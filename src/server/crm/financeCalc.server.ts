import "@tanstack/react-start/server-only";
import {
  decimalStringToPaise,
  outstandingPaise,
  paiseToDecimalString,
  paiseToRupees,
  sumPaise,
} from "../db/money.server";
import type { DealStatus, PaymentStatus } from "./validation.server";

export interface CalcMilestoneInput {
  id: string;
  label: string;
  amount: string;
  dueDate: string;
  sortOrder: number;
}

export interface CalcPaymentInput {
  id: string;
  dealId: string;
  amount: string;
  paymentIstDate: string;
  voided: boolean;
}

export interface CalcDealInput {
  id: string;
  quotedAmount: string;
  finalAmount: string;
  status: DealStatus;
  dueDate: string | null;
  wonIstDate: string | null;
}

export interface DealNextMilestoneDto {
  id: string;
  label: string;
  amount: number;
  amountDecimal: string;
  amountPaise: number;
  dueDate: string;
}

export interface DealFinancialSummaryDto {
  dealId: string;
  dealStatus: DealStatus;
  paymentStatus: PaymentStatus;
  isOverdue: boolean;
  dueDate: string | null;
  quotedAmount: number;
  quotedAmountDecimal: string;
  quotedAmountPaise: number;
  finalAmount: number;
  finalAmountDecimal: string;
  finalAmountPaise: number;
  collected: number;
  collectedDecimal: string;
  collectedPaise: number;
  realizedRevenue: number;
  realizedRevenueDecimal: string;
  realizedRevenuePaise: number;
  outstanding: number;
  outstandingDecimal: string;
  outstandingPaise: number;
  overdue: number;
  overdueDecimal: string;
  overduePaise: number;
  voidedAmount: number;
  voidedDecimal: string;
  voidedPaise: number;
  activePaymentCount: number;
  voidedPaymentCount: number;
  collectionRate: number | null;
  lastPaymentDate: string | null;
  nextMilestone: DealNextMilestoneDto | null;
}

/**
 * Authoritative IST business-day overdue check.
 *
 * Deliberate server precision rule:
 * - A Deal without `dueDate` is unpaid/partial, NEVER overdue (`finance.test.ts`).
 * - Cancelled or fully-paid deals (`outstandingPaise === 0`) are NEVER overdue.
 * - Unlike browser `new Date("YYYY-MM-DD")` (which parsed as 00:00Z = 05:30 AM IST),
 *   the server evaluates `dueDate < todayIstDate` in `Asia/Kolkata`, so a deal due on
 *   `2026-11-09` stays current throughout `2026-11-09` IST and becomes overdue at
 *   `2026-11-10T00:00:00+05:30`.
 */
export function isDealOverdueInIst(params: {
  status: DealStatus;
  dueDate: string | null;
  outstandingAmountPaise: number;
  todayIstDate: string;
}): boolean {
  if (params.status === "cancelled") return false;
  if (!params.dueDate) return false;
  if (params.outstandingAmountPaise <= 0) return false;
  return params.dueDate < params.todayIstDate;
}

export function computeDealPaymentStatus(params: {
  status: DealStatus;
  finalAmountPaise: number;
  collectedPaise: number;
  isOverdue: boolean;
}): PaymentStatus {
  if (params.status === "cancelled") return "cancelled";
  if (params.collectedPaise >= params.finalAmountPaise && params.finalAmountPaise > 0) {
    return "paid";
  }
  if (params.isOverdue) return "overdue";
  if (params.collectedPaise > 0) return "partial";
  return "unpaid";
}

/**
 * Computes authoritative per-Deal financial balances strictly in integer paise.
 */
export function calculateDealFinancialSummary(
  deal: CalcDealInput,
  payments: readonly CalcPaymentInput[],
  milestones: readonly CalcMilestoneInput[],
  todayIstDate: string,
): DealFinancialSummaryDto {
  const quotedAmountPaise = decimalStringToPaise(deal.quotedAmount);
  const finalAmountPaise = decimalStringToPaise(deal.finalAmount);

  const activePayments: CalcPaymentInput[] = [];
  const voidedPayments: CalcPaymentInput[] = [];
  for (const payment of payments) {
    if (payment.voided) {
      voidedPayments.push(payment);
    } else {
      activePayments.push(payment);
    }
  }

  const collectedPaise = sumPaise(activePayments.map((p) => decimalStringToPaise(p.amount)));
  const voidedPaise = sumPaise(voidedPayments.map((p) => decimalStringToPaise(p.amount)));

  // Cancelled deals exclude all figures from realized revenue, outstanding, and overdue.
  const realizedRevenuePaise = deal.status === "cancelled" ? 0 : collectedPaise;
  const remOutstandingPaise =
    deal.status === "cancelled" ? 0 : outstandingPaise(finalAmountPaise, collectedPaise);

  const isOverdue = isDealOverdueInIst({
    status: deal.status,
    dueDate: deal.dueDate,
    outstandingAmountPaise: remOutstandingPaise,
    todayIstDate,
  });

  const overduePaise = isOverdue ? remOutstandingPaise : 0;
  const paymentStatus = computeDealPaymentStatus({
    status: deal.status,
    finalAmountPaise,
    collectedPaise,
    isOverdue,
  });

  const collectionRate =
    deal.status === "cancelled" || finalAmountPaise === 0
      ? null
      : Math.min(1, collectedPaise / finalAmountPaise);

  let lastPaymentDate: string | null = null;
  for (const p of activePayments) {
    if (lastPaymentDate === null || p.paymentIstDate > lastPaymentDate) {
      lastPaymentDate = p.paymentIstDate;
    }
  }

  let nextMilestone: DealNextMilestoneDto | null = null;
  if (deal.status !== "cancelled" && remOutstandingPaise > 0 && milestones.length > 0) {
    const ordered = [...milestones].sort((a, b) => {
      const byDate = a.dueDate.localeCompare(b.dueDate);
      return byDate !== 0 ? byDate : a.sortOrder - b.sortOrder;
    });
    let cumulativePaise = 0;
    for (const ms of ordered) {
      const msPaise = decimalStringToPaise(ms.amount);
      cumulativePaise = sumPaise([cumulativePaise, msPaise]);
      if (cumulativePaise > collectedPaise) {
        nextMilestone = {
          id: ms.id,
          label: ms.label,
          amount: paiseToRupees(msPaise),
          amountDecimal: paiseToDecimalString(msPaise),
          amountPaise: msPaise,
          dueDate: ms.dueDate,
        };
        break;
      }
    }
  }

  return {
    dealId: deal.id,
    dealStatus: deal.status,
    paymentStatus,
    isOverdue,
    dueDate: deal.dueDate,
    quotedAmount: paiseToRupees(quotedAmountPaise),
    quotedAmountDecimal: paiseToDecimalString(quotedAmountPaise),
    quotedAmountPaise,
    finalAmount: paiseToRupees(finalAmountPaise),
    finalAmountDecimal: paiseToDecimalString(finalAmountPaise),
    finalAmountPaise,
    collected: paiseToRupees(collectedPaise),
    collectedDecimal: paiseToDecimalString(collectedPaise),
    collectedPaise,
    realizedRevenue: paiseToRupees(realizedRevenuePaise),
    realizedRevenueDecimal: paiseToDecimalString(realizedRevenuePaise),
    realizedRevenuePaise,
    outstanding: paiseToRupees(remOutstandingPaise),
    outstandingDecimal: paiseToDecimalString(remOutstandingPaise),
    outstandingPaise: remOutstandingPaise,
    overdue: paiseToRupees(overduePaise),
    overdueDecimal: paiseToDecimalString(overduePaise),
    overduePaise,
    voidedAmount: paiseToRupees(voidedPaise),
    voidedDecimal: paiseToDecimalString(voidedPaise),
    voidedPaise,
    activePaymentCount: activePayments.length,
    voidedPaymentCount: voidedPayments.length,
    collectionRate,
    lastPaymentDate,
    nextMilestone,
  };
}

export interface OwnerFinanceSummaryDto {
  todayIstDate: string;
  totals: {
    /** Sum of quotedAmount across non-cancelled deals. */
    quotedValue: number;
    quotedValueDecimal: string;
    quotedValuePaise: number;
    /** Agreed booked deal value (`financeSummary.totalValue` across non-cancelled deals). */
    totalValue: number;
    totalValueDecimal: string;
    totalValuePaise: number;
    /** Realized cash collected (`financeSummary.collected` — active payments on non-cancelled deals). */
    collected: number;
    collectedDecimal: string;
    collectedPaise: number;
    /** Remaining outstanding across non-cancelled deals (`financeSummary.outstanding`). */
    outstanding: number;
    outstandingDecimal: string;
    outstandingPaise: number;
    /** Overdue outstanding across non-cancelled deals with past IST dueDate (`financeSummary.overdue`). */
    overdue: number;
    overdueDecimal: string;
    overduePaise: number;
    collectionRate: number | null;
  };
  exclusions: {
    voidedPaymentCount: number;
    voidedAmount: number;
    voidedAmountDecimal: string;
    voidedAmountPaise: number;
    cancelledDealCount: number;
    cancelledBookedValue: number;
    cancelledBookedValueDecimal: string;
    cancelledBookedValuePaise: number;
    cancelledDealPaymentsExcluded: number;
    cancelledDealPaymentsExcludedDecimal: string;
    cancelledDealPaymentsExcludedPaise: number;
  };
  counts: {
    byDealStatus: Record<DealStatus | "total", number>;
    byPaymentStatus: Record<PaymentStatus, number>;
  };
  period: {
    from: string;
    to: string;
    wonCount: number;
    wonValue: number;
    wonValueDecimal: string;
    wonValuePaise: number;
    receivedCount: number;
    received: number;
    receivedDecimal: string;
    receivedPaise: number;
    /** Legacy non-cancelled deals missing `wonAt` — never fabricated into period `wonValue`. */
    unknownWonCount: number;
    unknownWonValue: number;
    unknownWonValueDecimal: string;
    unknownWonValuePaise: number;
  };
}

/**
 * Computes Owner-wide financial ledger totals matching `finance.ts` `financeSummary` and
 * `analytics.ts` `financeKpis`, strictly in integer paise.
 */
export function calculateOwnerFinanceSummary(params: {
  deals: readonly CalcDealInput[];
  payments: readonly CalcPaymentInput[];
  todayIstDate: string;
  periodFrom?: string | undefined;
  periodTo?: string | undefined;
}): OwnerFinanceSummaryDto {
  const { deals, payments, todayIstDate } = params;
  const periodFrom = params.periodFrom ?? `${todayIstDate.slice(0, 7)}-01`;
  const periodTo = params.periodTo ?? todayIstDate;

  const paymentsByDealId = new Map<string, CalcPaymentInput[]>();
  for (const p of payments) {
    const bucket = paymentsByDealId.get(p.dealId);
    if (bucket) bucket.push(p);
    else paymentsByDealId.set(p.dealId, [p]);
  }

  const byDealStatus: Record<DealStatus | "total", number> = {
    active: 0,
    completed: 0,
    on_hold: 0,
    cancelled: 0,
    total: deals.length,
  };
  const byPaymentStatus: Record<PaymentStatus, number> = {
    paid: 0,
    partial: 0,
    unpaid: 0,
    overdue: 0,
    cancelled: 0,
  };

  const nonCancelledSummaries: DealFinancialSummaryDto[] = [];
  const nonCancelledDealIds = new Set<string>();
  const cancelledBookedPaiseList: number[] = [];
  const cancelledExcludedPaymentPaiseList: number[] = [];

  const wonInPeriodPaiseList: number[] = [];
  let wonInPeriodCount = 0;
  const unknownWonPaiseList: number[] = [];
  let unknownWonCount = 0;

  for (const deal of deals) {
    byDealStatus[deal.status] += 1;
    const dealPayments = paymentsByDealId.get(deal.id) ?? [];
    const summary = calculateDealFinancialSummary(deal, dealPayments, [], todayIstDate);
    byPaymentStatus[summary.paymentStatus] += 1;

    if (deal.status === "cancelled") {
      cancelledBookedPaiseList.push(summary.finalAmountPaise);
      cancelledExcludedPaymentPaiseList.push(summary.collectedPaise);
      continue;
    }

    nonCancelledDealIds.add(deal.id);
    nonCancelledSummaries.push(summary);

    if (deal.wonIstDate === null) {
      unknownWonCount += 1;
      unknownWonPaiseList.push(summary.finalAmountPaise);
    } else if (deal.wonIstDate >= periodFrom && deal.wonIstDate <= periodTo) {
      wonInPeriodCount += 1;
      wonInPeriodPaiseList.push(summary.finalAmountPaise);
    }
  }

  const quotedValuePaise = sumPaise(nonCancelledSummaries.map((s) => s.quotedAmountPaise));
  const totalValuePaise = sumPaise(nonCancelledSummaries.map((s) => s.finalAmountPaise));
  const outstandingTotalPaise = sumPaise(nonCancelledSummaries.map((s) => s.outstandingPaise));
  const overdueTotalPaise = sumPaise(nonCancelledSummaries.map((s) => s.overduePaise));

  const realizedPaymentPaiseList: number[] = [];
  const voidedPaymentPaiseList: number[] = [];
  const periodReceivedPaiseList: number[] = [];

  for (const p of payments) {
    const pPaise = decimalStringToPaise(p.amount);
    if (p.voided) {
      voidedPaymentPaiseList.push(pPaise);
      continue;
    }
    if (!nonCancelledDealIds.has(p.dealId)) {
      continue;
    }
    realizedPaymentPaiseList.push(pPaise);
    if (p.paymentIstDate >= periodFrom && p.paymentIstDate <= periodTo) {
      periodReceivedPaiseList.push(pPaise);
    }
  }

  const collectedTotalPaise = sumPaise(realizedPaymentPaiseList);
  const voidedAmountPaise = sumPaise(voidedPaymentPaiseList);
  const cancelledBookedValuePaise = sumPaise(cancelledBookedPaiseList);
  const cancelledDealPaymentsExcludedPaise = sumPaise(cancelledExcludedPaymentPaiseList);
  const wonValuePaise = sumPaise(wonInPeriodPaiseList);
  const receivedPaise = sumPaise(periodReceivedPaiseList);
  const unknownWonValuePaise = sumPaise(unknownWonPaiseList);

  const collectionRate =
    totalValuePaise === 0 ? null : Math.min(1, collectedTotalPaise / totalValuePaise);

  return {
    todayIstDate,
    totals: {
      quotedValue: paiseToRupees(quotedValuePaise),
      quotedValueDecimal: paiseToDecimalString(quotedValuePaise),
      quotedValuePaise,
      totalValue: paiseToRupees(totalValuePaise),
      totalValueDecimal: paiseToDecimalString(totalValuePaise),
      totalValuePaise,
      collected: paiseToRupees(collectedTotalPaise),
      collectedDecimal: paiseToDecimalString(collectedTotalPaise),
      collectedPaise: collectedTotalPaise,
      outstanding: paiseToRupees(outstandingTotalPaise),
      outstandingDecimal: paiseToDecimalString(outstandingTotalPaise),
      outstandingPaise: outstandingTotalPaise,
      overdue: paiseToRupees(overdueTotalPaise),
      overdueDecimal: paiseToDecimalString(overdueTotalPaise),
      overduePaise: overdueTotalPaise,
      collectionRate,
    },
    exclusions: {
      voidedPaymentCount: voidedPaymentPaiseList.length,
      voidedAmount: paiseToRupees(voidedAmountPaise),
      voidedAmountDecimal: paiseToDecimalString(voidedAmountPaise),
      voidedAmountPaise,
      cancelledDealCount: cancelledBookedPaiseList.length,
      cancelledBookedValue: paiseToRupees(cancelledBookedValuePaise),
      cancelledBookedValueDecimal: paiseToDecimalString(cancelledBookedValuePaise),
      cancelledBookedValuePaise,
      cancelledDealPaymentsExcluded: paiseToRupees(cancelledDealPaymentsExcludedPaise),
      cancelledDealPaymentsExcludedDecimal: paiseToDecimalString(
        cancelledDealPaymentsExcludedPaise,
      ),
      cancelledDealPaymentsExcludedPaise,
    },
    counts: {
      byDealStatus,
      byPaymentStatus,
    },
    period: {
      from: periodFrom,
      to: periodTo,
      wonCount: wonInPeriodCount,
      wonValue: paiseToRupees(wonValuePaise),
      wonValueDecimal: paiseToDecimalString(wonValuePaise),
      wonValuePaise,
      receivedCount: periodReceivedPaiseList.length,
      received: paiseToRupees(receivedPaise),
      receivedDecimal: paiseToDecimalString(receivedPaise),
      receivedPaise,
      unknownWonCount,
      unknownWonValue: paiseToRupees(unknownWonValuePaise),
      unknownWonValueDecimal: paiseToDecimalString(unknownWonValuePaise),
      unknownWonValuePaise,
    },
  };
}
