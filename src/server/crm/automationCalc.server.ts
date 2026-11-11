import "@tanstack/react-start/server-only";
import { z } from "zod";
import { CrmServiceError } from "./errors.server";

export const LEAD_TRIGGERS = [
  "lead_created",
  "lead_assigned",
  "lead_updated",
  "stage_changed",
  "followup_created",
  "followup_overdue",
  "followup_completed",
  "call_logged",
  "deal_won",
  "inactivity",
] as const;

export type LeadTrigger = (typeof LEAD_TRIGGERS)[number];

export const PROJECT_TRIGGERS = [
  "project_created",
  "project_stage_changed",
  "task_completed",
  "milestone_completed",
  "task_overdue",
  "project_due_soon",
  "project_delivered",
  "support_created",
  "support_ending",
] as const;

export type ProjectTrigger = (typeof PROJECT_TRIGGERS)[number];

export const ALL_TRIGGERS = [...LEAD_TRIGGERS, ...PROJECT_TRIGGERS] as const;
export type TriggerType = (typeof ALL_TRIGGERS)[number];

export const RULE_SUBJECTS = ["lead", "project"] as const;
export type RuleSubject = (typeof RULE_SUBJECTS)[number];

export const RULE_STATUSES = ["draft", "enabled", "paused", "archived"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const ACTION_TYPES = [
  "reminder",
  "notify",
  "flag",
  "followup",
  "activity",
  "owner_review",
  "task",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTIONS_FOR: Record<RuleSubject, readonly ActionType[]> = {
  lead: ["reminder", "notify", "flag", "followup", "activity", "owner_review"],
  project: ["reminder", "notify", "flag", "owner_review", "activity", "task"],
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  lead_created: "Lead created",
  lead_assigned: "Lead assigned",
  lead_updated: "Lead updated",
  stage_changed: "Pipeline stage changed",
  followup_created: "Follow-up created",
  followup_overdue: "Follow-up overdue",
  followup_completed: "Follow-up completed",
  call_logged: "Call logged",
  deal_won: "Deal marked Won",
  inactivity: "Time since last recorded activity",
  project_created: "Project created",
  project_stage_changed: "Project stage changed",
  task_completed: "Project task completed",
  milestone_completed: "Milestone completed",
  task_overdue: "Project task overdue",
  project_due_soon: "Project due date approaching",
  project_delivered: "Project delivered",
  support_created: "Support request created",
  support_ending: "Support end date approaching",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  reminder: "Create internal reminder",
  notify: "Generate CRM notification",
  flag: "Flag for attention",
  followup: "Create a follow-up",
  activity: "Add activity entry",
  owner_review: "Request Owner review",
  task: "Create a project task",
};

export const CUSTOM_CONDITION_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "empty",
  "not_empty",
  "in",
  "not_in",
] as const;
export type CustomConditionOperator = (typeof CUSTOM_CONDITION_OPERATORS)[number];

/* ---------- Zod Schemas ---------- */

// Strict pattern to detect dangerous injection payloads (eval, script tags, SQL comments/unions)
const DANGEROUS_EXPRESSION_REGEX =
  /(<script\b|javascript:|eval\(|function\(|constructor\(|drop\s+table|union\s+select|--\s*$|\/\*|\*\/|['"]\s*(or|and)\s*['"]?\d['"]?\s*=\s*['"]?\d)/i;

export const ruleConditionCustomItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    field: z.string().min(1).max(64),
    op: z.enum(CUSTOM_CONDITION_OPERATORS),
    value: z.unknown().optional(),
  })
  .refine(
    (item) => {
      if (typeof item.field === "string" && DANGEROUS_EXPRESSION_REGEX.test(item.field)) {
        return false;
      }
      if (typeof item.value === "string" && DANGEROUS_EXPRESSION_REGEX.test(item.value)) {
        return false;
      }
      return true;
    },
    { message: "Potentially unsafe expression or script pattern detected in condition" },
  );

export type RuleConditionCustomItem = z.infer<typeof ruleConditionCustomItemSchema>;

export const ruleConditionsSchema = z
  .object({
    sources: z.array(z.string().min(1).max(64)).optional(),
    stages: z.array(z.string().min(1).max(64)).optional(),
    priorities: z.array(z.string().min(1).max(32)).optional(),
    employeeId: z.string().max(64).nullable().optional(),
    assigned: z.enum(["any", "assigned", "unassigned"]).optional(),
    inboxStatus: z.enum(["any", "needs_review", "reviewed"]).optional(),
    firstContactPending: z.boolean().optional(),
    minCreatedMinutes: z.number().min(0).max(525600).optional(),
    minSinceAttemptMinutes: z.number().min(0).max(525600).optional(),
    minStageDays: z.number().min(0).max(3650).optional(),
    minInactiveHours: z.number().min(0).max(87600).optional(),
    followupStatus: z.enum(["any", "pending", "overdue", "completed"]).optional(),
    custom: z.array(ruleConditionCustomItemSchema).max(25, "Maximum 25 custom conditions allowed").optional(),
    customMode: z.enum(["and", "or"]).optional(),
  })
  .strict();

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export const ruleSettingsSchema = z
  .object({
    cooldownHours: z.number().min(1, "Cooldown must be at least 1 hour to prevent repeat loops").max(87600),
    overdueMinutes: z.number().min(0).max(525600).optional(),
    escalateOwnerAfterMinutes: z.number().min(0).max(525600).optional(),
    followupInHours: z.number().min(1).max(87600).optional(),
    windowHours: z.number().min(1).max(87600).optional(),
    withinDays: z.number().min(0).max(365).optional(),
    taskTitle: z.string().max(160).optional(),
    taskDueInDays: z.number().min(0).max(365).optional(),
  })
  .strict();

export type RuleSettings = z.infer<typeof ruleSettingsSchema>;

export const baseAutomationRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Rule name is required").max(128),
    description: z.string().trim().max(255).default(""),
    templateId: z.string().trim().max(64).nullable().optional(),
    subject: z.enum(RULE_SUBJECTS).default("lead"),
    triggerType: z.enum(ALL_TRIGGERS),
    status: z.enum(RULE_STATUSES).default("draft"),
    conditions: ruleConditionsSchema,
    actions: z.array(z.enum(ACTION_TYPES)).min(1, "Choose at least one action"),
    settings: ruleSettingsSchema,
  });

function validateRuleSafety(val: { name: string; description: string }): boolean {
  if (DANGEROUS_EXPRESSION_REGEX.test(val.name) || DANGEROUS_EXPRESSION_REGEX.test(val.description)) {
    return false;
  }
  return true;
}

export const createAutomationRuleSchema = baseAutomationRuleSchema.refine(
  validateRuleSafety,
  { message: "Unsafe script or expression detected in rule name or description" },
);

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;

export const updateAutomationRuleSchema = baseAutomationRuleSchema
  .extend({
    expectedVersion: z.number().int().min(1, "expectedVersion is required for optimistic locking"),
  })
  .refine(
    validateRuleSafety,
    { message: "Unsafe script or expression detected in rule name or description" },
  );

export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;

/* ---------- Rule Validation & Error Checking ---------- */

export function validateRuleSemantics(rule: {
  name: string;
  subject?: RuleSubject;
  triggerType: TriggerType;
  actions: ActionType[];
  conditions: RuleConditions;
  settings: RuleSettings;
}): string | null {
  if (!rule.name.trim()) return "Give the rule a name.";
  if (!rule.actions.length) return "Choose at least one action.";
  if (!(rule.settings.cooldownHours >= 1)) {
    return "Cooldown must be at least 1 hour so alerts cannot repeat on every evaluation.";
  }

  const subject: RuleSubject = rule.subject ?? "lead";
  const isProjTrigger = (PROJECT_TRIGGERS as readonly string[]).includes(rule.triggerType);

  if (subject === "project" && !isProjTrigger) {
    return "Choose a Project trigger for a Project rule.";
  }
  if (subject === "lead" && isProjTrigger) {
    return "Choose a Lead trigger for a Lead rule.";
  }

  const allowedActions = ACTIONS_FOR[subject];
  for (const action of rule.actions) {
    if (!allowedActions.includes(action)) {
      return `“${ACTION_LABELS[action] ?? action}” is not available for ${subject} rules.`;
    }
  }

  if (rule.actions.includes("followup") && !(rule.settings.followupInHours && rule.settings.followupInHours > 0)) {
    return "Set when the automatic follow-up should be due (followupInHours).";
  }

  if (rule.actions.includes("task") && !rule.settings.taskTitle?.trim()) {
    return "Name the task this rule creates (taskTitle).";
  }

  if (
    rule.triggerType === "deal_won" &&
    rule.conditions.stages &&
    rule.conditions.stages.some((s) => s !== "won")
  ) {
    return "A Won-deal rule can only match the Won stage.";
  }

  if (
    (rule.triggerType === "project_due_soon" || rule.triggerType === "support_ending") &&
    !(rule.settings.withinDays !== undefined && rule.settings.withinDays >= 0)
  ) {
    return "Set how many days ahead to look (withinDays).";
  }

  return null;
}

/** Detects conflicts with existing enabled rules */
export function detectRuleConflicts(
  rule: {
    id?: string;
    subject?: RuleSubject;
    triggerType: TriggerType;
    conditions: RuleConditions;
    actions: ActionType[];
    name: string;
  },
  existingRules: Array<{
    id: string;
    subject: RuleSubject;
    triggerType: TriggerType;
    status: RuleStatus;
    conditions: RuleConditions;
    actions: ActionType[];
    name: string;
  }>,
): string[] {
  const conflicts: string[] = [];
  const ruleSubject = rule.subject ?? "lead";
  const ruleConditionsJson = JSON.stringify(rule.conditions);

  for (const existing of existingRules) {
    if (existing.id === rule.id || existing.status !== "enabled") continue;
    if (existing.triggerType !== rule.triggerType || existing.subject !== ruleSubject) continue;

    const existingConditionsJson = JSON.stringify(existing.conditions);
    if (existingConditionsJson === ruleConditionsJson) {
      conflicts.push(
        `"${existing.name}" already uses the same trigger and conditions — reminders would double up.`,
      );
    } else if (existing.actions.includes("followup") && rule.actions.includes("followup")) {
      conflicts.push(
        `"${existing.name}" also creates follow-ups for this trigger. Only one follow-up per lead can be active at a time.`,
      );
    }
  }

  return conflicts;
}

/* ---------- Contact State Tracking ---------- */

export type ContactState = "none" | "outbound" | "attempted" | "established";

const CONNECTED_CALL_OUTCOMES = new Set([
  "Connected",
  "Interested",
  "Callback requested",
  "Meeting scheduled",
  "Converted",
]);

export function calculateContactState(
  leadId: string,
  activities: Array<{ leadId: string; type: string; outcome?: string | null; opId?: string | null }>,
): ContactState {
  let state: ContactState = "none";
  for (const act of activities) {
    if (act.leadId !== leadId || act.opId?.startsWith("auto:")) continue;

    if (act.type === "call") {
      if (act.outcome && CONNECTED_CALL_OUTCOMES.has(act.outcome)) {
        return "established";
      }
      state = "attempted";
    } else if ((act.type === "whatsapp" || act.type === "email") && state === "none") {
      state = "outbound";
    } else if (act.type === "meeting") {
      return "established";
    }
  }
  return state;
}

export function calculateLastAttemptAt(
  leadId: string,
  activities: Array<{ leadId: string; type: string; at: string; opId?: string | null }>,
): string | undefined {
  let latest: string | undefined;
  for (const act of activities) {
    if (
      act.leadId === leadId &&
      !act.opId?.startsWith("auto:") &&
      (act.type === "call" || act.type === "whatsapp" || act.type === "email" || act.type === "meeting")
    ) {
      if (!latest || act.at > latest) {
        latest = act.at;
      }
    }
  }
  return latest;
}

export function calculateLastActivityAt(
  leadCreatedAt: string,
  leadId: string,
  activities: Array<{ leadId: string; type: string; at: string; opId?: string | null }>,
): string {
  let latest = leadCreatedAt;
  for (const act of activities) {
    if (
      act.leadId === leadId &&
      !act.opId?.startsWith("auto:") &&
      act.type !== "created" &&
      act.at > latest
    ) {
      latest = act.at;
    }
  }
  return latest;
}

/* ---------- Condition Evaluator ---------- */

export interface ConditionEvaluationResult {
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

export interface LeadEvaluationContext {
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    source: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
  };
  assignment?: {
    employeeId: string | null;
    assignedAt: string;
  } | null;
  activities: Array<{
    id: string;
    leadId: string;
    type: string;
    outcome?: string | null;
    text?: string | null;
    at: string;
    opId?: string | null;
  }>;
  inboxItem?: {
    status: string;
    reviewedAt?: string | null;
  } | null;
  customFieldValues?: Record<string, unknown>;
  tagIds?: string[];
  now: Date;
}

/** Compares values safely across numbers (INR/paise), strings, dates, and arrays */
export function evaluateConditionOperator(
  op: CustomConditionOperator,
  actual: unknown,
  expected: unknown,
): boolean {
  if (op === "empty") {
    return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0);
  }
  if (op === "not_empty") {
    return actual !== null && actual !== undefined && actual !== "" && (!Array.isArray(actual) || actual.length > 0);
  }

  if (actual === null || actual === undefined) {
    return false;
  }

  // Array contains or not contains
  if (Array.isArray(actual)) {
    const has = actual.some((item) => String(item) === String(expected));
    if (op === "contains") return has;
    if (op === "not_contains") return !has;
  }

  // String comparisons
  if (typeof actual === "string" && typeof expected === "string") {
    const act = actual.toLowerCase().trim();
    const exp = expected.toLowerCase().trim();
    switch (op) {
      case "is":
        return act === exp;
      case "is_not":
        return act !== exp;
      case "contains":
        return act.includes(exp);
      case "not_contains":
        return !act.includes(exp);
      case "starts_with":
        return act.startsWith(exp);
      case "ends_with":
        return act.endsWith(exp);
      case "in":
        return exp.split(",").map((s) => s.trim().toLowerCase()).includes(act);
      case "not_in":
        return !exp.split(",").map((s) => s.trim().toLowerCase()).includes(act);
    }
  }

  if (op === "between" && Array.isArray(expected) && expected.length === 2) {
    const numActual = typeof actual === "number" ? actual : Number(actual);
    const [min, max] = expected.map(Number);
    return Number.isFinite(numActual) && Number.isFinite(min) && Number.isFinite(max) && numActual >= min! && numActual <= max!;
  }

  // Numeric comparisons (handles numbers or numeric strings representing INR paise or counts)
  const numActual = typeof actual === "number" ? actual : Number(actual);
  const numExpected = typeof expected === "number" ? expected : Number(expected);

  if (Number.isFinite(numActual) && Number.isFinite(numExpected)) {
    switch (op) {
      case "is":
        return numActual === numExpected;
      case "is_not":
        return numActual !== numExpected;
      case "gt":
        return numActual > numExpected;
      case "gte":
        return numActual >= numExpected;
      case "lt":
        return numActual < numExpected;
      case "lte":
        return numActual <= numExpected;
    }
  }

  // Fallback equality
  if (op === "is") return String(actual) === String(expected);
  if (op === "is_not") return String(actual) !== String(expected);
  if (op === "in" && Array.isArray(expected)) {
    return expected.map(String).includes(String(actual));
  }
  if (op === "not_in" && Array.isArray(expected)) {
    return !expected.map(String).includes(String(actual));
  }

  return false;
}

/** Evaluates lead conditions deterministically, returning step-by-step diagnostic verification */
export function evaluateLeadConditions(
  conditions: RuleConditions,
  ctx: LeadEvaluationContext,
): { passed: boolean; results: ConditionEvaluationResult[] } {
  const results: ConditionEvaluationResult[] = [];
  const lead = ctx.lead;
  const nowMs = ctx.now.getTime();

  // 1. Source
  if (conditions.sources && conditions.sources.length > 0) {
    const passed = conditions.sources.includes(lead.source);
    results.push({
      id: "cond_source",
      field: "source",
      expected: conditions.sources,
      actual: lead.source,
      passed,
      message: passed ? `Source "${lead.source}" matched` : `Source "${lead.source}" not in allowed sources`,
    });
  }

  // 2. Stage
  if (conditions.stages && conditions.stages.length > 0) {
    const passed = conditions.stages.includes(lead.status);
    results.push({
      id: "cond_stage",
      field: "status",
      expected: conditions.stages,
      actual: lead.status,
      passed,
      message: passed ? `Stage "${lead.status}" matched` : `Stage "${lead.status}" not in allowed stages`,
    });
  }

  // 3. Priority
  if (conditions.priorities && conditions.priorities.length > 0) {
    const passed = conditions.priorities.includes(lead.priority);
    results.push({
      id: "cond_priority",
      field: "priority",
      expected: conditions.priorities,
      actual: lead.priority,
      passed,
      message: passed ? `Priority "${lead.priority}" matched` : `Priority "${lead.priority}" not in allowed priorities`,
    });
  }

  // 4. Assigned status / specific employee
  const employeeId = ctx.assignment?.employeeId ?? null;
  if (conditions.assigned) {
    const passed =
      conditions.assigned === "any" ||
      (conditions.assigned === "assigned" && !!employeeId) ||
      (conditions.assigned === "unassigned" && !employeeId);
    results.push({
      id: "cond_assigned",
      field: "assigned",
      expected: conditions.assigned,
      actual: employeeId ? "assigned" : "unassigned",
      passed,
      message: passed ? `Assignment condition "${conditions.assigned}" satisfied` : `Assignment condition failed`,
    });
  }
  if (conditions.employeeId !== undefined && conditions.employeeId !== null) {
    const passed = employeeId === conditions.employeeId;
    results.push({
      id: "cond_employee",
      field: "employeeId",
      expected: conditions.employeeId,
      actual: employeeId,
      passed,
      message: passed ? `Employee assignment matched` : `Employee mismatch`,
    });
  }

  // 5. Smart Inbox status
  if (conditions.inboxStatus && conditions.inboxStatus !== "any") {
    const isReviewed = !!ctx.inboxItem?.reviewedAt;
    const passed =
      (conditions.inboxStatus === "needs_review" && !isReviewed) ||
      (conditions.inboxStatus === "reviewed" && isReviewed);
    results.push({
      id: "cond_inbox",
      field: "inboxStatus",
      expected: conditions.inboxStatus,
      actual: isReviewed ? "reviewed" : "needs_review",
      passed,
      message: passed ? `Inbox review status matched` : `Inbox review status mismatch`,
    });
  }

  // 6. First contact pending
  const contactState = calculateContactState(lead.id, ctx.activities);
  if (conditions.firstContactPending !== undefined) {
    const passed = conditions.firstContactPending ? contactState === "none" : contactState !== "none";
    results.push({
      id: "cond_first_contact",
      field: "firstContactPending",
      expected: conditions.firstContactPending,
      actual: contactState,
      passed,
      message: passed ? `First contact pending condition satisfied (${contactState})` : `First contact pending condition failed (${contactState})`,
    });
  }

  // 7. Time thresholds
  if (conditions.minCreatedMinutes !== undefined && conditions.minCreatedMinutes >= 0) {
    const createdMs = new Date(lead.createdAt).getTime();
    const elapsedMinutes = Math.max(0, Math.floor((nowMs - createdMs) / 60000));
    const passed = elapsedMinutes >= conditions.minCreatedMinutes;
    results.push({
      id: "cond_min_created",
      field: "minCreatedMinutes",
      expected: conditions.minCreatedMinutes,
      actual: elapsedMinutes,
      passed,
      message: passed ? `Created ${elapsedMinutes}m ago >= ${conditions.minCreatedMinutes}m` : `Created ${elapsedMinutes}m ago < required ${conditions.minCreatedMinutes}m`,
    });
  }

  if (conditions.minSinceAttemptMinutes !== undefined && conditions.minSinceAttemptMinutes >= 0) {
    const lastAttemptIso = calculateLastAttemptAt(lead.id, ctx.activities);
    if (!lastAttemptIso) {
      // If no attempt has ever been made, it qualifies as not attempted
      results.push({
        id: "cond_min_attempt",
        field: "minSinceAttemptMinutes",
        expected: conditions.minSinceAttemptMinutes,
        actual: null,
        passed: true,
        message: "No contact attempt has been recorded",
      });
    } else {
      const elapsedMinutes = Math.max(0, Math.floor((nowMs - new Date(lastAttemptIso).getTime()) / 60000));
      const passed = elapsedMinutes >= conditions.minSinceAttemptMinutes;
      results.push({
        id: "cond_min_attempt",
        field: "minSinceAttemptMinutes",
        expected: conditions.minSinceAttemptMinutes,
        actual: elapsedMinutes,
        passed,
        message: passed ? `Last attempt ${elapsedMinutes}m ago >= ${conditions.minSinceAttemptMinutes}m` : `Last attempt ${elapsedMinutes}m ago < required ${conditions.minSinceAttemptMinutes}m`,
      });
    }
  }

  if (conditions.minInactiveHours !== undefined && conditions.minInactiveHours >= 0) {
    const lastActIso = calculateLastActivityAt(lead.createdAt, lead.id, ctx.activities);
    const elapsedHours = Math.max(0, Math.floor((nowMs - new Date(lastActIso).getTime()) / 3600000));
    const passed = elapsedHours >= conditions.minInactiveHours;
    results.push({
      id: "cond_min_inactive",
      field: "minInactiveHours",
      expected: conditions.minInactiveHours,
      actual: elapsedHours,
      passed,
      message: passed ? `Inactive for ${elapsedHours}h >= ${conditions.minInactiveHours}h` : `Inactive for ${elapsedHours}h < required ${conditions.minInactiveHours}h`,
    });
  }

  // 8. Custom fields & Tag conditions
  if (conditions.custom && conditions.custom.length > 0) {
    const customMode = conditions.customMode ?? "and";
    const customResults: ConditionEvaluationResult[] = [];

    for (const c of conditions.custom) {
      let actualValue: unknown = undefined;

      if (c.field.startsWith("tag:") || c.field === "tag" || c.field === "tagId") {
        // Tag check
        const targetTag = String(c.value);
        actualValue = ctx.tagIds ?? [];
        const passed = evaluateConditionOperator(c.op, actualValue, targetTag);
        customResults.push({
          id: c.id,
          field: c.field,
          expected: c.value,
          actual: actualValue,
          passed,
          message: passed ? `Tag condition matched` : `Tag condition not met`,
        });
      } else {
        // Custom field value check
        actualValue = ctx.customFieldValues?.[c.field];
        const passed = evaluateConditionOperator(c.op, actualValue, c.value);
        customResults.push({
          id: c.id,
          field: c.field,
          expected: c.value,
          actual: actualValue,
          passed,
          message: passed ? `Custom field condition "${c.field} ${c.op} ${c.value}" passed` : `Custom field condition failed`,
        });
      }
    }

    if (customMode === "and") {
      results.push(...customResults);
      const allPassed = customResults.every((r) => r.passed);
      if (!allPassed) {
        return { passed: false, results };
      }
    } else {
      // OR mode: custom group passes if any custom condition passed
      const anyPassed = customResults.some((r) => r.passed);
      results.push({
        id: "cond_custom_or_group",
        field: "custom",
        expected: "any",
        actual: customResults.filter((r) => r.passed).map((r) => r.id),
        passed: anyPassed,
        message: anyPassed
          ? `Custom condition group passed (OR mode: ${customResults.filter((r) => r.passed).length}/${customResults.length} matched)`
          : `Custom condition group failed (OR mode: 0/${customResults.length} matched)`,
      });
      if (!anyPassed) {
        return { passed: false, results };
      }
    }
  }

  const passed = results.every((r) => r.passed);
  return { passed, results };
}
