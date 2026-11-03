import { describe, it, expect } from "vitest";
import { analyseFollowUps, istDay, THRESHOLDS } from "./smartFollowups";
import type { FollowUp, Lead, LeadActivity } from "@/lib/crm/types";

// 23:30 IST on 3 Nov 2026 = 18:00 UTC
const NOW = new Date("2026-11-03T18:00:00Z");
const L = (id: string, status: Lead["status"], p: Partial<Lead> = {}): Lead => ({ id, name: id, phone: "9000000000", source: "Website", status, priority: "warm", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", requirement: "Website", ...p });
const F = (id: string, leadId: string, dueAt: string, p: Partial<FollowUp> = {}): FollowUp => ({ id, leadId, type: "call", dueAt, ...p });
const A = (leadId: string, at: string): LeadActivity => ({ id: `a_${leadId}_${at}`, leadId, type: "call", text: "Call logged", at } as LeadActivity);

const leads = [L("over", "contacted"), L("today", "contacted"), L("future", "qualified"), L("done", "contacted"), L("qual", "qualified"), L("prop", "proposal"), L("won", "won"), (({ requirement: _r, ...x }) => x)(L("thin", "contacted")) as Lead];
const fus = [
  F("f1", "over", "2026-11-01T05:00:00Z"),
  F("f2", "today", "2026-11-03T18:20:00Z"), // 23:50 IST today
  F("f3", "future", "2026-11-03T18:40:00Z"), // 00:10 IST tomorrow
  F("f4", "done", "2026-11-01T05:00:00Z", { completedAt: "2026-11-03T06:00:00Z" }),
  F("f5", "over", "2026-11-05T05:00:00Z"), // second pending for same lead → must not duplicate
  F("f6", "qual", "2026-11-02T05:00:00Z", { cancelledAt: "2026-11-02T06:00:00Z" }),
];
const acts = [A("prop", "2026-10-20T05:00:00Z"), A("done", "2026-11-03T06:00:00Z"), A("qual", "2026-11-02T05:00:00Z")];
const r = analyseFollowUps(leads, fus, acts, NOW);
const g = (id: string) => r.recs.find((x) => x.leadId === id)?.group;

describe("AI-4A classification", () => {
  it("overdue / today / upcoming across the IST midnight boundary", () => {
    expect(g("over")).toBe("overdue"); expect(g("today")).toBe("today"); expect(g("future")).toBe("upcoming");
    expect(istDay("2026-11-03T18:40:00Z")).toBe("2026-11-04");
  });
  it("completed follow-up isn't overdue; lead without next action is flagged missing", () => expect(g("done")).toBe("missing"));
  it("cancelled follow-up isn't actionable; qualified without future follow-up → missing, high", () => {
    expect(g("qual")).toBe("missing"); expect(r.recs.find((x) => x.leadId === "qual")!.attention).toBe("high");
  });
  it(`proposal quiet ≥ ${THRESHOLDS.proposalStallDays} days → proposal review`, () => expect(g("prop")).toBe("proposal"));
  it("won lead without pending follow-up gets no pitch", () => expect(g("won")).toBeUndefined());
  it("thin lead is marked insufficient", () => expect(r.recs.find((x) => x.leadId === "thin")!.insufficient).toBe(true));
  it("future follow-up doesn't trigger a missing warning", () => expect(r.recs.filter((x) => x.leadId === "future").map((x) => x.group)).toEqual(["upcoming"]));
});

describe("AI-4A dedupe and counts", () => {
  it("one recommendation per lead", () => expect(new Set(r.recs.map((x) => x.leadId)).size).toBe(r.recs.length));
  it("summary counts follow-ups once", () => expect(r.summary).toEqual({ overdue: 1, dueToday: 1, completedToday: 1, leadsNeedingAttention: 6 }));
  it("does not mutate inputs", () => {
    const snap = JSON.stringify([leads, fus, acts]); analyseFollowUps(leads, fus, acts, NOW); expect(JSON.stringify([leads, fus, acts])).toBe(snap);
  });
});
