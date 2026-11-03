// Phase 3B.6 — the Employee Workspace Preview session (frontend simulation only).
// While a preview runs, the real CRM pages operate on an isolated in-memory working copy:
// persistence is paused so the Owner's saved records are never written, and every store
// action is checked against the previewed employee's saved permissions. This is NOT a login
// and NOT security — the future Hostinger backend must enforce the same rules server-side.
import { create } from "zustand";
import type { FinanceLevel, LeadScope } from "./access";

export interface PreviewSession {
  employeeId: string;
  name: string;
  roleLabel: string;
  allowed: string[];
  leadScope: LeadScope;
  finance: FinanceLevel;
  startedAt: string;
}

/** Future production event shapes (Section 10). The backend persists, broadcasts and notifies; here they are only collected in the preview. */
export type CrmEventType = "lead.created" | "lead.updated" | "call.logged" | "followup.created" | "followup.completed" | "pipeline.stage_changed" | "client.note_added" | "lead.assigned";
export interface CrmEvent { id: string; type: CrmEventType; actorId: string; at: string; resourceId?: string; change?: unknown }
export interface CrmEventSink { emit: (e: CrmEvent) => void }

interface SessionState { preview: PreviewSession | null; events: CrmEvent[] }
export const useSession = create<SessionState>(() => ({ preview: null, events: [] }));
export const activePreview = () => useSession.getState().preview;

/** Pseudo-permissions: `__owner` is never granted to an employee; `__finance` = record/void payments. */
export function allows(p: PreviewSession | null, perm: string): boolean {
  if (!p) return true;
  if (perm === "__owner") return false;
  if (perm === "__finance") return p.finance === "manage" && p.allowed.includes("deals.edit");
  return p.allowed.includes(perm);
}
export const previewAllows = (perm: string) => allows(activePreview(), perm);

/** Preview-only sink. Swap for an authenticated API client when the backend exists. */
export const previewSink: CrmEventSink = {
  emit: (e) => useSession.setState((s) => ({ events: [e, ...s.events].slice(0, 200) })),
};

/** Permission needed to open each page. Owner-only pages can never be granted. */
export const ROUTE_PERM: Record<string, string> = {
  "/": "dashboard.view", "/leads/bin": "leads.delete", "/leads": "leads.view", "/inbox": "leads.view", "/ai-copilot": "leads.view", "/pipeline": "pipeline.view", "/follow-ups": "followups.view",
  "/deals": "deals.view", "/sales-studio": "studio.view", "/notes": "notes.own", "/analytics": "__owner", "/projects": "projects.view",
  "/daily-briefing": "briefing.view", "/my-performance": "dashboard.view", "/team-performance": "__owner", "/team-activity": "__owner", "/automation": "__owner", "/crm-config": "__owner", "/team": "__owner", "/data-vault": "__owner", "/settings": "__owner", "/login": "__owner",
};
export function routeAllowed(p: PreviewSession | null, path: string): boolean {
  if (!p) return true;
  const key = Object.keys(ROUTE_PERM).filter((k) => (k === "/" ? path === "/" : path.startsWith(k))).sort((a, b) => b.length - a.length)[0];
  if (!key) return true;
  if (key === "/deals" && (p.finance === "none" || p.finance === "status")) return false;
  return allows(p, ROUTE_PERM[key]!);
}

/** UI hook: `can` is always true for the Owner. */
export function useAccess() {
  const preview = useSession((s) => s.preview);
  return { preview, can: (perm: string) => allows(preview, perm) };
}

export const CALL_LOG_DENIED = "You don't have permission to log calls.";
export const FOLLOWUP_DENIED = "You don't have permission to schedule or change follow-ups.";
/** Permission needed before showing the follow-up form: new follow-ups need create, rescheduling needs edit. */
export const followUpPermission = (reschedule: boolean) => (reschedule ? "followups.edit" : "followups.create");
/** Shown whenever a stage change is refused (Pipeline drag, card select, Prospects, inspectors). */
export const STAGE_DENIED = "You don't have permission to change this lead's stage.";
export const canChangeStage = (p: PreviewSession | null) => allows(p, "pipeline.edit") || allows(p, "leads.edit");

/** Assignee filter choices. Assigned-only previews see just themselves ("My leads"); filters never widen record scope. */
export function assigneeChoices<E extends { id: string; name: string; accountStatus?: string }>(p: PreviewSession | null, employees: E[]): { id: string; name: string }[] {
  const live = employees.filter((e) => e.accountStatus !== "archived");
  if (!p) return live.map((e) => ({ id: e.id, name: e.name }));
  if (p.leadScope === "assigned") return [{ id: p.employeeId, name: "My leads" }];
  return live.map((e) => ({ id: e.id, name: e.id === p.employeeId ? `${e.name} (me)` : e.name }));
}
