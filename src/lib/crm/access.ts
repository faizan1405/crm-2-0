// Phase 3B — permissions, lead assignment and rule evaluation (pure, backend-agnostic).
// These are SPECIFICATIONS + UI simulation. Browser-local state is never a security boundary;
// the future Hostinger backend must enforce every rule here from the authenticated session.
import type { Employee } from "./team";
import type { Lead, LeadPriority, LeadSource, LeadStatus, FollowUp } from "./types";

export type ActionKey = string; // `${module}.${action}`
export interface PermAction { key: ActionKey; label: string; desc: string; sensitive?: boolean }
export interface PermModule { id: string; label: string; desc: string; actions: PermAction[]; ownerOnly?: boolean }

const a = (m: string, act: string, label: string, desc: string, sensitive = false): PermAction => ({ key: `${m}.${act}`, label, desc, ...(sensitive ? { sensitive } : {}) });

export const MODULES: PermModule[] = [
  { id: "dashboard", label: "Dashboard", desc: "Their own day at a glance.", actions: [a("dashboard", "view", "View dashboard", "Shows only figures from records they can access.")] },
  { id: "leads", label: "Leads", desc: "Prospect records in their scope.", actions: [
    a("leads", "view", "View leads", "See leads inside their lead scope."), a("leads", "create", "Create leads", "Add new prospects."),
    a("leads", "edit", "Edit leads", "Update details, stage and quick status."), a("leads", "delete", "Delete leads", "Move leads to Waste or Recently Deleted.", true),
    a("leads", "assign", "Assign leads", "Hand leads to other employees.", true), a("leads", "manage_all", "Manage all leads", "Act on every lead, not just their own. Also needs All Leads scope.", true)] },
  { id: "pipeline", label: "Pipeline", desc: "Stage board for leads in scope.", actions: [a("pipeline", "view", "View pipeline", "Board of leads they can see."), a("pipeline", "edit", "Move stages", "Drag or change a lead's stage.")] },
  { id: "followups", label: "Follow-ups", desc: "Agenda for their leads.", actions: [a("followups", "view", "View follow-ups", "Only follow-ups for leads in scope."), a("followups", "create", "Schedule follow-ups", "Book new follow-ups."), a("followups", "edit", "Complete & reschedule", "Mark done or move follow-ups.")] },
  { id: "clients", label: "Client information", desc: "Phone, email and conversation history.", actions: [a("clients", "view", "View client details", "Phone, email and history for leads in scope."), a("clients", "calls", "Log calls", "Record call outcomes."), a("clients", "whatsapp", "Open WhatsApp", "Send approved WhatsApp templates.")] },
  { id: "deals", label: "Deals & Payments", desc: "Money. Governed by the finance level too.", actions: [a("deals", "view", "View deals", "Deals of clients in scope, at the chosen finance level.", true), a("deals", "create", "Create deals", "Open new deals.", true), a("deals", "edit", "Record payments", "Add or void payments.", true), a("deals", "delete", "Delete deals", "Cancel deals.", true)] },
  { id: "proofs", label: "Payment proofs", desc: "Screenshots and PDFs. Always needs its own permission.", actions: [a("proofs", "view", "View proofs", "Open payment screenshots.", true), a("proofs", "upload", "Upload", "Attach a new proof.", true), a("proofs", "replace", "Replace", "Swap an attached proof.", true), a("proofs", "remove", "Remove", "Delete an attached proof.", true), a("proofs", "download", "Download", "Save proofs to their device.", true)] },
  { id: "analytics", label: "Analytics", desc: "Charts. Company-wide view is sensitive.", actions: [a("analytics", "view", "View own analytics", "Charts from their own leads only."), a("analytics", "company", "Company-wide analytics", "Totals across the whole business, including revenue.", true)] },
  { id: "studio", label: "Sales Studio", desc: "Shared sales assets.", actions: [a("studio", "view", "Open Sales Studio", "Browse the studio.")] },
  { id: "quotations", label: "Quotation templates", desc: "Reusable package messages.", actions: [a("quotations", "use", "Use packages", "Send packages in WhatsApp."), a("quotations", "manage", "Manage packages", "Create, edit and delete packages.", true)] },
  { id: "templates", label: "WhatsApp templates", desc: "Message drafts.", actions: [a("templates", "use", "Use templates", "Pick approved templates."), a("templates", "manage", "Manage templates", "Create, edit and delete templates.", true)] },
  { id: "demos", label: "Demo library", desc: "Portfolio links.", actions: [a("demos", "use", "Share demos", "Include demos in messages."), a("demos", "manage", "Manage demos", "Add, edit and remove demos.", true)] },
  { id: "notes", label: "Own notebook", desc: "Their own private notes. Never the Owner's.", actions: [a("notes", "own", "Own private notes", "A personal notebook only they see.")] },
  { id: "briefing", label: "Daily Briefing", desc: "Morning plan.", actions: [a("briefing", "view", "View briefing", "Built only from leads in scope.")] },
  { id: "import", label: "Data import", desc: "Bulk add.", actions: [a("import", "run", "Import leads", "Bulk add or paste leads.", true)] },
  { id: "export", label: "Data export", desc: "Downloads leave the CRM.", actions: [a("export", "run", "Export data", "Download CSV/JSON of records in scope.", true)] },
  { id: "team", label: "Team Management", desc: "Owner only — cannot be granted.", ownerOnly: true, actions: [a("team", "manage", "Manage team", "Employees, permissions and assignment rules.", true)] },
  { id: "settings", label: "Administrative settings", desc: "Business-wide preferences.", actions: [a("settings", "manage", "Manage settings", "Change company settings and reset data.", true)] },
];
export const ALL_KEYS: ActionKey[] = MODULES.flatMap((m) => m.actions.map((x) => x.key));
export const OWNER_ONLY_KEYS: ActionKey[] = MODULES.filter((m) => m.ownerOnly).flatMap((m) => m.actions.map((x) => x.key));

export type LeadScope = "assigned" | "all";
export type FinanceLevel = "none" | "status" | "amounts" | "manage";
export const FINANCE_LABEL: Record<FinanceLevel, string> = { none: "No finance access", status: "Payment status only", amounts: "Assigned-client amounts", manage: "Payment management" };
export const SCOPE_LABEL: Record<LeadScope, string> = { assigned: "Assigned only", all: "All leads" };

export interface RolePreset { allowed: ActionKey[]; leadScope: LeadScope; finance: FinanceLevel }
const SALES_BASE = ["dashboard.view", "leads.view", "leads.edit", "pipeline.view", "pipeline.edit", "followups.view", "followups.create", "followups.edit", "clients.view", "clients.calls", "clients.whatsapp", "studio.view", "quotations.use", "templates.use", "demos.use", "notes.own", "briefing.view", "analytics.view"];
export const ROLE_PRESETS: Record<Employee["roleId"], RolePreset> = {
  salesperson: { allowed: SALES_BASE, leadScope: "assigned", finance: "none" },
  sales_manager: { allowed: [...SALES_BASE, "leads.create", "leads.assign", "deals.view", "import.run"], leadScope: "all", finance: "status" },
  custom: { allowed: ["dashboard.view", "notes.own"], leadScope: "assigned", finance: "none" },
};

/** Employee-specific settings. Overrides never touch the role preset or other employees. */
export interface EmployeeAccess { overrides: Record<ActionKey, boolean>; leadScope?: LeadScope; finance?: FinanceLevel; updatedAt: string }
export type Reason = "owner" | "override-allow" | "override-deny" | "role" | "default-deny" | "owner-only";
export interface Effective { allowed: Set<ActionKey>; reason: (k: ActionKey) => Reason; leadScope: LeadScope; finance: FinanceLevel; can: (k: ActionKey) => boolean }

/** Resolution order: Owner → owner-only lock → explicit employee override → role default → deny. */
export function resolve(roleId: Employee["roleId"] | "owner", access?: EmployeeAccess): Effective {
  if (roleId === "owner") { const all = new Set(ALL_KEYS); return { allowed: all, reason: () => "owner", leadScope: "all", finance: "manage", can: () => true }; }
  const preset = ROLE_PRESETS[roleId];
  const reason = (k: ActionKey): Reason => {
    if (OWNER_ONLY_KEYS.includes(k)) return "owner-only";
    const o = access?.overrides[k];
    if (o === true) return "override-allow";
    if (o === false) return "override-deny";
    return preset.allowed.includes(k) ? "role" : "default-deny";
  };
  const allowed = new Set(ALL_KEYS.filter((k) => ["override-allow", "role"].includes(reason(k))));
  let finance = access?.finance ?? preset.finance;
  if (!allowed.has("deals.view")) finance = "none";
  return { allowed, reason, leadScope: access?.leadScope ?? preset.leadScope, finance, can: (k) => allowed.has(k) };
}
export const REASON_LABEL: Record<Reason, string> = { owner: "Owner always has full access", "override-allow": "Allowed for this employee only", "override-deny": "Blocked for this employee only", role: "Role default", "default-deny": "Off by default", "owner-only": "Owner only — can't be granted" };

/** Set a toggle as an override, dropping it when it equals the role default (keeps overrides minimal). */
export function setOverride(roleId: Employee["roleId"], o: Record<ActionKey, boolean>, key: ActionKey, value: boolean): Record<ActionKey, boolean> {
  if (OWNER_ONLY_KEYS.includes(key)) return o;
  const next = { ...o };
  if (ROLE_PRESETS[roleId].allowed.includes(key) === value) delete next[key]; else next[key] = value;
  return next;
}
/** Human consequences shown under a toggle when it unlocks more than it says. */
export function consequence(key: ActionKey): string | null {
  return ({ "deals.view": "Unlocks the finance level below. Without it, finance stays hidden everywhere.", "leads.manage_all": "Only effective together with All Leads scope.", "analytics.company": "Reveals company-wide revenue totals.", "proofs.download": "Files can leave the CRM on their device.", "export.run": "Downloads include every record in their scope." } as Record<string, string>)[key] ?? null;
}

// ---------- Assignment ----------
export interface Assignment { employeeId: string; assignedAt: string; source: string; manual: boolean }
export type AssignmentAction = "assign" | "reassign" | "unassign" | "auto";
/** Local prototype event — not a trusted audit record. */
export interface AssignmentEvent { id: string; leadId: string; previousAssigneeId: string | null; newAssigneeId: string | null; action: AssignmentAction; at: string; source: string }

export function applyAssign(cur: Record<string, Assignment>, leadIds: string[], employeeId: string | null, now: string, source: string, manual: boolean, mkId: () => string) {
  const next = { ...cur }; const events: AssignmentEvent[] = [];
  for (const id of leadIds) {
    const prev = cur[id]?.employeeId ?? null;
    if (prev === employeeId) continue;
    if (employeeId) next[id] = { employeeId, assignedAt: now, source, manual }; else delete next[id];
    events.push({ id: mkId(), leadId: id, previousAssigneeId: prev, newAssigneeId: employeeId, action: !manual ? "auto" : employeeId === null ? "unassign" : prev ? "reassign" : "assign", at: now, source });
  }
  return { next, events };
}
export const assignable = (e: Employee) => e.accountStatus === "active" || e.accountStatus === "pending";

// ---------- Rules ----------
export type RuleTrigger = "lead_created" | "stage_entered";
export interface RuleConditions { source?: LeadSource; priority?: LeadPriority; stage?: LeadStatus }
export interface AssignmentRule { id: string; name: string; trigger: RuleTrigger; conditions: RuleConditions; targetEmployeeId: string; priority: number; enabled: boolean; createdAt: string; updatedAt: string }
export interface RuleSettings { autoEnabled: boolean; replaceExisting: boolean }
export const DEFAULT_RULE_SETTINGS: RuleSettings = { autoEnabled: false, replaceExisting: false };

export function ruleMatches(r: AssignmentRule, lead: Lead, trigger: RuleTrigger): boolean {
  if (!r.enabled || r.trigger !== trigger) return false;
  const c = r.conditions;
  return (!c.source || c.source === lead.source) && (!c.priority || c.priority === lead.priority) && (!c.stage || c.stage === lead.status);
}
export type RuleOutcome = { winner?: AssignmentRule; matches: AssignmentRule[]; blocked?: string };
/** Deterministic: lowest priority number wins, then oldest rule. */
export function evaluate(lead: Lead, trigger: RuleTrigger, rules: AssignmentRule[], employees: Employee[], current: Assignment | undefined, settings: RuleSettings): RuleOutcome {
  const matches = rules.filter((r) => ruleMatches(r, lead, trigger)).sort((x, y) => x.priority - y.priority || x.createdAt.localeCompare(y.createdAt));
  const winner = matches.find((r) => { const e = employees.find((x) => x.id === r.targetEmployeeId); return e && assignable(e); });
  if (!matches.length) return { matches };
  if (!winner) return { matches, blocked: "Every matching rule targets an inactive or removed employee." };
  if (current?.manual && !settings.replaceExisting) return { matches, blocked: "Lead is manually assigned; rules don't replace it." };
  if (current && !settings.replaceExisting) return { matches, blocked: "Lead already has an assignee." };
  if (current?.employeeId === winner.targetEmployeeId) return { matches, blocked: "Already assigned to this employee." };
  return { winner, matches };
}
/** Key used to fire a rule once per lead per event — prevents repeated reassignment. */
export const fireKey = (r: AssignmentRule, leadId: string, trigger: RuleTrigger, stage: LeadStatus) => `${r.id}:${leadId}:${trigger}:${trigger === "stage_entered" ? stage : ""}`;
export function ruleError(r: Pick<AssignmentRule, "name" | "trigger" | "conditions" | "targetEmployeeId">, employees: Employee[]): string | null {
  if (!r.name.trim()) return "Name the rule.";
  const e = employees.find((x) => x.id === r.targetEmployeeId);
  if (!e) return "Choose a target employee.";
  if (!assignable(e)) return "Inactive employees can't receive leads.";
  if (r.trigger === "stage_entered" && !r.conditions.stage) return "Choose the stage that triggers the rule.";
  return null;
}

// ---------- Employee workspace (preview + future API shape) ----------
export function leadsInScope(leads: Lead[], employeeId: string, eff: Effective, assignments: Record<string, Assignment>): Lead[] {
  if (!eff.can("leads.view")) return [];
  return eff.leadScope === "all" ? leads : leads.filter((l) => assignments[l.id]?.employeeId === employeeId);
}
export function workspaceFor(employeeId: string, eff: Effective, data: { leads: Lead[]; followUps: FollowUp[]; assignments: Record<string, Assignment> }) {
  const leads = leadsInScope(data.leads, employeeId, eff, data.assignments);
  const ids = new Set(leads.map((l) => l.id));
  const followUps = eff.can("followups.view") ? data.followUps.filter((f) => ids.has(f.leadId)) : [];
  const nav = MODULES.filter((m) => !m.ownerOnly && m.actions.some((x) => eff.can(x.key)) && !["import", "export", "settings"].includes(m.id)).map((m) => m.id);
  return { leads, followUps, nav };
}
