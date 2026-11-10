import "@tanstack/react-start/server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { decimalStringToPaise, paiseToRupees, sumPaise } from "../db/money.server";
import {
  crmCallLogs,
  crmDeals,
  crmFollowUps,
  crmLeadActivities,
  crmLeads,
  crmPayments,
  crmProjectAuditEvents,
  crmProjects,
  crmQuotations,
  crmSalesGoalRevisions,
  crmSalesGoals,
  crmWhatsAppLogs,
} from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { getIstDay, getIstUtcRange, type DateWindow } from "./analyticsCalc.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import {
  calculateGoalProgress,
  definitionOn,
  GOAL_METRIC_MAP,
  resolveGoalWindow,
  type GoalDefinitionSnapshot,
  type GoalMeasurement,
  type GoalMetricKey,
  type GoalPeriod,
  type GoalProgressResult,
  type GoalRevisionSnapshotEntry,
  type GoalScope,
  type GoalStatus,
  type GoalTargetUnit,
} from "./goalsCalc.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  parseGoalTargetForMetric,
  type ArchiveGoalInput,
  type ChangeGoalStatusInput,
  type CreateGoalInput,
  type GoalProgressQuery,
  type ListGoalRevisionsQuery,
  type ListGoalsQuery,
  type UpdateGoalInput,
} from "./settingsGoalsValidation.server";

export type SalesGoalRow = typeof crmSalesGoals.$inferSelect;
export type SalesGoalRevisionRow = typeof crmSalesGoalRevisions.$inferSelect;

export interface SalesGoalDto {
  id: string;
  legacyId: string | null;
  ownerUserId: string;
  name: string;
  metric: GoalMetricKey;
  metricLabel: string;
  scope: GoalScope;
  targetUnit: GoalTargetUnit;
  target: number | null;
  targetDecimal: string | null;
  targetCount: number | null;
  targetAmount: string | null;
  period: GoalPeriod;
  customFromIst: string | null;
  customToIst: string | null;
  effectiveFromIst: string;
  status: GoalStatus;
  archivedAt: string | null;
  archiveReason: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalesGoalRevisionDto {
  id: string;
  goalId: string;
  ownerUserId: string;
  actorUserId: string;
  revisionNumber: number;
  eventType: string;
  effectiveFromIst: string;
  snapshot: GoalDefinitionSnapshot;
  changeSummary: string;
  occurredIstDate: string;
  createdAt: string;
}

function rowToDefinitionSnapshot(row: SalesGoalRow): GoalDefinitionSnapshot {
  return {
    name: row.name,
    metric: row.metric as GoalMetricKey,
    scope: row.scope as GoalScope,
    targetUnit: row.targetUnit as GoalTargetUnit,
    targetCount: row.targetCount ?? null,
    targetAmount: row.targetAmount ?? null,
    period: row.period as GoalPeriod,
    customFromIst: row.customFromIst ?? null,
    customToIst: row.customToIst ?? null,
    effectiveFromIst: row.effectiveFromIst,
    status: row.status as GoalStatus,
    version: row.version,
  };
}

function toGoalDto(row: SalesGoalRow): SalesGoalDto {
  const metric = row.metric as GoalMetricKey;
  const def = GOAL_METRIC_MAP[metric];
  const targetUnit = row.targetUnit as GoalTargetUnit;
  const targetAmount = row.targetAmount ?? null;
  const targetCount = row.targetCount ?? null;
  const target =
    targetUnit === "count"
      ? targetCount
      : targetAmount !== null
        ? paiseToRupees(decimalStringToPaise(targetAmount))
        : null;

  return {
    id: row.id,
    legacyId: row.legacyId ?? null,
    ownerUserId: row.ownerUserId,
    name: row.name,
    metric,
    metricLabel: def ? def.label : metric,
    scope: row.scope as GoalScope,
    targetUnit,
    target,
    targetDecimal: targetUnit === "inr" ? targetAmount : null,
    targetCount,
    targetAmount,
    period: row.period as GoalPeriod,
    customFromIst: row.customFromIst ?? null,
    customToIst: row.customToIst ?? null,
    effectiveFromIst: row.effectiveFromIst,
    status: row.status as GoalStatus,
    archivedAt: row.archivedAt ? parseUtcDateTime(row.archivedAt).toISOString() : null,
    archiveReason: row.archiveReason ?? null,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    version: row.version,
    createdAt: parseUtcDateTime(row.createdAt).toISOString(),
    updatedAt: parseUtcDateTime(row.updatedAt).toISOString(),
  };
}

function toGoalRevisionDto(row: SalesGoalRevisionRow): SalesGoalRevisionDto {
  const snapshot = JSON.parse(row.snapshotJson) as GoalDefinitionSnapshot;
  return {
    id: row.id,
    goalId: row.goalId,
    ownerUserId: row.ownerUserId,
    actorUserId: row.actorUserId,
    revisionNumber: row.revisionNumber,
    eventType: row.eventType,
    effectiveFromIst: row.effectiveFromIst,
    snapshot,
    changeSummary: row.changeSummary,
    occurredIstDate: row.occurredIstDate,
    createdAt: parseUtcDateTime(row.createdAt).toISOString(),
  };
}

async function assertGoalAffectedRow(
  resultPromise: Promise<unknown>,
  goalId: string,
): Promise<void> {
  const res = (await resultPromise) as
    [{ affectedRows?: number }, unknown] | { affectedRows?: number };
  const affectedRows = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
  if (affectedRows !== 1) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Goal was modified concurrently; reload and retry.",
      { conflict: { resource: "goal", id: goalId } },
    );
  }
}

export async function createGoalRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateGoalInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const scope = "goal:create";
  const requestHash = hashIdempotentRequest(scope, {
    name: input.name,
    metric: input.metric,
    scope: input.scope,
    period: input.period,
    targetCount: input.parsedTarget.targetCount,
    targetAmount: input.parsedTarget.targetAmount,
    customFromIst: input.customFromIst ?? null,
    customToIst: input.customToIst ?? null,
    effectiveFromIst: input.effectiveFromIst ?? null,
    legacyId: input.legacyId ?? null,
  });

  try {
    return await runWithIdempotency(
      db,
      { ownerUserId, scope, idemKey, requestHash, now },
      async (tx) => {
        const nowStr = toMysqlUtcDateTime(now);
        const ist = toIstParts(now);
        const effectiveFromIst = input.effectiveFromIst ?? ist.istDate;
        const goalId = generateServerId("goal");

        const goalRow: SalesGoalRow = {
          id: goalId,
          legacyId: input.legacyId ?? null,
          ownerUserId,
          name: input.name,
          metric: input.metric,
          scope: input.scope,
          targetUnit: input.parsedTarget.targetUnit,
          targetCount: input.parsedTarget.targetCount,
          targetAmount: input.parsedTarget.targetAmount,
          period: input.period,
          customFromIst: input.period === "custom" ? (input.customFromIst ?? null) : null,
          customToIst: input.period === "custom" ? (input.customToIst ?? null) : null,
          effectiveFromIst,
          status: "active",
          archivedAt: null,
          archiveReason: null,
          idempotencyKey: idemKey,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          version: 1,
          createdAt: nowStr,
          updatedAt: nowStr,
        };

        await tx.insert(crmSalesGoals).values(goalRow);

        // Internal hook for live MariaDB rollback verification tests.
        options?.hooks?.afterPrimaryWrite?.();

        const snapshot = rowToDefinitionSnapshot(goalRow);
        const revRow: SalesGoalRevisionRow = {
          id: generateServerId("grev"),
          goalId,
          ownerUserId,
          actorUserId,
          revisionNumber: 1,
          eventType: "goal.created",
          effectiveFromIst,
          snapshotJson: JSON.stringify(snapshot),
          changeSummary: `Created ${input.period} ${input.metric} goal (${input.name})`,
          occurredIstDate: ist.istDate,
          createdAt: nowStr,
        };
        await tx.insert(crmSalesGoalRevisions).values(revRow);

        return {
          status: 201,
          resourceId: goalId,
          body: {
            ok: true as const,
            goal: toGoalDto(goalRow),
            revision: toGoalRevisionDto(revRow),
          },
        };
      },
    );
  } catch (error) {
    if (error instanceof CrmServiceError) throw error;
    if (isMysqlDuplicateKeyError(error)) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "A matching goal legacyId or idempotency key already exists.",
      );
    }
    throw error;
  }
}

export async function listGoalsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListGoalsQuery,
): Promise<{
  items: SalesGoalDto[];
  total: number;
  limit: number;
  offset: number;
  configuredCount: number;
  note: string | null;
}> {
  const predicates: SQL[] = [eq(crmSalesGoals.ownerUserId, ownerUserId)];
  if (!query.includeArchived && query.status === "all") {
    predicates.push(sql`${crmSalesGoals.status} != 'archived'`);
  }
  if (query.status !== "all") {
    predicates.push(eq(crmSalesGoals.status, query.status));
  }
  if (query.metric !== "all") {
    predicates.push(eq(crmSalesGoals.metric, query.metric));
  }
  if (query.period !== "all") {
    predicates.push(eq(crmSalesGoals.period, query.period));
  }
  const whereClause = and(...predicates);

  const [countRes] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmSalesGoals)
    .where(whereClause);
  const total = Number(countRes?.count ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmSalesGoals)
          .where(whereClause)
          .orderBy(desc(crmSalesGoals.createdAt), desc(crmSalesGoals.id))
          .limit(query.limit)
          .offset(query.offset);

  const items = rows.map(toGoalDto);
  const configuredCount = items.filter((g) => g.target !== null).length;

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
    configuredCount,
    note:
      total === 0 ? "No sales goals configured yet. Unset targets remain explicitly unset." : null,
  };
}

export async function getGoalRecord(
  db: CrmDatabase,
  ownerUserId: string,
  goalId: string,
): Promise<{
  goal: SalesGoalDto;
  revisionCount: number;
}> {
  const rows = await db
    .select()
    .from(crmSalesGoals)
    .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
  }

  const [revCountRes] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmSalesGoalRevisions)
    .where(
      and(
        eq(crmSalesGoalRevisions.goalId, goalId),
        eq(crmSalesGoalRevisions.ownerUserId, ownerUserId),
      ),
    );

  return {
    goal: toGoalDto(row),
    revisionCount: Number(revCountRes?.count ?? 0),
  };
}

export async function updateGoalRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  goalId: string,
  input: UpdateGoalInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const scope = `goal:update:${goalId}`;
  const requestHash = hashIdempotentRequest(scope, {
    expectedVersion: input.expectedVersion,
    name: input.name,
    metric: input.metric,
    scope: input.scope,
    period: input.period,
    hasTargetField: input.hasTargetField,
    target: input.hasTargetField ? (input.target ?? null) : undefined,
    customFromIst: input.customFromIst,
    customToIst: input.customToIst,
    effectiveFromIst: input.effectiveFromIst,
    changeNote: input.changeNote,
  });

  return runWithIdempotency<{
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    const rows = await tx
      .select()
      .from(crmSalesGoals)
      .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
    }
    if (current.status === "archived") {
      throw new CrmServiceError(
        409,
        "goal_archived",
        "Archived goals cannot be edited; historical revisions remain auditable.",
        { conflict: { resource: "goal", id: current.id, status: current.status } },
      );
    }
    if (current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Goal was modified concurrently; reload and retry.",
        {
          conflict: {
            resource: "goal",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nextName = input.name ?? current.name;
    const nextMetric = input.metric ?? (current.metric as GoalMetricKey);
    const nextScope = input.scope ?? (current.scope as GoalScope);
    const nextPeriod = input.period ?? (current.period as GoalPeriod);
    const nextUnit = GOAL_METRIC_MAP[nextMetric].unit;

    let nextCustomFromIst: string | null;
    let nextCustomToIst: string | null;
    if (nextPeriod === "custom") {
      nextCustomFromIst =
        input.customFromIst !== undefined ? input.customFromIst : current.customFromIst;
      nextCustomToIst = input.customToIst !== undefined ? input.customToIst : current.customToIst;
      if (!nextCustomFromIst || !nextCustomToIst) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "customFromIst and customToIst are required for custom-period goals.",
        );
      }
      if (nextCustomFromIst > nextCustomToIst) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "customFromIst cannot be after customToIst.",
        );
      }
    } else {
      if (
        (input.customFromIst !== undefined && input.customFromIst !== null) ||
        (input.customToIst !== undefined && input.customToIst !== null)
      ) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "customFromIst and customToIst can only be set on custom-period goals.",
        );
      }
      nextCustomFromIst = null;
      nextCustomToIst = null;
    }

    let nextTargetCount: number | null;
    let nextTargetAmount: string | null;
    if (input.hasTargetField) {
      const parsedTarget = parseGoalTargetForMetric(nextMetric, input.target);
      nextTargetCount = parsedTarget.targetCount;
      nextTargetAmount = parsedTarget.targetAmount;
    } else if (nextUnit !== current.targetUnit) {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Provide an explicit target (or null) when switching between count and INR metrics.",
      );
    } else {
      nextTargetCount = current.targetCount ?? null;
      nextTargetAmount = current.targetAmount ?? null;
    }

    const nowStr = toMysqlUtcDateTime(now);
    const ist = toIstParts(now);

    const coreDefinitionChanged =
      nextMetric !== current.metric ||
      nextScope !== current.scope ||
      nextPeriod !== current.period ||
      nextTargetCount !== (current.targetCount ?? null) ||
      nextTargetAmount !== (current.targetAmount ?? null) ||
      nextCustomFromIst !== (current.customFromIst ?? null) ||
      nextCustomToIst !== (current.customToIst ?? null);

    const nextEffectiveFromIst =
      input.effectiveFromIst ??
      (coreDefinitionChanged && current.effectiveFromIst < ist.istDate
        ? ist.istDate
        : current.effectiveFromIst);

    const nextVersion = current.version + 1;
    const updRes = await tx
      .update(crmSalesGoals)
      .set({
        name: nextName,
        metric: nextMetric,
        scope: nextScope,
        targetUnit: nextUnit,
        targetCount: nextTargetCount,
        targetAmount: nextTargetAmount,
        period: nextPeriod,
        customFromIst: nextCustomFromIst,
        customToIst: nextCustomToIst,
        effectiveFromIst: nextEffectiveFromIst,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmSalesGoals.id, current.id),
          eq(crmSalesGoals.ownerUserId, ownerUserId),
          eq(crmSalesGoals.version, current.version),
        ),
      );
    await assertGoalAffectedRow(Promise.resolve(updRes), current.id);

    options?.hooks?.afterPrimaryWrite?.();

    const updatedRow: SalesGoalRow = {
      ...current,
      name: nextName,
      metric: nextMetric,
      scope: nextScope,
      targetUnit: nextUnit,
      targetCount: nextTargetCount,
      targetAmount: nextTargetAmount,
      period: nextPeriod,
      customFromIst: nextCustomFromIst,
      customToIst: nextCustomToIst,
      effectiveFromIst: nextEffectiveFromIst,
      updatedByUserId: actorUserId,
      version: nextVersion,
      updatedAt: nowStr,
    };

    const [maxRevRes] = await tx
      .select({ maxRev: sql<number>`COALESCE(MAX(${crmSalesGoalRevisions.revisionNumber}), 0)` })
      .from(crmSalesGoalRevisions)
      .where(eq(crmSalesGoalRevisions.goalId, current.id));
    const nextRevNumber = Number(maxRevRes?.maxRev ?? 0) + 1;

    const changedParts: string[] = [];
    if (nextName !== current.name) changedParts.push("name");
    if (nextMetric !== current.metric) changedParts.push("metric");
    if (nextScope !== current.scope) changedParts.push("scope");
    if (nextPeriod !== current.period) changedParts.push("period");
    if (
      nextTargetCount !== (current.targetCount ?? null) ||
      nextTargetAmount !== (current.targetAmount ?? null)
    ) {
      changedParts.push("target");
    }
    if (nextEffectiveFromIst !== current.effectiveFromIst) {
      changedParts.push(`effectiveFrom(${nextEffectiveFromIst})`);
    }

    const summary =
      input.changeNote?.trim() ||
      (changedParts.length > 0
        ? `Updated ${changedParts.join(", ")}`
        : `Updated goal (v${nextVersion})`);

    const revRow: SalesGoalRevisionRow = {
      id: generateServerId("grev"),
      goalId: current.id,
      ownerUserId,
      actorUserId,
      revisionNumber: nextRevNumber,
      eventType: "goal.updated",
      effectiveFromIst: nextEffectiveFromIst,
      snapshotJson: JSON.stringify(rowToDefinitionSnapshot(updatedRow)),
      changeSummary: summary.slice(0, 255),
      occurredIstDate: ist.istDate,
      createdAt: nowStr,
    };
    await tx.insert(crmSalesGoalRevisions).values(revRow);

    return {
      status: 200,
      resourceId: current.id,
      body: {
        ok: true as const,
        goal: toGoalDto(updatedRow),
        revision: toGoalRevisionDto(revRow),
      },
    };
  });
}

export async function changeGoalStatusRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  goalId: string,
  input: ChangeGoalStatusInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto | null;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const scope = `goal:status:${goalId}`;
  const requestHash = hashIdempotentRequest(scope, {
    status: input.status,
    reason: input.reason ?? null,
    expectedVersion: input.expectedVersion ?? null,
  });

  return runWithIdempotency<{
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto | null;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    const rows = await tx
      .select()
      .from(crmSalesGoals)
      .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
    }
    if (current.status === "archived") {
      throw new CrmServiceError(
        409,
        "goal_archived",
        "Archived goals cannot change status; historical goal remains auditable.",
        { conflict: { resource: "goal", id: current.id, status: current.status } },
      );
    }
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Goal was modified concurrently; reload and retry.",
        {
          conflict: {
            resource: "goal",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    if (current.status === input.status) {
      return {
        status: 200,
        resourceId: current.id,
        body: { ok: true as const, goal: toGoalDto(current), revision: null },
      };
    }

    const nowStr = toMysqlUtcDateTime(now);
    const ist = toIstParts(now);
    const nextVersion = current.version + 1;

    const updRes = await tx
      .update(crmSalesGoals)
      .set({
        status: input.status,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmSalesGoals.id, current.id),
          eq(crmSalesGoals.ownerUserId, ownerUserId),
          eq(crmSalesGoals.version, current.version),
        ),
      );
    await assertGoalAffectedRow(Promise.resolve(updRes), current.id);

    options?.hooks?.afterPrimaryWrite?.();

    const updatedRow: SalesGoalRow = {
      ...current,
      status: input.status,
      updatedByUserId: actorUserId,
      version: nextVersion,
      updatedAt: nowStr,
    };

    const [maxRevRes] = await tx
      .select({ maxRev: sql<number>`COALESCE(MAX(${crmSalesGoalRevisions.revisionNumber}), 0)` })
      .from(crmSalesGoalRevisions)
      .where(eq(crmSalesGoalRevisions.goalId, current.id));
    const nextRevNumber = Number(maxRevRes?.maxRev ?? 0) + 1;

    const revRow: SalesGoalRevisionRow = {
      id: generateServerId("grev"),
      goalId: current.id,
      ownerUserId,
      actorUserId,
      revisionNumber: nextRevNumber,
      eventType: input.status === "paused" ? "goal.paused" : "goal.resumed",
      effectiveFromIst: current.effectiveFromIst,
      snapshotJson: JSON.stringify(rowToDefinitionSnapshot(updatedRow)),
      changeSummary:
        input.reason?.trim() || `Goal status changed from ${current.status} to ${input.status}`,
      occurredIstDate: ist.istDate,
      createdAt: nowStr,
    };
    await tx.insert(crmSalesGoalRevisions).values(revRow);

    return {
      status: 200,
      resourceId: current.id,
      body: {
        ok: true as const,
        goal: toGoalDto(updatedRow),
        revision: toGoalRevisionDto(revRow),
      },
    };
  });
}

export async function archiveGoalRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  goalId: string,
  input: ArchiveGoalInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const scope = `goal:archive:${goalId}`;
  const requestHash = hashIdempotentRequest(scope, {
    reason: input.reason ?? null,
    expectedVersion: input.expectedVersion ?? null,
  });

  return runWithIdempotency<{
    ok: true;
    goal: SalesGoalDto;
    revision: SalesGoalRevisionDto;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    const rows = await tx
      .select()
      .from(crmSalesGoals)
      .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");

    const current = rows[0];
    if (!current) {
      throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
    }
    if (current.status === "archived") {
      throw new CrmServiceError(409, "goal_already_archived", "Goal is already archived.", {
        conflict: { resource: "goal", id: current.id, status: current.status },
      });
    }
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Goal was modified concurrently; reload and retry.",
        {
          conflict: {
            resource: "goal",
            id: current.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        },
      );
    }

    const nowStr = toMysqlUtcDateTime(now);
    const ist = toIstParts(now);
    const nextVersion = current.version + 1;
    const reason = input.reason?.trim() || null;

    const updRes = await tx
      .update(crmSalesGoals)
      .set({
        status: "archived",
        archivedAt: nowStr,
        archiveReason: reason,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmSalesGoals.id, current.id),
          eq(crmSalesGoals.ownerUserId, ownerUserId),
          eq(crmSalesGoals.version, current.version),
        ),
      );
    await assertGoalAffectedRow(Promise.resolve(updRes), current.id);

    options?.hooks?.afterPrimaryWrite?.();

    const updatedRow: SalesGoalRow = {
      ...current,
      status: "archived",
      archivedAt: nowStr,
      archiveReason: reason,
      updatedByUserId: actorUserId,
      version: nextVersion,
      updatedAt: nowStr,
    };

    const [maxRevRes] = await tx
      .select({ maxRev: sql<number>`COALESCE(MAX(${crmSalesGoalRevisions.revisionNumber}), 0)` })
      .from(crmSalesGoalRevisions)
      .where(eq(crmSalesGoalRevisions.goalId, current.id));
    const nextRevNumber = Number(maxRevRes?.maxRev ?? 0) + 1;

    const revRow: SalesGoalRevisionRow = {
      id: generateServerId("grev"),
      goalId: current.id,
      ownerUserId,
      actorUserId,
      revisionNumber: nextRevNumber,
      eventType: "goal.archived",
      effectiveFromIst: current.effectiveFromIst,
      snapshotJson: JSON.stringify(rowToDefinitionSnapshot(updatedRow)),
      changeSummary: reason ? `Archived goal: ${reason}`.slice(0, 255) : "Goal archived",
      occurredIstDate: ist.istDate,
      createdAt: nowStr,
    };
    await tx.insert(crmSalesGoalRevisions).values(revRow);

    return {
      status: 200,
      resourceId: current.id,
      body: {
        ok: true as const,
        goal: toGoalDto(updatedRow),
        revision: toGoalRevisionDto(revRow),
      },
    };
  });
}

export async function listGoalRevisionsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  goalId: string,
  query: ListGoalRevisionsQuery,
): Promise<{
  goalId: string;
  items: SalesGoalRevisionDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const goalRows = await db
    .select({ id: crmSalesGoals.id })
    .from(crmSalesGoals)
    .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
    .limit(1);
  if (!goalRows[0]) {
    throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
  }

  const whereClause = and(
    eq(crmSalesGoalRevisions.goalId, goalId),
    eq(crmSalesGoalRevisions.ownerUserId, ownerUserId),
  );

  const [countRes] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmSalesGoalRevisions)
    .where(whereClause);
  const total = Number(countRes?.count ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmSalesGoalRevisions)
          .where(whereClause)
          .orderBy(asc(crmSalesGoalRevisions.revisionNumber))
          .limit(query.limit)
          .offset(query.offset);

  return {
    goalId,
    items: rows.map(toGoalRevisionDto),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

// ---------------------------------------------------------------------------
// Authoritative Server Goal Measurement (Read-Only against B5C Sources)
// ---------------------------------------------------------------------------

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseProjectDeliveryDateSafe(rawJson: string | null | undefined): string | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as { date?: unknown };
    return typeof parsed.date === "string" && ISO_DAY_RE.test(parsed.date) ? parsed.date : null;
  } catch {
    return null;
  }
}

function parseProjectCompletionEventToCompleted(rawJson: string | null | undefined): boolean {
  if (!rawJson) return false;
  try {
    const parsed = JSON.parse(rawJson) as { to?: unknown };
    return parsed.to === "completed";
  } catch {
    return false;
  }
}

export async function measureGoalMetricFromDb(
  db: CrmDatabase,
  ownerUserId: string,
  metric: GoalMetricKey,
  scope: string,
  window: DateWindow,
): Promise<GoalMeasurement> {
  if (scope !== "owner" && scope !== "team") {
    return {
      measurable: false,
      reason: `Scope '${scope}' cannot be measured without Team CRM employee attribution.`,
    };
  }

  const { startUtc, endUtc } = getIstUtcRange(window);
  const startUtcSql = toMysqlUtcDateTime(startUtc);
  const endUtcSql = toMysqlUtcDateTime(endUtc);

  switch (metric) {
    case "calls_logged": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmCallLogs)
        .where(
          and(
            eq(crmCallLogs.ownerUserId, ownerUserId),
            gte(crmCallLogs.occurredAt, startUtcSql),
            lte(crmCallLogs.occurredAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "calls_connected": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmCallLogs)
        .where(
          and(
            eq(crmCallLogs.ownerUserId, ownerUserId),
            eq(crmCallLogs.connected, true),
            gte(crmCallLogs.occurredAt, startUtcSql),
            lte(crmCallLogs.occurredAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "followups_completed": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmFollowUps)
        .where(
          and(
            eq(crmFollowUps.ownerUserId, ownerUserId),
            isNull(crmFollowUps.cancelledAt),
            isNotNull(crmFollowUps.completedAt),
            gte(crmFollowUps.completedAt, startUtcSql),
            lte(crmFollowUps.completedAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "leads_created": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.lifecycleStatus, "active"),
            gte(crmLeads.createdAt, startUtcSql),
            lte(crmLeads.createdAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "leads_contacted": {
      const callLeads = await db
        .selectDistinct({ leadId: crmCallLogs.leadId })
        .from(crmCallLogs)
        .innerJoin(crmLeads, eq(crmCallLogs.leadId, crmLeads.id))
        .where(
          and(
            eq(crmCallLogs.ownerUserId, ownerUserId),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.lifecycleStatus, "active"),
            gte(crmCallLogs.occurredAt, startUtcSql),
            lte(crmCallLogs.occurredAt, endUtcSql),
          ),
        );

      const waLeads = await db
        .selectDistinct({ leadId: crmWhatsAppLogs.leadId })
        .from(crmWhatsAppLogs)
        .innerJoin(crmLeads, eq(crmWhatsAppLogs.leadId, crmLeads.id))
        .where(
          and(
            eq(crmWhatsAppLogs.ownerUserId, ownerUserId),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.lifecycleStatus, "active"),
            eq(crmWhatsAppLogs.confirmationStatus, "owner_confirmed_sent"),
            gte(crmWhatsAppLogs.confirmedAt, startUtcSql),
            lte(crmWhatsAppLogs.confirmedAt, endUtcSql),
          ),
        );

      const distinctLeadIds = new Set<string>([
        ...callLeads.map((r) => r.leadId),
        ...waLeads.map((r) => r.leadId),
      ]);
      return { measurable: true, countValue: distinctLeadIds.size };
    }

    case "leads_qualified": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmLeadActivities)
        .where(
          and(
            eq(crmLeadActivities.ownerUserId, ownerUserId),
            eq(crmLeadActivities.type, "status"),
            sql`${crmLeadActivities.text} LIKE 'Status changed to qualified%'`,
            gte(crmLeadActivities.occurredAt, startUtcSql),
            lte(crmLeadActivities.occurredAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "deals_booked":
    case "deals_booked_value": {
      const deals = await db
        .select({
          id: crmDeals.id,
          finalAmount: crmDeals.finalAmount,
          wonIstDate: crmDeals.wonIstDate,
        })
        .from(crmDeals)
        .where(and(eq(crmDeals.ownerUserId, ownerUserId), sql`${crmDeals.status} != 'cancelled'`));

      const unknownDateDeals = deals.filter((d) => !d.wonIstDate);
      const inWindowDeals = deals.filter(
        (d) => d.wonIstDate !== null && d.wonIstDate >= window.start && d.wonIstDate <= window.end,
      );

      const note =
        unknownDateDeals.length > 0
          ? `${unknownDateDeals.length} non-cancelled deal(s) without verified wonIstDate excluded.`
          : null;

      if (metric === "deals_booked") {
        return {
          measurable: true,
          countValue: inWindowDeals.length,
          excludedUnknownDateCount: unknownDateDeals.length,
          note,
        };
      }

      const paiseValue = sumPaise(inWindowDeals.map((d) => decimalStringToPaise(d.finalAmount)));
      return {
        measurable: true,
        paiseValue,
        excludedUnknownDateCount: unknownDateDeals.length,
        note,
      };
    }

    case "cash_collected": {
      const payments = await db
        .select({
          amount: crmPayments.amount,
        })
        .from(crmPayments)
        .innerJoin(crmDeals, eq(crmPayments.dealId, crmDeals.id))
        .where(
          and(
            eq(crmPayments.ownerUserId, ownerUserId),
            eq(crmDeals.ownerUserId, ownerUserId),
            eq(crmPayments.voided, false),
            sql`${crmDeals.status} != 'cancelled'`,
            gte(crmPayments.paymentIstDate, window.start),
            lte(crmPayments.paymentIstDate, window.end),
          ),
        );

      const paiseValue = sumPaise(payments.map((p) => decimalStringToPaise(p.amount)));
      return { measurable: true, paiseValue };
    }

    case "quotations_created": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmQuotations)
        .where(
          and(
            eq(crmQuotations.ownerUserId, ownerUserId),
            gte(crmQuotations.issueIstDate, window.start),
            lte(crmQuotations.issueIstDate, window.end),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "quotations_sent": {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmQuotations)
        .where(
          and(
            eq(crmQuotations.ownerUserId, ownerUserId),
            eq(crmQuotations.userConfirmedSent, true),
            gte(crmQuotations.sentAt, startUtcSql),
            lte(crmQuotations.sentAt, endUtcSql),
          ),
        );
      return { measurable: true, countValue: Number(row?.count ?? 0) };
    }

    case "projects_completed": {
      const projects = await db
        .select({
          id: crmProjects.id,
          deliveryJson: crmProjects.deliveryJson,
        })
        .from(crmProjects)
        .where(
          and(
            eq(crmProjects.ownerUserId, ownerUserId),
            eq(crmProjects.archived, false),
            eq(crmProjects.status, "completed"),
          ),
        );

      if (projects.length === 0) {
        return { measurable: true, countValue: 0, excludedUnknownDateCount: 0, note: null };
      }

      const projIds = projects.map((p) => p.id);
      const events = await db
        .select({
          projectId: crmProjectAuditEvents.projectId,
          eventType: crmProjectAuditEvents.eventType,
          detailsJson: crmProjectAuditEvents.detailsJson,
          occurredIstDate: crmProjectAuditEvents.occurredIstDate,
          createdAt: crmProjectAuditEvents.createdAt,
        })
        .from(crmProjectAuditEvents)
        .where(
          and(
            eq(crmProjectAuditEvents.ownerUserId, ownerUserId),
            inArray(crmProjectAuditEvents.projectId, projIds),
            inArray(crmProjectAuditEvents.eventType, [
              "project.delivered",
              "project.status_changed",
            ]),
          ),
        )
        .orderBy(desc(crmProjectAuditEvents.createdAt));

      const deliveredAuditDateByProject = new Map<string, string>();
      const completedStatusAuditDateByProject = new Map<string, string>();
      for (const ev of events) {
        if (
          ev.eventType === "project.delivered" &&
          !deliveredAuditDateByProject.has(ev.projectId)
        ) {
          deliveredAuditDateByProject.set(ev.projectId, ev.occurredIstDate);
        } else if (
          ev.eventType === "project.status_changed" &&
          !completedStatusAuditDateByProject.has(ev.projectId) &&
          parseProjectCompletionEventToCompleted(ev.detailsJson)
        ) {
          completedStatusAuditDateByProject.set(ev.projectId, ev.occurredIstDate);
        }
      }

      let countValue = 0;
      let excludedUnknownDateCount = 0;
      for (const p of projects) {
        const completionIstDate =
          parseProjectDeliveryDateSafe(p.deliveryJson) ??
          deliveredAuditDateByProject.get(p.id) ??
          completedStatusAuditDateByProject.get(p.id) ??
          null;

        if (!completionIstDate) {
          excludedUnknownDateCount += 1;
          continue;
        }
        if (completionIstDate >= window.start && completionIstDate <= window.end) {
          countValue += 1;
        }
      }

      return {
        measurable: true,
        countValue,
        excludedUnknownDateCount,
        note:
          excludedUnknownDateCount > 0
            ? `${excludedUnknownDateCount} completed project(s) without verified delivery or completion audit date excluded.`
            : null,
      };
    }
  }
}

async function evaluateGoalRowProgress(
  db: CrmDatabase,
  ownerUserId: string,
  row: SalesGoalRow,
  revRows: SalesGoalRevisionRow[],
  asOfIstDate: string,
): Promise<GoalProgressResult> {
  const currentSnap = rowToDefinitionSnapshot(row);
  const revisions: GoalRevisionSnapshotEntry[] = revRows.map((r) => ({
    revisionNumber: r.revisionNumber,
    effectiveFromIst: r.effectiveFromIst,
    snapshot: JSON.parse(r.snapshotJson) as GoalDefinitionSnapshot,
  }));

  const def = definitionOn(currentSnap, revisions, asOfIstDate);
  if (!def) {
    return calculateGoalProgress({
      def: null,
      goalStatus: row.status as GoalStatus,
      asOfIstDate,
      measurement: { measurable: false, reason: "Goal is not active on this date." },
      fallbackUnit: row.targetUnit as GoalTargetUnit,
    });
  }

  const resolvedWindow = resolveGoalWindow(def, asOfIstDate);
  let measurement: GoalMeasurement = {
    measurable: false,
    reason: "Goal is not actively measured in this state.",
  };

  if (row.status === "active" && resolvedWindow.window) {
    measurement = await measureGoalMetricFromDb(
      db,
      ownerUserId,
      def.metric,
      def.scope,
      resolvedWindow.window,
    );
  }

  return calculateGoalProgress({
    def,
    goalStatus: row.status as GoalStatus,
    asOfIstDate,
    measurement,
    fallbackUnit: row.targetUnit as GoalTargetUnit,
  });
}

export async function getGoalProgressRecord(
  db: CrmDatabase,
  ownerUserId: string,
  goalId: string,
  query: GoalProgressQuery,
  now: Date = new Date(),
): Promise<{
  ok: true;
  goal: SalesGoalDto;
  progress: GoalProgressResult;
}> {
  const goalRows = await db
    .select()
    .from(crmSalesGoals)
    .where(and(eq(crmSalesGoals.id, goalId), eq(crmSalesGoals.ownerUserId, ownerUserId)))
    .limit(1);

  const row = goalRows[0];
  if (!row) {
    throw new CrmServiceError(404, "goal_not_found", "Goal not found.");
  }

  const revRows = await db
    .select()
    .from(crmSalesGoalRevisions)
    .where(
      and(
        eq(crmSalesGoalRevisions.goalId, goalId),
        eq(crmSalesGoalRevisions.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(asc(crmSalesGoalRevisions.revisionNumber));

  const asOfIstDate = query.asOf ?? getIstDay(now);
  const progress = await evaluateGoalRowProgress(db, ownerUserId, row, revRows, asOfIstDate);

  return {
    ok: true as const,
    goal: toGoalDto(row),
    progress,
  };
}

export async function listActiveGoalsProgressRecord(
  db: CrmDatabase,
  ownerUserId: string,
  query: GoalProgressQuery,
  now: Date = new Date(),
): Promise<{
  ok: true;
  asOfIstDate: string;
  status: "active" | "not_configured";
  note: string | null;
  items: Array<{ goal: SalesGoalDto; progress: GoalProgressResult }>;
}> {
  const asOfIstDate = query.asOf ?? getIstDay(now);
  const goalRows = await db
    .select()
    .from(crmSalesGoals)
    .where(
      and(eq(crmSalesGoals.ownerUserId, ownerUserId), sql`${crmSalesGoals.status} != 'archived'`),
    )
    .orderBy(desc(crmSalesGoals.createdAt), desc(crmSalesGoals.id));

  if (goalRows.length === 0) {
    return {
      ok: true as const,
      asOfIstDate,
      status: "not_configured",
      note: "No sales goals configured yet. Unset targets are never fabricated.",
      items: [],
    };
  }

  const goalIds = goalRows.map((g) => g.id);
  const revRows = await db
    .select()
    .from(crmSalesGoalRevisions)
    .where(
      and(
        eq(crmSalesGoalRevisions.ownerUserId, ownerUserId),
        inArray(crmSalesGoalRevisions.goalId, goalIds),
      ),
    )
    .orderBy(asc(crmSalesGoalRevisions.revisionNumber));

  const revByGoal = new Map<string, SalesGoalRevisionRow[]>();
  for (const r of revRows) {
    const arr = revByGoal.get(r.goalId) ?? [];
    arr.push(r);
    revByGoal.set(r.goalId, arr);
  }

  const items: Array<{ goal: SalesGoalDto; progress: GoalProgressResult }> = [];
  for (const row of goalRows) {
    const progress = await evaluateGoalRowProgress(
      db,
      ownerUserId,
      row,
      revByGoal.get(row.id) ?? [],
      asOfIstDate,
    );
    items.push({ goal: toGoalDto(row), progress });
  }

  return {
    ok: true as const,
    asOfIstDate,
    status: "active",
    note: null,
    items,
  };
}
