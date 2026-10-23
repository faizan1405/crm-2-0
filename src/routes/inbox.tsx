import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, CheckCheck, StickyNote, Eye, Flag, GitCompare, Inbox, Pencil, PhoneCall, RotateCcw, Search, UserPlus, Users } from "lucide-react";
import { Shell, PriorityBadge, selectCls, Identity, Empty } from "@/components/crm/Shell";
import { CallButton } from "@/components/crm/CallButton";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { AssignDialog } from "@/components/team/AssignDialog";
import { BulkAssignDialog } from "@/components/team/BulkAssignDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { formatDate, formatINR } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type Lead, type LeadPriority } from "@/lib/crm/types";
import { buildRows, CATEGORY_LABEL, DUP_LABEL, duplicateIds, filterRows, findDuplicates, FIRST_CONTACT_LABEL, mergeBlockers, overview, type DupPair, type InboxCategory, type InboxFilters } from "@/lib/crm/inbox";
import { EMPTY_SELECTION, addPage, isSelected, selectMatching, selectedIds, selectionCount, toggle, type Selection } from "@/lib/crm/bulk";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Smart Lead Inbox · Scale Flow CRM" },
      { name: "description", content: "Review new leads, catch duplicates and assign enquiries in one place." },
      { property: "og:title", content: "Smart Lead Inbox · Scale Flow CRM" },
      { property: "og:description", content: "Review new leads, catch duplicates and assign enquiries in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InboxPage,
});

const CATS: InboxCategory[] = ["all", "needs_review", "unassigned", "newly_assigned", "duplicates", "recently_reviewed"];
const PAGE = 50;

function InboxPage() {
  const s = useCRM();
  const { can, preview } = useAccess();
  const isOwner = !preview;
  const now = useMemo(() => new Date(), [s.leads, s.inboxMeta, s.assignments]);
  const pairs = useMemo(() => findDuplicates(s.leads, s.leadRelations), [s.leads, s.leadRelations]);
  const rows = useMemo(() => buildRows({ leads: s.leads, meta: s.inboxMeta, assignments: s.assignments, activities: s.activities, followUps: s.followUps, dupIds: duplicateIds(pairs), now }), [s.leads, s.inboxMeta, s.assignments, s.activities, s.followUps, pairs, now]);
  const stats = overview(rows, now);
  const [cat, setCat] = useState<InboxCategory>("all");
  const [f, setF] = useState<InboxFilters>({ source: "all", assignee: "all", priority: "all", stage: "all", status: "all" });
  const upd = (p: Partial<InboxFilters>) => { setF((x) => ({ ...x, ...p })); setPage(0); };
  const list = useMemo(() => filterRows(rows, cat, f, now), [rows, cat, f, now]);
  const [page, setPage] = useState(0);
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const picked = selectedIds(sel);
  const [bulk, setBulk] = useState(false);
  const [assignFor, setAssignFor] = useState<string[] | null>(null);
  const [fuFor, setFuFor] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<Lead | null>(null);
  const [review, setReview] = useState<DupPair | null>(null);
  const empName = (id: string | null) => (id ? s.employees.find((e) => e.id === id)?.name ?? "Employee" : "Unassigned");
  const pairsFor = (id: string) => pairs.filter((p) => p.a === id || p.b === id);
  const counts = Object.fromEntries(CATS.map((c) => [c, rows.filter((r) => filterRows([r], c, {}, now).length).length])) as Record<InboxCategory, number>;
  const activeEmps = s.employees.filter((e) => e.accountStatus === "active");

  const markReviewed = (ids: string[]) => { const n = s.markReviewed(ids); toast.success(n ? `${n} lead${n > 1 ? "s" : ""} marked reviewed` : "Already reviewed"); };
  const filterLabel = [cat !== "all" && CATEGORY_LABEL[cat], f.source !== "all" && f.source, f.assignee === "unassigned" ? "unassigned" : f.assignee !== "all" && empName(f.assignee ?? null), f.createdDays && `created ≤${f.createdDays}d`].filter(Boolean).join(", ") || "current inbox filters";

  return (
    <Shell title="Smart Lead Inbox" subtitle="Review, de-duplicate and assign new enquiries. Same lead records as Leads and Pipeline.">
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Awaiting review", stats.awaitingReview, "needs_review"], ["Unassigned", stats.unassigned, "unassigned"], ["Possible duplicates", stats.duplicates, "duplicates"], ["Need first contact", stats.needFirstContact, null], ["Received · 7 days", stats.recent, null]] as const).map(([label, n, c]) => (
          <button key={label} type="button" className="kpi text-left" data-tone={c === "duplicates" && n > 0 ? "alert" : undefined} onClick={() => { if (c) setCat(c); else if (label.startsWith("Need")) { setCat("all"); upd({ firstContactPending: true }); } else { setCat("all"); upd({ createdDays: 7 }); } }}>
            <span className="kpi-label">{label}</span><span className="kpi-value num">{n}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Inbox categories">
        {CATS.map((c) => <button key={c} role="tab" aria-selected={cat === c} type="button" onClick={() => { setCat(c); setPage(0); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${cat === c ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground"}`}>{CATEGORY_LABEL[c]} <span className="num opacity-70">{counts[c]}</span></button>)}
      </div>

      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search inbox" className="pl-9" placeholder="Name, phone, email or company" value={f.q ?? ""} onChange={(e) => upd({ q: e.target.value })} /></div>
        <select aria-label="Source" className={selectCls} value={f.source} onChange={(e) => upd({ source: e.target.value })}><option value="all">All sources</option>{[...new Set([...LEAD_SOURCES, ...s.leads.map((l) => l.source)])].map((x) => <option key={x}>{x}</option>)}</select>
        {isOwner && <select aria-label="Assignee" className={selectCls} value={f.assignee} onChange={(e) => upd({ assignee: e.target.value })}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{s.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
        <select aria-label="Priority" className={selectCls} value={f.priority} onChange={(e) => upd({ priority: e.target.value as InboxFilters["priority"] })}><option value="all">Any priority</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select aria-label="Stage" className={selectCls} value={f.stage} onChange={(e) => upd({ stage: e.target.value as InboxFilters["stage"] })}><option value="all">Any stage</option>{LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>
        <select aria-label="Inbox status" className={selectCls} value={f.status} onChange={(e) => upd({ status: e.target.value as InboxFilters["status"] })}><option value="all">Any inbox status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option></select>
        <select aria-label="Created" className={selectCls} value={f.createdDays ?? 0} onChange={(e) => upd({ createdDays: Number(e.target.value) || undefined })}><option value={0}>Created: any time</option><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select>
        <select aria-label="Last contacted" className={selectCls} value={f.contactedDays ?? 0} onChange={(e) => upd({ contactedDays: Number(e.target.value) || undefined })}><option value={0}>Contacted: any</option><option value={1}>Contacted today</option><option value={7}>Contacted ≤7 days</option></select>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!f.firstContactPending} onChange={(e) => upd({ firstContactPending: e.target.checked })} />First contact pending</label>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!f.duplicate} onChange={(e) => upd({ duplicate: e.target.checked })} />Possible duplicate</label>
        <Button size="sm" variant="ghost" onClick={() => { setF({ source: "all", assignee: "all", priority: "all", stage: "all", status: "all" }); setPage(0); }}><RotateCcw className="size-3.5" />Reset</Button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="num">{list.length} lead{list.length === 1 ? "" : "s"}</span>
        <Button size="sm" variant="ghost" onClick={() => setSel(addPage(sel, pageRows.map((r) => r.lead.id)))}>Select page</Button>
        <Button size="sm" variant="ghost" onClick={() => setSel(selectMatching(list.map((r) => r.lead.id), filterLabel))}>Select all {list.length} matching</Button>
        {selectionCount(sel) > 0 && <>
          <span className="font-medium text-foreground">{selectionCount(sel)} selected{sel.kind === "matching" && sel.exclude.length ? ` (${sel.exclude.length} excluded)` : ""}</span>
          {can("leads.edit") && <Button size="sm" variant="outline" onClick={() => { markReviewed(picked); setSel(EMPTY_SELECTION); }}><CheckCheck className="size-3.5" />Mark reviewed</Button>}
          {can("leads.assign") && <Button size="sm" onClick={() => setBulk(true)}><Users className="size-3.5" />Assign / distribute</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSel(EMPTY_SELECTION)}>Clear</Button>
        </>}
      </div>

      <div className="surface overflow-hidden">
        {pageRows.length === 0 ? <Empty icon={<Inbox />} title="Inbox clear" hint="No leads match this view. Real enquiries appear here as soon as they're added — nothing is invented." /> : (
          <ul className="divide-y">
            {pageRows.map((r) => {
              const l = r.lead; const dups = pairsFor(l.id);
              return (
                <li key={l.id} className="grid gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <input type="checkbox" aria-label={`Select ${l.name}`} checked={isSelected(sel, l.id)} onChange={(e) => setSel(toggle(sel, l.id, e.target.checked))} className="size-4" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Identity name={l.name} company={l.company} />
                      <PriorityBadge p={l.priority} />
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium">{STATUS_LABEL[l.status]}</span>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${r.status === "needs_review" ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>{r.status === "needs_review" ? "Needs review" : "Reviewed"}</span>
                      {dups.map((p) => <button key={p.key} type="button" onClick={() => setReview(p)} className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{p.reasons.map((x) => DUP_LABEL[x]).join(" + ")}</button>)}
                      {r.flagged && !dups.length && <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">Flagged duplicate</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="num">{l.phone}</span>{l.email && <span>{l.email}</span>}<span>{l.source}</span>
                      <span>{empName(r.assignee)}</span>
                      <span className={r.contact === "not_contacted" ? "text-warning" : ""}>{FIRST_CONTACT_LABEL[r.contact]}</span>
                      <span>{r.ageDays === 0 ? "Received today" : `${r.ageDays}d old`}</span>
                      {l.requirement && <span className="truncate">“{l.requirement}”</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" asChild aria-label="Open inspector"><Link to="/pipeline" search={{ lead: l.id }}><Eye className="size-3.5" /></Link></Button>
                    <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Smart Inbox" compact />
                    {can("clients.calls") && <Button size="sm" variant="ghost" aria-label="Log call" onClick={() => openCallLog(l.id, "Smart Inbox")}><PhoneCall className="size-3.5" /></Button>}
                    <WhatsAppButton leadId={l.id} name={l.name} source="Smart Inbox" />
                    {can("leads.edit") && <Button size="sm" variant="ghost" asChild aria-label="Edit lead"><Link to="/leads/$id" params={{ id: l.id }}><Pencil className="size-3.5" /></Link></Button>}
                    {can("leads.view") && <Button size="sm" variant="ghost" aria-label="Add note" onClick={() => setNoteFor(l)}><StickyNote className="size-3.5" /></Button>}
                    {can("leads.edit") && <select aria-label="Priority" className={`${selectCls} h-8 px-2 text-xs`} value={l.priority} onChange={(e) => s.updateLead(l.id, { priority: e.target.value as LeadPriority })}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>}
                    {can("leads.assign") && <Button size="sm" variant="ghost" aria-label="Assign" onClick={() => setAssignFor([l.id])}><UserPlus className="size-3.5" /></Button>}
                    {can("followups.create") && <Button size="sm" variant="ghost" aria-label="Schedule follow-up" onClick={() => setFuFor(l.id)}><CalendarPlus className="size-3.5" /></Button>}
                    {can("leads.edit") && (r.status === "needs_review"
                      ? <Button size="sm" variant="outline" onClick={() => markReviewed([l.id])}><CheckCheck className="size-3.5" />Reviewed</Button>
                      : <Button size="sm" variant="ghost" onClick={() => { s.unmarkReviewed(l.id); toast.success("Moved back to Needs review"); }}>Undo review</Button>)}
                    {can("leads.edit") && !r.flagged && !dups.length && <Button size="sm" variant="ghost" aria-label="Flag possible duplicate" onClick={() => { s.flagDuplicate(l.id); toast.success("Flagged as possible duplicate"); }}><Flag className="size-3.5" /></Button>}
                    {r.flagged && can("leads.edit") && <Button size="sm" variant="ghost" onClick={() => s.unflagDuplicate(l.id)}>Unflag</Button>}
                    {dups[0] && <Button size="sm" variant="ghost" aria-label="Open duplicate review" onClick={() => setReview(dups[0]!)}><GitCompare className="size-3.5" /></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {list.length > PAGE && <div className="mt-3 flex items-center justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="num">Page {page + 1} of {Math.ceil(list.length / PAGE)}</span><Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(page + 1)}>Next</Button></div>}
      <p className="mt-4 text-[11px] text-muted-foreground">Leads arrive from manual entry, bulk add and assignment rules. Meta Lead Forms and website forms are not connected yet. Active employees available for assignment: {activeEmps.length}.</p>

      <BulkAssignDialog open={bulk} leadIds={picked} scope={sel.kind === "matching" ? `All inbox leads matching ${sel.label}${sel.exclude.length ? `, minus ${sel.exclude.length} excluded` : ""}` : "Inbox leads picked individually"} onClose={() => setBulk(false)} onDone={() => setSel(EMPTY_SELECTION)} />
      <AssignDialog open={!!assignFor} leadIds={assignFor ?? []} source="Smart Inbox" onClose={() => setAssignFor(null)} />
      <FollowUpDialog open={!!fuFor} onOpenChange={(o) => !o && setFuFor(null)} {...(fuFor ? { leadId: fuFor } : {})} />
      <NoteDialog lead={noteFor} onClose={() => setNoteFor(null)} />
      <DuplicateReview pair={review} isOwner={isOwner} onClose={() => setReview(null)} empName={empName} />
    </Shell>
  );
}

function NoteDialog({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const addActivity = useCRM((s) => s.addActivity);
  const [text, setText] = useState("");
  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) { setText(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add note · {lead?.name}</DialogTitle><DialogDescription>Saved to this lead's activity history.</DialogDescription></DialogHeader>
        <Input autoFocus aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you learn?" />
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!text.trim()} onClick={() => { if (lead) addActivity(lead.id, text.trim()); toast.success("Note added"); setText(""); onClose(); }}>Save note</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateReview({ pair, isOwner, onClose, empName }: { pair: DupPair | null; isOwner: boolean; onClose: () => void; empName: (id: string | null) => string }) {
  const s = useCRM();
  const [mergeView, setMergeView] = useState(false);
  const a = pair && s.leads.find((l) => l.id === pair.a); const b = pair && s.leads.find((l) => l.id === pair.b);
  const info = (l: Lead) => {
    const deals = s.deals.filter((d) => d.leadId === l.id); const dealIds = new Set(deals.map((d) => d.id));
    return { notes: s.activities.filter((x) => x.leadId === l.id && x.type === "note").length + (l.notes ? 1 : 0), acts: s.activities.filter((x) => x.leadId === l.id).length, fus: s.followUps.filter((f) => f.leadId === l.id).length, deals: deals.length, payments: s.payments.filter((p) => dealIds.has(p.dealId) && !p.voided).length, paid: s.payments.filter((p) => dealIds.has(p.dealId) && !p.voided).reduce((t, p) => t + p.amount, 0) };
  };
  const close = () => { setMergeView(false); onClose(); };
  if (!pair || !a || !b) return null;
  const ia = info(a), ib = info(b);
  const rowsDef: [string, (l: Lead, i: ReturnType<typeof info>) => string][] = [
    ["Client name", (l) => l.name], ["Phone", (l) => l.phone], ["Email", (l) => l.email ?? "—"], ["Company", (l) => l.company ?? "—"], ["Source", (l) => l.source],
    ["Created", (l) => formatDate(l.createdAt)], ["Assigned to", (l) => empName(s.assignments[l.id]?.employeeId ?? null)], ["Stage", (l) => STATUS_LABEL[l.status]], ["Priority", (l) => l.priority],
    ["Notes", (_, i) => String(i.notes)], ["Follow-ups", (_, i) => String(i.fus)], ["Deals", (_, i) => String(i.deals)], ["Payments", (_, i) => i.payments ? `${i.payments} · ${formatINR(i.paid)}` : "0"],
  ];
  const decide = (kind: "separate" | "related") => { s.resolveDuplicate(a.id, b.id, kind); toast.success(kind === "separate" ? "Kept as separate leads — this pair won't be flagged again" : "Marked as related records"); close(); };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Duplicate review</DialogTitle><DialogDescription>{pair.reasons.map((r) => DUP_LABEL[r]).join(" + ")}{pair.strength === "suggested" ? " — a suggestion only, not a confirmed duplicate." : ". A shared phone or email doesn't always mean the same customer."}</DialogDescription></DialogHeader>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Field</th><th className="py-1.5 pr-3 font-medium">Record A</th><th className="py-1.5 font-medium">Record B</th></tr></thead>
          <tbody>{rowsDef.map(([k, fn]) => { const va = fn(a, ia), vb = fn(b, ib); return <tr key={k} className="border-t"><td className="py-1.5 pr-3 text-xs text-muted-foreground">{k}</td><td className={`py-1.5 pr-3 ${va !== vb ? "font-medium" : ""}`}>{va}</td><td className={`py-1.5 ${va !== vb ? "font-medium" : ""}`}>{vb}</td></tr>; })}</tbody>
        </table></div>
        {mergeView && <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold">Merge preview (read-only)</div>
          <p>Record B would bring {ib.acts} activity entries, {ib.fus} follow-ups, {ib.deals} deals and {ib.payments} payments{s.assignments[b.id]?.employeeId ? `, plus its assignment to ${empName(s.assignments[b.id]!.employeeId)}` : ""}.</p>
          <ul className="mt-1 list-disc pl-4">{mergeBlockers({ activities: ib.acts, followUps: ib.fus, deals: ib.deals + ia.deals, payments: ib.payments + ia.payments, proofs: 0, assigned: !!s.assignments[b.id] }).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" asChild><Link to="/leads/$id" params={{ id: a.id }}>Open A</Link></Button>
          <Button variant="ghost" asChild><Link to="/leads/$id" params={{ id: b.id }}>Open B</Link></Button>
          {isOwner ? <>
            <Button variant="outline" onClick={() => setMergeView(!mergeView)}>Review merge</Button>
            <Button variant="outline" onClick={() => decide("separate")}>Keep separate</Button>
            <Button onClick={() => decide("related")}>Mark as related</Button>
          </> : <span className="text-xs text-muted-foreground">Only the Owner can resolve duplicates.</span>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
