import { describe, it, expect } from "vitest";
import { analyzeLead } from "./intelligence";
import { buildLeadContext } from "./context";
import type { LeadContext } from "./types";
import type { PreviewSession } from "@/lib/crm/session";

const NOW = new Date("2026-11-03T10:00:00Z");
const base = (over: Partial<LeadContext> = {}, facts: Partial<LeadContext["facts"]> = {}): LeadContext => ({
  leadId: "l", name: "Test", stage: "New", priority: "medium", source: "Website", recentActivity: [], pendingFollowUps: 0, excluded: [],
  ...over, facts: { statusKey: "new", hasEmail: true, callAttempts: 0, connectedCalls: 0, unsuccessfulStreak: 0, overdueFollowUp: false, ...facts },
});

describe("AI-2 prioritisation", () => {
  it("new lead without contact → medium, call first", () => {
    const a = analyzeLead(base({ requirement: "Website" }), NOW);
    expect(a.attention).toBe("medium"); expect(a.primary.kind).toBe("call");
  });
  it("overdue follow-up → high, call", () => {
    const a = analyzeLead(base({ stage: "Contacted", requirement: "x" }, { statusKey: "contacted", overdueFollowUp: true, nextFollowUpDue: "2026-11-01T00:00:00Z", callAttempts: 1, connectedCalls: 1, lastActivityAt: "2026-10-30T00:00:00Z" }), NOW);
    expect(a.attention).toBe("high"); expect(a.primary.kind).toBe("call");
  });
  it("qualified without next follow-up → high, schedule", () => {
    const a = analyzeLead(base({ stage: "Qualified", requirement: "x" }, { statusKey: "qualified", callAttempts: 1, connectedCalls: 1, lastActivityAt: "2026-11-02T00:00:00Z" }), NOW);
    expect(a.attention).toBe("high"); expect(a.primary.kind).toBe("schedule_followup");
  });
  it("proposal with 7+ quiet days → high", () => {
    const a = analyzeLead(base({ stage: "Proposal Sent", requirement: "x" }, { statusKey: "proposal", nextFollowUpDue: "2026-11-10T00:00:00Z", callAttempts: 1, connectedCalls: 1, lastActivityAt: "2026-10-25T00:00:00Z" }), NOW);
    expect(a.attention).toBe("high"); expect(a.signals.map((s) => s.id)).toContain("proposal_stall");
  });
  it("won lead → low, no action", () => {
    const a = analyzeLead(base({ stage: "Won" }, { statusKey: "won" }), NOW);
    expect(a.attention).toBe("low"); expect(a.primary.kind).toBe("none");
  });
  it("contacted lead with nothing recorded → insufficient information", () => {
    const a = analyzeLead(base({ stage: "Contacted" }, { statusKey: "contacted", hasEmail: false }), NOW);
    expect(a.attention).toBe("insufficient");
    expect(a.facts.find((f) => f.label === "Latest interaction")?.value).toBe("Not enough information");
  });
  it("high quoted value alone is not buying intent", () => {
    const a = analyzeLead(base({ requirement: "x", money: { quotedOrBudget: 9_000_000, dealsAgreed: 0, received: 0, outstanding: 0 } }), NOW);
    expect(a.intent).toEqual(["Not enough information"]); expect(a.attention).not.toBe("high");
  });
  it("2 unanswered calls in a row → change approach, not call again", () => {
    const a = analyzeLead(base({ requirement: "x" }, { callAttempts: 2, unsuccessfulStreak: 2 }), NOW);
    expect(a.primary.kind).toBe("schedule_followup");
  });
});

describe("AI-2 permission safety", () => {
  const src = {
    leads: [{ id: "a", name: "A", phone: "9", source: "Website", status: "proposal", priority: "high", pinned: false, createdAt: "", updatedAt: "", quotedAmount: 50000 }] as never[],
    activities: [{ id: "p", leadId: "a", type: "payment", text: "Paid ₹1", at: "2026-11-01" }] as never[],
    followUps: [], deals: [], payments: [],
    assignments: { a: { employeeId: "e1" } } as Record<string, { employeeId: string | null }>,
  };
  const emp: PreviewSession = { employeeId: "e1", name: "E", roleLabel: "r", allowed: ["leads.view"], leadScope: "assigned", finance: "none", startedAt: "" };
  it("no-finance employee: analysis shows no opportunity amount", () => {
    const r = buildLeadContext(src, "a", emp, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(analyzeLead(r.lead, NOW).facts.some((f) => f.label === "Opportunity")).toBe(false);
  });
  it("revoked assignment blocks analysis immediately", () => {
    expect(buildLeadContext({ ...src, assignments: { a: { employeeId: "e2" } } }, "a", emp, NOW)).toEqual({ ok: false, reason: "not_permitted" });
  });
});

describe("AI-2 regression: no duplicate alternatives", () => {
  it("thin lead lists each alternative once", () => {
    const a = analyzeLead(base({ stage: "New" }, { hasEmail: false }), NOW);
    const kinds = a.alternatives.map((x) => x.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
