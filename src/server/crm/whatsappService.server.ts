import "@tanstack/react-start/server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import { crmLeadActivities, crmLeads, crmWhatsAppLogs } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { generateServerId } from "../auth/security.server";
import { toIstParts } from "./dates.server";
import { hydrateLeadRelations } from "./customFieldsSupport.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  toLeadActivityDto,
  toLeadDto,
  toWhatsAppLogDto,
  type LeadActivityDto,
  type LeadActivityRow,
  type LeadDto,
  type LeadRow,
  type WhatsAppLogDto,
  type WhatsAppLogRow,
  type WhatsAppLogWithLeadDto,
} from "./mappers.server";
import {
  normalizeWhatsAppRecipientPhone,
  WA_PURPOSE_LABEL,
  type CreateWhatsAppLogInput,
  type LeadLifecycleStatus,
  type LeadPriority,
  type LeadStatus,
  type ListLeadWhatsAppQuery,
  type ListWhatsAppQuery,
  type WaPurpose,
} from "./validation.server";

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

/**
 * Builds the Lead Activity summary string matching `src/components/crm/WhatsAppComposer.tsx` `logIt`.
 * Never claims automated delivery or client reply; full message text is persisted in `crm_whatsapp_logs`.
 */
export function buildWhatsAppActivityText(params: {
  purpose: WaPurpose;
  composerSource: string;
  templateName?: string | null | undefined;
  messageText: string;
}): string {
  const purposeLabel = WA_PURPOSE_LABEL[params.purpose].toLowerCase();
  const templatePart = params.templateName?.trim() ? ` — ${params.templateName.trim()}` : "";
  const trimmed = params.messageText.trim();
  const preview = trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
  return `WhatsApp ${purposeLabel} message (from ${params.composerSource})${templatePart}: ${preview}`;
}

export async function createWhatsAppLogRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateWhatsAppLogInput,
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
    message: WhatsAppLogDto;
    lead: LeadDto;
    activity: LeadActivityDto;
  };
}> {
  if (input.confirmedSent !== true || input.confirmationStatus !== "owner_confirmed_sent") {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Confirm you actually sent the message in WhatsApp before logging.",
      { details: { confirmedSent: "Manual owner confirmation is required." } },
    );
  }

  const cleanMessage = input.messageText.replace(/\r\n?/g, "\n").trim();
  if (!cleanMessage || cleanMessage.length > 4096) {
    throw new CrmServiceError(
      400,
      "validation_error",
      !cleanMessage
        ? "Write or paste a WhatsApp message before confirming send."
        : "WhatsApp message cannot exceed 4096 characters.",
      { details: { messageText: "Invalid message length." } },
    );
  }

  const cleanTemplateId = input.templateId?.trim() || null;
  const cleanTemplateName = input.templateName?.trim() || null;
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? input.idempotencyKey ?? input.opId ?? null;
  const scope = `whatsapp:create:${input.leadId}`;
  const requestHash = hashIdempotentRequest(scope, {
    leadId: input.leadId,
    purpose: input.purpose,
    templateId: cleanTemplateId,
    templateName: cleanTemplateName,
    recipientPhone: input.recipientPhone ?? null,
    messageText: cleanMessage,
    confirmationStatus: "owner_confirmed_sent",
    composerSource: input.composerSource,
    expectedLeadVersion: input.expectedLeadVersion ?? null,
    opId: input.opId ?? null,
  });

  try {
    return await runWithIdempotency<{
      ok: true;
      message: WhatsAppLogDto;
      lead: LeadDto;
      activity: LeadActivityDto;
    }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
      if (input.opId) {
        const existingByOp = await tx
          .select()
          .from(crmWhatsAppLogs)
          .where(
            and(eq(crmWhatsAppLogs.ownerUserId, ownerUserId), eq(crmWhatsAppLogs.opId, input.opId)),
          )
          .limit(1);
        if (existingByOp[0]) {
          throw new CrmServiceError(
            409,
            "whatsapp_op_conflict",
            "Operation ID already exists for another WhatsApp log.",
            { conflict: { existingMessage: toWhatsAppLogDto(existingByOp[0]) } },
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
          "Cannot log a WhatsApp message for an archived lead. Restore it first.",
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

      const leadWaPhone = normalizeWhatsAppRecipientPhone(current.phone);
      if (!leadWaPhone) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "Lead phone number is not a valid Indian mobile for WhatsApp. Fix it on the lead first.",
          {
            details: {
              recipientPhone: "Lead phone number is not a valid Indian mobile for WhatsApp.",
            },
          },
        );
      }

      if (input.recipientPhone !== undefined) {
        const inputWaPhone = normalizeWhatsAppRecipientPhone(input.recipientPhone);
        if (!inputWaPhone || inputWaPhone !== leadWaPhone) {
          throw new CrmServiceError(
            400,
            "validation_error",
            "Recipient phone must match the lead's WhatsApp mobile number.",
            {
              details: {
                recipientPhone: "Recipient phone must match the lead's WhatsApp mobile number.",
              },
            },
          );
        }
      }

      const nowStr = toMysqlUtcDateTime(now);
      const ist = toIstParts(now);
      const nextVersion = current.version + 1;

      // Honesty rule: Outbound WhatsApp confirmation never fabricates two-way contact (`lastContactAt`),
      // pipeline stage (`status`), or `quickStatus`. Only version and updated_at advance.
      const updRes = await tx
        .update(crmLeads)
        .set({
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

      const waActId = generateServerId("act");
      const waActivityRow: LeadActivityRow = {
        id: waActId,
        legacyId: null,
        ownerUserId,
        leadId: current.id,
        actorUserId,
        type: "whatsapp",
        text: buildWhatsAppActivityText({
          purpose: input.purpose,
          composerSource: input.composerSource,
          templateName: cleanTemplateName,
          messageText: cleanMessage,
        }),
        outcome: null,
        opId: input.opId ?? null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      };

      await tx.insert(crmLeadActivities).values(waActivityRow);

      const waRow: WhatsAppLogRow = {
        id: generateServerId("wa"),
        legacyId: null,
        ownerUserId,
        leadId: current.id,
        actorUserId,
        purpose: input.purpose,
        templateId: cleanTemplateId,
        templateName: cleanTemplateName,
        recipientPhone: leadWaPhone,
        messageText: cleanMessage,
        confirmationStatus: "owner_confirmed_sent",
        composerSource: input.composerSource,
        leadActivityId: waActId,
        opId: input.opId ?? null,
        idempotencyKey: idemKey,
        confirmedAt: nowStr,
        confirmedIstDate: ist.istDate,
        confirmedIstTime: ist.istTime,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      await tx.insert(crmWhatsAppLogs).values(waRow);

      const relations = await hydrateLeadRelations(tx, ownerUserId, [current.id]);
      const updatedLeadRow: LeadRow = {
        ...current,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      return {
        status: 201,
        resourceId: waRow.id,
        body: {
          ok: true,
          message: toWhatsAppLogDto(waRow),
          lead: toLeadDto(updatedLeadRow, relations.get(current.id)),
          activity: toLeadActivityDto(waActivityRow),
        },
      };
    });
  } catch (error) {
    if (error instanceof CrmServiceError) throw error;
    if (isMysqlDuplicateKeyError(error)) {
      throw new CrmServiceError(
        409,
        "whatsapp_conflict",
        "A matching WhatsApp log operation or idempotency key already exists.",
      );
    }
    throw error;
  }
}

export async function listWhatsAppLogs(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListWhatsAppQuery,
): Promise<{
  items: WhatsAppLogWithLeadDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const predicates: SQL[] = [eq(crmWhatsAppLogs.ownerUserId, ownerUserId)];
  if (query.leadId) {
    predicates.push(eq(crmWhatsAppLogs.leadId, query.leadId));
  }
  if (query.purpose !== "all") {
    predicates.push(eq(crmWhatsAppLogs.purpose, query.purpose));
  }
  if (query.dateIst) {
    predicates.push(eq(crmWhatsAppLogs.confirmedIstDate, query.dateIst));
  }
  if (query.leadLifecycle !== "all") {
    predicates.push(eq(crmLeads.lifecycleStatus, query.leadLifecycle));
  }

  const whereClause = and(...predicates);
  const countRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(crmWhatsAppLogs)
    .innerJoin(crmLeads, eq(crmWhatsAppLogs.leadId, crmLeads.id))
    .where(whereClause);

  const total = Number(countRows[0]?.total ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select({
            message: crmWhatsAppLogs,
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
          .from(crmWhatsAppLogs)
          .innerJoin(crmLeads, eq(crmWhatsAppLogs.leadId, crmLeads.id))
          .where(whereClause)
          .orderBy(
            desc(crmWhatsAppLogs.confirmedAt),
            desc(crmWhatsAppLogs.createdAt),
            desc(crmWhatsAppLogs.id),
          )
          .limit(query.limit)
          .offset(query.offset);

  const items: WhatsAppLogWithLeadDto[] = rows.map((r) => ({
    ...toWhatsAppLogDto(r.message),
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
  };
}

export async function listWhatsAppLogsForLead(
  db: CrmDatabase,
  ownerUserId: string,
  leadId: string,
  query: ListLeadWhatsAppQuery,
): Promise<{
  leadId: string;
  items: WhatsAppLogDto[];
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
    eq(crmWhatsAppLogs.ownerUserId, ownerUserId),
    eq(crmWhatsAppLogs.leadId, leadId),
  ];
  if (query.purpose !== "all") {
    predicates.push(eq(crmWhatsAppLogs.purpose, query.purpose));
  }

  const whereClause = and(...predicates);
  const countRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(crmWhatsAppLogs)
    .where(whereClause);

  const total = Number(countRows[0]?.total ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmWhatsAppLogs)
          .where(whereClause)
          .orderBy(
            desc(crmWhatsAppLogs.confirmedAt),
            desc(crmWhatsAppLogs.createdAt),
            desc(crmWhatsAppLogs.id),
          )
          .limit(query.limit)
          .offset(query.offset);

  return {
    leadId,
    items: rows.map(toWhatsAppLogDto),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getWhatsAppLogRecord(
  db: CrmDatabase,
  ownerUserId: string,
  messageId: string,
): Promise<WhatsAppLogDto> {
  const rows = await db
    .select()
    .from(crmWhatsAppLogs)
    .where(and(eq(crmWhatsAppLogs.id, messageId), eq(crmWhatsAppLogs.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "WhatsApp message log not found.");
  }
  return toWhatsAppLogDto(row);
}
