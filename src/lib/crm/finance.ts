import type { Deal, Payment } from "./types";

/** Collected = sum of valid (non-voided) payments for the deal. */
export function dealCollected(dealId: string, payments: Payment[]) {
  return payments.filter((p) => p.dealId === dealId && !p.voided).reduce((s, p) => s + p.amount, 0);
}

/** Outstanding per deal = max(final amount - collected, 0). Cancelled deals owe nothing. */
export function dealOutstanding(deal: Deal, payments: Payment[]) {
  if (deal.status === "cancelled") return 0;
  return Math.max(deal.finalAmount - dealCollected(deal.id, payments), 0);
}

/** Overdue only when there is a real unpaid balance and a due date in the past. */
export function isDealOverdue(deal: Deal, payments: Payment[], now = new Date()) {
  if (!deal.dueDate) return false;
  return dealOutstanding(deal, payments) > 0 && new Date(deal.dueDate).getTime() < now.getTime();
}

export type PaymentStatus = "paid" | "partial" | "unpaid" | "overdue" | "cancelled";

export function dealPaymentStatus(deal: Deal, payments: Payment[], now = new Date()): PaymentStatus {
  if (deal.status === "cancelled") return "cancelled";
  const collected = dealCollected(deal.id, payments);
  if (collected >= deal.finalAmount && deal.finalAmount > 0) return "paid";
  if (isDealOverdue(deal, payments, now)) return "overdue";
  return collected > 0 ? "partial" : "unpaid";
}

export function financeSummary(deals: Deal[], payments: Payment[], now = new Date()) {
  const eligible = deals.filter((d) => d.status !== "cancelled");
  const eligibleIds = new Set(eligible.map((d) => d.id));
  const totalValue = eligible.reduce((s, d) => s + d.finalAmount, 0);
  const collected = payments
    .filter((p) => !p.voided && eligibleIds.has(p.dealId))
    .reduce((s, p) => s + p.amount, 0);
  const outstanding = eligible.reduce((s, d) => s + dealOutstanding(d, payments), 0);
  const overdue = eligible
    .filter((d) => isDealOverdue(d, payments, now))
    .reduce((s, d) => s + dealOutstanding(d, payments), 0);
  const collectionRate = totalValue > 0 ? collected / totalValue : null;
  return { totalValue, collected, outstanding, overdue, collectionRate };
}
