// AI-7A — Owner My Performance: attribution, counting rules, boundaries, zero denominators.
import { describe, expect, it } from "vitest";
import { ownerMetrics, ownerSeries, ownerTimeline, wonTrend, companyFinanceSnapshot, performanceSummary } from "./ownerPerformance";
import { periodWindow } from "./performance";
import type { ActivityEvent, EventType } from "./activity";
import { OWNER_ACTOR_ID } from "./activity";
import type { Deal, FollowUp, Lead } from "./types";
import type { QuotationShare } from "./studio";

const NOW = new Date("2026-11-04T10:00:00+05:30"); // a Wednesday in IST
const DAY = "2026-11-04";
const iso = (day: string, h = 12) => `${day}T${String(h).padStart(2, "0")}:00:00+05:30`;

let seq = 0;
function ev(eventType: EventType, at: string, actor: string = OWNER_ACTOR_ID, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    eventId: `t:${++seq}`, eventType, actorUserId: actor, actorRole: "owner", actorName: actor,
    entityType: "lead", entityId: "L1", occurredAt: at, summary: `${eventType}`, module: "calls",
    importance: "normal", operationId: `op:${seq}`, eventSource: "local", schemaVersion: 1, ...extra,
  };
}
const lead = (id: string, createdAt: string, status: Lead["status"] = "new"): Lead => ({
  id, name: `Lead ${id}`, phone: "9000000000", source: "Website", status, priority: "warm", pinned: false, createdAt, updatedAt: createdAt,
});
const fu = (id: string, dueAt: string, completedAt?: string): FollowUp => ({ id, leadId: "L1", type: "call", dueAt, ...(completedAt ? { completedAt } : {}) });
const deal = (id: string, leadId: string, finalAmount: number, wonAt?: string): Deal => ({
  id, leadId, clientType: "crm", clientName: "C", name: "Deal", quotedAmount: finalAmount, finalAmount,
  status: "active", milestones: [], createdAt: wonAt ?? "2026-01-01T00:00:00Z", ...(wonAt ? { wonAt } : {}),
});
const share = (id: string, createdAt: string, confirmed = true): QuotationShare => ({
  id, leadId: "L1", templateId: "T1", packageNameSnapshot: "P", priceSnapshot: "₹1", messageSnapshot: "m", userConfirmedSent: confirmed, createdAt,
});
const base = { events: [] as ActivityEvent[], leads: [] as Lead[], followUps: [] as FollowUp[], deals: [] as Deal[], quotationShares: [] as QuotationShare[] };

describe("AI-7A owner attribution", () => {
  it("counts only Owner events; other actors are reported separately, never credited", () => {
    const events = [
      ev("call.logged", iso(DAY), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } }),
      ev("call.logged", iso(DAY), "emp1", { newValues: { outcome: "Connected" } }),
      ev("call.logged", iso(DAY), "automation", { newValues: { outcome: "Connected" } }),
    ];
    const m = ownerMetrics({ ...base, events }, periodWindow("today", NOW), NOW);
    expect(m.calls).toBe(1);
    expect(m.connected).toBe(1);
    expect(m.unattributed).toBe(1); // emp1 only; automation is excluded from the warning
  });
  it("demo events never count", () => {
    const events = [ev("call.logged", iso(DAY), OWNER_ACTOR_ID, { eventSource: "demo", newValues: { outcome: "Connected" } })];
    expect(ownerMetrics({ ...base, events }, periodWindow("today", NOW), NOW).calls).toBe(0);
  });
});

describe("AI-7A call counting", () => {
  it("Not picked and Busy are attempts, never connected; reversals subtract", () => {
    const events = [
      ev("call.logged", iso(DAY, 9), OWNER_ACTOR_ID, { newValues: { outcome: "Not picked" } }),
      ev("call.logged", iso(DAY, 10), OWNER_ACTOR_ID, { newValues: { outcome: "Busy" } }),
      ev("call.logged", iso(DAY, 11), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } }),
      ev("call.reversed", iso(DAY, 12), OWNER_ACTOR_ID, { oldValues: { outcome: "Connected" } }),
    ];
    const m = ownerMetrics({ ...base, events }, periodWindow("today", NOW), NOW);
    expect(m.calls).toBe(2);
    expect(m.connected).toBe(0);
    expect(m.connectionRate).toBe(0);
  });
  it("zero calls → connection rate is null (N/A), never NaN or a fake 0%", () => {
    const m = ownerMetrics(base, periodWindow("today", NOW), NOW);
    expect(m.connectionRate).toBeNull();
    expect(m.winRate).toBeNull();
    expect(m.followUpRate).toBeNull();
  });
});

describe("AI-7A follow-ups and boundaries", () => {
  it("completed/due/overdue respect the IST window; cancelled never count", () => {
    const followUps = [
      fu("a", iso(DAY, 9), iso(DAY, 10)),           // due & done today
      fu("b", iso(DAY, 18)),                          // due today, still pending
      fu("c", iso("2026-11-01", 9)),                  // overdue (pending, past)
      { ...fu("d", iso(DAY, 9)), cancelledAt: iso(DAY, 8) }, // cancelled — excluded
    ];
    const events = [ev("followup.completed", iso(DAY, 10))];
    const m = ownerMetrics({ ...base, events, followUps }, periodWindow("today", NOW), NOW);
    expect(m.followUpsCompleted).toBe(1);
    expect(m.followUpsDue).toBe(2); // a + b (c is due outside today, d cancelled)
    expect(m.overdue).toBe(1);      // c only (b is due later today)
  });
  it("weeks run Monday–Sunday in Asia/Kolkata", () => {
    const w = periodWindow("thisWeek", NOW); // Wed 2026-11-04 IST
    expect(w).toEqual({ start: "2026-11-02", end: "2026-11-08" });
  });
  it("an event at 00:30 IST on the boundary day counts in that day, not the previous", () => {
    const events = [ev("call.logged", "2026-11-02T00:30:00+05:30", OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } })];
    const w = periodWindow("thisWeek", NOW);
    expect(ownerMetrics({ ...base, events }, w, NOW).calls).toBe(1);
    expect(ownerMetrics({ ...base, events }, periodWindow("lastWeek", NOW), NOW).calls).toBe(0);
  });
});

describe("AI-7A conversion and won value", () => {
  it("lead→Won uses only the Owner-created cohort of the window", () => {
    const events = [
      ev("lead.created", iso(DAY, 9), OWNER_ACTOR_ID, { relatedLeadId: "L1", entityId: "L1" }),
      ev("lead.created", iso(DAY, 9), "emp1", { relatedLeadId: "L2", entityId: "L2" }),
      ev("deal.won", iso(DAY, 15), OWNER_ACTOR_ID, { relatedLeadId: "L1", entityId: "L1" }),
    ];
    const leads = [lead("L1", iso(DAY, 9), "won"), lead("L2", iso(DAY, 9), "won")];
    const m = ownerMetrics({ ...base, events, leads }, periodWindow("today", NOW), NOW);
    expect(m.cohort).toBe(1);
    expect(m.cohortWon).toBe(1);
    expect(m.winRate).toBe(1);
    expect(m.dealsWon).toBe(1);
  });
  it("won value needs a verified wonAt in the window; unknown dates are excluded and counted", () => {
    const events = [ev("deal.won", iso(DAY, 15), OWNER_ACTOR_ID, { relatedLeadId: "L1", entityId: "L1" }), ev("deal.won", iso(DAY, 16), OWNER_ACTOR_ID, { relatedLeadId: "L2", entityId: "L2" })];
    const deals = [deal("D1", "L1", 50000, iso(DAY, 15)), deal("D2", "L2", 30000)];
    const m = ownerMetrics({ ...base, events, deals }, periodWindow("today", NOW), NOW);
    expect(m.wonValue).toBe(50000);
    expect(m.unknownWonDates).toBe(1);
  });
  it("quotations count only when explicitly confirmed as shared", () => {
    const quotationShares = [share("s1", iso(DAY, 9)), share("s2", iso(DAY, 10), false), share("s3", iso("2026-10-01", 9))];
    expect(ownerMetrics({ ...base, quotationShares }, periodWindow("today", NOW), NOW).quotationsShared).toBe(1);
  });
});

describe("AI-7A charts, timeline and finance", () => {
  it("daily series zero-fill inside the window and never fabricate beyond it", () => {
    const events = [ev("call.logged", iso(DAY, 9), OWNER_ACTOR_ID, { newValues: { outcome: "Connected" } })];
    const w = periodWindow("thisWeek", NOW);
    const s = ownerSeries(events, w);
    expect(s.calls).toHaveLength(7);
    expect(s.calls.find((x) => x.day === DAY)?.value).toBe(1);
    expect(s.calls.reduce((a, x) => a + x.value, 0)).toBe(1);
  });
  it("timeline has one row per saved action, newest first, Owner only", () => {
    const events = [
      ev("call.logged", iso(DAY, 9), OWNER_ACTOR_ID, { summary: "Called A", relatedLeadId: "L1" }),
      ev("lead.created", iso(DAY, 11), OWNER_ACTOR_ID, { summary: "Created B", relatedLeadId: "L2" }),
      ev("call.logged", iso(DAY, 10), "emp1", { summary: "Employee call" }),
    ];
    const rows = ownerTimeline(events, periodWindow("today", NOW), (e) => e.summary);
    expect(rows.map((r) => r.label)).toEqual(["Created B", "Called A"]);
  });
  it("won trend buckets by verified wonAt month and skips unknown dates", () => {
    const events = [ev("deal.won", iso(DAY), OWNER_ACTOR_ID, { relatedLeadId: "L1", entityId: "L1" }), ev("deal.won", iso(DAY), OWNER_ACTOR_ID, { relatedLeadId: "L2", entityId: "L2" })];
    const deals = [deal("D1", "L1", 40000, "2026-10-06T06:00:00Z"), deal("D2", "L2", 25000)];
    const t = wonTrend(events, deals, 6, NOW);
    expect(t).toHaveLength(6);
    expect(t.find((r) => r.month === "2026-10")).toEqual({ month: "2026-10", count: 1, value: 40000 });
    expect(t.reduce((a, r) => a + r.count, 0)).toBe(1);
  });
  it("finance snapshot is company-wide and excludes voided payments", () => {
    const deals = [deal("D1", "L1", 100000, iso(DAY))];
    const payments = [
      { id: "p1", dealId: "D1", amount: 40000, date: iso(DAY), method: "UPI" as const, type: "advance" as const },
      { id: "p2", dealId: "D1", amount: 20000, date: iso(DAY), method: "Cash" as const, type: "other" as const, voided: true },
    ];
    const f = companyFinanceSnapshot(deals, payments, NOW);
    expect(f.collected).toBe(40000);
    expect(f.outstanding).toBe(60000);
  });
  it("the AI-7B summary carries metrics and data quality, never conclusions", () => {
    const m = ownerMetrics(base, periodWindow("today", NOW), NOW);
    const s = performanceSummary(m, periodWindow("today", NOW));
    expect(s.window.timezone).toBe("Asia/Kolkata");
    expect(s.activity.calls).toBe(0);
    expect(s.dataQuality.unattributedEvents).toBe(0);
    expect(JSON.stringify(s)).not.toMatch(/coach|suggest|improve/i);
  });
});
