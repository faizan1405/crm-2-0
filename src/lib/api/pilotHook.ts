import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth/authClient";
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
 * Resolves Dev Lead Pilot activation safely without SSR/client hydration mismatches.
 * Strictly returns `{ leadPilotAvailable: false, pilotActive: false }` in production
 * or whenever server `DEV_LEAD_PILOT` is disabled.
 */
export function useLeadPilotState(searchPilot?: PilotParamValue): {
  leadPilotAvailable: boolean;
  pilotActive: boolean;
} {
  const authStatus = useAuthStore((s) => s.status);
  const serverAvailable = useAuthStore((s) => s.leadPilotAvailable);
  const leadPilotAvailable = authStatus === "authenticated" && serverAvailable;
  const [sessionOptIn, setSessionOptIn] = useState(false);
  const normalizedSearch = normalizePilotParam(searchPilot);

  useEffect(() => {
    if (!leadPilotAvailable) {
      setSessionOptIn(false);
      setLeadPilotSessionOptIn(false);
      return;
    }
    if (normalizedSearch === "1") {
      setLeadPilotSessionOptIn(true);
      setSessionOptIn(true);
      return;
    }
    if (normalizedSearch === "0") {
      setLeadPilotSessionOptIn(false);
      setSessionOptIn(false);
      return;
    }
    setSessionOptIn(readLeadPilotSessionOptIn());
  }, [leadPilotAvailable, normalizedSearch]);

  const pilotActive = resolveLeadPilotActive({
    leadPilotAvailable,
    searchPilot: normalizedSearch,
    sessionOptIn,
  });

  return { leadPilotAvailable, pilotActive };
}
