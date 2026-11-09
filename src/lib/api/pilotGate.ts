const PILOT_SESSION_KEY = "sf-b2b1-lead-pilot-mode";

export type PilotParamValue = "1" | "0" | 1 | 0;

export function normalizePilotParam(value: unknown): "1" | "0" | undefined {
  if (value === 1 || value === "1" || value === true || value === "true") return "1";
  if (value === 0 || value === "0" || value === false || value === "false") return "0";
  return undefined;
}

export interface PilotActivationInput {
  leadPilotAvailable: boolean;
  searchPilot?: PilotParamValue | undefined;
  sessionOptIn: boolean;
}

/**
 * Resolves whether Dev Lead Pilot mode should be active.
 * Server availability (`NODE_ENV !== "production" && DEV_LEAD_PILOT === true`) overrides any client URL or session flag.
 */
export function resolveLeadPilotActive(input: PilotActivationInput): boolean {
  if (!input.leadPilotAvailable) return false;
  const normalized = normalizePilotParam(input.searchPilot);
  if (normalized === "0") return false;
  if (normalized === "1") return true;
  return input.sessionOptIn;
}

export function readLeadPilotSessionOptIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PILOT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLeadPilotSessionOptIn(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      window.sessionStorage.setItem(PILOT_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(PILOT_SESSION_KEY);
    }
  } catch {
    // Ignore storage access errors in private browsing environments.
  }
}
