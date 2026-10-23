import { Link } from "@tanstack/react-router";
import { BellRing, Check, Flag, X } from "lucide-react";
import { toast } from "sonner";
import { useCRM } from "@/lib/crm/store";
import { useAccess } from "@/lib/crm/session";
import { formatDateTime } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";

/** Automation reminders for leads and projects in the current workspace (employees only ever hold their scoped leads). */
export function RemindersPanel({ limit = 8, only }: { limit?: number; only?: "project" }) {
  const { reminders, leads, projects, employees, completeReminder, dismissReminder } = useCRM();
  const { can } = useAccess();
  const ids = new Map(leads.map((l) => [l.id, l]));
  const pids = new Map(projects.map((p) => [p.id, p]));
  // Project reminders show only for projects in this workspace (employees hold only their assigned projects).
  const open = reminders.filter((r) => r.status === "open" && (!only || !!r.projectId) && (r.projectId ? pids.has(r.projectId) : ids.has(r.leadId))).sort((a, b) => (a.importance === b.importance ? b.createdAt.localeCompare(a.createdAt) : a.importance === "high" ? -1 : 1));
  if (!open.length) return null;
  const emp = (id: string | null) => (id ? employees.find((e) => e.id === id)?.name ?? "Employee" : "Unassigned");
  return (
    <section className="surface mb-6 p-4" aria-label="Automation reminders">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><BellRing className="size-4 text-primary" />Reminders <span className="num text-xs text-muted-foreground">{open.length}</span></h2>
        <span className="text-[11px] text-muted-foreground">Created by Automation Studio · checked while the CRM is open</span>
      </div>
      <ul className="divide-y">
        {open.slice(0, limit).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className={`size-2 shrink-0 rounded-full ${r.importance === "high" ? "bg-destructive" : "bg-primary"}`} aria-label={r.importance === "high" ? "High importance" : "Normal importance"} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.reason}</div>
              <div className="text-xs text-muted-foreground">{r.ruleName} · {emp(r.employeeId)} · {formatDateTime(r.dueAt)}{r.flag ? " · flagged" : ""}{r.escalated ? " · escalated to Owner" : ""}</div>
            </div>
            {r.flag && <Flag className="size-3.5 text-warning" aria-hidden />}
            {r.projectId ? <Button size="sm" variant="ghost" asChild><Link to="/projects/$id" params={{ id: r.projectId }}>Open project</Link></Button> : <Button size="sm" variant="ghost" asChild><Link to="/pipeline" search={{ lead: r.leadId }}>Open lead</Link></Button>}
            {can("followups.view") && <>
              <Button size="sm" variant="outline" onClick={() => { completeReminder(r.id); toast.success("Reminder done"); }}><Check className="size-3.5" />Done</Button>
              <Button size="sm" variant="ghost" aria-label="Dismiss reminder" onClick={() => { dismissReminder(r.id); toast("Reminder dismissed"); }}><X className="size-3.5" /></Button>
            </>}
          </li>
        ))}
      </ul>
      {open.length > limit && <p className="mt-2 text-xs text-muted-foreground">+{open.length - limit} more</p>}
    </section>
  );
}
