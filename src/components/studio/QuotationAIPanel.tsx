import { useState } from "react";
import { Sparkles, Loader2, Check, X, RotateCcw, FlaskConical, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";
import { getQuoteWriter, commercialViolations, QUOTE_LANG_LABEL, type QuoteMode, type QuoteLang, type QuoteResult } from "@/lib/ai/quoteWriter";

type St = { s: "idle" } | { s: "loading" } | { s: "ready"; res: QuoteResult; forBody: string; forReq: string; edited: string } | { s: "error"; message: string };

/**
 * Suggestion-only quotation writer inside the package editor. Never changes the editable draft
 * until "Use suggestion", and never saves — the existing Save template button does that.
 */
export function QuotationAIPanel({ body, leadRequirement, leadName, onUse }: { body: string; leadRequirement?: string | undefined; leadName?: string | undefined; onUse: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuoteMode>("improve");
  const [lang, setLang] = useState<QuoteLang>("en");
  const [reqs, setReqs] = useState("");
  const [variant, setVariant] = useState(0);
  const [st, setSt] = useState<St>({ s: "idle" });

  const run = async (v = variant) => {
    const forBody = body, forReq = reqs;
    setSt({ s: "loading" });
    try {
      const res = await getQuoteWriter().write({ mode, body: forBody, requirements: forReq, lang, variant: v });
      setSt({ s: "ready", res, forBody, forReq, edited: res.text });
    } catch (e) { setSt({ s: "error", message: (e as { message?: string }).message ?? "Couldn't prepare a suggestion." }); }
  };
  if (!open) return <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}><Sparkles className="size-3.5" />AI writing help</Button>;

  const stale = st.s === "ready" && (st.forBody !== body || st.forReq !== reqs);
  const issues = st.s === "ready" ? commercialViolations([st.forBody, st.forReq], st.edited, st.forBody) : [];
  const reset = () => setSt({ s: "idle" });
  return (
    <section aria-label="AI writing help" className="grid gap-2.5 rounded-xl border bg-muted/30 p-3" data-testid="quote-ai">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI writing help · Demo Mode</div>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close AI writing help" onClick={() => { setOpen(false); reset(); }}><X className="size-3.5" /></Button>
      </div>
      <div role="tablist" aria-label="Writing action" className="qt-tabs" onKeyDown={onRovingKeyDown}>
        <button type="button" role="tab" aria-selected={mode === "improve"} tabIndex={roving(mode === "improve")} onClick={() => { setMode("improve"); reset(); }}>AI Improve</button>
        <button type="button" role="tab" aria-selected={mode === "draft_scope"} tabIndex={roving(mode === "draft_scope")} onClick={() => { setMode("draft_scope"); reset(); }}>AI Draft Scope</button>
      </div>
      {mode === "draft_scope" && <div className="grid gap-2">
        <label htmlFor="qa-reqs" className="text-[11px] font-semibold">Client requirements (only what you type here is used)</label>
        <Textarea id="qa-reqs" rows={3} maxLength={1500} value={reqs} onChange={(e) => setReqs(e.target.value)} placeholder="e.g. Business website, 5 pages, contact form, WhatsApp button. Client will send logo." className="text-xs" />
        <div className="flex flex-wrap items-center gap-2">
          {leadRequirement && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setReqs((r) => (r.trim() ? `${r.trim()}\n${leadRequirement}` : leadRequirement))}>Add {leadName ?? "client"}'s recorded requirement</Button>}
          <label className="flex items-center gap-1.5 text-[11px] font-semibold">Headings<select aria-label="Heading language" className={cn(selectCls, "h-8 text-xs")} value={lang} onChange={(e) => { setLang(e.target.value as QuoteLang); reset(); }}>{Object.entries(QUOTE_LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
      </div>}
      {(st.s === "idle" || st.s === "error") && <Button type="button" size="sm" className="w-fit" onClick={() => void run()}><Sparkles className="size-3.5" />Suggest</Button>}
      {st.s === "error" && <p role="alert" className="text-xs text-destructive">{st.message}</p>}
      {st.s === "loading" && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Preparing a demo suggestion…</p>}
      {st.s === "ready" && <div className="grid gap-2" aria-live="polite">
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Original (unchanged)</summary><p className="mt-1 whitespace-pre-wrap break-words rounded-lg border bg-card p-2" data-testid="quote-original">{st.forBody}</p></details>
        <label htmlFor="qa-sug" className="text-[11px] text-muted-foreground">{st.res.label} — you can edit this suggestion</label>
        <Textarea id="qa-sug" rows={10} value={st.edited} onChange={(e) => setSt({ ...st, edited: e.target.value })} className="text-xs leading-relaxed" data-testid="quote-suggestion" />
        {st.res.notice && <p className={cn("flex items-start gap-1.5 text-[11px]", !st.res.supported && "font-medium")} data-testid="quote-notice" data-supported={st.res.supported}><Info className="mt-0.5 size-3 shrink-0" />{st.res.notice}</p>}
        {issues.length > 0 && <div role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive" data-testid="quote-blocked"><AlertTriangle className="mt-0.5 size-3 shrink-0" /><span>Can't use this — prices, percentages, timelines and other agreed values must stay exactly as written: {issues.join("; ")}.</span></div>}
        {stale && <p role="status" className="text-[11px] text-muted-foreground">Your message or requirements changed — try again to update the suggestion.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={stale || issues.length > 0 || !st.edited.trim()} onClick={() => { onUse(st.edited); setOpen(false); reset(); }}><Check className="size-3.5" />Use suggestion</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(false); reset(); }}>Keep original</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { const v = variant + 1; setVariant(v); void run(v); }}><RotateCcw className="size-3.5" />Try again</Button>
        </div>
      </div>}
      <p className="text-[11px] text-muted-foreground">Nothing is saved or sent. Using a suggestion only changes the message above — press Save template to keep it.</p>
    </section>
  );
}
