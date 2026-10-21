import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, CalendarClock } from "lucide-react";
import { Shell, Empty } from "@/components/crm/Shell";
import { FollowUpDialog } from "@/components/crm/Dialogs";
import { useCRM } from "@/lib/crm/store";
import { formatDateTime, dayKey } from "@/lib/crm/format";
import { FOLLOWUP_LABEL } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

type Tab = "overdue" | "today" | "upcoming" | "done";

function FollowUps() {
  const { followUps, leads, completeFollowUp, rescheduleFollowUp } = useCRM();
  const [tab, setTab] = useState<Tab>("today");
  const [add, setAdd] = useState(false);
  const today = dayKey(new Date());
  const bucket = (f: (typeof followUps)[0]): Tab => (f.completedAt ? "done" : dayKey(f.dueAt) < today ? "overdue" : dayKey(f.dueAt) === today ? "today" : "upcoming");
  const counts = { overdue: 0, today: 0, upcoming: 0, done: 0 };
  followUps.forEach((f) => counts[bucket(f)]++);
  const list = followUps.filter((f) => bucket(f) === tab).sort((a, b) => (tab === "done" ? b.dueAt.localeCompare(a.dueAt) : a.dueAt.localeCompare(b.dueAt)));
  const lead = (id: string) => leads.find((l) => l.id === id);
  const tomorrow = (iso: string) => new Date(new Date(iso).getTime() + 86_400_000).toISOString();

  return (
    <Shell title="Follow-ups" subtitle={`${counts.overdue + counts.today} need attention today`} actions={<Button onClick={() => setAdd(true)}><Plus className="size-4" />Schedule</Button>}>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:inline-flex">
        {(["overdue", "today", "upcoming", "done"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors", tab === t ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
            {t} <span className={cn("ml-1 rounded-full px-1.5 text-xs", t === "overdue" && counts.overdue ? "bg-destructive-soft text-destructive" : "bg-background")}>{counts[t]}</span>
          </button>
        ))}
      </div>
      <div className="surface divide-y">
        {list.map((f) => {
          const l = lead(f.leadId);
          return (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Link to="/leads/$id" params={{ id: f.leadId }} className="font-medium hover:text-primary">{l?.name ?? "Deleted lead"}</Link><span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">{FOLLOWUP_LABEL[f.type]}</span></div>
                <div className="text-sm text-muted-foreground">{l?.company ? `${l.company} · ` : ""}{f.note}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("num text-xs", tab === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>{formatDateTime(f.completedAt ?? f.dueAt)}</span>
                {!f.completedAt && <>
                  <Button size="sm" variant="ghost" onClick={() => { rescheduleFollowUp(f.id, tomorrow(f.dueAt)); toast.success("Moved by one day"); }}>+1 day</Button>
                  <Button size="sm" variant="outline" onClick={() => { completeFollowUp(f.id); toast.success("Marked done"); }}><Check className="size-4" />Done</Button>
                </>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <Empty icon={<CalendarClock />} title={tab === "done" ? "Nothing completed yet" : "Nothing here"} hint={tab === "overdue" ? "You're on top of everything." : "Schedule a follow-up to keep deals moving."} />}
      </div>
      <FollowUpDialog open={add} onOpenChange={setAdd} />
    </Shell>
  );
}
