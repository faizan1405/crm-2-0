import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Archive,
  Calendar,
  History,
  Info,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Settings,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selectCls } from "@/components/crm/Shell";
import type {
  GoalMetricKeyApi,
  GoalPeriodApi,
  GoalProgressResultDto,
  GoalStatusApi,
  SalesGoalDto,
} from "@/lib/api/schemas";
import { formatApiErrorMessage } from "@/lib/api/errors";
import {
  GOAL_PERIOD_LABELS,
  GOAL_PROGRESS_STATUS_LABELS,
  GOAL_SCOPE_LABELS,
  GOAL_STATUS_LABELS,
  createIdempotencyKey,
  formatGoalMetricValue,
  formatGoalProgressPercent,
  formatIstDayLabel,
  getTodayIstDate,
  isValidIstCalendarDate,
  useArchiveGoalMutation,
  useChangeGoalStatusMutation,
  useGoalsListQuery,
  useGoalsProgressQuery,
} from "@/lib/api/goalsApi";
import { useSettingsDefinitionsQuery } from "@/lib/api/settingsApi";
import { PilotGoalDialog } from "./PilotGoalDialog";
import { PilotGoalHistoryDrawer } from "./PilotGoalHistoryDrawer";

function formatGoalTargetDisplay(goal: SalesGoalDto): string {
  const hasTarget =
    goal.targetUnit === "count" ? goal.targetCount !== null : goal.targetAmount !== null;
  if (!hasTarget) return "Target not configured";
  return formatGoalMetricValue({
    unit: goal.targetUnit,
    value: goal.targetCount,
    decimal: goal.targetAmount,
  });
}

function formatProgressTargetDisplay(
  progress: GoalProgressResultDto,
  fallbackGoal: SalesGoalDto,
): string {
  if (progress.unit === "count") {
    if (progress.target === null) return "Target not configured";
    return formatGoalMetricValue({ unit: "count", value: progress.target });
  }
  if (progress.targetDecimal !== null) {
    return formatGoalMetricValue({
      unit: "inr",
      value: progress.target,
      decimal: progress.targetDecimal,
    });
  }
  if (progress.target !== null) {
    return formatGoalMetricValue({ unit: "inr", value: progress.target });
  }
  return formatGoalTargetDisplay(fallbackGoal);
}

export interface PilotGoalsSectionProps {
  unknownWonDatesCount?: number | undefined;
}

export function PilotGoalsSection({ unknownWonDatesCount = 0 }: PilotGoalsSectionProps) {
  const todayIst = useMemo(() => getTodayIstDate(), []);
  const [asOfInput, setAsOfInput] = useState<string>(todayIst);
  const effectiveAsOf = isValidIstCalendarDate(asOfInput) ? asOfInput : todayIst;

  const [statusFilter, setStatusFilter] = useState<"all" | GoalStatusApi>("all");
  const [metricFilter, setMetricFilter] = useState<"all" | GoalMetricKeyApi>("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | GoalPeriodApi>("all");
  const [showArchived, setShowArchived] = useState<boolean>(false);

  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; mode: "create"; goal?: null }
    | { open: true; mode: "edit"; goal: SalesGoalDto }
  >({ open: false });
  const [historyGoal, setHistoryGoal] = useState<SalesGoalDto | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SalesGoalDto | null>(null);
  const [archiveReason, setArchiveReason] = useState<string>("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [busyStatusGoalId, setBusyStatusGoalId] = useState<string | null>(null);

  const defsQ = useSettingsDefinitionsQuery();
  const progressQ = useGoalsProgressQuery(effectiveAsOf);
  const archivedQ = useGoalsListQuery(
    { status: "archived", includeArchived: true, limit: 100 },
    showArchived,
  );

  const statusMut = useChangeGoalStatusMutation();
  const archiveMut = useArchiveGoalMutation();

  const definitions = defsQ.data?.definitions;
  const metricDescriptionMap = useMemo(() => {
    const map = new Map<string, { description: string; dataSource: string }>();
    for (const m of definitions?.goalMetrics ?? []) {
      map.set(m.key, { description: m.description, dataSource: m.dataSource });
    }
    return map;
  }, [definitions]);

  const filteredActiveItems = useMemo(() => {
    const raw = progressQ.data?.items ?? [];
    return raw.filter(({ goal }) => {
      if (statusFilter !== "all" && goal.status !== statusFilter) return false;
      if (metricFilter !== "all" && goal.metric !== metricFilter) return false;
      if (periodFilter !== "all" && goal.period !== periodFilter) return false;
      return true;
    });
  }, [progressQ.data?.items, statusFilter, metricFilter, periodFilter]);

  const filteredArchivedGoals = useMemo(() => {
    if (!showArchived) return [];
    if (statusFilter !== "all" && statusFilter !== "archived") return [];
    const raw = archivedQ.data?.items ?? [];
    return raw.filter((goal) => {
      if (metricFilter !== "all" && goal.metric !== metricFilter) return false;
      if (periodFilter !== "all" && goal.period !== periodFilter) return false;
      return true;
    });
  }, [showArchived, statusFilter, metricFilter, periodFilter, archivedQ.data?.items]);

  const handleTogglePause = async (goal: SalesGoalDto) => {
    const nextStatus = goal.status === "paused" ? "active" : "paused";
    setBusyStatusGoalId(goal.id);
    try {
      const res = await statusMut.mutateAsync({
        id: goal.id,
        payload: {
          status: nextStatus,
          expectedVersion: goal.version,
          reason:
            nextStatus === "paused"
              ? "Paused from My Performance Pilot"
              : "Resumed from My Performance Pilot",
          idempotencyKey: createIdempotencyKey(),
        },
      });
      toast.success(
        `Goal “${res.goal.name}” ${res.goal.status === "paused" ? "paused" : "resumed"}`,
      );
    } catch (err) {
      toast.error(formatApiErrorMessage(err, "Could not update goal status."));
    } finally {
      setBusyStatusGoalId(null);
    }
  };

  const handleConfirmArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archiveTarget) return;
    setArchiveError(null);
    try {
      const res = await archiveMut.mutateAsync({
        id: archiveTarget.id,
        payload: {
          expectedVersion: archiveTarget.version,
          ...(archiveReason.trim() ? { reason: archiveReason.trim() } : {}),
          idempotencyKey: createIdempotencyKey(),
        },
      });
      toast.success(`Goal “${res.goal.name}” archived (historical revisions preserved)`);
      setArchiveTarget(null);
      setArchiveReason("");
    } catch (err) {
      setArchiveError(formatApiErrorMessage(err, "Could not archive goal."));
    }
  };

  const totalConfiguredNonArchived = progressQ.data?.items.length ?? 0;
  const anyVisibleCards = filteredActiveItems.length > 0 || filteredArchivedGoals.length > 0;

  return (
    <section
      className="rounded-2xl border bg-card p-5 space-y-4"
      aria-label="Sales Goals and Targets"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Target className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Sales Goals & Target Tracking
              </h2>
              <span
                className="pf-badge"
                data-status={totalConfiguredNonArchived > 0 ? "active" : undefined}
              >
                {totalConfiguredNonArchived > 0
                  ? `${totalConfiguredNonArchived} active/paused`
                  : "Target not configured"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Server-backed MariaDB goals evaluated in Asia/Kolkata (IST) against verified CRM
              records. Weeks run Monday–Sunday.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild type="button" size="sm" variant="outline" className="rounded-lg gap-1.5">
            <Link to="/settings" search={pilotLinkSearch({ section: "notifications" })}>
              <Settings className="size-3.5" />
              Goal alert prefs
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-lg gap-1.5"
            onClick={() => setDialogState({ open: true, mode: "create" })}
          >
            <Plus className="size-3.5" />
            New goal
          </Button>
        </div>
      </div>

      {/* Filter & As-Of Toolbar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/25 p-3">
        <div className="grid gap-1">
          <Label
            htmlFor="goals-as-of"
            className="text-[11px] text-muted-foreground flex items-center gap-1"
          >
            <Calendar className="size-3" />
            Measure as of (IST date)
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="goals-as-of"
              type="date"
              value={asOfInput}
              onChange={(e) => setAsOfInput(e.target.value)}
              className="h-8 w-auto text-xs"
            />
            {effectiveAsOf !== todayIst && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={() => setAsOfInput(todayIst)}
              >
                Today IST
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="goals-filter-status" className="text-[11px] text-muted-foreground">
            Status
          </Label>
          <select
            id="goals-filter-status"
            className={`${selectCls} h-8 text-xs`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | GoalStatusApi)}
          >
            <option value="all">All active/paused</option>
            <option value="active">Active only</option>
            <option value="paused">Paused only</option>
            {showArchived && <option value="archived">Archived only</option>}
          </select>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="goals-filter-metric" className="text-[11px] text-muted-foreground">
            Metric
          </Label>
          <select
            id="goals-filter-metric"
            className={`${selectCls} h-8 text-xs`}
            value={metricFilter}
            onChange={(e) => setMetricFilter(e.target.value as "all" | GoalMetricKeyApi)}
          >
            <option value="all">All metrics</option>
            {(definitions?.goalMetrics ?? []).map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="goals-filter-period" className="text-[11px] text-muted-foreground">
            Period
          </Label>
          <select
            id="goals-filter-period"
            className={`${selectCls} h-8 text-xs`}
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as "all" | GoalPeriodApi)}
          >
            <option value="all">All periods</option>
            <option value="daily">{GOAL_PERIOD_LABELS.daily}</option>
            <option value="weekly">{GOAL_PERIOD_LABELS.weekly}</option>
            <option value="monthly">{GOAL_PERIOD_LABELS.monthly}</option>
            <option value="custom">{GOAL_PERIOD_LABELS.custom}</option>
          </select>
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none h-8">
          <Switch
            id="goals-show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => {
              setShowArchived(checked);
              if (!checked && statusFilter === "archived") {
                setStatusFilter("all");
              }
            }}
          />
          <span>Show archived</span>
        </label>
      </div>

      {unknownWonDatesCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
          <Info className="size-4 shrink-0 text-warning" />
          <span>
            {unknownWonDatesCount} won deal(s) have missing/unknown won dates and are excluded from
            dated period goal figures.
          </span>
        </div>
      )}

      {progressQ.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              Failed to load MariaDB goals:{" "}
              {formatApiErrorMessage(progressQ.error, "Unknown server error.")}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void progressQ.refetch()}
          >
            <RotateCw className="size-3.5 mr-1" />
            Retry
          </Button>
        </div>
      )}

      {showArchived && archivedQ.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              Failed to load archived goals:{" "}
              {formatApiErrorMessage(archivedQ.error, "Unknown server error.")}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void archivedQ.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {progressQ.isLoading && (
        <div className="pf-goals" aria-label="Loading goals">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}

      {!progressQ.isLoading && !progressQ.error && !anyVisibleCards && (
        <div className="pf-unmeasured">
          <Info className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              {totalConfiguredNonArchived === 0
                ? "Target not configured."
                : "No goals match your active filters."}
            </p>
            <p>
              {totalConfiguredNonArchived === 0
                ? "Unconfigured goals never use hidden default sales targets or zero fallbacks. Create an explicit goal when you are ready to track targets in MariaDB."
                : "Clear a filter or toggle Show archived to inspect historical targets."}
            </p>
            {totalConfiguredNonArchived === 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDialogState({ open: true, mode: "create" })}
              >
                <Plus className="size-3.5 mr-1" />
                Configure your first goal
              </Button>
            )}
          </div>
        </div>
      )}

      {anyVisibleCards && (
        <div className="pf-goals">
          {filteredActiveItems.map(({ goal, progress }) => {
            const metricInfo = metricDescriptionMap.get(goal.metric);
            const targetText = formatProgressTargetDisplay(progress, goal);
            const actualText = progress.measurable
              ? formatGoalMetricValue({
                  unit: progress.unit,
                  value: progress.actual,
                  decimal: progress.actualDecimal,
                })
              : "—";
            const pctText =
              progress.status === "not_configured"
                ? "Unconfigured"
                : formatGoalProgressPercent(progress.pctPercent);
            const remainingText =
              progress.measurable && progress.remaining !== null
                ? progress.remaining > 0
                  ? `${formatGoalMetricValue({
                      unit: progress.unit,
                      value: progress.remaining,
                      decimal: progress.remainingDecimal,
                    })} remaining`
                  : "Target reached"
                : null;
            const statusBusy = busyStatusGoalId === goal.id && statusMut.isPending;

            return (
              <article
                key={goal.id}
                className="pf-goal flex flex-col justify-between gap-3"
                data-goal-id={goal.id}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-[130px]">
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {goal.name}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {goal.metricLabel} ·{" "}
                        <span className="capitalize">
                          {GOAL_SCOPE_LABELS[goal.scope] ?? goal.scope}
                        </span>
                      </p>
                    </div>
                    <span className="pf-badge shrink-0 max-w-full" data-status={progress.status}>
                      {GOAL_PROGRESS_STATUS_LABELS[progress.status]}
                    </span>
                  </div>

                  {metricInfo && (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {metricInfo.description}
                    </p>
                  )}

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pt-1">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Target</dt>
                      <dd className="font-semibold text-foreground num">{targetText}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Achieved</dt>
                      <dd className="font-semibold text-foreground num">{actualText}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Progress</dt>
                      <dd className="font-semibold text-foreground num">{pctText}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Remaining</dt>
                      <dd className="font-medium text-foreground num">{remainingText ?? "—"}</dd>
                    </div>
                  </dl>

                  {progress.measurable && progress.pct !== null ? (
                    <progress
                      className="pf-progress mt-2"
                      data-status={progress.status}
                      max={100}
                      value={Math.min(100, Math.max(0, progress.pctPercent ?? 0))}
                      aria-label={`${goal.name} progress (${pctText})`}
                    />
                  ) : (
                    <div
                      className="pf-bar mt-2"
                      data-empty="true"
                      aria-label={`${goal.name} has no measurable percentage in the current state`}
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground pt-1">
                    <span>
                      {GOAL_PERIOD_LABELS[goal.period]}
                      {progress.window
                        ? ` · ${formatIstDayLabel(progress.window.start)} – ${formatIstDayLabel(progress.window.end)}`
                        : ""}
                    </span>
                    <span>
                      v{progress.appliedVersion ?? goal.version}
                      {progress.appliedEffectiveFromIst
                        ? ` · eff. ${progress.appliedEffectiveFromIst}`
                        : ""}
                    </span>
                  </div>

                  {(progress.unavailableReason ||
                    progress.note ||
                    progress.excludedUnknownDateCount > 0) && (
                    <p className="rounded-lg border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
                      {progress.unavailableReason ??
                        progress.note ??
                        `${progress.excludedUnknownDateCount} record(s) without verified dates excluded.`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setDialogState({ open: true, mode: "edit", goal })}
                  >
                    <Pencil className="size-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={statusBusy}
                    className="h-7 px-2 text-xs"
                    onClick={() => void handleTogglePause(goal)}
                  >
                    {goal.status === "paused" ? (
                      <>
                        <Play className="size-3 mr-1" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="size-3 mr-1" />
                        Pause
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHistoryGoal(goal)}
                  >
                    <History className="size-3 mr-1" />
                    History
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive ml-auto"
                    onClick={() => {
                      setArchiveTarget(goal);
                      setArchiveReason("");
                      setArchiveError(null);
                    }}
                  >
                    <Archive className="size-3 mr-1" />
                    Archive
                  </Button>
                </div>
              </article>
            );
          })}

          {filteredArchivedGoals.map((goal) => (
            <article
              key={goal.id}
              className="pf-goal flex flex-col justify-between gap-3 opacity-80"
              data-goal-id={goal.id}
              data-archived="true"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-[130px]">
                    <h3 className="text-sm font-semibold text-foreground truncate">{goal.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {goal.metricLabel} · {GOAL_PERIOD_LABELS[goal.period]}
                    </p>
                  </div>
                  <span className="pf-badge shrink-0 max-w-full">
                    {GOAL_STATUS_LABELS.archived}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Final target</dt>
                    <dd className="font-semibold text-foreground num">
                      {formatGoalTargetDisplay(goal)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Version</dt>
                    <dd className="font-medium text-foreground">v{goal.version}</dd>
                  </div>
                </dl>
                {goal.archiveReason && (
                  <p className="text-[11px] text-muted-foreground">Reason: {goal.archiveReason}</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-2.5 text-[11px] text-muted-foreground">
                <span>Read-only historical record</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setHistoryGoal(goal)}
                >
                  <History className="size-3 mr-1" />
                  History
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <PilotGoalDialog
        open={dialogState.open}
        onOpenChange={(open) => {
          if (!open) setDialogState({ open: false });
        }}
        mode={dialogState.open ? dialogState.mode : "create"}
        goal={dialogState.open && dialogState.mode === "edit" ? dialogState.goal : null}
        definitions={definitions}
      />

      <PilotGoalHistoryDrawer
        open={Boolean(historyGoal)}
        onOpenChange={(open) => {
          if (!open) setHistoryGoal(null);
        }}
        goal={historyGoal}
      />

      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive “{archiveTarget?.name}”?</DialogTitle>
            <DialogDescription>
              Archived goals become read-only and stop measuring future periods. Historical
              revisions remain intact and auditable in MariaDB.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleConfirmArchive(e)} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="archive-goal-reason">Archive reason (optional)</Label>
              <Input
                id="archive-goal-reason"
                value={archiveReason}
                maxLength={255}
                placeholder="e.g. Superseded by Q4 target"
                onChange={(e) => setArchiveReason(e.target.value)}
              />
            </div>
            {archiveError && (
              <p role="alert" className="text-xs text-destructive">
                {archiveError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={archiveMut.isPending}
                onClick={() => setArchiveTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={archiveMut.isPending}>
                {archiveMut.isPending ? "Archiving…" : "Archive goal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
