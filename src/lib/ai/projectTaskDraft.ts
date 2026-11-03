// In-memory hand-off of one reviewable task draft from AI Assist to the existing Add Task form.
// Never persisted, never creates a task; keyed by project so switching projects can't leak drafts.
import { create } from "zustand";

export interface TaskDraft { projectId: string; title: string; reason: string }
interface S { draft: TaskDraft | null; set: (d: TaskDraft) => void; take: (projectId: string) => TaskDraft | null; clear: () => void }
export const useProjectTaskDraft = create<S>((set, get) => ({
  draft: null,
  set: (d) => set({ draft: d }),
  take: (projectId) => { const d = get().draft; if (!d || d.projectId !== projectId) return null; set({ draft: null }); return d; },
  clear: () => set({ draft: null }),
}));
