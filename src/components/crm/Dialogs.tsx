import { useState } from "react";
import { toast } from "sonner";
import { useCRM } from "@/lib/crm/store";
import { FOLLOWUP_LABEL, type FollowUpType } from "@/lib/crm/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "./Shell";

export function FollowUpDialog({ open, onOpenChange, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; leadId?: string }) {
  const { leads, addFollowUp } = useCRM();
  const [lead, setLead] = useState(leadId ?? "");
  const [type, setType] = useState<FollowUpType>("call");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const target = leadId ?? lead;
  const save = () => {
    if (!target || !at) { toast.error("Choose a lead and a date/time"); return; }
    addFollowUp({ leadId: target, type, dueAt: new Date(at).toISOString(), ...(note ? { note } : {}) });
    toast.success("Follow-up scheduled");
    setAt(""); setNote(""); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule follow-up</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {!leadId && (
            <div className="grid gap-1.5"><Label>Lead</Label>
              <select className={selectCls} value={lead} onChange={(e) => setLead(e.target.value)}>
                <option value="">Select a lead…</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Type</Label><select className={selectCls} value={type} onChange={(e) => setType(e.target.value as FollowUpType)}>{Object.entries(FOLLOWUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="fu-at">When</Label><Input id="fu-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save}>Schedule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LostReasonDialog({ leadName, open, onCancel, onConfirm }: { leadName?: string; open: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const presets = ["Budget too low", "Went with competitor", "No response", "Timing not right"];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark {leadName ?? "lead"} as lost</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">{presets.map((p) => <button key={p} onClick={() => setReason(p)} className="rounded-full border px-3 py-1 text-xs hover:border-primary hover:text-primary">{p}</button>)}</div>
        <Textarea placeholder="Why was this lead lost?" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={() => { if (!reason.trim()) { toast.error("Add a reason"); return; } onConfirm(reason.trim()); setReason(""); }}>Mark as lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
