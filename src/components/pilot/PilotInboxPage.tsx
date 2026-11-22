import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CalendarPlus,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  GitCompare,
  History,
  Inbox,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Empty, Identity, PriorityBadge, selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/crm/format";
import { LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL, type LeadPriority, type LeadStatus } from "@/lib/crm/types";
import type { LeadStatusApi } from "@/lib/api/schemas";
import {
  INBOX_CATEGORIES,
  useDuplicateCandidatesQuery,
  useInboxQueueQuery,
  useSetInboxReviewStatusMutation,
  useSetLeadDuplicateFlagMutation,
  type DupCandidateDto,
  type InboxCategory,
  type InboxRowDto,
} from "@/lib/api/inboxApi";
import { PilotDuplicateReviewDialog } from "./PilotDuplicateReviewDialog";
import { PilotInboxScanModal } from "./PilotInboxScanModal";
import { PilotInboxHistoryDrawer } from "./PilotInboxHistoryDrawer";
import { PilotCallDialog } from "./PilotCallDialog";
import { usePilotCallLauncher } from "./pilotCallLauncher";
import { PilotWhatsAppDialog } from "./PilotWhatsAppDialog";
import { usePilotWhatsAppLauncher } from "./pilotWhatsAppLauncher";
import { PilotScheduleFollowUpDialog } from "./PilotFollowUpDialogs";

const CATEGORY_LABELS: Record<InboxCategory, string> = {
  all: "All intake",
  needs_review: "Needs review",
  unassigned: "Unassigned",
  newly_assigned: "Newly assigned",
  duplicates: "Possible duplicates",
  recently_reviewed: "Recently reviewed",
};

interface PilotInboxPageProps {
  search?: Record<string, unknown>;
}

export function PilotInboxPage({ search = {} }: PilotInboxPageProps) {
  // Navigation / View states
  const searchCat = typeof search["category"] === "string" ? search["category"] : undefined;
  const searchQ =
    typeof search["q"] === "string"
      ? search["q"]
      : typeof search["search"] === "string"
        ? search["search"]
        : "";

  const [viewMode, setViewMode] = useState<"queue" | "candidates">(
    searchCat === "duplicates" ? "candidates" : "queue",
  );
  const [cat, setCat] = useState<InboxCategory>(
    searchCat && INBOX_CATEGORIES.includes(searchCat as InboxCategory)
      ? (searchCat as InboxCategory)
      : "all",
  );

  // Filters state
  const [q, setQ] = useState<string>(searchQ);
  const [source, setSource] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [createdDays, setCreatedDays] = useState<number>(0);
  const [firstContactPending, setFirstContactPending] = useState<boolean>(false);
  const [duplicateFilter, setDuplicateFilter] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal dialog states
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [reviewCandidateId, setReviewCandidateId] = useState<string | null>(null);
  const [flaggingLead, setFlaggingLead] = useState<InboxRowDto | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [followUpLead, setFollowUpLead] = useState<{ id: string; name: string } | null>(null);

  // Communication launchers
  const { target: callTarget, dialLead, close: closeCall } = usePilotCallLauncher();
  const {
    target: waTarget,
    openComposer: openWhatsApp,
    close: closeWhatsApp,
  } = usePilotWhatsAppLauncher();

  // API Queries & Mutations
  const queueQuery = useInboxQueueQuery({
    category: cat,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(source !== "all" ? { source } : {}),
    ...(priority !== "all" ? { priority } : {}),
    ...(stage !== "all" ? { stage } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(createdDays > 0 ? { createdDays } : {}),
    ...(firstContactPending ? { firstContactPending: true } : {}),
    ...(duplicateFilter ? { duplicate: true } : {}),
    page,
    pageSize,
  });

  const candidatesQuery = useDuplicateCandidatesQuery({
    status: "all",
    strength: "all",
    limit: 100,
  });

  const reviewStatusMutation = useSetInboxReviewStatusMutation();
  const flagMutation = useSetLeadDuplicateFlagMutation();

  const overview = queueQuery.data?.overview ?? {
    awaitingReview: 0,
    unassigned: 0,
    duplicates: 0,
    needFirstContact: 0,
    recent: 0,
    needsReviewCount: 0,
    unassignedCount: 0,
    duplicatesCount: 0,
  };

  const items = queueQuery.data?.items ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Handle row selection
  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAllPage = () => {
    const pageIds = items.map((i) => i.lead.id);
    setSelectedIds(new Set(pageIds));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Bulk Review Mutation
  const handleBulkReview = async (action: "mark_reviewed" | "unmark_reviewed") => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const res = await reviewStatusMutation.mutateAsync({
        leadIds: ids,
        action,
      });
      toast.success(
        action === "mark_reviewed"
          ? `${res.affectedCount} lead(s) marked reviewed`
          : `${res.affectedCount} lead(s) moved to needs review`,
      );
      setSelectedIds(new Set());
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Bulk review update failed");
    }
  };

  // Single Review Toggle
  const handleSingleReviewToggle = async (leadId: string, currentStatus: string) => {
    const action = currentStatus === "needs_review" ? "mark_reviewed" : "unmark_reviewed";
    try {
      await reviewStatusMutation.mutateAsync({
        leadIds: [leadId],
        action,
      });
      toast.success(action === "mark_reviewed" ? "Marked as reviewed" : "Moved back to needs review");
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Failed to update review status");
    }
  };

  // Manual Duplicate Flagging
  const handleConfirmFlag = async () => {
    if (!flaggingLead) return;
    try {
      await flagMutation.mutateAsync({
        leadId: flaggingLead.lead.id,
        action: "flag",
        ...(flagNote.trim() ? { note: flagNote.trim() } : {}),
      });
      toast.success("Lead flagged as possible duplicate");
      setFlaggingLead(null);
      setFlagNote("");
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Failed to flag duplicate");
    }
  };

  const handleUnflag = async (leadId: string) => {
    try {
      await flagMutation.mutateAsync({
        leadId,
        action: "unflag",
      });
      toast.success("Duplicate flag removed");
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Failed to unflag duplicate");
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setQ("");
    setSource("all");
    setPriority("all");
    setStage("all");
    setStatus("all");
    setCreatedDays(0);
    setFirstContactPending(false);
    setDuplicateFilter(false);
    setPage(1);
  };

  // Find candidate for a specific lead
  const candidatesList = candidatesQuery.data?.items ?? [];
  const candidateForLead = (leadId: string): DupCandidateDto | undefined => {
    return candidatesList.find((c) => c.leadA.id === leadId || c.leadB.id === leadId);
  };

  // Contact status badge helper
  const renderContactBadge = (contact: InboxRowDto["contact"]) => {
    const statusKey = typeof contact === "string" ? contact : contact.status;
    switch (statusKey) {
      case "established":
        return (
          <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
            Contacted (Connected Call)
          </Badge>
        );
      case "attempted":
        return (
          <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">
            Attempted Call
          </Badge>
        );
      case "outbound":
        return (
          <Badge className="bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/30 text-[10px]">
            WhatsApp Logged
          </Badge>
        );
      case "followup_only":
        return (
          <Badge className="bg-violet-500/20 text-violet-700 dark:text-violet-400 border-violet-500/30 text-[10px]">
            Follow-up Scheduled
          </Badge>
        );
      case "not_contacted":
      default:
        return (
          <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">
            Not Contacted
          </Badge>
        );
    }
  };

  return (
    <PilotShell
      title="Smart Lead Inbox (Pilot)"
      subtitle="Review, de-duplicate and manage enquiries backed by MariaDB 11.4."
    >
      {/* Top Utility Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={viewMode === "queue" ? "default" : "outline"}
            onClick={() => setViewMode("queue")}
            className="text-xs"
          >
            <Inbox className="mr-1.5 size-3.5" />
            Inbox Queue ({total})
          </Button>
          <Button
            size="sm"
            variant={viewMode === "candidates" ? "default" : "outline"}
            onClick={() => setViewMode("candidates")}
            className="text-xs"
          >
            <GitCompare className="mr-1.5 size-3.5" />
            Duplicate Review Desk ({candidatesList.length})
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScanModalOpen(true)}
            className="text-xs"
          >
            <Sparkles className="mr-1.5 size-3.5 text-primary" />
            Scan for Duplicates
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHistoryDrawerOpen(true)}
            className="text-xs"
          >
            <History className="mr-1.5 size-3.5 text-muted-foreground" />
            Review Audit History
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setViewMode("queue");
            setCat("needs_review");
            setPage(1);
          }}
          className={`rounded-lg border p-3 text-left transition-colors ${
            cat === "needs_review" && viewMode === "queue"
              ? "border-primary bg-primary/5"
              : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Awaiting review</div>
          <div className="mt-1 text-2xl font-bold num">{overview.awaitingReview}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode("queue");
            setCat("unassigned");
            setPage(1);
          }}
          className={`rounded-lg border p-3 text-left transition-colors ${
            cat === "unassigned" && viewMode === "queue"
              ? "border-primary bg-primary/5"
              : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Unassigned</div>
          <div className="mt-1 text-2xl font-bold num">{overview.unassigned}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode("candidates");
            setCat("duplicates");
            setPage(1);
          }}
          className={`rounded-lg border p-3 text-left transition-colors ${
            viewMode === "candidates"
              ? "border-primary bg-primary/5"
              : overview.duplicates > 0
                ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Duplicate candidates</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400 num">
            {overview.duplicates}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode("queue");
            setCat("all");
            setFirstContactPending(true);
            setPage(1);
          }}
          className={`rounded-lg border p-3 text-left transition-colors ${
            firstContactPending && viewMode === "queue"
              ? "border-primary bg-primary/5"
              : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Need first contact</div>
          <div className="mt-1 text-2xl font-bold num">{overview.needFirstContact}</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode("queue");
            setCat("all");
            setCreatedDays(7);
            setPage(1);
          }}
          className={`rounded-lg border p-3 text-left transition-colors ${
            createdDays === 7 && viewMode === "queue"
              ? "border-primary bg-primary/5"
              : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-[11px] font-medium text-muted-foreground">Received (7 days)</div>
          <div className="mt-1 text-2xl font-bold num">{overview.recent}</div>
        </button>
      </div>

      {viewMode === "queue" ? (
        <>
          {/* Category Tabs */}
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
            {INBOX_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={cat === c}
                onClick={() => {
                  setCat(c);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  cat === c
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          {/* Filter Bar */}
          <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3 rounded-lg border">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search inbox"
                className="pl-9 text-xs"
                placeholder="Search name, phone, email, or company"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <select
              aria-label="Lead Source"
              className={selectCls}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All sources</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              aria-label="Priority"
              className={selectCls}
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Any priority</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>

            <select
              aria-label="Stage"
              className={selectCls}
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Any stage</option>
              {LEAD_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>

            <select
              aria-label="Review status"
              className={selectCls}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Any review status</option>
              <option value="needs_review">Needs review</option>
              <option value="reviewed">Reviewed</option>
            </select>

            <select
              aria-label="Created window"
              className={selectCls}
              value={createdDays}
              onChange={(e) => {
                setCreatedDays(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={0}>Created: any time</option>
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={firstContactPending}
                onChange={(e) => {
                  setFirstContactPending(e.target.checked);
                  setPage(1);
                }}
              />
              Contact pending
            </label>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={duplicateFilter}
                onChange={(e) => {
                  setDuplicateFilter(e.target.checked);
                  setPage(1);
                }}
              />
              Duplicate flag
            </label>

            <Button size="sm" variant="ghost" onClick={handleResetFilters} className="text-xs">
              <RotateCcw className="mr-1 size-3" />
              Reset
            </Button>
          </div>

          {/* Bulk Selection Actions */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="num font-semibold text-foreground">
                {total} lead{total === 1 ? "" : "s"}
              </span>
              <Button size="sm" variant="ghost" onClick={handleSelectAllPage} className="h-7 text-xs">
                Select page ({items.length})
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <span className="font-medium text-foreground">
                    ({selectedIds.size} selected)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={reviewStatusMutation.isPending}
                    onClick={() => handleBulkReview("mark_reviewed")}
                  >
                    <CheckCheck className="mr-1 size-3 text-success" />
                    Mark reviewed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={reviewStatusMutation.isPending}
                    onClick={() => handleBulkReview("unmark_reviewed")}
                  >
                    Move to needs review
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleClearSelection}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>

            {queueQuery.isFetching && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" />
                Refreshing...
              </span>
            )}
          </div>

          {/* Lead Rows List */}
          <div className="surface rounded-lg border overflow-hidden">
            {queueQuery.isLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                <RefreshCw className="mr-2 size-4 animate-spin text-primary" />
                Loading inbox leads from MariaDB...
              </div>
            ) : items.length === 0 ? (
              <Empty
                icon={<Inbox className="size-8 text-muted-foreground" />}
                title="Smart Inbox clear"
                hint="No leads match the active category and filter criteria. New enquiries will appear here automatically."
              />
            ) : (
              <ul className="divide-y">
                {items.map((row) => {
                  const l = row.lead;
                  const cand = candidateForLead(l.id);
                  const isSelected = selectedIds.has(l.id);

                  return (
                    <li
                      key={l.id}
                      className="grid gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center hover:bg-muted/20 transition-colors"
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name}`}
                        checked={isSelected}
                        onChange={(e) => handleToggleSelect(l.id, e.target.checked)}
                        className="size-4 shrink-0 rounded border"
                      />

                      {/* Lead Details */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Identity name={l.name} company={l.company ?? undefined} />
                          <PriorityBadge p={l.priority as LeadPriority} />
                          <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium">
                            {STATUS_LABEL[l.status as LeadStatus] || l.status}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                              row.status === "needs_review"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-success/15 text-success"
                            }`}
                          >
                            {row.status === "needs_review" ? "Needs review" : "Reviewed"}
                          </span>

                          {/* Duplicate Indicators */}
                          {cand && (
                            <button
                              type="button"
                              onClick={() => setReviewCandidateId(cand.id)}
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                                cand.strength === "confirmed"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25"
                                  : "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25"
                              }`}
                            >
                              <GitCompare className="size-3" />
                              {cand.strength === "confirmed"
                                ? `Strong Match — ${cand.reasons.join(" + ")}`
                                : "Possible Match — Name + Company"}
                              {cand.reopened && (
                                <span className="text-[9px] font-bold text-destructive">
                                  (Reopened)
                                </span>
                              )}
                            </button>
                          )}

                          {row.flagged && (
                            <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive flex items-center gap-1">
                              <Flag className="size-3" />
                              Flagged duplicate
                              {row.flagNote && ` (${row.flagNote})`}
                            </span>
                          )}
                        </div>

                        {/* Secondary metadata */}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="num font-medium text-foreground">{l.phone}</span>
                          {l.email && <span>{l.email}</span>}
                          <span>Source: {l.source}</span>
                          {renderContactBadge(row.contact)}
                          <span className="num">
                            {row.ageDays === 0 ? "Received today" : `${row.ageDays}d old`}
                          </span>
                          {l.requirement && (
                            <span className="truncate italic">“{l.requirement}”</span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center gap-1">
                        <Button size="sm" variant="ghost" asChild aria-label="Open lead">
                          <Link to="/leads/$id" params={{ id: l.id }} search={pilotLinkSearch()}>
                            <Eye className="size-3.5" />
                          </Link>
                        </Button>

                        {/* Call Launcher */}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Call lead"
                          onClick={() =>
                            dialLead(
                              {
                                id: l.id,
                                name: l.name,
                                phone: l.phone,
                                company: l.company ?? undefined,
                                status: l.status as LeadStatusApi,
                                lifecycleStatus: "active",
                              },
                              "Smart Inbox",
                            )
                          }
                        >
                          <PhoneCall className="size-3.5" />
                        </Button>

                        {/* WhatsApp Launcher */}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="WhatsApp lead"
                          onClick={() =>
                            openWhatsApp(
                              {
                                id: l.id,
                                name: l.name,
                                phone: l.phone,
                                company: l.company ?? undefined,
                                status: l.status as LeadStatusApi,
                                lifecycleStatus: "active",
                              },
                              "Smart Inbox",
                            )
                          }
                        >
                          <MessageSquare className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        </Button>

                        {/* Schedule Follow-up */}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Schedule follow-up"
                          onClick={() => setFollowUpLead({ id: l.id, name: l.name })}
                        >
                          <CalendarPlus className="size-3.5" />
                        </Button>

                        {/* Review Toggle */}
                        {row.status === "needs_review" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={reviewStatusMutation.isPending}
                            onClick={() => handleSingleReviewToggle(l.id, row.status)}
                          >
                            <CheckCheck className="mr-1 size-3 text-success" />
                            Reviewed
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-muted-foreground"
                            disabled={reviewStatusMutation.isPending}
                            onClick={() => handleSingleReviewToggle(l.id, row.status)}
                          >
                            Undo
                          </Button>
                        )}

                        {/* Manual Flag / Unflag */}
                        {!row.flagged ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            aria-label="Flag duplicate"
                            onClick={() => {
                              setFlaggingLead(row);
                              setFlagNote("");
                            }}
                          >
                            <Flag className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleUnflag(l.id)}
                          >
                            Unflag
                          </Button>
                        )}

                        {/* Duplicate Review Launcher */}
                        {cand && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                            onClick={() => setReviewCandidateId(cand.id)}
                          >
                            <GitCompare className="mr-1 size-3" />
                            Compare
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <div>
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}{" "}
                leads
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 text-xs"
                >
                  <ChevronLeft className="mr-1 size-3" />
                  Previous
                </Button>
                <span className="num font-semibold text-foreground px-2">
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 text-xs"
                >
                  Next
                  <ChevronRight className="ml-1 size-3" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Duplicate Review Desk */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Active Duplicate Candidate Pairs</h3>
              <p className="text-xs text-muted-foreground">
                Owner review queue for algorithmic and flagged duplicates in MariaDB. Both lead
                records remain independent until explicit Owner resolution.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void candidatesQuery.refetch()}>
              <RefreshCw className="mr-1.5 size-3" />
              Refresh Candidates
            </Button>
          </div>

          {candidatesQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
              Loading duplicate candidates...
            </div>
          ) : candidatesList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
              <CheckCheck className="mx-auto size-8 text-success mb-2" />
              No duplicate candidate pairs found. Click “Scan for Duplicates” above to evaluate
              existing leads.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {candidatesList.map((cand) => {
                const isConfirmed = cand.strength === "confirmed";
                return (
                  <div
                    key={cand.id}
                    className="flex flex-col justify-between rounded-lg border bg-card p-3 shadow-xs space-y-3"
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                        <Badge
                          variant="outline"
                          className={
                            isConfirmed
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]"
                              : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400 text-[10px]"
                          }
                        >
                          {isConfirmed
                            ? "Strong Match — Phone/Email"
                            : "Possible Match — Name + Company"}
                        </Badge>
                        <Badge
                          variant={
                            cand.status === "pending"
                              ? "default"
                              : cand.status === "reviewed"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-[10px] capitalize"
                        >
                          {cand.status}
                          {cand.decisionKind && ` (${cand.decisionKind})`}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs border rounded-md p-2 bg-muted/20">
                        <div>
                          <div className="font-semibold text-foreground truncate">
                            {cand.leadA.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {cand.leadA.company || "No company"}
                          </div>
                          <div className="text-[11px] text-muted-foreground num font-mono">
                            {cand.leadA.phone}
                          </div>
                        </div>
                        <div className="border-l pl-2">
                          <div className="font-semibold text-foreground truncate">
                            {cand.leadB.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {cand.leadB.company || "No company"}
                          </div>
                          <div className="text-[11px] text-muted-foreground num font-mono">
                            {cand.leadB.phone}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Match criteria: <strong className="text-foreground">{cand.reasons.join(", ")}</strong>
                        {cand.reopened && (
                          <span className="ml-2 font-bold text-destructive">
                            · Reopened: contact changed
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t pt-2">
                      <Button
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => setReviewCandidateId(cand.id)}
                      >
                        <GitCompare className="mr-1 size-3" />
                        Review & Compare
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Flag Duplicate Dialog */}
      <Dialog open={Boolean(flaggingLead)} onOpenChange={(o) => !o && setFlaggingLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Flag className="size-4 text-destructive" />
              Flag Lead as Possible Duplicate
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mark <strong>{flaggingLead?.lead.name}</strong> as a suspected duplicate for manual
              audit review.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2 text-xs">
            <label htmlFor="flag-note" className="font-medium text-foreground">
              Reason / Note (Optional):
            </label>
            <Textarea
              id="flag-note"
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              placeholder="e.g. Branch office with different manager, alternate spelling..."
              className="h-20 text-xs"
            />
          </div>

          <DialogFooter className="gap-2 border-t pt-3">
            <Button size="sm" variant="ghost" onClick={() => setFlaggingLead(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={flagMutation.isPending}
              onClick={handleConfirmFlag}
            >
              Confirm Flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Review Dialog */}
      <PilotDuplicateReviewDialog
        candidateId={reviewCandidateId}
        onClose={() => setReviewCandidateId(null)}
        onDecisionSaved={() => {
          void queueQuery.refetch();
          void candidatesQuery.refetch();
        }}
      />

      {/* Duplicate Scan Modal */}
      <PilotInboxScanModal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        onScanCompleted={() => {
          void queueQuery.refetch();
          void candidatesQuery.refetch();
        }}
      />

      {/* History Drawer */}
      <PilotInboxHistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
      />

      {/* Call Dialog */}
      <PilotCallDialog target={callTarget} onClose={closeCall} />

      {/* WhatsApp Dialog */}
      <PilotWhatsAppDialog target={waTarget} onClose={closeWhatsApp} />

      {/* Schedule Follow-up Dialog */}
      <PilotScheduleFollowUpDialog
        open={Boolean(followUpLead)}
        onOpenChange={(o) => {
          if (!o) setFollowUpLead(null);
        }}
        leadId={followUpLead?.id}
        leadName={followUpLead?.name}
      />
    </PilotShell>
  );
}
