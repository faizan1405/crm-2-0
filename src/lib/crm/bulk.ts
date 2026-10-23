// Pure bulk-selection and lead-distribution rules. No React, no store — testable and backend-agnostic.
import type { Assignment } from "./access";

/** Selection model: explicit ids, or "everything matching" (snapshot of ids at click time) minus exclusions. */
export type Selection =
  | { kind: "ids"; ids: string[] }
  | { kind: "matching"; base: string[]; exclude: string[]; label: string };

export const EMPTY_SELECTION: Selection = { kind: "ids", ids: [] };

export function selectedIds(sel: Selection): string[] {
  if (sel.kind === "ids") return sel.ids;
  const ex = new Set(sel.exclude);
  return sel.base.filter((id) => !ex.has(id));
}
export const selectionCount = (sel: Selection) => (sel.kind === "ids" ? sel.ids.length : sel.base.length - new Set(sel.exclude).size);
export function isSelected(sel: Selection, id: string): boolean {
  return sel.kind === "ids" ? sel.ids.includes(id) : sel.base.includes(id) && !sel.exclude.includes(id);
}
export function toggle(sel: Selection, id: string, on: boolean): Selection {
  if (sel.kind === "ids") return { kind: "ids", ids: on ? (sel.ids.includes(id) ? sel.ids : [...sel.ids, id]) : sel.ids.filter((x) => x !== id) };
  if (!sel.base.includes(id)) return on ? { kind: "ids", ids: [...selectedIds(sel), id] } : sel;
  return { ...sel, exclude: on ? sel.exclude.filter((x) => x !== id) : sel.exclude.includes(id) ? sel.exclude : [...sel.exclude, id] };
}
/** Adds a page of ids to the current selection (does not select other pages). */
export function addPage(sel: Selection, pageIds: string[]): Selection {
  const cur = selectedIds(sel);
  return { kind: "ids", ids: [...cur, ...pageIds.filter((id) => !cur.includes(id))] };
}
export const selectMatching = (ids: string[], label: string): Selection => ({ kind: "matching", base: [...ids], exclude: [], label });

// ---------- Distribution ----------
export interface Allocation { employeeId: string; count: number }

/** Equal split; the remainder goes one-each to the first employees in the given order (deterministic). */
export function equalSplit(total: number, employeeIds: string[]): Allocation[] {
  const k = employeeIds.length; if (!k) return [];
  const base = Math.floor(total / k), extra = total % k;
  return employeeIds.map((employeeId, i) => ({ employeeId, count: base + (i < extra ? 1 : 0) }));
}

/** Suggest counts that even out total assigned leads (existing workload + new), filling the least loaded first. Ties keep given order. */
export function balancedSplit(total: number, employeeIds: string[], workload: Record<string, number>): Allocation[] {
  const load = employeeIds.map((id) => ({ id, n: workload[id] ?? 0, add: 0 }));
  if (!load.length) return [];
  for (let i = 0; i < total; i++) {
    let best = load[0]!;
    for (const x of load) if (x.n + x.add < best.n + best.add) best = x;
    best.add++;
  }
  return load.map((x) => ({ employeeId: x.id, count: x.add }));
}

export function allocationError(total: number, alloc: Allocation[]): string | null {
  if (!alloc.length) return "Choose at least one employee.";
  if (alloc.some((a) => !Number.isInteger(a.count) || a.count < 0)) return "Counts must be whole numbers of 0 or more.";
  const sum = alloc.reduce((s, a) => s + a.count, 0);
  if (sum !== total) return `Counts add up to ${sum}, but ${total} lead${total === 1 ? " is" : "s are"} selected.`;
  return null;
}

export interface PlanItem { leadId: string; employeeId: string | null; previous: string | null }
/** Maps leads (in given order) to employees by allocation; records each lead's current assignee for impact + stale checks. */
export function buildPlan(leadIds: string[], alloc: Allocation[], assignments: Record<string, Assignment>): PlanItem[] {
  const out: PlanItem[] = []; let i = 0;
  for (const a of alloc) for (let n = 0; n < a.count && i < leadIds.length; n++, i++) {
    const leadId = leadIds[i]!; out.push({ leadId, employeeId: a.employeeId, previous: assignments[leadId]?.employeeId ?? null });
  }
  return out;
}
export const singlePlan = (leadIds: string[], employeeId: string | null, assignments: Record<string, Assignment>): PlanItem[] =>
  leadIds.map((leadId) => ({ leadId, employeeId, previous: assignments[leadId]?.employeeId ?? null }));

export interface PlanImpact { unchanged: number; fresh: number; reassigned: number; perTarget: Record<string, number>; replacedFrom: Record<string, number> }
export function planImpact(plan: PlanItem[]): PlanImpact {
  const r: PlanImpact = { unchanged: 0, fresh: 0, reassigned: 0, perTarget: {}, replacedFrom: {} };
  for (const p of plan) {
    const t = p.employeeId ?? "__owner";
    r.perTarget[t] = (r.perTarget[t] ?? 0) + 1;
    if (p.previous === p.employeeId) r.unchanged++;
    else if (!p.previous) r.fresh++;
    else { r.reassigned++; r.replacedFrom[p.previous] = (r.replacedFrom[p.previous] ?? 0) + 1; }
  }
  return r;
}
/** Current-assignee breakdown for a set of leads ("__owner" = unassigned). */
export function assigneeBreakdown(leadIds: string[], assignments: Record<string, Assignment>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of leadIds) { const k = assignments[id]?.employeeId ?? "__owner"; out[k] = (out[k] ?? 0) + 1; }
  return out;
}
export const workload = (assignments: Record<string, Assignment>): Record<string, number> =>
  Object.values(assignments).reduce<Record<string, number>>((m, a) => ((m[a.employeeId] = (m[a.employeeId] ?? 0) + 1), m), {});

export type SkipReason = "missing" | "changed" | "inactive";
export const SKIP_LABEL: Record<SkipReason, string> = { missing: "lead no longer exists", changed: "assignee changed since you previewed", inactive: "employee can't receive leads" };
