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
import { formatINR, formatINRCompact, relative, formatDateTime, formatDate, digits } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadStatus, type LeadSource, type LeadPriority } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AssignDialog, AssigneeTag } from "@/components/team/AssignDialog";
import { UserCheck, X, ChevronLeft, ChevronRight } from "lucide-react";
import { BulkAssignDialog } from "@/components/team/BulkAssignDialog";
import { EMPTY_SELECTION, addPage, isSelected, selectMatching, selectedIds, selectionCount, toggle, type Selection } from "@/lib/crm/bulk";
import { dayKey } from "@/lib/crm/format";
import { parseLeadsSearch, matchesCreatedRange } from "@/lib/crm/leadsSearch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AdditionalInfo, TagChips, TagPicker, useViewer } from "@/components/crm/Customize";
import { ViewEditor, newView } from "@/components/crm/ViewEditor";
import { viewCtxOf, viewerId } from "@/lib/crm/store";
import { tagForLeads, runView, viewAllowed, viewEditable, viewIssues, type SavedView, type ViewCondition } from "@/lib/crm/customize";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bookmark, BookmarkPlus, Star, Tag, AlertTriangle, Pencil } from "lucide-react";

export const Route = createFileRoute("/leads")({
  validateSearch: parseLeadsSearch,
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
  const { leads, updateLead, deleteLead, wasteLead, restoreLead, setQuickStatus, bin, defaultLeadSort, assignments, employees, followUps } = useCRM();
  const crm = useCRM();
  const viewer = useViewer(); const me = viewerId(viewer);
  const search = Route.useSearch(); const viewId = search.view;
  // Created-date range from Analytics drill-downs lives only in the URL (India business days) — never saved into views.
  const cFrom = search.from, cTo = search.to, cSrc = search.src;
  const myViews = crm.savedViews.filter((v) => !v.archived && viewAllowed(v, viewer));
  const activeView = myViews.find((v) => v.id === viewId);
  const vprefs = crm.viewPrefs[me] ?? { pinned: [] };
  const [tagF, setTagF] = useState<string>("all");
  const [viewEdit, setViewEdit] = useState<SavedView | null>(null);
  const [tagOp, setTagOp] = useState<{ tagId: string; mode: "add" | "remove" } | null>(null);
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
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION), [assignFor, setAssignFor] = useState<string[] | null>(null), [bulkAssign, setBulkAssign] = useState(false);
  const picked = useMemo(() => selectedIds(selection), [selection]);
  const pickedCount = selectionCount(selection);
  const isPicked = (id: string) => isSelected(selection, id);
  const togglePick = (id: string, v: boolean) => setSelection((x) => toggle(x, id, v));
  const [who, setWho] = useState<string>("all"), [created, setCreated] = useState<"all" | "7" | "30" | "90">("all"), [due, setDue] = useState<"all" | "overdue" | "today" | "week" | "none">("all");
  const [page, setPage] = useState(0); const PAGE = 50;
  useEffect(() => setSort(defaultLeadSort), [defaultLeadSort]);
  // Open the viewer's default view once, if they haven't chosen one in the URL.
  useEffect(() => { if (!viewId && vprefs.defaultId && myViews.some((v) => v.id === vprefs.defaultId)) void navigate({ to: "/leads", search: { view: vprefs.defaultId }, replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Changing the view changes the dataset — a broad selection from the old view is cleared, never re-applied.
  const [lastView, setLastView] = useState(viewId);
  useEffect(() => { if (viewId === lastView) return; setLastView(viewId); if (selectionCount(selection) > 0) { setSelection(EMPTY_SELECTION); toast.info("Selection cleared because the view changed"); } setStatus("all"); setSource("all"); setPrio("all"); setQuick("all"); setWho("all"); setCreated("all"); setDue("all"); setTagF("all"); if (activeView) setSort(activeView.sort as Sort); }, [viewId]); // eslint-disable-line react-hooks/exhaustive-deps
  const openView = (id?: string) => void navigate({ to: "/leads", search: id ? { view: id } : {} });

  function dueMatch(leadId: string) {
    const f = followUps.filter((x) => x.leadId === leadId && isPending(x));
    if (due === "none") return f.length === 0;
    const t = now.getTime(), today = dayKey(now);
    if (due === "overdue") return f.some((x) => new Date(x.dueAt).getTime() < t);
    if (due === "today") return f.some((x) => dayKey(x.dueAt) === today);
    return f.some((x) => { const d = new Date(x.dueAt).getTime(); return d >= t && d <= t + 7 * 864e5; });
  }
  // One filter pass: `scoped` = every active filter except the stage tab; stage counts and rows both derive from it.
  const scoped = useMemo(() => {
    const base = activeView ? runView(activeView, leads, viewCtxOf(crm, viewer, now)) : leads;
    const r = base.filter((l) => tagF === "all" || (crm.leadTags[l.id] ?? []).includes(tagF)).filter((l) => (source === "all" || l.source === source) && (prio === "all" || l.priority === prio) && (quick === "all" || (quick === "stale" ? staleDays(l, now) !== undefined : l.quickStatus === quick)) && `${l.name} ${l.company ?? ""} ${l.phone} ${l.email ?? ""}`.toLowerCase().includes(q.toLowerCase())
      && (who === "all" || (who === "__none" ? !assignments[l.id] : assignments[l.id]?.employeeId === who))
      && (created === "all" || now.getTime() - new Date(l.createdAt).getTime() <= Number(created) * 864e5)
      && matchesCreatedRange(dayKey(l.createdAt), l.source, search)
      && (due === "all" || dueMatch(l.id)));
    return r;
  }, [leads, q, source, prio, quick, now, who, created, due, assignments, followUps, activeView, tagF, crm.leadTags, crm.fieldValues, crm.customFields, cFrom, cTo, cSrc]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageCounts = useMemo(() => { const m: Record<string, number> = { all: scoped.length }; for (const l of scoped) m[l.status] = (m[l.status] ?? 0) + 1; return m; }, [scoped]);
  const rows = useMemo(() => {
    const r = scoped.filter((l) => status === "all" || l.status === status);
    const cmp = { recent: (a: typeof r[0], b: typeof r[0]) => b.createdAt.localeCompare(a.createdAt), score: (a: typeof r[0], b: typeof r[0]) => (b.aiScore ?? 0) - (a.aiScore ?? 0), value: (a: typeof r[0], b: typeof r[0]) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0), name: (a: typeof r[0], b: typeof r[0]) => a.name.localeCompare(b.name) }[sort];
    return r.sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b));
  }, [scoped, status, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(0), [q, status, source, prio, sort, quick, who, created, due, viewId, tagF, cFrom, cTo, cSrc]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(page, pages - 1);
  const pageRows = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const filterLabel = [activeView && `view “${activeView.name}”`, tagF !== "all" && `tag ${crm.tagDefs.find((t) => t.id === tagF)?.name}`, status !== "all" && STATUS_LABEL[status], source !== "all" && source, prio !== "all" && prio, who === "__none" ? "Unassigned" : who !== "all" && employees.find((e) => e.id === who)?.name, created !== "all" && `created ≤${created}d`, (cFrom || cTo) && `created ${cFrom ?? "…"} → ${cTo ?? "…"}`, cSrc && `source ${cSrc}`, due !== "all" && `follow-up ${due}`, q && `“${q}”`].filter(Boolean).join(" · ") || "all leads";

  /** Turn the current quick filters into Saved View conditions (only filters that have an exact equivalent). */
  const currentConditions = (): ViewCondition[] => {
    const c: Omit<ViewCondition, "id">[] = [...(activeView?.filter.mode === "and" ? activeView.filter.conditions : [])];
    if (q.trim()) c.push({ field: "search", op: "contains", value: q.trim() });
    if (status !== "all") c.push({ field: "stage", op: "is", value: [status] });
    if (source !== "all") c.push({ field: "source", op: "is", value: [source] });
    if (prio !== "all") c.push({ field: "priority", op: "is", value: [prio] });
    if (quick !== "all" && quick !== "stale") c.push({ field: "quick", op: "is", value: [quick] });
    if (who !== "all") c.push({ field: "assignee", op: "is", value: [who] });
    if (created !== "all") c.push({ field: "created", op: "within_days", value: Number(created) });
    if (due === "overdue") c.push({ field: "followupDue", op: "overdue" }); else if (due === "today") c.push({ field: "followupDue", op: "today" }); else if (due === "none") c.push({ field: "followupDue", op: "empty" });
    if (tagF !== "all") c.push({ field: "tags", op: "contains_any", value: [tagF] });
    return c.map((x, i) => ({ ...x, id: `c${Date.now().toString(36)}${i}` }));
  };
  const runTagOp = () => {
    if (!tagOp) return; const name = crm.tagDefs.find((t) => t.id === tagOp.tagId)?.name ?? "tag";
    const r = crm.bulkTagLeads(picked, tagOp.tagId, tagOp.mode); setTagOp(null);
    if (!r.changed) { toast.info(`No lead needed this change`); return; }
    toast.success(`${tagOp.mode === "add" ? "Added" : "Removed"} “${name}” · ${r.changed} lead${r.changed === 1 ? "" : "s"}`, { action: { label: "Undo", onClick: () => { const u = useCRM.getState().undoBulkTags(r.before, r.applied); toast(u.kept ? `Undone on ${u.restored} · ${u.kept} kept (changed since)` : `Undone on ${u.restored} lead${u.restored === 1 ? "" : "s"}`); } } });
  };
  const activeTags = crm.tagDefs.filter((t) => t.status === "active" && tagForLeads(t));
  const viewWarn = activeView ? viewIssues(activeView, viewCtxOf(crm, viewer)) : [];
  const pinnedViews = myViews.filter((v) => vprefs.pinned.includes(v.id));
  /** Bulk edit with one Undo; each lead goes through the normal guarded updateLead. Lost is excluded (needs a reason per lead). */
  const bulkPatch = (patch: { priority?: LeadPriority; status?: LeadStatus }, label: string) => {
    const before = new Map(leads.filter((l) => picked.includes(l.id)).map((l) => [l.id, { priority: l.priority, status: l.status }]));
    let n = 0, failed = 0;
    for (const id of before.keys()) { const cur = before.get(id)!; if ((patch.priority && cur.priority === patch.priority) || (patch.status && cur.status === patch.status)) continue; if (updateLead(id, patch)) n++; else failed++; }
    const missing = picked.length - before.size;
    const undo = () => { for (const [id, b] of before) updateLead(id, patch.priority ? { priority: b.priority } : { status: b.status }); };
    const tail = [failed && `${failed} not allowed`, missing && `${missing} no longer exist`].filter(Boolean).join(", ");
    (tail ? toast.warning : toast.success)(`${label} · ${n} lead${n === 1 ? "" : "s"} changed${tail ? ` · ${tail}` : ""}`, n ? { action: { label: "Undo", onClick: undo } } : undefined);
  };
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
      {employees.length > 0 && <select aria-label="Assignee filter" className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}><option value="all">Any assignee</option><option value="__none">Unassigned</option>{employees.filter((e) => e.accountStatus !== "archived").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
      <select aria-label="Created filter" className={selectCls} value={created} onChange={(e) => setCreated(e.target.value as typeof created)}><option value="all">Any created date</option><option value="7">Created last 7 days</option><option value="30">Created last 30 days</option><option value="90">Created last 90 days</option></select>
      <select aria-label="Follow-up due filter" className={selectCls} value={due} onChange={(e) => setDue(e.target.value as typeof due)}><option value="all">Any follow-up</option><option value="overdue">Follow-up overdue</option><option value="today">Follow-up today</option><option value="week">Due next 7 days</option><option value="none">No follow-up</option></select>
      {crm.tagDefs.length > 0 && <select aria-label="Tag filter" className={selectCls} value={tagF} onChange={(e) => setTagF(e.target.value)}><option value="all">Any tag</option>{crm.tagDefs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status === "archived" ? " (archived)" : ""}</option>)}</select>}
      <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Newest</option><option value="score">Highest score</option><option value="value">Highest value</option><option value="name">Name A–Z</option></select>
    </div>
  );
  const empty = <Empty icon={<Users />} title="No leads match" hint="Try clearing a filter or add a new lead." action={<Button variant="outline" onClick={() => { setQ(""); setStatus("all"); setSource("all"); setPrio("all"); setQuick("all"); setWho("all"); setCreated("all"); setDue("all"); setTagF("all"); }}>Clear filters</Button>} />;
  const viewBar = (
    <div className="sv-bar" role="toolbar" aria-label="Saved views">
      <Bookmark className="size-4 text-muted-foreground" aria-hidden />
      <button type="button" className="sv-pill" aria-pressed={!activeView} onClick={() => openView()}>All leads</button>
      {pinnedViews.map((v) => <button key={v.id} type="button" className="sv-pill" aria-pressed={activeView?.id === v.id} onClick={() => openView(v.id)}>{v.name}</button>)}
      <select aria-label="Open a saved view" className={cn(selectCls, "h-8 text-xs")} value={activeView && !vprefs.pinned.includes(activeView.id) ? activeView.id : ""} onChange={(e) => e.target.value && openView(e.target.value)}><option value="">{myViews.length ? `More views (${myViews.length})…` : "No saved views"}</option>{(["company", "shared", "personal"] as const).map((g) => { const list = myViews.filter((v) => v.visibility === g); return list.length ? <optgroup key={g} label={g === "company" ? "Company" : g === "shared" ? "Shared" : "Personal"}>{list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup> : null; })}</select>
      {activeView && <>
        <Button size="sm" variant="ghost" className="h-8 rounded-full" aria-label={vprefs.pinned.includes(activeView.id) ? "Unpin view" : "Pin view"} onClick={() => crm.setViewPref(me, { pinned: vprefs.pinned.includes(activeView.id) ? vprefs.pinned.filter((x) => x !== activeView.id) : [...vprefs.pinned, activeView.id] })}><Pin className={cn("size-3.5", !vprefs.pinned.includes(activeView.id) && "opacity-50")} />{vprefs.pinned.includes(activeView.id) ? "Pinned" : "Pin"}</Button>
        <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => { crm.setViewPref(me, { defaultId: vprefs.defaultId === activeView.id ? undefined : activeView.id }); toast.success(vprefs.defaultId === activeView.id ? "Default view cleared" : `“${activeView.name}” opens by default`); }}><Star className={cn("size-3.5", vprefs.defaultId !== activeView.id && "opacity-50")} />{vprefs.defaultId === activeView.id ? "Default" : "Set default"}</Button>
        {viewEditable(activeView, viewer) && <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => setViewEdit(structuredClone(activeView))}><Pencil className="size-3.5" />Edit view</Button>}
      </>}
      <Button size="sm" variant="outline" className="ml-auto h-8 rounded-full" onClick={() => setViewEdit(newView({ mode: "and", conditions: currentConditions() }, sort === "recent" || sort === "score" || sort === "value" || sort === "name" ? sort : "recent"))}><BookmarkPlus className="size-3.5" />Save as view</Button>
      {viewWarn.length > 0 && <p className="flex w-full items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" />{viewWarn[0]!.text}</p>}
    </div>
  );

  return (
    <Shell title="Prospects" subtitle={`${rows.length} of ${leads.length} leads in view · select one to inspect it without leaving the list`} actions={<div className="flex flex-wrap gap-2">{canDel && <Button variant="outline" asChild className="rounded-full"><Link to="/leads/bin"><Archive className="size-4" />Waste & deleted{bin.length ? <span className="num ml-1 text-xs text-muted-foreground">{bin.length}</span> : null}</Link></Button>}{can("import.run") && <Button variant="outline" onClick={() => setBulk(true)} className="rounded-full"><Layers className="size-4" />Bulk add</Button>}{can("leads.create") && <Button onClick={() => setOpen(true)} className="rounded-full"><Plus className="size-4" />Add lead</Button>}</div>}>
      {(cFrom || cTo || cSrc) && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs"><span>From Analytics: created {cFrom ? formatDate(cFrom, { day: "numeric", month: "short", year: "numeric" }) : "…"} – {cTo ? formatDate(cTo, { day: "numeric", month: "short", year: "numeric" }) : "…"}{cSrc ? ` · source ${cSrc}` : ""} (India time)</span><Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => void navigate({ to: "/leads", search: viewId ? { view: viewId } : {} })}>Clear date filter</Button></div>}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-foreground pt-4">
        <div className="flex max-w-full gap-4 overflow-x-auto scrollbar-thin">{(["all", ...LEAD_STATUSES] as const).map(s => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} data-stage={s} className={cn("flex shrink-0 items-baseline gap-1.5 border-b-2 pb-1.5 text-sm transition-colors", status === s ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{s === "all" ? "Everyone" : STATUS_LABEL[s]}<span className="num text-[11px] opacity-70">{stageCounts[s] ?? 0}</span></button>)}</div>
        <div className="seg" role="group" aria-label="View">{([["workspace", Columns2, "Workspace"], ["table", List, "Ledger"], ["cards", LayoutGrid, "Tiles"]] as const).map(([v, I, label]) => <button key={v} type="button" aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)}><I className="size-3.5" /><span className="hidden sm:inline">{label}</span></button>)}</div>
      </div>
      {viewBar}
      <div className="mb-6">{filters}</div>

      {rows.length === 0 ? <div className="panel">{empty}</div> : view === "workspace" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,0.9fr)_1.4fr]">
          <div role="listbox" aria-label="Lead directory" className="max-h-[calc(100vh-180px)] overflow-y-auto border-t border-foreground scrollbar-thin lg:sticky lg:top-32">
            {pageRows.map((l) => { const st = staleDays(l, now); return (
              <div key={l.id} role="option" tabIndex={0} aria-selected={sel?.id === l.id} data-priority={l.priority} onClick={() => pick(l.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(l.id); } }} className="prospect-row prospect-row-pick">
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center"><Checkbox aria-label={`Select ${l.name}`} checked={isPicked(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /></span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="prio-dot shrink-0" /><span className="truncate text-sm font-semibold">{l.name}</span>{l.pinned && <Pin className="size-3 shrink-0" aria-label="Pinned" />}{st !== undefined && <span className="aging is-old shrink-0">stale {st}d</span>}</div>
                  <div className="mt-1 flex items-center gap-2 truncate pl-4 text-xs text-muted-foreground"><span className="stage-chip shrink-0" data-stage={l.status}>{STATUS_LABEL[l.status]}</span><span className="truncate">{l.company ?? l.source} · {l.lastContact ? `spoke ${relative(l.lastContact)}` : "not contacted"}</span><AssigneeTag leadId={l.id} /></div>
                  {crm.leadTags[l.id]?.length ? <div className="mt-1.5 pl-4"><TagChips ids={crm.leadTags[l.id]} max={3} /></div> : null}
                </div>
                <div className="text-right"><div className="num text-sm">{formatINRCompact(l.quotedAmount ?? l.budget ?? 0)}</div><div className="eyebrow mt-0.5">{l.source}</div></div>
              </div>); })}
          </div>
          {sel && <Inspector key={sel.id} id={sel.id} onFollowUp={() => setFu(sel.id)} onStage={(s) => changeStatus(sel.id, s)} onRemove={(k) => removeLead(sel.id, sel.name, k)} onAssign={() => setAssignFor([sel.id])} quickSel={quickSel(sel.id, sel.quickStatus)} />}
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pageRows.map((l, i) => { const st = staleDays(l, now); return (
            <article key={l.id} data-priority={l.priority} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }} className={cn("prospect-tile", l.pinned && "is-pinned")}>
              <span className="tile-score num" aria-hidden>{l.aiScore ?? ""}</span>
              <div className="flex items-start justify-between gap-2"><div className="relative flex items-center gap-2"><Checkbox aria-label={`Select ${l.name}`} checked={isPicked(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /><span className="prio-dot" /><span className="eyebrow">{l.priority} · {l.source}</span></div><Button size="icon" variant="ghost" aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className="relative size-8 rounded-full"><Pin className={cn("size-4", !l.pinned && "opacity-40")} /></Button></div>
              <Link to="/leads/$id" params={{ id: l.id }} className="relative"><h3 className="editorial text-[30px]">{l.name}</h3><p className="mt-1 text-xs text-muted-foreground">{l.company ?? "Independent"} · {l.phone}</p></Link>
              <div className="relative"><TagChips ids={crm.leadTags[l.id]} max={4} /></div>
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
            <thead className="text-left text-muted-foreground"><tr>{["", "Lead", "Phone", "Source", "Tags", "Priority", "Score", "Quoted", "Stage", "Quick status", "Updated", ""].map((h, i) => <th key={i} className="px-3">{h}</th>)}</tr></thead>
            <tbody>
              {pageRows.map((l) => (
                <tr key={l.id} className="border-b hover:bg-card">
                  <td className="pl-1"><span className="inline-flex items-center gap-1"><Checkbox aria-label={`Select ${l.name}`} checked={isPicked(l.id)} onCheckedChange={(v) => togglePick(l.id, !!v)} /><Button size="icon" variant="ghost" title={l.pinned ? "Unpin" : "Pin"} aria-label={l.pinned ? "Unpin" : "Pin"} onClick={() => updateLead(l.id, { pinned: !l.pinned })} className={cn("rounded-full", !l.pinned && "opacity-30 hover:opacity-80")}><Pin className="size-3.5" /></Button></span></td>
                  <td className="min-w-52 px-3"><Link to="/leads/$id" params={{ id: l.id }} className="hover:underline"><Identity name={l.name} company={l.company} /></Link></td>
                  <td className="num px-3 text-muted-foreground"><a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="hover:text-foreground" onClick={() => startCall(l.id, "Leads")}>{l.phone}</a></td>
                  <td className="px-3">{l.source}<div className="mt-0.5"><AssigneeTag leadId={l.id} /></div></td>
                  <td className="px-3"><TagPicker leadId={l.id} /></td>
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
      {rows.length > 0 && (can("leads.assign") || can("leads.edit")) && <div className="ba-pager">
        <span className="flex flex-wrap items-center gap-2"><Checkbox aria-label="Select this page" checked={pageRows.length > 0 && pageRows.every((l) => isPicked(l.id))} onCheckedChange={(v) => setSelection((x) => (v ? addPage(x, pageRows.map((l) => l.id)) : pageRows.reduce((a, l) => toggle(a, l.id, false), x)))} />Select page ({pageRows.length}){rows.length > pageRows.length && <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => setSelection(selectMatching(rows.map((l) => l.id), filterLabel))}>Select all {rows.length} matching</Button>}{leads.length > rows.length && <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => setSelection(selectMatching(leads.map((l) => l.id), "all leads"))}>Select all {leads.length} leads</Button>}</span>
        {pages > 1 && <span className="flex items-center gap-1"><Button size="icon" variant="ghost" className="size-7" aria-label="Previous page" disabled={pg === 0} onClick={() => setPage(pg - 1)}><ChevronLeft /></Button><span className="num">{pg * PAGE + 1}–{Math.min(rows.length, pg * PAGE + PAGE)} of {rows.length}</span><Button size="icon" variant="ghost" className="size-7" aria-label="Next page" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><ChevronRight /></Button></span>}
      </div>}
      {pickedCount > 0 && <div className="as-bulk" role="region" aria-label="Bulk actions">
        <span className="text-sm font-semibold"><span className="num">{pickedCount}</span> selected<span className="ba-scope block font-normal">{selection.kind === "matching" ? `All matching ${selection.label}${selection.exclude.length ? ` · ${selection.exclude.length} excluded` : ""}` : "Picked individually"}</span></span>
        {can("leads.assign") && <Button size="sm" onClick={() => setBulkAssign(true)}><UserCheck />Assign / distribute</Button>}
        {can("leads.edit") && <select aria-label="Bulk change priority" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => bulkPatch({ priority: e.target.value as LeadPriority }, `Priority set to ${e.target.value}`)}><option value="">Priority…</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>}
        {(can("pipeline.edit") || can("leads.edit")) && <select aria-label="Bulk change stage" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => bulkPatch({ status: e.target.value as LeadStatus }, `Moved to ${STATUS_LABEL[e.target.value as LeadStatus]}`)}><option value="">Stage…</option>{LEAD_STATUSES.filter((s) => s !== "lost").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>}
        {can("leads.edit") && activeTags.length > 0 && <select aria-label="Bulk add tag" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => e.target.value && setTagOp({ tagId: e.target.value, mode: "add" })}><option value="">Add tag…</option>{activeTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        {can("leads.edit") && crm.tagDefs.length > 0 && <select aria-label="Bulk remove tag" className={cn(selectCls, "h-8 text-xs")} value="" onChange={(e) => e.target.value && setTagOp({ tagId: e.target.value, mode: "remove" })}><option value="">Remove tag…</option>{crm.tagDefs.filter((t) => tagForLeads(t) || Object.values(crm.leadTags).some((ids) => ids.includes(t.id))).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        <Button size="sm" variant="ghost" aria-label="Clear selection" onClick={() => setSelection(EMPTY_SELECTION)}><X />Clear</Button>
      </div>}
      <BulkAssignDialog open={bulkAssign} leadIds={picked} scope={selection.kind === "matching" ? `All leads matching ${selection.label}${selection.exclude.length ? `, minus ${selection.exclude.length} excluded` : ""}` : "Leads picked individually"} onClose={() => setBulkAssign(false)} onDone={() => setSelection(EMPTY_SELECTION)} />
      {viewEdit && <ViewEditor initial={viewEdit} onClose={() => setViewEdit(null)} onSaved={(id) => openView(id)} />}
      <Dialog open={!!tagOp} onOpenChange={(o) => !o && setTagOp(null)}>
        <DialogContent className="sm:max-w-md">{tagOp && (() => { const t = crm.tagDefs.find((x) => x.id === tagOp.tagId); const live = picked.filter((id) => crm.leads.some((l) => l.id === id)); const has = live.filter((id) => (crm.leadTags[id] ?? []).includes(tagOp.tagId)).length; const affected = tagOp.mode === "add" ? live.length - has : has; return <>
          <DialogHeader><DialogTitle><Tag className="mr-1.5 inline size-4" />{tagOp.mode === "add" ? "Add" : "Remove"} “{t?.name}”</DialogTitle><DialogDescription>{selection.kind === "matching" ? `All leads matching ${selection.label}` : "Leads picked individually"} · {live.length} selected.</DialogDescription></DialogHeader>
          <p className="text-sm"><span className="num font-semibold">{affected}</span> lead{affected === 1 ? "" : "s"} will change{tagOp.mode === "add" ? ` · ${has} already have it` : ` · ${live.length - has} don't have it`}. Other tags, notes, assignments and follow-ups are untouched.</p>
          <DialogFooter><Button variant="ghost" onClick={() => setTagOp(null)}>Cancel</Button><Button onClick={runTagOp} disabled={!affected}>{tagOp.mode === "add" ? "Add tag" : "Remove tag"} to {affected}</Button></DialogFooter>
        </>; })()}</DialogContent>
      </Dialog>
      <AssignDialog open={!!assignFor} leadIds={assignFor ?? []} source="Leads inspector" onClose={() => setAssignFor(null)} />
      <FollowUpDialog open={!!fu} onOpenChange={(o) => !o && setFu(null)} {...(fu ? { leadId: fu } : {})} />
      <AddLeadDialog open={open} onOpenChange={setOpen} />
      <BulkLeadDialog open={bulk} onOpenChange={setBulk} />
      <LostReasonDialog open={!!lost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setLost(null)} onConfirm={(r) => { if (!lost) return; updateLead(lost, { status: "lost", lostReason: r }); setLost(null); toast.success("Marked as lost"); }} />
    </Shell>
  );
}

function Inspector({ id, onFollowUp, onStage, onRemove, onAssign, quickSel }: { id: string; onFollowUp: () => void; onAssign: () => void; onStage: (s: LeadStatus) => void; onRemove: (k: "waste" | "deleted") => void; quickSel: React.ReactNode }) {
  const { leads, deals, payments, activities, followUps, updateLead, addActivity } = useCRM();
  const { can } = useAccess(); const canDel = can("leads.delete");
  const [note, setNote] = useState("");
  const saveNote = () => { if (!note.trim()) return; addActivity(id, note.trim(), "note"); setNote(""); toast.success("Note added to history"); };
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
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-3 xl:grid-cols-5">
        <div><dt className="eyebrow">Stage</dt><dd className="mt-1.5"><select aria-label="Stage" className={cn(selectCls, "h-8 w-full text-xs")} value={l.status} onChange={(e) => onStage(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></dd></div>
        <div><dt className="eyebrow">Priority</dt><dd className="mt-1.5"><select aria-label="Priority" disabled={!can("leads.edit")} className={cn(selectCls, "h-8 w-full text-xs")} value={l.priority} onChange={(e) => { if (updateLead(l.id, { priority: e.target.value as LeadPriority })) toast.success(`Priority set to ${e.target.value}`); }}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></dd></div>
        <div><dt className="eyebrow">Quick status</dt><dd className="mt-1.5">{quickSel}</dd></div>
        <div><dt className="eyebrow">{l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num mt-1.5 text-lg">{formatINR(l.quotedAmount ?? l.budget)}</dd></div>
        <div><dt className="eyebrow">Next follow-up</dt><dd className="mt-1.5 text-sm">{fu ? formatDateTime(fu.dueAt) : "None booked"}</dd></div>
      </dl>
      <div className="as-insp"><span className="eyebrow">Tags</span><TagPicker leadId={l.id} /></div>
      <div className="as-insp"><span className="eyebrow">Responsible</span><AssigneeTag leadId={l.id} />{can("leads.assign") && <Button size="sm" variant="outline" className="ml-auto rounded-full" onClick={onAssign}><UserCheck className="size-3.5" />Assign to employee</Button>}</div>
      {l.requirement && <p className="mt-6 border-l-2 border-clay pl-4 text-sm leading-relaxed">{l.requirement}</p>}
      {l.status === "lost" && l.lostReason && <p className="mt-4 text-sm text-destructive">Lost · {l.lostReason}</p>}
      <AdditionalInfo leadId={l.id} />
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div><div className="eyebrow mb-3">Deals</div>{myDeals.length ? <ul className="grid gap-3">{myDeals.map((d) => { const got = dealCollected(d.id, payments); return <li key={d.id}><Link to="/deals" className="block rounded-xl border p-3 hover:bg-secondary"><div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{d.name}</span><span className="num">{formatINRCompact(d.finalAmount)}</span></div><div className="balance-track mt-2 h-1.5"><div style={{ width: `${d.finalAmount ? Math.min(got / d.finalAmount, 1) * 100 : 0}%` }} /></div><div className="num mt-1 text-[11px] text-muted-foreground">{formatINRCompact(got)} received · {formatINRCompact(dealOutstanding(d, payments))} due</div></Link></li>; })}</ul> : <p className="text-xs text-muted-foreground">No deal yet.</p>}</div>
        <div><div className="eyebrow mb-3">Conversation history</div>{can("leads.view") && <div className="mb-4 grid gap-2"><Textarea aria-label="Client note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to this client's history…" /><Button size="sm" variant="outline" className="justify-self-end rounded-full" disabled={!note.trim()} onClick={saveNote}>Save note</Button></div>}<ol className="timeline grid gap-4">{hist.map((a) => <li key={a.id} data-kind={a.type}><p className="text-xs leading-relaxed">{a.text}</p><span className="eyebrow">{relative(a.at)}</span></li>)}{!hist.length && <li className="text-xs text-muted-foreground">No activity yet.</li>}</ol></div>
      </div>
      {canDel && <div className="mt-8 flex gap-2 border-t pt-4"><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => onRemove("waste")}><Ban className="size-3.5" />Move to Waste</Button><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-destructive" onClick={() => onRemove("deleted")}><Trash2 className="size-3.5" />Delete</Button></div>}
    </aside>
  );
}
