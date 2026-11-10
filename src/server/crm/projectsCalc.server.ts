/**
 * Pure calculation, validation, and status lifecycle rules for CRM Projects, Milestones, Tasks, and Support.
 * Mirrors src/lib/crm/projects.ts ensuring 100% backend-frontend rule fidelity.
 */

export const PROJECT_STATUSES = [
  "accepted",
  "booked",
  "awaiting_client",
  "ready",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const NOT_STARTED_STATUSES: ProjectStatus[] = ["accepted", "booked", "awaiting_client", "ready"];
export const CLOSED_STATUSES: ProjectStatus[] = ["completed", "cancelled"];

export const PROJECT_STAGES = [
  "discovery",
  "awaiting_content",
  "design",
  "development",
  "testing",
  "client_review",
  "ready_to_launch",
  "delivered",
  "support",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_PRIORITIES = ["high", "normal", "low"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const SUPPORT_STATUSES = ["not_set", "not_included", "scheduled", "active", "ended"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_KINDS = ["bug", "technical", "content", "integration", "general"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const SUPPORT_COVERAGES = ["undecided", "included", "billable"] as const;
export type SupportCoverage = (typeof SUPPORT_COVERAGES)[number];

export const DELIVERABLE_STATUSES = ["draft", "review", "approved", "rejected", "delivered"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const DELIVERABLE_REVISION_STATUSES = ["submitted", "in_review", "changes_requested", "approved"] as const;
export type DeliverableRevisionStatus = (typeof DELIVERABLE_REVISION_STATUSES)[number];

export interface CheckItem {
  id: string;
  label: string;
  done: boolean;
  doneAt?: string | undefined;
  note?: string | undefined;
}

export interface ProjectDependency {
  id: string;
  label: string;
  done: boolean;
  doneAt?: string | undefined;
}

export interface ProjectLink {
  id: string;
  label: string;
  url: string;
  addedAt: string;
}

export interface ProjectDelivery {
  date: string;
  url?: string | undefined;
  notes?: string | undefined;
  deliveredBy: string;
  approval: "pending" | "approved" | "not_required";
  override?: string | undefined;
  incomplete: string[];
}

export interface ProjectSupport {
  included: boolean | null;
  months?: number | undefined;
  start?: string | undefined;
  end?: string | undefined;
  description?: string | undefined;
}

export interface DeliverInput {
  date: string;
  url?: string | undefined;
  notes?: string | undefined;
  approval: "pending" | "approved" | "not_required";
  override?: string | undefined;
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

/** Blocks passwords, keys, tokens from notes/scope. */
export function looksLikeSecret(text: string | undefined | null): boolean {
  if (!text) return false;
  return (
    /\b(pass(word|wd)?|pwd|otp|pin|secret|api[_ -]?key|token|cpanel login)\s*[:=]\s*\S+/i.test(text) ||
    /\b(sk|pk)_(live|test)_[A-Za-z0-9]{8,}/.test(text)
  );
}

export const SECRET_ERROR =
  "Looks like a password or key. Don't store credentials here — note where they are kept instead (e.g. “Hosting login: shared by client over call”).";

/** Validates basic project fields before save. */
export function validateProjectFields(p: {
  name: string;
  clientName: string;
  plannedStart?: string | null | undefined;
  targetDelivery?: string | null | undefined;
  actualStart?: string | null | undefined;
  bookingDate?: string | null | undefined;
  notes?: string | null | undefined;
  scope?: string | null | undefined;
}): string | null {
  if (!p.name || !p.name.trim()) return "Give the project a name.";
  if (!p.clientName || !p.clientName.trim()) return "Client name is required.";
  for (const d of [p.plannedStart, p.targetDelivery, p.actualStart, p.bookingDate]) {
    if (d && !ISO_DAY.test(d)) return "Use a valid date.";
  }
  if (p.plannedStart && p.targetDelivery && p.targetDelivery < p.plannedStart) {
    return "Target delivery can't be before the planned start.";
  }
  if (looksLikeSecret(p.notes) || looksLikeSecret(p.scope)) return SECRET_ERROR;
  return null;
}

/** Status change side-effects: "in_progress" sets actualStart; "booked" sets bookingDate. */
export function applyStatusSideEffects(
  current: { actualStart?: string | null | undefined; bookingDate?: string | null | undefined },
  status: ProjectStatus,
  todayIst: string,
): { actualStart?: string; bookingDate?: string } {
  const patch: { actualStart?: string; bookingDate?: string } = {};
  if (status === "in_progress" && !current.actualStart) patch.actualStart = todayIst;
  if (status === "booked" && !current.bookingDate) patch.bookingDate = todayIst;
  return patch;
}

/** Overall progress is strictly computed from completed tasks. */
export function projectProgress(tasks: { status: string }[]) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : null,
    text: total ? `${done} of ${total} tasks complete` : "No tasks yet — progress isn't measured",
  };
}

export function milestoneProgress(milestoneId: string, tasks: { milestoneId?: string | null; status: string }[]) {
  const t = tasks.filter((x) => x.milestoneId === milestoneId);
  const done = t.filter((x) => x.status === "done").length;
  return {
    total: t.length,
    done,
    complete: t.length > 0 && t.every((x) => x.status === "done"),
  };
}

export function taskOverdue(t: { status: string; dueDate?: string | null }, todayIst: string): boolean {
  return t.status === "open" && !!t.dueDate && t.dueDate < todayIst;
}

export function isActiveProject(p: { archived: boolean; status: string; stage: string }): boolean {
  return (
    !p.archived &&
    !CLOSED_STATUSES.includes(p.status as ProjectStatus) &&
    p.stage !== "delivered" &&
    p.stage !== "support"
  );
}

export function isProjectOverdue(
  p: { archived: boolean; status: string; stage: string; targetDelivery?: string | null },
  todayIst: string,
): boolean {
  return isActiveProject(p) && !!p.targetDelivery && p.targetDelivery < todayIst;
}

/** Incomplete technical QA and handover items. */
export function deliveryGaps(p: {
  qa?: CheckItem[] | null;
  handover?: CheckItem[] | null;
}): string[] {
  const qa = p.qa ?? [];
  const handover = p.handover ?? [];
  return [...qa, ...handover].filter((c) => !c.done).map((c) => c.label);
}

/** Validates delivery recording. */
export function deliveryError(
  p: { qa?: CheckItem[] | null; handover?: CheckItem[] | null; status: string },
  d: DeliverInput,
): string | null {
  if (p.status === "cancelled") return "A cancelled project can't be delivered.";
  if (!d.date || !ISO_DAY.test(d.date)) return "Enter the actual delivery date.";
  if (d.url && !URL_RE.test(d.url.trim())) {
    return "Enter a full website address starting with https://, or leave it empty.";
  }
  if (looksLikeSecret(d.notes)) return SECRET_ERROR;
  const gaps = deliveryGaps(p);
  if (gaps.length > 0 && !(d.override ?? "").trim()) {
    return "Some checklist items are not complete. Complete them or record why you are delivering anyway.";
  }
  return null;
}

/** Adds given number of months to a date string YYYY-MM-DD. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, last));
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

export function supportStatus(s: ProjectSupport | null | undefined, todayIst: string): SupportStatus {
  if (!s || s.included === false) return "not_included";
  if (s.included == null || !s.start) return "not_set";
  if (todayIst < s.start) return "scheduled";
  if (s.end && todayIst > s.end) return "ended";
  return "active";
}

export function supportError(s: ProjectSupport): string | null {
  if (s.included !== true) return null;
  if (!s.start || !ISO_DAY.test(s.start)) return "Choose when support starts — it is never assumed.";
  if (s.end && s.end < s.start) return "Support end can't be before it starts.";
  if (s.months != null && (!Number.isInteger(s.months) || s.months < 1 || s.months > 120)) {
    return "Support duration must be 1–120 months.";
  }
  if (looksLikeSecret(s.description)) return SECRET_ERROR;
  return null;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export interface ProjectAttentionItem {
  id: string;
  projectId: string;
  kind: "overdue" | "due_soon" | "ready" | "support_ending" | "support_open" | "review" | "tasks_overdue";
  text: string;
}

export function projectAttention(
  projects: Array<{
    id: string;
    archived: boolean;
    status: string;
    stage: string;
    targetDelivery?: string | null;
    reviewFlag?: string | null;
    attentionJson?: string | null;
    support?: ProjectSupport | null;
  }>,
  tasks: Array<{ projectId: string; status: string; dueDate?: string | null }>,
  requests: Array<{ projectId: string; status: string; priority: string }>,
  todayIst: string,
): ProjectAttentionItem[] {
  const out: ProjectAttentionItem[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    if (p.reviewFlag) {
      out.push({ id: `${p.id}:review`, projectId: p.id, kind: "review", text: p.reviewFlag });
    }
    if (p.attentionJson) {
      try {
        const att = JSON.parse(p.attentionJson);
        if (att?.reason) {
          out.push({
            id: `${p.id}:auto:${att.at || ""}`,
            projectId: p.id,
            kind: "review",
            text: `Automation: ${att.reason}`,
          });
        }
      } catch {}
    }
    if (isProjectOverdue(p, todayIst)) {
      out.push({
        id: `${p.id}:overdue:${p.targetDelivery}`,
        projectId: p.id,
        kind: "overdue",
        text: `Target delivery ${p.targetDelivery} has passed.`,
      });
    } else if (isActiveProject(p) && p.targetDelivery && daysBetween(todayIst, p.targetDelivery) <= 7) {
      out.push({
        id: `${p.id}:due:${p.targetDelivery}`,
        projectId: p.id,
        kind: "due_soon",
        text: `Delivery due in ${daysBetween(todayIst, p.targetDelivery)} day(s).`,
      });
    }
    if (p.status === "ready") {
      out.push({ id: `${p.id}:ready`, projectId: p.id, kind: "ready", text: "Client is ready — work can begin." });
    }
    const late = tasks.filter((t) => t.projectId === p.id && taskOverdue(t, todayIst)).length;
    if (late) {
      out.push({ id: `${p.id}:tasks`, projectId: p.id, kind: "tasks_overdue", text: `${late} overdue task(s).` });
    }
    if (p.support && supportStatus(p.support, todayIst) === "active" && p.support.end && daysBetween(todayIst, p.support.end) <= 14) {
      out.push({
        id: `${p.id}:support:${p.support.end}`,
        projectId: p.id,
        kind: "support_ending",
        text: `Support ends ${p.support.end}.`,
      });
    }
    const open = requests.filter(
      (r) => r.projectId === p.id && (r.status === "open" || r.status === "in_progress") && r.priority === "high",
    ).length;
    if (open) {
      out.push({
        id: `${p.id}:sr`,
        projectId: p.id,
        kind: "support_open",
        text: `${open} high-priority support request(s) open.`,
      });
    }
  }
  return out;
}

export function projectMetrics(
  projects: Array<{
    id: string;
    archived: boolean;
    status: string;
    stage: string;
    targetDelivery?: string | null;
    deliveryJson?: string | null;
  }>,
  tasks: Array<{ projectId: string; status: string; milestoneId?: string | null }>,
  milestones: Array<{ id: string; projectId: string; dueDate?: string | null }>,
  requests: Array<{ projectId: string; status: string }>,
  todayIst: string,
) {
  const live = projects.filter((p) => !p.archived);
  const ids = new Set(live.map((p) => p.id));
  return {
    active: live.filter(isActiveProject).length,
    awaiting: live.filter((p) => p.status === "awaiting_client" || p.status === "booked" || p.status === "accepted")
      .length,
    inProgress: live.filter((p) => p.status === "in_progress").length,
    overdue: live.filter((p) => isProjectOverdue(p, todayIst)).length,
    delivered: live.filter((p) => !!p.deliveryJson).length,
    openTasks: tasks.filter((t) => ids.has(t.projectId) && t.status === "open").length,
    upcomingMilestones: milestones.filter(
      (m) =>
        ids.has(m.projectId) &&
        m.dueDate &&
        m.dueDate >= todayIst &&
        daysBetween(todayIst, m.dueDate) <= 14 &&
        !milestoneProgress(m.id, tasks).complete,
    ).length,
    openRequests: requests.filter((r) => ids.has(r.projectId) && (r.status === "open" || r.status === "in_progress"))
      .length,
  };
}
