import { useMemo, useRef, useState } from "react";
import { Check, Compass, Copy, FlaskConical, Loader2, MessageCircle, RotateCcw, Sparkles, Wrench, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { cn } from "@/lib/utils";
import { useCRM } from "@/lib/crm/store";
import { useSession, allows } from "@/lib/crm/session";
import { dayKey } from "@/lib/crm/format";
import { dayLabel } from "@/lib/ai/projectAssist";
import {
  buildSupportContext, getSupportAssistProvider, nextSupportAction, replyViolations, summarizeRequest, supportContextUsed, troubleshoot,
  NOT_RECORDED, REPLY_LANG_LABEL, REPLY_PURPOSES, REPLY_PURPOSE_LABEL, SUPPORT_DEMO_LABEL,
  type ReplyLang, type ReplyPurpose, type SupportReplyResult,
} from "@/lib/ai/supportAssist";
import { TONE_LABEL, type RewriteTone } from "@/lib/ai/rewrite";

type Mode = "context" | "summary" | "troubleshoot" | "reply";
const MODES: [Mode, string][] = [["context", "Request context"], ["summary", "Summarize Request"], ["troubleshoot", "Suggest Troubleshooting Steps"], ["reply", "Draft Client Reply"]];
type Up = { s: "idle" } | { s: "loading" } | { s: "ready"; res: SupportReplyResult; edited: string };

/** Read-only AI assistant for one support request. Mount with key={requestId} so drafts never carry across requests. */
export function SupportAssistPanel({ requestId, assigneeName, onClose, onOpenResolution }: { requestId: string; assigneeName?: string; onClose: () => void; onOpenResolution?: () => void }) {
  const r = useCRM((s) => s.supportRequests.find((x) => x.id === requestId));
  const p = useCRM((s) => (r ? s.projects.find((x) => x.id === r.projectId) : undefined));
  const lead = useCRM((s) => (p?.leadId ? s.leads.find((l) => l.id === p.leadId) : undefined));
  const canWa = allows(useSession((s) => s.preview), "clients.whatsapp");
  const ctx = useMemo(() => (r && p ? buildSupportContext(r, p, assigneeName, dayKey(new Date())) : null), [r, p, assigneeName]);
  const [mode, setMode] = useState<Mode>("context");
  const [purpose, setPurpose] = useState<ReplyPurpose>("acknowledge");
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [lang, setLang] = useState<ReplyLang>("en");
  const [original, setOriginal] = useState("");
  const [up, setUp] = useState<Up>({ s: "idle" });
  const [lastPrev, setLastPrev] = useState<string | null>(null);
  const variant = useRef(0);
  if (!ctx) return null;
  const na = nextSupportAction(ctx);
  const sum = mode === "summary" ? summarizeRequest(ctx) : null;
  const tr = mode === "troubleshoot" ? troubleshoot(ctx) : null;
  const run = async (next = false) => {
    if (next) variant.current += 1;
    setUp({ s: "loading" });
    const res = await getSupportAssistProvider().reply({ ctx, purpose, tone, lang, variant: variant.current });
    setUp({ s: "ready", res, edited: res.text });
  };
  const issues = up.s === "ready" && !up.res.blocked ? replyViolations(ctx, original, up.edited) : [];
  const row = (k: string, v: React.ReactNode) => <div><dt>{k}</dt><dd>{v}</dd></div>;
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <label className="grid min-w-0 gap-1 text-[11px] font-semibold">{label}<select aria-label={label} className={cn(selectCls, "h-9 w-full min-w-0 text-xs")} value={value} onChange={(e) => { onChange(e.target.value); setUp({ s: "idle" }); }}>{opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  );
  const list = (items: string[], empty = NOT_RECORDED) => items.length ? <ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-muted-foreground">{empty}</p>;
  return (
    <section aria-label="Support AI Assist" className="mt-3 grid min-w-0 gap-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="support-assist" data-request={requestId}>
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-1"><div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Assist · Demo Mode</div><p className="text-xs text-muted-foreground">{SUPPORT_DEMO_LABEL} Nothing here changes the request, project or payments.</p></div>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Close Support AI Assist" onClick={onClose}><X className="size-4" /></Button>
      </div>

      <div className="rounded-xl border bg-muted/30 p-3" data-testid="sa-next" data-kind={na.kind}>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><Compass className="size-3.5" />Next best support action</div>
        <p className="text-sm font-medium">{na.title}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{na.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        {(na.kind === "add_resolution" || na.kind === "review_ready" || na.kind === "start") && onOpenResolution && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onOpenResolution}>Go to the request's actions</Button>}
        {na.kind === "ask_details" && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => { setMode("reply"); setPurpose("request_info"); setUp({ s: "idle" }); }}>Draft a request for details</Button>}
        <p className="mt-1 text-[11px] text-muted-foreground">Nothing is started, reassigned, resolved or reopened automatically.</p>
      </div>

      <div className="max-w-full overflow-x-auto"><div className="seg w-max" role="tablist" aria-label="Support AI actions">{MODES.map(([m, t]) => <button key={m} type="button" role="tab" aria-selected={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t}</button>)}</div></div>

      {mode === "context" && <dl className="pd-carry text-sm" data-testid="sa-context">
        {row("Client", ctx.clientName)}{row("Project", ctx.projectName)}
        {row("Request", ctx.title)}{row("Description", ctx.description ?? NOT_RECORDED)}
        {row("Status", `${ctx.statusText}${ctx.reopened ? " (reopened)" : ""}`)}
        {row("Assigned", ctx.assignee ?? NOT_RECORDED)}
        {row("Coverage", ctx.coverageText)}{row("Support terms", ctx.supportTerms)}
        {row("Resolution notes", ctx.resolution ?? NOT_RECORDED)}
        {row("Support history", ctx.history.length ? ctx.history.map((h) => `${dayLabel(h.at)}: ${h.change}`).join(" · ") : NOT_RECORDED)}
        <p className="col-span-full text-[11px] text-muted-foreground">Other projects, payments, proofs, login details and private notes are never included.</p>
      </dl>}

      {sum && <div className="grid gap-3 text-sm" data-testid="sa-summary">
        {sum.notices.map((n) => <p key={n} className="pd-note text-xs" role="status">{n}</p>)}
        <div><div className="text-xs font-semibold">Reported issue (client-reported, not verified)</div><p>{sum.reported}</p></div>
        <div><div className="text-xs font-semibold">Known facts</div>{list(sum.facts)}</div>
        <div><div className="text-xs font-semibold">Previous actions</div>{list(sum.previous)}</div>
        <div data-testid="sa-status"><div className="text-xs font-semibold">Current status</div><p>{sum.status}</p></div>
        <div><div className="text-xs font-semibold">Information still needed</div>{list(sum.needed, "Nothing obvious missing.")}</div>
        <div><div className="text-xs font-semibold">Suggested next action</div><p>{sum.next.title}</p></div>
        <p className="text-[11px] text-muted-foreground">No technical cause is inferred. Only recorded resolution notes count as verified findings.</p>
      </div>}

      {tr && <div className="grid gap-3 text-sm" data-testid="sa-troubleshoot" data-kind={tr.kind}>
        {tr.notices.map((n) => <p key={n} className="pd-note text-xs" role="status">{n}</p>)}
        {tr.steps.length > 0 && <div><div className="flex items-center gap-1.5 text-xs font-semibold"><Wrench className="size-3.5" />What to check next · {tr.label}</div><ol className="list-decimal pl-5">{tr.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>}
        <div><div className="text-xs font-semibold">Questions to ask the client</div>{list(tr.questions)}</div>
      </div>}

      {mode === "reply" && <div className="grid gap-3" data-testid="sa-reply">
        <div className="grid gap-2 sm:grid-cols-3">
          {sel("Reply purpose", purpose, (v) => setPurpose(v as ReplyPurpose), REPLY_PURPOSES.map((x) => [x, REPLY_PURPOSE_LABEL[x]]))}
          {sel("Writing style", tone, (v) => setTone(v as RewriteTone), (["professional", "friendly", "short"] as RewriteTone[]).map((x) => [x, TONE_LABEL[x]]))}
          {sel("Language", lang, (v) => setLang(v as ReplyLang), Object.entries(REPLY_LANG_LABEL))}
        </div>
        <label className="grid gap-1 text-[11px] font-semibold">Your draft (optional)<Textarea aria-label="Original reply draft" rows={2} value={original} onChange={(e) => setOriginal(e.target.value)} /></label>
        {up.s === "idle" && <Button type="button" size="sm" className="w-fit" onClick={() => void run()}><Sparkles className="size-3.5" />Draft Client Reply</Button>}
        {up.s === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Preparing demo draft…</p>}
        {up.s === "ready" && <div className="grid gap-2">
          <details className="text-xs"><summary className="cursor-pointer font-semibold"><FileText className="mr-1 inline size-3" />Context used</summary><ul className="mt-1 list-disc pl-5 text-muted-foreground">{supportContextUsed(ctx).map((x) => <li key={x}>{x}</li>)}</ul></details>
          {up.res.notices.map((n) => <p key={n} className="pd-note text-xs" role="status" data-testid="sa-notice">{n}</p>)}
          {!up.res.blocked && <>
            {original.trim() && <div className="text-xs"><div className="font-semibold">Original draft</div><p className="whitespace-pre-wrap text-muted-foreground">{original}</p></div>}
            <label className="grid gap-1 text-[11px] font-semibold">Suggested reply (editable)<Textarea aria-label="Suggested reply" rows={6} value={up.edited} onChange={(e) => setUp({ ...up, edited: e.target.value })} /></label>
            {issues.length > 0 && <ul className="pd-note list-disc pl-5 text-xs" role="alert" data-testid="sa-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
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
          {lead && canWa && <Button type="button" size="sm" variant="outline" onClick={() => openWhatsApp(lead.id, "Project Desk · AI support reply", { text: original })}><MessageCircle className="size-3.5" />Open in WhatsApp composer</Button>}
        </div>}
        <p className="text-[11px] text-muted-foreground">Never sent or logged automatically. Only messages you confirm as sent in the composer are recorded.</p>
      </div>}
    </section>
  );
}
