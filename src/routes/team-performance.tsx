import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Gauge, Plus, FlaskConical, Info, Users, Pencil, Pause, Play, Archive, Copy, History, AlertTriangle, ArrowUpDown, Bell } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { ATTRIBUTION_NOTE, GoalProgressCard, MetricTip, Stat, TrendChart, fmtMetric, fmtRate } from "@/components/crm/Performance";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { roleLabel, STATUS_LABEL as ACCOUNT_LABEL, type Employee } from "@/lib/crm/team";
import { STATUS_LABEL, LEAD_STATUSES } from "@/lib/crm/types";
import { dayKey, formatDate, formatDateTime, initials } from "@/lib/crm/format";
import {
  PERIODS, METRICS, METRIC, GOAL_PERIOD_LABEL, cohortConversion, demoPerformanceEvents, followUpCompletion, goalProgress, goalsFor, hasAttribution,
  indexEvents, metricSeries, metricValue, periodWindow, rate, workloadFor, workloadInsights,
  type GoalDef, type GoalInput, type GoalProgressRow, type MetricKey, type PeriodKey, type Workload,
} from "@/lib/crm/performance";
import type { ActivityEvent } from "@/lib/crm/activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

type S = { tab?: string; employee?: string; period?: string; from?: string; to?: string };
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const TABS = [{ id: "overview", label: "Team overview" }, { id: "scorecards", label: "Scorecards" }, { id: "goals", label: "Sales goals" }, { id: "trends", label: "Trends" }, { id: "workload", label: "Workload" }, { id: "compare", label: "Comparison" }] as const;

export const Route = createFileRoute("/team-performance")({
  validateSearch: (s: Record<string, unknown>): S => Object.fromEntries(["tab", "employee", "period", "from", "to"].map((k) => [k, str(s[k])]).filter(([, v]) => v)) as S,
  head: () => ({
    meta: [
      { title: "Team Performance · Scale Flow Sales OS" },
      { name: "description", content: "Owner dashboard for employee workload, verified sales activity, sales goals and team scorecards." },
      { property: "og:title", content: "Team Performance · Scale Flow Sales OS" },
      { property: "og:description", content: "Workload, verified activity, goals and scorecards for the sales team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPerformance,
});

function TeamPerformance() {
  const st = useCRM();
  const { preview } = useAccess();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/team-performance" });
  const set = (p: Partial<S>) => void navigate({ search: (s: S) => Object.fromEntries(Object.entries({ ...s, ...p }).filter(([, v]) => v)) as S, replace: true });
  const [demo, setDemo] = useState<ActivityEvent[]>([]);
  const [editing, setEditing] = useState<GoalDef | "new" | null>(null);
  const [history, setHistory] = useState<GoalDef | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const today = dayKey(now);
  const tab = search.tab ?? "overview";
  const period = (search.period as PeriodKey) ?? "thisWeek";
  const win = periodWindow(period, now, search.from, search.to);
  const demoOn = demo.length > 0;

  const idx = useMemo(() => indexEvents([...st.teamEvents, ...demo], demoOn), [st.teamEvents, demo, demoOn]);
  const realIdx = useMemo(() => indexEvents(st.teamEvents, false), [st.teamEvents]);
  const emps = st.employees.filter((e) => e.accountStatus !== "archived");
  const data = { leads: st.leads, followUps: st.followUps, assignments: st.assignments };
  const loads = useMemo(() => Object.fromEntries(emps.map((e) => [e.id, workloadFor(e.id, data, now)])) as Record<string, Workload>, [st.leads, st.followUps, st.assignments, st.employees]); // eslint-disable-line react-hooks/exhaustive-deps
  const unassigned = useMemo(() => st.leads.filter((l) => !st.assignments[l.id] && l.status !== "won" && l.status !== "lost").length, [st.leads, st.assignments]);
  const insights = workloadInsights(emps, loads, unassigned);
  const ctx = { employees: st.employees, payments: st.payments };

  // Goal rows for today's period (genuine records only — never demo — for alerts).
  const rows: GoalProgressRow[] = useMemo(() => st.goals.filter((g) => g.status !== "archived").flatMap((g) => (g.scope === "team" ? [null] : g.employeeIds).map((eid) => ({ goal: g, def: g, employeeId: eid, progress: goalProgress(g, st.goalRevisions, eid, realIdx, today, ctx) }))), [st.goals, st.goalRevisions, realIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Goal alerts are evaluated app-wide by the shared runner (automationRunner.ts), not by this page.

  if (preview) return <Shell title="Team Performance"><Empty icon={<Gauge />} title="Owner only" hint="Team-wide performance is never available to employees. Open My Performance instead." action={<Button asChild size="sm"><Link to="/my-performance">My Performance</Link></Button>} /></Shell>;

  const team = { kind: "team" as const };
  const mv = (m: MetricKey, i = idx) => metricValue(i, m, team, win, st.payments);
  const fuc = followUpCompletion(st.followUps, win);
  const coh = cohortConversion(st.leads, win);
  const selected = emps.find((e) => e.id === search.employee) ?? emps[0];

  return <TooltipProvider delayDuration={150}><Shell title="Team Performance" subtitle="Workload, verified activity and sales goals — every number defined" actions={<>
    <Button variant="outline" size="sm" onClick={() => setPrefsOpen(true)}><Bell />Goal alerts</Button>
    <Button variant={demoOn ? "secondary" : "ghost"} size="sm" aria-pressed={demoOn} onClick={() => setDemo(demoOn ? [] : demoPerformanceEvents(st.employees, st.leads, new Date()))}><FlaskConical />{demoOn ? "Hide demo data" : "Demo mode"}</Button>
    <Button size="sm" onClick={() => setEditing("new")} disabled={!emps.length && false}><Plus />New goal</Button>
  </>}>
    <div className="ta-note"><Info className="size-4 shrink-0" /><p><strong>Assigned workload</strong> is what employees currently hold. <strong>Verified contribution</strong> only counts actions recorded under that person's identity. Today every genuine action in this browser is yours as Owner, so employee contribution shows “Not measurable yet”. {ATTRIBUTION_NOTE}{demoOn && <strong> Demo mode is on: synthetic employee activity is shown in scorecards, trends and comparison only, marked Demo, and never saved, counted in company totals or backed up.</strong>}</p></div>

    <div className="pf-toolbar mt-5">
      <div className="pf-tabs" role="tablist" aria-label="Team performance sections">{TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="pf-tab" onClick={() => set({ tab: t.id })}>{t.label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectCls} aria-label="Reporting period" value={period} onChange={(e) => set({ period: e.target.value })}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        {period === "custom" && <><Input type="date" aria-label="From" className="w-auto" value={search.from ?? win.start} onChange={(e) => set({ from: e.target.value })} /><Input type="date" aria-label="To" className="w-auto" value={search.to ?? win.end} onChange={(e) => set({ to: e.target.value })} /></>}
        <span className="text-xs text-muted-foreground">{formatDate(win.start)} – {formatDate(win.end)} · Asia/Kolkata</span>
      </div>
    </div>

    {tab === "overview" && <section className="mt-6" aria-label="Team overview">
      <dl className="pf-grid">
        <Stat label="Active employees" value={emps.filter((e) => e.accountStatus === "active").length} />
        <Stat label="Assigned leads" value={st.leads.filter((l) => st.assignments[l.id]).length} tip="Leads with a current assignee (any stage)." />
        <Stat label="Unassigned open leads" value={unassigned} warn={unassigned > 0} tip="Open leads (not Won/Lost) with no assignee." />
        <Stat label="Follow-ups due" value={fuc.due} tip="Non-cancelled follow-ups whose current due date falls in the period. Rescheduled ones count by their new date." />
        <Stat label="Overdue follow-ups" value={Object.values(loads).reduce((s, w) => s + w.overdue, 0) + workloadFor(null, data, now).overdue} warn tip="Pending follow-ups due before today (business day)." />
        <Stat label="Calls logged" value={fmtMetric("calls", mv("calls", realIdx))} tip={METRIC.calls.definition} />
        <Stat label="Connected calls" value={fmtMetric("connected", mv("connected", realIdx))} tip={METRIC.connected.definition} />
        <Stat label="Call connection rate" value={fmtRate(rate(mv("connected", realIdx), mv("calls", realIdx)))} tip="Connected logged calls ÷ logged call attempts × 100. Not picked and Busy are attempts, not connections. N/A when no calls." />
        <Stat label="Qualified (moves)" value={fmtMetric("qualified", mv("qualified", realIdx))} tip={METRIC.qualified.definition} />
        <Stat label="Won deals" value={fmtMetric("won", mv("won", realIdx))} tip={METRIC.won.definition} />
        <Stat label="Open opportunities" value={st.leads.filter((l) => l.status === "qualified" || l.status === "proposal").length} tip="Leads currently in Qualified or Proposal Sent." />
        <Stat label="Follow-up completion" value={fmtRate(fuc.rate)} tip="Completed ÷ non-cancelled follow-ups due in the period. Cancelled/replaced are excluded; N/A when none were due." />
        <Stat label="Lead-to-Win (cohort)" value={fmtRate(coh.winRate)} tip={`Cohort = leads created in the period (${coh.cohort}). Won ÷ cohort size, measured today. Deals closed from older leads are not mixed in.`} />
        <Stat label="Sales value" value={fmtMetric("salesValue", mv("salesValue"))} tip={METRIC.salesValue.definition} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Company totals always use genuine records only — demo data is never included here.</p>
    </section>}

    {tab === "scorecards" && (emps.length ? <section className="mt-6 pf-split" aria-label="Employee scorecards">
      <ul className="pf-emplist" aria-label="Employees">{emps.map((e) => <li key={e.id}><button type="button" className="pf-empbtn" aria-current={selected?.id === e.id} onClick={() => set({ employee: e.id })}><span className="tm-avatar">{initials(e.name)}</span><span className="min-w-0 text-left"><span className="block truncate text-sm font-medium">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{roleLabel(e)} · {loads[e.id]?.assigned ?? 0} assigned</span></span></button></li>)}</ul>
      {selected && <Scorecard e={selected} load={loads[selected.id]!} idx={idx} win={win} demoOn={demoOn} goals={goalsFor(st.goals, selected.id)} onEditGoal={setEditing} today={today} />}
    </section> : <NoEmployees />)}

    {tab === "goals" && <GoalsTab onEdit={setEditing} onHistory={setHistory} idx={realIdx} today={today} />}
    {tab === "trends" && <Trends idx={idx} win={win} emps={emps} />}
    {tab === "workload" && <WorkloadTab emps={emps} loads={loads} insights={insights} unassigned={unassigned} />}
    {tab === "compare" && (emps.length ? <Compare emps={emps} loads={loads} idx={idx} win={win} today={today} demoOn={demoOn} /> : <NoEmployees />)}

    {editing && <GoalDialog goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} employees={emps} />}
    {history && <GoalHistory goal={history} onClose={() => setHistory(null)} />}
    <AlertPrefs open={prefsOpen} onOpenChange={setPrefsOpen} />
  </Shell></TooltipProvider>;
}

function NoEmployees() {
  return <Empty icon={<Users />} title="No employees yet" hint="Add people in Team Management to see workload and scorecards." action={<Button asChild size="sm"><Link to="/team">Open Team Management</Link></Button>} />;
}

function QuickActions({ e }: { e: Employee }) {
  return <div className="flex flex-wrap gap-2">
    <Button asChild size="sm" variant="outline"><Link to="/team/preview/$id" params={{ id: e.id }}>View workspace</Link></Button>
    <Button asChild size="sm" variant="ghost"><Link to="/team/workspace/$id" params={{ id: e.id }}>Assigned leads</Link></Button>
    <Button asChild size="sm" variant="ghost"><Link to="/team-activity" search={{ employee: e.id }}>Activity</Link></Button>
    <Button asChild size="sm" variant="ghost"><Link to="/follow-ups">Follow-ups</Link></Button>
    <Button asChild size="sm" variant="ghost"><Link to="/leads">Assign more leads</Link></Button>
    <Button asChild size="sm" variant="ghost"><Link to="/team" search={{ employee: e.id }}>Team Management</Link></Button>
  </div>;
}

function Scorecard({ e, load, idx, win, demoOn, goals, onEditGoal, today }: { e: Employee; load: Workload; idx: ReturnType<typeof indexEvents>; win: { start: string; end: string }; demoOn: boolean; goals: GoalDef[]; onEditGoal: (g: GoalDef) => void; today: string }) {
  const st = useCRM();
  const actor = { kind: "employee" as const, id: e.id };
  const attributed = hasAttribution(idx, e.id);
  const v = (m: MetricKey) => metricValue(idx, m, actor, win);
  const mine = new Set(st.leads.filter((l) => st.assignments[l.id]?.employeeId === e.id).map((l) => l.id));
  const fu = followUpCompletion(st.followUps, win, mine);
  const ctx = { employees: st.employees, payments: st.payments };
  return <article className="pf-card" aria-label={`${e.name} scorecard`}>
    <header className="flex flex-wrap items-center gap-3"><span className="tm-avatar">{initials(e.name)}</span><div className="min-w-0 flex-1"><h2 className="editorial text-2xl">{e.name}</h2><p className="text-xs text-muted-foreground">{roleLabel(e)} · {ACCOUNT_LABEL[e.accountStatus]}</p></div></header>
    <div className="mt-3"><QuickActions e={e} /></div>

    <h3 className="pf-h3">Assigned workload <MetricTip text="What is currently assigned. Assignment never counts as work performed." /></h3>
    <dl className="pf-grid">
      <Stat label="Assigned leads" value={load.assigned} /><Stat label="Open" value={load.open} /><Stat label="Hot" value={load.hot} /><Stat label="New" value={load.fresh} />
      <Stat label="Open follow-ups" value={load.openFollowUps} /><Stat label="Overdue" value={load.overdue} warn={load.overdue > 0} />
      <Stat label="FU completion (assigned)" value={fmtRate(fu.rate)} tip="Completed ÷ non-cancelled follow-ups due in the period on leads currently assigned to this employee. Records who completed them are not implied." />
    </dl>
    <div className="pf-stages mt-3" aria-label="Pipeline distribution">{LEAD_STATUSES.map((s) => <div key={s} className="pf-stage"><span>{STATUS_LABEL[s]}</span><b className="num">{load.byStage[s]}</b></div>)}</div>
    {load.recent.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Recently assigned: {load.recent.map((l) => l.name).join(", ")}</p>}

    <h3 className="pf-h3">Verified sales activity {demoOn && attributed && <span className="pf-badge" data-status="demo">Demo</span>}</h3>
    {!attributed ? <div className="pf-unmeasured"><AlertTriangle className="size-4 shrink-0" /><p>{ATTRIBUTION_NOTE} Calls, follow-ups and wins on {e.name.split(" ")[0]}'s assigned leads are not credited to them because the person who did the work isn't verified.</p></div> :
    <dl className="pf-grid">{(["calls", "connected", "followupsCompleted", "followupsRescheduled", "leadsCreated", "stageChanges", "qualified", "won", "lost"] as MetricKey[]).map((m) => <Stat key={m} label={METRIC[m].label} value={fmtMetric(m, v(m))} tip={METRIC[m].definition} />)}
      <Stat label="Contact rate" value={fmtRate(rate(v("connected"), v("calls")))} tip="Connected ÷ logged calls. N/A without calls." />
      <Stat label="Win rate (decided)" value={fmtRate(rate(v("won"), (v("won") ?? 0) + (v("lost") ?? 0)))} tip="Won ÷ (Won + Lost) decided by this person in the period." />
      <Stat label="Avg response time" value="N/A" muted tip="Needs verified first-response timestamps per employee; not available yet." />
    </dl>}

    <h3 className="pf-h3">Goals</h3>
    {goals.length ? <div className="pf-goals">{goals.map((g) => <GoalProgressCard key={g.id} goal={g} progress={goalProgress(g, st.goalRevisions, e.id, idx, today, ctx)} actions={<Button size="sm" variant="ghost" onClick={() => onEditGoal(g)}><Pencil />Change goal</Button>} />)}</div> : <p className="text-sm text-muted-foreground">No goals configured for {e.name}.</p>}
  </article>;
}

function GoalsTab({ onEdit, onHistory, idx, today }: { onEdit: (g: GoalDef | "new") => void; onHistory: (g: GoalDef) => void; idx: ReturnType<typeof indexEvents>; today: string }) {
  const st = useCRM();
  const [showArchived, setShowArchived] = useState(false);
  const list = st.goals.filter((g) => showArchived || g.status !== "archived");
  const name = (id: string) => st.employees.find((e) => e.id === id)?.name ?? "Removed employee";
  const ctx = { employees: st.employees, payments: st.payments };
  return <section className="mt-6" aria-label="Sales goals">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="editorial text-2xl">Sales goals</h2><label className="flex items-center gap-2 text-sm"><Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived goals" />Show archived</label></div>
    {!list.length ? <Empty icon={<Gauge />} title="No goals yet" hint="Set daily, weekly or monthly targets for employees or the whole team. Nothing is pre-filled." action={<Button size="sm" onClick={() => onEdit("new")}><Plus />Create goal</Button>} /> :
    <div className="mt-3 space-y-4">{list.map((g) => <div key={g.id} className="pf-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h3 className="truncate font-semibold">{g.name} <span className="pf-badge" data-status={g.status}>{g.status}</span></h3><p className="text-xs text-muted-foreground">{GOAL_PERIOD_LABEL[g.period]} · {METRIC[g.metric].label} · target {fmtMetric(g.metric, g.target)} · effective {formatDate(g.effectiveFrom)} · v{g.version}</p></div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => onEdit(g)} disabled={g.status === "archived"}><Pencil />Edit</Button>
          {g.status === "active" ? <Button size="sm" variant="ghost" onClick={() => st.setGoalStatus(g.id, "paused")}><Pause />Pause</Button> : g.status === "paused" ? <Button size="sm" variant="ghost" onClick={() => st.setGoalStatus(g.id, "active")}><Play />Resume</Button> : <Button size="sm" variant="ghost" onClick={() => st.setGoalStatus(g.id, "paused")}><Play />Restore</Button>}
          <Button size="sm" variant="ghost" onClick={() => { st.duplicateGoal(g.id); toast.success("Goal duplicated (paused)."); }}><Copy />Duplicate</Button>
          {g.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => st.setGoalStatus(g.id, "archived")}><Archive />Archive</Button>}
          <Button size="sm" variant="ghost" onClick={() => onHistory(g)}><History />History</Button>
        </div>
      </div>
      <div className="pf-goals mt-3">{(g.scope === "team" ? [null] : g.employeeIds).map((eid) => <GoalProgressCard key={eid ?? "team"} goal={g} who={eid ? name(eid) : "Entire team"} progress={goalProgress(g, st.goalRevisions, eid, idx, today, ctx)} />)}</div>
    </div>)}</div>}
  </section>;
}

function GoalDialog({ goal, onClose, employees }: { goal: GoalDef | null; onClose: () => void; employees: Employee[] }) {
  const st = useCRM();
  const today = dayKey(new Date());
  const [f, setF] = useState<GoalInput>(() => goal ? { name: goal.name, metric: goal.metric, target: goal.target, period: goal.period, scope: goal.scope, employeeIds: goal.employeeIds, effectiveFrom: today, customFrom: goal.customFrom, customTo: goal.customTo } : { name: "", metric: "calls", target: 20, period: "daily", scope: "employee", employeeIds: [], effectiveFrom: today });
  const [err, setErr] = useState<string | null>(null);
  const save = () => { const e = st.saveGoal(f, goal?.id); if (e) return setErr(e); toast.success(goal ? "Goal updated — earlier periods keep the old target." : "Goal created."); onClose(); };
  const toggle = (id: string) => setF((x) => ({ ...x, employeeIds: x.employeeIds.includes(id) ? x.employeeIds.filter((i) => i !== id) : [...x.employeeIds, id] }));
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{goal ? "Edit goal" : "New sales goal"}</DialogTitle><DialogDescription>{goal ? "Saving creates a new version from the effective date. Earlier periods keep their original target." : "Targets measure verified activity only."}</DialogDescription></DialogHeader>
    <div className="grid gap-3">
      <label className="pf-field"><span>Goal name</span><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Daily calls" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="pf-field"><span>Goal type</span><select className={selectCls} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as MetricKey })}>{METRICS.filter((m) => m.goalable).map((m) => <option key={m.key} value={m.key}>{m.label}{m.financial ? " (team, financial)" : ""}</option>)}</select></label>
        <label className="pf-field"><span>Target</span><Input type="number" min={1} inputMode="numeric" value={Number.isFinite(f.target) ? f.target : ""} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></label>
        <label className="pf-field"><span>Period</span><select className={selectCls} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as GoalInput["period"] })}>{(["daily", "weekly", "monthly", "custom"] as const).map((p) => <option key={p} value={p}>{GOAL_PERIOD_LABEL[p]}</option>)}</select></label>
        <label className="pf-field"><span>Effective from</span><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></label>
        {f.period === "custom" && <><label className="pf-field"><span>Start</span><Input type="date" value={f.customFrom ?? ""} onChange={(e) => setF({ ...f, customFrom: e.target.value })} /></label><label className="pf-field"><span>End</span><Input type="date" value={f.customTo ?? ""} onChange={(e) => setF({ ...f, customTo: e.target.value })} /></label></>}
      </div>
      <fieldset className="pf-field"><span>Assign to</span>
        <div className="flex gap-2"><Button type="button" size="sm" variant={f.scope === "employee" ? "secondary" : "ghost"} onClick={() => setF({ ...f, scope: "employee" })}>Employees</Button><Button type="button" size="sm" variant={f.scope === "team" ? "secondary" : "ghost"} onClick={() => setF({ ...f, scope: "team" })}>Entire team</Button></div>
        {f.scope === "employee" && (employees.length ? <div className="pf-checks">{employees.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.employeeIds.includes(e.id)} onChange={() => toggle(e.id)} />{e.name}<span className="text-xs text-muted-foreground">{roleLabel(e)}</span></label>)}</div> : <p className="text-xs text-muted-foreground">Add employees in Team Management first.</p>)}
      </fieldset>
      {METRIC[f.metric].financial && <p className="text-xs text-muted-foreground">Monetary goals are only shown to people with finance access and measure team payments until payments carry a verified actor.</p>}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </div>
    <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>{goal ? "Save new version" : "Create goal"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function GoalHistory({ goal, onClose }: { goal: GoalDef; onClose: () => void }) {
  const revs = useCRM((s) => s.goalRevisions).filter((r) => r.goalId === goal.id);
  return <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Goal history</SheetTitle><SheetDescription>{goal.name}</SheetDescription></SheetHeader>
    <ol className="mt-4 space-y-3 px-4">
      <li className="pf-card"><b>v{goal.version} · current</b><p className="text-xs text-muted-foreground">Target {fmtMetric(goal.metric, goal.target)} · {GOAL_PERIOD_LABEL[goal.period]} · from {formatDate(goal.effectiveFrom)}</p></li>
      {revs.map((r) => <li key={r.id} className="pf-card"><b>v{r.version}</b> <span className="text-xs text-muted-foreground">replaced {formatDateTime(r.at)}</span><p className="text-xs text-muted-foreground">Target {fmtMetric(r.def.metric, r.def.target)} · {GOAL_PERIOD_LABEL[r.def.period]} · from {formatDate(r.def.effectiveFrom)}</p><p className="mt-1 text-xs">Change: {r.change}</p></li>)}
      {!revs.length && <li className="text-sm text-muted-foreground">No earlier versions.</li>}
    </ol>
  </SheetContent></Sheet>;
}

function Trends({ idx, win, emps }: { idx: ReturnType<typeof indexEvents>; win: { start: string; end: string }; emps: Employee[] }) {
  const st = useCRM();
  const [metric, setMetric] = useState<MetricKey>("calls");
  const [who, setWho] = useState("team");
  const [day, setDay] = useState<string>();
  const actor = who === "team" ? { kind: "team" as const } : { kind: "employee" as const, id: who };
  const measurable = who === "team" || who === "owner" || hasAttribution(idx, who);
  const series = metricSeries(idx, metric, actor, win);
  const picked = series.find((s) => s.day === day);
  const leadName = (id?: string) => st.leads.find((l) => l.id === id)?.name ?? "Removed lead";
  return <section className="mt-6" aria-label="Performance trends">
    <div className="flex flex-wrap gap-2">
      <select className={selectCls} aria-label="Metric" value={metric} onChange={(e) => { setMetric(e.target.value as MetricKey); setDay(undefined); }}>{METRICS.filter((m) => !m.financial).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
      <select className={selectCls} aria-label="Person" value={who} onChange={(e) => { setWho(e.target.value); setDay(undefined); }}><option value="team">Whole team</option><option value="owner">Owner</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
    </div>
    <div className="pf-card mt-3">
      <h3 className="flex items-center gap-1 font-semibold">{METRIC[metric].label} by day <MetricTip text={METRIC[metric].definition} /></h3>
      {measurable ? <TrendChart series={series} label={METRIC[metric].label} picked={day} onPick={setDay} /> : <div className="pf-unmeasured mt-3"><AlertTriangle className="size-4 shrink-0" /><p>{ATTRIBUTION_NOTE}</p></div>}
      <p className="mt-2 text-xs text-muted-foreground">Charts use timestamped activity only (up to 92 days). Historical assignment counts aren't shown because past workload snapshots were never recorded.</p>
    </div>
    {picked && <div className="pf-card mt-3"><h4 className="font-semibold">{formatDate(picked.day)} · {picked.value} record{picked.value === 1 ? "" : "s"}</h4>
      {picked.events.length ? <ul className="mt-2 divide-y text-sm">{picked.events.slice(0, 50).map((e) => <li key={e.eventId} className="py-2"><span className="font-medium">{e.actorName}</span> · {e.eventSource === "demo" ? `${leadName(e.relatedLeadId)} (Demo)` : e.summary} <span className="text-xs text-muted-foreground">{formatDateTime(e.occurredAt)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No records that day.</p>}
    </div>}
  </section>;
}

function WorkloadTab({ emps, loads, insights, unassigned }: { emps: Employee[]; loads: Record<string, Workload>; insights: ReturnType<typeof workloadInsights>; unassigned: number }) {
  const max = Math.max(1, ...emps.map((e) => loads[e.id]?.open ?? 0));
  return <section className="mt-6 space-y-4" aria-label="Workload and bottlenecks">
    {insights.length ? <ul className="space-y-2">{insights.map((i) => <li key={i.id} className="pf-insight" data-tone={i.tone}><AlertTriangle className="size-4 shrink-0" /><span className="flex-1 text-sm">{i.text}</span>
      {i.action === "distribute" ? <Button asChild size="sm" variant="outline"><Link to="/leads">Open bulk assignment</Link></Button> : i.action === "followups" ? <Button asChild size="sm" variant="outline"><Link to="/follow-ups">Open follow-ups</Link></Button> : i.employeeId ? <Button asChild size="sm" variant="outline"><Link to="/team/workspace/$id" params={{ id: i.employeeId }}>Open assigned leads</Link></Button> : null}
    </li>)}</ul> : <p className="text-sm text-muted-foreground">No bottlenecks detected right now.</p>}
    <div className="pf-card"><h3 className="font-semibold">Open assigned leads per employee</h3>
      {emps.length ? <ul className="mt-3 space-y-2">{emps.map((e) => { const w = loads[e.id]!; return <li key={e.id} className="pf-load"><span className="w-32 truncate text-sm">{e.name}</span><span className="pf-loadbar"><span style={{ width: `${(w.open / max) * 100}%` }} /></span><span className="num w-24 text-right text-xs text-muted-foreground">{w.open} open · {w.overdue} late</span></li>; })}</ul> : <p className="text-sm text-muted-foreground">No employees yet.</p>}
      <p className="mt-3 text-xs text-muted-foreground">{unassigned} open lead{unassigned === 1 ? "" : "s"} unassigned. Distribute them with the existing bulk assignment on Leads.</p>
    </div>
  </section>;
}

type SortKey = "assigned" | "due" | "overdue" | "calls" | "followups" | "won" | "goal";
function Compare({ emps, loads, idx, win, today, demoOn }: { emps: Employee[]; loads: Record<string, Workload>; idx: ReturnType<typeof indexEvents>; win: { start: string; end: string }; today: string; demoOn: boolean }) {
  const st = useCRM();
  const [sort, setSort] = useState<SortKey>("assigned");
  const ctx = { employees: st.employees, payments: st.payments };
  const rows = emps.map((e) => {
    const a = { kind: "employee" as const, id: e.id };
    const gp = goalsFor(st.goals, e.id).filter((g) => g.status === "active").map((g) => goalProgress(g, st.goalRevisions, e.id, idx, today, ctx).pct).filter((p): p is number => p != null);
    return { e, w: loads[e.id]!, calls: metricValue(idx, "calls", a, win), followups: metricValue(idx, "followupsCompleted", a, win), won: metricValue(idx, "won", a, win), goal: gp.length ? gp.reduce((s, x) => s + Math.min(1, x), 0) / gp.length : null };
  });
  const val = (r: (typeof rows)[number]) => ({ assigned: r.w.assigned, due: r.w.dueToday, overdue: r.w.overdue, calls: r.calls ?? -1, followups: r.followups ?? -1, won: r.won ?? -1, goal: r.goal ?? -1 })[sort];
  const sorted = [...rows].sort((a, b) => val(b) - val(a));
  const H = ({ k, children }: { k: SortKey; children: React.ReactNode }) => <th scope="col" aria-sort={sort === k ? "descending" : "none"}><button type="button" className="pf-sort" onClick={() => setSort(k)}>{children}<ArrowUpDown className="size-3" /></button></th>;
  return <section className="mt-6" aria-label="Performance comparison">
    <p className="mb-3 text-xs text-muted-foreground">A transparent side-by-side view — no hidden scores and no automatic ranking. Workloads differ, so compare activity alongside assigned load. “—” means not measurable yet.{demoOn ? " Demo values are included while Demo mode is on." : ""}</p>
    <div className="pf-tablewrap"><table className="pf-table">
      <thead><tr><th scope="col">Employee</th><th scope="col">Role</th><H k="assigned">Assigned</H><H k="due">Due today</H><H k="overdue">Overdue</H><H k="calls">Verified calls</H><H k="followups">FU completed</H><H k="won">Won</H><H k="goal">Goal progress</H></tr></thead>
      <tbody>{sorted.map((r) => <tr key={r.e.id}><th scope="row"><Link to="/team-performance" search={{ tab: "scorecards", employee: r.e.id }} className="hover:underline">{r.e.name}</Link></th><td>{roleLabel(r.e)}</td><td className="num">{r.w.assigned}</td><td className="num">{r.w.dueToday}</td><td className="num" data-warn={r.w.overdue > 0}>{r.w.overdue}</td><td className="num">{fmtMetric("calls", r.calls)}</td><td className="num">{fmtMetric("followupsCompleted", r.followups)}</td><td className="num">{fmtMetric("won", r.won)}</td><td className="num">{fmtRate(r.goal)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

function AlertPrefs({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const st = useCRM();
  const p = st.perfPrefs;
  const items: [keyof typeof p, string][] = [["notifyGoalAchieved", "Employee goal achieved"], ["notifyTeamGoal", "Team goal achieved"], ["notifyMilestone", "Halfway milestones (weekly/monthly goals)"], ["notifyOverdue", "Severe overdue workload"]];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Goal alerts</DialogTitle><DialogDescription>Alerts fire once per goal, person and period — never on every call. No “underperforming” alerts are generated without verified attribution.</DialogDescription></DialogHeader>
    <div className="space-y-3">{items.map(([k, label]) => <label key={k} className="flex items-center justify-between gap-3 text-sm">{label}<Switch checked={!!p[k]} onCheckedChange={(v) => st.setPerfPrefs({ [k]: v })} /></label>)}
      <label className="flex items-center justify-between gap-3 text-sm">Overdue threshold<Input type="number" min={1} className="w-24" value={p.overdueThreshold} onChange={(e) => st.setPerfPrefs({ overdueThreshold: Math.max(1, Number(e.target.value) || 1) })} /></label>
    </div>
    <div className="mt-2 border-t pt-3"><h4 className="text-sm font-semibold">Recent alerts</h4>{st.goalAlerts.length ? <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">{st.goalAlerts.slice(0, 20).map((a) => <li key={a.id}>{a.text} <span className="text-xs text-muted-foreground">{formatDateTime(a.at)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">None yet.</p>}</div>
  </DialogContent></Dialog>;
}
