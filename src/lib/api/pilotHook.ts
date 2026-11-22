import { useEffect, useState } from "react";
import { useAuthStore, useResolvedAuthState } from "@/lib/auth/authClient";
import {
  normalizePilotParam,
  readLeadPilotSessionOptIn,
  resolveLeadPilotActive,
  setLeadPilotSessionOptIn,
  type PilotParamValue,
} from "./pilotGate";

export interface PilotSearchFlag {
  pilot?: 1 | 0;
}

/**
 * B14F: Returns clean `{}` (plus any extra params) when `CRM_V2_DEFAULT_BACKEND=true`,
 * omitting unnecessary `?pilot=1` query parameters across all in-page CTA links and redirects.
 * In legacy dev pilot mode (`crmV2DefaultBackend === false`), preserves `{ pilot: 1 }`.
 */
export function pilotLinkSearch<T extends Record<string, unknown> = Record<string, never>>(
  extra?: T,
): T & PilotSearchFlag {
  const isDefault = useAuthStore.getState().crmV2DefaultBackend;
  const base = (extra ?? {}) as T;
  return isDefault
    ? ({ ...base } as T & PilotSearchFlag)
    : ({ ...base, pilot: 1 } as T & PilotSearchFlag);
}

export function parsePilotSearch(s: Record<string, unknown>): PilotSearchFlag {
  const out: PilotSearchFlag = {};
  const normalized = normalizePilotParam(s["pilot"]);
  if (normalized === "1") out.pilot = 1;
  else if (normalized === "0") out.pilot = 0;
  return out;
}

/**
 * Resolves Dev Lead Pilot activation safely without SSR/client hydration mismatches
 * and without prematurely mounting local CRM `<Shell>` while pilot/session opt-in is unresolved.
 * Strictly returns `{ leadPilotAvailable: false, pilotActive: false }` in production
 * or whenever server `DEV_LEAD_PILOT` is disabled.
 */
export function useLeadPilotState(searchPilot?: PilotParamValue): {
  leadPilotAvailable: boolean;
  pilotActive: boolean;
  pilotResolved: boolean;
  defaultBackendActive: boolean;
} {
  const {
    status: authStatus,
    leadPilotAvailable: serverAvailable,
    crmV2DefaultBackend: serverDefaultBackend,
  } = useResolvedAuthState();
  const defaultBackendActive = authStatus === "authenticated" && Boolean(serverDefaultBackend);
  const leadPilotAvailable =
    defaultBackendActive || (authStatus === "authenticated" && serverAvailable);
  const [sessionOptIn, setSessionOptIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const normalizedSearch = normalizePilotParam(searchPilot);

  useEffect(() => {
    if (defaultBackendActive) {
      setSessionOptIn(true);
      setSessionChecked(true);
      return;
    }
    if (!leadPilotAvailable) {
      setSessionOptIn(false);
      setSessionChecked(authStatus !== "unknown");
      if (authStatus !== "unknown") {
        setLeadPilotSessionOptIn(false);
      }
      return;
    }
    if (normalizedSearch === "1") {
      setLeadPilotSessionOptIn(true);
      setSessionOptIn(true);
      setSessionChecked(true);
      return;
    }
    if (normalizedSearch === "0") {
      setLeadPilotSessionOptIn(false);
      setSessionOptIn(false);
      setSessionChecked(true);
      return;
    }
    setSessionOptIn(readLeadPilotSessionOptIn());
    setSessionChecked(true);
  }, [authStatus, defaultBackendActive, leadPilotAvailable, normalizedSearch]);

  // B14A: When CRM_V2_DEFAULT_BACKEND=true, MariaDB is the default data source without `?pilot=1`
  // and never silently falls back to local demo data.
  const pilotActive = defaultBackendActive
    ? true
    : resolveLeadPilotActive({
        leadPilotAvailable,
        searchPilot: normalizedSearch,
        sessionOptIn,
      });

  const pilotResolved =
    authStatus !== "unknown" &&
    (defaultBackendActive ||
      !leadPilotAvailable ||
      normalizedSearch !== undefined ||
      sessionChecked);

  return { leadPilotAvailable, pilotActive, pilotResolved, defaultBackendActive };
}
