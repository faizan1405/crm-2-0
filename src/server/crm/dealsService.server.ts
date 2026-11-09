import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { generateServerId } from "../auth/security.server";
import type { CrmDatabase } from "../db/index.server";
import { decimalStringToPaise, formatInrFromPaise, sumPaise } from "../db/money.server";
import {
  crmDealMilestones,
  crmDeals,
  crmFinanceEvents,
  crmLeadActivities,
  crmLeads,
  crmPayments,
} from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import {
  calculateDealFinancialSummary,
  calculateOwnerFinanceSummary,
  type DealFinancialSummaryDto,
  type OwnerFinanceSummaryDto,
} from "./financeCalc.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmDbExecutor,
  type CrmTransaction,
} from "./idempotency.server";
import {
  toDealDto,
  toFinanceEventDto,
  toPaymentDto,
  type DealDto,
  type DealMilestoneRow,
  type DealRow,
  type FinanceEventDto,
  type FinanceEventRow,
  type PaymentDto,
  type PaymentRow,
} from "./mappers.server";
import type {
  CancelDealInput,
  ChangeDealStatusInput,
  CreateDealInput,
  DealStatus,
  FinanceSummaryQuery,
  ListDealAuditQuery,
  ListDealsQuery,
  PaymentStatus,
  UpdateDealInput,
  VerifyDealWonDateInput,
} from "./validation.server";

function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function assertDealRowUpdated(
  resultPromise: Promise<unknown>,
  dealId: string,
): Promise<void> {
  const raw = await resultPromise;
  const header = Array.isArray(raw) ? (raw[0] as { affectedRows?: number } | undefined) : undefined;
  if (header && typeof header.affectedRows === "number" && header.affectedRows === 0) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      "Deal was modified concurrently; reload and retry.",
      { conflict: { resource: "deal", id: dealId } },
    );
  }
}

export async function hydrateDealChildren(
  executor: CrmDbExecutor,
  ownerUserId: string,
  dealIds: readonly string[],
): Promise<{
  milestonesByDeal: Map<string, DealMilestoneRow[]>;
  paymentsByDeal: Map<string, PaymentRow[]>;
}> {
  const milestonesByDeal = new Map<string, DealMilestoneRow[]>();
  const paymentsByDeal = new Map<string, PaymentRow[]>();
  if (dealIds.length === 0) {
    return { milestonesByDeal, paymentsByDeal };
  }

  const [milestoneRows, paymentRows] = await Promise.all([
    executor
      .select()
      .from(crmDealMilestones)
      .where(
        and(
          eq(crmDealMilestones.ownerUserId, ownerUserId),
          inArray(crmDealMilestones.dealId, [...dealIds]),
        ),
      )
      .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
    executor
      .select()
      .from(crmPayments)
      .where(
        and(eq(crmPayments.ownerUserId, ownerUserId), inArray(crmPayments.dealId, [...dealIds])),
      )
      .orderBy(desc(crmPayments.paymentIstDate), desc(crmPayments.createdAt), desc(crmPayments.id)),
  ]);

  for (const ms of milestoneRows) {
    const arr = milestonesByDeal.get(ms.dealId);
    if (arr) arr.push(ms);
    else milestonesByDeal.set(ms.dealId, [ms]);
  }
  for (const pay of paymentRows) {
    const arr = paymentsByDeal.get(pay.dealId);
    if (arr) arr.push(pay);
    else paymentsByDeal.set(pay.dealId, [pay]);
  }

  return { milestonesByDeal, paymentsByDeal };
}

function buildDealAuditSnapshot(row: DealRow, summary: DealFinancialSummaryDto) {
  return {
    status: row.status,
    name: row.name,
    clientType: row.clientType,
    clientName: row.clientName,
    leadId: row.leadId,
    quotedAmount: row.quotedAmount,
    finalAmount: row.finalAmount,
    dueDate: row.dueDate,
    wonIstDate: row.wonIstDate,
    collected: summary.collectedDecimal,
    outstanding: summary.outstandingDecimal,
    overdue: summary.overdueDecimal,
    paymentStatus: summary.paymentStatus,
    version: row.version,
  };
}

async function checkDuplicateActiveDealInTx(
  tx: CrmTransaction,
  params: {
    ownerUserId: string;
    clientType: "crm" | "other";
    leadId: string | null;
    clientName: string;
    name: string;
    excludeDealId?: string | undefined;
  },
): Promise<DealRow[]> {
  const baseConds = [
    eq(crmDeals.ownerUserId, params.ownerUserId),
    ne(crmDeals.status, "cancelled"),
    sql`LOWER(${crmDeals.name}) = ${params.name.trim().toLowerCase()}`,
  ];
  if (params.excludeDealId) {
    baseConds.push(ne(crmDeals.id, params.excludeDealId));
  }
  if (params.clientType === "crm" && params.leadId) {
    baseConds.push(eq(crmDeals.leadId, params.leadId));
  } else {
    baseConds.push(
      eq(crmDeals.clientType, "other"),
      sql`LOWER(${crmDeals.clientName}) = ${params.clientName.trim().toLowerCase()}`,
    );
  }

  return tx
    .select()
    .from(crmDeals)
    .where(and(...baseConds))
    .limit(5);
}

export async function createDealRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateDealInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; deal: DealDto; auditEvent: FinanceEventDto };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest("deal:create", input);

  return runWithIdempotency<{ ok: true; deal: DealDto; auditEvent: FinanceEventDto }>(
    db,
    { ownerUserId, scope: "deal:create", idemKey, requestHash, now },
    async (tx) => {
      if (input.opId) {
        const existingOp = await tx
          .select()
          .from(crmDeals)
          .where(and(eq(crmDeals.ownerUserId, ownerUserId), eq(crmDeals.opId, input.opId)))
          .limit(1)
          .for("update");
        if (existingOp[0]) {
          throw new CrmServiceError(
            409,
            "deal_op_conflict",
            "opId was already used to record another deal.",
            { conflict: { dealId: existingOp[0].id, opId: input.opId } },
          );
        }
      }

      let resolvedLeadId: string | null = null;
      let resolvedClientName: string;
      let resolvedCompany: string | null = input.company ?? null;
      let resolvedPhone: string | null = input.phone ?? null;

      if (input.clientType === "crm") {
        const leadRows = await tx
          .select()
          .from(crmLeads)
          .where(and(eq(crmLeads.id, input.leadId!), eq(crmLeads.ownerUserId, ownerUserId)))
          .limit(1)
          .for("update");
        const lead = leadRows[0];
        if (!lead) {
          throw new CrmServiceError(404, "not_found", "Linked lead not found.");
        }
        if (lead.lifecycleStatus !== "active") {
          throw new CrmServiceError(
            409,
            "lead_archived",
            "Linked lead is archived. Restore it before booking a deal.",
            { conflict: { leadId: lead.id, lifecycleStatus: lead.lifecycleStatus } },
          );
        }
        resolvedLeadId = lead.id;
        resolvedClientName = lead.name;
        resolvedCompany = input.company ?? lead.company ?? null;
        resolvedPhone = input.phone ?? lead.phone ?? null;
      } else {
        resolvedClientName = input.clientName!;
      }

      if (!input.allowDuplicate) {
        const dupes = await checkDuplicateActiveDealInTx(tx, {
          ownerUserId,
          clientType: input.clientType,
          leadId: resolvedLeadId,
          clientName: resolvedClientName,
          name: input.name,
        });
        if (dupes.length > 0) {
          throw new CrmServiceError(
            409,
            "duplicate_deal",
            "An active deal with this name already exists for this client. Pass allowDuplicate: true if intentional.",
            {
              conflict: {
                existingDealIds: dupes.map((d) => d.id),
                clientName: resolvedClientName,
                name: input.name,
              },
            },
          );
        }
      }

      const nowStr = toMysqlUtcDateTime(now);
      const todayIstDate = toIstParts(now).istDate;
      const dealId = generateServerId("deal");
      const quotedAmountDecimal = input.quotedAmount ?? input.finalAmount;
      const finalAmountDecimal = input.finalAmount;
      const finalAmountPaise = decimalStringToPaise(finalAmountDecimal);

      const dealRow: DealRow = {
        id: dealId,
        legacyId: null,
        ownerUserId,
        leadId: resolvedLeadId,
        clientType: input.clientType,
        clientName: resolvedClientName,
        company: resolvedCompany,
        phone: resolvedPhone,
        name: input.name,
        quotedAmount: quotedAmountDecimal,
        finalAmount: finalAmountDecimal,
        status: input.status,
        dueDate: input.dueDate ?? null,
        wonAt: nowStr,
        wonIstDate: todayIstDate,
        wonDateVerifiedAt: null,
        wonDateVerifiedByUserId: null,
        cancelledAt: null,
        cancelledIstDate: null,
        cancelledByUserId: null,
        cancelReason: null,
        notes: input.notes ?? null,
        opId: input.opId ?? null,
        idempotencyKey: idemKey,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        version: 1,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      try {
        await tx.insert(crmDeals).values(dealRow);
      } catch (err) {
        if (isMysqlDuplicateKeyError(err)) {
          throw new CrmServiceError(
            409,
            "deal_op_conflict",
            "Duplicate deal operation key detected.",
          );
        }
        throw err;
      }

      // Internal hook strictly used in live MariaDB transaction rollback tests; never exposed over HTTP.
      options?.hooks?.afterPrimaryWrite?.();

      const milestoneRows: DealMilestoneRow[] = input.milestones.map((m, index) => ({
        id: generateServerId("ms"),
        legacyId: m.id ?? null,
        ownerUserId,
        dealId,
        label: m.label,
        amount: m.amount,
        dueDate: m.dueDate,
        sortOrder: index,
        createdAt: nowStr,
        updatedAt: nowStr,
      }));

      if (milestoneRows.length > 0) {
        await tx.insert(crmDealMilestones).values(milestoneRows);
      }

      let leadActivityId: string | null = null;
      if (resolvedLeadId) {
        leadActivityId = generateServerId("act");
        await tx.insert(crmLeadActivities).values({
          id: leadActivityId,
          legacyId: null,
          ownerUserId,
          leadId: resolvedLeadId,
          actorUserId,
          type: "payment",
          text: `Deal booked: "${input.name}"`,
          outcome: null,
          opId: input.opId ?? null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      const financialSummary = calculateDealFinancialSummary(
        {
          id: dealRow.id,
          quotedAmount: dealRow.quotedAmount,
          finalAmount: dealRow.finalAmount,
          status: dealRow.status as DealStatus,
          dueDate: dealRow.dueDate,
          wonIstDate: dealRow.wonIstDate,
        },
        [],
        milestoneRows,
        todayIstDate,
      );

      const afterSnapshot = buildDealAuditSnapshot(dealRow, financialSummary);
      const eventRow: FinanceEventRow = {
        id: generateServerId("fin"),
        ownerUserId,
        dealId,
        paymentId: null,
        leadId: resolvedLeadId,
        actorUserId,
        eventType: "deal.created",
        summary: `Deal booked: "${input.name}" (${formatInrFromPaise(finalAmountPaise)})`,
        reason: null,
        amountSnapshot: finalAmountDecimal,
        beforeJson: null,
        afterJson: JSON.stringify(afterSnapshot),
        leadActivityId,
        opId: input.opId ?? null,
        occurredAt: nowStr,
        occurredIstDate: todayIstDate,
        createdAt: nowStr,
      };
      await tx.insert(crmFinanceEvents).values(eventRow);

      return {
        status: 201,
        resourceId: dealId,
        body: {
          ok: true,
          deal: toDealDto(dealRow, milestoneRows, financialSummary),
          auditEvent: toFinanceEventDto(eventRow),
        },
      };
    },
  );
}

export async function listDealsRecords(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListDealsQuery,
  options?: { now?: Date | undefined },
): Promise<{
  items: DealDto[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<DealStatus | "all", number>;
  paymentStatusCounts: Record<PaymentStatus | "due", number>;
}> {
  const now = options?.now ?? new Date();
  const todayIstDate = toIstParts(now).istDate;

  const baseConds = [eq(crmDeals.ownerUserId, ownerUserId)];
  if (query.clientType !== "all") {
    baseConds.push(eq(crmDeals.clientType, query.clientType));
  }
  if (query.leadId) {
    baseConds.push(eq(crmDeals.leadId, query.leadId));
  }
  if (query.wonFrom) {
    baseConds.push(gte(crmDeals.wonIstDate, query.wonFrom));
  }
  if (query.wonTo) {
    baseConds.push(lte(crmDeals.wonIstDate, query.wonTo));
  }
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    baseConds.push(
      or(
        sql`${crmDeals.name} LIKE ${pattern}`,
        sql`${crmDeals.clientName} LIKE ${pattern}`,
        sql`${crmDeals.company} LIKE ${pattern}`,
        sql`${crmDeals.phone} LIKE ${pattern}`,
      )!,
    );
  }

  const allMatchedRows = await db
    .select()
    .from(crmDeals)
    .where(and(...baseConds))
    .orderBy(desc(crmDeals.createdAt), desc(crmDeals.id));

  const { milestonesByDeal, paymentsByDeal } = await hydrateDealChildren(
    db,
    ownerUserId,
    allMatchedRows.map((r) => r.id),
  );

  const statusCounts: Record<DealStatus | "all", number> = {
    all: allMatchedRows.length,
    active: 0,
    completed: 0,
    on_hold: 0,
    cancelled: 0,
  };
  const paymentStatusCounts: Record<PaymentStatus | "due", number> = {
    paid: 0,
    partial: 0,
    unpaid: 0,
    overdue: 0,
    cancelled: 0,
    due: 0,
  };

  const hydrated: DealDto[] = [];
  for (const row of allMatchedRows) {
    const milestones = milestonesByDeal.get(row.id) ?? [];
    const payments = paymentsByDeal.get(row.id) ?? [];
    const summary = calculateDealFinancialSummary(
      {
        id: row.id,
        quotedAmount: row.quotedAmount,
        finalAmount: row.finalAmount,
        status: row.status as DealStatus,
        dueDate: row.dueDate,
        wonIstDate: row.wonIstDate,
      },
      payments,
      milestones,
      todayIstDate,
    );

    statusCounts[row.status as DealStatus] += 1;
    paymentStatusCounts[summary.paymentStatus] += 1;
    if (row.status !== "cancelled" && summary.outstandingPaise > 0) {
      paymentStatusCounts.due += 1;
    }

    if (query.status !== "all" && row.status !== query.status) {
      continue;
    }
    if (query.paymentStatus === "due") {
      if (row.status === "cancelled" || summary.outstandingPaise <= 0) continue;
    } else if (query.paymentStatus !== "all" && summary.paymentStatus !== query.paymentStatus) {
      continue;
    }

    hydrated.push(toDealDto(row, milestones, summary));
  }

  hydrated.sort((a, b) => {
    switch (query.sort) {
      case "due": {
        if (!a.dueDate && !b.dueDate) return b.createdAt.localeCompare(a.createdAt);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        const cmp = a.dueDate.localeCompare(b.dueDate);
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      }
      case "amount": {
        const diff = b.finalAmountPaise - a.finalAmountPaise;
        return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt);
      }
      case "outstanding": {
        const diff = b.financialSummary.outstandingPaise - a.financialSummary.outstandingPaise;
        return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt);
      }
      case "recent":
      default: {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
      }
    }
  });

  const total = hydrated.length;
  const items = hydrated.slice(query.offset, query.offset + query.limit);

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
    statusCounts,
    paymentStatusCounts,
  };
}

export async function getDealRecord(
  db: CrmDatabase,
  ownerUserId: string,
  dealId: string,
  options?: { now?: Date | undefined },
): Promise<{ deal: DealDto; payments: PaymentDto[] }> {
  const now = options?.now ?? new Date();
  const todayIstDate = toIstParts(now).istDate;

  const rows = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Deal not found.");
  }

  const { milestonesByDeal, paymentsByDeal } = await hydrateDealChildren(db, ownerUserId, [row.id]);
  const milestones = milestonesByDeal.get(row.id) ?? [];
  const payments = paymentsByDeal.get(row.id) ?? [];
  const summary = calculateDealFinancialSummary(
    {
      id: row.id,
      quotedAmount: row.quotedAmount,
      finalAmount: row.finalAmount,
      status: row.status as DealStatus,
      dueDate: row.dueDate,
      wonIstDate: row.wonIstDate,
    },
    payments,
    milestones,
    todayIstDate,
  );

  return {
    deal: toDealDto(row, milestones, summary),
    payments: payments.map(toPaymentDto),
  };
}

export async function getDealSummaryRecord(
  db: CrmDatabase,
  ownerUserId: string,
  dealId: string,
  options?: { now?: Date | undefined },
): Promise<DealFinancialSummaryDto> {
  const { deal } = await getDealRecord(db, ownerUserId, dealId, options);
  return deal.financialSummary;
}

async function cancelDealInsideTx(
  tx: CrmTransaction,
  params: {
    current: DealRow;
    ownerUserId: string;
    actorUserId: string;
    reason: string | null;
    now: Date;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{ deal: DealDto; auditEvent: FinanceEventDto }> {
  const { current, ownerUserId, actorUserId, reason, now } = params;
  if (current.status === "cancelled") {
    throw new CrmServiceError(409, "deal_already_cancelled", "Deal is already cancelled.", {
      conflict: {
        dealId: current.id,
        cancelledAt: current.cancelledAt,
        cancelReason: current.cancelReason,
      },
    });
  }

  const [milestoneRows, paymentRows] = await Promise.all([
    tx
      .select()
      .from(crmDealMilestones)
      .where(
        and(
          eq(crmDealMilestones.ownerUserId, ownerUserId),
          eq(crmDealMilestones.dealId, current.id),
        ),
      )
      .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
    tx
      .select()
      .from(crmPayments)
      .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, current.id)))
      .for("update"),
  ]);

  const nowStr = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;
  const beforeSummary = calculateDealFinancialSummary(
    {
      id: current.id,
      quotedAmount: current.quotedAmount,
      finalAmount: current.finalAmount,
      status: current.status as DealStatus,
      dueDate: current.dueDate,
      wonIstDate: current.wonIstDate,
    },
    paymentRows,
    milestoneRows,
    todayIstDate,
  );
  const beforeSnapshot = buildDealAuditSnapshot(current, beforeSummary);

  const nextVersion = current.version + 1;
  const patch = {
    status: "cancelled" as const,
    cancelledAt: nowStr,
    cancelledIstDate: todayIstDate,
    cancelledByUserId: actorUserId,
    cancelReason: reason,
    updatedByUserId: actorUserId,
    version: nextVersion,
    updatedAt: nowStr,
  };

  const updRes = await tx
    .update(crmDeals)
    .set(patch)
    .where(
      and(
        eq(crmDeals.id, current.id),
        eq(crmDeals.ownerUserId, ownerUserId),
        eq(crmDeals.version, current.version),
      ),
    );
  await assertDealRowUpdated(Promise.resolve(updRes), current.id);

  params.hooks?.afterPrimaryWrite?.();

  let leadActivityId: string | null = null;
  const activityText = reason
    ? `Deal cancelled: "${current.name}" — ${reason}`
    : `Deal cancelled: "${current.name}"`;

  if (current.leadId) {
    leadActivityId = generateServerId("act");
    await tx.insert(crmLeadActivities).values({
      id: leadActivityId,
      legacyId: null,
      ownerUserId,
      leadId: current.leadId,
      actorUserId,
      type: "payment",
      text: activityText,
      outcome: null,
      opId: null,
      idempotencyKey: null,
      occurredAt: nowStr,
      createdAt: nowStr,
    });
  }

  const updatedRow: DealRow = {
    ...current,
    ...patch,
  };
  const afterSummary = calculateDealFinancialSummary(
    {
      id: updatedRow.id,
      quotedAmount: updatedRow.quotedAmount,
      finalAmount: updatedRow.finalAmount,
      status: "cancelled",
      dueDate: updatedRow.dueDate,
      wonIstDate: updatedRow.wonIstDate,
    },
    paymentRows,
    milestoneRows,
    todayIstDate,
  );
  const afterSnapshot = buildDealAuditSnapshot(updatedRow, afterSummary);

  const eventRow: FinanceEventRow = {
    id: generateServerId("fin"),
    ownerUserId,
    dealId: current.id,
    paymentId: null,
    leadId: current.leadId,
    actorUserId,
    eventType: "deal.cancelled",
    summary: activityText,
    reason,
    amountSnapshot: current.finalAmount,
    beforeJson: JSON.stringify(beforeSnapshot),
    afterJson: JSON.stringify(afterSnapshot),
    leadActivityId,
    opId: null,
    occurredAt: nowStr,
    occurredIstDate: todayIstDate,
    createdAt: nowStr,
  };
  await tx.insert(crmFinanceEvents).values(eventRow);

  return {
    deal: toDealDto(updatedRow, milestoneRows, afterSummary),
    auditEvent: toFinanceEventDto(eventRow),
  };
}

export async function updateDealRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  dealId: string,
  input: UpdateDealInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; deal: DealDto; auditEvent: FinanceEventDto };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`deal:update:${dealId}`, input);

  return runWithIdempotency<{ ok: true; deal: DealDto; auditEvent: FinanceEventDto }>(
    db,
    { ownerUserId, scope: `deal:update:${dealId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");
      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Deal not found.");
      }

      if (current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Deal was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "deal",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      if (current.status === "cancelled") {
        if (input.status === "cancelled") {
          throw new CrmServiceError(409, "deal_already_cancelled", "Deal is already cancelled.", {
            conflict: { dealId: current.id, cancelledAt: current.cancelledAt },
          });
        }
        throw new CrmServiceError(
          409,
          "deal_cancelled",
          "Cancelled deals are locked and cannot be modified.",
          { conflict: { dealId: current.id, status: current.status } },
        );
      }

      // If transitioning solely to cancelled via PATCH, run safe cancellation flow.
      if (input.status === "cancelled") {
        const hasOtherFinancialEdits =
          input.name !== undefined ||
          input.clientName !== undefined ||
          input.quotedAmount !== undefined ||
          input.finalAmount !== undefined ||
          input.dueDate !== undefined ||
          input.milestones !== undefined;
        if (hasOtherFinancialEdits) {
          throw new CrmServiceError(
            400,
            "validation_error",
            "Cannot modify financial fields in the same request that cancels a deal.",
          );
        }
        const cancelled = await cancelDealInsideTx(tx, {
          current,
          ownerUserId,
          actorUserId,
          reason: input.cancelReason ?? null,
          now,
          hooks: options?.hooks,
        });
        return {
          status: 200,
          resourceId: dealId,
          body: { ok: true, ...cancelled },
        };
      }

      if (
        current.clientType === "crm" &&
        input.clientName !== undefined &&
        input.clientName !== current.clientName
      ) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "clientName on a CRM-linked deal is synchronized from its linked Lead.",
          { details: { clientName: "Update the linked Lead name instead." } },
        );
      }

      const [existingMilestones, paymentRows] = await Promise.all([
        tx
          .select()
          .from(crmDealMilestones)
          .where(
            and(
              eq(crmDealMilestones.ownerUserId, ownerUserId),
              eq(crmDealMilestones.dealId, dealId),
            ),
          )
          .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id))
          .for("update"),
        tx
          .select()
          .from(crmPayments)
          .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, dealId)))
          .for("update"),
      ]);

      const nowStr = toMysqlUtcDateTime(now);
      const todayIstDate = toIstParts(now).istDate;
      const beforeSummary = calculateDealFinancialSummary(
        {
          id: current.id,
          quotedAmount: current.quotedAmount,
          finalAmount: current.finalAmount,
          status: current.status as DealStatus,
          dueDate: current.dueDate,
          wonIstDate: current.wonIstDate,
        },
        paymentRows,
        existingMilestones,
        todayIstDate,
      );

      const nextFinalDecimal = input.finalAmount ?? current.finalAmount;
      const nextFinalPaise = decimalStringToPaise(nextFinalDecimal);
      if (nextFinalPaise < beforeSummary.collectedPaise) {
        throw new CrmServiceError(
          409,
          "deal_amount_below_collected",
          "Agreed deal finalAmount cannot be reduced below already collected payments.",
          {
            conflict: {
              dealId: current.id,
              collected: beforeSummary.collected,
              collectedDecimal: beforeSummary.collectedDecimal,
              attemptedFinalAmountDecimal: nextFinalDecimal,
            },
          },
        );
      }

      const effectiveMilestoneAmounts =
        input.milestones !== undefined
          ? input.milestones.map((m) => decimalStringToPaise(m.amount))
          : existingMilestones.map((m) => decimalStringToPaise(m.amount));
      if (
        effectiveMilestoneAmounts.length > 0 &&
        sumPaise(effectiveMilestoneAmounts) > nextFinalPaise
      ) {
        throw new CrmServiceError(
          400,
          "validation_error",
          "Total milestone amounts cannot exceed the agreed deal finalAmount.",
          { details: { milestones: "Reduce milestone amounts before lowering finalAmount." } },
        );
      }

      const nextStatus = input.status ?? (current.status as DealStatus);
      const nextVersion = current.version + 1;
      const patch = {
        name: input.name !== undefined ? input.name : current.name,
        clientName: input.clientName !== undefined ? input.clientName : current.clientName,
        company: input.company !== undefined ? input.company : current.company,
        phone: input.phone !== undefined ? input.phone : current.phone,
        quotedAmount: input.quotedAmount !== undefined ? input.quotedAmount : current.quotedAmount,
        finalAmount: nextFinalDecimal,
        status: nextStatus,
        dueDate: input.dueDate !== undefined ? input.dueDate : current.dueDate,
        notes: input.notes !== undefined ? input.notes : current.notes,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      const updRes = await tx
        .update(crmDeals)
        .set(patch)
        .where(
          and(
            eq(crmDeals.id, dealId),
            eq(crmDeals.ownerUserId, ownerUserId),
            eq(crmDeals.version, current.version),
          ),
        );
      await assertDealRowUpdated(Promise.resolve(updRes), dealId);

      options?.hooks?.afterPrimaryWrite?.();

      let nextMilestones: DealMilestoneRow[] = existingMilestones;
      if (input.milestones !== undefined) {
        await tx
          .delete(crmDealMilestones)
          .where(
            and(
              eq(crmDealMilestones.ownerUserId, ownerUserId),
              eq(crmDealMilestones.dealId, dealId),
            ),
          );
        nextMilestones = input.milestones.map((m, index) => ({
          id: generateServerId("ms"),
          legacyId: m.id ?? null,
          ownerUserId,
          dealId,
          label: m.label,
          amount: m.amount,
          dueDate: m.dueDate,
          sortOrder: index,
          createdAt: nowStr,
          updatedAt: nowStr,
        }));
        if (nextMilestones.length > 0) {
          await tx.insert(crmDealMilestones).values(nextMilestones);
        }
      }

      const updatedRow: DealRow = {
        ...current,
        ...patch,
      };
      const afterSummary = calculateDealFinancialSummary(
        {
          id: updatedRow.id,
          quotedAmount: updatedRow.quotedAmount,
          finalAmount: updatedRow.finalAmount,
          status: nextStatus,
          dueDate: updatedRow.dueDate,
          wonIstDate: updatedRow.wonIstDate,
        },
        paymentRows,
        nextMilestones,
        todayIstDate,
      );

      const onlyStatusChanged =
        input.status !== undefined &&
        input.status !== current.status &&
        input.name === undefined &&
        input.clientName === undefined &&
        input.company === undefined &&
        input.phone === undefined &&
        input.quotedAmount === undefined &&
        input.finalAmount === undefined &&
        input.dueDate === undefined &&
        input.milestones === undefined &&
        input.notes === undefined;

      const eventType = onlyStatusChanged ? "deal.status_changed" : "deal.updated";
      const summaryText = onlyStatusChanged
        ? `Deal "${updatedRow.name}" status changed from ${current.status} to ${nextStatus}`
        : `Deal "${updatedRow.name}" updated`;

      const eventRow: FinanceEventRow = {
        id: generateServerId("fin"),
        ownerUserId,
        dealId,
        paymentId: null,
        leadId: updatedRow.leadId,
        actorUserId,
        eventType,
        summary: summaryText,
        reason: null,
        amountSnapshot: updatedRow.finalAmount,
        beforeJson: JSON.stringify(buildDealAuditSnapshot(current, beforeSummary)),
        afterJson: JSON.stringify(buildDealAuditSnapshot(updatedRow, afterSummary)),
        leadActivityId: null,
        opId: null,
        occurredAt: nowStr,
        occurredIstDate: todayIstDate,
        createdAt: nowStr,
      };
      await tx.insert(crmFinanceEvents).values(eventRow);

      return {
        status: 200,
        resourceId: dealId,
        body: {
          ok: true,
          deal: toDealDto(updatedRow, nextMilestones, afterSummary),
          auditEvent: toFinanceEventDto(eventRow),
        },
      };
    },
  );
}

export async function changeDealStatusRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  dealId: string,
  input: ChangeDealStatusInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
) {
  if (input.status === "cancelled") {
    return cancelDealRecord(
      db,
      ownerUserId,
      actorUserId,
      dealId,
      {
        version: input.version,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      },
      options,
    );
  }
  return updateDealRecord(
    db,
    ownerUserId,
    actorUserId,
    dealId,
    {
      version: input.version,
      status: input.status,
      ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    },
    options,
  );
}

export async function cancelDealRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  dealId: string,
  input: CancelDealInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; deal: DealDto; auditEvent: FinanceEventDto };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`deal:cancel:${dealId}`, input);

  return runWithIdempotency<{ ok: true; deal: DealDto; auditEvent: FinanceEventDto }>(
    db,
    { ownerUserId, scope: `deal:cancel:${dealId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");
      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Deal not found.");
      }
      if (current.status === "cancelled") {
        throw new CrmServiceError(409, "deal_already_cancelled", "Deal is already cancelled.", {
          conflict: {
            dealId: current.id,
            cancelledAt: current.cancelledAt,
            cancelReason: current.cancelReason,
          },
        });
      }
      if (current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Deal was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "deal",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      const cancelled = await cancelDealInsideTx(tx, {
        current,
        ownerUserId,
        actorUserId,
        reason: input.reason ?? null,
        now,
        hooks: options?.hooks,
      });

      return {
        status: 200,
        resourceId: dealId,
        body: { ok: true, ...cancelled },
      };
    },
  );
}

export async function verifyDealWonDateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  dealId: string,
  input: VerifyDealWonDateInput,
  options?: {
    idempotencyKey?: string | null | undefined;
    now?: Date | undefined;
    hooks?: { afterPrimaryWrite?: () => void } | undefined;
  },
): Promise<{
  status: number;
  replayed: boolean;
  body: { ok: true; deal: DealDto; auditEvent: FinanceEventDto };
}> {
  const now = options?.now ?? new Date();
  const todayIstDate = toIstParts(now).istDate;
  if (input.wonDate > todayIstDate) {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Verified wonDate cannot be in the future.",
      { details: { wonDate: `Must be on or before ${todayIstDate}.` } },
    );
  }

  const idemKey = options?.idempotencyKey ?? null;
  const requestHash = hashIdempotentRequest(`deal:verify-won:${dealId}`, input);

  return runWithIdempotency<{ ok: true; deal: DealDto; auditEvent: FinanceEventDto }>(
    db,
    { ownerUserId, scope: `deal:verify-won:${dealId}`, idemKey, requestHash, now },
    async (tx) => {
      const rows = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
        .limit(1)
        .for("update");
      const current = rows[0];
      if (!current) {
        throw new CrmServiceError(404, "not_found", "Deal not found.");
      }
      if (current.status === "cancelled") {
        throw new CrmServiceError(
          409,
          "deal_cancelled",
          "Cannot verify wonDate on a cancelled deal.",
        );
      }
      if (current.wonAt !== null) {
        throw new CrmServiceError(
          409,
          "deal_won_date_already_set",
          "Deal already has a recorded wonAt date and cannot be overwritten.",
          { conflict: { dealId: current.id, wonIstDate: current.wonIstDate } },
        );
      }
      if (current.version !== input.version) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          "Deal was modified by another request; reload and retry.",
          {
            conflict: {
              resource: "deal",
              id: current.id,
              expectedVersion: input.version,
              currentVersion: current.version,
            },
          },
        );
      }

      const [milestoneRows, paymentRows] = await Promise.all([
        tx
          .select()
          .from(crmDealMilestones)
          .where(
            and(
              eq(crmDealMilestones.ownerUserId, ownerUserId),
              eq(crmDealMilestones.dealId, dealId),
            ),
          )
          .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
        tx
          .select()
          .from(crmPayments)
          .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, dealId))),
      ]);

      // Midday IST (12:00+05:30 = 06:30:00.000Z), matching analytics.ts `validWonDayInput`.
      const verifiedWonUtc = toMysqlUtcDateTime(new Date(`${input.wonDate}T06:30:00.000Z`));
      const nowStr = toMysqlUtcDateTime(now);
      const nextVersion = current.version + 1;

      const beforeSummary = calculateDealFinancialSummary(
        {
          id: current.id,
          quotedAmount: current.quotedAmount,
          finalAmount: current.finalAmount,
          status: current.status as DealStatus,
          dueDate: current.dueDate,
          wonIstDate: current.wonIstDate,
        },
        paymentRows,
        milestoneRows,
        todayIstDate,
      );

      const patch = {
        wonAt: verifiedWonUtc,
        wonIstDate: input.wonDate,
        wonDateVerifiedAt: nowStr,
        wonDateVerifiedByUserId: actorUserId,
        updatedByUserId: actorUserId,
        version: nextVersion,
        updatedAt: nowStr,
      };

      const updRes = await tx
        .update(crmDeals)
        .set(patch)
        .where(
          and(
            eq(crmDeals.id, dealId),
            eq(crmDeals.ownerUserId, ownerUserId),
            eq(crmDeals.version, current.version),
          ),
        );
      await assertDealRowUpdated(Promise.resolve(updRes), dealId);

      options?.hooks?.afterPrimaryWrite?.();

      const summaryText = `Verified won date recorded for "${current.name}": ${input.wonDate}`;
      let leadActivityId: string | null = null;
      if (current.leadId) {
        leadActivityId = generateServerId("act");
        await tx.insert(crmLeadActivities).values({
          id: leadActivityId,
          legacyId: null,
          ownerUserId,
          leadId: current.leadId,
          actorUserId,
          type: "edit",
          text: summaryText,
          outcome: null,
          opId: null,
          idempotencyKey: null,
          occurredAt: nowStr,
          createdAt: nowStr,
        });
      }

      const updatedRow: DealRow = { ...current, ...patch };
      const afterSummary = calculateDealFinancialSummary(
        {
          id: updatedRow.id,
          quotedAmount: updatedRow.quotedAmount,
          finalAmount: updatedRow.finalAmount,
          status: updatedRow.status as DealStatus,
          dueDate: updatedRow.dueDate,
          wonIstDate: updatedRow.wonIstDate,
        },
        paymentRows,
        milestoneRows,
        todayIstDate,
      );

      const eventRow: FinanceEventRow = {
        id: generateServerId("fin"),
        ownerUserId,
        dealId,
        paymentId: null,
        leadId: current.leadId,
        actorUserId,
        eventType: "deal.won_date_verified",
        summary: summaryText,
        reason: null,
        amountSnapshot: current.finalAmount,
        beforeJson: JSON.stringify(buildDealAuditSnapshot(current, beforeSummary)),
        afterJson: JSON.stringify(buildDealAuditSnapshot(updatedRow, afterSummary)),
        leadActivityId,
        opId: null,
        occurredAt: nowStr,
        occurredIstDate: todayIstDate,
        createdAt: nowStr,
      };
      await tx.insert(crmFinanceEvents).values(eventRow);

      return {
        status: 200,
        resourceId: dealId,
        body: {
          ok: true,
          deal: toDealDto(updatedRow, milestoneRows, afterSummary),
          auditEvent: toFinanceEventDto(eventRow),
        },
      };
    },
  );
}

export async function listDealAuditHistory(
  db: CrmDatabase,
  ownerUserId: string,
  dealId: string,
  query: ListDealAuditQuery,
): Promise<{
  items: FinanceEventDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const dealRows = await db
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
    .limit(1);
  if (!dealRows[0]) {
    throw new CrmServiceError(404, "not_found", "Deal not found.");
  }

  const conds = [
    eq(crmFinanceEvents.ownerUserId, ownerUserId),
    eq(crmFinanceEvents.dealId, dealId),
  ];
  if (query.eventType !== "all") {
    conds.push(eq(crmFinanceEvents.eventType, query.eventType));
  }

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmFinanceEvents)
    .where(and(...conds));
  const total = Number(countRows[0]?.count ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmFinanceEvents)
          .where(and(...conds))
          .orderBy(desc(crmFinanceEvents.occurredAt), desc(crmFinanceEvents.id))
          .limit(query.limit)
          .offset(query.offset);

  return {
    items: rows.map(toFinanceEventDto),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getOwnerFinanceSummary(
  db: CrmDatabase,
  ownerUserId: string,
  query: FinanceSummaryQuery,
  options?: { now?: Date | undefined },
): Promise<OwnerFinanceSummaryDto> {
  const now = options?.now ?? new Date();
  const todayIstDate = toIstParts(now).istDate;

  const [dealRows, paymentRows] = await Promise.all([
    db.select().from(crmDeals).where(eq(crmDeals.ownerUserId, ownerUserId)),
    db.select().from(crmPayments).where(eq(crmPayments.ownerUserId, ownerUserId)),
  ]);

  return calculateOwnerFinanceSummary({
    deals: dealRows.map((d) => ({
      id: d.id,
      quotedAmount: d.quotedAmount,
      finalAmount: d.finalAmount,
      status: d.status as DealStatus,
      dueDate: d.dueDate,
      wonIstDate: d.wonIstDate,
    })),
    payments: paymentRows.map((p) => ({
      id: p.id,
      dealId: p.dealId,
      amount: p.amount,
      paymentIstDate: p.paymentIstDate,
      voided: Boolean(p.voided),
    })),
    todayIstDate,
    periodFrom: query.from,
    periodTo: query.to,
  });
}
