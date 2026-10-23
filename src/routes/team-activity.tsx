import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, Search, Settings2, FlaskConical, X, ArrowUpRight, Users, Info } from "lucide-react";
import { Shell, Empty, selectCls } from "@/components/crm/Shell";
import { NotificationSettingsDialog } from "@/components/crm/NotificationSettings";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { EVENT_LABEL, MODULE_LABEL, employeeStats, filterEvents, rangeWindow, simulateDemoEvents, type ActivityEvent, type ActivityFilter, type CrmModule, type EventType, type Importance, type RangeKey } from "@/lib/crm/activity";
import { roleLabel, STATUS_LABEL } from "@/lib/crm/team";
import { dayKey, formatDate, formatDateTime, initials } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type S = { employee?: string; type?: string; module?: string; range?: string; from?: string; to?: string; lead?: string; importance?: string; q?: string; event?: string };
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const RANGES: { id: RangeKey; label: string }[] = [{ id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "90d", label: "90 days" }, { id: "custom", label: "Custom" }];
const PAGE = 30;

export const Route = createFileRoute("/team-activity")({
  validateSearch: (s: Record<string, unknown>): S => Object.fromEntries(["employee", "type", "module", "range", "from", "to", "lead", "importance", "q", "event"].map((k) => [k, str(s[k])]).filter(([, v]) => v)) as S,
  head: () => ({
    meta: [
      { title: "Team Activity · Scale Flow Sales OS" },
      { name: "description", content: "Owner-only activity timeline, team overview and smart notification settings." },
      { property: "og:title", content: "Team Activity · Scale Flow Sales OS" },
      { property: "og:description", content: "Owner-only activity timeline, team overview and smart notification settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamActivity,
});

function TeamActivity() {
  const { preview } = useAccess();
  const st = useCRM();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [limit, setLimit] = useState(PAGE);
  const [demo, setDemo] = useState<ActivityEvent[]>([]);
  const [settings, setSettings] = useState(false);
  const set = (p: { [K in keyof S]?: string | undefined }) => { setLimit(PAGE); void navigate({ search: (s: S) => Object.fromEntries(Object.entries({ ...s, ...p }).filter(([, v]) => v)) as S, replace: true }); };
  const now = new Date();
  const range = (search.range as RangeKey | undefined) ?? "30d";
  const filter: ActivityFilter = { ...(search.employee ? { employee: search.employee } : {}), type: (search.type as EventType) ?? "", module: (search.module as CrmModule) ?? "", importance: (search.importance as Importance) ?? "", ...(search.lead ? { lead: search.lead } : {}), range, ...(search.from ? { from: search.from } : {}), ...(search.to ? { to: search.to } : {}), ...(search.q ? { q: search.q } : {}) };
  const all = useMemo(() => [...demo, ...st.teamEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [demo, st.teamEvents]);
  const list = useMemo(() => filterEvents(all, filter, now), [all, JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps
  const win = rangeWindow(range, now, search.from, search.to);
  const selected = search.event ? all.find((e) => e.eventId === search.event) : undefined;
  const leadName = (id?: string) => (id ? st.leads.find((l) => l.id === id)?.name : undefined);
  const empName = (id?: string) => (id ? st.employees.find((e) => e.id === id)?.name : undefined);

  if (preview) return <Shell title="Team Activity"><Empty icon={<Activity />} title="Owner only" hint="Company-wide activity is never available to employees." /></Shell>;

  const shown = list.slice(0, limit);
  const groups: [string, ActivityEvent[]][] = [];
  for (const e of shown) { const k = dayKey(e.occurredAt); const g = groups.at(-1); if (g && g[0] === k) g[1].push(e); else groups.push([k, [e]]); }
  const types = Object.keys(EVENT_LABEL) as EventType[];

  return <Shell title="Team Activity" subtitle="Every meaningful CRM change, attributed and searchable" actions={<>
    <Button variant="outline" size="sm" onClick={() => setSettings(true)}><Settings2 />Notification settings</Button>
    <Button variant={demo.length ? "secondary" : "ghost"} size="sm" onClick={() => setDemo(demo.length ? [] : simulateDemoEvents(st.employees, st.leads, new Date()))} aria-pressed={demo.length > 0}><FlaskConical />{demo.length ? "Hide demo events" : "Demo event simulation"}</Button>
  </>}>
    <div className="ta-note"><Info className="size-4 shrink-0" /><p>Activity is recorded from actions taken in this browser, so today every genuine event is yours as Owner. Employee events appear once the secure backend records who did what. Employee Preview actions are never recorded here.{demo.length > 0 && <strong> Demo events are shown, marked “Demo”, and never saved, counted or backed up.</strong>}</p></div>

    <section aria-labelledby="ta-team" className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="ta-team" className="editorial text-2xl">Team overview</h2><span className="text-xs text-muted-foreground">Counts for {RANGES.find((r) => r.id === range)?.label.toLowerCase() ?? "selected range"} · from saved records on each employee's assigned leads</span></div>
      {!st.employees.length ? <Empty icon={<Users />} title="No employees yet" hint="Add people in Team Management to see their workload here." action={<Button asChild size="sm"><Link to="/team">Open Team Management</Link></Button>} /> :
      <div className="ta-team mt-3">{st.employees.map((e) => { const s = employeeStats(e.id, st, st.teamEvents, win, now); return <article key={e.id} className="ta-emp" data-active={search.employee === e.id}>
        <div className="flex items-center gap-3"><span className="tm-avatar">{initials(e.name)}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{e.name}</div><div className="truncate text-xs text-muted-foreground">{roleLabel(e)} · {STATUS_LABEL[e.accountStatus]}</div></div></div>
        <dl className="ta-stats"><div><dt>Assigned</dt><dd>{s.assigned}</dd></div><div><dt>Calls</dt><dd>{s.calls}</dd></div><div><dt>Done FU</dt><dd>{s.completedFollowUps}</dd></div><div><dt>Overdue</dt><dd data-warn={s.overdue > 0}>{s.overdue}</dd></div><div><dt>Qualified</dt><dd>{s.qualified}</dd></div><div><dt>Won</dt><dd>{s.won}</dd></div></dl>
        <p className="text-[11px] text-muted-foreground">Last attributed activity: {s.lastActivityAt ? formatDateTime(s.lastActivityAt) : "none recorded yet"}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => set({ employee: search.employee === e.id ? undefined : e.id })}>{search.employee === e.id ? "Clear filter" : "View activity"}</Button><Button asChild size="sm" variant="ghost"><Link to="/team/workspace/$id" params={{ id: e.id }}>Workspace</Link></Button></div>
      </article>; })}</div>}
    </section>

    <section aria-labelledby="ta-tl" className="mt-8">
      <h2 id="ta-tl" className="editorial text-2xl">Activity timeline</h2>
      <div className="ta-filters mt-3">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="Search activity" placeholder="Search activity…" value={search.q ?? ""} onChange={(e) => set({ q: e.target.value })} /></div>
        <select className={selectCls} aria-label="Employee" value={search.employee ?? ""} onChange={(e) => set({ employee: e.target.value })}><option value="">All people</option><option value="owner">Owner</option>{st.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <select className={selectCls} aria-label="Action type" value={search.type ?? ""} onChange={(e) => set({ type: e.target.value })}><option value="">All actions</option>{types.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}</select>
        <select className={selectCls} aria-label="Module" value={search.module ?? ""} onChange={(e) => set({ module: e.target.value })}><option value="">All modules</option>{(Object.keys(MODULE_LABEL) as CrmModule[]).map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}</select>
        <select className={selectCls} aria-label="Importance" value={search.importance ?? ""} onChange={(e) => set({ importance: e.target.value })}><option value="">Any importance</option><option value="high">Important</option><option value="normal">Normal</option><option value="low">Minor</option></select>
        <select className={selectCls} aria-label="Related lead" value={search.lead ?? ""} onChange={(e) => set({ lead: e.target.value })}><option value="">All leads</option>{st.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">{RANGES.map((r) => <button key={r.id} type="button" className="ta-chip" aria-pressed={range === r.id} onClick={() => set({ range: r.id === "30d" ? undefined : r.id })}>{r.label}</button>)}
        {range === "custom" && <span className="flex flex-wrap items-center gap-1.5"><Input type="date" aria-label="From date" className="h-9 w-auto" value={search.from ?? ""} onChange={(e) => set({ from: e.target.value })} /><span className="text-xs text-muted-foreground">to</span><Input type="date" aria-label="To date" className="h-9 w-auto" value={search.to ?? ""} onChange={(e) => set({ to: e.target.value })} /></span>}
        {(search.employee || search.type || search.module || search.importance || search.lead || search.q) && <Button size="sm" variant="ghost" onClick={() => set({ employee: undefined, type: undefined, module: undefined, importance: undefined, lead: undefined, q: undefined })}><X />Clear</Button>}
        <span className="ml-auto text-xs text-muted-foreground num">{list.length} event{list.length === 1 ? "" : "s"}</span>
      </div>

      {!list.length ? <Empty icon={<Activity />} title="No activity in this view" hint={st.teamEvents.length ? "Try a wider date range or clear filters." : "Actions you take from now on — new leads, calls, follow-ups, stage changes, payments, assignments — appear here."} /> :
      <ol className="ta-timeline mt-4">{groups.map(([day, evts]) => <li key={day}><h3 className="ta-day">{formatDate(evts[0]!.occurredAt, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h3>
        <ul>{evts.map((e) => <li key={e.eventId}><button type="button" className="ta-event" data-importance={e.importance} data-demo={e.eventSource === "demo"} onClick={() => set({ event: e.eventId })}>
          <span className="ta-avatar" aria-hidden>{initials(e.actorName)}</span>
          <span className="min-w-0 flex-1 text-left"><span className="text-sm leading-snug">{e.summary}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><span className="ta-tag">{EVENT_LABEL[e.eventType]}</span><span>{e.actorName} · {e.actorRole === "owner" ? "Owner" : e.actorRole}</span><span className="num">{formatDateTime(e.occurredAt)}</span>{e.eventSource === "demo" && <span className="ta-tag ta-demo">Demo</span>}{e.importance === "high" && <span className="ta-tag ta-hi">Important</span>}</span></span>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" /></button></li>)}</ul></li>)}</ol>}
      {list.length > limit && <div className="mt-4 text-center"><Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>Load {Math.min(PAGE, list.length - limit)} more</Button></div>}
    </section>

    <Sheet open={!!search.event} onOpenChange={(o) => !o && set({ event: undefined })}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {selected ? <><SheetHeader><SheetTitle>{EVENT_LABEL[selected.eventType]}</SheetTitle><SheetDescription>{selected.summary}</SheetDescription></SheetHeader>
          <dl className="tm-dl mt-5">
            <dt>Actor</dt><dd>{selected.actorName} ({selected.actorRole === "owner" ? "Owner" : selected.actorRole})</dd>
            <dt>When</dt><dd>{formatDateTime(selected.occurredAt)}</dd>
            <dt>Module</dt><dd>{MODULE_LABEL[selected.module]}</dd>
            {leadName(selected.relatedLeadId) && <><dt>Lead</dt><dd>{leadName(selected.relatedLeadId)}</dd></>}
            {empName(selected.targetEmployeeId) && <><dt>Employee</dt><dd>{empName(selected.targetEmployeeId)}</dd></>}
            <dt>Record ID</dt><dd className="break-all font-mono text-[11px]">{selected.entityId}</dd>
            <dt>Source</dt><dd>{selected.eventSource === "demo" ? "Demo simulation (not real)" : selected.eventSource === "backend" ? "Server" : "This browser"}</dd>
          </dl>
          {(selected.oldValues || selected.newValues) && <div className="mt-5"><h3 className="eyebrow">Changes</h3><table className="ta-diff mt-2"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
            {[...new Set([...Object.keys(selected.oldValues ?? {}), ...Object.keys(selected.newValues ?? {})])].filter((k) => k !== "leadIds").map((k) => <tr key={k}><td>{k}</td><td>{show(selected.oldValues?.[k])}</td><td>{show(selected.newValues?.[k])}</td></tr>)}
          </tbody></table></div>}
          {selected.eventType === "call.logged" && <p className="mt-4 text-xs text-muted-foreground">Only the logged outcome is shown. Call duration, connection and recordings are not tracked.</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            {selected.relatedLeadId && leadName(selected.relatedLeadId) && <Button asChild><Link to="/pipeline" search={{ lead: selected.relatedLeadId }}>Open lead inspector</Link></Button>}
            {selected.targetEmployeeId && empName(selected.targetEmployeeId) && <Button asChild variant="outline"><Link to="/team" search={{ employee: selected.targetEmployeeId }}>Open employee</Link></Button>}
          </div></> : <SheetHeader><SheetTitle>Event not found</SheetTitle><SheetDescription>It may be outside the stored history.</SheetDescription></SheetHeader>}
      </SheetContent>
    </Sheet>
    <NotificationSettingsDialog open={settings} onOpenChange={setSettings} />
  </Shell>;
}
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return String(v);
}
