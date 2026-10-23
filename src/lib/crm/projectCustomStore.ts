// Phase 3G.1.1 — Project custom fields and Project tags, merged into the single CRM store.
// Same write rules as Lead fields/tags (applyFieldSave / applyFieldValues / bulkTag / undoTags from customize.ts);
// values and tags are keyed by project id in their own maps, so Leads are never touched.
import { applyFieldSave, applyFieldValues, bulkTag, tagForProjects, undoTags, type CustomFieldDef, type FieldValues, type TagDef, type Viewer } from "./customize";
import type { ProjectTags } from "./projectCustomize";
import { canSeeProject, type Project } from "./projects";
import { projectViewer } from "./projectStore";
import { pauseRulesUsing, type AutomationRule } from "./automation";

export interface ProjectCustomSlice {
  projectFields: CustomFieldDef[];
  projectFieldValues: FieldValues;
  projectTags: ProjectTags;
  saveProjectField: (def: CustomFieldDef) => string | null;
  /** Archiving keeps every stored value and pauses enabled Project rules that rely on the field. */
  setProjectFieldStatus: (id: string, status: CustomFieldDef["status"]) => { paused: string[] };
  moveProjectField: (id: string, dir: -1 | 1) => void;
  setProjectFieldValues: (projectId: string, input: Record<string, unknown>, opts?: { isNew?: boolean }) => { ok: true; needs: string[] } | { ok: false; errors: Record<string, string> };
  setProjectTags: (projectId: string, tagIds: string[]) => boolean;
  bulkTagProjects: (ids: string[], tagId: string, mode: "add" | "remove") => { changed: number; before: Record<string, string[] | undefined>; applied: Record<string, string[]> };
  undoBulkProjectTags: (before: Record<string, string[] | undefined>, applied: Record<string, string[]>) => { restored: number; kept: number };
}

type S = ProjectCustomSlice & { projects: Project[]; tagDefs: TagDef[]; automationRules: AutomationRule[] };

/** Field-level viewer for Project values: employees edit team fields only with Project edit permission. */
export function projectFieldViewer(): Viewer {
  const v = projectViewer();
  return v.owner ? { owner: true } : { owner: false, employeeId: v.employeeId ?? "", canEdit: v.can("projects.edit") };
}

export function createProjectCustomSlice(set: (p: Partial<S> | ((s: S) => Partial<S>)) => void, get: () => S): ProjectCustomSlice {
  const editable = (id: string) => { const p = get().projects.find((x) => x.id === id); const v = projectViewer(); return p && canSeeProject(p, v) && (v.owner || v.can("projects.edit")) ? p : undefined; };
  return {
    projectFields: [], projectFieldValues: {}, projectTags: {},
    saveProjectField: (input) => {
      const st = get(); const r = applyFieldSave({ ...input, entity: "project" }, st.projectFields, st.projectFieldValues, new Date().toISOString());
      if ("error" in r) return r.error;
      set({ projectFields: r.defs, projectFieldValues: r.values }); return null;
    },
    setProjectFieldStatus: (id, status) => {
      const at = new Date().toISOString(); const st = get();
      const f = st.projectFields.find((x) => x.id === id); if (!f || f.status === status) return { paused: [] };
      const r = status === "archived" ? pauseRulesUsing(st.automationRules, "project", (c) => c.field === `cf:${id}`, `“${f.label}” was archived`, at) : { rules: st.automationRules, paused: [] };
      set({ automationRules: r.rules, projectFields: st.projectFields.map((x) => (x.id === id ? { ...x, status, updatedAt: at, version: x.version + 1, history: [...x.history, { at, change: status === "archived" ? "Archived (values kept)" : "Restored" }] } : x)) });
      return { paused: r.paused };
    },
    moveProjectField: (id, dir) => set((s) => { const l = [...s.projectFields].sort((a, b) => a.order - b.order); const i = l.findIndex((f) => f.id === id), j = i + dir; if (i < 0 || j < 0 || j >= l.length) return {}; [l[i], l[j]] = [l[j]!, l[i]!]; return { projectFields: l.map((f, k) => ({ ...f, order: k })) }; }),
    setProjectFieldValues: (projectId, input, opts) => {
      if (!editable(projectId)) return { ok: false, errors: { _: "You can't edit this project." } };
      const st = get(); const r = applyFieldValues(st.projectFields, st.projectFieldValues[projectId] ?? {}, input, projectFieldViewer(), !!opts?.isNew);
      if (!r.ok) return r;
      set((s) => ({ projectFieldValues: { ...s.projectFieldValues, [projectId]: r.row } }));
      return { ok: true, needs: r.needs };
    },
    setProjectTags: (projectId, tagIds) => {
      if (!editable(projectId)) return false;
      const st = get(); const known = new Map(st.tagDefs.map((t) => [t.id, t])); const cur = st.projectTags[projectId] ?? [];
      const next = [...new Set(tagIds)].filter((id) => known.has(id) && (cur.includes(id) || (known.get(id)!.status === "active" && tagForProjects(known.get(id)!))));
      set((s) => ({ projectTags: { ...s.projectTags, [projectId]: next } }));
      return true;
    },
    bulkTagProjects: (ids, tagId, mode) => {
      const st = get(); const tag = st.tagDefs.find((t) => t.id === tagId);
      if (!tag || (mode === "add" && (tag.status !== "active" || !tagForProjects(tag)))) return { changed: 0, before: {}, applied: {} };
      const live = new Set(st.projects.map((p) => p.id));
      const r = bulkTag(st.projectTags, ids.filter((id) => live.has(id)), tagId, mode);
      if (r.changed) set({ projectTags: r.next });
      return { changed: r.changed, before: r.before, applied: r.applied };
    },
    undoBulkProjectTags: (before, applied) => { const r = undoTags(get().projectTags, before, applied); if (r.restored) set({ projectTags: r.next }); return { restored: r.restored, kept: r.kept }; },
  };
}

/** v9: Project fields, values and tags start empty. Every earlier record is untouched. */
export function migrateProjectCustom(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 9) return state;
  return { ...state, projectFields: state["projectFields"] ?? [], projectFieldValues: state["projectFieldValues"] ?? {}, projectTags: state["projectTags"] ?? {} };
}
