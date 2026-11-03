// AI-7B — Owner AI Daily Briefing & Performance Coach (Demo Mode, deterministic).
// Every statement is derived from the same verified metrics as My Performance
// (`ownerMetrics`, `followUpCompletion`, `suggestFollowUp`) — no independent
// formulas, no invented activity, no AI conclusions beyond rule-based evidence.
// Swap point: a future secure server provider can replace `buildCoachReport`
// behind the same `CoachReport` contract; the UI never changes.
import type { ActivityEvent } from "@/lib/crm/activity";
import type { Deal, Employee, FollowUp, GoalDef, GoalRevision, Lead, LeadActivity, Payment } from "@/lib/crm/types";
import type { QuotationShare } from "@/lib/crm/studio";
import { ownerMetrics, type OwnerMetrics } from "@/lib/crm/ownerPerformance";
import { goalProgress, goalsFor, indexEvents, metricValue, PROGRESS_LABEL, visibleGoal, type Window } from "@/lib/crm/performance";
import { isPending, suggestFollowUp } from "@/lib/crm/followups";
import { dayKey } from "@/lib/crm/format";
import { shiftDay } from "@/lib/crm/dates";

export const COACH_LABEL = "Demo Analysis — based on recorded CRM data, not a live AI model.";

export interface CoachInput {
  events: ActivityEvent[];
  leads: Lead[];
  followUps: FollowUp[];
  deals: Deal[];
  quotationShares: QuotationShare[];
  activities: LeadActivity[];
  goals: GoalDef[];
  goalRevisions: GoalRevision[];
  employees: Employee[];
  payments: Payment[];
}

export interface Bottleneck { id: string; title: string; evidence: string; why: string; nextStep: string; leadId?: string | undefined }
export interface Recommendation { id: string; label: string; detail: string; to: string; leadId?: string | undefined }
export interface PlanItem { id: string; label: string; detail: string; leadId?: string | undefined; at?: string | undefined }

export interface CoachReport {
  label: string;
  window: Window;
  prevWindow: Window;
  /** Latest recorded activity anywhere in the CRM — the data boundary of this analysis. */
  lastDataAt: string | null;
  metrics: OwnerMetrics;
  summary: {
    calls: number; connected: number; followUpsCompleted: number; overdue: number;
    leadsCreated: number; dealsWon: number;
    attentionLeads: { id: string; name: string; reason: string }[];
  };
  /** One recommended focus for the day, or null when there is nothing actionable. */
  focus: string | null;
  bottlenecks: Bottleneck[];
  /** True when the window has too little recorded activity for any bottleneck judgment. */
  insufficient: boolean;
  recommendations: Recommendation[];
  coach: { wentWell: string[]; needsAttention: string[]; nextMove: string | null };
  /** Today's suggested plan — always computed against `now`, independent of the selected period. */
  plan: PlanItem[];
  comparison: { available: boolean; reason?: string | undefined; lines: string[] };
  targets: { configured: boolean; lines: string[] };
}

/** Same-length window immediately before `w` (business days, Asia/Kolkata keys). */
export function previousWindow(w: Window): Window {
  const len = daysOfWindow(w);
  const end = shiftDay(w.start, -1);
  return { start: shiftDay(end, -(len - 1)), end };
}
const daysOfWindow = (w: Window) => {
  let n = 0, d = w.start;
  while (d <= w.end && n < 400) { n++; d = shiftDay(d, 1); }
  return n;
};

const pct = (r: number | null) => (r === null ? "N/A" : `${Math.round(r * 100)}%`);
const DAY = 86_400_000;
const daysAgo = (iso: string | undefined, now: Date) =>
  iso ? Math.max(0, Math.round((new Date(`${dayKey(now)}T00:00:00Z`).getTime() - new Date(`${dayKey(iso)}T00:00:00Z`).getTime()) / DAY)) : undefined;

/** Open pipeline leads (never Won/Lost) sorted by urgency for attention lists. */
function openLeads(leads: Lead[]) {
  return leads.filter((l) => l.status !== "won" && l.status !== "lost");
}

export function buildCoachReport(input: CoachInput, w: Window, now: Date): CoachReport {
  const data = { events: input.events, leads: input.leads, followUps: input.followUps, deals: input.deals, quotationShares: input.quotationShares };
  const m = ownerMetrics(data, w, now);
  const prevW = previousWindow(w);
  const prev = ownerMetrics(data, prevW, now);
  const nowIso = now.toISOString();
  const open = openLeads(input.leads);
  const leadName = (id: string) => input.leads.find((l) => l.id === id)?.name ?? "this lead";

  const lastDataAt = input.events.reduce<string | null>((acc, e) => (acc === null || e.occurredAt > acc ? e.occurredAt : acc), null);

  // ---- Leads needing attention: overdue follow-ups first, then smart suggestions ----
  const overdueFUs = input.followUps.filter((f) => isPending(f) && f.dueAt < nowIso).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const attention: { id: string; name: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const f of overdueFUs) {
    const lead = input.leads.find((l) => l.id === f.leadId);
    if (!lead || lead.status === "won" || lead.status === "lost" || seen.has(lead.id)) continue;
    seen.add(lead.id);
    attention.push({ id: lead.id, name: lead.name, reason: `Follow-up overdue since ${dayKey(f.dueAt)}.` });
    if (attention.length >= 3) break;
  }
  for (const lead of open) {
    if (attention.length >= 3) break;
    if (seen.has(lead.id)) continue;
    const s = suggestFollowUp(lead, input.followUps, input.activities, now);
    if (s?.urgent) { seen.add(lead.id); attention.push({ id: lead.id, name: lead.name, reason: s.reason }); }
  }

  // ---- Bottlenecks (deterministic rules, minimum sample sizes) ----
  const bottlenecks: Bottleneck[] = [];
  if (m.calls >= 8 && m.connectionRate !== null && m.connectionRate < 0.3)
    bottlenecks.push({ id: "low-connection", title: "Many calls, few connections", evidence: `${m.connected} of ${m.calls} logged calls connected (${pct(m.connectionRate)}).`, why: "A low connection rate can mean calling at the wrong times or working a cold list — the effort is there, the conversations are not.", nextStep: "Try calling your Not picked leads at a different time of day." });
  if (m.connected >= 3 && m.followUpsCompleted === 0 && m.followUpsDue > 0)
    bottlenecks.push({ id: "no-next-steps", title: "Connected calls without recorded next steps", evidence: `${m.connected} connected calls but 0 follow-ups completed in this period.`, why: "Conversations without a recorded next step tend to go cold — the CRM can't remind you what it doesn't know.", nextStep: "Open your follow-ups and record the next step for each recent conversation." });
  if (m.overdue >= 3)
    bottlenecks.push({ id: "many-overdue", title: "Several overdue follow-ups", evidence: `${m.overdue} follow-ups are past their scheduled time.`, why: "Overdue follow-ups are the most common place deals quietly die.", nextStep: `Start with ${leadName(overdueFUs[0]?.leadId ?? "")} — the longest waiting.` , leadId: overdueFUs[0]?.leadId });
  const qualifiedNoNext = open.filter((l) => l.status === "qualified" && !input.followUps.some((f) => f.leadId === l.id && isPending(f)));
  if (qualifiedNoNext.length > 0)
    bottlenecks.push({ id: "qualified-no-next", title: "Qualified leads without a next action", evidence: `${qualifiedNoNext.length} qualified lead${qualifiedNoNext.length === 1 ? "" : "s"} (${qualifiedNoNext.slice(0, 3).map((l) => l.name).join(", ")}) ha${qualifiedNoNext.length === 1 ? "s" : "ve"} no pending follow-up.`, why: "Qualified leads are your closest revenue — leaving them without a next step stalls the pipeline.", nextStep: `Schedule the next step for ${qualifiedNoNext[0]!.name}.`, leadId: qualifiedNoNext[0]!.id });
  const staleProposals = open.filter((l) => l.status === "proposal" && (daysAgo(l.lastContact, now) === undefined || daysAgo(l.lastContact, now)! >= 7));
  if (staleProposals.length > 0)
    bottlenecks.push({ id: "stale-proposals", title: "Proposals without recent activity", evidence: `${staleProposals.length} lead${staleProposals.length === 1 ? "" : "s"} with a proposal sent ${staleProposals.length === 1 ? "has" : "have"} no recorded contact in 7+ days (${staleProposals.slice(0, 3).map((l) => l.name).join(", ")}).`, why: "An unanswered proposal usually needs a nudge — silence rarely means a yes is coming.", nextStep: `Check in with ${staleProposals[0]!.name} about the quotation.`, leadId: staleProposals[0]!.id });
  if (m.cohort >= 10 && m.winRate !== null && m.winRate < 0.1)
    bottlenecks.push({ id: "low-conversion", title: "Low observed Lead-to-Won conversion", evidence: `${m.cohortWon} of ${m.cohort} leads you created in this period are Won (${pct(m.winRate)}).`, why: "With a meaningful sample, a low rate can point at qualification or follow-through — this correlation alone doesn't prove the cause.", nextStep: "Review a few recent Lost leads for a common objection." });
  const insufficient = m.calls + m.followUpsCompleted + m.leadsCreated + m.dealsWon === 0;

  // ---- Recommendations (max 3, prioritized; open existing workflows only) ----
  const recommendations: Recommendation[] = [];
  if (overdueFUs[0]) recommendations.push({ id: "rec-overdue", label: `Contact ${leadName(overdueFUs[0].leadId)}`, detail: `Follow-up overdue since ${dayKey(overdueFUs[0].dueAt)} — the longest waiting commitment.`, to: "lead", leadId: overdueFUs[0].leadId });
  if (qualifiedNoNext[0]) recommendations.push({ id: "rec-qualified", label: `Schedule the next step for ${qualifiedNoNext[0].name}`, detail: "Qualified leads without a follow-up stall — set the next conversation.", to: "lead", leadId: qualifiedNoNext[0].id });
  if (staleProposals[0]) recommendations.push({ id: "rec-proposal", label: `Review the proposal with ${staleProposals[0].name}`, detail: "Proposal sent with no recent recorded contact — a short check-in keeps it alive.", to: "lead", leadId: staleProposals[0].id });
  const todayCalls = input.followUps.filter((f) => isPending(f) && f.type === "call" && dayKey(f.dueAt) === dayKey(now) && f.dueAt >= nowIso);
  if (recommendations.length < 3 && todayCalls[0]) recommendations.push({ id: "rec-call", label: `Prepare for today's call with ${leadName(todayCalls[0].leadId)}`, detail: `Scheduled call at ${todayCalls[0].dueAt.slice(11, 16)} India time.`, to: "lead", leadId: todayCalls[0].leadId });
  if (recommendations.length < 3 && m.calls > 0 && m.calls < 3) recommendations.push({ id: "rec-consistency", label: "Improve daily call consistency", detail: `Only ${m.calls} call${m.calls === 1 ? "" : "s"} logged in this period — a steady daily block beats occasional bursts.`, to: "followups" });
  const recs = recommendations.slice(0, 3);

  // ---- Personal coach ----
  const wentWell: string[] = [];
  if (m.calls > 0) wentWell.push(`You logged ${m.calls} call${m.calls === 1 ? "" : "s"}${m.connected ? ` and connected ${m.connected}` : ""}.`);
  if (m.followUpsCompleted > 0) wentWell.push(`You completed ${m.followUpsCompleted} follow-up${m.followUpsCompleted === 1 ? "" : "s"} — commitments are being kept.`);
  if (m.dealsWon > 0) wentWell.push(`You won ${m.dealsWon} deal${m.dealsWon === 1 ? "" : "s"} in this period.`);
  if (m.leadsCreated > 0) wentWell.push(`You added ${m.leadsCreated} new lead${m.leadsCreated === 1 ? "" : "s"} to the pipeline.`);
  const needsAttention = bottlenecks.slice(0, 3).map((b) => `${b.title}: ${b.evidence}`);
  const nextMove = recs[0]?.label ?? null;

  // ---- My Suggested Plan (today, real recorded commitments only) ----
  const plan: PlanItem[] = [];
  for (const f of overdueFUs.slice(0, 2)) {
    const lead = input.leads.find((l) => l.id === f.leadId);
    if (!lead || lead.status === "won" || lead.status === "lost") continue;
    plan.push({ id: `plan-od-${f.id}`, label: `Overdue: ${f.type === "call" ? "call" : "follow up with"} ${lead.name}`, detail: `Was due ${dayKey(f.dueAt)} ${f.dueAt.slice(11, 16)}.`, leadId: lead.id, at: f.dueAt });
  }
  for (const f of input.followUps.filter((x) => isPending(x) && dayKey(x.dueAt) === dayKey(now) && x.dueAt >= nowIso).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 2)) {
    const lead = input.leads.find((l) => l.id === f.leadId);
    if (!lead || lead.status === "won" || lead.status === "lost") continue;
    plan.push({ id: `plan-td-${f.id}`, label: `${f.type === "call" ? "Call" : "Follow up with"} ${lead.name}`, detail: `Scheduled today at ${f.dueAt.slice(11, 16)} India time.`, leadId: lead.id, at: f.dueAt });
  }
  if (plan.length < 5 && qualifiedNoNext[0] && !plan.some((p) => p.leadId === qualifiedNoNext[0]!.id))
    plan.push({ id: "plan-q", label: `Set a next step for ${qualifiedNoNext[0].name}`, detail: "Qualified lead with no pending follow-up.", leadId: qualifiedNoNext[0].id });
  const todaysPlan = plan.slice(0, 5);

  // ---- Comparison with the previous equivalent period ----
  const prevEvents = prev.calls + prev.followUpsCompleted + prev.leadsCreated + prev.dealsWon;
  const comparison: CoachReport["comparison"] = prevEvents === 0
    ? { available: false, reason: "The previous equivalent period has no recorded activity, so no comparison is shown.", lines: [] }
    : {
        available: true,
        lines: [
          `Calls: ${m.calls} vs ${prev.calls} in the previous period.`,
          `Connection rate: ${pct(m.connectionRate)} vs ${pct(prev.connectionRate)}.`,
          `Follow-ups completed: ${m.followUpsCompleted} vs ${prev.followUpsCompleted}.`,
          `Deals won: ${m.dealsWon} vs ${prev.dealsWon}.`,
        ],
      };

  // ---- Targets ----
  const idx = indexEvents(input.events, false);
  const goals = goalsFor(input.goals, "owner").filter((g) => g.status !== "archived" && visibleGoal(g, true));
  const targetLines = goals.map((g) => {
    const p = goalProgress(g, input.goalRevisions, "owner", idx, dayKey(now), { employees: input.employees, payments: input.payments });
    const actual = p.actual === null ? "not measurable yet" : `${p.actual} of ${p.target}`;
    return `${g.name}: ${actual} (${PROGRESS_LABEL[p.status]}).`;
  });

  return {
    label: COACH_LABEL,
    window: w, prevWindow: prevW, lastDataAt, metrics: m,
    summary: { calls: m.calls, connected: m.connected, followUpsCompleted: m.followUpsCompleted, overdue: m.overdue, leadsCreated: m.leadsCreated, dealsWon: m.dealsWon, attentionLeads: attention },
    focus: recs[0]?.label ?? null,
    bottlenecks, insufficient, recommendations: recs,
    coach: { wentWell, needsAttention, nextMove },
    plan: todaysPlan,
    comparison,
    targets: { configured: goals.length > 0, lines: targetLines },
  };
}

/** Request/response contract for the future secure provider — the UI already speaks this shape. */
export interface CoachRequest { window: Window; at: string }
export interface CoachResponse { report: CoachReport; simulated: true; providerLabel: string }
export function requestCoachReport(input: CoachInput, req: CoachRequest, now: Date): CoachResponse {
  return { report: buildCoachReport(input, req.window, now), simulated: true, providerLabel: COACH_LABEL };
}

// Re-export for the UI's metric reconciliation (single source of truth).
export { metricValue };
