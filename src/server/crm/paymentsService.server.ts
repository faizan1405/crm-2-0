import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { generateServerId } from "../auth/security.server";
import type { CrmDatabase } from "../db/index.server";
import {
  MAX_DECIMAL_15_2_PAISE,
  decimalStringToPaise,
  formatInrFromPaise,
  outstandingPaise,
  paiseToDecimalString,
  paiseToRupees,
  sumPaise,
} from "../db/money.server";
import {
  crmDealMilestones,
  crmDeals,
  crmFinanceEvents,
  crmLeadActivities,
  crmPaymentProofs,
  crmPayments,
} from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import { calculateDealFinancialSummary, type DealFinancialSummaryDto } from "./financeCalc.server";
import { hashIdempotentRequest, runWithIdempotency } from "./idempotency.server";
import {
  toFinanceEventDto,
  toPaymentDto,
  type FinanceEventDto,
  type FinanceEventRow,
  type PaymentDto,
  type PaymentRow,
} from "./mappers.server";
import type {
  CreatePaymentInput,
  DealStatus,
  ListDealPaymentsQuery,
  ListPaymentsQuery,
  VoidPaymentInput,
} from "./validation.server";

async function assertRowUpdated(
  resultPromise: Promise<unknown>,
  resource: "deal" | "payment",
  id: string,
): Promise<void> {
  const raw = await resultPromise;
  const header = Array.isArray(raw) ? (raw[0] as { affectedRows?: number } | undefined) : undefined;
  if (header && typeof header.affectedRows === "number" && header.affectedRows === 0) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      `${resource === "deal" ? "Deal" : "Payment"} was modified concurrently; reload and retry.`,
      { conflict: { resource, id } },
    );
  }
}

/**
 * Records a manual Owner-entered Payment inside an InnoDB transaction:
 * 1. Authenticated Owner verified by caller.
 * 2. Begins transaction via `runWithIdempotency`.
 * 3. Locks target Deal row (`SELECT ... FOR UPDATE`).
 * 4. Validates Deal state (not cancelled; optional `expectedDealVersion` match).
 * 5. Enforces request idempotency (`crm_idempotency_keys` + `op_id`).
 * 6. Locks & sums non-voided payments in exact integer paise.
 * 7. Validates positive exact INR amount (`1` paisa .. `MAX_DECIMAL_15_2_PAISE`).
 * 8. Rejects overpayment (`collectedPaise + amountPaise > finalAmountPaise`).
 * 9. Inserts `crm_payments` and increments `crm_deals.version`.
 * 10. Inserts `crm_finance_events` (+ paired `crm_lead_activities` when `deal.leadId` exists).
 * 11. Commits atomically.
 */
export async function createPaymentRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  dealId: string,
  input: CreatePaymentInput,
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
    payment: PaymentDto;
    dealSummary: DealFinancialSummaryDto;
    dealVersion: number;
    auditEvent: FinanceEventDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const scope = `payment:create:${dealId}`;
  const requestHash = hashIdempotentRequest(scope, { dealId, ...input });

  return runWithIdempotency<{
    ok: true;
    payment: PaymentDto;
    dealSummary: DealFinancialSummaryDto;
    dealVersion: number;
    auditEvent: FinanceEventDto;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    // Step 3: Lock the corresponding Deal row using `SELECT ... FOR UPDATE`.
    const dealRows = await tx
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    const deal = dealRows[0];
    if (!deal) {
      throw new CrmServiceError(404, "not_found", "Deal not found.");
    }

    // Step 4: Validate Deal state & optional optimistic version guard.
    if (deal.status === "cancelled") {
      throw new CrmServiceError(
        409,
        "deal_cancelled",
        "Cannot record a payment on a cancelled deal.",
        { conflict: { dealId: deal.id, status: deal.status } },
      );
    }
    if (input.expectedDealVersion !== undefined && deal.version !== input.expectedDealVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Deal was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "deal",
            id: deal.id,
            expectedVersion: input.expectedDealVersion,
            currentVersion: deal.version,
          },
        },
      );
    }

    // Step 5: Secondary `opId` uniqueness guard across payments for this Owner.
    if (input.opId) {
      const existingOp = await tx
        .select()
        .from(crmPayments)
        .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.opId, input.opId)))
        .limit(1)
        .for("update");
      if (existingOp[0]) {
        throw new CrmServiceError(
          409,
          "payment_op_conflict",
          "opId was already used to record another payment.",
          { conflict: { paymentId: existingOp[0].id, opId: input.opId } },
        );
      }
    }

    // Step 6: Lock existing Deal payments (`FOR UPDATE` ensures current read in InnoDB)
    // and compute already-collected total in exact integer paise.
    const [existingPayments, milestoneRows] = await Promise.all([
      tx
        .select()
        .from(crmPayments)
        .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, deal.id)))
        .for("update"),
      tx
        .select()
        .from(crmDealMilestones)
        .where(
          and(
            eq(crmDealMilestones.ownerUserId, ownerUserId),
            eq(crmDealMilestones.dealId, deal.id),
          ),
        )
        .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
    ]);

    const alreadyCollectedPaise = sumPaise(
      existingPayments.filter((p) => !p.voided).map((p) => decimalStringToPaise(p.amount)),
    );

    // Step 7: Defensive exact-paise check on payment amount.
    const amountPaise = decimalStringToPaise(input.amount);
    if (
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      amountPaise > MAX_DECIMAL_15_2_PAISE
    ) {
      throw new CrmServiceError(
        400,
        "validation_error",
        "Payment amount must be greater than ₹0 and within DECIMAL(15,2) bounds.",
      );
    }

    // Step 8: Prevent collected amount from exceeding the agreed Deal finalAmount.
    const finalAmountPaise = decimalStringToPaise(deal.finalAmount);
    const remainingBeforePaise = outstandingPaise(finalAmountPaise, alreadyCollectedPaise);
    if (alreadyCollectedPaise + amountPaise > finalAmountPaise) {
      throw new CrmServiceError(
        409,
        "overpayment",
        remainingBeforePaise === 0
          ? "Deal is already paid in full."
          : `Payment of ${formatInrFromPaise(amountPaise)} exceeds remaining outstanding balance of ${formatInrFromPaise(remainingBeforePaise)}.`,
        {
          conflict: {
            dealId: deal.id,
            finalAmount: paiseToRupees(finalAmountPaise),
            finalAmountDecimal: deal.finalAmount,
            collected: paiseToRupees(alreadyCollectedPaise),
            collectedDecimal: paiseToDecimalString(alreadyCollectedPaise),
            outstanding: paiseToRupees(remainingBeforePaise),
            outstandingDecimal: paiseToDecimalString(remainingBeforePaise),
            attemptedAmount: paiseToRupees(amountPaise),
            attemptedAmountDecimal: input.amount,
          },
        },
      );
    }

    const nowStr = toMysqlUtcDateTime(now);
    const todayIstDate = toIstParts(now).istDate;
    const paymentIstDate = input.date ?? todayIstDate;

    const beforeSummary = calculateDealFinancialSummary(
      {
        id: deal.id,
        quotedAmount: deal.quotedAmount,
        finalAmount: deal.finalAmount,
        status: deal.status as DealStatus,
        dueDate: deal.dueDate,
        wonIstDate: deal.wonIstDate,
      },
      existingPayments,
      milestoneRows,
      todayIstDate,
    );

    // Step 9: Insert `crm_payments` row and bump `crm_deals.version`.
    const paymentId = generateServerId("pay");
    const paymentRow: PaymentRow = {
      id: paymentId,
      legacyId: null,
      ownerUserId,
      dealId: deal.id,
      amount: input.amount,
      paymentIstDate,
      method: input.method,
      paymentType: input.type,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      status: "posted",
      voided: false,
      voidedAt: null,
      voidedIstDate: null,
      voidedByUserId: null,
      voidReason: null,
      opId: input.opId ?? null,
      idempotencyKey: idemKey,
      recordedByUserId: actorUserId,
      updatedByUserId: actorUserId,
      version: 1,
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    try {
      await tx.insert(crmPayments).values(paymentRow);
    } catch (err) {
      if (isMysqlDuplicateKeyError(err)) {
        throw new CrmServiceError(
          409,
          "payment_op_conflict",
          "Duplicate payment operation key detected.",
        );
      }
      throw err;
    }

    const nextDealVersion = deal.version + 1;
    const dealUpd = await tx
      .update(crmDeals)
      .set({
        updatedByUserId: actorUserId,
        version: nextDealVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmDeals.id, deal.id),
          eq(crmDeals.ownerUserId, ownerUserId),
          eq(crmDeals.version, deal.version),
        ),
      );
    await assertRowUpdated(Promise.resolve(dealUpd), "deal", deal.id);

    // Internal hook strictly used in live MariaDB transaction rollback tests; never exposed over HTTP.
    options?.hooks?.afterPrimaryWrite?.();

    // Step 10: Insert paired Lead activity (when CRM-linked) + financial audit event.
    const activityText = `Payment of ${formatInrFromPaise(amountPaise)} recorded`;
    let leadActivityId: string | null = null;
    if (deal.leadId) {
      leadActivityId = generateServerId("act");
      await tx.insert(crmLeadActivities).values({
        id: leadActivityId,
        legacyId: null,
        ownerUserId,
        leadId: deal.leadId,
        actorUserId,
        type: "payment",
        text: activityText,
        outcome: null,
        opId: input.opId ?? null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      });
    }

    const afterSummary = calculateDealFinancialSummary(
      {
        id: deal.id,
        quotedAmount: deal.quotedAmount,
        finalAmount: deal.finalAmount,
        status: deal.status as DealStatus,
        dueDate: deal.dueDate,
        wonIstDate: deal.wonIstDate,
      },
      [...existingPayments, paymentRow],
      milestoneRows,
      todayIstDate,
    );

    const eventRow: FinanceEventRow = {
      id: generateServerId("fin"),
      ownerUserId,
      dealId: deal.id,
      paymentId,
      leadId: deal.leadId,
      actorUserId,
      eventType: "payment.recorded",
      summary: `${activityText} on "${deal.name}" (${input.method})`,
      reason: null,
      amountSnapshot: input.amount,
      beforeJson: JSON.stringify({
        collected: beforeSummary.collectedDecimal,
        outstanding: beforeSummary.outstandingDecimal,
        paymentStatus: beforeSummary.paymentStatus,
      }),
      afterJson: JSON.stringify({
        paymentId,
        amount: input.amount,
        date: paymentIstDate,
        method: input.method,
        type: input.type,
        reference: input.reference ?? null,
        collected: afterSummary.collectedDecimal,
        outstanding: afterSummary.outstandingDecimal,
        paymentStatus: afterSummary.paymentStatus,
      }),
      leadActivityId,
      opId: input.opId ?? null,
      occurredAt: nowStr,
      occurredIstDate: todayIstDate,
      createdAt: nowStr,
    };
    await tx.insert(crmFinanceEvents).values(eventRow);

    // Step 11: Return for atomic transaction commit + idempotency persistence.
    return {
      status: 201,
      resourceId: paymentId,
      body: {
        ok: true,
        payment: toPaymentDto(paymentRow),
        dealSummary: afterSummary,
        dealVersion: nextDealVersion,
        auditEvent: toFinanceEventDto(eventRow),
      },
    };
  });
}

export async function listPaymentsForDeal(
  db: CrmDatabase,
  ownerUserId: string,
  dealId: string,
  query: ListDealPaymentsQuery,
  options?: { now?: Date | undefined },
): Promise<{
  items: PaymentDto[];
  total: number;
  limit: number;
  offset: number;
  dealSummary: DealFinancialSummaryDto;
}> {
  const now = options?.now ?? new Date();
  const todayIstDate = toIstParts(now).istDate;

  const dealRows = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.ownerUserId, ownerUserId)))
    .limit(1);
  const deal = dealRows[0];
  if (!deal) {
    throw new CrmServiceError(404, "not_found", "Deal not found.");
  }

  const [allDealPayments, milestoneRows] = await Promise.all([
    db
      .select()
      .from(crmPayments)
      .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, dealId)))
      .orderBy(desc(crmPayments.paymentIstDate), desc(crmPayments.createdAt), desc(crmPayments.id)),
    db
      .select()
      .from(crmDealMilestones)
      .where(
        and(eq(crmDealMilestones.ownerUserId, ownerUserId), eq(crmDealMilestones.dealId, dealId)),
      )
      .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
  ]);

  const dealSummary = calculateDealFinancialSummary(
    {
      id: deal.id,
      quotedAmount: deal.quotedAmount,
      finalAmount: deal.finalAmount,
      status: deal.status as DealStatus,
      dueDate: deal.dueDate,
      wonIstDate: deal.wonIstDate,
    },
    allDealPayments,
    milestoneRows,
    todayIstDate,
  );

  const filtered = allDealPayments.filter((p) => {
    if (!query.includeVoided && p.voided) return false;
    if (query.method !== "all" && p.method !== query.method) return false;
    if (query.type !== "all" && p.paymentType !== query.type) return false;
    if (query.dateFrom && p.paymentIstDate < query.dateFrom) return false;
    if (query.dateTo && p.paymentIstDate > query.dateTo) return false;
    return true;
  });

  const total = filtered.length;
  const pagedRows = filtered.slice(query.offset, query.offset + query.limit);
  const paymentIds = pagedRows.map((p) => p.id);

  const proofRows =
    paymentIds.length === 0
      ? []
      : await db
          .select()
          .from(crmPaymentProofs)
          .where(
            and(
              eq(crmPaymentProofs.ownerUserId, ownerUserId),
              inArray(crmPaymentProofs.paymentId, paymentIds),
              isNotNull(crmPaymentProofs.activePaymentLock),
            ),
          );

  const proofMap = new Map(proofRows.map((p) => [p.paymentId, p]));
  const items = pagedRows.map((p) => toPaymentDto(p, proofMap.get(p.id) ?? null));

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
    dealSummary,
  };
}

export async function listAllPayments(
  db: CrmDatabase,
  ownerUserId: string,
  query: ListPaymentsQuery,
): Promise<{
  items: PaymentDto[];
  total: number;
  limit: number;
  offset: number;
}> {
  const conds = [eq(crmPayments.ownerUserId, ownerUserId)];
  if (query.dealId) {
    conds.push(eq(crmPayments.dealId, query.dealId));
  }
  if (!query.includeVoided) {
    conds.push(eq(crmPayments.voided, false));
  }
  if (query.method !== "all") {
    conds.push(eq(crmPayments.method, query.method));
  }
  if (query.type !== "all") {
    conds.push(eq(crmPayments.paymentType, query.type));
  }
  if (query.dateFrom) {
    conds.push(gte(crmPayments.paymentIstDate, query.dateFrom));
  }
  if (query.dateTo) {
    conds.push(lte(crmPayments.paymentIstDate, query.dateTo));
  }

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmPayments)
    .where(and(...conds));
  const total = Number(countRows[0]?.count ?? 0);

  const rows =
    total === 0
      ? []
      : await db
          .select()
          .from(crmPayments)
          .where(and(...conds))
          .orderBy(
            desc(crmPayments.paymentIstDate),
            desc(crmPayments.createdAt),
            desc(crmPayments.id),
          )
          .limit(query.limit)
          .offset(query.offset);

  const paymentIds = rows.map((p) => p.id);
  const proofRows =
    paymentIds.length === 0
      ? []
      : await db
          .select()
          .from(crmPaymentProofs)
          .where(
            and(
              eq(crmPaymentProofs.ownerUserId, ownerUserId),
              inArray(crmPaymentProofs.paymentId, paymentIds),
              isNotNull(crmPaymentProofs.activePaymentLock),
            ),
          );

  const proofMap = new Map(proofRows.map((p) => [p.paymentId, p]));
  const items = rows.map((p) => toPaymentDto(p, proofMap.get(p.id) ?? null));

  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getPaymentRecord(
  db: CrmDatabase,
  ownerUserId: string,
  paymentId: string,
): Promise<PaymentDto> {
  const [paymentRows, proofRows] = await Promise.all([
    db
      .select()
      .from(crmPayments)
      .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
      .limit(1),
    db
      .select()
      .from(crmPaymentProofs)
      .where(
        and(
          eq(crmPaymentProofs.ownerUserId, ownerUserId),
          eq(crmPaymentProofs.paymentId, paymentId),
          eq(crmPaymentProofs.activePaymentLock, paymentId),
        ),
      )
      .limit(1),
  ]);
  const row = paymentRows[0];
  if (!row) {
    throw new CrmServiceError(404, "not_found", "Payment not found.");
  }
  return toPaymentDto(row, proofRows[0] ?? null);
}

/**
 * Voids an existing Payment inside an InnoDB transaction:
 * - Requires explicit non-empty `reason`.
 * - Locks both Payment and parent Deal rows (`SELECT ... FOR UPDATE`).
 * - Rejects double-voiding (`409 payment_already_voided`) while allowing exact idempotency-key replay.
 * - Never deletes the row and never alters the original `amount`.
 * - Appends `crm_finance_events` (`payment.voided`) + paired `crm_lead_activities` (`type = 'payment'`).
 * - Recalculates Deal balances immediately in exact integer paise.
 */
export async function voidPaymentRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  paymentId: string,
  input: VoidPaymentInput,
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
    payment: PaymentDto;
    dealSummary: DealFinancialSummaryDto;
    dealVersion: number;
    auditEvent: FinanceEventDto;
  };
}> {
  const now = options?.now ?? new Date();
  const idemKey = options?.idempotencyKey ?? null;
  const scope = `payment:void:${paymentId}`;
  const requestHash = hashIdempotentRequest(scope, { paymentId, ...input });

  return runWithIdempotency<{
    ok: true;
    payment: PaymentDto;
    dealSummary: DealFinancialSummaryDto;
    dealVersion: number;
    auditEvent: FinanceEventDto;
  }>(db, { ownerUserId, scope, idemKey, requestHash, now }, async (tx) => {
    const payRows = await tx
      .select()
      .from(crmPayments)
      .where(and(eq(crmPayments.id, paymentId), eq(crmPayments.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    const payment = payRows[0];
    if (!payment) {
      throw new CrmServiceError(404, "not_found", "Payment not found.");
    }

    if (payment.voided || payment.status === "voided") {
      throw new CrmServiceError(409, "payment_already_voided", "Payment is already voided.", {
        conflict: {
          paymentId: payment.id,
          voidedAt: payment.voidedAt,
          voidReason: payment.voidReason,
        },
      });
    }

    if (input.expectedVersion !== undefined && payment.version !== input.expectedVersion) {
      throw new CrmServiceError(
        409,
        "stale_conflict",
        "Payment was modified by another request; reload and retry.",
        {
          conflict: {
            resource: "payment",
            id: payment.id,
            expectedVersion: input.expectedVersion,
            currentVersion: payment.version,
          },
        },
      );
    }

    const dealRows = await tx
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, payment.dealId), eq(crmDeals.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    const deal = dealRows[0];
    if (!deal) {
      throw new CrmServiceError(404, "not_found", "Parent deal not found.");
    }

    const [allDealPayments, milestoneRows] = await Promise.all([
      tx
        .select()
        .from(crmPayments)
        .where(and(eq(crmPayments.ownerUserId, ownerUserId), eq(crmPayments.dealId, deal.id)))
        .for("update"),
      tx
        .select()
        .from(crmDealMilestones)
        .where(
          and(
            eq(crmDealMilestones.ownerUserId, ownerUserId),
            eq(crmDealMilestones.dealId, deal.id),
          ),
        )
        .orderBy(asc(crmDealMilestones.sortOrder), asc(crmDealMilestones.id)),
    ]);

    const nowStr = toMysqlUtcDateTime(now);
    const todayIstDate = toIstParts(now).istDate;
    const beforeSummary = calculateDealFinancialSummary(
      {
        id: deal.id,
        quotedAmount: deal.quotedAmount,
        finalAmount: deal.finalAmount,
        status: deal.status as DealStatus,
        dueDate: deal.dueDate,
        wonIstDate: deal.wonIstDate,
      },
      allDealPayments,
      milestoneRows,
      todayIstDate,
    );

    const nextPaymentVersion = payment.version + 1;
    const voidPatch = {
      status: "voided" as const,
      voided: true,
      voidedAt: nowStr,
      voidedIstDate: todayIstDate,
      voidedByUserId: actorUserId,
      voidReason: input.reason,
      updatedByUserId: actorUserId,
      version: nextPaymentVersion,
      updatedAt: nowStr,
    };

    const payUpd = await tx
      .update(crmPayments)
      .set(voidPatch)
      .where(
        and(
          eq(crmPayments.id, payment.id),
          eq(crmPayments.ownerUserId, ownerUserId),
          eq(crmPayments.voided, false),
          eq(crmPayments.version, payment.version),
        ),
      );
    await assertRowUpdated(Promise.resolve(payUpd), "payment", payment.id);

    const nextDealVersion = deal.version + 1;
    const dealUpd = await tx
      .update(crmDeals)
      .set({
        updatedByUserId: actorUserId,
        version: nextDealVersion,
        updatedAt: nowStr,
      })
      .where(
        and(
          eq(crmDeals.id, deal.id),
          eq(crmDeals.ownerUserId, ownerUserId),
          eq(crmDeals.version, deal.version),
        ),
      );
    await assertRowUpdated(Promise.resolve(dealUpd), "deal", deal.id);

    options?.hooks?.afterPrimaryWrite?.();

    const amountPaise = decimalStringToPaise(payment.amount);
    const leadActivityText = `Payment of ${formatInrFromPaise(amountPaise)} voided on "${deal.name}" (kept in history, excluded from totals)`;
    let leadActivityId: string | null = null;
    if (deal.leadId) {
      leadActivityId = generateServerId("act");
      await tx.insert(crmLeadActivities).values({
        id: leadActivityId,
        legacyId: null,
        ownerUserId,
        leadId: deal.leadId,
        actorUserId,
        type: "payment",
        text: leadActivityText,
        outcome: null,
        opId: input.opId ?? null,
        idempotencyKey: null,
        occurredAt: nowStr,
        createdAt: nowStr,
      });
    }

    const updatedPaymentRow: PaymentRow = {
      ...payment,
      ...voidPatch,
    };
    const updatedPayments = allDealPayments.map((p) =>
      p.id === payment.id ? updatedPaymentRow : p,
    );
    const afterSummary = calculateDealFinancialSummary(
      {
        id: deal.id,
        quotedAmount: deal.quotedAmount,
        finalAmount: deal.finalAmount,
        status: deal.status as DealStatus,
        dueDate: deal.dueDate,
        wonIstDate: deal.wonIstDate,
      },
      updatedPayments,
      milestoneRows,
      todayIstDate,
    );

    const eventRow: FinanceEventRow = {
      id: generateServerId("fin"),
      ownerUserId,
      dealId: deal.id,
      paymentId: payment.id,
      leadId: deal.leadId,
      actorUserId,
      eventType: "payment.voided",
      summary: `${leadActivityText} — Reason: ${input.reason}`,
      reason: input.reason,
      amountSnapshot: payment.amount,
      beforeJson: JSON.stringify({
        paymentStatus: "posted",
        voided: false,
        amount: payment.amount,
        collected: beforeSummary.collectedDecimal,
        outstanding: beforeSummary.outstandingDecimal,
        dealPaymentStatus: beforeSummary.paymentStatus,
      }),
      afterJson: JSON.stringify({
        paymentStatus: "voided",
        voided: true,
        voidReason: input.reason,
        amount: payment.amount,
        collected: afterSummary.collectedDecimal,
        outstanding: afterSummary.outstandingDecimal,
        dealPaymentStatus: afterSummary.paymentStatus,
      }),
      leadActivityId,
      opId: input.opId ?? null,
      occurredAt: nowStr,
      occurredIstDate: todayIstDate,
      createdAt: nowStr,
    };
    await tx.insert(crmFinanceEvents).values(eventRow);

    return {
      status: 200,
      resourceId: payment.id,
      body: {
        ok: true,
        payment: toPaymentDto(updatedPaymentRow),
        dealSummary: afterSummary,
        dealVersion: nextDealVersion,
        auditEvent: toFinanceEventDto(eventRow),
      },
    };
  });
}
