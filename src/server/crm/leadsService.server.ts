import "@tanstack/react-start/server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmFollowUps, crmLeadActivities, crmLeads, crmLeadTags } from "../db/schema.server";
import { paiseToDecimalString, rupeesToPaise } from "../db/money.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { DAY_MS, istDayBoundsUtc, toIstParts } from "./dates.server";
import {
  hydrateLeadRelations,
  syncLeadFieldValuesInTx,
  syncLeadTagsInTx,
} from "./customFieldsSupport.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmTransaction,
} from "./idempotency.server";
import {
  toLeadActivityDto,
  toLeadDto,
  type LeadActivityDto,
  type LeadActivityRow,
  type LeadDto,
  type LeadRow,
} from "./mappers.server";
import {
  buildLeadEditSummary,
  extractLeadPhoneKey,
  LEAD_STATUSES,
  normalizeLeadEmail,
  QUICK_LABEL,
  type CreateLeadInput,
  type LeadLifecycleStatus,
  type ListLeadsQuery,
  type UpdateLeadInput,
} from "./validation.server";

export interface DuplicateConflictMatch {
  id: string;
  name: string;
  phone: string;
  email?: string;
  status: string;
  lifecycleStatus: string;
  matchReasons: ("phone" | "email")[];
}

function escapeSqlLike(term: string): string {
  return term.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

async function findActiveLeadDuplicatesInTx(
  tx: CrmTransaction,
  ownerUserId: string,
  params: {
    phoneKey: string;
    emailNormalized: string | null;
    excludeLeadId?: string | undefined;
  },
): Promise<DuplicateConflictMatch[]> {
  const matchConditions: SQL[] = [eq(crmLeads.phoneKey, params.phoneKey)];
  if (params.emailNormalized) {
    matchConditions.push(eq(crmLeads.emailNormalized, params.emailNormalized));
  }

  const predicates: SQL[] = [
    eq(crmLeads.ownerUserId, ownerUserId),
    eq(crmLeads.lifecycleStatus, "active"),
    matchConditions.length === 1 ? matchConditions[0]! : or(...matchConditions)!,
  ];
  if (params.excludeLeadId) {
    predicates.push(ne(crmLeads.id, params.excludeLeadId));
  }

  const rows = await tx
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      phone: crmLeads.phone,
      email: crmLeads.email,
      emailNormalized: crmLeads.emailNormalized,
      status: crmLeads.status,
      lifecycleStatus: crmLeads.lifecycleStatus,
      phoneKey: crmLeads.phoneKey,
    })
    .from(crmLeads)
    .where(and(...predicates))
    .for("update");

  return rows.map((row) => {
    const reasons: ("phone" | "email")[] = [];
    if (row.phoneKey === params.phoneKey) reasons.push("phone");
    if (params.emailNormalized && row.emailNormalized === params.emailNormalized) {
      reasons.push("email");
    }
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      ...(row.email ? { email: row.email } : {}),
      status: row.status,
      lifecycleStatus: row.lifecycleStatus,
      matchReasons: reasons,
    };
  });
}

function throwDuplicateLeadConflict(message: string, matches: DuplicateConflictMatch[]): never {
  const reasonSet = new Set<"phone" | "email">();
  for (const m of matches) {
    for (const r of m.matchReasons) reasonSet.add(r);
  }
  throw new CrmServiceError(409, "duplicate_lead", message, {
    conflict: {
      matchReasons: [...reasonSet],
      matches,
    },
  });
}

async function assertAffectedRow(
  resultPromise: Promise<unknown>,
  resourceId: string,
): Promise<void> {
  const res = (await resultPromise) as
    [{ affectedRows?: number }, unknown] | { affectedRows?: number };
  const affectedRows = Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows;
  if (affectedRows !== 1) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Lead record changed concurrently; reload and retry.",
      {
        conflict: { resource: "lead", id: resourceId },
      },
    );
  }
}

export async function recomputeLeadNextFollowUpInTx(
  tx: CrmTransaction,
  ownerUserId: string,
  leadId: string,
): Promise<string | null> {
  const pendingRows = await tx
    .select({ dueAt: crmFollowUps.dueAt })
    .from(crmFollowUps)
    .where(
      and(
        eq(crmFollowUps.ownerUserId, ownerUserId),
        eq(crmFollowUps.leadId, leadId),
        isNull(crmFollowUps.completedAt),
        isNull(crmFollowUps.cancelledAt),
      ),
    )
    .orderBy(asc(crmFollowUps.dueAt))
    .limit(1);

  const nextDue = pendingRows[0]?.dueAt ?? null;
  await tx
    .update(crmLeads)
    .set({ nextFollowUpAt: nextDue })
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)));
  return nextDue;
}

export async function createLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateLeadInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; lead: LeadDto; activity: LeadActivityDto };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? null;
  const { idempotencyKey: _ignoredKey, ...hashableInput } = input;
  const requestHash = hashIdempotentRequest("lead:create", hashableInput);

  const res = await runWithIdempotency<{ ok: true; lead: LeadDto; activity: LeadActivityDto }>(
    db,
    { ownerUserId, scope: "lead:create", idemKey, requestHash, now },
    async (tx) => {
      const phoneKey = extractLeadPhoneKey(input.phone);
      const emailNormalized = input.email ? normalizeLeadEmail(input.email) : null;

      const duplicates = await findActiveLeadDuplicatesInTx(tx, ownerUserId, {
        phoneKey,
        emailNormalized,
      });
      if (duplicates.length > 0 && !input.allowDuplicate) {
        throwDuplicateLeadConflict(
          "An active lead already matches this phone number or email.",
          duplicates,
        );
      }

      const leadId = generateServerId("lead");
      const nowStr = toMysqlUtcDateTime(now);
      const quotedDecimal =
        input.quotedAmount !== undefined
          ? paiseToDecimalString(rupeesToPaise(input.quotedAmount))
          : null;
      const budgetDecimal =
        input.budget !== undefined ? paiseToDecimalString(rupeesToPaise(input.budget)) : null;

      const newLeadRow = {
        id: leadId,
        legacyId: null,
        ownerUserId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        phoneKey,
        email: input.email ?? null,
        emailNormalized,
        company: input.company ?? null,
        requirement: input.requirement ?? null,
        source: input.source,
        status: input.status,
        priority: input.priority,
        aiScore: input.aiScore ?? null,
        quotedAmount: quotedDecimal,
        budget: budgetDecimal,
        lastContactAt: null,
        nextFollowUpAt: null,
        notes: input.notes ?? null,
        pinned: input.pinned,
        quickStatus: input.quickStatus ?? null,
        lostReason: input.status === "lost" ? (input.lostReason ?? null) : null,
        lifecycleStatus: "active" as LeadLifecycleStatus,
        archivedAt: null,
        archiveReason: null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmLeads).values(newLeadRow);

      // Internal hook strictly used in live MariaDB transaction rollback tests; never exposed over HTTP.
      options?.hooks?.afterPrimaryWrite?.();

      const activityId = generateServerId("act");
      const createdActivityRow = {
        id: activityId,
        legacyId: null,
        ownerUserId,
        leadId,
        actorUserId,
        type: "created",
        text: "Lead added to Scale Flow",
        outcome: null,
        opId: null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(createdActivityRow);

      const tagIds =
        input.tagIds !== undefined
          ? await syncLeadTagsInTx(tx, {
              ownerUserId,
              leadId,
              tagIds: input.tagIds,
              isNew: true,
              now,
            })
          : [];

      const fieldValues = await syncLeadFieldValuesInTx(tx, {
        ownerUserId,
        leadId,
        input: input.fieldValues,
        isNew: true,
        now,
      });

      const leadDto = toLeadDto(newLeadRow as LeadRow, { tagIds, fieldValues });
      const activityDto = toLeadActivityDto(createdActivityRow);

      return {
        status: 201,
        resourceId: leadId,
        body: { ok: true, lead: leadDto, activity: activityDto },
      };
    },
  );

  return res;
}

export async function listLeadsRecords(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListLeadsQuery,
  now: Date = new Date(),
): Promise<{
  items: LeadDto[];
  total: number;
  limit: number;
  offset: number;
  stageCounts: Record<string, number>;
}> {
  const basePredicates: SQL[] = [eq(crmLeads.ownerUserId, ownerUserId)];

  if (query.lifecycle !== "all") {
    basePredicates.push(eq(crmLeads.lifecycleStatus, query.lifecycle));
  }
  if (query.source !== "all") {
    basePredicates.push(eq(crmLeads.source, query.source));
  }
  if (query.priority !== "all") {
    basePredicates.push(eq(crmLeads.priority, query.priority));
  }
  if (query.quickStatus === "none") {
    basePredicates.push(isNull(crmLeads.quickStatus));
  } else if (query.quickStatus !== "all") {
    basePredicates.push(eq(crmLeads.quickStatus, query.quickStatus));
  }

  if (query.createdFrom) {
    const start = istDayBoundsUtc(query.createdFrom).startMysqlUtc;
    basePredicates.push(gte(crmLeads.createdAt, start));
  }
  if (query.createdTo) {
    const endExcl = istDayBoundsUtc(query.createdTo).endExclusiveMysqlUtc;
    basePredicates.push(lt(crmLeads.createdAt, endExcl));
  }

  if (query.followUp !== "all") {
    const nowStr = toMysqlUtcDateTime(now);
    if (query.followUp === "none") {
      basePredicates.push(isNull(crmLeads.nextFollowUpAt));
    } else if (query.followUp === "overdue") {
      basePredicates.push(lt(crmLeads.nextFollowUpAt, nowStr));
    } else if (query.followUp === "today") {
      const todayBounds = istDayBoundsUtc(toIstParts(now).istDate);
      basePredicates.push(
        gte(crmLeads.nextFollowUpAt, todayBounds.startMysqlUtc),
        lt(crmLeads.nextFollowUpAt, todayBounds.endExclusiveMysqlUtc),
      );
    } else if (query.followUp === "week") {
      const weekEndStr = toMysqlUtcDateTime(new Date(now.getTime() + 7 * DAY_MS));
      basePredicates.push(
        gte(crmLeads.nextFollowUpAt, nowStr),
        lte(crmLeads.nextFollowUpAt, weekEndStr),
      );
    }
  }

  if (query.tagId) {
    const taggedRows = await db
      .select({ leadId: crmLeadTags.leadId })
      .from(crmLeadTags)
      .where(and(eq(crmLeadTags.ownerUserId, ownerUserId), eq(crmLeadTags.tagId, query.tagId)));
    const matchingLeadIds = taggedRows.map((r) => r.leadId);
    if (matchingLeadIds.length === 0) {
      const emptyCounts: Record<string, number> = { all: 0 };
      for (const s of LEAD_STATUSES) emptyCounts[s] = 0;
      return {
        items: [],
        total: 0,
        limit: query.limit,
        offset: query.offset,
        stageCounts: emptyCounts,
      };
    }
    basePredicates.push(inArray(crmLeads.id, matchingLeadIds));
  }

  if (query.q) {
    const pattern = `%${escapeSqlLike(query.q.trim())}%`;
    basePredicates.push(
      or(
        sql`${crmLeads.name} LIKE ${pattern} ESCAPE '!'`,
        sql`COALESCE(${crmLeads.company}, '') LIKE ${pattern} ESCAPE '!'`,
        sql`${crmLeads.phone} LIKE ${pattern} ESCAPE '!'`,
        sql`COALESCE(${crmLeads.email}, '') LIKE ${pattern} ESCAPE '!'`,
      )!,
    );
  }

  const baseWhere = and(...basePredicates);

  const stageRows = await db
    .select({
      status: crmLeads.status,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(crmLeads)
    .where(baseWhere)
    .groupBy(crmLeads.status);

  const stageCounts: Record<string, number> = { all: 0 };
  for (const s of LEAD_STATUSES) {
    stageCounts[s] = 0;
  }
  let allCount = 0;
  for (const r of stageRows) {
    const cnt = Number(r.cnt) || 0;
    stageCounts[r.status] = cnt;
    allCount += cnt;
  }
  stageCounts["all"] = allCount;

  const listPredicates = [...basePredicates];
  if (query.status !== "all") {
    listPredicates.push(eq(crmLeads.status, query.status));
  }
  const listWhere = and(...listPredicates);

  const total = query.status === "all" ? allCount : (stageCounts[query.status] ?? 0);

  const orderClauses: SQL[] = [];
  if (query.pinnedFirst) {
    orderClauses.push(desc(crmLeads.pinned));
  }
  switch (query.sort) {
    case "updated":
      orderClauses.push(desc(crmLeads.updatedAt), desc(crmLeads.id));
      break;
    case "score":
      orderClauses.push(desc(sql`COALESCE(${crmLeads.aiScore}, 0)`), desc(crmLeads.createdAt));
      break;
    case "value":
      orderClauses.push(desc(sql`COALESCE(${crmLeads.quotedAmount}, 0)`), desc(crmLeads.createdAt));
      break;
    case "name":
      orderClauses.push(asc(crmLeads.name), asc(crmLeads.id));
      break;
    case "recent":
    default:
      orderClauses.push(desc(crmLeads.createdAt), desc(crmLeads.id));
      break;
  }

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmLeads)
          .where(listWhere)
          .orderBy(...orderClauses)
          .limit(query.limit)
          .offset(query.offset);

  const relationsMap = await hydrateLeadRelations(
    db,
    ownerUserId,
    rows.map((r) => r.id),
  );

  const items = rows.map((row) => toLeadDto(row, relationsMap.get(row.id)));

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
    stageCounts,
  };
}

export async function getLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
): Promise<LeadDto> {
  const rows = await db
    .select()
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Lead not found.");
  }

  const relations = await hydrateLeadRelations(db, ownerUserId, [row.id]);
  return toLeadDto(row, relations.get(row.id));
}

export async function updateLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  leadId: string,
  input: UpdateLeadInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; lead: LeadDto; activities: LeadActivityDto[] };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`lead:update:${leadId}`, input);

  return runWithIdempotency<{ ok: true; lead: LeadDto; activities: LeadActivityDto[] }>(
    db,
    { ownerUserId, scope: `lead:update:${leadId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Lead not found.");
      }
      if (current.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Lead is archived. Restore it before making edits.",
          { conflict: { lifecycleStatus: current.lifecycleStatus } },
        );
      }
      if (current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Lead was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "lead",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      const nextStatus = input.status ?? current.status;
      const nextLostReason =
        input.status !== undefined && input.status !== "lost"
          ? null
          : input.lostReason !== undefined
            ? input.lostReason
            : current.lostReason;

      if (nextStatus === "lost" && !nextLostReason) {
        throw new CrmServiceError(400, "validation_error", "Add a lost reason", {
          details: { lostReason: "Add a lost reason" },
        });
      }

      const nextPhone = input.phone ?? current.phone;
      const nextPhoneKey = extractLeadPhoneKey(nextPhone);
      const nextEmail = input.email !== undefined ? input.email : current.email;
      const nextEmailNormalized = nextEmail ? normalizeLeadEmail(nextEmail) : null;

      // Match validation.ts:40: changing a lead's normalized phone onto another active lead is always blocked.
      if (input.phone !== undefined && nextPhoneKey !== current.phoneKey) {
        const phoneDupes = await findActiveLeadDuplicatesInTx(tx, ownerUserId, {
          phoneKey: nextPhoneKey,
          emailNormalized: null,
          excludeLeadId: leadId,
        });
        if (phoneDupes.length > 0) {
          throwDuplicateLeadConflict("This phone already belongs to another lead.", phoneDupes);
        }
      }

      // If changing normalized email onto another active lead, warn/block unless explicitly bypassed.
      if (
        input.email !== undefined &&
        nextEmailNormalized !== null &&
        nextEmailNormalized !== current.emailNormalized &&
        !input.allowDuplicate
      ) {
        const emailDupes = await findActiveLeadDuplicatesInTx(tx, ownerUserId, {
          phoneKey: "__never_match__",
          emailNormalized: nextEmailNormalized,
          excludeLeadId: leadId,
        });
        if (emailDupes.length > 0) {
          throwDuplicateLeadConflict(
            "Another active lead already uses this email address.",
            emailDupes,
          );
        }
      }

      const nextQuotedDecimal =
        input.quotedAmount === undefined
          ? current.quotedAmount
          : input.quotedAmount === null
            ? null
            : paiseToDecimalString(rupeesToPaise(input.quotedAmount));

      const nextBudgetDecimal =
        input.budget === undefined
          ? current.budget
          : input.budget === null
            ? null
            : paiseToDecimalString(rupeesToPaise(input.budget));

      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = current.version + 1;

      const patchPayload = {
        name: input.name !== undefined ? input.name : current.name,
        phone: nextPhone,
        phoneKey: nextPhoneKey,
        email: nextEmail,
        emailNormalized: nextEmailNormalized,
        company: input.company !== undefined ? input.company : current.company,
        requirement: input.requirement !== undefined ? input.requirement : current.requirement,
        source: input.source !== undefined ? input.source : current.source,
        status: nextStatus,
        priority: input.priority !== undefined ? input.priority : current.priority,
        aiScore: input.aiScore !== undefined ? input.aiScore : current.aiScore,
        quotedAmount: nextQuotedDecimal,
        budget: nextBudgetDecimal,
        notes: input.notes !== undefined ? input.notes : current.notes,
        pinned: input.pinned !== undefined ? input.pinned : current.pinned,
        quickStatus: input.quickStatus !== undefined ? input.quickStatus : current.quickStatus,
        lostReason: nextLostReason,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      const updRes = await tx
        .update(crmLeads)
        .set(patchPayload)
        .where(
          and(
            eq(crmLeads.id, leadId),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.version, current.version),
          ),
        );
      await assertAffectedRow(Promise.resolve(updRes), leadId);

      // Internal hook strictly used in live MariaDB transaction rollback tests; never exposed over HTTP.
      options?.hooks?.afterPrimaryWrite?.();

      const activityRows: LeadActivityRow[] = [];

      const editSummaryText = buildLeadEditSummary(
        {
          phone: current.phone,
          email: current.email,
          company: current.company,
          source: current.source,
        },
        {
          ...(input.phone !== undefined ? { phone: nextPhone } : {}),
          ...(input.email !== undefined ? { email: nextEmail } : {}),
          ...(input.company !== undefined ? { company: patchPayload.company } : {}),
          ...(input.source !== undefined ? { source: patchPayload.source } : {}),
        },
      );
      if (editSummaryText) {
        activityRows.push({
          id: generateServerId("act"),
          legacyId: null,
          ownerUserId,
          leadId,
          actorUserId,
          type: "edit",
          text: editSummaryText,
          outcome: null,
          opId: null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      if (input.status !== undefined && input.status !== current.status) {
        activityRows.push({
          id: generateServerId("act"),
          legacyId: null,
          ownerUserId,
          leadId,
          actorUserId,
          type: "status",
          text: `Status changed to ${input.status}`,
          outcome: null,
          opId: null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      if (input.quickStatus !== undefined && input.quickStatus !== current.quickStatus) {
        activityRows.push({
          id: generateServerId("act"),
          legacyId: null,
          ownerUserId,
          leadId,
          actorUserId,
          type: "quick",
          text:
            input.quickStatus !== null
              ? `Quick status: ${QUICK_LABEL[input.quickStatus]}`
              : "Quick status cleared",
          outcome: null,
          opId: null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      if (activityRows.length > 0) {
        await tx.insert(crmLeadActivities).values(activityRows);
      }

      let relationsTagIds: string[];
      if (input.tagIds !== undefined) {
        relationsTagIds = await syncLeadTagsInTx(tx, {
          ownerUserId,
          leadId,
          tagIds: input.tagIds,
          isNew: false,
          now,
        });
      } else {
        const existingRel = await hydrateLeadRelations(tx, ownerUserId, [leadId]);
        relationsTagIds = existingRel.get(leadId)?.tagIds ?? [];
      }

      const relationsFieldValues = await syncLeadFieldValuesInTx(tx, {
        ownerUserId,
        leadId,
        input: input.fieldValues,
        isNew: false,
        now,
      });

      const updatedRow: LeadRow = {
        ...current,
        ...patchPayload,
      };

      return {
        status: 200,
        resourceId: leadId,
        body: {
          ok: true,
          lead: toLeadDto(updatedRow, {
            tagIds: relationsTagIds,
            fieldValues: relationsFieldValues,
          }),
          activities: activityRows.map(toLeadActivityDto),
        },
      };
    },
  );
}

export async function archiveLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  leadId: string,
  input: {
    kind: "waste" | "deleted";
    reason?: string | undefined;
    version?: number | undefined;
    idempotencyKey?: string | null | undefined;
  },
  now: Date = new Date(),
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; lead: LeadDto; activity: LeadActivityDto };
}> {
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`lead:archive:${leadId}`, {
    kind: input.kind,
    reason: input.reason ?? null,
    version: input.version ?? null,
  });

  return runWithIdempotency<{ ok: true; lead: LeadDto; activity: LeadActivityDto }>(
    db,
    { ownerUserId, scope: `lead:archive:${leadId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Lead not found.");
      }
      if (current.lifecycleStatus !== "active") {
        throw new CrmServiceError(409, "lead_already_archived", "Lead is already archived.", {
          conflict: { lifecycleStatus: current.lifecycleStatus },
        });
      }
      if (input.version !== undefined && current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Lead was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "lead",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = current.version + 1;
      const reasonClean = input.reason?.trim() || null;

      const updRes = await tx
        .update(crmLeads)
        .set({
          lifecycleStatus: input.kind,
          archivedAt: nowStr,
          archiveReason: reasonClean,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmLeads.id, leadId),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.version, current.version),
          ),
        );
      await assertAffectedRow(Promise.resolve(updRes), leadId);

      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId,
        actorUserId,
        type: input.kind === "waste" ? "waste" : "note",
        text:
          input.kind === "waste"
            ? reasonClean
              ? `Moved to Waste: ${reasonClean}`
              : "Moved to Waste"
            : "Lead deleted",
        outcome: null,
        opId: null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      const rel = await hydrateLeadRelations(tx, ownerUserId, [leadId]);
      const updatedRow: LeadRow = {
        ...current,
        lifecycleStatus: input.kind,
        archivedAt: nowStr,
        archiveReason: reasonClean,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 200,
        resourceId: leadId,
        body: {
          ok: true,
          lead: toLeadDto(updatedRow, rel.get(leadId)),
          activity: toLeadActivityDto(actRow),
        },
      };
    },
  );
}

export async function restoreLeadRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  leadId: string,
  input: {
    version?: number | undefined;
    idempotencyKey?: string | null | undefined;
  },
  now: Date = new Date(),
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; lead: LeadDto; activity: LeadActivityDto };
}> {
  const idemKey = input.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`lead:restore:${leadId}`, {
    version: input.version ?? null,
  });

  return runWithIdempotency<{ ok: true; lead: LeadDto; activity: LeadActivityDto }>(
    db,
    { ownerUserId, scope: `lead:restore:${leadId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Lead not found.");
      }
      if (current.lifecycleStatus === "active") {
        throw new CrmServiceError(409, "lead_not_archived", "Lead is already active.");
      }
      if (input.version !== undefined && current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Lead was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "lead",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      // Mirror store.ts:750: never restore onto an active phone duplicate.
      const phoneDupes = await findActiveLeadDuplicatesInTx(tx, ownerUserId, {
        phoneKey: current.phoneKey,
        emailNormalized: null,
        excludeLeadId: leadId,
      });
      if (phoneDupes.length > 0) {
        throwDuplicateLeadConflict(
          "An active lead already uses this phone — merge or edit it first",
          phoneDupes,
        );
      }

      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = current.version + 1;
      const previousKind = current.lifecycleStatus;

      const updRes = await tx
        .update(crmLeads)
        .set({
          lifecycleStatus: "active",
          archivedAt: null,
          archiveReason: null,
          updatedByUserId: actorUserId,
          version: nextVersion,
          updatedAt: nowStr,
        })
        .where(
          and(
            eq(crmLeads.id, leadId),
            eq(crmLeads.ownerUserId, ownerUserId),
            eq(crmLeads.version, current.version),
          ),
        );
      await assertAffectedRow(Promise.resolve(updRes), leadId);

      const syncedNextDue = await recomputeLeadNextFollowUpInTx(tx, ownerUserId, leadId);

      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId,
        actorUserId,
        type: "restored",
        text: previousKind === "waste" ? "Restored from Waste" : "Restored from Recently Deleted",
        outcome: null,
        opId: null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      const rel = await hydrateLeadRelations(tx, ownerUserId, [leadId]);
      const updatedRow: LeadRow = {
        ...current,
        lifecycleStatus: "active",
        archivedAt: null,
        archiveReason: null,
        nextFollowUpAt: syncedNextDue,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 200,
        resourceId: leadId,
        body: {
          ok: true,
          lead: toLeadDto(updatedRow, rel.get(leadId)),
          activity: toLeadActivityDto(actRow),
        },
      };
    },
  );
}

export { isMysqlDuplicateKeyError };
