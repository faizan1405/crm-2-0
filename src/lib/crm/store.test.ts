import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useCRM, duplicatePhone } from "./store";
import { financeSummary, dealOutstanding } from "./finance";
import { paymentsToChase, buildPriorities } from "./insights";

beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); });
afterEach(() => vi.useRealTimers());
const first = () => {
  const lead = useCRM.getState().leads[0];
  if (!lead) throw new Error("Missing demo lead");
  return lead;
};
describe("CRM action and persistence contracts", () => {
  it("creates and reads a lead through the single store", () => {
    const id = useCRM.getState().addLead({ name: "Audit lead", phone: "9876543210", source: "Other", status: "new", priority: "warm", pinned: false });
    expect(useCRM.getState().leads.find((l) => l.id === id)?.name).toBe("Audit lead");
    expect(useCRM.getState().activities.some((a) => a.leadId === id)).toBe(true);
  });
  it("detects duplicate phones regardless of country prefix", () => {
    const lead = first();
    expect(duplicatePhone([lead], lead.phone.replace(/\D/g, "").slice(-10))?.id).toBe(lead.id);
    expect(duplicatePhone([lead], "123")).toBeUndefined();
  });
  it("rejects duplicate editing and preserves the original lead", () => {
    const lead = first(); const other = useCRM.getState().leads[1];
    if (!other) throw new Error("Missing second lead");
    expect(useCRM.getState().updateLead(lead.id, { phone: other.phone })).toBe(false);
    expect(first().phone).toBe(lead.phone);
  });
  it("requires Lost Reason and preserves state for rejected transitions", () => {
    const lead = first();
    expect(useCRM.getState().updateLead(lead.id, { status: "lost", lostReason: "" })).toBe(false);
    expect(first().status).toBe(lead.status);
    expect(useCRM.getState().updateLead(lead.id, { status: "lost", lostReason: "Budget too low" })).toBe(true);
    expect(first().lostReason).toBe("Budget too low");
    useCRM.getState().updateLead(lead.id, { status: "qualified" });
    expect(first().lostReason).toBeUndefined();
  });
  it("keeps edited client names consistent in multiple linked deals", () => {
    const lead = first();
    for (const name of ["Audit A", "Audit B"]) useCRM.getState().addDeal({ leadId: lead.id, clientType: "crm", clientName: lead.name, name, quotedAmount: 100, finalAmount: 100, status: "active", milestones: [] });
    useCRM.getState().updateLead(lead.id, { name: "Edited client" });
    expect(useCRM.getState().deals.filter((d) => d.name.startsWith("Audit ")).map((d) => d.clientName)).toEqual(["Edited client", "Edited client"]);
  });
  it("scheduling, rescheduling and completion keep the active date on the lead", () => {
    const id = first().id; useCRM.setState({ followUps: [] });
    const r = useCRM.getState().addFollowUp({ leadId: id, type: "call", dueAt: "2026-10-21T10:00:00Z" });
    if (!r.ok) throw new Error("schedule failed");
    useCRM.getState().rescheduleFollowUp(r.id, "2026-10-23T10:00:00Z");
    expect(first().nextFollowUp).toBe("2026-10-23T10:00:00Z");
    useCRM.getState().completeFollowUp(r.id);
    expect(first().nextFollowUp).toBeUndefined();
    expect(first().lastContact).toBeDefined();
  });
  it("rejects cumulative overpayment and voids amounts across summaries and chase", () => {
    useCRM.setState({ deals: [], payments: [] });
    useCRM.getState().addDeal({ clientType: "other", clientName: "Independent", name: "Audit", quotedAmount: 100000, finalAmount: 100000, status: "active", milestones: [], dueDate: "2026-01-01" });
    const deal = useCRM.getState().deals[0]; if (!deal) throw new Error("Missing deal");
    const pay = (amount: number) => useCRM.getState().addPayment({ dealId: deal.id, amount, date: "2026-10-21", method: "UPI", type: "advance" });
    expect(pay(40000)).toBe(true); expect(pay(30000)).toBe(true); expect(pay(30001)).toBe(false);
    expect(financeSummary([deal], useCRM.getState().payments).collected).toBe(70000);
    expect(pay(30000)).toBe(true); expect(paymentsToChase([deal], useCRM.getState().payments)).toEqual([]);
    const payment = useCRM.getState().payments[0]; if (!payment) throw new Error("Missing payment");
    useCRM.getState().voidPayment(payment.id);
    expect(dealOutstanding(deal, useCRM.getState().payments)).toBe(30000);
    expect(paymentsToChase([deal], useCRM.getState().payments)[0]?.due).toBe(30000);
    expect(financeSummary([deal], useCRM.getState().payments).collected).toBe(70000);
  });
  it("persists local changes and reads them back after rehydration", async () => {
    const id = first().id; useCRM.getState().updateLead(id, { name: "Persisted name" });
    const saved = localStorage.getItem("scale-flow-crm-2-demo");
    useCRM.setState({ leads: [] });
    if (!saved) throw new Error("Missing saved state");
    localStorage.setItem("scale-flow-crm-2-demo", saved);
    await useCRM.persist.rehydrate();
    expect(useCRM.getState().leads.find((l) => l.id === id)?.name).toBe("Persisted name");
  });
  it("keeps briefing checks only on the same business day", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    useCRM.getState().toggleBriefing("lead:one");
    expect(useCRM.getState().briefingDone).toEqual(["lead:one"]);
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    useCRM.getState().toggleBriefing("lead:two");
    expect(useCRM.getState().briefingDone).toEqual(["lead:two"]);
    expect(useCRM.getState().briefingDate).toBe("2026-10-22");
  });
  it("does not report a proposal as lacking a plan when an upcoming follow-up exists", () => {
    const lead = { ...first(), status: "proposal" as const };
    expect(buildPriorities([lead], [{ id: "f", leadId: lead.id, type: "call", dueAt: "2026-10-25T10:00:00Z" }], new Date("2026-10-21T10:00:00Z"))).toEqual([]);
  });
});