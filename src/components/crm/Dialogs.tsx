import { runFollowUp } from "@/components/crm/conflictFeedback";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { uid, formatDateTime } from "@/lib/crm/format";
import { toast } from "sonner";
import { useCRM } from "@/lib/crm/store";
import { FOLLOWUP_LABEL, type FollowUpType, type FollowUp } from "@/lib/crm/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { businessDateTime } from "@/lib/crm/dates";
import { selectCls } from "./Shell";
import { useAccess, followUpPermission, FOLLOWUP_DENIED } from "@/lib/crm/session";

export interface FollowUpDraft { at?: string; type?: FollowUpType; note?: string }

/** Side-by-side existing vs requested follow-up with Keep / Replace / Cancel. */
export function FollowUpConflict({ existing, requested, onKeep, onReplace, onCancel, compact }: { existing: FollowUp; requested: { dueAt: string; type: FollowUpType; note?: string }; onKeep: () => void; onReplace: () => void; onCancel?: () => void; compact?: boolean }) {
  const card = (title: string, f: { dueAt: string; type: FollowUpType; note?: string }, tone: string) => (
    <div className={`rounded-lg border p-3 ${tone}`}><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div><div className="mt-1 text-sm font-semibold">{FOLLOWUP_LABEL[f.type]} · {formatDateTime(f.dueAt)}</div><div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.note || "No notes"}</div></div>
  );
  return (
    <div role="alertdialog" aria-label="Follow-up conflict" className="fu-conflict grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-warning" />This lead already has an active follow-up</div>
      <div className="grid gap-2 sm:grid-cols-2">{card("Existing", existing, "bg-card")}{card("New", requested, "border-primary/40 bg-card")}</div>
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "justify-end"}`}>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button size="sm" variant="outline" onClick={onKeep}>Keep existing</Button>
        <Button size="sm" onClick={onReplace}>Replace with new</Button>
      </div>
    </div>
  );
}

type FollowUpDialogProps = { open: boolean; onOpenChange: (o: boolean) => void; leadId?: string; initial?: FollowUpDraft; rescheduleId?: string };
/** Never shows a working-looking form the employee can't submit; the store still refuses the write on its own. */
export function FollowUpDialog(props: FollowUpDialogProps) {
  const { can } = useAccess();
  const allowed = can(followUpPermission(!!props.rescheduleId));
  const { open, onOpenChange } = props;
  useEffect(() => { if (open && !allowed) { toast.error(FOLLOWUP_DENIED); onOpenChange(false); } }, [open, allowed, onOpenChange]);
  return allowed ? <FollowUpForm {...props} /> : null;
}
function FollowUpForm({ open, onOpenChange, leadId, initial, rescheduleId }: { open: boolean; onOpenChange: (o: boolean) => void; leadId?: string; initial?: FollowUpDraft; rescheduleId?: string }) {
  const { leads, addFollowUp, rescheduleFollowUp } = useCRM();
  const [lead, setLead] = useState(leadId ?? "");
  const [type, setType] = useState<FollowUpType>("call");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState<FollowUp | null>(null);
  const opId = useRef(uid("op"));
  // Reschedule: the due time the user saw when opening; a different saved time means another tab changed it.
  const baseDue = useRef<string | undefined>(undefined);
  const [staleDue, setStaleDue] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    opId.current = uid("op"); setConflict(null); setStaleDue(null);
    baseDue.current = rescheduleId ? useCRM.getState().followUps.find((x) => x.id === rescheduleId)?.dueAt : undefined;
    setType(initial?.type ?? "call"); setAt(initial?.at ?? ""); setNote(initial?.note ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = open && (type !== (initial?.type ?? "call") || at !== (initial?.at ?? "") || note !== (initial?.note ?? "") || (!leadId && !!lead));
  const target = leadId ?? lead;
  const done = (msg: string) => { toast.success(msg); setAt(""); setNote(""); setConflict(null); onOpenChange(false); };
  const save = (replaceId?: string) => {
    if (!target || !at) { toast.error("Choose a lead and a date/time"); return; }
    if (rescheduleId) {
      const ok = runFollowUp(() => rescheduleFollowUp(rescheduleId, businessDateTime(at), baseDue.current));
      if (ok) { setAt(""); setNote(""); setStaleDue(null); onOpenChange(false); return; }
      const live = useCRM.getState().followUps.find((x) => x.id === rescheduleId);
      if (live && live.dueAt !== baseDue.current && !live.completedAt && !live.cancelledAt) setStaleDue(live.dueAt); else onOpenChange(false);
      return;
    }
    const r = addFollowUp({ leadId: target, type, dueAt: businessDateTime(at), opId: opId.current, ...(note ? { note } : {}) }, replaceId ? { replaceId } : undefined);
    if (r.ok) done(replaceId ? "Follow-up replaced" : "Follow-up scheduled");
    else if (r.conflict) setConflict(r.conflict);
    else toast.error(r.error ?? "Could not schedule");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dirty={dirty}>
        <DialogHeader><DialogTitle>{rescheduleId ? "Reschedule follow-up" : "Schedule follow-up"}</DialogTitle>{leadId && <p className="text-sm" data-testid="fu-for" data-lead={leadId}>For <span className="font-semibold">{leads.find((l) => l.id === leadId)?.name ?? "Unknown lead"}</span></p>}{initial?.at && <DialogDescription>Suggested time — review and change before saving. Times are India time (IST).</DialogDescription>}</DialogHeader>
        <div className="grid gap-3">
          {!leadId && (
            <div className="grid gap-1.5"><Label htmlFor="fu-lead">Lead</Label>
              <select id="fu-lead" className={selectCls} value={lead} onChange={(e) => { setLead(e.target.value); setConflict(null); }}>
                <option value="">Select a lead…</option>
                {open && leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="fu-type">Type</Label><select id="fu-type" disabled={!!rescheduleId} className={selectCls} value={type} onChange={(e) => setType(e.target.value as FollowUpType)}>{Object.entries(FOLLOWUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="fu-at">When (IST)</Label><Input id="fu-at" type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setConflict(null); }} /></div>
          </div>
          {!rescheduleId && <div className="grid gap-1.5"><Label htmlFor="fu-note">Note</Label><Textarea id="fu-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
          {conflict && at && <FollowUpConflict existing={conflict} requested={{ dueAt: businessDateTime(at), type, note }} onCancel={() => onOpenChange(false)} onKeep={() => done("Kept the existing follow-up")} onReplace={() => save(conflict.id)} />}
        </div>
        {staleDue && <div role="alert" className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"><p className="font-medium">This follow-up was updated in another tab. Review the latest schedule before saving.</p><p className="text-xs text-muted-foreground">Latest saved time: {formatDateTime(staleDue)}. Your new time is kept below; nothing was saved.</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { baseDue.current = staleDue; setStaleDue(null); }}>Replace with my new time</Button><Button size="sm" variant="ghost" onClick={() => { setStaleDue(null); onOpenChange(false); }}>Keep latest</Button></div></div>}
        {!conflict && <DialogFooter><Button onClick={() => save()}>{rescheduleId ? "Reschedule" : "Schedule"}</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function LostReasonDialog({ leadName, open, onCancel, onConfirm }: { leadName?: string; open: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const presets = ["Budget too low", "Went with competitor", "No response", "Timing not right"];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(""); onCancel(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark {leadName ?? "lead"} as lost</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">{presets.map((p) => <Button variant="outline" size="sm" key={p} onClick={() => setReason(p)} className="rounded-full border px-3 py-1 text-xs hover:border-primary hover:text-primary">{p}</Button>)}</div>
        <Textarea placeholder="Why was this lead lost?" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setReason(""); onCancel(); }}>Cancel</Button>
          <Button variant="destructive" onClick={() => { if (!reason.trim()) { toast.error("Add a reason"); return; } onConfirm(reason.trim()); setReason(""); }}>Mark as lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
