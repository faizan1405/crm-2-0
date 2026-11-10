import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useDialogRequestClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/components/crm/Shell";
import {
  GOAL_METRIC_KEYS_API,
  GOAL_PERIODS_API,
  type GoalMetricDefinitionDto,
  type GoalMetricKeyApi,
  type GoalPeriodApi,
  type GoalScopeApi,
  type SalesGoalDto,
  type SettingsDefinitionsResponse,
} from "@/lib/api/schemas";
import {
  extractSettingsOrGoalFieldErrors,
  extractStaleConflict,
  formatApiErrorMessage,
  isArchivedGoalError,
} from "@/lib/api/errors";
import {
  GOAL_PERIOD_LABELS,
  GOAL_SCOPE_LABELS,
  createIdempotencyKey,
  formatIstDayLabel,
  getGoal,
  getTodayIstDate,
  isValidIstCalendarDate,
  parseGoalTargetInput,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  type CreateGoalPayload,
  type UpdateGoalPayload,
} from "@/lib/api/goalsApi";
import { cn } from "@/lib/utils";

const FALLBACK_METRICS: GoalMetricDefinitionDto[] = [
  {
    key: "calls_logged",
    label: "Calls Logged",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs",
    description: "Total outbound/inbound call outcomes logged in the period.",
  },
  {
    key: "calls_connected",
    label: "Connected Calls",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs",
    description: "Call logs marked connected in the period.",
  },
  {
    key: "followups_completed",
    label: "Follow-ups Completed",
    unit: "count",
    financial: false,
    dataSource: "crm_follow_ups",
    description: "Non-cancelled follow-ups marked completed during the period.",
  },
  {
    key: "leads_created",
    label: "New Leads Added",
    unit: "count",
    financial: false,
    dataSource: "crm_leads",
    description: "Active leads created inside the period.",
  },
  {
    key: "leads_contacted",
    label: "Leads Contacted",
    unit: "count",
    financial: false,
    dataSource: "crm_call_logs + crm_whatsapp_logs",
    description: "Distinct active leads with a logged call or confirmed WhatsApp message.",
  },
  {
    key: "leads_qualified",
    label: "Leads Qualified",
    unit: "count",
    financial: false,
    dataSource: "crm_lead_activities",
    description: "Recorded lead transitions into the Qualified stage during the period.",
  },
  {
    key: "deals_booked",
    label: "Deals Booked",
    unit: "count",
    financial: false,
    dataSource: "crm_deals",
    description: "Non-cancelled deals with verified wonIstDate inside the period.",
  },
  {
    key: "deals_booked_value",
    label: "Booked Deal Value",
    unit: "inr",
    financial: true,
    dataSource: "crm_deals",
    description: "Sum of finalAmount across verified won deals in the period (exact INR paise).",
  },
  {
    key: "cash_collected",
    label: "Cash Collected",
    unit: "inr",
    financial: true,
    dataSource: "crm_payments",
    description: "Sum of non-voided payments on active deals inside the period (exact INR paise).",
  },
  {
    key: "quotations_created",
    label: "Quotations Created",
    unit: "count",
    financial: false,
    dataSource: "crm_quotations",
    description: "Quotations issued by issueIstDate in the period.",
  },
  {
    key: "quotations_sent",
    label: "Quotations Confirmed Sent",
    unit: "count",
    financial: false,
    dataSource: "crm_quotations",
    description: "Owner-confirmed sent quotations by sentAt timestamp in the period.",
  },
  {
    key: "projects_completed",
    label: "Projects Completed",
    unit: "count",
    financial: false,
    dataSource: "crm_projects + crm_project_audit_events",
    description: "Active completed projects attributed by verified delivery/completion IST date.",
  },
];

interface GoalFormState {
  name: string;
  metric: GoalMetricKeyApi;
  scope: GoalScopeApi;
  period: GoalPeriodApi;
  leaveUnset: boolean;
  targetInput: string;
  customFromIst: string;
  customToIst: string;
  effectiveFromIst: string;
  changeNote: string;
}

function goalToFormState(
  mode: "create" | "edit",
  goal: SalesGoalDto | null | undefined,
  todayIst: string,
): GoalFormState {
  if (mode === "create" || !goal) {
    return {
      name: "",
      metric: "calls_connected",
      scope: "owner",
      period: "weekly",
      leaveUnset: false,
      targetInput: "",
      customFromIst: "",
      customToIst: "",
      effectiveFromIst: todayIst,
      changeNote: "",
    };
  }

  const leaveUnset =
    goal.targetUnit === "count" ? goal.targetCount === null : goal.targetAmount === null;
  const targetInput = leaveUnset
    ? ""
    : goal.targetUnit === "count"
      ? String(goal.targetCount ?? "")
      : (goal.targetAmount ?? goal.targetDecimal ?? "");

  return {
    name: goal.name,
    metric: goal.metric,
    scope: goal.scope === "team" ? "team" : "owner",
    period: goal.period,
    leaveUnset,
    targetInput,
    customFromIst: goal.customFromIst ?? "",
    customToIst: goal.customToIst ?? "",
    effectiveFromIst: goal.effectiveFromIst < todayIst ? todayIst : goal.effectiveFromIst,
    changeNote: "",
  };
}

function CancelDialogButton({ disabled }: { disabled?: boolean }) {
  const requestClose = useDialogRequestClose();
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={requestClose}>
      Cancel
    </Button>
  );
}

export interface PilotGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  goal?: SalesGoalDto | null | undefined;
  definitions?: SettingsDefinitionsResponse["definitions"] | undefined;
  onSaved?: ((goal: SalesGoalDto) => void) | undefined;
}

export function PilotGoalDialog({
  open,
  onOpenChange,
  mode,
  goal,
  definitions,
  onSaved,
}: PilotGoalDialogProps) {
  const createMut = useCreateGoalMutation();
  const updateMut = useUpdateGoalMutation();
  const todayIst = useMemo(() => getTodayIstDate(), []);

  const metricOptions = useMemo(() => {
    if (definitions?.goalMetrics && definitions.goalMetrics.length > 0) {
      return definitions.goalMetrics;
    }
    return FALLBACK_METRICS.filter((m) => GOAL_METRIC_KEYS_API.includes(m.key));
  }, [definitions]);

  const metricByKey = useMemo(() => {
    const map = new Map<GoalMetricKeyApi, GoalMetricDefinitionDto>();
    for (const item of metricOptions) {
      map.set(item.key, item);
    }
    return map;
  }, [metricOptions]);

  const periodOptions = useMemo<GoalPeriodApi[]>(() => {
    return definitions?.goalPeriods && definitions.goalPeriods.length > 0
      ? definitions.goalPeriods
      : [...GOAL_PERIODS_API];
  }, [definitions]);

  const employeeScopeNote = useMemo(() => {
    const found = definitions?.goalScopes?.find((s) => s.key === "employee");
    return (
      found?.description ??
      "Per-employee attribution requires Team CRM authentication (not yet enabled)."
    );
  }, [definitions]);

  const [baselineGoal, setBaselineGoal] = useState<SalesGoalDto | null>(goal ?? null);
  const [form, setForm] = useState<GoalFormState>(() => goalToFormState(mode, goal, todayIst));
  const [initialForm, setInitialForm] = useState<GoalFormState>(() =>
    goalToFormState(mode, goal, todayIst),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    expectedVersion?: number | undefined;
    currentVersion?: number | undefined;
  } | null>(null);
  const [rebasing, setRebasing] = useState(false);

  const idemKeyRef = useRef<string>(createIdempotencyKey());
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const customFromRef = useRef<HTMLInputElement>(null);
  const customToRef = useRef<HTMLInputElement>(null);
  const effectiveFromRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const nextBaseline = mode === "edit" ? (goal ?? null) : null;
    const nextState = goalToFormState(mode, nextBaseline, todayIst);
    setBaselineGoal(nextBaseline);
    setForm(nextState);
    setInitialForm(nextState);
    setFieldErrors({});
    setFormError(null);
    setConflictState(null);
    idemKeyRef.current = createIdempotencyKey();
  }, [open, mode, goal, todayIst]);

  const selectedMetricDef =
    metricByKey.get(form.metric) ?? metricOptions[0] ?? FALLBACK_METRICS[0]!;
  const selectedUnit = selectedMetricDef.unit;

  const isDirty = useMemo(() => {
    return (
      form.name !== initialForm.name ||
      form.metric !== initialForm.metric ||
      form.scope !== initialForm.scope ||
      form.period !== initialForm.period ||
      form.leaveUnset !== initialForm.leaveUnset ||
      form.targetInput !== initialForm.targetInput ||
      form.customFromIst !== initialForm.customFromIst ||
      form.customToIst !== initialForm.customToIst ||
      form.effectiveFromIst !== initialForm.effectiveFromIst ||
      form.changeNote !== initialForm.changeNote
    );
  }, [form, initialForm]);

  const targetPreview = useMemo(() => {
    return parseGoalTargetInput(selectedUnit, form.targetInput, form.leaveUnset);
  }, [selectedUnit, form.targetInput, form.leaveUnset]);

  const updateField = <K extends keyof GoalFormState>(key: K, value: GoalFormState[K]) => {
    idemKeyRef.current = createIdempotencyKey();
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    setConflictState(null);
    setFieldErrors((prev) => {
      if (!(key in prev) && !(key === "targetInput" && "target" in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      if (key === "targetInput" || key === "leaveUnset") delete next["target"];
      return next;
    });
  };

  const validateSingleField = (
    field: "name" | "target" | "customFromIst" | "customToIst" | "effectiveFromIst" | "changeNote",
    current: GoalFormState,
  ): string | null => {
    const unit = metricByKey.get(current.metric)?.unit ?? selectedUnit;
    switch (field) {
      case "name": {
        const trimmed = current.name.trim();
        if (!trimmed) return "Goal name is required.";
        if (trimmed.length > 140) return "Goal name must be 140 characters or fewer.";
        return null;
      }
      case "target": {
        const parsed = parseGoalTargetInput(unit, current.targetInput, current.leaveUnset);
        return parsed.ok ? null : parsed.error;
      }
      case "customFromIst": {
        if (current.period !== "custom") return null;
        if (!isValidIstCalendarDate(current.customFromIst)) {
          return "Select a valid start date (YYYY-MM-DD).";
        }
        return null;
      }
      case "customToIst": {
        if (current.period !== "custom") return null;
        if (!isValidIstCalendarDate(current.customToIst)) {
          return "Select a valid end date (YYYY-MM-DD).";
        }
        if (
          isValidIstCalendarDate(current.customFromIst) &&
          current.customFromIst > current.customToIst
        ) {
          return "End date must be on or after start date.";
        }
        return null;
      }
      case "effectiveFromIst": {
        if (!isValidIstCalendarDate(current.effectiveFromIst)) {
          return "Select a valid effective IST date (YYYY-MM-DD).";
        }
        return null;
      }
      case "changeNote": {
        if (current.changeNote.trim().length > 255) {
          return "Change note must be 255 characters or fewer.";
        }
        return null;
      }
    }
  };

  const handleBlur = (
    field: "name" | "target" | "customFromIst" | "customToIst" | "effectiveFromIst" | "changeNote",
  ) => {
    const err = validateSingleField(field, form);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const handleReloadLatest = async (keepEdits: boolean) => {
    if (!baselineGoal) return;
    setRebasing(true);
    try {
      const res = await getGoal(baselineGoal.id);
      const latest = res.goal;
      setBaselineGoal(latest);
      setConflictState(null);
      setFormError(null);
      idemKeyRef.current = createIdempotencyKey();
      if (keepEdits) {
        toast.info(`Rebased your edits onto version v${latest.version}. Click Save to apply.`);
      } else {
        const reloaded = goalToFormState("edit", latest, todayIst);
        setForm(reloaded);
        setInitialForm(reloaded);
        setFieldErrors({});
        toast.success(`Reloaded latest goal (v${latest.version}).`);
      }
    } catch (err) {
      setFormError(formatApiErrorMessage(err, "Could not reload the latest goal."));
    } finally {
      setRebasing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setConflictState(null);

    const fieldsToCheck = [
      "name",
      "target",
      "customFromIst",
      "customToIst",
      "effectiveFromIst",
      "changeNote",
    ] as const;
    const nextErrors: Record<string, string> = {};
    for (const f of fieldsToCheck) {
      const msg = validateSingleField(f, form);
      if (msg) nextErrors[f] = msg;
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      if (nextErrors["name"]) nameRef.current?.focus();
      else if (nextErrors["target"]) targetRef.current?.focus();
      else if (nextErrors["customFromIst"]) customFromRef.current?.focus();
      else if (nextErrors["customToIst"]) customToRef.current?.focus();
      else if (nextErrors["effectiveFromIst"]) effectiveFromRef.current?.focus();
      return;
    }

    const parsedTarget = parseGoalTargetInput(selectedUnit, form.targetInput, form.leaveUnset);
    if (!parsedTarget.ok) {
      setFieldErrors({ target: parsedTarget.error });
      targetRef.current?.focus();
      return;
    }

    const idempotencyKey = idemKeyRef.current;

    try {
      if (mode === "create") {
        const payload: CreateGoalPayload = {
          name: form.name.trim(),
          metric: form.metric,
          scope: form.scope,
          period: form.period,
          target: parsedTarget.target,
          ...(form.period === "custom"
            ? { customFromIst: form.customFromIst, customToIst: form.customToIst }
            : {}),
          effectiveFromIst: form.effectiveFromIst,
          idempotencyKey,
        };
        const res = await createMut.mutateAsync(payload);
        toast.success(`Goal “${res.goal.name}” created in MariaDB`);
        onSaved?.(res.goal);
        onOpenChange(false);
        return;
      }

      if (!baselineGoal) {
        setFormError("Goal record could not be resolved for editing.");
        return;
      }

      const targetChanged =
        form.leaveUnset !== initialForm.leaveUnset ||
        form.targetInput.trim() !== initialForm.targetInput.trim() ||
        selectedUnit !== baselineGoal.targetUnit;

      const payload: UpdateGoalPayload = {
        expectedVersion: baselineGoal.version,
        name: form.name.trim(),
        metric: form.metric,
        scope: form.scope,
        period: form.period,
        ...(targetChanged ? { target: parsedTarget.target } : {}),
        ...(form.period === "custom"
          ? { customFromIst: form.customFromIst, customToIst: form.customToIst }
          : baselineGoal.period === "custom"
            ? { customFromIst: null, customToIst: null }
            : {}),
        effectiveFromIst: form.effectiveFromIst,
        ...(form.changeNote.trim() ? { changeNote: form.changeNote.trim() } : {}),
        idempotencyKey,
      };

      const res = await updateMut.mutateAsync({ id: baselineGoal.id, payload });
      toast.success(`Goal “${res.goal.name}” updated (v${res.goal.version})`);
      onSaved?.(res.goal);
      onOpenChange(false);
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale) {
        setConflictState({
          expectedVersion: stale.expectedVersion ?? baselineGoal?.version,
          currentVersion: stale.currentVersion,
        });
        setFormError(
          `This goal was updated elsewhere (expected v${stale.expectedVersion ?? baselineGoal?.version}, server is on v${stale.currentVersion ?? "newer"}).`,
        );
        return;
      }
      if (isArchivedGoalError(err)) {
        setFormError(
          "This goal is archived and can no longer be edited. Historical revisions remain readable.",
        );
        return;
      }
      const serverFields = extractSettingsOrGoalFieldErrors(err);
      if (Object.keys(serverFields).length > 0) {
        setFieldErrors(serverFields);
      }
      setFormError(formatApiErrorMessage(err, "Could not save goal to MariaDB."));
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dirty={isDirty}
        className="max-h-[92dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby="goal-dialog-desc"
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create sales goal" : `Edit goal · ${baselineGoal?.name ?? ""}`}
          </DialogTitle>
          <DialogDescription id="goal-dialog-desc">
            {mode === "create"
              ? "Define an explicit server-tracked target measured in Asia/Kolkata from verified MariaDB records."
              : `Editing v${baselineGoal?.version ?? 1}. Saving writes a new historical revision without rewriting past periods.`}
          </DialogDescription>
        </DialogHeader>

        {conflictState && (
          <div
            role="alert"
            className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs text-foreground space-y-2"
          >
            <div className="flex items-start gap-2 font-medium">
              <AlertCircle className="size-4 shrink-0 text-warning mt-0.5" />
              <span>
                Concurrent modification detected (v{conflictState.expectedVersion} vs server v
                {conflictState.currentVersion ?? "?"}). Choose how to proceed:
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={rebasing}
                onClick={() => void handleReloadLatest(false)}
              >
                <RefreshCw className="size-3.5 mr-1" />
                Reload latest goal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={rebasing}
                onClick={() => void handleReloadLatest(true)}
              >
                Keep edits & rebase
              </Button>
            </div>
          </div>
        )}

        {formError && !conflictState && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <form noValidate onSubmit={(e) => void handleSubmit(e)} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="goal-name">Goal name</Label>
            <Input
              ref={nameRef}
              id="goal-name"
              name="name"
              value={form.name}
              placeholder="e.g. Weekly Connected Calls"
              maxLength={140}
              aria-invalid={Boolean(fieldErrors["name"])}
              aria-describedby={fieldErrors["name"] ? "goal-name-error" : "goal-name-hint"}
              onChange={(e) => updateField("name", e.target.value)}
              onBlur={() => handleBlur("name")}
            />
            {fieldErrors["name"] ? (
              <p id="goal-name-error" className="text-xs text-destructive">
                {fieldErrors["name"]}
              </p>
            ) : (
              <p id="goal-name-hint" className="text-[11px] text-muted-foreground">
                Required label shown in My Performance & Goal History.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-metric">Measured metric</Label>
              <select
                id="goal-metric"
                name="metric"
                className={selectCls}
                value={form.metric}
                onChange={(e) => {
                  const nextMetric = e.target.value as GoalMetricKeyApi;
                  const nextDef = metricByKey.get(nextMetric);
                  const prevUnit = selectedUnit;
                  updateField("metric", nextMetric);
                  if (nextDef && nextDef.unit !== prevUnit && form.targetInput.trim()) {
                    updateField("targetInput", "");
                  }
                }}
              >
                {metricOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.unit === "inr" ? "INR ₹" : "Count"})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {selectedMetricDef.description} (Source: <code>{selectedMetricDef.dataSource}</code>
                )
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="goal-scope">Attribution scope</Label>
              <select
                id="goal-scope"
                name="scope"
                className={selectCls}
                value={form.scope}
                onChange={(e) => updateField("scope", e.target.value as GoalScopeApi)}
              >
                <option value="owner">{GOAL_SCOPE_LABELS["owner"]}</option>
                <option value="team">{GOAL_SCOPE_LABELS["team"]}</option>
                <option value="employee" disabled>
                  {GOAL_SCOPE_LABELS["employee"]}
                </option>
              </select>
              <p className="text-[11px] text-muted-foreground">{employeeScopeNote}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-period">Period</Label>
              <select
                id="goal-period"
                name="period"
                className={selectCls}
                value={form.period}
                onChange={(e) => {
                  const nextPeriod = e.target.value as GoalPeriodApi;
                  updateField("period", nextPeriod);
                  if (nextPeriod !== "custom") {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next["customFromIst"];
                      delete next["customToIst"];
                      return next;
                    });
                  }
                }}
              >
                {periodOptions.map((p) => (
                  <option key={p} value={p}>
                    {GOAL_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Evaluated in Asia/Kolkata (IST). Weekly runs Monday–Sunday.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="goal-effective-from">Effective from (IST date)</Label>
              <Input
                ref={effectiveFromRef}
                id="goal-effective-from"
                name="effectiveFromIst"
                type="date"
                value={form.effectiveFromIst}
                aria-invalid={Boolean(fieldErrors["effectiveFromIst"])}
                aria-describedby={
                  fieldErrors["effectiveFromIst"] ? "goal-effective-error" : "goal-effective-hint"
                }
                onChange={(e) => updateField("effectiveFromIst", e.target.value)}
                onBlur={() => handleBlur("effectiveFromIst")}
              />
              {fieldErrors["effectiveFromIst"] ? (
                <p id="goal-effective-error" className="text-xs text-destructive">
                  {fieldErrors["effectiveFromIst"]}
                </p>
              ) : (
                <p id="goal-effective-hint" className="text-[11px] text-muted-foreground">
                  {mode === "edit" && baselineGoal
                    ? `Current version active since ${formatIstDayLabel(baselineGoal.effectiveFromIst)}. Revisions never rewrite earlier IST dates.`
                    : "Goal starts measuring on this IST date."}
                </p>
              )}
            </div>
          </div>

          {form.period === "custom" && (
            <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="goal-custom-from">Custom start (IST)</Label>
                <Input
                  ref={customFromRef}
                  id="goal-custom-from"
                  type="date"
                  value={form.customFromIst}
                  aria-invalid={Boolean(fieldErrors["customFromIst"])}
                  aria-describedby={
                    fieldErrors["customFromIst"] ? "goal-custom-from-error" : undefined
                  }
                  onChange={(e) => updateField("customFromIst", e.target.value)}
                  onBlur={() => handleBlur("customFromIst")}
                />
                {fieldErrors["customFromIst"] && (
                  <p id="goal-custom-from-error" className="text-xs text-destructive">
                    {fieldErrors["customFromIst"]}
                  </p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="goal-custom-to">Custom end (IST)</Label>
                <Input
                  ref={customToRef}
                  id="goal-custom-to"
                  type="date"
                  value={form.customToIst}
                  aria-invalid={Boolean(fieldErrors["customToIst"])}
                  aria-describedby={fieldErrors["customToIst"] ? "goal-custom-to-error" : undefined}
                  onChange={(e) => updateField("customToIst", e.target.value)}
                  onBlur={() => handleBlur("customToIst")}
                />
                {fieldErrors["customToIst"] && (
                  <p id="goal-custom-to-error" className="text-xs text-destructive">
                    {fieldErrors["customToIst"]}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-2 rounded-xl border p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="goal-target">
                Target ({selectedUnit === "inr" ? "INR ₹ exact paise" : "Whole count"})
              </Label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  id="goal-leave-unset"
                  type="checkbox"
                  checked={form.leaveUnset}
                  onChange={(e) => {
                    updateField("leaveUnset", e.target.checked);
                    if (e.target.checked) {
                      updateField("targetInput", "");
                    }
                  }}
                />
                <span>Leave target unset (not configured)</span>
              </label>
            </div>

            <Input
              ref={targetRef}
              id="goal-target"
              name="target"
              inputMode={selectedUnit === "inr" ? "decimal" : "numeric"}
              disabled={form.leaveUnset}
              value={form.leaveUnset ? "" : form.targetInput}
              placeholder={
                form.leaveUnset
                  ? "Target left unset (not configured)"
                  : selectedUnit === "inr"
                    ? "e.g. 20000.50"
                    : "e.g. 25"
              }
              aria-invalid={Boolean(fieldErrors["target"])}
              aria-describedby={fieldErrors["target"] ? "goal-target-error" : "goal-target-hint"}
              onChange={(e) => updateField("targetInput", e.target.value)}
              onBlur={() => handleBlur("target")}
            />

            {fieldErrors["target"] ? (
              <p id="goal-target-error" className="text-xs text-destructive">
                {fieldErrors["target"]}
              </p>
            ) : (
              <p
                id="goal-target-hint"
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                {form.leaveUnset ? (
                  <>
                    <Info className="size-3.5 shrink-0" />
                    <span>
                      Target will stay explicitly <b>not configured</b> (different from 0).
                    </span>
                  </>
                ) : targetPreview.ok && targetPreview.displayHint ? (
                  <>
                    <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                    <span>
                      Will save as{" "}
                      <b className="text-foreground num">{targetPreview.displayHint}</b>
                      {selectedUnit === "inr" ? " (exact paise)." : "."}
                    </span>
                  </>
                ) : (
                  <span>
                    {selectedUnit === "inr"
                      ? "Enter a positive INR amount with up to 2 decimal places (no commas or default targets)."
                      : "Enter a positive whole number (minimum 1)."}
                  </span>
                )}
              </p>
            )}
          </div>

          {mode === "edit" && (
            <div className="grid gap-1.5">
              <Label htmlFor="goal-change-note">Revision note (optional)</Label>
              <Input
                id="goal-change-note"
                value={form.changeNote}
                maxLength={255}
                placeholder="Reason for target or period update (recorded in revision history)"
                aria-invalid={Boolean(fieldErrors["changeNote"])}
                aria-describedby={fieldErrors["changeNote"] ? "goal-note-error" : undefined}
                onChange={(e) => updateField("changeNote", e.target.value)}
                onBlur={() => handleBlur("changeNote")}
              />
              {fieldErrors["changeNote"] && (
                <p id="goal-note-error" className="text-xs text-destructive">
                  {fieldErrors["changeNote"]}
                </p>
              )}
            </div>
          )}

          <div
            className={cn(
              "rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground",
            )}
          >
            Reviewed target: <b>{form.name.trim() || "Untitled"}</b> ·{" "}
            {GOAL_PERIOD_LABELS[form.period]} · {selectedMetricDef.label} ·{" "}
            {form.leaveUnset
              ? "Target not configured"
              : targetPreview.ok && targetPreview.displayHint
                ? targetPreview.displayHint
                : "Target required"}
          </div>

          <DialogFooter>
            <CancelDialogButton disabled={isPending} />
            <Button type="submit" disabled={isPending}>
              {isPending
                ? mode === "create"
                  ? "Creating…"
                  : "Saving…"
                : mode === "create"
                  ? "Create goal"
                  : "Save revision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
