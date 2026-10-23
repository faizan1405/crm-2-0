import { useState } from "react";
import { toast } from "sonner";
import { Crown, Check } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { assignable, type Assignment } from "@/lib/crm/access";
import { roleLabel, STATUS_LABEL } from "@/lib/crm/team";
import { initials } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Shared owner-only employee picker for single and bulk assignment. Never edits lead business data. */
export function AssignDialog({ open, leadIds, source, onClose, onDone }: { open: boolean; leadIds: string[]; source: string; onClose: () => void; onDone?: () => void }) {
  const { employees, assignments, assignLeads, restoreAssignments, leads } = useCRM();
  const current = leadIds.length === 1 ? assignments[leadIds[0]!]?.employeeId ?? null : undefined;
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const count = (id: string) => Object.values(assignments).filter((a) => a.employeeId === id).length;
  const list = employees.filter((e) => e.accountStatus !== "archived");
  const confirm = () => {
    if (pick === undefined) return;
    const snap: Record<string, Assignment | undefined> = Object.fromEntries(leadIds.map((id) => [id, assignments[id]]));
    const r = assignLeads(leadIds, pick, source);
    if (!r.ok) { toast.error(r.error); return; }
    const who = pick ? employees.find((e) => e.id === pick)?.name : "the Owner";
    const one = leadIds.length === 1 ? leads.find((l) => l.id === leadIds[0])?.name : null;
    toast.success(r.changed ? `${one ?? `${r.changed} lead${r.changed === 1 ? "" : "s"}`} ${pick ? "assigned to" : "returned to"} ${who}` : "Nothing changed — already set", r.changed ? { action: { label: "Undo", onClick: () => restoreAssignments(snap) } } : undefined);
    setPick(undefined); onDone?.(); onClose();
  };
  return <Dialog open={open} onOpenChange={(o) => { if (!o) { setPick(undefined); onClose(); } }}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>{leadIds.length === 1 ? "Assign lead" : `Assign ${leadIds.length} leads`}</DialogTitle><DialogDescription>Changes who is responsible only. Stage, value, payments and history stay as they are, and you keep full visibility.</DialogDescription></DialogHeader>
    <div role="radiogroup" aria-label="Choose employee" className="grid max-h-[50vh] gap-1.5 overflow-y-auto">
      <button type="button" role="radio" aria-checked={pick === null} onClick={() => setPick(null)} className={cn("as-opt", pick === null && "is-on")}><span className="tm-avatar tm-avatar-owner"><Crown className="size-4" /></span><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-semibold">Owner (unassigned)</span><span className="block text-xs text-muted-foreground">Return responsibility to you</span></span>{current === null && <span className="eyebrow">Current</span>}{pick === null && <Check className="size-4" />}</button>
      {list.map((e) => { const ok = assignable(e); return <button key={e.id} type="button" role="radio" aria-checked={pick === e.id} disabled={!ok} onClick={() => setPick(e.id)} className={cn("as-opt", pick === e.id && "is-on")}>
        <span className="tm-avatar">{initials(e.name)}</span>
        <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{roleLabel(e)} · {count(e.id)} assigned{!ok ? ` · ${STATUS_LABEL[e.accountStatus]} — can't receive leads` : ""}</span></span>
        {current === e.id && <span className="eyebrow">Current</span>}{pick === e.id && <Check className="size-4" />}
      </button>; })}
      {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">Add employees in Team Management first.</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => { setPick(undefined); onClose(); }}>Cancel</Button><Button disabled={pick === undefined} onClick={confirm}>Confirm{leadIds.length > 1 ? ` · ${leadIds.length} leads` : ""}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function AssigneeTag({ leadId }: { leadId: string }) {
  const a = useCRM((s) => s.assignments[leadId]);
  const e = useCRM((s) => (a ? s.employees.find((x) => x.id === a.employeeId) : undefined));
  return <span className="as-tag" data-assigned={e ? "true" : "false"}>{e ? <><span className="as-dot" />{e.name}</> : "Owner"}</span>;
}
