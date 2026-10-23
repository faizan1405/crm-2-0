// Phase 3G.2 — Analytics Studio. Pure, backend-agnostic calculations over existing CRM records.
// Every number here is derived from records that already exist (Leads, activity, Follow-ups, Deals, Payments,
// Projects). Nothing is stored except definitions (saved reports, forecast settings, expected close dates).
// Money always goes through finance.ts so totals reconcile with Deals & Payments.
import type { Deal, Lead, LeadActivity, LeadStatus, FollowUp, Payment } from "./types";
import { LEAD_STATUSES, STATUS_LABEL } from "./types";
import { dayKey } from "./format";
import { shiftDay } from "./dates";
import { dealCollected, dealOutstanding, financeSummary, isDealOverdue } from "./finance";
import { periodWindow, inWindow, weekStart, rate, type Window } from "./performance";
import { isConnectedOutcome, type CallOutcome } from "./calllog";
import { isPending } from "./followups";
import { CLOSED, isActive, isProjectOverdue, supportStatus, taskOverdue, type Project, type ProjectTask, type SupportRequest } from "./projects";
import type { Assignment } from "./access";
import type { CustomFieldDef, FieldValues, TagDef } from "./customize";

// ---------------------------------------------------------------- Periods
export type AnalyticsPeriod = "today" | "yesterday" | "7d" | "30d" | "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "custom";
export const ANALYTICS_PERIODS: { id: AnalyticsPeriod; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" }, { id: "lastMonth", label: "Last month" }, { id: "thisQuarter", label: "This quarter" }, { id: "thisYear", label: "This year" },
  { id: "custom", label: "Custom range" },
];
/** Inclusive business-day window (Asia/Kolkata day boundaries). */
export function analyticsWindow(p: AnalyticsPeriod, now: Date | string, from?: string, to?: string): Window {
  const today = dayKey(now);
  switch (p) {
    case "7d": return { start: shiftDay(today, -6), end: today };
    case "30d": return { start: shiftDay(today, -29), end: today };
    case "thisQuarter": { const m = Number(today.slice(5, 7)); const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0"); const start = `${today.slice(0, 4)}-${qm}-01`; return { start, end: today }; }
    case "thisYear": return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "thisMonth": return { start: `${today.slice(0, 8)}01`, end: today };
    default: return periodWindow(p, now, from, to);
  }
}
export const windowDays = (w: Window) => Math.round((Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / 86_400_000) + 1;
/** The equally long window immediately before `w`. */
export function previousWindow(w: Window): Window { const n = windowDays(w); return { start: shiftDay(w.start, -n), end: shiftDay(w.start, -1) }; }
/** Change vs previous period; null when the previous value is zero (a % change from nothing is meaningless). */
export const delta = (cur: number, prev: number) => ({ diff: cur - prev, pct: prev > 0 ? (cur - prev) / prev : null });

export type Granularity = "day" | "week" | "month";
export const granularityFor = (w: Window): Granularity => (windowDays(w) <= 31 ? "day" : windowDays(w) <= 120 ? "week" : "month");
export function bucketOf(day: string, g: Granularity) { return g === "day" ? day : g === "week" ? weekStart(day) : day.slice(0, 7); }
export function buckets(w: Window, g: Granularity): string[] {
  const out: string[] = []; let d = w.start;
  while (d <= w.end && out.length < 800) { const b = bucketOf(d, g); if (out[out.length - 1] !== b) out.push(b); d = shiftDay(d, 1); }
  return out;
}

// ---------------------------------------------------------------- Inputs & filters
export interface AnalyticsData {
  leads: Lead[]; activities: LeadActivity[]; followUps: FollowUp[]; deals: Deal[]; payments: Payment[];
  assignments: Record<string, Assignment>; projects: Project[]; projectTasks: ProjectTask[]; supportRequests: SupportRequest[];
  leadTags: Record<string, string[]>; tagDefs: TagDef[]; customFields: CustomFieldDef[]; fieldValues: FieldValues;
  leadRelations?: Record<string, { a: string; b: string; kind: string }>; inboxMeta?: Record<string, { flaggedAt?: string }>;
}
export interface LeadFilter { sources?: string[]; stages?: LeadStatus[]; priorities?: string[]; assignee?: string | "unassigned"; tagId?: string; leadIds?: Set<string> }
export function filterLeads(leads: Lead[], f: LeadFilter, d: Pick<AnalyticsData, "assignments" | "leadTags">): Lead[] {
  return leads.filter((l) =>
    (!f.sources?.length || f.sources.includes(l.source)) && (!f.stages?.length || f.stages.includes(l.status)) && (!f.priorities?.length || f.priorities.includes(l.priority)) &&
    (!f.assignee || (f.assignee === "unassigned" ? !d.assignments[l.id] : d.assignments[l.id]?.employeeId === f.assignee)) &&
    (!f.tagId || (d.leadTags[l.id] ?? []).includes(f.tagId)) && (!f.leadIds || f.leadIds.has(l.id)));
}
export const isFiltered = (f: LeadFilter) => !!(f.sources?.length || f.stages?.length || f.priorities?.length || f.assignee || f.tagId || f.leadIds);

/** Index activity once per data change so every chart does not rescan everything. */
export interface ActivityIndex { calls: LeadActivity[]; stageMoves: { leadId: string; to: LeadStatus; at: string }[]; firstCall: Map<string, string> }
const STATUS_RE = /^Status changed to (\w+)/;
export function indexActivity(activities: LeadActivity[]): ActivityIndex {
  const calls: LeadActivity[] = [], stageMoves: ActivityIndex["stageMoves"] = [], firstCall = new Map<string, string>();
  for (const a of activities) {
    if (a.type === "call" && a.outcome) { calls.push(a); const f = firstCall.get(a.leadId); if (!f || a.at < f) firstCall.set(a.leadId, a.at); }
    else if (a.type === "status") { const m = STATUS_RE.exec(a.text); const to = m?.[1] as LeadStatus | undefined; if (to && (LEAD_STATUSES as string[]).includes(to)) stageMoves.push({ leadId: a.leadId, to, at: a.at }); }
  }
  return { calls, stageMoves, firstCall };
}

// ---------------------------------------------------------------- Executive & finance
export interface FinanceKpis { wonValue: number; wonCount: number; received: number; paymentCount: number; outstanding: number; overdue: number; overdueKnown: boolean; wonIds: string[]; paymentIds: string[] }
/**
 * Won Deal Value = final amount of non-cancelled Deals booked (created) in the window.
 * Payments Received = valid (non-voided) payments dated in the window, for non-cancelled Deals.
 * Outstanding = current unpaid balance of every non-cancelled Deal (a snapshot "as of today", not a period value).
 */
export function financeKpis(deals: Deal[], payments: Payment[], w: Window | null, now: Date): FinanceKpis {
  const eligible = deals.filter((d) => d.status !== "cancelled");
  const ids = new Set(eligible.map((d) => d.id));
  const won = w ? eligible.filter((d) => inWindow(d.createdAt, w)) : eligible;
  const pays = payments.filter((p) => !p.voided && ids.has(p.dealId) && (!w || inWindow(p.date, w)));
  const fin = financeSummary(deals, payments, now);
  return {
    wonValue: won.reduce((s, d) => s + d.finalAmount, 0), wonCount: won.length, wonIds: won.map((d) => d.id),
    received: pays.reduce((s, p) => s + p.amount, 0), paymentCount: pays.length, paymentIds: pays.map((p) => p.id),
    outstanding: fin.outstanding, overdue: fin.overdue, overdueKnown: eligible.some((d) => !!d.dueDate),
  };
}
export interface FinanceBreakdown {
  byMonth: { month: string; received: number; won: number }[]; byMethod: { method: string; amount: number; count: number }[];
  fullyPaid: string[]; partial: string[]; awaiting: string[]; overdueIds: string[]; noTerms: number; collectionRate: number | null; voidedExcluded: number;
}
export function financeBreakdown(deals: Deal[], payments: Payment[], w: Window, now: Date): FinanceBreakdown {
  const eligible = deals.filter((d) => d.status !== "cancelled"); const ids = new Set(eligible.map((d) => d.id));
  const months = buckets(w, "month"); const byM = new Map(months.map((m) => [m, { month: m, received: 0, won: 0 }]));
  const methods = new Map<string, { method: string; amount: number; count: number }>();
  let voidedExcluded = 0;
  for (const p of payments) {
    if (!ids.has(p.dealId) || !inWindow(p.date, w)) continue;
    if (p.voided) { voidedExcluded++; continue; }
    const m = byM.get(dayKey(p.date).slice(0, 7)); if (m) m.received += p.amount;
    const x = methods.get(p.method) ?? { method: p.method, amount: 0, count: 0 }; x.amount += p.amount; x.count++; methods.set(p.method, x);
  }
  for (const d of eligible) if (inWindow(d.createdAt, w)) { const m = byM.get(dayKey(d.createdAt).slice(0, 7)); if (m) m.won += d.finalAmount; }
  const fullyPaid: string[] = [], partial: string[] = [], awaiting: string[] = [], overdueIds: string[] = [];
  let noTerms = 0;
  for (const d of eligible) {
    const got = dealCollected(d.id, payments);
    if (d.finalAmount > 0 && got >= d.finalAmount) fullyPaid.push(d.id); else if (got > 0) partial.push(d.id); else awaiting.push(d.id);
    if (isDealOverdue(d, payments, now)) overdueIds.push(d.id);
    if (dealOutstanding(d, payments) > 0 && !d.dueDate) noTerms++;
  }
  const fin = financeSummary(deals, payments, now);
  return { byMonth: [...byM.values()], byMethod: [...methods.values()].sort((a, b) => b.amount - a.amount), fullyPaid, partial, awaiting, overdueIds, noTerms, collectionRate: fin.collectionRate, voidedExcluded };
}

// ---------------------------------------------------------------- Lead acquisition
export interface SourceRow { source: string; leads: number; qualified: number; won: number; winRate: number | null; unassigned: number; duplicates: number; medianFirstAttemptH: number | null; attempted: number; leadIds: string[]; wonIds: string[] }
const QUALIFIED_OR_LATER: LeadStatus[] = ["qualified", "proposal", "won"];
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/** Leads created in the window grouped by their recorded source (source values are never rewritten). */
export function sourcePerformance(cohort: Lead[], d: Pick<AnalyticsData, "assignments" | "leadRelations" | "inboxMeta">, idx: ActivityIndex): SourceRow[] {
  const dup = new Set<string>();
  for (const r of Object.values(d.leadRelations ?? {})) if (r.kind === "duplicate" || r.kind === "possible") { dup.add(r.a); dup.add(r.b); }
  for (const [id, m] of Object.entries(d.inboxMeta ?? {})) if (m.flaggedAt) dup.add(id);
  const by = new Map<string, Lead[]>();
  for (const l of cohort) by.set(l.source, [...(by.get(l.source) ?? []), l]);
  return [...by.entries()].map(([source, ls]) => {
    const won = ls.filter((l) => l.status === "won");
    const hours = ls.flatMap((l) => { const f = idx.firstCall.get(l.id); return f ? [Math.max(0, (Date.parse(f) - Date.parse(l.createdAt)) / 3_600_000)] : []; });
    return { source, leads: ls.length, qualified: ls.filter((l) => QUALIFIED_OR_LATER.includes(l.status)).length, won: won.length, winRate: rate(won.length, ls.length), unassigned: ls.filter((l) => !d.assignments[l.id]).length, duplicates: ls.filter((l) => dup.has(l.id)).length, medianFirstAttemptH: median(hours), attempted: hours.length, leadIds: ls.map((l) => l.id), wonIds: won.map((l) => l.id) };
  }).sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
}
/** Leads received / moved into Qualified / moved into Won per bucket. Moves come only from recorded stage changes. */
export function leadTrend(leads: Lead[], idx: ActivityIndex, w: Window, g: Granularity) {
  const ids = new Set(leads.map((l) => l.id));
  const rows = new Map(buckets(w, g).map((b) => [b, { bucket: b, received: 0, qualified: 0, won: 0 }]));
  for (const l of leads) if (inWindow(l.createdAt, w)) { const r = rows.get(bucketOf(dayKey(l.createdAt), g)); if (r) r.received++; }
  for (const m of idx.stageMoves) if (ids.has(m.leadId) && inWindow(m.at, w) && (m.to === "qualified" || m.to === "won")) { const r = rows.get(bucketOf(dayKey(m.at), g)); if (r) r[m.to === "won" ? "won" : "qualified"]++; }
  return [...rows.values()];
}

// ---------------------------------------------------------------- Funnel
export interface Funnel {
  current: { stage: LeadStatus; label: string; count: number; value: number; ids: string[] }[];
  moves: { stage: LeadStatus; label: string; count: number }[]; movesRecorded: number;
  cohort: { size: number; qualified: number; won: number; lost: number; winRate: number | null; developing: boolean };
  lostReasons: { reason: string; count: number; value: number; ids: string[] }[];
}
/** Three separate calculations — never mixed: current distribution, recorded moves in the window, and cohort conversion. */
export function funnel(all: Lead[], idx: ActivityIndex, w: Window, now: Date): Funnel {
  const ids = new Set(all.map((l) => l.id));
  const current = LEAD_STATUSES.map((s) => { const ls = all.filter((l) => l.status === s); return { stage: s, label: STATUS_LABEL[s], count: ls.length, value: ls.reduce((a, l) => a + (l.quotedAmount ?? 0), 0), ids: ls.map((l) => l.id) }; });
  const inW = idx.stageMoves.filter((m) => ids.has(m.leadId) && inWindow(m.at, w));
  const moves = LEAD_STATUSES.filter((s) => s !== "new").map((s) => ({ stage: s, label: STATUS_LABEL[s], count: inW.filter((m) => m.to === s).length }));
  const cohortLeads = all.filter((l) => inWindow(l.createdAt, w));
  const won = cohortLeads.filter((l) => l.status === "won").length;
  const lostLeads = all.filter((l) => l.status === "lost");
  const reasons = new Map<string, { reason: string; count: number; value: number; ids: string[] }>();
  for (const l of lostLeads) { const k = l.lostReason?.trim() || "Not recorded"; const r = reasons.get(k) ?? { reason: k, count: 0, value: 0, ids: [] }; r.count++; r.value += l.quotedAmount ?? 0; r.ids.push(l.id); reasons.set(k, r); }
  return {
    current, moves, movesRecorded: inW.length,
    cohort: { size: cohortLeads.length, qualified: cohortLeads.filter((l) => QUALIFIED_OR_LATER.includes(l.status)).length, won, lost: cohortLeads.filter((l) => l.status === "lost").length, winRate: rate(won, cohortLeads.length), developing: w.end >= shiftDay(dayKey(now), -30) },
    lostReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- Sales activity
export interface ActivityStats { attempts: number; connected: number; noAnswer: number; busy: number; byOutcome: { outcome: string; count: number }[]; fuScheduled: number; fuCompleted: number; fuOverdue: number; fuRate: number | null; medianFirstAttemptH: number | null; cohortAttempted: number; cohortSize: number }
/** Only saved call outcomes count. Opening the dialer or WhatsApp is never evidence of contact. */
export function activityStats(leads: Lead[], idx: ActivityIndex, followUps: FollowUp[], w: Window, now: Date): ActivityStats {
  const ids = new Set(leads.map((l) => l.id));
  const calls = idx.calls.filter((c) => ids.has(c.leadId) && inWindow(c.at, w));
  const out = new Map<string, number>(); for (const c of calls) out.set(c.outcome!, (out.get(c.outcome!) ?? 0) + 1);
  const fus = followUps.filter((f) => ids.has(f.leadId) && !f.cancelledAt);
  const due = fus.filter((f) => inWindow(f.dueAt, w)); const done = due.filter((f) => f.completedAt).length;
  const nowIso = now.toISOString();
  const cohort = leads.filter((l) => inWindow(l.createdAt, w));
  const hours = cohort.flatMap((l) => { const f = idx.firstCall.get(l.id); return f ? [Math.max(0, (Date.parse(f) - Date.parse(l.createdAt)) / 3_600_000)] : []; });
  return {
    attempts: calls.length, connected: calls.filter((c) => isConnectedOutcome(c.outcome as CallOutcome)).length, noAnswer: out.get("Not picked") ?? 0, busy: out.get("Busy") ?? 0,
    byOutcome: [...out.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    fuScheduled: due.length, fuCompleted: fus.filter((f) => f.completedAt && inWindow(f.completedAt, w)).length, fuOverdue: fus.filter((f) => isPending(f) && f.dueAt < nowIso).length,
    fuRate: rate(done, due.length), medianFirstAttemptH: median(hours), cohortAttempted: hours.length, cohortSize: cohort.length,
  };
}

// ---------------------------------------------------------------- Projects
export interface ProjectStats {
  created: number; active: number; awaitingClient: number; inProgress: number; completed: number; delivered: number; overdue: number;
  byType: { type: string; count: number; ids: string[] }[]; tasksDone: number; tasksTotal: number; tasksOverdue: number; openDependencies: number; projectsWaitingOnClient: number;
  supportOpen: number; supportEnding: number; avgDeliveryDays: number | null; deliveryMeasured: number;
  ids: { active: string[]; overdue: string[]; delivered: string[]; awaitingClient: string[] };
}
export function projectStats(projects: Project[], tasks: ProjectTask[], support: SupportRequest[], w: Window, now: Date): ProjectStats {
  const today = dayKey(now); const live = projects.filter((p) => !p.archived);
  const pIds = new Set(live.map((p) => p.id));
  const t = tasks.filter((x) => pIds.has(x.projectId));
  const active = live.filter(isActive), overdue = live.filter((p) => isProjectOverdue(p, today)), delivered = live.filter((p) => !!p.delivery);
  const awaiting = live.filter((p) => p.status === "awaiting_client" || p.stage === "awaiting_content");
  const types = new Map<string, string[]>(); for (const p of live) types.set(p.type || "Unspecified", [...(types.get(p.type || "Unspecified") ?? []), p.id]);
  const durations = live.flatMap((p) => (p.actualStart && p.delivery?.date ? [Math.max(0, Math.round((Date.parse(p.delivery.date) - Date.parse(p.actualStart)) / 86_400_000))] : []));
  const withDeps = live.filter((p) => !CLOSED.includes(p.status) && p.dependencies.some((d) => !d.done));
  const soon = shiftDay(today, 30);
  return {
    created: live.filter((p) => inWindow(p.createdAt, w)).length, active: active.length, awaitingClient: awaiting.length, inProgress: live.filter((p) => p.status === "in_progress").length,
    completed: live.filter((p) => p.status === "completed").length, delivered: delivered.length, overdue: overdue.length,
    byType: [...types.entries()].map(([type, ids]) => ({ type, count: ids.length, ids })).sort((a, b) => b.count - a.count),
    tasksDone: t.filter((x) => x.status === "done").length, tasksTotal: t.length, tasksOverdue: t.filter((x) => taskOverdue(x, today)).length,
    openDependencies: withDeps.reduce((s, p) => s + p.dependencies.filter((d) => !d.done).length, 0), projectsWaitingOnClient: withDeps.length,
    supportOpen: support.filter((r) => pIds.has(r.projectId) && (r.status === "open" || r.status === "in_progress")).length,
    supportEnding: live.filter((p) => supportStatus(p.support, today) === "active" && !!p.support.end && p.support.end <= soon).length,
    avgDeliveryDays: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, deliveryMeasured: durations.length,
    ids: { active: active.map((p) => p.id), overdue: overdue.map((p) => p.id), delivered: delivered.map((p) => p.id), awaitingClient: awaiting.map((p) => p.id) },
  };
}
/** Linked-deal money read from Finance. Each Deal counts once even when several Projects link to it. */
export function projectFinanceLinks(projects: Project[], deals: Deal[], payments: Payment[]) {
  const live = projects.filter((p) => !p.archived && p.dealId);
  const dealIds = [...new Set(live.map((p) => p.dealId!))];
  const ds = deals.filter((d) => dealIds.includes(d.id) && d.status !== "cancelled");
  const deliveredUnpaid = live.filter((p) => p.delivery && ds.some((d) => d.id === p.dealId && dealOutstanding(d, payments) > 0)).map((p) => p.id);
  return { deals: ds.length, projects: live.length, value: ds.reduce((s, d) => s + d.finalAmount, 0), received: ds.reduce((s, d) => s + dealCollected(d.id, payments), 0), outstanding: ds.reduce((s, d) => s + dealOutstanding(d, payments), 0), deliveredUnpaid };
}

// ---------------------------------------------------------------- Forecast
export const OPEN_STAGES: LeadStatus[] = ["new", "contacted", "qualified", "proposal"];
export interface ForecastConfig { version: number; effectiveFrom: string; probabilities: Partial<Record<LeadStatus, number>>; conservative: number; optimistic: number; note?: string | undefined }
export const EMPTY_FORECAST: ForecastConfig = { version: 0, effectiveFrom: "", probabilities: {}, conservative: 0.75, optimistic: 1.25 };
export function forecastConfigError(c: Pick<ForecastConfig, "probabilities" | "conservative" | "optimistic">): string | null {
  for (const s of OPEN_STAGES) { const p = c.probabilities[s]; if (p == null || !Number.isFinite(p) || p < 0 || p > 100) return `Enter a probability between 0 and 100% for ${STATUS_LABEL[s]}.`; }
  if (!(c.conservative > 0 && c.conservative <= 1)) return "Conservative factor must be above 0 and at most 1.";
  if (!(c.optimistic >= 1 && c.optimistic <= 3)) return "Optimistic factor must be between 1 and 3.";
  return null;
}
export interface Opportunity { leadId: string; name: string; stage: LeadStatus; amount: number; probability: number; weighted: number; expectedClose?: string | undefined }
export interface Forecast { configured: boolean; opportunities: Opportunity[]; noAmount: string[]; weighted: number; open: number; conservative: number; optimistic: number; byMonth: { month: string; weighted: number; count: number }[]; byQuarter: { quarter: string; weighted: number; count: number }[]; undated: Opportunity[]; pastDue: Opportunity[] }
/** Weighted pipeline = Σ quoted amount × configured stage probability for open leads only (Won and Lost excluded). Undated opportunities are never given a month. */
export function forecast(leads: Lead[], cfg: ForecastConfig, expectedClose: Record<string, string>, now: Date): Forecast {
  const configured = cfg.version > 0 && forecastConfigError(cfg) === null;
  const open = leads.filter((l) => OPEN_STAGES.includes(l.status));
  const noAmount = open.filter((l) => !(l.quotedAmount && l.quotedAmount > 0)).map((l) => l.id);
  const opps: Opportunity[] = open.filter((l) => (l.quotedAmount ?? 0) > 0).map((l) => {
    const p = configured ? (cfg.probabilities[l.status] ?? 0) / 100 : 0;
    return { leadId: l.id, name: l.name, stage: l.status, amount: l.quotedAmount!, probability: p, weighted: Math.round(l.quotedAmount! * p), expectedClose: expectedClose[l.id] };
  });
  const weighted = opps.reduce((s, o) => s + o.weighted, 0);
  const today = dayKey(now);
  const dated = opps.filter((o) => o.expectedClose && o.expectedClose >= today);
  const months = new Map<string, { month: string; weighted: number; count: number }>(); const quarters = new Map<string, { quarter: string; weighted: number; count: number }>();
  for (const o of dated) {
    const m = o.expectedClose!.slice(0, 7); const q = `${m.slice(0, 4)} Q${Math.floor((Number(m.slice(5)) - 1) / 3) + 1}`;
    const a = months.get(m) ?? { month: m, weighted: 0, count: 0 }; a.weighted += o.weighted; a.count++; months.set(m, a);
    const b = quarters.get(q) ?? { quarter: q, weighted: 0, count: 0 }; b.weighted += o.weighted; b.count++; quarters.set(q, b);
  }
  const clamp = (x: number) => Math.min(1, x);
  return {
    configured, opportunities: opps, noAmount, weighted, open: opps.reduce((s, o) => s + o.amount, 0),
    conservative: Math.round(opps.reduce((s, o) => s + o.amount * clamp(o.probability * cfg.conservative), 0)),
    optimistic: Math.round(opps.reduce((s, o) => s + o.amount * clamp(o.probability * cfg.optimistic), 0)),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)), byQuarter: [...quarters.values()].sort((a, b) => a.quarter.localeCompare(b.quarter)),
    undated: opps.filter((o) => !o.expectedClose), pastDue: opps.filter((o) => o.expectedClose && o.expectedClose < today),
  };
}

// ---------------------------------------------------------------- Custom reports
export type ReportSource = "leads" | "calls" | "followups" | "deals" | "projects" | "support";
export type ReportChart = "bar" | "pie" | "table";
export interface ReportDef {
  id: string; name: string; source: ReportSource; metric: string; groupBy: string; period: AnalyticsPeriod; from?: string | undefined; to?: string | undefined;
  filter: { sources?: string[]; stages?: LeadStatus[]; tagId?: string | undefined }; chart: ReportChart; sort: "value" | "label";
  pinned: boolean; favorite: boolean; archived: boolean; createdAt: string; updatedAt: string; version: number;
}
export const SOURCE_LABEL: Record<ReportSource, string> = { leads: "Leads", calls: "Call outcomes", followups: "Follow-ups", deals: "Deals & payments", projects: "Projects", support: "Support requests" };
export const REPORT_METRICS: Record<ReportSource, { id: string; label: string; money?: boolean }[]> = {
  leads: [{ id: "count", label: "Number of leads" }, { id: "qualified", label: "Qualified or later" }, { id: "won", label: "Won leads" }, { id: "quoted", label: "Quoted value", money: true }],
  calls: [{ id: "count", label: "Saved call outcomes" }, { id: "connected", label: "Connected calls" }],
  followups: [{ id: "due", label: "Follow-ups due" }, { id: "completed", label: "Completed of those due" }],
  deals: [{ id: "count", label: "Deals booked", money: false }, { id: "value", label: "Won deal value", money: true }, { id: "received", label: "Payments received", money: true }, { id: "outstanding", label: "Outstanding today", money: true }],
  projects: [{ id: "count", label: "Projects" }, { id: "overdue", label: "Overdue projects" }],
  support: [{ id: "count", label: "Support requests" }],
};
/** Group-by options per data source. Lead dimensions also accept "tags" and active/archived select custom fields "cf:<id>". */
export const REPORT_DIMS: Record<ReportSource, { id: string; label: string }[]> = {
  leads: [{ id: "source", label: "Lead source" }, { id: "stage", label: "Pipeline stage" }, { id: "priority", label: "Priority" }, { id: "assignee", label: "Assigned employee" }, { id: "month", label: "Month created" }, { id: "tags", label: "Lead tag" }],
  calls: [{ id: "outcome", label: "Call outcome" }, { id: "source", label: "Lead source" }, { id: "month", label: "Month" }],
  followups: [{ id: "type", label: "Follow-up type" }, { id: "month", label: "Month due" }],
  deals: [{ id: "month", label: "Month (booked / paid)" }, { id: "status", label: "Deal status" }, { id: "source", label: "Lead source" }, { id: "method", label: "Payment method" }],
  projects: [{ id: "status", label: "Project status" }, { id: "stage", label: "Delivery stage" }, { id: "type", label: "Project type" }, { id: "priority", label: "Priority" }],
  support: [{ id: "priority", label: "Priority" }, { id: "status", label: "Status" }, { id: "kind", label: "Request type" }],
};
export function reportError(r: Pick<ReportDef, "name" | "source" | "metric" | "groupBy">, fields: CustomFieldDef[]): string | null {
  if (!r.name.trim()) return "Give the report a name.";
  if (!REPORT_METRICS[r.source].some((m) => m.id === r.metric)) return "That measure doesn't apply to this data source.";
  if (r.groupBy.startsWith("cf:")) {
    if (r.source !== "leads") return "Custom fields can only group Lead reports.";
    const f = fields.find((x) => x.id === r.groupBy.slice(3));
    if (!f) return "That custom field no longer exists.";
    if (f.type !== "select" && f.type !== "multi" && f.type !== "checkbox") return "Only choice fields (single or multiple choice, yes/no) can group a report.";
    if (f.visibility === "owner" && false) return null;
  } else if (!REPORT_DIMS[r.source].some((d) => d.id === r.groupBy)) return "That grouping doesn't apply to this data source.";
  if (r.source === "deals" && r.metric === "outstanding" && (r.groupBy === "month" || r.groupBy === "method")) return "Outstanding is a balance as of today — it can't be split by month or payment method.";
  if (r.source === "deals" && r.metric === "received" && r.groupBy === "status") return null;
  if (r.source === "deals" && r.groupBy === "method" && r.metric !== "received") return "Payment method only applies to Payments received.";
  return null;
}
export interface ReportRow { key: string; label: string; value: number; ids: string[]; kind: "lead" | "deal" | "project" | "payment" | "followup" | "support" }
export interface ReportResult { rows: ReportRow[]; total: number; money: boolean; warnings: string[]; window: Window }
const MONTH_LABEL = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
export function runReport(r: ReportDef, d: AnalyticsData, now: Date, ctx: { employeeName: (id: string) => string; idx?: ActivityIndex }): ReportResult {
  const w = analyticsWindow(r.period, now, r.from, r.to);
  const warnings: string[] = [];
  const money = !!REPORT_METRICS[r.source].find((m) => m.id === r.metric)?.money;
  const rows = new Map<string, ReportRow>();
  const add = (key: string, label: string, v: number, id: string, kind: ReportRow["kind"]) => { const x = rows.get(key) ?? { key, label, value: 0, ids: [], kind }; x.value += v; if (!x.ids.includes(id)) x.ids.push(id); rows.set(key, x); };
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  const leads = filterLeads(d.leads, { sources: r.filter.sources, stages: r.filter.stages, tagId: r.filter.tagId }, d);
  const leadIds = new Set(leads.map((l) => l.id));
  const tagName = (id: string) => { const t = d.tagDefs.find((x) => x.id === id); if (t?.status === "archived" && !warnings.includes(`Tag “${t.name}” is archived — its links are still counted.`)) warnings.push(`Tag “${t.name}” is archived — its links are still counted.`); return t?.name ?? "Removed tag"; };
  if (r.filter.tagId && d.tagDefs.find((t) => t.id === r.filter.tagId)?.status === "archived") warnings.push("The tag used as a filter is archived; existing links still apply.");
  const leadKey = (l: Lead): [string, string][] => {
    const g = r.groupBy;
    if (g === "source") return [[l.source, l.source]];
    if (g === "stage") return [[l.status, STATUS_LABEL[l.status]]];
    if (g === "priority") return [[l.priority, l.priority[0]!.toUpperCase() + l.priority.slice(1)]];
    if (g === "assignee") { const a = d.assignments[l.id]?.employeeId; return [[a ?? "none", a ? ctx.employeeName(a) : "Unassigned"]]; }
    if (g === "month") { const m = dayKey(l.createdAt).slice(0, 7); return [[m, MONTH_LABEL(m)]]; }
    if (g === "tags") { const ts = d.leadTags[l.id] ?? []; return ts.length ? ts.map((t) => [t, tagName(t)]) : [["none", "No tag"]]; }
    if (g.startsWith("cf:")) {
      const f = d.customFields.find((x) => x.id === g.slice(3)); if (!f) return [["none", "Field removed"]];
      const v = d.fieldValues[l.id]?.[f.id];
      if (v == null || v === "") return [["none", "Not set"]];
      if (typeof v === "boolean") return [[String(v), v ? "Yes" : "No"]];
      const vals = Array.isArray(v) ? (v as string[]) : [String(v)];
      return vals.map((id) => { const o = f.options?.find((x) => x.id === id); return [id, o ? o.label + (o.archived ? " (retired option)" : "") : "Unknown option"] as [string, string]; });
    }
    return [["all", "All"]];
  };
  if (r.groupBy.startsWith("cf:")) { const f = d.customFields.find((x) => x.id === r.groupBy.slice(3)); if (f?.status === "archived") warnings.push(`“${f.label}” is archived. Its stored values are kept and still reported, but new leads can't fill it in.`); if (!f) warnings.push("The custom field this report groups by was deleted."); }
  switch (r.source) {
    case "leads": for (const l of leads) {
      if (!inWindow(l.createdAt, w)) continue;
      const v = r.metric === "count" ? 1 : r.metric === "qualified" ? (QUALIFIED_OR_LATER.includes(l.status) ? 1 : 0) : r.metric === "won" ? (l.status === "won" ? 1 : 0) : (l.quotedAmount ?? 0);
      for (const [k, lab] of leadKey(l)) if (v || r.metric === "count") add(k, lab, v, l.id, "lead");
    } break;
    case "calls": { const idx = ctx.idx ?? indexActivity(d.activities); for (const c of idx.calls) {
      if (!leadIds.has(c.leadId) || !inWindow(c.at, w)) continue;
      const v = r.metric === "connected" ? (isConnectedOutcome(c.outcome as CallOutcome) ? 1 : 0) : 1; if (!v) continue;
      const l = leadById.get(c.leadId);
      const [k, lab] = r.groupBy === "outcome" ? [c.outcome!, c.outcome!] : r.groupBy === "source" ? [l?.source ?? "?", l?.source ?? "Unknown"] : [dayKey(c.at).slice(0, 7), MONTH_LABEL(dayKey(c.at).slice(0, 7))];
      add(k, lab, v, c.leadId, "lead");
    } break; }
    case "followups": for (const f of d.followUps) {
      if (f.cancelledAt || !leadIds.has(f.leadId) || !inWindow(f.dueAt, w)) continue;
      const v = r.metric === "completed" ? (f.completedAt ? 1 : 0) : 1; if (!v) continue;
      const [k, lab] = r.groupBy === "type" ? [f.type, f.type === "whatsapp" ? "WhatsApp" : f.type[0]!.toUpperCase() + f.type.slice(1)] : [dayKey(f.dueAt).slice(0, 7), MONTH_LABEL(dayKey(f.dueAt).slice(0, 7))];
      add(k, lab, v, f.leadId, "lead");
    } break;
    case "deals": {
      const eligible = d.deals.filter((x) => x.status !== "cancelled" || r.groupBy === "status");
      const srcOf = (x: Deal) => (x.leadId ? leadById.get(x.leadId)?.source ?? "Lead removed" : "Not from a CRM lead");
      const dealKey = (x: Deal, at?: string): [string, string] => r.groupBy === "status" ? [x.status, x.status.replace("_", " ")] : r.groupBy === "source" ? [srcOf(x), srcOf(x)] : [dayKey(at ?? x.createdAt).slice(0, 7), MONTH_LABEL(dayKey(at ?? x.createdAt).slice(0, 7))];
      if (r.metric === "received") { const ids = new Set(eligible.filter((x) => x.status !== "cancelled").map((x) => x.id)); for (const p of d.payments) {
        if (p.voided || !ids.has(p.dealId) || !inWindow(p.date, w)) continue; const x = eligible.find((y) => y.id === p.dealId)!;
        const [k, lab] = r.groupBy === "method" ? [p.method, p.method] : dealKey(x, p.date); add(k, lab, p.amount, x.id, "deal");
      } } else for (const x of eligible) {
        if (r.metric !== "outstanding" && !inWindow(x.createdAt, w)) continue;
        const v = r.metric === "count" ? 1 : r.metric === "value" ? (x.status === "cancelled" ? 0 : x.finalAmount) : dealOutstanding(x, d.payments);
        if (!v && r.metric !== "count") continue; const [k, lab] = dealKey(x); add(k, lab, v, x.id, "deal");
      }
      if (r.metric === "outstanding") warnings.push("Outstanding is today's balance for every active deal; the date range does not apply.");
      break;
    }
    case "projects": { const today = dayKey(now); for (const p of d.projects) {
      if (p.archived || !inWindow(p.createdAt, w)) continue;
      const v = r.metric === "overdue" ? (isProjectOverdue(p, today) ? 1 : 0) : 1; if (!v) continue;
      const g = r.groupBy; const k = g === "status" ? p.status : g === "stage" ? p.stage : g === "type" ? p.type || "Unspecified" : p.priority;
      add(k, k.replace(/_/g, " "), v, p.id, "project");
    } break; }
    case "support": { const pids = new Set(d.projects.filter((p) => !p.archived).map((p) => p.id)); for (const s of d.supportRequests) {
      if (!pids.has(s.projectId) || !inWindow(s.createdAt, w)) continue;
      const k = r.groupBy === "status" ? s.status : r.groupBy === "kind" ? s.kind : s.priority; add(k, k.replace(/_/g, " "), 1, s.projectId, "project");
    } break; }
  }
  const list = [...rows.values()].sort(r.sort === "label" ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return { rows: list, total: list.reduce((s, x) => s + x.value, 0), money, warnings, window: w };
}
/** Report starters (definitions only — results are always recomputed from current records). */
export const REPORT_PRESETS: Pick<ReportDef, "name" | "source" | "metric" | "groupBy" | "chart">[] = [
  { name: "Leads by source", source: "leads", metric: "count", groupBy: "source", chart: "bar" },
  { name: "Won deals by month", source: "deals", metric: "value", groupBy: "month", chart: "bar" },
  { name: "Call outcomes", source: "calls", metric: "count", groupBy: "outcome", chart: "pie" },
  { name: "Follow-up completion", source: "followups", metric: "completed", groupBy: "type", chart: "bar" },
  { name: "Outstanding by deal status", source: "deals", metric: "outstanding", groupBy: "status", chart: "table" },
  { name: "Pipeline value by stage", source: "leads", metric: "quoted", groupBy: "stage", chart: "bar" },
  { name: "Projects by delivery status", source: "projects", metric: "count", groupBy: "status", chart: "bar" },
  { name: "Support requests by priority", source: "support", metric: "count", groupBy: "priority", chart: "pie" },
  { name: "Tag performance", source: "leads", metric: "won", groupBy: "tags", chart: "bar" },
];

// ---------------------------------------------------------------- Definitions (shown in info tooltips)
export const DEFINITIONS: Record<string, string> = {
  newLeads: "Leads created in the selected range (business day, India time). Source: Leads. Waste-bin leads are excluded.",
  awaitingContact: "Open leads with no saved call outcome yet. Opening the dialer or WhatsApp does not count as contact.",
  qualified: "Leads created in the range that are now Qualified, Proposal Sent or Won.",
  wonDeals: "Deals booked (created) in Deals & Payments during the range, excluding cancelled deals. A won deal does not prove payment.",
  wonValue: "Final amount of deals booked in the range, excluding cancelled deals. This is not money received.",
  received: "Sum of valid payments dated in the range for non-cancelled deals. Voided payments are excluded. Matches Deals & Payments.",
  outstanding: "Unpaid balance across all active deals as of today (final amount − valid payments, never below zero). Not a period value.",
  overdue: "Only balances on deals with a recorded due date in the past. Unpaid without a due date is Outstanding, not Overdue.",
  fuCompleted: "Follow-ups marked complete in the range. Cancelled or replaced follow-ups never count.",
  fuOverdue: "Pending follow-ups whose due time has passed (right now, not for the range).",
  activeProjects: "Projects not archived, cancelled, completed, delivered or in support. Same rule as Project Desk.",
  overdueProjects: "Active projects whose target delivery date is before today.",
  lost: "Leads currently Lost. Reason shows “Not recorded” when none was saved — it is never guessed.",
  funnelCurrent: "How many leads sit in each stage right now (filters apply, date range does not).",
  funnelMoves: "Recorded stage changes into each stage during the range. Leads created directly in a later stage, or moved before history was recorded, are not counted.",
  funnelCohort: "Of the leads created in the range, the share that is Won today. Recent cohorts are still developing.",
  calls: "Saved call outcomes in the range. Connected = any outcome except Not picked and Busy.",
  firstAttempt: "Median hours from lead creation to its first saved call outcome, for leads created in the range that have one.",
  weighted: "Σ quoted amount × your configured stage probability, for open leads only. A scenario estimate, not guaranteed revenue.",
};
