import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, LogOut, Lock, Users, CalendarClock, KanbanSquare, Wallet, LayoutDashboard, StickyNote, BarChart3, Presentation, Sunrise, UserRound } from "lucide-react";
import { Shell, Empty, PriorityBadge } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { resolve, workspaceFor, FINANCE_LABEL, SCOPE_LABEL, MODULES } from "@/lib/crm/access";
import { roleLabel } from "@/lib/crm/team";
import { followUpBucket, isPending } from "@/lib/crm/followups";
import { dealCollected, dealOutstanding } from "@/lib/crm/finance";
import { formatDateTime, formatINRCompact } from "@/lib/crm/format";
import { LEAD_STATUSES, STATUS_LABEL, DEAL_STATUS_LABEL } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team_/preview/$id")({
  head: () => ({
    meta: [
      { title: "Employee Workspace Preview · Scale Flow Sales OS" },
      { name: "description", content: "Demo-only preview of what an employee's CRM workspace would show." },
      { property: "og:title", content: "Employee Workspace Preview · Scale Flow Sales OS" },
      { property: "og:description", content: "Demo-only preview of what an employee's CRM workspace would show." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Preview,
});

const ICON: Record<string, typeof Users> = { dashboard: LayoutDashboard, leads: Users, pipeline: KanbanSquare, followups: CalendarClock, deals: Wallet, notes: StickyNote, analytics: BarChart3, studio: Presentation, briefing: Sunrise, clients: UserRound };
const TABS = ["dashboard", "leads", "pipeline", "followups", "deals", "notes"] as const;

// Frontend simulation only — no session, no impersonation; the owner's data is read, never changed.
function Preview() {
  const { id } = Route.useParams();
  const { employees, employeeAccess, leads, followUps, deals, payments, assignments } = useCRM();
  const e = employees.find((x) => x.id === id && x.accountStatus !== "archived");
  const eff = useMemo(() => (e ? resolve(e.roleId, employeeAccess[e.id]) : null), [e, employeeAccess]);
  const ws = useMemo(() => (e && eff ? workspaceFor(e.id, eff, { leads, followUps, assignments }) : null), [e, eff, leads, followUps, assignments]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("dashboard");
  if (!e || !eff || !ws) return <Shell title="Employee Workspace Preview"><Empty icon={<Users />} title="Employee not found" action={<Button asChild><Link to="/team">Back to Team</Link></Button>} /></Shell>;
  const now = new Date();
  const pending = ws.followUps.filter(isPending);
  const overdue = pending.filter((f) => followUpBucket(f, now) === "overdue");
  const today = pending.filter((f) => followUpBucket(f, now) === "today");
  const ids = new Set(ws.leads.map((l) => l.id));
  const myDeals = eff.finance === "none" ? [] : deals.filter((d) => d.leadId && ids.has(d.leadId));
  const showPhone = eff.can("clients.view");
  const allowedTab = (t: string) => ws.nav.includes(t);
  const hidden = MODULES.filter((m) => !ws.nav.includes(m.id) && !["import", "export", "settings", "team", "clients", "quotations", "templates", "demos", "proofs"].includes(m.id));
  return (
    <Shell title={`${e.name.split(" ")[0]}'s workspace`} subtitle={`${roleLabel(e)} · ${SCOPE_LABEL[eff.leadScope]} · ${FINANCE_LABEL[eff.finance]}`} actions={<Button asChild variant="outline"><Link to="/team" search={{ employee: e.id }}><LogOut />Exit preview</Link></Button>}>
      <div className="pv-banner" role="status"><Eye className="size-4 shrink-0" /><span><b>Employee Workspace Preview — Demo Only.</b> A simulation of {e.name}'s saved permissions and assigned leads. Not a login, not secure; nothing here is changed.</span><Link to="/team" search={{ employee: e.id }} className="pv-exit">Exit</Link></div>
      <nav className="pv-tabs" aria-label="Employee navigation">{TABS.map((t) => { const I = ICON[t] ?? Users; const ok = t === "notes" ? eff.can("notes.own") : allowedTab(t); return <button key={t} type="button" disabled={!ok} aria-pressed={tab === t} onClick={() => setTab(t)} className="pv-tab"><I className="size-4" />{MODULES.find((m) => m.id === t)?.label}{!ok && <Lock className="size-3" />}</button>; })}</nav>
      <div className="pv-body">
        {tab === "dashboard" && <div className="grid gap-4">
          <div className="tm-summary">{([["Leads in view", ws.leads.length], ["Follow-ups today", today.length], ["Overdue", overdue.length], ["Hot leads", ws.leads.filter((l) => l.priority === "hot").length]] as const).map(([l, v]) => <div key={l} className="tm-sum"><span className="eyebrow">{l}</span><span className="num tm-sum-v">{v}</span></div>)}</div>
          <div className="surface p-4 text-sm"><div className="eyebrow mb-2">Company figures</div>{eff.can("analytics.company") ? "Company-wide totals would be visible." : <span className="flex items-center gap-2 text-muted-foreground"><Lock className="size-3.5" />Company revenue and totals are not sent to this employee.</span>}</div>
          {hidden.length > 0 && <div className="surface p-4"><div className="eyebrow mb-2">Not in their menu</div><div className="flex flex-wrap gap-1.5">{hidden.map((m) => <span key={m.id} className="tm-chip"><Lock className="size-3" />{m.label}</span>)}<span className="tm-chip"><Lock className="size-3" />Team Management</span><span className="tm-chip"><Lock className="size-3" />Your Personal Notes</span></div></div>}
        </div>}
        {tab === "leads" && (ws.leads.length ? <ul className="surface grid">{ws.leads.map((l) => <li key={l.id} className="tm-row"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{l.name}</span><span className="block truncate text-xs text-muted-foreground">{l.company ?? "Independent"}{showPhone ? ` · ${l.phone}` : " · contact details hidden"}</span></span><span className="stage-chip" data-stage={l.status}>{STATUS_LABEL[l.status]}</span><PriorityBadge p={l.priority} /></li>)}</ul> : <div className="surface"><Empty icon={<Users />} title="No leads yet" hint={eff.can("leads.view") ? "Assign leads to this employee from Leads or Team Management." : "Leads are switched off for this employee."} /></div>)}
        {tab === "pipeline" && <div className="pv-pipe">{LEAD_STATUSES.map((s) => { const ls = ws.leads.filter((l) => l.status === s); return <div key={s} className="surface p-3" data-stage={s}><div className="flex justify-between text-xs font-semibold"><span>{STATUS_LABEL[s]}</span><span className="num">{ls.length}</span></div>{eff.finance === "amounts" || eff.finance === "manage" ? <div className="num mt-1 text-xs text-muted-foreground">{formatINRCompact(ls.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))}</div> : <div className="mt-1 text-[11px] text-muted-foreground">Values hidden</div>}<ul className="mt-2 grid gap-1">{ls.map((l) => <li key={l.id} className="truncate rounded-md bg-muted px-2 py-1 text-xs">{l.name}</li>)}</ul></div>; })}</div>}
        {tab === "followups" && (pending.length ? <ul className="surface grid">{pending.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((f) => <li key={f.id} className="tm-row"><span className="min-w-0 flex-1 text-sm font-medium">{leads.find((l) => l.id === f.leadId)?.name}<span className="block text-xs text-muted-foreground">{f.note ?? f.type}</span></span><span className={cn("text-xs", followUpBucket(f, now) === "overdue" && "font-semibold text-destructive")}>{formatDateTime(f.dueAt)}</span></li>)}</ul> : <div className="surface"><Empty icon={<CalendarClock />} title="No follow-ups" hint="Only follow-ups for leads in their scope appear here." /></div>)}
        {tab === "deals" && (myDeals.length ? <ul className="surface grid">{myDeals.map((d) => <li key={d.id} className="tm-row"><span className="min-w-0 flex-1 text-sm font-medium">{d.name}<span className="block text-xs text-muted-foreground">{d.clientName}</span></span><span className="tm-role">{DEAL_STATUS_LABEL[d.status]}</span>{eff.finance !== "status" && <span className="num text-xs">{formatINRCompact(dealCollected(d.id, payments))} in · {formatINRCompact(dealOutstanding(d, payments))} due</span>}</li>)}</ul> : <div className="surface"><Empty icon={<Wallet />} title="No deals visible" hint={eff.finance === "none" ? "Finance is hidden for this employee." : "None of their clients have deals yet."} /></div>)}
        {tab === "notes" && <div className="surface"><Empty icon={<StickyNote />} title="Their own notebook" hint="Employees get a private notebook. Your Personal Notes are never shown to them." /></div>}
      </div>
    </Shell>
  );
}
