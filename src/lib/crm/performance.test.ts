import { describe, expect, it } from "vitest";
import {
  buildGoal, cohortConversion, definitionOn, demoPerformanceEvents, followUpCompletion, goalAlerts, goalError, goalProgress, goalWindow, indexEvents,
  mergeAlerts, metricValue, periodWindow, progressOf, rate, reviseGoal, visibleGoal, workloadFor, workloadInsights, DEFAULT_PERF_PREFS, type GoalInput,
} from "./performance";
import type { ActivityEvent } from "./activity";
import type { Employee } from "./team";
import type { FollowUp, Lead } from "./types";

const emp = (id: string, status: Employee["accountStatus"] = "active"): Employee => ({ id, name: `Emp ${id}`, email: `${id}@x.in`, roleId: "salesperson", accountStatus: status, createdAt: "", updatedAt: "", lastLoginAt: null, invitedAt: null, activatedAt: null, deactivatedAt: null } as Employee);
const ev = (p: Partial<ActivityEvent> & Pick<ActivityEvent, "eventType" | "actorUserId" | "occurredAt">): ActivityEvent => ({ eventId: Math.random().toString(36), actorRole: "x", actorName: "x", entityType: "lead", entityId: "l1", summary: "", module: "calls", importance: "normal", operationId: "op", eventSource: "local", schemaVersion: 1, ...p });
const lead = (id: string, p: Partial<Lead> = {}): Lead => ({ id, name: id, phone: "1", source: "Website", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-10T06:00:00Z", updatedAt: "", ...p });
const input = (p: Partial<GoalInput> = {}): GoalInput => ({ name: "Daily calls", metric: "calls", target: 20, period: "daily", scope: "employee", employeeIds: ["e1"], effectiveFrom: "2026-10-01", ...p });
const NOW = new Date("2026-10-23T10:00:00Z"); // Friday 15:30 IST

describe("periods (Asia/Kolkata)", () => {
  it("uses IST day boundaries", () => {
    expect(periodWindow("today", "2026-10-22T19:00:00Z")).toEqual({ start: "2026-10-23", end: "2026-10-23" }); // 00:30 IST next day
    expect(periodWindow("yesterday", NOW)).toEqual({ start: "2026-10-22", end: "2026-10-22" });
  });
  it("weeks run Monday–Sunday and months to their last day", () => {
    expect(periodWindow("thisWeek", NOW)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(periodWindow("lastWeek", NOW)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(periodWindow("lastMonth", NOW)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodWindow("thisMonth", NOW).end).toBe("2026-10-31");
  });
  it("each day falls in exactly one goal period", () => {
    expect(goalWindow({ period: "weekly" }, "2026-10-25")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(goalWindow({ period: "weekly" }, "2026-10-26")!.start).toBe("2026-10-26");
    expect(goalWindow({ period: "custom", customFrom: "2026-10-01", customTo: "2026-10-10" }, "2026-10-11")).toBeNull();
  });
});

describe("calls attempted vs connected", () => {
  const idx = indexEvents([
    ev({ eventType: "call.logged", actorUserId: "owner", occurredAt: "2026-10-23T05:00:00Z", newValues: { outcome: "Connected" } }),
    ev({ eventType: "call.logged", actorUserId: "owner", occurredAt: "2026-10-23T05:00:00Z", newValues: { outcome: "Not picked" } }),
    ev({ eventType: "call.logged", actorUserId: "owner", occurredAt: "2026-10-23T05:00:00Z", newValues: { outcome: "Busy" } }),
  ]);
  const w = { start: "2026-10-23", end: "2026-10-23" };
  it("counts every saved outcome as a call but only real conversations as connected", () => {
    expect(metricValue(idx, "calls", { kind: "employee", id: "owner" }, w)).toBe(3);
    expect(metricValue(idx, "connected", { kind: "employee", id: "owner" }, w)).toBe(1);
  });
  it("zero denominators are N/A, not 0%", () => { expect(rate(0, 0)).toBeNull(); expect(rate(1, 4)).toBe(0.25); });
});

describe("attribution", () => {
  const events = [ev({ eventType: "call.logged", actorUserId: "owner", occurredAt: "2026-10-23T05:00:00Z", newValues: { outcome: "Connected" } })];
  const w = { start: "2026-10-23", end: "2026-10-23" };
  it("never credits an employee for the Owner's calls on their assigned leads", () => {
    expect(metricValue(indexEvents(events), "calls", { kind: "employee", id: "e1" }, w)).toBeNull();
  });
  it("demo events are excluded unless explicitly allowed", () => {
    const demo = demoPerformanceEvents([emp("e1")], [lead("l1")], NOW);
    expect(demo.length).toBeGreaterThan(0);
    expect(demo.every((e) => e.eventSource === "demo")).toBe(true);
    expect(metricValue(indexEvents([...events, ...demo]), "calls", { kind: "team" }, w)).toBe(1);
    expect(metricValue(indexEvents([...events, ...demo], true), "calls", { kind: "employee", id: "e1" }, w)).toBeGreaterThan(0);
  });
  it("sales value is team-level only", () => {
    expect(metricValue(indexEvents([]), "salesValue", { kind: "employee", id: "owner" }, w, [])).toBeNull();
    expect(metricValue(indexEvents([]), "salesValue", { kind: "team" }, w, [{ id: "p", dealId: "d", amount: 500, date: "2026-10-23", method: "UPI", type: "advance" }, { id: "v", dealId: "d", amount: 900, date: "2026-10-23", method: "UPI", type: "advance", voided: true }])).toBe(500);
  });
});

describe("follow-up completion and cohorts", () => {
  const w = { start: "2026-10-23", end: "2026-10-23" };
  const fu = (p: Partial<FollowUp>): FollowUp => ({ id: Math.random().toString(), leadId: "l1", type: "call", dueAt: "2026-10-23T06:00:00Z", ...p });
  it("excludes cancelled follow-ups from the denominator", () => {
    const r = followUpCompletion([fu({ completedAt: "x" }), fu({}), fu({ cancelledAt: "x" })], w);
    expect(r).toEqual({ due: 2, done: 1, rate: 0.5 });
  });
  it("lead-to-win uses leads created in the period as the cohort", () => {
    const r = cohortConversion([lead("a", { createdAt: "2026-10-23T04:00:00Z", status: "won" }), lead("b", { createdAt: "2026-10-23T04:00:00Z" }), lead("c", { createdAt: "2026-09-01T04:00:00Z", status: "won" })], w);
    expect(r.cohort).toBe(2); expect(r.won).toBe(1); expect(r.winRate).toBe(0.5);
  });
});

describe("goals", () => {
  it("validates targets and assignees", () => {
    expect(goalError(input({ target: 0 }), [emp("e1")])).toMatch(/greater than zero/);
    expect(goalError(input({ employeeIds: [] }), [emp("e1")])).toMatch(/at least one/);
    expect(goalError(input({ metric: "lost" }), [emp("e1")])).toMatch(/goal type/);
    expect(goalError(input(), [emp("e1")])).toBeNull();
  });
  it("edits keep history so earlier periods use the old target", () => {
    const g = buildGoal(input({ target: 20 }), "g1", "2026-10-01T00:00:00Z");
    const { next, revision } = reviseGoal(g, input({ target: 30, effectiveFrom: "2026-10-20" }), "2026-10-20T00:00:00Z", "r1");
    expect(next.version).toBe(2);
    expect(revision.change).toContain("target 20 → 30");
    expect(definitionOn(next, [revision], "2026-10-10")!.target).toBe(20);
    expect(definitionOn(next, [revision], "2026-10-21")!.target).toBe(30);
  });
  it("progress: not measurable without attribution, exceeded when over target", () => {
    const g = buildGoal(input({ target: 2 }), "g1", "x");
    const idx = indexEvents([]);
    expect(goalProgress(g, [], "e1", idx, "2026-10-23", { employees: [emp("e1")], payments: [] }).status).toBe("not_measurable");
    expect(goalProgress(g, [], "e1", idx, "2026-10-23", { employees: [emp("e1", "inactive")], payments: [] }).status).toBe("inactive");
    expect(progressOf(2, 3, { start: "a", end: "a" })).toMatchObject({ status: "exceeded", remaining: 0, pct: 1.5 });
    expect(progressOf(4, 1, { start: "a", end: "a" })).toMatchObject({ status: "in_progress", remaining: 3, pct: 0.25 });
  });
  it("monetary goals are hidden without finance access", () => {
    expect(visibleGoal({ metric: "salesValue" }, false)).toBe(false);
    expect(visibleGoal({ metric: "calls" }, false)).toBe(true);
  });
  it("goal alerts deduplicate by stable id", () => {
    const g = buildGoal(input({ scope: "team", employeeIds: [], target: 1 }), "g1", "x");
    const rows = [{ goal: g, def: g, employeeId: null, progress: progressOf(1, 1, { start: "2026-10-23", end: "2026-10-23" }) }];
    const a = goalAlerts(rows, {}, [], DEFAULT_PERF_PREFS, "2026-10-23T10:00:00Z");
    expect(a).toHaveLength(1);
    const merged = mergeAlerts(a, goalAlerts(rows, {}, [], DEFAULT_PERF_PREFS, "2026-10-23T11:00:00Z"));
    expect(merged).toHaveLength(1);
  });
});

describe("workload", () => {
  it("counts assignment only, and flags imbalance", () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(`l${i}`, { priority: i < 6 ? "hot" : "cold" }));
    const assignments = Object.fromEntries(leads.map((l, i) => [l.id, { employeeId: i < 10 ? "e1" : "e2", assignedAt: "2026-10-22T00:00:00Z", source: "x", manual: true }]));
    const data = { leads, followUps: [], assignments };
    const loads = { e1: workloadFor("e1", data, NOW), e2: workloadFor("e2", data, NOW) };
    expect(loads.e1.assigned).toBe(10); expect(loads.e1.hot).toBe(6); expect(loads.e2.assigned).toBe(2);
    expect(workloadInsights([emp("e1"), emp("e2")], loads, 0).map((i) => i.id)).toContain("imbalance");
  });
  it("handles large datasets quickly", () => {
    const events = Array.from({ length: 50000 }, (_, i) => ev({ eventType: "call.logged", actorUserId: "owner", occurredAt: new Date(NOW.getTime() - (i % 60) * 864e5).toISOString(), newValues: { outcome: "Connected" } }));
    const t = performance.now();
    const idx = indexEvents(events);
    expect(metricValue(idx, "calls", { kind: "team" }, periodWindow("thisMonth", NOW))).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
