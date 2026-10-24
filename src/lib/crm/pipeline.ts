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
export function stageSince(lead: Pick<Lead, "id" | "status" | "createdAt">, activities: Pick<LeadActivity, "leadId" | "type" | "at">[]): string | null {
  const last = activities.filter((a) => a.leadId === lead.id && a.type === "status").reduce<string | null>((m, a) => (!m || a.at > m ? a.at : m), null);
  if (last) return last;
  return lead.status === "new" ? lead.createdAt : null;
}
export const daysIn = (since: string | null, now: Date) => (since ? Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY)) : null);
export function isStalled(status: LeadStatus, days: number | null) { const t = STALL_DAYS[status]; return t !== null && days !== null && days >= t; }

export interface CardSignals { days: number | null; stalled: boolean; overdue: boolean; nextDue?: string | undefined; highValue: boolean; hot: boolean }
export function cardSignals(lead: Lead, activities: LeadActivity[], followUps: FollowUp[], now: Date): CardSignals {
  const days = daysIn(stageSince(lead, activities), now);
  const next = followUps.filter((f) => f.leadId === lead.id && isPending(f)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
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
