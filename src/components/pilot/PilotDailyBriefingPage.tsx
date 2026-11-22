import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FolderKanban,
  IndianRupee,
  Phone,
  RefreshCw,
  Sun,
  Users,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFollowUpsQuery } from "@/lib/api/followupsApi";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import { useDealsQuery } from "@/lib/api/financeApi";
import { useProjectsQuery } from "@/lib/api/projectsApi";
import { formatApiErrorMessage } from "@/lib/api/errors";
import { formatINRCompact } from "@/lib/crm/format";

function getTodayIstLabel(): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

export function PilotDailyBriefingPage() {
  const overdueQuery = useFollowUpsQuery({ bucket: "overdue", limit: 50 });
  const todayQuery = useFollowUpsQuery({ bucket: "today", limit: 50 });
  const leadsQuery = useLeadsListQuery({ lifecycle: "active", limit: 200 });
  const dealsQuery = useDealsQuery({ limit: 100 });
  const projectsQuery = useProjectsQuery({ limit: 50 });

  const overdueFollowUps = useMemo(
    () => overdueQuery.data?.items ?? [],
    [overdueQuery.data?.items],
  );
  const todayFollowUps = useMemo(() => todayQuery.data?.items ?? [], [todayQuery.data?.items]);
  const leads = useMemo(() => leadsQuery.data?.items ?? [], [leadsQuery.data?.items]);
  const deals = useMemo(() => dealsQuery.data?.items ?? [], [dealsQuery.data?.items]);
  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data?.items]);

  const pendingCalls = useMemo(
    () =>
      [...overdueFollowUps, ...todayFollowUps].filter(
        (f) => f.status === "pending" && f.type === "call",
      ),
    [overdueFollowUps, todayFollowUps],
  );

  const leadsNeedingAttention = useMemo(
    () =>
      leads.filter(
        (l) => l.status !== "won" && l.status !== "lost" && l.priority === "hot" && !l.nextFollowUp,
      ),
    [leads],
  );

  const paymentReminders = useMemo(
    () =>
      deals.filter(
        (d) => d.status !== "cancelled" && (d.financialSummary?.outstandingPaise ?? 0) > 0,
      ),
    [deals],
  );

  const activeProjectsWithOpenTasks = useMemo(
    () =>
      projects.filter((p) => !p.archived && p.status !== "completed" && p.status !== "cancelled"),
    [projects],
  );

  const isLoading =
    overdueQuery.isLoading ||
    todayQuery.isLoading ||
    leadsQuery.isLoading ||
    dealsQuery.isLoading ||
    projectsQuery.isLoading;

  const firstError =
    overdueQuery.error ??
    todayQuery.error ??
    leadsQuery.error ??
    dealsQuery.error ??
    projectsQuery.error;

  const todayIstLabel = useMemo(() => getTodayIstLabel(), []);

  return (
    <PilotShell
      title="Daily Briefing"
      subtitle={`${todayIstLabel} (Asia/Kolkata) — Live Owner action queue from MariaDB.`}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-full"
          onClick={() => {
            void overdueQuery.refetch();
            void todayQuery.refetch();
            void leadsQuery.refetch();
            void dealsQuery.refetch();
            void projectsQuery.refetch();
          }}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      }
    >
      {firstError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            Unable to load some briefing records from MariaDB: {formatApiErrorMessage(firstError)}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6" data-testid="pilot-daily-briefing">
          {/* Summary Strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-border/60 bg-card p-3.5">
              <div className="text-[11px] text-muted-foreground">Overdue Follow-ups</div>
              <div
                data-testid="briefing-overdue-count"
                className="mt-1 text-xl font-bold text-rose-600 dark:text-rose-400"
              >
                {overdueFollowUps.length}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-3.5">
              <div className="text-[11px] text-muted-foreground">Today&apos;s Follow-ups</div>
              <div data-testid="briefing-today-count" className="mt-1 text-xl font-bold">
                {todayFollowUps.length}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-3.5">
              <div className="text-[11px] text-muted-foreground">Pending Calls Due</div>
              <div data-testid="briefing-calls-count" className="mt-1 text-xl font-bold">
                {pendingCalls.length}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-3.5">
              <div className="text-[11px] text-muted-foreground">Hot Leads Unscheduled</div>
              <div data-testid="briefing-attention-count" className="mt-1 text-xl font-bold">
                {leadsNeedingAttention.length}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-3.5">
              <div className="text-[11px] text-muted-foreground">Deals With Balance Due</div>
              <div data-testid="briefing-payments-count" className="mt-1 text-xl font-bold">
                {paymentReminders.length}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Overdue Follow-ups */}
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="size-4" />
                  Overdue Follow-ups ({overdueFollowUps.length})
                </h2>
                <Link to="/follow-ups" className="text-xs text-primary hover:underline">
                  Open Follow-ups
                </Link>
              </div>
              {overdueFollowUps.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  No overdue follow-ups.
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {overdueFollowUps.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <Link
                          to="/leads/$id"
                          params={{ id: f.leadId }}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {f.lead?.name ?? f.leadId}
                        </Link>
                        {f.note && <p className="text-[11px] text-muted-foreground">{f.note}</p>}
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-rose-600 dark:text-rose-400">
                        {f.dueIstDate} {f.dueIstTime}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Today's Follow-ups */}
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sun className="size-4 text-amber-500" />
                  Today&apos;s Follow-ups ({todayFollowUps.length})
                </h2>
                <Link to="/follow-ups" className="text-xs text-primary hover:underline">
                  View Schedule
                </Link>
              </div>
              {todayFollowUps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No follow-ups scheduled for today (Asia/Kolkata).
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {todayFollowUps.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <Link
                          to="/leads/$id"
                          params={{ id: f.leadId }}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {f.lead?.name ?? f.leadId}
                        </Link>
                        {f.note && <p className="text-[11px] text-muted-foreground">{f.note}</p>}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        {f.type === "call" && <Phone className="size-3" />}
                        {f.dueIstTime} IST
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Leads Requiring Attention */}
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Users className="size-4 text-primary" />
                  Hot Leads Without Follow-up ({leadsNeedingAttention.length})
                </h2>
                <Link to="/leads" className="text-xs text-primary hover:underline">
                  All Leads
                </Link>
              </div>
              {leadsNeedingAttention.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Every active hot lead has a follow-up scheduled.
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {leadsNeedingAttention.slice(0, 8).map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <Link
                          to="/leads/$id"
                          params={{ id: l.id }}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {l.name}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {l.company ?? l.phone} · Stage: {l.status}
                        </p>
                      </div>
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300">
                        Hot
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Payment Reminders */}
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <IndianRupee className="size-4 text-emerald-600" />
                  Payment Reminders ({paymentReminders.length})
                </h2>
                <Link to="/deals" className="text-xs text-primary hover:underline">
                  Finance Ledger
                </Link>
              </div>
              {paymentReminders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active deals currently have an outstanding balance.
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {paymentReminders.slice(0, 8).map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <div className="font-semibold text-foreground">{d.name}</div>
                        <div className="text-[11px] text-muted-foreground">{d.clientName}</div>
                      </div>
                      <span className="font-mono text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {formatINRCompact((d.financialSummary?.outstandingPaise ?? 0) / 100)} due
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Active Projects */}
          <section className="rounded-lg border border-border/60 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <FolderKanban className="size-4 text-primary" />
                Active Projects ({activeProjectsWithOpenTasks.length})
              </h2>
              <Link to="/projects" className="text-xs text-primary hover:underline">
                Project Desk
              </Link>
            </div>
            {activeProjectsWithOpenTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active projects in MariaDB.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activeProjectsWithOpenTasks.slice(0, 6).map((p) => (
                  <Link
                    key={p.id}
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs hover:bg-muted/40"
                  >
                    <div className="font-semibold text-foreground">{p.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {p.clientName} · {p.stage}
                    </div>
                    {p.progress && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-primary">
                        <CalendarClock className="size-3" />
                        <span>{p.progress.text}</span>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PilotShell>
  );
}
