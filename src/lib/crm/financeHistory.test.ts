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
