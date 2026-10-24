// Phase 3H Part 7: cross-module consistency through the real store (isolated test fixtures).
import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { dealOutstanding } from "./finance";
import { workload } from "./bulk";

const s = () => useCRM.getState();
beforeEach(() => { localStorage.clear(); s().reset(); });
const newLead = () => s().addLead({ name: "XM Test", phone: "9123400001", source: "Other", status: "new", priority: "warm", pinned: false });

describe("cross-module consistency", () => {
  it("stage change is one record shared by Prospects and Pipeline, with one status activity", () => {
    const id = newLead();
    expect(s().updateLead(id, { status: "qualified" })).toBe(true);
    expect(s().leads.filter((l) => l.id === id)).toHaveLength(1);
    expect(s().leads.find((l) => l.id === id)?.status).toBe("qualified");
    expect(s().activities.filter((a) => a.leadId === id && a.type === "status")).toHaveLength(1);
  });

  it("scheduling and completing a follow-up updates the lead's next follow-up", () => {
    const id = newLead();
    const due = new Date(Date.now() + 864e5).toISOString();
    const r = s().addFollowUp({ leadId: id, type: "call", dueAt: due });
    expect(r.ok).toBe(true);
    expect(s().leads.find((l) => l.id === id)?.nextFollowUp).toBe(due);
    const f = s().followUps.find((x) => x.leadId === id)!;
    s().completeFollowUp(f.id);
    expect(s().followUps.find((x) => x.id === f.id)?.completedAt).toBeTruthy();
    expect(s().leads.find((l) => l.id === id)?.nextFollowUp).toBeUndefined();
  });

  it("a saved call appears once in that client's history only", () => {
    const id = newLead(); const other = s().leads.find((l) => l.id !== id)!;
    const r = s().logCall({ opId: "op-xm", leadId: id, outcome: "Interested", notes: "XM", stage: "new", lostReason: "", source: "CRM" } as never);
    expect(r.ok).toBe(true);
    expect(s().activities.filter((a) => a.leadId === id && a.type === "call")).toHaveLength(1);
    expect(s().activities.some((a) => a.leadId === other.id && a.opId === "op-xm")).toBe(false);
  });

  it("assignment updates workload; inactive employees cannot receive leads", () => {
    const id = newLead();
    const e = s().addEmployee({ name: "XM Emp", email: "xm@qa.test", roleId: "salesperson", accountStatus: "active" });
    if (!e.ok) throw new Error(e.error);
    expect(s().assignLeads([id], e.id, "test").ok).toBe(true);
    expect(workload(s().assignments)[e.id]).toBe(1);
    s().setEmployeeStatus(e.id, "inactive");
    expect(s().assignLeads([newLead()], e.id, "test").ok).toBe(false);
    expect(workload(s().assignments)[e.id]).toBe(1);
  });

  it("voided payments drop out of received and outstanding", () => {
    s().addDeal({ clientType: "other", clientName: "XM Client", name: "XM Deal", quotedAmount: 100000, finalAmount: 100000, status: "active", milestones: [] });
    const deal = s().deals[0]!;
    expect(deal.wonAt).toBeTruthy();
    s().addPayment({ dealId: deal.id, amount: 30000, date: "2026-10-01", method: "UPI", type: "advance" });
    s().addPayment({ dealId: deal.id, amount: 20000, date: "2026-10-02", method: "UPI", type: "milestone" });
    expect(dealOutstanding(deal, s().payments)).toBe(50000);
    const p = s().payments.find((x) => x.dealId === deal.id && x.amount === 20000)!;
    s().voidPayment(p.id);
    expect(dealOutstanding(deal, s().payments)).toBe(70000);
    expect(s().payments.filter((x) => x.dealId === deal.id)).toHaveLength(2);
  });
});
