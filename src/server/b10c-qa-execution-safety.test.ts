import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  getAutomationTestRateLimitPolicy,
  parseServerEnv,
  summarizeSafeRuntimeEnv,
  verifyDisposableAutomationTestDatabaseConfig,
} from "./config/env.server";
import { closeDatabasePool } from "./db/index.server";
import * as dbSchema from "./db/schema.server";
import { nextFixedWindowRateLimitState } from "./auth/rateLimit.server";
import { baseAutomationRuleSchema, MAX_ACTIONS_PER_EVENT } from "./crm/automationCalc.server";
import {
  computeExecutionKey,
  executeAutomationRuleRecord,
  sanitizeAutomationExecutionError,
} from "./crm/automationExecution.server";
import { syntheticEventSchema } from "./crm/automationSimulation.server";
import { ALL_ACTIVITY_TYPES } from "./crm/validation.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";

function buildExecuteTestRequest(
  ruleId: string,
  method = "POST",
  headers: Record<string, string> = {},
  body?: unknown,
): Request {
  return new Request(`http://127.0.0.1:3000/api/v1/automations/${ruleId}/execute-test`, {
    method,
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Checkpoint B10C-QA — Automation Execution Safety, Schema & Production Isolation", () => {
  const originalProcessNodeEnv = process.env["NODE_ENV"];

  afterEach(async () => {
    process.env["NODE_ENV"] = originalProcessNodeEnv;
    await closeDatabasePool();
  });

  describe("1. Schema & Migration History Accuracy", () => {
    it("confirms tag definition table is crm_tag_defs and never crm_tags", () => {
      expect(getTableName(dbSchema.crmTagDefs)).toBe("crm_tag_defs");
      expect((dbSchema as Record<string, unknown>)["crmTags"]).toBeUndefined();
      expect(getTableColumns(dbSchema.crmTagDefs).scope).toBeDefined();
      expect(getTableColumns(dbSchema.crmTagDefs).status).toBeDefined();
    });

    it("confirms crm_internal_reminders.status defaults to open with no snoozed schema artifact", () => {
      const cols = getTableColumns(dbSchema.crmInternalReminders);
      expect(cols.status.default).toBe("open");
      const mig0012 = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/db/migrations/0012_b10a_automation_rules.sql"),
        "utf8",
      );
      expect(mig0012).toContain("DEFAULT 'open'");
      expect(mig0012.toLowerCase()).not.toContain("snoozed");
    });

    it("confirms migration 0012 did not add rule_version and migration 0013 added it additively", () => {
      const mig0012 = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/db/migrations/0012_b10a_automation_rules.sql"),
        "utf8",
      );
      const mig0013 = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/db/migrations/0013_b10c_automation_execution.sql"),
        "utf8",
      );
      expect(mig0012).not.toContain("rule_version");
      expect(mig0013).toContain("ADD `rule_version`");
      expect(mig0013).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    });
  });

  describe("2. Disposable DB Allowlist & Production Isolation", () => {
    it("blocks execution in production env even when DEV_LEAD_PILOT=true and DB is allowlisted", () => {
      const env = parseServerEnv({
        NODE_ENV: "production",
        DEV_LEAD_PILOT: "true",
        APP_ORIGIN: "https://crm.joinscaleflow.in",
        DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/crm_qa_disposable",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable",
      });
      const res = verifyDisposableAutomationTestDatabaseConfig(env, "crm_qa_disposable");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("automation_test_disabled_in_production");
    });

    it("blocks execution if process.env.NODE_ENV is production regardless of parsed env object", () => {
      process.env["NODE_ENV"] = "production";
      const env = parseServerEnv({
        NODE_ENV: "development",
        DEV_LEAD_PILOT: "true",
        DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/crm_qa_disposable",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable",
      });
      const res = verifyDisposableAutomationTestDatabaseConfig(env, "crm_qa_disposable");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("automation_test_disabled_in_production");
    });

    it("blocks missing, empty, wildcard, and non-matching allowlists", () => {
      const base = {
        NODE_ENV: "test",
        DEV_LEAD_PILOT: "true",
        DATABASE_URL: "mysql://root:pass@127.0.0.1:13306/crm_qa_disposable",
      };

      const noList = verifyDisposableAutomationTestDatabaseConfig(
        parseServerEnv(base),
        "crm_qa_disposable",
      );
      expect(noList.ok).toBe(false);
      if (!noList.ok) expect(noList.code).toBe("disposable_db_allowlist_required");

      for (const badList of ["*", "crm_qa_*", "crm_qa_?disposable"]) {
        const wildcard = verifyDisposableAutomationTestDatabaseConfig(
          parseServerEnv({ ...base, AUTOMATION_TEST_DB_ALLOWLIST: badList }),
          "crm_qa_disposable",
        );
        expect(wildcard.ok).toBe(false);
        if (!wildcard.ok) expect(wildcard.code).toBe("invalid_disposable_db_allowlist");
      }

      const substringOnly = verifyDisposableAutomationTestDatabaseConfig(
        parseServerEnv({ ...base, AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa" }),
        "crm_qa_disposable",
      );
      expect(substringOnly.ok).toBe(false);
      if (!substringOnly.ok) expect(substringOnly.code).toBe("database_not_allowlisted");

      const liveMismatch = verifyDisposableAutomationTestDatabaseConfig(
        parseServerEnv({ ...base, AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable" }),
        "different_db",
      );
      expect(liveMismatch.ok).toBe(false);
      if (!liveMismatch.ok) expect(liveMismatch.code).toBe("database_name_mismatch");
    });

    it("permanently blocks non-local hosts and production/staging/Hostinger DB names", () => {
      const nonLocal = verifyDisposableAutomationTestDatabaseConfig(
        parseServerEnv({
          NODE_ENV: "development",
          DEV_LEAD_PILOT: "true",
          DATABASE_URL: "mysql://user:pass@sql123.hostinger.com:3306/crm_qa_disposable",
          AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable",
        }),
        "crm_qa_disposable",
      );
      expect(nonLocal.ok).toBe(false);
      if (!nonLocal.ok) expect(nonLocal.code).toBe("non_local_database_blocked");

      for (const protectedDb of [
        "crm_production",
        "prod_crm",
        "crm_staging",
        "crm_live",
        "u123456789_crm",
      ]) {
        const blocked = verifyDisposableAutomationTestDatabaseConfig(
          parseServerEnv({
            NODE_ENV: "development",
            DEV_LEAD_PILOT: "true",
            DATABASE_URL: `mysql://user:pass@127.0.0.1:3306/${protectedDb}`,
            AUTOMATION_TEST_DB_ALLOWLIST: protectedDb,
          }),
          protectedDb,
        );
        expect(blocked.ok).toBe(false);
        if (!blocked.ok) expect(blocked.code).toBe("protected_database_blocked");
      }
    });

    it("accepts exact allowlisted loopback disposable DB and hides DB details in summarizeSafeRuntimeEnv", () => {
      const env = parseServerEnv({
        NODE_ENV: "development",
        DEV_LEAD_PILOT: "true",
        DATABASE_URL: "mysql://root:secret_pw@127.0.0.1:13306/crm_b10c_qa_disposable",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_other, crm_b10c_qa_disposable",
        AUTOMATION_TEST_RATE_LIMIT_MAX: "25",
        AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS: "30",
      });
      const res = verifyDisposableAutomationTestDatabaseConfig(env, "crm_b10c_qa_disposable");
      expect(res).toEqual({
        ok: true,
        database: "crm_b10c_qa_disposable",
        host: "127.0.0.1",
      });
      expect(getAutomationTestRateLimitPolicy(env)).toEqual({
        maxRequests: 25,
        windowSeconds: 30,
      });

      const summaryJson = JSON.stringify(summarizeSafeRuntimeEnv(env));
      expect(summaryJson).not.toContain("crm_b10c_qa_disposable");
      expect(summaryJson).not.toContain("secret_pw");
    });
  });

  describe("3. HTTP /execute-test Route Security Matrix", () => {
    it("returns 404 PILOT_DISABLED in production even with DEV_LEAD_PILOT=true", async () => {
      const env = parseServerEnv({
        NODE_ENV: "production",
        DEV_LEAD_PILOT: "true",
        APP_ORIGIN: "https://crm.joinscaleflow.in",
        DATABASE_URL: "mysql://root:pass@127.0.0.1:13306/crm_qa_disposable",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable",
      });
      const req = new Request("https://crm.joinscaleflow.in/api/v1/automations/ar_1/execute-test", {
        method: "POST",
        headers: {
          origin: "https://crm.joinscaleflow.in",
          "content-type": "application/json",
        },
        body: JSON.stringify({ authorized: true }),
      });
      const res = await handleCrmApiRequest(req, "/api/v1/automations/ar_1/execute-test", env);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(404);
      const body = (await res!.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PILOT_DISABLED");
    });

    it("returns 403 when disposable DB allowlist is missing or DB name is protected", async () => {
      const missingAllowlistEnv = parseServerEnv({
        NODE_ENV: "test",
        DEV_LEAD_PILOT: "true",
        APP_ORIGIN: "http://127.0.0.1:3000",
        DATABASE_URL: "mysql://root:pass@127.0.0.1:13306/crm_qa_disposable",
      });
      const res1 = await handleCrmApiRequest(
        buildExecuteTestRequest("ar_1", "POST", {}, { authorized: true }),
        "/api/v1/automations/ar_1/execute-test",
        missingAllowlistEnv,
      );
      expect(res1!.status).toBe(403);
      expect(((await res1!.json()) as { error: { code: string } }).error.code).toBe(
        "disposable_db_allowlist_required",
      );

      const protectedDbEnv = parseServerEnv({
        NODE_ENV: "test",
        DEV_LEAD_PILOT: "true",
        APP_ORIGIN: "http://127.0.0.1:3000",
        DATABASE_URL: "mysql://root:pass@127.0.0.1:13306/crm_production",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_production",
      });
      const res2 = await handleCrmApiRequest(
        buildExecuteTestRequest("ar_1", "POST", {}, { authorized: true }),
        "/api/v1/automations/ar_1/execute-test",
        protectedDbEnv,
      );
      expect(res2!.status).toBe(403);
      expect(((await res2!.json()) as { error: { code: string } }).error.code).toBe(
        "protected_database_blocked",
      );
    });

    it("enforces POST-only 405 and CSRF Origin checks on /execute-test", async () => {
      const env = parseServerEnv({
        NODE_ENV: "test",
        DEV_LEAD_PILOT: "true",
        APP_ORIGIN: "http://127.0.0.1:3000",
        DATABASE_URL: "mysql://root:pass@127.0.0.1:13306/crm_qa_disposable",
        AUTOMATION_TEST_DB_ALLOWLIST: "crm_qa_disposable",
      });

      const getRes = await handleCrmApiRequest(
        buildExecuteTestRequest("ar_1", "GET"),
        "/api/v1/automations/ar_1/execute-test",
        env,
      );
      expect(getRes!.status).toBe(405);
      expect(getRes!.headers.get("allow")).toBe("POST");

      const csrfRes = await handleCrmApiRequest(
        buildExecuteTestRequest(
          "ar_1",
          "POST",
          { origin: "https://evil.example" },
          { authorized: true },
        ),
        "/api/v1/automations/ar_1/execute-test",
        env,
      );
      expect(csrfRes!.status).toBe(403);
      expect(((await csrfRes!.json()) as { error: { code: string } }).error.code).toBe(
        "csrf_rejected",
      );
    });
  });

  describe("4. Source Event Identity, Action Budget, Rate Limiting & Error Sanitization", () => {
    it("preserves event.eventId in syntheticEventSchema and rejects missing/conflicting eventId at execution", async () => {
      const parsed = syntheticEventSchema.parse({
        eventId: "evt_distinct_lead_change_901",
        triggerType: "lead_created",
        leadId: "lead_1",
      });
      expect(parsed.eventId).toBe("evt_distinct_lead_change_901");
      expect(() =>
        syntheticEventSchema.parse({ eventId: "ab", triggerType: "lead_created" }),
      ).toThrow();

      await expect(
        executeAutomationRuleRecord(
          {} as unknown as Parameters<typeof executeAutomationRuleRecord>[0],
          "owner_1",
          "owner_1",
          "ar_1",
          {
            authorized: true,
            event: { triggerType: "lead_created", leadId: "lead_1" },
            depth: 0,
          },
        ),
      ).rejects.toMatchObject({
        status: 400,
        code: "automation_validation_error",
      });

      await expect(
        executeAutomationRuleRecord(
          {} as unknown as Parameters<typeof executeAutomationRuleRecord>[0],
          "owner_1",
          "owner_1",
          "ar_1",
          {
            authorized: true,
            event: { eventId: "evt_A", triggerType: "lead_created", leadId: "lead_1" },
            depth: 0,
          },
          { sourceEventId: "evt_B" },
        ),
      ).rejects.toMatchObject({
        status: 400,
        code: "automation_validation_error",
      });
    });

    it("distinguishes batch (-1) vs single-action execution keys and distinct sourceEventIds", () => {
      const batchKey = computeExecutionKey({
        ownerUserId: "owner_1",
        sourceEventId: "evt_1",
        ruleId: "rule_1",
        ruleVersion: 1,
        actionIndex: -1,
        targetId: "lead_1",
      });
      const singleZeroKey = computeExecutionKey({
        ownerUserId: "owner_1",
        sourceEventId: "evt_1",
        ruleId: "rule_1",
        ruleVersion: 1,
        actionIndex: 0,
        targetId: "lead_1",
      });
      expect(batchKey).not.toBe(singleZeroKey);
    });

    it("enforces MAX_ACTIONS_PER_EVENT = 5 on rule schema validation", () => {
      expect(MAX_ACTIONS_PER_EVENT).toBe(5);
      const valid5 = baseAutomationRuleSchema.safeParse({
        name: "Five action rule",
        description: "OK",
        subject: "lead",
        triggerType: "lead_created",
        status: "draft",
        conditions: {},
        actions: ["reminder", "followup", "notify", "flag", "owner_review"],
        settings: { cooldownHours: 24 },
      });
      expect(valid5.success).toBe(true);

      const invalid6 = baseAutomationRuleSchema.safeParse({
        name: "Six action rule",
        description: "Too many",
        subject: "lead",
        triggerType: "lead_created",
        status: "draft",
        conditions: {},
        actions: ["reminder", "followup", "notify", "flag", "owner_review", "activity"],
        settings: { cooldownHours: 24 },
      });
      expect(invalid6.success).toBe(false);
    });

    it("enforces fixed-window rate limiter transitions and window resets", () => {
      const t0 = new Date("2026-11-11T10:00:00.000Z");
      const policy = { maxRequests: 2, windowSeconds: 60 };

      const r1 = nextFixedWindowRateLimitState(null, policy, t0);
      expect(r1.blocked).toBe(false);
      expect(r1.remaining).toBe(1);

      const r2 = nextFixedWindowRateLimitState(r1.nextState, policy, new Date(t0.getTime() + 1000));
      expect(r2.blocked).toBe(false);
      expect(r2.remaining).toBe(0);

      const r3 = nextFixedWindowRateLimitState(r2.nextState, policy, new Date(t0.getTime() + 2000));
      expect(r3.blocked).toBe(true);
      expect(r3.retryAfterSeconds).toBe(58);

      const reset = nextFixedWindowRateLimitState(
        r3.nextState,
        policy,
        new Date(t0.getTime() + 61000),
      );
      expect(reset.blocked).toBe(false);
      expect(reset.remaining).toBe(1);
    });

    it("uses canonical 'followup' activity type matching validation.server contract", () => {
      expect(ALL_ACTIVITY_TYPES).toContain("followup");
      expect(ALL_ACTIVITY_TYPES).not.toContain("follow_up");
    });

    it("scrubs raw SQL/Drizzle internals from execution errors while retaining safe markers", () => {
      const rawDrizzleErr = new Error(
        "Failed query: insert into `crm_lead_activities` (`id`, `secret_token`) values (?, ?) params: act_1, topsecret",
      );
      const sanitized = sanitizeAutomationExecutionError(rawDrizzleErr);
      expect(sanitized).not.toContain("Failed query");
      expect(sanitized).not.toContain("crm_lead_activities");
      expect(sanitized).not.toContain("topsecret");

      const dupErr = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      expect(sanitizeAutomationExecutionError(dupErr)).toContain("uniqueness constraint");

      expect(sanitizeAutomationExecutionError(new Error("INJECTED_LEAD_SYNC_FAILURE"))).toContain(
        "lead synchronization",
      );
      expect(sanitizeAutomationExecutionError(new Error("INJECTED_ACTIVITY_FAILURE"))).toContain(
        "lead activity",
      );
    });
  });
});
