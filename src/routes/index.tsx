import { isPending } from "@/lib/crm/followups";
import { CallButton } from "@/components/crm/CallButton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Plus, Check, Sunrise } from "lucide-react";
import { Shell, Empty } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { Button } from "@/components/ui/button";
import { useCRM } from "@/lib/crm/store";
import { financeSummary, dealOutstanding, dealPaymentStatus } from "@/lib/crm/finance";
import { formatINRCompact, formatPct, formatTime, greeting, dayKey, formatDate, relative } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const DESC = "Today's calls, priority leads, sales momentum and revenue in one command center.";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    { title: "Command Center · Scale Flow Sales OS" }, { name: "description", content: DESC },
    { property: "og:title", content: "Command Center · Scale Flow Sales OS" }, { property: "og:description", content: DESC },
  ] }), component: Dashboard,
});

function Dashboard() {
  const { leads, deals, payments, followUps, owner, activities, completeFollowUp } = useCRM();
  const [add, setAdd] = useState(false);
  const fin = financeSummary(deals, payments), today = dayKey(new Date());
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
  const pending = followUps.filter((f) => isPending(f)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdue = pending.filter((f) => dayKey(f.dueAt) < today), dueToday = pending.filter((f) => dayKey(f.dueAt) === today);
  const hot = [...open].sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 4);
  const quiet = open.filter((l) => !l.nextFollowUp && l.lastContact && Date.now() - new Date(l.lastContact).getTime() > 5 * 864e5).slice(0, 3);
  const dueDeals = deals.filter((d) => ["overdue", "partial", "unpaid"].includes(dealPaymentStatus(d, payments))).sort((a, b) => dealOutstanding(b, payments) - dealOutstanding(a, payments)).slice(0, 3);
  const stage = LEAD_STATUSES.map((s) => { const c = leads.filter((l) => l.status === s); return { s, name: STATUS_LABEL[s], count: c.length, value: c.reduce((a, l) => a + (l.quotedAmount ?? 0), 0) }; });
  const won = leads.filter((l) => l.status === "won").length, closed = won + leads.filter((l) => l.status === "lost").length;
  const first = owner.split(" ")[0] ?? owner;
  const lead = (id: string) => leads.find((l) => l.id === id);
  const kpis: [string, string, "/leads" | "/follow-ups" | "/pipeline"][] = [
    ["Active leads", String(open.length), "/leads"], ["Overdue", String(overdue.length), "/follow-ups"],
    ["Open pipeline", formatINRCompact(open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0)), "/pipeline"], ["Won clients", String(won), "/pipeline"],
  ];
  return <Shell title={`${greeting()}, ${first}.`} subtitle={formatDate(new Date().toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} actions={<div className="flex gap-2"><Button variant="outline" asChild className="rounded-full"><Link to="/daily-briefing"><Sunrise />Daily briefing</Link></Button><Button onClick={() => setAdd(true)} className="rounded-full"><Plus />Add lead</Button></div>}>
    <section className="cc-hero grid gap-8 border-t border-foreground pt-8 lg:grid-cols-[1.35fr_1fr]">
      <h2 className="text-[34px] sm:text-[46px] lg:text-[56px]">You have <span className="rounded-lg bg-lime px-2 text-lime-foreground">{overdue.length + dueToday.length} conversations</span> waiting today, <em>and {formatINRCompact(fin.outstanding)} still to collect.</em></h2>
      <div className="grid grid-cols-2 content-end gap-x-6 gap-y-5">
        {kpis.map(([k, v, to]) => <Link key={k} to={to} className="group border-t pt-3"><div className="eyebrow flex items-center justify-between">{k}<ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></div><div className="num mt-1.5 text-3xl">{v}</div></Link>)}
      </div>
    </section>

    <section className="mt-12 grid gap-10 xl:grid-cols-[1.5fr_1fr]">
      <div>
        <div className="mb-2 flex items-end justify-between"><div><div className="eyebrow">Action center</div><h3 className="editorial mt-1 text-3xl">Today, in order</h3></div><Link to="/follow-ups" className="text-xs font-medium underline-offset-4 hover:underline">Full agenda →</Link></div>
        <ol className="border-t border-foreground">
          {[...overdue, ...dueToday].slice(0, 6).map((f, i) => { const l = lead(f.leadId); const late = dayKey(f.dueAt) < today; return <li key={f.id} className="cc-action"><span className="cc-rank">{String(i + 1).padStart(2, "0")}</span><div className="min-w-0"><Link to="/leads/$id" params={{ id: f.leadId }} className="text-sm font-semibold hover:underline">{l?.name ?? "Lead"}</Link><div className="mt-0.5 truncate text-xs text-muted-foreground"><span className={cn("mr-1.5 font-medium", late ? "text-destructive" : "text-foreground")}>{late ? "Overdue" : formatTime(f.dueAt)}</span>{FOLLOWUP_LABEL[f.type]}{f.note ? ` · ${f.note}` : ""}</div></div><div className="flex items-center gap-1.5">{l && <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Dashboard" compact />}<Button variant="outline" size="icon" className="size-8 rounded-full" title="Complete follow-up" aria-label={`Complete ${l?.name ?? "follow-up"}`} onClick={() => { completeFollowUp(f.id); toast.success("Follow-up completed"); }}><Check className="size-4" /></Button></div></li>; })}
          {!overdue.length && !dueToday.length && <li className="py-6"><Empty icon={<Check />} title="Nothing due — clear runway" /></li>}
        </ol>
      </div>
      <div className="grid content-start gap-8">
        <div><div className="eyebrow mb-2">Priority leads</div><ul className="border-t border-foreground">{hot.map((l) => <li key={l.id} data-priority={l.priority} className="flex items-center justify-between gap-3 border-b py-3"><Link to="/leads/$id" params={{ id: l.id }} className="flex min-w-0 items-center gap-3"><span className="prio-dot shrink-0" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{l.name}</span><span className="block truncate text-xs text-muted-foreground">{l.company ?? l.source}</span></span></Link><span className="flex items-center gap-2"><span className="num text-sm">{formatINRCompact(l.quotedAmount ?? 0)}</span><CallButton leadId={l.id} phone={l.phone} name={l.name} source="Dashboard" compact /></span></li>)}</ul></div>
        <div><div className="eyebrow mb-2">Clients awaiting attention</div><ul className="border-t border-foreground">{quiet.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 border-b py-3 text-sm"><Link to="/leads/$id" params={{ id: l.id }} className="hover:underline">{l.name}</Link><span className="text-xs text-muted-foreground">quiet since {relative(l.lastContact)}</span></li>)}{!quiet.length && <li className="py-3 text-xs text-muted-foreground">No quiet clients right now.</li>}</ul></div>
        <div><div className="eyebrow mb-2">Payments to chase</div><ul className="border-t border-foreground">{dueDeals.map((d) => { const st = dealPaymentStatus(d, payments); return <li key={d.id}><Link to="/deals" className="flex items-center justify-between gap-2 border-b py-3 text-sm"><span className="min-w-0"><span className="block truncate font-medium">{d.clientName}</span><span className={cn("block truncate text-xs capitalize", st === "overdue" ? "text-destructive" : "text-muted-foreground")}>{st} · {d.name}</span></span><span className="num">{formatINRCompact(dealOutstanding(d, payments))}</span></Link></li>; })}{!dueDeals.length && <li className="py-3 text-xs text-muted-foreground">Every balance is settled.</li>}</ul></div>
      </div>
    </section>

    <section className="mt-12 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <div className="panel p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="eyebrow">Sales momentum</div><h3 className="editorial mt-1 text-3xl">Where every lead stands</h3></div><div className="text-right"><div className="eyebrow">Win rate (closed)</div><div className="num text-2xl">{closed ? formatPct(won / closed) : "—"}</div></div></div>
        <div className="momentum-bar mt-7" role="img" aria-label="Leads by stage">{stage.filter((s) => s.count).map((s, i) => <div key={s.s} data-stage={s.s} title={`${s.name}: ${s.count}`} style={{ flexGrow: s.count, animationDelay: `${i * 40}ms` }} />)}</div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">{stage.map((s) => <Link key={s.s} to="/pipeline" data-stage={s.s} className="group border-t pt-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-sm bg-[var(--stage)]" />{s.name}</div><div className="num mt-1 text-xl group-hover:underline">{s.count}</div><div className="num text-[11px] text-muted-foreground">{formatINRCompact(s.value)}</div></Link>)}</div>
      </div>
      <div className="panel-ink flex flex-col p-6 sm:p-8">
        <div className="eyebrow">Revenue overview</div>
        <div className="num mt-4 text-[44px] leading-none">{formatINRCompact(fin.totalValue)}</div><div className="mt-1 text-xs opacity-70">booked across active deals · {formatPct(fin.collectionRate)} collected</div>
        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--hero-foreground)_14%,transparent)]"><div className="h-full rounded-full bg-lime" style={{ width: `${Math.min((fin.collectionRate ?? 0) * 100, 100)}%` }} /></div>
        <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">{([["Received", fin.collected], ["Outstanding", fin.outstanding], ["Overdue", fin.overdue]] as const).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-1 text-lg">{formatINRCompact(v)}</dd></div>)}</dl>
        <Button asChild variant="secondary" className="mt-8 self-start rounded-full"><Link to="/deals">Open Finance Studio<ArrowUpRight /></Link></Button>
      </div>
    </section>

    <section className="mt-12"><div className="mb-4"><div className="eyebrow">Recent activity</div><h3 className="editorial mt-1 text-3xl">What moved</h3></div>
      <ol className="timeline grid gap-x-10 gap-y-5 border-t border-foreground pt-6 md:grid-cols-2">{[...activities].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((a) => <li key={a.id} data-kind={a.type}><div className="flex items-baseline justify-between gap-3"><Link to="/leads/$id" params={{ id: a.leadId }} className="text-sm font-medium hover:underline">{lead(a.leadId)?.name ?? "Lead"}</Link><span className="eyebrow shrink-0">{relative(a.at)}</span></div><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.text}</p></li>)}</ol>
    </section>
    <AddLeadDialog open={add} onOpenChange={setAdd} />
  </Shell>;
}
