import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Crown, Check, Users, Split } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { assignable } from "@/lib/crm/access";
import { roleLabel } from "@/lib/crm/team";
import { initials } from "@/lib/crm/format";
import { allocationError, assigneeBreakdown, balancedSplit, buildPlan, equalSplit, planImpact, singlePlan, workload, SKIP_LABEL, type Allocation } from "@/lib/crm/bulk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";

type Method = "equal" | "custom" | "balanced";

/** Owner bulk assignment: one employee or a distribution across several. Previews impact, then applies through the store's validated plan. */
export function BulkAssignDialog({ open, leadIds, scope, onClose, onDone }: { open: boolean; leadIds: string[]; scope: string; onClose: () => void; onDone?: () => void }) {
  const { employees, assignments, applyAssignmentPlan, restoreAssignments } = useCRM();
  const [mode, setMode] = useState<"one" | "split">("one");
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [team, setTeam] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>("equal");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const total = leadIds.length;
  const load = useMemo(() => workload(assignments), [assignments]);
  const breakdown = useMemo(() => assigneeBreakdown(leadIds, assignments), [leadIds, assignments]);
  const list = employees.filter((e) => e.accountStatus !== "archived");
  const active = list.filter(assignable);
  const name = (id: string) => (id === "__owner" ? "Owner (unassigned)" : employees.find((e) => e.id === id)?.name ?? "Removed employee");

  const alloc: Allocation[] = mode === "one" ? [] : method === "equal" ? equalSplit(total, team) : method === "balanced" ? balancedSplit(total, team, load) : team.map((id) => ({ employeeId: id, count: Number(custom[id] ?? 0) }));
  const allocErr = mode === "split" ? allocationError(total, alloc) : target === undefined ? "Choose who receives the leads." : null;
  const plan = useMemo(() => (allocErr ? [] : mode === "one" ? singlePlan(leadIds, target ?? null, assignments) : buildPlan(leadIds, alloc, assignments)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allocErr, mode, target, leadIds, assignments, JSON.stringify(alloc)]);
  const impact = planImpact(plan);
  const needsAck = impact.reassigned > 0;

  const reset = () => { setMode("one"); setTarget(undefined); setTeam([]); setMethod("equal"); setCustom({}); setAck(false); };
  const close = () => { reset(); onClose(); };
  const apply = () => {
    if (allocErr || (needsAck && !ack)) return;
    const r = applyAssignmentPlan(plan, mode === "one" ? "Leads bulk assign" : `Leads distribute (${method})`);
    if (!r.ok) { toast.error(r.error); return; }
    const snap = r.snapshot; const exp: Record<string, string | null> = Object.fromEntries(plan.filter((x) => x.leadId in snap).map((x) => [x.leadId, x.employeeId]));
    const msg = r.changed ? `${r.changed} lead${r.changed === 1 ? "" : "s"} ${mode === "one" ? "assigned" : "distributed"}` : "Nothing changed — already set";
    if (r.skipped.length) {
      const why = [...new Set(r.skipped.map((s) => SKIP_LABEL[s.reason]))].join("; ");
      toast.warning(`${msg}. ${r.skipped.length} skipped: ${why}.`, r.changed ? { action: { label: "Undo", onClick: () => { const u = restoreAssignments(snap, exp); if (u.kept) toast.info(`Undo restored ${u.restored}; ${u.kept} kept because they changed again since.`); } }, duration: 10000 } : undefined);
    } else toast.success(msg, r.changed ? { action: { label: "Undo", onClick: () => { const u = restoreAssignments(snap, exp); if (u.kept) toast.info(`Undo restored ${u.restored}; ${u.kept} kept because they changed again since.`); } }, duration: 8000 } : undefined);
    reset(); onDone?.(); onClose();
  };

  const Emp = ({ id, on, onClick, multi }: { id: string; on: boolean; onClick: () => void; multi?: boolean }) => {
    const e = employees.find((x) => x.id === id)!; const ok = assignable(e);
    return <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} disabled={!ok} onClick={onClick} className={cn("as-opt", on && "is-on")}>
      <span className="tm-avatar">{initials(e.name)}</span>
      <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{roleLabel(e)} · <span className="num">{load[id] ?? 0}</span> assigned now{!ok ? " · inactive — can't receive leads" : ""}</span></span>
      {on && <Check className="size-4" />}
    </button>;
  };

  return <Dialog open={open} onOpenChange={(o) => !o && close()}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0 [&_.grid>*]:min-w-0">
    <DialogHeader><DialogTitle>Assign {total} lead{total === 1 ? "" : "s"}</DialogTitle><DialogDescription>{scope}. Changes who is responsible only — lead details, notes, follow-ups and history stay attached to each lead.</DialogDescription></DialogHeader>

    <div className="ba-break" aria-label="Current assignees">{Object.entries(breakdown).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="ba-pill"><b className="num">{n}</b> {name(k)}</span>)}</div>

    <div className="seg w-full" role="radiogroup" aria-label="Assignment mode" onKeyDown={onRovingKeyDown}>
      <button type="button" role="radio" aria-checked={mode === "one"} data-active={mode === "one"} tabIndex={roving(mode === "one")} onClick={() => { setMode("one"); setAck(false); }}><Users className="size-3.5" />One employee</button>
      <button type="button" role="radio" aria-checked={mode === "split"} data-active={mode === "split"} tabIndex={roving(mode === "split")} disabled={total < 2} onClick={() => { setMode("split"); setAck(false); }}><Split className="size-3.5" />Distribute</button>
    </div>

    {mode === "one" ? <div role="radiogroup" aria-label="Choose employee" className="grid max-h-[34vh] gap-1.5 overflow-y-auto">
      <button type="button" role="radio" aria-checked={target === null} onClick={() => { setTarget(null); setAck(false); }} className={cn("as-opt", target === null && "is-on")}><span className="tm-avatar tm-avatar-owner"><Crown className="size-4" /></span><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-semibold">Owner (unassigned)</span><span className="block text-xs text-muted-foreground">Return responsibility to you</span></span>{target === null && <Check className="size-4" />}</button>
      {list.map((e) => <Emp key={e.id} id={e.id} on={target === e.id} onClick={() => { setTarget(e.id); setAck(false); }} />)}
    </div> : <div className="grid gap-3">
      <div role="group" aria-label="Choose employees" className="grid max-h-[28vh] gap-1.5 overflow-y-auto">{list.map((e) => <Emp key={e.id} id={e.id} multi on={team.includes(e.id)} onClick={() => { setTeam((t) => (t.includes(e.id) ? t.filter((x) => x !== e.id) : [...t, e.id])); setAck(false); }} />)}</div>
      {!active.length && <p className="text-sm text-muted-foreground">No active employees can receive leads.</p>}
      <div className="seg w-full" role="group" aria-label="Distribution method">{([["equal", "Equal"], ["balanced", "Balance workload"], ["custom", "Custom counts"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={method === k} onClick={() => { setMethod(k); setAck(false); }}>{l}</button>)}</div>
      {method === "balanced" && <p className="text-xs text-muted-foreground">Suggests counts that even out total assigned leads per person. Based only on current lead counts — not on performance.</p>}
      {method === "custom" && team.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{team.map((id) => <label key={id} className="q-field"><span>{name(id)}</span><Input type="number" inputMode="numeric" min={0} value={custom[id] ?? ""} placeholder="0" onChange={(e) => { setCustom((c) => ({ ...c, [id]: e.target.value })); setAck(false); }} /></label>)}</div>}
    </div>}

    {plan.length > 0 && <div className="ba-preview" aria-label="Preview of changes">
      <div className="eyebrow mb-2">Preview</div>
      <ul className="grid gap-1 text-sm">{Object.entries(impact.perTarget).map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span>{name(k)}</span><span className="num font-semibold">{n} lead{n === 1 ? "" : "s"}</span></li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground"><span className="num">{impact.fresh}</span> newly assigned · <span className="num">{impact.reassigned}</span> moved from someone else · <span className="num">{impact.unchanged}</span> already there</p>
      {needsAck && <label className="mt-3 flex items-start gap-2 text-xs"><Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} aria-label="Confirm reassignment" /><span>I understand this takes leads away from {Object.entries(impact.replacedFrom).map(([k, n]) => `${name(k)} (${n})`).join(", ")}.</span></label>}
    </div>}
    {mode === "split" && allocErr && team.length > 0 && <p role="alert" className="text-xs text-destructive">{allocErr}</p>}

    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!!allocErr || (needsAck && !ack)} onClick={apply}>Confirm · {total} lead{total === 1 ? "" : "s"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
