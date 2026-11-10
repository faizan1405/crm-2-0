import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, Calendar, Info, RotateCw, Target, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PilotShell } from "./PilotShell";
import {
  invalidateAnalytics,
  usePerformanceAnalyticsQuery,
  useTrendsAnalyticsQuery,
} from "@/lib/api/analyticsApi";
import type { AnalyticsGranularity, AnalyticsPeriod } from "@/lib/api/schemas";
import { CHART, EmptyChart, Kpi, Panel, axis, tip } from "@/components/analytics/parts";
import { formatDate, formatINR, formatINRCompact, formatPct } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PERIODS: { id: AnalyticsPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This week" },
  { id: "7d", label: "Last 7 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisYear", label: "This year" },
  { id: "custom", label: "Custom range" },
];

const fmtDay = (d: string) =>
  formatDate(`${d}T12:00:00Z`, { day: "numeric", month: "short", year: "numeric" });
const fmtSafePct = (r: number | null) => (r == null ? "N/A" : formatPct(r));

export function PilotMyPerformancePage(_props: { search?: Record<string, unknown> }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [granularity, setGranularity] = useState<AnalyticsGranularity>("day");

  const isCustomValid =
    period !== "custom" || Boolean(customFrom && customTo && customFrom <= customTo);

  const queryParams = {
    period,
    from: period === "custom" ? customFrom || undefined : undefined,
    to: period === "custom" ? customTo || undefined : undefined,
  };

  const perfQ = usePerformanceAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const trendsQ = useTrendsAnalyticsQuery(
    { ...queryParams, granularity },
    { enabled: isCustomValid },
  );

  const isFetching = perfQ.isFetching || trendsQ.isFetching;
  const error = perfQ.error || trendsQ.error;

  const handleRefresh = async () => {
    try {
      await invalidateAnalytics(queryClient);
      toast.success("Owner performance refreshed from MariaDB");
    } catch {
      toast.error("Failed to refresh owner performance");
    }
  };

  const perf = perfQ.data;
  const trends = trendsQ.data;

  const isAllZero =
    perf != null &&
    perf.ownerSummary.callsAttempted === 0 &&
    perf.ownerSummary.followUpsCompleted === 0 &&
    perf.ownerSummary.leadsCreated === 0 &&
    perf.ownerSummary.dealsWon === 0 &&
    perf.ownerSummary.quotationsConfirmedSent === 0;

  return (
    <TooltipProvider delayDuration={150}>
      <PilotShell
        title="My Performance"
        subtitle={
          perf?.window
            ? `${fmtDay(perf.window.start)} – ${fmtDay(perf.window.end)} · Authenticated Owner Report (IST)`
            : "Your MariaDB sales activity, follow-ups, conversions and goals"
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching || !isCustomValid}
            className="rounded-lg gap-1.5"
          >
            <RotateCw className={cn("size-3.5", isFetching && "animate-spin")} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>
            <b className="font-semibold text-foreground">Owner Performance Mode.</b> Isolated to
            your authenticated Owner workspace in MariaDB. Browser-local Employee goals are not
            mixed into server calculations.
          </span>
        </div>

        {/* Date Controls */}
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
            <Calendar className="size-3.5" />
            Period:
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={period === p.id ? "default" : "outline"}
                onClick={() => setPeriod(p.id)}
                className="h-7 rounded-lg text-xs"
              >
                {p.label}
              </Button>
            ))}
          </div>

          {period === "custom" && (
            <div className="flex flex-wrap items-center gap-2 pl-2 border-l">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
                className="h-7 w-auto text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
                className="h-7 w-auto text-xs"
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5 pl-2 border-l">
            <span className="text-xs text-muted-foreground">Trend chart:</span>
            {(["day", "week", "month"] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={granularity === g ? "secondary" : "ghost"}
                onClick={() => setGranularity(g)}
                className="h-7 px-2 text-xs capitalize"
              >
                {g}
              </Button>
            ))}
          </div>
        </div>

        {!isCustomValid && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
            <Info className="size-4 shrink-0" />
            <span>
              Select a valid Start and End date where Start date is on or before End date.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                Failed to load owner performance:{" "}
                {error instanceof Error ? error.message : "Unknown error"}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={handleRefresh} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {perfQ.isLoading && isCustomValid ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : perf && isCustomValid && !error ? (
          <div className="space-y-5">
            {isAllZero && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                <Info className="size-4 shrink-0" />
                <span>
                  No recorded activity in this period yet. Metrics populate directly from saved
                  calls, completed follow-ups, leads worked, quotations sent, and won deals. Nothing
                  is estimated or fabricated.
                </span>
              </div>
            )}

            {/* Primary KPI Grid */}
            <section
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              aria-label="Owner summary"
            >
              <Kpi
                label="Calls Attempted"
                value={String(perf.ownerSummary.callsAttempted)}
                hint={`${perf.ownerSummary.callsConnected} connected (${fmtSafePct(perf.ownerSummary.connectionRate)})`}
                def="Explicitly logged call outcomes in this period. Connected rate = connected / attempts."
              />
              <Kpi
                label="Follow-ups Completed"
                value={String(perf.ownerSummary.followUpsCompleted)}
                hint={`${perf.ownerSummary.followUpsDue} due · Rate: ${fmtSafePct(perf.ownerSummary.followUpRate)}`}
                tone={perf.ownerSummary.followUpsOverdueNow > 0 ? "warning" : "default"}
                def={`${perf.ownerSummary.followUpsOverdueNow} follow-ups are currently overdue as of today (${perf.todayIstDate}).`}
              />
              <Kpi
                label="Leads Worked"
                value={String(perf.ownerSummary.leadsCreated)}
                hint={`${perf.ownerSummary.leadsQualified} reached qualified+ stage`}
                def="Leads entered in this period."
              />
              <Kpi
                label="Quotations Sent"
                value={String(perf.ownerSummary.quotationsConfirmedSent)}
                hint="Sent / confirmed proposals"
                def="Quotations moved into sent/accepted/rejected status during this period."
              />
              <Kpi
                label="Deals Won / Booked"
                value={String(perf.ownerSummary.dealsWon)}
                hint={`${formatINRCompact(perf.ownerSummary.wonDealValue)} booked`}
                tone="success"
                def="Verified won deals attributed in window."
              />
              <Kpi
                label="Cohort Win Rate"
                value={fmtSafePct(perf.ownerSummary.cohortWinRate)}
                hint={`${perf.ownerSummary.cohortWon} won / ${perf.ownerSummary.cohortSize} created`}
                def="Percentage of leads created in window that converted to Won."
              />
              <Kpi
                label="Booked Deal Value"
                value={formatINRCompact(perf.ownerSummary.wonDealValue)}
                hint={formatINR(perf.ownerSummary.wonDealValue)}
                def="Total final contract value of won deals in window (does not equal cash collected)."
              />
              <Kpi
                label="Overdue Follow-ups Now"
                value={String(perf.ownerSummary.followUpsOverdueNow)}
                tone={perf.ownerSummary.followUpsOverdueNow > 0 ? "destructive" : "default"}
                hint={`Snapshot as of ${perf.todayIstDate}`}
                def="Pending follow-ups past scheduled IST deadline."
              />
            </section>

            {/* Activity & Revenue Charts */}
            {trends && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel
                  title="Daily Activity Output"
                  sub={`Calls vs Follow-ups (${trends.granularity})`}
                >
                  {trends.series.length === 0 ? (
                    <EmptyChart text="No recorded activity events in window." />
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trends.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                          />
                          <XAxis dataKey="bucket" {...axis} />
                          <YAxis {...axis} />
                          <Tooltip {...tip} />
                          <Legend />
                          <Bar
                            dataKey="callsAttempted"
                            name="Calls Logged"
                            fill={CHART[0]}
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="followUpsCompleted"
                            name="Follow-ups Completed"
                            fill={CHART[1]}
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Panel>

                <Panel
                  title="Booked Value vs Cash Collected"
                  sub="Financial realization across periods"
                >
                  {trends.series.length === 0 ? (
                    <EmptyChart text="No financial bookings or collections in window." />
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trends.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                          />
                          <XAxis dataKey="bucket" {...axis} />
                          <YAxis {...axis} />
                          <Tooltip {...tip} />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="wonDealValue"
                            name="Booked Deal Value (INR)"
                            stroke={CHART[0]}
                            fill={CHART[0]}
                            fillOpacity={0.18}
                          />
                          <Area
                            type="monotone"
                            dataKey="paymentsCollected"
                            name="Cash Collected (INR)"
                            stroke={CHART[2]}
                            fill={CHART[2]}
                            fillOpacity={0.18}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* Goals & Data Attribution Boundaries */}
            <div className="rounded-2xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
                  <Target className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Goals & Target Tracking</h3>
                    <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {perf.goals.status === "not_configured"
                        ? "Deferred / Server Schema Pending"
                        : "Active"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {perf.goals.note}
                  </p>
                  {perf.ownerSummary.unknownWonDatesCount > 0 && (
                    <p className="mt-2 text-xs text-warning">
                      Note: {perf.ownerSummary.unknownWonDatesCount} won deal(s) have
                      missing/unknown won dates and are listed separately from dated period figures.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </PilotShell>
    </TooltipProvider>
  );
}
