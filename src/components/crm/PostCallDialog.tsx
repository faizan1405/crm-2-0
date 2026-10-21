import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { create } from "zustand";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { CALL_OUTCOMES, DATE_SHORTCUTS, outcomeStage, shortcutValue, toISO, type CallOutcome } from "@/lib/crm/calllog";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

/** UI-only trigger state for the post-call popup. */
export const useCallLog = create<{ leadId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  leadId: null,
  open: (leadId) => set({ leadId }),
  close: () => set({ leadId: null }),
}));

/** Use on any Call link: logs the call and opens the quick log after the dialer launches. */
export function startCall(leadId: string, source: string) {
  useCRM.getState().addActivity(leadId, `Called from ${source}`, "call");
  setTimeout(() => useCallLog.getState().open(leadId), 400);
}

export function PostCallDialog() {
  const { leadId, close } = useCallLog();
  const { leads, updateLead, addActivity, addFollowUp } = useCRM();
  const lead = leads.find((l) => l.id === leadId);
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [needFollow, setNeedFollow] = useState(true);
  const [when, setWhen] = useState("");
  const [stage, setStage] = useState<LeadStatus>("new");

  useEffect(() => {
    if (!lead) return;
    setOutcome(null); setNotes(""); setNeedFollow(true); setWhen(shortcutValue("Tomorrow")); setStage(lead.status);
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: CallOutcome) => { setOutcome(o); if (lead) setStage(outcomeStage(o, lead.status)); if (o === "Won" || o === "Lost" || o === "Not interested") setNeedFollow(false); };

  const save = (open: boolean) => {
    if (!lead) return;
    if (!outcome) { toast.error("Pick a call outcome"); return; }
    if (stage !== lead.status) {
      const ok = updateLead(lead.id, { status: stage, ...(stage === "lost" ? { lostReason: notes.trim() || outcome } : {}) });
      if (!ok) { toast.error("Could not update stage"); return; }
    }
    updateLead(lead.id, { lastContact: new Date().toISOString() });
    addActivity(lead.id, `Call outcome: ${outcome}${notes.trim() ? ` — ${notes.trim()}` : ""}`, "call");
    if (needFollow && when) addFollowUp({ leadId: lead.id, type: "call", dueAt: toISO(when), note: notes.trim() || `After call: ${outcome}` });
    toast.success("Call logged");
    close();
    if (open) navigate({ to: "/leads/$id", params: { id: lead.id } });
  };

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><PhoneCall className="size-4" /></span>Log call · {lead?.name}</DialogTitle>
          <DialogDescription className="num">{lead?.phone}{lead?.company ? ` · ${lead.company}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div><div className="mb-2 text-xs font-semibold text-muted-foreground">Outcome</div>
            <div className="flex flex-wrap gap-1.5">{CALL_OUTCOMES.map((o) => <button key={o} type="button" onClick={() => pick(o)} aria-pressed={outcome === o} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-95", outcome === o ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50")}>{o}</button>)}</div></div>
          <Textarea aria-label="Call notes" rows={3} placeholder="Quick notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">Stage<select aria-label="Stage after call" className={selectCls} value={stage} onChange={(e) => setStage(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <div className="rounded-lg border p-3">
            <label className="flex items-center justify-between text-sm font-medium">Schedule next follow-up<Switch checked={needFollow} onCheckedChange={setNeedFollow} aria-label="Follow-up required" /></label>
            {needFollow && <div className="mt-3 grid gap-2">
              <div className="flex flex-wrap gap-1.5">{DATE_SHORTCUTS.map((s) => { const v = shortcutValue(s); return <button key={s} type="button" onClick={() => setWhen(v)} className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors", when === v ? "border-teal bg-teal-soft text-teal" : "hover:bg-muted")}>{s}</button>; })}</div>
              <Input type="datetime-local" aria-label="Follow-up date and time" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={close}>Skip for now</Button>
          <div className="flex gap-2"><Button variant="outline" onClick={() => save(true)}>Save & open lead</Button><Button onClick={() => save(false)}>Save & close</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
