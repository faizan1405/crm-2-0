// Pure follow-up rules: pending state, canonical active follow-up, smart suggestions (IST).
import type { FollowUp, FollowUpType, Lead, LeadActivity } from "./types";
import { dayKey } from "./format";
import { shiftDay } from "./dates";

/** Pending = not completed and not cancelled/replaced. */
export const isPending = (f: FollowUp) => !f.completedAt && !f.cancelledAt;

/** The one canonical active follow-up for a lead (earliest pending). */
export function activeFollowUp(followUps: FollowUp[], leadId: string): FollowUp | undefined {
  return followUps.filter((f) => f.leadId === leadId && isPending(f)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
}

const IST_MS = 330 * 60_000;
/** Hour of day (0-23) in Asia/Kolkata. */
export const istHour = (d: Date) => new Date(d.getTime() + IST_MS).getUTCHours();
const pad = (n: number) => String(n).padStart(2, "0");

/** Next sensible working slot as IST datetime-local: next full hour (10:00–19:00) today, else tomorrow 11:00. */
export function nextSlot(now: Date, hoursAhead = 1): string {
  const today = dayKey(now);
  const h = Math.max(10, istHour(now) + hoursAhead);
  return h <= 19 ? `${today}T${pad(h)}:00` : `${shiftDay(today, 1)}T11:00`;
}
const tomorrowAt = (now: Date, h: number) => `${shiftDay(dayKey(now), 1)}T${pad(h)}:00`;
const inDays = (now: Date, n: number, h = 11) => `${shiftDay(dayKey(now), n)}T${pad(h)}:00`;

export interface Suggestion {
  leadId: string;
  type: FollowUpType;
  /** IST datetime-local "YYYY-MM-DDTHH:mm" — always shown for approval, never saved automatically. */
  at: string;
  reason: string;
  action: string;
  urgent: boolean;
  /** When set, accepting should reschedule this overdue follow-up instead of adding a new one. */
  rescheduleId?: string;
}

const DAY = 86_400_000;
const daysAgo = (iso: string | undefined, now: Date) => (iso ? Math.max(0, Math.round((dayStart(dayKey(now)) - dayStart(dayKey(iso))) / DAY)) : undefined);
const dayStart = (k: string) => new Date(`${k}T00:00:00Z`).getTime();
const ago = (n: number | undefined) => (n === undefined ? "never" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

/** Latest call outcome recorded on the lead's activity timeline. */
export function lastCallOutcome(activities: LeadActivity[], leadId: string): LeadActivity | undefined {
  return activities.filter((a) => a.leadId === leadId && a.type === "call" && a.outcome).sort((a, b) => b.at.localeCompare(a.at))[0];
}

/** Deterministic next-step suggestion from real lead data. Returns null when nothing should be suggested. */
export function suggestFollowUp(lead: Lead, followUps: FollowUp[], activities: LeadActivity[], now: Date): Suggestion | null {
  if (lead.status === "won" || lead.status === "lost") return null;
  const first = lead.name.split(" ")[0];
  const active = activeFollowUp(followUps, lead.id);
  if (active) {
    if (new Date(active.dueAt).getTime() >= now.getTime()) return null;
    return { leadId: lead.id, type: active.type, at: nextSlot(now), urgent: true, rescheduleId: active.id, action: "Reschedule now", reason: `${first}'s follow-up was due ${ago(daysAgo(active.dueAt, now))} and is overdue.` };
  }
  const hot = lead.priority === "hot" || (lead.aiScore ?? 0) >= 80;
  const last = lastCallOutcome(activities, lead.id);
  const outcome = last && (!lead.lastContact || last.at >= lead.lastContact) ? last.outcome : undefined;
  const q = lead.quickStatus;
  const contactAgo = daysAgo(lead.lastContact, now);
  const base = { leadId: lead.id, urgent: false };
  if (outcome === "Not picked" || (!outcome && q === "not_picked")) return { ...base, type: "call", at: nextSlot(now, 2), urgent: hot, action: "Try calling again", reason: `${first}'s last call wasn't picked up — try again in a couple of hours.` };
  if (outcome === "Busy" || (!outcome && q === "busy")) return { ...base, type: "call", at: istHour(now) < 17 ? `${dayKey(now)}T18:00` : tomorrowAt(now, 11), action: "Call back later", reason: `${first} was busy on the last call — call back at a calmer time.` };
  if (outcome === "Call back later" || (!outcome && q === "callback")) return { ...base, type: "call", at: tomorrowAt(now, 11), action: "Callback", reason: `${first} asked for a call back.` };
  if (lead.status === "new") {
    const age = daysAgo(lead.createdAt, now) ?? 0;
    return { ...base, type: "call", at: nextSlot(now), urgent: hot || age >= 1, action: "First contact", reason: `${first} is a new lead${age ? ` added ${ago(age)}` : ""} and hasn't been contacted yet.` };
  }
  if (lead.status === "contacted") return { ...base, type: contactAgo !== undefined && contactAgo >= 3 ? "call" : "whatsapp", at: hot ? nextSlot(now) : tomorrowAt(now, 11), urgent: hot, action: "Next conversation", reason: `${first} was contacted ${ago(contactAgo)} and has no upcoming follow-up.` };
  if (lead.status === "qualified") return { ...base, type: "meeting", at: hot ? tomorrowAt(now, 11) : inDays(now, 2), urgent: hot, action: "Proposal discussion", reason: `${first} is qualified — set up a proposal discussion.` };
  return { ...base, type: "call", at: contactAgo !== undefined && contactAgo >= 2 ? nextSlot(now) : inDays(now, 2), urgent: hot && (contactAgo ?? 0) >= 2, action: "Check quotation", reason: `${first} has the proposal — check whether they reviewed the quotation (last contact ${ago(contactAgo)}).` };
}

export function suggestAll(leads: Lead[], followUps: FollowUp[], activities: LeadActivity[], now: Date): Suggestion[] {
  return leads.map((l) => suggestFollowUp(l, followUps, activities, now)).filter((s): s is Suggestion => !!s).sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.at.localeCompare(b.at));
}
