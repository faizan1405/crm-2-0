import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { FlaskConical, AlertTriangle, CheckCircle2, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallButton } from "@/components/crm/CallButton";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { analyzeLead, ATTENTION_LABEL, type NextAction } from "@/lib/ai/intelligence";
import type { LeadContext } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

/** Read-only Demo Analysis. Actions only open existing CRM forms; nothing is saved here. */
export function LeadIntelligencePanel({ lead, phone, canFollowUp, onFollowUp }: { lead: LeadContext; phone?: string | undefined; canFollowUp: boolean; onFollowUp: () => void }) {
  const a = useMemo(() => analyzeLead(lead), [lead]);
  const act = (n: NextAction, primary: boolean) => {
    const v = primary ? "default" : "outline";
    if (n.kind === "call" && phone) return <CallButton leadId={lead.leadId} phone={phone} name={lead.name} source="AI Copilot" />;
    if (n.kind === "schedule_followup" && canFollowUp) return <Button size="sm" variant={v} onClick={onFollowUp}>Open follow-up form</Button>;
    if (n.kind === "prepare_quotation") return <Button size="sm" variant={v} onClick={() => openWhatsApp(lead.leadId, "AI Copilot")}>Open message composer</Button>;
    if (n.kind === "qualify" || n.kind === "review_history") return <Button size="sm" variant={v} asChild><Link to="/leads/$id" params={{ id: lead.leadId }}>Open lead</Link></Button>;
    return null;
  };
  return (
    <section className="surface grid gap-4 p-4" aria-label="Lead intelligence" data-testid="lead-intel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3.5" />Demo Analysis · fixed rules, not a live AI model</div>
        <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold" data-attention={a.attention} data-testid="attention">Suggested: {ATTENTION_LABEL[a.attention]}</span>
      </div>
      <p className="text-sm leading-relaxed" data-testid="intel-summary">{a.summary}</p>

      <div>
        <div className="eyebrow mb-1.5">Recorded facts</div>
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{a.facts.map((f) => <div key={f.label} className="flex justify-between gap-2 border-b border-dashed py-1"><dt className="text-muted-foreground">{f.label}</dt><dd className="text-right">{f.value}</dd></div>)}</dl>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-1.5">Why this attention level <span className="normal-case">(suggestion)</span></div>
          <ul className="grid gap-1 text-xs">{a.attentionWhy.map((w) => <li key={w}>{w}</li>)}</ul>
          {a.signals.length > 0 && <ul className="mt-2 grid gap-1 text-xs" data-testid="signals">{a.signals.map((s) => <li key={s.id} className="flex items-start gap-1.5">{s.tone === "risk" ? <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" /> : s.tone === "positive" ? <CheckCircle2 className="mt-0.5 size-3 shrink-0" /> : <Info className="mt-0.5 size-3 shrink-0" />}{s.text}</li>)}</ul>}
        </div>
        <div>
          <div className="eyebrow mb-1.5">Buying-intent signals</div>
          <ul className="grid gap-1 text-xs" data-testid="intent">{a.intent.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="eyebrow mb-1.5 mt-3">Missing information</div>
          {a.missing.length ? <ul className="grid gap-1 text-xs" data-testid="missing">{a.missing.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing obvious missing.</p>}
        </div>
      </div>

      <div className="rounded-xl border p-3" data-testid="nba">
        <div className="eyebrow mb-1">Recommended next action <span className="normal-case">(suggestion)</span></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold" data-testid="nba-primary">{a.primary.label}</p>{act(a.primary, true)}</div>
        <p className="mt-1 text-xs text-muted-foreground">Why: {a.primary.why}</p>
        {a.alternatives.length > 0 && <ul className="mt-3 grid gap-2 border-t pt-2">{a.alternatives.map((n) => <li key={n.label} className="text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className={cn("flex items-center gap-1 font-medium")}><ArrowRight className="size-3" />{n.label}</span>{act(n, false)}</div><p className="text-muted-foreground">Why: {n.why}</p></li>)}</ul>}
        <p className="mt-3 text-[11px] text-muted-foreground">Nothing is logged, sent or changed until you save it in the form that opens. Manual priority is never changed.</p>
      </div>
    </section>
  );
}
