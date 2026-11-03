import { describe, it, expect } from "vitest";
import { prepareCall, OBJECTIONS, objectionById, reviewResponse, suggestAfterCall, getCoachProvider, NOT_RECORDED, REVIEW_LIMITATION } from "./coach";
import type { LeadContext } from "./types";

const base = (over: Partial<LeadContext> = {}, facts: Partial<LeadContext["facts"]> = {}): LeadContext => ({
  leadId: "l1", name: "Asha", stage: "New", priority: "medium", source: "Website", recentActivity: [], pendingFollowUps: 0, excluded: [],
  ...over, facts: { statusKey: "new", hasEmail: true, callAttempts: 0, connectedCalls: 0, unsuccessfulStreak: 0, overdueFollowUp: false, ...facts },
});

describe("AI-3B call preparation", () => {
  it("uses only the selected lead and shows Not recorded instead of inventing", () => {
    const p = prepareCall(base());
    const v = Object.fromEntries(p.facts.map((f) => [f.label, f.value]));
    expect(v["Customer"]).toBe("Asha");
    expect(v["Company"]).toBe(NOT_RECORDED);
    expect(v["Requirements"]).toBe(NOT_RECORDED);
    expect(v["Previous call outcomes"]).toBe(NOT_RECORDED);
    expect(p.facts.every((f) => f.source === "crm")).toBe(true);
  });
  it("new lead: no budget question before discovery", () => {
    const p = prepareCall(base({ requirement: "New website" }));
    expect(p.questions.some((q) => q.theme === "budget_decision")).toBe(false);
    expect(p.questions.some((q) => q.theme === "urgency")).toBe(true);
  });
  it("qualified lead gets decision-process questions", () => {
    expect(prepareCall(base({ stage: "Qualified" }, { statusKey: "qualified" })).questions.some((q) => q.theme === "budget_decision")).toBe(true);
  });
  it("lists previous Not Picked outcomes and adjusts the objective", () => {
    const p = prepareCall(base({}, { callAttempts: 2, unsuccessfulStreak: 2, callOutcomes: ["Not picked", "Not picked"] }));
    expect(p.facts.find((f) => f.label === "Previous call outcomes")!.value).toBe("Not picked, Not picked");
    expect(p.objective.text).toMatch(/weren't answered/);
  });
  it("won lead gets no new sales pitch", () => {
    const p = prepareCall(base({ stage: "Won" }, { statusKey: "won" }));
    expect(p.noPitch).toBe(true); expect(p.missing).toEqual([]);
    expect(p.questions.some((q) => q.theme === "budget_decision" || q.theme === "problem")).toBe(false);
  });
});

describe("AI-3B objections", () => {
  it("has the 8 required categories with distinct responses", () => {
    expect(OBJECTIONS.map((o) => o.id)).toEqual(["price", "trust", "timing", "comparison", "no_urgency", "authority", "brush_off", "hidden"]);
    expect(new Set(OBJECTIONS.map((o) => o.response)).size).toBe(8);
    expect(OBJECTIONS.every((o) => o.source === "static_example")).toBe(true);
  });
  it("price response doesn't offer a discount", () => {
    expect(objectionById("price").response).not.toMatch(/discount|% off/i);
  });
});

describe("AI-3B response review is honest", () => {
  it("never claims real analysis and gives no score", () => {
    const r = reviewResponse("price", "Ok sir I will give 20% discount today only");
    expect(r.supported).toBe(false); expect(r.limitation).toBe(REVIEW_LIMITATION);
    expect(r.strengths).toEqual([]); expect(r.weaknesses).toEqual([]);
    expect(r.checks.find((c) => c.label.includes("discount"))!.ok).toBe(false);
    expect(r.checks.find((c) => c.label.includes("pressure"))!.ok).toBe(false);
  });
});

describe("AI-3B after call", () => {
  it("call me later → schedule follow-up", () => expect(suggestAfterCall(base({ requirement: "x" }), "Busy, call me next month").kind).toBe("schedule_followup"));
  it("price objection → review objection", () => expect(suggestAfterCall(base({ requirement: "x" }), "Said it's too expensive").kind).toBe("review_objection"));
  it("quote asked without requirement → ask requirements", () => expect(suggestAfterCall(base(), "wants a quotation").kind).toBe("ask_requirements"));
  it("quote asked with requirement → prepare quotation", () => expect(suggestAfterCall(base({ requirement: "5 page site" }), "wants a quotation").kind).toBe("prepare_quotation"));
  it("won lead → no action", () => expect(suggestAfterCall(base({}, { statusKey: "won" }), "wants a quotation").kind).toBe("none"));
});

describe("AI-3B no mutation", () => {
  it("provider is demo and doesn't modify the lead context", () => {
    const l = base({ requirement: "Site" }, { callOutcomes: ["Busy"] });
    const snap = JSON.stringify(l);
    const p = getCoachProvider();
    expect(p.live).toBe(false);
    p.run({ kind: "call_prep", lead: l }); p.run({ kind: "objection", lead: l, objection: "trust" });
    p.run({ kind: "response_review", lead: l, objection: "trust", draft: "hi?" }); p.run({ kind: "after_call", lead: l, summary: "send details on whatsapp" });
    expect(JSON.stringify(l)).toBe(snap);
  });
});
