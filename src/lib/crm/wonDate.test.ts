import { beforeEach, describe, expect, it } from "vitest";
import { dealWonAt, financeKpis } from "./analytics";
import { financeSummary } from "./finance";
import { useCRM } from "./store";
import type { Deal, Payment } from "./types";

const deal = (id: string, amt: number, o: Partial<Deal> = {}): Deal => ({ id, clientType: "other", clientName: "T", name: id, quotedAmount: amt, finalAmount: amt, status: "active", milestones: [], createdAt: "2026-10-05T06:00:00Z", ...o });
const pay = (dealId: string, amount: number, voided = false): Payment => ({ id: `${dealId}-${amount}-${voided}`, dealId, amount, date: "2026-10-10", method: "UPI", type: "advance", voided });
const oct = { start: "2026-10-01", end: "2026-10-31" } as never;
const now = new Date("2026-10-24T10:00:00Z");

describe("historical won-date integrity", () => {
  beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); });

  it("a deal without wonAt has an unknown won date, never its creation date", () => {
    expect(dealWonAt(deal("L", 1000))).toBeUndefined();
  });
  it("legacy deal is in all-time totals but not in its creation month", () => {
    const deals = [deal("A", 40000, { wonAt: "2026-10-06T06:00:00Z" }), deal("L", 25000)];
    expect(financeKpis(deals, [], null, now).wonValue).toBe(65000);
    const k = financeKpis(deals, [], oct, now);
    expect(k.wonValue).toBe(40000);
    expect(k.unknownWonIds).toEqual(["L"]);
    expect(k.unknownWonValue).toBe(25000);
  });
  it("Deal A 40,000 + Deal B 30,000 with 4k+16k+30k valid and a voided 5k reconcile", () => {
    const deals = [deal("A", 40000, { wonAt: "2026-10-06T06:00:00Z" }), deal("B", 30000, { wonAt: "2026-10-07T06:00:00Z" })];
    const pays = [pay("A", 4000), pay("A", 16000), pay("A", 5000, true), pay("B", 30000)];
    const k = financeKpis(deals, pays, null, now); const f = financeSummary(deals, pays, now);
    expect([k.wonValue, k.received, k.outstanding]).toEqual([70000, 50000, 20000]);
    expect([f.totalValue, f.collected, f.outstanding]).toEqual([70000, 50000, 20000]);
  });
  it("Owner can record a verified won date once, with history; it then counts in that month", () => {
    const lead = useCRM.getState().leads[0]!;
    useCRM.setState({ deals: [deal("L", 25000, { leadId: lead.id })] });
    expect(useCRM.getState().setDealWonAt("L", "2026-10-12T06:00:00Z")).toBe(true);
    expect(useCRM.getState().setDealWonAt("L", "2026-10-15T06:00:00Z")).toBe(false);
    expect(useCRM.getState().deals[0]!.wonAt).toBe("2026-10-12T06:00:00.000Z");
    expect(useCRM.getState().activities.some((a) => a.leadId === lead.id && a.text.includes("Verified won date"))).toBe(true);
    expect(financeKpis(useCRM.getState().deals, [], oct, now).wonValue).toBe(25000);
  });
  it("rejects a future or invalid won date", () => {
    useCRM.setState({ deals: [deal("L", 25000)] });
    expect(useCRM.getState().setDealWonAt("L", "2099-01-01T00:00:00Z")).toBe(false);
    expect(useCRM.getState().setDealWonAt("L", "nope")).toBe(false);
    expect(useCRM.getState().deals[0]!.wonAt).toBeUndefined();
  });
});
