import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, RotateCw, ShieldCheck, Calendar, Info } from "lucide-react";
import { toast } from "sonner";
import { PilotShell } from "./PilotShell";
import {
  invalidateAnalytics,
  useCommunicationsAnalyticsQuery,
  useFinanceAnalyticsQuery,
  useFunnelAnalyticsQuery,
  useProjectsAnalyticsQuery,
  useQuotationsAnalyticsQuery,
  useTrendsAnalyticsQuery,
} from "@/lib/api/analyticsApi";
import type { AnalyticsGranularity, AnalyticsPeriod } from "@/lib/api/schemas";
import {
  CHART,
  EmptyChart,
  Kpi,
  Panel,
  Unavailable,
  axis,
  tip,
} from "@/components/analytics/parts";
import { formatDate, formatINR, formatINRCompact, formatPct } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "overview", label: "Executive overview" },
  { id: "funnel", label: "Funnel & acquisition" },
  { id: "activity", label: "Communications & follow-ups" },
  { id: "finance", label: "Finance & cash" },
  { id: "quotations", label: "Quotations" },
  { id: "projects", label: "Project delivery" },
  { id: "trends", label: "Time-series trends" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const PERIOD_OPTIONS: { id: AnalyticsPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This week" },
  { id: "lastWeek", label: "Last week" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "thisYear", label: "This year" },
  { id: "custom", label: "Custom range" },
];

const GRANULARITY_OPTIONS: { id: AnalyticsGranularity; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

const fmtDay = (d: string) =>
  formatDate(`${d}T12:00:00Z`, { day: "numeric", month: "short", year: "numeric" });
const fmtHrs = (h: number | null) =>
  h == null
    ? "N/A"
    : h < 1
      ? `${Math.round(h * 60)} min`
      : h < 48
        ? `${h.toFixed(1)} h`
        : `${(h / 24).toFixed(1)} days`;
const fmtSafePct = (r: number | null) => (r == null ? "N/A" : formatPct(r));

export function PilotAnalyticsPage(_props: { search?: Record<string, unknown> }) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionId>("overview");
  const [period, setPeriod] = useState<AnalyticsPeriod>("thisMonth");
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

  const funnelQ = useFunnelAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const commsQ = useCommunicationsAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const financeQ = useFinanceAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const quotesQ = useQuotationsAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const projectsQ = useProjectsAnalyticsQuery(queryParams, { enabled: isCustomValid });
  const trendsQ = useTrendsAnalyticsQuery(
    { ...queryParams, granularity },
    { enabled: isCustomValid },
  );

  const isFetchingAny =
    funnelQ.isFetching ||
    commsQ.isFetching ||
    financeQ.isFetching ||
    quotesQ.isFetching ||
    projectsQ.isFetching ||
    trendsQ.isFetching;

  const isLoadingCore =
    isCustomValid &&
    (funnelQ.isLoading ||
      commsQ.isLoading ||
      financeQ.isLoading ||
      quotesQ.isLoading ||
      projectsQ.isLoading);

  const firstError =
    funnelQ.error ||
    commsQ.error ||
    financeQ.error ||
    quotesQ.error ||
    projectsQ.error ||
    trendsQ.error;

  const handleRefresh = async () => {
    try {
      await invalidateAnalytics(queryClient);
      toast.success("Analytics refreshed from MariaDB");
    } catch {
      toast.error("Failed to refresh analytics");
    }
  };

  const resolvedWindow = funnelQ.data?.window ?? financeQ.data?.window ?? commsQ.data?.window;

  return (
    <TooltipProvider delayDuration={150}>
      <PilotShell
        title="Analytics Studio"
        subtitle={
          resolvedWindow
            ? `${fmtDay(resolvedWindow.start)} – ${fmtDay(resolvedWindow.end)} · India Business Time (IST) · MariaDB Reporting`
            : "India Business Time (IST) · MariaDB Reporting"
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetchingAny || !isCustomValid}
            className="rounded-lg gap-1.5"
          >
            <RotateCw className={cn("size-3.5", isFetchingAny && "animate-spin")} />
            {isFetchingAny ? "Refreshing…" : "Refresh"}
          </Button>
        }
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>
            <b className="font-semibold text-foreground">MariaDB Reporting Mode.</b> Every metric is
            computed from server database records in IST. Ad spend, CAC, ROAS, and Profit are marked
            unavailable until expense tracking is configured.
          </span>
        </div>

        {/* Period Filter Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
            <Calendar className="size-3.5" />
            Window:
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
            {PERIOD_OPTIONS.map((opt) => (
              <Button
                key={opt.id}
                size="sm"
                variant={period === opt.id ? "default" : "outline"}
                onClick={() => setPeriod(opt.id)}
                className="h-7 rounded-lg text-xs"
              >
                {opt.label}
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

          {section === "trends" && (
            <div className="flex items-center gap-1.5 ml-auto pl-2 border-l">
              <span className="text-xs text-muted-foreground">Group by:</span>
              {GRANULARITY_OPTIONS.map((g) => (
                <Button
                  key={g.id}
                  size="sm"
                  variant={granularity === g.id ? "secondary" : "ghost"}
                  onClick={() => setGranularity(g.id)}
                  className="h-7 px-2.5 text-xs"
                >
                  {g.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {!isCustomValid && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
            <Info className="size-4 shrink-0" />
            <span>
              Please select valid Start and End dates where Start date is on or before End date to
              run a custom report.
            </span>
          </div>
        )}

        {firstError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                Reporting error:{" "}
                {firstError instanceof Error ? firstError.message : "Failed to load analytics"}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={handleRefresh} className="h-8">
              Retry
            </Button>
          </div>
        )}

        {/* Section Tabs */}
        <nav className="seg as-tabs mb-5" aria-label="Analytics sections">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={section === x.id}
              onClick={() => setSection(x.id)}
            >
              {x.label}
            </button>
          ))}
        </nav>

        {isLoadingCore ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : !isCustomValid || firstError ? null : (
          <>
            {/* SECTION: OVERVIEW */}
            {section === "overview" &&
              funnelQ.data &&
              financeQ.data &&
              commsQ.data &&
              projectsQ.data && (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi
                      label="New Leads Cohort"
                      value={String(funnelQ.data.cohort.size)}
                      hint={`${funnelQ.data.cohort.qualified} qualified · ${funnelQ.data.cohort.won} won`}
                      def="Leads created within the selected IST window."
                    />
                    <Kpi
                      label="Cohort Win Rate"
                      value={fmtSafePct(funnelQ.data.cohort.winRate)}
                      hint={`Closed conversion: ${fmtSafePct(funnelQ.data.closedConversion.winRate)}`}
                      def="Won leads divided by total leads created in window. Closed conversion is won / (won + lost)."
                    />
                    <Kpi
                      label="Booked Deal Value"
                      value={formatINRCompact(financeQ.data.kpis.wonDealValue)}
                      hint={`${financeQ.data.kpis.wonDealCount} deal(s) booked in window`}
                      def="Sum of final contract values for active/won deals in window. Booked value is NOT cash collected."
                    />
                    <Kpi
                      label="Cash Collected"
                      value={formatINRCompact(financeQ.data.kpis.receivedCash)}
                      tone="success"
                      hint={`${financeQ.data.kpis.paymentCount} posted payments · ${formatINRCompact(financeQ.data.kpis.outstanding)} outstanding`}
                      def="Sum of non-voided posted payments recorded in window."
                    />
                    <Kpi
                      label="Connected Calls"
                      value={`${commsQ.data.calls.connected} / ${commsQ.data.calls.attempts}`}
                      hint={`Connection rate: ${fmtSafePct(commsQ.data.calls.connectionRate)}`}
                      def="Only explicitly logged connected outcomes count. Busy/Unanswered calls are excluded."
                    />
                    <Kpi
                      label="WhatsApp Confirmed Sent"
                      value={String(commsQ.data.whatsapp.confirmedSent)}
                      hint="Owner-confirmed sent only"
                      def="Count of owner_confirmed_sent WhatsApp messages logged. Opening wa.me does not count."
                    />
                    <Kpi
                      label="Follow-up Completion"
                      value={fmtSafePct(commsQ.data.followUps.completionRate)}
                      hint={`${commsQ.data.followUps.completed} completed · ${commsQ.data.followUps.overdueNow} overdue now`}
                      tone={commsQ.data.followUps.overdueNow > 0 ? "warning" : "default"}
                      def="Completed follow-ups divided by scheduled/due follow-ups."
                    />
                    <Kpi
                      label="Active Projects"
                      value={String(projectsQ.data.projectCounts.active)}
                      hint={`${projectsQ.data.tasks.done}/${projectsQ.data.tasks.total} tasks completed`}
                      def="Current active projects tracked in Project Desk."
                    />
                  </div>

                  {/* Unavailable Notice Card */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Unavailable
                      title="Marketing Spend & CAC"
                      reason="Meta/Google Ads cost ingestion is disabled in this checkpoint."
                    />
                    <Unavailable
                      title="ROAS & Campaign ROI"
                      reason="Attribution cost tracking requires connected Ad accounts."
                    />
                    <Unavailable
                      title="Net Business Profit"
                      reason="Collected cash is reported separately; operational expenses are not stored."
                    />
                    <Unavailable
                      title="WhatsApp Delivered / Read"
                      reason="Manual log records confirm owner-sent intent, not Meta Cloud receipt."
                    />
                  </div>

                  {trendsQ.data && (
                    <Panel
                      title="Period Trend (Leads & Collections)"
                      sub={`${fmtDay(trendsQ.data.window.start)} – ${fmtDay(trendsQ.data.window.end)} (${trendsQ.data.granularity})`}
                    >
                      {trendsQ.data.series.length === 0 ? (
                        <EmptyChart text="No recorded trend activity in this period." />
                      ) : (
                        <div className="h-72 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendsQ.data.series}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="var(--border)"
                                vertical={false}
                              />
                              <XAxis dataKey="bucket" {...axis} />
                              <YAxis yAxisId="left" {...axis} />
                              <YAxis yAxisId="right" orientation="right" {...axis} />
                              <Tooltip {...tip} />
                              <Legend />
                              <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="leadsReceived"
                                name="New Leads"
                                stroke={CHART[0]}
                                fill={CHART[0]}
                                fillOpacity={0.18}
                              />
                              <Area
                                yAxisId="right"
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
                  )}
                </div>
              )}

            {/* SECTION: FUNNEL & ACQUISITION */}
            {section === "funnel" && funnelQ.data && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label="Cohort Win Rate"
                    value={fmtSafePct(funnelQ.data.cohort.winRate)}
                    hint={`${funnelQ.data.cohort.won} won out of ${funnelQ.data.cohort.size} leads`}
                    def="Won / Cohort size. Represents end-to-end outcome of leads created in window."
                  />
                  <Kpi
                    label="Closed Deal Conversion"
                    value={fmtSafePct(funnelQ.data.closedConversion.winRate)}
                    hint={`${funnelQ.data.closedConversion.won} won / ${funnelQ.data.closedConversion.won + funnelQ.data.closedConversion.lost} closed`}
                    def="Won / (Won + Lost). Excludes active in-progress leads."
                  />
                  <Kpi
                    label="Cohort Qualification Rate"
                    value={fmtSafePct(funnelQ.data.cohort.qualRate)}
                    hint={`${funnelQ.data.cohort.qualified} leads reached qualified+`}
                    def="Leads that reached qualified stage or further divided by cohort size."
                  />
                  <Kpi
                    label="Recorded Stage Moves"
                    value={String(funnelQ.data.totalMovesRecorded)}
                    hint="Pipeline transitions logged"
                    def="Audit-backed count of stage transitions within this window."
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <Panel
                    title="Current Lead Stage Distribution"
                    sub="Active pipeline distribution by count & quoted value"
                  >
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={funnelQ.data.currentDistribution}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                          />
                          <XAxis dataKey="label" {...axis} />
                          <YAxis {...axis} />
                          <Tooltip {...tip} />
                          <Bar dataKey="count" name="Leads" fill={CHART[0]} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>

                  <Panel
                    title="Lead Source Attribution"
                    sub="Leads, win rate & median first contact time by source"
                  >
                    {funnelQ.data.sourcePerformance.length === 0 ? (
                      <EmptyChart text="No leads available in this window to group by source." />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 font-medium">Source</th>
                              <th className="py-2 text-right font-medium">Leads</th>
                              <th className="py-2 text-right font-medium">Qualified</th>
                              <th className="py-2 text-right font-medium">Won</th>
                              <th className="py-2 text-right font-medium">Win Rate</th>
                              <th className="py-2 text-right font-medium">Med First Touch</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {funnelQ.data.sourcePerformance.map((src) => (
                              <tr key={src.source}>
                                <td className="py-2 font-medium">{src.source}</td>
                                <td className="py-2 text-right">{src.leads}</td>
                                <td className="py-2 text-right">{src.qualified}</td>
                                <td className="py-2 text-right">{src.won}</td>
                                <td className="py-2 text-right">{fmtSafePct(src.winRate)}</td>
                                <td className="py-2 text-right">
                                  {fmtHrs(src.medianFirstAttemptH)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                </div>

                {funnelQ.data.lostReasons.length > 0 && (
                  <Panel
                    title="Lost Lead Reasons"
                    sub="Breakdown of closed-lost opportunities by recorded reason"
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 font-medium">Reason</th>
                            <th className="py-2 text-right font-medium">Count</th>
                            <th className="py-2 text-right font-medium">Quoted Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {funnelQ.data.lostReasons.map((lr) => (
                            <tr key={lr.reason}>
                              <td className="py-2 font-medium">{lr.reason}</td>
                              <td className="py-2 text-right">{lr.count}</td>
                              <td className="py-2 text-right">{formatINR(lr.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                )}
              </div>
            )}

            {/* SECTION: COMMUNICATIONS & FOLLOW-UPS */}
            {section === "activity" && commsQ.data && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label="Calls Attempted"
                    value={String(commsQ.data.calls.attempts)}
                    hint={`${commsQ.data.calls.noAnswer} unanswered · ${commsQ.data.calls.busy} busy`}
                    def="Dialer opens are excluded; counts explicitly saved call log entries."
                  />
                  <Kpi
                    label="Connected Calls"
                    value={String(commsQ.data.calls.connected)}
                    tone="success"
                    hint={`Rate: ${fmtSafePct(commsQ.data.calls.connectionRate)}`}
                    def="Only calls marked Connected count. Unanswered and Busy calls are excluded from connected."
                  />
                  <Kpi
                    label="WhatsApp Confirmed Sent"
                    value={String(commsQ.data.whatsapp.confirmedSent)}
                    hint="Verified owner_confirmed_sent only"
                    def="Opening WhatsApp without owner confirmation does not increment this count."
                  />
                  <Kpi
                    label="Follow-up Completion"
                    value={fmtSafePct(commsQ.data.followUps.completionRate)}
                    hint={`${commsQ.data.followUps.completed} done · ${commsQ.data.followUps.overdueNow} overdue now`}
                    tone={commsQ.data.followUps.overdueNow > 0 ? "warning" : "default"}
                    def="Completed / Due in period."
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <Panel
                    title="Call Outcomes Breakdown"
                    sub={`Median first attempt latency: ${fmtHrs(commsQ.data.calls.medianFirstAttemptHours)}`}
                  >
                    {commsQ.data.calls.byOutcome.length === 0 ? (
                      <EmptyChart text="No call logs recorded in this window." />
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={commsQ.data.calls.byOutcome}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="var(--border)"
                              vertical={false}
                            />
                            <XAxis dataKey="outcome" {...axis} />
                            <YAxis {...axis} />
                            <Tooltip {...tip} />
                            <Bar
                              dataKey="count"
                              name="Calls"
                              fill={CHART[1]}
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="WhatsApp Confirmations by Purpose"
                    sub="Only confirmed sent messages included"
                  >
                    {commsQ.data.whatsapp.byPurpose.length === 0 ? (
                      <EmptyChart text="No owner-confirmed WhatsApp messages in this window." />
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={commsQ.data.whatsapp.byPurpose}
                              dataKey="count"
                              nameKey="purpose"
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              label
                            >
                              {commsQ.data.whatsapp.byPurpose.map((_, idx) => (
                                <Cell key={idx} fill={CHART[idx % CHART.length]} />
                              ))}
                            </Pie>
                            <Tooltip {...tip} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            )}

            {/* SECTION: FINANCE & CASH */}
            {section === "finance" && financeQ.data && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label="Won Deal Value (Booked)"
                    value={formatINRCompact(financeQ.data.kpis.wonDealValue)}
                    hint={`${financeQ.data.kpis.wonDealCount} deal(s) won in window`}
                    def="Contract value of won/active deals. Does NOT equal cash collected."
                  />
                  <Kpi
                    label="Cash Collected"
                    value={formatINRCompact(financeQ.data.kpis.receivedCash)}
                    tone="success"
                    hint={`${financeQ.data.kpis.paymentCount} posted payments · Collection Rate: ${fmtSafePct(financeQ.data.kpis.collectionRate)}`}
                    def="Actual non-voided cash receipts verified in MariaDB."
                  />
                  <Kpi
                    label="Outstanding Balance"
                    value={formatINRCompact(financeQ.data.kpis.outstanding)}
                    hint={`Overdue: ${formatINRCompact(financeQ.data.kpis.overdue)}`}
                    tone={financeQ.data.kpis.overdue > 0 ? "destructive" : "default"}
                    def="Snapshot of current unpaid balances across active deals (independent of historic filters)."
                  />
                  <Kpi
                    label="Voided Payments"
                    value={formatINRCompact(financeQ.data.voided.amount)}
                    hint={`${financeQ.data.voided.count} voided receipt(s)`}
                    def="Audit-preserved voided payments strictly excluded from Collected Cash."
                  />
                </div>

                {financeQ.data.cancelledDeals.historicalCollectedCash > 0 && (
                  <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-xs flex items-center justify-between">
                    <div>
                      <b className="font-semibold text-foreground">
                        Cancelled Deal Historical Collections:{" "}
                      </b>
                      <span className="text-muted-foreground">
                        {financeQ.data.cancelledDeals.count} cancelled deal(s) retain historical
                        payments for accounting visibility without inflating active Booked Deal
                        Value.
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatINR(financeQ.data.cancelledDeals.historicalCollectedCash)}
                    </span>
                  </div>
                )}

                <div className="grid gap-5 lg:grid-cols-2">
                  <Panel
                    title="Booked Value vs Cash Collected (Monthly)"
                    sub="Monthly inflow comparison"
                  >
                    {financeQ.data.byMonth.length === 0 ? (
                      <EmptyChart text="No monthly deal or payment activity." />
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={financeQ.data.byMonth}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="var(--border)"
                              vertical={false}
                            />
                            <XAxis dataKey="month" {...axis} />
                            <YAxis {...axis} />
                            <Tooltip {...tip} />
                            <Legend />
                            <Bar
                              dataKey="wonValue"
                              name="Booked Value (INR)"
                              fill={CHART[0]}
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="receivedCash"
                              name="Cash Collected (INR)"
                              fill={CHART[2]}
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Collections by Payment Method"
                    sub="Distribution of verified receipts"
                  >
                    {financeQ.data.byPaymentMethod.length === 0 ? (
                      <EmptyChart text="No posted payments recorded in window." />
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={financeQ.data.byPaymentMethod}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="var(--border)"
                              vertical={false}
                            />
                            <XAxis dataKey="method" {...axis} />
                            <YAxis {...axis} />
                            <Tooltip {...tip} />
                            <Bar
                              dataKey="amount"
                              name="Collected (INR)"
                              fill={CHART[3]}
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Panel>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Unavailable
                    title="Net Profit / Margin"
                    reason="Operational/delivery expenses are not captured in B5D."
                  />
                  <Unavailable
                    title="CAC & Ad ROI"
                    reason="No Meta Ads or Google Ads integration present."
                  />
                  <Unavailable
                    title="Bank Reconciliation Status"
                    reason="Voiding reverses CRM ledger entry; bank refunds require separate tracking."
                  />
                </div>
              </div>
            )}

            {/* SECTION: QUOTATIONS */}
            {section === "quotations" && quotesQ.data && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label="Total Quotations"
                    value={String(quotesQ.data.counts.total)}
                    hint={`Draft: ${quotesQ.data.counts.draft} · Sent: ${quotesQ.data.counts.sent}`}
                    def="All quotations created in window across all lifecycle statuses."
                  />
                  <Kpi
                    label="Acceptance Rate (Of Sent)"
                    value={fmtSafePct(quotesQ.data.conversion.rateAcceptedOfSent)}
                    tone="success"
                    hint={`${quotesQ.data.counts.accepted} accepted / ${quotesQ.data.counts.sent + quotesQ.data.counts.accepted + quotesQ.data.counts.rejected} dispatched`}
                    def="Accepted divided by all quotations actually sent to clients (sent + accepted + rejected)."
                  />
                  <Kpi
                    label="Acceptance Rate (Total)"
                    value={fmtSafePct(quotesQ.data.conversion.rateAcceptedOfTotal)}
                    hint={`${quotesQ.data.counts.accepted} / ${quotesQ.data.counts.total} created`}
                    def="Accepted divided by total created including drafts."
                  />
                  <Kpi
                    label="Accepted Quoted Value"
                    value={formatINRCompact(quotesQ.data.values.acceptedQuoted)}
                    hint={`Total sent value: ${formatINRCompact(quotesQ.data.values.sentQuoted)}`}
                    def="Note: Quotation accepted does not automatically equal Deal booked or Payment collected."
                  />
                </div>

                <Panel title="Quotation Volume by Status" sub="Monthly progression">
                  {quotesQ.data.byMonth.length === 0 ? (
                    <EmptyChart text="No quotation history in selected window." />
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={quotesQ.data.byMonth}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                          />
                          <XAxis dataKey="month" {...axis} />
                          <YAxis {...axis} />
                          <Tooltip {...tip} />
                          <Legend />
                          <Bar
                            dataKey="createdCount"
                            name="Created"
                            fill={CHART[0]}
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="sentCount"
                            name="Sent"
                            fill={CHART[1]}
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="acceptedCount"
                            name="Accepted"
                            fill={CHART[2]}
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* SECTION: PROJECT DELIVERY */}
            {section === "projects" && projectsQ.data && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label="Active Projects"
                    value={String(projectsQ.data.projectCounts.active)}
                    hint={`${projectsQ.data.projectCounts.overdue} overdue · ${projectsQ.data.projectCounts.delivered} delivered`}
                    def="Projects currently active in Project Desk."
                  />
                  <Kpi
                    label="Task Completion"
                    value={fmtSafePct(projectsQ.data.tasks.completionRate)}
                    hint={`${projectsQ.data.tasks.done}/${projectsQ.data.tasks.total} tasks completed · ${projectsQ.data.tasks.overdue} overdue`}
                    tone={projectsQ.data.tasks.overdue > 0 ? "warning" : "default"}
                    def="Ratio of marked-done tasks across active delivery."
                  />
                  <Kpi
                    label="Avg Delivery Turnaround"
                    value={
                      projectsQ.data.deliveryPerformance.avgDeliveryDays != null
                        ? `${projectsQ.data.deliveryPerformance.avgDeliveryDays.toFixed(1)} days`
                        : "N/A"
                    }
                    hint={`Measured across ${projectsQ.data.deliveryPerformance.deliveryMeasuredCount} delivered project(s)`}
                    def="Only projects with explicit verified start and delivery dates contribute."
                  />
                  <Kpi
                    label="Support Tickets"
                    value={String(
                      projectsQ.data.support.openTickets + projectsQ.data.support.inProgressTickets,
                    )}
                    hint={`${projectsQ.data.support.resolvedTickets} resolved · ${projectsQ.data.support.activeSupportAgreements} active SLAs`}
                    def="Support requests separated strictly from sales lead interactions."
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <Panel title="Projects by Stage" sub="Distribution across delivery pipeline">
                    {projectsQ.data.byStage.length === 0 ? (
                      <EmptyChart text="No active projects tracked." />
                    ) : (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={projectsQ.data.byStage}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="var(--border)"
                              vertical={false}
                            />
                            <XAxis dataKey="stage" {...axis} />
                            <YAxis {...axis} />
                            <Tooltip {...tip} />
                            <Bar
                              dataKey="count"
                              name="Projects"
                              fill={CHART[4]}
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Delivery & Dependencies Health"
                    sub="Client blockers & unpaid delivered status"
                  >
                    <dl className="divide-y text-sm">
                      <div className="flex items-center justify-between py-2.5">
                        <dt className="text-muted-foreground">Open Client Dependencies</dt>
                        <dd className="font-semibold">
                          {projectsQ.data.dependencies.openClientDependencies}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2.5">
                        <dt className="text-muted-foreground">Projects Waiting on Client</dt>
                        <dd className="font-semibold">
                          {projectsQ.data.dependencies.projectsWaitingOnClient}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2.5">
                        <dt className="text-muted-foreground">Delivered Unpaid Projects</dt>
                        <dd className="font-semibold text-warning">
                          {projectsQ.data.deliveryPerformance.deliveredUnpaidCount}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2.5">
                        <dt className="text-muted-foreground">Support SLAs Ending Soon</dt>
                        <dd className="font-semibold">
                          {projectsQ.data.support.supportEndingSoon}
                        </dd>
                      </div>
                    </dl>
                  </Panel>
                </div>
              </div>
            )}

            {/* SECTION: TRENDS */}
            {section === "trends" && trendsQ.data && (
              <div className="space-y-5">
                <Panel
                  title="Sales & Cash Flow Time Series"
                  sub={`Grouping: ${trendsQ.data.granularity} · Missing periods explicitly zeroed (never interpolated)`}
                >
                  {trendsQ.data.series.length === 0 ? (
                    <EmptyChart text="No trend buckets found for this window." />
                  ) : (
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendsQ.data.series}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                          />
                          <XAxis dataKey="bucket" {...axis} />
                          <YAxis yAxisId="left" {...axis} />
                          <YAxis yAxisId="right" orientation="right" {...axis} />
                          <Tooltip {...tip} />
                          <Legend />
                          <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="leadsReceived"
                            name="Leads Received"
                            stroke={CHART[0]}
                            fill={CHART[0]}
                            fillOpacity={0.2}
                          />
                          <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="callsConnected"
                            name="Connected Calls"
                            stroke={CHART[1]}
                            fill={CHART[1]}
                            fillOpacity={0.2}
                          />
                          <Area
                            yAxisId="right"
                            type="monotone"
                            dataKey="paymentsCollected"
                            name="Cash Collected (INR)"
                            stroke={CHART[2]}
                            fill={CHART[2]}
                            fillOpacity={0.2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Panel>
              </div>
            )}
          </>
        )}
      </PilotShell>
    </TooltipProvider>
  );
}
