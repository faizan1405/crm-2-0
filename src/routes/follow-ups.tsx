import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Shell } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { formatDateTime } from "@/lib/crm/format";
import { FOLLOWUP_LABEL } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/follow-ups")({
  head: () => ({
    meta: [
      { title: "Follow-ups · Scale Flow CRM" },
      { name: "description", content: "Calls, meetings and messages due across your leads." },
      { property: "og:title", content: "Follow-ups · Scale Flow CRM" },
      { property: "og:description", content: "Calls, meetings and messages due across your leads." },
    ],
  }),
  component: FollowUps,
});

function FollowUps() {
  const { followUps, leads, completeFollowUp } = useCRM();
  const now = Date.now();
  const pending = followUps.filter((f) => !f.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const done = followUps.filter((f) => f.completedAt);
  const name = (id: string) => leads.find((l) => l.id === id)?.name ?? "Deleted lead";
  return (
    <Shell title="Follow-ups" subtitle={`${pending.length} pending`}>
      <div className="surface divide-y">
        {pending.map((f) => {
          const late = new Date(f.dueAt).getTime() < now;
          return (
            <div key={f.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{name(f.leadId)} <span className="ml-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">{FOLLOWUP_LABEL[f.type]}</span></div>
                <div className="text-sm text-muted-foreground">{f.note}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={late ? "num text-xs font-semibold text-destructive" : "num text-xs text-muted-foreground"}>{late ? "Overdue · " : ""}{formatDateTime(f.dueAt)}</span>
                <Button size="sm" variant="outline" onClick={() => { completeFollowUp(f.id); toast.success("Marked done"); }}><Check className="size-4" />Done</Button>
              </div>
            </div>
          );
        })}
        {pending.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing pending. Nice work.</p>}
      </div>
      {done.length > 0 && <p className="mt-4 text-sm text-muted-foreground">{done.length} completed</p>}
    </Shell>
  );
}
