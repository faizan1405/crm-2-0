import { toast } from "sonner";
import { followUpFeedback, voidFeedback, isStaleError, type FollowUpResult, type VoidResult } from "@/lib/crm/crossTab";
import { isPersistError } from "@/lib/crm/persistStatus";

/** Runs a follow-up action and shows exactly one honest message. Returns true only when the change was saved. */
export function runFollowUp(run: () => FollowUpResult, successText?: string): boolean {
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
