// In-memory hand-off of a reviewable note draft from Sales Coach to one Lead's note editor.
// Never persisted, never saved as a note — the editor takes it once and the Owner decides.
import { create } from "zustand";

export const useNoteDrafts = create<{ drafts: Record<string, string> }>(() => ({ drafts: {} }));
export const offerNoteDraft = (leadId: string, text: string) => useNoteDrafts.setState((s) => ({ drafts: { ...s.drafts, [leadId]: text } }));
/** Returns and removes the pending draft for exactly this lead (other leads' drafts untouched). */
export function takeNoteDraft(leadId: string): string | undefined {
  const d = useNoteDrafts.getState().drafts[leadId];
  if (d === undefined) return undefined;
  useNoteDrafts.setState((s) => { const { [leadId]: _, ...rest } = s.drafts; return { drafts: rest }; });
  return d;
}
