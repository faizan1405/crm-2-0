// Pipeline intelligence: pure, data-backed signals only (no invented ages or probabilities).
import type { FollowUp, Lead, LeadActivity, LeadStatus } from "./types";
import { followUpBucket, isPending } from "./followups";

/** Days a lead may sit in an open stage before it is flagged as stalled. Won/Lost never stall. */
export const STALL_DAYS: Record<LeadStatus, number | null> = { new: 3, contacted: 7, qualified: 10, proposal: 7, won: null, lost: null };
export const HIGH_VALUE = 50000;
const DAY = 864e5;

/**
 * When the lead entered its current stage: the latest recorded stage change,
 * or creation time for a lead still in "new" that never changed stage. Otherwise unknown.
 */
// Per-lead lookups built once per (immutable) array and reused by every card — same results as scanning, O(n) instead of O(leads × records).
type ActLike = Pick<LeadActivity, "leadId" | "type" | "at">;
const statusIdx = new WeakMap<readonly ActLike[], Map<string, string>>();
const nextIdx = new WeakMap<readonly FollowUp[], Map<string, FollowUp>>();
export function lastStageChanges(activities: readonly ActLike[]): Map<string, string> {
  let m = statusIdx.get(activities);
  if (!m) { m = new Map(); for (const a of activities) if (a.type === "status") { const cur = m.get(a.leadId); if (!cur || a.at > cur) m.set(a.leadId, a.at); } statusIdx.set(activities, m); }
  return m;
}
/** Earliest pending follow-up per lead (first in list order on equal times, matching a stable sort). */
export function nextPendingByLead(followUps: readonly FollowUp[]): Map<string, FollowUp> {
  let m = nextIdx.get(followUps);
  if (!m) { m = new Map(); for (const f of followUps) if (isPending(f)) { const cur = m.get(f.leadId); if (!cur || f.dueAt.localeCompare(cur.dueAt) < 0) m.set(f.leadId, f); } nextIdx.set(followUps, m); }
  return m;
}
export function stageSince(lead: Pick<Lead, "id" | "status" | "createdAt">, activities: ActLike[]): string | null {
  const last = lastStageChanges(activities).get(lead.id) ?? null;
  if (last) return last;
  return lead.status === "new" ? lead.createdAt : null;
}
export const daysIn = (since: string | null, now: Date) => (since ? Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY)) : null);
export function isStalled(status: LeadStatus, days: number | null) { const t = STALL_DAYS[status]; return t !== null && days !== null && days >= t; }

export interface CardSignals { days: number | null; stalled: boolean; overdue: boolean; nextDue?: string | undefined; highValue: boolean; hot: boolean }
export function cardSignals(lead: Lead, activities: LeadActivity[], followUps: FollowUp[], now: Date): CardSignals {
  const days = daysIn(stageSince(lead, activities), now);
  const next = nextPendingByLead(followUps).get(lead.id);
  return { days, stalled: isStalled(lead.status, days), overdue: !!next && followUpBucket(next, now) === "overdue", nextDue: next?.dueAt, highValue: (lead.quotedAmount ?? 0) >= HIGH_VALUE, hot: lead.priority === "hot" };
}

export interface StageSummary { count: number; value: number; overdue: number; stalled: number }
export function stageSummary(leads: Lead[], status: LeadStatus, activities: LeadActivity[], followUps: FollowUp[], now: Date): StageSummary {
  const col = leads.filter((l) => l.status === status);
  const sig = col.map((l) => cardSignals(l, activities, followUps, now));
  return { count: col.length, value: col.reduce((s, l) => s + (l.quotedAmount ?? 0), 0), overdue: sig.filter((s) => s.overdue).length, stalled: sig.filter((s) => s.stalled).length };
}
export const isOpen = (s: LeadStatus) => s !== "won" && s !== "lost";

/** An older stage Undo may only run if the lead is still exactly as that move left it (no newer edit since). */
export const canUndoStage = (current: Pick<Lead, "status" | "updatedAt"> | undefined, applied: Pick<Lead, "status" | "updatedAt">) =>
  !!current && current.status === applied.status && current.updatedAt === applied.updatedAt;

/** Cards mounted per stage before "Show more"; only limits rendering, never data or counts. */
export const PIPE_BATCH = 40;
/** First `limit` cards of a stage plus any pinned ids (dragged / selected) found beyond it — no duplicates, order kept. */
export function visibleCards<T extends { id: string }>(col: readonly T[], limit: number, pinned: readonly (string | null | undefined)[] = []): { shown: T[]; hidden: number } {
  const shown = col.slice(0, Math.max(0, limit));
  for (const id of pinned) { if (!id) continue; const i = col.findIndex((c) => c.id === id); if (i >= limit && !shown.some((c) => c.id === id)) shown.push(col[i]!); }
  return { shown, hidden: col.length - shown.length };
}
/** Leads grouped by stage (sorted by quoted amount desc) in one pass. */
export function groupByStage(leads: readonly Lead[], stages: readonly LeadStatus[]): Map<LeadStatus, Lead[]> {
  const m = new Map<LeadStatus, Lead[]>(stages.map((s) => [s, []]));
  for (const l of leads) m.get(l.status)?.push(l);
  for (const col of m.values()) col.sort((a, b) => (b.quotedAmount ?? 0) - (a.quotedAmount ?? 0));
  return m;
}
