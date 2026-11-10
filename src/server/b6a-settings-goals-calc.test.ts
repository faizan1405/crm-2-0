import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getIstUtcRange } from "./crm/analyticsCalc.server";
import { CrmServiceError } from "./crm/errors.server";
import {
  calculateGoalProgress,
  definitionOn,
  GOAL_METRIC_DEFINITIONS,
  GOAL_METRIC_KEYS,
  GOAL_METRIC_MAP,
  resolveGoalWindow,
  type GoalDefinitionSnapshot,
  type GoalRevisionSnapshotEntry,
} from "./crm/goalsCalc.server";
import { getSettingsDefinitionsRecord } from "./crm/settingsService.server";
import {
  assertNoForbiddenSettingKeys,
  parseCreateGoalBody,
  parseGoalTargetForMetric,
  parseUpdateGoalBody,
  parseUpdateSettingsBody,
} from "./crm/settingsGoalsValidation.server";
import {
  appSchema,
  crmCoreSchema,
  crmOwnerSettings,
  crmSalesGoalRevisions,
  crmSalesGoals,
  crmSettingsAuditEvents,
  crmSettingsGoalsSchema,
} from "./db/schema.server";

describe("Checkpoint B6A — Settings, Goals Schema, Validation & Progress Engine", () => {
  describe("1. Drizzle Schema & Forward Migration 0009 Safety", () => {
    it("exports all 4 B6A Drizzle tables inside appSchema & crmCoreSchema", () => {
      expect(getTableName(crmOwnerSettings)).toBe("crm_owner_settings");
      expect(getTableName(crmSettingsAuditEvents)).toBe("crm_settings_audit_events");
      expect(getTableName(crmSalesGoals)).toBe("crm_sales_goals");
      expect(getTableName(crmSalesGoalRevisions)).toBe("crm_sales_goal_revisions");

      expect(crmSettingsGoalsSchema.crmOwnerSettings).toBe(crmOwnerSettings);
      expect(crmCoreSchema.crmSalesGoals).toBe(crmSalesGoals);
      expect(appSchema.crmSettingsAuditEvents).toBe(crmSettingsAuditEvents);
      expect(appSchema.crmSalesGoalRevisions).toBe(crmSalesGoalRevisions);

      expect(Object.keys(getTableColumns(crmOwnerSettings))).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "ownerDisplayName",
          "businessName",
          "profileEmail",
          "businessTimezone",
          "currencyCode",
          "defaultLeadSort",
          "overdueThreshold",
          "version",
        ]),
      );

      expect(Object.keys(getTableColumns(crmSalesGoals))).toEqual(
        expect.arrayContaining([
          "id",
          "legacyId",
          "ownerUserId",
          "metric",
          "scope",
          "targetUnit",
          "targetCount",
          "targetAmount",
          "period",
          "customFromIst",
          "customToIst",
          "effectiveFromIst",
          "status",
          "version",
        ]),
      );
    });

    it("orders CREATE TABLE statements before FK constraints and respects MariaDB 64-char identifiers in 0009 migration", () => {
      const sqlPath = path.join(
        process.cwd(),
        "src",
        "server",
        "db",
        "migrations",
        "0009_b6a_settings_goals.sql",
      );
      expect(fs.existsSync(sqlPath)).toBe(true);
      const content = fs.readFileSync(sqlPath, "utf8");

      const statements = content
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      let seenAlter = false;
      for (const stmt of statements) {
        if (/^CREATE TABLE/i.test(stmt)) {
          expect(seenAlter).toBe(false);
        }
        if (/^ALTER TABLE/i.test(stmt)) {
          seenAlter = true;
          expect(stmt).not.toMatch(/ON DELETE CASCADE/i);
        }
      }
      expect(seenAlter).toBe(true);

      const identMatches = [...content.matchAll(/(?:CONSTRAINT|INDEX)\s+`([^`]+)`/g)].map(
        (m) => m[1]!,
      );
      expect(identMatches.length).toBeGreaterThan(5);
      for (const ident of identMatches) {
        expect(ident.length).toBeLessThanOrEqual(64);
      }
    });
  });

  describe("2. Goal Period Resolution, IST Boundaries & Leap Years", () => {
    it("resolves daily, weekly (Mon-Sun), monthly (including leap Feb), and custom IST windows", () => {
      expect(
        resolveGoalWindow(
          { period: "daily", customFromIst: null, customToIst: null },
          "2026-11-10",
        ),
      ).toEqual({
        window: { start: "2026-11-10", end: "2026-11-10" },
        windowState: "active",
      });

      // 2026-11-10 is Tuesday -> Mon 2026-11-09 .. Sun 2026-11-15
      expect(
        resolveGoalWindow(
          { period: "weekly", customFromIst: null, customToIst: null },
          "2026-11-10",
        ),
      ).toEqual({
        window: { start: "2026-11-09", end: "2026-11-15" },
        windowState: "active",
      });
      // Sunday belongs to same week starting prior Monday
      expect(
        resolveGoalWindow(
          { period: "weekly", customFromIst: null, customToIst: null },
          "2026-11-15",
        ),
      ).toEqual({
        window: { start: "2026-11-09", end: "2026-11-15" },
        windowState: "active",
      });

      // Leap year Feb 2024 vs non-leap Feb 2026
      expect(
        resolveGoalWindow(
          { period: "monthly", customFromIst: null, customToIst: null },
          "2024-02-10",
        ),
      ).toEqual({
        window: { start: "2024-02-01", end: "2024-02-29" },
        windowState: "active",
      });
      expect(
        resolveGoalWindow(
          { period: "monthly", customFromIst: null, customToIst: null },
          "2026-02-10",
        ),
      ).toEqual({
        window: { start: "2026-02-01", end: "2026-02-28" },
        windowState: "active",
      });

      // Custom active, future, expired
      expect(
        resolveGoalWindow(
          { period: "custom", customFromIst: "2026-11-01", customToIst: "2026-11-15" },
          "2026-11-10",
        ),
      ).toEqual({
        window: { start: "2026-11-01", end: "2026-11-15" },
        windowState: "active",
      });
      expect(
        resolveGoalWindow(
          { period: "custom", customFromIst: "2026-12-01", customToIst: "2026-12-31" },
          "2026-11-10",
        ),
      ).toEqual({
        window: null,
        windowState: "future",
      });
      expect(
        resolveGoalWindow(
          { period: "custom", customFromIst: "2026-10-01", customToIst: "2026-10-31" },
          "2026-11-10",
        ),
      ).toEqual({
        window: null,
        windowState: "expired",
      });

      // IST midnight boundary check (+05:30)
      const range = getIstUtcRange({ start: "2026-11-10", end: "2026-11-10" });
      expect(range.startUtc.toISOString()).toBe("2026-11-09T18:30:00.000Z");
      expect(range.endUtc.toISOString()).toBe("2026-11-10T18:29:59.999Z");
    });

    it("resolves historical goal revisions cleanly with definitionOn()", () => {
      const rev1Snap: GoalDefinitionSnapshot = {
        name: "Monthly Cash",
        metric: "cash_collected",
        scope: "owner",
        targetUnit: "inr",
        targetCount: null,
        targetAmount: "50000.00",
        period: "monthly",
        customFromIst: null,
        customToIst: null,
        effectiveFromIst: "2026-11-01",
        status: "active",
        version: 1,
      };
      const currentSnap: GoalDefinitionSnapshot = {
        ...rev1Snap,
        targetAmount: "100000.00",
        effectiveFromIst: "2026-11-10",
        version: 2,
      };
      const revisions: GoalRevisionSnapshotEntry[] = [
        { revisionNumber: 1, effectiveFromIst: "2026-11-01", snapshot: rev1Snap },
        { revisionNumber: 2, effectiveFromIst: "2026-11-10", snapshot: currentSnap },
      ];

      expect(definitionOn(currentSnap, revisions, "2026-11-05")?.targetAmount).toBe("50000.00");
      expect(definitionOn(currentSnap, revisions, "2026-11-10")?.targetAmount).toBe("100000.00");
      expect(definitionOn(currentSnap, revisions, "2026-10-31")).toBeNull();
    });
  });

  describe("3. Goal Progress Calculation & Zero-Fabrication Rules", () => {
    const baseInrDef: GoalDefinitionSnapshot = {
      name: "Monthly Cash Collected",
      metric: "cash_collected",
      scope: "owner",
      targetUnit: "inr",
      targetCount: null,
      targetAmount: "100000.00",
      period: "monthly",
      customFromIst: null,
      customToIst: null,
      effectiveFromIst: "2026-11-01",
      status: "active",
      version: 1,
    };

    it("evaluates exact INR progress without float drift and never fabricates unset/zero denominators", () => {
      const prog40 = calculateGoalProgress({
        def: baseInrDef,
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, paiseValue: 4_000_000 },
        fallbackUnit: "inr",
      });
      expect(prog40.status).toBe("in_progress");
      expect(prog40.target).toBe(100000);
      expect(prog40.targetDecimal).toBe("100000.00");
      expect(prog40.actual).toBe(40000);
      expect(prog40.actualDecimal).toBe("40000.00");
      expect(prog40.pct).toBe(0.4);
      expect(prog40.pctPercent).toBe(40);
      expect(prog40.remaining).toBe(60000);

      // Fractional paise exactness
      const progPaise = calculateGoalProgress({
        def: { ...baseInrDef, targetAmount: "30001.00" },
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, paiseValue: 3_000_030 },
        fallbackUnit: "inr",
      });
      expect(progPaise.actualDecimal).toBe("30000.30");
      expect(progPaise.remainingDecimal).toBe("0.70");

      // Unset null target -> not_configured, pct: null, never NaN/Infinity
      const unsetProg = calculateGoalProgress({
        def: { ...baseInrDef, targetAmount: null },
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, paiseValue: 500_000 },
        fallbackUnit: "inr",
      });
      expect(unsetProg.status).toBe("not_configured");
      expect(unsetProg.target).toBeNull();
      expect(unsetProg.pct).toBeNull();
      expect(unsetProg.actual).toBe(5000);

      // Zero denominator guard
      const zeroTargetProg = calculateGoalProgress({
        def: { ...baseInrDef, targetUnit: "count", targetCount: 0, targetAmount: null },
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, countValue: 5 },
        fallbackUnit: "count",
      });
      expect(zeroTargetProg.status).toBe("not_configured");
      expect(zeroTargetProg.pct).toBeNull();

      // Unavailable/unmeasurable state returns null actual & pct
      const unmeasurable = calculateGoalProgress({
        def: baseInrDef,
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: false, reason: "Employee scope unavailable." },
        fallbackUnit: "inr",
      });
      expect(unmeasurable.status).toBe("not_measurable");
      expect(unmeasurable.actual).toBeNull();
      expect(unmeasurable.pct).toBeNull();

      // Met & exceeded count goals
      const countDef: GoalDefinitionSnapshot = {
        ...baseInrDef,
        metric: "calls_connected",
        targetUnit: "count",
        targetCount: 50,
        targetAmount: null,
      };
      const metProg = calculateGoalProgress({
        def: countDef,
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, countValue: 50 },
        fallbackUnit: "count",
      });
      expect(metProg.status).toBe("met");
      expect(metProg.pctPercent).toBe(100);
      expect(metProg.remaining).toBe(0);

      const excProg = calculateGoalProgress({
        def: countDef,
        goalStatus: "active",
        asOfIstDate: "2026-11-10",
        measurement: { measurable: true, countValue: 65 },
        fallbackUnit: "count",
      });
      expect(excProg.status).toBe("exceeded");
      expect(excProg.pctPercent).toBe(130);
      expect(excProg.remaining).toBe(0);
    });

    it("preserves mandatory metric distinctions across definitions", () => {
      expect(GOAL_METRIC_KEYS).toHaveLength(GOAL_METRIC_DEFINITIONS.length);
      expect(GOAL_METRIC_MAP.deals_booked_value.unit).toBe("inr");
      expect(GOAL_METRIC_MAP.cash_collected.unit).toBe("inr");
      expect(GOAL_METRIC_MAP.deals_booked.unit).toBe("count");
      expect(GOAL_METRIC_MAP.calls_logged.key).not.toBe(GOAL_METRIC_MAP.calls_connected.key);
      expect(GOAL_METRIC_MAP.quotations_created.key).not.toBe(GOAL_METRIC_MAP.quotations_sent.key);
    });
  });

  describe("4. Security Blocklist & Strict Settings/Goals Input Validation", () => {
    it("blocks dangerous credential, role, token, storage, and pilot override keys with 403", () => {
      for (const badKey of [
        "password",
        "passwordHash",
        "roleId",
        "role",
        "accountStatus",
        "permissions",
        "apiKey",
        "openrouter_api_key",
        "secret",
        "authSecret",
        "sessionToken",
        "bankPassword",
        "bankCredentials",
        "proofStorageDir",
        "databaseUrl",
        "leadPilotAvailable",
        "DEV_LEAD_PILOT",
        "bypassAuth",
      ]) {
        let caught: unknown;
        try {
          parseUpdateSettingsBody({ businessName: "Valid Co", [badKey]: "injected" });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(CrmServiceError);
        expect((caught as CrmServiceError).status).toBe(403);
        expect((caught as CrmServiceError).code).toBe("forbidden_setting_key");
      }

      // Nested forbidden key inside goal/settings payload also blocked
      expect(() =>
        assertNoForbiddenSettingKeys({ nested: { deeper: [{ session_token: "abc" }] } }),
      ).toThrowError(CrmServiceError);
    });

    it("rejects unknown keys, secrets in text, fixed timezone/currency changes, and malformed settings values", () => {
      // Valid update passes cleanly and normalizes email & GSTIN
      const valid = parseUpdateSettingsBody({
        ownerDisplayName: "Faizan Studio",
        businessName: "Scale Flow Studio",
        profileEmail: "Hello@ScaleFlow.IN",
        businessPhone: "+91 98765 43210",
        businessWebsite: "https://scaleflow.in",
        gstin: "27aabcu9603r1zm",
        defaultLeadSort: "score",
        notifyFollowUps: true,
        overdueThreshold: 14,
      });
      expect(valid.profileEmail).toBe("hello@scaleflow.in");
      expect(valid.gstin).toBe("27AABCU9603R1ZM");

      // Secret in paymentInstructions -> 400 secret_detected
      expect(() =>
        parseUpdateSettingsBody({
          paymentInstructions: "cpanel login: admin password=mysecretpass",
        }),
      ).toThrowError(CrmServiceError);

      // Unknown safe key -> Zod strict validation error
      expect(() => parseUpdateSettingsBody({ randomFooSetting: "bar" })).toThrow();

      // Invariant overrides rejected
      expect(() => parseUpdateSettingsBody({ businessTimezone: "America/New_York" })).toThrow();
      expect(() => parseUpdateSettingsBody({ currencyCode: "USD" })).toThrow();

      // Malformed values
      expect(() => parseUpdateSettingsBody({ profileEmail: "not-an-email" })).toThrow();
      expect(() => parseUpdateSettingsBody({ businessWebsite: "javascript:alert(1)" })).toThrow();
      expect(() => parseUpdateSettingsBody({ gstin: "INVALID" })).toThrow();
      expect(() => parseUpdateSettingsBody({ businessPhone: "abc!!" })).toThrow();
      expect(() => parseUpdateSettingsBody({ overdueThreshold: 0 })).toThrow();
      expect(() => parseUpdateSettingsBody({ overdueThreshold: 1.5 })).toThrow();
      expect(() => parseUpdateSettingsBody({ notifyDigest: "yes" })).toThrow();
      expect(() => parseUpdateSettingsBody({ expectedVersion: 1 })).toThrow(); // no mutable setting fields
    });

    it("validates goal creation, strict monetary/count targets, custom date bounds, and unsupported metrics/scopes", () => {
      // Null/omitted target leaves unset
      const unsetGoal = parseCreateGoalBody({
        name: "Daily Calls",
        metric: "calls_logged",
        period: "daily",
      });
      expect(unsetGoal.parsedTarget).toEqual({
        targetUnit: "count",
        targetCount: null,
        targetAmount: null,
      });

      // Monetary string & number parse accurately
      expect(parseGoalTargetForMetric("cash_collected", 100000)).toEqual({
        targetUnit: "inr",
        targetCount: null,
        targetAmount: "100000.00",
      });
      expect(parseGoalTargetForMetric("deals_booked_value", "250000.50")).toEqual({
        targetUnit: "inr",
        targetCount: null,
        targetAmount: "250000.50",
      });

      // Invalid count/money targets rejected
      for (const badTarget of [0, -10, "-500", 12.555, "12.345", "1e5", Number.NaN, true, "abc"]) {
        expect(() => parseGoalTargetForMetric("cash_collected", badTarget)).toThrowError(
          CrmServiceError,
        );
      }
      for (const badCount of [0, -1, 1.5, 12.5, "1.5", "abc", true, Number.POSITIVE_INFINITY]) {
        expect(() => parseGoalTargetForMetric("calls_connected", badCount)).toThrowError(
          CrmServiceError,
        );
      }

      // Invalid date ranges on custom goals
      expect(() =>
        parseCreateGoalBody({
          name: "Bad Custom",
          metric: "cash_collected",
          period: "custom",
          customFromIst: "2026-11-20",
          customToIst: "2026-11-10",
        }),
      ).toThrow();
      expect(() =>
        parseCreateGoalBody({
          name: "Leap Bad",
          metric: "cash_collected",
          period: "custom",
          customFromIst: "2026-02-29",
          customToIst: "2026-03-10",
        }),
      ).toThrow();

      // Unsupported metric -> 400 unsupported_metric
      let badMetricErr: unknown;
      try {
        parseCreateGoalBody({
          name: "Magic WA",
          metric: "whatsapp_delivered",
          period: "daily",
        });
      } catch (e) {
        badMetricErr = e;
      }
      expect(badMetricErr).toBeInstanceOf(CrmServiceError);
      expect((badMetricErr as CrmServiceError).code).toBe("unsupported_metric");

      // Employee scope blocked cleanly
      expect(() =>
        parseCreateGoalBody({
          name: "Emp Goal",
          metric: "calls_logged",
          scope: "employee",
          period: "daily",
        }),
      ).toThrowError(CrmServiceError);

      // Update requires expectedVersion >= 1
      expect(() => parseUpdateGoalBody({ name: "No Version" })).toThrow();
      const upd = parseUpdateGoalBody({ expectedVersion: 2, target: null });
      expect(upd.hasTargetField).toBe(true);
    });

    it("exposes authoritative read-only definitions without duplicating existing template APIs", () => {
      const defs = getSettingsDefinitionsRecord();
      expect(defs.ok).toBe(true);
      expect(defs.definitions.invariants).toEqual({
        businessTimezone: "Asia/Kolkata",
        currencyCode: "INR",
        readOnly: true,
      });
      expect(defs.definitions.existingTemplateEndpoints).toEqual({
        quotationTemplates: "/api/v1/quotation-templates",
        projectTemplates: "/api/v1/project-templates",
      });
      expect(defs.definitions.goalMetrics).toHaveLength(12);
      expect(defs.definitions.deferredModules).toContain("customFieldsCrud");
    });
  });
});
