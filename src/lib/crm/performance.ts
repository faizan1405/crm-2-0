// Phase 3F — Team Performance, Sales Goals and Scorecards (pure, backend-agnostic).
// Two strictly separate ideas:
//  • Assigned workload — what is currently assigned to an employee (from `assignments`).
//  • Verified contribution — actions whose ActivityEvent actorUserId is that employee.
// Locally only the Owner (and Automation) are trustworthy actors, so employee contribution is
// "Not measurable yet" until an authenticated backend sends events with real actor ids.
// Demo events (eventSource "demo") are accepted only when the caller passes them explicitly
// and are never persisted, reported company-wide or backed up.
import type { FollowUp, Lead, LeadStatus, Payment } from "./types";
import { LEAD_STATUSES } from "./types";
import type { Assignment } from "./access";
import type { ActivityEvent } from "./activity";
import { OWNER_ACTOR_ID } from "./activity";
import type { Employee } from "./team";
import { dayKey } from "./format";
import { shiftDay } from "./dates";
import { isPending } from "./followups";
import { CALL_OUTCOMES, isConnectedOutcome, type CallOutcome } from "./calllog";

// ---------------- Periods (Asia/Kolkata business days) ----------------
export type PeriodKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";
export const PERIODS: { id: PeriodKey; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "thisWeek", label: "This week" }, { id: "lastWeek", label: "Last week" },
  { id: "thisMonth", label: "This month" }, { id: "lastMonth", label: "Last month" }, { id: "custom", label: "Custom" },
];
export interface Window { start: string; end: string } // inclusive yyyy-mm-dd business days

/** Monday of the business week containing `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sun
  return shiftDay(day, -((dow + 6) % 7));
}
const monthStart = (day: string) => `${day.slice(0, 8)}01`;
function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 8)}${String(last).padStart(2, "0")}`;
}
export function periodWindow(p: PeriodKey, now: Date | string, from?: string, to?: string): Window {
  const today = dayKey(now);
  switch (p) {
    case "today": return { start: today, end: today };
    case "yesterday": { const y = shiftDay(today, -1); return { start: y, end: y }; }
    case "thisWeek": { const s = weekStart(today); return { start: s, end: shiftDay(s, 6) }; }
    case "lastWeek": { const s = shiftDay(weekStart(today), -7); return { start: s, end: shiftDay(s, 6) }; }
    case "thisMonth": return { start: monthStart(today), end: monthEnd(today) };
    case "lastMonth": { const d = shiftDay(monthStart(today), -1); return { start: monthStart(d), end: d }; }
    case "custom": {
      const s = from || shiftDay(today, -29), e = to || today;
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
  }
}
export const inWindow = (iso: string | undefined, w: Window) => { if (!iso) return false; const k = dayKey(iso); return k >= w.start && k <= w.end; };
export function daysOf(w: Window, max = 400): string[] {
  const out: string[] = []; let d = w.start;
  while (d <= w.end && out.length < max) { out.push(d); d = shiftDay(d, 1); }
  return out;
}

// ---------------- Metrics ----------------
export type MetricKey = "calls" | "connected" | "followupsCompleted" | "followupsRescheduled" | "leadsCreated" | "stageChanges" | "qualified" | "won" | "lost" | "salesValue";
export interface MetricDef { key: MetricKey; label: string; unit: "count" | "inr"; definition: string; financial?: boolean; goalable: boolean }
export const METRICS: MetricDef[] = [
  { key: "calls", label: "Calls logged", unit: "count", goalable: true, definition: "Saved call outcomes by this person (every outcome, including Not picked and Busy). Opening the dialer does not count; reversed calls are subtracted." },
  { key: "connected", label: "Connected calls", unit: "count", goalable: true, definition: "Saved call outcomes other than Not picked or Busy." },
  { key: "followupsCompleted", label: "Follow-ups completed", unit: "count", goalable: true, definition: "Follow-ups this person marked complete in the period. Cancelled or replaced follow-ups never count." },
  { key: "followupsRescheduled", label: "Follow-ups rescheduled", unit: "count", goalable: false, definition: "Follow-ups this person moved to a new time. A reschedule is not a completion." },
  { key: "leadsCreated", label: "New leads created", unit: "count", goalable: true, definition: "Leads this person created. Current assignment is never used." },
  { key: "stageChanges", label: "Pipeline changes", unit: "count", goalable: false, definition: "Recorded stage moves, including Won and Lost." },
  { key: "qualified", label: "Leads qualified", unit: "count", goalable: true, definition: "Recorded moves into the Qualified stage by this person." },
  { key: "won", label: "Deals won", unit: "count", goalable: true, definition: "Leads this person marked Won. The current assignee is not credited unless they made the change." },
  { key: "lost", label: "Deals lost", unit: "count", goalable: false, definition: "Leads this person marked Lost." },
  { key: "salesValue", label: "Sales value", unit: "inr", financial: true, goalable: true, definition: "Non-voided payments recorded in the period. Team-level only until payments carry a verified actor." },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

/** Events that may be counted as genuine work. Demo events only when explicitly allowed. */
export const countable = (e: ActivityEvent, allowDemo = false) => (e.eventSource === "demo" ? allowDemo : true);

const stageTo = (e: ActivityEvent): LeadStatus | undefined => {
  const v = e.newValues?.["status"] ?? e.newValues?.["stage"] ?? e.newValues?.["to"];
  return typeof v === "string" ? (v as LeadStatus) : undefined;
};
/** Does this event contribute to `metric`, and by how much? */
export function eventValue(e: ActivityEvent, metric: MetricKey): number {
  switch (metric) {
    case "calls": return e.eventType === "call.logged" ? 1 : e.eventType === "call.reversed" ? -1 : 0;
    case "connected": {
      const o = e.newValues?.["outcome"];
      if (e.eventType === "call.logged") return typeof o === "string" && isConnectedOutcome(o as CallOutcome) ? 1 : 0;
      if (e.eventType === "call.reversed") { const p = e.oldValues?.["outcome"]; return typeof p === "string" && isConnectedOutcome(p as CallOutcome) ? -1 : 0; }
      return 0;
    }
    case "followupsCompleted": return e.eventType === "followup.completed" ? 1 : 0;
    case "followupsRescheduled": return e.eventType === "followup.rescheduled" ? 1 : 0;
    case "leadsCreated": return e.eventType === "lead.created" ? 1 : 0;
    case "stageChanges": return e.eventType === "pipeline.stage_changed" || e.eventType === "deal.won" || e.eventType === "deal.lost" ? 1 : 0;
    case "qualified": return e.eventType === "pipeline.stage_changed" && stageTo(e) === "qualified" ? 1 : 0;
    case "won": return e.eventType === "deal.won" ? 1 : 0;
    case "lost": return e.eventType === "deal.lost" ? 1 : 0;
    case "salesValue": return 0;
  }
}

export type ActorFilter = { kind: "employee"; id: string } | { kind: "team" };
const actorMatch = (e: ActivityEvent, a: ActorFilter) => (a.kind === "team" ? e.actorUserId !== "automation" : e.actorUserId === a.id);

/** Index events once per render (bucketed by business day) so repeated metric reads stay cheap on large datasets. */
export interface EventIndex { byDay: Map<string, ActivityEvent[]>; actors: Set<string> }
export function indexEvents(events: ActivityEvent[], allowDemo = false): EventIndex {
  const byDay = new Map<string, ActivityEvent[]>(), actors = new Set<string>();
  for (const e of events) {
    if (!countable(e, allowDemo)) continue;
    const k = dayKey(e.occurredAt);
    const arr = byDay.get(k); if (arr) arr.push(e); else byDay.set(k, [e]);
    actors.add(e.actorUserId);
  }
  return { byDay, actors };
}
export function eventsIn(idx: EventIndex, w: Window): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const d of daysOf(w)) { const a = idx.byDay.get(d); if (a) out.push(...a); }
  return out;
}

/** Whether genuine actor attribution exists for an employee. Owner always has it locally. */
export const hasAttribution = (idx: EventIndex, employeeId: string) => employeeId === OWNER_ACTOR_ID || idx.actors.has(employeeId);

/** Metric total. Returns null when the value cannot be measured honestly. */
export function metricValue(idx: EventIndex, metric: MetricKey, actor: ActorFilter, w: Window, payments: Payment[] = []): number | null {
  if (metric === "salesValue") {
    if (actor.kind !== "team") return null; // payments carry no verified actor yet
    return payments.filter((p) => !p.voided && inWindow(p.date, w)).reduce((s, p) => s + p.amount, 0);
  }
  if (actor.kind === "employee" && !hasAttribution(idx, actor.id)) return null;
  let n = 0;
  for (const e of eventsIn(idx, w)) if (actorMatch(e, actor)) n += eventValue(e, metric);
  return Math.max(0, n);
}
export function metricSeries(idx: EventIndex, metric: MetricKey, actor: ActorFilter, w: Window): { day: string; value: number; events: ActivityEvent[] }[] {
  return daysOf(w, 92).map((day) => {
    const evs = (idx.byDay.get(day) ?? []).filter((e) => actorMatch(e, actor) && eventValue(e, metric) !== 0);
    return { day, value: Math.max(0, evs.reduce((s, e) => s + eventValue(e, metric), 0)), events: evs };
  });
}

/** n / d, or null (shown as N/A) when the denominator is zero. */
export const rate = (n: number | null, d: number | null): number | null => (n == null || d == null || d <= 0 ? null : n / d);

/** Follow-up completion: of non-cancelled follow-ups currently due in the window (rescheduled ones count by their new due date), how many are completed. */
export function followUpCompletion(followUps: FollowUp[], w: Window, leadIds?: Set<string>) {
  const due = followUps.filter((f) => !f.cancelledAt && inWindow(f.dueAt, w) && (!leadIds || leadIds.has(f.leadId)));
  const done = due.filter((f) => f.completedAt).length;
  return { due: due.length, done, rate: rate(done, due.length) };
}
/** Lead-to-Win cohort: leads created in the window; how many of that same cohort are Won today. */
export function cohortConversion(leads: Lead[], w: Window, leadIds?: Set<string>) {
  const cohort = leads.filter((l) => inWindow(l.createdAt, w) && (!leadIds || leadIds.has(l.id)));
  const won = cohort.filter((l) => l.status === "won").length;
  const qualified = cohort.filter((l) => ["qualified", "proposal", "won"].includes(l.status)).length;
  return { cohort: cohort.length, won, qualified, winRate: rate(won, cohort.length), qualRate: rate(qualified, cohort.length) };
}

// ---------------- Workload (assigned, never credited as contribution) ----------------
export interface Workload { assigned: number; open: number; hot: number; fresh: number; openFollowUps: number; overdue: number; dueToday: number; byStage: Record<LeadStatus, number>; recent: Lead[] }
export function workloadFor(employeeId: string | null, data: { leads: Lead[]; followUps: FollowUp[]; assignments: Record<string, Assignment> }, now: Date | string): Workload {
  const today = dayKey(now), nowIso = new Date(now).toISOString();
  const mine = data.leads.filter((l) => (data.assignments[l.id]?.employeeId ?? null) === employeeId);
  const ids = new Set(mine.map((l) => l.id));
  const fu = data.followUps.filter((f) => ids.has(f.leadId) && isPending(f));
  const byStage = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const l of mine) byStage[l.status]++;
  const weekAgo = new Date(new Date(now).getTime() - 7 * 864e5).toISOString();
  return {
    assigned: mine.length,
    open: mine.filter((l) => l.status !== "won" && l.status !== "lost").length,
    hot: mine.filter((l) => l.priority === "hot" && l.status !== "won" && l.status !== "lost").length,
    fresh: byStage.new,
    openFollowUps: fu.length,
    overdue: fu.filter((f) => f.dueAt < nowIso && dayKey(f.dueAt) < today).length,
    dueToday: fu.filter((f) => dayKey(f.dueAt) === today).length,
    byStage,
    recent: mine.filter((l) => (data.assignments[l.id]?.assignedAt ?? "") >= weekAgo).sort((a, b) => (data.assignments[b.id]!.assignedAt).localeCompare(data.assignments[a.id]!.assignedAt)).slice(0, 5),
  };
}

export interface Insight { id: string; tone: "warn" | "info"; text: string; employeeId?: string; action: "followups" | "leads" | "distribute" | "workspace" }
export function workloadInsights(employees: Employee[], loads: Record<string, Workload>, unassigned: number): Insight[] {
  const out: Insight[] = [];
  if (unassigned > 0) out.push({ id: "unassigned", tone: "info", text: `${unassigned} lead${unassigned === 1 ? "" : "s"} awaiting distribution.`, action: "distribute" });
  const act = employees.filter((e) => e.accountStatus === "active");
  for (const e of act) {
    const w = loads[e.id]; if (!w) continue;
    if (w.overdue >= 5) out.push({ id: `overdue:${e.id}`, tone: "warn", text: `${e.name} has ${w.overdue} overdue follow-ups.`, employeeId: e.id, action: "followups" });
    if (w.hot >= 5) out.push({ id: `hot:${e.id}`, tone: "info", text: `${e.name} holds ${w.hot} Hot leads that need attention.`, employeeId: e.id, action: "leads" });
  }
  if (act.length >= 2) {
    const n = act.map((e) => loads[e.id]?.open ?? 0), max = Math.max(...n), min = Math.min(...n), avg = n.reduce((s, x) => s + x, 0) / n.length;
    if (max - min >= 5 && max > avg * 1.5) { const top = act[n.indexOf(max)]!; out.push({ id: "imbalance", tone: "warn", text: `Workload imbalance: ${top.name} has ${max} open leads; the lightest load is ${min}.`, employeeId: top.id, action: "distribute" }); }
  }
  return out;
}

// ---------------- Goals ----------------
export type GoalPeriod = "daily" | "weekly" | "monthly" | "custom";
export type GoalStatus = "active" | "paused" | "archived";
export type GoalScope = "employee" | "team";
export interface GoalDef {
  id: string; name: string; metric: MetricKey; target: number; period: GoalPeriod;
  customFrom?: string | undefined; customTo?: string | undefined;
  scope: GoalScope; employeeIds: string[]; status: GoalStatus;
  /** Business day this version takes effect; earlier periods keep using the previous version. */
  effectiveFrom: string; version: number; createdAt: string; updatedAt: string;
}
export interface GoalRevision { id: string; goalId: string; version: number; at: string; change: string; def: GoalDef }
export type GoalInput = Pick<GoalDef, "name" | "metric" | "target" | "period" | "scope" | "employeeIds" | "effectiveFrom"> & { customFrom?: string | undefined; customTo?: string | undefined };
export const GOAL_PERIOD_LABEL: Record<GoalPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom range" };

export function goalError(g: GoalInput, employees: Employee[]): string | null {
  if (!g.name.trim()) return "Name the goal.";
  if (g.name.trim().length > 80) return "Goal name is too long.";
  if (!METRIC[g.metric]?.goalable) return "Choose a goal type.";
  if (!Number.isFinite(g.target) || g.target <= 0) return "Target must be greater than zero.";
  if (METRIC[g.metric].unit === "count" && !Number.isInteger(g.target)) return "Count targets must be whole numbers.";
  if (g.target > 1e9) return "Target is too large.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.effectiveFrom)) return "Choose an effective date.";
  if (g.period === "custom" && (!g.customFrom || !g.customTo || g.customFrom > g.customTo)) return "Choose a valid custom date range.";
  if (g.scope === "employee") {
    if (!g.employeeIds.length) return "Assign the goal to at least one employee.";
    if (g.employeeIds.some((id) => !employees.some((e) => e.id === id && e.accountStatus !== "archived"))) return "One of the selected employees no longer exists.";
  }
  return null;
}
export function buildGoal(input: GoalInput, id: string, at: string): GoalDef {
  return { ...input, name: input.name.trim(), employeeIds: input.scope === "team" ? [] : [...new Set(input.employeeIds)], id, status: "active", version: 1, createdAt: at, updatedAt: at, customFrom: input.period === "custom" ? input.customFrom : undefined, customTo: input.period === "custom" ? input.customTo : undefined };
}
/** Edit = new version + revision snapshot of the old one. Returns the new def and the revision row. */
export function reviseGoal(cur: GoalDef, input: GoalInput, at: string, revId: string): { next: GoalDef; revision: GoalRevision } {
  const next: GoalDef = { ...cur, ...buildGoal(input, cur.id, at), status: cur.status, createdAt: cur.createdAt, version: cur.version + 1 };
  const diff: string[] = [];
  if (cur.target !== next.target) diff.push(`target ${cur.target} → ${next.target}`);
  if (cur.name !== next.name) diff.push("renamed");
  if (cur.period !== next.period) diff.push(`period ${cur.period} → ${next.period}`);
  if (cur.metric !== next.metric) diff.push(`type ${METRIC[cur.metric].label} → ${METRIC[next.metric].label}`);
  if (cur.employeeIds.join() !== next.employeeIds.join() || cur.scope !== next.scope) diff.push("assignees changed");
  if (cur.effectiveFrom !== next.effectiveFrom) diff.push(`effective ${next.effectiveFrom}`);
  return { next, revision: { id: revId, goalId: cur.id, version: cur.version, at, change: diff.join(", ") || "saved without changes", def: cur } };
}
/** The goal definition that applied on `day` (historical periods keep their old target). */
export function definitionOn(goal: GoalDef, revisions: GoalRevision[], day: string): GoalDef | null {
  if (goal.effectiveFrom <= day) return goal;
  const older = revisions.filter((r) => r.goalId === goal.id && r.def.effectiveFrom <= day).sort((a, b) => b.version - a.version)[0];
  return older?.def ?? null;
}
/** The single reporting period of a goal that contains `day` — each activity falls in exactly one. */
export function goalWindow(g: Pick<GoalDef, "period" | "customFrom" | "customTo">, day: string): Window | null {
  if (g.period === "daily") return { start: day, end: day };
  if (g.period === "weekly") { const s = weekStart(day); return { start: s, end: shiftDay(s, 6) }; }
  if (g.period === "monthly") return { start: monthStart(day), end: monthEnd(day) };
  if (!g.customFrom || !g.customTo || day < g.customFrom || day > g.customTo) return null;
  return { start: g.customFrom, end: g.customTo };
}

export type ProgressStatus = "not_measurable" | "no_activity" | "in_progress" | "met" | "exceeded" | "paused" | "inactive" | "not_started" | "outside_range";
export interface Progress { target: number; actual: number | null; pct: number | null; remaining: number | null; status: ProgressStatus; window: Window | null }
export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  not_measurable: "Not measurable yet", no_activity: "No activity yet", in_progress: "In progress", met: "Target met", exceeded: "Target exceeded",
  paused: "Paused", inactive: "Employee inactive", not_started: "Not in effect yet", outside_range: "Outside goal dates",
};
export function progressOf(target: number, actual: number | null, window: Window | null): Progress {
  if (!window) return { target, actual: null, pct: null, remaining: null, status: "outside_range", window };
  if (actual == null) return { target, actual: null, pct: null, remaining: null, status: "not_measurable", window };
  const pct = target > 0 ? actual / target : null;
  const status: ProgressStatus = actual === 0 ? "no_activity" : actual > target ? "exceeded" : actual === target ? "met" : "in_progress";
  return { target, actual, pct, remaining: Math.max(0, target - actual), status, window };
}
export interface GoalProgressRow { goal: GoalDef; def: GoalDef | null; employeeId: string | null; progress: Progress }
/** Progress of a goal for one assignee (or the whole team) for the period containing `day`. */
export function goalProgress(goal: GoalDef, revisions: GoalRevision[], employeeId: string | null, idx: EventIndex, day: string, ctx: { employees: Employee[]; payments: Payment[] }): Progress {
  const def = definitionOn(goal, revisions, day);
  if (!def) return { target: goal.target, actual: null, pct: null, remaining: null, status: "not_started", window: null };
  const w = goalWindow(def, day);
  if (goal.status === "paused") return { ...progressOf(def.target, null, w), status: "paused" };
  if (employeeId) {
    const e = ctx.employees.find((x) => x.id === employeeId);
    if (!e || e.accountStatus === "inactive" || e.accountStatus === "archived") return { ...progressOf(def.target, null, w), status: "inactive" };
  }
  if (!w) return progressOf(def.target, null, null);
  const actor: ActorFilter = employeeId ? { kind: "employee", id: employeeId } : { kind: "team" };
  return progressOf(def.target, metricValue(idx, def.metric, actor, w, ctx.payments), w);
}
export const goalsFor = (goals: GoalDef[], employeeId: string) => goals.filter((g) => g.status !== "archived" && g.scope === "employee" && g.employeeIds.includes(employeeId));

/** Employees without finance access never see monetary goals or values. */
export const visibleGoal = (g: Pick<GoalDef, "metric">, canSeeMoney: boolean) => canSeeMoney || !METRIC[g.metric].financial;

// ---------------- Goal notifications (deduplicated, never per-call spam) ----------------
export interface PerfPrefs { notifyGoalAchieved: boolean; notifyTeamGoal: boolean; notifyMilestone: boolean; notifyOverdue: boolean; overdueThreshold: number }
export const DEFAULT_PERF_PREFS: PerfPrefs = { notifyGoalAchieved: true, notifyTeamGoal: true, notifyMilestone: false, notifyOverdue: true, overdueThreshold: 10 };
export interface GoalAlert { id: string; kind: "achieved" | "team_achieved" | "milestone" | "overdue"; text: string; at: string; goalId?: string; employeeId?: string }
/** Stable ids: one alert per goal version × assignee × period × kind — re-evaluation never duplicates. */
export function goalAlerts(rows: GoalProgressRow[], loads: Record<string, Workload>, employees: Employee[], prefs: PerfPrefs, at: string): GoalAlert[] {
  const out: GoalAlert[] = [];
  const name = (id: string | null) => (id ? employees.find((e) => e.id === id)?.name ?? "Employee" : "Team");
  for (const r of rows) {
    const p = r.progress; if (!p.window || p.pct == null || r.goal.status !== "active") continue;
    const base = `goal:${r.goal.id}:v${r.def?.version ?? r.goal.version}:${r.employeeId ?? "team"}:${p.window.start}`;
    const reached = p.status === "met" || p.status === "exceeded";
    if (reached && (r.employeeId ? prefs.notifyGoalAchieved : prefs.notifyTeamGoal)) out.push({ id: `${base}:achieved`, kind: r.employeeId ? "achieved" : "team_achieved", text: `${name(r.employeeId)} reached “${r.goal.name}” (${p.actual}/${p.target}).`, at, goalId: r.goal.id, ...(r.employeeId ? { employeeId: r.employeeId } : {}) });
    else if (prefs.notifyMilestone && p.pct >= 0.5 && r.goal.period !== "daily") out.push({ id: `${base}:half`, kind: "milestone", text: `${name(r.employeeId)} is halfway to “${r.goal.name}”.`, at, goalId: r.goal.id });
  }
  if (prefs.notifyOverdue) for (const e of employees) { const w = loads[e.id]; if (w && w.overdue >= prefs.overdueThreshold) out.push({ id: `overdue:${e.id}:${dayKey(at)}`, kind: "overdue", text: `${e.name} has ${w.overdue} overdue follow-ups.`, at, employeeId: e.id }); }
  return out;
}
export function mergeAlerts(cur: GoalAlert[], next: GoalAlert[], cap = 300): GoalAlert[] {
  const seen = new Set(cur.map((a) => a.id));
  const fresh = next.filter((a) => !seen.has(a.id) && (seen.add(a.id), true));
  return fresh.length ? [...fresh, ...cur].slice(0, cap) : cur;
}

// ---------------- Demo Mode (synthetic, in-memory only) ----------------
const OUTCOMES: readonly CallOutcome[] = CALL_OUTCOMES;
export function demoPerformanceEvents(employees: Employee[], leads: Lead[], now: Date): ActivityEvent[] {
  const emps = employees.filter((e) => e.accountStatus === "active").slice(0, 6);
  if (!emps.length || !leads.length) return [];
  const out: ActivityEvent[] = []; let i = 0;
  emps.forEach((e, ei) => {
    for (let d = 0; d < 14; d++) {
      const calls = ((ei * 3 + d * 5) % 7) + 2;
      for (let c = 0; c < calls; c++) {
        const l = leads[(i++) % leads.length]!;
        const at = new Date(now.getTime() - d * 864e5 - (c + 1) * 23 * 60000).toISOString();
        const push = (eventType: ActivityEvent["eventType"], extra: Partial<ActivityEvent> = {}) => out.push({ eventId: `demo-perf:${e.id}:${d}:${c}:${eventType}`, eventType, actorUserId: e.id, actorRole: e.roleId, actorName: e.name, entityType: "lead", entityId: l.id, relatedLeadId: l.id, occurredAt: at, summary: `${e.name} · ${eventType} (Demo)`, module: "calls", importance: "normal", operationId: `demo:${i}`, eventSource: "demo", schemaVersion: 1, ...extra });
        push("call.logged", { newValues: { outcome: OUTCOMES[(c + d + ei) % OUTCOMES.length] } });
        if (c % 3 === 0) push("followup.completed", { module: "followups" });
        if (c % 5 === 1) push("pipeline.stage_changed", { module: "pipeline", newValues: { status: "qualified" } });
        if (c % 9 === 4) push("deal.won", { module: "pipeline", newValues: { status: "won" } });
      }
    }
  });
  return out;
}

/** App-level goal alert evaluation (runs from the shared browser runner, not a page). Genuine events only; alert ids are stable, so re-runs never duplicate. */
export function evaluateGoalAlerts(s: { goals: GoalDef[]; goalRevisions: GoalRevision[]; teamEvents: ActivityEvent[]; employees: Employee[]; payments: Payment[]; leads: Lead[]; followUps: FollowUp[]; assignments: Record<string, Assignment>; perfPrefs: PerfPrefs }, now: Date): GoalAlert[] {
  const live = s.goals.filter((g) => g.status !== "archived"); if (!live.length) return [];
  const idx = indexEvents(s.teamEvents, false); const day = dayKey(now); const ctx = { employees: s.employees, payments: s.payments };
  const emps = s.employees.filter((e) => e.accountStatus !== "archived");
  const rows: GoalProgressRow[] = live.flatMap((g) => (g.scope === "team" ? [null] : g.employeeIds).map((eid) => ({ goal: g, def: g, employeeId: eid, progress: goalProgress(g, s.goalRevisions, eid, idx, day, ctx) })));
  const data = { leads: s.leads, followUps: s.followUps, assignments: s.assignments };
  const loads = Object.fromEntries(emps.map((e) => [e.id, workloadFor(e.id, data, now)])) as Record<string, Workload>;
  return goalAlerts(rows, loads, emps, s.perfPrefs, now.toISOString());
}
