import { describe, expect, it } from "vitest";
import { buildDealContext, collectionPriorities, demoReminder, explainFinances, reminderViolations, reviewRecords, NO_DATE } from "./financeAssist";
import type { Deal, Payment } from "@/lib/crm/types";

const now = new Date("2026-11-03T10:00:00Z");
const D = (id: string, amt: number, o: { [K in keyof Deal]?: Deal[K] | undefined } = {}): Deal => ({ id, clientType: "other", clientName: `${id.toUpperCase()} Client`, name: `Deal ${id}`, quotedAmount: amt, finalAmount: amt, status: "active", milestones: [], createdAt: "2026-11-01T05:00:00Z", wonAt: "2026-11-01T05:00:00Z", ...o } as Deal);
const P = (id: string, dealId: string, amount: number, o: Partial<Payment> = {}): Payment => ({ id, dealId, amount, date: "2026-11-02", method: "UPI", type: "advance", reference: id, ...o } as Deal);
const deals = [D("a", 40000), D("b", 30000), D("c", 25000, { wonAt: undefined })];
const pays = [P("p1", "a", 4000), P("p2", "a", 16000, { date: "2026-11-03" }), P("p3", "a", 5000, { voided: true }), P("p4", "b", 30000)];
const r = (id: string, purpose: Parameters<typeof demoReminder>[0]["purpose"]) => demoReminder({ ctx: buildDealContext(deals.find((d) => d.id === id)!, pays, now), purpose, tone: "professional", lang: "en", variant: 0, priorReminder: false });

describe("AI-6C finance assistant", () => {
  it("totals match the brief's scenarios and exclude voided payments", () => {
    const a = buildDealContext(deals[0]!, pays, now);
    expect([a.received, a.outstanding, a.voided.amount]).toEqual([20000, 20000, 5000]);
    const e = explainFinances(deals, pays, now);
    expect([e.booked, e.collected, e.outstanding, e.voidedAmount]).toEqual([95000, 50000, 45000, 5000]);
    expect(e.fullyPaid).toEqual(["Deal b"]); expect(e.partial).toEqual(["Deal a"]); expect(e.noPayment).toEqual(["Deal c"]);
  });
  it("legacy deals with no won date are not placed in the month", () => {
    const e = explainFinances(deals, pays, now);
    expect(e.thisMonth.booked).toBe(70000); expect(e.thisMonth.unknownWonValue).toBe(25000);
  });
  it("fully paid deals get no balance reminders and are not prioritised", () => {
    expect(r("b", "balance").blocked).toBe(true); expect(r("b", "initial").blocked).toBe(true);
    expect(collectionPriorities(deals, pays, now).map((x) => x.dealId)).not.toContain("b");
  });
  it("outstanding without a due date is never overdue", () => {
    const it = collectionPriorities(deals, pays, now).find((x) => x.dealId === "a")!;
    expect(it.ctx.overdue).toBe(false); expect(it.reason).toContain(NO_DATE);
    expect(reminderViolations(it.ctx, "", "Hi A, your payment is overdue.").join(" ")).toMatch(/overdue/);
  });
  it("reminder carries exact amounts and blocks altered figures", () => {
    const x = r("a", "balance"); const c = buildDealContext(deals[0]!, pays, now);
    expect(x.text).toContain("₹20,000"); expect(x.text).toContain("₹40,000");
    expect(reminderViolations(c, "", x.text)).toEqual([]);
    expect(reminderViolations(c, "", x.text.replace("₹20,000.", "₹18,000.")).join(" ")).toMatch(/18000/);
    expect(reminderViolations(c, "", x.text + " A 10% discount and late fee apply, refund possible.").length).toBeGreaterThan(2);
    expect(reminderViolations(c, "", x.text + " Your deal is fully paid.").join(" ")).toMatch(/fully paid/);
  });
  it("thank-you needs a recorded payment; milestone needs a recorded milestone", () => {
    expect(r("c", "thanks").blocked).toBe(true); expect(r("c", "milestone").blocked).toBe(true);
    expect(reminderViolations(buildDealContext(deals[2]!, pays, now), "", "Hi C, we received your payment.").join(" ")).toMatch(/none is recorded/);
  });
  it("record review flags duplicates and missing won dates without changing data", () => {
    const ps = [...pays, P("p5", "a", 4000)]; const before = JSON.stringify([deals, ps]);
    const f = reviewRecords(deals, ps, [], now).map((x) => x.title).join(" | ");
    expect(f).toMatch(/duplicate-looking/); expect(f).toMatch(/Won date not recorded — Deal c/);
    expect(JSON.stringify([deals, ps])).toBe(before);
  });
  it("deal context contains no phone or notes", () => {
    const c = buildDealContext(D("z", 1000, { phone: "9999999999", notes: "secret" }), [], now);
    expect(JSON.stringify(c)).not.toMatch(/9999999999|secret/);
  });
});
