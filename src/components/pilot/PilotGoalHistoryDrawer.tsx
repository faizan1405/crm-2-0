import { AlertCircle, History, RotateCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SalesGoalDto } from "@/lib/api/schemas";
import { formatApiErrorMessage } from "@/lib/api/errors";
import {
  GOAL_PERIOD_LABELS,
  GOAL_SCOPE_LABELS,
  GOAL_STATUS_LABELS,
  formatGoalMetricValue,
  formatIstDayLabel,
  useGoalRevisionsQuery,
} from "@/lib/api/goalsApi";
import { formatDateTime } from "@/lib/crm/format";

export interface PilotGoalHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: SalesGoalDto | null;
}

export function PilotGoalHistoryDrawer({ open, onOpenChange, goal }: PilotGoalHistoryDrawerProps) {
  const revQ = useGoalRevisionsQuery(goal?.id, { limit: 100 }, open && Boolean(goal));

  const revisions = revQ.data?.items ? [...revQ.data.items].reverse() : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <History className="size-4 text-primary" />
            <span>{goal?.name ?? "Goal history"}</span>
          </SheetTitle>
          <SheetDescription>
            {goal ? (
              <>
                {goal.metricLabel} · {GOAL_PERIOD_LABELS[goal.period]} · Version v{goal.version} ·{" "}
                {GOAL_STATUS_LABELS[goal.status]}
              </>
            ) : (
              "Immutable revision timeline stored in MariaDB"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {goal?.status === "archived" && (
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-semibold text-foreground">
                Archived goal (read-only audit record)
              </div>
              {goal.archivedAt && <div>Archived on {formatDateTime(goal.archivedAt)}</div>}
              {goal.archiveReason && <div>Reason: {goal.archiveReason}</div>}
            </div>
          )}

          {revQ.isLoading && (
            <div className="space-y-3" aria-label="Loading goal revisions">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          )}

          {revQ.error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                {formatApiErrorMessage(revQ.error, "Could not load goal revisions.")}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => void revQ.refetch()}>
                <RotateCw className="size-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {!revQ.isLoading && !revQ.error && revisions.length === 0 && (
            <p className="text-sm text-muted-foreground">No revisions recorded for this goal.</p>
          )}

          {revisions.length > 0 && (
            <ol className="space-y-3" aria-label="Goal revision timeline">
              {revisions.map((rev) => {
                const snap = rev.snapshot;
                const formattedTarget =
                  snap.targetUnit === "count"
                    ? snap.targetCount !== null
                      ? formatGoalMetricValue({ unit: "count", value: snap.targetCount })
                      : "Target not configured"
                    : snap.targetAmount !== null
                      ? formatGoalMetricValue({
                          unit: "inr",
                          value: null,
                          decimal: snap.targetAmount,
                        })
                      : "Target not configured";

                return (
                  <li key={rev.id} className="rounded-xl border bg-card p-3.5 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                        <span className="pf-badge">Rev {rev.revisionNumber}</span>
                        <span>{rev.eventType}</span>
                      </span>
                      <span className="text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{rev.changeSummary}</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <div>
                        <dt className="inline">Target: </dt>
                        <dd className="inline font-semibold text-foreground num">
                          {formattedTarget}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Period: </dt>
                        <dd className="inline font-medium text-foreground">
                          {GOAL_PERIOD_LABELS[snap.period]}
                          {snap.period === "custom" && snap.customFromIst && snap.customToIst
                            ? ` (${snap.customFromIst} – ${snap.customToIst})`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Effective from: </dt>
                        <dd className="inline font-medium text-foreground">
                          {formatIstDayLabel(rev.effectiveFromIst)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Status / Scope: </dt>
                        <dd className="inline font-medium text-foreground">
                          {GOAL_STATUS_LABELS[snap.status]} ·{" "}
                          {GOAL_SCOPE_LABELS[snap.scope] ?? snap.scope}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
