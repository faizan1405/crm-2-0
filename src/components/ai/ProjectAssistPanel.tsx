import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNavigate } from "@tanstack/react-router";
import { Check, ClipboardList, Compass, FlaskConical, Loader2, MessageCircle, RotateCcw, Sparkles, X, ListChecks, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { cn } from "@/lib/utils";
import { useCRM } from "@/lib/crm/store";
import { useSession, allows } from "@/lib/crm/session";
import {
  buildProjectContext, contextUsed, dayLabel, deliveryOpen, getProjectAssistProvider, nextAction, structureRequirements, suggestTasks, taskStats, updateViolations,
  NOT_RECORDED, PROJECT_DEMO_LABEL, REQ_SECTION_LABEL, UPDATE_LANG_LABEL, UPDATE_PURPOSES, UPDATE_PURPOSE_LABEL,
  type ClientUpdateResult, type ReqSection, type StructuredBrief, type UpdateLang, type UpdatePurpose,
} from "@/lib/ai/projectAssist";
import { TONE_LABEL, type RewriteTone } from "@/lib/ai/rewrite";
import { useProjectTaskDraft } from "@/lib/ai/projectTaskDraft";

type Mode = "facts" | "structure" | "tasks" | "update";
const MODES: [Mode, string][] = [["facts", "Project facts"], ["structure", "Structure Requirements"], ["tasks", "Suggest Tasks"], ["update", "Draft Client Update"]];
type Up = { s: "idle" } | { s: "loading" } | { s: "ready"; res: ClientUpdateResult; edited: string; prev?: string };

/** Read-only AI assistant for one project. Mount with key={projectId} so drafts never carry across projects. */
export function ProjectAssistPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const src = useCRM(useShallow((s) => ({ projects: s.projects, tasks: s.projectTasks, ms: s.projectMilestones, reqs: s.supportRequests, leads: s.leads })));
  const preview = useSession((s) => s.preview);
  const canWa = allows(preview, "clients.whatsapp");
  const p = src.projects.find((x) => x.id === projectId);
  const ctx = useMemo(() => (p ? buildProjectContext(p, src.tasks, src.ms, src.reqs.filter((r) => r.projectId === p.id && (r.status === "open" || r.status === "in_progress")).length) : null), [p, src.tasks, src.ms, src.reqs]);
  const navigate = useNavigate();
  const setDraft = useProjectTaskDraft((s) => s.set);
  const [mode, setMode] = useState<Mode>("facts");
  const [briefSrc, setBriefSrc] = useState<"recorded" | "custom">("recorded");
  const [brief, setBrief] = useState("");
  const [structured, setStructured] = useState<StructuredBrief | null>(null);
  const [purpose, setPurpose] = useState<UpdatePurpose>("status");
  const [tone, setTone] = useState<RewriteTone>("professional");
  const [lang, setLang] = useState<UpdateLang>("en");
  const [original, setOriginal] = useState("");
  const [up, setUp] = useState<Up>({ s: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const variant = useRef(0);
  if (!p || !ctx) return null;
  const s = taskStats(ctx);
  const na = nextAction(ctx);
  const tasks = suggestTasks(ctx);
  const lead = p.leadId ? src.leads.find((l) => l.id === p.leadId) : undefined;
  const recordedBrief = [ctx.scope, ...ctx.requirements.map((r) => r.label)].filter(Boolean).join("\n");
  const runUpdate = async (next = false) => {
    if (next) variant.current += 1;
    setUp({ s: "loading" });
    const res = await getProjectAssistProvider().clientUpdate({ ctx, purpose, tone, lang, variant: variant.current });
    setUp({ s: "ready", res, edited: res.text });
  };
  const issues = up.s === "ready" && !up.res.blocked ? updateViolations(ctx, original, up.edited) : [];
  const row = (k: string, v: React.ReactNode) => <div><dt>{k}</dt><dd>{v}</dd></div>;
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <label className="grid min-w-0 gap-1 text-[11px] font-semibold">{label}<select aria-label={label} className={cn(selectCls, "h-9 w-full min-w-0 text-xs")} value={value} onChange={(e) => { onChange(e.target.value); setUp({ s: "idle" }); }}>{opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  );
  return (
    <section aria-label="Project AI Assist" className="receipt mb-6 grid gap-4 p-4 sm:p-5" data-testid="project-assist" data-project={projectId}>
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-1"><div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Assist · Demo Mode</div><p className="text-xs text-muted-foreground">{PROJECT_DEMO_LABEL} Nothing here changes the project, tasks, deals or payments.</p></div>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Close AI Assist" onClick={onClose}><X className="size-4" /></Button>
      </div>

      <div className="rounded-xl border bg-muted/30 p-3" data-testid="pa-next">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><Compass className="size-3.5" />Recommended next action</div>
        <p className="text-sm font-medium">{na.title}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{na.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>

      <div className="max-w-full overflow-x-auto"><div className="seg w-max" role="tablist" aria-label="AI Assist actions">{MODES.map(([m, t]) => <button key={m} type="button" role="tab" aria-selected={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t}</button>)}</div></div>

      {mode === "facts" && <dl className="pd-carry text-sm" data-testid="pa-facts">
        {row("Project", ctx.name)}{row("Client", `${ctx.clientName}${ctx.company ? ` · ${ctx.company}` : ""}`)}
        {row("Stage", `${ctx.stageText} · ${ctx.statusText}`)}
        {row("Scope", ctx.scope ?? NOT_RECORDED)}
        {row("Requirements", ctx.requirements.length ? ctx.requirements.map((r) => `${r.done ? "✓" : "○"} ${r.label}`).join(" · ") : NOT_RECORDED)}
        {row("Tasks", s.total ? `${s.done} of ${s.total} complete${s.open ? ` · open: ${ctx.tasks.filter((t) => !t.done).map((t) => t.title).join(", ")}` : ""}` : NOT_RECORDED)}
        {row("Milestones", ctx.milestones.length ? ctx.milestones.map((m) => `${m.title} ${m.done}/${m.total}${m.complete ? " ✓" : ""}${m.dueDate ? ` (${dayLabel(m.dueDate)})` : ""}`).join(" · ") : NOT_RECORDED)}
        {row("Waiting on client", ctx.waitingOnClient.length ? ctx.waitingOnClient.join(", ") : "Nothing recorded")}
        {row("Delivery checklist", ctx.qa.length + ctx.handover.length ? `${ctx.qa.length + ctx.handover.length - deliveryOpen(ctx).length} of ${ctx.qa.length + ctx.handover.length} done` : NOT_RECORDED)}
        {row("Target delivery", ctx.targetDelivery ? dayLabel(ctx.targetDelivery) : NOT_RECORDED)}
        {row("Delivery", ctx.delivery ? `Delivered ${dayLabel(ctx.delivery.date)}` : "Not delivered")}
        <p className="col-span-full text-[11px] text-muted-foreground">Payments, proofs, phone, email, internal notes and other clients are never included.</p>
      </dl>}

      {mode === "structure" && <div className="grid gap-3" data-testid="pa-structure">
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" name={`bs-${projectId}`} checked={briefSrc === "recorded"} onChange={() => { setBriefSrc("recorded"); setStructured(null); }} />Use recorded scope & requirements</label>
          <label className="flex items-center gap-1.5"><input type="radio" name={`bs-${projectId}`} checked={briefSrc === "custom"} onChange={() => { setBriefSrc("custom"); setStructured(null); }} />Enter a brief</label>
        </div>
        {briefSrc === "custom" ? <Textarea aria-label="Project brief" rows={5} value={brief} onChange={(e) => { setBrief(e.target.value); setStructured(null); }} placeholder="Paste or type the client's brief…" /> : <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs">{recordedBrief || NOT_RECORDED}</pre>}
        <Button type="button" size="sm" className="w-fit" onClick={() => setStructured(structureRequirements(briefSrc === "custom" ? brief : recordedBrief, ctx))}><ClipboardList className="size-3.5" />Structure Requirements</Button>
        {structured && <div className="grid gap-3 text-sm" data-testid="pa-structured">
          {structured.notices.map((n) => <p key={n} className="pd-note text-xs" role="status">{n}</p>)}
          <div><div className="text-xs font-semibold">Recorded on the Project</div>{structured.recorded.length ? <ul className="list-disc pl-5">{structured.recorded.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-muted-foreground">{NOT_RECORDED}</p>}</div>
          {(Object.keys(REQ_SECTION_LABEL) as ReqSection[]).map((k) => structured.sections[k].length > 0 && <div key={k} data-section={k}><div className="text-xs font-semibold">{REQ_SECTION_LABEL[k]}</div><ul className="list-disc pl-5">{structured.sections[k].map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
          <div data-section="missing"><div className="text-xs font-semibold">Missing information</div>{structured.missing.length ? <ul className="list-disc pl-5">{structured.missing.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-muted-foreground">Nothing obvious missing.</p>}</div>
          <div data-section="questions"><div className="text-xs font-semibold">Questions to clarify</div>{structured.questions.length ? <ul className="list-disc pl-5">{structured.questions.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-muted-foreground">None.</p>}</div>
          {structured.limited && <div><div className="text-xs font-semibold">Original brief (unchanged)</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs">{structured.original}</pre></div>}
          <p className="text-[11px] text-muted-foreground">This is a reading aid only. Brief lines are not confirmed deliverables and nothing was added to the project.</p>
        </div>}
      </div>}

      {mode === "tasks" && <div className="grid gap-2" data-testid="pa-tasks">
        {tasks.notices.map((n) => <p key={n} className="pd-note text-xs" role="status">{n}</p>)}
        <ul className="grid gap-2">{tasks.suggestions.map((t) => <li key={t.id} className="rounded-xl border p-3 text-sm" data-testid="pa-suggestion" data-dup={t.duplicateOf ? "1" : "0"}>
          <div className="font-medium">{t.title}</div>
          <div className="text-xs text-muted-foreground">{t.description}</div>
          <div className="text-xs">Why: {t.reason}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {t.duplicateOf ? <span className="pd-pill">Already a task: “{t.duplicateOf}”</span> : <span className="text-xs text-muted-foreground">No matching task yet</span>}
            <Button type="button" size="sm" variant="outline" disabled={!!t.duplicateOf} onClick={() => { setDraft({ projectId, title: t.title, reason: t.reason }); void navigate({ to: "/projects/$id", params: { id: projectId }, search: { tab: "tasks" } }); toast.message("Draft placed in Add task — review it and click Add to save."); }}><ListChecks className="size-3.5" />Open in Add task</Button>
          </div>
        </li>)}</ul>
        <p className="text-[11px] text-muted-foreground">Suggestions never create tasks, assign people, set deadlines or change stages.</p>
      </div>}

      {mode === "update" && <div className="grid gap-3" data-testid="pa-update">
        <div className="grid gap-2 sm:grid-cols-3">
          {sel("Update purpose", purpose, (v) => setPurpose(v as UpdatePurpose), UPDATE_PURPOSES.map((x) => [x, UPDATE_PURPOSE_LABEL[x]]))}
          {sel("Writing style", tone, (v) => setTone(v as RewriteTone), (["professional", "friendly", "short"] as RewriteTone[]).map((x) => [x, TONE_LABEL[x]]))}
          {sel("Language", lang, (v) => setLang(v as UpdateLang), Object.entries(UPDATE_LANG_LABEL))}
        </div>
        <label className="grid gap-1 text-[11px] font-semibold">Your draft (optional)<Textarea aria-label="Original draft" rows={2} value={message ?? original} onChange={(e) => { setMessage(null); setOriginal(e.target.value); }} /></label>
        {up.s === "idle" && <Button type="button" size="sm" className="w-fit" onClick={() => void runUpdate()}><Sparkles className="size-3.5" />Draft Client Update</Button>}
        {up.s === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Preparing demo draft…</p>}
        {up.s === "ready" && <div className="grid gap-2">
          <details className="text-xs"><summary className="cursor-pointer font-semibold">Context used</summary><ul className="mt-1 list-disc pl-5 text-muted-foreground">{contextUsed(ctx).map((x) => <li key={x}>{x}</li>)}</ul></details>
          {up.res.notices.map((n) => <p key={n} className="pd-note text-xs" role="status">{n}</p>)}
          {!up.res.blocked && <>
            {original.trim() && <div className="text-xs"><div className="font-semibold">Original draft</div><p className="whitespace-pre-wrap text-muted-foreground">{original}</p></div>}
            <label className="grid gap-1 text-[11px] font-semibold">Proposed message (editable)<Textarea aria-label="Proposed message" rows={6} value={up.edited} onChange={(e) => setUp({ ...up, edited: e.target.value })} /></label>
            {issues.length > 0 && <ul className="pd-note list-disc pl-5 text-xs" role="alert" data-testid="pa-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          </>}
          <div className="flex flex-wrap gap-2">
            {!up.res.blocked && <Button type="button" size="sm" disabled={issues.length > 0} onClick={() => { const prev = original; setOriginal(up.edited); setUp({ s: "idle" }); setMessage(null); setLastPrev(prev); toast.success("Suggestion placed in your draft. Nothing was sent."); }}><Check className="size-3.5" />Use Suggestion</Button>}
            <Button type="button" size="sm" variant="outline" onClick={() => setUp({ s: "idle" })}><X className="size-3.5" />Keep Original</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void runUpdate(true)}><RotateCcw className="size-3.5" />Try Again</Button>
          </div>
        </div>}
        {lastPrev !== null && up.s === "idle" && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => { setOriginal(lastPrev); setLastPrev(null); }}><RotateCcw className="size-3.5" />Undo Improvement</Button>}
        {original.trim() && up.s === "idle" && <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(original).then(() => toast.success("Copied")); }}><Copy className="size-3.5" />Copy</Button>
          {lead && canWa && <Button type="button" size="sm" variant="outline" onClick={() => openWhatsApp(lead.id, "Project Desk · AI client update", { text: original })}><MessageCircle className="size-3.5" />Open in WhatsApp composer</Button>}
        </div>}
        <p className="text-[11px] text-muted-foreground">Never sent automatically. Only messages you confirm as sent in the composer are recorded.</p>
      </div>}
    </section>
  );
}
