import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Target, AlertTriangle, Info, Gauge } from "lucide-react";
import { Shell, Empty } from "@/components/crm/Shell";
import { ATTRIBUTION_NOTE, GoalProgressCard, Stat, TrendChart, fmtRate } from "@/components/crm/Performance";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { STATUS_LABEL, LEAD_STATUSES } from "@/lib/crm/types";
import { dayKey, formatDate, formatDateTime, formatINR, formatINRCompact } from "@/lib/crm/format";
import { goalProgress, goalsFor, indexEvents, periodWindow, visibleGoal, workloadFor, type PeriodKey, type Window } from "@/lib/crm/performance";
import { companyFinanceSnapshot, ownerMetrics, ownerSeries, ownerTimeline, wonTrend } from "@/lib/crm/ownerPerformance";
import { EVENT_LABEL } from "@/lib/crm/activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";

type S = { period?: string | undefined; from?: string | undefined; to?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const OWNER_PERIODS: { id: PeriodKey; label: string }[] = [
  { id: "today", label: "Today" }, { id: "thisWeek", label: "This week" }, { id: "thisMonth", label: "This month" }, { id: "custom", label: "Custom range" },
];

export const Route = createFileRoute("/my-performance")({
  validateSearch: (s: Record<string, unknown>): S => Object.fromEntries(["period", "from", "to"].map((k) => [k, str(s[k])]).filter(([, v]) => v)) as S,
  head: () => ({
    meta: [
      { title: "My Performance · Scale Flow Sales OS" },
      { name: "description", content: "Your sales activity, follow-ups, conversions and goals — daily, weekly and monthly." },
      { property: "og:title", content: "My Performance · Scale Flow Sales OS" },
      { property: "og:description", content: "Personal sales activity, workload, goals and progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyPerformance,
});

function MyPerformance() {
  const { preview } = useAccess();
  return preview ? <EmployeePerformance /> : <OwnerPerformance />;
}

// ---------------- Owner dashboard (AI-7A) ----------------
function OwnerPerformance() {
  const st = useCRM();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/my-performance" });
  const set = (p: Partial<S>) => void navigate({ search: (s: S) => Object.fromEntries(Object.entries({ ...s, ...p }).filter(([, v]) => v)) as S, replace: true });
  const now = useMemo(() => new Date(), []);
  const today = dayKey(now);
  const period = (search.period as PeriodKey) ?? "thisWeek";
  const win: Window = periodWindow(period, now, search.from, search.to);
  const [picked, setPicked] = useState<string | null>(null);

  const data = { events: st.teamEvents, leads: st.leads, followUps: st.followUps, deals: st.deals, quotationShares: st.quotationShares };
  const m = useMemo(() => ownerMetrics(data, win, now), [st.teamEvents, st.leads, st.followUps, st.deals, st.quotationShares, search.period, search.from, search.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => ownerSeries(st.teamEvents, win), [st.teamEvents, search.period, search.from, search.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline = useMemo(() => ownerTimeline(st.teamEvents, win, (e) => e.summary || EVENT_LABEL[e.eventType]), [st.teamEvents, search.period, search.from, search.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => wonTrend(st.teamEvents, st.deals, 6, now), [st.teamEvents, st.deals]); // eslint-disable-line react-hooks/exhaustive-deps
  const fin = useMemo(() => companyFinanceSnapshot(st.deals, st.payments, now), [st.deals, st.payments]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = useMemo(() => indexEvents(st.teamEvents, false), [st.teamEvents]);
  const goals = goalsFor(st.goals, "owner").filter((g) => g.status !== "archived" && visibleGoal(g, true));
  const ctx = { employees: st.employees, payments: st.payments };
  const empty = m.calls === 0 && m.followUpsCompleted === 0 && m.leadsCreated === 0 && m.dealsWon === 0;

  return <TooltipProvider delayDuration={150}><Shell title="My Performance" subtitle="Your sales activity and results">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
      {OWNER_PERIODS.map((p) => <Button key={p.id} size="sm" variant={period === p.id ? "default" : "outline"} onClick={() => set({ period: p.id === "custom" ? "custom" : p.id, from: undefined, to: undefined })}>{p.label}</Button>)}
      {period === "custom" && <span className="flex items-center gap-2">
        <Input type="date" className="h-8 w-auto" value={win.start} max={win.end} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" className="h-8 w-auto" value={win.end} min={win.start} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
      </span>}
      <span className="text-xs text-muted-foreground">{formatDate(win.start)} – {formatDate(win.end)} · India time, weeks run Monday to Sunday</span>
    </div>

    {empty && <div className="ta-note mt-4"><Info className="size-4 shrink-0" /><p>No recorded activity in this period yet. Numbers appear here as you log calls, complete follow-ups and move leads — nothing is estimated.</p></div>}

    <section className="mt-6" aria-label="Sales work">
      <h2 className="editorial text-2xl">Sales work</h2>
      <dl className="pf-grid mt-3">
        <Stat label="Calls logged" value={m.calls} tip="Saved call outcomes only — every outcome, including Not picked and Busy. Opening the dialer never counts." />
        <Stat label="Connected" value={m.connected} tip="Saved outcomes other than Not picked or Busy." />
        <Stat label="Connection rate" value={fmtRate(m.connectionRate)} tip={m.calls ? `${m.connected} connected of ${m.calls} logged calls.` : "No calls logged in this period, so no rate is shown."} />
        <Stat label="Follow-ups completed" value={m.followUpsCompleted} tip="Follow-ups you marked complete in the period. Cancelled or replaced ones never count." />
        <Stat label="Follow-ups due" value={m.followUpsDue} tip="Non-cancelled follow-ups due in the period (rescheduled ones count by their new date)." />
        <Stat label="Overdue now" value={m.overdue} warn={m.overdue > 0} tip="Pending follow-ups whose scheduled time has passed." />
      </dl>
    </section>

    <section className="mt-8" aria-label="Results">
      <h2 className="editorial text-2xl">Results</h2>
      <dl className="pf-grid mt-3">
        <Stat label="Leads created" value={m.leadsCreated} tip="Leads recorded as created by you in the period." />
        <Stat label="Qualified" value={m.qualified} tip="Recorded moves into the Qualified stage by you." />
        <Stat label="Quotations shared" value={m.quotationsShared} tip="Quotations you explicitly confirmed as shared. Opening WhatsApp never counts." />
        <Stat label="Deals won" value={m.dealsWon} tip="Leads you marked Won in the period." />
        <Stat label="Won value" value={formatINRCompact(m.wonValue)} tip={m.unknownWonDates ? `Booked value of deals with a verified Won date in the period. ${m.unknownWonDates} won deal(s) have no reliable Won date and are excluded.` : "Booked value of deals with a verified Won date in the period. This is booked business, not cash collected."} />
        <Stat label="Lead → Won" value={fmtRate(m.winRate)} tip={m.cohort ? `${m.cohortWon} of the ${m.cohort} leads you created in this period are Won today.` : "No leads were created in this period, so no conversion rate is shown."} />
      </dl>
      {m.unattributed > 0 && <div className="pf-unmeasured mt-3"><AlertTriangle className="size-4 shrink-0" /><p>{m.unattributed} recorded action{m.unattributed === 1 ? "" : "s"} in this period {m.unattributed === 1 ? "is" : "are"} not credited to you because they belong to another actor. {ATTRIBUTION_NOTE}</p></div>}
    </section>

    <section className="mt-8" aria-label="Activity charts">
      <h2 className="editorial text-2xl">Daily activity</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border p-4"><h3 className="text-sm font-semibold">Calls logged</h3><TrendChart series={series.calls} label="Calls" picked={picked ?? undefined} onPick={setPicked} /></div>
        <div className="rounded-xl border p-4"><h3 className="text-sm font-semibold">Follow-ups completed</h3><TrendChart series={series.followUps} label="Follow-ups" picked={picked ?? undefined} onPick={setPicked} /></div>
        <div className="rounded-xl border p-4"><h3 className="text-sm font-semibold">Leads created</h3><TrendChart series={series.leads} label="Leads" picked={picked ?? undefined} onPick={setPicked} /></div>
      </div>
      <div className="mt-4 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Won deals — last 6 months</h3>
        {trend.some((t) => t.count > 0) ? <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{trend.map((t) => <li key={t.month} className="rounded-lg border px-3 py-2 text-center"><p className="text-xs text-muted-foreground">{formatDate(`${t.month}-01`, { month: "short", year: "2-digit" })}</p><p className="num text-sm font-semibold">{t.count} won</p><p className="num text-xs text-muted-foreground">{formatINRCompact(t.value)}</p></li>)}</ul>
          : <p className="mt-2 text-sm text-muted-foreground">No Won deals with a verified Won date yet. The trend appears once a deal is won with a reliable date.</p>}
      </div>
    </section>

    <section className="mt-8" aria-label="Targets">
      <h2 className="editorial text-2xl">Targets</h2>
      {goals.length ? <div className="pf-goals mt-3">{goals.map((g) => <GoalProgressCard key={g.id} goal={g} progress={goalProgress(g, st.goalRevisions, "owner", idx, today, ctx)} />)}</div>
        : <div className="pf-unmeasured mt-3"><Info className="size-4 shrink-0" /><p>Target not configured. You can set yourself a goal from Team Performance → Sales goals by assigning it to the Owner; team goals are never reused as personal targets.</p></div>}
    </section>

    <section className="mt-8" aria-label="Company finance snapshot">
      <h2 className="editorial text-2xl">Company Finance Snapshot</h2>
      <p className="mt-1 text-xs text-muted-foreground">Payments don't record who collected them, so these are company-wide figures — not your personal collections. Voided payments are excluded.</p>
      <dl className="pf-grid mt-3">
        <Stat label="Booked deal value" value={formatINR(fin.totalValue)} tip="Final amount of all non-cancelled deals — booked business, not cash." />
        <Stat label="Collected" value={formatINR(fin.collected)} tip="All non-voided recorded payments." />
        <Stat label="Outstanding" value={formatINR(fin.outstanding)} warn={fin.outstanding > 0} tip="Booked value not yet collected." />
        <Stat label="Overdue balance" value={formatINR(fin.overdue)} warn={fin.overdue > 0} tip="Outstanding on deals past their due date." />
      </dl>
    </section>

    <section className="mt-8" aria-label="Activity timeline">
      <h2 className="editorial text-2xl">Activity in this period</h2>
      {timeline.length ? <ul className="mt-3 divide-y rounded-xl border">{timeline.map((t) => <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 truncate">{t.leadId ? <Link to="/leads/$id" params={{ id: t.leadId }} className="font-medium underline-offset-2 hover:underline">{t.label}</Link> : t.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(t.at)}</span>
      </li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No recorded calls, completions, new leads or stage changes in this period.</p>}
    </section>
  </Shell></TooltipProvider>;
}

// ---------------- Employee view (unchanged) ----------------
function EmployeePerformance() {
  const st = useCRM();
  const { preview } = useAccess();
  const now = useMemo(() => new Date(), []);
  const idx = useMemo(() => indexEvents(st.teamEvents, false), [st.teamEvents]);
  if (!preview) return null;
  const id = preview.employeeId;
  const canMoney = (preview.finance === "amounts" || preview.finance === "manage") && preview.allowed.includes("deals.view");
  const w = workloadFor(id, { leads: st.leads, followUps: st.followUps, assignments: st.assignments }, now);
  const goals = goalsFor(st.goals, id).filter((g) => g.status !== "archived" && visibleGoal(g, canMoney));
  const today = dayKey(now);
  const ctx = { employees: st.employees, payments: canMoney ? st.payments : [] };
  const priorities = st.leads.filter((l) => st.assignments[l.id]?.employeeId === id && l.priority === "hot" && l.status !== "won" && l.status !== "lost").slice(0, 6);

  return <TooltipProvider delayDuration={150}><Shell title="My Performance" subtitle={`${preview.name} · your workload and goals`}>
    <div className="ta-note"><Info className="size-4 shrink-0" /><p>You see only your own workload and goals. Goals are set by the Owner. {ATTRIBUTION_NOTE}</p></div>
    <section className="mt-6" aria-label="My workload">
      <h2 className="editorial text-2xl">My workload</h2>
      <dl className="pf-grid mt-3">
        <Stat label="Assigned leads" value={w.assigned} /><Stat label="Hot leads" value={w.hot} /><Stat label="New leads" value={w.fresh} />
        <Stat label="Follow-ups due today" value={w.dueToday} /><Stat label="Open follow-ups" value={w.openFollowUps} /><Stat label="Overdue" value={w.overdue} warn={w.overdue > 0} />
      </dl>
      <div className="pf-stages mt-3">{LEAD_STATUSES.map((s) => <div key={s} className="pf-stage"><span>{STATUS_LABEL[s]}</span><b className="num">{w.byStage[s]}</b></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/follow-ups">Open my follow-ups</Link></Button><Button asChild size="sm" variant="ghost"><Link to="/leads">Open my leads</Link></Button></div>
    </section>
    <section className="mt-8" aria-label="My goals">
      <h2 className="editorial text-2xl">My goals</h2>
      {goals.length ? <div className="pf-goals mt-3">{goals.map((g) => <GoalProgressCard key={g.id} goal={g} progress={goalProgress(g, st.goalRevisions, id, idx, today, ctx)} />)}</div> : <p className="mt-2 text-sm text-muted-foreground">No goals have been set for you yet.</p>}
    </section>
    <section className="mt-8" aria-label="Open priorities">
      <h2 className="editorial text-2xl">Open priorities</h2>
      {priorities.length ? <ul className="mt-3 divide-y rounded-xl border">{priorities.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="truncate font-medium">{l.name}</span><span className="text-xs text-muted-foreground">{STATUS_LABEL[l.status]} · Hot</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No Hot leads waiting.</p>}
      <div className="pf-unmeasured mt-4"><AlertTriangle className="size-4 shrink-0" /><p>Your personal activity summary (calls, completions, wins) appears once your actions are recorded under your own secure account.</p></div>
    </section>
  </Shell></TooltipProvider>;
}
