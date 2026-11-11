import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ALL_TRIGGERS,
  ACTION_LABELS,
  ACTION_TYPES,
  ACTIONS_FOR,
  CUSTOM_CONDITION_OPERATORS,
  LEAD_TRIGGERS,
  PROJECT_TRIGGERS,
  TRIGGER_LABELS,
  calculateContactState,
  calculateLastActivityAt,
  calculateLastAttemptAt,
  createAutomationRuleSchema,
  detectRuleConflicts,
  evaluateConditionOperator,
  evaluateLeadConditions,
  updateAutomationRuleSchema,
  validateRuleSemantics,
  type LeadEvaluationContext,
  type RuleConditions,
} from "./crm/automationCalc.server";
import {
  appSchema,
  crmAutomationRuleRevisions,
  crmAutomationRules,
  crmAutomationRuns,
  crmAutomationSchema,
  crmCoreSchema,
  crmInternalReminders,
} from "./db/schema.server";

describe("Checkpoint B10A — Automation Rules Schema & Pure Calculation Suite", () => {
  describe("1. Drizzle Schema & Migration 0012 Forward Safety", () => {
    it("exports all 4 automation tables in crmAutomationSchema, crmCoreSchema, and appSchema", () => {
      expect(getTableName(crmAutomationRules)).toBe("crm_automation_rules");
      expect(getTableName(crmAutomationRuleRevisions)).toBe("crm_automation_rule_revisions");
      expect(getTableName(crmAutomationRuns)).toBe("crm_automation_runs");
      expect(getTableName(crmInternalReminders)).toBe("crm_internal_reminders");

      expect(crmAutomationSchema.crmAutomationRules).toBe(crmAutomationRules);
      expect(crmAutomationSchema.crmAutomationRuleRevisions).toBe(crmAutomationRuleRevisions);
      expect(crmAutomationSchema.crmAutomationRuns).toBe(crmAutomationRuns);
      expect(crmAutomationSchema.crmInternalReminders).toBe(crmInternalReminders);

      expect(crmCoreSchema.crmAutomationRules).toBe(crmAutomationRules);
      expect(crmCoreSchema.crmAutomationRuleRevisions).toBe(crmAutomationRuleRevisions);
      expect(crmCoreSchema.crmAutomationRuns).toBe(crmAutomationRuns);
      expect(crmCoreSchema.crmInternalReminders).toBe(crmInternalReminders);

      expect(appSchema.crmAutomationRules).toBe(crmAutomationRules);
      expect(appSchema.crmAutomationRuleRevisions).toBe(crmAutomationRuleRevisions);
      expect(appSchema.crmAutomationRuns).toBe(crmAutomationRuns);
      expect(appSchema.crmInternalReminders).toBe(crmInternalReminders);
    });

    it("verifies crmAutomationRules column definitions", () => {
      const cols = Object.keys(getTableColumns(crmAutomationRules));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "name",
          "description",
          "templateId",
          "subject",
          "triggerType",
          "status",
          "pausedReason",
          "conditionsJson",
          "actionsJson",
          "settingsJson",
          "lastEvaluatedAt",
          "lastTriggeredAt",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies crmAutomationRuleRevisions column definitions", () => {
      const cols = Object.keys(getTableColumns(crmAutomationRuleRevisions));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "ruleId",
          "version",
          "name",
          "description",
          "subject",
          "triggerType",
          "status",
          "conditionsJson",
          "actionsJson",
          "settingsJson",
          "diffSummary",
          "actorUserId",
          "createdAt",
        ]),
      );
    });

    it("verifies crmAutomationRuns column definitions", () => {
      const cols = Object.keys(getTableColumns(crmAutomationRuns));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "ruleId",
          "triggerType",
          "outcome",
          "isSimulation",
          "leadId",
          "projectId",
          "matchedCount",
          "skippedCount",
          "plannedActionsJson",
          "executedActionsJson",
          "executionError",
          "actorUserId",
          "createdAt",
        ]),
      );
    });

    it("verifies crmInternalReminders column definitions", () => {
      const cols = Object.keys(getTableColumns(crmInternalReminders));
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "ownerUserId",
          "reminderKey",
          "ruleId",
          "ruleName",
          "leadId",
          "projectId",
          "taskId",
          "employeeId",
          "reason",
          "dueAt",
          "importance",
          "status",
          "flag",
          "ownerReview",
          "escalated",
          "followUpId",
          "resolveWhen",
          "origin",
          "historyJson",
          "closedAt",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies migration 0012 SQL file and journal entry exist", () => {
      const migPath = path.resolve(
        process.cwd(),
        "src/server/db/migrations/0012_b10a_automation_rules.sql",
      );
      expect(fs.existsSync(migPath)).toBe(true);

      const sqlContent = fs.readFileSync(migPath, "utf8");
      expect(sqlContent).toContain("CREATE TABLE `crm_automation_rules`");
      expect(sqlContent).toContain("CREATE TABLE `crm_automation_rule_revisions`");
      expect(sqlContent).toContain("CREATE TABLE `crm_automation_runs`");
      expect(sqlContent).toContain("CREATE TABLE `crm_internal_reminders`");
      expect(sqlContent).toContain("uq_crm_reminders_owner_key");

      const journalPath = path.resolve(
        process.cwd(),
        "src/server/db/migrations/meta/_journal.json",
      );
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const entry = journal.entries.find(
        (e: { tag: string }) => e.tag === "0012_b10a_automation_rules",
      );
      expect(entry).toBeDefined();
    });
  });

  describe("2. Trigger Contracts & Action Models", () => {
    it("contains exactly 10 Lead triggers and 9 Project triggers", () => {
      expect(LEAD_TRIGGERS).toHaveLength(10);
      expect(PROJECT_TRIGGERS).toHaveLength(9);
      expect(ALL_TRIGGERS).toHaveLength(19);

      for (const t of ALL_TRIGGERS) {
        expect(TRIGGER_LABELS[t]).toBeDefined();
        expect(typeof TRIGGER_LABELS[t]).toBe("string");
      }
    });

    it("restricts available actions per subject", () => {
      expect(ACTIONS_FOR.lead).toContain("followup");
      expect(ACTIONS_FOR.lead).not.toContain("task");

      expect(ACTIONS_FOR.project).toContain("task");
      expect(ACTIONS_FOR.project).not.toContain("followup");

      for (const a of ACTION_TYPES) {
        expect(ACTION_LABELS[a]).toBeDefined();
      }
    });
  });

  describe("3. Zod Input Validation & Security Guards", () => {
    it("validates a standard valid lead automation rule", () => {
      const valid = {
        name: "Quick Response Alert",
        description: "Alert when lead is new",
        subject: "lead" as const,
        triggerType: "lead_created" as const,
        status: "draft" as const,
        conditions: {
          sources: ["Website", "Meta Ads"],
          stages: ["new"],
          firstContactPending: true,
          minCreatedMinutes: 15,
        },
        actions: ["reminder" as const, "flag" as const],
        settings: {
          cooldownHours: 24,
        },
      };

      const parsed = createAutomationRuleSchema.parse(valid);
      expect(parsed.name).toBe("Quick Response Alert");
    });

    it("rejects cooldown less than 1 hour", () => {
      const invalid = {
        name: "Loop Rule",
        subject: "lead" as const,
        triggerType: "lead_created" as const,
        conditions: {},
        actions: ["reminder" as const],
        settings: {
          cooldownHours: 0,
        },
      };

      expect(() => createAutomationRuleSchema.parse(invalid)).toThrow();
    });

    it("rejects excessive condition count (> 25)", () => {
      const conditions: RuleConditions = {
        custom: Array.from({ length: 26 }, (_, i) => ({
          id: `c_${i}`,
          field: `custom_${i}`,
          op: "is" as const,
          value: `val_${i}`,
        })),
      };

      expect(() =>
        createAutomationRuleSchema.parse({
          name: "Too many conditions",
          triggerType: "lead_created" as const,
          conditions,
          actions: ["reminder" as const],
          settings: { cooldownHours: 24 },
        }),
      ).toThrow();
    });

    it("rejects script injection patterns in rule name", () => {
      expect(() =>
        createAutomationRuleSchema.parse({
          name: '<script>alert("xss")</script>',
          triggerType: "lead_created" as const,
          conditions: {},
          actions: ["reminder" as const],
          settings: { cooldownHours: 24 },
        }),
      ).toThrow(/Unsafe script or expression detected/);
    });

    it("rejects arbitrary SQL payload in rule conditions", () => {
      expect(() =>
        createAutomationRuleSchema.parse({
          name: "SQL injection test",
          triggerType: "lead_created" as const,
          conditions: {
            custom: [
              {
                id: "c1",
                field: "budget' OR '1'='1",
                op: "is" as const,
                value: "1000",
              },
            ],
          },
          actions: ["reminder" as const],
          settings: { cooldownHours: 24 },
        }),
      ).toThrow();
    });

    it("requires expectedVersion for updateAutomationRuleSchema", () => {
      expect(() =>
        updateAutomationRuleSchema.parse({
          name: "Update Rule",
          triggerType: "lead_created" as const,
          conditions: {},
          actions: ["reminder" as const],
          settings: { cooldownHours: 24 },
        }),
      ).toThrow();
    });
  });

  describe("4. Business Semantics & Conflict Detection", () => {
    it("rejects Won-deal rule with non-won stages", () => {
      const err = validateRuleSemantics({
        name: "Won Deal",
        triggerType: "deal_won",
        actions: ["reminder"],
        conditions: { stages: ["qualified"] },
        settings: { cooldownHours: 24 },
      });
      expect(err).toBe("A Won-deal rule can only match the Won stage.");
    });

    it("rejects project trigger on a lead rule", () => {
      const err = validateRuleSemantics({
        name: "Mismatch",
        subject: "lead",
        triggerType: "task_overdue",
        actions: ["reminder"],
        conditions: {},
        settings: { cooldownHours: 24 },
      });
      expect(err).toBe("Choose a Lead trigger for a Lead rule.");
    });

    it("rejects followup action without followupInHours setting", () => {
      const err = validateRuleSemantics({
        name: "Auto Followup",
        subject: "lead",
        triggerType: "lead_created",
        actions: ["followup"],
        conditions: {},
        settings: { cooldownHours: 24 },
      });
      expect(err).toBe("Set when the automatic follow-up should be due (followupInHours).");
    });

    it("detects identical enabled rule conflicts", () => {
      const rule = {
        name: "Rule B",
        triggerType: "lead_created" as const,
        conditions: { sources: ["Website"] },
        actions: ["reminder" as const],
      };
      const existing = [
        {
          id: "r1",
          name: "Rule A",
          subject: "lead" as const,
          triggerType: "lead_created" as const,
          status: "enabled" as const,
          conditions: { sources: ["Website"] },
          actions: ["reminder" as const],
        },
      ];

      const conflicts = detectRuleConflicts(rule, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain("already uses the same trigger and conditions");
    });
  });

  describe("5. Contact State & Activity Tracking", () => {
    it("differentiates contact states accurately", () => {
      expect(calculateContactState("l1", [])).toBe("none");

      expect(
        calculateContactState("l1", [
          { leadId: "l1", type: "call", outcome: "Not picked" },
        ]),
      ).toBe("attempted");

      expect(
        calculateContactState("l1", [
          { leadId: "l1", type: "call", outcome: "Connected" },
        ]),
      ).toBe("established");

      expect(
        calculateContactState("l1", [
          { leadId: "l1", type: "whatsapp", outcome: null },
        ]),
      ).toBe("outbound");
    });

    it("ignores automation-origin activities when tracking contact state", () => {
      expect(
        calculateContactState("l1", [
          { leadId: "l1", type: "call", outcome: "Connected", opId: "auto:123" },
        ]),
      ).toBe("none");
    });
  });

  describe("6. Condition Operator Evaluation (INR, Dates, Strings)", () => {
    it("handles numeric comparisons (INR paise / numbers)", () => {
      expect(evaluateConditionOperator("gt", 500000, 200000)).toBe(true);
      expect(evaluateConditionOperator("lte", 100000, 100000)).toBe(true);
      expect(evaluateConditionOperator("between", 150000, [100000, 200000])).toBe(true);
      expect(evaluateConditionOperator("between", 250000, [100000, 200000])).toBe(false);
    });

    it("handles string comparisons case-insensitively", () => {
      expect(evaluateConditionOperator("is", "Meta Ads", "meta ads")).toBe(true);
      expect(evaluateConditionOperator("contains", "High Growth Tech", "growth")).toBe(true);
      expect(evaluateConditionOperator("starts_with", "Scale Flow", "scale")).toBe(true);
    });

    it("handles safe missing field checks", () => {
      expect(evaluateConditionOperator("empty", null, undefined)).toBe(true);
      expect(evaluateConditionOperator("empty", "", undefined)).toBe(true);
      expect(evaluateConditionOperator("not_empty", null, undefined)).toBe(false);
      expect(evaluateConditionOperator("gt", null, 100)).toBe(false);
    });
  });

  describe("7. Deterministic Lead Condition Evaluation Engine", () => {
    const baseCtx: LeadEvaluationContext = {
      lead: {
        id: "l_test_1",
        name: "Rohit Sharma",
        source: "Website",
        status: "new",
        priority: "hot",
        createdAt: "2026-10-20T10:00:00.000Z",
        updatedAt: "2026-10-20T10:00:00.000Z",
      },
      assignment: null,
      activities: [],
      inboxItem: { status: "needs_review", reviewedAt: null },
      customFieldValues: { cf_budget: 150000, cf_industry: "SaaS" },
      tagIds: ["tag_vip", "tag_mumbai"],
      now: new Date("2026-10-20T11:00:00.000Z"), // 60 minutes later
    };

    it("matches when all conditions are satisfied", () => {
      const conditions: RuleConditions = {
        sources: ["Website", "Meta Ads"],
        stages: ["new"],
        priorities: ["hot"],
        firstContactPending: true,
        minCreatedMinutes: 30,
        custom: [
          { id: "c1", field: "cf_budget", op: "gte", value: 100000 },
          { id: "c2", field: "tag", op: "contains", value: "tag_vip" },
        ],
        customMode: "and",
      };

      const evalRes = evaluateLeadConditions(conditions, baseCtx);
      expect(evalRes.passed).toBe(true);
      expect(evalRes.results.every((r) => r.passed)).toBe(true);
    });

    it("fails when one condition in AND mode fails", () => {
      const conditions: RuleConditions = {
        sources: ["Website"],
        priorities: ["cold"], // Mismatch: lead is hot
      };

      const evalRes = evaluateLeadConditions(conditions, baseCtx);
      expect(evalRes.passed).toBe(false);
      const failed = evalRes.results.find((r) => !r.passed);
      expect(failed?.field).toBe("priority");
    });

    it("supports OR mode for custom conditions", () => {
      const conditions: RuleConditions = {
        custom: [
          { id: "c1", field: "cf_budget", op: "gt", value: 999999 }, // Fails
          { id: "c2", field: "cf_industry", op: "is", value: "SaaS" }, // Passes
        ],
        customMode: "or",
      };

      const evalRes = evaluateLeadConditions(conditions, baseCtx);
      expect(evalRes.passed).toBe(true);
    });
  });
});
