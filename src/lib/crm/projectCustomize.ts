// Phase 3G.1.1 — Project custom fields, Project tags and Project filters.
// Reuses the Lead customization engine (definitions, typed values, tags, condition shapes and comparison
// rules from customize.ts). Project values and tags live in their own maps keyed by project id, so a
// Project change can never touch a Lead and vice versa.
import {
  cmpDate, cmpScalar, conditionIssues, customFilterFields, fieldVisible, OPS_FOR, tagForProjects,
  type CustomFieldDef, type FieldValues, type FilterField, type LeadTags, type TagDef, type ViewCondition, type ViewFilter, type Viewer,
} from "./customize";
import { dayKey } from "./format";
import {
  daysBetween, milestoneProgress, PROJECT_STAGES, PROJECT_STATUSES, STAGE_TEXT, STATUS_TEXT, SUPPORT_TEXT, supportStatus, taskOverdue,
  type Project, type ProjectMilestone, type ProjectTask, type SupportRequest, type SupportStatus,
} from "./projects";

/** projectId → tag ids. Separate from `leadTags`. */
export type ProjectTags = LeadTags;

export interface ProjectCtx {
  projectFields: CustomFieldDef[]; projectFieldValues: FieldValues; projectTags: ProjectTags; tags: TagDef[];
  employees: { id: string; name: string }[]; types: string[];
  tasks: ProjectTask[]; milestones: ProjectMilestone[]; supportRequests: SupportRequest[];
  now: Date; viewer: Viewer;
}

export type TaskState = "has_overdue" | "has_open" | "all_done" | "no_tasks";
export const TASK_STATE_TEXT: Record<TaskState, string> = { has_overdue: "Has overdue tasks", has_open: "Has open tasks", all_done: "All tasks done", no_tasks: "No tasks yet" };
export type MilestoneState = "has_incomplete" | "all_complete" | "none";
export const MILESTONE_STATE_TEXT: Record<MilestoneState, string> = { has_incomplete: "Has incomplete milestones", all_complete: "All milestones complete", none: "No milestones" };

/** Every field a Project filter or automation condition may use, for this viewer. Owner-only fields are absent for employees. */
export function projectFilterFields(ctx: Pick<ProjectCtx, "projectFields" | "tags" | "employees" | "types" | "viewer">): FilterField[] {
  const sys: FilterField[] = [
    { key: "p.stage", label: "Project stage", kind: "select", options: PROJECT_STAGES.map((s) => ({ id: s, label: STAGE_TEXT[s] })) },
    { key: "p.status", label: "Project status", kind: "select", options: PROJECT_STATUSES.map((s) => ({ id: s, label: STATUS_TEXT[s] })) },
    { key: "p.priority", label: "Project priority", kind: "select", options: [{ id: "high", label: "High" }, { id: "normal", label: "Normal" }, { id: "low", label: "Low" }] },
    { key: "p.type", label: "Project type", kind: "select", options: ctx.types.map((t) => ({ id: t, label: t })) },
    { key: "p.owner", label: "Project owner", kind: "select", options: [{ id: "__none", label: "Unassigned" }, { id: "owner", label: "Owner" }, ...ctx.employees.map((e) => ({ id: e.id, label: e.name }))] },
    { key: "p.member", label: "Team member", kind: "multi", options: ctx.employees.map((e) => ({ id: e.id, label: e.name })) },
    { key: "p.due", label: "Target delivery date", kind: "date" },
    { key: "p.tasks", label: "Task status", kind: "select", options: (Object.keys(TASK_STATE_TEXT) as TaskState[]).map((k) => ({ id: k, label: TASK_STATE_TEXT[k] })) },
    { key: "p.milestones", label: "Milestone status", kind: "select", options: (Object.keys(MILESTONE_STATE_TEXT) as MilestoneState[]).map((k) => ({ id: k, label: MILESTONE_STATE_TEXT[k] })) },
    { key: "p.support", label: "Support status", kind: "select", options: (Object.keys(SUPPORT_TEXT) as SupportStatus[]).map((k) => ({ id: k, label: SUPPORT_TEXT[k] })) },
    { key: "tags", label: "Project tags", kind: "multi", options: ctx.tags.filter(tagForProjects).map((t) => ({ id: t.id, label: t.status === "archived" ? `${t.name} (archived)` : t.name })) },
  ];
  return [...sys, ...customFilterFields(ctx.projectFields, ctx.viewer)];
}

export function taskState(projectId: string, tasks: ProjectTask[], today: string): TaskState {
  const t = tasks.filter((x) => x.projectId === projectId);
  if (!t.length) return "no_tasks";
  if (t.some((x) => taskOverdue(x, today))) return "has_overdue";
  return t.some((x) => x.status === "open") ? "has_open" : "all_done";
}
export function milestoneState(projectId: string, milestones: ProjectMilestone[], tasks: ProjectTask[]): MilestoneState {
  const ms = milestones.filter((m) => m.projectId === projectId);
  if (!ms.length) return "none";
  return ms.every((m) => milestoneProgress(m, tasks).complete) ? "all_complete" : "has_incomplete";
}

/** Whether one project satisfies one condition. Unknown/hidden fields or invalid operators → false (never broadens). */
export function matchProjectCondition(p: Project, c: ViewCondition, ctx: ProjectCtx, fields: Map<string, FilterField>): boolean {
  const f = fields.get(c.field); if (!f || !OPS_FOR[f.kind].includes(c.op)) return false;
  const today = dayKey(ctx.now);
  switch (c.field) {
    case "p.stage": return cmpScalar(p.stage, c, "select");
    case "p.status": return cmpScalar(p.status, c, "select");
    case "p.priority": return cmpScalar(p.priority, c, "select");
    case "p.type": return cmpScalar(p.type, c, "select");
    case "p.owner": return cmpScalar(p.ownerId ?? "__none", c, "select");
    case "p.member": return cmpScalar(p.memberIds, c, "multi");
    case "p.due": return c.op === "overdue" ? !!p.targetDelivery && p.targetDelivery < today && !p.delivery : cmpDate(p.targetDelivery, c, ctx.now);
    case "p.tasks": return cmpScalar(taskState(p.id, ctx.tasks, today), c, "select");
    case "p.milestones": return cmpScalar(milestoneState(p.id, ctx.milestones, ctx.tasks), c, "select");
    case "p.support": return cmpScalar(supportStatus(p.support, today), c, "select");
    case "tags": return cmpScalar(ctx.projectTags[p.id] ?? [], c, "multi");
  }
  if (c.field.startsWith("cf:")) {
    const v = ctx.projectFieldValues[p.id]?.[c.field.slice(3)];
    return f.kind === "date" ? cmpDate(typeof v === "string" ? v : undefined, c, ctx.now) : cmpScalar(v, c, f.kind);
  }
  return false;
}
export function matchProjectFilter(p: Project, filter: ViewFilter, ctx: ProjectCtx, fields = new Map(projectFilterFields(ctx).map((f) => [f.key, f]))): boolean {
  const cs = filter.conditions;
  if (!cs.length) return true;
  return filter.mode === "or" ? cs.some((c) => matchProjectCondition(p, c, ctx, fields)) : cs.every((c) => matchProjectCondition(p, c, ctx, fields));
}
/** Filter projects already inside the viewer's scope. Never widens what a viewer can see. */
export function runProjectFilter(filter: ViewFilter, projects: Project[], ctx: ProjectCtx): Project[] {
  const fields = new Map(projectFilterFields(ctx).map((f) => [f.key, f]));
  return projects.filter((p) => matchProjectFilter(p, filter, ctx, fields));
}
export const projectFilterIssues = (conditions: ViewCondition[], ctx: Pick<ProjectCtx, "projectFields" | "tags" | "employees" | "types" | "viewer">) =>
  conditionIssues(conditions, new Map(projectFilterFields(ctx).map((f) => [f.key, f])), "projects");

/** Remove Owner-only Project definitions/values and out-of-scope rows — what an employee copy may contain. */
export function scopeProjectCustomization(defs: CustomFieldDef[], values: FieldValues, tags: ProjectTags, projectIds: Set<string>, v: Viewer) {
  const seen = defs.filter((d) => fieldVisible(d, v)); const ok = new Set(seen.map((d) => d.id));
  const vals: FieldValues = {};
  for (const [id, row] of Object.entries(values)) if (projectIds.has(id)) vals[id] = Object.fromEntries(Object.entries(row).filter(([k]) => ok.has(k)));
  return { projectFields: seen, projectFieldValues: vals, projectTags: Object.fromEntries(Object.entries(tags).filter(([id]) => projectIds.has(id))) };
}

/** Days from today to a date (negative = past). */
export const daysUntil = (day: string | undefined, now: Date) => (day ? daysBetween(dayKey(now), day) : undefined);
