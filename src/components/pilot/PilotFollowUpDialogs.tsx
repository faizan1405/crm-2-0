import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createIdempotencyKey } from "@/lib/api/client";
import {
  extractFieldValidationErrors,
  extractFollowUpConflict,
  extractStaleConflict,
  formatApiErrorMessage,
  isApiError,
} from "@/lib/api/errors";
import {
  followupKeys,
  getFollowUp,
  useCancelFollowUpMutation,
  useCreateFollowUpMutation,
  useRescheduleFollowUpMutation,
} from "@/lib/api/followupsApi";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import {
  FOLLOWUP_TYPES_API,
  formatIsoToIstInput,
  parseIstDateTimeInput,
  type FollowUpDto,
  type FollowUpTypeApi,
} from "@/lib/api/schemas";
import { formatDateTime } from "@/lib/crm/format";
import { FOLLOWUP_LABEL } from "@/lib/crm/types";
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
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";

export interface ScheduleFollowUpInitialDraft {
  type?: FollowUpTypeApi;
  dueAtInput?: string;
  note?: string;
}

export function PilotScheduleFollowUpDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  leadCompany,
  initial,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string | undefined;
  leadName?: string | undefined;
  leadCompany?: string | undefined;
  initial?: ScheduleFollowUpInitialDraft | undefined;
  onCompleted?: ((followUp: FollowUpDto) => void) | undefined;
}) {
  const createMutation = useCreateFollowUpMutation();
  const leadsQuery = useLeadsListQuery(
    { lifecycle: "active", limit: 200, offset: 0, sort: "recent" },
    open && !leadId,
  );

  const [selectedLeadId, setSelectedLeadId] = useState(leadId ?? "");
  const [type, setType] = useState<FollowUpTypeApi>(initial?.type ?? "call");
  const [dueAtInput, setDueAtInput] = useState(initial?.dueAtInput ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflictActive, setConflictActive] = useState<FollowUpDto | null>(null);
  const [conflictStaleHint, setConflictStaleHint] = useState<string | null>(null);

  const opIdRef = useRef<string>(createIdempotencyKey());
  const replaceIdemKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedLeadId(leadId ?? "");
    setType(initial?.type ?? "call");
    setDueAtInput(initial?.dueAtInput ?? "");
    setNote(initial?.note ?? "");
    setErrs({});
    setSubmitError(null);
    setConflictActive(null);
    setConflictStaleHint(null);
    opIdRef.current = createIdempotencyKey();
    replaceIdemKeyRef.current = null;
  }, [open, leadId, initial?.type, initial?.dueAtInput, initial?.note]);

  const effectiveLeadId = leadId ?? selectedLeadId;
  const leadsList = leadsQuery.data?.items ?? [];
  const resolvedLead = leadId
    ? { id: leadId, name: leadName ?? "Lead", company: leadCompany }
    : leadsList.find((l) => l.id === selectedLeadId);

  const parsedDue = dueAtInput ? parseIstDateTimeInput(dueAtInput) : null;

  const resetSubmissionKeys = () => {
    opIdRef.current = createIdempotencyKey();
    replaceIdemKeyRef.current = null;
  };

  const handleSubmit = async (e?: FormEvent, replaceFollowUpId?: string) => {
    e?.preventDefault();
    if (createMutation.isPending) return;

    const nextErrs: Record<string, string> = {};
    if (!effectiveLeadId) {
      nextErrs["leadId"] = "Choose a lead for this follow-up.";
    }
    const dueValidation = parseIstDateTimeInput(dueAtInput);
    if (!dueValidation.ok) {
      nextErrs["dueAt"] = dueValidation.error;
    }
    const cleanNote = note.trim();
    if (cleanNote.length > 1000) {
      nextErrs["note"] = "Follow-up note must be 1000 characters or fewer.";
    }

    setErrs(nextErrs);
    if (Object.keys(nextErrs).length > 0) {
      const focusTarget = nextErrs["leadId"]
        ? "pilot-fu-lead"
        : nextErrs["dueAt"]
          ? "pilot-fu-at"
          : "pilot-fu-note";
      requestAnimationFrame(() => document.getElementById(focusTarget)?.focus());
      return;
    }

    if (!dueValidation.ok) return;

    setSubmitError(null);
    setConflictStaleHint(null);

    const isReplace = Boolean(replaceFollowUpId);
    if (isReplace && !replaceIdemKeyRef.current) {
      replaceIdemKeyRef.current = createIdempotencyKey();
    }
    const idempotencyKey = isReplace ? replaceIdemKeyRef.current! : opIdRef.current;

    try {
      const res = await createMutation.mutateAsync({
        payload: {
          leadId: effectiveLeadId,
          type,
          dueAt: dueValidation.istInput,
          ...(cleanNote ? { note: cleanNote } : {}),
          ...(replaceFollowUpId ? { replaceActiveFollowUpId: replaceFollowUpId } : {}),
          ...(isReplace ? {} : { opId: opIdRef.current }),
        },
        idempotencyKey,
      });

      toast.success(replaceFollowUpId ? "Replaced active follow-up" : "Follow-up scheduled");
      onCompleted?.(res.followUp);
      onOpenChange(false);
    } catch (err) {
      const fuConflict = extractFollowUpConflict(err);
      if (isApiError(err) && err.code === "followup_conflict" && fuConflict?.activeFollowUp) {
        replaceIdemKeyRef.current = null;
        setConflictActive(fuConflict.activeFollowUp);
        setSubmitError(null);
        return;
      }

      if (isApiError(err) && err.code === "stale_conflict") {
        replaceIdemKeyRef.current = null;
        if (fuConflict?.currentActiveFollowUp) {
          setConflictActive(fuConflict.currentActiveFollowUp);
          setConflictStaleHint(
            "The active follow-up changed in another session before replacing. Review the updated follow-up below.",
          );
          return;
        }
        setConflictActive(null);
      }

      if (isApiError(err) && err.code === "lead_archived") {
        setConflictActive(null);
        setSubmitError(
          "This lead is archived. Restore it from Waste & Recently Deleted before scheduling a follow-up.",
        );
        return;
      }

      const fieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(fieldErrs).length > 0) {
        setErrs((prev) => ({ ...prev, ...fieldErrs }));
      }
      setSubmitError(formatApiErrorMessage(err, "Could not schedule follow-up. Draft preserved."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !createMutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule follow-up (MariaDB)</DialogTitle>
          <DialogDescription>
            Saved directly to the server in India Standard Time (IST). Only one active pending
            follow-up per lead is permitted at a time.
          </DialogDescription>
          {resolvedLead && (
            <p className="text-sm text-foreground" data-testid="pilot-fu-for">
              For <span className="font-semibold">{resolvedLead.name}</span>
              {resolvedLead.company ? (
                <span className="text-muted-foreground"> · {resolvedLead.company}</span>
              ) : null}
            </p>
          )}
        </DialogHeader>

        <form noValidate onSubmit={(e) => void handleSubmit(e)} className="grid gap-3">
          {!leadId && (
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-fu-lead">Lead *</Label>
              <select
                id="pilot-fu-lead"
                className={selectCls}
                value={selectedLeadId}
                disabled={createMutation.isPending || leadsQuery.isLoading}
                aria-invalid={errs["leadId"] ? true : undefined}
                aria-describedby={errs["leadId"] ? "pilot-fu-lead-error" : undefined}
                onChange={(e) => {
                  setSelectedLeadId(e.target.value);
                  setConflictActive(null);
                  setConflictStaleHint(null);
                  setSubmitError(null);
                  resetSubmissionKeys();
                  if (errs["leadId"]) {
                    setErrs((prev) => {
                      const next = { ...prev };
                      delete next["leadId"];
                      return next;
                    });
                  }
                }}
              >
                <option value="">
                  {leadsQuery.isLoading ? "Loading server leads…" : "Select an active lead…"}
                </option>
                {leadsList.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.company ? ` · ${l.company}` : ""} ({l.phone})
                  </option>
                ))}
              </select>
              {leadsQuery.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {formatApiErrorMessage(leadsQuery.error, "Unable to load leads from MariaDB.")}
                </p>
              )}
              {!leadsQuery.isLoading && !leadsQuery.isError && leadsList.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active server leads found. Add one in Leads (Pilot) first.
                </p>
              )}
              {errs["leadId"] && (
                <p id="pilot-fu-lead-error" className="text-xs text-destructive" role="alert">
                  {errs["leadId"]}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-fu-type">Channel *</Label>
              <select
                id="pilot-fu-type"
                className={selectCls}
                value={type}
                disabled={createMutation.isPending}
                onChange={(e) => {
                  setType(e.target.value as FollowUpTypeApi);
                  setConflictActive(null);
                  setSubmitError(null);
                  resetSubmissionKeys();
                }}
              >
                {FOLLOWUP_TYPES_API.map((k) => (
                  <option key={k} value={k}>
                    {FOLLOWUP_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pilot-fu-at">When (IST) *</Label>
              <Input
                id="pilot-fu-at"
                type="datetime-local"
                value={dueAtInput}
                disabled={createMutation.isPending}
                aria-invalid={errs["dueAt"] ? true : undefined}
                aria-describedby={errs["dueAt"] ? "pilot-fu-at-error" : undefined}
                onChange={(e) => {
                  setDueAtInput(e.target.value);
                  setConflictActive(null);
                  setConflictStaleHint(null);
                  setSubmitError(null);
                  resetSubmissionKeys();
                  if (errs["dueAt"]) {
                    setErrs((prev) => {
                      const next = { ...prev };
                      delete next["dueAt"];
                      return next;
                    });
                  }
                }}
              />
              {errs["dueAt"] && (
                <p id="pilot-fu-at-error" className="text-xs text-destructive" role="alert">
                  {errs["dueAt"]}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pilot-fu-note">Note (optional)</Label>
            <Textarea
              id="pilot-fu-note"
              rows={2}
              maxLength={1000}
              placeholder="Agenda, quotation check, or preparation note…"
              value={note}
              disabled={createMutation.isPending}
              aria-invalid={errs["note"] ? true : undefined}
              aria-describedby={errs["note"] ? "pilot-fu-note-error" : undefined}
              onChange={(e) => {
                setNote(e.target.value);
                setConflictActive(null);
                setSubmitError(null);
                resetSubmissionKeys();
                if (errs["note"]) {
                  setErrs((prev) => {
                    const next = { ...prev };
                    delete next["note"];
                    return next;
                  });
                }
              }}
            />
            {errs["note"] && (
              <p id="pilot-fu-note-error" className="text-xs text-destructive" role="alert">
                {errs["note"]}
              </p>
            )}
          </div>

          {conflictActive && (
            <div
              role="alertdialog"
              aria-label="Follow-up conflict"
              data-testid="pilot-fu-conflict"
              className="fu-conflict grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 shrink-0 text-warning" />
                This lead already has an active pending follow-up
              </div>
              {conflictStaleHint && (
                <p className="text-xs font-medium text-warning">{conflictStaleHint}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Existing active
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {FOLLOWUP_LABEL[conflictActive.type]} · {formatDateTime(conflictActive.dueAt)}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {conflictActive.note || "No notes"}
                  </div>
                </div>
                <div className="rounded-lg border border-primary/40 bg-card p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    New request
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {FOLLOWUP_LABEL[type]} ·{" "}
                    {parsedDue?.ok ? formatDateTime(parsedDue.utcIso) : dueAtInput}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {note.trim() || "No notes"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={createMutation.isPending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={createMutation.isPending}
                  onClick={() => {
                    toast.info("Kept existing active follow-up");
                    onOpenChange(false);
                  }}
                >
                  Keep existing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={createMutation.isPending}
                  onClick={() => void handleSubmit(undefined, conflictActive.id)}
                >
                  {createMutation.isPending ? "Replacing…" : "Replace with new"}
                </Button>
              </div>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              data-testid="pilot-fu-schedule-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
            >
              {submitError}
            </div>
          )}

          {!conflictActive && (
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={createMutation.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Scheduling…" : "Schedule follow-up"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PilotEditFollowUpDialog({
  followUp,
  leadName,
  onOpenChange,
  onSaved,
}: {
  followUp: FollowUpDto | null;
  leadName?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSaved?: ((updated: FollowUpDto) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const rescheduleMutation = useRescheduleFollowUpMutation();

  const [baseFollowUp, setBaseFollowUp] = useState<FollowUpDto | null>(followUp);
  const [startAtInput, setStartAtInput] = useState("");
  const [startNote, setStartNote] = useState("");
  const [dueAtInput, setDueAtInput] = useState("");
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [staleLatest, setStaleLatest] = useState<FollowUpDto | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);

  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    if (!followUp) {
      setBaseFollowUp(null);
      return;
    }
    const initialAt = formatIsoToIstInput(followUp.dueAt);
    const initialNote = followUp.note ?? "";
    setBaseFollowUp(followUp);
    setStartAtInput(initialAt);
    setStartNote(initialNote);
    setDueAtInput(initialAt);
    setNote(initialNote);
    setErrs({});
    setSubmitError(null);
    setStaleLatest(null);
    idempotencyKeyRef.current = createIdempotencyKey();
  }, [followUp]);

  const open = Boolean(followUp);
  const activeBase = baseFollowUp ?? followUp;

  const rebaseOntoLatest = () => {
    if (!staleLatest) return;
    setBaseFollowUp(staleLatest);
    setStartAtInput(formatIsoToIstInput(staleLatest.dueAt));
    setStartNote(staleLatest.note ?? "");
    setStaleLatest(null);
    setSubmitError(null);
    idempotencyKeyRef.current = createIdempotencyKey();
    toast.info(`Draft rebased onto server v${staleLatest.version}`);
  };

  const loadLatestIntoForm = () => {
    if (!staleLatest) return;
    const latestAt = formatIsoToIstInput(staleLatest.dueAt);
    const latestNote = staleLatest.note ?? "";
    setBaseFollowUp(staleLatest);
    setStartAtInput(latestAt);
    setStartNote(latestNote);
    setDueAtInput(latestAt);
    setNote(latestNote);
    setStaleLatest(null);
    setErrs({});
    setSubmitError(null);
    idempotencyKeyRef.current = createIdempotencyKey();
    toast.info(`Loaded server v${staleLatest.version}`);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBase || rescheduleMutation.isPending) return;

    const dueValidation = parseIstDateTimeInput(dueAtInput);
    const nextErrs: Record<string, string> = {};
    if (!dueValidation.ok) {
      nextErrs["dueAt"] = dueValidation.error;
    }
    const cleanedNextNote = note.trim();
    if (cleanedNextNote.length > 1000) {
      nextErrs["note"] = "Follow-up note must be 1000 characters or fewer.";
    }
    setErrs(nextErrs);
    if (Object.keys(nextErrs).length > 0 || !dueValidation.ok) return;

    const dueChanged = dueValidation.istInput !== startAtInput;
    const noteChanged = cleanedNextNote !== startNote.trim();
    if (!dueChanged && !noteChanged) {
      onOpenChange(false);
      return;
    }

    setSubmitError(null);

    try {
      const res = await rescheduleMutation.mutateAsync({
        id: activeBase.id,
        payload: {
          version: activeBase.version,
          ...(dueChanged ? { dueAt: dueValidation.istInput } : {}),
          ...(noteChanged ? { note: cleanedNextNote === "" ? null : cleanedNextNote } : {}),
        },
        idempotencyKey: idempotencyKeyRef.current,
      });

      toast.success(dueChanged ? "Follow-up rescheduled" : "Follow-up note updated");
      onSaved?.(res.followUp);
      onOpenChange(false);
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale || (isApiError(err) && err.code === "followup_already_closed")) {
        setLoadingLatest(true);
        try {
          const fresh = await getFollowUp(activeBase.id);
          queryClient.setQueryData(followupKeys.detail(fresh.id), fresh);
          void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
          void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(fresh.leadId) });
          setStaleLatest(fresh);
          setSubmitError(
            fresh.status === "pending"
              ? `This follow-up changed in another session (v${activeBase.version} → v${fresh.version}). Review before saving.`
              : `This follow-up was already ${fresh.status} in another session. Your unsaved draft stays visible below.`,
          );
        } catch {
          setSubmitError(formatApiErrorMessage(err));
        } finally {
          setLoadingLatest(false);
        }
        return;
      }

      const fieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(fieldErrs).length > 0) {
        setErrs((prev) => ({ ...prev, ...fieldErrs }));
      }
      setSubmitError(formatApiErrorMessage(err, "Could not update follow-up. Draft preserved."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !rescheduleMutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit & reschedule follow-up</DialogTitle>
          <DialogDescription>
            {leadName ? (
              <>
                For <span className="font-semibold text-foreground">{leadName}</span> ·{" "}
              </>
            ) : null}
            {activeBase
              ? `${FOLLOWUP_LABEL[activeBase.type]} · Server v${activeBase.version} (IST)`
              : "Times are India Standard Time (IST)."}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={(e) => void handleSubmit(e)} className="grid gap-3">
          {staleLatest && (
            <div
              role="alert"
              data-testid="pilot-fu-stale-conflict"
              className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
            >
              <p className="font-semibold text-foreground">
                Latest server state (v{staleLatest.version} · {staleLatest.status})
              </p>
              <div className="grid gap-1 text-muted-foreground">
                <div>
                  Time:{" "}
                  <span className="font-medium text-foreground">
                    {formatDateTime(staleLatest.dueAt)}
                  </span>
                </div>
                <div>
                  Note:{" "}
                  <span className="font-medium text-foreground">
                    {staleLatest.note || "No note"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {staleLatest.status === "pending" && (
                  <Button type="button" size="sm" variant="outline" onClick={rebaseOntoLatest}>
                    Keep my draft & rebase onto v{staleLatest.version}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={loadLatestIntoForm}>
                  <RefreshCw className="size-3.5" />
                  Reload latest
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="pilot-edit-fu-at">When (IST) *</Label>
            <Input
              id="pilot-edit-fu-at"
              type="datetime-local"
              value={dueAtInput}
              disabled={
                rescheduleMutation.isPending ||
                (staleLatest !== null && staleLatest.status !== "pending")
              }
              aria-invalid={errs["dueAt"] ? true : undefined}
              aria-describedby={errs["dueAt"] ? "pilot-edit-fu-at-error" : undefined}
              onChange={(e) => {
                setDueAtInput(e.target.value);
                setSubmitError(null);
                idempotencyKeyRef.current = createIdempotencyKey();
                if (errs["dueAt"]) {
                  setErrs((prev) => {
                    const next = { ...prev };
                    delete next["dueAt"];
                    return next;
                  });
                }
              }}
            />
            {errs["dueAt"] && (
              <p id="pilot-edit-fu-at-error" className="text-xs text-destructive" role="alert">
                {errs["dueAt"]}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pilot-edit-fu-note">Note (leave blank to clear)</Label>
            <Textarea
              id="pilot-edit-fu-note"
              rows={3}
              maxLength={1000}
              value={note}
              disabled={
                rescheduleMutation.isPending ||
                (staleLatest?.status !== undefined && staleLatest.status !== "pending")
              }
              aria-invalid={errs["note"] ? true : undefined}
              aria-describedby={errs["note"] ? "pilot-edit-fu-note-error" : undefined}
              onChange={(e) => {
                setNote(e.target.value);
                setSubmitError(null);
                idempotencyKeyRef.current = createIdempotencyKey();
                if (errs["note"]) {
                  setErrs((prev) => {
                    const next = { ...prev };
                    delete next["note"];
                    return next;
                  });
                }
              }}
            />
            {errs["note"] && (
              <p id="pilot-edit-fu-note-error" className="text-xs text-destructive" role="alert">
                {errs["note"]}
              </p>
            )}
          </div>

          {submitError && (
            <p
              role="alert"
              data-testid="pilot-fu-edit-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
            >
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={rescheduleMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {staleLatest && staleLatest.status !== "pending" ? "Close" : "Cancel"}
            </Button>
            {(!staleLatest || staleLatest.status === "pending") && (
              <Button
                type="submit"
                disabled={rescheduleMutation.isPending || loadingLatest || Boolean(staleLatest)}
              >
                {rescheduleMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PilotCancelFollowUpDialog({
  followUp,
  leadName,
  onOpenChange,
  onCancelled,
}: {
  followUp: FollowUpDto | null;
  leadName?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onCancelled?: ((cancelled: FollowUpDto) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const cancelMutation = useCancelFollowUpMutation();

  const [baseFollowUp, setBaseFollowUp] = useState<FollowUpDto | null>(followUp);
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [staleLatest, setStaleLatest] = useState<FollowUpDto | null>(null);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    setBaseFollowUp(followUp);
    setReason("");
    setSubmitError(null);
    setStaleLatest(null);
    idempotencyKeyRef.current = createIdempotencyKey();
  }, [followUp]);

  const activeBase = baseFollowUp ?? followUp;

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBase || cancelMutation.isPending) return;
    const cleanReason = reason.trim();
    if (cleanReason.length > 255) {
      setSubmitError("Cancel reason must be 255 characters or fewer.");
      return;
    }

    setSubmitError(null);
    try {
      const res = await cancelMutation.mutateAsync({
        id: activeBase.id,
        payload: {
          version: activeBase.version,
          ...(cleanReason ? { reason: cleanReason } : {}),
        },
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success("Follow-up cancelled");
      onCancelled?.(res.followUp);
      onOpenChange(false);
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale || (isApiError(err) && err.code === "followup_already_closed")) {
        try {
          const fresh = await getFollowUp(activeBase.id);
          queryClient.setQueryData(followupKeys.detail(fresh.id), fresh);
          void queryClient.invalidateQueries({ queryKey: followupKeys.lists() });
          void queryClient.invalidateQueries({ queryKey: followupKeys.byLead(fresh.leadId) });
          setStaleLatest(fresh);
          setSubmitError(
            fresh.status === "pending"
              ? `This follow-up was updated concurrently (v${activeBase.version} → v${fresh.version}). Review the new schedule before confirming cancellation.`
              : `This follow-up was already ${fresh.status} on the server.`,
          );
          return;
        } catch {
          // Fallback to standard error
        }
      }
      setSubmitError(formatApiErrorMessage(err, "Could not cancel follow-up. Try again."));
    }
  };

  return (
    <Dialog
      open={Boolean(followUp)}
      onOpenChange={(o) => !cancelMutation.isPending && onOpenChange(o)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel follow-up?</DialogTitle>
          <DialogDescription>
            {leadName ? (
              <>
                For <span className="font-semibold text-foreground">{leadName}</span> ·{" "}
              </>
            ) : null}
            {activeBase
              ? `${FOLLOWUP_LABEL[activeBase.type]} due ${formatDateTime(activeBase.dueAt)} (v${activeBase.version})`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={(e) => void handleConfirm(e)} className="grid gap-3">
          {staleLatest && (
            <div
              role="alert"
              data-testid="pilot-fu-cancel-stale"
              className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
            >
              <p className="font-medium text-foreground">
                Server version v{staleLatest.version} · {staleLatest.status} ·{" "}
                {formatDateTime(staleLatest.dueAt)}
              </p>
              {staleLatest.status === "pending" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBaseFollowUp(staleLatest);
                    setStaleLatest(null);
                    setSubmitError(null);
                    idempotencyKeyRef.current = createIdempotencyKey();
                  }}
                >
                  Cancel server v{staleLatest.version} instead
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="pilot-cancel-fu-reason">Cancel reason (optional)</Label>
            <Textarea
              id="pilot-cancel-fu-reason"
              rows={2}
              maxLength={255}
              placeholder="e.g., Client postponed until next month, no longer needed…"
              value={reason}
              disabled={cancelMutation.isPending || Boolean(staleLatest)}
              onChange={(e) => {
                setReason(e.target.value);
                setSubmitError(null);
                idempotencyKeyRef.current = createIdempotencyKey();
              }}
            />
          </div>

          {submitError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
            >
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={cancelMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Keep active
            </Button>
            {(!staleLatest || staleLatest.status === "pending") && (
              <Button
                type="submit"
                variant="destructive"
                disabled={cancelMutation.isPending || Boolean(staleLatest)}
              >
                {cancelMutation.isPending ? "Cancelling…" : "Confirm cancel"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
