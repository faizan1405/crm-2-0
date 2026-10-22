import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileText } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { formatINR, uid, dayKey } from "@/lib/crm/format";
import { addDaysYmd, emptyItem, lineTotal, quoteError, quoteTotals, type Quotation, type QuoteStatus } from "@/lib/crm/studio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/Shell";

const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

function blank(leadId: string | undefined, leads: ReturnType<typeof useCRM.getState>["leads"]): Quotation {
  const today = dayKey(new Date());
  const lead = leads.find((l) => l.id === leadId);
  return {
    id: uid("quo"), number: "", leadId: lead?.id ?? "", clientName: lead?.name ?? "", company: lead?.company, phone: lead?.phone, email: lead?.email,
    title: lead?.requirement ?? "", issueDate: today, validUntil: addDaysYmd(today, 30), items: [emptyItem()],
    discountType: "flat", discount: 0, gstEnabled: false, gstRate: 18, status: "draft", revision: 1, history: [], createdAt: "", updatedAt: "",
  };
}

/** Create or edit one quotation. Saving never creates or changes a Deal or Payment. */
export function QuotationEditor({ initial, leadId, onClose, onSaved }: { initial?: Quotation | undefined; leadId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { leads, saveQuotation } = useCRM();
  const start = useMemo(() => initial ?? blank(leadId, leads), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState<Quotation>(start);
  const dirty = JSON.stringify(q) !== JSON.stringify(start);
  const t = quoteTotals(q);
  const err = quoteError(q);
  const set = (patch: Partial<Quotation>) => setQ((s) => ({ ...s, ...patch }));
  const setItem = (id: string, patch: Partial<Quotation["items"][number]>) => set({ items: q.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const chooseLead = (id: string) => { const l = leads.find((x) => x.id === id); set({ leadId: id, clientName: l?.name ?? "", company: l?.company, phone: l?.phone, email: l?.email }); };
  const tryClose = () => { if (dirty && !window.confirm("Discard unsaved quotation changes?")) return; onClose(); };
  const save = (status?: QuoteStatus) => {
    const row = { ...q, ...(status ? { status } : {}) };
    const e = quoteError(row);
    if (e) { toast.error(e); return; }
    const id = saveQuotation(row);
    if (!id) { toast.error("Couldn't save this quotation"); return; }
    toast.success(initial ? "Quotation updated" : "Quotation saved");
    onSaved?.(id); onClose();
  };
  const locked = !!leadId && !initial;

  return (
    <Dialog open onOpenChange={(o) => !o && tryClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="size-5" />{initial ? `Edit ${initial.number}` : "New quotation"}</DialogTitle><DialogDescription>Totals are calculated from the items below. Saving a quotation never creates a deal or a payment.</DialogDescription></DialogHeader>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid content-start gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="q-field"><span>Client</span>
                <select aria-label="Client" className={selectCls} value={q.leadId} disabled={locked} onChange={(e) => chooseLead(e.target.value)}>
                  <option value="">Choose a client…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}
                </select>
              </label>
              <label className="q-field"><span>Quotation title</span><Input value={q.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Business Website" /></label>
              <label className="q-field"><span>Quotation date</span><Input type="date" value={q.issueDate} onChange={(e) => set({ issueDate: e.target.value })} /></label>
              <label className="q-field"><span>Valid until</span><Input type="date" value={q.validUntil} min={q.issueDate} onChange={(e) => set({ validUntil: e.target.value })} /></label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold">Items</span><Button type="button" size="sm" variant="ghost" onClick={() => set({ items: [...q.items, emptyItem()] })}><Plus />Add item</Button></div>
              <div className="q-items">
                <div className="q-items-head" aria-hidden><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span><span /></div>
                {q.items.map((i, n) => (
                  <div key={i.id} className="q-item">
                    <Input aria-label={`Item ${n + 1} description`} value={i.description} onChange={(e) => setItem(i.id, { description: e.target.value })} placeholder="Service or product" />
                    <Input aria-label={`Item ${n + 1} quantity`} type="number" min={0} step="any" inputMode="decimal" value={i.qty} onChange={(e) => setItem(i.id, { qty: num(e.target.value) })} />
                    <Input aria-label={`Item ${n + 1} unit price`} type="number" min={0} step="any" inputMode="decimal" value={i.unitPrice} onChange={(e) => setItem(i.id, { unitPrice: num(e.target.value) })} />
                    <span className="num q-line">{formatINR(lineTotal(i))}</span>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${n + 1}`} disabled={q.items.length === 1} onClick={() => set({ items: q.items.filter((x) => x.id !== i.id) })}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="q-field"><span>Discount</span>
                <div className="flex gap-2"><select aria-label="Discount type" className={selectCls} value={q.discountType} onChange={(e) => set({ discountType: e.target.value as Quotation["discountType"] })}><option value="flat">₹ Flat</option><option value="percent">% Percent</option></select>
                <Input aria-label="Discount value" type="number" min={0} step="any" value={q.discount} onChange={(e) => set({ discount: num(e.target.value) })} /></div>
              </div>
              <div className="q-field"><span>GST</span>
                <div className="flex h-10 items-center gap-3"><Switch aria-label="Apply GST" checked={q.gstEnabled} onCheckedChange={(v) => set({ gstEnabled: v })} />{q.gstEnabled && <><Input aria-label="GST rate" type="number" min={0} max={100} step="any" className="w-20" value={q.gstRate} onChange={(e) => set({ gstRate: num(e.target.value) })} /><span className="text-xs text-muted-foreground">%</span></>}</div>
              </div>
            </div>
            <label className="q-field"><span>Payment terms</span><Textarea rows={2} value={q.paymentTerms ?? ""} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="e.g. 50% advance, 50% on delivery" /></label>
            <label className="q-field"><span>Notes</span><Textarea rows={2} value={q.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Scope, timelines or exclusions" /></label>
          </div>
          <aside className="q-summary" aria-label="Quotation total">
            <div className="eyebrow">Live total</div>
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="num">{formatINR(t.subtotal)}</dd></div>
              {t.discount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="num">− {formatINR(t.discount)}</dd></div>}
              {q.gstEnabled && <div className="flex justify-between"><dt className="text-muted-foreground">GST ({t.gstRate}%)</dt><dd className="num">{formatINR(t.gst)}</dd></div>}
            </dl>
            <div className="q-total"><span>Total</span><span className="num">{formatINR(t.total)}</span></div>
            {err ? <p className="text-xs text-destructive" role="alert">{err}</p> : <p className="text-xs text-muted-foreground">Ready to save.</p>}
            {initial && initial.history.length > 0 && <div className="mt-2 grid gap-1"><div className="eyebrow">Revisions</div>{[...initial.history].reverse().map((h) => <div key={h.revision} className="flex justify-between text-[11px] text-muted-foreground"><span>Rev {h.revision} · {h.at.slice(0, 10)}</span><span className="num">{formatINR(h.total)}</span></div>)}</div>}
          </aside>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={tryClose}>Cancel</Button>
          <Button variant="outline" onClick={() => save(initial ? undefined : "draft")} disabled={!!err}>{initial ? "Save changes" : "Save draft"}</Button>
          {q.status === "draft" && <Button onClick={() => save("ready")} disabled={!!err}>Save &amp; mark Ready</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
