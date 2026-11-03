import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sparkles, Loader2, RotateCcw, Check, X, FlaskConical, Database, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";
import { useCRM } from "@/lib/crm/store";
import { useSession } from "@/lib/crm/session";
import { buildLeadContext } from "@/lib/ai/context";
import { buildFollowUpFacts, draftViolations, FU_PURPOSES, FU_PURPOSE_LABEL, getFollowUpDraftProvider, LANG_LABEL, suggestPurpose, TONE_LABEL, type FollowUpDraftResult, type FollowUpPurpose } from "@/lib/ai/followupWriter";
import type { RewriteLang, RewriteTone } from "@/lib/ai/rewrite";

type Lang = Exclude<RewriteLang, "keep">;
type St = { s: "idle" } | { s: "loading" } | { s: "ready"; res: FollowUpDraftResult; edited: string; for: string };

/** Suggestion-only: the composer draft changes only when the Owner clicks "Use suggestion". Nothing is sent or saved. */
export function FollowUpWriterPanel({ leadId, draft, initialOpen, initialPurpose, onUse }: { leadId: string; draft: string; initialOpen?: boolean; initialPurpose?: FollowUpPurpose; onUse: (text: string) => void }) {
  const src = useCRM(useShallow((s) => ({ leads: s.leads, activities: s.activities, followUps: s.followUps, deals: s.deals, payments: s.payments, assignments: s.assignments, shares: s.quotationShares })));
  const preview = useSession((s) => s.preview);
  const facts = useMemo(() => {
    const ctx = buildLeadContext(src, leadId, preview);
    if (!ctx.ok) return null;
    const note = src.followUps.filter((f) => f.leadId === leadId && !f.completedAt && !f.cancelledAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]?.note;
    return buildFollowUpFacts(ctx.lead, src.shares, note);
  }, [src, leadId, preview]);
  const [open, setOpen] = useState(!!initialOpen);
  const [purpose, setPurpose] = useState<FollowUpPurpose>(() => initialPurpose ?? (facts ? suggestPurpose(facts) : "no_response"));
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [lang, setLang] = useState<Lang | "keep">("en");
  const [st, setSt] = useState<St>({ s: "idle" });
  const variant = useRef(0);
  if (!facts) return null;
  const effLang: Lang = lang === "keep" ? (/[\u0900-\u097F]/.test(draft) ? "hi" : /\b(hai|aap|kya|nahi|ji)\b/i.test(draft) ? "hinglish" : "en") : lang;
  const run = async (next = false) => {
    if (next) variant.current += 1;
    const snapshot = draft;
    setSt({ s: "loading" });
    const res = await getFollowUpDraftProvider().draft({ facts, purpose, tone, lang: effLang, variant: variant.current });
    setSt({ s: "ready", res, edited: res.text, for: snapshot });
  };
  const reset = () => setSt({ s: "idle" });
  if (!open) return <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}><Sparkles className="size-3.5" />AI Draft Message</Button>;
  const issues = st.s === "ready" ? draftViolations(facts, st.for, st.edited) : [];
  const stale = st.s === "ready" && st.for !== draft;
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <label className="grid min-w-0 gap-1 text-[11px] font-semibold">{label}<select aria-label={label} className={cn(selectCls, "h-9 w-full min-w-0 text-xs")} value={value} onChange={(e) => { onChange(e.target.value); reset(); }}>{opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  );
  return (
    <section aria-label="AI Draft Message" className="grid gap-2.5 rounded-xl border bg-muted/30 p-3" data-testid="fu-writer" data-lead={leadId}>
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Draft Message · Demo Mode</div>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close AI Draft Message" onClick={() => { setOpen(false); reset(); }}><X className="size-3.5" /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {sel("Message purpose", purpose, (v) => setPurpose(v as FollowUpPurpose), FU_PURPOSES.map((p) => [p, FU_PURPOSE_LABEL[p]]))}
        {sel("Writing style", tone, (v) => setTone(v as RewriteTone), Object.entries(TONE_LABEL))}
        {sel("Draft language", lang, (v) => setLang(v as Lang | "keep"), [["en", LANG_LABEL.en], ["hi", LANG_LABEL.hi], ["hinglish", LANG_LABEL.hinglish], ["keep", "Preserve original language"]])}
      </div>
      {st.s === "idle" && <Button type="button" size="sm" className="w-fit" onClick={() => void run()}><Sparkles className="size-3.5" />Draft suggestion</Button>}
      {st.s === "loading" && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Preparing a demo draft…</p>}
      {st.s === "ready" && (
        <div className="grid gap-2" aria-live="polite">
          <p className="text-[11px] text-muted-foreground" data-testid="fu-label">{st.res.label}</p>
          <details className="text-xs" data-testid="fu-context"><summary className="flex cursor-pointer items-center gap-1 text-muted-foreground"><Database className="size-3" />Context used ({st.res.contextUsed.length})</summary><ul className="mt-1 grid gap-0.5 rounded-lg border bg-card p-2">{st.res.contextUsed.map((c) => <li key={c}>{c}</li>)}</ul></details>
          <label htmlFor="fu-suggestion" className="text-[11px] font-semibold">Suggested message (editable — your current draft is unchanged)</label>
          <Textarea id="fu-suggestion" data-testid="fu-suggestion" rows={6} value={st.edited} onChange={(e) => setSt({ ...st, edited: e.target.value })} className="text-sm leading-relaxed" />
          {st.res.notices.map((n) => <p key={n} className="flex items-start gap-1 text-[11px] text-muted-foreground" data-testid="fu-notice"><Info className="mt-0.5 size-3 shrink-0" />{n}</p>)}
          {issues.length > 0 && <p role="alert" className="text-[11px] text-destructive">Can't use this suggestion: {issues.join(", ")}.</p>}
          {stale && <p role="status" className="text-[11px] text-muted-foreground">Your message changed since this suggestion — Undo will restore the version you have now.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={issues.length > 0 || !st.edited.trim()} onClick={() => { onUse(st.edited); reset(); setOpen(false); }}><Check className="size-3.5" />Use suggestion</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { reset(); setOpen(false); }}>Keep original</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void run(true)}><RotateCcw className="size-3.5" />Try again</Button>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">Uses only this lead's recorded details. Never invents amounts, dates, discounts or promises. Nothing is sent or saved.</p>
    </section>
  );
}
