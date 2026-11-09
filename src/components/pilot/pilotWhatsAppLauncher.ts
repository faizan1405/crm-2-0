import { useCallback, useEffect, useState } from "react";
import type { FollowUpTypeApi, LeadDto, LeadStatusApi, WaPurposeApi } from "@/lib/api/schemas";

export const PILOT_WA_PENDING_KEY = "sf-b2b4-pilot-wa-pending";

export interface PilotWhatsAppLeadRef {
  id: string;
  name: string;
  phone: string;
  company?: string | undefined;
  requirement?: string | undefined;
  quotedAmount?: number | undefined;
  status: LeadStatusApi;
  lifecycleStatus: string;
}

export interface PilotWhatsAppDraftState {
  purpose: WaPurposeApi;
  templateId: string | null;
  text: string;
  base: string;
  edited: boolean;
  opened: boolean;
  needFollow: boolean;
  followUpType: FollowUpTypeApi;
  when: string;
  followUpNote: string;
}

export interface PilotWhatsAppTarget {
  leadId: string;
  composerSource: string;
  leadSnapshot?: LeadDto | undefined;
  fallbackLead?: PilotWhatsAppLeadRef | undefined;
  initialPurpose?: WaPurposeApi | undefined;
  restoredDraft?: PilotWhatsAppDraftState | undefined;
}

export function clearPilotWhatsAppPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PILOT_WA_PENDING_KEY);
  } catch {
    // Ignore storage unavailability in non-browser/restricted environments.
  }
}

export function savePilotWhatsAppPending(
  target: PilotWhatsAppTarget,
  draft?: PilotWhatsAppDraftState,
): void {
  if (typeof window === "undefined") return;
  try {
    const fallbackLead: PilotWhatsAppLeadRef | undefined =
      target.fallbackLead ??
      (target.leadSnapshot
        ? {
            id: target.leadSnapshot.id,
            name: target.leadSnapshot.name,
            phone: target.leadSnapshot.phone,
            company: target.leadSnapshot.company,
            requirement: target.leadSnapshot.requirement,
            quotedAmount: target.leadSnapshot.quotedAmount,
            status: target.leadSnapshot.status,
            lifecycleStatus: target.leadSnapshot.lifecycleStatus,
          }
        : undefined);

    const payload = {
      leadId: target.leadId,
      composerSource: target.composerSource,
      ...(fallbackLead ? { fallbackLead } : {}),
      ...(target.initialPurpose ? { initialPurpose: target.initialPurpose } : {}),
      ...(draft ? { restoredDraft: draft } : {}),
    };
    window.sessionStorage.setItem(PILOT_WA_PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort tab recovery only; never touches localStorage.
  }
}

export function readPilotWhatsAppPending(): PilotWhatsAppTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PILOT_WA_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PilotWhatsAppTarget>;
    if (!parsed || typeof parsed.leadId !== "string" || typeof parsed.composerSource !== "string") {
      return null;
    }
    return {
      leadId: parsed.leadId,
      composerSource: parsed.composerSource,
      ...(parsed.fallbackLead ? { fallbackLead: parsed.fallbackLead } : {}),
      ...(parsed.initialPurpose ? { initialPurpose: parsed.initialPurpose } : {}),
      ...(parsed.restoredDraft ? { restoredDraft: parsed.restoredDraft } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Isolated tab-scoped WhatsApp composer launcher for Pilot Mode.
 * Never imports Zustand CRM stores and never touches localStorage.
 */
export function usePilotWhatsAppLauncher() {
  const [target, setTarget] = useState<PilotWhatsAppTarget | null>(null);

  useEffect(() => {
    const restored = readPilotWhatsAppPending();
    if (restored) {
      setTarget(restored);
    }
  }, []);

  const openWhatsAppComposer = useCallback(
    (
      lead: LeadDto | PilotWhatsAppLeadRef,
      composerSource: string,
      initialPurpose?: WaPurposeApi,
    ) => {
      if (lead.lifecycleStatus !== "active") return;
      const isFullLead = "version" in lead && typeof lead.version === "number";
      const next: PilotWhatsAppTarget = {
        leadId: lead.id,
        composerSource,
        ...(isFullLead ? { leadSnapshot: lead } : { fallbackLead: lead }),
        ...(initialPurpose ? { initialPurpose } : {}),
      };
      savePilotWhatsAppPending(next);
      setTarget(next);
    },
    [],
  );

  const close = useCallback(() => {
    clearPilotWhatsAppPending();
    setTarget(null);
  }, []);

  return { target, openComposer: openWhatsAppComposer, openWhatsAppComposer, close };
}
