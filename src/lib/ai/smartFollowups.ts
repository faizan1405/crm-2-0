// AI-4A Smart Follow-up Priorities — deterministic Demo Analysis over recorded CRM data.
// One recommendation per lead (its single canonical pending follow-up decides the group), so a
// lead never appears twice. Dates are grouped in Asia/Kolkata. No network, no CRM writes.
import type { FollowUp, Lead, LeadActivity } from "@/lib/crm/types";
import { STATUS_LABEL } from "@/lib/crm/types";
import { activeFollowUp, followUpBucket, isPending } from "@/lib/crm/followups";

export const SMART_FU_LABEL = "Demo Analysis — based on recorded CRM data, not live AI.";
/** Explicit thresholds (also documented in docs/ai-copilot-architecture.md). */
export const THRESHOLDS = { proposalStallDays: 7, upcomingWindowDays: 7 } as const;

export type SmartGroup = "overdue" | "today" | "missing" | "proposal" | "upcoming";
export const GROUP_LABEL: Record<SmartGroup, string> = {
  overdue: "Overdue Follow-ups", today: "Due Today", missing: "Active Leads Missing a Next Follow-up",
  proposal: "Proposals Needing Review", upcoming: "Upcoming Follow-ups",
};
export const GROUP_ORDER: SmartGroup[] = ["overdue", "today", "proposal", "missing", "upcoming"];
export type Attention = "high" | "medium" | "low";
export type NextKind = "call" | "reschedule" | "schedule" | "whatsapp" | "open_lead" | "review";
export const NEXT_LABEL: Record<NextKind, string> = { call: "Call the lead", reschedule: "Reschedule the follow-up", schedule: "Schedule a follow-up", whatsapp: "Send a WhatsApp check-in", open_lead: "Open the lead", review: "Review Lead Intelligence" };

export interface SmartRec {
  leadId: string; name: string; stage: string; group: SmartGroup; attention: Attention;
  reason: string; next: NextKind; latestActivity?: { at: string; text: string };
  followUp?: Pick<FollowUp, "id" | "type" | "dueAt" | "note">;
  /** Too little recorded to judge — shown as a limitation, never as interest. */
  insufficient: boolean;
  afterSales: boolean;
}
export interface SmartSummary { overdue: number; dueToday: number; completedToday: number; leadsNeedingAttention: number }
export interface SmartFollowUpResult { recs: SmartRec[]; summary: SmartSummary; label: string; simulated: true }
/** Future provider contract: same input → same shape. */
export interface SmartFollowUpRequest { leads: Lead[]; followUps: FollowUp[]; activities: LeadActivity[]; now: string }
export interface SmartFollowUpProvider { analyse(req: SmartFollowUpRequest): SmartFollowUpResult }

const IST = 330 * 60_000, DAY = 86_400_000;
export const istDay = (d: Date | string) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const agoDays = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
const inDays = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

export function analyseFollowUps(leads: Lead[], followUps: FollowUp[], activities: LeadActivity[], now: Date): SmartFollowUpResult {
  const today = istDay(now);
  const recs: SmartRec[] = [];
  for (const l of leads) {
    const acts = activities.filter((a) => a.leadId === l.id).sort((a, b) => b.at.localeCompare(a.at));
    const last = acts[0];
    const active = activeFollowUp(followUps, l.id);
    const closed = l.status === "won" || l.status === "lost";
    const base = { leadId: l.id, name: l.name, stage: STATUS_LABEL[l.status], afterSales: closed, insufficient: false, ...(last ? { latestActivity: { at: last.at, text: last.text + (last.outcome ? ` · ${last.outcome}` : "") } } : {}) };
    if (active) {
      const b = followUpBucket(active, now);
      const fu = { id: active.id, type: active.type, dueAt: active.dueAt, ...(active.note ? { note: active.note } : {}) };
      const d = dayDiff(today, istDay(active.dueAt));
      if (b === "overdue") recs.push({ ...base, followUp: fu, group: "overdue", attention: closed ? "low" : "high", next: closed ? "reschedule" : "call", reason: `${closed ? "After-sales follow-up" : "Follow-up"} was scheduled ${d === 0 ? "earlier today" : agoDays(d)} and remains incomplete.` });
      else if (b === "today") recs.push({ ...base, followUp: fu, group: "today", attention: closed ? "low" : "medium", next: closed ? "open_lead" : "call", reason: `${closed ? "After-sales follow-up" : "Follow-up"} is due today.` });
      else if (-d <= THRESHOLDS.upcomingWindowDays) recs.push({ ...base, followUp: fu, group: "upcoming", attention: "low", next: "open_lead", reason: `Next follow-up is already booked ${inDays(-d)} — nothing to do yet.` });
      continue;
    }
    if (closed) continue; // no fresh sales pitch for Won/Lost leads
    const sinceAct = last ? dayDiff(today, istDay(last.at)) : null;
    if (l.status === "proposal") {
      if (sinceAct === null || sinceAct >= THRESHOLDS.proposalStallDays) { recs.push({ ...base, group: "proposal", attention: "high", next: "call", reason: sinceAct === null ? "Proposal sent, but no activity is recorded since and no follow-up is booked." : `Proposal sent, last activity ${agoDays(sinceAct)} and no follow-up is booked.` }); continue; }
      recs.push({ ...base, group: "missing", attention: "medium", next: "schedule", reason: "Proposal sent with recent activity, but no next follow-up is booked." }); continue;
    }
    const thin = !last && !l.requirement;
    if (l.status === "new" && !last) { recs.push({ ...base, group: "missing", attention: "medium", next: "call", insufficient: thin, reason: thin ? "New lead with no contact or requirement recorded — too little to judge interest." : "New lead with no contact recorded and no follow-up booked." }); continue; }
    if (thin) { recs.push({ ...base, group: "missing", attention: "low", next: "open_lead", insufficient: true, reason: "Too little is recorded to judge this lead, and no follow-up is booked." }); continue; }
    recs.push({ ...base, group: "missing", attention: l.status === "qualified" ? "high" : "medium", next: "schedule", reason: `${STATUS_LABEL[l.status]} lead with no future follow-up booked.` });
  }
  const pend = followUps.filter(isPending);
  const summary: SmartSummary = {
    overdue: pend.filter((f) => followUpBucket(f, now) === "overdue").length,
    dueToday: pend.filter((f) => followUpBucket(f, now) === "today").length,
    completedToday: followUps.filter((f) => f.completedAt && istDay(f.completedAt) === today).length,
    leadsNeedingAttention: new Set(recs.filter((r) => !r.afterSales && r.group !== "upcoming").map((r) => r.leadId)).size,
  };
  const rank = { high: 0, medium: 1, low: 2 } as const;
  recs.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || rank[a.attention] - rank[b.attention] || (a.followUp?.dueAt ?? "").localeCompare(b.followUp?.dueAt ?? ""));
  return { recs, summary, label: SMART_FU_LABEL, simulated: true };
}

export const demoSmartFollowUps: SmartFollowUpProvider = { analyse: (r) => analyseFollowUps(r.leads, r.followUps, r.activities, new Date(r.now)) };
export const getSmartFollowUpProvider = (): SmartFollowUpProvider => demoSmartFollowUps;
