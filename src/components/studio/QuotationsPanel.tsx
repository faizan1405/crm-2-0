import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, FileText, Copy, Pencil, Trash2, Eye, ArrowUp, ArrowDown, Archive, Download } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { formatINR, formatDate } from "@/lib/crm/format";
import { formatPackagePrice, legacyTotal, renderQuotation, templateFromLegacy, type QuotationTemplate } from "@/lib/crm/studio";
import { Empty, selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuotationTemplateEditor } from "./QuotationTemplateEditor";
import { cn } from "@/lib/utils";

/** Quotation Templates: reusable, global WhatsApp packages. Not linked to any client, deal or payment. */
export function QuotationsPanel({ client, create }: { client?: string | undefined; create?: boolean | undefined }) {
  const { quotationTemplates, legacyQuotations, duplicateQuotationTemplate, deleteQuotationTemplate, setQuotationTemplateActive, moveQuotationTemplate } = useCRM();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<QuotationTemplate | "new" | null>(create ? "new" : null);
  const [previewing, setPreviewing] = useState<QuotationTemplate | null>(null);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const sorted = useMemo(() => [...quotationTemplates].sort((a, b) => a.sortOrder - b.sortOrder), [quotationTemplates]);
  const list = sorted.filter((t) => `${t.name} ${t.messageBody} ${formatPackagePrice(t)}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Search quotations" className="pl-8" placeholder="Search packages" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {legacyQuotations.length > 0 && <Button variant="outline" onClick={() => setLegacyOpen(true)}><Archive />Old quotations ({legacyQuotations.length})</Button>}
        <Button onClick={() => setEditing("new")}><Plus />Add quotation</Button>
      </div>
      {quotationTemplates.length === 0 ? (
        <div className="surface"><Empty icon={<FileText />} title="No quotation packages yet" hint="Add a package once — name, price and message — and send it to any client from WhatsApp." action={<Button onClick={() => setEditing("new")}><Plus />Add quotation</Button>} /></div>
      ) : (
        <div className="qt-grid" aria-label="Quotation templates">
          {list.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No packages match “{q}”.</p>}
          {list.map((t) => { const i = sorted.indexOf(t); return (
            <article key={t.id} className={cn("qt-card", !t.isActive && "is-off")} aria-label={t.name}>
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate text-[15px] font-semibold">{t.name}</h3><div className="num text-lg font-semibold text-primary">{formatPackagePrice(t)}</div></div>
                <Switch aria-label={`${t.isActive ? "Deactivate" : "Activate"} ${t.name}`} checked={t.isActive} onCheckedChange={(v) => { setQuotationTemplateActive(t.id, v); toast.success(v ? "Package active in WhatsApp" : "Package hidden from WhatsApp"); }} />
              </header>
              <p className="qt-snippet">{t.messageBody}</p>
              <footer className="flex flex-wrap items-center gap-1">
                <span className="mr-auto text-[11px] text-muted-foreground">{t.isActive ? "Active" : "Inactive"} · edited {formatDate(t.updatedAt, { day: "numeric", month: "short" })}</span>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => moveQuotationTemplate(t.id, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Move ${t.name} down`} disabled={i === sorted.length - 1} onClick={() => moveQuotationTemplate(t.id, 1)}><ArrowDown className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Preview ${t.name}`} onClick={() => setPreviewing(t)}><Eye className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Duplicate ${t.name}`} onClick={() => { if (duplicateQuotationTemplate(t.id)) toast.success("Package duplicated"); }}><Copy className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 hover:text-destructive" aria-label={`Delete ${t.name}`} onClick={() => { if (window.confirm(`Delete “${t.name}”? Messages already logged keep their copy.`)) { deleteQuotationTemplate(t.id); toast.success("Package deleted"); } }}><Trash2 className="size-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}><Pencil />Edit</Button>
              </footer>
            </article>); })}
        </div>
      )}
      {editing && <QuotationTemplateEditor initial={editing === "new" ? undefined : editing} previewLeadId={client} onClose={() => setEditing(null)} />}
      {previewing && <PreviewDialog t={previewing} leadId={client} onClose={() => setPreviewing(null)} />}
      {legacyOpen && <LegacyDialog onClose={() => setLegacyOpen(false)} onUse={(t) => { setLegacyOpen(false); setEditing(t); }} />}
    </div>
  );
}

function PreviewDialog({ t, leadId, onClose }: { t: QuotationTemplate; leadId?: string | undefined; onClose: () => void }) {
  const { leads, deals, owner, business } = useCRM();
  const [id, setId] = useState(leadId ?? leads[0]?.id ?? "");
  const lead = leads.find((l) => l.id === id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{t.name} · {formatPackagePrice(t)}</DialogTitle><DialogDescription>How this package reads for a real client. Only saved client details are used.</DialogDescription></DialogHeader>
        <select aria-label="Preview client" className={selectCls} value={id} onChange={(e) => setId(e.target.value)}>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}</select>
        <div className="qt-bubble">{lead ? renderQuotation(t, lead, { owner, business, dealName: deals.find((d) => d.leadId === lead.id && d.status !== "cancelled")?.name }) : "Add a lead to preview."}</div>
      </DialogContent>
    </Dialog>
  );
}

function LegacyDialog({ onClose, onUse }: { onClose: () => void; onUse: (t: QuotationTemplate) => void }) {
  const { legacyQuotations, quotationTemplates, deleteLegacyQuotations } = useCRM();
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(legacyQuotations, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "old-quotations-backup.json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Old quotations</DialogTitle><DialogDescription>These came from the earlier invoice-style builder. They're kept unchanged as a backup and aren't used in WhatsApp. Turn one into a package only if you want to — you'll review it before saving.</DialogDescription></DialogHeader>
        <div className="grid gap-1.5">
          {legacyQuotations.map((x) => (
            <div key={x.id} className="studio-row">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{x.title || "Untitled"}</span><span className="block truncate text-xs text-muted-foreground">{x.clientName} · {x.number}</span></span>
              <span className="num text-sm font-semibold">{formatINR(legacyTotal(x))}</span>
              <Button size="sm" variant="outline" onClick={() => onUse(templateFromLegacy(x, quotationTemplates.length))}>Use as package</Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" className="hover:text-destructive" onClick={() => { if (window.confirm("Delete the backup of old quotations? Download it first if you might need it.")) { deleteLegacyQuotations(); onClose(); toast.success("Old quotations removed"); } }}><Trash2 />Delete backup</Button>
          <Button variant="outline" onClick={exportJson}><Download />Download backup</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
