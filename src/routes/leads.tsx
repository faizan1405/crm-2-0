import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pin, Users, LayoutGrid, List, Phone, MessageCircle, CalendarPlus, ArrowUpRight } from "lucide-react";
import { startCall } from "@/components/crm/PostCallDialog";
import { Shell, PriorityBadge, Empty, Identity, selectCls } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { LostReasonDialog, FollowUpDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatINR, relative, formatDateTime, digits } from "@/lib/crm/format";
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
  const [view, setView] = useState<"table" | "cards">("table");
  const [fu, setFu] = useState<string | null>(null);
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
      <div className="mb-5 flex max-w-full gap-1 overflow-x-auto border-b pb-3 scrollbar-thin">{(["all", ...LEAD_STATUSES] as const).map(s => <Button key={s} size="sm" variant="ghost" onClick={() => setStatus(s)} className={cn("shrink-0", status === s ? "bg-primary-soft text-primary" : "text-muted-foreground")}>{s === "all" ? "All leads" : STATUS_LABEL[s]}<span className="ml-1 text-[10px] opacity-70">{s === "all" ? leads.length : leads.filter(l => l.status === s).length}</span></Button>)}</div>
      <div className="mb-5 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search name, company, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Status filter" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All stages</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <select aria-label="Source filter" className={selectCls} value={source} onChange={(e) => setSource(e.target.value as typeof source)}><option value="all">All sources</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Priority filter" className={selectCls} value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)}><option value="all">All priorities</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Newest</option><option value="score">Highest score</option><option value="value">Highest value</option><option value="name">Name A–Z</option></select>
        <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="View">{([["table", List], ["cards", LayoutGrid]] as const).map(([v, I]) => <Button key={v} size="icon" variant="ghost" aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)} className={cn("size-8", view === v ? "bg-primary-soft text-primary" : "text-muted-foreground")}><I className="size-4" /></Button>)}</div>
      </div>
      {view === "cards" && rows.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => (
            <article key={l.id} className={cn("surface surface-hover flex flex-col gap-4 p-5", l.pinned && "ring-1 ring-primary/40")}>
              <div className="flex items-start justify-between gap-2">
                <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 hover:text-primary"><Identity name={l.name} company={l.company} /></Link>
                <Button size="icon" variant="ghost" aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className={cn("size-8 shrink-0", l.pinned ? "text-primary" : "text-muted-foreground/50")}><Pin className="size-4" /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5"><PriorityBadge p={l.priority} /><span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">{STATUS_LABEL[l.status]}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.source}</span></div>
              <dl className="grid grid-cols-2 gap-3 border-y py-3 text-xs">
                <div><dt className="text-muted-foreground">{l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num mt-0.5 text-base font-bold">{formatINR(l.quotedAmount ?? l.budget)}</dd></div>
                <div><dt className="text-muted-foreground">Phone</dt><dd className="num mt-0.5 font-medium">{l.phone}</dd></div>
                <div><dt className="text-muted-foreground">Next follow-up</dt><dd className="mt-0.5 font-medium">{l.nextFollowUp ? formatDateTime(l.nextFollowUp) : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Updated</dt><dd className="mt-0.5 font-medium">{relative(l.updatedAt)}</dd></div>
              </dl>
              <div className="mt-auto flex items-center gap-1">
                <Button size="sm" variant="outline" asChild><a href={`tel:${l.phone}`} onClick={() => startCall(l.id, "Leads")}><Phone className="size-3.5" />Call</a></Button>
                <Button size="icon" variant="ghost" asChild className="size-8"><a href={`https://wa.me/91${digits(l.phone)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${l.name}`}><MessageCircle className="size-4 text-success" /></a></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Schedule follow-up" onClick={() => setFu(l.id)}><CalendarPlus className="size-4 text-teal" /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Delete lead" onClick={() => { if (window.confirm(`Delete ${l.name}?`)) { deleteLead(l.id); toast.success("Lead deleted"); } }}><Trash2 className="size-4 text-muted-foreground" /></Button>
                <Button size="sm" variant="ghost" asChild className="ml-auto text-primary"><Link to="/leads/$id" params={{ id: l.id }}>View<ArrowUpRight className="size-3.5" /></Link></Button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="surface overflow-x-auto">
        {rows.length === 0 ? (
          <Empty icon={<Users />} title="No leads match" hint="Try clearing a filter or add a new lead." action={<Button variant="outline" onClick={() => { setQ(""); setStatus("all"); setSource("all"); setPrio("all"); }}>Clear filters</Button>} />
        ) : (
          <table className="w-full min-w-[1120px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["", "Lead", "Phone", "Source", "Priority", "Score", "Quoted", "Stage", "Updated", ""].map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t transition-colors hover:bg-muted/40">
                  <td className="pl-3"><Button size="icon" variant="ghost" title={l.pinned ? "Unpin" : "Pin"} aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className={cn("rounded p-1", l.pinned ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground")}><Pin className="size-3.5" /></Button></td>
                  <td className="min-w-52 px-3 py-3"><Link to="/leads/$id" params={{ id: l.id }} className="text-foreground hover:text-primary"><Identity name={l.name} company={l.company} /></Link></td>
                  <td className="num px-3 py-3 text-muted-foreground"><a href={`tel:${l.phone}`} className="hover:text-primary" onClick={() => startCall(l.id, "Leads")}>{l.phone}</a></td>
                  <td className="px-3 py-3">{l.source}</td>
                  <td className="px-3 py-3"><PriorityBadge p={l.priority} /></td>
                  <td className="num px-3 py-3 font-semibold text-primary">{l.aiScore ?? "—"}</td>
                  <td className="num px-3 py-3">{formatINR(l.quotedAmount)}</td>
                  <td className="px-3 py-3"><select aria-label="Stage" className={cn(selectCls, "h-8")} value={l.status} onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{relative(l.updatedAt)}</td>
                  <td className="pr-3"><Button size="icon" variant="ghost" title="Delete lead" aria-label="Delete lead" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${l.name}?`)) { deleteLead(l.id); toast.success("Lead deleted"); } }}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>}
      <FollowUpDialog open={!!fu} onOpenChange={(o) => !o && setFu(null)} {...(fu ? { leadId: fu } : {})} />
      <AddLeadDialog open={open} onOpenChange={setOpen} />
      <LostReasonDialog open={!!lost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setLost(null)} onConfirm={(r) => { if (!lost) return; updateLead(lost, { status: "lost", lostReason: r }); setLost(null); toast.success("Marked as lost"); }} />
    </Shell>
  );
}
