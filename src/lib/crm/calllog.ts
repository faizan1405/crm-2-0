// Pure rules for the post-call quick log.
import { dayKey } from "./format";
import { shiftDay, businessDateTime } from "./dates";
import type { LeadStatus } from "./types";

export const CALL_OUTCOMES = ["Connected", "Not picked", "Busy", "Call back later", "Interested", "Not interested", "Qualified", "Proposal Sent", "Won", "Lost"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Outcomes that imply a stage; others keep the lead's current stage. */
export function outcomeStage(outcome: CallOutcome, current: LeadStatus): LeadStatus {
  const map: Partial<Record<CallOutcome, LeadStatus>> = { Qualified: "qualified", "Proposal Sent": "proposal", Won: "won", Lost: "lost", "Not interested": "lost" };
  if (map[outcome]) return map[outcome]!;
  if ((outcome === "Connected" || outcome === "Interested") && current === "new") return "contacted";
  return current;
}

export const DATE_SHORTCUTS = ["Tonight", "Tomorrow", "After 2 days", "Next week"] as const;
export type DateShortcut = (typeof DATE_SHORTCUTS)[number];

/** Returns a business-time (IST) datetime-local value "YYYY-MM-DDTHH:mm". */
export function shortcutValue(s: DateShortcut, now = new Date()): string {
  const today = dayKey(now);
  if (s === "Tonight") return `${today}T19:00`;
  const days = s === "Tomorrow" ? 1 : s === "After 2 days" ? 2 : 7;
  return `${shiftDay(today, days)}T11:00`;
}

export const toISO = businessDateTime;

/** Not picked / Busy are attempts only — they never count as a successful contact. */
export function isConnectedOutcome(o: CallOutcome): boolean {
  return o !== "Not picked" && o !== "Busy";
}

/** Moving to Won or Lost from a call needs an explicit confirmation step. */
export function needsStageConfirm(stage: LeadStatus, current: LeadStatus): boolean {
  return stage !== current && (stage === "won" || stage === "lost");
}

/** Returns a blocking message for the call log, or null when it can be saved. */
export function callLogError(input: { outcome: CallOutcome | null; stage: LeadStatus; current: LeadStatus; confirmed: boolean; lostReason: string }): string | null {
  if (!input.outcome) return "Pick a call outcome";
  if (needsStageConfirm(input.stage, input.current) && !input.confirmed) return "Confirm the stage change";
  if (input.stage === "lost" && input.stage !== input.current && !input.lostReason.trim()) return "Add a lost reason";
  return null;
}
