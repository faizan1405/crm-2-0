import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pin, Users } from "lucide-react";
import { Shell, PriorityBadge, Empty, selectCls } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { LostReasonDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatINR, relative } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadStatus, type LeadSource, type LeadPriority } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Leads · Scale Flow CRM" },
      { name: "description", content: "Search, filter, sort and add leads." },
      { property: "og:title", content: "Leads · Scale Flow CRM" },
      { property: "og:description", content: "Search, filter, sort and add leads." },
    ],
  }),
  component: Leads,
});

type Sort = "recent" | "score" | "value" | "name";

function Leads() {
  const { leads, updateLead, deleteLead, defaultLeadSort } = useCRM();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatus>("all");
  const [source, setSource] = useState<"all" | LeadSource>("all");
  const [prio, setPrio] = useState<"all" | LeadPriority>("all");
  const [sort, setSort] = useState<Sort>(defaultLeadSort);
  const [open, setOpen] = useState(false);
  const [lost, setLost] = useState<string | null>(null);
  useEffect(() => setSort(defaultLeadSort), [defaultLeadSort]);

  const rows = useMemo(() => {
    const r = leads.filter((l) => (status === "all" || l.status === status) && (source === "all" || l.source === source) && (prio === "all" || l.priority === prio) && `${l.name} ${l.company ?? ""} ${l.phone} ${l.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    const cmp = { recent: (a: typeof r[0], b: typeof r[0]) => b.createdAt.localeCompare(a.createdAt), score: (a: typeof r[0], b: typeof r[0]) => (b.aiScore ?? 0) - (a.aiScore ?? 0), value: (a: typeof r[0], b: typeof r[0]) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0), name: (a: typeof r[0], b: typeof r[0]) => a.name.localeCompare(b.name) }[sort];
    return r.sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b));
  }, [leads, q, status, source, prio, sort]);

  const changeStatus = (id: string, s: LeadStatus) => (s === "lost" ? setLost(id) : updateLead(id, { status: s }));
  const lostLead = leads.find((l) => l.id === lost);

  return (
    <Shell title="Leads" subtitle={`${rows.length} of ${leads.length} leads`} actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />Add lead</Button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search name, company, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Status filter" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All stages</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <select aria-label="Source filter" className={selectCls} value={source} onChange={(e) => setSource(e.target.value as typeof source)}><option value="all">All sources</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Priority filter" className={selectCls} value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)}><option value="all">All priorities</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Newest</option><option value="score">Highest score</option><option value="value">Highest value</option><option value="name">Name A–Z</option></select>
      </div>
      <div className="surface overflow-x-auto">
        {rows.length === 0 ? (
          <Empty icon={<Users />} title="No leads match" hint="Try clearing a filter or add a new lead." action={<Button variant="outline" onClick={() => { setQ(""); setStatus("all"); setSource("all"); setPrio("all"); }}>Clear filters</Button>} />
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["", "Lead", "Phone", "Source", "Priority", "Score", "Quoted", "Stage", "Updated", ""].map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t transition-colors hover:bg-muted/40">
                  <td className="pl-3"><button aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className={cn("rounded p-1", l.pinned ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground")}><Pin className="size-3.5" /></button></td>
                  <td className="px-3 py-3"><Link to="/leads/$id" params={{ id: l.id }} className="font-medium text-foreground hover:text-primary">{l.name}</Link><div className="text-xs text-muted-foreground">{l.company ?? "—"}</div></td>
                  <td className="num px-3 py-3 text-muted-foreground">{l.phone}</td>
                  <td className="px-3 py-3">{l.source}</td>
                  <td className="px-3 py-3"><PriorityBadge p={l.priority} /></td>
                  <td className="num px-3 py-3 font-semibold text-primary">{l.aiScore ?? "—"}</td>
                  <td className="num px-3 py-3">{formatINR(l.quotedAmount)}</td>
                  <td className="px-3 py-3"><select aria-label="Stage" className={cn(selectCls, "h-8")} value={l.status} onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{relative(l.updatedAt)}</td>
                  <td className="pr-3"><button aria-label="Delete lead" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${l.name}?`)) { deleteLead(l.id); toast.success("Lead deleted"); } }}><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <AddLeadDialog open={open} onOpenChange={setOpen} />
      <LostReasonDialog open={!!lost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setLost(null)} onConfirm={(r) => { if (!lost) return; updateLead(lost, { status: "lost", lostReason: r }); setLost(null); toast.success("Marked as lost"); }} />
    </Shell>
  );
}
