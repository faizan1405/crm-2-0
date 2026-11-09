import { useEffect, useState } from "react";
import { useResolvedAuthState } from "@/lib/auth/authClient";
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
} {
  const { status: authStatus, leadPilotAvailable: serverAvailable } = useResolvedAuthState();
  const leadPilotAvailable = authStatus === "authenticated" && serverAvailable;
  const [sessionOptIn, setSessionOptIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const normalizedSearch = normalizePilotParam(searchPilot);

  useEffect(() => {
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
  }, [authStatus, leadPilotAvailable, normalizedSearch]);

  const pilotActive = resolveLeadPilotActive({
    leadPilotAvailable,
    searchPilot: normalizedSearch,
    sessionOptIn,
  });

  const pilotResolved =
    authStatus !== "unknown" &&
    (!leadPilotAvailable || normalizedSearch !== undefined || sessionChecked);

  return { leadPilotAvailable, pilotActive, pilotResolved };
}
