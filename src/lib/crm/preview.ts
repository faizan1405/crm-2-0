// Isolated Employee Workspace Preview: snapshot Owner data, swap in a scoped working copy, restore on exit.
import { useCRM } from "./store";
import { useSession, type PreviewSession } from "./session";
import { resolve, leadsInScope, type Assignment, type Effective } from "./access";
import { roleLabel, type Employee } from "./team";
import type { Deal, FollowUp, Lead, LeadActivity, Payment } from "./types";
import type { QuotationShare } from "./studio";

interface ScopeInput { leads: Lead[]; followUps: FollowUp[]; activities: LeadActivity[]; deals: Deal[]; payments: Payment[]; quotationShares: QuotationShare[]; assignments: Record<string, Assignment> }

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
    activities: d.activities.filter((a) => ids.has(a.leadId)),
    deals,
    payments: d.payments.filter((p) => dealIds.has(p.dealId)),
    quotationShares: d.quotationShares.filter((s) => ids.has(s.leadId)),
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
}
