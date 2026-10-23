// Phase 3G.1 — Project Desk: pure contracts and rules for Deal → Project → Tasks → Delivery → Support.
// Projects reference Leads and Deals by stable id. They never copy payments: all money is read from
// the existing Finance Studio records through finance.ts, so there is exactly one financial ledger.
import { dealCollected, dealOutstanding } from "./finance";
import type { Deal, Lead, Payment } from "./types";

export const PROJECT_SCHEMA = 1;

export type ProjectStatus = "accepted" | "booked" | "awaiting_client" | "ready" | "in_progress" | "on_hold" | "completed" | "cancelled";
export const PROJECT_STATUSES: ProjectStatus[] = ["accepted", "booked", "awaiting_client", "ready", "in_progress", "on_hold", "completed", "cancelled"];
export const STATUS_TEXT: Record<ProjectStatus, string> = {
  accepted: "Project accepted", booked: "Booking confirmed", awaiting_client: "Awaiting client start", ready: "Ready to begin",
  in_progress: "In progress", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled",
};
/** Statuses where work has genuinely not started yet — a booking never means development began. */
export const NOT_STARTED: ProjectStatus[] = ["accepted", "booked", "awaiting_client", "ready"];
export const CLOSED: ProjectStatus[] = ["completed", "cancelled"];

export type ProjectStage = "discovery" | "awaiting_content" | "design" | "development" | "testing" | "client_review" | "ready_to_launch" | "delivered" | "support";
export const PROJECT_STAGES: ProjectStage[] = ["discovery", "awaiting_content", "design", "development", "testing", "client_review", "ready_to_launch", "delivered", "support"];
export const STAGE_TEXT: Record<ProjectStage, string> = {
  discovery: "Discovery", awaiting_content: "Awaiting content", design: "Design", development: "Development", testing: "Testing & QA",
  client_review: "Client review", ready_to_launch: "Ready to launch", delivered: "Delivered", support: "Support",
};

export type ProjectPriority = "high" | "normal" | "low";
export interface CheckItem { id: string; label: string; done: boolean; doneAt?: string | undefined; note?: string | undefined }
export interface ProjectLink { id: string; label: string; url: string; addedAt: string }
export interface ProjectDependency { id: string; label: string; done: boolean; doneAt?: string | undefined }
export interface ProjectHistory { at: string; by: string; change: string }
export interface ProjectDelivery { date: string; url?: string | undefined; notes?: string | undefined; deliveredBy: string; approval: "pending" | "approved" | "not_required"; override?: string | undefined; incomplete: string[] }
export type SupportStatus = "not_set" | "not_included" | "scheduled" | "active" | "ended";
export interface ProjectSupport { included: boolean | null; months?: number | undefined; start?: string | undefined; end?: string | undefined; description?: string | undefined }

export interface Project {
  id: string;
  name: string;
  clientName: string;
  company?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  leadId?: string | undefined;
  dealId?: string | undefined;
  templateId?: string | undefined;
  type: string;
  scope?: string | undefined;
  bookingDate?: string | undefined;
  plannedStart?: string | undefined;
  actualStart?: string | undefined;
  targetDelivery?: string | undefined;
  status: ProjectStatus;
  stage: ProjectStage;
  priority: ProjectPriority;
  /** "owner" or an employee id. */
  ownerId: string | null;
  memberIds: string[];
  dependencies: ProjectDependency[];
  notes?: string | undefined;
  requirements: CheckItem[];
  qa: CheckItem[];
  handover: CheckItem[];
  links: ProjectLink[];
  delivery?: ProjectDelivery | undefined;
  support: ProjectSupport;
  /** Read-only snapshot taken at handoff (source, service, accepted package, visible custom values). The Lead is never edited. */
  carried: { source?: string; service?: string; packageRef?: string; dealValue?: number; fields?: { label: string; value: string }[] };
  /** Set when the linked Deal was cancelled or the Lead marked lost after handoff. The Project is never deleted. */
  reviewFlag?: string | undefined;
  /** Set by an automation "Flag for attention" action. Cleared by the Owner; never changes money, stage or delivery. */
  attention?: { reason: string; at: string; ruleId: string } | undefined;
  archived: boolean;
  history: ProjectHistory[];
  createdAt: string;
  updatedAt: string;
  version: number;
  schema: number;
}

export interface ProjectMilestone { id: string; projectId: string; title: string; dueDate?: string | undefined; order: number }
export type TaskStatus = "open" | "done";
export interface ProjectTask {
  id: string; projectId: string; milestoneId?: string | undefined; title: string; notes?: string | undefined;
  assigneeId: string | null; dueDate?: string | undefined; priority: ProjectPriority; status: TaskStatus;
  completedAt?: string | undefined; completedBy?: string | undefined; order: number;
  history: ProjectHistory[]; createdAt: string; updatedAt: string; version: number;
}
export type SupportKind = "bug" | "technical" | "content" | "integration" | "general";
export const SUPPORT_KIND_TEXT: Record<SupportKind, string> = { bug: "Bug fix", technical: "Technical issue", content: "Content correction", integration: "Integration issue", general: "General support" };
export type RequestStatus = "open" | "in_progress" | "resolved" | "closed";
export interface SupportRequest {
  id: string; projectId: string; kind: SupportKind; title: string; description?: string | undefined; priority: ProjectPriority;
  assigneeId: string | null; createdAt: string; dueDate?: string | undefined; status: RequestStatus; resolution?: string | undefined; resolvedAt?: string | undefined;
  /** Never assumed: Owner decides whether a request is covered by the agreement. */
  coverage: "undecided" | "included" | "billable";
  updatedAt: string; version: number;
}

export interface ProjectTemplate {
  id: string; name: string; type: string; builtIn?: boolean;
  milestones: string[];
  tasks: { title: string; milestone?: string }[];
  requirements: string[]; qa: string[]; handover: string[];
  archived: boolean; updatedAt: string;
}

const DEFAULT_REQ = ["Logo received", "Brand colours confirmed", "Reference websites received", "Website copy received", "Images received", "Domain responsibility confirmed", "Hosting responsibility confirmed", "Launch approval received"];
const DEFAULT_QA = ["Tested on desktop", "Mobile responsiveness tested", "Forms tested", "Domain configuration reviewed", "Hosting deployment completed"];
const DEFAULT_HANDOVER = ["Client approval received", "Handover completed", "Documentation provided"];

/** Optional starter templates. No prices, timelines, hosting responsibility or support periods are hardcoded. */
export function starterTemplates(at: string): ProjectTemplate[] {
  const t = (id: string, name: string, milestones: string[], tasks: [string, string?][], extra: Partial<ProjectTemplate> = {}): ProjectTemplate => ({
    id, name, type: name, builtIn: true, milestones, tasks: tasks.map(([title, milestone]) => (milestone ? { title, milestone } : { title })),
    requirements: DEFAULT_REQ, qa: DEFAULT_QA, handover: DEFAULT_HANDOVER, archived: false, updatedAt: at, ...extra,
  });
  return [
    t("tpl_business", "Business Website", ["Content", "Build", "Launch"], [["Collect content and images", "Content"], ["Approve design", "Build"], ["Build pages", "Build"], ["Mobile QA", "Launch"], ["Deliver website", "Launch"]]),
    t("tpl_ecom", "E-commerce Website", ["Content", "Design", "Build", "Launch"], [["Collect product images", "Content"], ["Collect product information", "Content"], ["Approve UI design", "Design"], ["Build product pages", "Build"], ["Configure admin panel", "Build"], ["Integrate payment flow", "Build"], ["Test checkout", "Launch"], ["Perform mobile QA", "Launch"], ["Obtain launch approval", "Launch"], ["Deliver website", "Launch"]], { qa: [...DEFAULT_QA, "Checkout tested", "Admin panel tested", "Payment integration tested"], requirements: [...DEFAULT_REQ, "Product details received", "Admin access requirements identified", "Integrations clarified"] }),
    t("tpl_3d", "3D / Interactive Website", ["Concept", "Build", "Launch"], [["Agree interaction concept", "Concept"], ["Prepare 3D assets", "Build"], ["Build interactive scenes", "Build"], ["Performance testing", "Launch"], ["Deliver website", "Launch"]]),
    t("tpl_redesign", "Website Redesign", ["Audit", "Build", "Launch"], [["Review current website", "Audit"], ["Approve new design", "Build"], ["Rebuild pages", "Build"], ["Redirect old URLs", "Launch"], ["Deliver website", "Launch"]]),
    t("tpl_software", "CRM / Custom Software", ["Discovery", "Build", "Testing", "Launch"], [["Requirements workshop", "Discovery"], ["Data model sign-off", "Discovery"], ["Build core modules", "Build"], ["User acceptance testing", "Testing"], ["Deploy", "Launch"], ["Team training", "Launch"]], { qa: ["Core workflows tested", "Permissions tested", "Data import tested", "Deployment completed"] }),
    t("tpl_other", "Other Custom Project", [], [], { requirements: [], qa: [], handover: DEFAULT_HANDOVER }),
  ];
}

// ---------- Credential safety ----------
/** Blocks obvious secrets (passwords, keys, tokens) from being stored in browser-local notes or backups. */
export function looksLikeSecret(text: string | undefined): boolean {
  if (!text) return false;
  return /\b(pass(word|wd)?|pwd|otp|pin|secret|api[_ -]?key|token|cpanel login)\s*[:=]\s*\S+/i.test(text) || /\b(sk|pk)_(live|test)_[A-Za-z0-9]{8,}/.test(text);
}
export const SECRET_ERROR = "Looks like a password or key. Don't store credentials here — note where they are kept instead (e.g. “Hosting login: shared by client over call”).";

// ---------- Handoff ----------
export interface HandoffInput { deal: Deal; lead?: Lead | undefined; template?: ProjectTemplate | undefined; fields?: { label: string; value: string }[]; packageRef?: string | undefined; service?: string | undefined }
/** Draft prefilled from the Deal/Lead. Nothing is paid, booked or started automatically. */
export function draftFromDeal(i: HandoffInput): Omit<Project, "id" | "createdAt" | "updatedAt" | "version" | "schema" | "history"> {
  const { deal, lead, template: tp } = i;
  const check = (labels: string[], p: string) => labels.map((label, n) => ({ id: `${p}${n + 1}`, label, done: false }));
  return {
    name: deal.name, clientName: deal.clientName || lead?.name || "",
    company: deal.company ?? lead?.company, phone: deal.phone ?? lead?.phone, email: lead?.email,
    leadId: deal.leadId, dealId: deal.id, templateId: tp?.id, type: tp?.type ?? "Other Custom Project",
    scope: lead?.requirement, status: "accepted", stage: "discovery", priority: "normal", ownerId: "owner", memberIds: [],
    dependencies: [], requirements: check(tp?.requirements ?? [], "rq"), qa: check(tp?.qa ?? [], "qa"), handover: check(tp?.handover ?? [], "ho"),
    links: [], support: { included: null },
    carried: { ...(lead?.source ? { source: lead.source } : {}), ...(i.service ? { service: i.service } : {}), ...(i.packageRef ? { packageRef: i.packageRef } : {}), dealValue: deal.finalAmount, ...(i.fields?.length ? { fields: i.fields } : {}) },
    archived: false,
  };
}

/** The active (not archived, not cancelled) project already created from this deal, if any. */
export function activeProjectForDeal(projects: Project[], dealId: string): Project | undefined {
  return projects.find((p) => p.dealId === dealId && !p.archived && p.status !== "cancelled");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function projectError(p: Pick<Project, "name" | "clientName" | "plannedStart" | "targetDelivery" | "actualStart" | "bookingDate" | "notes" | "scope">): string | null {
  if (!p.name.trim()) return "Give the project a name.";
  if (!p.clientName.trim()) return "Client name is required.";
  for (const d of [p.plannedStart, p.targetDelivery, p.actualStart, p.bookingDate]) if (d && !ISO_DAY.test(d)) return "Use a valid date.";
  if (p.plannedStart && p.targetDelivery && p.targetDelivery < p.plannedStart) return "Target delivery can't be before the planned start.";
  if (looksLikeSecret(p.notes) || looksLikeSecret(p.scope)) return SECRET_ERROR;
  return null;
}

/** Status change side-effects: only "in_progress" records an actual start, and only when the user hasn't set one. */
export function applyStatus(p: Project, status: ProjectStatus, today: string): Partial<Project> {
  const patch: Partial<Project> = { status };
  if (status === "in_progress" && !p.actualStart) patch.actualStart = today;
  if (status === "booked" && !p.bookingDate) patch.bookingDate = today;
  return patch;
}

// ---------- Progress (only from real completed tasks) ----------
export function projectProgress(tasks: ProjectTask[]) {
  const total = tasks.length, done = tasks.filter((t) => t.status === "done").length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : null, text: total ? `${done} of ${total} tasks complete` : "No tasks yet — progress isn't measured" };
}
export function milestoneProgress(m: ProjectMilestone, tasks: ProjectTask[]) {
  const t = tasks.filter((x) => x.milestoneId === m.id);
  return { total: t.length, done: t.filter((x) => x.status === "done").length, complete: t.length > 0 && t.every((x) => x.status === "done") };
}
export const taskOverdue = (t: ProjectTask, today: string) => t.status === "open" && !!t.dueDate && t.dueDate < today;
export const isActive = (p: Project) => !p.archived && !CLOSED.includes(p.status) && p.stage !== "delivered" && p.stage !== "support";
export const isProjectOverdue = (p: Project, today: string) => isActive(p) && !!p.targetDelivery && p.targetDelivery < today;

// ---------- Finance (read from Finance Studio only) ----------
export interface ProjectFinance { linked: boolean; dealName?: string; agreed: number; received: number; remaining: number; advanceReceived: boolean; payments: Payment[]; voided: number; cancelled: boolean }
export function projectFinance(p: Pick<Project, "dealId">, deals: Deal[], payments: Payment[]): ProjectFinance {
  const deal = p.dealId ? deals.find((d) => d.id === p.dealId) : undefined;
  if (!deal) return { linked: false, agreed: 0, received: 0, remaining: 0, advanceReceived: false, payments: [], voided: 0, cancelled: false };
  const mine = payments.filter((x) => x.dealId === deal.id).sort((a, b) => b.date.localeCompare(a.date));
  const received = dealCollected(deal.id, payments);
  return { linked: true, dealName: deal.name, agreed: deal.finalAmount, received, remaining: dealOutstanding(deal, payments), advanceReceived: received > 0, payments: mine, voided: mine.filter((x) => x.voided).length, cancelled: deal.status === "cancelled" };
}

// ---------- Delivery ----------
export function deliveryGaps(p: Pick<Project, "qa" | "handover">): string[] {
  return [...p.qa, ...p.handover].filter((c) => !c.done).map((c) => c.label);
}
export interface DeliverInput { date: string; url?: string; notes?: string; approval: ProjectDelivery["approval"]; override?: string }
export function deliveryError(p: Pick<Project, "qa" | "handover" | "status">, d: DeliverInput): string | null {
  if (p.status === "cancelled") return "A cancelled project can't be delivered.";
  if (!ISO_DAY.test(d.date)) return "Enter the actual delivery date.";
  if (d.url && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(d.url.trim())) return "Enter a full website address starting with https://, or leave it empty.";
  if (looksLikeSecret(d.notes)) return SECRET_ERROR;
  if (deliveryGaps(p).length && !(d.override ?? "").trim()) return "Some checklist items are not complete. Complete them or record why you are delivering anyway.";
  return null;
}

// ---------- Support ----------
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, last));
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}
export function supportStatus(s: ProjectSupport, today: string): SupportStatus {
  if (s.included === false) return "not_included";
  if (s.included == null || !s.start) return "not_set";
  if (today < s.start) return "scheduled";
  if (s.end && today > s.end) return "ended";
  return "active";
}
export const SUPPORT_TEXT: Record<SupportStatus, string> = { not_set: "Not configured", not_included: "Not included", scheduled: "Starts later", active: "Active", ended: "Ended" };
export function supportError(s: ProjectSupport): string | null {
  if (s.included !== true) return null;
  if (!s.start || !ISO_DAY.test(s.start)) return "Choose when support starts — it is never assumed.";
  if (s.end && s.end < s.start) return "Support end can't be before it starts.";
  if (s.months != null && (!Number.isInteger(s.months) || s.months < 1 || s.months > 120)) return "Support duration must be 1–120 months.";
  if (looksLikeSecret(s.description)) return SECRET_ERROR;
  return null;
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ---------- Reversal ----------
/** If the deal is cancelled or the lead is lost after handoff, flag the project — never delete it. */
export function reversalFlag(p: Project, deals: Deal[], leads: Lead[]): string | undefined {
  if (p.archived || CLOSED.includes(p.status)) return undefined;
  const deal = p.dealId ? deals.find((d) => d.id === p.dealId) : undefined;
  if (p.dealId && deal?.status === "cancelled") return "The linked deal was cancelled. Review this project.";
  const lead = p.leadId ? leads.find((l) => l.id === p.leadId) : undefined;
  if (lead?.status === "lost") return "The linked lead was marked Lost. Review this project.";
  return undefined;
}

// ---------- Access ----------
export interface ProjectViewer { owner: boolean; employeeId?: string; can: (perm: string) => boolean; financeAmounts: boolean }
export const OWNER_PROJECT_VIEWER: ProjectViewer = { owner: true, can: () => true, financeAmounts: true };
export const isOnProject = (p: Project, empId: string) => p.ownerId === empId || p.memberIds.includes(empId);
/** Employees only ever see projects they are assigned to; seeing the linked Lead is not enough. */
export function canSeeProject(p: Project, v: ProjectViewer) { return v.owner || (!!v.employeeId && v.can("projects.view") && isOnProject(p, v.employeeId)); }
export function canEditTask(t: ProjectTask, p: Project, v: ProjectViewer) {
  if (v.owner) return true;
  if (!v.employeeId || !canSeeProject(p, v)) return false;
  if (v.can("projects.edit")) return true;
  return v.can("projects.tasks_edit") && (t.assigneeId === v.employeeId || p.ownerId === v.employeeId);
}
export const canCompleteTask = (t: ProjectTask, p: Project, v: ProjectViewer) => canEditTask(t, p, v) || (!!v.employeeId && canSeeProject(p, v) && v.can("projects.tasks_complete") && t.assigneeId === v.employeeId);
/** Finance needs the explicit project-finance permission and an amounts-level finance access. */
export const canSeeProjectFinance = (v: ProjectViewer) => v.owner || (v.can("projects.finance") && v.financeAmounts);

/** Pure: the project slice an employee would receive from the backend. */
export function scopeProjects<T extends { projects: Project[]; projectTasks: ProjectTask[]; projectMilestones: ProjectMilestone[]; supportRequests: SupportRequest[] }>(d: T, v: ProjectViewer) {
  const projects = d.projects.filter((p) => canSeeProject(p, v)).map((p) => ({ ...p, notes: undefined }));
  const ids = new Set(projects.map((p) => p.id));
  return { projects, projectTasks: d.projectTasks.filter((t) => ids.has(t.projectId)), projectMilestones: d.projectMilestones.filter((m) => ids.has(m.projectId)), supportRequests: d.supportRequests.filter((r) => ids.has(r.projectId)) };
}

// ---------- Overview / attention ----------
export interface ProjectAttention { id: string; projectId: string; kind: "overdue" | "due_soon" | "ready" | "support_ending" | "support_open" | "review" | "tasks_overdue"; text: string }
export function projectAttention(projects: Project[], tasks: ProjectTask[], requests: SupportRequest[], today: string): ProjectAttention[] {
  const out: ProjectAttention[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    if (p.reviewFlag) out.push({ id: `${p.id}:review`, projectId: p.id, kind: "review", text: p.reviewFlag });
    if (p.attention) out.push({ id: `${p.id}:auto:${p.attention.at}`, projectId: p.id, kind: "review", text: `Automation: ${p.attention.reason}` });
    if (isProjectOverdue(p, today)) out.push({ id: `${p.id}:overdue:${p.targetDelivery}`, projectId: p.id, kind: "overdue", text: `Target delivery ${p.targetDelivery} has passed.` });
    else if (isActive(p) && p.targetDelivery && daysBetween(today, p.targetDelivery) <= 7) out.push({ id: `${p.id}:due:${p.targetDelivery}`, projectId: p.id, kind: "due_soon", text: `Delivery due in ${daysBetween(today, p.targetDelivery)} day(s).` });
    if (p.status === "ready") out.push({ id: `${p.id}:ready`, projectId: p.id, kind: "ready", text: "Client is ready — work can begin." });
    const late = tasks.filter((t) => t.projectId === p.id && taskOverdue(t, today)).length;
    if (late) out.push({ id: `${p.id}:tasks`, projectId: p.id, kind: "tasks_overdue", text: `${late} overdue task(s).` });
    if (supportStatus(p.support, today) === "active" && p.support.end && daysBetween(today, p.support.end) <= 14) out.push({ id: `${p.id}:support:${p.support.end}`, projectId: p.id, kind: "support_ending", text: `Support ends ${p.support.end}.` });
    const open = requests.filter((r) => r.projectId === p.id && (r.status === "open" || r.status === "in_progress") && r.priority === "high").length;
    if (open) out.push({ id: `${p.id}:sr`, projectId: p.id, kind: "support_open", text: `${open} high-priority support request(s) open.` });
  }
  return out;
}
export function projectMetrics(projects: Project[], tasks: ProjectTask[], milestones: ProjectMilestone[], requests: SupportRequest[], today: string) {
  const live = projects.filter((p) => !p.archived);
  const ids = new Set(live.map((p) => p.id));
  return {
    active: live.filter(isActive).length,
    awaiting: live.filter((p) => p.status === "awaiting_client" || p.status === "booked" || p.status === "accepted").length,
    inProgress: live.filter((p) => p.status === "in_progress").length,
    overdue: live.filter((p) => isProjectOverdue(p, today)).length,
    delivered: live.filter((p) => !!p.delivery).length,
    openTasks: tasks.filter((t) => ids.has(t.projectId) && t.status === "open").length,
    upcomingMilestones: milestones.filter((m) => ids.has(m.projectId) && m.dueDate && m.dueDate >= today && daysBetween(today, m.dueDate) <= 14 && !milestoneProgress(m, tasks).complete).length,
    openRequests: requests.filter((r) => ids.has(r.projectId) && (r.status === "open" || r.status === "in_progress")).length,
  };
}

// ---------- Undo ----------
/** Only undo when nobody changed the project since (version check) — never overwrite a newer change. */
export const canUndo = (p: Project | undefined, expectedVersion: number) => !!p && p.version === expectedVersion;

// ---------- WhatsApp drafts (fully resolved text — no unresolved placeholders) ----------
export type ProjectMessage = "booking" | "kickoff" | "content" | "progress" | "approval" | "delivery" | "support";
export const MESSAGE_TEXT: Record<ProjectMessage, string> = { booking: "Booking confirmation", kickoff: "Project kickoff", content: "Content request", progress: "Progress update", approval: "Approval request", delivery: "Delivery notification", support: "Support follow-up" };
export function projectMessage(kind: ProjectMessage, p: Project, ctx: { owner: string; business: string; pending?: string[]; progress?: string }): string {
  const first = p.clientName.trim().split(/\s+/)[0] || "there";
  const sign = `\n\n— ${ctx.owner}${ctx.business ? `, ${ctx.business}` : ""}`;
  const body: Record<ProjectMessage, string> = {
    booking: `Thank you for confirming “${p.name}”. Your booking is recorded with us. We'll begin work on the start date you confirm.`,
    kickoff: `We're starting work on “${p.name}”${p.targetDelivery ? `, targeting delivery by ${p.targetDelivery}` : ""}. I'll share updates as we go.`,
    content: `To keep “${p.name}” moving, could you please share:\n${(ctx.pending?.length ? ctx.pending : ["the remaining content"]).map((x) => `• ${x}`).join("\n")}`,
    progress: `Quick update on “${p.name}”: ${ctx.progress ?? "work is progressing"}. Current stage: ${STAGE_TEXT[p.stage]}.`,
    approval: `“${p.name}” is ready for your review. Please take a look and let us know if it's approved or what you'd like changed.`,
    delivery: `“${p.name}” has been delivered${p.delivery?.url ? `: ${p.delivery.url}` : ""}. Thank you for working with us!`,
    support: `Checking in on “${p.name}”. Is everything working well? Let us know if you need any help.`,
  };
  return `Hi ${first},\n\n${body[kind]}${sign}`;
}
