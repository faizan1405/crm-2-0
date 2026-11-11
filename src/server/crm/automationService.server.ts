import "@tanstack/react-start/server-only";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import {
  crmAutomationRules,
  crmAutomationRuleRevisions,
  crmAutomationRuns,
} from "../db/schema.server";
import { generateServerId } from "../auth/security.server";
import { CrmServiceError } from "./errors.server";
import {
  ALL_TRIGGERS,
  ACTIONS_FOR,
  ACTION_LABELS,
  CUSTOM_CONDITION_OPERATORS,
  LEAD_TRIGGERS,
  PROJECT_TRIGGERS,
  TRIGGER_LABELS,
  createAutomationRuleSchema,
  detectRuleConflicts,
  updateAutomationRuleSchema,
  validateRuleSemantics,
  type ActionType,
  type CreateAutomationRuleInput,
  type RuleConditions,
  type RuleSettings,
  type RuleStatus,
  type RuleSubject,
  type TriggerType,
  type UpdateAutomationRuleInput,
} from "./automationCalc.server";
import {
  simulateRuleExecution,
  syntheticEventSchema,
  type SimulationResult,
  type SyntheticEvent,
} from "./automationSimulation.server";
import {
  findOrVerifyIdempotencyReplay,
  hashIdempotentRequest,
  storeIdempotencyResponse,
} from "./idempotency.server";
import { toMysqlUtcDateTime } from "../db/utc.server";

export interface ParsedAutomationRule {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  subject: RuleSubject;
  triggerType: TriggerType;
  status: RuleStatus;
  pausedReason: string | null;
  conditions: RuleConditions;
  actions: ActionType[];
  settings: RuleSettings;
  version: number;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedAutomationRuleRevision {
  id: string;
  ruleId: string;
  version: number;
  name: string;
  description: string;
  subject: RuleSubject;
  triggerType: TriggerType;
  status: RuleStatus;
  conditions: RuleConditions;
  actions: ActionType[];
  settings: RuleSettings;
  diffSummary: string | null;
  actorUserId: string;
  createdAt: string;
}

function parseRuleRow(row: typeof crmAutomationRules.$inferSelect): ParsedAutomationRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    templateId: row.templateId ?? null,
    subject: row.subject as RuleSubject,
    triggerType: row.triggerType as TriggerType,
    status: row.status as RuleStatus,
    pausedReason: row.pausedReason ?? null,
    conditions: JSON.parse(row.conditionsJson) as RuleConditions,
    actions: JSON.parse(row.actionsJson) as ActionType[],
    settings: JSON.parse(row.settingsJson) as RuleSettings,
    version: row.version,
    lastEvaluatedAt: row.lastEvaluatedAt ?? null,
    lastTriggeredAt: row.lastTriggeredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseRevisionRow(
  row: typeof crmAutomationRuleRevisions.$inferSelect,
): ParsedAutomationRuleRevision {
  return {
    id: row.id,
    ruleId: row.ruleId,
    version: row.version,
    name: row.name,
    description: row.description,
    subject: row.subject as RuleSubject,
    triggerType: row.triggerType as TriggerType,
    status: row.status as RuleStatus,
    conditions: JSON.parse(row.conditionsJson) as RuleConditions,
    actions: JSON.parse(row.actionsJson) as ActionType[],
    settings: JSON.parse(row.settingsJson) as RuleSettings,
    diffSummary: row.diffSummary ?? null,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

export async function listAutomationRulesRecord(
  db: CrmDatabase,
  ownerUserId: string,
  query: {
    status?: string | null;
    subject?: string | null;
    triggerType?: string | null;
    search?: string | null;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  rules: ParsedAutomationRule[];
  items: ParsedAutomationRule[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats?: {
    total: number;
    draft: number;
    enabled: number;
    paused: number;
    archived: number;
  };
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions = [eq(crmAutomationRules.ownerUserId, ownerUserId)];

  if (query.status && query.status !== "all") {
    conditions.push(eq(crmAutomationRules.status, query.status));
  }
  if (query.subject && query.subject !== "all") {
    conditions.push(eq(crmAutomationRules.subject, query.subject));
  }
  if (query.triggerType && query.triggerType !== "all") {
    conditions.push(eq(crmAutomationRules.triggerType, query.triggerType));
  }
  if (query.search && query.search.trim()) {
    const s = `%${query.search.trim()}%`;
    conditions.push(or(like(crmAutomationRules.name, s), like(crmAutomationRules.description, s))!);
  }

  const whereClause = and(...conditions);

  const [totalRes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(crmAutomationRules)
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [statsRes] = await db
    .select({
      total: sql<number>`count(*)`,
      draft: sql<number>`coalesce(sum(case when status = 'draft' then 1 else 0 end), 0)`,
      enabled: sql<number>`coalesce(sum(case when status = 'enabled' then 1 else 0 end), 0)`,
      paused: sql<number>`coalesce(sum(case when status = 'paused' then 1 else 0 end), 0)`,
      archived: sql<number>`coalesce(sum(case when status = 'archived' then 1 else 0 end), 0)`,
    })
    .from(crmAutomationRules)
    .where(eq(crmAutomationRules.ownerUserId, ownerUserId));

  const stats = {
    total: Number(statsRes?.total ?? 0),
    draft: Number(statsRes?.draft ?? 0),
    enabled: Number(statsRes?.enabled ?? 0),
    paused: Number(statsRes?.paused ?? 0),
    archived: Number(statsRes?.archived ?? 0),
  };

  const rows = await db
    .select()
    .from(crmAutomationRules)
    .where(whereClause)
    .orderBy(desc(crmAutomationRules.createdAt))
    .limit(pageSize)
    .offset(offset);

  const parsedRules = rows.map(parseRuleRow);

  return {
    rules: parsedRules,
    items: parsedRules,
    total,
    page,
    pageSize,
    totalPages,
    stats,
  };
}

export async function getAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  ruleId: string,
): Promise<ParsedAutomationRule> {
  const [row] = await db
    .select()
    .from(crmAutomationRules)
    .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
    .limit(1);

  if (!row) {
    throw new CrmServiceError(404, "automation_rule_not_found", `Automation rule "${ruleId}" not found.`);
  }

  return parseRuleRow(row);
}

export async function createAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  rawInput: CreateAutomationRuleInput,
  options?: { idempotencyKey?: string | null },
): Promise<{ ok: true; rule: ParsedAutomationRule; replayed?: boolean }> {
  const input = createAutomationRuleSchema.parse(rawInput);

  const semanticError = validateRuleSemantics(input);
  if (semanticError) {
    throw new CrmServiceError(400, "automation_validation_error", semanticError);
  }

  const scope = "create_automation_rule";
  const idemKey = options?.idempotencyKey;
  const requestHash = idemKey ? hashIdempotentRequest(scope, input) : "";
  const now = new Date();

  return await db.transaction(async (tx) => {
    if (idemKey) {
      const replay = await findOrVerifyIdempotencyReplay<{ ok: true; rule: ParsedAutomationRule }>(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        now,
      });
      if (replay.hit) {
        return { ...replay.body, replayed: true };
      }
    }

    // Check conflicts if enabled
    if (input.status === "enabled") {
      const existingEnabled = await tx
        .select()
        .from(crmAutomationRules)
        .where(
          and(
            eq(crmAutomationRules.ownerUserId, ownerUserId),
            eq(crmAutomationRules.status, "enabled"),
          ),
        );
      const conflicts = detectRuleConflicts(
        {
          subject: input.subject,
          triggerType: input.triggerType,
          conditions: input.conditions,
          actions: input.actions,
          name: input.name,
        },
        existingEnabled.map((r) => ({
          id: r.id,
          subject: r.subject as RuleSubject,
          triggerType: r.triggerType as TriggerType,
          status: r.status as RuleStatus,
          conditions: JSON.parse(r.conditionsJson),
          actions: JSON.parse(r.actionsJson),
          name: r.name,
        })),
      );
      if (conflicts.length > 0) {
        throw new CrmServiceError(409, "automation_rule_conflict", conflicts[0]!, {
          details: { conflicts },
        });
      }
    }

    const ruleId = generateServerId("ar");
    const revisionId = generateServerId("ar_rev");
    const nowStr = toMysqlUtcDateTime(now);

    const conditionsJson = JSON.stringify(input.conditions);
    const actionsJson = JSON.stringify(input.actions);
    const settingsJson = JSON.stringify(input.settings);

    await tx.insert(crmAutomationRules).values({
      id: ruleId,
      ownerUserId,
      name: input.name,
      description: input.description,
      templateId: input.templateId ?? null,
      subject: input.subject,
      triggerType: input.triggerType,
      status: input.status,
      pausedReason: null,
      conditionsJson,
      actionsJson,
      settingsJson,
      version: 1,
      createdAt: nowStr,
      updatedAt: nowStr,
    });

    await tx.insert(crmAutomationRuleRevisions).values({
      id: revisionId,
      ownerUserId,
      ruleId,
      version: 1,
      name: input.name,
      description: input.description,
      subject: input.subject,
      triggerType: input.triggerType,
      status: input.status,
      conditionsJson,
      actionsJson,
      settingsJson,
      diffSummary: "Initial rule creation",
      actorUserId,
      createdAt: nowStr,
    });

    const [createdRow] = await tx
      .select()
      .from(crmAutomationRules)
      .where(eq(crmAutomationRules.id, ruleId))
      .limit(1);

    const parsed = parseRuleRow(createdRow!);
    const result = { ok: true as const, rule: parsed };

    if (idemKey) {
      await storeIdempotencyResponse(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        resourceId: ruleId,
        responseStatus: 201,
        responseBody: result,
        now,
      });
    }

    return result;
  });
}

export async function updateAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ruleId: string,
  rawInput: UpdateAutomationRuleInput,
  options?: { idempotencyKey?: string | null },
): Promise<{ ok: true; rule: ParsedAutomationRule; replayed?: boolean }> {
  const input = updateAutomationRuleSchema.parse(rawInput);

  const semanticError = validateRuleSemantics(input);
  if (semanticError) {
    throw new CrmServiceError(400, "automation_validation_error", semanticError);
  }

  const scope = `update_automation_rule_${ruleId}`;
  const idemKey = options?.idempotencyKey;
  const requestHash = idemKey ? hashIdempotentRequest(scope, input) : "";
  const now = new Date();

  return await db.transaction(async (tx) => {
    if (idemKey) {
      const replay = await findOrVerifyIdempotencyReplay<{ ok: true; rule: ParsedAutomationRule }>(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        now,
      });
      if (replay.hit) {
        return { ...replay.body, replayed: true };
      }
    }

    const [existing] = await tx
      .select()
      .from(crmAutomationRules)
      .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");

    if (!existing) {
      throw new CrmServiceError(404, "automation_rule_not_found", `Automation rule "${ruleId}" not found.`);
    }

    if (existing.status === "archived") {
      throw new CrmServiceError(400, "automation_rule_archived", "Archived rules cannot be edited.");
    }

    // Optimistic locking
    if (existing.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Rule was modified by another session. Please reload and try again.",
        { conflict: { currentVersion: existing.version, expectedVersion: input.expectedVersion } },
      );
    }

    // Check conflicts if enabled
    if (input.status === "enabled") {
      const existingEnabled = await tx
        .select()
        .from(crmAutomationRules)
        .where(
          and(
            eq(crmAutomationRules.ownerUserId, ownerUserId),
            eq(crmAutomationRules.status, "enabled"),
          ),
        );
      const conflicts = detectRuleConflicts(
        {
          id: ruleId,
          subject: input.subject,
          triggerType: input.triggerType,
          conditions: input.conditions,
          actions: input.actions,
          name: input.name,
        },
        existingEnabled.map((r) => ({
          id: r.id,
          subject: r.subject as RuleSubject,
          triggerType: r.triggerType as TriggerType,
          status: r.status as RuleStatus,
          conditions: JSON.parse(r.conditionsJson),
          actions: JSON.parse(r.actionsJson),
          name: r.name,
        })),
      );
      if (conflicts.length > 0) {
        throw new CrmServiceError(409, "automation_rule_conflict", conflicts[0]!, {
          details: { conflicts },
        });
      }
    }

    const newVersion = existing.version + 1;
    const revisionId = generateServerId("ar_rev");
    const nowStr = toMysqlUtcDateTime(now);

    const conditionsJson = JSON.stringify(input.conditions);
    const actionsJson = JSON.stringify(input.actions);
    const settingsJson = JSON.stringify(input.settings);

    await tx
      .update(crmAutomationRules)
      .set({
        name: input.name,
        description: input.description,
        templateId: input.templateId ?? existing.templateId,
        subject: input.subject,
        triggerType: input.triggerType,
        status: input.status,
        conditionsJson,
        actionsJson,
        settingsJson,
        version: newVersion,
        updatedAt: nowStr,
      })
      .where(eq(crmAutomationRules.id, ruleId));

    await tx.insert(crmAutomationRuleRevisions).values({
      id: revisionId,
      ownerUserId,
      ruleId,
      version: newVersion,
      name: input.name,
      description: input.description,
      subject: input.subject,
      triggerType: input.triggerType,
      status: input.status,
      conditionsJson,
      actionsJson,
      settingsJson,
      diffSummary: `Rule updated to version ${newVersion}`,
      actorUserId,
      createdAt: nowStr,
    });

    const [updatedRow] = await tx
      .select()
      .from(crmAutomationRules)
      .where(eq(crmAutomationRules.id, ruleId))
      .limit(1);

    const parsed = parseRuleRow(updatedRow!);
    const result = { ok: true as const, rule: parsed };

    if (idemKey) {
      await storeIdempotencyResponse(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        resourceId: ruleId,
        responseStatus: 200,
        responseBody: result,
        now,
      });
    }

    return result;
  });
}

export async function duplicateAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ruleId: string,
  options?: { idempotencyKey?: string | null },
): Promise<{ ok: true; rule: ParsedAutomationRule; replayed?: boolean }> {
  const scope = `duplicate_automation_rule_${ruleId}`;
  const idemKey = options?.idempotencyKey;
  const requestHash = idemKey ? hashIdempotentRequest(scope, { ruleId }) : "";
  const now = new Date();

  return await db.transaction(async (tx) => {
    if (idemKey) {
      const replay = await findOrVerifyIdempotencyReplay<{ ok: true; rule: ParsedAutomationRule }>(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        now,
      });
      if (replay.hit) {
        return { ...replay.body, replayed: true };
      }
    }

    const [existing] = await tx
      .select()
      .from(crmAutomationRules)
      .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
      .limit(1);

    if (!existing) {
      throw new CrmServiceError(404, "automation_rule_not_found", `Automation rule "${ruleId}" not found.`);
    }

    const newRuleId = generateServerId("ar");
    const newRevisionId = generateServerId("ar_rev");
    const duplicatedName = `Copy of ${existing.name}`.slice(0, 128);
    const nowStr = toMysqlUtcDateTime(now);

    await tx.insert(crmAutomationRules).values({
      id: newRuleId,
      ownerUserId,
      name: duplicatedName,
      description: existing.description,
      templateId: existing.templateId,
      subject: existing.subject,
      triggerType: existing.triggerType,
      status: "draft", // Always start duplicates as draft
      pausedReason: null,
      conditionsJson: existing.conditionsJson,
      actionsJson: existing.actionsJson,
      settingsJson: existing.settingsJson,
      version: 1,
      createdAt: nowStr,
      updatedAt: nowStr,
    });

    await tx.insert(crmAutomationRuleRevisions).values({
      id: newRevisionId,
      ownerUserId,
      ruleId: newRuleId,
      version: 1,
      name: duplicatedName,
      description: existing.description,
      subject: existing.subject,
      triggerType: existing.triggerType,
      status: "draft",
      conditionsJson: existing.conditionsJson,
      actionsJson: existing.actionsJson,
      settingsJson: existing.settingsJson,
      diffSummary: `Duplicated from rule ${ruleId}`,
      actorUserId,
      createdAt: nowStr,
    });

    const [createdRow] = await tx
      .select()
      .from(crmAutomationRules)
      .where(eq(crmAutomationRules.id, newRuleId))
      .limit(1);

    const parsed = parseRuleRow(createdRow!);
    const result = { ok: true as const, rule: parsed };

    if (idemKey) {
      await storeIdempotencyResponse(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        resourceId: newRuleId,
        responseStatus: 201,
        responseBody: result,
        now,
      });
    }

    return result;
  });
}

export async function archiveAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ruleId: string,
  expectedVersion?: number,
  options?: { idempotencyKey?: string | null },
): Promise<{ ok: true; rule: ParsedAutomationRule; replayed?: boolean }> {
  const scope = `archive_automation_rule_${ruleId}`;
  const idemKey = options?.idempotencyKey;
  const requestHash = idemKey ? hashIdempotentRequest(scope, { ruleId, expectedVersion }) : "";
  const now = new Date();

  return await db.transaction(async (tx) => {
    if (idemKey) {
      const replay = await findOrVerifyIdempotencyReplay<{ ok: true; rule: ParsedAutomationRule }>(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        now,
      });
      if (replay.hit) {
        return { ...replay.body, replayed: true };
      }
    }

    const [existing] = await tx
      .select()
      .from(crmAutomationRules)
      .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");

    if (!existing) {
      throw new CrmServiceError(404, "automation_rule_not_found", `Automation rule "${ruleId}" not found.`);
    }

    if (existing.status === "archived") {
      throw new CrmServiceError(400, "automation_rule_archived", "Rule is already archived.");
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Rule was modified by another session. Please reload before archiving.",
        { conflict: { currentVersion: existing.version, expectedVersion } },
      );
    }

    const newVersion = existing.version + 1;
    const revisionId = generateServerId("ar_rev");
    const nowStr = toMysqlUtcDateTime(now);

    await tx
      .update(crmAutomationRules)
      .set({
        status: "archived",
        version: newVersion,
        updatedAt: nowStr,
      })
      .where(eq(crmAutomationRules.id, ruleId));

    await tx.insert(crmAutomationRuleRevisions).values({
      id: revisionId,
      ownerUserId,
      ruleId,
      version: newVersion,
      name: existing.name,
      description: existing.description,
      subject: existing.subject,
      triggerType: existing.triggerType,
      status: "archived",
      conditionsJson: existing.conditionsJson,
      actionsJson: existing.actionsJson,
      settingsJson: existing.settingsJson,
      diffSummary: "Rule archived",
      actorUserId,
      createdAt: nowStr,
    });

    const [updatedRow] = await tx
      .select()
      .from(crmAutomationRules)
      .where(eq(crmAutomationRules.id, ruleId))
      .limit(1);

    const parsed = parseRuleRow(updatedRow!);
    const result = { ok: true as const, rule: parsed };

    if (idemKey) {
      await storeIdempotencyResponse(tx, {
        ownerUserId,
        scope,
        idemKey,
        requestHash,
        resourceId: ruleId,
        responseStatus: 200,
        responseBody: result,
        now,
      });
    }

    return result;
  });
}

export async function getAutomationRuleRevisionsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  ruleId: string,
): Promise<ParsedAutomationRuleRevision[]> {
  // Verify rule ownership
  const [rule] = await db
    .select({ id: crmAutomationRules.id })
    .from(crmAutomationRules)
    .where(and(eq(crmAutomationRules.id, ruleId), eq(crmAutomationRules.ownerUserId, ownerUserId)))
    .limit(1);

  if (!rule) {
    throw new CrmServiceError(404, "automation_rule_not_found", `Automation rule "${ruleId}" not found.`);
  }

  const rows = await db
    .select()
    .from(crmAutomationRuleRevisions)
    .where(
      and(
        eq(crmAutomationRuleRevisions.ownerUserId, ownerUserId),
        eq(crmAutomationRuleRevisions.ruleId, ruleId),
      ),
    )
    .orderBy(desc(crmAutomationRuleRevisions.version));

  return rows.map(parseRevisionRow);
}

export async function simulateAutomationRuleRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  ruleId: string,
  rawEvent: SyntheticEvent,
): Promise<{ ok: true; simulation: SimulationResult }> {
  const event = syntheticEventSchema.parse(rawEvent);

  const rule = await getAutomationRuleRecord(db, ownerUserId, ruleId);

  // Execute read-only simulation
  const result = await simulateRuleExecution(
    db as any,
    ownerUserId,
    {
      id: rule.id,
      name: rule.name,
      subject: rule.subject,
      triggerType: rule.triggerType,
      conditions: rule.conditions,
      actions: rule.actions,
      settings: rule.settings,
    },
    event,
  );

  // Record simulation run audit (ZERO business mutations)
  const runId = generateServerId("ar_run");
  const now = new Date();
  const nowStr = toMysqlUtcDateTime(now);

  await db.insert(crmAutomationRuns).values({
    id: runId,
    ownerUserId,
    ruleId,
    triggerType: event.triggerType,
    outcome: result.matched ? "simulated" : "skipped",
    isSimulation: true,
    leadId: event.leadId ?? null,
    projectId: event.projectId ?? null,
    matchedCount: result.matched ? 1 : 0,
    skippedCount: result.matched ? 0 : 1,
    plannedActionsJson: JSON.stringify(result.plannedActions),
    executedActionsJson: "[]",
    executionError: null,
    actorUserId,
    createdAt: nowStr,
  });

  // Update rule lastEvaluatedAt
  await db
    .update(crmAutomationRules)
    .set({
      lastEvaluatedAt: nowStr,
      ...(result.matched ? { lastTriggeredAt: nowStr } : {}),
    })
    .where(eq(crmAutomationRules.id, ruleId));

  return { ok: true, simulation: result };
}

export function getAutomationDefinitions(): {
  triggers: Array<{ type: TriggerType; label: string; subject: RuleSubject }>;
  actions: Array<{ type: ActionType; label: string; subjects: RuleSubject[] }>;
  operators: readonly string[];
  subjects: readonly string[];
  templates: Array<{
    templateId: string;
    name: string;
    description: string;
    subject: RuleSubject;
    triggerType: TriggerType;
    conditions: RuleConditions;
    actions: ActionType[];
    settings: RuleSettings;
  }>;
} {
  const triggers = ALL_TRIGGERS.map((t) => ({
    type: t,
    label: TRIGGER_LABELS[t],
    subject: (LEAD_TRIGGERS as readonly string[]).includes(t) ? ("lead" as const) : ("project" as const),
  }));

  const actions = (Object.keys(ACTION_LABELS) as ActionType[]).map((a) => ({
    type: a,
    label: ACTION_LABELS[a],
    subjects: [
      ...(ACTIONS_FOR.lead.includes(a) ? (["lead"] as RuleSubject[]) : []),
      ...(ACTIONS_FOR.project.includes(a) ? (["project"] as RuleSubject[]) : []),
    ],
  }));

  const templates = [
    {
      templateId: "tpl_response",
      name: "New lead response reminder",
      description: "Assigned lead with no recorded contact attempt after the set time.",
      subject: "lead" as const,
      triggerType: "lead_assigned" as const,
      conditions: { assigned: "assigned" as const, firstContactPending: true, minCreatedMinutes: 30, stages: ["new"] },
      actions: ["reminder" as const, "flag" as const, "notify" as const],
      settings: { cooldownHours: 24, escalateOwnerAfterMinutes: 120 },
    },
    {
      templateId: "tpl_overdue",
      name: "Overdue follow-up escalation",
      description: "A scheduled follow-up is overdue. Never marks it complete.",
      subject: "lead" as const,
      triggerType: "followup_overdue" as const,
      conditions: { followupStatus: "overdue" as const },
      actions: ["reminder" as const, "notify" as const],
      settings: { overdueMinutes: 15, cooldownHours: 24, escalateOwnerAfterMinutes: 240 },
    },
    {
      templateId: "tpl_hot",
      name: "Hot lead protection",
      description: "Hot lead with no recent recorded activity. Priority is never changed.",
      subject: "lead" as const,
      triggerType: "inactivity" as const,
      conditions: { priorities: ["hot"], minInactiveHours: 48 },
      actions: ["reminder" as const, "flag" as const],
      settings: { cooldownHours: 48 },
    },
    {
      templateId: "tpl_stale",
      name: "Stale pipeline warning",
      description: "Lead has stayed in one stage too long — added to the review queue.",
      subject: "lead" as const,
      triggerType: "stage_changed" as const,
      conditions: { stages: ["contacted", "qualified", "proposal"], minStageDays: 7 },
      actions: ["reminder" as const, "flag" as const, "owner_review" as const],
      settings: { cooldownHours: 168 },
    },
    {
      templateId: "tpl_assigned",
      name: "Newly assigned leads",
      description: "One summary reminder per employee for leads assigned recently.",
      subject: "lead" as const,
      triggerType: "lead_assigned" as const,
      conditions: { assigned: "assigned" as const },
      actions: ["reminder" as const],
      settings: { cooldownHours: 24, windowHours: 24 },
    },
    {
      templateId: "tpl_won",
      name: "Won deal handoff",
      description: "Offer a project handoff checklist when a deal is won. The sales record is unchanged.",
      subject: "lead" as const,
      triggerType: "deal_won" as const,
      conditions: { stages: ["won"] },
      actions: ["reminder" as const, "owner_review" as const],
      settings: { cooldownHours: 24 * 365 },
    },
    {
      templateId: "ptpl_overdue_task",
      name: "Overdue project task",
      description: "A project task is past its due date. The task is never changed.",
      subject: "project" as const,
      triggerType: "task_overdue" as const,
      conditions: {},
      actions: ["reminder" as const, "flag" as const],
      settings: { cooldownHours: 24 },
    },
    {
      templateId: "ptpl_due_soon",
      name: "Delivery date approaching",
      description: "Target delivery is within the set days and the project is not delivered.",
      subject: "project" as const,
      triggerType: "project_due_soon" as const,
      conditions: {},
      actions: ["reminder" as const, "owner_review" as const],
      settings: { cooldownHours: 72, withinDays: 3 },
    },
    {
      templateId: "ptpl_waiting_content",
      name: "Waiting on client content",
      description: "Project is awaiting content — remind owner to follow up.",
      subject: "project" as const,
      triggerType: "project_stage_changed" as const,
      conditions: { custom: [{ id: "c_stage", field: "p.stage", op: "is" as const, value: "awaiting_content" }] },
      actions: ["reminder" as const],
      settings: { cooldownHours: 72 },
    },
    {
      templateId: "ptpl_support_ending",
      name: "Support ending soon",
      description: "The support period ends within the set days.",
      subject: "project" as const,
      triggerType: "support_ending" as const,
      conditions: {},
      actions: ["reminder" as const, "notify" as const],
      settings: { cooldownHours: 24 * 7, withinDays: 14 },
    },
    {
      templateId: "ptpl_support_request",
      name: "New support request",
      description: "A support request was opened — remind the owner.",
      subject: "project" as const,
      triggerType: "support_created" as const,
      conditions: {},
      actions: ["reminder" as const],
      settings: { cooldownHours: 24 },
    },
    {
      templateId: "ptpl_delivered",
      name: "Delivered — check handover",
      description: "A project was delivered. Suggests a handover check task.",
      subject: "project" as const,
      triggerType: "project_delivered" as const,
      conditions: {},
      actions: ["reminder" as const, "task" as const],
      settings: { cooldownHours: 24 * 365, taskTitle: "Confirm handover and support details with client" },
    },
  ];

  return {
    triggers,
    actions,
    operators: CUSTOM_CONDITION_OPERATORS,
    subjects: ["lead", "project"],
    templates,
  };
}
