import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Phone, PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createIdempotencyKey } from "@/lib/api/client";
import { useCreateCallMutation } from "@/lib/api/callsApi";
import {
  extractFieldValidationErrors,
  extractFollowUpConflict,
  extractStaleConflict,
  formatApiErrorMessage,
  isApiError,
} from "@/lib/api/errors";
import { useCreateFollowUpMutation, useLeadFollowUpsQuery } from "@/lib/api/followupsApi";
import { getLead, leadKeys, useLeadQuery } from "@/lib/api/leadsApi";
import {
  CALL_OUTCOMES_API,
  FOLLOWUP_TYPES_API,
  parseIstDateTimeInput,
  type CallLogDto,
  type CallOutcomeApi,
  type FollowUpDto,
  type FollowUpTypeApi,
  type LeadDto,
  type LeadStatusApi,
} from "@/lib/api/schemas";
import {
  callLogError,
  DATE_SHORTCUTS,
  isConnectedOutcome,
  needsStageConfirm,
  outcomeStage,
  shortcutValue,
  type CallOutcome,
} from "@/lib/crm/calllog";
import { formatDateTime } from "@/lib/crm/format";
import { QUICK_LABEL } from "@/lib/crm/leadtools";
import { FOLLOWUP_LABEL, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { telHref } from "@/lib/crm/validation";
import { cn } from "@/lib/utils";
import { selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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

export function PilotCallLink({
  lead,
  dialSource,
  compact,
  className,
  onDialStarted,
  disabled,
}: {
  lead: LeadDto | PilotCallLeadRef;
  dialSource: string;
  compact?: boolean | undefined;
  className?: string | undefined;
  onDialStarted: (lead: LeadDto | PilotCallLeadRef, dialSource: string) => void;
  disabled?: boolean | undefined;
}) {
  const href = telHref(lead.phone);
  const blocked = Boolean(disabled || lead.lifecycleStatus !== "active" || !href);

  return (
    <a
      href={blocked ? undefined : (href ?? undefined)}
      aria-disabled={blocked || undefined}
      draggable={false}
      aria-label={`Call ${lead.name}`}
      title={
        lead.lifecycleStatus !== "active"
          ? "Restore archived lead to call"
          : !href
            ? "No valid phone number to dial"
            : `Call ${lead.name}`
      }
      onClick={(e) => {
        e.stopPropagation();
        if (blocked) {
          e.preventDefault();
          return;
        }
        onDialStarted(lead, dialSource);
      }}
      className={cn(
        "call-btn",
        compact && "is-compact",
        blocked && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Phone className="size-3.5" />
      {!compact && <span>Call</span>}
    </a>
  );
}

export function PilotCallDialog({
  target,
  onClose,
  onSaved,
}: {
  target: PilotCallTarget | null;
  onClose: () => void;
  onSaved?:
    ((res: { call: CallLogDto; lead: LeadDto; followUp?: FollowUpDto }) => void) | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createCallMutation = useCreateCallMutation();
  const createFollowUpMutation = useCreateFollowUpMutation();

  const open = Boolean(target);
  const shouldFetchFullLead = Boolean(open && target && !target.leadSnapshot);
  const hydratedLeadQuery = useLeadQuery(target?.leadId, shouldFetchFullLead);

  const [baseLead, setBaseLead] = useState<LeadDto | null>(target?.leadSnapshot ?? null);
  const [outcome, setOutcome] = useState<CallOutcomeApi | null>(null);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<LeadStatusApi>(
    target?.leadSnapshot?.status ?? target?.fallbackLead?.status ?? "new",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [lostReason, setLostReason] = useState("");

  const [needFollow, setNeedFollow] = useState(false);
  const [followUpType, setFollowUpType] = useState<FollowUpTypeApi>("call");
  const [when, setWhen] = useState(() => shortcutValue("Tomorrow"));
  const [followUpNote, setFollowUpNote] = useState("");
  const [conflictChoice, setConflictChoice] = useState<"keep" | "replace" | null>(null);

  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optimistic lock recovery if lead changed concurrently before Step 1 saved
  const [staleLatestLead, setStaleLatestLead] = useState<LeadDto | null>(null);
  const [showLatestDiff, setShowLatestDiff] = useState(false);

  // Two-step checkpoint: once Step 1 (`POST /api/v1/calls`) succeeds, NEVER re-submit Step 1
  const [savedCall, setSavedCall] = useState<CallLogDto | null>(null);
  const [pendingAndOpen, setPendingAndOpen] = useState(false);
  const [step2ConflictActive, setStep2ConflictActive] = useState<FollowUpDto | null>(null);
  const [step2StaleHint, setStep2StaleHint] = useState<string | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  const callIdemKeyRef = useRef<string>(createIdempotencyKey());
  const fuIdemKeyRef = useRef<string>(createIdempotencyKey());
  const fuReplaceIdemKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!target) {
      sessionKeyRef.current = null;
      setBaseLead(null);
      return;
    }
    const nextSessionKey = `${target.leadId}:${target.dialSource}:${target.leadSnapshot?.version ?? "fetch"}`;
    if (sessionKeyRef.current === nextSessionKey) return;
    sessionKeyRef.current = nextSessionKey;

    setBaseLead(target.leadSnapshot ?? null);
    setOutcome(null);
    setNotes("");
    setStage(target.leadSnapshot?.status ?? target.fallbackLead?.status ?? "new");
    setConfirmed(false);
    setLostReason("");
    setNeedFollow(false);
    setFollowUpType("call");
    setWhen(shortcutValue("Tomorrow"));
    setFollowUpNote("");
    setConflictChoice(null);
    setErrs({});
    setSubmitError(null);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSavedCall(null);
    setPendingAndOpen(false);
    setStep2ConflictActive(null);
    setStep2StaleHint(null);
    setStep2Error(null);

    callIdemKeyRef.current = createIdempotencyKey();
    fuIdemKeyRef.current = createIdempotencyKey();
    fuReplaceIdemKeyRef.current = null;
    inFlightRef.current = false;
  }, [target]);

  useEffect(() => {
    if (target && !baseLead && hydratedLeadQuery.data) {
      setBaseLead(hydratedLeadQuery.data);
      setStage(hydratedLeadQuery.data.status);
    }
  }, [target, baseLead, hydratedLeadQuery.data]);

  const activeLeadId = target?.leadId;
  const leadFollowUpsQuery = useLeadFollowUpsQuery(activeLeadId, Boolean(target));
  const preloadedActiveFollowUp =
    leadFollowUpsQuery.data?.items.find(
      (f) => f.id === leadFollowUpsQuery.data?.activeFollowUpId,
    ) ?? null;

  const displayLead = baseLead ?? target?.fallbackLead ?? null;
  const currentStage = baseLead?.status ?? target?.fallbackLead?.status ?? "new";
  const confirmNeeded = needsStageConfirm(stage, currentStage);
  const busy = createCallMutation.isPending || createFollowUpMutation.isPending;

  const pickOutcome = (next: CallOutcomeApi) => {
    if (savedCall || busy) return;
    setOutcome(next);
    setConfirmed(false);
    setStage(outcomeStage(next as CallOutcome, currentStage));
    if (next === "Won" || next === "Lost" || next === "Not interested") {
      setNeedFollow(false);
    }
    setSubmitError(null);
    setErrs((prev) => {
      const copy = { ...prev };
      delete copy["outcome"];
      delete copy["confirmed"];
      delete copy["lostReason"];
      return copy;
    });
    callIdemKeyRef.current = createIdempotencyKey();
  };

  const changeStage = (nextStage: LeadStatusApi) => {
    if (savedCall || busy) return;
    setStage(nextStage);
    setConfirmed(false);
    setSubmitError(null);
    setErrs((prev) => {
      const copy = { ...prev };
      delete copy["confirmed"];
      delete copy["lostReason"];
      return copy;
    });
    callIdemKeyRef.current = createIdempotencyKey();
  };

  const rebaseOntoLatestLead = () => {
    if (!staleLatestLead) return;
    setBaseLead(staleLatestLead);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSubmitError(null);
    callIdemKeyRef.current = createIdempotencyKey();
    toast.info(`Draft rebased onto server v${staleLatestLead.version}`);
  };

  const loadLatestLead = () => {
    if (!staleLatestLead) return;
    setBaseLead(staleLatestLead);
    setStage(staleLatestLead.status);
    setConfirmed(false);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSubmitError(null);
    callIdemKeyRef.current = createIdempotencyKey();
    toast.info(`Loaded server v${staleLatestLead.version}`);
  };

  const finishClose = (
    leadId: string,
    andOpen: boolean,
    payload: { call: CallLogDto; lead: LeadDto; followUp?: FollowUpDto },
  ) => {
    onSaved?.(payload);
    onClose();
    if (andOpen) {
      void navigate({ to: "/leads/$id", params: { id: leadId }, search: { pilot: 1 } });
    }
  };

  const executeStep2FollowUp = async (
    callRes: { call: CallLogDto; lead: LeadDto },
    andOpen: boolean,
    replaceFollowUpId?: string,
  ) => {
    const dueValidation = parseIstDateTimeInput(when);
    if (!dueValidation.ok) {
      setStep2Error(dueValidation.error);
      return;
    }

    const isReplace = Boolean(replaceFollowUpId);
    if (isReplace && !fuReplaceIdemKeyRef.current) {
      fuReplaceIdemKeyRef.current = createIdempotencyKey();
    }
    const fuKey = isReplace ? fuReplaceIdemKeyRef.current! : fuIdemKeyRef.current;
    const cleanFuNote =
      followUpNote.trim() || notes.trim() || `After call (${callRes.call.outcome})`;

    setStep2Error(null);
    setStep2StaleHint(null);

    try {
      const fuRes = await createFollowUpMutation.mutateAsync({
        payload: {
          leadId: callRes.lead.id,
          type: followUpType,
          dueAt: dueValidation.istInput,
          note: cleanFuNote.slice(0, 1000),
          ...(replaceFollowUpId ? { replaceActiveFollowUpId: replaceFollowUpId } : {}),
          ...(isReplace ? {} : { opId: fuIdemKeyRef.current }),
        },
        idempotencyKey: fuKey,
      });

      toast.success(
        replaceFollowUpId
          ? "Call saved & active follow-up replaced"
          : "Call saved & follow-up scheduled",
      );
      finishClose(callRes.lead.id, andOpen, {
        call: callRes.call,
        lead: callRes.lead,
        followUp: fuRes.followUp,
      });
    } catch (err) {
      const fuConflict = extractFollowUpConflict(err);
      if (isApiError(err) && err.code === "followup_conflict" && fuConflict?.activeFollowUp) {
        fuReplaceIdemKeyRef.current = null;
        setStep2ConflictActive(fuConflict.activeFollowUp);
        setStep2Error(null);
        return;
      }

      if (isApiError(err) && err.code === "stale_conflict") {
        fuReplaceIdemKeyRef.current = null;
        if (fuConflict?.currentActiveFollowUp) {
          setStep2ConflictActive(fuConflict.currentActiveFollowUp);
          setStep2StaleHint(
            "The active follow-up changed in another session before replacing. Review the updated follow-up below.",
          );
          return;
        }
      }

      setStep2Error(
        `Call outcome was saved to MariaDB, but the follow-up failed to save: ${formatApiErrorMessage(
          err,
          "Retry scheduling follow-up only.",
        )}`,
      );
    }
  };

  const handleSave = async (andOpen: boolean) => {
    if (!target || !displayLead || busy || inFlightRef.current) return;

    // If Step 1 already committed and we are retrying Step 2 only:
    if (savedCall && baseLead) {
      inFlightRef.current = true;
      try {
        await executeStep2FollowUp(
          { call: savedCall, lead: baseLead },
          andOpen,
          step2ConflictActive?.id,
        );
      } finally {
        inFlightRef.current = false;
      }
      return;
    }

    if (!baseLead) {
      setSubmitError("Still loading latest server version for this lead. Please try again.");
      return;
    }

    const nextErrs: Record<string, string> = {};
    const callValidationErr = callLogError({
      outcome: outcome as CallOutcome | null,
      stage,
      current: currentStage,
      confirmed,
      lostReason,
    });
    if (callValidationErr) {
      if (callValidationErr === "Pick a call outcome") {
        nextErrs["outcome"] = callValidationErr;
      } else if (callValidationErr === "Confirm the stage change") {
        nextErrs["confirmed"] = callValidationErr;
      } else {
        nextErrs["lostReason"] = callValidationErr;
      }
    }
    if (notes.trim().length > 5000) {
      nextErrs["notes"] = "Call notes must be 5000 characters or fewer.";
    }

    let dueValidation: ReturnType<typeof parseIstDateTimeInput> | null = null;
    if (needFollow) {
      dueValidation = parseIstDateTimeInput(when);
      if (!dueValidation.ok) {
        nextErrs["when"] = dueValidation.error;
      }
      if (followUpNote.trim().length > 1000) {
        nextErrs["followUpNote"] = "Follow-up note must be 1000 characters or fewer.";
      }
      if (preloadedActiveFollowUp && dueValidation.ok && !conflictChoice) {
        nextErrs["conflictChoice"] = "Choose Keep existing or Replace for the follow-up";
      }
    }

    setErrs(nextErrs);
    if (Object.keys(nextErrs).length > 0) {
      toast.error(Object.values(nextErrs)[0]);
      return;
    }

    setSubmitError(null);
    setPendingAndOpen(andOpen);
    inFlightRef.current = true;

    try {
      const res = await createCallMutation.mutateAsync({
        payload: {
          leadId: baseLead.id,
          outcome: outcome!,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          stage,
          confirmed: confirmNeeded ? confirmed : false,
          ...(stage === "lost" && stage !== currentStage ? { lostReason: lostReason.trim() } : {}),
          dialSource: target.dialSource,
          expectedLeadVersion: baseLead.version,
          opId: callIdemKeyRef.current,
        },
        idempotencyKey: callIdemKeyRef.current,
      });

      setSavedCall(res.call);
      setBaseLead(res.lead);

      const skipFollowUpDueToKeep =
        needFollow && preloadedActiveFollowUp && conflictChoice === "keep";

      if (!needFollow || skipFollowUpDueToKeep) {
        toast.success(
          skipFollowUpDueToKeep
            ? "Call outcome saved to MariaDB (kept existing follow-up)"
            : "Call outcome saved to MariaDB",
        );
        finishClose(res.lead.id, andOpen, { call: res.call, lead: res.lead });
        return;
      }

      await executeStep2FollowUp(
        { call: res.call, lead: res.lead },
        andOpen,
        conflictChoice === "replace" ? preloadedActiveFollowUp?.id : undefined,
      );
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale) {
        try {
          const fresh = await getLead(baseLead.id);
          queryClient.setQueryData(leadKeys.detail(fresh.id), fresh);
          setStaleLatestLead(fresh);
          setSubmitError(
            `This lead changed in another session (v${baseLead.version} -> v${fresh.version}). Review or rebase before saving.`,
          );
        } catch {
          setSubmitError(formatApiErrorMessage(err));
        }
        return;
      }

      if (isApiError(err) && err.code === "lead_archived") {
        setSubmitError(
          "This lead was moved to Waste or Deleted. Restore it before logging a call.",
        );
        return;
      }

      const fieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(fieldErrs).length > 0) {
        setErrs((prev) => ({ ...prev, ...fieldErrs }));
      }
      setSubmitError(
        formatApiErrorMessage(err, "Could not save call log. Your notes remain intact."),
      );
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleStep2Keep = () => {
    if (!savedCall || !baseLead) {
      onClose();
      return;
    }
    toast.info("Call outcome saved; kept existing active follow-up");
    finishClose(baseLead.id, pendingAndOpen, { call: savedCall, lead: baseLead });
  };

  const handleStep2Retry = async (replaceId?: string) => {
    if (!savedCall || !baseLead || busy || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await executeStep2FollowUp({ call: savedCall, lead: baseLead }, pendingAndOpen, replaceId);
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className="call-log max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        data-testid="pilot-call-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <PhoneCall className="size-4" />
            </span>
            <span>Log call · {displayLead?.name ?? "Lead"}</span>
          </DialogTitle>
          <DialogDescription className="num">
            {displayLead?.phone ?? ""}
            {displayLead?.company ? ` · ${displayLead.company}` : ""}
            {baseLead ? ` · v${baseLead.version}` : ""} · User-recorded log · nothing is saved until
            you click Save
          </DialogDescription>
        </DialogHeader>

        {hydratedLeadQuery.isLoading && !baseLead && (
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Loading current lead version from MariaDB…
          </div>
        )}

        {hydratedLeadQuery.isError && !baseLead && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <span>
              {formatApiErrorMessage(hydratedLeadQuery.error, "Unable to load latest lead.")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void hydratedLeadQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {savedCall && (
          <div
            role="status"
            data-testid="pilot-call-step1-saved"
            className="flex items-start gap-2 rounded-lg border border-success/40 bg-success-soft p-3 text-xs"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                Call outcome saved to MariaDB ({savedCall.outcome})
              </p>
              <p className="text-muted-foreground">
                This call log is permanently committed and will not be duplicated.
              </p>
            </div>
          </div>
        )}

        {staleLatestLead && (
          <div
            role="alert"
            data-testid="pilot-call-stale-conflict"
            className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              Lead changed in another session (v{baseLead?.version ?? "?"} → v
              {staleLatestLead.version})
            </div>
            <p className="text-muted-foreground">
              Your call outcome and notes are preserved. Review the latest server values, rebase
              onto v{staleLatestLead.version}, or reload before saving.
            </p>
            {showLatestDiff && (
              <dl className="grid gap-1 rounded-md border bg-card p-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Stage:</span>{" "}
                  <b>{STATUS_LABEL[staleLatestLead.status]}</b>
                </div>
                <div>
                  <span className="text-muted-foreground">Quick status:</span>{" "}
                  <b>
                    {staleLatestLead.quickStatus
                      ? QUICK_LABEL[staleLatestLead.quickStatus]
                      : "None"}
                  </b>
                </div>
                <div>
                  <span className="text-muted-foreground">Last contact:</span>{" "}
                  <b>
                    {staleLatestLead.lastContact
                      ? formatDateTime(staleLatestLead.lastContact)
                      : "Never"}
                  </b>
                </div>
              </dl>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowLatestDiff((v) => !v)}
              >
                {showLatestDiff ? "Hide latest" : "Review latest"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={rebaseOntoLatestLead}>
                Keep my call log & rebase onto v{staleLatestLead.version}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={loadLatestLead}>
                <RefreshCw className="size-3.5" />
                Reload v{staleLatestLead.version}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
              <span>Outcome *</span>
              {outcome && (
                <span className="font-normal">
                  {isConnectedOutcome(outcome as CallOutcome)
                    ? "Connected call · updates Last contact in MariaDB"
                    : "Dial attempt only · leaves Last contact unchanged"}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CALL_OUTCOMES_API.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={busy || Boolean(savedCall)}
                  onClick={() => pickOutcome(o)}
                  aria-pressed={outcome === o}
                  className={cn(
                    "outcome-chip",
                    outcome === o && "is-active",
                    savedCall && "opacity-75",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
            {errs["outcome"] && (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {errs["outcome"]}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Textarea
              aria-label="Call notes"
              rows={3}
              maxLength={5000}
              disabled={busy || Boolean(savedCall)}
              placeholder="Summary of conversation, objections, or pricing discussed…"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSubmitError(null);
                callIdemKeyRef.current = createIdempotencyKey();
                if (errs["notes"]) {
                  setErrs((prev) => {
                    const next = { ...prev };
                    delete next["notes"];
                    return next;
                  });
                }
              }}
            />
            {errs["notes"] && (
              <p role="alert" className="text-xs text-destructive">
                {errs["notes"]}
              </p>
            )}
          </div>

          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            <span>
              Stage{" "}
              {outcome && stage !== currentStage ? (
                <span className="font-normal">suggested from outcome — change if needed</span>
              ) : null}
            </span>
            <select
              aria-label="Stage after call"
              className={selectCls}
              value={stage}
              disabled={busy || Boolean(savedCall)}
              onChange={(e) => changeStage(e.target.value as LeadStatusApi)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          {confirmNeeded && !savedCall && (
            <div
              className={cn(
                "call-confirm grid gap-2 rounded-lg border p-3",
                stage === "lost"
                  ? "border-destructive/40 bg-destructive-soft"
                  : "border-success/40 bg-success-soft",
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4" />
                Move {displayLead?.name} to {STATUS_LABEL[stage]}?
              </div>
              {stage === "lost" && (
                <div className="grid gap-1">
                  <Input
                    aria-label="Lost reason"
                    placeholder="Lost reason (required)"
                    maxLength={500}
                    disabled={busy}
                    value={lostReason}
                    onChange={(e) => {
                      setLostReason(e.target.value);
                      callIdemKeyRef.current = createIdempotencyKey();
                      if (errs["lostReason"]) {
                        setErrs((prev) => {
                          const next = { ...prev };
                          delete next["lostReason"];
                          return next;
                        });
                      }
                    }}
                  />
                  {errs["lostReason"] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errs["lostReason"]}
                    </p>
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    callIdemKeyRef.current = createIdempotencyKey();
                    if (errs["confirmed"]) {
                      setErrs((prev) => {
                        const next = { ...prev };
                        delete next["confirmed"];
                        return next;
                      });
                    }
                  }}
                  aria-label="Confirm stage change"
                />
                Yes, mark as {STATUS_LABEL[stage]}
              </label>
              {errs["confirmed"] && (
                <p role="alert" className="text-xs text-destructive">
                  {errs["confirmed"]}
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border p-3">
            <label className="flex items-center justify-between text-sm font-medium">
              <span>Schedule next follow-up (MariaDB IST)</span>
              <Switch
                checked={needFollow}
                disabled={busy || Boolean(savedCall)}
                onCheckedChange={(checked) => {
                  setNeedFollow(checked);
                  if (checked && !when) setWhen(shortcutValue("Tomorrow"));
                  setStep2Error(null);
                  fuIdemKeyRef.current = createIdempotencyKey();
                }}
                aria-label="Schedule next follow-up"
              />
            </label>

            {needFollow && (
              <div className="mt-3 grid gap-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {DATE_SHORTCUTS.map((s) => {
                    const v = shortcutValue(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setWhen(v);
                          setStep2ConflictActive(null);
                          setStep2Error(null);
                          fuIdemKeyRef.current = createIdempotencyKey();
                        }}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors active:scale-95",
                          when === v ? "border-teal bg-teal-soft text-teal" : "hover:bg-muted",
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    Channel
                    <select
                      aria-label="Follow-up channel"
                      className={cn(selectCls, "h-9 text-xs")}
                      value={followUpType}
                      disabled={busy}
                      onChange={(e) => {
                        setFollowUpType(e.target.value as FollowUpTypeApi);
                        setStep2ConflictActive(null);
                        setStep2Error(null);
                        fuIdemKeyRef.current = createIdempotencyKey();
                      }}
                    >
                      {FOLLOWUP_TYPES_API.map((k) => (
                        <option key={k} value={k}>
                          {FOLLOWUP_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    When (IST) *
                    <Input
                      type="datetime-local"
                      aria-label="Follow-up date and time"
                      value={when}
                      disabled={busy}
                      onChange={(e) => {
                        setWhen(e.target.value);
                        setStep2ConflictActive(null);
                        setStep2Error(null);
                        fuIdemKeyRef.current = createIdempotencyKey();
                        if (errs["when"]) {
                          setErrs((prev) => {
                            const next = { ...prev };
                            delete next["when"];
                            return next;
                          });
                        }
                      }}
                    />
                  </label>
                </div>
                {errs["when"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errs["when"]}
                  </p>
                )}

                <Input
                  aria-label="Follow-up note"
                  placeholder="Optional follow-up agenda…"
                  maxLength={1000}
                  value={followUpNote}
                  disabled={busy}
                  onChange={(e) => {
                    setFollowUpNote(e.target.value);
                    setStep2ConflictActive(null);
                    setStep2Error(null);
                    fuIdemKeyRef.current = createIdempotencyKey();
                  }}
                />
                {errs["followUpNote"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errs["followUpNote"]}
                  </p>
                )}

                {!savedCall && preloadedActiveFollowUp && when && (
                  <div
                    role="region"
                    aria-label="Existing active follow-up warning"
                    className="fu-conflict grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="size-3.5 text-warning" />
                      Already has a {FOLLOWUP_LABEL[preloadedActiveFollowUp.type]} follow-up ·{" "}
                      {formatDateTime(preloadedActiveFollowUp.dueAt)}
                    </div>
                    {preloadedActiveFollowUp.note && (
                      <div className="text-muted-foreground">{preloadedActiveFollowUp.note}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["keep", "Keep existing"],
                          [
                            "replace",
                            `Replace with ${(() => {
                              const p = parseIstDateTimeInput(when);
                              return p.ok ? formatDateTime(p.utcIso) : when;
                            })()}`,
                          ],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={conflictChoice === k}
                          onClick={() => {
                            setConflictChoice(k);
                            if (errs["conflictChoice"]) {
                              setErrs((prev) => {
                                const next = { ...prev };
                                delete next["conflictChoice"];
                                return next;
                              });
                            }
                          }}
                          className={cn(
                            "rounded-md border px-2.5 py-1",
                            conflictChoice === k
                              ? "border-primary bg-primary-soft text-primary"
                              : "bg-card hover:bg-muted",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {errs["conflictChoice"] && (
                      <p role="alert" className="text-xs text-destructive">
                        {errs["conflictChoice"]}
                      </p>
                    )}
                  </div>
                )}

                {savedCall && step2ConflictActive && (
                  <div
                    role="alertdialog"
                    aria-label="Follow-up conflict after call saved"
                    data-testid="pilot-call-step2-conflict"
                    className="fu-conflict grid gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <AlertTriangle className="size-4 shrink-0 text-warning" />
                      Another active follow-up exists on this lead
                    </div>
                    {step2StaleHint && <p className="font-medium text-warning">{step2StaleHint}</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border bg-card p-2">
                        <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                          Existing active
                        </div>
                        <div className="mt-0.5 font-semibold">
                          {FOLLOWUP_LABEL[step2ConflictActive.type]} ·{" "}
                          {formatDateTime(step2ConflictActive.dueAt)}
                        </div>
                        <div className="text-muted-foreground">
                          {step2ConflictActive.note || "No note"}
                        </div>
                      </div>
                      <div className="rounded-md border border-primary/40 bg-card p-2">
                        <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                          Proposed follow-up
                        </div>
                        <div className="mt-0.5 font-semibold">
                          {FOLLOWUP_LABEL[followUpType]} ·{" "}
                          {(() => {
                            const p = parseIstDateTimeInput(when);
                            return p.ok ? formatDateTime(p.utcIso) : when;
                          })()}
                        </div>
                        <div className="text-muted-foreground">
                          {followUpNote.trim() ||
                            notes.trim() ||
                            `After call (${savedCall.outcome})`}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={handleStep2Keep}
                      >
                        Keep existing
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleStep2Retry(step2ConflictActive.id)}
                      >
                        {busy ? "Replacing…" : "Replace with new"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {submitError && (
          <div
            role="alert"
            data-testid="pilot-call-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            {submitError}
          </div>
        )}

        {step2Error && savedCall && (
          <div
            role="alert"
            data-testid="pilot-call-step2-error"
            className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            <span>{step2Error}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void handleStep2Retry()}
              >
                {busy ? "Retrying…" : "Retry follow-up only"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!savedCall || !baseLead) {
                    onClose();
                    return;
                  }
                  finishClose(baseLead.id, pendingAndOpen, {
                    call: savedCall,
                    lead: baseLead,
                  });
                }}
              >
                Close without follow-up
              </Button>
            </div>
          </div>
        )}

        {!step2ConflictActive && !(savedCall && step2Error) && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Skip for now
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || (!baseLead && hydratedLeadQuery.isLoading)}
                onClick={() => void handleSave(true)}
              >
                {busy && pendingAndOpen ? "Saving…" : "Save & open lead"}
              </Button>
              <Button
                type="button"
                disabled={busy || (!baseLead && hydratedLeadQuery.isLoading)}
                onClick={() => void handleSave(false)}
              >
                {busy && !pendingAndOpen ? "Saving…" : "Save & close"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
