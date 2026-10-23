import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, FileText, PenLine } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { emptyQuotationTemplate, formatPackagePrice, priceMismatch, quotationTemplateError, QUOTATION_PLACEHOLDERS, renderQuotation, type QuotationTemplate } from "@/lib/crm/studio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/components/crm/Shell";

/** Create or edit one reusable package. Saving changes the global template only — never deals, payments or sent history. */
export function QuotationTemplateEditor({ initial, previewLeadId, onClose, onSaved }: { initial?: QuotationTemplate | undefined; previewLeadId?: string | undefined; onClose: () => void; onSaved?: (id: string) => void }) {
  const { leads, deals, owner, business, quotationTemplates, saveQuotationTemplate } = useCRM();
  const isNew = !initial || !quotationTemplates.some((x) => x.id === initial.id);
  const start = useMemo(() => initial ?? emptyQuotationTemplate(quotationTemplates.length), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [t, setT] = useState<QuotationTemplate>(start);
  const [view, setView] = useState<"write" | "preview">("write");
  const [leadId, setLeadId] = useState(previewLeadId ?? leads[0]?.id ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(t) !== JSON.stringify(start);
  const err = quotationTemplateError(t);
  const mismatch = priceMismatch(t);
  const set = (patch: Partial<QuotationTemplate>) => setT((s) => ({ ...s, ...patch }));
  const lead = leads.find((l) => l.id === leadId);
  const preview = lead ? renderQuotation(t, lead, { owner, business, dealName: deals.find((d) => d.leadId === lead.id && d.status !== "cancelled")?.name }) : "";
  const tryClose = () => { if (dirty && !window.confirm("Discard unsaved changes to this package?")) return; onClose(); };
  const insert = (k: string) => {
    const el = ref.current, token = `{${k}}`, at = el?.selectionStart ?? t.messageBody.length;
    set({ messageBody: t.messageBody.slice(0, at) + token + t.messageBody.slice(el?.selectionEnd ?? at) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };
  const useToken = () => { let body = t.messageBody; mismatch.forEach((m) => { body = body.split(m).join("{packagePrice}"); }); set({ messageBody: body }); };
  const save = () => {
    if (err) { toast.error(err); return; }
    const id = saveQuotationTemplate(t);
    if (!id) { toast.error("Couldn't save this package"); return; }
    toast.success(isNew ? "Package saved — it's available in every WhatsApp message now" : "Package updated everywhere");
    onSaved?.(id); onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && tryClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="size-5" />{isNew ? "Add quotation" : `Edit ${initial?.name}`}</DialogTitle><DialogDescription>Write it once and send it to any client from WhatsApp. This is a sales message, not an invoice.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_240px]">
            <label className="q-field"><span>Package name</span><Input autoFocus value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Premium 3D Website" /></label>
            <div className="q-field"><span>Price</span>
              <div className="flex gap-2">
                <select aria-label="Price type" className={selectCls} value={t.priceType} onChange={(e) => set({ priceType: e.target.value as QuotationTemplate["priceType"] })}><option value="fixed">₹ Fixed</option><option value="custom">Custom</option></select>
                {t.priceType === "fixed"
                  ? <Input aria-label="Package price" type="number" min={0} step="any" inputMode="numeric" value={t.priceAmount ?? ""} placeholder="45000" onChange={(e) => set({ priceAmount: e.target.value.trim() === "" ? undefined : Number(e.target.value) })} />
                  : <Input aria-label="Price label" value={t.priceLabel ?? ""} placeholder="On request" onChange={(e) => set({ priceLabel: e.target.value })} />}
              </div>
            </div>
          </div>

          <div className="qt-tabs" role="tablist" aria-label="Editor view">
            <button type="button" role="tab" aria-selected={view === "write"} onClick={() => setView("write")}><PenLine className="size-3.5" />Write</button>
            <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}><Eye className="size-3.5" />Preview</button>
          </div>

          {view === "write" ? (
            <div className="grid gap-2">
              <label htmlFor="qt-body" className="text-xs font-semibold">Quotation message</label>
              <Textarea id="qt-body" ref={ref} rows={12} value={t.messageBody} onChange={(e) => set({ messageBody: e.target.value })} className="min-h-64 text-sm leading-relaxed" placeholder="Describe the package: what's included, timeline, support, payment terms…" />
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Insert placeholder"><span className="text-[11px] text-muted-foreground">Insert:</span>{QUOTATION_PLACEHOLDERS.map((k) => <button key={k} type="button" className="ph-chip" onClick={() => insert(k)}>{`{${k}}`}</button>)}</div>
              <p className="text-[11px] text-muted-foreground">Use {"{packagePrice}"} instead of typing the price, so the message always matches the saved price. Lines with details a client doesn't have are left out.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-xs"><span className="font-semibold">Preview for</span>
                <select aria-label="Preview client" className={selectCls + " h-8"} value={leadId} onChange={(e) => setLeadId(e.target.value)}>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}</select>
              </label>
              <div className="qt-bubble" aria-label="Message preview">{preview || <span className="text-muted-foreground">Nothing to preview yet.</span>}</div>
            </div>
          )}

          {mismatch.length > 0 && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft p-2.5 text-xs"><AlertTriangle className="size-4 shrink-0 text-warning" /><span className="flex-1">The message mentions {mismatch.join(", ")}, but the saved price is {formatPackagePrice(t)}.</span><Button size="sm" variant="outline" onClick={useToken}>Replace with {"{packagePrice}"}</Button></div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {err && <span className="mr-auto text-xs text-muted-foreground">{err}</span>}
          <Button variant="ghost" onClick={tryClose}>Cancel</Button>
          <Button variant="outline" onClick={() => setView(view === "write" ? "preview" : "write")}><Eye />{view === "write" ? "Preview" : "Back to editing"}</Button>
          <Button onClick={save} disabled={!!err}>Save template</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
