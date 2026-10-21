import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Flame, CalendarCheck, AlertTriangle, UserPlus, Hourglass, IndianRupee, RefreshCw, ChevronDown, Phone, MessageCircle, CalendarPlus, Check, RotateCcw, Sparkles, ExternalLink } from "lucide-react";
import { Shell } from "@/components/crm/Shell";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { buildPriorities, paymentsToChase, isOpen, isStale, type Severity } from "@/lib/crm/insights";
import { dayKey, formatDateTime, formatINR, formatINRCompact, formatTime, greeting, digits, formatDate } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/daily-briefing")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Daily Briefing · Scale Flow CRM" },
      { name: "description", content: "Today's priorities, calls, proposals and payments to chase." },
      { property: "og:title", content: "Daily Briefing · Scale Flow CRM" },
      { property: "og:description", content: "Today's priorities, calls, proposals and payments to chase." },
    ],
  }),
  component: Briefing,
});

const SEV: Record<Severity, string> = { critical: "bg-destructive-soft text-destructive", important: "bg-warning-soft text-warning", normal: "bg-info-soft text-primary" };

function Briefing() {
  const { leads, followUps, deals, payments, owner, briefingDone: savedDone, briefingDate, toggleBriefing, resetBriefing, addActivity } = useCRM();
  const [filter, setFilter] = useState<"all" | Severity | "done">("all");
  const [expanded, setExpanded] = useState(false);
  const [stamp, setStamp] = useState(() => new Date());
  const [fuLead, setFuLead] = useState<string | null>(null);
  const now = stamp;
  const today = dayKey(now);
  const briefingDone = briefingDate === today ? savedDone : [];

  const d = useMemo(() => {
    const open = leads.filter(isOpen);
    const pending = followUps.filter((f) => !f.completedAt);
    const todayFu = pending.filter((f) => dayKey(f.dueAt) === today);
    const overdueFu = pending.filter((f) => dayKey(f.dueAt) < today);
    return {
      hot: open.filter((l) => l.priority === "hot"),
      todayFu, overdueFu,
      newLeads: leads.filter((l) => l.status === "new"),
      stale: open.filter((l) => isStale(l, now)),
      openValue: open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0),
      calls: todayFu.filter((f) => f.type === "call").sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      proposals: leads.filter((l) => l.status === "proposal"),
      chase: paymentsToChase(deals, payments, now),
      items: buildPriorities(leads, followUps, now),
    };
  }, [leads, followUps, deals, payments, today, now]);

  const items = d.items.filter((i) => (filter === "done" ? briefingDone.includes(i.key) : !briefingDone.includes(i.key) && (filter === "all" || i.severity === filter)));
  const lead = (id: string) => leads.find((l) => l.id === id);
  const counts = { critical: d.items.filter((i) => i.severity === "critical" && !briefingDone.includes(i.key)).length, important: d.items.filter((i) => i.severity === "important" && !briefingDone.includes(i.key)).length };
  const top = d.items.filter((i) => !briefingDone.includes(i.key)).slice(0, 3);

  const snap = [
    { label: "Hot leads", value: d.hot.length, icon: Flame, tone: "text-destructive bg-destructive-soft" },
    { label: "Follow-ups today", value: d.todayFu.length, icon: CalendarCheck, tone: "text-primary bg-primary-soft" },
    { label: "Overdue follow-ups", value: d.overdueFu.length, icon: AlertTriangle, tone: "text-warning bg-warning-soft" },
    { label: "New leads", value: d.newLeads.length, icon: UserPlus, tone: "text-teal bg-teal-soft" },
    { label: "Going stale (7d+)", value: d.stale.length, icon: Hourglass, tone: "text-muted-foreground bg-neutral-soft" },
    { label: "Active opportunity", value: formatINRCompact(d.openValue), icon: IndianRupee, tone: "text-success bg-success-soft" },
  ];

  return (
    <Shell title="Daily Briefing" subtitle="Your sales plan for today">
      <section className="briefing-banner relative overflow-hidden p-6 text-hero-foreground sm:p-8">
        <div className="text-xs font-medium tracking-wider text-hero-muted uppercase">{formatDate(now.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{greeting()}, {owner}.</h2>
        <p className="mt-2 max-w-xl text-sm text-hero-muted">You have <b className="text-hero-foreground">{counts.critical} critical</b> and <b className="text-hero-foreground">{counts.important} important</b> actions today, across <b className="text-hero-foreground">{formatINRCompact(d.openValue)}</b> of open opportunity.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Hot leads", d.hot.length], ["Follow-ups today", d.todayFu.length], ["Overdue", d.overdueFu.length], ["Open value", formatINRCompact(d.openValue)]].map(([l, v]) => (
            <div key={l as string} className="border-l border-hero-foreground/20 pl-4"><div className="num font-display text-2xl font-bold">{v}</div><div className="text-xs text-hero-muted">{l}</div></div>
          ))}
        </div>
      </section>

      <section className="surface mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h2 className="font-semibold">Daily intelligence</h2><span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning uppercase">Simulated · rule-based</span></div>
          <Button size="sm" variant="ghost" onClick={() => { setStamp(new Date()); toast.success("Briefing refreshed"); }}><RefreshCw className="size-4" />Refresh · {formatTime(stamp.toISOString())}</Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {d.overdueFu.length > 0 ? `Start with ${d.overdueFu.length} overdue follow-up${d.overdueFu.length > 1 ? "s" : ""}, then ` : "No overdue follow-ups — "}
          work through {d.todayFu.length} scheduled for today. {d.chase.filter((c) => c.overdue).length > 0 && `${d.chase.filter((c) => c.overdue).length} payment(s) are overdue — ${formatINRCompact(d.chase.filter((c) => c.overdue).reduce((a, c) => a + c.due, 0))} to collect.`}
        </p>
        {top.length > 0 && (
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {top.map((t, i) => <li key={t.key} className="rounded-lg border p-3 text-sm"><div className="text-xs text-muted-foreground">Priority {i + 1}</div><div className="font-medium">{t.lead.name}</div><div className="text-xs text-muted-foreground">{t.action}</div></li>)}
          </ol>
        )}
        <Button variant="link" size="sm" onClick={() => setExpanded(!expanded)} className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">How these are chosen<ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} /></Button>
        {expanded && <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground"><li>Critical: overdue follow-ups, or a hot lead's follow-up due today.</li><li>Important: follow-ups due today, proposals with nothing scheduled, hot leads without a plan.</li><li>Normal: new leads not yet contacted. Ties are broken by opportunity value.</li><li>These rules run on your demo data only — no AI service is connected yet.</li></ul>}
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {snap.map((s) => (
          <div key={s.label} className="surface p-4"><div className={cn("grid size-8 place-items-center rounded-lg", s.tone)}><s.icon className="size-4" /></div><div className="num mt-3 font-display text-xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="surface p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Today's priorities</h2>
            <div className="flex flex-wrap items-center gap-1">
              {(["all", "critical", "important", "normal", "done"] as const).map((f) => <Button variant="ghost" size="sm" key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{f}</Button>)}
              <Button size="sm" variant="ghost" onClick={() => { resetBriefing(); toast.success("Checklist reset"); }}><RotateCcw className="size-3.5" />Reset</Button>
            </div>
          </div>
          <ul className="grid gap-2">
            {items.length === 0 && <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{filter === "done" ? "Nothing marked done yet." : "All clear for this filter."}</li>}
            {items.map((i) => {
              const done = briefingDone.includes(i.key);
              return (
                <li key={i.key} className={cn("rounded-lg border border-border bg-card p-5 shadow-card transition-colors hover:border-primary/40", done && "opacity-60")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", SEV[i.severity])}>{i.severity}</span><span className="font-medium">{i.lead.name}</span>{i.lead.company && <span className="text-sm text-muted-foreground">· {i.lead.company}</span>}</div>
                      <div className="mt-1 text-sm">{i.reason}</div>
                      <div className="text-sm text-muted-foreground">→ {i.action}</div>
                    </div>
                    <div className="num text-right text-xs text-muted-foreground">{i.when && <div>{formatDateTime(i.when)}</div>}{i.value && <div className="font-semibold text-foreground">{formatINR(i.value)}</div>}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" asChild><Link to="/leads/$id" params={{ id: i.lead.id }}><ExternalLink className="size-3.5" />Open</Link></Button>
                    <Button size="sm" variant="outline" asChild><a href={`tel:${i.lead.phone}`} onClick={() => addActivity(i.lead.id, "Called from Daily Briefing", "call")}><Phone className="size-3.5" />Call</a></Button>
                    <Button size="sm" variant="outline" asChild><a href={`https://wa.me/91${digits(i.lead.phone)}`} target="_blank" rel="noreferrer" onClick={() => addActivity(i.lead.id, "WhatsApp from Daily Briefing", "whatsapp")}><MessageCircle className="size-3.5" />WhatsApp</a></Button>
                    <Button size="sm" variant="outline" onClick={() => setFuLead(i.lead.id)}><CalendarPlus className="size-3.5" />Follow-up</Button>
                    <Button size="sm" variant={done ? "ghost" : "default"} onClick={() => toggleBriefing(i.key)}><Check className="size-3.5" />{done ? "Undo" : "Mark done"}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="grid content-start gap-5">
          <Widget title="Today's call list" count={d.calls.length}>
            {d.calls.length === 0 ? <p className="text-sm text-muted-foreground">No calls scheduled today.</p> : d.calls.map((f) => { const l = lead(f.leadId); return l && (
              <Link key={f.id} to="/leads/$id" params={{ id: l.id }} className="flex items-center justify-between rounded-lg p-2 text-sm hover:bg-muted">
                <div><div className="font-medium">{l.name}</div><div className="num text-xs text-muted-foreground">{l.phone}</div></div><span className="num text-xs font-semibold text-primary">{formatTime(f.dueAt)}</span>
              </Link>); })}
          </Widget>
          <Widget title="Proposal stage" count={d.proposals.length}>
            {d.proposals.length === 0 ? <p className="text-sm text-muted-foreground">No leads in Proposal Sent.</p> : d.proposals.map((l) => {
              const next = followUps.find((f) => f.leadId === l.id && !f.completedAt);
              return <Link key={l.id} to="/leads/$id" params={{ id: l.id }} className="flex items-center justify-between rounded-lg p-2 text-sm hover:bg-muted"><div><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{next ? `Next: ${formatDateTime(next.dueAt)}` : "No follow-up scheduled"}</div></div><span className="num text-xs font-semibold">{formatINRCompact(l.quotedAmount ?? 0)}</span></Link>;
            })}
          </Widget>
          <Widget title="Payments to chase" count={d.chase.length}>
            {d.chase.length === 0 ? <p className="text-sm text-muted-foreground">Every deal is fully paid.</p> : d.chase.map(({ deal, due, overdue }) => (
              <Link key={deal.id} to="/deals" className="flex items-center justify-between rounded-lg p-2 text-sm hover:bg-muted">
                <div><div className="font-medium">{deal.clientName}</div><div className="text-xs text-muted-foreground">{deal.name} · {deal.clientType === "crm" ? "CRM" : "Other client"}</div></div>
                <div className="num text-right"><div className="text-xs font-semibold">{formatINRCompact(due)}</div>{overdue && <div className="text-[10px] font-bold text-destructive uppercase">Overdue</div>}</div>
              </Link>
            ))}
          </Widget>
        </div>
      </div>
      {fuLead && <FollowUpDialog open onOpenChange={(o) => !o && setFuLead(null)} leadId={fuLead} />}
    </Shell>
  );
}

function Widget({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="surface p-4"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{count}</span></div><div className="grid gap-0.5">{children}</div></section>;
}
