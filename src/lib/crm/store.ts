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
  assignLeads: ["leads.assign", { ok: false, error: DENIED }, "lead.assigned"], restoreAssignments: ["leads.assign", undefined], applyAssignmentPlan: ["leads.assign", { ok: false, error: DENIED }, "lead.assigned"],
  saveBusinessProfile: ["__owner", undefined], reset: ["__owner", undefined], logBackup: ["__owner", undefined], deleteLegacyQuotations: ["__owner", undefined],
  addEmployee: ["__owner", { ok: false, error: DENIED }], updateEmployee: ["__owner", DENIED], setEmployeeStatus: ["__owner", undefined], saveEmployeeAccess: ["__owner", undefined],
  saveRule: ["__owner", DENIED], deleteRule: ["__owner", undefined], moveRule: ["__owner", undefined], setRuleSettings: ["__owner", undefined], applyRulesToExisting: ["__owner", 0],
};
/** Actions never recorded as Team Activity (bulk reset would be noise; settings/templates are not team activity). */
const UNRECORDED = new Set(["reset", "logBackup"]);
const snapOf = (s: CRMState): EventSnap => ({ leads: s.leads, followUps: s.followUps, deals: s.deals, payments: s.payments, activities: s.activities, assignments: s.assignments, employees: s.employees, employeeAccess: s.employeeAccess });
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
        const evts = deriveEvents(before, snapOf(after), { action: name, operationId: uid("op"), at, actor: { id: OWNER_ACTOR_ID, role: "owner", name: after.owner || "Owner" } });
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

interface CRMState extends Prefs {
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
  restoreAssignments: (snapshot: Record<string, Assignment | undefined>) => void;
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
  teamEvents: ActivityEvent[];
  notifyPrefs: NotifyPrefs;
  notifyReads: ReadState;
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  /** Real-time entry point (future backend feed / reconnect replay) — deduplicated by eventId. */
  ingestEvents: (events: ActivityEvent[]) => void;
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
      teamEvents: [],
      notifyPrefs: DEFAULT_NOTIFY_PREFS,
      notifyReads: EMPTY_READS,
      setNotifyPrefs: (p) => set((s) => ({ notifyPrefs: { ...s.notifyPrefs, ...p } })),
      markNotificationRead: (id) => set((s) => ({ notifyReads: markRead(s.notifyReads, id) })),
      markAllNotificationsRead: () => set({ notifyReads: markAllRead(new Date().toISOString()) }),
      ingestEvents: (events) => set((s) => ({ teamEvents: mergeEvents(s.teamEvents, events.filter((e) => e.eventSource !== "demo")) })),
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
      restoreAssignments: (snap) => set((s) => { const next = { ...s.assignments }; for (const [id, a] of Object.entries(snap)) { if (a) next[id] = a; else delete next[id]; } return { assignments: next }; }),
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
    });
    },
    {
      name: "scale-flow-crm-2-demo",
      version: 3,
      storage: createJSONStorage(() => guardedStorage),
      skipHydration: true,
      // v3: billing quotations are moved, unchanged, into a read-only backup. Nothing is converted automatically.
      migrate: (persisted, version) => migrateQuotations(persisted as Record<string, unknown>, version) as unknown as CRMState,
    },
  ),
);

/** Move pre-v3 billing quotations into `legacyQuotations` untouched; deals and payments are never read or changed. */
export function migrateQuotations(state: Record<string, unknown>, version: number): Record<string, unknown> {
  if (!state || version >= 3) return state;
  const { quotations, ...rest } = state;
  const old = Array.isArray(quotations) ? (quotations as LegacyQuotation[]) : [];
  const prev = Array.isArray(rest["legacyQuotations"]) ? (rest["legacyQuotations"] as LegacyQuotation[]) : [];
  return { ...rest, legacyQuotations: [...prev, ...old], quotationTemplates: rest["quotationTemplates"] ?? [], quotationShares: rest["quotationShares"] ?? [] };
}
