import "@tanstack/react-start/server-only";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmFollowUps, crmLeadActivities, crmLeads } from "../db/schema.server";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { followUpBucketServer, mysqlUtcToIso, parseBusinessDateTimeToUtc } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmTransaction,
} from "./idempotency.server";
import { recomputeLeadNextFollowUpInTx } from "./leadsService.server";
import {
  toFollowUpDto,
  toLeadActivityDto,
  type FollowUpDto,
  type FollowUpRow,
  type FollowUpWithLeadDto,
  type LeadActivityDto,
} from "./mappers.server";
import type {
  CancelFollowUpInput,
  CompleteFollowUpInput,
  CreateFollowUpInput,
  FollowUpType,
  LeadLifecycleStatus,
  LeadPriority,
  LeadStatus,
  ListFollowUpsQuery,
  UpdateFollowUpInput,
} from "./validation.server";

async function assertFollowUpAffectedRow(
  resultPromise: Promise<unknown>,
  followUpId: string,
): Promise<void> {
  const res = (await resultPromise) as
    [{ affectedRows?: number }, unknown] | { affectedRows?: number };
  const affectedRows = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
  if (affectedRows !== 1) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Follow-up was modified concurrently; reload and retry.",
      { conflict: { resource: "followup", id: followUpId } },
    );
  }
}

async function lockLeadFollowUpsRow(
  tx: CrmTransaction,
  ownerUserId: string,
  followUpId: string,
): Promise<{
  followUp: FollowUpRow;
  lead: { id: string; lifecycleStatus: string; version: number; lastContactAt: string | null };
}> {
  const rows = await tx
    .select({
      followUp: crmFollowUps,
      leadId: crmLeads.id,
      leadLifecycleStatus: crmLeads.lifecycleStatus,
      leadVersion: crmLeads.version,
      leadLastContactAt: crmLeads.lastContactAt,
    })
    .from(crmFollowUps)
    .innerJoin(crmLeads, eq(crmFollowUps.leadId, crmLeads.id))
    .where(and(eq(crmFollowUps.id, followUpId), eq(crmFollowUps.ownerUserId, ownerUserId)))
    .limit(1)
    .for("update");

  const joined = rows[0];
  if (!joined) {
    throw new CrmServiceError(404, "not_found", "Follow-up not found.");
  }

  return {
    followUp: joined.followUp,
    lead: {
      id: joined.leadId,
      lifecycleStatus: joined.leadLifecycleStatus,
      version: joined.leadVersion,
      lastContactAt: joined.leadLastContactAt,
    },
  };
}

function buildFollowUpSortTimestamp(row: FollowUpRow): number {
  const iso = row.completedAt ?? row.cancelledAt ?? row.dueAt;
  const d = parseUtcDateTime(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export async function listFollowUps(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListFollowUpsQuery,
  now: Date = new Date(),
): Promise<{
  items: (FollowUpWithLeadDto & { bucket: "overdue" | "today" | "upcoming" | "done" })[];
  total: number;
  limit: number;
  offset: number;
  summary: { overdue: number; today: number; upcoming: number; done: number; pending: number };
}> {
  const predicates: SQL[] = [eq(crmFollowUps.ownerUserId, ownerUserId)];
  if (query.leadId) {
    predicates.push(eq(crmFollowUps.leadId, query.leadId));
  }
  if (query.dateIst) {
    predicates.push(eq(crmFollowUps.dueIstDate, query.dateIst));
  }
  if (query.type !== "all") {
    predicates.push(eq(crmFollowUps.type, query.type));
  }
  if (query.leadLifecycle !== "all") {
    predicates.push(eq(crmLeads.lifecycleStatus, query.leadLifecycle));
  }

  const rows = await db
    .select({
      followUp: crmFollowUps,
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
    .from(crmFollowUps)
    .innerJoin(crmLeads, eq(crmFollowUps.leadId, crmLeads.id))
    .where(and(...predicates));

  const summary = { overdue: 0, today: 0, upcoming: 0, done: 0, pending: 0 };
  const enriched = rows.map((r) => {
    const bucket = followUpBucketServer(
      {
        dueAtMysqlUtc: r.followUp.dueAt,
        dueIstDate: r.followUp.dueIstDate,
        completedAt: r.followUp.completedAt,
        cancelledAt: r.followUp.cancelledAt,
      },
      now,
    );
    summary[bucket] += 1;
    if (bucket !== "done") summary.pending += 1;

    const dto = toFollowUpDto(r.followUp);
    return {
      ...dto,
      bucket,
      lead: {
        id: r.lead.id,
        name: r.lead.name,
        phone: r.lead.phone,
        ...(r.lead.company ? { company: r.lead.company } : {}),
        status: r.lead.status as LeadStatus,
        priority: r.lead.priority as LeadPriority,
        lifecycleStatus: r.lead.lifecycleStatus as LeadLifecycleStatus,
      },
      _raw: r.followUp,
    };
  });

  const filtered = enriched.filter((item) => {
    if (query.bucket === "all") return true;
    if (query.bucket === "pending") return item.bucket !== "done";
    return item.bucket === query.bucket;
  });

  filtered.sort((a, b) => {
    if (query.bucket === "done") {
      return buildFollowUpSortTimestamp(b._raw) - buildFollowUpSortTimestamp(a._raw);
    }
    const ta = parseUtcDateTime(a._raw.dueAt).getTime();
    const tb = parseUtcDateTime(b._raw.dueAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const paged = filtered
    .slice(query.offset, query.offset + query.limit)
    .map(({ _raw, ...rest }) => rest);

  return {
    items: paged,
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
    summary,
  };
}

export async function getFollowUpRecord(
  db: CrmDatabase,
  ownerUserId: string,
  followUpId: string,
): Promise<FollowUpDto> {
  const rows = await db
    .select()
    .from(crmFollowUps)
    .where(and(eq(crmFollowUps.id, followUpId), eq(crmFollowUps.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Follow-up not found.");
  }
  return toFollowUpDto(row);
}

export async function listFollowUpsForLead(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
): Promise<{ leadId: string; items: FollowUpDto[]; activeFollowUpId: string | null }> {
  const leadRows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
    .limit(1);

  if (!leadRows[0]) {
    throw new CrmServiceError(404, "not_found", "Lead not found.");
  }

  const rows = await db
    .select()
    .from(crmFollowUps)
    .where(and(eq(crmFollowUps.ownerUserId, ownerUserId), eq(crmFollowUps.leadId, leadId)))
    .orderBy(desc(crmFollowUps.createdAt), desc(crmFollowUps.id));

  const active = rows.find((r) => r.completedAt === null && r.cancelledAt === null) ?? null;

  return {
    leadId,
    items: rows.map(toFollowUpDto),
    activeFollowUpId: active ? active.id : null,
  };
}

export async function createFollowUpRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateFollowUpInput,
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
    followUp: FollowUpDto;
    replacedFollowUpId: string | null;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto;
  };
}> {
  const parsedDue = parseBusinessDateTimeToUtc(input.dueAt);
  if (!parsedDue.ok) {
    throw new CrmServiceError(400, "validation_error", parsedDue.error, {
      details: { dueAt: parsedDue.error },
    });
  }

  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? input.opId ?? null;
  const requestHash = hashIdempotentRequest("followup:create", {
    leadId: input.leadId,
    type: input.type,
    dueAtUtc: parsedDue.value.utcIso,
    note: input.note ?? null,
    replaceActiveFollowUpId: input.replaceActiveFollowUpId ?? null,
    opId: input.opId ?? null,
  });

  try {
    return await runWithIdempotency<{
      ok: true;
      followUp: FollowUpDto;
      replacedFollowUpId: string | null;
      leadNextFollowUp: string | null;
      activity: LeadActivityDto;
    }>(db, { ownerUserId, scope: "followup:create", idemKey, requestHash, now }, async (tx) => {
      if (input.opId) {
        const existingByOp = await tx
          .select()
          .from(crmFollowUps)
          .where(and(eq(crmFollowUps.ownerUserId, ownerUserId), eq(crmFollowUps.opId, input.opId)))
          .limit(1);
        if (existingByOp[0]) {
          throw new CrmServiceError(
            409,
            "followup_conflict",
            "Operation ID already exists for another follow-up.",
            { conflict: { existingFollowUp: toFollowUpDto(existingByOp[0]) } },
          );
        }
      }

      const leadRows = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const lead = leadRows[0];
      if (!lead) {
        throw new CrmServiceError(404, "not_found", "Lead not found");
      }
      if (lead.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot schedule a follow-up for an archived lead. Restore it first.",
          { conflict: { lifecycleStatus: lead.lifecycleStatus } },
        );
      }

      const activeRows = await tx
        .select()
        .from(crmFollowUps)
        .where(
          and(
            eq(crmFollowUps.ownerUserId, ownerUserId),
            eq(crmFollowUps.leadId, input.leadId),
            isNull(crmFollowUps.completedAt),
            isNull(crmFollowUps.cancelledAt),
          ),
        )
        .limit(1)
        .for("update");

      const active = activeRows[0];
      const newFollowUpId = generateServerId("fu");
      const nowStr = toMysqlUtcDateTime(now);
      let replacedFollowUpId: string | null = null;

      if (active) {
        if (!input.replaceActiveFollowUpId) {
          throw new CrmServiceError(
            409,
            "followup_conflict",
            "This lead already has an active pending follow-up.",
            {
              conflict: {
                activeFollowUp: toFollowUpDto(active),
              },
            },
          );
        }
        if (input.replaceActiveFollowUpId !== active.id) {
          throw new CrmServiceError(
            409,
            "stale_conflict",
            "The active follow-up changed before it could be replaced.",
            {
              conflict: {
                expectedActiveFollowUpId: input.replaceActiveFollowUpId,
                currentActiveFollowUp: toFollowUpDto(active),
              },
            },
          );
        }

        // Clear `active_lead_lock` before inserting replacement so unique constraint never trips.
        const cancelRes = await tx
          .update(crmFollowUps)
          .set({
            activeLeadLock: null,
            cancelledAt: nowStr,
            cancelReason: "Replaced by newer follow-up",
            replacedById: newFollowUpId,
            updatedByUserId: actorUserId,
            version: active.version + 1,
            updatedAt: nowStr,
          })
          .where(
            and(
              eq(crmFollowUps.id, active.id),
              eq(crmFollowUps.ownerUserId, ownerUserId),
              eq(crmFollowUps.version, active.version),
            ),
          );
        await assertFollowUpAffectedRow(Promise.resolve(cancelRes), active.id);
        replacedFollowUpId = active.id;
      }

      const newRow: FollowUpRow = {
        id: newFollowUpId,
        legacyId: null,
        ownerUserId,
        leadId: input.leadId,
        activeLeadLock: input.leadId,
        type: input.type as FollowUpType,
        dueAt: parsedDue.value.mysqlUtc,
        dueIstDate: parsedDue.value.istDate,
        dueIstTime: parsedDue.value.istTime,
        note: input.note ?? null,
        completedAt: null,
        cancelledAt: null,
        cancelReason: null,
        replacedById: null,
        opId: input.opId ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };
      await tx.insert(crmFollowUps).values(newRow);

      options?.hooks?.afterPrimaryWrite?.();

      const nextDueMysql = await recomputeLeadNextFollowUpInTx(tx, ownerUserId, input.leadId);
      await tx
        .update(crmLeads)
        .set({ updatedAt: nowStr, updatedByUserId: actorUserId })
        .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.ownerUserId, ownerUserId)));

      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId: input.leadId,
        actorUserId,
        type: "followup",
        text: replacedFollowUpId
          ? `Follow-up replaced (${input.type})`
          : `Follow-up scheduled (${input.type})`,
        outcome: null,
        opId: input.opId ?? null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      return {
        status: 201,
        resourceId: newFollowUpId,
        body: {
          ok: true,
          followUp: toFollowUpDto(newRow),
          replacedFollowUpId,
          leadNextFollowUp: nextDueMysql ? parseUtcDateTime(nextDueMysql).toISOString() : null,
          activity: toLeadActivityDto(actRow),
        },
      };
    });
  } catch (error) {
    if (error instanceof CrmServiceError) throw error;
    if (isMysqlDuplicateKeyError(error)) {
      throw new CrmServiceError(
        409,
        "followup_conflict",
        "Another active follow-up already exists for this lead.",
      );
    }
    throw error;
  }
}

export async function rescheduleFollowUpRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  followUpId: string,
  input: UpdateFollowUpInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    followUp: FollowUpDto;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto | null;
  };
}> {
  const parsedDue = input.dueAt !== undefined ? parseBusinessDateTimeToUtc(input.dueAt) : null;
  if (parsedDue && !parsedDue.ok) {
    throw new CrmServiceError(400, "validation_error", parsedDue.error, {
      details: { dueAt: parsedDue.error },
    });
  }

  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`followup:update:${followUpId}`, {
    version: input.version,
    dueAtUtc: parsedDue?.ok ? parsedDue.value.utcIso : undefined,
    note: input.note,
  });

  return runWithIdempotency<{
    ok: true;
    followUp: FollowUpDto;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto | null;
  }>(
    db,
    { ownerUserId, scope: `followup:update:${followUpId}`, idemKey, requestHash, now },
    async (tx) => {
      const { followUp, lead } = await lockLeadFollowUpsRow(tx, ownerUserId, followUpId);
      if (lead.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot modify follow-up for an archived lead. Restore the lead first.",
          { conflict: { lifecycleStatus: lead.lifecycleStatus } },
        );
      }
      if (followUp.completedAt !== null || followUp.cancelledAt !== null) {
        throw new CrmServiceError(
          409,
          "followup_already_closed",
          "Follow-up is already completed or cancelled.",
        );
      }
      if (followUp.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Follow-up was modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "followup",
              id: followUp.id,
              expectedVersion: input.version,
              currentVersion: followUp.version,
            },
          },
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const nextDueMysql = parsedDue?.ok ? parsedDue.value.mysqlUtc : followUp.dueAt;
      const nextIstDate = parsedDue?.ok ? parsedDue.value.istDate : followUp.dueIstDate;
      const nextIstTime = parsedDue?.ok ? parsedDue.value.istTime : followUp.dueIstTime;
      const nextNote = input.note !== undefined ? input.note : followUp.note;
      const nextVersion = followUp.version + 1;

      const updRes = await tx
        .update(crmFollowUps)
        .set({
          dueAt: nextDueMysql,
          dueIstDate: nextIstDate,
          dueIstTime: nextIstTime,
          note: nextNote,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmFollowUps.id, followUpId),
            eq(crmFollowUps.ownerUserId, ownerUserId),
            eq(crmFollowUps.version, followUp.version),
          ),
        );
      await assertFollowUpAffectedRow(Promise.resolve(updRes), followUpId);

      const syncedDue = await recomputeLeadNextFollowUpInTx(tx, ownerUserId, followUp.leadId);
      const dueChanged = Boolean(parsedDue?.ok && nextDueMysql !== followUp.dueAt);
      const noteChanged = nextNote !== followUp.note;

      let actDto: LeadActivityDto | null = null;
      if (dueChanged || noteChanged) {
        const actRow = {
          id: generateServerId("act"),
          legacyId: null,
          ownerUserId,
          leadId: followUp.leadId,
          actorUserId,
          type: "followup",
          text: dueChanged ? "Follow-up rescheduled" : "Follow-up note updated",
          outcome: null,
          opId: null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        };
        await tx.insert(crmLeadActivities).values(actRow);
        actDto = toLeadActivityDto(actRow);
      }

      const updatedRow: FollowUpRow = {
        ...followUp,
        dueAt: nextDueMysql,
        dueIstDate: nextIstDate,
        dueIstTime: nextIstTime,
        note: nextNote,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      const nextLeadIso = syncedDue ? parseUtcDateTime(syncedDue).toISOString() : null;

      return {
        status: 200,
        resourceId: followUpId,
        body: {
          ok: true,
          followUp: toFollowUpDto(updatedRow),
          leadNextFollowUp: nextLeadIso,
          activity: actDto,
        },
      };
    },
  );
}

export async function completeFollowUpRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  followUpId: string,
  input: CompleteFollowUpInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    followUp: FollowUpDto;
    leadLastContact: string | null;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`followup:complete:${followUpId}`, {
    version: input.version,
  });

  return runWithIdempotency<{
    ok: true;
    followUp: FollowUpDto;
    leadLastContact: string | null;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto;
  }>(
    db,
    { ownerUserId, scope: `followup:complete:${followUpId}`, idemKey, requestHash, now },
    async (tx) => {
      const { followUp, lead } = await lockLeadFollowUpsRow(tx, ownerUserId, followUpId);
      if (lead.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot complete follow-up for an archived lead. Restore the lead first.",
          { conflict: { lifecycleStatus: lead.lifecycleStatus } },
        );
      }
      if (followUp.completedAt !== null || followUp.cancelledAt !== null) {
        throw new CrmServiceError(
          409,
          "followup_already_closed",
          followUp.completedAt
            ? "Follow-up has already been completed."
            : "Follow-up has already been cancelled.",
        );
      }
      if (followUp.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Follow-up was modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "followup",
              id: followUp.id,
              expectedVersion: input.version,
              currentVersion: followUp.version,
            },
          },
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = followUp.version + 1;

      const updRes = await tx
        .update(crmFollowUps)
        .set({
          activeLeadLock: null,
          completedAt: nowStr,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmFollowUps.id, followUpId),
            eq(crmFollowUps.ownerUserId, ownerUserId),
            eq(crmFollowUps.version, followUp.version),
          ),
        );
      await assertFollowUpAffectedRow(Promise.resolve(updRes), followUpId);

      // Completing a scheduled follow-up task clears/recomputes nextFollowUp without fabricating
      // a real customer contact (`lastContact` updates only on genuine saved calls/sends).
      await tx
        .update(crmLeads)
        .set({
          updatedByUserId: actorUserId,
          updatedAt: nowStr,
        })
        .where(and(eq(crmLeads.id, followUp.leadId), eq(crmLeads.ownerUserId, ownerUserId)));

      const syncedDue = await recomputeLeadNextFollowUpInTx(tx, ownerUserId, followUp.leadId);

      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId: followUp.leadId,
        actorUserId,
        type: "followup",
        text: `Follow-up completed (${followUp.type})`,
        outcome: null,
        opId: null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      const updatedRow: FollowUpRow = {
        ...followUp,
        activeLeadLock: null,
        completedAt: nowStr,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 200,
        resourceId: followUpId,
        body: {
          ok: true,
          followUp: toFollowUpDto(updatedRow),
          leadLastContact: mysqlUtcToIso(lead.lastContactAt) ?? null,
          leadNextFollowUp: syncedDue ? parseUtcDateTime(syncedDue).toISOString() : null,
          activity: toLeadActivityDto(actRow),
        },
      };
    },
  );
}

export async function cancelFollowUpRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  followUpId: string,
  input: CancelFollowUpInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: {
    ok: true;
    followUp: FollowUpDto;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`followup:cancel:${followUpId}`, {
    version: input.version,
    reason: input.reason ?? null,
  });

  return runWithIdempotency<{
    ok: true;
    followUp: FollowUpDto;
    leadNextFollowUp: string | null;
    activity: LeadActivityDto;
  }>(
    db,
    { ownerUserId, scope: `followup:cancel:${followUpId}`, idemKey, requestHash, now },
    async (tx) => {
      const { followUp, lead } = await lockLeadFollowUpsRow(tx, ownerUserId, followUpId);
      if (lead.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot cancel follow-up for an archived lead. Restore the lead first.",
          { conflict: { lifecycleStatus: lead.lifecycleStatus } },
        );
      }
      if (followUp.completedAt !== null || followUp.cancelledAt !== null) {
        throw new CrmServiceError(
          409,
          "followup_already_closed",
          followUp.completedAt
            ? "Follow-up has already been completed."
            : "Follow-up has already been cancelled.",
        );
      }
      if (followUp.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Follow-up was modified concurrently; reload and retry.",
          {
            conflict: {
              resource: "followup",
              id: followUp.id,
              expectedVersion: input.version,
              currentVersion: followUp.version,
            },
          },
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = followUp.version + 1;
      const reasonClean = input.reason?.trim() || null;

      const updRes = await tx
        .update(crmFollowUps)
        .set({
          activeLeadLock: null,
          cancelledAt: nowStr,
          cancelReason: reasonClean,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmFollowUps.id, followUpId),
            eq(crmFollowUps.ownerUserId, ownerUserId),
            eq(crmFollowUps.version, followUp.version),
          ),
        );
      await assertFollowUpAffectedRow(Promise.resolve(updRes), followUpId);

      const syncedDue = await recomputeLeadNextFollowUpInTx(tx, ownerUserId, followUp.leadId);
      await tx
        .update(crmLeads)
        .set({ updatedByUserId: actorUserId, updatedAt: nowStr })
        .where(and(eq(crmLeads.id, followUp.leadId), eq(crmLeads.ownerUserId, ownerUserId)));

      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId: followUp.leadId,
        actorUserId,
        type: "followup",
        text: reasonClean ? `Follow-up cancelled: ${reasonClean}` : "Follow-up cancelled",
        outcome: null,
        opId: null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      const updatedRow: FollowUpRow = {
        ...followUp,
        activeLeadLock: null,
        cancelledAt: nowStr,
        cancelReason: reasonClean,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 200,
        resourceId: followUpId,
        body: {
          ok: true,
          followUp: toFollowUpDto(updatedRow),
          leadNextFollowUp: syncedDue ? parseUtcDateTime(syncedDue).toISOString() : null,
          activity: toLeadActivityDto(actRow),
        },
      };
    },
  );
}
