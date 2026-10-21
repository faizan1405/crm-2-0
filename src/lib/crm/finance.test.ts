import { describe, expect, it } from "vitest";
import { dealOutstanding, financeSummary, isDealOverdue } from "./finance";
import type { Deal, Payment } from "./types";

const base = (o: Partial<Deal>): Deal => ({
  id: "d1",
  clientType: "other",
  clientName: "A",
  name: "P",
  quotedAmount: 100000,
  finalAmount: 100000,
  status: "active",
  milestones: [],
  createdAt: "2026-01-01",
  ...o,
});
const pay = (dealId: string, amount: number, voided = false): Payment => ({
  id: Math.random().toString(),
  dealId,
  amount,
  date: "2026-01-02",
  method: "UPI",
  type: "advance",
  voided,
});

describe("finance rules", () => {
  it("outstanding never goes below zero", () => {
    expect(dealOutstanding(base({}), [pay("d1", 120000)])).toBe(0);
  });

  it("voided payments are not counted as collected", () => {
    expect(dealOutstanding(base({}), [pay("d1", 40000), pay("d1", 30000, true)])).toBe(60000);
  });

  it("overdue requires an unpaid balance and a past due date", () => {
    const now = new Date("2026-06-01");
    expect(isDealOverdue(base({ dueDate: "2026-05-01" }), [pay("d1", 100000)], now)).toBe(false);
    expect(isDealOverdue(base({ dueDate: "2026-05-01" }), [pay("d1", 50000)], now)).toBe(true);
    expect(isDealOverdue(base({ dueDate: "2026-07-01" }), [], now)).toBe(false);
  });

  it("collection rate is collected divided by contracted value, excluding cancelled deals", () => {
    const deals = [base({ id: "a", finalAmount: 200000 }), base({ id: "b", finalAmount: 50000, status: "cancelled" })];
    const s = financeSummary(deals, [pay("a", 50000), pay("b", 10000)]);
    expect(s.totalValue).toBe(200000);
    expect(s.collected).toBe(50000);
    expect(s.outstanding).toBe(150000);
    expect(s.collectionRate).toBe(0.25);
  });

  it("collection rate is null when there is no contracted value", () => {
    expect(financeSummary([], []).collectionRate).toBeNull();
  });
  it("separates multiple deals for one client including an independent client", () => {
    const deals = [base({ id: "a", finalAmount: 100000 }), base({ id: "b", finalAmount: 200000 }), base({ id: "c", finalAmount: 50000, clientName: "Independent" })];
    const payments = [pay("a", 40000), pay("a", 10000), pay("b", 200000)];
    expect(financeSummary(deals, payments).collected).toBe(250000);
    expect(financeSummary(deals, payments).outstanding).toBe(100000);
    expect(dealOutstanding(deals[2] ?? base({}), payments)).toBe(50000);
  });
  it("a deal without a due date is unpaid but never overdue", () => {
    expect(isDealOverdue(base({}), [], new Date("2026-10-21"))).toBe(false);
    expect(dealOutstanding(base({}), [])).toBe(100000);
  });
});
