import "@tanstack/react-start/server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmCallLogs, crmLeadActivities, crmLeads } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { toIstParts } from "./dates.server";
import { hydrateLeadRelations } from "./customFieldsSupport.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  toCallLogDto,
  toLeadActivityDto,
  toLeadDto,
  type CallLogDto,
  type CallLogRow,
  type CallLogWithLeadDto,
  type LeadActivityDto,
  type LeadActivityRow,
  type LeadDto,
  type LeadRow,
} from "./mappers.server";
import {
  isConnectedCallOutcome,
  needsCallStageConfirmation,
  resolveOutcomeStage,
  resolveQuickStatusAfterCall,
  type CreateCallLogInput,
  type LeadLifecycleStatus,
  type LeadPriority,
  type LeadStatus,
  type ListCallsQuery,
  type ListLeadCallsQuery,
  type QuickStatus,
} from "./validation.server";

export interface CallLogSummary {
  total: number;
  connected: number;
  attempts: number;
}

async function assertLeadAffectedRow(
  resultPromise: Promise<unknown>,
  leadId: string,
): Promise<void> {
  const res = (await resultPromise) as
    [{ affectedRows?: number }, unknown] | { affectedRows?: number };
  const affectedRows = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
  if (affectedRows !== 1) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Lead was modified concurrently; reload and retry.",
      { conflict: { resource: "lead", id: leadId } },
    );
  }
}

export async function createCallLogRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateCallLogInput,
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
    call: CallLogDto;
    lead: LeadDto;
    activities: LeadActivityDto[];
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? input.opId ?? null;
  const scope = `call:create:${input.leadId}`;
  const requestHash = hashIdempotentRequest(scope, {
    leadId: input.leadId,
    outcome: input.outcome,
    notes: input.notes ?? null,
    stage: input.stage ?? null,
    confirmed: input.confirmed,
    lostReason: input.lostReason ?? null,
    dialSource: input.dialSource,
    expectedLeadVersion: input.expectedLeadVersion ?? null,
    opId: input.opId ?? null,
  });

  try {
    return await runWithIdempotency<{
      ok: true;
      call: CallLogDto;
      lead: LeadDto;
      activities: LeadActivityDto[];
    }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
      if (input.opId) {
        const existingByOp = await tx
          .select()
          .from(crmCallLogs)
          .where(and(eq(crmCallLogs.ownerUserId, ownerUserId), eq(crmCallLogs.opId, input.opId)))
          .limit(1);
        if (existingByOp[0]) {
          throw new CrmServiceError(
            409,
            "call_op_conflict",
            "Operation ID already exists for another call log.",
            { conflict: { existingCall: toCallLogDto(existingByOp[0]) } },
          );
        }
      }

      const leadRows = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const current = leadRows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Lead not found.");
      }
      if (current.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot log a call for an archived lead. Restore it first.",
          { conflict: { lifecycleStatus: current.lifecycleStatus } },
        );
      }
      if (
        input.expectedLeadVersion !== undefined &&
        current.version !== input.expectedLeadVersion
      ) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Lead was modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "lead",
              id: current.id,
              expectedVersion: input.expectedLeadVersion,
              currentVersion: current.version,
            },
          },
        );
      }

      const stageBefore = current.status as LeadStatus;
      const stageAfter = input.stage ?? resolveOutcomeStage(input.outcome, stageBefore);

      if (needsCallStageConfirmation(stageAfter, stageBefore) && !input.confirmed) {
        throw new CrmServiceError(400, "validation_error", "Confirm the stage change", {
          details: { confirmed: "Confirm the stage change" },
        });
      }

      let nextLostReason: string | null;
      if (stageAfter !== "lost") {
        nextLostReason = null;
      } else if (stageBefore !== "lost") {
        const cleanedReason = input.lostReason?.trim();
        if (!cleanedReason) {
          throw new CrmServiceError(400, "validation_error", "Add a lost reason", {
            details: { lostReason: "Add a lost reason" },
          });
        }
        nextLostReason = cleanedReason;
      } else {
        const cleanedReason = input.lostReason?.trim() || current.lostReason?.trim() || null;
        if (!cleanedReason) {
          throw new CrmServiceError(400, "validation_error", "Add a lost reason", {
            details: { lostReason: "Add a lost reason" },
          });
        }
        nextLostReason = cleanedReason;
      }

      const connected = isConnectedCallOutcome(input.outcome);
      const quickBefore = (current.quickStatus as QuickStatus | null) ?? null;
      const quickResolution = resolveQuickStatusAfterCall(input.outcome, quickBefore);
      const quickAfter = quickResolution.set ? quickResolution.value : quickBefore;

      const nowStr = toMysqlUtcDateTime(now);
      const ist = toIstParts(now);
      const nextVersion = current.version + 1;
      // Honesty rule: "Not picked" and "Busy" are attempts only and never fabricate contact.
      const nextLastContactAt = connected ? nowStr : current.lastContactAt;

      const updRes = await tx
        .update(crmLeads)
        .set({
          status: stageAfter,
          lostReason: nextLostReason,
          quickStatus: quickAfter,
          lastContactAt: nextLastContactAt,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmLeads.id, current.id),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.version, current.version),
          ),
        );
      await assertLeadAffectedRow(Promise.resolve(updRes), current.id);

      // Internal hook strictly used in live MariaDB transaction rollback tests; never exposed over HTTP.
      options?.hooks?.afterPrimaryWrite?.();

      const cleanNotes = input.notes?.trim() || null;
      const callActId = generateServerId("act");
      const callActivityRow: LeadActivityRow = {
        id: callActId,
        legacyId: null,
        ownerUserId,
        leadId: current.id,
        actorUserId,
        type: "call",
        text: `${connected ? "Call" : "Call attempt"} (${input.dialSource}): ${input.outcome}${cleanNotes ? ` — ${cleanNotes}` : ""}`,
        outcome: input.outcome,
        opId: input.opId ?? null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };

      const activityRows: LeadActivityRow[] = [callActivityRow];
      if (stageAfter !== stageBefore) {
        activityRows.push({
          id: generateServerId("act"),
          legacyId: null,
          ownerUserId,
          leadId: current.id,
          actorUserId,
          type: "status",
          text: `Status changed to ${stageAfter}`,
          outcome: null,
          opId: input.opId ?? null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      await tx.insert(crmLeadActivities).values(activityRows);

      const callRow: CallLogRow = {
        id: generateServerId("call"),
        legacyId: null,
        ownerUserId,
        leadId: current.id,
        actorUserId,
        outcome: input.outcome,
        connected,
        recordingSource: "user_recorded",
        notes: cleanNotes,
        dialSource: input.dialSource,
        stageBefore,
        stageAfter,
        quickStatusBefore: quickBefore,
        quickStatusAfter: quickAfter,
        leadActivityId: callActId,
        opId: input.opId ?? null,
        idempotencyKey: idemKey,
        occurredAt: nowStr,
        occurredIstDate: ist.istDate,
        occurredIstTime: ist.istTime,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmCallLogs).values(callRow);

      const relations = await hydrateLeadRelations(tx, ownerUserId, [current.id]);
      const updatedLeadRow: LeadRow = {
        ...current,
        status: stageAfter,
        lostReason: nextLostReason,
        quickStatus: quickAfter,
        lastContactAt: nextLastContactAt,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 201,
        resourceId: callRow.id,
        body: {
          ok: true,
          call: toCallLogDto(callRow),
          lead: toLeadDto(updatedLeadRow, relations.get(current.id)),
          activities: activityRows.map(toLeadActivityDto),
        },
      };
    });
  } catch (error) {
    if (error instanceof CrmServiceError) throw error;
    if (isMysqlDuplicateKeyError(error)) {
      throw new CrmServiceError(
        409,
        "call_conflict",
        "A matching call log operation or idempotency key already exists.",
      );
    }
    throw error;
  }
}

export async function listCallLogs(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListCallsQuery,
): Promise<{
  items: CallLogWithLeadDto[];
  total: number;
  limit: number;
  offset: number;
  summary: CallLogSummary;
}> {
  const basePredicates: SQL[] = [eq(crmCallLogs.ownerUserId, ownerUserId)];
  if (query.leadId) {
    basePredicates.push(eq(crmCallLogs.leadId, query.leadId));
  }
  if (query.outcome !== "all") {
    basePredicates.push(eq(crmCallLogs.outcome, query.outcome));
  }
  if (query.dateIst) {
    basePredicates.push(eq(crmCallLogs.occurredIstDate, query.dateIst));
  }
  if (query.leadLifecycle !== "all") {
    basePredicates.push(eq(crmLeads.lifecycleStatus, query.leadLifecycle));
  }

  const baseWhere = and(...basePredicates);
  const summaryRows = await db
    .select({
      total: sql<number>`COUNT(*)`,
      connected: sql<number>`SUM(CASE WHEN ${crmCallLogs.connected} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(crmCallLogs)
    .innerJoin(crmLeads, eq(crmCallLogs.leadId, crmLeads.id))
    .where(baseWhere);

  const sumTotal = Number(summaryRows[0]?.total ?? 0);
  const sumConnected = Number(summaryRows[0]?.connected ?? 0);
  const sumAttempts = Math.max(0, sumTotal - sumConnected);
  const summary: CallLogSummary = {
    total: sumTotal,
    connected: sumConnected,
    attempts: sumAttempts,
  };

  const listPredicates = [...basePredicates];
  if (query.connected === "true") {
    listPredicates.push(eq(crmCallLogs.connected, true));
  } else if (query.connected === "false") {
    listPredicates.push(eq(crmCallLogs.connected, false));
  }

  const total =
    query.connected === "all" ? sumTotal : query.connected === "true" ? sumConnected : sumAttempts;

  const rows =
    total === 0
      ? []
      : await db
          .select({
            call: crmCallLogs,
            lead: {
              id: crmLeads.id,
              name: crmLeads.name,
              phone: crmLeads.phone,
              company: crmLeads.company,
              status: crmLeads.status,
              priority: crmLeads.priority,
              lifecycleStatus: crmLeads.lifecycleStatus,
            },
          })
          .from(crmCallLogs)
          .innerJoin(crmLeads, eq(crmCallLogs.leadId, crmLeads.id))
          .where(and(...listPredicates))
          .orderBy(desc(crmCallLogs.occurredAt), desc(crmCallLogs.createdAt), desc(crmCallLogs.id))
          .limit(query.limit)
          .offset(query.offset);

  const items: CallLogWithLeadDto[] = rows.map((r) => ({
    ...toCallLogDto(r.call),
    lead: {
      id: r.lead.id,
      name: r.lead.name,
      phone: r.lead.phone,
      ...(r.lead.company ? { company: r.lead.company } : {}),
      status: r.lead.status as LeadStatus,
      priority: r.lead.priority as LeadPriority,
      lifecycleStatus: r.lead.lifecycleStatus as LeadLifecycleStatus,
    },
  }));

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
    summary,
  };
}

export async function listCallLogsForLead(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  query: ListLeadCallsQuery,
): Promise<{
  leadId: string;
  items: CallLogDto[];
  total: number;
  limit: number;
  offset: number;
  summary: CallLogSummary;
}> {
  const leadRows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
    .limit(1);

  if (!leadRows[0]) {
    throw new CrmServiceError(404, "not_found", "Lead not found.");
  }

  const basePredicates: SQL[] = [
    eq(crmCallLogs.ownerUserId, ownerUserId),
    eq(crmCallLogs.leadId, leadId),
  ];
  if (query.outcome !== "all") {
    basePredicates.push(eq(crmCallLogs.outcome, query.outcome));
  }

  const summaryRows = await db
    .select({
      total: sql<number>`COUNT(*)`,
      connected: sql<number>`SUM(CASE WHEN ${crmCallLogs.connected} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(crmCallLogs)
    .where(and(...basePredicates));

  const sumTotal = Number(summaryRows[0]?.total ?? 0);
  const sumConnected = Number(summaryRows[0]?.connected ?? 0);
  const sumAttempts = Math.max(0, sumTotal - sumConnected);
  const summary: CallLogSummary = {
    total: sumTotal,
    connected: sumConnected,
    attempts: sumAttempts,
  };

  const listPredicates = [...basePredicates];
  if (query.connected === "true") {
    listPredicates.push(eq(crmCallLogs.connected, true));
  } else if (query.connected === "false") {
    listPredicates.push(eq(crmCallLogs.connected, false));
  }

  const total =
    query.connected === "all" ? sumTotal : query.connected === "true" ? sumConnected : sumAttempts;

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmCallLogs)
          .where(and(...listPredicates))
          .orderBy(desc(crmCallLogs.occurredAt), desc(crmCallLogs.createdAt), desc(crmCallLogs.id))
          .limit(query.limit)
          .offset(query.offset);

  return {
    leadId,
    items: rows.map(toCallLogDto),
    total,
    limit: query.limit,
    offset: query.offset,
    summary,
  };
}

export async function getCallLogRecord(
  db: CrmDatabase,
  ownerUserId: string,
  callId: string,
): Promise<CallLogDto> {
  const rows = await db
    .select()
    .from(crmCallLogs)
    .where(and(eq(crmCallLogs.id, callId), eq(crmCallLogs.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Call log not found.");
  }
  return toCallLogDto(row);
}
