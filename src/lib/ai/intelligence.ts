// AI-2 Lead Intelligence — deterministic Demo Analysis over permission-filtered LeadContext.
// Pure: same input → same output. Rules are readable; no scores, no network, no CRM writes.
// Quoted/budget value is never treated as buying intent.
import type { LeadContext } from "./types";

export type Attention = "high" | "medium" | "low" | "insufficient";
export const ATTENTION_LABEL: Record<Attention, string> = { high: "High attention", medium: "Medium attention", low: "Low attention", insufficient: "Insufficient information" };

export type NBAKind = "call" | "schedule_followup" | "qualify" | "prepare_quotation" | "review_history" | "none";
export interface NextAction { kind: NBAKind; label: string; why: string }
export interface Signal { id: string; text: string; tone: "risk" | "positive" | "info" }
export interface LeadIntelligence {
  summary: string;
  facts: { label: string; value: string }[];
  attention: Attention;
  attentionWhy: string[];
  signals: Signal[];
  intent: string[];
  missing: string[];
  primary: NextAction;
  alternatives: NextAction[];
}

export const NOT_ENOUGH = "Not enough information";
const DAY = 86_400_000;
const STALL_DAYS = 7;
const INTEREST = /\b(interested|keen|wants?|asked (for|about)|send (me )?(the )?(quote|quotation|proposal|price|details)|ready|budget approved|call back|let'?s proceed|go ahead)\b/i;

const daysSince = (iso: string | undefined, now: Date) => (iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : null);
const ago = (d: number) => (d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`);

export function analyzeLead(l: LeadContext, now = new Date()): LeadIntelligence {
  const f = l.facts;
  const sinceAct = daysSince(f.lastActivityAt, now);
  const signals: Signal[] = [];
  const intent: string[] = [];
  const missing: string[] = [];

  if (!l.requirement) missing.push("What they need (requirement)");
  if (!f.hasEmail) missing.push("Email address");
  if (!l.company) missing.push("Company / business name");
  if (l.money && l.money.quotedOrBudget === undefined && ["qualified", "proposal"].includes(f.statusKey)) missing.push("Budget or quoted amount");
  if (f.connectedCalls === 0 && !f.lastInteraction) missing.push("Any recorded conversation");

  if (f.statusKey === "won") signals.push({ id: "won", text: "Stage is Won.", tone: "positive" });
  if (f.statusKey === "lost") signals.push({ id: "lost", text: `Stage is Lost${f.lostReason ? ` — reason: ${f.lostReason}` : ""}.`, tone: "info" });
  if (f.overdueFollowUp) signals.push({ id: "overdue", text: "A follow-up is overdue.", tone: "risk" });
  if (f.callAttempts > 0 && f.connectedCalls === 0) signals.push({ id: "no_contact", text: `No successful contact yet (${f.callAttempts} call attempt${f.callAttempts === 1 ? "" : "s"}).`, tone: "risk" });
  else if (f.callAttempts === 0 && !f.lastInteraction && !["won", "lost"].includes(f.statusKey)) signals.push({ id: "never", text: "No contact recorded yet.", tone: "risk" });
  if (f.unsuccessfulStreak >= 2) signals.push({ id: "repeat_fail", text: `${f.unsuccessfulStreak} unsuccessful call attempts in a row.`, tone: "risk" });
  if (f.statusKey === "qualified" && !f.nextFollowUpDue) signals.push({ id: "qual_no_next", text: "Qualified, but no next follow-up is booked.", tone: "risk" });
  if (f.statusKey === "proposal" && (sinceAct === null || sinceAct >= STALL_DAYS)) signals.push({ id: "proposal_stall", text: sinceAct === null ? "Proposal sent, no activity recorded since." : `Proposal sent, last activity ${ago(sinceAct)}.`, tone: "risk" });
  if (l.clientNotes && INTEREST.test(l.clientNotes)) { signals.push({ id: "interest", text: "Client notes record interest.", tone: "positive" }); intent.push("Interest is written in the client notes."); }
  const interestAct = l.recentActivity.find((t) => INTEREST.test(t));
  if (interestAct) intent.push(`Recent history: “${interestAct.slice(0, 90)}”.`);
  if (f.connectedCalls > 0) intent.push(`${f.connectedCalls} connected call${f.connectedCalls === 1 ? "" : "s"} recorded.`);
  if (f.statusKey === "proposal" || f.statusKey === "qualified") intent.push(`Reached the ${l.stage} stage.`);

  const has = (id: string) => signals.some((s) => s.id === id);
  const closed = f.statusKey === "won" || f.statusKey === "lost";
  const thin = !l.requirement && !f.lastInteraction && f.callAttempts === 0 && !l.clientNotes;

  let attention: Attention; const why: string[] = [];
  if (closed) { attention = "low"; why.push(f.statusKey === "won" ? "Already won — selling is finished." : "Marked lost."); }
  else if (has("overdue") || has("qual_no_next") || has("proposal_stall")) { attention = "high"; why.push(...signals.filter((s) => ["overdue", "qual_no_next", "proposal_stall"].includes(s.id)).map((s) => s.text)); }
  else if (thin && f.statusKey !== "new") { attention = "insufficient"; why.push("Too little is recorded to judge this lead."); }
  else if (has("never") || has("no_contact") || has("repeat_fail") || has("interest")) { attention = "medium"; why.push(...signals.filter((s) => ["never", "no_contact", "repeat_fail", "interest"].includes(s.id)).map((s) => s.text)); }
  else if (thin) { attention = "insufficient"; why.push("Too little is recorded to judge this lead."); }
  else { attention = "low"; why.push(f.nextFollowUpDue ? "A follow-up is already booked and nothing is overdue." : "No warning signs in the recorded history."); }

  const A = {
    call: (why: string): NextAction => ({ kind: "call", label: "Call the lead", why }),
    fu: (why: string): NextAction => ({ kind: "schedule_followup", label: "Schedule a follow-up", why }),
    qualify: (why: string): NextAction => ({ kind: "qualify", label: "Ask a qualification question", why }),
    quote: (why: string): NextAction => ({ kind: "prepare_quotation", label: "Prepare a quotation", why }),
    review: (why: string): NextAction => ({ kind: "review_history", label: "Review previous conversation", why }),
    none: (why: string): NextAction => ({ kind: "none", label: "No action currently needed", why }),
  };
  let primary: NextAction; const alt: NextAction[] = [];
  if (f.statusKey === "won") { primary = A.none("The lead is already Won; delivery and payments are handled in Deals and Project Desk."); alt.push(A.review("Check the history if a handover question comes up.")); }
  else if (f.statusKey === "lost") { primary = A.none("The lead is marked Lost."); alt.push(A.review("Review the history before deciding to re-open it.")); }
  else if (has("overdue")) { primary = A.call("A follow-up is overdue — contacting them now keeps the promise you made."); alt.push(A.fu("If you can't call now, reschedule so it isn't forgotten.")); }
  else if (has("repeat_fail")) { primary = A.fu(`${f.unsuccessfulStreak} calls in a row weren't answered — try a different time or channel instead of calling again right away.`); alt.push(A.review("Check earlier notes for a better time to reach them.")); }
  else if (has("proposal_stall")) { primary = A.call("The proposal has gone quiet — a short check-in call shows whether they're still deciding."); alt.push(A.fu("Book a follow-up so the proposal doesn't drift.")); }
  else if (has("qual_no_next")) { primary = A.fu("They're qualified but nothing is booked, so the next step could be missed."); alt.push(A.quote("If the requirement is clear, a quotation moves things forward.")); }
  else if (has("never") || has("no_contact")) { primary = A.call("No conversation is recorded yet — a first call is the quickest way to learn what they need."); if (!l.requirement) alt.push(A.qualify("The requirement isn't recorded.")); }
  else if (!l.requirement) { primary = A.qualify("The requirement isn't recorded, so any recommendation would be a guess."); }
  else if (f.statusKey === "qualified") { primary = A.quote("They're qualified, a follow-up is booked and the requirement is known."); alt.push(A.review("Check the last conversation before writing the quotation.")); }
  else if (f.nextFollowUpDue) { primary = A.none("A follow-up is already booked and nothing is overdue."); alt.push(A.review("Review the last conversation before the follow-up.")); }
  else { primary = A.fu("No next step is booked."); }
  if (!closed && missing.length && primary.kind !== "qualify" && alt.length < 2) alt.push(A.qualify(`Missing: ${missing[0]}.`));

  const factsOut = [
    { label: "Stage", value: l.stage },
    { label: "Manual priority", value: l.priority },
    { label: "Latest interaction", value: f.lastInteraction ? `${f.lastInteraction.text} (${ago(daysSince(f.lastInteraction.at, now) ?? 0)})` : NOT_ENOUGH },
    { label: "Follow-up", value: f.nextFollowUpDue ? (f.overdueFollowUp ? "Overdue" : "Booked") : "None booked" },
    { label: "Calls", value: f.callAttempts ? `${f.connectedCalls} connected of ${f.callAttempts}` : "None recorded" },
  ];
  if (l.money) factsOut.push({ label: "Opportunity", value: l.money.quotedOrBudget !== undefined ? `₹${l.money.quotedOrBudget.toLocaleString("en-IN")} quoted/budget` : NOT_ENOUGH });

  const summary = `${l.name}${l.company ? ` (${l.company})` : ""} — ${l.stage}, from ${l.source}. ${l.requirement ? `Needs: ${l.requirement}.` : "Requirement: not recorded."}`;
  return { summary, facts: factsOut, attention, attentionWhy: why, signals, intent: intent.length ? intent : [NOT_ENOUGH], missing, primary, alternatives: alt.slice(0, 2) };
}
