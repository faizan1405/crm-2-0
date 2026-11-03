import { Link, useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, X, Undo2, FlaskConical, Info, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";
import { getNotesProvider, type NoteMode, type NoteResult, type ActionItem } from "@/lib/ai/notes";
import { takeNoteDraft } from "@/lib/ai/noteDraft";
import type { LeadContext } from "@/lib/ai/types";

type St = { s: "idle" } | { s: "loading" } | { s: "ready"; res: NoteResult; for: string };

/**
 * Lead note editor (existing "Log" note workflow) with Demo AI Improve. Suggestions never change
 * the draft until "Use suggestion"; nothing is saved until the Owner presses "Save note".
 */
export function LeadNoteEditor({ leadId, lead, onSave, canFollowUp, onFollowUp }: {
  leadId: string; lead?: LeadContext | undefined; onSave: (text: string) => boolean; canFollowUp: boolean; onFollowUp: () => void;
}) {
  const [note, setNote] = useState("");
  const [fromCoach, setFromCoach] = useState(false);
  const [beforeAI, setBeforeAI] = useState<string | null>(null);
  const [mode, setMode] = useState<NoteMode>("structure");
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<St>({ s: "idle" });
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const d = takeNoteDraft(leadId);
    if (d !== undefined) { setNote(d); setFromCoach(true); requestAnimationFrame(() => { ref.current?.focus(); ref.current?.scrollIntoView({ block: "center" }); }); }
  }, [leadId]);
  const dirty = note.trim().length > 0;
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm("Discard your unsaved note?"), enableBeforeUnload: () => dirty });

  const run = async () => {
    const snap = note; setSt({ s: "loading" });
    try { setSt({ s: "ready", res: await getNotesProvider().run({ mode, text: snap, ...(lead ? { lead } : {}) }), for: snap }); }
    catch (e) { toast.error((e as { message?: string }).message ?? "Couldn't prepare a suggestion."); setSt({ s: "idle" }); }
  };
  const save = () => {
    const t = note.trim(); if (!t) return;
    if (!onSave(t)) return;
    setNote(""); setBeforeAI(null); setFromCoach(false); setSt({ s: "idle" }); setOpen(false);
  };
  const stale = st.s === "ready" && st.for !== note;
  const blocked = st.s === "ready" && st.res.violations.length > 0;
  const actionBtn = (a: ActionItem) => {
    if ((a.kind === "follow_up" || a.kind === "call_again") && canFollowUp) return <Button type="button" size="sm" variant="outline" onClick={onFollowUp}>Open follow-up form</Button>;
    if (a.kind === "prepare_quotation") return <Button type="button" size="sm" variant="outline" asChild><Link to="/sales-studio">Open Sales Studio</Link></Button>;
    if (a.kind === "discuss_objection") return <Button type="button" size="sm" variant="outline" asChild><Link to="/ai-copilot" search={{ lead: leadId, tab: "coach" }}>Open Objection Coach</Link></Button>;
    return null;
  };

  return (
    <div className="mb-4 grid gap-2" id="lead-note" data-testid="note-editor">
      <label htmlFor="lead-note-text" className="sr-only">New note</label>
      <Textarea ref={ref} id="lead-note-text" rows={note.includes("\n") ? 6 : 2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a note or call outcome…" />
      {fromCoach && <p className="text-[11px] text-muted-foreground" role="status" data-testid="note-from-coach">Draft from Sales Coach — not saved yet. Edit it, then press Save note.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={save} disabled={!dirty}>Save note</Button>
        {!open && <Button type="button" size="sm" variant="ghost" disabled={!dirty} onClick={() => setOpen(true)}><Sparkles className="size-3.5" />AI Improve</Button>}
        {beforeAI !== null && <Button type="button" size="sm" variant="ghost" onClick={() => { setNote(beforeAI); setBeforeAI(null); }}><Undo2 className="size-3.5" />Undo improvement</Button>}
      </div>
      {open && (
        <section aria-label="AI Improve note" className="grid gap-2.5 rounded-xl border bg-muted/30 p-3" data-testid="note-ai">
          <div className="flex items-center justify-between gap-2">
            <div className="eyebrow flex items-center gap-1.5"><FlaskConical className="size-3" />AI Improve · Demo Mode — not live AI</div>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close AI Improve" onClick={() => { setOpen(false); setSt({ s: "idle" }); }}><X className="size-3.5" /></Button>
          </div>
          <div role="tablist" aria-label="Improve mode" className="seg w-fit" onKeyDown={onRovingKeyDown}>
            {(["improve", "structure"] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} tabIndex={roving(mode === m)} onClick={() => { setMode(m); setSt({ s: "idle" }); }}>{m === "improve" ? "Improve" : "Structure Notes"}</button>)}
          </div>
          {st.s === "idle" && <Button type="button" size="sm" className="w-fit" onClick={() => void run()} disabled={!dirty}><Sparkles className="size-3.5" />Suggest</Button>}
          {st.s === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" />Preparing a demo suggestion…</p>}
          {st.s === "ready" && (
            <div className="grid gap-2" aria-live="polite">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="min-w-0"><div className="mb-1 text-[11px] font-semibold">Original</div><p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-2 text-xs" data-testid="note-original">{st.for}</p></div>
                <div className="min-w-0"><div className="mb-1 text-[11px] font-semibold">Suggestion · {st.res.label}</div><p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-2 text-xs" data-testid="note-suggestion">{st.res.text}</p></div>
              </div>
              {st.res.notice && <p className={cn("flex items-start gap-1.5 text-[11px]", st.res.supported ? "text-muted-foreground" : "font-medium")} data-testid="note-notice" data-supported={st.res.supported}><Info className="mt-0.5 size-3 shrink-0" />{st.res.notice}</p>}
              {blocked && <p role="alert" className="text-[11px] text-destructive">Can't use this suggestion: {st.res.violations.join(", ")}.</p>}
              {stale && <p role="status" className="text-[11px] text-muted-foreground">Your note changed since this suggestion — suggest again to update it.</p>}
              {st.res.actions.length > 0 && <div data-testid="note-actions"><div className="eyebrow mb-1">Possible next actions (suggestions)</div><ul className="grid gap-1.5">{st.res.actions.map((a) => (
                <li key={a.kind} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs" data-kind={a.kind}>
                  <div className="min-w-0"><div className="font-medium">{a.label}</div><div className="text-muted-foreground">From your note: “{a.evidence}”</div>
                    {a.confirmDate && <div className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="size-3" />{a.dateText ? `Date “${a.dateText}” is not exact — confirm it in the form.` : "No date given — choose one in the form."}</div>}</div>
                  {actionBtn(a)}
                </li>))}</ul></div>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={stale || blocked} onClick={() => { setBeforeAI(st.for); setNote(st.res.text); setSt({ s: "idle" }); setOpen(false); }}><Check className="size-3.5" />Use suggestion</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setSt({ s: "idle" }); setOpen(false); }}>Keep original</Button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Nothing is saved, scheduled or sent until you press Save note or save in a form that opens.</p>
        </section>
      )}
    </div>
  );
}
