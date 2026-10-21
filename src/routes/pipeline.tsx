import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Shell, PriorityBadge } from "@/components/crm/Shell";
import { LostReasonDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatINRCompact } from "@/lib/crm/format";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Pipeline · Scale Flow CRM" },
      { name: "description", content: "Drag leads through every stage of your sales pipeline." },
      { property: "og:title", content: "Pipeline · Scale Flow CRM" },
      { property: "og:description", content: "Drag leads through every stage of your sales pipeline." },
    ],
  }),
  component: Pipeline,
});

const DOT: Record<LeadStatus, string> = { new: "bg-chart-6", contacted: "bg-chart-2", qualified: "bg-chart-1", proposal: "bg-chart-3", won: "bg-success", lost: "bg-destructive" };

function Pipeline() {
  const { leads, updateLead } = useCRM();
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

  return (
    <Shell title="Pipeline" subtitle={`${open.length} open · ${formatINRCompact(open.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))} in play — drag cards or use the stage menu`}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LEAD_STATUSES.map((s) => {
          const col = leads.filter((l) => l.status === s);
          return (
            <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { setOver(null); move(e.dataTransfer.getData("text/plain"), s); }}
              className={cn("rounded-xl border border-transparent bg-muted/70 p-3 transition-colors", over === s && "border-primary bg-primary-soft")}>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-semibold"><span className={cn("size-2 rounded-full", DOT[s])} />{STATUS_LABEL[s]}<span className="rounded-full bg-card px-1.5 text-xs text-muted-foreground">{col.length}</span></span>
                <span className="num text-xs text-muted-foreground">{formatINRCompact(col.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))}</span>
              </div>
              <div className="flex max-h-[420px] min-h-20 flex-col gap-2 overflow-y-auto scrollbar-thin">
                {col.map((l) => (
                  <div key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)} className="surface surface-hover cursor-grab p-3 active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-2">
                      <Link to="/leads/$id" params={{ id: l.id }} className="text-sm font-medium hover:text-primary">{l.name}</Link>
                      <PriorityBadge p={l.priority} />
                    </div>
                    <div className="text-xs text-muted-foreground">{l.company ?? "—"}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="num text-xs font-semibold">{formatINRCompact(l.quotedAmount ?? 0)}</span>
                      <select aria-label={`Move ${l.name}`} className="h-6 rounded border border-input bg-card px-1 text-[11px] text-muted-foreground" value={l.status} onChange={(e) => move(l.id, e.target.value as LeadStatus)}>
                        {LEAD_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                      </select>
                    </div>
                    {l.lostReason && l.status === "lost" && <div className="mt-2 text-[11px] text-destructive">{l.lostReason}</div>}
                  </div>
                ))}
                {col.length === 0 && <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Drop leads here</div>}
              </div>
            </div>
          );
        })}
      </div>
      <LostReasonDialog open={!!pendingLost} {...(lostLead ? { leadName: lostLead.name } : {})} onCancel={() => setPendingLost(null)} onConfirm={(r) => { if (!pendingLost) return; updateLead(pendingLost, { status: "lost", lostReason: r }); toast.success("Marked as lost"); setPendingLost(null); }} />
    </Shell>
  );
}
