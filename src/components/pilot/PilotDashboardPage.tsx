import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  Check,
  Flame,
  Hourglass,
  Plus,
  RotateCw,
  Wallet,
  Phone,
  FolderKanban,
  AlertCircle,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import {
  useDashboardOverviewQuery,
  useFinanceAnalyticsQuery,
  useProjectsAnalyticsQuery,
  invalidateAnalytics,
} from "@/lib/api/analyticsApi";
import { formatINR, formatINRCompact, formatPct, relative } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TABS = [
  ["all", "All"],
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["hot", "Hot leads"],
  ["money", "Collections"],
] as const;

const KIND_ICON = {
  overdue: AlarmClock,
  today: CalendarClock,
  hot: Flame,
  money: Wallet,
};

export function PilotDashboardPage(_props: { search?: Record<string, unknown> }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number][0]>("all");

  const dashboardQuery = useDashboardOverviewQuery();
  const financeQuery = useFinanceAnalyticsQuery({ period: "thisYear" });
  const projectsQuery = useProjectsAnalyticsQuery({ period: "thisYear" });

  const isRefreshing =
    dashboardQuery.isFetching || financeQuery.isFetching || projectsQuery.isFetching;

  const handleRefresh = async () => {
    try {
      await invalidateAnalytics(queryClient);
      await Promise.all([
        dashboardQuery.refetch(),
        financeQuery.refetch(),
        projectsQuery.refetch(),
      ]);
      toast.success("Dashboard metrics refreshed from MariaDB");
    } catch {
      toast.error("Failed to refresh metrics");
    }
  };

  const data = dashboardQuery.data;
  const fin = financeQuery.data;
  const prj = projectsQuery.data;

  // Actions bar with Refresh & Exit Pilot
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="rounded-lg gap-1.5"
      >
        <RotateCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </Button>
      <Button size="sm" asChild className="rounded-lg gap-1.5">
        <Link to="/leads" search={{ pilot: 1 }}>
          <Plus className="size-3.5" />
          Manage Leads
        </Link>
      </Button>
    </div>
  );

  return (
    <PilotShell
      title="Command center"
      subtitle={
        data?.todayIstDate
          ? `India Business Time (IST) · ${data.todayIstDate} · MariaDB Reporting Engine`
          : "India Business Time (IST) · MariaDB Reporting Engine"
      }
      actions={actions}
    >
      {dashboardQuery.isError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              Failed to load server dashboard metrics:{" "}
              {dashboardQuery.error instanceof Error
                ? dashboardQuery.error.message
                : "Unknown error"}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void dashboardQuery.refetch()}
            className="h-8"
          >
            Retry
          </Button>
        </div>
      )}

      {dashboardQuery.isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        </div>
      ) : data ? (
        <>
          {/* Welcome Banner */}
          <section className="cc-welcome p-6 sm:p-7 rounded-2xl border bg-card/60 mb-5">
            <div className="relative z-10 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Scale Flow Sales OS 3.0 · Dev Pilot
                </div>
                <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">
                  Your sales,{" "}
                  <span className="editorial font-normal italic text-sidebar-primary">
                    in motion.
                  </span>
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {data.kpis.followUpsTodayCount + data.kpis.followUpsOverdueCount > 0
                    ? `${data.kpis.followUpsTodayCount + data.kpis.followUpsOverdueCount} follow-ups need your attention (${data.kpis.followUpsOverdueCount} overdue). `
                    : "No pending follow-ups are overdue today. "}
                  {formatINRCompact(data.kpis.outstandingValue)} is outstanding across{" "}
                  {data.kpis.dueDealsCount} deal{data.kpis.dueDealsCount === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs">
                  <b className="font-semibold text-destructive">
                    {data.kpis.followUpsOverdueCount}
                  </b>{" "}
                  overdue
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs">
                  <b className="font-semibold text-foreground">{data.kpis.followUpsTodayCount}</b>{" "}
                  due today
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs">
                  <b className="font-semibold text-warning">{data.kpis.hotLeadsCount}</b> hot leads
                </span>
              </div>
            </div>
          </section>

          {/* KPI Cards Grid */}
          <section
            className="grid grid-cols-2 gap-3 lg:grid-cols-6 mb-5"
            aria-label="Performance overview"
          >
            {/* Open Pipeline Value */}
            <Link
              to="/leads"
              search={{ pilot: 1 }}
              className="kpi col-span-2 group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Open pipeline value</span>
                <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">
                {formatINRCompact(data.kpis.openPipelineValue)}
              </div>
              <div className="mt-auto flex items-end justify-between gap-4 pt-3 text-xs text-muted-foreground">
                <span>
                  {data.kpis.activeLeadsCount} active leads ·{" "}
                  {data.kpis.winRate != null ? formatPct(data.kpis.winRate) : "—"} win rate
                </span>
              </div>
            </Link>

            {/* Active Leads */}
            <Link
              to="/leads"
              search={{ pilot: 1 }}
              className="kpi group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Active leads</span>
                <ArrowUpRight className="size-3.5" />
              </div>
              <div className="mt-2 text-[26px] font-semibold leading-tight">
                {data.kpis.activeLeadsCount}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {data.kpis.hotLeadsCount} marked hot
              </div>
            </Link>

            {/* Follow-ups Today */}
            <Link
              to="/follow-ups"
              search={{ pilot: 1 }}
              className="kpi group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Follow-ups today</span>
                <CalendarClock className="size-3.5" />
              </div>
              <div className="mt-2 text-[26px] font-semibold leading-tight">
                {data.kpis.followUpsTodayCount}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {data.next7DaysFollowUps.length} upcoming days tracked
              </div>
            </Link>

            {/* Overdue Follow-ups */}
            <Link
              to="/follow-ups"
              search={{ pilot: 1 }}
              className={cn(
                "kpi group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40",
                data.kpis.followUpsOverdueCount > 0 && "border-destructive/30 bg-destructive/5",
              )}
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Overdue</span>
                <AlarmClock
                  className={cn(
                    "size-3.5",
                    data.kpis.followUpsOverdueCount > 0 && "text-destructive",
                  )}
                />
              </div>
              <div
                className={cn(
                  "mt-2 text-[26px] font-semibold leading-tight",
                  data.kpis.followUpsOverdueCount > 0 && "text-destructive",
                )}
              >
                {data.kpis.followUpsOverdueCount}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground truncate">
                {data.kpis.oldestOverdueDueAt
                  ? `Oldest ${relative(data.kpis.oldestOverdueDueAt)}`
                  : "Nothing slipping"}
              </div>
            </Link>

            {/* Received Cash */}
            <Link
              to="/deals"
              search={{ pilot: 1 }}
              className="kpi col-span-2 lg:col-span-1 group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Received</span>
                <Wallet className="size-3.5" />
              </div>
              <div className="mt-2 text-[26px] font-semibold leading-tight text-success">
                {formatINRCompact(data.kpis.receivedValue)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground truncate">
                <span className="font-medium text-foreground">
                  {formatINRCompact(data.kpis.outstandingValue)}
                </span>{" "}
                outstanding
              </div>
            </Link>
          </section>

          {/* Operations Snapshot (B5A / B5C Project Metrics) */}
          {prj && (
            <section className="mb-5 rounded-xl border bg-card/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-primary" />
                  <span className="text-sm font-semibold">Delivery & Operations Snapshot</span>
                  <span className="text-xs text-muted-foreground">· From active projects</span>
                </div>
                <Link
                  to="/projects"
                  search={{ pilot: 1 }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Project Desk →
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div>
                  <div className="text-xs text-muted-foreground">Active Projects</div>
                  <div className="mt-1 text-lg font-semibold">{prj.projectCounts.active}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Projects Requiring Attention</div>
                  <div
                    className={cn(
                      "mt-1 text-lg font-semibold",
                      (prj.projectCounts.overdue > 0 ||
                        prj.dependencies.projectsWaitingOnClient > 0) &&
                        "text-warning",
                    )}
                  >
                    {prj.projectCounts.overdue + prj.dependencies.projectsWaitingOnClient}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Overdue Tasks</div>
                  <div
                    className={cn(
                      "mt-1 text-lg font-semibold",
                      prj.tasks.overdue > 0 && "text-destructive",
                    )}
                  >
                    {prj.tasks.overdue}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Open Client Dependencies</div>
                  <div className="mt-1 text-lg font-semibold">
                    {prj.dependencies.openClientDependencies}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Open Support Tickets</div>
                  <div
                    className={cn(
                      "mt-1 text-lg font-semibold",
                      prj.support.openTickets > 0 && "text-warning",
                    )}
                  >
                    {prj.support.openTickets}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Action Center & Right Column */}
          <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr] mb-5">
            {/* Left: Action Center */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold">Today's action center</h3>
                  <p className="text-xs text-muted-foreground">
                    Prioritized by urgency — next actionable step on each row
                  </p>
                </div>
                <div
                  className="flex flex-wrap items-center gap-1"
                  role="group"
                  aria-label="Filter actions"
                >
                  {TABS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={activeTab === k}
                      onClick={() => setActiveTab(k)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                        activeTab === k
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {label}
                      <span className="ml-1 opacity-70">({data.actionCenter.counts[k]})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Items List */}
              <ul className="divide-y">
                {(() => {
                  const items =
                    activeTab === "all"
                      ? data.actionCenter.items
                      : data.actionCenter.items.filter((t) => t.kind === activeTab);
                  const shown = items.slice(0, 8);

                  if (!shown.length) {
                    return (
                      <li className="p-8 text-center text-sm text-muted-foreground">
                        <Check className="mx-auto size-6 text-success mb-2" />
                        Clear runway. Nothing in this list needs your immediate attention right now.
                      </li>
                    );
                  }

                  return shown.map((t) => {
                    const Icon = KIND_ICON[t.kind] || CalendarClock;
                    return (
                      <li
                        key={`${t.kind}-${t.key}`}
                        className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/40"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                              t.kind === "overdue" &&
                                "border-destructive/30 bg-destructive/10 text-destructive",
                              t.kind === "today" && "border-primary/30 bg-primary/10 text-primary",
                              t.kind === "hot" && "border-warning/30 bg-warning/10 text-warning",
                              t.kind === "money" && "border-success/30 bg-success/10 text-success",
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            {t.leadId ? (
                              <Link
                                to="/leads"
                                search={{ pilot: 1 }}
                                className="block text-sm font-semibold hover:underline truncate"
                              >
                                {t.title}
                              </Link>
                            ) : (
                              <Link
                                to="/deals"
                                search={{ pilot: 1 }}
                                className="block text-sm font-semibold hover:underline truncate"
                              >
                                {t.title}
                              </Link>
                            )}
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span
                                className={cn(
                                  "shrink-0 font-medium",
                                  t.kind === "overdue" && "text-destructive",
                                )}
                              >
                                {t.when}
                              </span>
                              <span className="truncate">· {t.detail}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {t.phone && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              className="h-8 gap-1 rounded-lg text-xs"
                            >
                              <a href={`tel:${t.phone}`}>
                                <Phone className="size-3" />
                                Call
                              </a>
                            </Button>
                          )}
                          {t.leadId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="h-8 rounded-lg text-xs"
                            >
                              <Link to="/leads" search={{ pilot: 1 }}>
                                View Lead
                              </Link>
                            </Button>
                          )}
                          {t.kind === "money" && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              className="h-8 gap-1 rounded-lg text-xs"
                            >
                              <Link to="/deals" search={{ pilot: 1 }}>
                                Record Payment
                                <ArrowUpRight className="size-3" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  });
                })()}
              </ul>

              {data.actionCenter.items.length > 8 && (
                <div className="border-t px-5 py-3 text-right">
                  <Link
                    to="/follow-ups"
                    search={{ pilot: 1 }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open full agenda in Follow-ups (Pilot) →
                  </Link>
                </div>
              )}
            </div>

            {/* Right: Collections & Pipeline Funnel */}
            <div className="grid content-start gap-5">
              {/* Collections Card */}
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Collections</h3>
                    <p className="text-xs text-muted-foreground">
                      From recorded deals and verified payments
                    </p>
                  </div>
                  <Link
                    to="/deals"
                    search={{ pilot: 1 }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Finance →
                  </Link>
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <span
                    className="text-[30px] font-semibold leading-none"
                    title={formatINR(data.kpis.receivedValue + data.kpis.outstandingValue)}
                  >
                    {formatINRCompact(data.kpis.receivedValue + data.kpis.outstandingValue)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    booked ·{" "}
                    {data.collectionProgress.collectionRate != null
                      ? formatPct(data.collectionProgress.collectionRate)
                      : "0%"}{" "}
                    collected
                  </span>
                </div>

                {/* Progress Bar */}
                <div
                  className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label="Collection progress"
                >
                  <div
                    style={{
                      width: `${Math.min(
                        (data.collectionProgress.received /
                          Math.max(
                            1,
                            data.collectionProgress.received + data.collectionProgress.outstanding,
                          )) *
                          100,
                        100,
                      )}%`,
                    }}
                    className="bg-success transition-all duration-500"
                    title={`Received: ${formatINR(data.collectionProgress.received)}`}
                  />
                  <div
                    style={{
                      width: `${Math.min(
                        (data.collectionProgress.overdue /
                          Math.max(
                            1,
                            data.collectionProgress.received + data.collectionProgress.outstanding,
                          )) *
                          100,
                        100,
                      )}%`,
                    }}
                    className="bg-destructive transition-all duration-500"
                    title={`Overdue: ${formatINR(data.collectionProgress.overdue)}`}
                  />
                </div>

                {/* Breakdown DL */}
                <dl className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-2 rounded-sm bg-success" />
                      Received
                    </dt>
                    <dd className="mt-1 text-[15px] font-semibold">
                      {formatINRCompact(data.collectionProgress.received)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-2 rounded-sm bg-muted-foreground" />
                      Outstanding
                    </dt>
                    <dd className="mt-1 text-[15px] font-semibold">
                      {formatINRCompact(data.collectionProgress.outstanding)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-2 rounded-sm bg-destructive" />
                      Overdue
                    </dt>
                    <dd className="mt-1 text-[15px] font-semibold text-destructive">
                      {formatINRCompact(data.collectionProgress.overdue)}
                    </dd>
                  </div>
                </dl>
                {fin && fin.cancelledDeals.historicalCollectedCash > 0 && (
                  <div className="mt-3 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                    <span>
                      Historical cash on {fin.cancelledDeals.count} cancelled deal
                      {fin.cancelledDeals.count === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatINRCompact(fin.cancelledDeals.historicalCollectedCash)}
                    </span>
                  </div>
                )}
              </div>

              {/* Pipeline Funnel Bottleneck */}
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Pipeline</h3>
                    <p className="text-xs text-muted-foreground">
                      {data.bottleneck.count > 0 ? (
                        <>
                          Most leads waiting in{" "}
                          <b className="font-semibold text-foreground">{data.bottleneck.name}</b>
                        </>
                      ) : (
                        "No open leads"
                      )}
                    </p>
                  </div>
                  <Link
                    to="/leads"
                    search={{ pilot: 1 }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Board →
                  </Link>
                </div>

                <div className="mt-3 space-y-1.5">
                  {(() => {
                    const maxCount = Math.max(1, ...data.stages.map((s) => s.count));
                    return data.stages.map((s) => (
                      <Link
                        key={s.stage}
                        to="/leads"
                        search={{ pilot: 1 }}
                        className="flex items-center justify-between gap-2 rounded-lg p-1.5 text-xs transition-colors hover:bg-secondary/60"
                        title={`${s.name}: ${s.count} leads · ${formatINR(s.value)}`}
                      >
                        <span className="flex items-center gap-2 min-w-28 font-medium">
                          <span className="size-2 rounded-sm bg-primary/60" />
                          {s.name}
                        </span>
                        <div className="flex-1 mx-2 h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            style={{ width: `${(s.count / maxCount) * 100}%` }}
                            className="h-full bg-primary/70 transition-all duration-300"
                          />
                        </div>
                        <span className="text-right">
                          <b className="font-semibold">{s.count}</b>{" "}
                          <span className="text-muted-foreground">{formatINRCompact(s.value)}</span>
                        </span>
                      </Link>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </section>

          {/* Bottom Grid: Priority Prospects & Recent Activities */}
          <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr] mb-5">
            {/* Priority Prospects */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold">Priority prospects</h3>
                  <p className="text-xs text-muted-foreground">Hot and high-score leads first</p>
                </div>
                <Link
                  to="/leads"
                  search={{ pilot: 1 }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  All leads →
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                  <thead>
                    <tr className="border-b bg-secondary/30 text-left text-xs text-muted-foreground">
                      <th className="py-2.5 pl-5 font-medium">Lead</th>
                      <th className="py-2.5 font-medium">Stage</th>
                      <th className="py-2.5 font-medium">Priority</th>
                      <th className="py-2.5 text-right font-medium">Quoted</th>
                      <th className="py-2.5 pl-4 font-medium">Last Contact</th>
                      <th className="py-2.5 pr-5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.priorityProspects.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">
                          No open priority prospects currently found in MariaDB.
                        </td>
                      </tr>
                    ) : (
                      data.priorityProspects.map((l) => (
                        <tr key={l.id} className="transition-colors hover:bg-secondary/40">
                          <td className="py-3 pl-5">
                            <Link
                              to="/leads"
                              search={{ pilot: 1 }}
                              className="block font-medium hover:underline truncate max-w-[180px]"
                            >
                              {l.name}
                            </Link>
                            <span className="text-xs text-muted-foreground truncate block">
                              {l.company ?? l.source}
                            </span>
                          </td>
                          <td className="py-3">
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                              <span className="size-1.5 rounded-full bg-primary" />
                              {l.status}
                            </span>
                          </td>
                          <td className="py-3">
                            <span
                              className={cn(
                                "text-xs font-medium capitalize",
                                l.priority === "hot" && "text-warning font-semibold",
                              )}
                            >
                              {l.priority}
                            </span>
                          </td>
                          <td className="py-3 text-right font-medium">
                            {l.quotedAmount ? formatINRCompact(l.quotedAmount) : "—"}
                          </td>
                          <td className="py-3 pl-4 text-xs text-muted-foreground">
                            {l.lastContactAt ? relative(l.lastContactAt) : "Never"}
                          </td>
                          <td className="py-3 pr-5 text-right">
                            {l.phone ? (
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                className="h-7 text-xs gap-1"
                              >
                                <a href={`tel:${l.phone}`}>
                                  <Phone className="size-3" />
                                  Call
                                </a>
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                                <Link to="/leads" search={{ pilot: 1 }}>
                                  View
                                </Link>
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Activities */}
            <div className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="text-base font-semibold">Recent activity</h3>
                <Hourglass className="size-4 text-muted-foreground" />
              </div>
              <ol className="mt-4 space-y-4">
                {data.recentActivities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No recent activities recorded in MariaDB.
                  </p>
                ) : (
                  data.recentActivities.map((a) => (
                    <li key={a.id} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-foreground truncate">{a.leadName}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {relative(a.occurredAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                        <span className="font-medium text-foreground capitalize">[{a.type}]</span>{" "}
                        {a.text}
                      </p>
                    </li>
                  ))
                )}
              </ol>
            </div>
          </section>
        </>
      ) : null}
    </PilotShell>
  );
}
