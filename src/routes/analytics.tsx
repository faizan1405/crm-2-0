import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Archive, BarChart3, Copy, Pencil, Pin, Plus, RotateCcw, Star, X, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { Shell } from "@/components/crm/Shell";
import { useCRM, viewCtxOf } from "@/lib/crm/store";
import { dayKey as formatDayKey, formatDate, formatINR, formatINRCompact, formatPct } from "@/lib/crm/format";
import { cardSignals as cardSignalsS } from "@/lib/crm/pipeline";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { financeSummary } from "@/lib/crm/finance";
import { runView } from "@/lib/crm/customize";
import { indexEvents, hasAttribution, metricValue, workloadFor } from "@/lib/crm/performance";
import { OWNER_ACTOR_ID } from "@/lib/crm/activity";
import { isActive } from "@/lib/crm/projects";
import {
  bucketOf as bucketOfS, ANALYTICS_PERIODS, DEFINITIONS, OPEN_STAGES, REPORT_DIMS, REPORT_METRICS, REPORT_PRESETS, SOURCE_LABEL,
  activityStats, analyticsWindow, delta, filterLeads, financeBreakdown, financeKpis, forecast, forecastConfigError, funnel, granularityFor, indexActivity,
  isFiltered, leadTrend, previousWindow, projectFinanceLinks, projectStats, reportError, runReport, sourcePerformance,
  type AnalyticsData, type AnalyticsPeriod, type LeadFilter, type ReportDef, type ReportSource, type ReportChart,
} from "@/lib/crm/analytics";
import { CHART, Def, DrillSheet, EmptyChart, Kpi, Panel, Unavailable, axis, tip, type Drill } from "@/components/analytics/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "overview", label: "Executive overview" }, { id: "acquisition", label: "Lead acquisition" }, { id: "funnel", label: "Sales funnel" },
  { id: "activity", label: "Sales activity" }, { id: "finance", label: "Financial intelligence" }, { id: "projects", label: "Project performance" },
  { id: "forecast", label: "Opportunity forecast" }, { id: "reports", label: "Custom reports" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];
interface Search { section?: Section; period?: AnalyticsPeriod; from?: string; to?: string; source?: string; stage?: LeadStatus; priority?: string; assignee?: string; tag?: string; view?: string; compare?: boolean }
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/analytics")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {};
    const sec = str(s["section"]); if (sec && SECTIONS.some((x) => x.id === sec)) out.section = sec as Section;
    const p = str(s["period"]); if (p && ANALYTICS_PERIODS.some((x) => x.id === p)) out.period = p as AnalyticsPeriod;
    for (const k of ["from", "to", "source", "priority", "assignee", "tag", "view"] as const) { const v = str(s[k]); if (v) out[k] = v; }
    const st = str(s["stage"]); if (st && (LEAD_STATUSES as string[]).includes(st)) out.stage = st as LeadStatus;
    if (s["compare"] === false || s["compare"] === "false") out.compare = false;
    return out;
  },
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Analytics Studio · Scale Flow CRM" },
      { name: "description", content: "Owner analytics: lead sources, funnel, calls, collections, projects and an explainable pipeline forecast." },
      { property: "og:title", content: "Analytics Studio · Scale Flow CRM" },
      { property: "og:description", content: "Owner analytics: lead sources, funnel, calls, collections, projects and an explainable pipeline forecast." },
    ],
  }),
  component: Analytics,
});

const fmtDay = (d: string) => formatDate(`${d}T12:00:00Z`, { day: "numeric", month: "short", year: "numeric" });
const bucketLabel = (b: string) => (b.length === 7 ? formatDate(`${b}-01T12:00:00Z`, { month: "short", year: "2-digit" }) : formatDate(`${b}T12:00:00Z`));
const hrs = (h: number | null) => (h == null ? "N/A" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

function useStudio(search: Search) {
  const s = useCRM();
  const now = useMemo(() => new Date(), [s]);
  const data: AnalyticsData = s;
  const idx = useMemo(() => indexActivity(s.activities), [s.activities]);
  const w = analyticsWindow(search.period ?? "30d", now, search.from, search.to);
  const prev = previousWindow(w);
  const view = search.view ? s.savedViews.find((v) => v.id === search.view && !v.archived) : undefined;
  const viewIds = useMemo(() => (view ? new Set(runView(view, s.leads, viewCtxOf(s, { owner: true })).map((l) => l.id)) : undefined), [view, s]);
  const filter: LeadFilter = { sources: search.source ? [search.source] : undefined, stages: search.stage ? [search.stage] : undefined, priorities: search.priority ? [search.priority] : undefined, assignee: search.assignee, tagId: search.tag, leadIds: viewIds };
  const leads = useMemo(() => filterLeads(s.leads, filter, s), [s.leads, s.assignments, s.leadTags, search.source, search.stage, search.priority, search.assignee, search.tag, viewIds]);
  return { s, now, data, idx, w, prev, leads, filter, view, compare: search.compare !== false };
}
type Studio = ReturnType<typeof useStudio>;
type Patch = { [K in keyof Search]?: Search[K] | undefined };

function Analytics() {
  const search = Route.useSearch();
  const nav = Route.useNavigate();
  const st = useStudio(search);
  const [drill, setDrill] = useState<Drill | null>(null);
  const section = search.section ?? "overview";
  const set = (patch: Patch) => nav({ search: (p) => Object.fromEntries(Object.entries({ ...p, ...patch }).filter(([, v]) => v !== undefined)) as Search, replace: true });
  return (
    <Shell title="Analytics Studio" subtitle={`${fmtDay(st.w.start)} – ${fmtDay(st.w.end)} · India time${st.compare ? ` · compared with ${fmtDay(st.prev.start)} – ${fmtDay(st.prev.end)}` : ""}`}>
      <div className="as-notice mb-4"><ShieldCheck className="size-4 shrink-0" /><span><b>Owner only.</b> Every number is rebuilt from the records in this browser. Nothing here is connected to Meta Ads, Google Ads or a bank — ad cost, ROAS and CAC are not shown.</span></div>
      <nav className="seg as-tabs mb-4" aria-label="Analytics sections">
        {SECTIONS.map((x) => <button key={x.id} type="button" aria-pressed={section === x.id} onClick={() => set({ section: x.id })}>{x.label}</button>)}
      </nav>
      {section !== "reports" && <Filters search={search} set={set} st={st} />}
      {section === "overview" && <Overview st={st} open={setDrill} />}
      {section === "acquisition" && <Acquisition st={st} open={setDrill} />}
      {section === "funnel" && <FunnelSection st={st} open={setDrill} />}
      {section === "activity" && <ActivitySection st={st} open={setDrill} />}
      {section === "finance" && <FinanceSection st={st} open={setDrill} />}
      {section === "projects" && <ProjectsSection st={st} open={setDrill} />}
      {section === "forecast" && <ForecastSection st={st} open={setDrill} />}
      {section === "reports" && <Reports open={setDrill} />}
      <DrillSheet drill={drill} onClose={() => setDrill(null)} />
    </Shell>
  );
}

// ---------------------------------------------------------------- Filters
const sel = "h-9 rounded-md border bg-card px-2 text-sm min-w-0";
function Filters({ search, set, st }: { search: Search; set: (p: Patch) => void; st: Studio }) {
  const { s } = st;
  const period = search.period ?? "30d";
  const leadTags = s.tagDefs.filter((t) => (t.scope ?? "lead") !== "project");
  const anyFilter = isFiltered(st.filter);
  return (
    <section className="as-filters mb-5" aria-label="Analytics filters">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label htmlFor="as-period" className="text-[11px] text-muted-foreground">Date range</Label>
          <select id="as-period" className={sel} value={period} onChange={(e) => set({ period: e.target.value as AnalyticsPeriod })}>{ANALYTICS_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        {period === "custom" && <>
          <div className="grid gap-1"><Label htmlFor="as-from" className="text-[11px] text-muted-foreground">From</Label><Input id="as-from" type="date" className="h-9 w-[9.5rem]" value={search.from ?? st.w.start} onChange={(e) => set({ from: e.target.value || undefined })} /></div>
          <div className="grid gap-1"><Label htmlFor="as-to" className="text-[11px] text-muted-foreground">To</Label><Input id="as-to" type="date" className="h-9 w-[9.5rem]" value={search.to ?? st.w.end} onChange={(e) => set({ to: e.target.value || undefined })} /></div>
        </>}
        <select aria-label="Lead source" className={sel} value={search.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })}><option value="">All sources</option>{[...new Set([...LEAD_SOURCES, ...s.leads.map((l) => l.source)])].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Pipeline stage" className={sel} value={search.stage ?? ""} onChange={(e) => set({ stage: (e.target.value || undefined) as LeadStatus | undefined })}><option value="">All stages</option>{LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>
        <select aria-label="Lead priority" className={sel} value={search.priority ?? ""} onChange={(e) => set({ priority: e.target.value || undefined })}><option value="">Any priority</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select aria-label="Assigned employee" className={sel} value={search.assignee ?? ""} onChange={(e) => set({ assignee: e.target.value || undefined })}><option value="">Anyone</option><option value="unassigned">Unassigned</option>{s.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        {leadTags.length > 0 && <select aria-label="Lead tag" className={sel} value={search.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })}><option value="">Any tag</option>{leadTags.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status === "archived" ? " (archived)" : ""}</option>)}</select>}
        {s.savedViews.some((v) => !v.archived) && <select aria-label="Saved view" className={sel} value={search.view ?? ""} onChange={(e) => set({ view: e.target.value || undefined })}><option value="">No saved view</option>{s.savedViews.filter((v) => !v.archived).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
        <label className="flex h-9 items-center gap-2 text-xs"><input type="checkbox" checked={st.compare} onChange={(e) => set({ compare: e.target.checked ? undefined : false })} />Compare</label>
        {anyFilter && <Button size="sm" variant="ghost" onClick={() => set({ source: undefined, stage: undefined, priority: undefined, assignee: undefined, tag: undefined, view: undefined })}><X className="size-3.5" />Clear filters</Button>}
      </div>
      {anyFilter && <p className="mt-2 text-[11px] text-muted-foreground">Lead filters apply to lead, funnel and activity figures ({st.leads.length} of {s.leads.length} leads). Money and projects always show the whole business{st.view ? ` · Saved view “${st.view.name}”` : ""}.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- Overview
type SecProps = { st: Studio; open: (d: Drill) => void };
function Overview({ st, open }: SecProps) {
  const { s, w, prev, leads, idx, now, compare } = st;
  const nav = useNavigate(); const srch = Route.useSearch();
  const cur = useMemo(() => {
    const cohort = leads.filter((l) => inW(l.createdAt, w));
    const pc = leads.filter((l) => inW(l.createdAt, prev));
    const awaiting = leads.filter((l) => OPEN_STAGES.includes(l.status) && !idx.firstCall.has(l.id));
    const qualified = cohort.filter((l) => ["qualified", "proposal", "won"].includes(l.status));
    const fin = financeKpis(s.deals, s.payments, w, now), pfin = financeKpis(s.deals, s.payments, prev, now);
    const act = activityStats(leads, idx, s.followUps, w, now), pact = activityStats(leads, idx, s.followUps, prev, now);
    const proj = projectStats(s.projects, s.projectTasks, s.supportRequests, w, now);
    const lost = cohort.filter((l) => l.status === "lost");
    return { cohort, pc, awaiting, qualified, fin, pfin, act, pact, proj, lost, pqual: pc.filter((l) => ["qualified", "proposal", "won"].includes(l.status)).length };
  }, [leads, idx, s, w.start, w.end]);
  const d = (a: number, b: number) => (compare ? delta(a, b) : null);
  const trend = useMemo(() => leadTrend(leads, idx, w, granularityFor(w)), [leads, idx, w.start, w.end]);
  const pinned = s.savedReports.filter((r) => r.pinned && !r.archived);
  return (
    <div className="grid gap-5">
      <div className="as-kpi-row">
        <Kpi primary label="Won deal value" value={formatINR(cur.fin.wonValue)} def={DEFINITIONS["wonValue"]!} delta={d(cur.fin.wonValue, cur.pfin.wonValue)} deltaMoney hint={`${cur.fin.wonCount} deal${cur.fin.wonCount === 1 ? "" : "s"} won${cur.fin.unknownWonIds.length ? ` · ${cur.fin.unknownWonIds.length} with unknown won date excluded` : ""}`} onOpen={() => open({ title: "Deals won in range", kind: "deal", ids: cur.fin.wonIds })} />
        <Kpi primary label="Payments received" value={formatINR(cur.fin.received)} tone="success" def={DEFINITIONS["received"]!} delta={d(cur.fin.received, cur.pfin.received)} deltaMoney hint={`${cur.fin.paymentCount} valid payment${cur.fin.paymentCount === 1 ? "" : "s"}`} onOpen={() => open({ title: "Payments received in range", kind: "payment", ids: cur.fin.paymentIds })} />
        <Kpi primary label="Outstanding balance" value={formatINR(cur.fin.outstanding)} tone="warning" def={DEFINITIONS["outstanding"]!} hint="As of today, all active deals" onOpen={() => open({ title: "Deals with an outstanding balance", kind: "deal", ids: s.deals.filter((x) => x.status !== "cancelled" && financeSummary([x], s.payments).outstanding > 0).map((x) => x.id) })} />
      </div>
      <div className="as-kpi-grid">
        <Kpi label="New leads" value={String(cur.cohort.length)} def={DEFINITIONS["newLeads"]!} delta={d(cur.cohort.length, cur.pc.length)} onOpen={() => (srch.stage || srch.priority || srch.assignee || srch.tag || srch.view ? open({ title: "New leads in range", kind: "lead", ids: cur.cohort.map((l) => l.id) }) : void nav({ to: "/leads", search: { from: w.start, to: w.end, ...(srch.source ? { src: srch.source } : {}) } }))} />
        <Kpi label="Awaiting first contact" value={String(cur.awaiting.length)} tone={cur.awaiting.length ? "warning" : "default"} def={DEFINITIONS["awaitingContact"]!} hint="Open leads, right now" onOpen={() => open({ title: "Open leads with no saved call outcome", kind: "lead", ids: cur.awaiting.map((l) => l.id) })} />
        <Kpi label="Qualified leads" value={String(cur.qualified.length)} def={DEFINITIONS["qualified"]!} delta={d(cur.qualified.length, cur.pqual)} onOpen={() => open({ title: "Qualified or later (created in range)", kind: "lead", ids: cur.qualified.map((l) => l.id) })} />
        <Kpi label="Deals won" value={String(cur.fin.wonCount)} def={DEFINITIONS["wonDeals"]!} delta={d(cur.fin.wonCount, cur.pfin.wonCount)} onOpen={() => open({ title: "Deals won in range", kind: "deal", ids: cur.fin.wonIds })} />
        <Kpi label="Leads lost" value={String(cur.lost.length)} def={DEFINITIONS["lost"]!} hint="Created in range, now Lost" onOpen={() => open({ title: "Lost leads (created in range)", kind: "lead", ids: cur.lost.map((l) => l.id) })} />
        <Kpi label="Follow-ups completed" value={String(cur.act.fuCompleted)} def={DEFINITIONS["fuCompleted"]!} delta={d(cur.act.fuCompleted, cur.pact.fuCompleted)} />
        <LinkKpi to="/follow-ups"><Kpi label="Overdue follow-ups" value={String(cur.act.fuOverdue)} tone={cur.act.fuOverdue ? "destructive" : "default"} def={DEFINITIONS["fuOverdue"]!} hint="Open the agenda →" /></LinkKpi>
        <Kpi label="Active projects" value={String(cur.proj.active)} def={DEFINITIONS["activeProjects"]!} onOpen={() => open({ title: "Active projects", kind: "project", ids: cur.proj.ids.active })} />
        <Kpi label="Overdue projects" value={String(cur.proj.overdue)} tone={cur.proj.overdue ? "destructive" : "default"} def={DEFINITIONS["overdueProjects"]!} onOpen={() => open({ title: "Overdue projects", kind: "project", ids: cur.proj.ids.overdue })} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Leads received, qualified and won" sub="Qualified and Won come only from recorded stage changes" def={DEFINITIONS["funnelMoves"]}>
          <Trend data={trend} />
        </Panel>
        <Reconciliation st={st} />
      </div>
      {pinned.length > 0 && <div className="grid gap-5 lg:grid-cols-2">{pinned.map((r) => <ReportCard key={r.id} report={r} open={open} compact />)}</div>}
    </div>
  );
}
const inW = (iso: string, w: { start: string; end: string }) => { const k = formatDayKey(iso); return k >= w.start && k <= w.end; };
function LinkKpi({ to, children }: { to: "/follow-ups"; children: ReactNode }) { return <Link to={to} className="as-kpi-link" aria-label="Open Follow-ups agenda">{children}</Link>; }

function Trend({ data }: { data: { bucket: string; received: number; qualified: number; won: number }[] }) {
  if (!data.some((x) => x.received || x.qualified || x.won)) return <EmptyChart text="No leads or recorded stage changes in this range." />;
  return (
    <div className="h-56"><ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data.map((x) => ({ ...x, label: bucketLabel(x.bucket) }))} margin={{ left: -20, right: 4, top: 6, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} minTickGap={20} /><YAxis allowDecimals={false} {...axis} width={40} />
        <Tooltip {...tip} labelFormatter={(l) => `Period starting ${l}`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="received" name="Received" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
        <Area type="monotone" dataKey="qualified" name="Moved to Qualified" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.1} strokeWidth={2} />
        <Area type="monotone" dataKey="won" name="Moved to Won" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.1} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer></div>
  );
}

function Reconciliation({ st }: { st: Studio }) {
  const { s, now } = st;
  const all = financeKpis(s.deals, s.payments, null, now);
  const fin = financeSummary(s.deals, s.payments, now);
  const today = formatDayKey(now);
  const checks = [
    { label: "Payments received (all time) = Deals & Payments", ok: all.received === fin.collected, value: formatINR(all.received) },
    { label: "Outstanding = Deals & Payments", ok: all.outstanding === fin.outstanding, value: formatINR(all.outstanding) },
    { label: "Won deal value (all time) = Deals & Payments total", ok: all.wonValue === fin.totalValue, value: formatINR(all.wonValue) },
    { label: `Deals with unknown won date (in all-time totals, not in any period): ${all.unknownWonIds.length}`, ok: true, value: formatINR(all.unknownWonValue) },
    { label: "Active projects = Project Desk", ok: projectStats(s.projects, s.projectTasks, s.supportRequests, st.w, now).active === s.projects.filter(isActive).length, value: String(s.projects.filter(isActive).length) },
    { label: "Lead count = Leads page", ok: true, value: String(s.leads.length) },
    { label: "Pending follow-ups = Follow-ups", ok: true, value: String(s.followUps.filter((f) => !f.completedAt && !f.cancelledAt).length) },
  ];
  return (
    <Panel title="Reconciliation" sub={`Checked against the source modules · ${fmtDay(today)}`}>
      <ul className="grid gap-1.5 text-sm">{checks.map((c) => <li key={c.label} className="flex items-center gap-2">{c.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <AlertTriangle className="size-4 shrink-0 text-destructive" />}<span className="min-w-0 flex-1">{c.label}</span><span className="num shrink-0 font-medium">{c.value}</span></li>)}</ul>
      <p className="mt-3 text-[11px] text-muted-foreground">Analytics reads money only through the same rules as Deals & Payments; Project Desk never adds a second payment.</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- Acquisition
function Acquisition({ st, open }: SecProps) {
  const { s, w, leads, idx } = st;
  const cohort = useMemo(() => leads.filter((l) => inW(l.createdAt, w)), [leads, w.start, w.end]);
  const rows = useMemo(() => sourcePerformance(cohort, s, idx), [cohort, s, idx]);
  const g = granularityFor(w);
  const mix = useMemo(() => {
    const top = rows.slice(0, 5).map((r) => r.source);
    const by = new Map<string, Record<string, number | string>>();
    for (const l of cohort) { const b = bucketOfS(formatDayKey(l.createdAt), g); const row = by.get(b) ?? { bucket: b }; const k = top.includes(l.source) ? l.source : "Other sources"; row[k] = ((row[k] as number) ?? 0) + 1; by.set(b, row); }
    return { keys: [...top, ...(cohort.some((l) => !top.includes(l.source)) ? ["Other sources"] : [])], data: [...by.values()].sort((a, b) => String(a["bucket"]).localeCompare(String(b["bucket"]))).map((r) => ({ ...r, label: bucketLabel(String(r["bucket"])) })) };
  }, [cohort, rows, g]);
  const total = cohort.length;
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-5">
        <Panel title="Source share" sub={`${total} new lead${total === 1 ? "" : "s"} in range`} className="lg:col-span-2" def="Share of leads created in the range by their recorded source. Source values are shown exactly as saved — nothing is regrouped.">
          {total === 0 ? <EmptyChart text="No leads created in this range." /> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart>
            <Pie data={rows.map((r) => ({ name: r.source, value: r.leads }))} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} onClick={(x: { name?: string }) => { const r = rows.find((y) => y.source === x.name); if (r) open({ title: `${r.source} leads`, kind: "lead", ids: r.leadIds }); }}>
              {rows.map((r, i) => <Cell key={r.source} fill={CHART[i % CHART.length]} className="cursor-pointer" />)}
            </Pie><Tooltip {...tip} formatter={(v: number, n: string) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart></ResponsiveContainer></div>}
        </Panel>
        <Panel title="Source mix over time" sub={`Leads received per ${g}`} className="lg:col-span-3">
          {total === 0 ? <EmptyChart text="No leads created in this range." /> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={mix.data} margin={{ left: -20, right: 4, top: 6 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" {...axis} minTickGap={16} /><YAxis allowDecimals={false} {...axis} width={40} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            {mix.keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={CHART[i % CHART.length]} radius={i === mix.keys.length - 1 ? [3, 3, 0, 0] : 0} />)}
          </BarChart></ResponsiveContainer></div>}
        </Panel>
      </div>
      <Panel title="Lead source performance" sub="Leads created in range · Won = those same leads now Won" def="Lead-to-Win = Won ÷ leads created in the range from that source (a cohort rate, still developing for recent leads). First attempt = median hours to the first saved call outcome. Duplicates = leads flagged as possible duplicates in Smart Inbox.">
        {rows.length === 0 ? <EmptyChart text="No leads created in this range." /> : <div className="as-table-wrap"><table className="as-table">
          <thead><tr><th>Source</th><th>Leads</th><th>Qualified+</th><th>Won</th><th>Lead→Win</th><th>Unassigned</th><th>Flagged duplicates</th><th>First attempt (median)</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.source}>
            <td className="font-medium">{r.source}</td>
            <td><button className="as-cell-btn" onClick={() => open({ title: `${r.source} leads`, kind: "lead", ids: r.leadIds })}>{r.leads}</button></td>
            <td>{r.qualified}</td>
            <td><button className="as-cell-btn" disabled={!r.won} onClick={() => open({ title: `${r.source} won leads`, kind: "lead", ids: r.wonIds })}>{r.won}</button></td>
            <td>{formatPct(r.winRate)}</td><td>{r.unassigned}</td><td>{r.duplicates}</td>
            <td>{r.attempted ? `${hrs(r.medianFirstAttemptH)} · ${r.attempted}/${r.leads}` : "N/A"}</td>
          </tr>)}</tbody></table></div>}
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Unavailable title="Cost per lead, ROAS, CAC" reason="The CRM is not connected to Meta Ads or Google Ads and no ad spend has been recorded, so these can't be calculated. A lead from Meta Ads tells us its source, not its cost." />
        <Unavailable title="Historical assignment by source" reason="Only current assignments are stored. Past assignment snapshots were not recorded and are not reconstructed." />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Funnel
function FunnelSection({ st, open }: SecProps) {
  const { leads, idx, w, now, s } = st;
  const f = useMemo(() => funnel(leads, idx, w, now), [leads, idx, w.start, w.end]);
  const stalled = useMemo(() => leads.filter((l) => OPEN_STAGES.includes(l.status)).map((l) => ({ l, sig: cardSignalsS(l, s.activities, s.followUps, now) })).filter((x) => x.sig.stalled), [leads, s.activities, s.followUps]);
  const max = Math.max(1, ...f.current.map((c) => c.count));
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="1 · Current pipeline distribution" sub="Leads in each stage right now" def={DEFINITIONS["funnelCurrent"]}>
          <ul className="grid gap-2">{f.current.map((c, i) => <li key={c.stage}><button className="w-full text-left text-sm" onClick={() => open({ title: `Leads now in ${c.label}`, kind: "lead", ids: c.ids })}>
            <div className="mb-1 flex justify-between gap-2"><span>{c.label}</span><span className="num font-semibold">{c.count}<span className="ml-2 font-normal text-muted-foreground">{formatINRCompact(c.value)}</span></span></div>
            <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, background: CHART[i % CHART.length] }} /></div></button></li>)}</ul>
        </Panel>
        <Panel title="2 · Stage movement in range" sub={`${f.movesRecorded} recorded stage change${f.movesRecorded === 1 ? "" : "s"}`} def={DEFINITIONS["funnelMoves"]}>
          {f.movesRecorded === 0 ? <EmptyChart text="No stage changes were recorded in this range." /> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={f.moves} layout="vertical" margin={{ left: 10, right: 16 }}>
            <XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="label" {...axis} width={92} /><Tooltip {...tip} formatter={(v: number) => [v, "Moves into stage"]} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
          </BarChart></ResponsiveContainer></div>}
        </Panel>
        <Panel title="3 · Lead cohort conversion" sub="Leads created in range → their stage today" def={DEFINITIONS["funnelCohort"]}>
          <dl className="as-dl">
            <dt>Cohort</dt><dd>{f.cohort.size}</dd><dt>Qualified or later</dt><dd>{f.cohort.qualified}</dd><dt>Won</dt><dd>{f.cohort.won}</dd><dt>Lost</dt><dd>{f.cohort.lost}</dd>
            <dt>Lead-to-Win</dt><dd className="font-semibold">{f.cohort.size ? formatPct(f.cohort.winRate) : "N/A"}</dd>
          </dl>
          {f.cohort.size === 0 ? <p className="mt-2 text-xs text-muted-foreground">No leads were created in this range, so there is no rate (N/A, not 0%).</p> : f.cohort.developing && <p className="mt-2 text-xs text-warning">Recent cohort — conversion is still developing.</p>}
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Stalled opportunities" sub={`${stalled.length} open lead${stalled.length === 1 ? "" : "s"} past the stage threshold`} def="Same rule as the Pipeline: time in stage comes only from recorded stage changes. Leads without a recorded change (other than New) have no age and are never flagged.">
          {stalled.length === 0 ? <p className="text-sm text-muted-foreground">Nothing stalled.</p> : <ul className="divide-y text-sm">{stalled.slice(0, 8).map(({ l, sig }) => <li key={l.id} className="flex justify-between gap-2 py-1.5"><Link to="/pipeline" search={{ lead: l.id }} className="truncate font-medium hover:underline">{l.name}</Link><span className="shrink-0 text-muted-foreground">{STATUS_LABEL[l.status]} · {sig.days} days</span></li>)}</ul>}
          {stalled.length > 8 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => open({ title: "Stalled opportunities", kind: "lead", ids: stalled.map((x) => x.l.id) })}>Show all {stalled.length}</Button>}
        </Panel>
        <Panel title="Lost deal intelligence" sub="Leads currently Lost, by recorded reason" def={DEFINITIONS["lost"]}>
          {f.lostReasons.length === 0 ? <p className="text-sm text-muted-foreground">No lost leads.</p> : <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Reason</th><th>Leads</th><th>Quoted value</th></tr></thead>
            <tbody>{f.lostReasons.map((r) => <tr key={r.reason}><td className={r.reason === "Not recorded" ? "text-muted-foreground" : "font-medium"}>{r.reason}</td><td><button className="as-cell-btn" onClick={() => open({ title: `Lost: ${r.reason}`, kind: "lead", ids: r.ids })}>{r.count}</button></td><td>{formatINR(r.value)}</td></tr>)}</tbody></table></div>}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Activity
function ActivitySection({ st }: SecProps) {
  const { s, leads, idx, w, now } = st;
  const a = useMemo(() => activityStats(leads, idx, s.followUps, w, now), [leads, idx, s.followUps, w.start, w.end]);
  const evIdx = useMemo(() => indexEvents(s.teamEvents), [s.teamEvents]);
  const pw = { start: w.start, end: w.end };
  return (
    <div className="grid gap-5">
      <div className="as-kpi-grid">
        <Kpi label="Logged call attempts" value={String(a.attempts)} def={DEFINITIONS["calls"]!} />
        <Kpi label="Connected calls" value={String(a.connected)} tone="success" def={DEFINITIONS["calls"]!} hint={a.attempts ? `${formatPct(a.connected / a.attempts)} of attempts` : "No attempts"} />
        <Kpi label="No answer / busy" value={`${a.noAnswer} / ${a.busy}`} def="Saved outcomes Not picked and Busy." />
        <Kpi label="Follow-ups due" value={String(a.fuScheduled)} def="Follow-ups (not cancelled) due in the range. Scheduling is not proof of contact." />
        <Kpi label="Follow-up completion" value={a.fuScheduled ? formatPct(a.fuRate) : "N/A"} def="Of the follow-ups due in the range, the share now completed. N/A when nothing was due." />
        <Kpi label="Time to first attempt" value={hrs(a.medianFirstAttemptH)} def={DEFINITIONS["firstAttempt"]!} hint={`${a.cohortAttempted} of ${a.cohortSize} new leads attempted`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Call outcomes" sub="Saved outcomes only — opening the dialer or WhatsApp is never counted">
          {a.byOutcome.length === 0 ? <EmptyChart text="No call outcomes saved in this range." /> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={a.byOutcome} layout="vertical" margin={{ left: 10, right: 16 }}>
            <XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="outcome" {...axis} width={104} /><Tooltip {...tip} /><Bar dataKey="count" name="Calls" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
          </BarChart></ResponsiveContainer></div>}
        </Panel>
        <Panel title="Team workload and contribution" sub="Workload from current assignments · contribution from verified actors only" def="Workload is measured from real assignments. Contribution needs authenticated employee activity; every real action in this browser is recorded as the Owner, and Employee Preview actions are simulated and never counted.">
          {s.employees.length === 0 ? <p className="text-sm text-muted-foreground">No employees yet.</p> : <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Employee</th><th>Assigned</th><th>Open</th><th>Overdue follow-ups</th><th>Calls logged</th></tr></thead>
            <tbody>{s.employees.map((e) => { const wl = workloadFor(e.id, s, now); const ok = hasAttribution(evIdx, e.id); return <tr key={e.id}><td className="font-medium">{e.name}</td><td>{wl.assigned}</td><td>{wl.open}</td><td>{wl.overdue}</td><td>{ok ? metricValue(evIdx, "calls", { kind: "employee", id: e.id }, pw) ?? "N/A" : <span className="text-muted-foreground">Not measurable</span>}</td></tr>; })}
              <tr><td className="font-medium">Owner</td><td colSpan={3} className="text-muted-foreground">—</td><td>{metricValue(evIdx, "calls", { kind: "employee", id: OWNER_ACTOR_ID }, pw) ?? 0}</td></tr></tbody></table></div>}
          <p className="mt-3 rounded-md bg-muted p-2 text-xs">Employee contribution not measurable until authenticated employee activity is available. <Link to="/team-performance" className="font-medium underline">Team Performance</Link> uses the same definitions.</p>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Finance
function FinanceSection({ st, open }: SecProps) {
  const { s, w, now } = st;
  const k = financeKpis(s.deals, s.payments, w, now);
  const b = useMemo(() => financeBreakdown(s.deals, s.payments, w, now), [s.deals, s.payments, w.start, w.end]);
  return (
    <div className="grid gap-5">
      <div className="as-kpi-row">
        <Kpi primary label="Won deal value" value={formatINR(k.wonValue)} def={DEFINITIONS["wonValue"]!} hint={k.unknownWonIds.length ? `By recorded won date · ${k.unknownWonIds.length} older deal${k.unknownWonIds.length === 1 ? "" : "s"} with unknown won date not included` : "By recorded won date"} onOpen={() => open({ title: "Deals won in range", kind: "deal", ids: k.wonIds })} />
        <Kpi primary label="Payments received" value={formatINR(k.received)} tone="success" def={DEFINITIONS["received"]!} hint={`By payment date · ${b.voidedExcluded} voided excluded`} onOpen={() => open({ title: "Payments received in range", kind: "payment", ids: k.paymentIds })} />
        <Kpi primary label="Outstanding balance" value={formatINR(k.outstanding)} tone="warning" def={DEFINITIONS["outstanding"]!} hint="As of today" />
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">Payments received are cash recorded in Deals &amp; Payments — not formally recognised accounting revenue. A won deal does not prove payment.</p>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Collections and bookings by month" sub="Each bar uses its own date: payment date vs deal booked date" className="lg:col-span-2">
          {!b.byMonth.some((m) => m.received || m.won) ? <EmptyChart text="No deals booked or payments received in this range." /> : <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={b.byMonth.map((m) => ({ ...m, label: bucketLabel(m.month) }))} margin={{ left: 0, right: 4, top: 6 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={56} tickFormatter={(v: number) => formatINRCompact(v)} />
            <Tooltip {...tip} formatter={(v: number, n: string) => [formatINR(v), n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="won" name="Won deal value" fill="var(--chart-3)" radius={[3, 3, 0, 0]} /><Bar dataKey="received" name="Payments received" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
          </BarChart></ResponsiveContainer></div>}
        </Panel>
        <Panel title="Payment methods" sub="Valid payments in range">
          {b.byMethod.length === 0 ? <EmptyChart text="No payments in this range." /> : <ul className="grid gap-2 text-sm">{b.byMethod.map((m, i) => <li key={m.method} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: CHART[i % CHART.length] }} /><span className="flex-1">{m.method}</span><span className="num font-medium">{formatINR(m.amount)}</span><span className="w-8 text-right text-xs text-muted-foreground">{m.count}</span></li>)}</ul>}
        </Panel>
      </div>
      <div className="as-kpi-grid">
        <Kpi label="Fully paid deals" value={String(b.fullyPaid.length)} tone="success" def="Active deals whose valid payments cover the final amount." onOpen={() => open({ title: "Fully paid deals", kind: "deal", ids: b.fullyPaid })} />
        <Kpi label="Partially paid" value={String(b.partial.length)} def="Active deals with some valid payments but a remaining balance." onOpen={() => open({ title: "Partially paid deals", kind: "deal", ids: b.partial })} />
        <Kpi label="Awaiting payment" value={String(b.awaiting.length)} tone="warning" def="Active deals with no valid payment yet." onOpen={() => open({ title: "Deals awaiting payment", kind: "deal", ids: b.awaiting })} />
        <Kpi label="Collection rate" value={formatPct(b.collectionRate)} def="All valid payments ÷ all active deal value (all time). Same figure as Deals & Payments." />
        <Kpi label="Overdue" value={k.overdueKnown ? formatINR(k.overdue) : "N/A"} tone={k.overdue ? "destructive" : "default"} def={DEFINITIONS["overdue"]!} hint={b.noTerms ? `${b.noTerms} unpaid deal${b.noTerms === 1 ? "" : "s"} without a due date` : undefined} onOpen={k.overdueKnown ? () => open({ title: "Deals overdue", kind: "deal", ids: b.overdueIds }) : undefined} />
      </div>
      <Unavailable title="Collection forecast" reason="Future collections need agreed instalment dates. Deals without a due date are shown as Outstanding — their payment timing is not guessed." />
    </div>
  );
}

// ---------------------------------------------------------------- Projects
function ProjectsSection({ st, open }: SecProps) {
  const { s, w, now } = st;
  const p = useMemo(() => projectStats(s.projects, s.projectTasks, s.supportRequests, w, now), [s.projects, s.projectTasks, s.supportRequests, w.start, w.end]);
  const money = useMemo(() => projectFinanceLinks(s.projects, s.deals, s.payments), [s.projects, s.deals, s.payments]);
  return (
    <div className="grid gap-5">
      <div className="as-kpi-grid">
        <Kpi label="Projects created" value={String(p.created)} def="Projects created in the range (archived excluded)." />
        <Kpi label="Active" value={String(p.active)} def={DEFINITIONS["activeProjects"]!} onOpen={() => open({ title: "Active projects", kind: "project", ids: p.ids.active })} />
        <Kpi label="Awaiting client" value={String(p.awaitingClient)} tone={p.awaitingClient ? "warning" : "default"} def="Status Awaiting client or stage Awaiting content." onOpen={() => open({ title: "Awaiting client", kind: "project", ids: p.ids.awaitingClient })} />
        <Kpi label="In progress" value={String(p.inProgress)} def="Status In progress." />
        <Kpi label="Completed" value={String(p.completed)} def="Status Completed." />
        <Kpi label="Delivered" value={String(p.delivered)} tone="success" def="Projects with a recorded delivery." onOpen={() => open({ title: "Delivered projects", kind: "project", ids: p.ids.delivered })} />
        <Kpi label="Overdue" value={String(p.overdue)} tone={p.overdue ? "destructive" : "default"} def={DEFINITIONS["overdueProjects"]!} onOpen={() => open({ title: "Overdue projects", kind: "project", ids: p.ids.overdue })} />
        <Kpi label="Tasks completed" value={`${p.tasksDone} / ${p.tasksTotal}`} def="Actual completed tasks. Progress is never estimated from the stage." hint={p.tasksOverdue ? `${p.tasksOverdue} overdue` : undefined} />
        <Kpi label="Client dependencies open" value={String(p.openDependencies)} def="Open client dependencies on projects that are not closed." hint={`${p.projectsWaitingOnClient} project${p.projectsWaitingOnClient === 1 ? "" : "s"}`} />
        <Kpi label="Support requests open" value={String(p.supportOpen)} def="Open or in-progress support requests." hint={p.supportEnding ? `${p.supportEnding} support period${p.supportEnding === 1 ? "" : "s"} ending in 30 days` : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Project types">
          {p.byType.length === 0 ? <EmptyChart text="No projects yet." /> : <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={p.byType} margin={{ left: -20, right: 4 }}>
            <XAxis dataKey="type" {...axis} interval={0} /><YAxis allowDecimals={false} {...axis} width={40} /><Tooltip {...tip} />
            <Bar dataKey="count" name="Projects" fill="var(--chart-4)" radius={[4, 4, 0, 0]} onClick={(x: { type?: string; ids?: string[] }) => x.ids && open({ title: `${x.type} projects`, kind: "project", ids: x.ids })} className="cursor-pointer" />
          </BarChart></ResponsiveContainer></div>}
          <p className="mt-2 text-xs text-muted-foreground">Average delivery time: {p.avgDeliveryDays == null ? "N/A — needs projects with both an actual start and a delivery date" : `${p.avgDeliveryDays} days across ${p.deliveryMeasured} delivered project${p.deliveryMeasured === 1 ? "" : "s"}`}.</p>
        </Panel>
        <Panel title="Linked deal money" sub="Read from Deals & Payments · each deal counted once" def="Deals linked to non-archived projects. A deal linked to several projects is counted once. No project payment is ever added separately.">
          <dl className="as-dl"><dt>Linked deals</dt><dd>{money.deals} (for {money.projects} projects)</dd><dt>Deal value</dt><dd>{formatINR(money.value)}</dd><dt>Payments received</dt><dd>{formatINR(money.received)}</dd><dt>Outstanding</dt><dd>{formatINR(money.outstanding)}</dd></dl>
          {money.deliveredUnpaid.length > 0 && <Button size="sm" variant="outline" className="mt-3" onClick={() => open({ title: "Delivered with an unpaid balance", kind: "project", ids: money.deliveredUnpaid })}>{money.deliveredUnpaid.length} delivered with unpaid balance</Button>}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Forecast
function ForecastSection({ st, open }: SecProps) {
  const { s, now, leads } = st;
  const f = useMemo(() => forecast(leads, s.forecastConfig, s.expectedClose, now), [leads, s.forecastConfig, s.expectedClose]);
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid gap-5">
        <div role="note" className="rounded-md border bg-muted/40 p-3 text-xs"><b>Weighted Pipeline Opportunity Forecast.</b> Built from open qualified Leads with a quoted amount × your stage probability, grouped by expected close date (undated opportunities shown separately). It is <b>not</b> cash received, confirmed revenue, a guaranteed sale or an agreed payment schedule. No Deal records are created from it.</div>
      {!f.configured ? <Panel title="Set your stage probabilities" sub="The forecast stays empty until you choose them — no percentages are assumed.">
        <Button onClick={() => setEditing(true)}>Configure probabilities</Button>
      </Panel> : <>
        <div className="as-kpi-row">
          <Kpi primary label="Weighted pipeline (base)" value={formatINR(f.weighted)} def={DEFINITIONS["weighted"]!} hint={`${f.opportunities.length} open opportunities · ${formatINR(f.open)} quoted`} onOpen={() => open({ title: "Open opportunities in the forecast", kind: "lead", ids: f.opportunities.map((o) => o.leadId) })} />
          <Kpi primary label="Conservative" value={formatINR(f.conservative)} def={`Each probability × ${s.forecastConfig.conservative} (your setting).`} />
          <Kpi primary label="Optimistic" value={formatINR(f.optimistic)} def={`Each probability × ${s.forecastConfig.optimistic} (your setting), capped at 100%.`} />
        </div>
        <p className="-mt-2 text-[11px] text-muted-foreground">Scenario estimates, not guaranteed revenue. Won and Lost leads are excluded. Probabilities version {s.forecastConfig.version} since {formatDate(s.forecastConfig.effectiveFrom, { day: "numeric", month: "short", year: "numeric" })}. <button className="font-medium underline" onClick={() => setEditing(true)}>Change probabilities</button></p>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Forecast timeline" sub="Grouped by your expected close dates">
            {f.byMonth.length === 0 ? <EmptyChart text="No opportunity has a future expected close date yet." /> : <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={f.byMonth.map((m) => ({ ...m, label: bucketLabel(m.month) }))} margin={{ left: 0, right: 4 }}>
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={56} tickFormatter={(v: number) => formatINRCompact(v)} /><Tooltip {...tip} formatter={(v: number) => [formatINR(v), "Weighted"]} /><Bar dataKey="weighted" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>}
            {f.byQuarter.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{f.byQuarter.map((q) => `${q.quarter}: ${formatINR(q.weighted)}`).join(" · ")}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{f.undated.length} undated{f.pastDue.length ? ` · ${f.pastDue.length} with a past expected date` : ""}{f.noAmount.length ? ` · ${f.noAmount.length} open lead${f.noAmount.length === 1 ? "" : "s"} without a quoted amount excluded` : ""}.</p>
          </Panel>
          <Panel title="Probability history" sub="Earlier settings are kept so old forecasts stay explainable">
            <ul className="grid gap-1 text-xs">{[s.forecastConfig, ...s.forecastHistory].map((c) => <li key={c.version} className="flex flex-wrap gap-x-2"><b>v{c.version}</b><span className="text-muted-foreground">{formatDate(c.effectiveFrom, { day: "numeric", month: "short", year: "numeric" })}</span><span>{OPEN_STAGES.map((x) => `${STATUS_LABEL[x]} ${c.probabilities[x]}%`).join(" · ")}</span>{c.note && <span className="text-muted-foreground">“{c.note}”</span>}</li>)}</ul>
          </Panel>
        </div>
      </>}
      <Panel title="Open opportunities" sub="Set expected close dates here — undated opportunities are never given a month">
        {f.opportunities.length === 0 ? <p className="text-sm text-muted-foreground">No open leads with a quoted amount.</p> : <div className="as-table-wrap"><table className="as-table">
          <thead><tr><th>Lead</th><th>Stage</th><th>Quoted</th><th>Probability</th><th>Weighted</th><th>Expected close</th></tr></thead>
          <tbody>{[...f.opportunities].sort((a, b) => b.weighted - a.weighted || b.amount - a.amount).slice(0, 100).map((o) => <tr key={o.leadId}>
            <td><Link to="/pipeline" search={{ lead: o.leadId }} className="font-medium hover:underline">{o.name}</Link></td><td>{STATUS_LABEL[o.stage]}</td><td>{formatINR(o.amount)}</td>
            <td>{f.configured ? `${Math.round(o.probability * 100)}%` : "—"}</td><td>{f.configured ? formatINR(o.weighted) : "—"}</td>
            <td><div className="flex items-center gap-1"><Input type="date" aria-label={`Expected close for ${o.name}`} className="h-8 w-[9.5rem]" value={o.expectedClose ?? ""} onChange={(e) => { const err = s.setExpectedClose(o.leadId, e.target.value || null); if (err) toast.error(err); }} />
              {o.expectedClose ? <Button size="icon" variant="ghost" className="size-8" aria-label={`Clear expected close for ${o.name}`} onClick={() => s.setExpectedClose(o.leadId, null)}><X className="size-3.5" /></Button> : <span className="text-[11px] text-muted-foreground">Undated</span>}</div></td>
          </tr>)}</tbody></table></div>}
      </Panel>
      {editing && <ProbabilityDialog onClose={() => setEditing(false)} />}
    </div>
  );
}
function ProbabilityDialog({ onClose }: { onClose: () => void }) {
  const s = useCRM(); const cur = s.forecastConfig;
  const [p, setP] = useState<Record<string, string>>(Object.fromEntries(OPEN_STAGES.map((x) => [x, cur.probabilities[x] != null ? String(cur.probabilities[x]) : ""])));
  const [cons, setCons] = useState(String(cur.conservative)); const [opt, setOpt] = useState(String(cur.optimistic)); const [note, setNote] = useState("");
  const input = { probabilities: Object.fromEntries(OPEN_STAGES.map((x) => [x, p[x] === "" ? NaN : Number(p[x])])), conservative: Number(cons), optimistic: Number(opt), note };
  const err = forecastConfigError(input);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Stage probabilities</DialogTitle><DialogDescription>Your own estimate of how likely an open lead in each stage is to be won. Saving creates a new version; earlier versions are kept.</DialogDescription></DialogHeader>
        <div className="grid gap-2">{OPEN_STAGES.map((x) => <div key={x} className="flex items-center gap-2"><Label htmlFor={`pr-${x}`} className="flex-1">{STATUS_LABEL[x]}</Label><Input id={`pr-${x}`} type="number" min={0} max={100} className="h-9 w-24" value={p[x]} onChange={(e) => setP({ ...p, [x]: e.target.value })} /><span className="text-sm text-muted-foreground">%</span></div>)}
          <div className="mt-2 grid grid-cols-2 gap-2"><div className="grid gap-1"><Label htmlFor="pr-cons" className="text-xs">Conservative factor</Label><Input id="pr-cons" type="number" step="0.05" value={cons} onChange={(e) => setCons(e.target.value)} /></div><div className="grid gap-1"><Label htmlFor="pr-opt" className="text-xs">Optimistic factor</Label><Input id="pr-opt" type="number" step="0.05" value={opt} onChange={(e) => setOpt(e.target.value)} /></div></div>
          <div className="grid gap-1"><Label htmlFor="pr-note" className="text-xs">Reason for change (optional)</Label><Input id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {cur.version === 0 && <Button size="sm" variant="ghost" className="justify-start" onClick={() => setP({ new: "10", contacted: "20", qualified: "40", proposal: "60" })}>Fill example values (edit before saving)</Button>}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!!err} onClick={() => { const e = s.saveForecastConfig(input); if (e) toast.error(e); else { toast.success("Probabilities saved"); onClose(); } }}>Save version {cur.version + 1}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Reports
function Reports({ open }: { open: (d: Drill) => void }) {
  const s = useCRM();
  const [edit, setEdit] = useState<Partial<ReportDef> | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = s.savedReports.filter((r) => r.archived === showArchived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEdit({})}><Plus className="size-4" />New report</Button>
        <label className="ml-auto flex items-center gap-2 text-xs"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
      </div>
      {s.savedReports.length === 0 && <Panel title="Start from a template" sub="Reports store only their definition; results are rebuilt from your latest records every time.">
        <div className="flex flex-wrap gap-2">{REPORT_PRESETS.map((p) => <Button key={p.name} size="sm" variant="outline" onClick={() => setEdit({ ...p })}>{p.name}</Button>)}</div>
      </Panel>}
      {list.length === 0 && s.savedReports.length > 0 && <p className="text-sm text-muted-foreground">{showArchived ? "No archived reports." : "All reports are archived."}</p>}
      <div className="grid gap-5 lg:grid-cols-2">{list.map((r) => <ReportCard key={r.id} report={r} open={open} onEdit={() => setEdit(r)} />)}</div>
      {edit && <ReportEditor initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ReportCard({ report: r, open, onEdit, compact }: { report: ReportDef; open: (d: Drill) => void; onEdit?: () => void; compact?: boolean }) {
  const s = useCRM();
  const res = useMemo(() => runReport(r, s, new Date(), { employeeName: (id) => s.employees.find((e) => e.id === id)?.name ?? "Employee" }), [r, s]);
  const err = reportError(r, s.customFields);
  const fmt = (v: number) => (res.money ? formatINR(v) : String(v));
  const drill = (row: { label: string; ids: string[]; kind: string }) => open({ title: `${r.name} · ${row.label}`, kind: row.kind === "deal" ? "deal" : row.kind === "project" ? "project" : "lead", ids: row.ids });
  const data = res.rows.slice(0, 12);
  return (
    <Panel title={r.name} sub={`${SOURCE_LABEL[r.source]} · ${REPORT_METRICS[r.source].find((m) => m.id === r.metric)?.label} · ${fmtDay(res.window.start)} – ${fmtDay(res.window.end)}`}
      action={<div className="flex gap-0.5">
        <Button size="icon" variant="ghost" className="size-8" aria-label={r.favorite ? "Remove favourite" : "Mark favourite"} onClick={() => s.setReportFlags(r.id, { favorite: !r.favorite })}><Star className={cn("size-4", r.favorite && "fill-current text-warning")} /></Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label={r.pinned ? "Unpin from overview" : "Pin to overview"} onClick={() => s.setReportFlags(r.id, { pinned: !r.pinned })}><Pin className={cn("size-4", r.pinned && "fill-current text-primary")} /></Button>
        {!compact && <>
          {onEdit && <Button size="icon" variant="ghost" className="size-8" aria-label="Edit report" onClick={onEdit}><Pencil className="size-4" /></Button>}
          <Button size="icon" variant="ghost" className="size-8" aria-label="Duplicate report" onClick={() => { s.duplicateReport(r.id); toast.success("Report duplicated"); }}><Copy className="size-4" /></Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label={r.archived ? "Restore report" : "Archive report"} onClick={() => { s.setReportFlags(r.id, { archived: !r.archived, pinned: false }); toast(r.archived ? "Report restored" : "Report archived"); }}>{r.archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}</Button>
        </>}
      </div>}>
      {err && <p className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      {res.warnings.map((w) => <p key={w} className="mb-2 flex gap-1.5 rounded-md bg-warning/10 p-2 text-xs"><AlertTriangle className="size-3.5 shrink-0 text-warning" />{w}</p>)}
      {res.rows.length === 0 ? <EmptyChart text="No matching records in this range." /> : r.chart === "table" ? null : <div className="h-52"><ResponsiveContainer width="100%" height="100%">
        {r.chart === "pie" ? <PieChart><Pie data={data} dataKey="value" nameKey="label" innerRadius="50%" outerRadius="85%" paddingAngle={2} onClick={(x: { payload?: { label: string; ids: string[]; kind: string } }) => x.payload && drill(x.payload)}>{data.map((x, i) => <Cell key={x.key} fill={CHART[i % CHART.length]} className="cursor-pointer" />)}</Pie><Tooltip {...tip} formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
          : <BarChart data={data} margin={{ left: res.money ? 0 : -20, right: 4 }}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" {...axis} interval={0} tick={{ ...axis.tick, fontSize: 10 }} /><YAxis {...axis} width={res.money ? 56 : 40} allowDecimals={false} tickFormatter={(v: number) => (res.money ? formatINRCompact(v) : String(v))} /><Tooltip {...tip} formatter={(v: number) => [fmt(v), "Value"]} />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} className="cursor-pointer" onClick={(x: { label: string; ids: string[]; kind: string }) => drill(x)} /></BarChart>}
      </ResponsiveContainer></div>}
      {res.rows.length > 0 && (r.chart === "table" || !compact) && <div className="as-table-wrap mt-2"><table className="as-table"><thead><tr><th>{groupLabel(r, s.customFields)}</th><th>{res.money ? "Amount" : "Count"}</th></tr></thead>
        <tbody>{res.rows.map((x) => <tr key={x.key}><td>{x.label}</td><td><button className="as-cell-btn" onClick={() => drill(x)}>{fmt(x.value)}</button></td></tr>)}<tr><td className="font-semibold">Total</td><td className="num font-semibold">{fmt(res.total)}</td></tr></tbody></table></div>}
    </Panel>
  );
}
const groupLabel = (r: Pick<ReportDef, "groupBy" | "source">, fields: { id: string; label: string }[]) => (r.groupBy.startsWith("cf:") ? fields.find((f) => f.id === r.groupBy.slice(3))?.label ?? "Removed field" : REPORT_DIMS[r.source].find((d) => d.id === r.groupBy)?.label ?? r.groupBy);

function ReportEditor({ initial, onClose }: { initial: Partial<ReportDef>; onClose: () => void }) {
  const s = useCRM();
  const [r, setR] = useState<Omit<ReportDef, "id" | "createdAt" | "updatedAt" | "version"> & { id?: string | undefined }>({
    id: initial.id, name: initial.name ?? "", source: initial.source ?? "leads", metric: initial.metric ?? "count", groupBy: initial.groupBy ?? "source", period: initial.period ?? "30d", from: initial.from, to: initial.to,
    filter: initial.filter ?? {}, chart: initial.chart ?? "bar", sort: initial.sort ?? "value", pinned: initial.pinned ?? false, favorite: initial.favorite ?? false, archived: initial.archived ?? false,
  });
  const choiceFields = s.customFields.filter((f) => f.type === "select" || f.type === "multiselect" || f.type === "checkbox");
  const err = reportError(r, s.customFields);
  const setSource = (src: ReportSource) => setR({ ...r, source: src, metric: REPORT_METRICS[src][0]!.id, groupBy: REPORT_DIMS[src][0]!.id });
  const leadTags = s.tagDefs.filter((t) => (t.scope ?? "lead") !== "project");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{r.id ? "Edit report" : "New report"}</DialogTitle><DialogDescription>Only the definition is saved. Opening the report always uses your latest records.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label htmlFor="rp-name">Report name</Label><Input id="rp-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1"><Label htmlFor="rp-src">Data source</Label><select id="rp-src" className={sel} value={r.source} onChange={(e) => setSource(e.target.value as ReportSource)}>{(Object.keys(SOURCE_LABEL) as ReportSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}</select></div>
            <div className="grid gap-1"><Label htmlFor="rp-metric">Measure</Label><select id="rp-metric" className={sel} value={r.metric} onChange={(e) => setR({ ...r, metric: e.target.value })}>{REPORT_METRICS[r.source].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
            <div className="grid gap-1"><Label htmlFor="rp-group">Group by</Label><select id="rp-group" className={sel} value={r.groupBy} onChange={(e) => setR({ ...r, groupBy: e.target.value })}>
              {REPORT_DIMS[r.source].map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              {r.source === "leads" && choiceFields.map((f) => <option key={f.id} value={`cf:${f.id}`}>{f.label}{f.status === "archived" ? " (archived)" : ""}{f.visibility === "owner" ? " · Owner-only" : ""}</option>)}
            </select></div>
            <div className="grid gap-1"><Label htmlFor="rp-period">Date range</Label><select id="rp-period" className={sel} value={r.period} onChange={(e) => setR({ ...r, period: e.target.value as AnalyticsPeriod })}>{ANALYTICS_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            {r.period === "custom" && <><div className="grid gap-1"><Label htmlFor="rp-from">From</Label><Input id="rp-from" type="date" value={r.from ?? ""} onChange={(e) => setR({ ...r, from: e.target.value || undefined })} /></div><div className="grid gap-1"><Label htmlFor="rp-to">To</Label><Input id="rp-to" type="date" value={r.to ?? ""} onChange={(e) => setR({ ...r, to: e.target.value || undefined })} /></div></>}
            <div className="grid gap-1"><Label htmlFor="rp-chart">Chart</Label><select id="rp-chart" className={sel} value={r.chart} onChange={(e) => setR({ ...r, chart: e.target.value as ReportChart })}><option value="bar">Bar chart</option><option value="pie">Donut</option><option value="table">Table only</option></select></div>
            <div className="grid gap-1"><Label htmlFor="rp-sort">Sort</Label><select id="rp-sort" className={sel} value={r.sort} onChange={(e) => setR({ ...r, sort: e.target.value as "value" | "label" })}><option value="value">Largest first</option><option value="label">By name / date</option></select></div>
          </div>
          {r.source !== "projects" && r.source !== "support" && <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">Lead filters</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Report source filter" className={sel} value={r.filter.sources?.[0] ?? ""} onChange={(e) => setR({ ...r, filter: { ...r.filter, sources: e.target.value ? [e.target.value] : undefined } })}><option value="">All sources</option>{LEAD_SOURCES.map((x) => <option key={x}>{x}</option>)}</select>
              <select aria-label="Report stage filter" className={sel} value={r.filter.stages?.[0] ?? ""} onChange={(e) => setR({ ...r, filter: { ...r.filter, stages: e.target.value ? [e.target.value as LeadStatus] : undefined } })}><option value="">All stages</option>{LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>
              <select aria-label="Report tag filter" className={sel} value={r.filter.tagId ?? ""} onChange={(e) => setR({ ...r, filter: { ...r.filter, tagId: e.target.value || undefined } })}><option value="">Any tag</option>{leadTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </div></fieldset>}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!!err} onClick={() => { const res = s.saveReport(r); if (!res.ok) toast.error(res.error); else { toast.success("Report saved"); onClose(); } }}><BarChart3 className="size-4" />Save report</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
