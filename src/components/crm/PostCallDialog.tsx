import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { activeFollowUp } from "@/lib/crm/followups";
import { uid, formatDateTime } from "@/lib/crm/format";
import { CALL_OUTCOMES, DATE_SHORTCUTS, callLogError, needsStageConfirm, outcomeStage, shortcutValue, toISO, type CallOutcome } from "@/lib/crm/calllog";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

/**
 * UI-only call state. `pending` survives a refresh / returning from the dialer so the
 * log stays available; nothing is recorded until the user saves.
 */
export const useCallLog = create<{
  pending: { leadId: string; source: string } | null;
  leadId: string | null;
  start: (leadId: string, source: string) => void;
  open: (id: string) => void;
  close: () => void;
}>()(
  persist(
    (set) => ({
      pending: null,
      leadId: null,
      start: (leadId, source) => set({ pending: { leadId, source } }),
      open: (leadId) => set({ leadId }),
      close: () => set({ leadId: null, pending: null }),
    }),
    { name: "scale-flow-call-pending", storage: createJSONStorage(() => localStorage), skipHydration: true, partialize: (s) => ({ pending: s.pending }) },
  ),
);

/** Use on any Call link: the device dialer opens via tel:, then the same log opens for this lead. */
export function startCall(leadId: string, source: string) {
  useCallLog.getState().start(leadId, source);
  setTimeout(() => { const p = useCallLog.getState().pending; if (p?.leadId === leadId) useCallLog.getState().open(leadId); }, 400);
}

export function PostCallDialog() {
  const { leadId, pending, open: openLog, close } = useCallLog();
  const { leads, followUps, logCall, undoCall } = useCRM();
  const [conflictChoice, setConflictChoice] = useState<"keep" | "replace" | null>(null);
  const opId = useRef("");
  const lead = leads.find((l) => l.id === leadId);
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [needFollow, setNeedFollow] = useState(true);
  const [when, setWhen] = useState("");
  const [stage, setStage] = useState<LeadStatus>("new");
  const [confirmed, setConfirmed] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Restore an unfinished call after refresh, and reopen when returning from the dialer.
  useEffect(() => {
    void Promise.resolve(useCallLog.persist.rehydrate()).then(() => {
      const p = useCallLog.getState().pending;
      if (p && useCRM.getState().leads.some((l) => l.id === p.leadId)) useCallLog.getState().open(p.leadId);
      else if (p) useCallLog.getState().close();
    });
    const onVisible = () => { const p = useCallLog.getState().pending; if (document.visibilityState === "visible" && p) useCallLog.getState().open(p.leadId); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!lead) return;
    setOutcome(null); setNotes(""); setNeedFollow(true); setWhen(shortcutValue("Tomorrow")); setStage(lead.status);
    setConfirmed(false); setLostReason(""); setSaving(false); savingRef.current = false; setConflictChoice(null); opId.current = uid("op");
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: CallOutcome) => {
    setOutcome(o); setConfirmed(false);
    if (lead) setStage(outcomeStage(o, lead.status));
    if (o === "Won" || o === "Lost" || o === "Not interested") setNeedFollow(false);
  };
  const changeStage = (s: LeadStatus) => { setStage(s); setConfirmed(false); };

  const active = lead ? activeFollowUp(followUps, lead.id) : undefined;
  const confirmNeeded = !!lead && needsStageConfirm(stage, lead.status);

  const save = (andOpen: boolean) => {
    if (!lead || savingRef.current) return;
    const err = callLogError({ outcome, stage, current: lead.status, confirmed, lostReason });
    if (err) { toast.error(err); return; }
    if (needFollow && when && active && !conflictChoice) { toast.error("Choose Keep existing or Replace for the follow-up"); return; }
    savingRef.current = true; setSaving(true);
    const source = pending?.leadId === lead.id ? pending.source : "CRM";
    const r = logCall({ opId: opId.current, leadId: lead.id, outcome: outcome!, notes, stage, lostReason, source, ...(needFollow && when ? { followUp: { dueAt: toISO(when), type: "call" as const } } : {}), ...(conflictChoice ? { onConflict: conflictChoice } : {}) });
    if (!r.ok) { toast.error(r.error ?? "Resolve the follow-up conflict first"); savingRef.current = false; setSaving(false); return; }
    const done = r.opId;
    toast.success("Call outcome saved", { duration: 8000, action: { label: "Undo", onClick: () => { const e = undoCall(done); if (e) toast.error(e); else toast.success("Call log undone"); } } });
    const id = lead.id;
    close();
    if (andOpen) navigate({ to: "/leads/$id", params: { id } });
  };

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && close()}>
      <DialogContent className="call-log max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><PhoneCall className="size-4" /></span>Log call · {lead?.name}</DialogTitle>
          <DialogDescription className="num">{lead?.phone}{lead?.company ? ` · ${lead.company}` : ""} · nothing is saved until you choose Save</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div><div className="mb-2 text-xs font-semibold text-muted-foreground">Outcome</div>
            <div className="flex flex-wrap gap-1.5">{CALL_OUTCOMES.map((o) => <button key={o} type="button" onClick={() => pick(o)} aria-pressed={outcome === o} className={cn("outcome-chip", outcome === o && "is-active")}>{o}</button>)}</div></div>
          <Textarea aria-label="Call notes" rows={3} placeholder="Quick notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">Stage {lead && outcome && stage !== lead.status ? <span className="font-normal">suggested from outcome — change if needed</span> : null}<select aria-label="Stage after call" className={selectCls} value={stage} onChange={(e) => changeStage(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          {confirmNeeded && (
            <div className={cn("call-confirm grid gap-2 rounded-lg border p-3", stage === "lost" ? "border-destructive/40 bg-destructive-soft" : "border-success/40 bg-success-soft")}>
              <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4" />Move {lead?.name} to {STATUS_LABEL[stage]}?</div>
              {stage === "lost" && <Input aria-label="Lost reason" placeholder="Lost reason (required)" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-label="Confirm stage change" />Yes, mark as {STATUS_LABEL[stage]}</label>
            </div>
          )}
          <div className="rounded-lg border p-3">
            <label className="flex items-center justify-between text-sm font-medium">Schedule next follow-up<Switch checked={needFollow} onCheckedChange={setNeedFollow} aria-label="Follow-up required" /></label>
            {needFollow && <div className="mt-3 grid gap-2">
              <div className="flex flex-wrap gap-1.5">{DATE_SHORTCUTS.map((s) => { const v = shortcutValue(s); return <button key={s} type="button" onClick={() => setWhen(v)} className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors active:scale-95", when === v ? "border-teal bg-teal-soft text-teal" : "hover:bg-muted")}>{s}</button>; })}</div>
              <Input type="datetime-local" aria-label="Follow-up date and time" value={when} onChange={(e) => setWhen(e.target.value)} />
              {active && when && <div className="fu-conflict grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5 text-warning" />Already has a {active.type} follow-up · {formatDateTime(active.dueAt)}</div>
                {active.note && <div className="text-muted-foreground">{active.note}</div>}
                <div className="flex gap-1.5">{([["keep", "Keep existing"], ["replace", `Replace with ${formatDateTime(toISO(when))}`]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={conflictChoice === k} onClick={() => setConflictChoice(k)} className={cn("rounded-md border px-2.5 py-1", conflictChoice === k ? "border-primary bg-primary-soft text-primary" : "bg-card hover:bg-muted")}>{l}</button>)}</div>
              </div>}
            </div>}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={close} disabled={saving}>Skip for now</Button>
          <div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={() => save(true)}>Save & open lead</Button><Button disabled={saving} onClick={() => save(false)}>Save & close</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Same reopen helper used by "Log call" buttons that don't dial. */
export const openCallLog = (leadId: string, source: string) => { useCallLog.getState().start(leadId, source); useCallLog.getState().open(leadId); };
