import { describe, it, expect, vi } from "vitest";
import { buildLeadContext, scrubSecrets } from "./context";
import { demoProvider, getProvider } from "./demoProvider";
import type { PreviewSession } from "@/lib/crm/session";

const lead = (id: string, extra = {}) => ({ id, name: id.toUpperCase(), phone: "9", source: "Website", status: "new", priority: "high", pinned: false, createdAt: "2026-01-01", updatedAt: "2026-01-01", quotedAmount: 40000, notes: "password: hunter2 wants site", ...extra }) as never;
const src = {
  leads: [lead("a"), lead("b")],
  activities: [{ id: "x", leadId: "a", type: "payment", text: "Paid ₹4,000", at: "2026-01-02" }, { id: "y", leadId: "a", type: "call", text: "Called", at: "2026-01-03" }, { id: "z", leadId: "b", type: "call", text: "B call", at: "2026-01-03" }] as never[],
  followUps: [],
  deals: [{ id: "d", leadId: "a", finalAmount: 40000, status: "active" }] as never[],
  payments: [{ id: "p1", dealId: "d", amount: 20000 }, { id: "p2", dealId: "d", amount: 5000, voided: true }] as never[],
  assignments: { a: { employeeId: "e1" }, b: { employeeId: "e2" } },
};
const emp = (finance: PreviewSession["finance"], leadScope: PreviewSession["leadScope"] = "assigned"): PreviewSession => ({ employeeId: "e1", name: "E", roleLabel: "r", allowed: ["leads.view"], leadScope, finance, startedAt: "" });

describe("AI-1 context permissions", () => {
  it("Owner gets money with voided payments ignored", () => {
    const r = buildLeadContext(src, "a", null);
    expect(r.ok && r.lead.money).toEqual({ quotedOrBudget: 40000, dealsAgreed: 40000, received: 20000, outstanding: 20000 });
  });
  it("employee without amounts gets no money and no payment activity", () => {
    const r = buildLeadContext(src, "a", emp("none"));
    expect(r.ok && r.lead.money).toBeUndefined();
    expect(r.ok && r.lead.recentActivity).toEqual(["Called"]);
  });
  it("assigned-only employee cannot load another employee's lead", () => {
    expect(buildLeadContext(src, "b", emp("amounts"))).toEqual({ ok: false, reason: "not_permitted" });
  });
  it("only the selected lead's activity is included", () => {
    const r = buildLeadContext(src, "a", null);
    expect(r.ok && r.lead.recentActivity.includes("B call")).toBe(false);
  });
  it("credential-like text is masked", () => {
    expect(scrubSecrets("password: hunter2 ok")).toBe("[hidden] ok");
    const r = buildLeadContext(src, "a", null);
    expect(r.ok && r.lead.clientNotes).not.toContain("hunter2");
  });
});

describe("AI-1 demo provider", () => {
  it("is the active provider, labelled simulated, makes no network call", async () => {
    vi.useFakeTimers();
    const f = vi.spyOn(globalThis, "fetch");
    const r = buildLeadContext(src, "a", null);
    const p = getProvider().ask({ id: "r", module: "general", question: "Next step?", at: "", context: { ...(r.ok ? { lead: r.lead } : {}), viewer: { role: "owner", name: "O" } } });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(getProvider()).toBe(demoProvider);
    expect(res.simulated).toBe(true);
    expect(res.providerLabel).toMatch(/Demo Mode/);
    expect(f).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
