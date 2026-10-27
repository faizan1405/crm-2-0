// Multi-tab safety helpers (pure). Two tabs share one localStorage blob; these rules decide when an edit is stale
// and which fields a draft actually changed, so a stale tab never writes untouched (older) values back.

/** Revision of a record = its last update time (falls back to creation time). */
export const revisionOf = (r: { updatedAt?: string; createdAt?: string } | undefined): string => r?.updatedAt ?? r?.createdAt ?? "";

export class StaleRecordError extends Error {
  readonly stale = true;
  constructor(readonly recordId: string) {
    super("This lead was updated in another tab. Review the latest changes before saving.");
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
