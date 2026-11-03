import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Copy, FlaskConical, Database, BookOpen, Info, MessageSquareQuote, ListChecks, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";
import type { LeadContext } from "@/lib/ai/types";
import {
  getCoachProvider, OBJECTIONS, SOURCE_LABEL, THEME_LABEL, NOT_RECORDED,
  type CallPrep, type ObjectionCoaching, type ObjectionId, type ResponseReview, type AfterCallSuggestion, type ContentSource,
} from "@/lib/ai/coach";

const copy = async (text: string, what = "Copied") => {
  try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.error("Couldn't copy — select the text and copy it manually."); }
};
const SrcTag = ({ s }: { s: ContentSource }) => {
  const Icon = s === "crm" ? Database : s === "demo_rules" ? FlaskConical : BookOpen;
  return <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground" data-source={s}><Icon className="size-3" />{SOURCE_LABEL[s]}</span>;
};
const CopyBtn = ({ text, label }: { text: string; label: string }) => (
  <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2" aria-label={label} onClick={() => void copy(text)}><Copy className="size-3.5" /></Button>
);

/** Read-only Owner Sales Coach. Buttons only open existing forms; nothing is saved, called or sent. */
export function SalesCoachPanel({ lead, canFollowUp, onFollowUp }: { lead: LeadContext; canFollowUp: boolean; onFollowUp: () => void }) {
  const provider = getCoachProvider();
  const prep = useMemo(() => provider.run({ kind: "call_prep", lead }) as CallPrep, [provider, lead]);
  const [obj, setObj] = useState<ObjectionId>("price");
  const coaching = provider.run({ kind: "objection", lead, objection: obj }) as ObjectionCoaching;
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState<ResponseReview | null>(null);
  const [summary, setSummary] = useState("");
  const [next, setNext] = useState<AfterCallSuggestion | null>(null);
  const grouped = Object.entries(THEME_LABEL).map(([k, label]) => ({ label, items: prep.questions.filter((q) => q.theme === k) })).filter((g) => g.items.length);

  const nextAction = (n: AfterCallSuggestion) => {
    if (n.kind === "schedule_followup" && canFollowUp) return <Button size="sm" onClick={onFollowUp}>Open follow-up form</Button>;
    if (n.kind === "send_whatsapp") return <Button size="sm" onClick={() => openWhatsApp(lead.leadId, "AI Sales Coach")}>Open message composer</Button>;
    if (n.kind === "prepare_quotation") return <Button size="sm" variant="outline" asChild><Link to="/sales-studio">Open Sales Studio</Link></Button>;
    if (n.kind === "ask_requirements") return <Button size="sm" variant="outline" asChild><Link to="/leads/$id" params={{ id: lead.leadId }}>Open lead</Link></Button>;
    if (n.kind === "review_objection") return <Button size="sm" variant="outline" onClick={() => document.getElementById("coach-objections")?.scrollIntoView({ block: "start" })}>Go to Objection Coach</Button>;
    return null;
  };

  return (
    <div className="grid gap-5" data-testid="sales-coach">
      <section className="surface grid gap-4 p-4" aria-labelledby="coach-prep-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="coach-prep-h" className="text-base font-semibold">Call preparation · {lead.name}</h2>
          <Button size="sm" variant="ghost" asChild><Link to="/leads/$id" params={{ id: lead.leadId }}>Back to lead</Link></Button>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2"><span className="eyebrow">CRM facts</span><SrcTag s="crm" /></div>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2" data-testid="coach-facts">{prep.facts.map((f) => (
            <div key={f.label} className="flex justify-between gap-2 border-b border-dashed py-1"><dt className="text-muted-foreground">{f.label}</dt><dd className={cn("min-w-0 break-words text-right", f.value === NOT_RECORDED && "text-muted-foreground italic")}>{f.value}</dd></div>
          ))}</dl>
        </div>
        {prep.missing.length > 0 && <div><div className="eyebrow mb-1.5">Important missing information</div><ul className="grid gap-1 text-xs" data-testid="coach-missing">{prep.missing.map((m) => <li key={m}>• {m}</li>)}</ul></div>}
        <div className="rounded-xl border p-3" data-testid="coach-objective">
          <div className="mb-1 flex flex-wrap items-center gap-2"><span className="eyebrow">Suggested call objective</span><SrcTag s={prep.objective.source} /></div>
          <p className="text-sm">{prep.objective.text}</p>
        </div>
        {grouped.length > 0 ? (
          <div data-testid="coach-questions">
            <div className="mb-1.5 flex flex-wrap items-center gap-2"><ListChecks className="size-4" /><span className="eyebrow">Discovery questions</span><span className="text-[11px] text-muted-foreground">Ask before talking price or packages.</span></div>
            <div className="grid gap-3">{grouped.map((g) => (
              <div key={g.label}><div className="mb-1 text-xs font-semibold">{g.label}</div>
                <ul className="grid gap-1">{g.items.map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm"><span className="min-w-0">{q.text}<span className="ml-2 align-middle"><SrcTag s={q.source} /></span></span><CopyBtn text={q.text} label={`Copy question: ${q.text}`} /></li>
                ))}</ul></div>
            ))}</div>
          </div>
        ) : <p className="text-xs text-muted-foreground">No discovery questions — this lead is closed.</p>}
      </section>

      {!prep.noPitch && <section id="coach-objections" className="surface grid gap-4 p-4" aria-labelledby="coach-obj-h">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="coach-obj-h" className="flex items-center gap-2 text-base font-semibold"><MessageSquareQuote className="size-4" />Objection Coach</h2><SrcTag s="static_example" /></div>
        <div role="tablist" aria-label="Objection type" className="flex flex-wrap gap-1.5" onKeyDown={onRovingKeyDown}>
          {OBJECTIONS.map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={obj === o.id} tabIndex={roving(obj === o.id)} onClick={() => { setObj(o.id); setReview(null); }}
              className={cn("rounded-full border px-3 py-1 text-xs", obj === o.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{o.category}</button>
          ))}
        </div>
        <div role="tabpanel" className="grid gap-3 text-sm" data-testid="objection-card" data-objection={coaching.id}>
          <p className="font-semibold">“{coaching.quote}” <span className="text-xs font-normal text-muted-foreground">· {coaching.category}</span></p>
          <div><div className="eyebrow mb-0.5">What they may be worried about</div><p>{coaching.concern}</p></div>
          <div><div className="eyebrow mb-0.5">What not to say</div><p>{coaching.avoid}</p></div>
          <div className="rounded-lg border bg-muted/30 p-2.5"><div className="flex items-start justify-between gap-2"><div><div className="eyebrow mb-0.5">Suggested response</div><p data-testid="objection-response">{coaching.response}</p></div><CopyBtn text={coaching.response} label="Copy suggested response" /></div></div>
          <div><div className="eyebrow mb-0.5">Why it could work</div><p>{coaching.why}</p></div>
          <div className="flex items-start justify-between gap-2"><div><div className="eyebrow mb-0.5">Next question</div><p>{coaching.nextQuestion}</p></div><CopyBtn text={coaching.nextQuestion} label="Copy next question" /></div>
        </div>
        <div className="grid gap-2 border-t pt-3">
          <label htmlFor="coach-draft" className="eyebrow">Your response (practice)</label>
          <Textarea id="coach-draft" rows={3} maxLength={800} value={draft} onChange={(e) => { setDraft(e.target.value); setReview(null); }} placeholder={`How would you answer “${coaching.quote}”?`} />
          <div><Button size="sm" variant="outline" disabled={!draft.trim()} onClick={() => setReview(provider.run({ kind: "response_review", lead, objection: obj, draft }) as ResponseReview)}>Review my response</Button></div>
          {review && <div className="grid gap-2 rounded-xl border p-3 text-sm" data-testid="review-result" aria-live="polite">
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-2 text-xs" role="note" data-testid="review-limitation"><Info className="mt-0.5 size-3.5 shrink-0" />{review.limitation}</div>
            <div><div className="eyebrow mb-1">Simple checks</div><ul className="grid gap-1 text-xs">{review.checks.map((c) => <li key={c.label} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5 text-destructive" />}{c.label}{!c.ok && <span className="sr-only"> — not met</span>}</li>)}</ul></div>
            <p className="text-xs"><span className="font-semibold">Strengths / weaknesses / what the prospect might think:</span> not available in Demo Mode — a live coach would need to really read your words.</p>
            <div className="flex items-start justify-between gap-2"><div><div className="mb-0.5 flex items-center gap-2"><span className="eyebrow">Example of a stronger response</span><SrcTag s={review.source} /></div><p>{review.improved}</p></div><CopyBtn text={review.improved} label="Copy example response" /></div>
            <p className="text-xs"><span className="font-semibold">Next question:</span> {review.nextQuestion}</p>
          </div>}
        </div>
      </section>}

      <section className="surface grid gap-3 p-4" aria-labelledby="coach-after-h">
        <h2 id="coach-after-h" className="text-base font-semibold">After Call — What's Next?</h2>
        <label htmlFor="coach-summary" className="sr-only">What happened on the call</label>
        <Textarea id="coach-summary" rows={2} maxLength={600} value={summary} onChange={(e) => { setSummary(e.target.value); setNext(null); }} placeholder="e.g. Liked the idea, wants a quotation for 5 pages" />
        <div><Button size="sm" variant="outline" onClick={() => setNext(provider.run({ kind: "after_call", lead, summary }) as AfterCallSuggestion)}>Suggest next step</Button></div>
        {next && <div className="rounded-xl border p-3" data-testid="after-call" data-kind={next.kind} aria-live="polite">
          <div className="mb-1 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{next.label}</span><SrcTag s={next.source} /></div>
          <p className="text-xs text-muted-foreground">Why: {next.why}{next.matched ? ` (matched “${next.matched}”)` : ""}</p>
          <div className="mt-2">{nextAction(next)}</div>
        </div>}
        <p className="text-[11px] text-muted-foreground">This summary isn't saved. Nothing is logged, called, sent or changed — use Log call or the forms that open to record anything.</p>
      </section>
    </div>
  );
}
