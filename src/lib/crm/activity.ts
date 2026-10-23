// Phase 3C — Team Activity events and Smart Notifications (pure, backend-agnostic).
// One event model for future production integration. Events are derived by diffing the CRM
// state before/after a real store action, so business records stay the single source of truth.
// Locally, the only trustworthy actor is the Owner; employee events only arrive from a future
// authenticated backend (eventSource "backend") or the clearly-labelled demo simulation ("demo").
import type { Deal, FollowUp, Lead, LeadActivity, Payment } from "./types";
import { STATUS_LABEL } from "./types";
import type { Assignment, EmployeeAccess } from "./access";
import type { Employee } from "./team";

export const EVENT_SCHEMA_VERSION = 1;

export type EventType =
  | "lead.created" | "lead.edited" | "lead.removed" | "lead.hot"
  | "lead.assigned" | "lead.reassigned" | "lead.unassigned"
  | "call.logged" | "call.reversed" | "client.note_added"
  | "followup.created" | "followup.rescheduled" | "followup.completed"
  | "pipeline.stage_changed" | "deal.won" | "deal.lost" | "deal.created"
  | "payment.recorded" | "payment.updated"
  | "bulk.completed" | "bulk.reversed"
  | "lead.reviewed" | "lead.duplicate_flagged" | "lead.duplicate_resolved" | "lead.related" | "lead.merged" | "lead.intake_status_changed"
  | "automation.reminder" | "automation.escalated"
  | "lead.tag_added" | "lead.tag_removed" | "lead.fields_changed" | "config.field_changed" | "config.view_changed"
  | "project.created" | "project.booked" | "project.started" | "project.stage_changed" | "project.task_created" | "project.task_completed" | "project.assigned" | "project.delivered" | "project.support_started" | "project.support_request_created" | "project.support_request_resolved"
  | "employee.added" | "employee.updated" | "employee.status_changed" | "employee.permissions_changed";

export type EntityType = "lead" | "followup" | "deal" | "payment" | "employee" | "bulk" | "project";
export type CrmModule = "leads" | "calls" | "followups" | "pipeline" | "finance" | "assignments" | "team" | "projects";
export type Importance = "low" | "normal" | "high";
export type EventSource = "local" | "demo" | "backend";

export interface ActivityEvent {
  eventId: string;
  eventType: EventType;
  actorUserId: string;
  actorRole: string;
  actorName: string;
  entityType: EntityType;
  entityId: string;
  occurredAt: string;
  summary: string;
  module: CrmModule;
  importance: Importance;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  relatedLeadId?: string;
  targetEmployeeId?: string;
  operationId: string;
  eventSource: EventSource;
  schemaVersion: number;
}

export interface Actor { id: string; role: string; name: string }
export const OWNER_ACTOR_ID = "owner";

/** The slice of CRM state that events are derived from. */
export interface EventSnap {
  leads: Lead[]; followUps: FollowUp[]; deals: Deal[]; payments: Payment[]; activities: LeadActivity[];
  assignments: Record<string, Assignment>; employees: Employee[]; employeeAccess: Record<string, EmployeeAccess>;
  reminders?: { id: string; leadId: string; ruleName: string; reason: string; escalated?: boolean; employeeId: string | null }[];
  inboxMeta?: Record<string, { reviewedAt?: string; flaggedAt?: string }>;
  leadTags?: Record<string, string[]>; fieldValues?: Record<string, Record<string, unknown>>;
  customFields?: { id: string; label: string; status: string; version: number }[]; tagDefs?: { id: string; name: string }[];
  savedViews?: { id: string; name: string; visibility: string; version: number }[];
  projects?: { id: string; name: string; leadId?: string | undefined; dealId?: string | undefined; status: string; stage: string; ownerId: string | null; memberIds: string[]; delivery?: unknown; support: { included: boolean | null; start?: string | undefined }; version: number }[];
  projectTasks?: { id: string; projectId: string; title: string; status: string }[];
  supportRequests?: { id: string; projectId: string; title: string; status: string }[]; leadRelations?: Record<string, { a: string; b: string; kind: string }>;
}
export interface DeriveCtx { action: string; operationId: string; at: string; actor: Actor; source?: EventSource }

/** Bulk threshold: at or above this many assignment changes in one action we write one summary event. */
export const BULK_THRESHOLD = 5;

export const MODULE_OF: Record<EventType, CrmModule> = {
  "project.created": "projects", "project.booked": "projects", "project.started": "projects", "project.stage_changed": "projects", "project.task_created": "projects", "project.task_completed": "projects", "project.assigned": "projects", "project.delivered": "projects", "project.support_started": "projects", "project.support_request_created": "projects", "project.support_request_resolved": "projects",
  "lead.tag_added": "leads", "lead.tag_removed": "leads", "lead.fields_changed": "leads", "config.field_changed": "leads", "config.view_changed": "leads",
  "lead.created": "leads", "lead.edited": "leads", "lead.removed": "leads", "lead.hot": "leads",
  "lead.assigned": "assignments", "lead.reassigned": "assignments", "lead.unassigned": "assignments",
  "call.logged": "calls", "call.reversed": "calls", "client.note_added": "leads",
  "followup.created": "followups", "followup.rescheduled": "followups", "followup.completed": "followups",
  "pipeline.stage_changed": "pipeline", "deal.won": "pipeline", "deal.lost": "pipeline", "deal.created": "finance",
  "payment.recorded": "finance", "payment.updated": "finance",
  "bulk.completed": "assignments", "bulk.reversed": "assignments",
  "lead.reviewed": "leads", "lead.duplicate_flagged": "leads", "lead.duplicate_resolved": "leads", "lead.related": "leads", "lead.merged": "leads", "lead.intake_status_changed": "leads",
  "automation.reminder": "followups", "automation.escalated": "followups",
  "employee.added": "team", "employee.updated": "team", "employee.status_changed": "team", "employee.permissions_changed": "team",
};
export const EVENT_LABEL: Record<EventType, string> = {
  "lead.created": "Lead created", "lead.edited": "Lead edited", "lead.removed": "Lead removed", "lead.hot": "Lead became Hot",
  "lead.assigned": "Lead assigned", "lead.reassigned": "Lead reassigned", "lead.unassigned": "Lead unassigned",
  "call.logged": "Call outcome logged", "call.reversed": "Call log reversed", "client.note_added": "Client note added",
  "followup.created": "Follow-up created", "followup.rescheduled": "Follow-up rescheduled", "followup.completed": "Follow-up completed",
  "pipeline.stage_changed": "Stage changed", "deal.won": "Deal won", "deal.lost": "Deal lost", "deal.created": "Deal created",
  "payment.recorded": "Payment recorded", "payment.updated": "Payment updated",
  "bulk.completed": "Bulk operation", "bulk.reversed": "Bulk operation reversed",
  "lead.reviewed": "Lead reviewed", "lead.duplicate_flagged": "Possible duplicate flagged", "lead.duplicate_resolved": "Duplicate kept separate", "lead.related": "Leads marked related", "lead.merged": "Leads merged", "lead.intake_status_changed": "Inbox status changed",
  "automation.reminder": "Automation reminder", "automation.escalated": "Escalated to Owner",
  "lead.tag_added": "Lead tag added", "lead.tag_removed": "Lead tag removed", "lead.fields_changed": "Custom field changed", "config.field_changed": "Field definition changed", "config.view_changed": "Shared view changed",
  "project.created": "Project created", "project.booked": "Project booked", "project.started": "Project started", "project.stage_changed": "Project stage changed", "project.task_created": "Project task added", "project.task_completed": "Project task completed", "project.assigned": "Project team changed", "project.delivered": "Project delivered", "project.support_started": "Support configured", "project.support_request_created": "Support request opened", "project.support_request_resolved": "Support request resolved",
  "employee.added": "Employee added", "employee.updated": "Employee updated", "employee.status_changed": "Account status changed", "employee.permissions_changed": "Permissions changed",
};
export const MODULE_LABEL: Record<CrmModule, string> = { leads: "Leads", calls: "Calls", followups: "Follow-ups", pipeline: "Pipeline", finance: "Finance", assignments: "Assignments", team: "Team", projects: "Projects" };
const IMPORTANCE: Partial<Record<EventType, Importance>> = {
  "lead.edited": "low", "project.task_created": "low", "project.stage_changed": "low", "lead.fields_changed": "low", "lead.tag_added": "low", "lead.tag_removed": "low", "config.field_changed": "low", "config.view_changed": "low", "followup.rescheduled": "low", "client.note_added": "low", "deal.created": "low", "employee.updated": "low",
  "deal.won": "high", "deal.lost": "high", "lead.hot": "high", "bulk.completed": "high", "payment.updated": "high", "employee.status_changed": "high", "employee.permissions_changed": "high", "bulk.reversed": "high", "automation.escalated": "high",
};

const EDIT_KEYS = ["name", "phone", "email", "company", "requirement", "source", "budget", "quotedAmount", "priority", "notes"] as const;
const clip = (s: string | undefined, n = 80) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

/** Derive meaningful events from one store transition. Deterministic ids (operationId + key) prevent duplicates. */
export function deriveEvents(prev: EventSnap, next: EventSnap, ctx: DeriveCtx): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const who = ctx.actor.name;
  const leadName = (id: string) => next.leads.find((l) => l.id === id)?.name ?? prev.leads.find((l) => l.id === id)?.name ?? "a lead";
  const empName = (id: string | null | undefined) => (id ? next.employees.find((e) => e.id === id)?.name ?? prev.employees.find((e) => e.id === id)?.name ?? "an employee" : "nobody");
  const push = (type: EventType, key: string, e: Omit<ActivityEvent, "eventId" | "eventType" | "actorUserId" | "actorRole" | "actorName" | "occurredAt" | "module" | "importance" | "operationId" | "eventSource" | "schemaVersion">) =>
    out.push({ eventId: `${ctx.operationId}:${type}:${key}`, eventType: type, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, actorName: who, occurredAt: ctx.at, module: MODULE_OF[type], importance: IMPORTANCE[type] ?? "normal", operationId: ctx.operationId, eventSource: ctx.source ?? "local", schemaVersion: EVENT_SCHEMA_VERSION, ...e });

  // Leads
  const prevLeads = new Map(prev.leads.map((l) => [l.id, l]));
  const nextIds = new Set(next.leads.map((l) => l.id));
  for (const l of next.leads) {
    const p = prevLeads.get(l.id);
    if (!p) { push("lead.created", l.id, { entityType: "lead", entityId: l.id, relatedLeadId: l.id, summary: `${who} created lead ${l.name}.`, newValues: { source: l.source, priority: l.priority, status: l.status } }); continue; }
    if (p.status !== l.status) {
      const type: EventType = l.status === "won" ? "deal.won" : l.status === "lost" ? "deal.lost" : "pipeline.stage_changed";
      const text = type === "deal.won" ? `${who} marked ${l.name} as Won.` : type === "deal.lost" ? `${who} marked ${l.name} as Lost${l.lostReason ? ` — ${clip(l.lostReason, 60)}` : ""}.` : `${who} changed ${l.name}'s Lead stage from ${STATUS_LABEL[p.status]} to ${STATUS_LABEL[l.status]}.`;
      push(type, l.id, { entityType: "lead", entityId: l.id, relatedLeadId: l.id, summary: text, oldValues: { status: p.status }, newValues: { status: l.status, ...(l.lostReason ? { lostReason: l.lostReason } : {}) } });
    }
    const changed = EDIT_KEYS.filter((k) => (p[k] ?? "") !== (l[k] ?? ""));
    if (changed.length) {
      const oldValues = Object.fromEntries(changed.map((k) => [k, p[k] ?? null]));
      const newValues = Object.fromEntries(changed.map((k) => [k, l[k] ?? null]));
      push("lead.edited", l.id, { entityType: "lead", entityId: l.id, relatedLeadId: l.id, summary: `${who} edited ${l.name} (${changed.join(", ")}).`, oldValues, newValues });
      if (l.priority === "hot" && p.priority !== "hot") push("lead.hot", l.id, { entityType: "lead", entityId: l.id, relatedLeadId: l.id, summary: `${l.name} became a Hot lead.`, oldValues: { priority: p.priority }, newValues: { priority: "hot" } });
    }
  }
  for (const p of prev.leads) if (!nextIds.has(p.id)) push("lead.removed", p.id, { entityType: "lead", entityId: p.id, relatedLeadId: p.id, summary: `${who} moved ${p.name} out of active leads.` });

  // Calls & client notes come from newly appended lead activity rows.
  const prevActs = new Set(prev.activities.map((a) => a.id));
  for (const a of next.activities) {
    if (prevActs.has(a.id)) continue;
    if (a.type === "call") push("call.logged", a.id, { entityType: "lead", entityId: a.leadId, relatedLeadId: a.leadId, summary: `${who} logged a call outcome for ${leadName(a.leadId)}: ${a.outcome ?? "Logged"}.`, newValues: { outcome: a.outcome ?? null } });
    else if (a.type === "note" && ctx.action === "addActivity") push("client.note_added", a.id, { entityType: "lead", entityId: a.leadId, relatedLeadId: a.leadId, summary: `${who} added a client note to ${leadName(a.leadId)}.`, newValues: { preview: clip(a.text, 60) } });
  }
  if (ctx.action === "undoCall") {
    const gone = prev.activities.filter((a) => a.type === "call" && !next.activities.some((b) => b.id === a.id));
    for (const a of gone) push("call.reversed", a.id, { entityType: "lead", entityId: a.leadId, relatedLeadId: a.leadId, summary: `${who} reversed a logged call for ${leadName(a.leadId)}. The original call remains in this history.`, oldValues: { outcome: a.outcome ?? null } });
  }

  // Follow-ups
  const prevFu = new Map(prev.followUps.map((f) => [f.id, f]));
  for (const f of next.followUps) {
    const p = prevFu.get(f.id);
    if (!p) { push("followup.created", f.id, { entityType: "followup", entityId: f.id, relatedLeadId: f.leadId, summary: `${who} scheduled a ${f.type} follow-up with ${leadName(f.leadId)}.`, newValues: { dueAt: f.dueAt, type: f.type } }); continue; }
    if (!p.completedAt && f.completedAt) push("followup.completed", f.id, { entityType: "followup", entityId: f.id, relatedLeadId: f.leadId, summary: `${who} completed a follow-up with ${leadName(f.leadId)}.`, newValues: { completedAt: f.completedAt } });
    else if (p.dueAt !== f.dueAt && !f.cancelledAt) push("followup.rescheduled", f.id, { entityType: "followup", entityId: f.id, relatedLeadId: f.leadId, summary: `${who} rescheduled a follow-up with ${leadName(f.leadId)}.`, oldValues: { dueAt: p.dueAt }, newValues: { dueAt: f.dueAt } });
  }

  // Deals & payments — amounts stay in the event detail only, never in notification text.
  const prevDeals = new Set(prev.deals.map((d) => d.id));
  for (const d of next.deals) if (!prevDeals.has(d.id)) push("deal.created", d.id, { entityType: "deal", entityId: d.id, ...(d.leadId ? { relatedLeadId: d.leadId } : {}), summary: `${who} created deal ${d.name}.` });
  const prevPay = new Map(prev.payments.map((p) => [p.id, p]));
  const dealOf = (id: string) => next.deals.find((d) => d.id === id);
  for (const p of next.payments) {
    const o = prevPay.get(p.id); const d = dealOf(p.dealId); const rel = d?.leadId ? { relatedLeadId: d.leadId } : {};
    if (!o) push("payment.recorded", p.id, { entityType: "payment", entityId: p.id, ...rel, summary: `${who} recorded a payment for ${d?.name ?? "a deal"}.`, newValues: { amount: p.amount, method: p.method, date: p.date } });
    else if (!o.voided && p.voided) push("payment.updated", p.id, { entityType: "payment", entityId: p.id, ...rel, summary: `${who} voided a payment for ${d?.name ?? "a deal"}.`, oldValues: { voided: false }, newValues: { voided: true } });
    else if (o.amount !== p.amount || o.date !== p.date || o.method !== p.method) push("payment.updated", p.id, { entityType: "payment", entityId: p.id, ...rel, summary: `${who} updated a payment for ${d?.name ?? "a deal"}.`, oldValues: { amount: o.amount, date: o.date, method: o.method }, newValues: { amount: p.amount, date: p.date, method: p.method } });
  }

  // Assignments — one summary event for bulk changes, individual history stays on each lead.
  const ids = new Set([...Object.keys(prev.assignments), ...Object.keys(next.assignments)]);
  const changes: { leadId: string; from: string | null; to: string | null }[] = [];
  for (const id of ids) { const from = prev.assignments[id]?.employeeId ?? null, to = next.assignments[id]?.employeeId ?? null; if (from !== to) changes.push({ leadId: id, from, to }); }
  if (changes.length) {
    const reversing = ctx.action === "restoreAssignments";
    if (reversing || changes.length >= BULK_THRESHOLD) {
      const per: Record<string, number> = {};
      for (const c of changes) { const k = c.to ?? "unassigned"; per[k] = (per[k] ?? 0) + 1; }
      const targets = Object.keys(per).filter((k) => k !== "unassigned");
      const n = changes.length, s = n === 1 ? "" : "s";
      const summary = reversing ? `${who} reversed the assignment of ${n} Lead${s}.` : targets.length > 1 ? `${n} Leads distributed across ${targets.length} employees.` : targets.length === 1 ? `${who} assigned ${n} Leads to ${empName(targets[0])}.` : `${who} unassigned ${n} Leads.`;
      push(reversing ? "bulk.reversed" : "bulk.completed", "assign", { entityType: "bulk", entityId: ctx.operationId, summary, newValues: { count: n, perEmployee: per, leadIds: changes.map((c) => c.leadId) }, ...(targets.length === 1 ? { targetEmployeeId: targets[0]! } : {}) });
    } else {
      for (const c of changes) {
        const type: EventType = c.to === null ? "lead.unassigned" : c.from ? "lead.reassigned" : "lead.assigned";
        const summary = type === "lead.unassigned" ? `${who} unassigned ${leadName(c.leadId)} from ${empName(c.from)}.` : type === "lead.reassigned" ? `${who} reassigned ${leadName(c.leadId)} from ${empName(c.from)} to ${empName(c.to)}.` : `${who} assigned ${leadName(c.leadId)} to ${empName(c.to)}.`;
        push(type, c.leadId, { entityType: "lead", entityId: c.leadId, relatedLeadId: c.leadId, summary, oldValues: { employeeId: c.from }, newValues: { employeeId: c.to }, ...(c.to ? { targetEmployeeId: c.to } : {}) });
      }
    }
  }

  // Team — never passwords or credentials.
  const prevEmp = new Map(prev.employees.map((e) => [e.id, e]));
  for (const e of next.employees) {
    const p = prevEmp.get(e.id);
    if (!p) { push("employee.added", e.id, { entityType: "employee", entityId: e.id, targetEmployeeId: e.id, summary: `${who} added ${e.name} to the team.`, newValues: { roleId: e.roleId } }); continue; }
    if (p.accountStatus !== e.accountStatus) push("employee.status_changed", e.id, { entityType: "employee", entityId: e.id, targetEmployeeId: e.id, summary: `${who} changed ${e.name}'s account from ${p.accountStatus} to ${e.accountStatus}.`, oldValues: { accountStatus: p.accountStatus }, newValues: { accountStatus: e.accountStatus } });
    else if (p.roleId !== e.roleId || p.name !== e.name || p.email !== e.email) push("employee.updated", e.id, { entityType: "employee", entityId: e.id, targetEmployeeId: e.id, summary: `${who} updated ${e.name}'s profile${p.roleId !== e.roleId ? " and role" : ""}.`, oldValues: { roleId: p.roleId }, newValues: { roleId: e.roleId } });
  }
  for (const id of new Set([...Object.keys(prev.employeeAccess), ...Object.keys(next.employeeAccess)])) {
    const a = prev.employeeAccess[id], b = next.employeeAccess[id];
    if (JSON.stringify(a ? { ...a, updatedAt: 0 } : null) !== JSON.stringify(b ? { ...b, updatedAt: 0 } : null)) push("employee.permissions_changed", id, { entityType: "employee", entityId: id, targetEmployeeId: id, summary: `${who} changed ${empName(id)}'s permissions.` });
  }
  // Automation — one grouped summary for many reminders; escalations notify individually. Actor is "Automation", never an employee.
  const prevRem = new Set((prev.reminders ?? []).map((r) => r.id));
  const fresh = (next.reminders ?? []).filter((r) => !prevRem.has(r.id));
  if (fresh.length >= BULK_THRESHOLD) push("automation.reminder", "bulk", { entityType: "bulk", entityId: ctx.operationId, summary: `Automation created ${fresh.length} reminders across ${new Set(fresh.map((r) => r.leadId)).size} leads.`, newValues: { count: fresh.length, rules: [...new Set(fresh.map((r) => r.ruleName))] } });
  else for (const r of fresh) push("automation.reminder", r.id, { entityType: "lead", entityId: r.leadId, relatedLeadId: r.leadId, summary: `${r.ruleName}: ${r.reason}`, newValues: { rule: r.ruleName } });
  for (const r of fresh) if (r.escalated) push("automation.escalated", r.id, { entityType: "lead", entityId: r.leadId, relatedLeadId: r.leadId, summary: `Escalated by ${r.ruleName}: ${r.reason}`, newValues: { rule: r.ruleName } });

  // Smart Inbox — reviews (summarised at BULK_THRESHOLD), duplicate flags and Owner decisions.
  const pm = prev.inboxMeta ?? {}, nm = next.inboxMeta ?? {};
  const reviewed = Object.keys(nm).filter((id) => nm[id]?.reviewedAt && !pm[id]?.reviewedAt);
  if (reviewed.length >= BULK_THRESHOLD) push("lead.reviewed", "bulk", { entityType: "bulk", entityId: ctx.operationId, summary: `${who} reviewed ${reviewed.length} leads in the Smart Inbox.`, newValues: { count: reviewed.length, leadIds: reviewed } });
  else for (const id of reviewed) push("lead.reviewed", id, { entityType: "lead", entityId: id, relatedLeadId: id, summary: `${who} reviewed ${leadName(id)} in the Smart Inbox.` });
  for (const id of Object.keys(nm)) {
    if (nm[id]?.reviewedAt || !pm[id]?.reviewedAt) continue;
    push("lead.intake_status_changed", id, { entityType: "lead", entityId: id, relatedLeadId: id, summary: `${who} moved ${leadName(id)} back to Needs review.`, oldValues: { status: "reviewed" }, newValues: { status: "needs_review" } });
  }
  if (ctx.action === "flagDuplicate") for (const id of Object.keys(nm)) if (nm[id]?.flaggedAt && !pm[id]?.flaggedAt) push("lead.duplicate_flagged", id, { entityType: "lead", entityId: id, relatedLeadId: id, summary: `${who} flagged ${leadName(id)} as a possible duplicate.` });
  // Phase 3G — tags and custom fields. Summaries name the field, never its value (values may be confidential).
  const tagName = (id: string) => next.tagDefs?.find((t) => t.id === id)?.name ?? "a tag";
  const pt = prev.leadTags ?? {}, nt = next.leadTags ?? {};
  if (pt !== nt) {
    const adds: [string, string][] = [], rems: [string, string][] = [];
    for (const id of new Set([...Object.keys(pt), ...Object.keys(nt)])) { const a = pt[id] ?? [], b = nt[id] ?? []; for (const t of b) if (!a.includes(t)) adds.push([id, t]); for (const t of a) if (!b.includes(t)) rems.push([id, t]); }
    for (const [list, type, verb] of [[adds, "lead.tag_added", "added"], [rems, "lead.tag_removed", "removed"]] as const) {
      if (list.length >= BULK_THRESHOLD) { const tags = [...new Set(list.map((x) => x[1]))]; push(type, "bulk", { entityType: "bulk", entityId: ctx.operationId, summary: `${who} ${verb} ${tags.map(tagName).join(", ")} ${verb === "added" ? "to" : "from"} ${new Set(list.map((x) => x[0])).size} leads.`, newValues: { count: list.length, tagIds: tags } }); }
      else for (const [id, t] of list) push(type, `${id}:${t}`, { entityType: "lead", entityId: id, relatedLeadId: id, summary: `${who} ${verb} tag “${tagName(t)}” ${verb === "added" ? "to" : "from"} ${leadName(id)}.`, newValues: { tagId: t } });
    }
  }
  const pf = prev.fieldValues ?? {}, nf = next.fieldValues ?? {};
  if (pf !== nf) for (const id of Object.keys(nf)) {
    if (pf[id] === nf[id]) continue;
    const a = pf[id] ?? {}, b = nf[id] ?? {};
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (!changed.length || !nextIds.has(id)) continue;
    const labels = changed.map((k) => next.customFields?.find((f) => f.id === k)?.label ?? "a field");
    push("lead.fields_changed", id, { entityType: "lead", entityId: id, relatedLeadId: id, summary: `${who} updated ${labels.join(", ")} on ${leadName(id)}.`, newValues: { fieldIds: changed } });
  }
  const pcf = new Map((prev.customFields ?? []).map((f) => [f.id, f]));
  for (const f of next.customFields ?? []) { const o = pcf.get(f.id); if (o && o.version === f.version) continue; push("config.field_changed", `${f.id}:${f.version}`, { entityType: "lead", entityId: f.id, summary: !o ? `${who} created the field “${f.label}”.` : o.status !== f.status ? `${who} ${f.status === "archived" ? "archived" : "restored"} the field “${f.label}”. Stored values are kept.` : `${who} edited the field “${f.label}”.` }); }
  const pv = new Map((prev.savedViews ?? []).map((v) => [v.id, v]));
  for (const v of next.savedViews ?? []) { if (v.visibility === "personal") continue; const o = pv.get(v.id); if (o && o.version === v.version) continue; push("config.view_changed", `${v.id}:${v.version}`, { entityType: "lead", entityId: v.id, summary: `${who} ${o ? "updated" : "created"} the ${v.visibility} view “${v.name}”.` }); }
  // Project Desk events — derived from real before/after state, attributed to the acting Owner.
  const pp = new Map((prev.projects ?? []).map((x) => [x.id, x]));
  const pName = (id: string) => (next.projects ?? []).find((x) => x.id === id)?.name ?? "a project";
  for (const p of next.projects ?? []) {
    const o = pp.get(p.id); if (o && o.version === p.version) continue;
    const base = { entityType: "project" as const, entityId: p.id, ...(p.leadId ? { relatedLeadId: p.leadId } : {}) };
    const links = { projectId: p.id, ...(p.dealId ? { dealId: p.dealId } : {}), ...(p.leadId ? { leadId: p.leadId } : {}) };
    if (!o) { push("project.created", p.id, { ...base, summary: `${who} created the project “${p.name}”.`, newValues: { ...links, status: p.status } }); continue; }
    if (o.status !== p.status && p.status === "booked") push("project.booked", `${p.id}:${p.version}`, { ...base, summary: `${who} confirmed the booking for “${p.name}”.`, oldValues: { status: o.status }, newValues: { ...links, status: p.status } });
    if (o.status !== p.status && p.status === "in_progress") push("project.started", `${p.id}:${p.version}`, { ...base, summary: `${who} started work on “${p.name}”.`, oldValues: { status: o.status }, newValues: { ...links, status: p.status } });
    if (!o.delivery && p.delivery) push("project.delivered", `${p.id}`, { ...base, summary: `${who} marked “${p.name}” delivered.`, newValues: links });
    else if (o.stage !== p.stage) push("project.stage_changed", `${p.id}:${p.version}`, { ...base, summary: `${who} moved “${p.name}” from ${o.stage} to ${p.stage}.`, oldValues: { stage: o.stage }, newValues: { ...links, stage: p.stage } });
    if (o.ownerId !== p.ownerId || o.memberIds.join() !== p.memberIds.join()) push("project.assigned", `${p.id}:${p.version}`, { ...base, summary: `${who} changed the team on “${p.name}”.`, oldValues: { ownerId: o.ownerId, memberIds: o.memberIds }, newValues: { ...links, ownerId: p.ownerId, memberIds: p.memberIds } });
    if (p.support.included && p.support.start && !(o.support.included && o.support.start)) push("project.support_started", `${p.id}:${p.version}`, { ...base, summary: `${who} configured support for “${p.name}” from ${p.support.start}.`, newValues: links });
  }
  const pt = new Map((prev.projectTasks ?? []).map((x) => [x.id, x]));
  for (const t of next.projectTasks ?? []) {
    const o = pt.get(t.id);
    if (!o && !(prev.projects ?? []).every((x) => x.id !== t.projectId)) push("project.task_created", t.id, { entityType: "project", entityId: t.projectId, summary: `${who} added the task “${t.title}” to “${pName(t.projectId)}”.`, newValues: { projectId: t.projectId, taskId: t.id } });
    if (o && o.status !== "done" && t.status === "done") push("project.task_completed", `${t.id}:done:${ctx.operationId}`, { entityType: "project", entityId: t.projectId, summary: `${who} completed “${t.title}” on “${pName(t.projectId)}”.`, newValues: { projectId: t.projectId, taskId: t.id } });
  }
  const psr = new Map((prev.supportRequests ?? []).map((x) => [x.id, x]));
  for (const r of next.supportRequests ?? []) {
    const o = psr.get(r.id);
    if (!o) push("project.support_request_created", r.id, { entityType: "project", entityId: r.projectId, summary: `${who} opened the support request “${r.title}” on “${pName(r.projectId)}”.`, newValues: { projectId: r.projectId, requestId: r.id } });
    else if (o.status !== "resolved" && r.status === "resolved") push("project.support_request_resolved", `${r.id}:resolved`, { entityType: "project", entityId: r.projectId, summary: `${who} resolved “${r.title}” on “${pName(r.projectId)}”.`, newValues: { projectId: r.projectId, requestId: r.id } });
  }
  const pr = prev.leadRelations ?? {}, nr = next.leadRelations ?? {};
  for (const [k, r] of Object.entries(nr)) {
    if (pr[k]?.kind === r.kind) continue;
    const t: EventType = r.kind === "related" ? "lead.related" : "lead.duplicate_resolved";
    push(t, k, { entityType: "lead", entityId: r.a, relatedLeadId: r.a, summary: r.kind === "related" ? `${who} marked ${leadName(r.a)} and ${leadName(r.b)} as related records.` : `${who} kept ${leadName(r.a)} and ${leadName(r.b)} as separate leads.`, newValues: { a: r.a, b: r.b, kind: r.kind } });
  }
  return out;
}

/** Merge incoming events (local, backend or reconnect replay) — dedupes by eventId, newest first, capped. */
export function mergeEvents(existing: ActivityEvent[], incoming: ActivityEvent[], cap = 2000): ActivityEvent[] {
  const seen = new Set(existing.map((e) => e.eventId));
  const fresh = incoming.filter((e) => { if (seen.has(e.eventId)) return false; seen.add(e.eventId); return true; });
  if (!fresh.length) return existing;
  return [...fresh, ...existing].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, cap);
}

// ---- Filtering ----
export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom" | "all";
export interface ActivityFilter { employee?: string; type?: EventType | ""; module?: CrmModule | ""; lead?: string; importance?: Importance | ""; range?: RangeKey; from?: string; to?: string; q?: string }

/** Inclusive [start, end) window in business time (IST, UTC+5:30). Dates are YYYY-MM-DD. */
export function rangeWindow(range: RangeKey | undefined, now: Date, from?: string, to?: string): { start: number; end: number } {
  const IST = 330 * 60000;
  const dayStart = (d: Date) => { const t = d.getTime() + IST; return t - (t % 86400000) - IST; };
  const today = dayStart(now), end = today + 86400000;
  switch (range ?? "30d") {
    case "today": return { start: today, end };
    case "7d": return { start: today - 6 * 86400000, end };
    case "30d": return { start: today - 29 * 86400000, end };
    case "90d": return { start: today - 89 * 86400000, end };
    case "custom": {
      const s = from ? Date.parse(`${from}T00:00:00+05:30`) : -Infinity, e = to ? Date.parse(`${to}T00:00:00+05:30`) + 86400000 : Infinity;
      return { start: Number.isNaN(s) ? -Infinity : s, end: Number.isNaN(e) ? Infinity : e };
    }
    default: return { start: -Infinity, end: Infinity };
  }
}

export function filterEvents(events: ActivityEvent[], f: ActivityFilter, now: Date): ActivityEvent[] {
  const { start, end } = rangeWindow(f.range, now, f.from, f.to);
  const q = f.q?.trim().toLowerCase();
  return events.filter((e) => {
    const t = Date.parse(e.occurredAt);
    if (t < start || t >= end) return false;
    if (f.employee && e.actorUserId !== f.employee && e.targetEmployeeId !== f.employee) return false;
    if (f.type && e.eventType !== f.type) return false;
    if (f.module && e.module !== f.module) return false;
    if (f.importance && e.importance !== f.importance) return false;
    if (f.lead && e.relatedLeadId !== f.lead && !((e.newValues?.["leadIds"] as string[] | undefined)?.includes(f.lead))) return false;
    if (q && !`${e.summary} ${e.actorName} ${EVENT_LABEL[e.eventType]}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Team Activity is Owner-only; no permission override can grant company-wide monitoring. */
export const canViewTeamActivity = (actor: "owner" | { employeeId: string }) => actor === "owner";

// ---- Notifications ----
export type NotifyCategory = "leads" | "calls" | "followups" | "overdue" | "deals" | "assignments" | "payments" | "team" | "projects";
export const NOTIFY_CATEGORIES: { id: NotifyCategory; label: string; desc: string }[] = [
  { id: "leads", label: "New & Hot leads", desc: "A lead is created or becomes Hot." },
  { id: "calls", label: "Call logs", desc: "A call outcome is logged." },
  { id: "followups", label: "Follow-up completions", desc: "A follow-up is marked done." },
  { id: "overdue", label: "Overdue follow-ups", desc: "A pending follow-up passes its scheduled time." },
  { id: "deals", label: "Pipeline, Won & Lost", desc: "Stage changes and closed deals." },
  { id: "assignments", label: "Assignments", desc: "Leads assigned, reassigned or distributed in bulk." },
  { id: "payments", label: "Payments", desc: "A payment is recorded, updated or voided." },
  { id: "team", label: "Team & permissions", desc: "Employee account or permission changes." },
  { id: "projects", label: "Projects", desc: "New projects, deliveries and support requests." },
];
export type NotifyPrefs = Record<NotifyCategory, boolean>;
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { leads: true, calls: true, followups: true, overdue: true, deals: true, assignments: true, payments: true, team: true, projects: true };

/** Which events notify, and under which category. Trivial edits (lead.edited, reschedules, notes) never notify. */
export const NOTIFY_OF: Partial<Record<EventType, NotifyCategory>> = {
  "lead.created": "leads", "lead.hot": "leads", "call.logged": "calls", "followup.completed": "followups",
  "pipeline.stage_changed": "deals", "deal.won": "deals", "deal.lost": "deals",
  "lead.reassigned": "assignments", "bulk.completed": "assignments", "bulk.reversed": "assignments",
  "automation.reminder": "followups", "automation.escalated": "overdue",
  "payment.recorded": "payments", "payment.updated": "payments",
  "employee.status_changed": "team", "employee.permissions_changed": "team", "employee.added": "team",
  "project.created": "projects", "project.delivered": "projects", "project.support_request_created": "projects", "project.started": "projects",
};

export interface Notification { id: string; category: NotifyCategory; title: string; body: string; at: string; importance: Importance; leadId?: string; employeeId?: string; eventId?: string; source: EventSource }
export interface ReadState { readAllAt: string | null; ids: string[] }
export const EMPTY_READS: ReadState = { readAllAt: null, ids: [] };

export function deriveNotifications(events: ActivityEvent[], followUps: FollowUp[], leads: Lead[], prefs: NotifyPrefs, now: Date, limit = 60): Notification[] {
  const out: Notification[] = [];
  for (const e of events) {
    const cat = NOTIFY_OF[e.eventType];
    if (!cat || prefs[cat] === false) continue;
    out.push({ id: `n:${e.eventId}`, category: cat, title: EVENT_LABEL[e.eventType], body: e.summary, at: e.occurredAt, importance: e.importance, ...(e.relatedLeadId ? { leadId: e.relatedLeadId } : {}), ...(e.targetEmployeeId ? { employeeId: e.targetEmployeeId } : {}), eventId: e.eventId, source: e.eventSource });
  }
  if (prefs.overdue) {
    const name = new Map(leads.map((l) => [l.id, l.name]));
    for (const f of followUps) {
      if (f.completedAt || f.cancelledAt || !name.has(f.leadId) || Date.parse(f.dueAt) >= now.getTime()) continue;
      out.push({ id: `overdue:${f.id}`, category: "overdue", title: "Follow-up overdue", body: `Follow-up with ${name.get(f.leadId)} is overdue.`, at: f.dueAt, importance: "high", leadId: f.leadId, source: "local" });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export const isRead = (n: Notification, r: ReadState) => r.ids.includes(n.id) || (!!r.readAllAt && n.at <= r.readAllAt);
export const unreadCount = (list: Notification[], r: ReadState) => list.filter((n) => !isRead(n, r)).length;
export const markRead = (r: ReadState, id: string): ReadState => (r.ids.includes(id) ? r : { ...r, ids: [id, ...r.ids].slice(0, 500) });
export const markAllRead = (now: string): ReadState => ({ readAllAt: now, ids: [] });

/** Deep link for a notification: lead → Pipeline inspector, employee → Team inspector, otherwise Team Activity. */
export function notificationLink(n: Notification): { to: "/pipeline"; search: { lead: string } } | { to: "/team"; search: { employee: string } } | { to: "/team-activity"; search: { event?: string } } {
  if (n.leadId) return { to: "/pipeline", search: { lead: n.leadId } };
  if (n.employeeId) return { to: "/team", search: { employee: n.employeeId } };
  return { to: "/team-activity", search: n.eventId ? { event: n.eventId } : {} };
}

// ---- Employee monitoring (derived from real records only) ----
export interface EmployeeStats { assigned: number; qualified: number; won: number; openFollowUps: number; overdue: number; completedFollowUps: number; calls: number; lastActivityAt: string | null }
export function employeeStats(employeeId: string, s: Pick<EventSnap, "leads" | "followUps" | "activities" | "assignments">, events: ActivityEvent[], window: { start: number; end: number }, now: Date): EmployeeStats {
  const mine = new Set(s.leads.filter((l) => s.assignments[l.id]?.employeeId === employeeId).map((l) => l.id));
  const inWin = (iso: string | undefined) => { if (!iso) return false; const t = Date.parse(iso); return t >= window.start && t < window.end; };
  const leads = s.leads.filter((l) => mine.has(l.id));
  const fus = s.followUps.filter((f) => mine.has(f.leadId) && !f.cancelledAt);
  const pending = fus.filter((f) => !f.completedAt);
  const last = events.filter((e) => e.actorUserId === employeeId && e.eventSource !== "demo").map((e) => e.occurredAt).sort().at(-1) ?? null;
  return {
    assigned: leads.length,
    qualified: leads.filter((l) => ["qualified", "proposal", "won"].includes(l.status)).length,
    won: leads.filter((l) => l.status === "won").length,
    openFollowUps: pending.length,
    overdue: pending.filter((f) => Date.parse(f.dueAt) < now.getTime()).length,
    completedFollowUps: fus.filter((f) => inWin(f.completedAt)).length,
    calls: s.activities.filter((a) => a.type === "call" && mine.has(a.leadId) && inWin(a.at)).length,
    lastActivityAt: last,
  };
}

// ---- Demo Event Simulation (never persisted, never counted, never backed up) ----
export function simulateDemoEvents(employees: Employee[], leads: Lead[], now: Date): ActivityEvent[] {
  const emps = employees.filter((e) => e.accountStatus === "active").slice(0, 3);
  if (!emps.length || !leads.length) return [];
  const kinds: EventType[] = ["call.logged", "followup.completed", "pipeline.stage_changed", "lead.created", "client.note_added"];
  const out: ActivityEvent[] = [];
  let i = 0;
  for (const e of emps) for (const k of kinds) {
    const l = leads[i % leads.length]!;
    const at = new Date(now.getTime() - (i + 1) * 47 * 60000).toISOString();
    const text: Record<string, string> = {
      "call.logged": `${e.name} logged a call outcome for ${l.name}: Interested.`,
      "followup.completed": `${e.name} completed a follow-up with ${l.name}.`,
      "pipeline.stage_changed": `${e.name} changed ${l.name}'s Lead stage from Contacted to Qualified.`,
      "lead.created": `${e.name} created lead ${l.name}.`,
      "client.note_added": `${e.name} added a client note to ${l.name}.`,
    };
    out.push({ eventId: `demo:${e.id}:${k}:${i}`, eventType: k, actorUserId: e.id, actorRole: e.roleId, actorName: e.name, entityType: "lead", entityId: l.id, relatedLeadId: l.id, occurredAt: at, summary: `${text[k]} (Demo)`, module: MODULE_OF[k], importance: IMPORTANCE[k] ?? "normal", operationId: `demo:${i}`, eventSource: "demo", schemaVersion: EVENT_SCHEMA_VERSION });
    i++;
  }
  return out;
}

// ---- Real-time readiness ----
/** Future live feed contract (WebSocket/SSE from the Hostinger backend). Nothing implements it locally. */
export interface ActivityFeed {
  connect(onEvents: (events: ActivityEvent[]) => void, onStatus: (s: "connecting" | "live" | "offline") => void): () => void;
  /** Replay events after a cursor when reconnecting; merged through `mergeEvents`, so repeats are harmless. */
  since(cursor: string | null): Promise<ActivityEvent[]>;
}
