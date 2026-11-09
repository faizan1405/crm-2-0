import "@tanstack/react-start/server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmLeadActivities, crmLeads } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { CrmServiceError } from "./errors.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import { toLeadActivityDto, type LeadActivityDto } from "./mappers.server";
import {
  MANUAL_ACTIVITY_TYPES,
  type CreateActivityInput,
  type ListActivitiesQuery,
  type ManualActivityType,
} from "./validation.server";

function isManualActivityType(raw: string): raw is ManualActivityType {
  return (MANUAL_ACTIVITY_TYPES as readonly string[]).includes(raw);
}

export async function listLeadActivities(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  query: ListActivitiesQuery,
): Promise<{
  leadId: string;
  items: LeadActivityDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const leadRows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
    .limit(1);

  if (!leadRows[0]) {
    throw new CrmServiceError(404, "not_found", "Lead not found.");
  }

  const predicates: SQL[] = [
    eq(crmLeadActivities.ownerUserId, ownerUserId),
    eq(crmLeadActivities.leadId, leadId),
  ];
  if (query.type !== "all") {
    predicates.push(eq(crmLeadActivities.type, query.type));
  }
  const whereClause = and(...predicates);

  const countRows = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(crmLeadActivities)
    .where(whereClause);
  const total = Number(countRows[0]?.cnt ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmLeadActivities)
          .where(whereClause)
          .orderBy(
            desc(crmLeadActivities.occurredAt),
            desc(crmLeadActivities.createdAt),
            desc(crmLeadActivities.id),
          )
          .limit(query.limit)
          .offset(query.offset);

  return {
    leadId,
    items: rows.map(toLeadActivityDto),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function createLeadActivity(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  leadId: string,
  input: CreateActivityInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; activity: LeadActivityDto };
}> {
  if (!isManualActivityType(input.type)) {
    throw new CrmServiceError(
      400,
      "activity_type_not_permitted",
      `Activity type "${input.type}" cannot be recorded directly. Permitted manual types: ${MANUAL_ACTIVITY_TYPES.join(", ")}.`,
      { details: { type: input.type, allowedTypes: [...MANUAL_ACTIVITY_TYPES] } },
    );
  }

  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? input.opId ?? null;
  const requestHash = hashIdempotentRequest(`activity:create:${leadId}`, {
    type: input.type,
    text: input.text.trim(),
    opId: input.opId ?? null,
  });

  return runWithIdempotency<{ ok: true; activity: LeadActivityDto }>(
    db,
    { ownerUserId, scope: `activity:create:${leadId}`, idemKey, requestHash, now },
    async (tx) => {
      const leadRows = await tx
        .select({ id: crmLeads.id, lifecycleStatus: crmLeads.lifecycleStatus })
        .from(crmLeads)
        .where(and(eq(crmLeads.id, leadId), eq(crmLeads.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");

      const lead = leadRows[0];
      if (!lead) {
        throw new CrmServiceError(404, "not_found", "Lead not found.");
      }
      if (lead.lifecycleStatus !== "active") {
        throw new CrmServiceError(
          409,
          "lead_archived",
          "Cannot record activity on an archived lead. Restore it first.",
          { conflict: { lifecycleStatus: lead.lifecycleStatus } },
        );
      }

      // Guard against duplicate retry on the table-level unique index as well.
      if (idemKey) {
        const existingActivity = await tx
          .select()
          .from(crmLeadActivities)
          .where(
            and(
              eq(crmLeadActivities.ownerUserId, ownerUserId),
              eq(crmLeadActivities.leadId, leadId),
              eq(crmLeadActivities.idempotencyKey, idemKey),
            ),
          )
          .limit(1);
        if (existingActivity[0]) {
          return {
            status: 201,
            resourceId: existingActivity[0].id,
            body: { ok: true, activity: toLeadActivityDto(existingActivity[0]) },
          };
        }
      }

      const nowStr = toMysqlUtcDateTime(now);
      const actRow = {
        id: generateServerId("act"),
        legacyId: null,
        ownerUserId,
        leadId,
        actorUserId,
        type: input.type,
        text: input.text.trim(),
        outcome: null,
        opId: input.opId ?? null,
        idempotencyKey: idemKey,
        occurredAt: nowStr,
        createdAt: nowStr,
      };
      await tx.insert(crmLeadActivities).values(actRow);

      return {
        status: 201,
        resourceId: actRow.id,
        body: { ok: true, activity: toLeadActivityDto(actRow) },
      };
    },
  );
}
