import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Activity, Eye, UserX } from "lucide-react";
import { Shell, Empty, Stat, PriorityBadge } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { employeeStats, EVENT_LABEL } from "@/lib/crm/activity";
import { roleLabel, STATUS_LABEL as ACCOUNT_LABEL } from "@/lib/crm/team";
import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { formatDateTime } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/team_/workspace/$id")({
  head: () => ({
    meta: [
      { title: "Employee Workspace · Scale Flow Sales OS" },
      { name: "description", content: "Read-only Owner view of an employee's assigned leads, pipeline and follow-ups." },
      { property: "og:title", content: "Employee Workspace · Scale Flow Sales OS" },
      { property: "og:description", content: "Read-only Owner view of an employee's assigned leads, pipeline and follow-ups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const { id } = Route.useParams();
  const { preview } = useAccess();
  const st = useCRM();
  const e = st.employees.find((x) => x.id === id);
  const now = new Date();
  const mine = useMemo(() => st.leads.filter((l) => st.assignments[l.id]?.employeeId === id), [st.leads, st.assignments, id]);
  if (preview) return <Shell title="Employee Workspace"><Empty icon={<Eye />} title="Owner only" /></Shell>;
  if (!e) return <Shell title="Employee Workspace"><Empty icon={<UserX />} title="Employee not found" action={<Button asChild size="sm"><Link to="/team">Back to Team</Link></Button>} /></Shell>;
  const s = employeeStats(id, st, st.teamEvents, { start: Date.now() - 30 * 86400000, end: Infinity }, now);
  const ids = new Set(mine.map((l) => l.id));
  const pending = st.followUps.filter((f) => ids.has(f.leadId) && !f.completedAt && !f.cancelledAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const recent = [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const history = st.teamEvents.filter((x) => x.actorUserId === id || x.targetEmployeeId === id || (x.relatedLeadId && ids.has(x.relatedLeadId))).slice(0, 12);
  const name = (lid: string) => st.leads.find((l) => l.id === lid)?.name ?? "Lead";

  return <Shell title={`${e.name}'s workspace`} subtitle={`${roleLabel(e)} · ${ACCOUNT_LABEL[e.accountStatus]} · read-only Owner view`} actions={<>
    <Button asChild variant="ghost" size="sm"><Link to="/team" search={{ employee: id }}><ArrowLeft />Profile</Link></Button>
    <Button asChild variant="outline" size="sm"><Link to="/team-activity" search={{ employee: id }}><Activity />View activity</Link></Button>
  </>}>
    <p className="ta-note"><Eye className="size-4 shrink-0" />You're inspecting {e.name}'s assigned workload as the Owner. Nothing here signs in as them, and any edit you make from your own CRM is recorded as an Owner action.</p>
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Assigned leads" value={String(s.assigned)} />
      <Stat label="Open follow-ups" value={String(s.openFollowUps)} tone="teal" />
      <Stat label="Overdue follow-ups" value={String(s.overdue)} tone={s.overdue ? "destructive" : "success"} />
      <Stat label="Calls on their leads" value={String(s.calls)} hint="Last 30 days, logged records" tone="warning" />
    </div>
    <section className="mt-8"><h2 className="editorial text-2xl">Pipeline distribution</h2>
      <div className="ta-dist mt-3">{LEAD_STATUSES.map((k) => { const n = mine.filter((l) => l.status === k).length; return <div key={k}><span className="text-xs text-muted-foreground">{STATUS_LABEL[k]}</span><span className="num text-xl">{n}</span><span className="ta-bar"><span style={{ width: `${mine.length ? (n / mine.length) * 100 : 0}%` }} /></span></div>; })}</div>
    </section>
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <section><h2 className="editorial text-2xl">Open follow-ups</h2>
        {!pending.length ? <p className="mt-3 text-sm text-muted-foreground">No open follow-ups.</p> : <ul className="ta-list mt-3">{pending.slice(0, 10).map((f) => <li key={f.id}><Link to="/pipeline" search={{ lead: f.leadId }} className="ta-row"><span className="flex-1 text-sm font-medium">{name(f.leadId)}</span><span className="num text-xs" data-warn={Date.parse(f.dueAt) < now.getTime()}>{formatDateTime(f.dueAt)}</span></Link></li>)}</ul>}
      </section>
      <section><h2 className="editorial text-2xl">Recently changed leads</h2>
        {!recent.length ? <p className="mt-3 text-sm text-muted-foreground">No leads assigned yet.</p> : <ul className="ta-list mt-3">{recent.map((l) => <li key={l.id}><Link to="/pipeline" search={{ lead: l.id }} className="ta-row"><span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span><PriorityBadge p={l.priority} /><span className="text-xs text-muted-foreground">{STATUS_LABEL[l.status]}</span></Link></li>)}</ul>}
      </section>
    </div>
    <section className="mt-8"><h2 className="editorial text-2xl">Assigned leads</h2>
      {!mine.length ? <p className="mt-3 text-sm text-muted-foreground">Nothing assigned.</p> : <ul className="ta-list mt-3">{mine.map((l) => <li key={l.id}><Link to="/pipeline" search={{ lead: l.id }} className="ta-row"><span className="min-w-0 flex-1 truncate text-sm">{l.name}{l.company && <span className="text-muted-foreground"> · {l.company}</span>}</span><span className="text-xs text-muted-foreground">{STATUS_LABEL[l.status]}</span></Link></li>)}</ul>}
    </section>
    <section className="mt-8"><h2 className="editorial text-2xl">Related activity</h2>
      {!history.length ? <p className="mt-3 text-sm text-muted-foreground">No recorded activity for this employee or their leads yet.</p> : <ul className="ta-list mt-3">{history.map((x) => <li key={x.eventId}><Link to="/team-activity" search={{ event: x.eventId }} className="ta-row"><span className="min-w-0 flex-1 text-sm">{x.summary}</span><span className="text-[11px] text-muted-foreground">{EVENT_LABEL[x.eventType]} · {formatDateTime(x.occurredAt)}</span></Link></li>)}</ul>}
    </section>
  </Shell>;
}
