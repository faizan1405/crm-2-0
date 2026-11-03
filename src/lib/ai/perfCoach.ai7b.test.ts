// AI-7B — Owner AI Briefing & Performance Coach: period math, attribution, bottleneck rules,
// insufficient-data handling, lead association, no-mutation behavior.
import { describe, expect, it } from "vitest";
import { buildCoachReport, previousWindow, COACH_LABEL, type CoachInput } from "./perfCoach";
import { periodWindow } from "@/lib/crm/performance";
import type { ActivityEvent, EventType } from "@/lib/crm/activity";
import { OWNER_ACTOR_ID } from "@/lib/crm/activity";
import type { Deal, FollowUp, Lead } from "@/lib/crm/types";

const NOW = new Date("2026-11-04T10:00:00+05:30"); // Wednesday, IST
const DAY = "2026-11-04";
const iso = (day: string, h = 12) => `${day}T${String(h).padStart(2, "0")}:00:00+05:30`;

let seq = 0;
function ev(eventType: EventType, at: string, actor: string = OWNER_ACTOR_ID, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    eventId: `c:${++seq}`, eventType, actorUserId: actor, actorRole: "owner", actorName: actor,
    entityType: "lead", entityId: "L1", occurredAt: at, summary: `${eventType}`, module: "calls",
    importance: "normal", operationId: `cop:${seq}`, eventSource: "local", schemaVersion: 1, ...extra,
  };
}
const lead = (id: string, status: Lead["status"] = "new", extra: Partial<Lead> = {}): Lead => ({
  id, name: `Lead ${id}`, phone: "9000000000", source: "Website", status, priority: "warm", pinned: false,
  createdAt: iso(DAY, 8), updatedAt: iso(DAY, 8), ...extra,
});
const fu = (id: string, leadId: string, dueAt: string, completedAt?: string): FollowUp => ({ id, leadId, type: "call", dueAt, ...(completedAt ? { completedAt } : {}) });
const deal = (id: string, leadId: string, finalAmount: number, wonAt?: string): Deal => ({
  id, leadId, clientType: "crm", clientName: "C", name: "Deal", quotedAmount: finalAmount, finalAmount,
  status: "active", milestones: [], createdAt: wonAt ?? "2026-01-01T00:00:00Z", ...(wonAt ? { wonAt } : {}),
});

const input = (over: Partial<CoachInput> = {}): CoachInput => ({
  events: [], leads: [], followUps: [], deals: [], quotationShares: [], activities: [],
  goals: [], goalRevisions: [], employees: [], payments: [], ...over,
});
const today = () => periodWindow("today", NOW);

describe("AI-7B period math", () => {
  it("previousWindow returns the same-length window immediately before", () => {
    expect(previousWindow({ start: "2026-11-04", end: "2026-11-04" })).toEqual({ start: "2026-11-03", end: "2026-11-03" });
    expect(previousWindow({ start: "2026-11-02", end: "2026-11-08" })).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(previousWindow({ start: "2026-11-01", end: "2026-11-30" })).toEqual({ start: "2026-10-02", end: "2026-10-31" });
  });
  it("report carries the analyzed window and the Demo Mode label", () => {
    const r = buildCoachReport(input(), today(), NOW);
    expect(r.label).toBe(COACH_LABEL);
    expect(r.window).toEqual({ start: DAY, end: DAY });
    expect(r.lastDataAt).toBeNull();
  });
  it("lastDataAt is the latest recorded activity of any actor", () => {
    const r = buildCoachReport(input({ events: [ev("call.logged", iso(DAY, 9), "emp1"), ev("lead.created", iso(DAY, 11))] }), today(), NOW);
    expect(r.lastDataAt).toBe(iso(DAY, 11));
  });
});

describe("AI-7B attribution", () => {
  it("employee activity is never credited to the Owner in the briefing", () => {
    const events = Array.from({ length: 9 }, (_, i) => ev("call.logged", iso(DAY, 9 + (i % 8)), "emp1", { newValues: { outcome: "Not picked" } }));
    const r = buildCoachReport(input({ events }), today(), NOW);
    expect(r.summary.calls).toBe(0);
    expect(r.bottlenecks.find((b) => b.id === "low-connection")).toBeUndefined();
    expect(r.insufficient).toBe(true);
  });
  it("demo events never feed the coach", () => {
    const events = [ev("deal.won", iso(DAY), OWNER_ACTOR_ID, { eventSource: "demo", relatedLeadId: "L1" })];
    const r = buildCoachReport(input({ events, deals: [deal("D1", "L1", 50000, iso(DAY))] }), today(), NOW);
    expect(r.summary.dealsWon).toBe(0);
  });
});

describe("AI-7B bottleneck rules", () => {
  it("many calls with few connections is flagged only above the sample threshold", () => {
    const calls = (n: number) => Array.from({ length: n }, (_, i) => ev("call.logged", iso(DAY, 9 + (i % 8)), OWNER_ACTOR_ID, { newValues: { outcome: i === 0 ? "Connected" : "Not picked" } }));
    expect(buildCoachReport(input({ events: calls(8) }), today(), NOW).bottlenecks.map((b) => b.id)).toContain("low-connection");
    expect(buildCoachReport(input({ events: calls(5) }), today(), NOW).bottlenecks.map((b) => b.id)).not.toContain("low-connection");
  });
  it("connected calls without recorded next steps are flagged", () => {
    const events = [0, 1, 2].map((i) => ev("call.logged", iso(DAY, 9 + i), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } }));
    const r = buildCoachReport(input({ events, followUps: [fu("F1", "L1", iso(DAY, 18))] }), today(), NOW);
    expect(r.bottlenecks.map((b) => b.id)).toContain("no-next-steps");
  });
  it("three or more overdue follow-ups are flagged with the longest-waiting lead", () => {
    const followUps = [fu("F1", "L1", iso("2026-11-01", 10)), fu("F2", "L2", iso("2026-11-02", 10)), fu("F3", "L3", iso("2026-11-03", 10))];
    const leads = [lead("L1"), lead("L2"), lead("L3")];
    const r = buildCoachReport(input({ followUps, leads, events: [ev("lead.created", iso(DAY))] }), today(), NOW);
    const b = r.bottlenecks.find((x) => x.id === "many-overdue");
    expect(b).toBeDefined();
    expect(b!.leadId).toBe("L1");
  });
  it("qualified leads without a pending follow-up are flagged and linked", () => {
    const r = buildCoachReport(input({ leads: [lead("LQ", "qualified")], events: [ev("lead.created", iso(DAY))] }), today(), NOW);
    const b = r.bottlenecks.find((x) => x.id === "qualified-no-next");
    expect(b?.leadId).toBe("LQ");
  });
  it("stale proposals (7+ days without contact) are flagged", () => {
    const r = buildCoachReport(input({ leads: [lead("LP", "proposal", { lastContact: iso("2026-10-20") })], events: [ev("lead.created", iso(DAY))] }), today(), NOW);
    expect(r.bottlenecks.map((b) => b.id)).toContain("stale-proposals");
  });
  it("low conversion is flagged only with a meaningful sample", () => {
    const mk = (n: number) => ({
      leads: Array.from({ length: n }, (_, i) => lead(`C${i}`)),
      events: Array.from({ length: n }, (_, i) => ev("lead.created", iso(DAY, 8), OWNER_ACTOR_ID, { relatedLeadId: `C${i}` })),
    });
    expect(buildCoachReport(input(mk(12)), today(), NOW).bottlenecks.map((b) => b.id)).toContain("low-conversion");
    expect(buildCoachReport(input(mk(5)), today(), NOW).bottlenecks.map((b) => b.id)).not.toContain("low-conversion");
  });
  it("an empty period reports insufficient information, not judgments", () => {
    const r = buildCoachReport(input(), today(), NOW);
    expect(r.insufficient).toBe(true);
    expect(r.bottlenecks).toEqual([]);
    expect(r.recommendations).toEqual([]);
    expect(r.focus).toBeNull();
  });
});

describe("AI-7B recommendations, plan and coach", () => {
  it("recommendations are capped at three and link to the right lead", () => {
    const followUps = [fu("F1", "L1", iso("2026-11-01", 10))];
    const leads = [lead("L1"), lead("LQ", "qualified"), lead("LP", "proposal", { lastContact: iso("2026-10-15") })];
    const r = buildCoachReport(input({ followUps, leads, events: [ev("lead.created", iso(DAY))] }), today(), NOW);
    expect(r.recommendations.length).toBeLessThanOrEqual(3);
    expect(r.recommendations[0]!.leadId).toBe("L1");
    expect(r.focus).toBe(r.recommendations[0]!.label);
  });
  it("the daily plan lists overdue and today's commitments, never Won/Lost leads", () => {
    const leads = [lead("L1"), lead("L2"), lead("LW", "won"), lead("LL", "lost")];
    const followUps = [
      fu("F1", "L1", iso("2026-11-03", 10)),           // overdue
      fu("F2", "L2", iso(DAY, 15)),                     // today, future
      fu("F3", "LW", iso("2026-11-03", 10)),            // won — excluded
      fu("F4", "LL", iso(DAY, 16)),                     // lost — excluded
    ];
    const r = buildCoachReport(input({ leads, followUps, events: [ev("lead.created", iso(DAY))] }), today(), NOW);
    const ids = r.plan.map((p) => p.leadId);
    expect(ids).toContain("L1");
    expect(ids).toContain("L2");
    expect(ids).not.toContain("LW");
    expect(ids).not.toContain("LL");
    expect(r.plan.length).toBeLessThanOrEqual(5);
  });
  it("coach sections are grounded in records, never generic", () => {
    const events = [
      ev("call.logged", iso(DAY, 9), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } }),
      ev("deal.won", iso(DAY, 10), OWNER_ACTOR_ID, { relatedLeadId: "L1" }),
    ];
    const r = buildCoachReport(input({ events, deals: [deal("D1", "L1", 50000, iso(DAY))] }), today(), NOW);
    expect(r.coach.wentWell.some((t) => t.includes("1 call"))).toBe(true);
    expect(r.coach.wentWell.some((t) => t.includes("won 1 deal"))).toBe(true);
    expect(r.coach.wentWell.some((t) => /great job|keep it up/i.test(t))).toBe(false);
  });
});

describe("AI-7B comparison and targets", () => {
  it("previous period without activity is reported as unavailable, never invented", () => {
    const r = buildCoachReport(input({ events: [ev("call.logged", iso(DAY), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } })] }), today(), NOW);
    expect(r.comparison.available).toBe(false);
    expect(r.comparison.reason).toMatch(/no recorded activity/i);
  });
  it("comparison lines carry real numerators from both periods", () => {
    const events = [
      ev("call.logged", iso(DAY), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } }),
      ev("call.logged", iso("2026-11-03"), OWNER_ACTOR_ID, { newValues: { outcome: "Not picked" } }),
      ev("call.logged", iso("2026-11-03", 14), OWNER_ACTOR_ID, { newValues: { outcome: "Busy" } }),
    ];
    const r = buildCoachReport(input({ events }), today(), NOW);
    expect(r.comparison.available).toBe(true);
    expect(r.comparison.lines[0]).toBe("Calls: 1 vs 2 in the previous period.");
  });
  it("missing Owner targets show Target not configured", () => {
    expect(buildCoachReport(input(), today(), NOW).targets).toEqual({ configured: false, lines: [] });
  });
});

describe("AI-7B no-mutation behavior", () => {
  it("building a report never mutates its input", () => {
    const events = [ev("call.logged", iso(DAY), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } })];
    const leads = [lead("L1", "qualified")];
    const followUps = [fu("F1", "L1", iso("2026-11-01", 10))];
    const inp = input({ events, leads, followUps });
    const snapshot = JSON.parse(JSON.stringify(inp)) as unknown;
    buildCoachReport(inp, today(), NOW);
    expect(JSON.parse(JSON.stringify(inp))).toEqual(snapshot);
  });
});
