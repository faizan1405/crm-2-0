// Isolated Employee Workspace Preview: snapshot Owner data, swap in a scoped working copy, restore on exit.
import { syncFromStorage, useCRM } from "./store";
import { useSession, type PreviewSession } from "./session";
import { resolve, leadsInScope, type Assignment, type Effective } from "./access";
import { roleLabel, type Employee } from "./team";
import type { Deal, FollowUp, Lead, LeadActivity, Payment } from "./types";
import type { QuotationShare } from "./studio";
import { scopeProjectCustomization } from "./projectCustomize";
import { scopeProjects, type Project, type ProjectMilestone, type ProjectTask, type SupportRequest } from "./projects";
import { scopeCustomization, viewAllowed, type CustomFieldDef, type FieldValues, type LeadTags, type SavedView } from "./customize";

interface ScopeInput { leads: Lead[]; followUps: FollowUp[]; activities: LeadActivity[]; deals: Deal[]; payments: Payment[]; quotationShares: QuotationShare[]; assignments: Record<string, Assignment>; customFields?: CustomFieldDef[]; fieldValues?: FieldValues; leadTags?: LeadTags; savedViews?: SavedView[]; projects?: Project[]; projectTasks?: ProjectTask[]; projectMilestones?: ProjectMilestone[]; supportRequests?: SupportRequest[]; projectFields?: CustomFieldDef[]; projectFieldValues?: FieldValues; projectTags?: LeadTags }

export const FINANCE_REDACTED = "Finance update (details hidden — no finance access)";

/** Pure: the working copy an employee would receive from the backend. Owner notes are never included. */
export function scopeWorkspace(d: ScopeInput, employeeId: string, eff: Effective) {
  const leads = leadsInScope(d.leads, employeeId, eff, d.assignments);
  const ids = new Set(leads.map((l) => l.id));
  const money = eff.finance === "amounts" || eff.finance === "manage";
  const deals = money ? d.deals.filter((x) => x.leadId && ids.has(x.leadId)) : [];
  const dealIds = new Set(deals.map((x) => x.id));
  return {
    leads,
    followUps: eff.can("followups.view") ? d.followUps.filter((f) => ids.has(f.leadId)) : [],
    // Money history is redacted for employees without an amounts finance level (backend would do the same).
    activities: d.activities.filter((a) => ids.has(a.leadId)).map((a) => (a.type === "payment" && !money ? { ...a, text: FINANCE_REDACTED } : a)),
    deals,
    payments: d.payments.filter((p) => dealIds.has(p.dealId)),
    quotationShares: d.quotationShares.filter((s) => ids.has(s.leadId)),
    // Sensitive (Owner-only) field definitions and values never reach the employee copy; views never widen record scope.
    ...(() => { const viewer = { owner: false as const, employeeId, canEdit: eff.can("leads.edit") }; const c = scopeCustomization(d.customFields ?? [], d.fieldValues ?? {}, ids, viewer); return { ...c, leadTags: Object.fromEntries(Object.entries(d.leadTags ?? {}).filter(([id]) => ids.has(id))), savedViews: (d.savedViews ?? []).filter((v) => !v.archived && viewAllowed(v, viewer)) }; })(),
    // Projects: only those the employee is assigned to, and only with the projects.view permission.
    ...(() => {
      const sp = scopeProjects({ projects: d.projects ?? [], projectTasks: d.projectTasks ?? [], projectMilestones: d.projectMilestones ?? [], supportRequests: d.supportRequests ?? [] }, { owner: false, employeeId, can: (k) => eff.can(k), financeAmounts: money });
      // Owner-only Project fields and their values never reach the employee copy.
      const pc = scopeProjectCustomization(d.projectFields ?? [], d.projectFieldValues ?? {}, d.projectTags ?? {}, new Set(sp.projects.map((p) => p.id)), { owner: false, employeeId, canEdit: eff.can("projects.edit") });
      return { ...sp, ...pc };
    })(),
    automationRules: [], automationRuns: [],
    notes: [], bin: [], callOps: [], briefingDone: [], legacyQuotations: [], backupHistory: [], assignmentRules: [], firedRules: [],
  };
}

let snapshot: Record<string, unknown> | null = null;
const dataOnly = (s: object) => Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== "function"));

export function startPreview(e: Employee): PreviewSession {
  if (snapshot) exitPreview();
  const st = useCRM.getState();
  const eff = resolve(e.roleId, st.employeeAccess[e.id]);
  snapshot = structuredClone(dataOnly(st));
  const session: PreviewSession = { employeeId: e.id, name: e.name, roleLabel: roleLabel(e), allowed: [...eff.allowed], leadScope: eff.leadScope, finance: eff.finance, startedAt: new Date().toISOString() };
  useSession.setState({ preview: session, events: [] }); // pauses persistence first
  useCRM.setState({ ...scopeWorkspace(st, e.id, eff), ruleSettings: { ...st.ruleSettings, autoEnabled: false } });
  return session;
}

/** Throws away every preview change and puts the Owner's records back exactly. */
export function exitPreview() {
  const snap = snapshot;
  snapshot = null;
  if (snap) useCRM.setState(snap);
  useSession.setState({ preview: null, events: [] });
  syncFromStorage(); // another tab may have saved while the preview ran — show the latest Owner records
}
