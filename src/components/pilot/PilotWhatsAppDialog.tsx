import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  LayoutTemplate,
  MessageCircle,
  MessagesSquare,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useResolvedAuthState } from "@/lib/auth/authClient";
import { createIdempotencyKey } from "@/lib/api/client";
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
  FOLLOWUP_TYPES_API,
  parseIstDateTimeInput,
  type FollowUpDto,
  type FollowUpTypeApi,
  type LeadDto,
  type WaMessageDto,
  type WaPurposeApi,
} from "@/lib/api/schemas";
import { useCreateWhatsAppMessageMutation } from "@/lib/api/whatsappApi";
import { DATE_SHORTCUTS, shortcutValue } from "@/lib/crm/calllog";
import { formatDateTime, formatINR } from "@/lib/crm/format";
import { QUICK_LABEL } from "@/lib/crm/leadtools";
import { builtInTemplates, composeDraft, syncDraft } from "@/lib/crm/studio";
import { FOLLOWUP_LABEL, STATUS_LABEL } from "@/lib/crm/types";
import { WA_LABEL, WA_PURPOSES, waLink, waNumber, type WaPurpose } from "@/lib/crm/whatsapp";
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
import {
  clearPilotWhatsAppPending,
  savePilotWhatsAppPending,
  type PilotWhatsAppLeadRef,
  type PilotWhatsAppTarget,
} from "./pilotWhatsAppLauncher";

const PURPOSE_ICON: Record<WaPurpose, typeof FileText> = {
  followup: MessagesSquare,
  quotation: FileText,
  samples: LayoutTemplate,
  custom: PenLine,
};

const PURPOSE_HINT: Record<WaPurpose, string> = {
  followup: "Continue the conversation",
  quotation: "Pricing, proposal or offer",
  samples: "Share website examples",
  custom: "Write from scratch",
};

const BUILT_IN_TEMPLATES = builtInTemplates("2026-01-01T00:00:00.000Z");

export function PilotWhatsAppButton({
  lead,
  composerSource,
  compact,
  className,
  onOpenComposer,
  disabled,
}: {
  lead: LeadDto | PilotWhatsAppLeadRef;
  composerSource: string;
  compact?: boolean | undefined;
  className?: string | undefined;
  onOpenComposer: (lead: LeadDto | PilotWhatsAppLeadRef, composerSource: string) => void;
  disabled?: boolean | undefined;
}) {
  const archived = lead.lifecycleStatus !== "active";
  const blocked = Boolean(disabled || archived);

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon" : "sm"}
      disabled={blocked}
      aria-label={`WhatsApp ${lead.name}`}
      title={
        archived
          ? "Restore archived lead to compose WhatsApp messages"
          : `Compose WhatsApp message for ${lead.name}`
      }
      onClick={(e) => {
        e.stopPropagation();
        if (blocked) return;
        onOpenComposer(lead, composerSource);
      }}
      className={cn(
        compact ? "size-8 rounded-full" : "rounded-full",
        blocked && "opacity-60",
        className,
      )}
    >
      <MessageCircle className={compact ? "size-4" : "size-3.5"} />
      {!compact && <span>WhatsApp</span>}
    </Button>
  );
}

export function PilotWhatsAppDialog({
  target,
  onClose,
  onSaved,
}: {
  target: PilotWhatsAppTarget | null;
  onClose: () => void;
  onSaved?:
    ((res: { message: WaMessageDto; lead: LeadDto; followUp?: FollowUpDto }) => void) | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: authUser } = useResolvedAuthState();
  const createWaMutation = useCreateWhatsAppMessageMutation();
  const createFollowUpMutation = useCreateFollowUpMutation();

  const open = Boolean(target);
  const shouldFetchFullLead = Boolean(open && target && !target.leadSnapshot);
  const hydratedLeadQuery = useLeadQuery(target?.leadId, shouldFetchFullLead);

  const [baseLead, setBaseLead] = useState<LeadDto | null>(target?.leadSnapshot ?? null);
  const displayLead = baseLead ?? hydratedLeadQuery.data ?? target?.fallbackLead ?? null;

  useEffect(() => {
    if (hydratedLeadQuery.data && !baseLead) {
      setBaseLead(hydratedLeadQuery.data);
    }
  }, [hydratedLeadQuery.data, baseLead]);

  const ownerName = authUser?.name ?? "Owner";
  const businessName = "Scale Flow";

  const [purpose, setPurpose] = useState<WaPurposeApi>(
    target?.restoredDraft?.purpose ?? target?.initialPurpose ?? "followup",
  );
  const [templateId, setTemplateId] = useState<string | null>(
    target?.restoredDraft?.templateId ?? null,
  );

  const composeLeadRef = useMemo(
    () => ({
      name: displayLead?.name ?? "Client",
      ...(displayLead?.company !== undefined ? { company: displayLead.company } : {}),
      ...(displayLead?.requirement !== undefined ? { requirement: displayLead.requirement } : {}),
      ...(displayLead?.quotedAmount !== undefined
        ? { quotedAmount: displayLead.quotedAmount }
        : {}),
    }),
    [displayLead?.name, displayLead?.company, displayLead?.requirement, displayLead?.quotedAmount],
  );

  const fresh = useMemo(
    () =>
      composeDraft({
        purpose,
        templateId,
        lead: composeLeadRef,
        owner: ownerName,
        business: businessName,
        templates: BUILT_IN_TEMPLATES,
        demos: [],
      }),
    [purpose, templateId, composeLeadRef, ownerName, businessName],
  );

  const [text, setText] = useState(target?.restoredDraft?.text ?? fresh);
  const [base, setBase] = useState(target?.restoredDraft?.base ?? fresh);
  const [edited, setEdited] = useState(Boolean(target?.restoredDraft?.edited));
  const [opened, setOpened] = useState(Boolean(target?.restoredDraft?.opened));

  const [needFollow, setNeedFollow] = useState(Boolean(target?.restoredDraft?.needFollow));
  const [followUpType, setFollowUpType] = useState<FollowUpTypeApi>(
    target?.restoredDraft?.followUpType ?? "whatsapp",
  );
  const [when, setWhen] = useState(() => target?.restoredDraft?.when ?? shortcutValue("Tomorrow"));
  const [followUpNote, setFollowUpNote] = useState(target?.restoredDraft?.followUpNote ?? "");
  const [conflictChoice, setConflictChoice] = useState<"keep" | "replace" | null>(null);

  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optimistic lock recovery if lead changed concurrently before Step 1 saved
  const [staleLatestLead, setStaleLatestLead] = useState<LeadDto | null>(null);
  const [showLatestDiff, setShowLatestDiff] = useState(false);

  // Two-step checkpoint: once Step 1 (`POST /api/v1/whatsapp-messages`) succeeds, NEVER re-submit Step 1
  const [savedMessage, setSavedMessage] = useState<WaMessageDto | null>(null);
  const [pendingAndOpen, setPendingAndOpen] = useState(false);
  const [step2ConflictActive, setStep2ConflictActive] = useState<FollowUpDto | null>(null);
  const [step2StaleHint, setStep2StaleHint] = useState<string | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  const waIdemKeyRef = useRef<string>(createIdempotencyKey());
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
    const nextSessionKey = `${target.leadId}:${target.composerSource}`;
    if (sessionKeyRef.current === nextSessionKey) return;
    sessionKeyRef.current = nextSessionKey;

    setBaseLead(target.leadSnapshot ?? null);
    const initPurpose = target.restoredDraft?.purpose ?? target.initialPurpose ?? "followup";
    const initTplId = target.restoredDraft?.templateId ?? null;
    const rawInitLead = target.leadSnapshot ?? target.fallbackLead;
    const initLeadRef = {
      name: rawInitLead?.name ?? "Client",
      ...(rawInitLead?.company !== undefined ? { company: rawInitLead.company } : {}),
      ...(rawInitLead?.requirement !== undefined ? { requirement: rawInitLead.requirement } : {}),
      ...(rawInitLead?.quotedAmount !== undefined
        ? { quotedAmount: rawInitLead.quotedAmount }
        : {}),
    };
    const initFresh = composeDraft({
      purpose: initPurpose,
      templateId: initTplId,
      lead: initLeadRef,
      owner: ownerName,
      business: businessName,
      templates: BUILT_IN_TEMPLATES,
      demos: [],
    });

    setPurpose(initPurpose);
    setTemplateId(initTplId);
    setText(target.restoredDraft?.text ?? initFresh);
    setBase(target.restoredDraft?.base ?? initFresh);
    setEdited(Boolean(target.restoredDraft?.edited));
    setOpened(Boolean(target.restoredDraft?.opened));
    setNeedFollow(Boolean(target.restoredDraft?.needFollow));
    setFollowUpType(target.restoredDraft?.followUpType ?? "whatsapp");
    setWhen(target.restoredDraft?.when ?? shortcutValue("Tomorrow"));
    setFollowUpNote(target.restoredDraft?.followUpNote ?? "");
    setConflictChoice(null);
    setErrs({});
    setSubmitError(null);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSavedMessage(null);
    setPendingAndOpen(false);
    setStep2ConflictActive(null);
    setStep2StaleHint(null);
    setStep2Error(null);
    waIdemKeyRef.current = createIdempotencyKey();
    fuIdemKeyRef.current = createIdempotencyKey();
    fuReplaceIdemKeyRef.current = null;
  }, [target, ownerName, businessName]);

  const sync = syncDraft({ text, base, edited }, fresh);
  useEffect(() => {
    if (sync.text !== text) setText(sync.text);
    if (sync.base !== base) setBase(sync.base);
  }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist tab-scoped draft & confirmation state in sessionStorage so returning from external WhatsApp or refreshing recovers cleanly.
  useEffect(() => {
    if (!target || savedMessage) return;
    savePilotWhatsAppPending(
      {
        ...target,
        ...(baseLead ? { leadSnapshot: baseLead } : {}),
      },
      {
        purpose,
        templateId,
        text,
        base,
        edited,
        opened,
        needFollow,
        followUpType,
        when,
        followUpNote,
      },
    );
  }, [
    target,
    baseLead,
    savedMessage,
    purpose,
    templateId,
    text,
    base,
    edited,
    opened,
    needFollow,
    followUpType,
    when,
    followUpNote,
  ]);

  const leadFollowUpsQuery = useLeadFollowUpsQuery(target?.leadId, Boolean(open && needFollow));
  const preloadedActiveFollowUp = useMemo(() => {
    const data = leadFollowUpsQuery.data;
    if (!data?.activeFollowUpId) return null;
    return data.items.find((f) => f.id === data.activeFollowUpId) ?? null;
  }, [leadFollowUpsQuery.data]);

  const activeTemplate = useMemo(
    () =>
      purpose === "custom"
        ? undefined
        : (BUILT_IN_TEMPLATES.find(
            (t) => t.purpose === purpose && (!templateId || t.id === templateId),
          ) ?? BUILT_IN_TEMPLATES.find((t) => t.purpose === purpose)),
    [purpose, templateId],
  );

  const normalizedNumber = displayLead ? waNumber(displayLead.phone) : null;
  const busy = createWaMutation.isPending || createFollowUpMutation.isPending;

  const pickPurpose = (nextPurpose: WaPurposeApi) => {
    if (nextPurpose === purpose || savedMessage) return;
    if (
      edited &&
      text.trim() &&
      !window.confirm("Replace your edited message with the new template?")
    ) {
      return;
    }
    setPurpose(nextPurpose);
    setTemplateId(null);
    setEdited(false);
    setErrs({});
    waIdemKeyRef.current = createIdempotencyKey();
  };

  const applyFreshDraft = () => {
    setText(fresh);
    setBase(fresh);
    setEdited(false);
    waIdemKeyRef.current = createIdempotencyKey();
  };

  const handleCopy = async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select the text and copy manually");
    }
  };

  const handleOpenWhatsApp = () => {
    if (!normalizedNumber) {
      setErrs((prev) => ({
        ...prev,
        recipientPhone: "Lead phone number is not a valid Indian mobile for WhatsApp.",
      }));
      return;
    }
    if (!text.trim()) {
      setErrs((prev) => ({
        ...prev,
        messageText: "Write or paste a WhatsApp message before opening WhatsApp.",
      }));
      return;
    }
    setErrs({});
    window.open(waLink(normalizedNumber, text), "_blank", "noopener,noreferrer");
    setOpened(true);
  };

  const rebaseOntoLatestLead = () => {
    if (!staleLatestLead) return;
    setBaseLead(staleLatestLead);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSubmitError(null);
    waIdemKeyRef.current = createIdempotencyKey();
    toast.info(`Message rebased onto server v${staleLatestLead.version}`);
  };

  const loadLatestLead = () => {
    if (!staleLatestLead) return;
    setBaseLead(staleLatestLead);
    setStaleLatestLead(null);
    setShowLatestDiff(false);
    setSubmitError(null);
    setEdited(false);
    waIdemKeyRef.current = createIdempotencyKey();
    toast.info(`Loaded server v${staleLatestLead.version}`);
  };

  const finishClose = (
    leadId: string,
    andOpen: boolean,
    payload: { message: WaMessageDto; lead: LeadDto; followUp?: FollowUpDto },
  ) => {
    clearPilotWhatsAppPending();
    onSaved?.(payload);
    onClose();
    if (andOpen) {
      void navigate({ to: "/leads/$id", params: { id: leadId }, search: pilotLinkSearch() });
    }
  };

  const executeStep2FollowUp = async (
    waRes: { message: WaMessageDto; lead: LeadDto },
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
      followUpNote.trim() || `Follow up after WhatsApp (${WA_LABEL[waRes.message.purpose]})`;

    setStep2Error(null);
    setStep2StaleHint(null);

    try {
      const fuRes = await createFollowUpMutation.mutateAsync({
        payload: {
          leadId: waRes.lead.id,
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
          ? "Confirmed WhatsApp logged & active follow-up replaced"
          : "Confirmed WhatsApp logged & follow-up scheduled",
      );
      finishClose(waRes.lead.id, andOpen, {
        message: waRes.message,
        lead: waRes.lead,
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
        `WhatsApp message was logged to MariaDB, but the follow-up failed to save: ${formatApiErrorMessage(
          err,
          "Retry scheduling follow-up only.",
        )}`,
      );
    }
  };

  const handleConfirmSend = async (andOpen: boolean) => {
    if (!target || !displayLead || busy || inFlightRef.current) return;

    // If Step 1 already committed and we are retrying Step 2 only:
    if (savedMessage && baseLead) {
      inFlightRef.current = true;
      try {
        await executeStep2FollowUp(
          { message: savedMessage, lead: baseLead },
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
    const cleanText = text.replace(/\r\n?/g, "\n").trim();
    if (!cleanText) {
      nextErrs["messageText"] = "Write or paste a WhatsApp message before confirming send.";
    } else if (cleanText.length > 4096) {
      nextErrs["messageText"] = "WhatsApp message cannot exceed 4096 characters.";
    }

    const leadWaPhone = waNumber(baseLead.phone);
    if (!leadWaPhone) {
      nextErrs["recipientPhone"] =
        "Lead phone number is not a valid Indian mobile for WhatsApp. Fix it on the lead first.";
    }

    if (needFollow) {
      const dueValidation = parseIstDateTimeInput(when);
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
      const res = await createWaMutation.mutateAsync({
        payload: {
          leadId: baseLead.id,
          purpose,
          ...(activeTemplate ? { templateId: activeTemplate.id } : {}),
          ...(activeTemplate ? { templateName: activeTemplate.name } : {}),
          recipientPhone: leadWaPhone!,
          messageText: cleanText,
          confirmedSent: true,
          confirmationStatus: "owner_confirmed_sent",
          composerSource: target.composerSource,
          expectedLeadVersion: baseLead.version,
          opId: waIdemKeyRef.current,
        },
        idempotencyKey: waIdemKeyRef.current,
      });

      clearPilotWhatsAppPending();
      setSavedMessage(res.message);
      setBaseLead(res.lead);

      const skipFollowUpDueToKeep =
        needFollow && preloadedActiveFollowUp && conflictChoice === "keep";

      if (!needFollow || skipFollowUpDueToKeep) {
        toast.success(
          skipFollowUpDueToKeep
            ? "Confirmed WhatsApp logged to MariaDB (kept existing follow-up)"
            : "Confirmed WhatsApp logged to MariaDB",
        );
        finishClose(res.lead.id, andOpen, { message: res.message, lead: res.lead });
        return;
      }

      await executeStep2FollowUp(
        { message: res.message, lead: res.lead },
        andOpen,
        conflictChoice === "replace" ? preloadedActiveFollowUp?.id : undefined,
      );
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale) {
        try {
          const freshLead = await getLead(baseLead.id);
          queryClient.setQueryData(leadKeys.detail(freshLead.id), freshLead);
          setStaleLatestLead(freshLead);
          setSubmitError(
            `This lead changed in another session (v${baseLead.version} -> v${freshLead.version}). Review or rebase before logging.`,
          );
        } catch {
          setSubmitError(formatApiErrorMessage(err));
        }
        return;
      }

      if (isApiError(err) && err.code === "lead_archived") {
        setSubmitError(
          "This lead was moved to Waste or Deleted. Restore it before logging a WhatsApp message.",
        );
        return;
      }

      const fieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(fieldErrs).length > 0) {
        setErrs((prev) => ({ ...prev, ...fieldErrs }));
      }
      setSubmitError(
        formatApiErrorMessage(
          err,
          "Could not save confirmed WhatsApp log. Your message draft remains intact.",
        ),
      );
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleStep2Keep = () => {
    if (!savedMessage || !baseLead) {
      onClose();
      return;
    }
    toast.info("Confirmed WhatsApp logged; kept existing active follow-up");
    finishClose(baseLead.id, pendingAndOpen, { message: savedMessage, lead: baseLead });
  };

  const handleStep2Retry = async (replaceId?: string) => {
    if (!savedMessage || !baseLead || busy || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await executeStep2FollowUp(
        { message: savedMessage, lead: baseLead },
        pendingAndOpen,
        replaceId,
      );
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        dirty={edited && Boolean(text.trim()) && !savedMessage}
        className="wa-composer max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="pilot-whatsapp-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5 text-success" />
            <span>WhatsApp message · {displayLead?.name ?? "Lead"}</span>
          </DialogTitle>
          <DialogDescription>
            Choose a purpose, edit the draft, then open WhatsApp. Nothing is sent automatically and
            nothing is logged to MariaDB until you confirm you sent it.
          </DialogDescription>
        </DialogHeader>

        {displayLead && (
          <section aria-label="Client" className="wa-client">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{displayLead.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {displayLead.company ?? "Independent"} ·{" "}
                <span className="num">{displayLead.phone}</span>
                {baseLead ? ` · v${baseLead.version}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="stage-chip" data-stage={displayLead.status}>
                {STATUS_LABEL[displayLead.status]}
              </span>
              {displayLead.requirement && (
                <span className="aging max-w-[220px] truncate">{displayLead.requirement}</span>
              )}
              {displayLead.quotedAmount !== undefined && (
                <span className="aging num">Quoted {formatINR(displayLead.quotedAmount)}</span>
              )}
            </div>
          </section>
        )}

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

        {!normalizedNumber && displayLead && (
          <p
            role="alert"
            data-testid="pilot-wa-invalid-phone"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-2.5 text-xs text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0" />
            This phone number isn&apos;t a valid Indian mobile, so WhatsApp can&apos;t be opened or
            logged. Fix it on the lead first.
          </p>
        )}

        {savedMessage && (
          <div
            role="status"
            data-testid="pilot-wa-step1-saved"
            className="flex items-start gap-2 rounded-lg border border-success/40 bg-success-soft p-3 text-xs"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                Confirmed WhatsApp logged to MariaDB ({WA_LABEL[savedMessage.purpose]})
              </p>
              <p className="text-muted-foreground">
                Saved as Owner-confirmed sent (`owner_confirmed_sent`). This message log is
                permanently committed and will not be duplicated.
              </p>
            </div>
          </div>
        )}

        {staleLatestLead && (
          <div
            role="alert"
            data-testid="pilot-wa-stale-conflict"
            className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              Lead changed in another session (v{baseLead?.version ?? "?"} → v
              {staleLatestLead.version})
            </div>
            <p className="text-muted-foreground">
              Your prepared WhatsApp message is preserved. Review the latest server values, rebase
              onto v{staleLatestLead.version}, or reload before logging.
            </p>
            {showLatestDiff && (
              <dl className="grid gap-1 rounded-md border bg-card p-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Phone:</span>{" "}
                  <b className="num">{staleLatestLead.phone}</b>
                </div>
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
                  <span className="text-muted-foreground">Quoted:</span>{" "}
                  <b className="num">{formatINR(staleLatestLead.quotedAmount)}</b>
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
                Keep my message & rebase onto v{staleLatestLead.version}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={loadLatestLead}>
                <RefreshCw className="size-3.5" />
                Reload v{staleLatestLead.version}
              </Button>
            </div>
          </div>
        )}

        <div
          role="radiogroup"
          aria-label="Message purpose"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {WA_PURPOSES.map((p) => {
            const Icon = PURPOSE_ICON[p];
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={purpose === p}
                disabled={Boolean(savedMessage)}
                onClick={() => pickPurpose(p)}
                className="wa-purpose"
              >
                <Icon className="size-4" />
                <span className="text-[13px] font-semibold">{WA_LABEL[p]}</span>
                <span className="text-[11px] text-muted-foreground">{PURPOSE_HINT[p]}</span>
              </button>
            );
          })}
        </div>

        {(purpose === "quotation" || purpose === "samples") && (
          <div
            data-testid="pilot-wa-local-studio-note"
            className="rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground"
          >
            {purpose === "quotation" ? (
              <span>
                <b className="text-foreground">Built-in quotation draft:</b> Hydrated from this
                server lead
                {displayLead?.quotedAmount ? ` (${formatINR(displayLead.quotedAmount)})` : ""}.
                Custom Sales Studio quotation packages remain browser-local until the Sales Studio
                backend checkpoint — you can edit or paste package details below.
              </span>
            ) : (
              <span>
                <b className="text-foreground">Built-in samples draft:</b> Hydrated from this server
                lead. Custom Sales Studio demo links remain browser-local until the Sales Studio
                backend checkpoint — paste any live sample URLs into the message below.
              </span>
            )}
          </div>
        )}

        {sync.notice && !savedMessage && (
          <div role="status" className="wa-notice">
            <RefreshCw className="size-4 shrink-0" />
            <span className="flex-1 text-xs">
              The lead details or template selection changed. Your edited message was kept.
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setBase(fresh)}>
              Keep my edits
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={applyFreshDraft}>
              Use updated draft
            </Button>
          </div>
        )}

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="pilot-wa-text" className="text-xs font-semibold">
              Message
            </label>
            <span className="num text-[11px] text-muted-foreground">
              {text.length} / 4096 chars
            </span>
          </div>
          <Textarea
            id="pilot-wa-text"
            aria-label="Message"
            value={text}
            maxLength={4096}
            disabled={Boolean(savedMessage) || busy}
            onChange={(e) => {
              setText(e.target.value);
              setEdited(true);
              waIdemKeyRef.current = createIdempotencyKey();
              if (errs["messageText"]) {
                setErrs((prev) => {
                  const next = { ...prev };
                  delete next["messageText"];
                  return next;
                });
              }
            }}
            rows={7}
            placeholder={purpose === "custom" ? "Write your message…" : ""}
            className="wa-editor min-h-36 text-sm leading-relaxed"
          />
          {errs["messageText"] && (
            <p role="alert" className="text-xs text-destructive">
              {errs["messageText"]}
            </p>
          )}
        </div>

        {submitError && (
          <p
            role="alert"
            data-testid="pilot-wa-submit-error"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            {submitError}
          </p>
        )}

        {step2Error && (
          <div
            role="alert"
            data-testid="pilot-wa-step2-error"
            className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <p>{step2Error}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void handleStep2Retry(step2ConflictActive?.id)}
              >
                Retry follow-up only
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (savedMessage && baseLead) {
                    finishClose(baseLead.id, pendingAndOpen, {
                      message: savedMessage,
                      lead: baseLead,
                    });
                  } else {
                    onClose();
                  }
                }}
              >
                Done without follow-up
              </Button>
            </div>
          </div>
        )}

        {step2ConflictActive && (
          <div
            role="alert"
            data-testid="pilot-wa-step2-conflict"
            className="grid gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <div className="font-semibold text-foreground">
              Active follow-up already exists for {displayLead?.name}
            </div>
            {step2StaleHint && <p className="text-warning">{step2StaleHint}</p>}
            <div className="rounded-md border bg-card p-2">
              <span className="font-medium">
                Existing: {FOLLOWUP_LABEL[step2ConflictActive.type]} ·{" "}
                <span className="num">{formatDateTime(step2ConflictActive.dueAt)}</span>
              </span>
              {step2ConflictActive.note && (
                <p className="mt-0.5 text-muted-foreground">{step2ConflictActive.note}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
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
                Replace with new
              </Button>
            </div>
          </div>
        )}

        {opened && !savedMessage && (
          <div
            role="status"
            data-testid="pilot-wa-confirm-panel"
            className="grid gap-3 rounded-lg border border-primary/30 bg-primary-soft/60 p-3.5 text-xs"
          >
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">
                  Did you send this WhatsApp message to {displayLead?.name}?
                </p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  WhatsApp opened externally. CRM V2 cannot verify delivery or client replies
                  automatically — confirm below <b>only if you actually sent the message</b>.
                  Confirming logs an <code>owner_confirmed_sent</code> record and leaves Last
                  contact unchanged.
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label htmlFor="pilot-wa-followup-switch" className="text-xs font-semibold">
                    Schedule next follow-up (MariaDB IST)
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Optional — creates or replaces the single active follow-up after logging
                  </p>
                </div>
                <Switch
                  id="pilot-wa-followup-switch"
                  aria-label="Schedule next follow-up"
                  checked={needFollow}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    setNeedFollow(checked);
                    setConflictChoice(null);
                  }}
                />
              </div>

              {needFollow && (
                <div className="mt-3 grid gap-2.5 border-t pt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {DATE_SHORTCUTS.map((label) => (
                      <Button
                        key={label}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full px-2.5 text-[11px]"
                        onClick={() => setWhen(shortcutValue(label))}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="pilot-wa-fu-when" className="text-xs">
                        When (IST) *
                      </Label>
                      <Input
                        id="pilot-wa-fu-when"
                        aria-label="Follow-up when (IST)"
                        type="datetime-local"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                        className="mt-1 h-8 text-xs"
                      />
                      {errs["when"] && (
                        <p role="alert" className="mt-1 text-[11px] text-destructive">
                          {errs["when"]}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="pilot-wa-fu-type" className="text-xs">
                        Follow-up type
                      </Label>
                      <select
                        id="pilot-wa-fu-type"
                        aria-label="Follow-up type"
                        value={followUpType}
                        onChange={(e) => setFollowUpType(e.target.value as FollowUpTypeApi)}
                        className={cn(selectCls, "mt-1 h-8 w-full text-xs")}
                      >
                        {FOLLOWUP_TYPES_API.map((t) => (
                          <option key={t} value={t}>
                            {FOLLOWUP_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="pilot-wa-fu-note" className="text-xs">
                      Follow-up note
                    </Label>
                    <Input
                      id="pilot-wa-fu-note"
                      aria-label="Follow-up note"
                      value={followUpNote}
                      maxLength={1000}
                      onChange={(e) => setFollowUpNote(e.target.value)}
                      placeholder="Optional agenda for the next follow-up…"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>

                  {preloadedActiveFollowUp && (
                    <div
                      data-testid="pilot-wa-preloaded-fu-conflict"
                      className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
                    >
                      <p className="font-semibold text-foreground">
                        Active follow-up already scheduled:{" "}
                        {FOLLOWUP_LABEL[preloadedActiveFollowUp.type]} ·{" "}
                        <span className="num">{formatDateTime(preloadedActiveFollowUp.dueAt)}</span>
                      </p>
                      {preloadedActiveFollowUp.note && (
                        <p className="mt-0.5 text-muted-foreground">
                          {preloadedActiveFollowUp.note}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={conflictChoice === "keep" ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => setConflictChoice("keep")}
                        >
                          Keep existing
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={conflictChoice === "replace" ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => setConflictChoice("replace")}
                        >
                          Replace with new
                        </Button>
                      </div>
                      {errs["conflictChoice"] && (
                        <p role="alert" className="mt-1 text-[11px] text-destructive">
                          {errs["conflictChoice"]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setOpened(false)}
              >
                Not sent / Keep editing
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>
                Close without logging
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="pilot-wa-confirm-send"
                disabled={busy || !normalizedNumber || !text.trim() || !baseLead}
                onClick={() => void handleConfirmSend(false)}
              >
                {busy ? "Saving…" : "I sent it — Log to MariaDB"}
              </Button>
            </div>
          </div>
        )}

        {!opened && !savedMessage && (
          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!normalizedNumber || !text.trim() || busy}
              onClick={() => setOpened(true)}
            >
              Already sent manually? Confirm &amp; log
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleCopy()}
                disabled={!text.trim() || busy}
              >
                <Copy className="size-4" />
                Copy
              </Button>
              <Button
                type="button"
                data-testid="pilot-wa-open-external"
                onClick={handleOpenWhatsApp}
                disabled={!normalizedNumber || !text.trim() || busy}
              >
                <ExternalLink className="size-4" />
                Open in WhatsApp
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
