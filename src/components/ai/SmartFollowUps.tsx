import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { FlaskConical, ChevronDown, Info, Sparkles, CalendarPlus, CalendarSync, ArrowUpRight } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { formatDateTime } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, type FollowUp } from "@/lib/crm/types";
import { CallButton } from "@/components/crm/CallButton";
import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getSmartFollowUpProvider, GROUP_LABEL, GROUP_ORDER, NEXT_LABEL, type SmartGroup, type SmartRec } from "@/lib/ai/smartFollowups";

const ATT: Record<SmartRec["attention"], string> = { high: "High attention", medium: "Medium attention", low: "Low attention" };
const SHOW = 5;

/** Read-only Demo Analysis. Every button opens an existing CRM screen or form; nothing is saved here. */
export function SmartFollowUps({ onSchedule, onReschedule }: { onSchedule: (leadId: string) => void; onReschedule: (f: FollowUp) => void }) {
  const src = useCRM(useShallow((s) => ({ leads: s.leads, followUps: s.followUps, activities: s.activities })));
  const { can } = useAccess();
  const res = useMemo(() => getSmartFollowUpProvider().analyse({ ...src, now: new Date().toISOString() }), [src]);
  const [open, setOpen] = useState<Record<SmartGroup, boolean>>({ overdue: true, today: true, proposal: true, missing: false, upcoming: false });
  const [all, setAll] = useState<Partial<Record<SmartGroup, boolean>>>({});
  const phone = (id: string) => src.leads.find((l) => l.id === id)?.phone ?? "";
  const s = res.summary;

  return (
    <section className="surface mb-6 grid gap-4 p-4" aria-labelledby="smart-fu-h" data-testid="smart-fu">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="smart-fu-h" className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4 text-primary" />Smart Follow-up Priorities</h2>
        <span className="eyebrow flex items-center gap-1.5" data-testid="smart-label"><FlaskConical className="size-3" />{res.label}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="smart-summary">
        {([["Overdue", s.overdue, "overdue"], ["Due today", s.dueToday, "today"], ["Completed today", s.completedToday, "done"], ["Leads needing attention", s.leadsNeedingAttention, "leads"]] as const).map(([k, v, id]) => (
          <div key={k} className="rounded-xl border px-3 py-2" data-k={id}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="num text-xl font-semibold">{v}</dd></div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground">Counts come straight from your follow-up records (India time). Each lead appears once, in the group of its next follow-up.</p>
      {GROUP_ORDER.map((g) => {
        const items = res.recs.filter((r) => r.group === g);
        const shown = all[g] ? items : items.slice(0, SHOW);
        return (
          <div key={g} className="rounded-xl border" data-group={g}>
            <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold" aria-expanded={open[g]} onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}>
              <span>{GROUP_LABEL[g]} <span className="num ml-1 text-muted-foreground" data-testid={`count-${g}`}>{items.length}</span></span><ChevronDown className={cn("size-4 transition-transform", open[g] && "rotate-180")} />
            </button>
            {open[g] && <div className="grid gap-2 border-t p-2">
              {items.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">Nothing here.</p>}
              {shown.map((r) => (
                <article key={r.leadId} className="grid gap-1.5 rounded-lg bg-muted/30 p-2.5 text-sm" data-lead={r.leadId} data-attention={r.attention}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2"><Link to="/leads/$id" params={{ id: r.leadId }} className="font-semibold hover:underline">{r.name}</Link><span className="stage-chip">{r.stage}</span>{r.afterSales && <span className="text-[11px] text-muted-foreground">After-sales</span>}</div>
                    <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold">{ATT[r.attention]}</span>
                  </div>
                  <p className="text-xs" data-testid="reason">{r.reason}</p>
                  {r.insufficient && <p className="flex items-start gap-1 text-[11px] text-muted-foreground"><Info className="mt-0.5 size-3 shrink-0" />Not enough recorded to judge interest — this is a limitation, not a signal.</p>}
                  <dl className="grid gap-x-3 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <div><dt className="inline">Latest activity: </dt><dd className="inline">{r.latestActivity ? `${r.latestActivity.text.slice(0, 80)} · ${formatDateTime(r.latestActivity.at)}` : "Not recorded"}</dd></div>
                    <div><dt className="inline">Follow-up: </dt><dd className="inline">{r.followUp ? `${FOLLOWUP_LABEL[r.followUp.type]} · ${formatDateTime(r.followUp.dueAt)}${r.followUp.note ? ` · “${r.followUp.note.slice(0, 60)}”` : ""}` : "None booked"}</dd></div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-semibold">Next: {NEXT_LABEL[r.next]}</span>
                    {phone(r.leadId) && <CallButton leadId={r.leadId} phone={phone(r.leadId)} name={r.name} source="Smart Follow-ups" />}
                    {r.followUp && can("followups.create") && <Button size="sm" variant="outline" className="rounded-full" onClick={() => { const f = src.followUps.find((x) => x.id === r.followUp!.id); if (f) onReschedule(f); }}><CalendarSync className="size-3.5" />Reschedule</Button>}
                    {!r.followUp && can("followups.create") && <Button size="sm" variant="outline" className="rounded-full" onClick={() => onSchedule(r.leadId)}><CalendarPlus className="size-3.5" />Schedule follow-up</Button>}
                    <WhatsAppButton leadId={r.leadId} name={r.name} source="Smart Follow-ups" label />
                    <Button size="sm" variant="ghost" className="rounded-full" asChild><Link to="/ai-copilot" search={{ lead: r.leadId }}><Sparkles className="size-3.5" />Lead Intelligence</Link></Button>
                    <Button size="sm" variant="ghost" className="rounded-full" asChild><Link to="/leads/$id" params={{ id: r.leadId }}><ArrowUpRight className="size-3.5" />Open lead</Link></Button>
                  </div>
                </article>
              ))}
              {items.length > SHOW && <Button size="sm" variant="ghost" className="w-fit" onClick={() => setAll((a) => ({ ...a, [g]: !a[g] }))}>{all[g] ? "Show fewer" : `Show all ${items.length}`}</Button>}
            </div>}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Nothing is called, sent, completed or saved from here — only the forms that open save, when you confirm.</p>
    </section>
  );
}
