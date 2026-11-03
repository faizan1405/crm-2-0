import { followUpBucket, isPending, activeFollowUp } from "@/lib/crm/followups";
import { runFollowUp, runVoid } from "@/components/crm/conflictFeedback";
import { SmartFollowUps } from "@/components/ai/SmartFollowUps";
import { RemindersPanel } from "@/components/automation/RemindersPanel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, CalendarClock, CheckCircle2, AlertCircle, Flame, NotebookPen, CalendarSync, SunMedium, PanelRightOpen, ArrowUpRight, Sparkles, ListTodo, Clock } from "lucide-react";
import { Shell, Empty, PriorityBadge } from "@/components/crm/Shell";
import { SuggestionList } from "@/components/crm/Suggestions";
import { CallButton } from "@/components/crm/CallButton";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { useAccess } from "@/lib/crm/session";
import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatDateTime, formatINR } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, STATUS_LABEL, type FollowUp, type Lead } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";

export const Route = createFileRoute("/follow-ups")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Follow-ups · Scale Flow CRM" },
      { name: "description", content: "Your sales agenda: overdue, today and upcoming follow-ups with one-tap actions." },
      { property: "og:title", content: "Follow-ups · Scale Flow CRM" },
      { property: "og:description", content: "Your sales agenda: overdue, today and upcoming follow-ups with one-tap actions." },
    ],
  }),
  component: FollowUps,
});

type Tab = "overdue" | "today" | "upcoming" | "done";
const TABS: [Tab, string][] = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["done", "History"]];
/** Same time of day, one day later — the follow-up's own scheduled time is the configured time. */
const tomorrowSameTime = (iso: string) => new Date(new Date(iso).getTime() + 86_400_000).toISOString();
const timeOnly = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function FollowUps() {
  const { followUps, leads, deals, activities, completeFollowUp, rescheduleFollowUp } = useCRM();
  const [tab, setTab] = useState<Tab>("today");
  const [add, setAdd] = useState(false);
  const [addFor, setAddFor] = useState<string | null>(null);
  const { can } = useAccess();
  const [resched, setResched] = useState<FollowUp | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = new Date();
  const lead = (id: string) => leads.find((l) => l.id === id);
  const counts = { overdue: 0, today: 0, upcoming: 0, done: 0 };
  followUps.forEach((f) => counts[followUpBucket(f, now)]++);
  const hot = followUps.filter((f) => isPending(f) && lead(f.leadId)?.priority === "hot").length;
  const list = followUps.filter((f) => followUpBucket(f, now) === tab).sort((a, b) => (tab === "done" ? (b.completedAt ?? b.cancelledAt ?? b.dueAt).localeCompare(a.completedAt ?? a.cancelledAt ?? a.dueAt) : a.dueAt.localeCompare(b.dueAt)));
  // Guard against rapid double taps creating repeated changes.
  const once = (id: string, fn: () => void) => { if (busy === id) return; setBusy(id); fn(); setTimeout(() => setBusy(null), 400); };

  return (
    <Shell title="Follow-ups" subtitle={`${counts.overdue + counts.today} need attention today · India time (IST)`} actions={can("followups.create") ? <Button onClick={() => setAdd(true)}><Plus className="size-4" />Schedule</Button> : undefined}>
      <RemindersPanel />
      <SmartFollowUps onSchedule={setAddFor} onReschedule={setResched} />
      <div className="fu-overview mb-6">
        {([["Pending", counts.overdue + counts.today + counts.upcoming, ListTodo, "upcoming"], ["Overdue", counts.overdue, AlertCircle, "overdue"], ["Left today", counts.today, Clock, "today"], ["Hot clients", hot, Flame, "today"]] as const).map(([label, n, Icon, t]) => (
          <button type="button" key={label} onClick={() => setTab(t)} className="fu-metric" data-tone={label === "Overdue" && n ? "danger" : label === "Hot clients" && n ? "hot" : undefined}><Icon className="size-4" /><span className="num text-2xl font-semibold">{n}</span><span className="text-xs text-muted-foreground">{label}</span></button>
        ))}
      </div>

      <div role="tablist" aria-label="Follow-up views" onKeyDown={onRovingKeyDown} className="fu-tabs mb-4">
        {TABS.map(([t, label]) => <button key={t} role="tab" type="button" aria-selected={tab === t} tabIndex={roving(tab === t)} onClick={() => setTab(t)} className="fu-tab">{label}<span className={cn("num fu-count", t === "overdue" && counts.overdue && "is-danger")}>{counts[t]}</span></button>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div key={tab} className="grid content-start gap-3">
          {list.map((f, i) => {
            const l = lead(f.leadId); const b = followUpBucket(f, now); const deal = deals.find((d) => d.leadId === f.leadId && d.status !== "cancelled");
            return (
              <article key={f.id} className="fu-card" data-bucket={b} data-priority={l?.priority} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => l && setInspect(l.id)} aria-label={`View ${l?.name ?? "client"}`}>
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-semibold hover:underline">{l?.name ?? "Deleted lead"}</span>{l && <PriorityBadge p={l.priority} />}{l && <span className="stage-chip" data-stage={l.status}>{STATUS_LABEL[l.status]}</span>}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{l?.company ?? "Independent"}{l && <> · <span className="num">{l.phone}</span></>}{(deal?.name || l?.requirement) && <> · {deal?.name ?? l?.requirement}</>}</div>
                  </button>
                  <div className="fu-when" data-bucket={b}><span className="fu-type">{FOLLOWUP_LABEL[f.type]}</span><span className="num">{formatDateTime(f.completedAt ?? f.cancelledAt ?? f.dueAt)}</span>{b === "overdue" && <span className="fu-flag">Overdue</span>}{f.cancelledAt && <span className="fu-flag is-muted">Replaced</span>}{f.completedAt && <span className="fu-flag is-done">Done</span>}</div>
                </div>
                {f.note && <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{f.note}</p>}
                {isPending(f) && l && (
                  <div className="fu-actions">
                    <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Follow-ups" />
                    {can("clients.calls") && <Button size="sm" variant="outline" className="rounded-full" onClick={() => openCallLog(l.id, "Follow-ups")}><NotebookPen className="size-3.5" />Log call</Button>}
                    <WhatsAppButton leadId={l.id} name={l.name} source="Follow-ups" label />
                    <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setResched(f)}><CalendarSync className="size-3.5" />Reschedule</Button>
                    <Button size="sm" variant="ghost" className="rounded-full" disabled={busy === f.id} onClick={() => once(f.id, () => { runFollowUp(() => rescheduleFollowUp(f.id, tomorrowSameTime(f.dueAt), f.dueAt), `Moved to tomorrow, ${timeOnly(f.dueAt)}`); })}><SunMedium className="size-3.5" />Tomorrow {timeOnly(f.dueAt)}</Button>
                    <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setInspect(l.id)}><PanelRightOpen className="size-3.5" />View</Button>
                    <Button size="sm" className="ml-auto rounded-full" disabled={busy === f.id} onClick={() => once(f.id, () => { runFollowUp(() => completeFollowUp(f.id, f.dueAt)); })}><Check className="size-3.5" />Complete</Button>
                  </div>
                )}
              </article>
            );
          })}
          {list.length === 0 && <div className="surface"><Empty icon={tab === "done" ? <CheckCircle2 /> : <CalendarClock />} title={tab === "done" ? "No history yet" : tab === "overdue" ? "Nothing overdue" : "Nothing here"} hint={tab === "overdue" ? "You're on top of everything." : "Schedule a follow-up to keep deals moving."} /></div>}
        </div>
        <aside className="fu-side surface h-fit p-5"><h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Suggested next actions</h2><p className="mb-3 text-xs text-muted-foreground">From stage, quick status, last call and dates. Nothing saves until you review the time.</p><SuggestionList limit={4} /></aside>
      </div>

      <FollowUpDialog open={add} onOpenChange={setAdd} />
      {addFor && <FollowUpDialog open onOpenChange={(o) => !o && setAddFor(null)} leadId={addFor} />}
      {resched && <FollowUpDialog open onOpenChange={(o) => !o && setResched(null)} leadId={resched.leadId} rescheduleId={resched.id} initial={{ type: resched.type, at: new Date(new Date(resched.dueAt).getTime() + 330 * 60_000).toISOString().slice(0, 16), ...(resched.note ? { note: resched.note } : {}) }} />}
      <Inspector lead={inspect ? lead(inspect) : undefined} onClose={() => setInspect(null)} followUps={followUps} deals={deals} activities={activities} onReschedule={setResched} />
    </Shell>
  );
}

function Inspector({ lead: l, onClose, followUps, deals, activities, onReschedule }: { lead: Lead | undefined; onClose: () => void; followUps: FollowUp[]; deals: ReturnType<typeof useCRM.getState>["deals"]; activities: ReturnType<typeof useCRM.getState>["activities"]; onReschedule: (f: FollowUp) => void }) {
  const recent = useMemo(() => (l ? activities.filter((a) => a.leadId === l.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4) : []), [activities, l]);
  const active = l ? activeFollowUp(followUps, l.id) : undefined;
  const deal = l ? deals.find((d) => d.leadId === l.id && d.status !== "cancelled") : undefined;
  return (
    <Sheet open={!!l} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="fu-inspector w-full overflow-y-auto sm:max-w-md">
        {l && <>
          <SheetHeader className="text-left"><span className="eyebrow">Client</span><SheetTitle className="editorial text-3xl">{l.name}</SheetTitle><SheetDescription>{l.company ?? "Independent"} · <span className="num">{l.phone}</span></SheetDescription></SheetHeader>
          <div className="mt-2 flex flex-wrap gap-1.5 px-4"><span className="stage-chip" data-stage={l.status}>{STATUS_LABEL[l.status]}</span><PriorityBadge p={l.priority} /><span className="aging">{l.source}</span></div>
          <div className="mt-4 flex flex-wrap gap-2 px-4"><CallButton leadId={l.id} phone={l.phone} name={l.name} source="Follow-up inspector" /><Button size="sm" variant="outline" className="rounded-full" onClick={() => openCallLog(l.id, "Follow-up inspector")}><NotebookPen className="size-3.5" />Log call</Button><WhatsAppButton leadId={l.id} name={l.name} source="Follow-up inspector" label /></div>
          <dl className="fu-facts mx-4 mt-5">
            <div><dt>Project</dt><dd>{deal?.name ?? l.requirement ?? "Not recorded"}</dd></div>
            <div><dt>{deal ? "Deal value" : l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num">{formatINR(deal?.finalAmount ?? l.quotedAmount ?? l.budget)}</dd></div>
            <div><dt>Last contact</dt><dd className="num">{l.lastContact ? formatDateTime(l.lastContact) : "Never"}</dd></div>
          </dl>
          <section className="mx-4 mt-5"><h3 className="eyebrow mb-2">Active follow-up</h3>{active ? <div className="rounded-lg border p-3 text-sm"><div className="font-semibold">{FOLLOWUP_LABEL[active.type]} · <span className="num">{formatDateTime(active.dueAt)}</span></div>{active.note && <p className="mt-1 text-xs text-muted-foreground">{active.note}</p>}<Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => onReschedule(active)}><CalendarSync className="size-3.5" />Reschedule</Button></div> : <p className="text-xs text-muted-foreground">None planned.</p>}</section>
          {l.notes && <section className="mx-4 mt-5"><h3 className="eyebrow mb-2">Notes</h3><p className="text-sm leading-relaxed whitespace-pre-line">{l.notes}</p></section>}
          <section className="mx-4 mt-5"><h3 className="eyebrow mb-2">Recent activity</h3>{recent.length ? <ol className="grid gap-2">{recent.map((a) => <li key={a.id} className="border-l-2 pl-3 text-xs"><div className="text-foreground">{a.text}</div><div className="num text-muted-foreground">{formatDateTime(a.at)}</div></li>)}</ol> : <p className="text-xs text-muted-foreground">No activity yet.</p>}</section>
          <div className="m-4 mt-6"><Button asChild variant="outline" className="w-full"><Link to="/leads/$id" params={{ id: l.id }}>Open full record<ArrowUpRight className="size-4" /></Link></Button></div>
        </>}
      </SheetContent>
    </Sheet>
  );
}
