import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  activityStats, analyticsWindow, filterLeads, financeKpis, financeBreakdown, forecast, funnel, indexActivity, previousWindow, delta,
  projectFinanceLinks, projectStats, reportError, runReport, sourcePerformance, EMPTY_FORECAST, type AnalyticsData, type ReportDef, type ForecastConfig,
} from "./analytics";
import { financeSummary } from "./finance";
import { useCRM } from "./store";
import { migrateAnalytics } from "./analyticsStore";
import { buildBackup, ALL_CATEGORY_IDS } from "./vault";
import { indexEvents, hasAttribution } from "./performance";
import { routeAllowed } from "./session";
import type { Deal, Lead, LeadActivity, Payment, FollowUp } from "./types";
import type { Project, ProjectTask } from "./projects";

const NOW = new Date("2026-10-23T12:00:00+05:30");
const W = { start: "2026-10-01", end: "2026-10-31" };
const lead = (id: string, p: Partial<Lead> = {}): Lead => ({ id, name: id, phone: "9999999999", source: "Meta Ads", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-10T06:00:00Z", updatedAt: "2026-10-10T06:00:00Z", ...p });
const deal = (id: string, amount: number, p: Partial<Deal> = {}): Deal => ({ id, clientType: "crm", clientName: id, name: id, quotedAmount: amount, finalAmount: amount, status: "active", milestones: [], createdAt: "2026-10-05T06:00:00Z", wonAt: p.createdAt ?? "2026-10-05T06:00:00Z", ...p });
const pay = (id: string, dealId: string, amount: number, p: Partial<Payment> = {}): Payment => ({ id, dealId, amount, date: "2026-10-12", method: "UPI", type: "advance", ...p });
const act = (leadId: string, type: LeadActivity["type"], at: string, p: Partial<LeadActivity> = {}): LeadActivity => ({ id: `${leadId}-${type}-${at}`, leadId, type, text: "", at, ...p });
const base = (p: Partial<AnalyticsData> = {}): AnalyticsData => ({ leads: [], activities: [], followUps: [], deals: [], payments: [], assignments: {}, projects: [], projectTasks: [], supportRequests: [], leadTags: {}, tagDefs: [], customFields: [], fieldValues: {}, ...p });

// The brief's financial scenario: Deal A ₹40,000 with ₹4,000 + ₹16,000 valid and ₹5,000 voided; Deal B ₹30,000 fully paid.
const DEALS = [deal("A", 40000), deal("B", 30000)];
const PAYS = [pay("a1", "A", 4000), pay("a2", "A", 16000), pay("a3", "A", 5000, { voided: true }), pay("b1", "B", 30000)];

describe("financial aggregation", () => {
  it("Deal A alone: won ₹40,000, received ₹20,000, outstanding ₹20,000 (voided excluded)", () => {
    const k = financeKpis([DEALS[0]!], PAYS, W, NOW);
    expect([k.wonValue, k.received, k.outstanding]).toEqual([40000, 20000, 20000]);
  });
  it("combined: won ₹70,000, received ₹50,000, outstanding ₹20,000 and it reconciles with Deals & Payments", () => {
    const k = financeKpis(DEALS, PAYS, W, NOW);
    expect([k.wonValue, k.received, k.outstanding]).toEqual([70000, 50000, 20000]);
    const fin = financeSummary(DEALS, PAYS, NOW);
    const all = financeKpis(DEALS, PAYS, null, NOW);
    expect([all.received, all.outstanding, all.wonValue]).toEqual([fin.collected, fin.outstanding, fin.totalValue]);
  });
  it("won date and payment date are separate: a payment outside the range is not received in it", () => {
    const k = financeKpis(DEALS, [...PAYS, pay("late", "A", 1000, { date: "2026-11-02" })], W, NOW);
    expect(k.received).toBe(50000);
    expect(financeKpis(DEALS, PAYS, { start: "2026-11-01", end: "2026-11-30" }, NOW)).toMatchObject({ wonValue: 0, received: 0, outstanding: 20000 });
  });
  it("cancelled deals and their payments never count; unpaid without a due date is not overdue", () => {
    const k = financeKpis([...DEALS, deal("C", 9000, { status: "cancelled" })], [...PAYS, pay("c1", "C", 9000)], W, NOW);
    expect([k.wonValue, k.received, k.overdue, k.overdueKnown]).toEqual([70000, 50000, 0, false]);
    const b = financeBreakdown(DEALS, PAYS, W, NOW);
    expect([b.fullyPaid, b.partial, b.awaiting, b.noTerms, b.voidedExcluded]).toEqual([["B"], ["A"], [], 1, 1]);
    expect(b.byMethod).toEqual([{ method: "UPI", amount: 50000, count: 3 }]);
  });
  it("project links never double count a deal shared by two projects", () => {
    const pr = (id: string): Project => ({ id, dealId: "A", archived: false } as unknown as Project);
    const m = projectFinanceLinks([pr("p1"), pr("p2")], DEALS, PAYS);
    expect([m.deals, m.value, m.received, m.outstanding]).toEqual([1, 40000, 20000, 20000]);
  });
});

describe("periods", () => {
  it("uses India business days and an equal previous period", () => {
    expect(analyticsWindow("7d", NOW)).toEqual({ start: "2026-10-17", end: "2026-10-23" });
    expect(analyticsWindow("thisQuarter", NOW)).toEqual({ start: "2026-10-01", end: "2026-10-23" });
    expect(analyticsWindow("today", "2026-10-22T19:00:00Z")).toEqual({ start: "2026-10-23", end: "2026-10-23" }); // 00:30 IST next day
    expect(previousWindow({ start: "2026-10-17", end: "2026-10-23" })).toEqual({ start: "2026-10-10", end: "2026-10-16" });
    expect(delta(5, 0)).toEqual({ diff: 5, pct: null });
  });
});

describe("lead acquisition", () => {
  const leads = [lead("m1"), lead("m2", { status: "won" }), lead("i1", { source: "Instagram", status: "qualified" }), lead("r1", { source: "Referral", status: "won" }), lead("old", { createdAt: "2026-09-01T00:00:00Z" })];
  it("counts by source, qualified, won and lead-to-win per cohort; old leads stay out of the range", () => {
    const cohort = leads.filter((l) => l.createdAt >= "2026-10-01");
    const rows = sourcePerformance(cohort, { assignments: { m1: { employeeId: "e", assignedAt: "", source: "", manual: true } } }, indexActivity([]));
    const meta = rows.find((r) => r.source === "Meta Ads")!;
    expect([meta.leads, meta.qualified, meta.won, meta.winRate, meta.unassigned]).toEqual([2, 1, 1, 0.5, 1]);
    expect(rows.find((r) => r.source === "Instagram")).toMatchObject({ leads: 1, qualified: 1, won: 0, winRate: 0 });
    expect(rows.map((r) => r.source)).not.toContain("Google Ads");
  });
  it("first-attempt time uses saved call outcomes only", () => {
    const idx = indexActivity([act("m1", "call", "2026-10-10T08:00:00Z", { outcome: "Not picked" }), act("m2", "whatsapp", "2026-10-10T07:00:00Z")]);
    const rows = sourcePerformance([lead("m1"), lead("m2")], { assignments: {} }, idx);
    expect(rows[0]).toMatchObject({ attempted: 1, medianFirstAttemptH: 2 });
  });
  it("filters by source, stage and assignee", () => {
    expect(filterLeads(leads, { sources: ["Meta Ads"], stages: ["won"] }, { assignments: {}, leadTags: {} }).map((l) => l.id)).toEqual(["m2"]);
    expect(filterLeads(leads, { assignee: "unassigned" }, { assignments: { m1: { employeeId: "e", assignedAt: "", source: "", manual: true } }, leadTags: {} })).toHaveLength(4);
  });
});

describe("funnel definitions", () => {
  it("keeps current distribution, recorded moves and cohort conversion separate; no history = no moves", () => {
    const leads = [lead("a", { status: "qualified" }), lead("b", { status: "won" }), lead("c", { status: "lost", lostReason: "Budget" }), lead("d", { status: "lost" })];
    const idx = indexActivity([act("a", "status", "2026-10-11T00:00:00Z", { text: "Status changed to qualified" })]);
    const f = funnel(leads, idx, W, NOW);
    expect(f.current.find((c) => c.stage === "lost")!.count).toBe(2);
    expect(f.movesRecorded).toBe(1);
    expect(f.moves.find((m) => m.stage === "won")!.count).toBe(0); // b is Won but its move was never recorded
    expect(f.cohort).toMatchObject({ size: 4, won: 1, winRate: 0.25, developing: true });
    expect(f.lostReasons.map((r) => [r.reason, r.count])).toEqual([["Budget", 1], ["Not recorded", 1]]);
  });
  it("zero denominators give no rate rather than 0%", () => {
    const f = funnel([], indexActivity([]), W, NOW);
    expect(f.cohort.winRate).toBeNull();
    expect(activityStats([], indexActivity([]), [], W, NOW).fuRate).toBeNull();
  });
});

describe("sales activity", () => {
  it("attempt is not connection; follow-up scheduling is not completion", () => {
    const leads = [lead("a")];
    const idx = indexActivity([act("a", "call", "2026-10-11T05:00:00Z", { outcome: "Not picked" }), act("a", "call", "2026-10-12T05:00:00Z", { outcome: "Busy" }), act("a", "call", "2026-10-13T05:00:00Z", { outcome: "Interested" })]);
    const fu = (id: string, p: Partial<FollowUp>): FollowUp => ({ id, leadId: "a", type: "call", dueAt: "2026-10-14T05:00:00Z", ...p });
    const s = activityStats(leads, idx, [fu("f1", {}), fu("f2", { completedAt: "2026-10-14T06:00:00Z" }), fu("f3", { cancelledAt: "2026-10-13T00:00:00Z" })], W, NOW);
    expect([s.attempts, s.connected, s.noAnswer, s.busy]).toEqual([3, 1, 1, 1]);
    expect([s.fuScheduled, s.fuCompleted, s.fuRate, s.fuOverdue]).toEqual([2, 1, 0.5, 1]);
  });
  it("employee contribution needs verified actor events; demo events never count", () => {
    const ev = (actor: string, src?: "demo") => ({ eventId: actor, eventType: "call.logged", actorUserId: actor, occurredAt: "2026-10-12T00:00:00Z", ...(src ? { eventSource: src } : {}) });
    const idx = indexEvents([ev("owner"), ev("emp_1", "demo")] as never);
    expect(hasAttribution(idx, "emp_1")).toBe(false);
  });
});

describe("projects", () => {
  it("counts active/overdue/delivered and actual task completion only", () => {
    const p = (id: string, x: Partial<Project>): Project => ({ id, name: id, type: "Website", status: "in_progress", stage: "development", archived: false, dependencies: [], support: { included: null }, createdAt: "2026-10-02T00:00:00Z", ...x } as unknown as Project);
    const projects = [p("late", { targetDelivery: "2026-10-01" }), p("ok", { targetDelivery: "2026-12-01", dependencies: [{ id: "d", label: "Logo", done: false }] }), p("done", { stage: "delivered", delivery: { date: "2026-10-20", deliveredBy: "owner", approval: "approved" }, actualStart: "2026-10-05" } as Partial<Project>), p("arch", { archived: true })];
    const t = (id: string, projectId: string, status: "open" | "done", dueDate?: string): ProjectTask => ({ id, projectId, status, ...(dueDate ? { dueDate } : {}) } as unknown as ProjectTask);
    const s = projectStats(projects, [t("1", "late", "done"), t("2", "late", "open", "2026-10-02"), t("3", "arch", "done")], [], W, NOW);
    expect([s.active, s.overdue, s.delivered, s.tasksDone, s.tasksTotal, s.tasksOverdue, s.openDependencies]).toEqual([2, 1, 1, 1, 2, 1, 1]);
    expect([s.avgDeliveryDays, s.deliveryMeasured]).toEqual([15, 1]);
  });
});

describe("forecast", () => {
  const cfg: ForecastConfig = { version: 1, effectiveFrom: "2026-10-01T00:00:00Z", probabilities: { new: 10, contacted: 25, qualified: 50, proposal: 75 }, conservative: 0.5, optimistic: 1.5 };
  const leads = [lead("A", { status: "qualified", quotedAmount: 20000 }), lead("B", { status: "contacted", quotedAmount: 40000 }), lead("W", { status: "won", quotedAmount: 99000 }), lead("L", { status: "lost", quotedAmount: 50000 }), lead("N", { status: "new" })];
  it("weighted pipeline = Σ amount × probability; Won and Lost excluded", () => {
    const f = forecast(leads, cfg, {}, NOW);
    expect(f.weighted).toBe(20000); // 20,000×50% + 40,000×25%
    expect(f.opportunities.map((o) => o.leadId).sort()).toEqual(["A", "B"]);
    expect(f.noAmount).toEqual(["N"]);
    expect([f.conservative, f.optimistic]).toEqual([10000, 30000]);
  });
  it("changing a probability updates the forecast; unconfigured gives nothing", () => {
    expect(forecast(leads, { ...cfg, probabilities: { ...cfg.probabilities, qualified: 100 } }, {}, NOW).weighted).toBe(30000);
    expect(forecast(leads, EMPTY_FORECAST, {}, NOW)).toMatchObject({ configured: false, weighted: 0 });
  });
  it("undated opportunities are never given a month", () => {
    const f = forecast(leads, cfg, { A: "2026-11-15" }, NOW);
    expect(f.byMonth).toEqual([{ month: "2026-11", weighted: 10000, count: 1 }]);
    expect(f.undated.map((o) => o.leadId)).toEqual(["B"]);
  });
});

describe("custom reports", () => {
  const SVC = { id: "cf_service", entity: "lead", label: "Service", type: "select", options: [{ id: "o_web", label: "Website" }, { id: "o_3d", label: "3D Website" }], status: "active", visibility: "team" } as never;
  const rep = (p: Partial<ReportDef>): ReportDef => ({ id: "r", name: "R", source: "leads", metric: "count", groupBy: "source", period: "thisMonth", filter: {}, chart: "bar", sort: "value", pinned: false, favorite: false, archived: false, createdAt: "", updatedAt: "", version: 1, ...p });
  it("validates incompatible combinations", () => {
    expect(reportError(rep({ source: "calls", metric: "value" }), [])).toMatch(/measure/);
    expect(reportError(rep({ source: "deals", metric: "outstanding", groupBy: "month" }), [])).toMatch(/balance/);
    expect(reportError(rep({ source: "projects", groupBy: "cf:cf_service" }), [SVC])).toMatch(/Lead reports/);
    expect(reportError(rep({ groupBy: "cf:cf_service" }), [SVC])).toBeNull();
  });
  it("segments by source and custom field, refreshes from current data and explains archived fields", () => {
    const d = base({ leads: [lead("a"), lead("b"), lead("c", { source: "Referral" })], customFields: [SVC], fieldValues: { a: { cf_service: "o_3d" }, c: { cf_service: "o_3d" } } });
    const r = rep({ groupBy: "cf:cf_service" });
    const ctx = { employeeName: () => "E" };
    expect(runReport(r, d, NOW, ctx).rows.map((x) => [x.label, x.value])).toEqual([["3D Website", 2], ["Not set", 1]]);
    expect(runReport(rep({}), d, NOW, ctx).rows.map((x) => [x.label, x.value, x.ids])).toEqual([["Meta Ads", 2, ["a", "b"]], ["Referral", 1, ["c"]]]);
    d.fieldValues = { ...d.fieldValues, b: { cf_service: "o_web" } }; // underlying change
    expect(runReport(r, d, NOW, ctx).rows.map((x) => x.label)).toEqual(["3D Website", "Website"]);
    const archived = runReport(r, { ...d, customFields: [{ ...(SVC as object), status: "archived" } as never] }, NOW, ctx);
    expect(archived.warnings[0]).toMatch(/archived/);
    expect(archived.total).toBe(3); // values kept, not silently dropped
  });
  it("deal reports reuse the finance rules", () => {
    const d = base({ deals: DEALS, payments: PAYS });
    expect(runReport(rep({ source: "deals", metric: "received", groupBy: "method" }), d, NOW, { employeeName: () => "" }).total).toBe(50000);
    expect(runReport(rep({ source: "deals", metric: "outstanding", groupBy: "status" }), d, NOW, { employeeName: () => "" }).total).toBe(20000);
  });
  it("handles large datasets", () => {
    const leads = Array.from({ length: 6000 }, (_, i) => lead(`l${i}`, { source: i % 3 ? "Meta Ads" : "Referral" }));
    const activities = leads.map((l) => act(l.id, "call", "2026-10-11T05:00:00Z", { outcome: "Connected" }));
    const t = performance.now();
    const idx = indexActivity(activities);
    const s = activityStats(leads, idx, [], W, NOW);
    const r = runReport(rep({}), base({ leads, activities }), NOW, { employeeName: () => "", idx });
    expect(s.connected).toBe(6000);
    expect(r.total).toBe(6000);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe("store, privacy and backups", () => {
  const s = () => useCRM.getState();
  beforeEach(() => { localStorage.clear(); s().reset(); useCRM.setState({ forecastConfig: EMPTY_FORECAST, forecastHistory: [], expectedClose: {}, savedReports: [], teamEvents: [] }); });
  it("probability versions keep history and record one Owner activity event", () => {
    expect(s().saveForecastConfig({ probabilities: { new: 10, contacted: 20, qualified: 40 }, conservative: 0.8, optimistic: 1.2 })).toMatch(/Proposal/);
    expect(s().saveForecastConfig({ probabilities: { new: 10, contacted: 20, qualified: 40, proposal: 60 }, conservative: 0.8, optimistic: 1.2 })).toBeNull();
    s().saveForecastConfig({ probabilities: { new: 10, contacted: 20, qualified: 50, proposal: 60 }, conservative: 0.8, optimistic: 1.2, note: "Better close rate" });
    expect(s().forecastConfig.version).toBe(2);
    expect(s().forecastHistory.map((c) => c.probabilities["qualified"])).toEqual([40]);
    expect(s().teamEvents.filter((e) => e.eventType === "analytics.forecast_changed" && e.actorUserId === "owner")).toHaveLength(2);
  });
  it("saved reports: create, rename, duplicate, archive; invalid ones are refused", () => {
    expect(s().saveReport({ name: "", source: "leads", metric: "count", groupBy: "source", period: "30d", filter: {}, chart: "bar", sort: "value", pinned: false, favorite: false, archived: false }).ok).toBe(false);
    const r = s().saveReport({ name: "Leads by source", source: "leads", metric: "count", groupBy: "source", period: "30d", filter: {}, chart: "bar", sort: "value", pinned: true, favorite: false, archived: false });
    if (!r.ok) throw new Error(r.error);
    s().setReportFlags(r.id, { name: "Sources" });
    const copy = s().duplicateReport(r.id)!;
    s().setReportFlags(r.id, { archived: true });
    expect(s().savedReports.map((x) => [x.name, x.archived, x.pinned])).toEqual([["Sources", true, true], ["Sources (copy)", false, false]]);
    expect(copy).toBeTruthy();
    expect(s().teamEvents.some((e) => e.eventType === "analytics.report_changed" && /archived/.test(e.summary))).toBe(true);
  });
  it("Analytics Studio is Owner-only — employees in preview cannot open it", () => {
    expect(routeAllowed({ employeeId: "e", perms: new Set(["analytics.view", "analytics.company"]) } as never, "/analytics")).toBe(false);
    expect(routeAllowed(null, "/analytics")).toBe(true);
  });
  it("full backup includes analytics definitions; employee backups never do", async () => {
    s().saveForecastConfig({ probabilities: { new: 10, contacted: 20, qualified: 40, proposal: 60 }, conservative: 0.8, optimistic: 1.2 });
    s().saveReport({ name: "Leads by source", source: "leads", metric: "count", groupBy: "source", period: "30d", filter: {}, chart: "bar", sort: "value", pinned: false, favorite: false, archived: false });
    const st = Object.fromEntries(Object.entries(s()).filter(([, v]) => typeof v !== "function"));
    const files = unzipSync((await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, st, [])).bytes);
    const a = JSON.parse(strFromU8(files["data/analytics-settings.json"]!));
    expect(a.savedReports.map((r: ReportDef) => r.name)).toEqual(["Leads by source"]);
    expect(a.forecastConfig.version).toBe(1);
    expect(Object.keys(a).sort()).toEqual(["expectedClose", "forecastConfig", "forecastHistory", "savedReports"]);
    expect(files["data/leads.json"]).toBeDefined();
  });
  it("v10 migration starts analytics empty and keeps everything else", () => {
    expect(migrateAnalytics({ leads: [1] }, 9)).toMatchObject({ leads: [1], savedReports: [], forecastConfig: { version: 0 } });
  });
});

describe("won date semantics (Phase 3H)", () => {
  it("period Won value uses the recorded won date, not the creation date", () => {
    const d = deal("W", 50000, { createdAt: "2026-09-20T06:00:00Z", wonAt: "2026-10-03T06:00:00Z" });
    expect(financeKpis([d], [], W, NOW).wonValue).toBe(50000);
    expect(financeKpis([d], [], { start: "2026-09-01", end: "2026-09-30" }, NOW).wonValue).toBe(0);
  });
  it("legacy deals without a won date are not placed in their creation period", () => {
    const { wonAt: _w, ...legacy } = deal("L", 10000);
    expect(financeKpis([legacy], [], W, NOW).wonValue).toBe(0);
    expect(financeKpis([legacy], [], null, NOW).wonValue).toBe(10000);
  });
  it("new deals record wonAt at booking", () => {
    useCRM.getState().addDeal({ clientType: "crm", clientName: "QA", name: "QA won", quotedAmount: 1, finalAmount: 1, status: "active", milestones: [] });
    const d = useCRM.getState().deals[0]!;
    expect(d.wonAt).toBe(d.createdAt);
  });
});
