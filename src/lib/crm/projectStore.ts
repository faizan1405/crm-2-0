// Phase 3G.1 — Project Desk store slice. Merged into the single CRM store (store.ts); rules stay in pure projects.ts.
import { uid, dayKey } from "./format";
import { activePreview, allows } from "./session";
import { StaleRecordError } from "./crossTab";
import {
  applyStatus, canCompleteTask, canEditTask, canSeeProject, canUndo, deliveryError, deliveryGaps, draftFromDeal, activeProjectForDeal,
  looksLikeSecret, projectError, starterTemplates, supportError, PROJECT_SCHEMA, SECRET_ERROR, STAGE_TEXT, STATUS_TEXT,
  type CheckItem, type DeliverInput, type Project, type ProjectMilestone, type ProjectPriority, type ProjectStage, type ProjectStatus,
  type ProjectSupport, type ProjectTask, type ProjectTemplate, type ProjectViewer, type SupportRequest,
} from "./projects";

export type NewProject = ReturnType<typeof draftFromDeal>;
export type CheckList = "requirements" | "qa" | "handover";
export interface TaskInput { title: string; milestoneId?: string | undefined; assigneeId?: string | null; dueDate?: string | undefined; priority?: ProjectPriority; notes?: string | undefined }
export type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; existingId?: string };

export interface ProjectSlice {
  projects: Project[];
  projectTasks: ProjectTask[];
  projectMilestones: ProjectMilestone[];
  supportRequests: SupportRequest[];
  projectTemplates: ProjectTemplate[];
  /** Owner-confirmed handoff. Refuses a second active project for the same deal unless `allowAnother` is set explicitly. */
  createProject: (draft: NewProject, plan?: { milestones?: string[]; tasks?: { title: string; milestone?: string }[]; allowAnother?: boolean }) => Res<{ id: string }>;
  updateProject: (id: string, patch: Partial<Project>, note?: string) => string | null;
  setProjectStatus: (id: string, status: ProjectStatus) => void;
  /** Returns the version after the move, used for safe Undo. */
  /** `from` = stage the user saw; if another tab moved the project since, throws StaleRecordError (nothing saved). */
  moveProjectStage: (id: string, stage: ProjectStage, from?: ProjectStage) => { from: ProjectStage; version: number } | null;
  undoProjectStage: (id: string, to: ProjectStage, expectedVersion: number) => boolean;
  /** Returns false when the project is already in that state (e.g. archived from another tab) — no duplicate history. */
  archiveProject: (id: string, archived: boolean) => boolean;
  addProjectNote: (id: string, text: string) => string | null;
  addTask: (projectId: string, t: TaskInput) => Res<{ id: string }>;
  /** `baseVersion` = task version the form started from; a newer saved version throws StaleRecordError (nothing saved). */
  updateTask: (id: string, patch: Partial<TaskInput>, baseVersion?: number) => string | null;
  setTaskDone: (id: string, done: boolean) => boolean;
  moveTask: (id: string, dir: -1 | 1) => void;
  addMilestone: (projectId: string, title: string, dueDate?: string) => string | null;
  toggleCheck: (projectId: string, list: CheckList, itemId: string) => void;
  addCheck: (projectId: string, list: CheckList, label: string) => string | null;
  addDependency: (projectId: string, label: string) => string | null;
  toggleDependency: (projectId: string, depId: string) => void;
  addProjectLink: (projectId: string, label: string, url: string) => string | null;
  deliverProject: (id: string, d: DeliverInput) => string | null;
  saveSupport: (id: string, s: ProjectSupport) => string | null;
  addSupportRequest: (r: Omit<SupportRequest, "id" | "createdAt" | "updatedAt" | "version" | "status" | "coverage"> & { coverage?: SupportRequest["coverage"] }) => Res<{ id: string }>;
  updateSupportRequest: (id: string, patch: Partial<Pick<SupportRequest, "status" | "resolution" | "assigneeId" | "priority" | "dueDate" | "coverage">>) => string | null;
  saveProjectTemplate: (t: ProjectTemplate) => string | null;
}

/** The current actor as seen by Project Desk rules. */
export function projectViewer(): ProjectViewer {
  const pv = activePreview();
  if (!pv) return { owner: true, can: () => true, financeAmounts: true };
  return { owner: false, employeeId: pv.employeeId, can: (p) => allows(pv, p), financeAmounts: pv.finance === "amounts" || pv.finance === "manage" };
}
const actorId = () => activePreview()?.employeeId ?? "owner";
const today = () => dayKey(new Date());
const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

type S = ProjectSlice & { deals: { id: string }[] };
export function createProjectSlice(set: (fn: (s: S) => Partial<S>) => void, get: () => S): ProjectSlice {
  const now = () => new Date().toISOString();
  const findP = (id: string) => get().projects.find((p) => p.id === id);
  const visible = (id: string) => { const p = findP(id); return p && canSeeProject(p, projectViewer()) ? p : undefined; };
  const edit = (id: string, fn: (p: Project) => Partial<Project>, change?: string) => set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, ...fn(p), updatedAt: now(), version: p.version + 1, history: change ? [...p.history, { at: now(), by: actorId(), change }].slice(-200) : p.history } : p)),
  }));
  const editTask = (id: string, fn: (t: ProjectTask) => Partial<ProjectTask>, change: string) => set((s) => ({
    projectTasks: s.projectTasks.map((t) => (t.id === id ? { ...t, ...fn(t), updatedAt: now(), version: t.version + 1, history: [...t.history, { at: now(), by: actorId(), change }].slice(-50) } : t)),
  }));
  return {
    projects: [], projectTasks: [], projectMilestones: [], supportRequests: [], projectTemplates: starterTemplates(new Date(0).toISOString()),
    createProject: (draft, plan = {}) => {
      const err = projectError(draft);
      if (err) return { ok: false, error: err };
      if (draft.dealId) {
        const ex = activeProjectForDeal(get().projects, draft.dealId);
        if (ex && !plan.allowAnother) return { ok: false, error: `“${ex.name}” is already active for this deal.`, existingId: ex.id };
      }
      const id = uid("prj"), at = now();
      const ms: ProjectMilestone[] = (plan.milestones ?? []).filter((m) => m.trim()).map((title, i) => ({ id: uid("ms"), projectId: id, title: title.trim(), order: i }));
      const msId = (name?: string) => ms.find((m) => m.title === name)?.id;
      const tasks: ProjectTask[] = (plan.tasks ?? []).filter((t) => t.title.trim()).map((t, i) => ({ id: uid("task"), projectId: id, milestoneId: msId(t.milestone), title: t.title.trim(), assigneeId: null, priority: "normal", status: "open", order: i, history: [{ at, by: actorId(), change: "Created from template" }], createdAt: at, updatedAt: at, version: 1 }));
      const p: Project = { ...draft, id, createdAt: at, updatedAt: at, version: 1, schema: PROJECT_SCHEMA, history: [{ at, by: actorId(), change: `Project created${draft.dealId ? " from deal" : ""} · ${STATUS_TEXT[draft.status]}` }] };
      set((s) => ({ projects: [p, ...s.projects], projectMilestones: [...s.projectMilestones, ...ms], projectTasks: [...s.projectTasks, ...tasks] }));
      return { ok: true, id };
    },
    updateProject: (id, patch, note) => {
      const p = visible(id); if (!p) return "Project not found.";
      const next = { ...p, ...patch };
      const err = projectError(next); if (err) return err;
      // Identity links never change through a general edit.
      const { id: _i, dealId: _d, leadId: _l, history: _h, version: _v, delivery: _dl, ...safe } = patch;
      edit(id, () => safe, note ?? "Details edited");
      return null;
    },
    setProjectStatus: (id, status) => { const p = visible(id); if (!p || p.status === status) return; edit(id, (x) => applyStatus(x, status, today()), `Status: ${STATUS_TEXT[p.status]} → ${STATUS_TEXT[status]}`); },
    moveProjectStage: (id, stage, from) => {
      const p = visible(id); if (!p) return null;
      if (from !== undefined && p.stage !== from) throw new StaleRecordError(id, "project");
      if (p.stage === stage) return null;
      if (stage === "delivered" && !p.delivery) return null; // delivery is recorded through the checklist, never by dragging
      edit(id, () => ({ stage }), `Stage: ${STAGE_TEXT[p.stage]} → ${STAGE_TEXT[stage]}`);
      return { from: p.stage, version: findP(id)!.version };
    },
    undoProjectStage: (id, to, expectedVersion) => {
      const p = findP(id); if (!canUndo(p, expectedVersion) || !p) return false;
      edit(id, () => ({ stage: to }), `Undo: stage back to ${STAGE_TEXT[to]}`);
      return true;
    },
    archiveProject: (id, archived) => {
      const p = findP(id); if (!p || !!p.archived === archived) return false;
      edit(id, () => ({ archived }), archived ? "Archived (records kept)" : "Restored from archive"); return true;
    },
    addProjectNote: (id, text) => {
      const p = visible(id); if (!p) return "Project not found."; if (!text.trim()) return "Write a note.";
      if (looksLikeSecret(text)) return SECRET_ERROR;
      edit(id, () => ({}), `Note: ${text.trim().slice(0, 500)}`); return null;
    },
    addTask: (projectId, t) => {
      const p = visible(projectId); if (!p) return { ok: false, error: "Project not found." };
      if (!t.title.trim()) return { ok: false, error: "Give the task a title." };
      if (looksLikeSecret(t.notes)) return { ok: false, error: SECRET_ERROR };
      const id = uid("task"), at = now(), order = get().projectTasks.filter((x) => x.projectId === projectId).length;
      const row: ProjectTask = { id, projectId, milestoneId: t.milestoneId, title: t.title.trim(), notes: t.notes, assigneeId: t.assigneeId ?? null, dueDate: t.dueDate, priority: t.priority ?? "normal", status: "open", order, history: [{ at, by: actorId(), change: "Created" }], createdAt: at, updatedAt: at, version: 1 };
      set((s) => ({ projectTasks: [...s.projectTasks, row] }));
      return { ok: true, id };
    },
    updateTask: (id, patch, baseVersion) => {
      const t = get().projectTasks.find((x) => x.id === id); const p = t && findP(t.projectId);
      if (!t || !p || !canEditTask(t, p, projectViewer())) return "You can't edit this task.";
      if (baseVersion !== undefined && t.version !== baseVersion) throw new StaleRecordError(id, "task");
      if (patch.title !== undefined && !patch.title.trim()) return "Give the task a title.";
      if (looksLikeSecret(patch.notes)) return SECRET_ERROR;
      const changes = [patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId ? `Reassigned from ${t.assigneeId ?? "nobody"} to ${patch.assigneeId ?? "nobody"}` : "", patch.dueDate !== undefined && patch.dueDate !== t.dueDate ? `Due ${patch.dueDate || "cleared"}` : ""].filter(Boolean);
      editTask(id, () => patch as Partial<ProjectTask>, changes.join(" · ") || "Edited");
      return null;
    },
    setTaskDone: (id, done) => {
      const t = get().projectTasks.find((x) => x.id === id); const p = t && findP(t.projectId);
      if (!t || !p || !canCompleteTask(t, p, projectViewer()) || (t.status === "done") === done) return false;
      editTask(id, () => (done ? { status: "done", completedAt: now(), completedBy: actorId() } : { status: "open", completedAt: undefined, completedBy: undefined }), done ? "Completed" : "Reopened");
      return true;
    },
    moveTask: (id, dir) => set((s) => {
      const t = s.projectTasks.find((x) => x.id === id); if (!t) return {};
      const list = s.projectTasks.filter((x) => x.projectId === t.projectId).sort((a, b) => a.order - b.order);
      const i = list.findIndex((x) => x.id === id), j = i + dir; if (j < 0 || j >= list.length) return {};
      const order = new Map(list.map((x, k) => [x.id, k])); order.set(id, j); order.set(list[j]!.id, i);
      return { projectTasks: s.projectTasks.map((x) => (order.has(x.id) ? { ...x, order: order.get(x.id)! } : x)) };
    }),
    addMilestone: (projectId, title, dueDate) => {
      if (!visible(projectId)) return "Project not found."; if (!title.trim()) return "Name the milestone.";
      set((s) => ({ projectMilestones: [...s.projectMilestones, { id: uid("ms"), projectId, title: title.trim(), ...(dueDate ? { dueDate } : {}), order: s.projectMilestones.filter((m) => m.projectId === projectId).length }] }));
      return null;
    },
    toggleCheck: (projectId, list, itemId) => {
      const p = visible(projectId); const item = p?.[list].find((c) => c.id === itemId); if (!p || !item) return;
      edit(projectId, (x) => ({ [list]: x[list].map((c: CheckItem) => (c.id === itemId ? { ...c, done: !c.done, doneAt: !c.done ? now() : undefined } : c)) }), `${item.done ? "Unchecked" : "Checked"}: ${item.label}`);
    },
    addCheck: (projectId, list, label) => {
      if (!visible(projectId)) return "Project not found."; if (!label.trim()) return "Write the item.";
      if (looksLikeSecret(label)) return SECRET_ERROR;
      edit(projectId, (x) => ({ [list]: [...x[list], { id: uid("chk"), label: label.trim(), done: false }] }), `Checklist item added: ${label.trim()}`); return null;
    },
    addDependency: (projectId, label) => {
      if (!visible(projectId)) return "Project not found."; if (!label.trim()) return "Describe what you're waiting for.";
      if (looksLikeSecret(label)) return SECRET_ERROR;
      edit(projectId, (x) => ({ dependencies: [...x.dependencies, { id: uid("dep"), label: label.trim(), done: false }] }), `Waiting on client: ${label.trim()}`); return null;
    },
    toggleDependency: (projectId, depId) => {
      const p = visible(projectId); const d = p?.dependencies.find((x) => x.id === depId); if (!p || !d) return;
      edit(projectId, (x) => ({ dependencies: x.dependencies.map((y) => (y.id === depId ? { ...y, done: !y.done, doneAt: !y.done ? now() : undefined } : y)) }), `${d.done ? "Reopened" : "Received"}: ${d.label}`);
    },
    addProjectLink: (projectId, label, url) => {
      if (!visible(projectId)) return "Project not found."; if (!URL_RE.test(url.trim())) return "Enter a full link starting with https://";
      if (/[?&](pass|password|token|key)=/i.test(url)) return SECRET_ERROR;
      edit(projectId, (x) => ({ links: [...x.links, { id: uid("lnk"), label: label.trim() || url.trim(), url: url.trim(), addedAt: now() }] }), `Reference added: ${label.trim() || url.trim()}`); return null;
    },
    deliverProject: (id, d) => {
      const p = visible(id); if (!p) return "Project not found.";
      if (p.delivery) return "Delivery is already recorded for this project.";
      const err = deliveryError(p, d); if (err) return err;
      const gaps = deliveryGaps(p);
      edit(id, () => ({ delivery: { date: d.date, url: d.url?.trim() || undefined, notes: d.notes?.trim() || undefined, deliveredBy: actorId(), approval: d.approval, override: gaps.length ? d.override!.trim() : undefined, incomplete: gaps }, stage: "delivered", status: "completed" }), gaps.length ? `Delivered with ${gaps.length} incomplete checklist item(s). Reason: ${d.override!.trim()}` : "Delivered — all checklist items complete");
      return null;
    },
    saveSupport: (id, sup) => {
      const p = visible(id); if (!p) return "Project not found.";
      const err = supportError(sup); if (err) return err;
      edit(id, (x) => ({ support: sup, stage: sup.included && x.delivery ? "support" : x.stage }), sup.included ? `Support configured: ${sup.start}${sup.end ? ` → ${sup.end}` : ""}` : sup.included === false ? "Support marked not included" : "Support cleared");
      return null;
    },
    addSupportRequest: (r) => {
      if (!visible(r.projectId)) return { ok: false, error: "Project not found." };
      if (!r.title.trim()) return { ok: false, error: "Give the request a title." };
      if (looksLikeSecret(r.description)) return { ok: false, error: SECRET_ERROR };
      const id = uid("sr"), at = now();
      set((s) => ({ supportRequests: [{ ...r, title: r.title.trim(), id, createdAt: at, updatedAt: at, version: 1, status: "open", coverage: r.coverage ?? "undecided" }, ...s.supportRequests] }));
      return { ok: true, id };
    },
    updateSupportRequest: (id, patch) => {
      const r = get().supportRequests.find((x) => x.id === id); if (!r || !visible(r.projectId)) return "Request not found.";
      if (looksLikeSecret(patch.resolution)) return SECRET_ERROR;
      if (patch.status === "resolved" && !(patch.resolution ?? r.resolution ?? "").trim()) return "Add resolution notes before resolving.";
      set((s) => ({ supportRequests: s.supportRequests.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.status === "resolved" && x.status !== "resolved" ? { resolvedAt: now() } : {}), updatedAt: now(), version: x.version + 1 } : x)) }));
      return null;
    },
    saveProjectTemplate: (t) => {
      if (!t.name.trim()) return "Name the template.";
      set((s) => { const ex = s.projectTemplates.some((x) => x.id === t.id); const row = { ...t, id: t.id || uid("tpl"), name: t.name.trim(), updatedAt: now() }; return { projectTemplates: ex ? s.projectTemplates.map((x) => (x.id === t.id ? row : x)) : [...s.projectTemplates, row] }; });
      return null;
    },
  };
}

/** v8: Project Desk state starts empty (plus optional starter templates). Leads, deals and payments are untouched. */
export function migrateProjects(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 8) return state;
  return { ...state, projects: state["projects"] ?? [], projectTasks: state["projectTasks"] ?? [], projectMilestones: state["projectMilestones"] ?? [], supportRequests: state["supportRequests"] ?? [], projectTemplates: state["projectTemplates"] ?? starterTemplates(new Date().toISOString()) };
}
