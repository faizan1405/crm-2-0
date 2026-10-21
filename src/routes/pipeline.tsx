import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Shell } from "@/components/crm/Shell";
import { LostReasonDialog } from "@/components/crm/Dialogs";
import { CallButton } from "@/components/crm/CallButton";
import { useCRM } from "@/lib/crm/store";
import { formatINRCompact, formatDateTime } from "@/lib/crm/format";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Deal Theatre · Scale Flow Sales OS" },
      { name: "description", content: "Drag leads through every stage of your sales pipeline." },
      { property: "og:title", content: "Deal Theatre · Scale Flow Sales OS" },
      { property: "og:description", content: "Drag leads through every stage of your sales pipeline." },
    ],
  }),
  component: Pipeline,
});


function Pipeline() {
  const board = useRef<HTMLDivElement>(null);
  const { leads, updateLead } = useCRM();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const [pendingLost, setPendingLost] = useState<string | null>(null);
  const move = (id: string, status: LeadStatus) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === "lost") { setPendingLost(id); return; }
    updateLead(id, { status });
    toast.success(`${lead.name} → ${STATUS_LABEL[status]}`);
  };
  const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");
  const lostLead = leads.find((l) => l.id === pendingLost);

  const total = Math.max(leads.length, 1);
  const smooth = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth") as ScrollBehavior;
  const jump = (s: LeadStatus) => { const el = board.current?.querySelector<HTMLElement>(`[data-col="${s}"]`); if (el && board.current) board.current.scrollTo({ left: el.offsetLeft - board.current.offsetLeft, behavior: smooth() }); };
  const now = Date.now();
  return (
    <Shell title="Deal theatre" subtitle={`${open.length} open opportunities worth ${formatINRCompact(open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))} · drag a ticket to move its stage`}>
      <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex gap-6 text-sm"><span><span className="num text-lg">{leads.length}</span> <span className="text-muted-foreground">leads</span></span><span><span className="num text-lg">{leads.filter(l => l.status === "proposal").length}</span> <span className="text-muted-foreground">proposals</span></span><span><span className="num text-lg">{leads.filter(l => l.status === "won").length}</span> <span className="text-muted-foreground">won</span></span></div>
        <div className="max-w-full overflow-x-auto md:hidden"><div className="seg w-max" role="tablist" aria-label="Jump to stage">{LEAD_STATUSES.map((s) => <button key={s} type="button" role="tab" onClick={() => jump(s)}>{STATUS_LABEL[s]}</button>)}</div></div>
        <div className="ml-auto hidden gap-1 md:flex"><Button variant="outline" size="icon" className="rounded-full" aria-label="Previous stages" title="Previous stages" onClick={() => board.current?.scrollBy({ left: -(board.current?.clientWidth ?? 300) / 2, behavior: smooth() })}><ChevronLeft /></Button><Button variant="outline" size="icon" className="rounded-full" aria-label="Next stages" title="Next stages" onClick={() => board.current?.scrollBy({ left: (board.current?.clientWidth ?? 300) / 2, behavior: smooth() })}><ChevronRight /></Button></div>
      </div>
      <div ref={board} className="theatre scrollbar-thin">
        {LEAD_STATUSES.map((s, i) => {
          const col = leads.filter((l) => l.status === s);
          return (
            <div key={s} data-col={s} data-stage={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setDragging(null); setOver(null); move(e.dataTransfer.getData("text/plain"), s); }}
              className={cn("theatre-col", over === s && "is-over")} aria-label={`${STATUS_LABEL[s]} stage`}>
              <div className="theatre-head">
                <div className="flex items-baseline justify-between"><span className="stage-no">0{i + 1}</span><span className="num text-xs text-muted-foreground">{col.length} · {formatINRCompact(col.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))}</span></div>
                <div className="stage-name mt-1">{STATUS_LABEL[s]}</div>
                <div className="theatre-meter"><div style={{ width: `${(col.length / total) * 100}%` }} /></div>
              </div>
              <div className="flex min-h-40 flex-col gap-2.5">
                {col.map((l) => { const age = Math.max(0, Math.floor((now - new Date(l.updatedAt).getTime()) / 864e5)); return (
                  <div key={l.id} draggable data-priority={l.priority} onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; setDragging(l.id); }} onDragEnd={() => { setDragging(null); setOver(null); }} className={cn("ticket", dragging === l.id && "is-dragging", s === "lost" && "is-lost")}>
                    <div className="eyebrow pr-5">{l.company ?? l.source}</div>
                    <Link to="/leads/$id" params={{ id: l.id }} className="mt-1 block text-[15px] font-semibold leading-tight hover:underline">{l.name}</Link>
                    <div className="mt-3 flex items-end justify-between gap-2"><span className="num text-xl">{formatINRCompact(l.quotedAmount ?? 0)}</span><span className={cn("aging", age >= 7 && "is-old")} title="Days since last update">{age}d in stage</span></div>
                    {l.nextFollowUp && <div className="mt-2 text-[11px] text-muted-foreground">Next · {formatDateTime(l.nextFollowUp)}</div>}
                    {l.lostReason && s === "lost" && <div className="mt-2 text-[11px] text-destructive">Reason · {l.lostReason}</div>}
                    <div className="ticket-perf flex items-center gap-2">
                      <CallButton leadId={l.id} phone={l.phone} name={l.name} source="Pipeline" compact />
                      <span className="eyebrow">{l.priority}</span>
                      <select aria-label={`Move ${l.name}`} className="ml-auto h-8 max-w-[112px] rounded-full border border-input bg-card px-2 text-[11px]" value={l.status} onChange={(e) => move(l.id, e.target.value as LeadStatus)}>
                        {LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                      </select>
                    </div>
                  </div>); })}
                {col.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">Drop a ticket here</div>}
              </div>
            </div>
          );
        })}
      </div>
      <LostReasonDialog open={!!pendingLost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setPendingLost(null)} onConfirm={(r) => { if (!pendingLost) return; updateLead(pendingLost, { status: "lost", lostReason: r }); toast.success("Marked as lost"); setPendingLost(null); }} />
    </Shell>
  );
}
