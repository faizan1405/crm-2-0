import { describe, expect, it, vi } from "vitest";
import {
  automationDefinitionsResponseSchema,
  automationRuleDetailResponseSchema,
  automationRuleDtoSchema,
  automationRuleListResponseSchema,
  automationRevisionsResponseSchema,
  automationSimulationResponseSchema,
  createAutomationRule,
  getAutomationDefinitions,
  getAutomationRule,
  getAutomationRuleRevisions,
  listAutomationRules,
  simulateAutomationRule,
  updateAutomationRule,
  duplicateAutomationRule,
  archiveAutomationRule,
  type AutomationRuleDto,
  type AutomationDefinitionsResponse,
  type AutomationRuleRevisionDto,
  type SimulationResultDto,
} from "./automationsApi";

const MOCK_RULE: AutomationRuleDto = {
  id: "ar_test_01",
  ownerUserId: "usr_owner_alpha",
  name: "Follow up with hot leads",
  description: "Create reminder if hot lead is untouched",
  templateId: "tpl_hot",
  subject: "lead",
  triggerType: "inactivity",
  status: "enabled",
  pausedReason: null,
  conditions: {
    priorities: ["hot"],
    minInactiveHours: 48,
  },
  actions: ["reminder", "flag"],
  settings: {
    cooldownHours: 48,
  },
  version: 2,
  lastTriggeredAt: null,
  lastEvaluatedAt: "2026-11-11T10:00:00.000Z",
  totalTriggerCount: 0,
  totalActionCount: 0,
  createdAt: "2026-11-11T09:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
  createdByUserId: "usr_owner_alpha",
  updatedByUserId: "usr_owner_alpha",
};

describe("Checkpoint B10B: Typed Automations API & Contracts", () => {
  it("validates automationRuleDtoSchema", () => {
    const parsed = automationRuleDtoSchema.parse(MOCK_RULE);
    expect(parsed.id).toBe("ar_test_01");
    expect(parsed.name).toBe("Follow up with hot leads");
    expect(parsed.status).toBe("enabled");
    expect(parsed.version).toBe(2);
  });

  it("validates automationRuleListResponseSchema with items, stats, and pagination", () => {
    const raw = {
      ok: true,
      items: [MOCK_RULE],
      total: 1,
      page: 1,
      pageSize: 20,
      stats: {
        total: 1,
        draft: 0,
        enabled: 1,
        paused: 0,
        archived: 0,
      },
    };
    const parsed = automationRuleListResponseSchema.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.stats.enabled).toBe(1);
    expect(parsed.stats.total).toBe(1);
  });

  it("validates automationDefinitionsResponseSchema", () => {
    const raw: AutomationDefinitionsResponse = {
      ok: true,
      triggers: [
        { type: "lead_created", label: "Lead created", subject: "lead" },
        { type: "project_due_soon", label: "Project due date approaching", subject: "project" },
      ],
      actions: [
        { type: "reminder", label: "Create internal reminder", subjects: ["lead", "project"] },
        { type: "task", label: "Create a project task", subjects: ["project"] },
      ],
      operators: ["is", "is_not", "gt", "between"],
      subjects: ["lead", "project"],
      templates: [
        {
          templateId: "tpl_test",
          name: "Test Template",
          description: "Template description",
          subject: "lead",
          triggerType: "lead_created",
          conditions: {},
          actions: ["reminder"],
          settings: { cooldownHours: 24 },
        },
      ],
    };
    const parsed = automationDefinitionsResponseSchema.parse(raw);
    expect(parsed.triggers).toHaveLength(2);
    expect(parsed.actions).toHaveLength(2);
    expect(parsed.templates).toHaveLength(1);
  });

  it("validates automationRevisionsResponseSchema", () => {
    const rev: AutomationRuleRevisionDto = {
      id: "arr_01",
      ownerUserId: "usr_owner_alpha",
      ruleId: "ar_test_01",
      version: 1,
      name: "Original Name",
      description: "Original Description",
      subject: "lead",
      triggerType: "lead_created",
      status: "draft",
      conditions: {},
      actions: ["reminder"],
      settings: { cooldownHours: 24 },
      diffSummary: "Initial rule creation",
      actorUserId: "usr_owner_alpha",
      createdAt: "2026-11-11T09:00:00.000Z",
    };
    const parsed = automationRevisionsResponseSchema.parse({ ok: true, revisions: [rev] });
    expect(parsed.revisions).toHaveLength(1);
    expect(parsed.revisions[0]?.version).toBe(1);
  });

  it("validates automationSimulationResponseSchema with business-safe invariant", () => {
    const sim: SimulationResultDto = {
      ruleId: "ar_test_01",
      ruleName: "Follow up with hot leads",
      subject: "lead",
      triggerType: "inactivity",
      eventTriggerType: "inactivity",
      triggerMatched: true,
      matched: true,
      conditionResults: [
        {
          id: "cond_01",
          conditionId: "cond_01",
          field: "l.priority",
          operator: "is",
          expectedValue: "hot",
          actualValue: "hot",
          passed: true,
          message: 'Lead priority "hot" matches expected "hot"',
          reason: 'Lead priority "hot" matches expected "hot"',
        },
      ],
      plannedActions: [
        {
          action: "reminder",
          label: "Create internal reminder",
          category: "internal",
          target: "lead_01",
          reason: "Hot lead inactive for 48 hours",
          dueAt: "2026-11-11T12:00:00.000Z",
          details: { priority: "hot" },
          executableInCurrentCheckpoint: false,
          unattendedExecutionAllowed: false,
        },
      ],
      skippedReasons: [],
      safeForExecution: true,
      zeroWritesVerified: true,
      evaluatedAt: "2026-11-11T10:00:00.000Z",
    };

    const parsed = automationSimulationResponseSchema.parse({ ok: true, simulation: sim });
    expect(parsed.simulation.matched).toBe(true);
    expect(parsed.simulation.zeroWritesVerified).toBe(true);
    expect(parsed.simulation.plannedActions).toHaveLength(1);
  });

  it("fetches definitions via getAutomationDefinitions()", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        ok: true,
        triggers: [{ type: "lead_created", label: "Lead created", subject: "lead" }],
        actions: [{ type: "reminder", label: "Reminder", subjects: ["lead"] }],
        operators: ["is"],
        subjects: ["lead"],
        templates: [],
      }),
    });

    vi.stubGlobal("fetch", mockFetch);
    const defs = await getAutomationDefinitions();
    expect(defs.ok).toBe(true);
    expect(defs.triggers[0]?.type).toBe("lead_created");
    vi.unstubAllGlobals();
  });

  it("creates rule via createAutomationRule() with auto-generated idempotency key", async () => {
    let capturedHeaders: Headers | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedHeaders = new Headers(init.headers);
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true, rule: MOCK_RULE }),
      });
    });

    vi.stubGlobal("fetch", mockFetch);
    const created = await createAutomationRule({
      name: "New Rule",
      subject: "lead",
      triggerType: "lead_created",
      conditions: {},
      actions: ["reminder"],
      settings: { cooldownHours: 24 },
    });

    expect(created.id).toBe("ar_test_01");
    expect(capturedHeaders?.get("Idempotency-Key")).toMatch(/^sf_/);
    vi.unstubAllGlobals();
  });
});
