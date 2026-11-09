import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadDto, LeadStatusApi } from "@/lib/api/schemas";
import { telHref } from "@/lib/crm/validation";

const PILOT_CALL_PENDING_KEY = "sf-b2b3-pilot-call-pending";

export interface PilotCallLeadRef {
  id: string;
  name: string;
  phone: string;
  company?: string | undefined;
  status: LeadStatusApi;
  lifecycleStatus: string;
}

export interface PilotCallTarget {
  leadId: string;
  dialSource: string;
  leadSnapshot?: LeadDto | undefined;
  fallbackLead?: PilotCallLeadRef | undefined;
}

export function clearPilotCallPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PILOT_CALL_PENDING_KEY);
  } catch {
    // Ignore storage unavailability in non-browser/restricted environments.
  }
}

function savePilotCallPending(target: PilotCallTarget): void {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      leadId: target.leadId,
      dialSource: target.dialSource,
      fallbackLead:
        target.fallbackLead ??
        (target.leadSnapshot
          ? {
              id: target.leadSnapshot.id,
              name: target.leadSnapshot.name,
              phone: target.leadSnapshot.phone,
              company: target.leadSnapshot.company,
              status: target.leadSnapshot.status,
              lifecycleStatus: target.leadSnapshot.lifecycleStatus,
            }
          : undefined),
    };
    window.sessionStorage.setItem(PILOT_CALL_PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort tab recovery only; never touches localStorage.
  }
}

function readPilotCallPending(): PilotCallTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PILOT_CALL_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PilotCallTarget>;
    if (!parsed || typeof parsed.leadId !== "string" || typeof parsed.dialSource !== "string") {
      return null;
    }
    return {
      leadId: parsed.leadId,
      dialSource: parsed.dialSource,
      ...(parsed.fallbackLead ? { fallbackLead: parsed.fallbackLead } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Isolated tab-scoped dialer launcher for Pilot Mode.
 * Never imports Zustand CRM stores and never touches localStorage.
 */
export function usePilotCallLauncher() {
  const [target, setTarget] = useState<PilotCallTarget | null>(null);
  const pendingRef = useRef<PilotCallTarget | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const openPendingNow = useCallback(
    (next: PilotCallTarget) => {
      clearTimer();
      pendingRef.current = null;
      clearPilotCallPending();
      setTarget(next);
    },
    [clearTimer],
  );

  useEffect(() => {
    const restored = readPilotCallPending();
    if (restored) {
      openPendingNow(restored);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && pendingRef.current) {
        openPendingNow(pendingRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [clearTimer, openPendingNow]);

  const dialLead = useCallback(
    (lead: LeadDto | PilotCallLeadRef, dialSource: string) => {
      if (!telHref(lead.phone) || lead.lifecycleStatus !== "active") return;
      const isFullLead = "version" in lead && typeof lead.version === "number";
      const next: PilotCallTarget = {
        leadId: lead.id,
        dialSource,
        ...(isFullLead ? { leadSnapshot: lead } : { fallbackLead: lead }),
      };
      pendingRef.current = next;
      savePilotCallPending(next);
      clearTimer();
      timerRef.current = setTimeout(() => {
        if (pendingRef.current?.leadId === lead.id) {
          openPendingNow(pendingRef.current);
        }
      }, 400);
    },
    [clearTimer, openPendingNow],
  );

  const openLogOnly = useCallback(
    (lead: LeadDto | PilotCallLeadRef, dialSource: string) => {
      if (lead.lifecycleStatus !== "active") return;
      const isFullLead = "version" in lead && typeof lead.version === "number";
      openPendingNow({
        leadId: lead.id,
        dialSource,
        ...(isFullLead ? { leadSnapshot: lead } : { fallbackLead: lead }),
      });
    },
    [openPendingNow],
  );

  const close = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    clearPilotCallPending();
    setTarget(null);
  }, [clearTimer]);

  return { target, dialLead, openLogOnly, close };
}
