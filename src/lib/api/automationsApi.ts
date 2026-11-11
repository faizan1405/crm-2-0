import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";

// ============================================================================
// CONSTANTS & SCHEMAS
// ============================================================================

export const RULE_SUBJECTS = ["lead", "project"] as const;
export type RuleSubject = (typeof RULE_SUBJECTS)[number];

export const RULE_STATUSES = ["draft", "enabled", "paused", "archived"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

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

export const ALL_TRIGGERS = [...LEAD_TRIGGERS, ...PROJECT_TRIGGERS] as const;
export type TriggerType = (typeof ALL_TRIGGERS)[number];

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

// Condition Item Schema
export const ruleConditionCustomItemSchema = z.object({
  id: z.string().min(1).max(64),
  field: z.string().min(1).max(64),
  op: z.enum(CUSTOM_CONDITION_OPERATORS),
  value: z.unknown().optional(),
});
export type RuleConditionCustomItem = z.infer<typeof ruleConditionCustomItemSchema>;

// Conditions Schema
export const ruleConditionsSchema = z.object({
  sources: z.array(z.string()).optional(),
  stages: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  employeeId: z.string().nullable().optional(),
  assigned: z.enum(["any", "assigned", "unassigned"]).optional(),
  inboxStatus: z.enum(["any", "needs_review", "reviewed"]).optional(),
  firstContactPending: z.boolean().optional(),
  minCreatedMinutes: z.number().optional(),
  minSinceAttemptMinutes: z.number().optional(),
  minStageDays: z.number().optional(),
  minInactiveHours: z.number().optional(),
  followupStatus: z.enum(["any", "pending", "overdue", "completed"]).optional(),
  custom: z.array(ruleConditionCustomItemSchema).optional(),
  customMode: z.enum(["and", "or"]).optional(),
});
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

// Settings Schema
export const ruleSettingsSchema = z.object({
  cooldownHours: z.number().min(1),
  overdueMinutes: z.number().optional(),
  escalateOwnerAfterMinutes: z.number().optional(),
  followupInHours: z.number().optional(),
  windowHours: z.number().optional(),
  withinDays: z.number().optional(),
  taskTitle: z.string().optional(),
  taskDueInDays: z.number().optional(),
});
export type RuleSettings = z.infer<typeof ruleSettingsSchema>;

// Rule DTO Schema
export const automationRuleDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  subject: z.enum(RULE_SUBJECTS),
  triggerType: z.enum(ALL_TRIGGERS),
  status: z.enum(RULE_STATUSES),
  pausedReason: z.string().nullable().optional(),
  conditions: ruleConditionsSchema,
  actions: z.array(z.enum(ACTION_TYPES)),
  settings: ruleSettingsSchema,
  version: z.number(),
  lastTriggeredAt: z.string().nullable().optional(),
  lastEvaluatedAt: z.string().nullable().optional(),
  totalTriggerCount: z.number().optional().default(0),
  totalActionCount: z.number().optional().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdByUserId: z.string().nullable().optional(),
  updatedByUserId: z.string().nullable().optional(),
});
export type AutomationRuleDto = z.infer<typeof automationRuleDtoSchema>;

// Stats Schema
export const automationRuleStatsSchema = z.object({
  total: z.number(),
  draft: z.number(),
  enabled: z.number(),
  paused: z.number(),
  archived: z.number(),
});
export type AutomationRuleStats = z.infer<typeof automationRuleStatsSchema>;

// List Response Schema
export const automationRuleListResponseSchema = z
  .object({
    ok: z.literal(true),
    items: z.array(automationRuleDtoSchema).optional(),
    rules: z.array(automationRuleDtoSchema).optional(),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number().optional(),
    stats: automationRuleStatsSchema.optional(),
  })
  .transform((data) => ({
    ok: true as const,
    items: data.items ?? data.rules ?? [],
    rules: data.rules ?? data.items ?? [],
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    totalPages: data.totalPages ?? 1,
    stats: data.stats ?? {
      total: data.total,
      draft: 0,
      enabled: 0,
      paused: 0,
      archived: 0,
    },
  }));
export type AutomationRuleListResponse = z.infer<typeof automationRuleListResponseSchema>;

// Detail Response Schema
export const automationRuleDetailResponseSchema = z.object({
  ok: z.literal(true),
  rule: automationRuleDtoSchema,
});
export type AutomationRuleDetailResponse = z.infer<typeof automationRuleDetailResponseSchema>;

// Revision DTO Schema
export const automationRuleRevisionDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  ruleId: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  subject: z.enum(RULE_SUBJECTS),
  triggerType: z.enum(ALL_TRIGGERS),
  status: z.enum(RULE_STATUSES),
  conditions: ruleConditionsSchema,
  actions: z.array(z.enum(ACTION_TYPES)),
  settings: ruleSettingsSchema,
  diffSummary: z.string().nullable().optional(),
  actorUserId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AutomationRuleRevisionDto = z.infer<typeof automationRuleRevisionDtoSchema>;

export const automationRevisionsResponseSchema = z.object({
  ok: z.literal(true),
  revisions: z.array(automationRuleRevisionDtoSchema),
});
export type AutomationRevisionsResponse = z.infer<typeof automationRevisionsResponseSchema>;

// Definitions Response Schema
export const automationDefinitionsResponseSchema = z.object({
  ok: z.literal(true),
  triggers: z.array(
    z.object({
      type: z.enum(ALL_TRIGGERS),
      label: z.string(),
      subject: z.enum(RULE_SUBJECTS),
    }),
  ),
  actions: z.array(
    z.object({
      type: z.enum(ACTION_TYPES),
      label: z.string(),
      subjects: z.array(z.enum(RULE_SUBJECTS)),
    }),
  ),
  operators: z.array(z.string()),
  subjects: z.array(z.string()),
  templates: z.array(
    z.object({
      templateId: z.string(),
      name: z.string(),
      description: z.string(),
      subject: z.enum(RULE_SUBJECTS),
      triggerType: z.enum(ALL_TRIGGERS),
      conditions: ruleConditionsSchema,
      actions: z.array(z.enum(ACTION_TYPES)),
      settings: ruleSettingsSchema,
    }),
  ),
});
export type AutomationDefinitionsResponse = z.infer<typeof automationDefinitionsResponseSchema>;

// Simulation DTO Schema
export const conditionEvaluationResultDtoSchema = z.object({
  id: z.string().optional(),
  conditionId: z.string().optional(),
  field: z.string(),
  operator: z.string().optional().default("matches"),
  expected: z.unknown().optional(),
  expectedValue: z.unknown().optional(),
  actual: z.unknown().optional(),
  actualValue: z.unknown().optional(),
  passed: z.boolean(),
  message: z.string().optional(),
  reason: z.string().optional(),
}).transform((c) => ({
  id: c.id ?? c.conditionId ?? "",
  conditionId: c.conditionId ?? c.id ?? "",
  field: c.field,
  operator: c.operator ?? "matches",
  expectedValue: c.expectedValue ?? c.expected,
  actualValue: c.actualValue ?? c.actual,
  passed: c.passed,
  message: c.message ?? c.reason ?? "",
  reason: c.reason ?? c.message ?? "",
}));
export type ConditionEvaluationResultDto = z.infer<typeof conditionEvaluationResultDtoSchema>;

export const plannedActionItemDtoSchema = z.object({
  action: z.enum(ACTION_TYPES),
  label: z.string(),
  category: z.enum(["internal", "business_state", "external"]),
  target: z.string(),
  reason: z.string(),
  dueAt: z.string(),
  details: z.record(z.unknown()).optional().default({}),
  executableInCurrentCheckpoint: z.boolean().optional().default(false),
  unattendedExecutionAllowed: z.boolean().optional().default(false),
});
export type PlannedActionItemDto = z.infer<typeof plannedActionItemDtoSchema>;

export const simulationResultDtoSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  subject: z.enum(RULE_SUBJECTS),
  triggerType: z.enum(ALL_TRIGGERS),
  eventTriggerType: z.enum(ALL_TRIGGERS),
  triggerMatched: z.boolean(),
  matched: z.boolean(),
  conditionResults: z.array(conditionEvaluationResultDtoSchema),
  plannedActions: z.array(plannedActionItemDtoSchema),
  skippedReasons: z.array(z.string()),
  safeForExecution: z.boolean(),
  zeroWritesVerified: z.literal(true),
  evaluatedAt: z.string(),
});
export type SimulationResultDto = z.infer<typeof simulationResultDtoSchema>;

export const automationSimulationResponseSchema = z.object({
  ok: z.literal(true),
  simulation: simulationResultDtoSchema,
});
export type AutomationSimulationResponse = z.infer<typeof automationSimulationResponseSchema>;

// Create/Update Input Schemas
export interface CreateAutomationRuleInput {
  name: string;
  description?: string | undefined;
  templateId?: string | null | undefined;
  subject: RuleSubject;
  triggerType: TriggerType;
  status?: RuleStatus | undefined;
  conditions: RuleConditions;
  actions: ActionType[];
  settings: RuleSettings;
  idempotencyKey?: string | undefined;
}

export interface UpdateAutomationRuleInput {
  name: string;
  description?: string | undefined;
  templateId?: string | null | undefined;
  subject: RuleSubject;
  triggerType: TriggerType;
  status: RuleStatus;
  conditions: RuleConditions;
  actions: ActionType[];
  settings: RuleSettings;
  expectedVersion: number;
  idempotencyKey?: string | undefined;
}

export interface SyntheticEventInput {
  triggerType: TriggerType;
  leadId?: string | undefined;
  projectId?: string | undefined;
  followupId?: string | undefined;
  at?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export interface ListAutomationRulesQueryParams {
  status?: string | null | undefined;
  subject?: string | null | undefined;
  triggerType?: string | null | undefined;
  search?: string | null | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export async function getAutomationDefinitions(signal?: AbortSignal): Promise<AutomationDefinitionsResponse> {
  return apiRequest({
    path: "/api/v1/automations/definitions",
    method: "GET",
    schema: automationDefinitionsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function listAutomationRules(
  params?: ListAutomationRulesQueryParams,
  signal?: AbortSignal,
): Promise<AutomationRuleListResponse> {
  return apiRequest({
    path: "/api/v1/automations",
    method: "GET",
    query: params as Record<string, string | number | boolean | undefined | null>,
    schema: automationRuleListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getAutomationRule(
  id: string,
  signal?: AbortSignal,
): Promise<AutomationRuleDto> {
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}`,
    method: "GET",
    schema: automationRuleDetailResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.rule;
}

export async function createAutomationRule(
  input: CreateAutomationRuleInput,
): Promise<AutomationRuleDto> {
  const idemKey = input.idempotencyKey ?? createIdempotencyKey();
  const res = await apiRequest({
    path: "/api/v1/automations",
    method: "POST",
    body: { ...input, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: automationRuleDetailResponseSchema,
  });
  return res.rule;
}

export async function updateAutomationRule(
  id: string,
  input: UpdateAutomationRuleInput,
): Promise<AutomationRuleDto> {
  const idemKey = input.idempotencyKey ?? createIdempotencyKey();
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}`,
    method: "PUT",
    body: { ...input, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: automationRuleDetailResponseSchema,
  });
  return res.rule;
}

export async function duplicateAutomationRule(
  id: string,
  idempotencyKey?: string,
): Promise<AutomationRuleDto> {
  const idemKey = idempotencyKey ?? createIdempotencyKey();
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}/duplicate`,
    method: "POST",
    body: { idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: automationRuleDetailResponseSchema,
  });
  return res.rule;
}

export async function archiveAutomationRule(
  id: string,
  expectedVersion?: number,
  idempotencyKey?: string,
): Promise<AutomationRuleDto> {
  const idemKey = idempotencyKey ?? createIdempotencyKey();
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}`,
    method: "DELETE",
    body: { expectedVersion, idempotencyKey: idemKey },
    idempotencyKey: idemKey,
    schema: z.object({
      ok: z.literal(true),
      rule: automationRuleDtoSchema,
      archived: z.boolean().optional(),
    }),
  });
  return res.rule;
}

export async function getAutomationRuleRevisions(
  id: string,
  signal?: AbortSignal,
): Promise<AutomationRuleRevisionDto[]> {
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}/revisions`,
    method: "GET",
    schema: automationRevisionsResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.revisions;
}

export async function simulateAutomationRule(
  id: string,
  event: SyntheticEventInput,
): Promise<SimulationResultDto> {
  const res = await apiRequest({
    path: `/api/v1/automations/${encodeURIComponent(id)}/simulate`,
    method: "POST",
    body: event,
    schema: automationSimulationResponseSchema,
  });
  return res.simulation;
}

// ============================================================================
// REACT QUERY KEYS & HOOKS
// ============================================================================

export const automationKeys = {
  all: ["automations"] as const,
  definitions: () => [...automationKeys.all, "definitions"] as const,
  lists: () => [...automationKeys.all, "list"] as const,
  list: (params?: ListAutomationRulesQueryParams) =>
    [...automationKeys.lists(), params ?? {}] as const,
  details: () => [...automationKeys.all, "detail"] as const,
  detail: (id: string) => [...automationKeys.details(), id] as const,
  revisions: (id: string) => [...automationKeys.detail(id), "revisions"] as const,
};

export function useAutomationDefinitionsQuery() {
  return useQuery({
    queryKey: automationKeys.definitions(),
    queryFn: ({ signal }) => getAutomationDefinitions(signal),
    staleTime: 60_000,
  });
}

export function useAutomationRulesQuery(params?: ListAutomationRulesQueryParams) {
  return useQuery({
    queryKey: automationKeys.list(params),
    queryFn: ({ signal }) => listAutomationRules(params, signal),
    staleTime: 10_000,
  });
}

export function useAutomationRuleQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: automationKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getAutomationRule(id!, signal),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useAutomationRevisionsQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: automationKeys.revisions(id ?? ""),
    queryFn: ({ signal }) => getAutomationRuleRevisions(id!, signal),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateAutomationRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAutomationRuleInput) => createAutomationRule(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useUpdateAutomationRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAutomationRuleInput }) =>
      updateAutomationRule(id, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
      void queryClient.setQueryData(automationKeys.detail(data.id), data);
    },
  });
}

export function useDuplicateAutomationRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateAutomationRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useArchiveAutomationRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: number }) =>
      archiveAutomationRule(id, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useSimulateAutomationRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, event }: { id: string; event: SyntheticEventInput }) =>
      simulateAutomationRule(id, event),
    onSuccess: () => {
      // Invalidate automations list to update lastTriggeredAt / lastEvaluatedAt timestamps
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}
