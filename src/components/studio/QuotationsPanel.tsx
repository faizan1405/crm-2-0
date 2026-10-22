import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Plus, Search, FileText, Copy, Download, Pencil, Trash2, MessageCircle, Building2, Info } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { formatINR, dayKey } from "@/lib/crm/format";
import { effectiveStatus, quoteTotals, QUOTE_STATUSES, QUOTE_STATUS_LABEL, type BusinessProfile, type Quotation, type QuoteStatus } from "@/lib/crm/studio";
import { openWhatsApp } from "@/components/crm/WhatsAppComposer";
import { Empty, selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuotationEditor } from "./QuotationEditor";
import { QuotationPreview } from "./QuotationPreview";
import { cn } from "@/lib/utils";

export function QuotationsPanel({ selected, client, onSelect, onClient }: { selected?: string | undefined; client?: string | undefined; onSelect: (id: string | undefined) => void; onClient: (id: string | undefined) => void }) {
  const { quotations, leads, businessProfile, business, duplicateQuotation, deleteQuotation, setQuoteStatus } = useCRM();
  const [q, setQ] = useState(""), [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [editing, setEditing] = useState<Quotation | "new" | null>(null);
  const [bizOpen, setBizOpen] = useState(false);
  const today = dayKey(new Date());
  const list = useMemo(() => quotations
    .filter((x) => (!client || x.leadId === client) && (status === "all" || effectiveStatus(x, today) === status) && `${x.number} ${x.title} ${x.clientName} ${x.company ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [quotations, client, status, q, today]);
  const current = quotations.find((x) => x.id === selected) ?? list[0];
  const leadExists = (id: string) => leads.some((l) => l.id === id);
  const quoted = quotations.filter((x) => ["ready", "shared"].includes(effectiveStatus(x, today))).reduce((s, x) => s + quoteTotals(x).total, 0);
  const accepted = quotations.filter((x) => x.status === "accepted").reduce((s, x) => s + quoteTotals(x).total, 0);
  const pdf = async (x: Quotation) => { try { const { downloadQuotationPdf } = await import("@/lib/crm/quotepdf"); await downloadQuotationPdf(x, businessProfile, business); toast.success("PDF downloaded"); } catch { toast.error("Couldn't create the PDF"); } };
  const clientsWithQuotes = leads.filter((l) => quotations.some((x) => x.leadId === l.id));

  return (
    <div className="grid gap-4">
      <div className="studio-metrics">
        <div className="studio-metric"><span className="eyebrow">Quotations</span><span className="num text-2xl font-semibold">{quotations.length}</span></div>
        <div className="studio-metric"><span className="eyebrow">Open quoted value</span><span className="num text-2xl font-semibold">{formatINR(quoted)}</span><span className="text-[11px] text-muted-foreground">Ready or shared — not confirmed revenue</span></div>
        <div className="studio-metric"><span className="eyebrow">Accepted</span><span className="num text-2xl font-semibold">{formatINR(accepted)}</span><span className="text-[11px] text-muted-foreground">Convert to a deal manually</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Search quotations" className="pl-8" placeholder="Search number, title or client" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Filter by status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus | "all")}><option value="all">All statuses</option>{QUOTE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}</select>
        <select aria-label="Filter by client" className={selectCls} value={client ?? ""} onChange={(e) => onClient(e.target.value || undefined)}><option value="">All clients</option>{clientsWithQuotes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <Button variant="outline" onClick={() => setBizOpen(true)}><Building2 />Business details</Button>
        <Button onClick={() => setEditing("new")}><Plus />New quotation</Button>
      </div>
      {quotations.length === 0 ? (
        <div className="surface"><Empty icon={<FileText />} title="No quotations yet" hint="Create your first quotation. It stays separate from deals and payments until you convert it yourself." action={<Button onClick={() => setEditing("new")}><Plus />New quotation</Button>} /></div>
      ) : (
        <div className="studio-split">
          <div className="studio-list" role="listbox" aria-label="Quotations">
            {list.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No quotations match these filters.</p>}
            {list.map((x) => { const st = effectiveStatus(x, today); return (
              <button key={x.id} type="button" role="option" aria-selected={current?.id === x.id} onClick={() => onSelect(x.id)} className="studio-row">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{x.title}</span><span className="block truncate text-xs text-muted-foreground">{x.clientName}{x.company ? ` · ${x.company}` : ""}</span><span className="num block text-[11px] text-muted-foreground">{x.number} · until {x.validUntil}</span></span>
                <span className="grid justify-items-end gap-1"><span className="num text-sm font-semibold">{formatINR(quoteTotals(x).total)}</span><span className="q-status" data-status={st}>{QUOTE_STATUS_LABEL[st]}</span></span>
              </button>); })}
          </div>
          {current && (
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Quotation status" className={cn(selectCls, "h-9")} value={current.status} onChange={(e) => { setQuoteStatus(current.id, e.target.value as QuoteStatus); toast.success(`Marked ${QUOTE_STATUS_LABEL[e.target.value as QuoteStatus]}`); }}>
                  {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={() => setEditing(current)}><Pencil />Edit</Button>
                <Button size="sm" variant="outline" onClick={() => { const id = duplicateQuotation(current.id); if (id) { onSelect(id); toast.success("Duplicated as a new draft"); } }}><Copy />Duplicate</Button>
                <Button size="sm" variant="outline" onClick={() => pdf(current)}><Download />PDF</Button>
                <Button size="sm" variant="outline" disabled={!leadExists(current.leadId)} title={leadExists(current.leadId) ? undefined : "This client is no longer an active lead"} onClick={() => openWhatsApp(current.leadId, "Sales Studio", { purpose: "quotation", quoteId: current.id })}><MessageCircle />WhatsApp</Button>
                <Button size="sm" variant="ghost" aria-label="Delete quotation" className="hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${current.number} — ${current.title}? This can't be undone.`)) { deleteQuotation(current.id); onSelect(undefined); toast.success("Quotation deleted"); } }}><Trash2 /></Button>
              </div>
              {current.status === "accepted" && <p className="flex items-center gap-2 rounded-lg bg-success-soft p-2.5 text-xs"><Info className="size-4 shrink-0" />Accepted quotations aren't turned into deals automatically. Create the deal yourself in <Link to="/deals" className="underline">Deals &amp; Payments</Link>.</p>}
              <QuotationPreview q={current} biz={businessProfile} fallbackName={business} />
            </div>
          )}
        </div>
      )}
      {editing && <QuotationEditor initial={editing === "new" ? undefined : editing} {...(editing === "new" && client ? { leadId: client } : {})} onClose={() => setEditing(null)} onSaved={(id) => onSelect(id)} />}
      {bizOpen && <BusinessDialog initial={businessProfile} onClose={() => setBizOpen(false)} />}
    </div>
  );
}

function BusinessDialog({ initial, onClose }: { initial: BusinessProfile; onClose: () => void }) {
  const save = useCRM((s) => s.saveBusinessProfile);
  const [b, setB] = useState<BusinessProfile>(initial);
  const f = (k: keyof BusinessProfile, label: string, ph: string, area = false) => (
    <label className="q-field"><span>{label}</span>{area ? <Textarea rows={3} value={b[k] ?? ""} placeholder={ph} onChange={(e) => setB({ ...b, [k]: e.target.value })} /> : <Input value={b[k] ?? ""} placeholder={ph} onChange={(e) => setB({ ...b, [k]: e.target.value })} />}</label>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Business details for quotations</DialogTitle><DialogDescription>Only what you enter here appears on quotations. Leave anything blank to hide it.</DialogDescription></DialogHeader>
        <div className="grid gap-3">{f("name", "Business name", "Your registered business name")}{f("address", "Address", "Street, city, PIN", true)}<div className="grid gap-3 sm:grid-cols-2">{f("email", "Email", "billing@…")}{f("phone", "Phone", "+91…")}</div><div className="grid gap-3 sm:grid-cols-2">{f("website", "Website", "yourdomain.com")}{f("gstin", "GSTIN", "Only if registered")}</div>{f("paymentInstructions", "Payment instructions", "Bank / UPI details shown on every quotation", true)}</div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { const clean = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, (v ?? "").trim()]).filter(([k, v]) => k === "name" || v)) as unknown as BusinessProfile; save(clean); toast.success("Business details saved"); onClose(); }}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}
