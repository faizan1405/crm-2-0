import { allows, useSession } from "@/lib/crm/session";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { MessageCircle, MessagesSquare, FileText, LayoutTemplate, PenLine, Copy, ExternalLink, AlertTriangle, Check, Plus, RefreshCw, Globe, Settings2 } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { STATUS_LABEL, type Lead } from "@/lib/crm/types";
import { formatINR } from "@/lib/crm/format";
import { WA_LABEL, WA_PURPOSES, waLink, waNumber, type WaPurpose } from "@/lib/crm/whatsapp";
import { activeQuotationTemplates, composeDraft, formatPackagePrice, selectedDemos, syncDraft, safeUrl } from "@/lib/crm/studio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuotationTemplateEditor } from "@/components/studio/QuotationTemplateEditor";
import { cn } from "@/lib/utils";

/** `text` = a fully-resolved draft prepared elsewhere (e.g. Project Desk). It opens as an edited Custom message, so it is never overwritten silently. */
export interface ComposerPreset { purpose?: WaPurpose; packageId?: string; text?: string }
/** UI-only state: which lead the composer is open for. Never persisted. */
export const useWhatsApp = create<{ leadId: string | null; source: string; preset: ComposerPreset; nonce: number; open: (leadId: string, source: string, preset?: ComposerPreset) => void; close: () => void }>()((set) => ({
  leadId: null, source: "", preset: {}, nonce: 0,
  open: (leadId, source, preset = {}) => set((s) => ({ leadId, source, preset, nonce: s.nonce + 1 })),
  close: () => set({ leadId: null, preset: {} }),
}));
export const openWhatsApp = (leadId: string, source: string, preset?: ComposerPreset) => useWhatsApp.getState().open(leadId, source, preset);

const ICON: Record<WaPurpose, typeof FileText> = { followup: MessagesSquare, quotation: FileText, samples: LayoutTemplate, custom: PenLine };
const HINT: Record<WaPurpose, string> = { followup: "Continue the conversation", quotation: "Pricing, proposal or offer", samples: "Share website examples", custom: "Write from scratch" };

/** Icon button for any WhatsApp action point — always opens the composer, never WhatsApp directly. */
export function WhatsAppButton({ leadId, name, source, label, className }: { leadId: string; name: string; source: string; label?: boolean; className?: string }) {
  if (!allows(useSession.getState().preview, "clients.whatsapp")) return null;
  return <button type="button" draggable={false} aria-label={`WhatsApp ${name}`} title={`WhatsApp ${name}`} onClick={(e) => { e.stopPropagation(); openWhatsApp(leadId, source); }} className={cn("wa-btn", label && "has-label", className)}><MessageCircle className="size-3.5" />{label && <span>WhatsApp</span>}</button>;
}

export function WhatsAppComposer() {
  const { leadId, source, preset, nonce, close } = useWhatsApp();
  const lead = useCRM((s) => s.leads.find((l) => l.id === leadId));
  if (!lead) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="wa-composer max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {/* Keyed by client + open: switching client remounts, so no draft, quotation or number can leak across. */}
        <ComposerBody key={`${lead.id}:${nonce}`} lead={lead} source={source} preset={preset} close={close} />
      </DialogContent>
    </Dialog>
  );
}

function ComposerBody({ lead, source, preset, close }: { lead: Lead; source: string; preset: ComposerPreset; close: () => void }) {
  const { deals, owner, business, addActivity, quotationTemplates, waTemplates, demos, logQuotationShare } = useCRM();
  const deal = useMemo(() => deals.find((d) => d.leadId === lead.id && d.status !== "cancelled"), [deals, lead.id]);
  // Global packages — the same list for every client, always the latest saved version.
  const packages = useMemo(() => activeQuotationTemplates(quotationTemplates), [quotationTemplates]);
  const [purpose, setPurpose] = useState<WaPurpose>(preset.purpose ?? (preset.text ? "custom" : "followup"));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(preset.packageId ?? null);
  const [override, setOverride] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const pkg = packages.find((p) => p.id === packageId) ?? packages[0];
  const activeDemos = demos.filter((d) => d.active && safeUrl(d.url)).sort((a, b) => a.order - b.order);
  const picked = selectedDemos(demos, override);
  const purposeTemplates = purpose === "quotation" ? [] : waTemplates.filter((t) => t.purpose === purpose && t.enabled);
  const fresh = composeDraft({ purpose, templateId, lead, owner, business, dealName: deal?.name, templates: waTemplates, pkg: purpose === "quotation" ? pkg : undefined, demos: purpose === "samples" ? picked : [] });
  const [text, setText] = useState(preset.text ?? fresh);
  const [base, setBase] = useState(fresh);
  const [edited, setEdited] = useState(!!preset.text);
  const [opened, setOpened] = useState(false);
  const sync = syncDraft({ text, base, edited }, fresh);
  useEffect(() => { if (sync.text !== text) setText(sync.text); if (sync.base !== base) setBase(sync.base); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const number = waNumber(lead.phone);
  const pick = (p: WaPurpose) => {
    if (p === purpose) return;
    if (edited && text.trim() && !window.confirm("Replace your edited message with the new template?")) return;
    setPurpose(p); setTemplateId(null); setEdited(false);
  };
  const choosePackage = (id: string) => {
    if (id === pkg?.id) return;
    if (edited && text.trim() && !window.confirm("Replace your edited message with this package?")) return;
    setPackageId(id); setEdited(false);
  };
  const applyFresh = () => { setText(fresh); setBase(fresh); setEdited(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.success("Message copied"); } catch { toast.error("Couldn't copy — select the text and copy manually"); } };
  const send = () => { if (!number || !text.trim()) return; window.open(waLink(number, text), "_blank", "noopener,noreferrer"); setOpened(true); };
  const logIt = () => {
    const isQuote = purpose === "quotation" && !!pkg;
    addActivity(lead.id, `WhatsApp ${WA_LABEL[purpose].toLowerCase()} message (from ${source})${isQuote ? ` — ${pkg.name} (${formatPackagePrice(pkg)})` : ""}: ${text.slice(0, 140)}${text.length > 140 ? "…" : ""}`, "whatsapp");
    // Snapshot of exactly what was sent; later template edits never change it.
    if (isQuote) logQuotationShare({ leadId: lead.id, templateId: pkg.id, packageNameSnapshot: pkg.name, priceSnapshot: formatPackagePrice(pkg), messageSnapshot: text, userConfirmedSent: true });
    toast.success("Logged to the lead's history");
    close();
  };
  const toggleDemo = (id: string) => { const cur = picked.map((d) => d.id); setOverride(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); };

  return (
    <>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="size-5 text-success" />WhatsApp message</DialogTitle><DialogDescription>Choose a purpose, edit the draft, then open WhatsApp. Nothing is sent automatically.</DialogDescription></DialogHeader>
      <section aria-label="Client" className="wa-client">
        <div className="min-w-0"><div className="truncate text-base font-semibold">{lead.name}</div><div className="truncate text-xs text-muted-foreground">{lead.company ?? "Independent"} · <span className="num">{lead.phone}</span></div></div>
        <div className="flex flex-wrap items-center gap-1.5"><span className="stage-chip" data-stage={lead.status}>{STATUS_LABEL[lead.status]}</span>{(deal?.name || lead.requirement) && <span className="aging max-w-[220px] truncate">{deal?.name ?? lead.requirement}</span>}{lead.quotedAmount ? <span className="aging num">Quoted {formatINR(lead.quotedAmount)}</span> : null}</div>
      </section>
      {!number && <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-2.5 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />This phone number isn't a valid Indian mobile, so WhatsApp can't be opened. Fix it on the lead first.</p>}
      <div role="radiogroup" aria-label="Message purpose" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {WA_PURPOSES.map((p) => { const I = ICON[p]; return <button key={p} type="button" role="radio" aria-checked={purpose === p} onClick={() => pick(p)} className="wa-purpose"><I className="size-4" /><span className="text-[13px] font-semibold">{WA_LABEL[p]}</span><span className="text-[11px] text-muted-foreground">{p === "quotation" && packages.length ? `${packages.length} package${packages.length === 1 ? "" : "s"}` : HINT[p]}</span></button>; })}
      </div>

      {purpose === "quotation" && (
        <section aria-label="Quotation packages" className="wa-assets">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Choose a package</div>
            <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setCreating(true)}><Plus />Create template</Button><Button size="sm" variant="ghost" asChild><Link to="/sales-studio" search={{ tab: "quotations", client: lead.id }} onClick={close}><Settings2 />Manage</Link></Button></div>
          </div>
          {packages.length === 0 ? (
            <div className="wa-empty"><FileText className="size-5" /><div><div className="text-sm font-semibold">No quotation packages yet</div><p className="text-xs text-muted-foreground">Create one once and use it for every client — you'll come straight back here.</p></div></div>
          ) : (
            <div role="radiogroup" aria-label="Choose package" className="grid gap-1.5">
              {packages.map((p) => { const sel = pkg?.id === p.id; return (
                <button key={p.id} type="button" role="radio" aria-checked={sel} onClick={() => choosePackage(p.id)} className="wa-quote">
                  <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">{p.name}</span>
                  <span className="num text-sm font-semibold">{formatPackagePrice(p)}</span>
                </button>); })}
            </div>
          )}
          {pkg && <p className="text-[11px] text-muted-foreground">Edits below apply to this message only — the saved package stays the same.</p>}
        </section>
      )}

      {purpose === "samples" && (
        <section aria-label="Website demos" className="wa-assets">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-semibold">Demos in this message <span className="num text-muted-foreground">({picked.length})</span></div>{override && <Button size="sm" variant="ghost" onClick={() => setOverride(null)}><RefreshCw />Use saved defaults</Button>}</div>
          {activeDemos.length === 0 ? (
            <div className="wa-empty"><Globe className="size-5" /><div><div className="text-sm font-semibold">No demo links saved yet</div><p className="text-xs text-muted-foreground">Add your real website demos in <Link to="/sales-studio" search={{ tab: "demos" }} onClick={close} className="underline">Sales Studio</Link>.</p></div></div>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Include demos">
              {activeDemos.map((d) => { const on = picked.some((x) => x.id === d.id); return <button key={d.id} type="button" aria-pressed={on} onClick={() => toggleDemo(d.id)} className="demo-pill">{on && <Check className="size-3" />}{d.title}<span className="text-[10px] opacity-70">{d.category}</span></button>; })}
            </div>
          )}
          {override && <p className="text-[11px] text-muted-foreground">Only this message changes — your saved default selection stays the same.</p>}
        </section>
      )}

      {purposeTemplates.length > 1 && (
        <label className="flex items-center gap-2 text-xs"><span className="font-semibold">Template</span>
          <select aria-label="Template" value={templateId ?? (purposeTemplates.find((t) => t.isDefault) ?? purposeTemplates[0])!.id} onChange={(e) => setTemplateId(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
            {purposeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</option>)}
          </select>
        </label>
      )}

      {sync.notice && (
        <div role="status" className="wa-notice"><RefreshCw className="size-4 shrink-0" /><span className="flex-1 text-xs">The template or selection changed. Your edited message was kept.</span><Button size="sm" variant="ghost" onClick={() => setBase(fresh)}>Keep my edits</Button><Button size="sm" variant="outline" onClick={applyFresh}>Use updated draft</Button></div>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between"><label htmlFor="wa-text" className="text-xs font-semibold">Message</label><span className="num text-[11px] text-muted-foreground">{text.length} chars</span></div>
        <Textarea id="wa-text" value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} rows={8} placeholder={purpose === "custom" ? "Write your message…" : ""} className="wa-editor min-h-40 text-sm leading-relaxed" />
      </div>
      {opened ? (
        <div className="wa-after" role="status"><Check className="size-4 text-success" /><span className="flex-1 text-xs">WhatsApp opened. It isn't marked as sent — log it only if you actually sent it.</span><Button size="sm" variant="ghost" onClick={close}>Close</Button><Button size="sm" onClick={logIt}>{purpose === "quotation" && pkg ? "I sent it — log to history" : "Log to history"}</Button></div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={copy} disabled={!text.trim()}><Copy className="size-4" />Copy</Button>
          <Button onClick={send} disabled={!number || !text.trim()}><ExternalLink className="size-4" />Open in WhatsApp</Button>
        </div>
      )}
      {creating && <QuotationTemplateEditor previewLeadId={lead.id} onClose={() => setCreating(false)} onSaved={(id) => { setPackageId(id); setPurpose("quotation"); setEdited(false); }} />}
    </>
  );
}
