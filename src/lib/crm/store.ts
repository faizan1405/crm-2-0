// Single local demo store for Scale Flow CRM 2.0.
// Integration point: replace these actions with API calls in the backend phase.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lead, Deal, Payment, FollowUp, Note, LeadActivity, BinEntry } from "./types";
import { mergePatch, QUICK_LABEL, type QuickStatus } from "./leadtools";
import type { ParsedLead } from "./parse";
import { isPending, activeFollowUp } from "./followups";
import { isConnectedOutcome, outcomeQuick, type CallOutcome } from "./calllog";

export type FollowUpResult = { ok: true; id: string } | { ok: false; conflict?: FollowUp; error?: string };
export interface CallLogInput {
  opId: string;
  leadId: string;
  outcome: CallOutcome;
  notes?: string;
  stage: Lead["status"];
  lostReason?: string;
  source: string;
  followUp?: { dueAt: string; type: FollowUp["type"]; note?: string };
  /** Required when the lead already has an active follow-up and followUp is set. */
  onConflict?: "keep" | "replace";
}
type LeadSnap = { status: Lead["status"]; lostReason: string | undefined; lastContact: string | undefined; nextFollowUp: string | undefined; quickStatus: Lead["quickStatus"] };
export interface CallOp {
  id: string;
  leadId: string;
  at: string;
  before: LeadSnap;
  after: LeadSnap;
  activityId: string;
  followUpId?: string;
  followUpDueAt?: string;
  replacedId?: string;
  undone?: boolean;
}
export type CallLogResult = { ok: true; opId: string } | { ok: false; conflict?: FollowUp; error?: string };
import { demoLeads, demoDeals, demoPayments, demoFollowUps, demoNotes, demoActivities } from "./demo";
import { uid, digits, dayKey } from "./format";
import { dealOutstanding } from "./finance";
import { leadEditError } from "./validation";
import { applyAssign, assignable, evaluate, fireKey, ruleError, DEFAULT_RULE_SETTINGS, OWNER_ONLY_KEYS, type Assignment, type AssignmentEvent, type AssignmentRule, type EmployeeAccess, type RuleSettings, type RuleTrigger } from "./access";
import type { BackupRecord } from "./vault";
import type { PlanItem, SkipReason } from "./bulk";
import { buildEmployee, employeeError, withStatus, type AccountStatus, type Employee, type EmployeeInput } from "./team";
import { builtInTemplates, DEFAULT_DEMO_CATEGORIES, quotationTemplateError, safeUrl, type BusinessProfile, type Demo, type LegacyQuotation, type QuotationShare, type QuotationTemplate, type WaTemplate } from "./studio";
import { activePreview, allows, previewSink, type CrmEventType } from "./session";
import { DEFAULT_AUTOMATION_SETTINGS, planRule, reconcileReminders, ruleError as automationRuleError, ruleFromTemplate, type AutomationRule, type AutomationRun, type AutomationSettings, type Reminder, type RuleStatus } from "./automation";
import { pairKey, pairSignature, type InboxMeta, type LeadRelation, type RelationKind } from "./inbox";
import { buildGoal, goalError, reviseGoal, mergeAlerts, DEFAULT_PERF_PREFS, type GoalAlert, type GoalDef, type GoalInput, type GoalRevision, type GoalStatus, type PerfPrefs } from "./performance";
import { activeFields, bulkTag, fieldDefError, matchCondition, filterFields, removedUsedOptions, starterViews, tagError, typeChangeImpact, convertValue, undoTags, validateLeadValues, viewEditable, viewError, viewIssues, CUSTOMIZE_SCHEMA, type CustomFieldDef, type FieldValues, type FieldValue, type LeadTags, type SavedView, type TagDef, type ViewCtx, type ViewPrefs, type Viewer, type ViewCondition } from "./customize";
import { createProjectSlice, migrateProjects, type ProjectSlice } from "./projectStore";
import { deriveEvents, mergeEvents, markRead, markAllRead, DEFAULT_NOTIFY_PREFS, EMPTY_READS, OWNER_ACTOR_ID, type ActivityEvent, type EventSnap, type NotifyPrefs, type ReadState } from "./activity";

// ---- Preview guards: every action is checked against the previewed employee's permissions (Owner: always allowed). ----
const DENIED = "Not allowed by this employee's permissions.";
const statusOnly = (patch: object) => Object.keys(patch).every((k) => k === "status" || k === "lostReason");
type Guard = [perm: string | ((...a: never[]) => string | string[]), denied: unknown, event?: CrmEventType];
const GUARDS: Record<string, Guard> = {
  addLead: ["leads.create", "", "lead.created"],
  updateLead: [((_id: string, patch: object) => (statusOnly(patch) ? ["pipeline.edit", "leads.edit"] : "leads.edit")) as never, false, "lead.updated"],
  deleteLead: ["leads.delete", undefined], wasteLead: ["leads.delete", undefined], restoreLead: ["leads.delete", DENIED], purgeBin: ["leads.delete", undefined], emptyBin: ["leads.delete", undefined],
  addActivity: ["leads.view", undefined, "client.note_added"], mergeIntoLead: ["leads.edit", false], setQuickStatus: ["leads.edit", undefined],
  addDeal: ["deals.create", undefined], addPayment: ["__finance", false], voidPayment: ["__finance", undefined],
  addFollowUp: ["followups.create", { ok: false, error: DENIED }, "followup.created"], completeFollowUp: ["followups.edit", undefined, "followup.completed"], rescheduleFollowUp: ["followups.edit", undefined],
  logCall: ["clients.calls", { ok: false, error: DENIED }, "call.logged"], undoCall: ["clients.calls", DENIED],
  saveNote: ["notes.own", undefined], deleteNote: ["notes.own", undefined],
  saveQuotationTemplate: ["quotations.manage", DENIED], duplicateQuotationTemplate: ["quotations.manage", undefined], deleteQuotationTemplate: ["quotations.manage", undefined], setQuotationTemplateActive: ["quotations.manage", undefined], moveQuotationTemplate: ["quotations.manage", undefined], logQuotationShare: ["quotations.use", ""],
  saveTemplate: ["templates.manage", undefined], deleteTemplate: ["templates.manage", undefined], setDefaultTemplate: ["templates.manage", undefined], resetTemplates: ["templates.manage", undefined],
  saveDemo: ["demos.manage", false], deleteDemo: ["demos.manage", undefined], moveDemo: ["demos.manage", undefined], addDemoCategory: ["demos.manage", undefined],
  markReviewed: ["leads.edit", 0], unmarkReviewed: ["leads.edit", undefined], flagDuplicate: ["leads.edit", undefined], unflagDuplicate: ["leads.edit", undefined], resolveDuplicate: ["__owner", undefined], clearRelation: ["__owner", undefined],
  saveAutomationRule: ["__owner", DENIED], setAutomationStatus: ["__owner", DENIED], duplicateAutomationRule: ["__owner", undefined], addRuleFromTemplate: ["__owner", undefined], setAutomationSettings: ["__owner", undefined],
  runAutomations: ["__owner", { created: 0, resolved: 0 }], completeReminder: ["followups.view", undefined], dismissReminder: ["followups.view", undefined],
  assignLeads: ["leads.assign", { ok: false, error: DENIED }, "lead.assigned"], restoreAssignments: ["leads.assign", undefined], applyAssignmentPlan: ["leads.assign", { ok: false, error: DENIED }, "lead.assigned"],
  saveBusinessProfile: ["__owner", undefined], reset: ["__owner", undefined], logBackup: ["__owner", undefined], deleteLegacyQuotations: ["__owner", undefined],
  addEmployee: ["__owner", { ok: false, error: DENIED }], updateEmployee: ["__owner", DENIED], setEmployeeStatus: ["__owner", undefined], saveEmployeeAccess: ["__owner", undefined],
  saveCustomField: ["__owner", DENIED], setCustomFieldStatus: ["__owner", undefined], moveCustomField: ["__owner", undefined], saveTag: ["__owner", DENIED], setTagStatus: ["__owner", undefined],
  setLeadFieldValues: ["leads.edit", { ok: false, errors: { _: DENIED } }], setLeadTags: ["leads.edit", false], bulkTagLeads: ["leads.edit", { changed: 0, before: {}, applied: {} }], undoBulkTags: ["leads.edit", { restored: 0, kept: 0 }],
  saveView: ["leads.view", { ok: false, error: DENIED }], deleteView: ["leads.view", undefined], duplicateView: ["leads.view", undefined], setViewPref: ["leads.view", undefined],
  saveGoal: ["__owner", DENIED], setGoalStatus: ["__owner", undefined], duplicateGoal: ["__owner", undefined], setPerfPrefs: ["__owner", undefined], recordGoalAlerts: ["__owner", undefined],
  createProject: ["projects.create", { ok: false, error: DENIED }], updateProject: ["projects.edit", DENIED], setProjectStatus: ["projects.stage", undefined], moveProjectStage: ["projects.stage", null], undoProjectStage: ["projects.stage", false], archiveProject: ["__owner", undefined],
  addProjectNote: ["projects.notes", DENIED], addTask: ["projects.tasks_add", { ok: false, error: DENIED }], updateTask: ["projects.view", DENIED], setTaskDone: ["projects.view", false], moveTask: ["projects.tasks_edit", undefined], addMilestone: ["projects.tasks_add", DENIED],
  toggleCheck: ["projects.edit", undefined], addCheck: ["projects.edit", DENIED], addDependency: ["projects.edit", DENIED], toggleDependency: ["projects.edit", undefined], addProjectLink: ["projects.edit", DENIED], deliverProject: ["projects.edit", DENIED],
  saveSupport: ["__owner", DENIED], addSupportRequest: ["projects.support", { ok: false, error: DENIED }], updateSupportRequest: ["projects.support", DENIED], saveProjectTemplate: ["__owner", DENIED],
  saveRule: ["__owner", DENIED], deleteRule: ["__owner", undefined], moveRule: ["__owner", undefined], setRuleSettings: ["__owner", undefined], applyRulesToExisting: ["__owner", 0],
};
/** Actions never recorded as Team Activity (bulk reset would be noise; settings/templates are not team activity). */
const UNRECORDED = new Set(["reset", "logBackup", "recordGoalAlerts", "setPerfPrefs", "setViewPref"]);
const snapOf = (s: CRMState): EventSnap => ({ leads: s.leads, followUps: s.followUps, deals: s.deals, payments: s.payments, activities: s.activities, assignments: s.assignments, employees: s.employees, employeeAccess: s.employeeAccess, inboxMeta: s.inboxMeta, leadRelations: s.leadRelations, reminders: s.reminders, leadTags: s.leadTags, fieldValues: s.fieldValues, customFields: s.customFields, tagDefs: s.tagDefs, savedViews: s.savedViews, projects: s.projects, projectTasks: s.projectTasks, supportRequests: s.supportRequests });
let depth = 0;
function guarded<T extends object>(state: T, get: () => CRMState, set: (p: Partial<CRMState>) => void): T {
  const out = { ...state } as Record<string, unknown>;
  for (const [name, [perm, denied, event]] of Object.entries(GUARDS)) {
    const fn = out[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof fn !== "function") continue;
    out[name] = (...args: unknown[]) => {
      const pv = activePreview();
      if (!pv) {
        // Owner action: record Team Activity from the real before/after state (outermost action only).
        if (depth > 0 || UNRECORDED.has(name)) return fn(...args);
        const before = snapOf(get()); depth++;
        let r: unknown;
        try { r = fn(...args); } finally { depth--; }
        const after = get();
        const at = new Date().toISOString();
        const evts = deriveEvents(before, snapOf(after), { action: name, operationId: uid("op"), at, actor: name === "runAutomations" ? { id: "automation", role: "automation", name: "Automation" } : { id: OWNER_ACTOR_ID, role: "owner", name: after.owner || "Owner" } });
        if (evts.length) set({ teamEvents: mergeEvents(after.teamEvents, evts) });
        return r;
      }
      const need = typeof perm === "function" ? (perm as (...a: unknown[]) => string | string[])(...args) : perm;
      const ok = Array.isArray(need) ? need.some((p) => allows(pv, p)) : allows(pv, need);
      if (!ok) return denied;
      const r = fn(...args);
      if (event && r !== false && !(r && typeof r === "object" && "ok" in r && !(r as { ok: boolean }).ok)) {
        const type: CrmEventType = name === "updateLead" && statusOnly(args[1] as object) ? "pipeline.stage_changed" : event;
        previewSink.emit({ id: uid("evt"), type, actorId: pv.employeeId, at: new Date().toISOString(), resourceId: typeof r === "string" && r ? r : String(args[0] ?? ""), change: args[1] });
      }
      return r;
    };
  }
  return out as T;
}
/** localStorage that is never written while a preview runs — the Owner's saved data stays exactly as it was. */
const guardedStorage = {
  getItem: (k: string) => localStorage.getItem(k),
  setItem: (k: string, v: string) => { if (!activePreview()) localStorage.setItem(k, v); },
  removeItem: (k: string) => { if (!activePreview()) localStorage.removeItem(k); },
};

export type ThemePref = "light" | "dark" | "system";
export interface Prefs {
  owner: string;
  email: string;
  business: string;
  theme: ThemePref;
  accent: "indigo" | "emerald" | "blue";
  density: "comfortable" | "compact";
  timeFormat: "12h" | "24h";
  dateStyle: "short" | "long";
  defaultLeadSort: "recent" | "score" | "value";
  notifyFollowUps: boolean;
  notifyPayments: boolean;
  notifyDigest: boolean;
}

interface CRMState extends Prefs, ProjectSlice {
  leads: Lead[];
  deals: Deal[];
  payments: Payment[];
  followUps: FollowUp[];
  notes: Note[];
  activities: LeadActivity[];
  /** Waste + Recently Deleted leads, restorable. */
  bin: BinEntry[];
  /** Briefing checklist item keys marked done today (does not touch lead data). */
  briefingDone: string[];
  briefingDate: string;
  addLead: (lead: Omit<Lead, "id" | "createdAt" | "updatedAt">) => string;
  updateLead: (id: string, patch: Partial<Lead>) => boolean;
  /** Soft delete into Recently Deleted. */
  deleteLead: (id: string) => void;
  wasteLead: (id: string, reason?: string) => void;
  /** Returns an error message, or undefined on success. */
  restoreLead: (binId: string) => string | undefined;
  purgeBin: (binId: string) => void;
  emptyBin: (kind: BinEntry["kind"]) => void;
  mergeIntoLead: (id: string, incoming: ParsedLead, mode: "fill" | "overwrite") => boolean;
  setQuickStatus: (id: string, q: QuickStatus | undefined) => void;
  addActivity: (leadId: string, text: string, type?: LeadActivity["type"]) => void;
  addDeal: (deal: Omit<Deal, "id" | "createdAt">) => void;
  /** `id` lets callers pre-assign the identifier (e.g. to attach staged proof); rejected if already used. */
  addPayment: (payment: Omit<Payment, "id">, id?: string) => boolean;
  voidPayment: (id: string) => void;
  /** One active follow-up per lead: returns a conflict unless replaceId names the active one. Same opId never saves twice. */
  addFollowUp: (followUp: Omit<FollowUp, "id">, opts?: { replaceId?: string }) => FollowUpResult;
  callOps: CallOp[];
  logCall: (input: CallLogInput) => CallLogResult;
  /** Returns an explanation when undo is not safe, else undefined. */
  undoCall: (opId: string) => string | undefined;
  completeFollowUp: (id: string) => void;
  rescheduleFollowUp: (id: string, date: string) => void;
  saveNote: (note: Note) => void;
  deleteNote: (id: string) => void;
  toggleBriefing: (key: string) => void;
  resetBriefing: () => void;
  preferences: (patch: Partial<Prefs>) => void;
  reset: () => void;
  // Sales Studio — one shared source for quotation packages, templates and demos (not cleared by reset()).
  quotationTemplates: QuotationTemplate[];
  quotationShares: QuotationShare[];
  /** Old billing-style quotations, kept read-only as a recoverable backup. */
  legacyQuotations: LegacyQuotation[];
  waTemplates: WaTemplate[];
  demos: Demo[];
  demoCategories: string[];
  businessProfile: BusinessProfile;
  saveQuotationTemplate: (t: QuotationTemplate) => string | null;
  duplicateQuotationTemplate: (id: string) => string | undefined;
  deleteQuotationTemplate: (id: string) => void;
  setQuotationTemplateActive: (id: string, active: boolean) => void;
  moveQuotationTemplate: (id: string, dir: -1 | 1) => void;
  logQuotationShare: (s: Omit<QuotationShare, "id" | "createdAt">) => string;
  deleteLegacyQuotations: () => void;
  saveTemplate: (t: WaTemplate) => void;
  deleteTemplate: (id: string) => void;
  setDefaultTemplate: (id: string) => void;
  resetTemplates: () => void;
  saveDemo: (d: Demo) => boolean;
  deleteDemo: (id: string) => void;
  moveDemo: (id: string, dir: -1 | 1) => void;
  addDemoCategory: (name: string) => void;
  saveBusinessProfile: (p: BusinessProfile) => void;
  // Team Management (Phase 3A) — local employee profiles only, never credentials. Not cleared by reset().
  employees: Employee[];
  /** Data Vault history — genuine local backup operations only. Not cleared by reset(). */
  backupHistory: BackupRecord[];
  logBackup: (r: BackupRecord) => void;
  addEmployee: (input: EmployeeInput) => { ok: true; id: string } | { ok: false; error: string };
  updateEmployee: (id: string, input: EmployeeInput) => string | null;
  setEmployeeStatus: (id: string, status: AccountStatus) => void;
  // Phase 3B — permissions + lead assignment (local simulation; backend enforces later). Not cleared by reset().
  employeeAccess: Record<string, EmployeeAccess>;
  saveEmployeeAccess: (employeeId: string, access: Omit<EmployeeAccess, "updatedAt">) => void;
  assignments: Record<string, Assignment>;
  assignmentEvents: AssignmentEvent[];
  /** Returns how many leads changed, or an error. */
  assignLeads: (leadIds: string[], employeeId: string | null, source: string) => { ok: true; changed: number } | { ok: false; error: string };
  /** Undo helper: restores exactly the given previous assignments for these leads. */
  /** Undo: restores the previous assignments. With `expected` (what the operation set), any lead changed again since is kept as-is and counted in `kept`. */
  restoreAssignments: (snapshot: Record<string, Assignment | undefined>, expected?: Record<string, string | null>) => { restored: number; kept: number };
  /** Bulk assign/distribute: re-validates every item against current data; stale or invalid items are skipped and reported, never forced. */
  applyAssignmentPlan: (plan: PlanItem[], source: string) => { ok: true; changed: number; skipped: { leadId: string; reason: SkipReason }[]; snapshot: Record<string, Assignment | undefined> } | { ok: false; error: string };
  assignmentRules: AssignmentRule[];
  ruleSettings: RuleSettings;
  firedRules: string[];
  saveRule: (r: Omit<AssignmentRule, "createdAt" | "updatedAt" | "priority"> & { priority?: number }) => string | null;
  deleteRule: (id: string) => void;
  moveRule: (id: string, dir: -1 | 1) => void;
  setRuleSettings: (p: Partial<RuleSettings>) => void;
  /** Explicit, confirmed historical redistribution. Returns the number of leads assigned. */
  applyRulesToExisting: () => number;
  // Phase 3C — Team Activity + Smart Notifications. One activity source; notifications are derived from it.
  /** Smart Lead Inbox review state and duplicate decisions, keyed by lead id / pair key. Never edits Lead records. */
  inboxMeta: Record<string, InboxMeta>;
  leadRelations: Record<string, LeadRelation>;
  markReviewed: (ids: string[]) => number;
  unmarkReviewed: (id: string) => void;
  flagDuplicate: (id: string, note?: string) => void;
  unflagDuplicate: (id: string) => void;
  resolveDuplicate: (a: string, b: string, kind: RelationKind, note?: string) => void;
  clearRelation: (key: string) => void;
  /** Sales Automation Studio (Owner-only rules; reminders are internal tasks, never customer messages). */
  automationRules: AutomationRule[];
  reminders: Reminder[];
  automationRuns: AutomationRun[];
  automationSettings: AutomationSettings;
  saveAutomationRule: (r: AutomationRule) => string | null;
  setAutomationStatus: (id: string, status: RuleStatus) => string | null;
  duplicateAutomationRule: (id: string) => string | undefined;
  addRuleFromTemplate: (templateId: string) => string | undefined;
  setAutomationSettings: (p: Partial<AutomationSettings>) => void;
  runAutomations: (opts?: { manual?: boolean; now?: string }) => { created: number; resolved: number };
  completeReminder: (id: string) => void;
  dismissReminder: (id: string) => void;
  teamEvents: ActivityEvent[];
  notifyPrefs: NotifyPrefs;
  notifyReads: ReadState;
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  /** Real-time entry point (future backend feed / reconnect replay) — deduplicated by eventId. */
  ingestEvents: (events: ActivityEvent[]) => void;
  // Phase 3F — Sales goals (Owner-only). Edits create a new version; old versions live in goalRevisions.
  goals: GoalDef[];
  goalRevisions: GoalRevision[];
  goalAlerts: GoalAlert[];
  perfPrefs: PerfPrefs;
  /** Create (no id) or revise a goal. Returns an error or null. */
  saveGoal: (input: GoalInput, id?: string) => string | null;
  setGoalStatus: (id: string, status: GoalStatus) => void;
  duplicateGoal: (id: string) => string | undefined;
  setPerfPrefs: (p: Partial<PerfPrefs>) => void;
  /** Deduplicated by stable alert id. */
  recordGoalAlerts: (alerts: GoalAlert[]) => void;
  // Phase 3G — custom fields, tags, saved views. Values/tags live in maps keyed by lead id; Lead itself never changes shape.
  customFields: CustomFieldDef[];
  fieldValues: FieldValues;
  tagDefs: TagDef[];
  leadTags: LeadTags;
  savedViews: SavedView[];
  viewPrefs: ViewPrefs;
  /** Create (empty id) or edit a field definition. Type changes only apply when every stored value converts cleanly. */
  saveCustomField: (def: CustomFieldDef) => string | null;
  setCustomFieldStatus: (id: string, status: CustomFieldDef["status"]) => void;
  moveCustomField: (id: string, dir: -1 | 1) => void;
  /** Validated per type; respects field-level visibility/editability for the current viewer. */
  setLeadFieldValues: (leadId: string, input: Record<string, unknown>, opts?: { isNew?: boolean }) => { ok: true; needs: string[] } | { ok: false; errors: Record<string, string> };
  saveTag: (t: Omit<TagDef, "createdAt" | "updatedAt"> & { id: string }) => string | null;
  setTagStatus: (id: string, status: TagDef["status"]) => void;
  setLeadTags: (leadId: string, tagIds: string[]) => boolean;
  bulkTagLeads: (ids: string[], tagId: string, mode: "add" | "remove") => { changed: number; before: Record<string, string[] | undefined>; applied: Record<string, string[]> };
  undoBulkTags: (before: Record<string, string[] | undefined>, applied: Record<string, string[]>) => { restored: number; kept: number };
  saveView: (v: Omit<SavedView, "createdAt" | "updatedAt" | "version" | "schema" | "ownerId"> & { ownerId?: string }) => { ok: true; id: string } | { ok: false; error: string };
  deleteView: (id: string) => void;
  duplicateView: (id: string) => string | undefined;
  setViewPref: (userId: string, patch: { defaultId?: string | undefined; pinned?: string[] }) => void;
}

/** Who is acting right now: the Owner, or the previewed employee. */
export function currentViewer(): Viewer {
  const pv = activePreview();
  return pv ? { owner: false, employeeId: pv.employeeId, canEdit: allows(pv, "leads.edit") } : { owner: true };
}
/** Automation evaluation context — one place, shared by real runs and Automation Studio dry runs. */
export function automationCtxOf(st: Pick<CRMState, "leads" | "activities" | "followUps" | "assignments" | "inboxMeta" | "fieldValues" | "leadTags" | "customFields" | "tagDefs" | "employees">, now = new Date()) {
  const vctx = viewCtxOf(st, { owner: true }, now); const vfields = new Map(filterFields(vctx).map((f) => [f.key, f]));
  return { leads: st.leads, activities: st.activities, followUps: st.followUps, assignments: st.assignments, inboxMeta: st.inboxMeta, now, customMatch: (l: Lead, cs: NonNullable<AutomationRule["conditions"]["custom"]>) => cs.every((c) => matchCondition(l, c as ViewCondition, vctx, vfields)) };
}
/** Custom-field/tag problems that stop a rule from running (archived/removed fields or options). */
export function automationIssues(st: Pick<CRMState, "assignments" | "followUps" | "activities" | "inboxMeta" | "fieldValues" | "leadTags" | "customFields" | "tagDefs" | "employees">, r: AutomationRule) {
  return r.conditions.custom?.length ? viewIssues({ filter: { mode: "and", conditions: r.conditions.custom as ViewCondition[] } }, viewCtxOf(st, { owner: true })) : [];
}
export const viewerId = (v: Viewer) => (v.owner ? OWNER_ACTOR_ID : v.employeeId);
export function viewCtxOf(s: Pick<CRMState, "assignments" | "followUps" | "activities" | "inboxMeta" | "fieldValues" | "leadTags" | "customFields" | "tagDefs" | "employees">, viewer: Viewer, now = new Date()): ViewCtx {
  return { assignments: s.assignments, followUps: s.followUps, activities: s.activities, inboxMeta: s.inboxMeta, fieldValues: s.fieldValues, leadTags: s.leadTags, customFields: s.customFields, tags: s.tagDefs, employees: s.employees.filter((e) => e.accountStatus !== "archived"), now, viewer };
}

export function duplicatePhone(leads: Lead[], phone: string): Lead | undefined {
  const d = digits(phone);
  if (d.length !== 10) return undefined;
  return leads.find((l) => digits(l.phone) === d);
}

const defaultPrefs: Prefs = {
  owner: "Faizan",
  email: "faizan@joinscaleflow.in",
  business: "Scale Flow",
  theme: "light",
  accent: "indigo",
  density: "comfortable",
  timeFormat: "12h",
  dateStyle: "short",
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
};
const initialData = {
  leads: demoLeads,
  deals: demoDeals,
  payments: demoPayments,
  followUps: demoFollowUps,
  notes: demoNotes,
  activities: demoActivities,
  bin: [] as BinEntry[],
  callOps: [] as CallOp[],
  briefingDone: [] as string[],
  briefingDate: "",
};

export const useCRM = create<CRMState>()(
  persist(
    (set, get) => {
      const syncNext = (leadId: string) => {
        const next = get().followUps.filter((x) => x.leadId === leadId && isPending(x)).map((x) => x.dueAt).sort()[0];
        set((s) => ({ leads: s.leads.map((l) => (l.id === leadId ? { ...l, nextFollowUp: next } : l)) }));
      };
      const moveToBin = (id: string, kind: BinEntry["kind"], reason?: string) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead) return;
        const at = new Date().toISOString();
        const acts = [{ id: uid("activity"), leadId: id, type: kind === "waste" ? "waste" : "note", text: kind === "waste" ? `Moved to Waste${reason ? `: ${reason}` : ""}` : "Lead deleted", at } as LeadActivity, ...get().activities.filter((a) => a.leadId === id)];
        set((s) => ({
          bin: [{ id: uid("bin"), kind, at, ...(reason ? { reason } : {}), lead, followUps: s.followUps.filter((f) => f.leadId === id), activities: acts }, ...s.bin],
          leads: s.leads.filter((l) => l.id !== id),
          followUps: s.followUps.filter((f) => f.leadId !== id),
          activities: s.activities.filter((a) => a.leadId !== id),
        }));
      };
      const autoAssign = (leadId: string, trigger: RuleTrigger) => {
        const st = get();
        if (!st.ruleSettings.autoEnabled) return;
        const lead = st.leads.find((l) => l.id === leadId); if (!lead) return;
        const o = evaluate(lead, trigger, st.assignmentRules, st.employees, st.assignments[leadId], st.ruleSettings);
        if (!o.winner) return;
        const key = fireKey(o.winner, leadId, trigger, lead.status);
        if (st.firedRules.includes(key)) return;
        const { next, events } = applyAssign(st.assignments, [leadId], o.winner.targetEmployeeId, new Date().toISOString(), `Rule: ${o.winner.name}`, false, () => uid("asg"));
        set((s) => ({ assignments: next, assignmentEvents: [...events, ...s.assignmentEvents].slice(0, 500), firedRules: [key, ...s.firedRules].slice(0, 2000) }));
      };
      return guarded<CRMState>({
      ...initialData,
      inboxMeta: {},
      leadRelations: {},
      markReviewed: (ids) => {
        const at = new Date().toISOString(); const st = get(); const live = new Set(st.leads.map((l) => l.id));
        const todo = [...new Set(ids)].filter((id) => live.has(id) && !st.inboxMeta[id]?.reviewedAt);
        if (todo.length) set((s) => ({ inboxMeta: { ...s.inboxMeta, ...Object.fromEntries(todo.map((id) => [id, { ...s.inboxMeta[id], reviewedAt: at }])) } }));
        return todo.length;
      },
      unmarkReviewed: (id) => set((s) => { const { reviewedAt: _r, ...rest } = s.inboxMeta[id] ?? {}; return { inboxMeta: { ...s.inboxMeta, [id]: rest } }; }),
      flagDuplicate: (id, note) => set((s) => (s.leads.some((l) => l.id === id) ? { inboxMeta: { ...s.inboxMeta, [id]: { ...s.inboxMeta[id], flaggedAt: new Date().toISOString(), ...(note ? { flagNote: note } : {}) } } } : {})),
      unflagDuplicate: (id) => set((s) => { const { flaggedAt: _f, flagNote: _n, ...rest } = s.inboxMeta[id] ?? {}; return { inboxMeta: { ...s.inboxMeta, [id]: rest } }; }),
      resolveDuplicate: (a, b, kind, note) => set((s) => {
        if (a === b || !s.leads.some((l) => l.id === a) || !s.leads.some((l) => l.id === b)) return {};
        const key = pairKey(a, b);
        const clear = (id: string) => { const { flaggedAt: _f, flagNote: _n, ...rest } = s.inboxMeta[id] ?? {}; return rest; };
        const at = new Date().toISOString(); const la = s.leads.find((l) => l.id === a)!, lb = s.leads.find((l) => l.id === b)!;
        const sig = pairSignature(la, lb); const prev = s.leadRelations[key];
        const history = [...(prev?.history ?? []), ...(prev ? [{ kind: prev.kind, at: prev.at, ...(prev.sig ? { sig: prev.sig } : {}) }] : [])];
        return { leadRelations: { ...s.leadRelations, [key]: { key, a: a < b ? a : b, b: a < b ? b : a, kind, at, sig, ...(history.length ? { history } : {}), ...(note ? { note } : {}) } }, inboxMeta: { ...s.inboxMeta, [a]: clear(a), [b]: clear(b) } };
      }),
      clearRelation: (key) => set((s) => { const { [key]: _x, ...rest } = s.leadRelations; return { leadRelations: rest }; }),
      automationRules: [],
      reminders: [],
      automationRuns: [],
      automationSettings: DEFAULT_AUTOMATION_SETTINGS,
      saveAutomationRule: (r) => {
        const err = automationRuleError(r); if (err && r.status === "enabled") return err;
        const at = new Date().toISOString();
        set((s) => { const ex = s.automationRules.find((x) => x.id === r.id); const row = { ...r, updatedAt: at, version: (ex?.version ?? 0) + 1, createdAt: ex?.createdAt ?? at };
          return { automationRules: ex ? s.automationRules.map((x) => (x.id === r.id ? row : x)) : [...s.automationRules, row] }; });
        return null;
      },
      setAutomationStatus: (id, status) => {
        const r = get().automationRules.find((x) => x.id === id); if (!r) return "Rule not found";
        if (status === "enabled") { const err = automationRuleError(r); if (err) return err; }
        set((s) => ({ automationRules: s.automationRules.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x)) }));
        return null;
      },
      duplicateAutomationRule: (id) => {
        const r = get().automationRules.find((x) => x.id === id); if (!r) return undefined;
        const nid = uid("auto"); const at = new Date().toISOString();
        const { lastEvaluatedAt: _e, lastTriggeredAt: _t, ...rest } = r;
        set((s) => ({ automationRules: [...s.automationRules, { ...rest, id: nid, name: `${r.name} (copy)`, status: "draft", createdAt: at, updatedAt: at, version: 1 }] }));
        return nid;
      },
      addRuleFromTemplate: (tplId) => {
        const r = ruleFromTemplate(tplId, uid("auto"), new Date().toISOString()); if (!r) return undefined;
        set((s) => ({ automationRules: [...s.automationRules, r] })); return r.id;
      },
      setAutomationSettings: (p) => set((s) => ({ automationSettings: { ...s.automationSettings, ...p } })),
      runAutomations: (opts) => {
        const st = get(); const now = opts?.now ? new Date(opts.now) : new Date(); const at = now.toISOString(); const manual = !!opts?.manual;
        const vctx = viewCtxOf(st, { owner: true }, now);
        const ctx = automationCtxOf(st, now);
        const rec = reconcileReminders(st.reminders, ctx);
        let reminders = rec.next; let budget = st.automationSettings.maxActionsPerRun; let created = 0;
        const runs: AutomationRun[] = []; const fuJobs: { reminderId: string; leadId: string; key: string; dueAt: string; rule: string }[] = [];
        const rules = st.automationRules.map((r) => {
          if (r.status !== "enabled") { if (manual && r.status !== "archived") runs.push({ id: uid("run"), ruleId: r.id, ruleName: r.name, at, outcome: "disabled", actions: [], skippedDuplicates: 0, matched: 0, manual }); return r; }
          const broken = r.conditions.custom?.length ? viewIssues({ filter: { mode: "and", conditions: r.conditions.custom as ViewCondition[] } }, vctx) : [];
          if (broken.length) { runs.push({ id: uid("run"), ruleId: r.id, ruleName: r.name, at, outcome: "failed", actions: [], skippedDuplicates: 0, matched: 0, error: `Not run: ${broken[0]!.text}`, manual }); return { ...r, lastEvaluatedAt: at }; }
          const plan = planRule(r, ctx, reminders);
          const make = plan.create.slice(0, Math.max(0, budget)); budget -= make.length;
          const failed = plan.create.length - make.length;
          const rows: Reminder[] = make.map(({ followUpDueAt, ...p }) => { const id = uid("rem"); if (followUpDueAt) fuJobs.push({ reminderId: id, leadId: p.leadId, key: p.key, dueAt: followUpDueAt, rule: r.name }); return { ...p, id }; });
          reminders = [...rows, ...reminders]; created += rows.length;
          const actions = rows.length ? [`${rows.length} reminder${rows.length > 1 ? "s" : ""}`, ...(rows.some((x) => x.flag) ? ["flagged"] : []), ...(plan.escalations.length ? [`${plan.escalations.length} escalated to Owner`] : [])] : [];
          if (rows.length) runs.push({ id: uid("run"), ruleId: r.id, ruleName: r.name, at, outcome: "triggered", ...(rows.length === 1 ? { leadId: rows[0]!.leadId } : {}), actions, skippedDuplicates: plan.skippedDuplicates + plan.cooldown, matched: plan.matched, manual });
          if (failed) runs.push({ id: uid("run"), ruleId: r.id, ruleName: r.name, at, outcome: "failed", actions: [], skippedDuplicates: 0, matched: plan.matched, error: `Run limit of ${st.automationSettings.maxActionsPerRun} actions reached — ${failed} not created. They will be retried on the next evaluation.`, manual });
          if (manual && !rows.length && !failed) runs.push({ id: uid("run"), ruleId: r.id, ruleName: r.name, at, outcome: plan.matched ? "skipped" : "evaluated", actions: [], skippedDuplicates: plan.skippedDuplicates + plan.cooldown, matched: plan.matched, manual });
          return { ...r, lastEvaluatedAt: at, ...(rows.length ? { lastTriggeredAt: at } : {}) };
        });
        set({ reminders: reminders.slice(0, 3000), automationRules: rules, automationRuns: [...runs, ...st.automationRuns].slice(0, 2000) });
        // Explicitly configured follow-ups go through the normal follow-up rules (one active per lead, opId idempotency).
        for (const j of fuJobs) {
          const res = get().addFollowUp({ leadId: j.leadId, type: "call", dueAt: j.dueAt, note: `Automation: ${j.rule}`, opId: `auto:${j.key}` });
          const text = res.ok ? "Follow-up created" : "Follow-up skipped — one is already active for this lead";
          set((s) => ({
            reminders: s.reminders.map((x) => (x.id === j.reminderId ? { ...x, ...(res.ok ? { followUpId: res.id } : {}), history: [...(x.history ?? []), { at, text }] } : x)),
            // Mark the follow-up's own activity row as automation-origin so it never counts as contact or re-triggers rules.
            activities: res.ok ? (() => { let done = false; return s.activities.map((a) => (!done && a.leadId === j.leadId && a.type === "followup" && !a.opId ? ((done = true), { ...a, opId: `auto:${j.key}` }) : a)); })() : s.activities,
          }));
        }
        return { created, resolved: rec.changed };
      },
      completeReminder: (id) => set((s) => ({ reminders: s.reminders.map((r) => (r.id === id && r.status === "open" ? { ...r, status: "done", closedAt: new Date().toISOString() } : r)) })),
      dismissReminder: (id) => set((s) => ({ reminders: s.reminders.map((r) => (r.id === id && r.status === "open" ? { ...r, status: "dismissed", closedAt: new Date().toISOString() } : r)) })),
      teamEvents: [],
      notifyPrefs: DEFAULT_NOTIFY_PREFS,
      notifyReads: EMPTY_READS,
      setNotifyPrefs: (p) => set((s) => ({ notifyPrefs: { ...s.notifyPrefs, ...p } })),
      markNotificationRead: (id) => set((s) => ({ notifyReads: markRead(s.notifyReads, id) })),
      markAllNotificationsRead: () => set({ notifyReads: markAllRead(new Date().toISOString()) }),
      ingestEvents: (events) => set((s) => ({ teamEvents: mergeEvents(s.teamEvents, events.filter((e) => e.eventSource !== "demo")) })),
      goals: [],
      goalRevisions: [],
      goalAlerts: [],
      perfPrefs: DEFAULT_PERF_PREFS,
      saveGoal: (input, id) => {
        const err = goalError(input, get().employees); if (err) return err;
        const at = new Date().toISOString();
        if (!id) { set((s) => ({ goals: [...s.goals, buildGoal(input, uid("goal"), at)] })); return null; }
        const cur = get().goals.find((g) => g.id === id); if (!cur) return "Goal not found.";
        const { next, revision } = reviseGoal(cur, input, at, uid("grev"));
        set((s) => ({ goals: s.goals.map((g) => (g.id === id ? next : g)), goalRevisions: [revision, ...s.goalRevisions].slice(0, 2000) }));
        return null;
      },
      setGoalStatus: (id, status) => set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, status, updatedAt: new Date().toISOString() } : g)) })),
      duplicateGoal: (id) => {
        const g = get().goals.find((x) => x.id === id); if (!g) return undefined;
        const nid = uid("goal"), at = new Date().toISOString();
        set((s) => ({ goals: [...s.goals, { ...g, id: nid, name: `${g.name} (copy)`, status: "paused", version: 1, createdAt: at, updatedAt: at }] }));
        return nid;
      },
      setPerfPrefs: (p) => set((s) => ({ perfPrefs: { ...s.perfPrefs, ...p } })),
      recordGoalAlerts: (alerts) => set((s) => { const next = mergeAlerts(s.goalAlerts, alerts); return next === s.goalAlerts ? s : { goalAlerts: next }; }),
      customFields: [],
      fieldValues: {},
      tagDefs: [],
      leadTags: {},
      savedViews: starterViews(OWNER_ACTOR_ID, "2026-01-01T00:00:00.000Z"),
      viewPrefs: {},
      saveCustomField: (input) => {
        const st = get(); const at = new Date().toISOString();
        const cur = input.id ? st.customFields.find((f) => f.id === input.id) : undefined;
        const def: CustomFieldDef = { ...input, label: input.label.trim(), ...(input.description?.trim() ? { description: input.description.trim() } : { description: undefined }), id: input.id, order: cur?.order ?? (st.customFields.length ? Math.max(...st.customFields.map((f) => f.order)) + 1 : 0) };
        if (!def.id) return "Missing internal id.";
        const err = fieldDefError(def, st.customFields); if (err) return err;
        if (!cur) { set((s) => ({ customFields: [...s.customFields, { ...def, createdAt: at, updatedAt: at, version: 1, history: [{ at, change: "Created" }] }] })); return null; }
        const lost = removedUsedOptions(cur, def, st.fieldValues);
        if (lost.length) return `Option ${lost.map((o) => `“${o.label}” (${o.count} lead${o.count > 1 ? "s" : ""})`).join(", ")} is in use — archive it instead of deleting it.`;
        let values = st.fieldValues;
        if (cur.type !== def.type) {
          const imp = typeChangeImpact(cur, def, st.fieldValues);
          if (imp.incompatible.length) return `${imp.incompatible.length} lead${imp.incompatible.length > 1 ? "s have values" : " has a value"} that can't become ${def.type}. Nothing was changed.`;
          values = Object.fromEntries(Object.entries(st.fieldValues).map(([id, row]) => { const v = row[cur.id]; return [id, v === undefined ? row : { ...row, [cur.id]: convertValue(v, cur, def)! }]; }));
        }
        const changes = [cur.label !== def.label && `Renamed from “${cur.label}”`, cur.type !== def.type && `Type ${cur.type} → ${def.type}`, cur.required !== def.required && (def.required ? "Now required" : "Now optional"), (cur.visibility !== def.visibility || cur.editable !== def.editable) && "Visibility changed", JSON.stringify(cur.options) !== JSON.stringify(def.options) && "Options changed"].filter(Boolean) as string[];
        set((s) => ({ fieldValues: values, customFields: s.customFields.map((f) => (f.id === cur.id ? { ...def, createdAt: cur.createdAt, updatedAt: at, version: cur.version + 1, history: [...cur.history, { at, change: changes.join(" · ") || "Edited" }].slice(-50) } : f)) }));
        return null;
      },
      setCustomFieldStatus: (id, status) => set((s) => ({ customFields: s.customFields.map((f) => (f.id === id && f.status !== status ? { ...f, status, updatedAt: new Date().toISOString(), version: f.version + 1, history: [...f.history, { at: new Date().toISOString(), change: status === "archived" ? "Archived (values kept)" : "Restored" }] } : f)) })),
      moveCustomField: (id, dir) => set((s) => { const l = [...s.customFields].sort((a, b) => a.order - b.order); const i = l.findIndex((f) => f.id === id), j = i + dir; if (i < 0 || j < 0 || j >= l.length) return {}; [l[i], l[j]] = [l[j]!, l[i]!]; return { customFields: l.map((f, k) => ({ ...f, order: k })) }; }),
      setLeadFieldValues: (leadId, input, opts) => {
        const st = get(); if (!st.leads.some((l) => l.id === leadId)) return { ok: false, errors: { _: "Lead not found." } };
        const viewer = currentViewer();
        const allowed = activeFields(st.customFields).filter((d) => viewer.owner || (d.visibility === "team" && d.editable === "team"));
        const ok = new Set(allowed.map((d) => d.id));
        const blocked = Object.keys(input).filter((k) => !ok.has(k));
        if (blocked.length) return { ok: false, errors: Object.fromEntries(blocked.map((k) => [k, "You can't edit this field."])) };
        const prev = st.fieldValues[leadId] ?? {};
        const r = validateLeadValues(allowed, input, { isNew: !!opts?.isNew, previous: prev });
        if (Object.keys(r.errors).length) return { ok: false, errors: r.errors };
        const row: Record<string, FieldValue> = { ...prev };
        for (const k of Object.keys(input)) { const v = r.values[k]; if (v === undefined) delete row[k]; else row[k] = v; }
        set((s) => ({ fieldValues: { ...s.fieldValues, [leadId]: row } }));
        return { ok: true, needs: r.needs };
      },
      saveTag: (t) => {
        const st = get(); const err = tagError(t, st.tagDefs); if (err) return err; const at = new Date().toISOString();
        const cur = st.tagDefs.find((x) => x.id === t.id);
        set((s) => ({ tagDefs: cur ? s.tagDefs.map((x) => (x.id === t.id ? { ...x, ...t, name: t.name.trim(), updatedAt: at } : x)) : [...s.tagDefs, { ...t, name: t.name.trim(), createdAt: at, updatedAt: at }] }));
        return null;
      },
      setTagStatus: (id, status) => set((s) => ({ tagDefs: s.tagDefs.map((t) => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)) })),
      setLeadTags: (leadId, tagIds) => {
        const st = get(); if (!st.leads.some((l) => l.id === leadId)) return false;
        const known = new Map(st.tagDefs.map((t) => [t.id, t])); const cur = st.leadTags[leadId] ?? [];
        // Archived tags already on the lead may stay; new ones must be active.
        const next = [...new Set(tagIds)].filter((id) => known.has(id) && (known.get(id)!.status === "active" || cur.includes(id)));
        set((s) => ({ leadTags: { ...s.leadTags, [leadId]: next } }));
        return true;
      },
      bulkTagLeads: (ids, tagId, mode) => {
        const st = get(); const tag = st.tagDefs.find((t) => t.id === tagId);
        if (!tag || (mode === "add" && tag.status !== "active")) return { changed: 0, before: {}, applied: {} };
        const live = new Set(st.leads.map((l) => l.id));
        const r = bulkTag(st.leadTags, ids.filter((id) => live.has(id)), tagId, mode);
        if (r.changed) set({ leadTags: r.next });
        return { changed: r.changed, before: r.before, applied: r.applied };
      },
      undoBulkTags: (before, applied) => { const r = undoTags(get().leadTags, before, applied); if (r.restored) set({ leadTags: r.next }); return { restored: r.restored, kept: r.kept }; },
      saveView: (input) => {
        const st = get(); const viewer = currentViewer(); const at = new Date().toISOString();
        const cur = input.id ? st.savedViews.find((v) => v.id === input.id) : undefined;
        if (cur && !viewEditable(cur, viewer)) return { ok: false, error: "You can't edit this view." };
        const ownerId = cur?.ownerId ?? viewerId(viewer);
        const err = viewError({ ...input, ownerId }, viewer, st.savedViews, cur?.id); if (err) return { ok: false, error: err };
        const id = cur?.id ?? uid("view");
        const row: SavedView = { id, name: input.name.trim(), visibility: input.visibility, ownerId, filter: input.filter, sort: input.sort, ...(input.columns ? { columns: input.columns } : {}), archived: !!input.archived, schema: CUSTOMIZE_SCHEMA, createdAt: cur?.createdAt ?? at, updatedAt: at, version: (cur?.version ?? 0) + 1 };
        set((s) => ({ savedViews: cur ? s.savedViews.map((v) => (v.id === id ? row : v)) : [...s.savedViews, row] }));
        return { ok: true, id };
      },
      deleteView: (id) => { const v = get().savedViews.find((x) => x.id === id); if (!v || !viewEditable(v, currentViewer())) return; set((s) => ({ savedViews: s.savedViews.filter((x) => x.id !== id), viewPrefs: Object.fromEntries(Object.entries(s.viewPrefs).map(([u, p]) => [u, { ...p, pinned: p.pinned.filter((x) => x !== id), ...(p.defaultId === id ? { defaultId: undefined } : {}) }])) })); },
      duplicateView: (id) => {
        const st = get(); const v = st.savedViews.find((x) => x.id === id); const viewer = currentViewer(); if (!v) return undefined;
        let name = `${v.name} (copy)`, n = 2; const mine = st.savedViews.filter((x) => x.ownerId === viewerId(viewer));
        while (mine.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${v.name} (copy ${n++})`;
        const r = get().saveView({ id: "", name, visibility: "personal", filter: structuredClone(v.filter), sort: v.sort, columns: v.columns, archived: false });
        return r.ok ? r.id : undefined;
      },
      setViewPref: (userId, patch) => set((s) => ({ viewPrefs: { ...s.viewPrefs, [userId]: { pinned: [], ...s.viewPrefs[userId], ...patch } } })),
      ...createProjectSlice(set as never, get as never),
      ...defaultPrefs,
      addLead: (lead) => {
        const id = uid("lead");
        const at = new Date().toISOString();
        set((s) => ({
          leads: [{ ...lead, id, createdAt: at, updatedAt: at }, ...s.leads],
          activities: [{ id: uid("activity"), leadId: id, type: "created", text: "Lead added to Scale Flow", at }, ...s.activities],
        }));
        const pv = activePreview();
        // In the employee preview, a lead the employee creates is theirs (otherwise it would vanish from an assigned-only scope).
        if (pv) set((s) => ({ assignments: { ...s.assignments, [id]: { employeeId: pv.employeeId, assignedAt: at, source: "Created by employee", manual: true } } }));
        else autoAssign(id, "lead_created");
        return id;
      },
      updateLead: (id, patch) => {
        if (leadEditError(get().leads, id, patch)) return false;
        const prev = get().leads.find((l) => l.id === id);
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch, ...(patch.status && patch.status !== "lost" ? { lostReason: undefined } : {}), updatedAt: new Date().toISOString() } : l)),
          deals: s.deals.map((d) => d.leadId === id ? { ...d, ...(patch.name !== undefined ? { clientName: patch.name } : {}), ...(patch.company !== undefined ? { company: patch.company } : {}) } : d),
        }));
        if (patch.status && prev && prev.status !== patch.status) { get().addActivity(id, `Status changed to ${patch.status}`, "status"); autoAssign(id, "stage_entered"); }
        return true;
      },
      deleteLead: (id) => moveToBin(id, "deleted"),
      wasteLead: (id, reason) => moveToBin(id, "waste", reason),
      restoreLead: (binId) => {
        const e = get().bin.find((b) => b.id === binId);
        if (!e) return "Not found";
        if (duplicatePhone(get().leads, e.lead.phone)) return "An active lead already uses this phone — merge or edit it first";
        const at = new Date().toISOString();
        set((s) => ({
          bin: s.bin.filter((b) => b.id !== binId),
          leads: [{ ...e.lead, updatedAt: at }, ...s.leads],
          followUps: [...e.followUps, ...s.followUps],
          activities: [{ id: uid("activity"), leadId: e.lead.id, type: "restored", text: `Restored from ${e.kind === "waste" ? "Waste" : "Recently Deleted"}`, at }, ...e.activities, ...s.activities],
        }));
        return undefined;
      },
      purgeBin: (binId) => set((s) => ({ bin: s.bin.filter((b) => b.id !== binId) })),
      emptyBin: (kind) => set((s) => ({ bin: s.bin.filter((b) => b.kind !== kind) })),
      mergeIntoLead: (id, incoming, mode) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead) return false;
        const patch = mergePatch(lead, incoming, mode);
        if (Object.keys(patch).length && !get().updateLead(id, patch)) return false;
        const fields = Object.keys(patch).filter((k) => k !== "notes");
        get().addActivity(id, fields.length || patch.notes ? `Merged new details (${[...fields, ...(patch.notes ? ["notes"] : [])].join(", ")})` : "Duplicate entry checked — nothing new to merge", "merged");
        return true;
      },
      setQuickStatus: (id, q) => {
        const lead = get().leads.find((l) => l.id === id);
        if (!lead || lead.quickStatus === q) return;
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, quickStatus: q, updatedAt: new Date().toISOString() } : l)) }));
        get().addActivity(id, q ? `Quick status: ${QUICK_LABEL[q]}` : "Quick status cleared", "quick");
      },
      addActivity: (leadId, text, type = "note") =>
        set((s) => ({ activities: [{ id: uid("activity"), leadId, type, text, at: new Date().toISOString() }, ...s.activities] })),
      addDeal: (deal) => set((s) => ({ deals: [{ ...deal, id: uid("deal"), createdAt: new Date().toISOString() }, ...s.deals] })),
      addPayment: (payment, id) => {
        if (id && get().payments.some((p) => p.id === id)) return false;
        const target = get().deals.find((d) => d.id === payment.dealId);
        if (!target || !Number.isFinite(payment.amount) || payment.amount <= 0 || payment.amount > dealOutstanding(target, get().payments) || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) return false;
        set((s) => ({ payments: [{ ...payment, id: id ?? uid("payment") }, ...s.payments] }));
        const deal = get().deals.find((d) => d.id === payment.dealId);
        if (deal?.leadId) get().addActivity(deal.leadId, `Payment of ₹${payment.amount.toLocaleString("en-IN")} recorded`, "payment");
        return true;
      },
      voidPayment: (id) => set((s) => ({ payments: s.payments.map((p) => (p.id === id ? { ...p, voided: true } : p)) })),
      addFollowUp: (f, opts) => {
        if (f.opId) { const dup = get().followUps.find((x) => x.opId === f.opId); if (dup) return { ok: true, id: dup.id }; }
        if (!get().leads.some((l) => l.id === f.leadId)) return { ok: false, error: "Lead not found" };
        if (!Number.isFinite(new Date(f.dueAt).getTime())) return { ok: false, error: "Choose a valid date and time" };
        const active = activeFollowUp(get().followUps, f.leadId);
        if (active && opts?.replaceId !== active.id) return { ok: false, conflict: active };
        const id = uid("followup"); const at = new Date().toISOString();
        set((s) => ({ followUps: [{ ...f, id }, ...s.followUps.map((x) => (active && x.id === active.id ? { ...x, cancelledAt: at, replacedBy: id } : x))] }));
        syncNext(f.leadId);
        get().addActivity(f.leadId, active ? `Follow-up replaced (${f.type})` : `Follow-up scheduled (${f.type})`, "followup");
        return { ok: true, id };
      },
      completeFollowUp: (id) => {
        const f = get().followUps.find((x) => x.id === id);
        if (!f || !isPending(f)) return;
        set((s) => ({ followUps: s.followUps.map((x) => (x.id === id ? { ...x, completedAt: new Date().toISOString() } : x)) }));
        get().updateLead(f.leadId, { lastContact: new Date().toISOString() });
        syncNext(f.leadId);
        get().addActivity(f.leadId, `Follow-up completed (${f.type})`, "followup");
      },
      rescheduleFollowUp: (id, dueAt) => {
        const f = get().followUps.find((x) => x.id === id);
        if (!f || !isPending(f) || !Number.isFinite(new Date(dueAt).getTime())) return;
        set((s) => ({ followUps: s.followUps.map((x) => (x.id === id ? { ...x, dueAt } : x)) }));
        syncNext(f.leadId);
        get().addActivity(f.leadId, "Follow-up rescheduled", "followup");
      },
      logCall: (i) => {
        if (get().callOps.some((o) => o.id === i.opId)) return { ok: true, opId: i.opId };
        const lead = get().leads.find((l) => l.id === i.leadId);
        if (!lead) return { ok: false, error: "Lead not found" };
        if (i.stage === "lost" && lead.status !== "lost" && !i.lostReason?.trim()) return { ok: false, error: "Add a lost reason" };
        const active = activeFollowUp(get().followUps, i.leadId);
        if (i.followUp && active && !i.onConflict) return { ok: false, conflict: active };
        if (i.followUp && !Number.isFinite(new Date(i.followUp.dueAt).getTime())) return { ok: false, error: "Choose a valid follow-up time" };
        const at = new Date().toISOString();
        const before: LeadSnap = { status: lead.status, lostReason: lead.lostReason, lastContact: lead.lastContact, nextFollowUp: lead.nextFollowUp, quickStatus: lead.quickStatus };
        const q = outcomeQuick(i.outcome);
        const patch: Partial<Lead> = {
          ...(i.stage !== lead.status ? { status: i.stage, ...(i.stage === "lost" ? { lostReason: i.lostReason!.trim() } : {}) } : {}),
          ...(isConnectedOutcome(i.outcome) ? { lastContact: at } : {}),
          ...(q ? { quickStatus: q } : {}),
        };
        const next = { ...lead, ...patch, ...(patch.status && patch.status !== "lost" ? { lostReason: undefined } : {}) };
        const editErr = leadEditError(get().leads, lead.id, next);
        if (editErr) return { ok: false, error: editErr };
        const activityId = uid("activity");
        const notes = i.notes?.trim();
        const add = i.followUp && !(active && i.onConflict === "keep");
        const followUpId = add ? uid("followup") : undefined;
        const replacedId = add && active ? active.id : undefined;
        set((s) => {
          const fus = s.followUps.map((x) => (x.id === replacedId ? { ...x, cancelledAt: at, replacedBy: followUpId } : x));
          if (followUpId && i.followUp) fus.unshift({ id: followUpId, leadId: lead.id, type: i.followUp.type, dueAt: i.followUp.dueAt, note: i.followUp.note || notes || `After call: ${i.outcome}`, opId: i.opId });
          const nextDue = fus.filter((x) => x.leadId === lead.id && isPending(x)).map((x) => x.dueAt).sort()[0];
          const updated = { ...next, nextFollowUp: nextDue, updatedAt: at };
          const statusAct: LeadActivity[] = patch.status ? [{ id: uid("activity"), leadId: lead.id, type: "status", text: `Status changed to ${patch.status}`, at, opId: i.opId }] : [];
          return {
            followUps: fus,
            leads: s.leads.map((l) => (l.id === lead.id ? updated : l)),
            activities: [{ id: activityId, leadId: lead.id, type: "call", outcome: i.outcome, opId: i.opId, at, text: `${isConnectedOutcome(i.outcome) ? "Call" : "Call attempt"} (${i.source}): ${i.outcome}${notes ? ` — ${notes}` : ""}${followUpId ? replacedId ? " · follow-up replaced" : " · follow-up scheduled" : ""}` }, ...statusAct, ...s.activities],
            callOps: [{ id: i.opId, leadId: lead.id, at, before, after: { status: updated.status, lostReason: updated.lostReason, lastContact: updated.lastContact, nextFollowUp: updated.nextFollowUp, quickStatus: updated.quickStatus }, activityId, ...(followUpId ? { followUpId, followUpDueAt: i.followUp!.dueAt } : {}), ...(replacedId ? { replacedId } : {}) }, ...s.callOps].slice(0, 50),
          };
        });
        return { ok: true, opId: i.opId };
      },
      undoCall: (opId) => {
        const op = get().callOps.find((o) => o.id === opId);
        if (!op) return "This call log can no longer be undone";
        if (op.undone) return undefined;
        const lead = get().leads.find((l) => l.id === op.leadId);
        if (!lead) return "The lead was moved to Waste or deleted after this call — restore it first";
        if (lead.status !== op.after.status || lead.lastContact !== op.after.lastContact || lead.quickStatus !== op.after.quickStatus) return "The lead changed after this call (stage, contact or quick status), so Undo was stopped to protect the newer change";
        const fu = op.followUpId ? get().followUps.find((x) => x.id === op.followUpId) : undefined;
        if (op.followUpId && (!fu || !isPending(fu) || fu.dueAt !== op.followUpDueAt)) return "The follow-up from this call was already completed, moved or replaced — update it directly instead";
        const replaced = op.replacedId ? get().followUps.find((x) => x.id === op.replacedId) : undefined;
        const restoreReplaced = replaced && replaced.cancelledAt && replaced.replacedBy === op.followUpId && !replaced.completedAt;
        set((s) => {
          const fus = s.followUps.filter((x) => x.id !== op.followUpId).map((x) => (restoreReplaced && x.id === op.replacedId ? { ...x, cancelledAt: undefined, replacedBy: undefined } : x));
          const nextDue = fus.filter((x) => x.leadId === op.leadId && isPending(x)).map((x) => x.dueAt).sort()[0];
          return {
            followUps: fus,
            leads: s.leads.map((l) => (l.id === op.leadId ? { ...l, status: op.before.status, lostReason: op.before.lostReason, lastContact: op.before.lastContact, quickStatus: op.before.quickStatus, nextFollowUp: nextDue, updatedAt: new Date().toISOString() } : l)),
            activities: s.activities.filter((a) => a.opId !== opId),
            callOps: s.callOps.map((o) => (o.id === opId ? { ...o, undone: true } : o)),
          };
        });
        return undefined;
      },
      saveNote: (note) =>
        set((s) => ({ notes: s.notes.some((n) => n.id === note.id) ? s.notes.map((n) => (n.id === note.id ? note : n)) : [note, ...s.notes] })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      toggleBriefing: (key) =>
        set((s) => {
          const today = dayKey(new Date());
          const done = s.briefingDate === today ? s.briefingDone : [];
          return { briefingDate: today, briefingDone: done.includes(key) ? done.filter((k) => k !== key) : [...done, key] };
        }),
      resetBriefing: () => set({ briefingDone: [], briefingDate: dayKey(new Date()) }),
      preferences: (patch) => set(patch),
      reset: () => set({ ...initialData }),
      quotationTemplates: [],
      quotationShares: [],
      legacyQuotations: [],
      waTemplates: builtInTemplates(),
      demos: [],
      demoCategories: DEFAULT_DEMO_CATEGORIES,
      businessProfile: { name: "" },
      // Package templates are global sales messages — never linked to deals, payments or follow-ups.
      saveQuotationTemplate: (t) => {
        if (quotationTemplateError(t)) return null;
        const at = new Date().toISOString();
        const row: QuotationTemplate = { ...t, name: t.name.trim(), currency: "INR", ...(t.priceType === "custom" ? { priceAmount: undefined } : { priceLabel: undefined }), updatedAt: at };
        set((s) => {
          const prev = s.quotationTemplates.find((x) => x.id === t.id);
          if (prev) return { quotationTemplates: s.quotationTemplates.map((x) => (x.id === t.id ? { ...row, createdAt: prev.createdAt, sortOrder: prev.sortOrder } : x)) };
          const order = s.quotationTemplates.reduce((m, x) => Math.max(m, x.sortOrder + 1), 0);
          return { quotationTemplates: [...s.quotationTemplates, { ...row, createdAt: at, sortOrder: order }] };
        });
        return row.id;
      },
      duplicateQuotationTemplate: (id) => {
        const src = get().quotationTemplates.find((x) => x.id === id);
        if (!src) return undefined;
        const at = new Date().toISOString();
        const copy: QuotationTemplate = { ...src, id: uid("qt"), name: `${src.name} (copy)`, sortOrder: src.sortOrder + 0.5, createdAt: at, updatedAt: at };
        set((s) => ({ quotationTemplates: [...s.quotationTemplates, copy].sort((a, b) => a.sortOrder - b.sortOrder).map((x, i) => ({ ...x, sortOrder: i })) }));
        return copy.id;
      },
      deleteQuotationTemplate: (id) => set((s) => ({ quotationTemplates: s.quotationTemplates.filter((x) => x.id !== id) })),
      setQuotationTemplateActive: (id, active) => set((s) => ({ quotationTemplates: s.quotationTemplates.map((x) => (x.id === id ? { ...x, isActive: active, updatedAt: new Date().toISOString() } : x)) })),
      moveQuotationTemplate: (id, dir) => set((s) => {
        const list = [...s.quotationTemplates].sort((a, b) => a.sortOrder - b.sortOrder);
        const i = list.findIndex((x) => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return {};
        [list[i], list[j]] = [list[j]!, list[i]!];
        return { quotationTemplates: list.map((x, sortOrder) => ({ ...x, sortOrder })) };
      }),
      logQuotationShare: (share) => {
        const row: QuotationShare = { ...share, id: uid("qs"), createdAt: new Date().toISOString() };
        set((s) => ({ quotationShares: [row, ...s.quotationShares] }));
        return row.id;
      },
      deleteLegacyQuotations: () => set({ legacyQuotations: [] }),
      saveTemplate: (t) => set((s) => {
        const row = { ...t, updatedAt: new Date().toISOString() };
        const exists = s.waTemplates.some((x) => x.id === t.id);
        let list = exists ? s.waTemplates.map((x) => (x.id === t.id ? row : x)) : [...s.waTemplates, row];
        if (row.isDefault) list = list.map((x) => (x.purpose === row.purpose && x.id !== row.id ? { ...x, isDefault: false } : x));
        return { waTemplates: list };
      }),
      deleteTemplate: (id) => set((s) => ({ waTemplates: s.waTemplates.filter((x) => x.id !== id) })),
      setDefaultTemplate: (id) => set((s) => {
        const t = s.waTemplates.find((x) => x.id === id);
        return t ? { waTemplates: s.waTemplates.map((x) => (x.purpose === t.purpose ? { ...x, isDefault: x.id === id, ...(x.id === id ? { enabled: true } : {}) } : x)) } : {};
      }),
      resetTemplates: () => set((s) => ({ waTemplates: [...builtInTemplates(), ...s.waTemplates.filter((x) => !x.builtIn).map((x) => ({ ...x, isDefault: false }))] })),
      saveDemo: (d) => {
        if (!d.title.trim() || !safeUrl(d.url)) return false;
        const row = { ...d, url: safeUrl(d.url)! };
        set((s) => ({ demos: s.demos.some((x) => x.id === d.id) ? s.demos.map((x) => (x.id === d.id ? row : x)) : [...s.demos, { ...row, order: s.demos.length }] }));
        return true;
      },
      deleteDemo: (id) => set((s) => ({ demos: s.demos.filter((x) => x.id !== id) })),
      moveDemo: (id, dir) => set((s) => {
        const list = [...s.demos].sort((a, b) => a.order - b.order);
        const i = list.findIndex((x) => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return {};
        [list[i], list[j]] = [list[j]!, list[i]!];
        return { demos: list.map((x, order) => ({ ...x, order })) };
      }),
      addDemoCategory: (name) => set((s) => (name.trim() && !s.demoCategories.includes(name.trim()) ? { demoCategories: [...s.demoCategories, name.trim()] } : {})),
      saveBusinessProfile: (p) => set({ businessProfile: p }),
      employees: [],
      backupHistory: [],
      logBackup: (r) => set((s) => ({ backupHistory: [r, ...s.backupHistory].slice(0, 100) })),
      addEmployee: (input) => {
        const err = employeeError(input, get().employees, get().email);
        if (err) return { ok: false, error: err };
        const id = uid("emp");
        set((s) => ({ employees: [...s.employees, buildEmployee(input, id, new Date().toISOString())] }));
        return { ok: true, id };
      },
      updateEmployee: (id, input) => {
        const cur = get().employees.find((e) => e.id === id);
        if (!cur) return "Employee not found.";
        const err = employeeError(input, get().employees, get().email, id);
        if (err) return err;
        const now = new Date().toISOString();
        const next = { ...buildEmployee(input, id, now), createdAt: cur.createdAt, lastLoginAt: cur.lastLoginAt, invitedAt: cur.invitedAt, activatedAt: cur.activatedAt, deactivatedAt: cur.accountStatus === input.accountStatus ? cur.deactivatedAt : input.accountStatus === "inactive" ? now : null };
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? next : e)) }));
        return null;
      },
      employeeAccess: {},
      saveEmployeeAccess: (employeeId, access) => set((s) => ({ employeeAccess: { ...s.employeeAccess, [employeeId]: { overrides: Object.fromEntries(Object.entries(access.overrides).filter(([k]) => !OWNER_ONLY_KEYS.includes(k))), ...(access.leadScope ? { leadScope: access.leadScope } : {}), ...(access.finance ? { finance: access.finance } : {}), updatedAt: new Date().toISOString() } } })),
      assignments: {},
      assignmentEvents: [],
      assignLeads: (leadIds, employeeId, source) => {
        if (employeeId) { const e = get().employees.find((x) => x.id === employeeId); if (!e || !assignable(e)) return { ok: false, error: "Choose an active employee." }; }
        const known = leadIds.filter((id) => get().leads.some((l) => l.id === id));
        const { next, events } = applyAssign(get().assignments, known, employeeId, new Date().toISOString(), source, true, () => uid("asg"));
        set((s) => ({ assignments: next, assignmentEvents: [...events, ...s.assignmentEvents].slice(0, 500) }));
        return { ok: true, changed: events.length };
      },
      applyAssignmentPlan: (plan, source) => {
        const st = get(); const now = new Date().toISOString();
        const ids = new Set(st.leads.map((l) => l.id));
        const skipped: { leadId: string; reason: SkipReason }[] = []; const groups = new Map<string | null, string[]>();
        const ok = new Map(st.employees.map((e) => [e.id, assignable(e)]));
        const seen = new Set<string>();
        for (const p of plan) {
          if (seen.has(p.leadId)) continue; seen.add(p.leadId);
          if (!ids.has(p.leadId)) { skipped.push({ leadId: p.leadId, reason: "missing" }); continue; }
          if ((st.assignments[p.leadId]?.employeeId ?? null) !== p.previous) { skipped.push({ leadId: p.leadId, reason: "changed" }); continue; }
          if (p.employeeId && !ok.get(p.employeeId)) { skipped.push({ leadId: p.leadId, reason: "inactive" }); continue; }
          groups.set(p.employeeId, [...(groups.get(p.employeeId) ?? []), p.leadId]);
        }
        const snapshot: Record<string, Assignment | undefined> = {};
        let next = st.assignments; const events: AssignmentEvent[] = [];
        for (const [emp, leadIds] of groups) {
          for (const id of leadIds) snapshot[id] = st.assignments[id];
          const r = applyAssign(next, leadIds, emp, now, source, true, () => uid("asg"));
          next = r.next; events.push(...r.events);
        }
        set((s) => ({ assignments: next, assignmentEvents: [...events, ...s.assignmentEvents].slice(0, 500) }));
        return { ok: true, changed: events.length, skipped, snapshot };
      },
      restoreAssignments: (snap, expected) => {
        const next = { ...get().assignments }; let restored = 0, kept = 0;
        for (const [id, a] of Object.entries(snap)) {
          if (expected && id in expected && (next[id]?.employeeId ?? null) !== expected[id]) { kept++; continue; }
          if (a) next[id] = a; else delete next[id];
          restored++;
        }
        set({ assignments: next });
        return { restored, kept };
      },
      assignmentRules: [],
      ruleSettings: DEFAULT_RULE_SETTINGS,
      firedRules: [],
      saveRule: (r) => {
        const err = ruleError(r, get().employees); if (err) return err;
        const now = new Date().toISOString();
        set((s) => { const cur = s.assignmentRules.find((x) => x.id === r.id);
          return { assignmentRules: cur ? s.assignmentRules.map((x) => (x.id === r.id ? { ...cur, ...r, priority: cur.priority, updatedAt: now } : x)) : [...s.assignmentRules, { ...r, priority: s.assignmentRules.length + 1, createdAt: now, updatedAt: now }] }; });
        return null;
      },
      deleteRule: (id) => set((s) => ({ assignmentRules: s.assignmentRules.filter((x) => x.id !== id).map((x, i) => ({ ...x, priority: i + 1 })) })),
      moveRule: (id, dir) => set((s) => { const l = [...s.assignmentRules].sort((x, y) => x.priority - y.priority); const i = l.findIndex((x) => x.id === id), j = i + dir; if (i < 0 || j < 0 || j >= l.length) return {}; [l[i], l[j]] = [l[j]!, l[i]!]; return { assignmentRules: l.map((x, k) => ({ ...x, priority: k + 1 })) }; }),
      setRuleSettings: (p) => set((s) => ({ ruleSettings: { ...s.ruleSettings, ...p } })),
      applyRulesToExisting: () => {
        let n = 0;
        for (const l of get().leads) {
          const st = get();
          const o = evaluate(l, "lead_created", st.assignmentRules, st.employees, st.assignments[l.id], st.ruleSettings);
          if (!o.winner) continue;
          const { next, events } = applyAssign(st.assignments, [l.id], o.winner.targetEmployeeId, new Date().toISOString(), `Rule: ${o.winner.name} (bulk)`, false, () => uid("asg"));
          set((s) => ({ assignments: next, assignmentEvents: [...events, ...s.assignmentEvents].slice(0, 500) })); n += events.length;
        }
        return n;
      },
      setEmployeeStatus: (id, status) => set((s) => ({ employees: s.employees.map((e) => (e.id === id ? withStatus(e, status, new Date().toISOString()) : e)) })),
    }, get, set);
    },
    {
      name: "scale-flow-crm-2-demo",
      version: 8,
      storage: createJSONStorage(() => guardedStorage),
      skipHydration: true,
      // v3: billing quotations are moved, unchanged, into a read-only backup. Nothing is converted automatically.
      // v4: adds Smart Inbox maps (empty) — existing leads are untouched and start as "Needs review".
      migrate: (persisted, version) => migrateProjects(migrateCustomization(migratePerformance(migrateAutomation(migrateInbox(migrateQuotations(persisted as Record<string, unknown>, version), version), version), version), version), version) as unknown as CRMState,
    },
  ),
);

/** v6: adds Sales Goals state (empty, no goal pre-created). */
/** v7: custom fields, tags and saved views start empty (plus starter company views). No lead is modified. */
export function migrateCustomization(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (version >= 7) return state;
  return { ...state, customFields: state["customFields"] ?? [], fieldValues: state["fieldValues"] ?? {}, tagDefs: state["tagDefs"] ?? [], leadTags: state["leadTags"] ?? {}, savedViews: state["savedViews"] ?? starterViews(OWNER_ACTOR_ID, new Date().toISOString()), viewPrefs: state["viewPrefs"] ?? {} };
}
export function migratePerformance(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 6) return state;
  return { ...state, goals: state["goals"] ?? [], goalRevisions: state["goalRevisions"] ?? [], goalAlerts: state["goalAlerts"] ?? [], perfPrefs: state["perfPrefs"] ?? DEFAULT_PERF_PREFS };
}
/** v5: adds Automation Studio state (empty, nothing enabled). */
export function migrateAutomation(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 5) return state;
  return { ...state, automationRules: state["automationRules"] ?? [], reminders: state["reminders"] ?? [], automationRuns: state["automationRuns"] ?? [], automationSettings: state["automationSettings"] ?? DEFAULT_AUTOMATION_SETTINGS };
}
export function migrateInbox(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 4) return state;
  return { ...state, inboxMeta: state["inboxMeta"] ?? {}, leadRelations: state["leadRelations"] ?? {} };
}

/** Move pre-v3 billing quotations into `legacyQuotations` untouched; deals and payments are never read or changed. */
export function migrateQuotations(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 3) return state;
  const { quotations, ...rest } = state;
  const old = Array.isArray(quotations) ? (quotations as LegacyQuotation[]) : [];
  const prev = Array.isArray(rest["legacyQuotations"]) ? (rest["legacyQuotations"] as LegacyQuotation[]) : [];
  return { ...rest, legacyQuotations: [...prev, ...old], quotationTemplates: rest["quotationTemplates"] ?? [], quotationShares: rest["quotationShares"] ?? [] };
}
