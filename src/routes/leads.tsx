import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pin, Users, LayoutGrid, List, Phone, MessageCircle, CalendarPlus, ArrowUpRight, Layers, Archive, Ban, Clock, Columns2, PhoneCall } from "lucide-react";
import { BulkLeadDialog } from "@/components/crm/BulkLeadDialog";
import { QUICK_STATUSES, QUICK_LABEL, staleDays, type QuickStatus } from "@/lib/crm/leadtools";
import { startCall, openCallLog } from "@/components/crm/PostCallDialog";
import { isPending } from "@/lib/crm/followups";
import { dealCollected, dealOutstanding } from "@/lib/crm/finance";
import { CallButton } from "@/components/crm/CallButton";
import { Shell, PriorityBadge, Empty, Identity, selectCls } from "@/components/crm/Shell";
import { AddLeadDialog } from "@/components/crm/AddLeadDialog";
import { LostReasonDialog, FollowUpDialog } from "@/components/crm/Dialogs";
import { useAccess } from "@/lib/crm/session";
import { useCRM } from "@/lib/crm/store";
import { formatINR, formatINRCompact, relative, formatDateTime, digits } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadStatus, type LeadSource, type LeadPriority } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AssignDialog, AssigneeTag } from "@/components/team/AssignDialog";
import { UserCheck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Prospects · Scale Flow Sales OS" },
      { name: "description", content: "A prospect workspace: searchable directory with an instant lead inspector." },
      { property: "og:title", content: "Prospects · Scale Flow Sales OS" },
      { property: "og:description", content: "A prospect workspace: searchable directory with an instant lead inspector." },
    ],
  }),
  component: Leads,
});

type Sort = "recent" | "score" | "value" | "name";

function Leads() {
  const { leads, updateLead, deleteLead, wasteLead, restoreLead, setQuickStatus, bin, defaultLeadSort } = useCRM();
  const { can } = useAccess();
  const canDel = can("leads.delete");
  const [bulk, setBulk] = useState(false);
  const [quick, setQuick] = useState<"all" | "stale" | QuickStatus>("all");
  const now = useMemo(() => new Date(), [leads]);
  const removeLead = (id: string, name: string, kind: "waste" | "deleted") => {
    if (!canDel) { toast.error("Not allowed by this employee's permissions"); return; }
    if (kind === "waste") wasteLead(id); else deleteLead(id);
    const binId = useCRM.getState().bin[0]?.id;
    toast.success(kind === "waste" ? `${name} moved to Waste` : `${name} deleted`, { action: binId ? { label: "Undo", onClick: () => { const e = restoreLead(binId); if (e) toast.error(e); } } : undefined });
  };
  const quickSel = (id: string, v?: QuickStatus) => <select aria-label="Quick status" className={cn(selectCls, "h-8 text-xs")} value={v ?? ""} onChange={(e) => setQuickStatus(id, (e.target.value || undefined) as QuickStatus | undefined)}><option value="">Quick status…</option>{QUICK_STATUSES.map((q) => <option key={q} value={q}>{QUICK_LABEL[q]}</option>)}</select>;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatus>("all");
  const [source, setSource] = useState<"all" | LeadSource>("all");
  const [prio, setPrio] = useState<"all" | LeadPriority>("all");
  const [sort, setSort] = useState<Sort>(defaultLeadSort);
  const [open, setOpen] = useState(false);
  const [lost, setLost] = useState<string | null>(null);
  const [view, setView] = useState<"workspace" | "table" | "cards">("workspace");
  const [selected, setSelected] = useState<string | null>(null);
  const navigate = useNavigate();
  const [fu, setFu] = useState<string | null>(null);
  // Owner-only bulk assignment; selection survives filter changes and never alters lead data.
  const [picked, setPicked] = useState<string[]>([]), [assignFor, setAssignFor] = useState<string[] | null>(null);
  const togglePick = (id: string, v: boolean) => setPicked((x) => (v ? (x.includes(id) ? x : [...x, id]) : x.filter((y) => y !== id)));
  useEffect(() => setSort(defaultLeadSort), [defaultLeadSort]);

  const rows = useMemo(() => {
    const r = leads.filter((l) => (status === "all" || l.status === status) && (source === "all" || l.source === source) && (prio === "all" || l.priority === prio) && (quick === "all" || (quick === "stale" ? staleDays(l, now) !== undefined : l.quickStatus === quick)) && `${l.name} ${l.company ?? ""} ${l.phone} ${l.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    const cmp = { recent: (a: typeof r[0], b: typeof r[0]) => b.createdAt.localeCompare(a.createdAt), score: (a: typeof r[0], b: typeof r[0]) => (b.aiScore ?? 0) - (a.aiScore ?? 0), value: (a: typeof r[0], b: typeof r[0]) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0), name: (a: typeof r[0], b: typeof r[0]) => a.name.localeCompare(b.name) }[sort];
    return r.sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b));
  }, [leads, q, status, source, prio, sort, quick, now]);

  const changeStatus = (id: string, s: LeadStatus) => (s === "lost" ? setLost(id) : updateLead(id, { status: s }));
  const lostLead = leads.find((l) => l.id === lost);

  const sel = rows.find((l) => l.id === selected) ?? rows[0];
  const pick = (id: string) => { if (window.matchMedia("(max-width: 1023px)").matches) navigate({ to: "/leads/$id", params: { id } }); else setSelected(id); };
  const filters = (
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="rounded-full pl-9" placeholder="Search name, company, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <select aria-label="Source filter" className={selectCls} value={source} onChange={(e) => setSource(e.target.value as typeof source)}><option value="all">All sources</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
      <select aria-label="Priority filter" className={selectCls} value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)}><option value="all">All priorities</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
      <select aria-label="Quick status filter" className={selectCls} value={quick} onChange={(e) => setQuick(e.target.value as typeof quick)}><option value="all">Any quick status</option><option value="stale">Stale (7+ days quiet)</option>{QUICK_STATUSES.map((x) => <option key={x} value={x}>{QUICK_LABEL[x]}</option>)}</select>
      <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Newest</option><option value="score">Highest score</option><option value="value">Highest value</option><option value="name">Name A–Z</option></select>
    </div>
  );
  const empty = <Empty icon={<Users />} title="No leads match" hint="Try clearing a filter or add a new lead." action={<Button variant="outline" onClick={() => { setQ(""); setStatus("all"); setSource("all"); setPrio("all"); setQuick("all"); }}>Clear filters</Button>} />;

  return (
    <Shell title="Prospects" subtitle={`${rows.length} of ${leads.length} leads in view · select one to inspect it without leaving the list`} actions={<div className="flex flex-wrap gap-2">{canDel && <Button variant="outline" asChild className="rounded-full"><Link to="/leads/bin"><Archive className="size-4" />Waste & deleted{bin.length ? <span className="num ml-1 text-xs text-muted-foreground">{bin.length}</span> : null}</Link></Button>}{can("import.run") && <Button variant="outline" onClick={() => setBulk(true)} className="rounded-full"><Layers className="size-4" />Bulk add</Button>}{can("leads.create") && <Button onClick={() => setOpen(true)} className="rounded-full"><Plus className="size-4" />Add lead</Button>}</div>}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-foreground pt-4">
        <div className="flex max-w-full gap-4 overflow-x-auto scrollbar-thin">{(["all", ...LEAD_STATUSES] as const).map(s => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} data-stage={s} className={cn("flex shrink-0 items-baseline gap-1.5 border-b-2 pb-1.5 text-sm transition-colors", status === s ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{s === "all" ? "Everyone" : STATUS_LABEL[s]}<span className="num text-[11px] opacity-70">{s === "all" ? leads.length : leads.filter(l => l.status === s).length}</span></button>)}</div>
        <div className="seg" role="group" aria-label="View">{([["workspace", Columns2, "Workspace"], ["table", List, "Ledger"], ["cards", LayoutGrid, "Tiles"]] as const).map(([v, I, label]) => <button key={v} type="button" aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)}><I className="size-3.5" /><span className="hidden sm:inline">{label}</span></button>)}</div>
      </div>
      <div className="mb-6">{filters}</div>

      {rows.length === 0 ? <div className="panel">{empty}</div> : view === "workspace" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,0.9fr)_1.4fr]">
          <div role="listbox" aria-label="Lead directory" className="max-h-[calc(100vh-180px)] overflow-y-auto border-t border-foreground scrollbar-thin lg:sticky lg:top-32">
            {rows.map((l) => { const st = staleDays(l, now); return (
              <div key={l.id} role="option" tabIndex={0} aria-selected={sel?.id === l.id} data-priority={l.priority} onClick={() => pick(l.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(l.id); } }} className="prospect-row prospect-row-pick">
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center"><Checkbox aria-label={`Select ${l.name}`} checked={picked.includes(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /></span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="prio-dot shrink-0" /><span className="truncate text-sm font-semibold">{l.name}</span>{l.pinned && <Pin className="size-3 shrink-0" aria-label="Pinned" />}{st !== undefined && <span className="aging is-old shrink-0">stale {st}d</span>}</div>
                  <div className="mt-1 flex items-center gap-2 truncate pl-4 text-xs text-muted-foreground"><span className="stage-chip shrink-0" data-stage={l.status}>{STATUS_LABEL[l.status]}</span><span className="truncate">{l.company ?? l.source} · {l.lastContact ? `spoke ${relative(l.lastContact)}` : "not contacted"}</span><AssigneeTag leadId={l.id} /></div>
                </div>
                <div className="text-right"><div className="num text-sm">{formatINRCompact(l.quotedAmount ?? l.budget ?? 0)}</div><div className="eyebrow mt-0.5">{l.source}</div></div>
              </div>); })}
          </div>
          {sel && <Inspector key={sel.id} id={sel.id} onFollowUp={() => setFu(sel.id)} onStage={(s) => changeStatus(sel.id, s)} onRemove={(k) => removeLead(sel.id, sel.name, k)} onAssign={() => setAssignFor([sel.id])} quickSel={quickSel(sel.id, sel.quickStatus)} />}
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l, i) => { const st = staleDays(l, now); return (
            <article key={l.id} data-priority={l.priority} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }} className={cn("prospect-tile", l.pinned && "is-pinned")}>
              <span className="tile-score num" aria-hidden>{l.aiScore ?? ""}</span>
              <div className="flex items-start justify-between gap-2"><div className="relative flex items-center gap-2"><Checkbox aria-label={`Select ${l.name}`} checked={picked.includes(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /><span className="prio-dot" /><span className="eyebrow">{l.priority} · {l.source}</span></div><Button size="icon" variant="ghost" aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className="relative size-8 rounded-full"><Pin className={cn("size-4", !l.pinned && "opacity-40")} /></Button></div>
              <Link to="/leads/$id" params={{ id: l.id }} className="relative"><h3 className="editorial text-[30px]">{l.name}</h3><p className="mt-1 text-xs text-muted-foreground">{l.company ?? "Independent"} · {l.phone}</p></Link>
              <div className="relative flex flex-wrap items-center gap-1.5"><span className="stage-chip" data-stage={l.status}>{STATUS_LABEL[l.status]}</span>{l.quickStatus && <span className="aging">{QUICK_LABEL[l.quickStatus]}</span>}{st !== undefined && <span className="aging is-old"><Clock className="mr-1 inline size-3" />stale {st}d</span>}</div>
              <dl className="relative grid grid-cols-3 gap-3 border-t pt-3 text-xs"><div><dt className="eyebrow">{l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num mt-1 text-sm">{formatINRCompact(l.quotedAmount ?? l.budget ?? 0)}</dd></div><div><dt className="eyebrow">Next</dt><dd className="mt-1">{l.nextFollowUp ? formatDateTime(l.nextFollowUp) : "—"}</dd></div><div><dt className="eyebrow">Updated</dt><dd className="mt-1">{relative(l.updatedAt)}</dd></div></dl>
              <div className="relative">{quickSel(l.id, l.quickStatus)}</div>
              <div className="relative mt-auto flex items-center gap-1">
                <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Leads cards" />
                <WhatsAppButton leadId={l.id} name={l.name} source="Leads cards" />
                <Button size="icon" variant="ghost" className="size-8 rounded-full" aria-label="Schedule follow-up" onClick={() => setFu(l.id)}><CalendarPlus className="size-4" /></Button>
                {canDel && <Button size="icon" variant="ghost" className="size-8 rounded-full" aria-label="Move to Waste" title="Move to Waste" onClick={() => removeLead(l.id, l.name, "waste")}><Ban className="size-4" /></Button>}
                {canDel && <Button size="icon" variant="ghost" className="size-8 rounded-full" aria-label="Delete lead" onClick={() => removeLead(l.id, l.name, "deleted")}><Trash2 className="size-4" /></Button>}
                <Button size="sm" variant="ghost" asChild className="ml-auto rounded-full"><Link to="/leads/$id" params={{ id: l.id }}>View<ArrowUpRight className="size-3.5" /></Link></Button>
              </div>
            </article>); })}
        </div>
      ) : <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-left text-muted-foreground"><tr>{["", "Lead", "Phone", "Source", "Priority", "Score", "Quoted", "Stage", "Quick status", "Updated", ""].map((h, i) => <th key={i} className="px-3">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b hover:bg-card">
                  <td className="pl-1"><span className="inline-flex items-center gap-1"><Checkbox aria-label={`Select ${l.name}`} checked={picked.includes(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /><Button size="icon" variant="ghost" title={l.pinned ? "Unpin" : "Pin"} aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className={cn("rounded-full", !l.pinned && "opacity-30 hover:opacity-80")}><Pin className="size-3.5" /></Button></span></td>
                  <td className="min-w-52 px-3"><Link to="/leads/$id" params={{ id: l.id }} className="hover:underline"><Identity name={l.name} company={l.company} /></Link></td>
                  <td className="num px-3 text-muted-foreground"><a href={`tel:${l.phone}`} className="hover:text-foreground" onClick={() => startCall(l.id, "Leads")}>{l.phone}</a></td>
                  <td className="px-3">{l.source}<div className="mt-0.5"><AssigneeTag leadId={l.id} /></div></td>
                  <td className="px-3"><PriorityBadge p={l.priority} /></td>
                  <td className="num px-3">{l.aiScore ?? "—"}</td>
                  <td className="num px-3">{formatINR(l.quotedAmount)}</td>
                  <td className="px-3"><select aria-label="Stage" className={cn(selectCls, "h-8")} value={l.status} onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></td>
                  <td className="px-3">{quickSel(l.id, l.quickStatus)}</td>
                  <td className="px-3 text-xs text-muted-foreground">{relative(l.updatedAt)}{staleDays(l, now) !== undefined && <span className="aging is-old ml-1.5">stale</span>}</td>
                  <td className="pr-1">{canDel && <><Button size="icon" variant="ghost" title="Move to Waste" aria-label="Move to Waste" className="rounded-full text-muted-foreground" onClick={() => removeLead(l.id, l.name, "waste")}><Ban className="size-4" /></Button><Button size="icon" variant="ghost" title="Delete lead" aria-label="Delete lead" className="rounded-full text-muted-foreground hover:text-destructive" onClick={() => removeLead(l.id, l.name, "deleted")}><Trash2 className="size-4" /></Button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {picked.length > 0 && <div className="as-bulk" role="region" aria-label="Bulk actions"><span className="text-sm font-semibold"><span className="num">{picked.length}</span> lead{picked.length === 1 ? "" : "s"} selected</span>{can("leads.assign") && <Button size="sm" onClick={() => setAssignFor(picked)}><UserCheck />Assign / reassign</Button>}<Button size="sm" variant="ghost" onClick={() => setPicked(rows.map((r) => r.id))}>Select all {rows.length}</Button><Button size="sm" variant="ghost" aria-label="Clear selection" onClick={() => setPicked([])}><X />Clear</Button></div>}
      <AssignDialog open={!!assignFor} leadIds={assignFor ?? []} source={assignFor && assignFor.length > 1 ? "Leads bulk" : "Leads inspector"} onClose={() => setAssignFor(null)} onDone={() => { if (assignFor && assignFor.length > 1) setPicked([]); }} />
      <FollowUpDialog open={!!fu} onOpenChange={(o) => !o && setFu(null)} {...(fu ? { leadId: fu } : {})} />
      <AddLeadDialog open={open} onOpenChange={setOpen} />
      <BulkLeadDialog open={bulk} onOpenChange={setBulk} />
      <LostReasonDialog open={!!lost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setLost(null)} onConfirm={(r) => { if (!lost) return; updateLead(lost, { status: "lost", lostReason: r }); setLost(null); toast.success("Marked as lost"); }} />
    </Shell>
  );
}

function Inspector({ id, onFollowUp, onStage, onRemove, onAssign, quickSel }: { id: string; onFollowUp: () => void; onAssign: () => void; onStage: (s: LeadStatus) => void; onRemove: (k: "waste" | "deleted") => void; quickSel: React.ReactNode }) {
  const { leads, deals, payments, activities, followUps, updateLead } = useCRM();
  const l = leads.find((x) => x.id === id);
  if (!l) return null;
  const myDeals = deals.filter((d) => d.leadId === l.id);
  const fu = followUps.filter((f) => f.leadId === l.id && isPending(f)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const hist = activities.filter((a) => a.leadId === l.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
  return (
    <aside aria-label={`${l.name} inspector`} className="inspector panel self-start p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><div className="eyebrow" data-priority={l.priority}><span className="prio-dot mr-1.5" />{l.priority} priority · score {l.aiScore ?? "—"}</div><h2 className="editorial mt-2 text-[44px]">{l.name}</h2><p className="mt-1 text-sm text-muted-foreground">{l.company ?? "Independent"} · <span className="num">{l.phone}</span>{l.email ? ` · ${l.email}` : ""}</p></div>
        <Button size="icon" variant="ghost" aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className="rounded-full"><Pin className={cn("size-4", !l.pinned && "opacity-40")} /></Button>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Leads workspace" />
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => openCallLog(l.id, "Leads workspace")}><PhoneCall className="size-3.5" />Log call</Button>
        <WhatsAppButton leadId={l.id} name={l.name} source="Leads workspace" label />
        <Button variant="outline" size="sm" className="rounded-full" onClick={onFollowUp}><CalendarPlus className="size-3.5" />Follow-up</Button>
        <Button variant="ghost" size="sm" asChild className="ml-auto rounded-full"><Link to="/leads/$id" params={{ id: l.id }}>Full record<ArrowUpRight className="size-3.5" /></Link></Button>
      </div>
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-4">
        <div><dt className="eyebrow">Stage</dt><dd className="mt-1.5"><select aria-label="Stage" className={cn(selectCls, "h-8 w-full text-xs")} value={l.status} onChange={(e) => onStage(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></dd></div>
        <div><dt className="eyebrow">Quick status</dt><dd className="mt-1.5">{quickSel}</dd></div>
        <div><dt className="eyebrow">{l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num mt-1.5 text-lg">{formatINR(l.quotedAmount ?? l.budget)}</dd></div>
        <div><dt className="eyebrow">Next follow-up</dt><dd className="mt-1.5 text-sm">{fu ? formatDateTime(fu.dueAt) : "None booked"}</dd></div>
      </dl>
      <div className="as-insp"><span className="eyebrow">Responsible</span><AssigneeTag leadId={l.id} /><Button size="sm" variant="outline" className="ml-auto rounded-full" onClick={onAssign}><UserCheck className="size-3.5" />Assign to employee</Button></div>
      {l.requirement && <p className="mt-6 border-l-2 border-clay pl-4 text-sm leading-relaxed">{l.requirement}</p>}
      {l.status === "lost" && l.lostReason && <p className="mt-4 text-sm text-destructive">Lost · {l.lostReason}</p>}
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div><div className="eyebrow mb-3">Deals</div>{myDeals.length ? <ul className="grid gap-3">{myDeals.map((d) => { const got = dealCollected(d.id, payments); return <li key={d.id}><Link to="/deals" className="block rounded-xl border p-3 hover:bg-secondary"><div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{d.name}</span><span className="num">{formatINRCompact(d.finalAmount)}</span></div><div className="balance-track mt-2 h-1.5"><div style={{ width: `${d.finalAmount ? Math.min(got / d.finalAmount, 1) * 100 : 0}%` }} /></div><div className="num mt-1 text-[11px] text-muted-foreground">{formatINRCompact(got)} received · {formatINRCompact(dealOutstanding(d, payments))} due</div></Link></li>; })}</ul> : <p className="text-xs text-muted-foreground">No deal yet.</p>}</div>
        <div><div className="eyebrow mb-3">Conversation history</div><ol className="timeline grid gap-4">{hist.map((a) => <li key={a.id} data-kind={a.type}><p className="text-xs leading-relaxed">{a.text}</p><span className="eyebrow">{relative(a.at)}</span></li>)}{!hist.length && <li className="text-xs text-muted-foreground">No activity yet.</li>}</ol></div>
      </div>
      {useAccess().can("leads.delete") && <div className="mt-8 flex gap-2 border-t pt-4"><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => onRemove("waste")}><Ban className="size-3.5" />Move to Waste</Button><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-destructive" onClick={() => onRemove("deleted")}><Trash2 className="size-3.5" />Delete</Button></div>}
    </aside>
  );
}
