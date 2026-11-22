import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Archive, ArrowLeft, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  extractDuplicateLeadConflict,
  extractStaleConflict,
  formatApiErrorMessage,
} from "@/lib/api/errors";
import { useLeadsListQuery, useRestoreLeadMutation } from "@/lib/api/leadsApi";
import type { LeadDto } from "@/lib/api/schemas";
import { formatINR, relative } from "@/lib/crm/format";
import { STATUS_LABEL } from "@/lib/crm/types";
import { Empty, Identity } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PilotShell } from "./PilotShell";

export function PilotLeadsBinPage() {
  const [tab, setTab] = useState<"waste" | "deleted">("waste");
  const [alertState, setAlertState] = useState<{ message: string; isStale: boolean } | null>(null);

  const wasteQuery = useLeadsListQuery({ lifecycle: "waste", limit: 100, offset: 0 });
  const deletedQuery = useLeadsListQuery({ lifecycle: "deleted", limit: 100, offset: 0 });
  const restoreMutation = useRestoreLeadMutation();

  const activeQuery = tab === "waste" ? wasteQuery : deletedQuery;
  const rows = activeQuery.data?.items ?? [];
  const wasteTotal = wasteQuery.data?.total ?? 0;
  const deletedTotal = deletedQuery.data?.total ?? 0;

  const handleRestore = async (lead: LeadDto) => {
    setAlertState(null);
    try {
      await restoreMutation.mutateAsync({
        id: lead.id,
        payload: { version: lead.version },
      });
      toast.success(`${lead.name} restored to active Leads`);
    } catch (err) {
      const dup = extractDuplicateLeadConflict(err);
      const stale = extractStaleConflict(err);
      const msg = dup
        ? `Cannot restore ${lead.name}: an active lead already uses ${dup.matches
            .map((m) => `${m.name} (${m.phone})`)
            .join(", ")}.`
        : stale
          ? `${lead.name} changed concurrently (v${lead.version} vs server v${stale.currentVersion ?? "?"}). Reload the bin list.`
          : formatApiErrorMessage(err);
      setAlertState({ message: msg, isStale: Boolean(stale) });
      toast.error(msg);
    }
  };

  return (
    <PilotShell
      title="Waste & Recently Deleted (Pilot)"
      subtitle="Server-archived MariaDB leads — restore anytime when no active phone conflict exists"
      actions={
        <Button
          type="button"
          variant="outline"
          disabled
          title="Permanent purge has no B2A backend endpoint yet"
          className="opacity-60"
        >
          <Trash2 className="size-4" />
          Empty {tab === "waste" ? "Waste" : "Recently Deleted"} (Disabled)
        </Button>
      }
    >
      <Link
        to="/leads"
        search={pilotLinkSearch()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        Back to Pilot leads
      </Link>

      <div
        role="status"
        className="mb-4 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        Permanent bin purge is disabled in B2B1 Pilot because the backend exposes archive and
        restore only (soft lifecycle states preserve audit trail).
      </div>

      {activeQuery.isError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{formatApiErrorMessage(activeQuery.error, "Unable to load archived leads.")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void activeQuery.refetch()}
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {alertState && (
        <div
          role="alert"
          data-testid="pilot-bin-alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{alertState.message}</span>
          <div className="flex gap-2">
            {alertState.isStale && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setAlertState(null);
                  void activeQuery.refetch();
                }}
              >
                <RefreshCw className="size-3.5" />
                Reload
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setAlertState(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b pb-3">
        {(
          [
            ["waste", "Waste", wasteTotal],
            ["deleted", "Recently Deleted", deletedTotal],
          ] as const
        ).map(([k, label, count]) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setTab(k);
              setAlertState(null);
            }}
            className={cn(tab === k ? "bg-primary-soft text-primary" : "text-muted-foreground")}
          >
            {label}
            <span className="num ml-1 text-[10px] opacity-70">{count}</span>
          </Button>
        ))}
      </div>

      {activeQuery.isLoading ? (
        <div className="surface grid gap-3 p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="surface">
          <Empty
            icon={<Archive />}
            title={tab === "waste" ? "Waste is empty" : "Nothing deleted recently"}
            hint="Leads you move here on the server can be restored with their activity history."
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((lead) => (
            <div key={lead.id} className="surface flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1">
                <Link
                  to="/leads/$id"
                  params={{ id: lead.id }}
                  search={pilotLinkSearch()}
                  className="hover:underline"
                >
                  <Identity name={lead.name} company={lead.company} />
                </Link>
              </div>
              <div className="text-xs text-muted-foreground">
                <div className="num">{lead.phone}</div>
                <div>
                  {STATUS_LABEL[lead.status]} · {formatINR(lead.quotedAmount ?? lead.budget)} · v
                  {lead.version}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                <div>
                  {tab === "waste" ? "Wasted" : "Deleted"}{" "}
                  {relative(lead.archivedAt ?? lead.updatedAt)}
                </div>
                {lead.archiveReason && <div>Reason: {lead.archiveReason}</div>}
              </div>
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={restoreMutation.isPending}
                  onClick={() => void handleRestore(lead)}
                >
                  <RotateCcw className="size-4" />
                  Restore
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled
                  aria-label="Delete permanently disabled in B2B1 Pilot"
                  title="Permanent purge has no B2A backend endpoint in B2B1"
                >
                  <Trash2 className="size-4 text-muted-foreground opacity-50" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PilotShell>
  );
}
