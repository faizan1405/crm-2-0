import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Archive,
  ArrowUpRight,
  Ban,
  Bookmark,
  CalendarPlus,
  CalendarSync,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Layers,
  LayoutGrid,
  List,
  MessageCircle,
  Phone,
  PhoneCall,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useCreateActivityMutation, useLeadActivitiesQuery } from "@/lib/api/activitiesApi";
import { createIdempotencyKey } from "@/lib/api/client";
import { extractStaleConflict, formatApiErrorMessage, isApiError } from "@/lib/api/errors";
import { useCompleteFollowUpMutation, useLeadFollowUpsQuery } from "@/lib/api/followupsApi";
import {
  useArchiveLeadMutation,
  useLeadsListQuery,
  useUpdateLeadMutation,
  type LeadFollowUpFilter,
  type LeadSortOption,
} from "@/lib/api/leadsApi";
import {
  MANUAL_ACTIVITY_TYPES_API,
  type FollowUpDto,
  type LeadDto,
  type LeadPriorityApi,
  type LeadSourceApi,
  type LeadStatusApi,
  type ManualActivityTypeApi,
  type QuickStatusApi,
} from "@/lib/api/schemas";
import { QUICK_LABEL, QUICK_STATUSES, staleDays } from "@/lib/crm/leadtools";
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  relative,
} from "@/lib/crm/format";
import type { LeadsSearch } from "@/lib/crm/leadsSearch";
import { FOLLOWUP_LABEL, LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { Empty, Identity, PriorityBadge, selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PilotAddLeadDialog } from "./PilotAddLeadDialog";
import { PilotArchiveDialog, PilotLostReasonDialog } from "./PilotDialogs";
import {
  PilotCancelFollowUpDialog,
  PilotEditFollowUpDialog,
  PilotScheduleFollowUpDialog,
} from "./PilotFollowUpDialogs";
import { PilotShell } from "./PilotShell";

const PAGE_SIZE = 50;

const ACTIVITY_TYPE_LABEL: Record<ManualActivityTypeApi, string> = {
  note: "Note",
  meeting: "Meeting",
  email: "Email",
};

export function PilotLeadsPage({ search }: { search: LeadsSearch }) {
  const navigate = useNavigate();

  const [qInput, setQInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatusApi>("all");
  const [source, setSource] = useState<"all" | LeadSourceApi>(
    search.src && (LEAD_SOURCES as readonly string[]).includes(search.src)
      ? (search.src as LeadSourceApi)
      : "all",
  );
  const [priority, setPriority] = useState<"all" | LeadPriorityApi>("all");
  const [quickStatus, setQuickStatus] = useState<"all" | "none" | QuickStatusApi>("all");
  const [followUp, setFollowUp] = useState<LeadFollowUpFilter>("all");
  const [sort, setSort] = useState<LeadSortOption>("recent");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"workspace" | "table" | "cards">("workspace");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<LeadDto | null>(null);

  const [lostTarget, setLostTarget] = useState<LeadDto | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{
    lead: LeadDto;
    kind: "waste" | "deleted";
  } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [actionAlert, setActionAlert] = useState<{
    message: string;
    isStale: boolean;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(qInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, status, source, priority, quickStatus, followUp, sort, search.from, search.to]);

  const filters = {
    ...(debouncedQ ? { q: debouncedQ } : {}),
    lifecycle: "active" as const,
    status,
    source,
    priority,
    quickStatus,
    followUp,
    ...(search.from ? { createdFrom: search.from } : {}),
    ...(search.to ? { createdTo: search.to } : {}),
    sort,
    pinnedFirst: true,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const leadsQuery = useLeadsListQuery(filters);
  const binWasteQuery = useLeadsListQuery({ lifecycle: "waste", limit: 1, offset: 0 });
  const binDeletedQuery = useLeadsListQuery({ lifecycle: "deleted", limit: 1, offset: 0 });
  const updateMutation = useUpdateLeadMutation();
  const archiveMutation = useArchiveLeadMutation();

  const rows = leadsQuery.data?.items ?? [];
  const total = leadsQuery.data?.total ?? 0;
  const stageCounts = leadsQuery.data?.stageCounts ?? { all: total };
  const binTotal = (binWasteQuery.data?.total ?? 0) + (binDeletedQuery.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (leadsQuery.isSuccess && page >= pages) {
      setPage(Math.max(0, pages - 1));
    }
  }, [leadsQuery.isSuccess, page, pages]);
  const selectedLead = rows.find((l) => l.id === selectedId) ?? rows[0] ?? null;

  const now = new Date();

  const clearFilters = () => {
    setQInput("");
    setDebouncedQ("");
    setStatus("all");
    setSource("all");
    setPriority("all");
    setQuickStatus("all");
    setFollowUp("all");
    setSort("recent");
    setPage(0);
  };

  const handleRowPick = (id: string) => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      void navigate({ to: "/leads/$id", params: { id }, search: { pilot: 1 } });
      return;
    }
    setSelectedId(id);
  };

  const runLeadPatch = async (
    lead: LeadDto,
    patch: Record<string, unknown>,
    successMsg: string,
  ): Promise<boolean> => {
    setActionAlert(null);
    try {
      await updateMutation.mutateAsync({
        id: lead.id,
        payload: {
          version: lead.version,
          ...patch,
        },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(successMsg);
      return true;
    } catch (err) {
      const stale = extractStaleConflict(err);
      const isArchived = isApiError(err) && err.code === "lead_archived";
      const msg = stale
        ? `${lead.name} changed in another session (server v${stale.currentVersion ?? "?"}, your screen had v${lead.version}). Reload latest before retrying.`
        : formatApiErrorMessage(err);
      setActionAlert({ message: msg, isStale: Boolean(stale || isArchived) });
      toast.error(msg);
      return false;
    }
  };

  const handleStageSelect = (lead: LeadDto, nextStatus: LeadStatusApi) => {
    if (nextStatus === lead.status) return;
    if (nextStatus === "lost") {
      setLostError(null);
      setLostTarget(lead);
      return;
    }
    void runLeadPatch(
      lead,
      { status: nextStatus },
      `Moved ${lead.name} to ${STATUS_LABEL[nextStatus]}`,
    );
  };

  const handleConfirmLost = async (reason: string) => {
    if (!lostTarget) return;
    setLostError(null);
    setActionAlert(null);
    try {
      await updateMutation.mutateAsync({
        id: lostTarget.id,
        payload: {
          version: lostTarget.version,
          status: "lost",
          lostReason: reason,
        },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(`${lostTarget.name} marked as Lost`);
      setLostTarget(null);
    } catch (err) {
      const msg = formatApiErrorMessage(err);
      setLostError(msg);
      const stale = extractStaleConflict(err);
      if (stale) {
        setActionAlert({ message: msg, isStale: true });
      }
    }
  };

  const handleConfirmArchive = async (reason?: string) => {
    if (!archiveTarget) return;
    setArchiveError(null);
    setActionAlert(null);
    const { lead, kind } = archiveTarget;
    try {
      await archiveMutation.mutateAsync({
        id: lead.id,
        payload: {
          kind,
          version: lead.version,
          ...(reason ? { reason } : {}),
        },
      });
      toast.success(
        kind === "waste" ? `${lead.name} moved to Waste` : `${lead.name} moved to Recently Deleted`,
      );
      if (selectedId === lead.id) {
        setSelectedId(null);
      }
      setArchiveTarget(null);
    } catch (err) {
      const msg = formatApiErrorMessage(err);
      setArchiveError(msg);
      const stale = extractStaleConflict(err);
      if (stale) {
        setActionAlert({ message: msg, isStale: true });
      }
    }
  };

  const quickSel = (lead: LeadDto) => (
    <select
      aria-label={`Quick status for ${lead.name}`}
      className={cn(selectCls, "h-8 text-xs")}
      value={lead.quickStatus ?? ""}
      disabled={updateMutation.isPending}
      onChange={(e) => {
        const nextVal = (e.target.value || null) as QuickStatusApi | null;
        void runLeadPatch(
          lead,
          { quickStatus: nextVal },
          nextVal ? `Quick status: ${QUICK_LABEL[nextVal]}` : "Quick status cleared",
        );
      }}
    >
      <option value="">Quick status…</option>
      {QUICK_STATUSES.map((qs) => (
        <option key={qs} value={qs}>
          {QUICK_LABEL[qs]}
        </option>
      ))}
    </select>
  );

  return (
    <PilotShell
      title="Prospects (Server Pilot)"
      subtitle={`${rows.length} shown of ${total} server leads · MariaDB-backed create, edit, stage, activities, waste & restore`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild className="rounded-full">
            <Link to="/leads/bin" search={{ pilot: 1 }}>
              <Archive className="size-4" />
              Waste & deleted
              {binTotal > 0 ? (
                <span className="num ml-1 text-xs text-muted-foreground">{binTotal}</span>
              ) : null}
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled
            title="Bulk import is disabled in B2B1 Pilot"
            className="rounded-full opacity-60"
          >
            <Layers className="size-4" />
            Bulk add (Pilot off)
          </Button>
          <Button type="button" onClick={() => setAddOpen(true)} className="rounded-full">
            <Plus className="size-4" />
            Add lead
          </Button>
        </div>
      }
    >
      {(search.from || search.to || search.src) && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs"
        >
          <span>
            Created{" "}
            {search.from
              ? formatDate(search.from, { day: "numeric", month: "short", year: "numeric" })
              : "…"}{" "}
            –{" "}
            {search.to
              ? formatDate(search.to, { day: "numeric", month: "short", year: "numeric" })
              : "…"}
            {search.src ? ` · source ${search.src}` : ""} (IST)
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-full"
            onClick={() => void navigate({ to: "/leads", search: { pilot: 1 } })}
          >
            Clear date filter
          </Button>
        </div>
      )}

      {leadsQuery.isError && (
        <div
          role="alert"
          data-testid="pilot-leads-load-error"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>
            {formatApiErrorMessage(leadsQuery.error, "Unable to load leads from server.")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void leadsQuery.refetch()}
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {actionAlert && (
        <div
          role="alert"
          data-testid="pilot-leads-action-error"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
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
                  void leadsQuery.refetch();
                }}
              >
                <RefreshCw className="size-3.5" />
                Refresh latest
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setActionAlert(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-foreground pt-4">
        <div className="flex max-w-full gap-4 overflow-x-auto scrollbar-thin">
          {(["all", ...LEAD_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              data-stage={s}
              className={cn(
                "flex shrink-0 items-baseline gap-1.5 border-b-2 pb-1.5 text-sm transition-colors",
                status === s
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "Everyone" : STATUS_LABEL[s]}
              <span className="num text-[11px] opacity-70">{stageCounts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="View">
          {(
            [
              ["workspace", Columns2, "Workspace"],
              ["table", List, "Ledger"],
              ["cards", LayoutGrid, "Tiles"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              aria-label={`${v} view`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sv-bar" role="status" aria-label="Saved views status">
        <Bookmark className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">
          Saved views, tag filters, assignee filters & bulk actions are disabled in B2B1 Pilot and
          remain untouched in local storage.
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search leads"
            className="rounded-full pl-9"
            placeholder="Search name, company, phone or email"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <select
          aria-label="Source filter"
          className={selectCls}
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          <option value="all">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority filter"
          className={selectCls}
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        >
          <option value="all">All priorities</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        <select
          aria-label="Quick status filter"
          className={selectCls}
          value={quickStatus}
          onChange={(e) => setQuickStatus(e.target.value as typeof quickStatus)}
        >
          <option value="all">Any quick status</option>
          <option value="none">No quick status</option>
          {QUICK_STATUSES.map((qs) => (
            <option key={qs} value={qs}>
              {QUICK_LABEL[qs]}
            </option>
          ))}
        </select>
        <select
          aria-label="Follow-up due filter"
          className={selectCls}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value as LeadFollowUpFilter)}
        >
          <option value="all">Any follow-up</option>
          <option value="overdue">Follow-up overdue</option>
          <option value="today">Follow-up today</option>
          <option value="week">Due next 7 days</option>
          <option value="none">No follow-up</option>
        </select>
        <select
          aria-label="Sort"
          className={selectCls}
          value={sort}
          onChange={(e) => setSort(e.target.value as LeadSortOption)}
        >
          <option value="recent">Newest</option>
          <option value="updated">Recently updated</option>
          <option value="score">Highest score</option>
          <option value="value">Highest value</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {leadsQuery.isLoading ? (
        <div className="panel grid gap-3 p-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <Empty
            icon={<Users />}
            title="No server leads match"
            hint="Try clearing filters or add a synthetic lead to MariaDB."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
                <Button type="button" onClick={() => setAddOpen(true)}>
                  Add lead
                </Button>
              </div>
            }
          />
        </div>
      ) : view === "workspace" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,0.9fr)_1.4fr]">
          <div
            role="listbox"
            aria-label="Server lead directory"
            className="max-h-[calc(100vh-180px)] overflow-y-auto border-t border-foreground scrollbar-thin lg:sticky lg:top-32"
          >
            {rows.map((l) => {
              const st = staleDays(l as never, now);
              return (
                <div
                  key={l.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={selectedLead?.id === l.id}
                  data-priority={l.priority}
                  onClick={() => handleRowPick(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowPick(l.id);
                    }
                  }}
                  className="prospect-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="prio-dot shrink-0" />
                      <span className="truncate text-sm font-semibold">{l.name}</span>
                      {l.pinned && <Pin className="size-3 shrink-0" aria-label="Pinned" />}
                      {st !== undefined && (
                        <span className="aging is-old shrink-0">stale {st}d</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 truncate pl-4 text-xs text-muted-foreground">
                      <span className="stage-chip shrink-0" data-stage={l.status}>
                        {STATUS_LABEL[l.status]}
                      </span>
                      <span className="truncate">
                        {l.company ?? l.source} ·{" "}
                        {l.lastContact ? `spoke ${relative(l.lastContact)}` : "not contacted"}
                      </span>
                      <span className="num text-[10px] opacity-70">v{l.version}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-sm">
                      {formatINRCompact(l.quotedAmount ?? l.budget ?? 0)}
                    </div>
                    <div className="eyebrow mt-0.5 whitespace-nowrap">{l.source}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {selectedLead && (
            <PilotLeadInspector
              key={selectedLead.id}
              lead={selectedLead}
              mutating={updateMutation.isPending}
              onPin={() =>
                void runLeadPatch(
                  selectedLead,
                  { pinned: !selectedLead.pinned },
                  selectedLead.pinned ? "Unpinned lead" : "Pinned lead",
                )
              }
              onPriority={(p) =>
                void runLeadPatch(selectedLead, { priority: p }, `Priority set to ${p}`)
              }
              onStage={(s) => handleStageSelect(selectedLead, s)}
              quickSel={quickSel(selectedLead)}
              onRemove={(kind) => {
                setArchiveError(null);
                setArchiveTarget({ lead: selectedLead, kind });
              }}
            />
          )}
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => {
            const st = staleDays(l as never, now);
            return (
              <article
                key={l.id}
                data-priority={l.priority}
                className={cn("prospect-tile", l.pinned && "is-pinned")}
              >
                <span className="tile-score num" aria-hidden>
                  {l.aiScore ?? ""}
                </span>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="prio-dot" />
                    <span className="eyebrow">
                      {l.priority} · {l.source}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={l.pinned ? "Unpin" : "Pin"}
                    onClick={() =>
                      void runLeadPatch(
                        l,
                        { pinned: !l.pinned },
                        l.pinned ? "Unpinned lead" : "Pinned lead",
                      )
                    }
                    className="size-8 rounded-full"
                  >
                    <Pin className={cn("size-4", !l.pinned && "opacity-40")} />
                  </Button>
                </div>
                <Link to="/leads/$id" params={{ id: l.id }} search={{ pilot: 1 }}>
                  <h3 className="editorial text-[30px]">{l.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l.company ?? "Independent"} · <span className="num">{l.phone}</span>
                  </p>
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="stage-chip" data-stage={l.status}>
                    {STATUS_LABEL[l.status]}
                  </span>
                  {l.quickStatus && <span className="aging">{QUICK_LABEL[l.quickStatus]}</span>}
                  {st !== undefined && (
                    <span className="aging is-old">
                      <Clock className="mr-1 inline size-3" />
                      stale {st}d
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-3 border-t pt-3 text-xs">
                  <div>
                    <dt className="eyebrow">
                      {l.quotedAmount !== undefined ? "Quoted" : "Budget"}
                    </dt>
                    <dd className="num mt-1 text-sm">
                      {formatINRCompact(l.quotedAmount ?? l.budget ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Next</dt>
                    <dd className="mt-1">
                      {l.nextFollowUp ? formatDateTime(l.nextFollowUp) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Updated</dt>
                    <dd className="mt-1">{relative(l.updatedAt)}</dd>
                  </div>
                </dl>
                <div>{quickSel(l)}</div>
                <div className="mt-auto flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-full"
                    aria-label={`Schedule follow-up for ${l.name}`}
                    title="Schedule follow-up"
                    onClick={() => setFollowUpTarget(l)}
                  >
                    <CalendarPlus className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-full"
                    aria-label="Move to Waste"
                    title="Move to Waste"
                    onClick={() => {
                      setArchiveError(null);
                      setArchiveTarget({ lead: l, kind: "waste" });
                    }}
                  >
                    <Ban className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-full"
                    aria-label="Delete lead"
                    onClick={() => {
                      setArchiveError(null);
                      setArchiveTarget({ lead: l, kind: "deleted" });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    asChild
                    className="ml-auto rounded-full"
                  >
                    <Link to="/leads/$id" params={{ id: l.id }} search={{ pilot: 1 }}>
                      View
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div
          role="region"
          aria-label="Lead directory ledger"
          tabIndex={0}
          className="overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <table className="w-full min-w-[1040px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-left text-muted-foreground">
              <tr>
                {[
                  "",
                  "Lead",
                  "Phone",
                  "Source",
                  "Priority",
                  "Score",
                  "Quoted",
                  "Stage",
                  "Quick status",
                  "Updated",
                  "",
                ].map((h, i) => (
                  <th key={i} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b hover:bg-card">
                  <td className="pl-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={l.pinned ? "Unpin" : "Pin"}
                      onClick={() =>
                        void runLeadPatch(
                          l,
                          { pinned: !l.pinned },
                          l.pinned ? "Unpinned lead" : "Pinned lead",
                        )
                      }
                      className={cn("rounded-full", !l.pinned && "opacity-30 hover:opacity-80")}
                    >
                      <Pin className="size-3.5" />
                    </Button>
                  </td>
                  <td className="min-w-52 px-3">
                    <Link
                      to="/leads/$id"
                      params={{ id: l.id }}
                      search={{ pilot: 1 }}
                      className="hover:underline"
                    >
                      <Identity name={l.name} company={l.company} />
                    </Link>
                  </td>
                  <td className="num px-3 text-muted-foreground">{l.phone}</td>
                  <td className="px-3">{l.source}</td>
                  <td className="px-3">
                    <PriorityBadge p={l.priority} />
                  </td>
                  <td className="num px-3">{l.aiScore ?? "—"}</td>
                  <td className="num px-3">{formatINR(l.quotedAmount)}</td>
                  <td className="px-3">
                    <select
                      aria-label={`Stage for ${l.name}`}
                      className={cn(selectCls, "h-8")}
                      value={l.status}
                      disabled={updateMutation.isPending}
                      onChange={(e) => handleStageSelect(l, e.target.value as LeadStatusApi)}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3">{quickSel(l)}</td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {relative(l.updatedAt)} · v{l.version}
                  </td>
                  <td className="pr-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Move to Waste"
                      className="rounded-full text-muted-foreground"
                      onClick={() => {
                        setArchiveError(null);
                        setArchiveTarget({ lead: l, kind: "waste" });
                      }}
                    >
                      <Ban className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Delete lead"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setArchiveError(null);
                        setArchiveTarget({ lead: l, kind: "deleted" });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="ba-pager mt-4">
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
              <ChevronLeft />
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
              <ChevronRight />
            </Button>
          </span>
        </div>
      )}

      <PilotAddLeadDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      <PilotLostReasonDialog
        open={Boolean(lostTarget)}
        {...(lostTarget ? { leadName: lostTarget.name } : {})}
        pending={updateMutation.isPending}
        errorMessage={lostError}
        onCancel={() => {
          setLostTarget(null);
          setLostError(null);
        }}
        onConfirm={(reason) => void handleConfirmLost(reason)}
      />

      <PilotArchiveDialog
        open={Boolean(archiveTarget)}
        kind={archiveTarget?.kind ?? "waste"}
        leadName={archiveTarget?.lead.name ?? "lead"}
        pending={archiveMutation.isPending}
        errorMessage={archiveError}
        onCancel={() => {
          setArchiveTarget(null);
          setArchiveError(null);
        }}
        onConfirm={(reason) => void handleConfirmArchive(reason)}
      />

      <PilotScheduleFollowUpDialog
        open={Boolean(followUpTarget)}
        onOpenChange={(o) => !o && setFollowUpTarget(null)}
        leadId={followUpTarget?.id}
        leadName={followUpTarget?.name}
        leadCompany={followUpTarget?.company}
      />
    </PilotShell>
  );
}

function PilotLeadInspector({
  lead,
  mutating,
  onPin,
  onPriority,
  onStage,
  quickSel,
  onRemove,
}: {
  lead: LeadDto;
  mutating: boolean;
  onPin: () => void;
  onPriority: (p: LeadPriorityApi) => void;
  onStage: (s: LeadStatusApi) => void;
  quickSel: React.ReactNode;
  onRemove: (kind: "waste" | "deleted") => void;
}) {
  const activitiesQuery = useLeadActivitiesQuery(lead.id, { limit: 7 });
  const leadFollowUpsQuery = useLeadFollowUpsQuery(lead.id);
  const createActivityMutation = useCreateActivityMutation();
  const completeFollowUpMutation = useCompleteFollowUpMutation();

  const [actType, setActType] = useState<ManualActivityTypeApi>("note");
  const [actText, setActText] = useState("");
  const [actError, setActError] = useState<string | null>(null);
  const actIdemKeyRef = useRef<string>(createIdempotencyKey());

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editFollowUp, setEditFollowUp] = useState<FollowUpDto | null>(null);
  const [cancelFollowUpTarget, setCancelFollowUpTarget] = useState<FollowUpDto | null>(null);
  const [fuBusy, setFuBusy] = useState(false);
  const fuBusyRef = useRef(false);

  const activeFollowUp =
    leadFollowUpsQuery.data?.items.find(
      (f) => f.id === leadFollowUpsQuery.data?.activeFollowUpId,
    ) ?? null;

  const completeActiveFollowUp = async () => {
    if (!activeFollowUp || fuBusyRef.current) return;
    fuBusyRef.current = true;
    setFuBusy(true);
    try {
      await completeFollowUpMutation.mutateAsync({
        id: activeFollowUp.id,
        payload: { version: activeFollowUp.version },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success("Follow-up completed");
    } catch (err) {
      toast.error(formatApiErrorMessage(err, "Could not complete follow-up."));
    } finally {
      fuBusyRef.current = false;
      setFuBusy(false);
    }
  };

  const submitActivity = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = actText.trim();
    if (!cleaned) {
      setActError("Enter activity text before saving.");
      return;
    }
    setActError(null);
    try {
      await createActivityMutation.mutateAsync({
        leadId: lead.id,
        payload: { type: actType, text: cleaned },
        idempotencyKey: actIdemKeyRef.current,
      });
      setActText("");
      actIdemKeyRef.current = createIdempotencyKey();
      toast.success(`${ACTIVITY_TYPE_LABEL[actType]} saved to MariaDB`);
    } catch (err) {
      const msg = formatApiErrorMessage(err, "Could not save activity. Draft preserved.");
      setActError(msg);
      toast.error(msg);
    }
  };

  const hist = activitiesQuery.data?.items ?? [];

  return (
    <aside aria-label={`${lead.name} inspector`} className="inspector panel self-start p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow" data-priority={lead.priority}>
            <span className="prio-dot mr-1.5" />
            {lead.priority} priority · score {lead.aiScore ?? "—"} · v{lead.version}
          </div>
          <h2 className="editorial mt-2 text-[44px]">{lead.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {lead.company ?? "Independent"} · <span className="num">{lead.phone}</span>
            {lead.email ? ` · ${lead.email}` : ""}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={lead.pinned ? "Unpin" : "Pin"}
          onClick={onPin}
          disabled={mutating}
          className="rounded-full"
        >
          <Pin className={cn("size-4", !lead.pinned && "opacity-40")} />
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full opacity-60"
          disabled
          title="Call dialer & logging connect in later checkpoints"
        >
          <Phone className="size-3.5" />
          Call
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full opacity-60"
          disabled
          title="Call logging connects in later checkpoints"
        >
          <PhoneCall className="size-3.5" />
          Log call
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full opacity-60"
          disabled
          title="WhatsApp templates connect in later checkpoints"
        >
          <MessageCircle className="size-3.5" />
          WhatsApp
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setScheduleOpen(true)}
        >
          <CalendarPlus className="size-3.5" />
          Follow-up
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild className="ml-auto rounded-full">
          <Link to="/leads/$id" params={{ id: lead.id }} search={{ pilot: 1 }}>
            Full record
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-3 xl:grid-cols-5">
        <div>
          <dt className="eyebrow">Stage</dt>
          <dd className="mt-1.5">
            <select
              aria-label="Stage"
              disabled={mutating}
              className={cn(selectCls, "h-8 w-full text-xs")}
              value={lead.status}
              onChange={(e) => onStage(e.target.value as LeadStatusApi)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Priority</dt>
          <dd className="mt-1.5">
            <select
              aria-label="Priority"
              disabled={mutating}
              className={cn(selectCls, "h-8 w-full text-xs")}
              value={lead.priority}
              onChange={(e) => onPriority(e.target.value as LeadPriorityApi)}
            >
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Quick status</dt>
          <dd className="mt-1.5">{quickSel}</dd>
        </div>
        <div>
          <dt className="eyebrow">{lead.quotedAmount !== undefined ? "Quoted" : "Budget"}</dt>
          <dd className="num mt-1.5 text-lg">{formatINR(lead.quotedAmount ?? lead.budget)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Next follow-up</dt>
          <dd className="mt-1.5 text-sm">
            {lead.nextFollowUp ? formatDateTime(lead.nextFollowUp) : "None booked"}
          </dd>
        </div>
      </dl>

      <div className="as-insp">
        <span className="eyebrow">Tags & Assignment</span>
        <span className="text-xs text-muted-foreground">
          {lead.tagIds.length > 0
            ? `${lead.tagIds.length} server tag(s) (read-only)`
            : "Disabled in B2B1 Pilot"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Assignments connect in Team CRM phase"
          className="ml-auto rounded-full opacity-60"
        >
          <UserCheck className="size-3.5" />
          Assign (Local)
        </Button>
      </div>

      {lead.requirement && (
        <p className="mt-6 border-l-2 border-clay pl-4 text-sm leading-relaxed">
          {lead.requirement}
        </p>
      )}
      {lead.status === "lost" && lead.lostReason && (
        <p className="mt-4 text-sm text-destructive">Lost · {lead.lostReason}</p>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div className="grid content-start gap-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="eyebrow">Follow-up (MariaDB)</span>
              <Link
                to="/follow-ups"
                search={{ pilot: 1 }}
                className="text-xs font-medium text-primary hover:underline"
              >
                All follow-ups →
              </Link>
            </div>
            {leadFollowUpsQuery.isLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            ) : leadFollowUpsQuery.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {formatApiErrorMessage(leadFollowUpsQuery.error, "Could not load follow-ups.")}
              </p>
            ) : activeFollowUp ? (
              <div
                data-testid="pilot-inspector-active-fu"
                className="rounded-lg border bg-card p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {FOLLOWUP_LABEL[activeFollowUp.type]} ·{" "}
                    <span className="num">{formatDateTime(activeFollowUp.dueAt)}</span>
                  </span>
                  <span className="num text-[11px] text-muted-foreground">
                    v{activeFollowUp.version}
                  </span>
                </div>
                {activeFollowUp.note && (
                  <p className="mt-1.5 text-muted-foreground">{activeFollowUp.note}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-2.5 text-xs"
                    disabled={fuBusy}
                    onClick={() => setEditFollowUp(activeFollowUp)}
                  >
                    <CalendarSync className="size-3" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full px-2.5 text-xs text-destructive"
                    disabled={fuBusy}
                    onClick={() => setCancelFollowUpTarget(activeFollowUp)}
                  >
                    <XCircle className="size-3" />
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto h-7 rounded-full px-2.5 text-xs"
                    disabled={fuBusy}
                    onClick={() => void completeActiveFollowUp()}
                  >
                    <Check className="size-3" />
                    Complete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-xs">
                <span className="text-muted-foreground">No active follow-up scheduled.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-2.5 text-xs"
                  onClick={() => setScheduleOpen(true)}
                >
                  <CalendarPlus className="size-3" />
                  Schedule
                </Button>
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow mb-3">Deals (B3)</div>
            <p className="text-xs text-muted-foreground">
              Deals & Payment proofs stay browser-local until Checkpoint B3.
            </p>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-3">Conversation history (MariaDB)</div>
          <form noValidate onSubmit={submitActivity} className="mb-4 grid gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="insp-act-type" className="text-xs text-muted-foreground">
                Type
              </label>
              <select
                id="insp-act-type"
                className={cn(selectCls, "h-8 text-xs")}
                value={actType}
                disabled={createActivityMutation.isPending}
                onChange={(e) => {
                  setActType(e.target.value as ManualActivityTypeApi);
                  actIdemKeyRef.current = createIdempotencyKey();
                }}
              >
                {MANUAL_ACTIVITY_TYPES_API.map((t) => (
                  <option key={t} value={t}>
                    {ACTIVITY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <Textarea
              aria-label="Manual activity note"
              rows={2}
              value={actText}
              disabled={createActivityMutation.isPending}
              onChange={(e) => {
                setActText(e.target.value);
                actIdemKeyRef.current = createIdempotencyKey();
                if (actError) setActError(null);
              }}
              placeholder="Add note, meeting, or email log…"
            />
            {actError && (
              <p role="alert" className="text-xs text-destructive">
                {actError}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="justify-self-end rounded-full"
              disabled={!actText.trim() || createActivityMutation.isPending}
            >
              {createActivityMutation.isPending
                ? "Saving…"
                : `Save ${ACTIVITY_TYPE_LABEL[actType].toLowerCase()}`}
            </Button>
          </form>
          {activitiesQuery.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {formatApiErrorMessage(activitiesQuery.error, "Could not load activities.")}
            </p>
          ) : (
            <ol className="timeline grid gap-4">
              {hist.map((a) => (
                <li key={a.id} data-kind={a.type}>
                  <p className="text-xs leading-relaxed">
                    <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase">
                      {a.type}
                    </span>
                    {a.text}
                  </p>
                  <span className="eyebrow">{relative(a.at)}</span>
                </li>
              ))}
              {!activitiesQuery.isLoading && hist.length === 0 && (
                <li className="text-xs text-muted-foreground">No server activity yet.</li>
              )}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-8 flex gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={mutating}
          className="rounded-full text-muted-foreground"
          onClick={() => onRemove("waste")}
        >
          <Ban className="size-3.5" />
          Move to Waste
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={mutating}
          className="rounded-full text-muted-foreground hover:text-destructive"
          onClick={() => onRemove("deleted")}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      <PilotScheduleFollowUpDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        leadId={lead.id}
        leadName={lead.name}
        leadCompany={lead.company}
      />

      <PilotEditFollowUpDialog
        followUp={editFollowUp}
        leadName={lead.name}
        onOpenChange={(o) => !o && setEditFollowUp(null)}
      />

      <PilotCancelFollowUpDialog
        followUp={cancelFollowUpTarget}
        leadName={lead.name}
        onOpenChange={(o) => !o && setCancelFollowUpTarget(null)}
      />
    </aside>
  );
}
