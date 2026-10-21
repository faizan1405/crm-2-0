import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Shell, PriorityBadge } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { formatINRCompact } from "@/lib/crm/format";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline · Scale Flow CRM" },
      { name: "description", content: "Drag leads through every stage of your sales pipeline." },
      { property: "og:title", content: "Pipeline · Scale Flow CRM" },
      { property: "og:description", content: "Drag leads through every stage of your sales pipeline." },
    ],
  }),
  component: Pipeline,
});

function Pipeline() {
  const { leads, updateLead } = useCRM();
  const [over, setOver] = useState<LeadStatus | null>(null);
  const drop = (status: LeadStatus, id: string) => {
    setOver(null);
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === "lost") {
      const reason = window.prompt("Why was this lead lost?");
      if (reason === null) return;
      updateLead(id, { status, lostReason: reason });
    } else updateLead(id, { status });
    toast.success(`${lead.name} moved to ${STATUS_LABEL[status]}`);
  };
  return (
    <Shell title="Pipeline" subtitle="Drag cards between stages to update them.">
      <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-4">
        {LEAD_STATUSES.map((s) => {
          const col = leads.filter((l) => l.status === s);
          return (
            <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(s, e.dataTransfer.getData("text/plain"))}
              className={cn("w-64 shrink-0 rounded-xl bg-muted p-3 transition-colors", over === s && "bg-primary-soft ring-2 ring-ring")}>
              <div className="mb-3 flex justify-between text-sm"><span className="font-semibold">{STATUS_LABEL[s]}</span><span className="num text-muted-foreground">{col.length} · {formatINRCompact(col.reduce((a, l) => a + (l.quotedAmount ?? 0), 0))}</span></div>
              <div className="flex min-h-24 flex-col gap-2">
                {col.map((l) => (
                  <div key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)} className="surface surface-hover cursor-grab p-3 active:cursor-grabbing">
                    <div className="text-sm font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{l.company}</div>
                    <div className="mt-2 flex items-center justify-between"><PriorityBadge p={l.priority} /><span className="num text-xs font-semibold">{formatINRCompact(l.quotedAmount ?? 0)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
