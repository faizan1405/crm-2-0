import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import {
  crmAutomationRules,
  crmAutomationRuleRevisions,
  crmAutomationRuns,
  crmInternalReminders,
  crmFollowUps,
  crmLeads,
  crmLeadActivities,
  crmLeadTags,
  crmTagDefs,
  crmProjects,
} from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { toIstParts } from "./dates.server";
import { recomputeLeadNextFollowUpInTx } from "./leadsService.server";
import { CrmServiceError, isMysqlDeadlockError, isMysqlDuplicateKeyError } from "./errors.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  simulateRuleExecution,
  syntheticEventSchema,
  type SyntheticEvent,
  type PlannedActionItem,
  type SimulationResult,
} from "./automationSimulation.server";
import {
  MAX_ACTIONS_PER_EVENT,
  type ActionType,
  type RuleSubject,
  type TriggerType,
} from "./automationCalc.server";
import { z } from "zod";

export const MAX_EXECUTION_DEPTH = 3;
export { MAX_ACTIONS_PER_EVENT };

export const executeAutomationInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1).optional(),
    event: syntheticEventSchema,
    actionIndex: z.number().int().min(0).optional(),
    authorized: z.literal(true, {
      errorMap: () => ({ message: "Explicit test execution authorization required" }),
    }),
    dryRunRollback: z.boolean().optional(),
    testFailureInjection: z
      .enum([
        "none",
        "transaction_error",
        "constraint_violation",
        "lead_sync_error",
        "activity_error",
      ])
      .optional(),
    causationId: z.string().max(128).optional(),
    depth: z.number().int().min(0).max(10).default(0),
    customTagId: z.string().max(64).optional(),
    idempotencyKey: z.string().max(128).optional(),
  })
  .strict();

export type ExecuteAutomationInput = z.infer<typeof executeAutomationInputSchema>;

export interface ExecutionLifecycleRecord {
  state:
    | "evaluated"
    | "matched"
    | "planned"
    | "authorized"
    | "executing"
    | "succeeded"
    | "failed"
    | "skipped";
  timestamp: string;
  detail?: string;
}

export interface ExecutedActionDetail {
  actionIndex: number;
  action: ActionType | "tag";
  executionKey: string;
  status: "succeeded" | "skipped" | "failed";
  target: string;
  recordId?: string;
  recordType?: "crm_follow_ups" | "crm_internal_reminders" | "crm_lead_tags";
  reason?: string;
  details?: Record<string, unknown>;
}

export interface AutomationExecutionResult {
  ok: boolean;
  runId: string;
  ruleId: string;
  ruleVersion: number;
  triggerType: TriggerType;
  outcome: "succeeded" | "failed" | "skipped";
  lifecycle: ExecutionLifecycleRecord[];
  plannedActions: PlannedActionItem[];
  executedActions: ExecutedActionDetail[];
  replayed: boolean;
  executionError?: string | null;
  causationId?: string | null;
  depth: number;
  createdAt: string;
}

/**
 * Generates a deterministic deduplication hash for an automation action:
 * `sha256(ownerUserId:sourceEventId:ruleId:ruleVersion:actionIndex:targetId)`
 */
export function computeExecutionKey(params: {
  ownerUserId: string;
  sourceEventId: string;
  ruleId: string;
  ruleVersion: number;
  actionIndex: number;
  targetId: string;
  customTagId?: string | undefined;
}): string {
  const payload = [
    params.ownerUserId,
    params.sourceEventId,
    params.ruleId,
    String(params.ruleVersion),
    String(params.actionIndex),
    params.targetId,
    params.customTagId ?? "",
  ].join(":");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Maps internal/database errors to safe, non-leaky diagnostic summaries.
 * Never exposes SQL query strings, table/column identifiers, or bind parameters.
 */
export function sanitizeAutomationExecutionError(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err ?? "");
  if (rawMessage === "DRY_RUN_ROLLBACK_REQUESTED") {
    return "DRY_RUN_ROLLBACK_REQUESTED";
  }
  if (rawMessage === "INJECTED_TRANSACTION_FAILURE") {
    return "Injected transaction failure triggered atomic rollback.";
  }
  if (rawMessage === "INJECTED_LEAD_SYNC_FAILURE") {
    return "Injected lead synchronization failure triggered atomic rollback.";
  }
  if (rawMessage === "INJECTED_ACTIVITY_FAILURE") {
    return "Injected lead activity failure triggered atomic rollback.";
  }

  if (isMysqlDeadlockError(err)) {
    return "Database transaction deadlock interrupted automation execution after retries.";
  }
  if (isMysqlDuplicateKeyError(err)) {
    return "Database uniqueness constraint prevented conflicting automation execution.";
  }

  const mysqlCode =
    (err as { code?: unknown; cause?: { code?: unknown } } | null)?.cause?.code ??
    (err as { code?: unknown } | null)?.code;
  if (mysqlCode === "ER_NO_REFERENCED_ROW_2" || mysqlCode === "ER_NO_REFERENCED_ROW") {
    return "Referenced CRM entity is unavailable during automation transaction.";
  }
  if (mysqlCode === "ER_DATA_TOO_LONG" || mysqlCode === "ER_TRUNCATED_WRONG_VALUE") {
    return "Automation execution output exceeded permitted field length.";
  }

  if (err instanceof CrmServiceError) {
    const clean = err.message.replace(/\s+/g, " ").trim();
    if (!/failed query:|insert into|update\s+|delete from|select\s+|params:/i.test(clean)) {
      return clean.slice(0, 240);
    }
  }

  return "Internal execution error occurred; all transaction writes were rolled back.";
}

/**
 * Plans an automation action without executing or writing to business tables.
 * Returns the evaluated simulation and planned actions.
 */
export async function planAutomationRuleExecution(
  db: CrmDatabase,
  ownerUserId: string,
  ruleId: string,
  event: SyntheticEvent,
): Promise<{
  rule: typeof crmAutomationRules.$inferSelect;
  simulation: SimulationResult;
}> {
  const [rule] = await db
    .select()
    .from(crmAutomationRules)
    .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
    .limit(1);

  if (!rule) {
    throw new CrmServiceError(
      404,
      "automation_rule_not_found",
      `Automation rule "${ruleId}" not found.`,
    );
  }

  const simulation = await simulateRuleExecution(
    db as unknown as Parameters<typeof simulateRuleExecution>[0],
    ownerUserId,
    {
      id: rule.id,
      name: rule.name,
      subject: rule.subject as RuleSubject,
      triggerType: rule.triggerType as TriggerType,
      conditions: JSON.parse(rule.conditionsJson),
      actions: JSON.parse(rule.actionsJson),
      settings: JSON.parse(rule.settingsJson),
    },
    event,
  );

  return { rule, simulation };
}

/**
 * Executes an approved internal automation action within an atomic, idempotent MariaDB transaction.
 *
 * Invariants strictly guaranteed:
 * 1. ZERO automatic/unattended execution. Must be explicitly authorized via test harness or dev gate.
 * 2. Only internal actions executed: Follow-up creation (`crm_follow_ups`), Reminder creation (`crm_internal_reminders`),
 *    and Tag application (`crm_lead_tags`).
 * 3. Atomic rollback: On any transaction failure, business rows roll back cleanly with zero orphaned rows.
 * 4. Deterministic deduplication: `Owner + Event + Rule ID + Version + Action Index + Target` prevents duplicate execution.
 * 5. Owner-scoped isolation: Strict cross-owner rejection.
 * 6. Stale rule version check: Rejects execution if rule version was modified.
 * 7. Recursion prevention: Rejects execution beyond `MAX_EXECUTION_DEPTH` (depth 3).
 * 8. Financial and communications invariants: Never modifies deals, payments, or sends external messages.
 */
export async function executeAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ruleId: string,
  input: ExecuteAutomationInput,
  options?: {
    now?: Date;
    sourceEventId?: string;
  },
): Promise<AutomationExecutionResult> {
  const parsedInput = executeAutomationInputSchema.parse(input);
  const now = options?.now ?? new Date();
  const nowStr = toMysqlUtcDateTime(now);
  const depth = parsedInput.depth;
  const causationId = parsedInput.causationId ?? null;
  const bodyEventId = parsedInput.event.eventId?.trim() ?? "";
  const optEventId = options?.sourceEventId?.trim() ?? "";
  if (bodyEventId && optEventId && bodyEventId !== optEventId) {
    throw new CrmServiceError(
      400,
      "automation_validation_error",
      "Conflicting event.eventId and sourceEventId values supplied.",
    );
  }
  const sourceEventId = optEventId || bodyEventId;
  if (!sourceEventId || sourceEventId.length < 3) {
    throw new CrmServiceError(
      400,
      "automation_validation_error",
      "Explicit event.eventId (min 3 characters) or sourceEventId is required for safe automation execution.",
    );
  }

  const lifecycle: ExecutionLifecycleRecord[] = [
    { state: "evaluated", timestamp: nowStr, detail: "Started automation execution evaluation" },
  ];

  // 1. Enforce recursion limit
  if (depth > MAX_EXECUTION_DEPTH) {
    throw new CrmServiceError(
      400,
      "automation_validation_error",
      `Execution depth ${depth} exceeds maximum allowed depth limit of ${MAX_EXECUTION_DEPTH}. Recursion halted.`,
      { details: { depth, maxDepth: MAX_EXECUTION_DEPTH } },
    );
  }

  // 2. Fetch and validate Rule configuration state
  const [rule] = await db
    .select()
    .from(crmAutomationRules)
    .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
    .limit(1);

  if (!rule) {
    throw new CrmServiceError(
      404,
      "automation_rule_not_found",
      `Automation rule "${ruleId}" not found.`,
    );
  }

  // Paused / Archived / Draft guard
  if (rule.status === "paused") {
    throw new CrmServiceError(
      409,
      "automation_rule_conflict",
      `Automation rule "${rule.name}" is paused. Paused rules cannot execute actions.`,
    );
  }
  if (rule.status === "archived") {
    throw new CrmServiceError(
      409,
      "automation_rule_archived",
      `Automation rule "${rule.name}" is archived. Archived rules cannot execute actions.`,
    );
  }
  if (rule.status !== "enabled") {
    throw new CrmServiceError(
      409,
      "automation_rule_conflict",
      `Automation rule "${rule.name}" status is "${rule.status}". Only enabled rules can execute actions.`,
    );
  }

  // Version lock guard
  if (parsedInput.expectedVersion !== undefined && rule.version !== parsedInput.expectedVersion) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      `Rule version mismatch. The rule was modified (current version: ${rule.version}, expected: ${parsedInput.expectedVersion}).`,
      { conflict: { currentVersion: rule.version, expectedVersion: parsedInput.expectedVersion } },
    );
  }

  // 3. Target entity verification BEFORE condition evaluation (Owner-scoped & active state)
  const targetLeadId = parsedInput.event.leadId ?? null;
  const targetProjectId = parsedInput.event.projectId ?? null;
  const targetFollowupId = parsedInput.event.followupId ?? null;
  let targetLead: typeof crmLeads.$inferSelect | null = null;
  let targetProject: typeof crmProjects.$inferSelect | null = null;

  if (targetLeadId) {
    const [leadRow] = await db
      .select()
      .from(crmLeads)
      .where(and(eq(crmLeads.id, targetLeadId), eq(crmLeads.ownerUserId, ownerUserId)))
      .limit(1);

    if (!leadRow) {
      throw new CrmServiceError(
        404,
        "lead_not_found",
        `Target Lead "${targetLeadId}" not found for Owner.`,
      );
    }
    if (leadRow.lifecycleStatus !== "active") {
      throw new CrmServiceError(
        409,
        "lead_archived",
        `Target Lead "${targetLeadId}" is not active (lifecycleStatus: ${leadRow.lifecycleStatus}).`,
      );
    }
    targetLead = leadRow;
  }

  if (targetProjectId) {
    const [projectRow] = await db
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.id, targetProjectId), eq(crmProjects.ownerUserId, ownerUserId)))
      .limit(1);

    if (!projectRow) {
      throw new CrmServiceError(
        404,
        "project_not_found",
        `Target Project "${targetProjectId}" not found for Owner.`,
      );
    }
    if (projectRow.status === "cancelled") {
      throw new CrmServiceError(
        400,
        "automation_validation_error",
        `Target Project "${targetProjectId}" is cancelled. Cannot execute automation on cancelled project.`,
      );
    }
    targetProject = projectRow;
  }

  if (targetFollowupId) {
    const [fuRow] = await db
      .select()
      .from(crmFollowUps)
      .where(and(eq(crmFollowUps.id, targetFollowupId), eq(crmFollowUps.ownerUserId, ownerUserId)))
      .limit(1);

    if (!fuRow) {
      throw new CrmServiceError(
        404,
        "not_found",
        `Target Follow-up "${targetFollowupId}" not found for Owner.`,
      );
    }
    if (targetLeadId && fuRow.leadId !== targetLeadId) {
      throw new CrmServiceError(
        400,
        "automation_validation_error",
        `Target Follow-up "${targetFollowupId}" does not belong to Lead "${targetLeadId}".`,
      );
    }
  }

  // 4. Plan & Simulate rule against event
  const simulation = await simulateRuleExecution(
    db as unknown as Parameters<typeof simulateRuleExecution>[0],
    ownerUserId,
    {
      id: rule.id,
      name: rule.name,
      subject: rule.subject as RuleSubject,
      triggerType: rule.triggerType as TriggerType,
      conditions: JSON.parse(rule.conditionsJson),
      actions: JSON.parse(rule.actionsJson),
      settings: JSON.parse(rule.settingsJson),
    },
    parsedInput.event,
  );

  if (!simulation.triggerMatched) {
    lifecycle.push({
      state: "skipped",
      timestamp: nowStr,
      detail: "Trigger did not match event trigger",
    });
    return {
      ok: true,
      runId: generateServerId("ar_run"),
      ruleId: rule.id,
      ruleVersion: rule.version,
      triggerType: rule.triggerType as TriggerType,
      outcome: "skipped",
      lifecycle,
      plannedActions: [],
      executedActions: [],
      replayed: false,
      causationId,
      depth,
      createdAt: nowStr,
    };
  }

  if (!simulation.matched) {
    lifecycle.push({
      state: "skipped",
      timestamp: nowStr,
      detail: "Rule conditions did not match target entity",
    });
    return {
      ok: true,
      runId: generateServerId("ar_run"),
      ruleId: rule.id,
      ruleVersion: rule.version,
      triggerType: rule.triggerType as TriggerType,
      outcome: "skipped",
      lifecycle,
      plannedActions: simulation.plannedActions,
      executedActions: [],
      replayed: false,
      causationId,
      depth,
      createdAt: nowStr,
    };
  }

  lifecycle.push({ state: "matched", timestamp: nowStr, detail: "Rule conditions matched" });
  lifecycle.push({
    state: "planned",
    timestamp: nowStr,
    detail: `${simulation.plannedActions.length} actions planned`,
  });
  lifecycle.push({
    state: "authorized",
    timestamp: nowStr,
    detail: "Test execution authorized by Owner",
  });

  // 5. Select actions to execute & enforce bounded action budget
  const actionsToProcess: Array<{
    index: number;
    plan: Omit<PlannedActionItem, "action"> & { action: ActionType | "tag" };
  }> = [];

  if (parsedInput.customTagId) {
    if (!targetLead) {
      throw new CrmServiceError(
        400,
        "automation_validation_error",
        "Custom tag application requires an active target leadId.",
      );
    }
    actionsToProcess.push({
      index: 999,
      plan: {
        action: "tag",
        label: "Apply Lead Tag",
        category: "internal",
        target: `lead:${targetLead.id}`,
        reason: `Apply tag ${parsedInput.customTagId} to lead`,
        dueAt: nowStr,
        details: { tagId: parsedInput.customTagId, leadId: targetLead.id },
        executableInCurrentCheckpoint: true,
        unattendedExecutionAllowed: false,
      },
    });
  } else if (parsedInput.actionIndex !== undefined) {
    const selected = simulation.plannedActions[parsedInput.actionIndex];
    if (!selected) {
      throw new CrmServiceError(
        400,
        "validation_error",
        `Action index ${parsedInput.actionIndex} does not exist in planned actions.`,
      );
    }
    actionsToProcess.push({ index: parsedInput.actionIndex, plan: selected });
  } else {
    simulation.plannedActions.forEach((plan, index) => {
      actionsToProcess.push({ index, plan });
    });
  }

  if (actionsToProcess.length > MAX_ACTIONS_PER_EVENT) {
    throw new CrmServiceError(
      400,
      "automation_validation_error",
      `Action count ${actionsToProcess.length} exceeds limit of ${MAX_ACTIONS_PER_EVENT} actions per event.`,
      { details: { actionCount: actionsToProcess.length, maxActions: MAX_ACTIONS_PER_EVENT } },
    );
  }

  const runId = generateServerId("ar_run");
  const targetId = targetLeadId ?? targetProjectId ?? "global";
  const primaryActionIndex = parsedInput.customTagId
    ? 999
    : parsedInput.actionIndex !== undefined
      ? parsedInput.actionIndex
      : -1;

  const primaryExecutionKey = computeExecutionKey({
    ownerUserId,
    sourceEventId,
    ruleId: rule.id,
    ruleVersion: rule.version,
    actionIndex: primaryActionIndex,
    targetId,
    customTagId: parsedInput.customTagId,
  });

  // Bind idempotency request hash across ALL execution-affecting parameters
  const idemKey = parsedInput.idempotencyKey ?? null;
  const idemScope = `auto_exec_${rule.id}`;
  const requestHash = idemKey
    ? hashIdempotentRequest(idemScope, {
        ruleId: rule.id,
        sourceEventId,
        event: parsedInput.event,
        actionIndex: parsedInput.actionIndex ?? null,
        customTagId: parsedInput.customTagId ?? null,
        expectedVersion: parsedInput.expectedVersion ?? null,
        causationId,
        depth,
        dryRunRollback: Boolean(parsedInput.dryRunRollback),
        testFailureInjection: parsedInput.testFailureInjection ?? "none",
      })
    : "";

  lifecycle.push({ state: "executing", timestamp: nowStr, detail: "Beginning atomic transaction" });

  let retryCount = 0;
  const maxDeadlockRetries = 3;

  while (true) {
    try {
      const executedActions: ExecutedActionDetail[] = [];

      const idemResult = await runWithIdempotency<AutomationExecutionResult>(
        db,
        {
          ownerUserId,
          scope: idemScope,
          idemKey,
          requestHash,
          now,
        },
        async (tx) => {
          // Check execution-key deduplication INSIDE runWithIdempotency so mismatched idempotency payloads still 409 first
          const [existingRun] = await tx
            .select()
            .from(crmAutomationRuns)
            .where(
              and(
                eq(crmAutomationRuns.ownerUserId, ownerUserId),
                eq(crmAutomationRuns.executionKey, primaryExecutionKey),
                inArray(crmAutomationRuns.outcome, ["succeeded", "skipped"]),
              ),
            )
            .limit(1);

          if (existingRun) {
            const skipLifecycle: ExecutionLifecycleRecord[] = [
              ...lifecycle,
              {
                state: "skipped",
                timestamp: nowStr,
                detail: `Execution skipped: identical action already recorded under executionKey ${primaryExecutionKey}`,
              },
            ];
            return {
              status: 200,
              body: {
                ok: true,
                runId: existingRun.id,
                ruleId: existingRun.ruleId,
                ruleVersion: existingRun.ruleVersion ?? rule.version,
                triggerType: existingRun.triggerType as TriggerType,
                outcome: "skipped",
                lifecycle: skipLifecycle,
                plannedActions: simulation.plannedActions,
                executedActions: JSON.parse(existingRun.executedActionsJson || "[]"),
                replayed: true,
                causationId,
                depth,
                createdAt: existingRun.createdAt,
              },
              resourceId: existingRun.id,
            };
          }

          // Test failure injection: simulated transaction error
          if (parsedInput.testFailureInjection === "transaction_error") {
            throw new Error("INJECTED_TRANSACTION_FAILURE");
          }

          for (const item of actionsToProcess) {
            const actionExecutionKey = computeExecutionKey({
              ownerUserId,
              sourceEventId,
              ruleId: rule.id,
              ruleVersion: rule.version,
              actionIndex: item.index,
              targetId,
              customTagId: parsedInput.customTagId,
            });

            // 1. Follow-up action handler
            if (item.plan.action === "followup") {
              if (!targetLead) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "followup",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: item.plan.target,
                  reason: "Follow-up action requires an active target lead.",
                });
                continue;
              }

              // Consistent InnoDB lock ordering with followupsService: lock crm_leads BEFORE crm_follow_ups
              const [lockedLead] = await tx
                .select()
                .from(crmLeads)
                .where(and(eq(crmLeads.id, targetLead.id), eq(crmLeads.ownerUserId, ownerUserId)))
                .limit(1)
                .for("update");

              if (!lockedLead) {
                throw new CrmServiceError(
                  404,
                  "lead_not_found",
                  `Target Lead "${targetLead.id}" not found for Owner.`,
                );
              }
              if (lockedLead.lifecycleStatus !== "active") {
                throw new CrmServiceError(
                  409,
                  "lead_archived",
                  `Target Lead "${targetLead.id}" is not active (lifecycleStatus: ${lockedLead.lifecycleStatus}).`,
                );
              }

              const [existingOpFu] = await tx
                .select()
                .from(crmFollowUps)
                .where(
                  and(
                    eq(crmFollowUps.ownerUserId, ownerUserId),
                    eq(crmFollowUps.opId, actionExecutionKey),
                  ),
                )
                .limit(1);

              if (existingOpFu) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "followup",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: `lead:${targetLead.id}`,
                  recordId: existingOpFu.id,
                  recordType: "crm_follow_ups",
                  reason: `Follow-up already created under executionKey (${existingOpFu.id})`,
                  details: { existingFollowUpId: existingOpFu.id },
                });
                continue;
              }

              const [activeFu] = await tx
                .select()
                .from(crmFollowUps)
                .where(
                  and(
                    eq(crmFollowUps.ownerUserId, ownerUserId),
                    eq(crmFollowUps.leadId, targetLead.id),
                    isNull(crmFollowUps.completedAt),
                    isNull(crmFollowUps.cancelledAt),
                  ),
                )
                .limit(1)
                .for("update");

              if (activeFu) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "followup",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: `lead:${targetLead.id}`,
                  reason: `Lead already has active pending follow-up (${activeFu.id})`,
                  details: { activeFollowUpId: activeFu.id },
                });
                continue;
              }

              const rawHours = Number(item.plan.details["followupInHours"] ?? 24);
              const hours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 24;
              const dueAtDate = new Date(now.getTime() + hours * 3600000);
              const ist = toIstParts(dueAtDate);
              const dueUtcStr = toMysqlUtcDateTime(dueAtDate);
              const fuId = generateServerId("fu");
              const noteText = `[Automation: ${rule.name}] ${item.plan.reason}`;

              await tx.insert(crmFollowUps).values({
                id: fuId,
                ownerUserId,
                leadId: targetLead.id,
                activeLeadLock: targetLead.id,
                type: "call",
                dueAt: dueUtcStr,
                dueIstDate: ist.istDate,
                dueIstTime: ist.istTime,
                note: noteText,
                opId: actionExecutionKey,
                createdByUserId: actorUserId,
                updatedByUserId: actorUserId,
                version: 1,
                createdAt: nowStr,
                updatedAt: nowStr,
              });

              if (parsedInput.testFailureInjection === "lead_sync_error") {
                throw new Error("INJECTED_LEAD_SYNC_FAILURE");
              }

              await recomputeLeadNextFollowUpInTx(
                tx as unknown as Parameters<typeof recomputeLeadNextFollowUpInTx>[0],
                ownerUserId,
                targetLead.id,
              );
              await tx
                .update(crmLeads)
                .set({
                  updatedByUserId: actorUserId,
                  updatedAt: nowStr,
                })
                .where(and(eq(crmLeads.id, targetLead.id), eq(crmLeads.ownerUserId, ownerUserId)));

              if (parsedInput.testFailureInjection === "activity_error") {
                throw new Error("INJECTED_ACTIVITY_FAILURE");
              }

              const actId = generateServerId("act");
              await tx.insert(crmLeadActivities).values({
                id: actId,
                legacyId: null,
                ownerUserId,
                leadId: targetLead.id,
                actorUserId,
                type: "followup",
                text: noteText,
                outcome: null,
                opId: actionExecutionKey,
                occurredAt: nowStr,
                createdAt: nowStr,
              });

              executedActions.push({
                actionIndex: item.index,
                action: "followup",
                executionKey: actionExecutionKey,
                status: "succeeded",
                target: `lead:${targetLead.id}`,
                recordId: fuId,
                recordType: "crm_follow_ups",
                details: {
                  dueAt: dueUtcStr,
                  dueIstDate: ist.istDate,
                  dueIstTime: ist.istTime,
                  note: noteText,
                  opId: actionExecutionKey,
                },
              });
            }

            // 2. Reminder action handler
            else if (item.plan.action === "reminder") {
              const reminderKey = `rem_${actionExecutionKey}`;
              const [existingRem] = await tx
                .select()
                .from(crmInternalReminders)
                .where(
                  and(
                    eq(crmInternalReminders.ownerUserId, ownerUserId),
                    eq(crmInternalReminders.reminderKey, reminderKey),
                  ),
                )
                .limit(1);

              if (existingRem) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "reminder",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: targetLead
                    ? `lead:${targetLead.id}`
                    : targetProject
                      ? `project:${targetProject.id}`
                      : "internal",
                  recordId: existingRem.id,
                  recordType: "crm_internal_reminders",
                  reason: `Internal reminder already recorded for reminderKey (${existingRem.id})`,
                  details: { reminderKey, existingReminderId: existingRem.id },
                });
                continue;
              }

              const remId = generateServerId("rem");
              await tx.insert(crmInternalReminders).values({
                id: remId,
                ownerUserId,
                reminderKey,
                ruleId: rule.id,
                ruleName: rule.name,
                leadId: targetLead?.id ?? null,
                projectId: targetProject?.id ?? null,
                reason: item.plan.reason,
                dueAt: nowStr,
                importance:
                  (item.plan.details["importance"] as
                    (typeof crmInternalReminders.$inferInsert)["importance"] | undefined) ??
                  "normal",
                status: "open",
                flag: Boolean(item.plan.details["flag"]),
                ownerReview: Boolean(item.plan.details["ownerReview"]),
                escalated: false,
                resolveWhen:
                  (item.plan.details["resolveWhen"] as
                    (typeof crmInternalReminders.$inferInsert)["resolveWhen"] | undefined) ??
                  "never",
                origin: "automation",
                createdAt: nowStr,
                updatedAt: nowStr,
              });

              executedActions.push({
                actionIndex: item.index,
                action: "reminder",
                executionKey: actionExecutionKey,
                status: "succeeded",
                target: targetLead
                  ? `lead:${targetLead.id}`
                  : targetProject
                    ? `project:${targetProject.id}`
                    : "internal",
                recordId: remId,
                recordType: "crm_internal_reminders",
                details: {
                  reminderKey,
                  status: "open",
                  origin: "automation",
                  noDeliveryClaimed: true,
                },
              });
            }

            // 3. Tag action handler (enforces Owner isolation, active status, and Lead-compatible scope)
            else if (
              (item.plan.action as string) === "tag" ||
              (item.index === 999 && parsedInput.customTagId)
            ) {
              const tagId = (
                (item.plan.details["tagId"] as string) ??
                parsedInput.customTagId ??
                ""
              ).trim();
              if (!tagId) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "tag",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: targetLead ? `lead:${targetLead.id}` : "unknown",
                  reason: "No tagId configured for tag action.",
                });
                continue;
              }
              if (!targetLead) {
                executedActions.push({
                  actionIndex: item.index,
                  action: "tag",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: item.plan.target,
                  reason: "Tag action requires an active target lead.",
                });
                continue;
              }

              const [tagRow] = await tx
                .select()
                .from(crmTagDefs)
                .where(and(eq(crmTagDefs.id, tagId), eq(crmTagDefs.ownerUserId, ownerUserId)))
                .limit(1);

              if (!tagRow) {
                throw new CrmServiceError(
                  404,
                  "not_found",
                  `Tag "${tagId}" not found for this Owner.`,
                );
              }
              if (tagRow.status !== "active") {
                throw new CrmServiceError(
                  400,
                  "validation_error",
                  `Cannot apply non-active Tag "${tagRow.name}" (${tagId}) with status "${tagRow.status}" to Lead.`,
                );
              }
              if (tagRow.scope !== "lead" && tagRow.scope !== "both") {
                throw new CrmServiceError(
                  400,
                  "validation_error",
                  `Cannot apply ${tagRow.scope}-scoped Tag "${tagRow.name}" (${tagId}) to a Lead.`,
                );
              }

              const [existingLink] = await tx
                .select()
                .from(crmLeadTags)
                .where(
                  and(
                    eq(crmLeadTags.ownerUserId, ownerUserId),
                    eq(crmLeadTags.leadId, targetLead.id),
                    eq(crmLeadTags.tagId, tagId),
                  ),
                )
                .limit(1)
                .for("update");

              if (!existingLink) {
                const tagLinkId = generateServerId("ltag");
                await tx.insert(crmLeadTags).values({
                  id: tagLinkId,
                  ownerUserId,
                  leadId: targetLead.id,
                  tagId,
                  createdAt: nowStr,
                });

                executedActions.push({
                  actionIndex: item.index,
                  action: "tag",
                  executionKey: actionExecutionKey,
                  status: "succeeded",
                  target: `lead:${targetLead.id}`,
                  recordId: tagLinkId,
                  recordType: "crm_lead_tags",
                  details: { tagId, tagName: tagRow.name, scope: tagRow.scope },
                });
              } else {
                executedActions.push({
                  actionIndex: item.index,
                  action: "tag",
                  executionKey: actionExecutionKey,
                  status: "skipped",
                  target: `lead:${targetLead.id}`,
                  recordId: existingLink.id,
                  recordType: "crm_lead_tags",
                  reason: "Tag already applied to lead",
                  details: { tagId, tagName: tagRow.name, scope: tagRow.scope },
                });
              }
            }

            // 4. Audit-only / non-executable action types in current checkpoint
            else {
              executedActions.push({
                actionIndex: item.index,
                action: item.plan.action,
                executionKey: actionExecutionKey,
                status: "skipped",
                target: item.plan.target,
                reason: `Action "${item.plan.action}" is audit-only and not executed automatically in current checkpoint.`,
                details: { executableInCurrentCheckpoint: false },
              });
            }

            // Test failure injection: simulated constraint violation
            if (parsedInput.testFailureInjection === "constraint_violation") {
              await tx.insert(crmAutomationRuns).values({
                id: "duplicate_id_force_error",
                ownerUserId,
                ruleId: rule.id,
                triggerType: rule.triggerType,
                outcome: "failed",
                isSimulation: false,
                plannedActionsJson: "[]",
                executedActionsJson: "[]",
                createdAt: nowStr,
              });
              await tx.insert(crmAutomationRuns).values({
                id: "duplicate_id_force_error",
                ownerUserId,
                ruleId: rule.id,
                triggerType: rule.triggerType,
                outcome: "failed",
                isSimulation: false,
                plannedActionsJson: "[]",
                executedActionsJson: "[]",
                createdAt: nowStr,
              });
            }
          }

          if (parsedInput.dryRunRollback) {
            throw new Error("DRY_RUN_ROLLBACK_REQUESTED");
          }

          const succeededCount = executedActions.filter((a) => a.status === "succeeded").length;
          const skippedCount = executedActions.filter((a) => a.status === "skipped").length;
          const runOutcome: "succeeded" | "skipped" = succeededCount > 0 ? "succeeded" : "skipped";

          // Record atomic execution audit row in crm_automation_runs
          await tx.insert(crmAutomationRuns).values({
            id: runId,
            ownerUserId,
            ruleId: rule.id,
            executionKey: primaryExecutionKey,
            ruleVersion: rule.version,
            triggerType: parsedInput.event.triggerType,
            outcome: runOutcome,
            isSimulation: false,
            leadId: targetLeadId,
            projectId: targetProjectId,
            matchedCount: 1,
            skippedCount,
            plannedActionsJson: JSON.stringify(simulation.plannedActions),
            executedActionsJson: JSON.stringify(executedActions),
            executionError: null,
            causationId,
            depth,
            actorUserId,
            createdAt: nowStr,
          });

          // Update rule timestamps: only update lastTriggeredAt when an action actually succeeded
          await tx
            .update(crmAutomationRules)
            .set({
              lastEvaluatedAt: nowStr,
              ...(runOutcome === "succeeded" ? { lastTriggeredAt: nowStr } : {}),
              updatedAt: nowStr,
            })
            .where(eq(crmAutomationRules.id, rule.id));

          const finalLifecycle: ExecutionLifecycleRecord[] = [
            ...lifecycle,
            {
              state: runOutcome,
              timestamp: nowStr,
              detail:
                runOutcome === "succeeded"
                  ? "All actions committed atomically"
                  : "Execution completed with all planned actions skipped",
            },
          ];

          const body: AutomationExecutionResult = {
            ok: true,
            runId,
            ruleId: rule.id,
            ruleVersion: rule.version,
            triggerType: parsedInput.event.triggerType,
            outcome: runOutcome,
            lifecycle: finalLifecycle,
            plannedActions: simulation.plannedActions,
            executedActions,
            replayed: false,
            causationId,
            depth,
            createdAt: nowStr,
          };

          return { status: 200, body, resourceId: runId };
        },
      );

      return {
        ...idemResult.body,
        replayed: Boolean(idemResult.replayed || idemResult.body.replayed),
      };
    } catch (err: unknown) {
      if (isMysqlDeadlockError(err) && retryCount < maxDeadlockRetries) {
        retryCount++;
        await new Promise((resolve) =>
          setTimeout(resolve, 50 * retryCount + Math.floor(Math.random() * 50)),
        );
        continue;
      }

      if (err instanceof Error && err.message === "DRY_RUN_ROLLBACK_REQUESTED") {
        lifecycle.push({
          state: "skipped",
          timestamp: nowStr,
          detail: "Dry run rollback successfully completed",
        });
        return {
          ok: true,
          runId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          triggerType: parsedInput.event.triggerType,
          outcome: "skipped",
          lifecycle,
          plannedActions: simulation.plannedActions,
          executedActions: [],
          replayed: false,
          causationId,
          depth,
          createdAt: nowStr,
        };
      }

      // Handle concurrent duplicate execution races where another request committed first
      if (isMysqlDuplicateKeyError(err)) {
        const [winnerRun] = await db
          .select()
          .from(crmAutomationRuns)
          .where(
            and(
              eq(crmAutomationRuns.ownerUserId, ownerUserId),
              eq(crmAutomationRuns.executionKey, primaryExecutionKey),
              inArray(crmAutomationRuns.outcome, ["succeeded", "skipped"]),
            ),
          )
          .limit(1);

        if (winnerRun) {
          lifecycle.push({
            state: "skipped",
            timestamp: nowStr,
            detail: "Concurrent execution race: winner already committed this action.",
          });
          return {
            ok: true,
            runId: winnerRun.id,
            ruleId: winnerRun.ruleId,
            ruleVersion: winnerRun.ruleVersion ?? rule.version,
            triggerType: winnerRun.triggerType as TriggerType,
            outcome: "skipped",
            lifecycle,
            plannedActions: simulation.plannedActions,
            executedActions: JSON.parse(winnerRun.executedActionsJson || "[]"),
            replayed: true,
            causationId,
            depth,
            createdAt: winnerRun.createdAt,
          };
        }
      }

      const safeErrorMsg = sanitizeAutomationExecutionError(err);

      // Durably record sanitized failure audit row outside the rolled-back transaction
      const failedRunId = generateServerId("ar_run_fail");
      try {
        await db.insert(crmAutomationRuns).values({
          id: failedRunId,
          ownerUserId,
          ruleId: rule.id,
          executionKey: null, // never lock executionKey on failure so legitimate retries succeed
          ruleVersion: rule.version,
          triggerType: parsedInput.event.triggerType,
          outcome: "failed",
          isSimulation: false,
          leadId: targetLeadId,
          projectId: targetProjectId,
          matchedCount: 1,
          skippedCount: 0,
          plannedActionsJson: JSON.stringify(simulation.plannedActions),
          executedActionsJson: "[]",
          executionError: safeErrorMsg.slice(0, 255),
          causationId,
          depth,
          actorUserId,
          createdAt: nowStr,
        });
      } catch {
        // ignore secondary audit failure
      }

      lifecycle.push({ state: "failed", timestamp: nowStr, detail: safeErrorMsg });

      if (err instanceof CrmServiceError) {
        throw err;
      }

      throw new CrmServiceError(
        500,
        "automation_execution_failed",
        `Automation execution failed: ${safeErrorMsg}`,
        {
          details: { runId: failedRunId, error: safeErrorMsg },
        },
      );
    }
  }
}
