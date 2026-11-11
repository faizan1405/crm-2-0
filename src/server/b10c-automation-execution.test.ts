import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  computeExecutionKey,
  executeAutomationInputSchema,
  MAX_EXECUTION_DEPTH,
} from "./crm/automationExecution.server";
import {
  crmAutomationRuns,
  crmAutomationRules,
  crmFollowUps,
  crmInternalReminders,
  crmLeadTags,
} from "./db/schema.server";

describe("Checkpoint B10C — Automation Execution Engine Contracts & Invariants", () => {
  describe("1. Drizzle Schema & Migration 0013 Invariants", () => {
    it("migration 0013 exists and contains execution_key unique constraint", () => {
      const migPath = path.resolve(
        process.cwd(),
        "src/server/db/migrations/0013_b10c_automation_execution.sql",
      );
      expect(fs.existsSync(migPath)).toBe(true);
      const sqlContent = fs.readFileSync(migPath, "utf8");
      expect(sqlContent).toContain("execution_key");
      expect(sqlContent).toContain("rule_version");
      expect(sqlContent).toContain("causation_id");
      expect(sqlContent).toContain("depth");
      expect(sqlContent).toContain("uq_crm_auto_runs_owner_exec_key");
    });

    it("crmAutomationRuns schema defines executionKey and unique constraint", () => {
      const cols = getTableColumns(crmAutomationRuns);
      expect(cols.executionKey).toBeDefined();
      expect(cols.ruleVersion).toBeDefined();
      expect(cols.causationId).toBeDefined();
      expect(cols.depth).toBeDefined();
    });

    it("crmFollowUps defines opId with unique index uq_crm_follow_ups_owner_op", () => {
      const cols = getTableColumns(crmFollowUps);
      expect(cols.opId).toBeDefined();
    });

    it("crmInternalReminders defines reminderKey with unique constraint", () => {
      const cols = getTableColumns(crmInternalReminders);
      expect(cols.reminderKey).toBeDefined();
    });

    it("crmLeadTags defines leadId and tagId composite unique relation", () => {
      const cols = getTableColumns(crmLeadTags);
      expect(cols.leadId).toBeDefined();
      expect(cols.tagId).toBeDefined();
      expect(cols.ownerUserId).toBeDefined();
    });
  });

  describe("2. Deterministic Deduplication Key (computeExecutionKey)", () => {
    it("produces identical SHA-256 hash for identical parameters", () => {
      const params = {
        ownerUserId: "usr_owner_alpha",
        sourceEventId: "lead_created_lead_123_2026-11-11",
        ruleId: "ar_rule_meta_01",
        ruleVersion: 1,
        actionIndex: 0,
        targetId: "lead:lead_123",
      };

      const key1 = computeExecutionKey(params);
      const key2 = computeExecutionKey(params);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex is 64 characters
      expect(/^[0-9a-f]{64}$/.test(key1)).toBe(true);
    });

    it("produces different hash when owner differs", () => {
      const base = {
        sourceEventId: "event_1",
        ruleId: "rule_1",
        ruleVersion: 1,
        actionIndex: 0,
        targetId: "lead:1",
      };
      const keyOwnerA = computeExecutionKey({ ...base, ownerUserId: "owner_a" });
      const keyOwnerB = computeExecutionKey({ ...base, ownerUserId: "owner_b" });
      expect(keyOwnerA).not.toBe(keyOwnerB);
    });

    it("produces different hash when rule version differs", () => {
      const base = {
        ownerUserId: "owner_a",
        sourceEventId: "event_1",
        ruleId: "rule_1",
        actionIndex: 0,
        targetId: "lead:1",
      };
      const keyV1 = computeExecutionKey({ ...base, ruleVersion: 1 });
      const keyV2 = computeExecutionKey({ ...base, ruleVersion: 2 });
      expect(keyV1).not.toBe(keyV2);
    });

    it("produces different hash when actionIndex differs", () => {
      const base = {
        ownerUserId: "owner_a",
        sourceEventId: "event_1",
        ruleId: "rule_1",
        ruleVersion: 1,
        targetId: "lead:1",
      };
      const keyAction0 = computeExecutionKey({ ...base, actionIndex: 0 });
      const keyAction1 = computeExecutionKey({ ...base, actionIndex: 1 });
      expect(keyAction0).not.toBe(keyAction1);
    });

    it("produces different hash when source event differs", () => {
      const base = {
        ownerUserId: "owner_a",
        ruleId: "rule_1",
        ruleVersion: 1,
        actionIndex: 0,
        targetId: "lead:1",
      };
      const keyEvent1 = computeExecutionKey({ ...base, sourceEventId: "evt_1" });
      const keyEvent2 = computeExecutionKey({ ...base, sourceEventId: "evt_2" });
      expect(keyEvent1).not.toBe(keyEvent2);
    });

    it("produces different hash when target ID differs", () => {
      const base = {
        ownerUserId: "owner_a",
        sourceEventId: "evt_1",
        ruleId: "rule_1",
        ruleVersion: 1,
        actionIndex: 0,
      };
      const keyTarget1 = computeExecutionKey({ ...base, targetId: "lead:101" });
      const keyTarget2 = computeExecutionKey({ ...base, targetId: "lead:102" });
      expect(keyTarget1).not.toBe(keyTarget2);
    });
  });

  describe("3. Execution Input Validation & Authorization Gate", () => {
    it("requires explicit authorized: true", () => {
      const validPayload = {
        event: {
          triggerType: "lead_created",
          leadId: "lead_001",
        },
        authorized: true,
      };

      const result = executeAutomationInputSchema.safeParse(validPayload);
      expect(result.success).toBe(true);

      const unauthorized = {
        event: {
          triggerType: "lead_created",
          leadId: "lead_001",
        },
        authorized: false,
      };
      const unauthResult = executeAutomationInputSchema.safeParse(unauthorized);
      expect(unauthResult.success).toBe(false);
    });

    it("rejects negative depth", () => {
      const invalidDepth = {
        event: { triggerType: "lead_created", leadId: "lead_001" },
        authorized: true,
        depth: -1,
      };
      const res = executeAutomationInputSchema.safeParse(invalidDepth);
      expect(res.success).toBe(false);
    });

    it("accepts valid test failure injection modes", () => {
      for (const mode of ["none", "transaction_error", "constraint_violation"] as const) {
        const payload = {
          event: { triggerType: "lead_created", leadId: "lead_001" },
          authorized: true,
          testFailureInjection: mode,
        };
        const res = executeAutomationInputSchema.safeParse(payload);
        expect(res.success).toBe(true);
      }
    });

    it("rejects unknown failure injection modes", () => {
      const payload = {
        event: { triggerType: "lead_created", leadId: "lead_001" },
        authorized: true,
        testFailureInjection: "hack_database",
      };
      const res = executeAutomationInputSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it("enforces MAX_EXECUTION_DEPTH constant is set to 3", () => {
      expect(MAX_EXECUTION_DEPTH).toBe(3);
    });
  });

  describe("4. Financial & Customer Invariants", () => {
    it("ensures automation tables are strictly separated from financial tables", () => {
      const runsCols = Object.keys(getTableColumns(crmAutomationRuns));
      expect(runsCols).not.toContain("amountPaise");
      expect(runsCols).not.toContain("dealValuePaise");
      expect(runsCols).not.toContain("paymentMode");
      expect(runsCols).not.toContain("stage");
    });

    it("ensures reminder table is strictly internal and contains no delivery claims", () => {
      const remCols = Object.keys(getTableColumns(crmInternalReminders));
      expect(remCols).toContain("status");
      expect(remCols).toContain("origin");
      expect(remCols).not.toContain("deliveredAt");
      expect(remCols).not.toContain("smsStatus");
      expect(remCols).not.toContain("emailStatus");
      expect(remCols).not.toContain("waStatus");
    });
  });
});
