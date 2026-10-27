// Truthful persistence status for the browser prototype. A store action only counts as saved once
// localStorage.setItem actually succeeded; failures are recorded here (no customer data, only sizes/errors).
import { useSyncExternalStore } from "react";

export class PersistError extends Error {
  readonly quota: boolean;
  constructor(cause: unknown) {
    const quota = isQuotaError(cause);
    super(quota ? STORAGE_FULL_MESSAGE : "Your latest changes could not be saved in this browser. Existing saved data has not been deleted.");
    this.name = "PersistError";
    this.quota = quota;
  }
}

export const STORAGE_FULL_MESSAGE = "Your browser storage is full. Your latest changes could not be saved. Existing saved data has not been deleted.";

export function isQuotaError(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === "QuotaExceededError" || x.name === "NS_ERROR_DOM_QUOTA_REACHED" || x.code === 22 || x.code === 1014);
}

export const isPersistError = (e: unknown): e is PersistError => e instanceof Error && e.name === "PersistError";

export interface PersistStatus {
  lastOk: boolean | null;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureKind?: "quota" | "other";
  failures: number;
  /** Bytes of the last attempted write (approximate, UTF-16). */
  lastAttemptBytes?: number;
}

let status: PersistStatus = { lastOk: null, failures: 0 };
const listeners = new Set<() => void>();
const failListeners = new Set<(e: PersistError) => void>();
const emit = () => listeners.forEach((l) => l());

export function recordSave(ok: boolean, bytes: number, err?: unknown) {
  const at = new Date().toISOString();
  status = ok
    ? { ...status, lastOk: true, lastSuccessAt: at, lastAttemptBytes: bytes }
    : { ...status, lastOk: false, lastFailureAt: at, lastFailureKind: isQuotaError(err) ? "quota" : "other", failures: status.failures + 1, lastAttemptBytes: bytes };
  emit();
}
export const getPersistStatus = () => status;
export function resetPersistStatus() { status = { lastOk: null, failures: 0 }; emit(); }
export function usePersistStatus() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => status, () => status);
}
/** Notified once per failed (rolled-back) user action — used by Shell to show one clear message. */
export function onPersistFailure(fn: (e: PersistError) => void) { failListeners.add(fn); return () => { failListeners.delete(fn); }; }
export function notifyPersistFailure(e: PersistError) { failListeners.forEach((f) => f(e)); }

/** True while the most recent write failed — background work pauses instead of retrying in a loop. */
export const savesFailing = () => status.lastOk === false;
/** A save succeeded right after a failure: the earlier "not saved" notice is now outdated and should be cleared. */
export const recoveredFromFailure = (prevOk: boolean | null, nextOk: boolean | null) => prevOk === false && nextOk === true;

// ---- measurement (pure) ----
export const strBytes = (s: string) => s.length * 2; // localStorage stores UTF-16 code units

export interface KeySize { key: string; bytes: number }
export function measureStorage(st: Pick<Storage, "length" | "key" | "getItem">): { total: number; keys: KeySize[] } {
  const keys: KeySize[] = [];
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i); if (k == null) continue;
    keys.push({ key: k, bytes: strBytes(k) + strBytes(st.getItem(k) ?? "") });
  }
  keys.sort((a, b) => b.bytes - a.bytes);
  return { total: keys.reduce((n, k) => n + k.bytes, 0), keys };
}

export const CATEGORIES: Record<string, string[]> = {
  Leads: ["leads", "leadTags", "fieldValues", "inboxMeta", "leadRelations", "bin"],
  Activity: ["activities", "teamEvents", "callOps", "assignmentEvents"],
  "Follow-ups": ["followUps", "reminders"],
  "Deals & payments": ["deals", "payments", "legacyQuotations"],
  Projects: ["projects", "projectTasks", "supportRequests", "projectTags", "projectFieldValues", "projectFields"],
  Notes: ["notes"],
  Automation: ["automationRules", "automationRuns", "automationLog"],
  "Team": ["employees", "employeeAccess", "assignments", "goals"],
};

/** Approximate bytes per CRM category from the persisted JSON (no values are returned). */
export function categorySizes(json: string | null): { name: string; bytes: number }[] {
  if (!json) return [];
  let state: Record<string, unknown>;
  try { state = (JSON.parse(json) as { state?: Record<string, unknown> }).state ?? {}; } catch { return []; }
  const used = new Set<string>();
  const out = Object.entries(CATEGORIES).map(([name, ks]) => ({ name, bytes: ks.reduce((n, k) => { if (!(k in state)) return n; used.add(k); return n + strBytes(JSON.stringify(state[k]) ?? ""); }, 0) }));
  const other = Object.keys(state).filter((k) => !used.has(k)).reduce((n, k) => n + strBytes(JSON.stringify(state[k]) ?? ""), 0);
  out.push({ name: "Settings & other", bytes: other });
  return out.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}
