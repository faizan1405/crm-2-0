import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CalendarPlus,
  CalendarSync,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  ListTodo,
  PanelRightOpen,
  PhoneCall,
  Plus,
  RefreshCw,
  Sparkles,
  SunMedium,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLeadActivitiesQuery } from "@/lib/api/activitiesApi";
import { useLeadCallsQuery } from "@/lib/api/callsApi";
import { createIdempotencyKey } from "@/lib/api/client";
import { useLeadWhatsAppMessagesQuery } from "@/lib/api/whatsappApi";
import { extractStaleConflict, formatApiErrorMessage, isApiError } from "@/lib/api/errors";
import {
  addIstOneDaySameTimeIso,
  formatIstTimeLabel,
  useCompleteFollowUpMutation,
  useFollowUpsQuery,
  useLeadFollowUpsQuery,
  useRescheduleFollowUpMutation,
} from "@/lib/api/followupsApi";
import { useLeadQuery } from "@/lib/api/leadsApi";
import type { LeadDto } from "@/lib/api/schemas";
import {
  FOLLOWUP_TYPES_API,
  type FollowUpDto,
  type FollowUpTypeApi,
  type FollowUpWithLeadDto,
} from "@/lib/api/schemas";
import { formatDateTime, formatINR } from "@/lib/crm/format";
import { FOLLOWUP_LABEL, STATUS_LABEL } from "@/lib/crm/types";
import { WA_LABEL } from "@/lib/crm/whatsapp";
import { onRovingKeyDown, roving } from "@/lib/a11y/tabKeys";
import { cn } from "@/lib/utils";
import { Empty, PriorityBadge, selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PilotCallDialog, PilotCallLink } from "./PilotCallDialog";
import { type PilotCallLeadRef, usePilotCallLauncher } from "./pilotCallLauncher";
import {
  PilotCancelFollowUpDialog,
  PilotEditFollowUpDialog,
  PilotScheduleFollowUpDialog,
} from "./PilotFollowUpDialogs";
import { PilotShell } from "./PilotShell";
import { PilotWhatsAppButton, PilotWhatsAppDialog } from "./PilotWhatsAppDialog";
import { type PilotWhatsAppLeadRef, usePilotWhatsAppLauncher } from "./pilotWhatsAppLauncher";

type FollowUpTab = "overdue" | "today" | "upcoming" | "done";

const TABS: [FollowUpTab, string][] = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["upcoming", "Upcoming"],
  ["done", "History"],
];

const PAGE_SIZE = 50;

export function PilotFollowUpsPage() {
  const [tab, setTab] = useState<FollowUpTab>("today");
  const [typeFilter, setTypeFilter] = useState<FollowUpTypeApi | "all">("all");
  const [page, setPage] = useState(0);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLeadTarget, setScheduleLeadTarget] = useState<{
    id: string;
    name: string;
    company?: string;
  } | null>(null);
  const [editTarget, setEditTarget] = useState<{
    followUp: FollowUpDto;
    leadName: string;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    followUp: FollowUpDto;
    leadName: string;
  } | null>(null);
  const [inspectLeadId, setInspectLeadId] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlightRef = useRef<Set<string>>(new Set());
  const { target: callTarget, dialLead, openLogOnly, close: closeCall } = usePilotCallLauncher();
  const {
    target: waTarget,
    openComposer: openWhatsAppComposer,
    close: closeWhatsApp,
  } = usePilotWhatsAppLauncher();
  const [actionAlert, setActionAlert] = useState<{
    message: string;
    isStale: boolean;
  } | null>(null);

  const activeListQuery = useFollowUpsQuery({
    bucket: tab,
    type: typeFilter,
    leadLifecycle: "active",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // Always keep unfiltered pending overview fresh so metric tiles & tab counts never drift by active tab/filter.
  const pendingOverviewQuery = useFollowUpsQuery({
    bucket: "pending",
    type: "all",
    leadLifecycle: "active",
    limit: 200,
    offset: 0,
  });

  const rescheduleMutation = useRescheduleFollowUpMutation();
  const completeMutation = useCompleteFollowUpMutation();

  const summary = pendingOverviewQuery.data?.summary ??
    activeListQuery.data?.summary ?? {
      overdue: 0,
      today: 0,
      upcoming: 0,
      done: 0,
      pending: 0,
    };

  const pendingItems = pendingOverviewQuery.data?.items ?? [];
  const hotClientsCount = pendingItems.filter((f) => f.lead.priority === "hot").length;
  const hotClientsTruncated = (pendingOverviewQuery.data?.total ?? 0) > pendingItems.length;

  const items = activeListQuery.data?.items ?? [];
  const total = activeListQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const switchTab = (next: FollowUpTab) => {
    setTab(next);
    setPage(0);
    setActionAlert(null);
  };

  const refetchAll = () => {
    void activeListQuery.refetch();
    void pendingOverviewQuery.refetch();
  };

  const handleQuickTomorrow = async (item: FollowUpDto, leadName: string) => {
    if (inFlightRef.current.has(item.id)) return;
    const nextDue = addIstOneDaySameTimeIso(item.dueAt);
    if (!nextDue) {
      toast.error("Cannot compute next day for invalid date.");
      return;
    }

    inFlightRef.current.add(item.id);
    setBusyId(item.id);
    setActionAlert(null);
    try {
      await rescheduleMutation.mutateAsync({
        id: item.id,
        payload: { version: item.version, dueAt: nextDue },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(`${leadName}: moved to tomorrow, ${formatIstTimeLabel(item.dueAt)}`);
    } catch (err) {
      const stale = extractStaleConflict(err);
      const closed = isApiError(err) && err.code === "followup_already_closed";
      const archived = isApiError(err) && err.code === "lead_archived";
      const msg = stale
        ? `${leadName}'s follow-up changed in another session (v${item.version} vs server v${stale.currentVersion ?? "?"}). Reloaded latest.`
        : formatApiErrorMessage(err, "Could not reschedule follow-up.");
      setActionAlert({ message: msg, isStale: Boolean(stale || closed || archived) });
      toast.error(msg);
      if (stale || closed || archived) {
        refetchAll();
      }
    } finally {
      inFlightRef.current.delete(item.id);
      setBusyId(null);
    }
  };

  const handleComplete = async (item: FollowUpDto, leadName: string) => {
    if (inFlightRef.current.has(item.id)) return;
    inFlightRef.current.add(item.id);
    setBusyId(item.id);
    setActionAlert(null);
    try {
      await completeMutation.mutateAsync({
        id: item.id,
        payload: { version: item.version },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(`${leadName}: follow-up completed`);
    } catch (err) {
      const stale = extractStaleConflict(err);
      const closed = isApiError(err) && err.code === "followup_already_closed";
      const archived = isApiError(err) && err.code === "lead_archived";
      const msg = stale
        ? `${leadName}'s follow-up changed in another session (v${item.version} vs server v${stale.currentVersion ?? "?"}). Reload before acting.`
        : formatApiErrorMessage(err, "Could not complete follow-up.");
      setActionAlert({ message: msg, isStale: Boolean(stale || closed || archived) });
      toast.error(msg);
      if (stale || closed || archived) {
        refetchAll();
      }
    } finally {
      inFlightRef.current.delete(item.id);
      setBusyId(null);
    }
  };

  return (
    <PilotShell
      title="Follow-ups (Server Pilot)"
      subtitle={`${summary.overdue + summary.today} need attention today · India time (IST) · MariaDB-backed schedule & conflict safety`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={activeListQuery.isFetching}
          >
            <RefreshCw className={cn("size-4", activeListQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() => {
              setScheduleLeadTarget(null);
              setScheduleOpen(true);
            }}
          >
            <Plus className="size-4" />
            Schedule
          </Button>
        </div>
      }
    >
      {actionAlert && (
        <div
          role="alert"
          data-testid="pilot-fu-action-alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{actionAlert.message}</span>
          <div className="flex gap-2">
            {actionAlert.isStale && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setActionAlert(null);
                  refetchAll();
                }}
              >
                <RefreshCw className="size-3.5" />
                Reload latest
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setActionAlert(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {activeListQuery.isError && (
        <div
          role="alert"
          data-testid="pilot-fu-load-error"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>
            {formatApiErrorMessage(
              activeListQuery.error,
              "Unable to load follow-ups from MariaDB.",
            )}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={refetchAll}>
            Retry
          </Button>
        </div>
      )}

      <div className="fu-overview mb-6">
        {(
          [
            ["Pending", summary.pending, ListTodo, "upcoming", false],
            ["Overdue", summary.overdue, AlertCircle, "overdue", false],
            ["Left today", summary.today, Clock, "today", false],
            ["Hot clients", hotClientsCount, Flame, "today", hotClientsTruncated],
          ] as const
        ).map(([label, n, Icon, targetTab, plus]) => (
          <button
            type="button"
            key={label}
            onClick={() => switchTab(targetTab)}
            className="fu-metric"
            data-tone={
              label === "Overdue" && n ? "danger" : label === "Hot clients" && n ? "hot" : undefined
            }
          >
            <Icon className="size-4" />
            <span className="num text-2xl font-semibold">
              {n}
              {plus ? "+" : ""}
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Follow-up views"
          onKeyDown={onRovingKeyDown}
          className="fu-tabs"
        >
          {TABS.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              tabIndex={roving(tab === t)}
              onClick={() => switchTab(t)}
              className="fu-tab"
            >
              {label}
              <span
                className={cn(
                  "num fu-count",
                  t === "overdue" && summary.overdue > 0 && "is-danger",
                )}
              >
                {summary[t]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="pilot-fu-filter-type" className="text-xs text-muted-foreground">
            Channel
          </label>
          <select
            id="pilot-fu-filter-type"
            aria-label="Filter follow-ups by channel"
            className={cn(selectCls, "h-9 text-xs")}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as FollowUpTypeApi | "all");
              setPage(0);
            }}
          >
            <option value="all">All channels</option>
            {FOLLOWUP_TYPES_API.map((k) => (
              <option key={k} value={k}>
                {FOLLOWUP_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div key={tab} className="grid content-start gap-3">
          {activeListQuery.isLoading ? (
            <div className="surface grid gap-3 p-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="surface">
              <Empty
                icon={tab === "done" ? <CheckCircle2 /> : <CalendarClock />}
                title={
                  tab === "done"
                    ? "No follow-up history yet"
                    : tab === "overdue"
                      ? "Nothing overdue"
                      : typeFilter !== "all"
                        ? `No ${FOLLOWUP_LABEL[typeFilter].toLowerCase()} follow-ups here`
                        : "Nothing scheduled here"
                }
                hint={
                  tab === "overdue"
                    ? "You're caught up on overdue follow-ups."
                    : "Schedule a server-backed follow-up to track next steps."
                }
                action={
                  tab !== "done" ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setScheduleLeadTarget(null);
                        setScheduleOpen(true);
                      }}
                    >
                      <Plus className="size-4" />
                      Schedule follow-up
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            items.map((item: FollowUpWithLeadDto, i: number) => {
              const bucket = item.bucket ?? (item.status === "pending" ? tab : "done");
              const lead = item.lead;
              const isBusy = busyId === item.id;
              return (
                <article
                  key={item.id}
                  data-testid={`pilot-fu-card-${item.id}`}
                  className="fu-card"
                  data-bucket={bucket}
                  data-priority={lead.priority}
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setInspectLeadId(lead.id)}
                      aria-label={`Inspect ${lead.name}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold hover:underline">
                          {lead.name}
                        </span>
                        <PriorityBadge p={lead.priority} />
                        <span className="stage-chip" data-stage={lead.status}>
                          {STATUS_LABEL[lead.status]}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {lead.company ?? "Independent"} · <span className="num">{lead.phone}</span>{" "}
                        · <span className="num">v{item.version}</span>
                      </div>
                    </button>

                    <div className="fu-when" data-bucket={bucket}>
                      <span className="fu-type">{FOLLOWUP_LABEL[item.type]}</span>
                      <span className="num">
                        {formatDateTime(item.completedAt ?? item.cancelledAt ?? item.dueAt)}
                      </span>
                      {bucket === "overdue" && <span className="fu-flag">Overdue</span>}
                      {item.status === "cancelled" && (
                        <span className="fu-flag is-muted">
                          {item.replacedBy ? "Replaced" : "Cancelled"}
                        </span>
                      )}
                      {item.status === "completed" && <span className="fu-flag is-done">Done</span>}
                    </div>
                  </div>

                  {item.note && (
                    <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                      {item.note}
                    </p>
                  )}

                  {item.status === "cancelled" && item.cancelReason && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Reason: {item.cancelReason}
                    </p>
                  )}

                  {item.status === "pending" ? (
                    <div className="fu-actions">
                      <PilotCallLink
                        lead={lead}
                        dialSource="Follow-ups"
                        onDialStarted={(l, src) => dialLead(l, src)}
                        disabled={isBusy}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={isBusy}
                        onClick={() => openLogOnly(lead, "Follow-ups")}
                      >
                        <PhoneCall className="size-3.5" />
                        Log call
                      </Button>
                      <PilotWhatsAppButton
                        lead={lead}
                        composerSource="Follow-ups"
                        onOpenComposer={openWhatsAppComposer}
                        disabled={isBusy}
                        className="border-0 bg-transparent shadow-none hover:bg-accent"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={isBusy}
                        onClick={() => setEditTarget({ followUp: item, leadName: lead.name })}
                      >
                        <CalendarSync className="size-3.5" />
                        Edit / Reschedule
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={isBusy}
                        onClick={() => void handleQuickTomorrow(item, lead.name)}
                      >
                        <SunMedium className="size-3.5" />
                        Tomorrow {formatIstTimeLabel(item.dueAt)}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full text-muted-foreground hover:text-destructive"
                        disabled={isBusy}
                        onClick={() => setCancelTarget({ followUp: item, leadName: lead.name })}
                      >
                        <XCircle className="size-3.5" />
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        onClick={() => setInspectLeadId(lead.id)}
                      >
                        <PanelRightOpen className="size-3.5" />
                        View
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="ml-auto rounded-full"
                        disabled={isBusy}
                        onClick={() => void handleComplete(item, lead.name)}
                      >
                        <Check className="size-3.5" />
                        Complete
                      </Button>
                    </div>
                  ) : (
                    <div className="fu-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        onClick={() => setInspectLeadId(lead.id)}
                      >
                        <PanelRightOpen className="size-3.5" />
                        Inspect lead
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto rounded-full"
                        asChild
                      >
                        <Link to="/leads/$id" params={{ id: lead.id }} search={{ pilot: 1 }}>
                          Open lead
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </Button>
                    </div>
                  )}
                </article>
              );
            })
          )}

          {total > PAGE_SIZE && (
            <div className="ba-pager mt-2">
              <span className="num text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Previous page"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="num text-xs">
                  Page {page + 1} / {pages}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Next page"
                  disabled={page >= pages - 1}
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </span>
            </div>
          )}
        </div>

        <aside className="fu-side surface grid h-fit gap-4 p-5">
          <div>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              Pilot scope & honesty rules
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Follow-ups in Pilot Mode persist directly to MariaDB with Asia/Kolkata (IST) dates and
              one-active-follow-up enforcement.
            </p>
          </div>
          <ul className="grid gap-2 text-xs text-muted-foreground">
            <li className="rounded-lg border bg-card p-3">
              <b className="text-foreground">Last contact preserved:</b> Completing a follow-up or
              confirming an outgoing WhatsApp message does not fabricate two-way Last contact; only
              connected call logs update Last contact.
            </li>
            <li className="rounded-lg border bg-card p-3">
              <b className="text-foreground">Smart suggestions & custom libraries:</b> AI follow-up
              prompts, custom Sales Studio template libraries, and automations remain local until
              B4–B5.
            </li>
          </ul>
          <Button type="button" variant="outline" size="sm" asChild className="w-full">
            <Link to="/leads" search={{ pilot: 1 }}>
              Manage server leads
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </aside>
      </div>

      <PilotScheduleFollowUpDialog
        open={scheduleOpen}
        onOpenChange={(o) => {
          setScheduleOpen(o);
          if (!o) setScheduleLeadTarget(null);
        }}
        leadId={scheduleLeadTarget?.id}
        leadName={scheduleLeadTarget?.name}
        leadCompany={scheduleLeadTarget?.company}
      />

      <PilotEditFollowUpDialog
        followUp={editTarget?.followUp ?? null}
        leadName={editTarget?.leadName}
        onOpenChange={(o) => !o && setEditTarget(null)}
      />

      <PilotCancelFollowUpDialog
        followUp={cancelTarget?.followUp ?? null}
        leadName={cancelTarget?.leadName}
        onOpenChange={(o) => !o && setCancelTarget(null)}
      />

      <PilotFollowUpLeadInspector
        leadId={inspectLeadId}
        onClose={() => setInspectLeadId(null)}
        onDial={(l) => {
          setInspectLeadId(null);
          dialLead(l, "Follow-ups inspector");
        }}
        onLogCall={(l) => {
          setInspectLeadId(null);
          openLogOnly(l, "Follow-ups inspector");
        }}
        onOpenWhatsApp={(l) => {
          setInspectLeadId(null);
          openWhatsAppComposer(l, "Follow-ups inspector");
        }}
        onSchedule={(l) => {
          setInspectLeadId(null);
          setScheduleLeadTarget(l);
          setScheduleOpen(true);
        }}
        onEdit={(fu, lName) => {
          setInspectLeadId(null);
          setEditTarget({ followUp: fu, leadName: lName });
        }}
        onCancel={(fu, lName) => {
          setInspectLeadId(null);
          setCancelTarget({ followUp: fu, leadName: lName });
        }}
        onComplete={(fu, lName) => void handleComplete(fu, lName)}
      />

      <PilotCallDialog target={callTarget} onClose={closeCall} />
      <PilotWhatsAppDialog target={waTarget} onClose={closeWhatsApp} />
    </PilotShell>
  );
}

function PilotFollowUpLeadInspector({
  leadId,
  onClose,
  onDial,
  onLogCall,
  onOpenWhatsApp,
  onSchedule,
  onEdit,
  onCancel,
  onComplete,
}: {
  leadId: string | null;
  onClose: () => void;
  onDial: (lead: LeadDto | PilotCallLeadRef, dialSource: string) => void;
  onLogCall: (lead: LeadDto | PilotCallLeadRef) => void;
  onOpenWhatsApp: (lead: LeadDto | PilotWhatsAppLeadRef, composerSource: string) => void;
  onSchedule: (lead: { id: string; name: string; company?: string }) => void;
  onEdit: (followUp: FollowUpDto, leadName: string) => void;
  onCancel: (followUp: FollowUpDto, leadName: string) => void;
  onComplete: (followUp: FollowUpDto, leadName: string) => void;
}) {
  const leadQuery = useLeadQuery(leadId ?? undefined);
  const callsQuery = useLeadCallsQuery(leadId ?? "", { limit: 3 }, Boolean(leadId));
  const waMessagesQuery = useLeadWhatsAppMessagesQuery(leadId ?? "", { limit: 3 }, Boolean(leadId));
  const leadFollowUpsQuery = useLeadFollowUpsQuery(leadId ?? undefined, Boolean(leadId));
  const activitiesQuery = useLeadActivitiesQuery(leadId ?? "", { limit: 5 }, Boolean(leadId));

  const lead = leadQuery.data;
  const activeFollowUp =
    leadFollowUpsQuery.data?.items.find(
      (f) => f.id === leadFollowUpsQuery.data?.activeFollowUpId,
    ) ?? null;
  const recentActs = activitiesQuery.data?.items ?? [];

  return (
    <Sheet open={Boolean(leadId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="fu-inspector w-full overflow-y-auto sm:max-w-md">
        {leadQuery.isLoading ? (
          <div className="grid gap-3 p-6">
            <div className="h-8 w-44 animate-pulse rounded bg-muted" />
            <div className="h-32 animate-pulse rounded bg-muted" />
          </div>
        ) : leadQuery.isError ? (
          <div className="grid gap-3 p-6">
            <SheetHeader className="text-left">
              <SheetTitle>Unable to load lead</SheetTitle>
              <SheetDescription>
                {formatApiErrorMessage(leadQuery.error, "Server error loading client details.")}
              </SheetDescription>
            </SheetHeader>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void leadQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : lead ? (
          <>
            <SheetHeader className="text-left">
              <span className="eyebrow">Client (MariaDB)</span>
              <SheetTitle className="editorial text-3xl">{lead.name}</SheetTitle>
              <SheetDescription>
                {lead.company ?? "Independent"} · <span className="num">{lead.phone}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-2 flex flex-wrap gap-1.5 px-4">
              <span className="stage-chip" data-stage={lead.status}>
                {STATUS_LABEL[lead.status]}
              </span>
              <PriorityBadge p={lead.priority} />
              <span className="aging">{lead.source}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 px-4">
              <PilotCallLink lead={lead} dialSource="Follow-ups inspector" onDialStarted={onDial} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={lead.lifecycleStatus !== "active"}
                className="rounded-full"
                onClick={() => onLogCall(lead)}
              >
                <PhoneCall className="size-3.5" />
                Log call
              </Button>
              <PilotWhatsAppButton
                lead={lead}
                composerSource="Follow-ups inspector"
                onOpenComposer={onOpenWhatsApp}
              />
            </div>

            <dl className="fu-facts mx-4 mt-5">
              <div>
                <dt>Requirement</dt>
                <dd>{lead.requirement ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>{lead.quotedAmount !== undefined ? "Quoted" : "Budget"}</dt>
                <dd className="num">{formatINR(lead.quotedAmount ?? lead.budget)}</dd>
              </div>
              <div>
                <dt>Last contact</dt>
                <dd className="num">
                  {lead.lastContact ? formatDateTime(lead.lastContact) : "Never"}
                </dd>
              </div>
            </dl>

            <section className="mx-4 mt-5">
              <h3 className="eyebrow mb-2">Active follow-up</h3>
              {activeFollowUp ? (
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-semibold">
                    {FOLLOWUP_LABEL[activeFollowUp.type]} ·{" "}
                    <span className="num">{formatDateTime(activeFollowUp.dueAt)}</span>
                  </div>
                  {activeFollowUp.note && (
                    <p className="mt-1 text-xs text-muted-foreground">{activeFollowUp.note}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(activeFollowUp, lead.name)}
                    >
                      <CalendarSync className="size-3.5" />
                      Edit / Reschedule
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => onCancel(activeFollowUp, lead.name)}
                    >
                      <XCircle className="size-3.5" />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto"
                      onClick={() => {
                        onComplete(activeFollowUp, lead.name);
                        onClose();
                      }}
                    >
                      <Check className="size-3.5" />
                      Complete
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <span className="text-xs text-muted-foreground">
                    No active follow-up planned.
                  </span>
                  {lead.lifecycleStatus === "active" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onSchedule({
                          id: lead.id,
                          name: lead.name,
                          ...(lead.company ? { company: lead.company } : {}),
                        })
                      }
                    >
                      <CalendarPlus className="size-3.5" />
                      Schedule
                    </Button>
                  )}
                </div>
              )}
            </section>

            {lead.notes && (
              <section className="mx-4 mt-5">
                <h3 className="eyebrow mb-2">Notes</h3>
                <p className="text-sm leading-relaxed whitespace-pre-line">{lead.notes}</p>
              </section>
            )}

            <section className="mx-4 mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="eyebrow">Recent calls (MariaDB)</h3>
                <span className="num text-[11px] text-muted-foreground">
                  {callsQuery.data?.summary.total ?? 0} total ·{" "}
                  {callsQuery.data?.summary.connected ?? 0} connected
                </span>
              </div>
              {(callsQuery.data?.items ?? []).length > 0 ? (
                <ul className="grid gap-1.5 text-xs">
                  {(callsQuery.data?.items ?? []).map((c) => (
                    <li key={c.id} className="rounded-md border bg-card p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {c.outcome}{" "}
                          <span className="font-normal text-muted-foreground">
                            ({c.connected ? "Connected" : "Attempt"})
                          </span>
                        </span>
                        <span className="num text-[11px] text-muted-foreground">
                          {formatDateTime(c.at)}
                        </span>
                      </div>
                      {c.notes && (
                        <p className="mt-1 line-clamp-2 text-muted-foreground">{c.notes}</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No calls logged yet.</p>
              )}
            </section>

            <section className="mx-4 mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="eyebrow">Recent WhatsApp (MariaDB)</h3>
                <span className="num text-[11px] text-muted-foreground">
                  {waMessagesQuery.data?.total ?? 0} confirmed
                </span>
              </div>
              {(waMessagesQuery.data?.items ?? []).length > 0 ? (
                <ul className="grid gap-1.5 text-xs">
                  {(waMessagesQuery.data?.items ?? []).map((m) => (
                    <li key={m.id} className="rounded-md border bg-card p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {WA_LABEL[m.purpose]}{" "}
                          <span className="font-normal text-muted-foreground">
                            (Owner-confirmed sent)
                          </span>
                        </span>
                        <span className="num text-[11px] text-muted-foreground">
                          {formatDateTime(m.confirmedAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{m.messageText}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No confirmed WhatsApp messages logged yet.
                </p>
              )}
            </section>

            <section className="mx-4 mt-5">
              <h3 className="eyebrow mb-2">Recent activity (MariaDB)</h3>
              {recentActs.length > 0 ? (
                <ol className="grid gap-2">
                  {recentActs.map((a) => (
                    <li key={a.id} className="border-l-2 pl-3 text-xs">
                      <div className="text-foreground">
                        <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase">
                          {a.type}
                        </span>
                        {a.text}
                      </div>
                      <div className="num text-muted-foreground">{formatDateTime(a.at)}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">No server activity yet.</p>
              )}
            </section>

            <div className="m-4 mt-6">
              <Button asChild variant="outline" className="w-full">
                <Link to="/leads/$id" params={{ id: lead.id }} search={{ pilot: 1 }}>
                  Open full record
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
