import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { MessageCircle, MessagesSquare, FileText, LayoutTemplate, PenLine, Copy, ExternalLink, AlertTriangle, Check } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { STATUS_LABEL } from "@/lib/crm/types";
import { formatINR } from "@/lib/crm/format";
import { WA_LABEL, WA_PURPOSES, draftMessage, waLink, waNumber, type WaPurpose } from "@/lib/crm/whatsapp";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** UI-only state: which lead the composer is open for. Never persisted. */
export const useWhatsApp = create<{ leadId: string | null; source: string; open: (leadId: string, source: string) => void; close: () => void }>()((set) => ({
  leadId: null, source: "", open: (leadId, source) => set({ leadId, source }), close: () => set({ leadId: null }),
}));
export const openWhatsApp = (leadId: string, source: string) => useWhatsApp.getState().open(leadId, source);

const ICON: Record<WaPurpose, typeof FileText> = { followup: MessagesSquare, quotation: FileText, samples: LayoutTemplate, custom: PenLine };
const HINT: Record<WaPurpose, string> = { followup: "Continue the conversation", quotation: "Pricing, proposal or offer", samples: "Share website examples", custom: "Write from scratch" };

/** Icon button for any WhatsApp action point — always opens the composer, never WhatsApp directly. */
export function WhatsAppButton({ leadId, name, source, label, className }: { leadId: string; name: string; source: string; label?: boolean; className?: string }) {
  return <button type="button" draggable={false} aria-label={`WhatsApp ${name}`} title={`WhatsApp ${name}`} onClick={(e) => { e.stopPropagation(); openWhatsApp(leadId, source); }} className={cn("wa-btn", label && "has-label", className)}><MessageCircle className="size-3.5" />{label && <span>WhatsApp</span>}</button>;
}

export function WhatsAppComposer() {
  const { leadId, source, close } = useWhatsApp();
  const { leads, deals, owner, business, addActivity } = useCRM();
  const lead = leads.find((l) => l.id === leadId);
  const deal = useMemo(() => deals.find((d) => d.leadId === leadId && d.status !== "cancelled"), [deals, leadId]);
  const [purpose, setPurpose] = useState<WaPurpose>("followup");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [opened, setOpened] = useState(false);
  const ctx = { owner, business, dealName: deal?.name };
  // Reset for every newly selected lead so a previous client's number or draft is never reused.
  useEffect(() => { if (!lead) return; setPurpose("followup"); setText(draftMessage("followup", lead, ctx)); setEdited(false); setOpened(false); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lead) return null;
  const number = waNumber(lead.phone);
  const pick = (p: WaPurpose) => {
    if (p === purpose) return;
    if (edited && text.trim() && !window.confirm("Replace your edited message with the new template?")) return;
    setPurpose(p); setText(draftMessage(p, lead, ctx)); setEdited(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.success("Message copied"); } catch { toast.error("Couldn't copy — select the text and copy manually"); } };
  const send = () => { if (!number || !text.trim()) return; window.open(waLink(number, text), "_blank", "noopener,noreferrer"); setOpened(true); };
  const logIt = () => { addActivity(lead.id, `WhatsApp ${WA_LABEL[purpose].toLowerCase()} message (from ${source}): ${text.slice(0, 140)}${text.length > 140 ? "…" : ""}`, "whatsapp"); toast.success("Logged to the lead's history"); close(); };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="wa-composer max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="size-5 text-success" />WhatsApp message</DialogTitle><DialogDescription>Choose a purpose, edit the draft, then open WhatsApp. Nothing is sent automatically.</DialogDescription></DialogHeader>
        <section aria-label="Client" className="wa-client">
          <div className="min-w-0"><div className="truncate text-base font-semibold">{lead.name}</div><div className="truncate text-xs text-muted-foreground">{lead.company ?? "Independent"} · <span className="num">{lead.phone}</span></div></div>
          <div className="flex flex-wrap items-center gap-1.5"><span className="stage-chip" data-stage={lead.status}>{STATUS_LABEL[lead.status]}</span>{(deal?.name || lead.requirement) && <span className="aging max-w-[220px] truncate">{deal?.name ?? lead.requirement}</span>}{lead.quotedAmount ? <span className="aging num">Quoted {formatINR(lead.quotedAmount)}</span> : null}</div>
        </section>
        {!number && <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-2.5 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />This phone number isn't a valid Indian mobile, so WhatsApp can't be opened. Fix it on the lead first.</p>}
        <div role="radiogroup" aria-label="Message purpose" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WA_PURPOSES.map((p) => { const I = ICON[p]; return <button key={p} type="button" role="radio" aria-checked={purpose === p} onClick={() => pick(p)} className="wa-purpose"><I className="size-4" /><span className="text-[13px] font-semibold">{WA_LABEL[p]}</span><span className="text-[11px] text-muted-foreground">{HINT[p]}</span></button>; })}
        </div>
        {(purpose === "quotation" || purpose === "samples") && <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Sales assets</span> — no saved packages, demo links or quotation links yet. Paste any link straight into the message below.{purpose === "quotation" && !lead.quotedAmount && " No quoted amount is recorded, so the draft leaves price out."}</div>}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between"><label htmlFor="wa-text" className="text-xs font-semibold">Message</label><span className="num text-[11px] text-muted-foreground">{text.length} chars</span></div>
          <Textarea id="wa-text" key={purpose} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} rows={7} placeholder={purpose === "custom" ? "Write your message…" : ""} className="wa-editor min-h-40 text-sm leading-relaxed" />
        </div>
        {opened ? (
          <div className="wa-after" role="status"><Check className="size-4 text-success" /><span className="flex-1 text-xs">WhatsApp opened. It isn't marked as sent — log it only if you actually sent it.</span><Button size="sm" variant="ghost" onClick={close}>Close</Button><Button size="sm" variant="outline" onClick={logIt}>Log to history</Button></div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={copy} disabled={!text.trim()}><Copy className="size-4" />Copy</Button>
            <Button onClick={send} disabled={!number || !text.trim()}><ExternalLink className="size-4" />Open in WhatsApp</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
