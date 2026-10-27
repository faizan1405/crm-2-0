// Multi-tab safety helpers (pure). Two tabs share one localStorage blob; these rules decide when an edit is stale
// and which fields a draft actually changed, so a stale tab never writes untouched (older) values back.

/** Revision of a record = its last update time (falls back to creation time). */
export const revisionOf = (r: { updatedAt?: string; createdAt?: string } | undefined): string => r?.updatedAt ?? r?.createdAt ?? "";

export const STALE_MESSAGE = {
  lead: "This lead was updated in another tab. Review the latest changes before saving.",
  followup: "This follow-up was updated in another tab. Review the latest schedule before saving.",
  payment: "This payment was changed in another tab. Reload the latest information before continuing.",
} as const;
export class StaleRecordError extends Error {
  readonly stale = true;
  constructor(readonly recordId: string, readonly kind: keyof typeof STALE_MESSAGE = "lead") {
    super(STALE_MESSAGE[kind]);
    this.name = "StaleRecordError";
  }
}
export const isStaleError = (e: unknown): e is StaleRecordError => !!e && typeof e === "object" && (e as { stale?: unknown }).stale === true;

type Form = Record<string, string>;
/** Keys the user changed in the draft compared with the values the form started from. */
export const changedKeys = (start: Form, draft: Form): string[] => Object.keys(draft).filter((k) => draft[k] !== start[k]);
/** Keys someone else changed since the form started (start → latest persisted). */
export const externalKeys = (start: Form, latest: Form): string[] => Object.keys(latest).filter((k) => latest[k] !== start[k]);
/** Keep my draft: take the latest value for every field the user did not touch; keep the user's typed values. */
export function rebaseDraft(start: Form, draft: Form, latest: Form): Form {
  const out: Form = { ...draft };
  for (const k of Object.keys(latest)) if (draft[k] === start[k]) out[k] = latest[k]!;
  return out;
}

export type VoidResult = "voided" | "already" | "missing" | undefined;
/** undefined = refused (e.g. no permission in Employee Preview). */
export type FollowUpOutcome = "completed" | "rescheduled" | "already" | "closed" | "missing" | "invalid" | undefined;
/** One feedback line per outcome, so the UI never shows success for an action that did not happen. */
export function followUpFeedback(r: FollowUpOutcome): { ok: boolean; text: string } {
  switch (r) {
    case "completed": return { ok: true, text: "Follow-up completed" };
    case "rescheduled": return { ok: true, text: "Follow-up rescheduled" };
    case "already": return { ok: false, text: "This follow-up was already completed in another tab — nothing changed." };
    case "closed": return { ok: false, text: "This follow-up was replaced in another tab — nothing changed." };
    case "missing": return { ok: false, text: "This follow-up no longer exists — nothing changed." };
    case "invalid": return { ok: false, text: "Choose a valid date and time" };
    default: return { ok: false, text: "You don't have permission to change follow-ups." };
  }
}
export function voidFeedback(r: VoidResult): { ok: boolean; text: string } {
  if (r === "voided") return { ok: true, text: "Payment voided" };
  if (r === "already") return { ok: false, text: "This payment was already voided in another tab — totals unchanged." };
  if (r === "missing") return { ok: false, text: "This payment no longer exists — nothing changed." };
  return { ok: false, text: "You don't have permission to void payments." };
}
