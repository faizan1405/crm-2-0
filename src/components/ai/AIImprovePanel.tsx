import { useRef, useState } from "react";
import { Sparkles, Loader2, AlertCircle, RotateCcw, Check, X, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";
import { getRewriteProvider, rewriteViolations, TONE_LABEL, LANG_LABEL, SCENARIO_LABEL, type RewriteTone, type RewriteLang, type RewriteResult } from "@/lib/ai/rewrite";

type St = { s: "idle" } | { s: "loading" } | { s: "ready"; res: RewriteResult; for: string } | { s: "error"; message: string; retryable: boolean };

/** Suggestion-only: never changes the draft unless the user clicks "Use improved". */
export function AIImprovePanel({ draft, firstName, onUse }: { draft: string; firstName?: string | undefined; onUse: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [lang, setLang] = useState<RewriteLang>("keep");
  const [st, setSt] = useState<St>({ s: "idle" });
  const variant = useRef(0);
  const run = async (next = false) => {
    if (next) variant.current += 1;
    const snapshot = draft;
    setSt({ s: "loading" });
    try {
      const res = await getRewriteProvider().rewrite({ draft: snapshot, tone, lang, variant: variant.current, ...(firstName ? { firstName } : {}) });
      setSt({ s: "ready", res, for: snapshot });
    } catch (e) {
      const err = e as { message?: string; retryable?: boolean };
      setSt({ s: "error", message: err.message ?? "Something went wrong.", retryable: err.retryable ?? true });
    }
  };
  if (!open) return <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)} disabled={!draft.trim()}><Sparkles className="size-3.5" />AI Improve</Button>;
  const stale = st.s === "ready" && st.for !== draft;
  const issues = st.s === "ready" ? rewriteViolations(st.for, st.res.text) : [];
  return (
    <section aria-label="AI Improve" className="grid gap-2.5 rounded-xl border bg-muted/30 p-3" data-testid="ai-improve">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Improve · Demo Mode</div>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close AI Improve" onClick={() => { setOpen(false); setSt({ s: "idle" }); }}><X className="size-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-semibold">Tone<select aria-label="Tone" className={cn(selectCls, "h-9 text-xs")} value={tone} onChange={(e) => { setTone(e.target.value as RewriteTone); setSt({ s: "idle" }); }}>{Object.entries(TONE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-[11px] font-semibold">Language<select aria-label="Language" className={cn(selectCls, "h-9 text-xs")} value={lang} onChange={(e) => { setLang(e.target.value as RewriteLang); setSt({ s: "idle" }); }}>{Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      {st.s !== "ready" && st.s !== "loading" && <Button type="button" size="sm" className="w-fit" onClick={() => void run()} disabled={!draft.trim()}><Sparkles className="size-3.5" />Suggest improvement</Button>}
      {st.s === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" />Preparing a demo suggestion…</p>}
      {st.s === "error" && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><AlertCircle className="size-3.5" />{st.message}{st.retryable && <Button type="button" size="sm" variant="outline" onClick={() => void run()}><RotateCcw className="size-3.5" />Retry</Button>}</div>}
      {st.s === "ready" && (
        <div className="grid gap-2" aria-live="polite">
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Original draft</summary><p className="mt-1 whitespace-pre-wrap rounded-lg border bg-card p-2" data-testid="ai-original">{st.for}</p></details>
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">{st.res.label} · {SCENARIO_LABEL[st.res.scenario]}</div>
            <p className="whitespace-pre-wrap rounded-lg border bg-card p-2.5 text-sm leading-relaxed" data-testid="ai-suggestion">{st.res.text}</p>
          </div>
          {st.res.notice && <p className="text-[11px] text-muted-foreground" data-testid="ai-notice">{st.res.notice}</p>}
          {issues.length > 0 && <p role="alert" className="text-[11px] text-destructive">Can't use this suggestion: {issues.join(", ")}.</p>}
          {stale && <p role="status" className="text-[11px] text-muted-foreground">Your message changed since this suggestion — try again to update it.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={stale || issues.length > 0} onClick={() => { onUse(st.res.text); setSt({ s: "idle" }); setOpen(false); }}><Check className="size-3.5" />Use improved</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setSt({ s: "idle" }); setOpen(false); }}>Keep original</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void run(true)}><RotateCcw className="size-3.5" />Try again</Button>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">Suggestions keep your prices, dates and names exactly as written and never add new ones. Nothing is sent or saved.</p>
    </section>
  );
}
