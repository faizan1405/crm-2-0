import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CalendarPlus, ChevronLeft, ChevronRight, Clock, Flame, Gem, NotebookPen, PhoneCall, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shell, selectCls } from "@/components/crm/Shell";
import { FollowUpDialog, LostReasonDialog } from "@/components/crm/Dialogs";
import { CallButton } from "@/components/crm/CallButton";
import { openCallLog } from "@/components/crm/PostCallDialog";
import { WhatsAppButton } from "@/components/crm/WhatsAppComposer";
import { useCRM } from "@/lib/crm/store";
import { useAccess, STAGE_DENIED } from "@/lib/crm/session";
import { formatINR, formatINRCompact, formatDateTime, relative } from "@/lib/crm/format";
import { dealCollected, dealOutstanding } from "@/lib/crm/finance";
import { canUndoStage, cardSignals, isOpen, stageSummary, STALL_DAYS } from "@/lib/crm/pipeline";
import { LEAD_STATUSES, STATUS_LABEL, type Lead, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

interface PipeSearch { lead?: string | undefined }
export const Route = createFileRoute("/pipeline")({
  validateSearch: (s: Record<string, unknown>): PipeSearch => (typeof s["lead"] === "string" ? { lead: s["lead"] } : {}),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Deal Theatre · Scale Flow Sales OS" },
      { name: "description", content: "Move leads through every sales stage and inspect any client without leaving the board." },
      { property: "og:title", content: "Deal Theatre · Scale Flow Sales OS" },
      { property: "og:description", content: "Move leads through every sales stage and inspect any client without leaving the board." },
    ],
  }),
  component: Pipeline,
});

function Pipeline() {
  const board = useRef<HTMLDivElement>(null);
  const dragAt = useRef(0);
  const { lead: selected } = Route.useSearch();
  const navigate = useNavigate({ from: "/pipeline" });
  const { leads, activities, followUps, updateLead } = useCRM();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const [pendingLost, setPendingLost] = useState<string | null>(null);
  const [fuFor, setFuFor] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [leads, followUps, activities]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (id: string | undefined) => navigate({ search: id ? { lead: id } : {}, replace: true, resetScroll: false });
  const sel = leads.find((l) => l.id === selected);
  // Wide screens dock the inspector beside the board; smaller screens float it above everything (portal escapes the page's stacking context).
  const wide = useSyncExternalStore((cb) => { const m = window.matchMedia("(min-width: 1280px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => window.matchMedia("(min-width: 1280px)").matches, () => true);
  const { can } = useAccess();
  const canMove = can("pipeline.edit") || can("leads.edit");
  const inspector = sel ? <>
    <button type="button" aria-label="Close inspector" className="pipe-scrim" onClick={() => select(undefined)} />
    <PipeInspector key={sel.id} lead={sel} onClose={() => select(undefined)} canMove={canMove} onStage={(s) => move(sel.id, s)} onFollowUp={() => setFuFor(sel.id)} />
  </> : null;

  useEffect(() => { if (!sel) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) select(undefined); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (id: string, status: LeadStatus) => {
    if (!canMove) { toast.error(STAGE_DENIED); return; }
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === "lost") { setPendingLost(id); return; }
    commit(lead, { status });
  };
  // One store write per move; Undo restores the exact previous stage (and lost reason).
  const commit = (lead: Lead, patch: Partial<Lead>) => {
    const before = { status: lead.status, lostReason: lead.lostReason };
    if (!updateLead(lead.id, patch)) { toast.error("Couldn't move this lead — nothing changed"); return; }
    const applied = useCRM.getState().leads.find((l) => l.id === lead.id);
    setPulse(lead.id); setTimeout(() => setPulse((p) => (p === lead.id ? null : p)), 900);
    toast.success(`${lead.name} → ${STATUS_LABEL[patch.status!]}`, { action: { label: "Undo", onClick: () => { const cur = useCRM.getState().leads.find((l) => l.id === lead.id); if (!applied || !canUndoStage(cur, applied)) { toast.warning(`${lead.name} changed since this move — Undo skipped, newer change kept`); return; } updateLead(lead.id, before); toast(`${lead.name} back in ${STATUS_LABEL[before.status]}`); } } });
  };
  const open = leads.filter((l) => isOpen(l.status));
  const openSig = open.map((l) => cardSignals(l, activities, followUps, now));
  const lostLead = leads.find((l) => l.id === pendingLost);
  const smooth = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth") as ScrollBehavior;
  const jump = (s: LeadStatus) => { const el = board.current?.querySelector<HTMLElement>(`[data-col="${s}"]`); if (el && board.current) board.current.scrollTo({ left: el.offsetLeft - board.current.offsetLeft, behavior: smooth() }); };

  return (
    <Shell title="Deal theatre" subtitle="Tap any ticket to inspect the client · drag to change its stage">
      <section aria-label="Pipeline overview" className="pipe-intel">
        <div className="pipe-kpi"><span className="eyebrow">Open opportunities</span><span className="num pipe-kpi-v">{open.length}</span></div>
        <div className="pipe-kpi"><span className="eyebrow">Open pipeline value</span><span className="num pipe-kpi-v">{formatINRCompact(open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))}</span><span className="pipe-kpi-h">Quoted, not confirmed revenue</span></div>
        <div className="pipe-kpi" data-tone={openSig.some((s) => s.overdue) ? "warn" : undefined}><span className="eyebrow">Need attention</span><span className="num pipe-kpi-v">{openSig.filter((s) => s.overdue || s.hot).length}</span><span className="pipe-kpi-h">Overdue follow-up or hot</span></div>
        <div className="pipe-kpi"><span className="eyebrow">Stalled</span><span className="num pipe-kpi-v">{openSig.filter((s) => s.stalled).length}</span><span className="pipe-kpi-h">Past the stage time limit</span></div>
        <div className="pipe-dist" aria-label="Stage distribution">
          <span className="eyebrow">Stage distribution</span>
          <div className="pipe-dist-bar">{LEAD_STATUSES.map((s) => { const n = leads.filter((l) => l.status === s).length; return n ? <button key={s} type="button" data-stage={s} style={{ flexGrow: n }} title={`${STATUS_LABEL[s]}: ${n}`} aria-label={`Jump to ${STATUS_LABEL[s]} (${n})`} onClick={() => jump(s)} /> : null; })}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{LEAD_STATUSES.map((s) => <span key={s} data-stage={s} className="inline-flex items-center gap-1"><i className="pipe-dot" />{STATUS_LABEL[s]} <b className="num font-medium text-foreground">{leads.filter((l) => l.status === s).length}</b></span>)}</div>
        </div>
      </section>

      <div className="mb-3 flex items-center gap-2">
        <div className="max-w-full overflow-x-auto md:hidden"><div className="seg w-max" role="tablist" aria-label="Jump to stage">{LEAD_STATUSES.map((s) => <button key={s} type="button" role="tab" onClick={() => jump(s)}>{STATUS_LABEL[s]}</button>)}</div></div>
        <div className="ml-auto hidden gap-1 md:flex"><Button variant="outline" size="icon" className="rounded-full" aria-label="Previous stages" onClick={() => board.current?.scrollBy({ left: -(board.current?.clientWidth ?? 300) / 2, behavior: smooth() })}><ChevronLeft /></Button><Button variant="outline" size="icon" className="rounded-full" aria-label="Next stages" onClick={() => board.current?.scrollBy({ left: (board.current?.clientWidth ?? 300) / 2, behavior: smooth() })}><ChevronRight /></Button></div>
      </div>

      <div className={cn("pipe-wrap", sel && "has-inspector")}>
        <div ref={board} className="theatre pipe-board scrollbar-thin">
          {LEAD_STATUSES.map((s, i) => {
            const col = leads.filter((l) => l.status === s).sort((a, b) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0));
            const sum = stageSummary(leads, s, activities, followUps, now);
            return (
              <div key={s} data-col={s} data-stage={s} aria-label={`${STATUS_LABEL[s]} stage`} className={cn("theatre-col pipe-col", over === s && "is-over")}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== s) setOver(s); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setDragging(null); setOver(null); if (id) move(id, s); }}>
                <div className="pipe-head">
                  <div className="flex items-baseline justify-between"><span className="stage-no">0{i + 1}</span><span key={sum.count} className="num pipe-count">{sum.count}</span></div>
                  <div className="stage-name mt-1">{STATUS_LABEL[s]}</div>
                  <div className="num mt-1 text-xs text-muted-foreground">{formatINRCompact(sum.value)} known value</div>
                  {(sum.overdue > 0 || sum.stalled > 0) && <div className="mt-2 flex flex-wrap gap-1">{sum.overdue > 0 && <span className="pipe-flag" data-kind="overdue">{sum.overdue} overdue</span>}{sum.stalled > 0 && <span className="pipe-flag" data-kind="stalled">{sum.stalled} stalled</span>}</div>}
                  <div className="theatre-meter"><div style={{ width: `${(sum.count / Math.max(leads.length, 1)) * 100}%` }} /></div>
                </div>
                <div className="flex min-h-40 flex-col gap-2.5">
                  {col.map((l) => { const sig = cardSignals(l, activities, followUps, now); return (
                    <div key={l.id} role="button" tabIndex={0} draggable={canMove} data-priority={l.priority} aria-pressed={sel?.id === l.id} aria-label={`${l.name}${l.company ? `, ${l.company}` : ""} — open inspector`}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; dragAt.current = Date.now(); setDragging(l.id); }}
                      onDragEnd={() => { dragAt.current = Date.now(); setDragging(null); setOver(null); }}
                      onClick={() => { if (Date.now() - dragAt.current < 250) return; select(l.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(l.id); } }}
                      className={cn("ticket pipe-ticket", dragging === l.id && "is-dragging", s === "lost" && "is-lost", sel?.id === l.id && "is-selected", pulse === l.id && "is-moved", sig.overdue && "is-overdue")}>
                      <div className="eyebrow truncate pr-5">{l.company ?? l.source}</div>
                      <div className="mt-1 text-[15px] font-semibold leading-tight">{l.name}</div>
                      {l.requirement && <div className="mt-0.5 truncate text-xs text-muted-foreground">{l.requirement}</div>}
                      <div className="mt-3 flex items-end justify-between gap-2">
                        <span className={cn("num text-xl", sig.highValue && "pipe-value-hi")}>{l.quotedAmount ? formatINRCompact(l.quotedAmount) : <span className="text-sm text-muted-foreground">No quote</span>}</span>
                        {sig.days !== null && <span className={cn("aging", sig.stalled && "is-old")} title={sig.stalled ? `Over ${STALL_DAYS[s]} days in this stage` : "Days in this stage"}>{sig.days}d in stage</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {sig.hot && <span className="pipe-flag" data-kind="hot"><Flame className="size-3" />Hot</span>}
                        {sig.highValue && <span className="pipe-flag" data-kind="value"><Gem className="size-3" />High value</span>}
                        {sig.overdue && <span className="pipe-flag" data-kind="overdue"><AlertTriangle className="size-3" />Overdue</span>}
                        {sig.stalled && <span className="pipe-flag" data-kind="stalled"><Clock className="size-3" />Stalled</span>}
                        {!sig.overdue && sig.nextDue && <span className="text-[11px] text-muted-foreground">Next · {formatDateTime(sig.nextDue)}</span>}
                      </div>
                      {l.lostReason && s === "lost" && <div className="mt-2 text-[11px] text-destructive">Reason · {l.lostReason}</div>}
                      <div className="pipe-hover" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[11px] text-muted-foreground">{l.lastContact ? `Spoke ${relative(l.lastContact)}` : "No contact yet"}</span>
                        <select aria-label={`Move ${l.name}`} disabled={!canMove} title={canMove ? undefined : STAGE_DENIED} className="pipe-move" value={l.status} onClick={(e) => e.stopPropagation()} onChange={(e) => move(l.id, e.target.value as LeadStatus)}>
                          {LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                        </select>
                      </div>
                    </div>); })}
                  {dragging && over === s && !col.some((l) => l.id === dragging) && <div className="pipe-drop" aria-hidden>Drop to move to {STATUS_LABEL[s]}</div>}
                  {col.length === 0 && !(dragging && over === s) && <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">Drop a ticket here</div>}
                </div>
              </div>
            );
          })}
        </div>
        {sel && (wide ? inspector : createPortal(<div className="pipe-layer">{inspector}</div>, document.body))}
      </div>
      <LostReasonDialog open={!!pendingLost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setPendingLost(null)} onConfirm={(r) => { if (!lostLead) return; commit(lostLead, { status: "lost", lostReason: r }); setPendingLost(null); }} />
      <FollowUpDialog open={!!fuFor} onOpenChange={(o) => !o && setFuFor(null)} {...(fuFor ? { leadId: fuFor } : {})} />
    </Shell>
  );
}

function PipeInspector({ lead: l, canMove, onClose, onStage, onFollowUp }: { lead: Lead; canMove: boolean; onClose: () => void; onStage: (s: LeadStatus) => void; onFollowUp: () => void }) {
  const { deals, payments, activities, followUps, addActivity } = useCRM();
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const now = new Date();
  const sig = cardSignals(l, activities, followUps, now);
  const myDeals = deals.filter((d) => d.leadId === l.id);
  const hist = activities.filter((a) => a.leadId === l.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const saveNote = () => { if (!note.trim()) return; addActivity(l.id, note.trim(), "note"); setNote(""); setNoting(false); toast.success("Note added to history"); };
  return (
    <aside ref={ref} tabIndex={-1} aria-label={`${l.name} inspector`} className="pipe-inspector" data-stage={l.status}>
      <div className="pipe-insp-top">
        <div className="min-w-0">
          <div className="eyebrow" data-priority={l.priority}><span className="prio-dot mr-1.5" />{l.priority} priority{l.aiScore !== undefined ? ` · score ${l.aiScore}` : ""}</div>
          <h2 className="editorial mt-1.5 text-[34px] leading-none">{l.name}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{l.company ?? "Independent"} · <span className="num">{l.phone}</span></p>
          <p className="mt-0.5 text-xs text-muted-foreground">{[l.requirement, l.source].filter(Boolean).join(" · ")}</p>
        </div>
        <Button size="icon" variant="ghost" className="rounded-full" aria-label="Close inspector" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="pipe-actions">
        <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Pipeline" />
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => openCallLog(l.id, "Pipeline")}><PhoneCall className="size-3.5" />Log call</Button>
        <WhatsAppButton leadId={l.id} name={l.name} source="Pipeline" label />
        <Button variant="outline" size="sm" className="rounded-full" onClick={onFollowUp}><CalendarPlus className="size-3.5" />Follow-up</Button>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setNoting((v) => !v)} aria-expanded={noting}><NotebookPen className="size-3.5" />Note</Button>
      </div>
      {noting && <div className="grid gap-2"><Textarea aria-label="New note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? Saved to this client's history." autoFocus /><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNoting(false)}>Cancel</Button><Button size="sm" onClick={saveNote} disabled={!note.trim()}>Save note</Button></div></div>}
      <dl className="pipe-facts">
        <div><dt className="eyebrow">Stage</dt><dd><select aria-label="Stage" disabled={!canMove} title={canMove ? undefined : STAGE_DENIED} className={cn(selectCls, "h-8 w-full text-xs")} value={l.status} onChange={(e) => onStage(e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></dd></div>
        <div><dt className="eyebrow">{l.quotedAmount ? "Quoted" : "Budget"}</dt><dd className="num text-lg">{l.quotedAmount || l.budget ? formatINR(l.quotedAmount ?? l.budget) : "—"}</dd></div>
        <div><dt className="eyebrow">In stage</dt><dd className="text-sm">{sig.days === null ? "Not recorded" : `${sig.days} day${sig.days === 1 ? "" : "s"}`}{sig.stalled && <span className="pipe-flag ml-1.5" data-kind="stalled">Stalled</span>}</dd></div>
        <div><dt className="eyebrow">Last contact</dt><dd className="text-sm">{l.lastContact ? relative(l.lastContact) : "Never"}</dd></div>
        <div className="col-span-2"><dt className="eyebrow">Next follow-up</dt><dd className={cn("text-sm", sig.overdue && "font-semibold text-destructive")}>{sig.nextDue ? `${formatDateTime(sig.nextDue)}${sig.overdue ? " · overdue" : ""}` : "None booked"}</dd></div>
      </dl>
      {l.status === "lost" && l.lostReason && <p className="text-sm text-destructive">Lost · {l.lostReason}</p>}
      {l.notes && <div><div className="eyebrow mb-1.5">Notes</div><p className="border-l-2 border-clay pl-3 text-sm leading-relaxed whitespace-pre-line">{l.notes}</p></div>}
      {myDeals.length > 0 && <div><div className="eyebrow mb-2">Deals</div><ul className="grid gap-2">{myDeals.map((d) => { const got = dealCollected(d.id, payments); return <li key={d.id}><Link to="/deals" className="block rounded-xl border p-3 hover:bg-secondary"><div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{d.name}</span><span className="num">{formatINRCompact(d.finalAmount)}</span></div><div className="num mt-1 text-[11px] text-muted-foreground">{formatINRCompact(got)} received · {formatINRCompact(dealOutstanding(d, payments))} due</div></Link></li>; })}</ul></div>}
      <div><div className="eyebrow mb-2">Recent activity</div><ol className="timeline grid gap-3">{hist.map((a) => <li key={a.id} data-kind={a.type}><p className="text-xs leading-relaxed">{a.text}{a.outcome ? ` · ${a.outcome}` : ""}</p><span className="eyebrow">{relative(a.at)}</span></li>)}{!hist.length && <li className="text-xs text-muted-foreground">No activity yet.</li>}</ol></div>
      <Button variant="outline" asChild className="mt-auto w-full rounded-full"><Link to="/leads/$id" params={{ id: l.id }}>Open full record<ArrowUpRight className="size-3.5" /></Link></Button>
    </aside>
  );
}
