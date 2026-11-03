import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Check, Copy, FlaskConical, Loader2, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { cn } from "@/lib/utils";
import { useCRM } from "@/lib/crm/store";
import { useSession, allows } from "@/lib/crm/session";
import { formatINR, formatPct } from "@/lib/crm/format";
import {
  buildDealContext, collectionPriorities, dealFacts, explainFinances, getFinanceAssistProvider, nextDueText, reminderViolations, reviewRecords,
  FINANCE_DEMO_LABEL, REMINDER_LABEL, REMINDER_LANG_LABEL, REMINDER_PURPOSES, type ReminderLang, type ReminderPurpose, type ReminderResult,
} from "@/lib/ai/financeAssist";
import { dayLabel } from "@/lib/ai/projectAssist";
import { TONE_LABEL, type RewriteTone } from "@/lib/ai/rewrite";

type Mode = "explain" | "attention" | "reminder" | "review";
const MODES: [Mode, string][] = [["explain", "Explain My Finances"], ["attention", "Payments Needing Attention"], ["reminder", "Draft Payment Reminder"], ["review", "Review Financial Records"]];
export const REMINDER_SOURCE = "Finance Studio · AI payment reminder";

/** Owner-only, read-only Finance assistant. All figures come from the canonical CRM finance functions. */
export function FinanceAssistPanel({ dealId, onSelectDeal, onClose }: { dealId: string | null; onSelectDeal: (id: string) => void; onClose: () => void }) {
  const { deals, payments, projects } = useCRM(useShallow((s) => ({ deals: s.deals, payments: s.payments, projects: s.projects })));
  const [mode, setMode] = useState<Mode>("explain");
  const deal = deals.find((d) => d.id === dealId) ?? null;
  const ctx = useMemo(() => (deal ? buildDealContext(deal, payments) : null), [deal, payments]);
  const ex = mode === "explain" ? explainFinances(deals, payments) : null;
  const pri = mode === "attention" ? collectionPriorities(deals, payments) : null;
  const rev = mode === "review" ? reviewRecords(deals, payments, projects) : null;
  return (
    <section aria-label="Finance AI Assist" className="receipt mb-6 mt-6 grid min-w-0 gap-4 p-4 sm:p-5" data-testid="finance-assist">
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-1"><div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Assist · Demo Mode</div><p className="text-xs text-muted-foreground">{FINANCE_DEMO_LABEL} Figures come from the CRM's own finance calculations. Nothing here records, voids or changes payments or deals.</p></div>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Close Finance AI Assist" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <label className="grid gap-1 text-[11px] font-semibold sm:max-w-md">Selected deal<select aria-label="Selected deal" className={cn(selectCls, "h-9 w-full text-xs")} value={dealId ?? ""} onChange={(e) => onSelectDeal(e.target.value)}><option value="" disabled>Choose a deal…</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.clientName} · {d.name}</option>)}</select></label>
      {ctx && <dl className="pd-carry text-sm" data-testid="fa-context">
        {dealFacts(ctx).map((f) => { const [k, ...v] = f.split(": "); return <div key={k}><dt>{k}</dt><dd>{v.join(": ")}</dd></div>; })}
        <p className="col-span-full text-[11px] text-muted-foreground">Received = sum of non-voided payments. Outstanding = agreed value − received (never below zero). Recorded in the CRM, not bank-verified. Phone, email and proof files are not used.</p>
      </dl>}
      <div className="max-w-full overflow-x-auto"><div className="seg w-max" role="tablist" aria-label="Finance AI actions">{MODES.map(([m, t]) => <button key={m} type="button" role="tab" aria-selected={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t}</button>)}</div></div>

      {ex && <div className="grid gap-3 text-sm" data-testid="fa-explain">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["Booked value", formatINR(ex.booked)], ["Recorded collections", formatINR(ex.collected)], ["Outstanding", formatINR(ex.outstanding)], ["Outstanding share", formatPct(ex.outstandingShare)]] as const).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-1 text-lg" data-testid={`fa-${k.split(" ")[0]!.toLowerCase()}`}>{v}</dd></div>)}</dl>
        <ul className="list-disc pl-5">{ex.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div><div className="font-semibold">Fully paid ({ex.fullyPaid.length})</div>{ex.fullyPaid.join(", ") || "None"}</div>
          <div><div className="font-semibold">Partially paid ({ex.partial.length})</div>{ex.partial.join(", ") || "None"}</div>
          <div><div className="font-semibold">No payment recorded ({ex.noPayment.length})</div>{ex.noPayment.join(", ") || "None"}</div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-xs" data-testid="fa-month"><div className="font-semibold">{ex.thisMonth.monthLabel} (India time)</div>Booked this month: {formatINR(ex.thisMonth.booked)} · Collected this month: {formatINR(ex.thisMonth.collected)}{ex.thisMonth.unknownWon > 0 && <> · {ex.thisMonth.unknownWon} older deal(s) worth {formatINR(ex.thisMonth.unknownWonValue)} have no recorded won date and aren't placed in any month.</>}</div>
        {ex.largest.length > 0 && <div className="text-xs"><div className="font-semibold">Largest outstanding balances</div><ol className="list-decimal pl-5">{ex.largest.map((x) => <li key={x.name + x.client}>{x.client} · {x.name}: {formatINR(x.outstanding)}</li>)}</ol></div>}
      </div>}

      {pri && <div className="grid gap-2" data-testid="fa-attention">
        {pri.length === 0 && <p className="text-sm text-muted-foreground">No deal has an outstanding balance.</p>}
        <ul className="grid gap-2">{pri.map((p) => <li key={p.dealId} className="rounded-xl border p-3 text-sm" data-testid="fa-item" data-deal={p.dealId}>
          <div className="font-medium">{p.ctx.clientName} · {p.ctx.dealName}</div>
          <div className="text-xs text-muted-foreground">Agreed {formatINR(p.ctx.agreed)} · Received {formatINR(p.ctx.received)} · Outstanding {formatINR(p.ctx.outstanding)} · Last payment {p.ctx.lastPaymentDate ? dayLabel(p.ctx.lastPaymentDate) : "none"} · Next due: {nextDueText(p.ctx)}</div>
          <div className="mt-1 text-xs"><b>{p.action}.</b> Why: {p.reason}</div>
          <div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onSelectDeal(p.dealId)}>Open deal</Button><Button type="button" size="sm" variant="outline" onClick={() => { onSelectDeal(p.dealId); setMode("reminder"); }}><Sparkles className="size-3.5" />Draft reminder</Button></div>
        </li>)}</ul>
      </div>}

      {mode === "reminder" && (ctx ? <ReminderWriter key={ctx.dealId} dealId={ctx.dealId} /> : <p className="text-sm text-muted-foreground">Choose a deal first.</p>)}

      {rev && <div className="grid gap-2" data-testid="fa-review">
        {rev.length === 0 ? <p className="text-sm text-muted-foreground">No issues found by the built-in checks.</p> : <ul className="grid gap-2">{rev.map((f) => <li key={f.id} className={cn("rounded-xl border p-3 text-sm", f.severity === "review" && "border-warning/40 bg-warning/10")} data-testid="fa-finding" data-sev={f.severity}><div className="font-medium">{f.title}</div><div className="text-xs text-muted-foreground">{f.detail}</div>{f.dealId && <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => onSelectDeal(f.dealId!)}>Open deal</Button>}</li>)}</ul>}
        <p className="text-[11px] text-muted-foreground">“Needs review” means check it manually — not an error or fraud. Nothing is voided, edited or removed.</p>
      </div>}
    </section>
  );
}

type Up = { s: "idle" } | { s: "loading" } | { s: "ready"; res: ReminderResult; edited: string };
function ReminderWriter({ dealId }: { dealId: string }) {
  const deal = useCRM((s) => s.deals.find((d) => d.id === dealId))!;
  const payments = useCRM((s) => s.payments);
  const prior = useCRM((s) => !!deal?.leadId && s.activities.some((a) => a.leadId === deal.leadId && a.type === "whatsapp" && a.text.includes(REMINDER_SOURCE)));
  const canWa = allows(useSession((s) => s.preview), "clients.whatsapp");
  const ctx = useMemo(() => buildDealContext(deal, payments), [deal, payments]);
  const [purpose, setPurpose] = useState<ReminderPurpose>(ctx.outstanding > 0 ? "initial" : "thanks");
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [lang, setLang] = useState<ReminderLang>("en");
  const [original, setOriginal] = useState("");
  const [up, setUp] = useState<Up>({ s: "idle" });
  const [lastPrev, setLastPrev] = useState<string | null>(null);
  const variant = useRef(0);
  const run = async (next = false) => {
    if (next) variant.current += 1;
    setUp({ s: "loading" });
    const res = await getFinanceAssistProvider().reminder({ ctx, purpose, tone, lang, variant: variant.current, priorReminder: prior });
    setUp({ s: "ready", res, edited: res.text });
  };
  const issues = up.s === "ready" && !up.res.blocked ? reminderViolations(ctx, original, up.edited) : [];
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <label className="grid min-w-0 gap-1 text-[11px] font-semibold">{label}<select aria-label={label} className={cn(selectCls, "h-9 w-full min-w-0 text-xs")} value={value} onChange={(e) => { onChange(e.target.value); setUp({ s: "idle" }); }}>{opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  );
  return <div className="grid gap-3" data-testid="fa-reminder" data-deal={dealId}>
    <div className="grid gap-2 sm:grid-cols-3">
      {sel("Reminder purpose", purpose, (v) => setPurpose(v as ReminderPurpose), REMINDER_PURPOSES.map((x) => [x, REMINDER_LABEL[x]]))}
      {sel("Writing style", tone, (v) => setTone(v as RewriteTone), (["professional", "friendly", "short"] as RewriteTone[]).map((x) => [x, TONE_LABEL[x]]))}
      {sel("Language", lang, (v) => setLang(v as ReminderLang), Object.entries(REMINDER_LANG_LABEL))}
    </div>
    <label className="grid gap-1 text-[11px] font-semibold">Your draft (optional)<Textarea aria-label="Original reminder draft" rows={2} value={original} onChange={(e) => setOriginal(e.target.value)} /></label>
    {up.s === "idle" && <Button type="button" size="sm" className="w-fit" onClick={() => void run()}><Sparkles className="size-3.5" />Draft Payment Reminder</Button>}
    {up.s === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Preparing demo draft…</p>}
    {up.s === "ready" && <div className="grid gap-2">
      <details className="text-xs" open><summary className="cursor-pointer font-semibold">Recorded financial facts used</summary><ul className="mt-1 list-disc pl-5 text-muted-foreground">{up.res.contextUsed.map((x) => <li key={x}>{x}</li>)}</ul></details>
      {up.res.notices.map((n) => <p key={n} className="pd-note text-xs" role="status" data-testid="fa-notice">{n}</p>)}
      {!up.res.blocked && <>
        {original.trim() && <div className="text-xs"><div className="font-semibold">Original draft</div><p className="whitespace-pre-wrap text-muted-foreground">{original}</p></div>}
        <label className="grid gap-1 text-[11px] font-semibold">Suggested reminder (editable) · Demo suggestion<Textarea aria-label="Suggested reminder" rows={6} value={up.edited} onChange={(e) => setUp({ ...up, edited: e.target.value })} /></label>
        {issues.length > 0 && <ul className="pd-note list-disc pl-5 text-xs" role="alert" data-testid="fa-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      </>}
      <div className="flex flex-wrap gap-2">
        {!up.res.blocked && <Button type="button" size="sm" disabled={issues.length > 0} onClick={() => { setLastPrev(original); setOriginal(up.edited); setUp({ s: "idle" }); toast.success("Suggestion placed in your draft. Nothing was sent."); }}><Check className="size-3.5" />Use Suggestion</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => setUp({ s: "idle" })}><X className="size-3.5" />Keep Original</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void run(true)}><RotateCcw className="size-3.5" />Try Again</Button>
      </div>
    </div>}
    {lastPrev !== null && up.s === "idle" && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => { setOriginal(lastPrev); setLastPrev(null); }}><RotateCcw className="size-3.5" />Undo Improvement</Button>}
    {original.trim() && up.s === "idle" && <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(original).then(() => toast.success("Copied")); }}><Copy className="size-3.5" />Copy</Button>
      {ctx.leadId && canWa && <Button type="button" size="sm" variant="outline" onClick={() => openWhatsApp(ctx.leadId!, REMINDER_SOURCE, { text: original })}><MessageCircle className="size-3.5" />Open in WhatsApp composer</Button>}
      {!ctx.leadId && <span className="text-xs text-muted-foreground">Not a CRM client — copy the text to send it yourself.</span>}
    </div>}
    <p className="text-[11px] text-muted-foreground">Never sent or marked as sent automatically. Only a send you confirm in the composer is recorded.</p>
  </div>;
}
