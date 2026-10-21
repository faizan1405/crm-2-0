import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2 } from "lucide-react";
import { Shell, PriorityBadge } from "@/components/crm/Shell";
import { useCRM, duplicatePhone } from "@/lib/crm/store";
import { formatINR } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadPriority, type LeadSource, type LeadStatus } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Leads · Scale Flow CRM" },
      { name: "description", content: "Search, filter and add leads." },
      { property: "og:title", content: "Leads · Scale Flow CRM" },
      { property: "og:description", content: "Search, filter and add leads." },
    ],
  }),
  component: Leads,
});

const sel = "h-9 rounded-md border border-input bg-card px-2 text-sm";

function Leads() {
  const { leads, updateLead, deleteLead } = useCRM();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatus>("all");
  const [open, setOpen] = useState(false);
  const rows = leads.filter((l) => (status === "all" || l.status === status) && `${l.name} ${l.company} ${l.phone}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Shell title="Leads" subtitle={`${leads.length} leads in your workspace`} actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />Add lead</Button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search name, company or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b">{["Lead", "Phone", "Source", "Priority", "Score", "Quoted", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3"><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.company}</div></td>
                <td className="num px-4 py-3 text-muted-foreground">{l.phone}</td>
                <td className="px-4 py-3">{l.source}</td>
                <td className="px-4 py-3"><PriorityBadge p={l.priority} /></td>
                <td className="num px-4 py-3 font-semibold text-primary">{l.aiScore ?? "—"}</td>
                <td className="num px-4 py-3">{formatINR(l.quotedAmount)}</td>
                <td className="px-4 py-3"><select aria-label="Status" className={sel} value={l.status} onChange={(e) => updateLead(l.id, { status: e.target.value as LeadStatus })}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></td>
                <td className="px-4 py-3"><button aria-label="Delete lead" className="text-muted-foreground hover:text-destructive" onClick={() => { deleteLead(l.id); toast.success("Lead deleted"); }}><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No leads match your filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <AddLead open={open} onOpenChange={setOpen} />
    </Shell>
  );
}

function AddLead({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { leads, addLead } = useCRM();
  const [f, setF] = useState({ name: "", phone: "", company: "", source: "Website" as LeadSource, priority: "warm" as LeadPriority, quotedAmount: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dup = duplicatePhone(leads, f.phone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.phone.trim()) { toast.error("Name and phone are required"); return; }
    if (dup) { toast.error("A lead with this phone already exists"); return; }
    addLead({ name: f.name.trim(), phone: f.phone.trim(), company: f.company, source: f.source, priority: f.priority, status: "new", pinned: false, ...(Number(f.quotedAmount) > 0 ? { quotedAmount: Number(f.quotedAmount) } : {}), aiScore: f.priority === "hot" ? 85 : f.priority === "warm" ? 70 : 50 });
    toast.success("Lead added");
    setF({ name: "", phone: "", company: "", source: "Website", priority: "warm", quotedAmount: "" });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add lead</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Input placeholder="Full name *" value={f.name} onChange={set("name")} />
          <Input placeholder="Phone *" value={f.phone} onChange={set("phone")} />
          {dup && <p className="text-xs text-destructive">This phone number already belongs to a lead.</p>}
          <Input placeholder="Company" value={f.company} onChange={set("company")} />
          <div className="grid grid-cols-2 gap-3">
            <select className={sel} value={f.source} onChange={set("source")}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
            <select className={sel} value={f.priority} onChange={set("priority")}>{["hot", "warm", "cold"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <Input type="number" placeholder="Quoted amount (₹)" value={f.quotedAmount} onChange={set("quotedAmount")} />
          <Button type="submit">Save lead</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
