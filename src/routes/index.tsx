import { isPending } from "@/lib/crm/followups";
import { CallButton } from "@/components/crm/CallButton";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Plus, Check, Sunrise, AlarmClock, CalendarClock, Flame, Wallet, MessageCircle, NotebookPen, CalendarSync, Hourglass } from "lucide-react";
import { Shell, Empty, PriorityBadge } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { Button } from "@/components/ui/button";
import { useCRM } from "@/lib/crm/store";
import { financeSummary, dealOutstanding, dealPaymentStatus } from "@/lib/crm/finance";
import { formatINRCompact, formatINR, formatPct, formatTime, greeting, dayKey, formatDate, relative, digits } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const DESC = "Today's calls, priority leads, pipeline and collections in one actionable sales command center.";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    { title: "Command Center · Scale Flow Sales OS" }, { name: "description", content: DESC },
    { property: "og:title", content: "Command Center · Scale Flow Sales OS" }, { property: "og:description", content: DESC },
  ] }), component: Dashboard,
});

/** Animates a number toward its target; instant when the user prefers reduced motion. */
function useCountUp(target: number, ms = 600) {
  const [v, setV] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); from.current = target; return; }
    const start = performance.now(), a = from.current; let raf = 0;
    const tick = (t: number) => { const p = Math.min((t - start) / ms, 1), e = 1 - Math.pow(1 - p, 3); setV(a + (target - a) * e); if (p < 1) raf = requestAnimationFrame(tick); else from.current = target; };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function Num({ value, money }: { value: number; money?: boolean }) {
  const v = useCountUp(value);
  return <span title={money ? formatINR(value) : undefined}>{money ? formatINRCompact(Math.round(v)) : Math.round(v)}</span>;
}

type Task = { key: string; kind: "overdue" | "today" | "hot" | "money"; leadId?: string; title: string; detail: string; when: string; followUpId?: string; phone?: string; amount?: number };
const TABS = [["all", "All"], ["overdue", "Overdue"], ["today", "Today"], ["hot", "Hot leads"], ["money", "Collections"]] as const;
const KIND_ICON = { overdue: AlarmClock, today: CalendarClock, hot: Flame, money: Wallet };

function Dashboard() {
  const { leads, deals, payments, followUps, owner, activities, completeFollowUp } = useCRM();
  const [add, setAdd] = useState(false), [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [resched, setResched] = useState<{ leadId: string; id: string } | null>(null);
  const now = Date.now(), today = dayKey(new Date());
  const fin = financeSummary(deals, payments);
  const lead = (id: string) => leads.find((l) => l.id === id);
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
  const pending = followUps.filter(isPending).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  // Overdue = scheduled time already passed (IST-agnostic absolute time); Today = later today in India time.
  const overdue = pending.filter((f) => new Date(f.dueAt).getTime() < now);
  const dueToday = pending.filter((f) => new Date(f.dueAt).getTime() >= now && dayKey(f.dueAt) === today);
  const hot = open.filter((l) => l.priority === "hot").sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
  const dueDeals = deals.filter((d) => ["overdue", "partial", "unpaid"].includes(dealPaymentStatus(d, payments))).sort((a, b) => dealOutstanding(b, payments) - dealOutstanding(a, payments));
  const pipelineValue = open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0);
  const stage = LEAD_STATUSES.map((s) => { const c = leads.filter((l) => l.status === s); return { s, name: STATUS_LABEL[s], count: c.length, value: c.reduce((a, l) => a + (l.quotedAmount ?? 0), 0) }; });
  const maxStage = Math.max(1, ...stage.map((s) => s.count));
  const openStages = stage.filter((s) => !["won", "lost"].includes(s.s));
  const bottleneck = openStages.reduce((a, b) => (b.count > a.count ? b : a), openStages[0]!);
  const won = stage.find((s) => s.s === "won")!.count, closed = won + stage.find((s) => s.s === "lost")!.count;
  const next7 = Array.from({ length: 7 }, (_, i) => { const k = dayKey(new Date(now + i * 864e5)); return pending.filter((f) => dayKey(f.dueAt) === k).length; });
  const max7 = Math.max(1, ...next7);
  const first = owner.split(" ")[0] ?? owner;

  const tasks: Task[] = [
    ...overdue.map((f): Task => ({ key: f.id, kind: "overdue", leadId: f.leadId, followUpId: f.id, title: lead(f.leadId)?.name ?? "Lead", detail: `${FOLLOWUP_LABEL[f.type]}${f.note ? ` · ${f.note}` : ""}`, when: `Due ${relative(f.dueAt)}`, phone: lead(f.leadId)?.phone })),
    ...dueToday.map((f): Task => ({ key: f.id, kind: "today", leadId: f.leadId, followUpId: f.id, title: lead(f.leadId)?.name ?? "Lead", detail: `${FOLLOWUP_LABEL[f.type]}${f.note ? ` · ${f.note}` : ""}`, when: formatTime(f.dueAt), phone: lead(f.leadId)?.phone })),
    ...hot.filter((l) => !pending.some((f) => f.leadId === l.id && dayKey(f.dueAt) <= today)).slice(0, 4).map((l): Task => ({ key: l.id, kind: "hot", leadId: l.id, title: l.name, detail: `${STATUS_LABEL[l.status]} · ${l.company ?? l.source}`, when: l.lastContact ? `Last touch ${relative(l.lastContact)}` : "Not contacted yet", phone: l.phone })),
    ...dueDeals.slice(0, 4).map((d): Task => ({ key: d.id, kind: "money", title: d.clientName, detail: `${d.name} · ${dealPaymentStatus(d, payments)}`, when: formatINRCompact(dealOutstanding(d, payments)), amount: dealOutstanding(d, payments) })),
  ];
  const counts = { all: tasks.length, overdue: overdue.length, today: dueToday.length, hot: tasks.filter((t) => t.kind === "hot").length, money: tasks.filter((t) => t.kind === "money").length };
  const shown = (tab === "all" ? tasks : tasks.filter((t) => t.kind === tab)).slice(0, 8);

  const prospects = [...open].sort((a, b) => (Number(b.priority === "hot") - Number(a.priority === "hot")) || (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 5);
  const segs = [["Received", fin.collected, "var(--success)"], ["Outstanding (not yet due)", Math.max(fin.outstanding - fin.overdue, 0), "var(--chart-2)"], ["Overdue", fin.overdue, "var(--destructive)"]] as const;
  const segTotal = Math.max(1, segs.reduce((a, s) => a + s[1], 0));

  return <Shell title="Command center" subtitle={formatDate(new Date().toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} actions={<div className="flex gap-2"><Button variant="outline" asChild className="rounded-lg"><Link to="/daily-briefing"><Sunrise />Daily briefing</Link></Button><Button onClick={() => setAdd(true)} className="rounded-lg"><Plus />Add lead</Button></div>}>
    <section className="cc-welcome p-6 sm:p-7">
      <div className="relative z-10 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <div className="muted text-xs font-medium">{greeting()}, {first}</div>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">Your sales, <span className="editorial font-normal italic text-sidebar-primary">in motion.</span></h2>
          <p className="muted mt-2 max-w-xl text-sm leading-relaxed">{overdue.length + dueToday.length > 0 ? `${overdue.length + dueToday.length} follow-ups need you today${overdue.length ? `, ${overdue.length} already overdue` : ""}. ` : "No follow-ups are due today. "}{formatINRCompact(fin.outstanding)} is still to collect across {dueDeals.length} deal{dueDeals.length === 1 ? "" : "s"}.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <span className="cc-chip"><b className="num">{overdue.length}</b> overdue</span>
          <span className="cc-chip"><b className="num">{dueToday.length}</b> due later today</span>
          <span className="cc-chip"><b className="num">{hot.length}</b> hot leads</span>
        </div>
      </div>
    </section>

    <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6" aria-label="Performance overview">
      <Link to="/pipeline" className="kpi col-span-2" data-tone="lime" style={{ animationDelay: "0ms" }}>
        <div className="kpi-label">Open pipeline value<ArrowUpRight className="size-3.5" /></div>
        <div className="kpi-value text-[34px]"><Num value={pipelineValue} money /></div>
        <div className="mt-auto flex items-end justify-between gap-4 pt-3 text-xs"><span>{open.length} active leads · {closed ? formatPct(won / closed) : "—"} win rate</span><div className="spark w-24" aria-hidden>{openStages.map((s) => <span key={s.s} data-on="true" style={{ height: `${(s.count / maxStage) * 100}%` }} />)}</div></div>
      </Link>
      <Link to="/leads" className="kpi" style={{ animationDelay: "40ms" }}><div className="kpi-label">Active leads<ArrowUpRight className="size-3.5" /></div><div className="kpi-value"><Num value={open.length} /></div><div className="mt-1 text-[11px] text-muted-foreground">{hot.length} marked hot</div></Link>
      <Link to="/follow-ups" className="kpi" style={{ animationDelay: "80ms" }}><div className="kpi-label">Follow-ups today<CalendarClock className="size-3.5" /></div><div className="kpi-value"><Num value={dueToday.length + overdue.filter((f) => dayKey(f.dueAt) === today).length} /></div><div className="spark mt-2 text-foreground" aria-label="Pending follow-ups, next 7 days">{next7.map((c, i) => <span key={i} data-on={i === 0 ? "true" : "false"} style={{ height: `${(c / max7) * 100}%`, animationDelay: `${i * 30}ms` }} title={`${c} on day ${i + 1}`} />)}</div></Link>
      <Link to="/follow-ups" className="kpi" data-tone={overdue.length ? "alert" : undefined} style={{ animationDelay: "120ms" }}><div className="kpi-label">Overdue<AlarmClock className={cn("size-3.5", overdue.length && "text-destructive")} /></div><div className={cn("kpi-value", overdue.length && "text-destructive")}><Num value={overdue.length} /></div><div className="mt-1 text-[11px] text-muted-foreground">{overdue[0] ? `Oldest ${relative(overdue[0].dueAt)}` : "Nothing slipping"}</div></Link>
      <Link to="/deals" className="kpi col-span-2 lg:col-span-1" style={{ animationDelay: "160ms" }}><div className="kpi-label">Received<Wallet className="size-3.5" /></div><div className="kpi-value text-success"><Num value={fin.collected} money /></div><div className="mt-1 text-[11px] text-muted-foreground"><span className="num">{formatINRCompact(fin.outstanding)}</span> outstanding</div></Link>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <div className="cc-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
          <div><h3 className="text-base font-semibold">Today's action center</h3><p className="text-xs text-muted-foreground">Ordered by urgency — the next step is on each row</p></div>
          <div className="cc-tabs" role="group" aria-label="Filter actions">{TABS.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}<span className="count">{counts[k]}</span></button>)}</div>
        </div>
        <ul key={tab}>
          {shown.map((t, i) => { const Icon = KIND_ICON[t.kind]; return <li key={`${t.kind}-${t.key}`} className="cc-task" data-urgency={t.kind} style={{ animationDelay: `${i * 30}ms` }}>
            <span className="cc-kind" aria-hidden><Icon /></span>
            <div className="min-w-0">
              {t.leadId ? <Link to="/leads/$id" params={{ id: t.leadId }} className="text-sm font-semibold hover:underline">{t.title}</Link> : <Link to="/deals" className="text-sm font-semibold hover:underline">{t.title}</Link>}
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("num shrink-0 font-medium", t.kind === "overdue" ? "text-destructive" : "text-foreground")}>{t.when}</span><span className="truncate">· {t.detail}</span></div>
            </div>
            <div className="flex items-center gap-1.5">
              {t.leadId && t.phone && <CallButton leadId={t.leadId} phone={t.phone} name={t.title} source="Dashboard" compact />}
              {t.leadId && <button type="button" className="cc-act hidden sm:grid" title="Log call" aria-label={`Log call with ${t.title}`} onClick={() => openCallLog(t.leadId!, "Dashboard")}><NotebookPen /></button>}
              {t.phone && <a className="cc-act hidden sm:grid" href={`https://wa.me/91${digits(t.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label={`WhatsApp ${t.title}`}><MessageCircle /></a>}
              {t.followUpId && <button type="button" className="cc-act" title="Reschedule" aria-label={`Reschedule ${t.title}`} onClick={() => setResched({ leadId: t.leadId!, id: t.followUpId! })}><CalendarSync /></button>}
              {t.followUpId && <button type="button" className="cc-act" title="Complete follow-up" aria-label={`Complete ${t.title}`} onClick={() => { completeFollowUp(t.followUpId!); toast.success("Follow-up completed"); }}><Check /></button>}
              {t.kind === "money" && <Link to="/deals" className="cc-act" title="Open Deals & Payments" aria-label={`Open payments for ${t.title}`}><ArrowUpRight /></Link>}
            </div>
          </li>; })}
          {!shown.length && <li className="border-t"><Empty icon={<Check />} title="Clear runway" hint="Nothing in this list needs you right now." /></li>}
        </ul>
        {tasks.length > shown.length && <div className="border-t px-5 py-3 text-right"><Link to="/follow-ups" className="text-xs font-medium hover:underline">Open full agenda →</Link></div>}
      </div>

      <div className="grid content-start gap-5">
        <div className="cc-card p-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold">Collections</h3><p className="text-xs text-muted-foreground">From recorded deals and payments</p></div><Link to="/deals" className="text-xs font-medium hover:underline">Finance →</Link></div>
          <div className="mt-4 flex items-baseline gap-2"><span className="num text-[30px] leading-none" title={formatINR(fin.totalValue)}>{formatINRCompact(fin.totalValue)}</span><span className="text-xs text-muted-foreground">booked · {formatPct(fin.collectionRate)} collected</span></div>
          <div className="collect-bar mt-4" role="img" aria-label="Collection progress">{segs.filter((s) => s[1] > 0).map(([k, v, c], i) => <div key={k} title={`${k}: ${formatINR(v)}`} style={{ flexGrow: v / segTotal, background: c, animationDelay: `${i * 80}ms` }} />)}</div>
          <dl className="mt-4 grid grid-cols-3 gap-3">{segs.map(([k, v, c]) => <div key={k} title={formatINR(v)}><dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: c }} />{k.split(" ")[0]}</dt><dd className="num mt-1 text-[15px]">{formatINRCompact(v)}</dd></div>)}</dl>
        </div>
        <div className="cc-card p-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold">Pipeline</h3><p className="text-xs text-muted-foreground">{bottleneck.count ? <>Most leads waiting in <b className="font-medium text-foreground">{bottleneck.name}</b></> : "No open leads"}</p></div><Link to="/pipeline" className="text-xs font-medium hover:underline">Board →</Link></div>
          <div className="mt-3 grid gap-0.5">{stage.map((s, i) => <Link key={s.s} to="/pipeline" data-stage={s.s} className="funnel-row" title={`${s.name}: ${s.count} leads · ${formatINR(s.value)}`}><span className="flex items-center gap-2 text-xs"><span className="size-2 rounded-sm bg-[var(--stage)]" />{s.name}</span><span className="funnel-track"><span className="funnel-fill block" style={{ width: `${Math.max((s.count / maxStage) * 100, s.count ? 6 : 0)}%`, animationDelay: `${i * 50}ms` }} /></span><span className="num text-right text-xs"><b className="font-medium">{s.count}</b> <span className="text-muted-foreground">{formatINRCompact(s.value)}</span></span></Link>)}</div>
        </div>
      </div>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <div className="cc-card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3"><div><h3 className="text-base font-semibold">Priority prospects</h3><p className="text-xs text-muted-foreground">Hot and high-score leads first</p></div><Link to="/leads" className="text-xs font-medium hover:underline">All leads →</Link></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="sr-only"><tr><th>Lead</th><th>Stage</th><th>Priority</th><th>Value</th><th>Last</th><th>Next</th><th>Actions</th></tr></thead><tbody>
          {prospects.map((l) => { const nf = pending.find((f) => f.leadId === l.id); return <tr key={l.id} className="border-t transition-colors hover:bg-secondary/60">
            <td className="py-3 pl-5"><Link to="/leads/$id" params={{ id: l.id }} className="block font-medium hover:underline">{l.name}</Link><span className="text-xs text-muted-foreground">{l.company ?? l.source}</span></td>
            <td className="py-3"><span className="stage-chip" data-stage={l.status}><span className="size-1.5 rounded-full bg-[var(--stage)]" />{STATUS_LABEL[l.status]}</span></td>
            <td className="py-3"><PriorityBadge p={l.priority} /></td>
            <td className="num py-3 text-right">{l.quotedAmount ? formatINRCompact(l.quotedAmount) : "—"}</td>
            <td className="py-3 pl-4 text-xs text-muted-foreground">{l.lastContact ? relative(l.lastContact) : "Never"}</td>
            <td className={cn("py-3 text-xs", nf && new Date(nf.dueAt).getTime() < now ? "text-destructive" : "text-muted-foreground")}>{nf ? `${FOLLOWUP_LABEL[nf.type]} · ${relative(nf.dueAt)}` : "No follow-up"}</td>
            <td className="py-3 pr-5"><div className="flex justify-end"><CallButton leadId={l.id} phone={l.phone} name={l.name} source="Dashboard" compact /></div></td>
          </tr>; })}
        </tbody></table></div>
      </div>
      <div className="cc-card p-5">
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Recent activity</h3><Hourglass className="size-4 text-muted-foreground" /></div>
        <ol className="timeline mt-4 grid gap-4">{[...activities].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6).map((a) => <li key={a.id} data-kind={a.type}><div className="flex items-baseline justify-between gap-3"><Link to="/leads/$id" params={{ id: a.leadId }} className="text-sm font-medium hover:underline">{lead(a.leadId)?.name ?? "Lead"}</Link><span className="eyebrow shrink-0">{relative(a.at)}</span></div><p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{a.text}</p></li>)}</ol>
      </div>
    </section>
    <AddLeadDialog open={add} onOpenChange={setAdd} />
    {resched && <FollowUpDialog open onOpenChange={(o) => !o && setResched(null)} leadId={resched.leadId} rescheduleId={resched.id} />}
  </Shell>;
}
