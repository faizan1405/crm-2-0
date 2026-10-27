import { toast } from "sonner";
import { followUpFeedback, voidFeedback, isStaleError, type FollowUpOutcome, type VoidResult } from "@/lib/crm/crossTab";
import { isPersistError } from "@/lib/crm/persistStatus";

/** Runs a follow-up action and shows exactly one honest message. Returns true only when the change was saved. */
export function runFollowUp(run: () => FollowUpOutcome, successText?: string): boolean {
  try {
    const fb = followUpFeedback(run());
    if (fb.ok) toast.success(successText ?? fb.text); else toast.warning(fb.text);
    return fb.ok;
  } catch (e) {
    if (isStaleError(e)) { toast.error(e.message); return false; }
    if (isPersistError(e)) return false; // storage message already shown
    throw e;
  }
}

export function runVoid(run: () => VoidResult): boolean {
  try {
    const fb = voidFeedback(run());
    if (fb.ok) toast.success(fb.text); else toast.warning(fb.text);
    return fb.ok;
  } catch (e) {
    if (isPersistError(e)) return false;
    throw e;
  }
}

/** Runs an edit that may be refused as stale; shows the conflict message once. Returns `undefined` when nothing was saved. */
export function runGuarded<T>(run: () => T): { value: T } | undefined {
  try { return { value: run() }; }
  catch (e) {
    if (isStaleError(e)) { toast.error(e.message); return undefined; }
    if (isPersistError(e)) return undefined;
    throw e;
  }
}
