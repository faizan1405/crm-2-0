// Team Management (Phase 3A) — pure models, rules and future service contracts.
// Browser-local profiles only. No passwords, hashes, sessions or tokens ever live here:
// authentication and authorization are enforced by the future Hostinger backend.

export type AccountStatus = "pending" | "active" | "inactive" | "archived";
export type SystemRoleId = "owner" | "salesperson" | "sales_manager" | "custom";

export interface Role { id: SystemRoleId | string; name: string; description: string; isSystemRole: boolean; createdAt: string }

/** Employee profile (future `User`). Security-sensitive fields come from the server only. */
export interface Employee {
  id: string;
  name: string;
  email: string;
  roleId: Exclude<SystemRoleId, "owner">;
  customRoleLabel?: string;
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  invitedAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

export const RESOURCES = ["dashboard", "leads", "pipeline", "followups", "deals", "clients", "notes", "analytics", "quotations", "sales_studio", "team", "settings"] as const;
export const ACTIONS = ["view", "create", "edit", "delete", "import", "export", "manage"] as const;
export type Resource = (typeof RESOURCES)[number];
export type PermissionAction = (typeof ACTIONS)[number];
export interface Permission { id: `${Resource}:${PermissionAction}`; resource: Resource; action: PermissionAction }
export interface RolePermission { roleId: string; permissionId: Permission["id"]; allowed: boolean }
export interface UserPermission { userId: string; permissionId: Permission["id"]; allowed: boolean }
export interface LeadAssignment { id: string; leadId: string; assignedToUserId: string; assignedByUserId: string; assignedAt: string; status: "active" | "returned" | "reassigned" }
export interface AuditEvent { id: string; actorUserId: string; action: string; resourceType: string; resourceId: string; timestamp: string; metadata?: Record<string, unknown> }

/** Resources only the Owner may ever reach; the backend must enforce this. */
export const OWNER_ONLY: readonly Resource[] = ["team"];

export const ROLES: Role[] = [
  { id: "owner", name: "Owner", description: "Permanent super admin. Full access; cannot be removed, disabled or demoted.", isSystemRole: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "sales_manager", name: "Sales Manager", description: "Planned: manage assigned team leads, pipeline and follow-ups.", isSystemRole: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "salesperson", name: "Salesperson", description: "Planned: work only on assigned leads and their follow-ups.", isSystemRole: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "custom", name: "Custom Role", description: "Planned: permissions chosen in the Phase 3B Permission Manager.", isSystemRole: false, createdAt: "2026-01-01T00:00:00.000Z" },
];
/** Planned (not enforced) access summary shown read-only in the inspector. */
export const PLANNED_ACCESS: Record<Employee["roleId"], Resource[]> = {
  sales_manager: ["dashboard", "leads", "pipeline", "followups", "clients", "quotations", "sales_studio", "analytics"],
  salesperson: ["dashboard", "leads", "pipeline", "followups", "clients", "quotations"],
  custom: [],
};
export const RESOURCE_LABEL: Record<Resource, string> = { dashboard: "Dashboard", leads: "Leads", pipeline: "Pipeline", followups: "Follow-ups", deals: "Deals & Payments", clients: "Client information", notes: "Personal Notes", analytics: "Analytics", quotations: "Quotations", sales_studio: "Sales Studio", team: "Team Management", settings: "Settings" };
export const STATUS_LABEL: Record<AccountStatus, string> = { pending: "Pending setup", active: "Active", inactive: "Inactive", archived: "Removed" };

export const roleLabel = (e: Pick<Employee, "roleId" | "customRoleLabel">) => (e.roleId === "custom" && e.customRoleLabel?.trim()) || ROLES.find((r) => r.id === e.roleId)?.name || "Role";
export const normalizeEmail = (v: string) => v.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FORBIDDEN_KEYS = /pass|hash|token|secret|session/i;

export interface EmployeeInput { name: string; email: string; roleId: Employee["roleId"]; customRoleLabel?: string; accountStatus: "pending" | "inactive" | "active" }

/** Returns a user-facing error or null. `ownerEmail` can never be reused by an employee. */
export function employeeError(input: EmployeeInput, existing: Employee[], ownerEmail: string, selfId?: string): string | null {
  if (!input.name.trim()) return "Enter the employee's full name.";
  if (input.name.trim().length > 80) return "Name is too long.";
  const email = normalizeEmail(input.email);
  if (!email) return "Enter an email address.";
  if (!EMAIL.test(email) || email.length > 160) return "Enter a valid email address.";
  if (ownerEmail && email === normalizeEmail(ownerEmail)) return "That email belongs to the Owner.";
  if (existing.some((e) => e.id !== selfId && e.accountStatus !== "archived" && normalizeEmail(e.email) === email)) return "An employee with this email already exists.";
  if (!ROLES.some((r) => r.id !== "owner" && r.id === (input.roleId as string))) return "Choose a role.";
  if (input.roleId === "custom" && !input.customRoleLabel?.trim()) return "Name the custom role.";
  for (const k of Object.keys(input)) if (FORBIDDEN_KEYS.test(k)) return "Credentials can't be stored in the demo.";
  return null;
}

export function buildEmployee(input: EmployeeInput, id: string, now: string): Employee {
  return {
    id, name: input.name.trim(), email: normalizeEmail(input.email), roleId: input.roleId,
    ...(input.roleId === "custom" && input.customRoleLabel?.trim() ? { customRoleLabel: input.customRoleLabel.trim() } : {}),
    accountStatus: input.accountStatus, createdAt: now, updatedAt: now,
    lastLoginAt: null, invitedAt: null, activatedAt: null, deactivatedAt: input.accountStatus === "inactive" ? now : null,
  };
}

export function withStatus(e: Employee, status: AccountStatus, now: string): Employee {
  return { ...e, accountStatus: status, updatedAt: now, ...(status === "inactive" || status === "archived" ? { deactivatedAt: now } : {}), ...(status === "active" ? { deactivatedAt: null } : {}) };
}

export type TeamSort = "name" | "newest" | "oldest";
export type TeamFilter = "all" | AccountStatus;
export function filterEmployees(list: Employee[], q: string, status: TeamFilter, sort: TeamSort): Employee[] {
  const t = q.trim().toLowerCase();
  return list
    .filter((e) => (status === "all" ? e.accountStatus !== "archived" : e.accountStatus === status))
    .filter((e) => !t || `${e.name} ${e.email} ${roleLabel(e)}`.toLowerCase().includes(t))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
}

export function teamSummary(list: Employee[]) {
  const live = list.filter((e) => e.accountStatus !== "archived");
  return { total: live.length, active: live.filter((e) => e.accountStatus === "active").length, inactive: live.filter((e) => e.accountStatus === "inactive").length, pending: live.filter((e) => e.accountStatus === "pending").length };
}

// ---------- Future backend contracts (Hostinger). Not implemented in the browser. ----------
export type BackendResult<T = void> = { ok: true; data: T } | { ok: false; reason: "backend_required" | "invalid" | "forbidden"; message: string };
export interface AuthService {
  signIn(email: string, password: string): Promise<BackendResult<{ userId: string; roleId: string }>>;
  requestPasswordReset(email: string): Promise<BackendResult>;
  revokeSessions(userId: string): Promise<BackendResult>;
}
export interface TeamService {
  inviteEmployee(employeeId: string): Promise<BackendResult>;
  setStatus(employeeId: string, status: AccountStatus): Promise<BackendResult>;
}
export interface PermissionService {
  can(userId: string, resource: Resource, action: PermissionAction): Promise<boolean>;
}
const NEEDS_BACKEND = { ok: false as const, reason: "backend_required" as const, message: "Sign-in needs the secure backend, which isn't connected yet." };
/** Demo implementation: never authenticates, never fakes a token. */
export const demoAuth: AuthService = {
  signIn: async () => NEEDS_BACKEND,
  requestPasswordReset: async () => ({ ...NEEDS_BACKEND, message: "Password reset needs the secure backend, which isn't connected yet." }),
  revokeSessions: async () => ({ ...NEEDS_BACKEND, message: "There are no real sessions to revoke in the demo." }),
};
