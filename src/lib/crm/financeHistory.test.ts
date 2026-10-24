import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { dealCollected } from "./finance";

beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); });
const lead = () => useCRM.getState().leads[0]!;
const book = (amt = 40000) => {
  useCRM.getState().addDeal({ leadId: lead().id, clientType: "crm", clientName: lead().name, name: "Hist Deal", quotedAmount: amt, finalAmount: amt, status: "active", milestones: [] });
  return useCRM.getState().deals.find((d) => d.name === "Hist Deal")!;
};
const rows = (t: string) => useCRM.getState().activities.filter((a) => a.leadId === lead().id && a.text.includes(t));

describe("financial client history", () => {
  it("booking a CRM deal adds exactly one 'Deal booked' entry", () => {
    book(); expect(rows("Deal booked")).toHaveLength(1);
  });
  it("voiding adds one entry, keeps the payment, and a second void adds nothing", () => {
    const d = book();
    useCRM.getState().addPayment({ dealId: d.id, amount: 5000, date: "2026-10-20", method: "UPI", type: "advance" }, "pv1");
    useCRM.getState().addPayment({ dealId: d.id, amount: 4000, date: "2026-10-20", method: "UPI", type: "advance" }, "pv2");
    useCRM.getState().voidPayment("pv1"); useCRM.getState().voidPayment("pv1");
    expect(rows("voided")).toHaveLength(1);
    expect(useCRM.getState().payments.find((p) => p.id === "pv1")?.voided).toBe(true);
    expect(useCRM.getState().payments.find((p) => p.id === "pv2")?.voided).toBeFalsy();
    expect(dealCollected(d.id, useCRM.getState().payments)).toBe(4000);
  });
  it("an Other-client deal (no lead) books without touching any client history", () => {
    const before = useCRM.getState().activities.length;
    useCRM.getState().addDeal({ clientType: "other", clientName: "X", name: "Y", quotedAmount: 1, finalAmount: 1, status: "active", milestones: [] });
    expect(useCRM.getState().activities.length).toBe(before);
  });
});

import { scopeWorkspace, FINANCE_REDACTED } from "./preview";
import { resolve } from "./access";
describe("employee financial privacy in client history", () => {
  const setup = () => {
    const d = book();
    useCRM.getState().addPayment({ dealId: d.id, amount: 4000, date: "2026-10-20", method: "UPI", type: "advance" }, "pp1");
    const s = useCRM.getState();
    return { ...s, assignments: { [lead().id]: { employeeId: "e1", assignedAt: "2026-10-20T00:00:00Z", source: "t", manual: true } } };
  };
  it("a salesperson with no finance access sees no amounts, deals or payments", () => {
    const w = scopeWorkspace(setup(), "e1", resolve("salesperson"));
    const money = w.activities.filter((a) => a.type === "payment");
    expect(money.length).toBeGreaterThan(0);
    expect(money.every((a) => a.text === FINANCE_REDACTED)).toBe(true);
    expect(w.deals).toEqual([]); expect(w.payments).toEqual([]);
  });
  it("an employee with amounts-level finance still sees the payment history text", () => {
    const eff = resolve("salesperson", { overrides: { "deals.view": true } as never, finance: "amounts", updatedAt: "" });
    const w = scopeWorkspace(setup(), "e1", eff);
    expect(w.activities.some((a) => a.text.includes("₹4,000"))).toBe(true);
  });
});
