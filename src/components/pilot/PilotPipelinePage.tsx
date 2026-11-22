import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  GripVertical,
  IndianRupee,
  Phone,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeadsListQuery, useUpdateLeadMutation } from "@/lib/api/leadsApi";
import { useDealsQuery } from "@/lib/api/financeApi";
import { formatApiErrorMessage } from "@/lib/api/errors";
import type { DealDto, LeadDto, LeadStatusApi } from "@/lib/api/schemas";
import { formatINRCompact } from "@/lib/crm/format";
import { cn } from "@/lib/utils";

const STAGES: Array<{ id: LeadStatusApi; label: string; accent: string }> = [
  { id: "new", label: "New", accent: "border-t-sky-500" },
  { id: "contacted", label: "Contacted", accent: "border-t-indigo-500" },
  { id: "qualified", label: "Qualified", accent: "border-t-violet-500" },
  { id: "proposal", label: "Proposal", accent: "border-t-amber-500" },
  { id: "won", label: "Won", accent: "border-t-emerald-500" },
  { id: "lost", label: "Lost", accent: "border-t-rose-500" },
];

export function PilotPipelinePage() {
  const leadsQuery = useLeadsListQuery({ lifecycle: "active", limit: 200 });
  const dealsQuery = useDealsQuery({ limit: 100 });
  const updateLead = useUpdateLeadMutation();

  // Optimistic stage overrides keyed by leadId; cleared on settle or rolled back immediately on failure
  const [optimisticStages, setOptimisticStages] = useState<Record<string, LeadStatusApi>>({});
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<LeadStatusApi | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const leads = useMemo(() => leadsQuery.data?.items ?? [], [leadsQuery.data?.items]);
  const deals = useMemo(() => dealsQuery.data?.items ?? [], [dealsQuery.data?.items]);

  // Map leadId -> active/non-cancelled linked deals for accurate read-only financial context
  const dealsByLead = useMemo(() => {
    const map = new Map<string, DealDto[]>();
    for (const d of deals) {
      if (!d.leadId) continue;
      const list = map.get(d.leadId) ?? [];
      list.push(d);
      map.set(d.leadId, list);
    }
    return map;
  }, [deals]);

  const effectiveLeads = useMemo(
    () =>
      leads.map((lead) => ({
        ...lead,
        status: optimisticStages[lead.id] ?? lead.status,
      })),
    [leads, optimisticStages],
  );

  const columns = useMemo(() => {
    return STAGES.map((stage) => {
      const stageLeads = effectiveLeads.filter((l) => l.status === stage.id);
      let stageValueInr = 0;
      for (const lead of stageLeads) {
        const linked = dealsByLead.get(lead.id) ?? [];
        const activeLinked = linked.filter((d) => d.status !== "cancelled");
        if (activeLinked.length > 0) {
          stageValueInr += activeLinked.reduce((sum, d) => sum + d.finalAmount, 0);
        } else if (typeof lead.quotedAmount === "number") {
          stageValueInr += lead.quotedAmount;
        }
      }
      return { ...stage, leads: stageLeads, stageValueInr };
    });
  }, [effectiveLeads, dealsByLead]);

  const handleStageChange = async (lead: LeadDto, targetStage: LeadStatusApi) => {
    const currentEffective = optimisticStages[lead.id] ?? lead.status;
    if (currentEffective === targetStage) return;

    setMoveError(null);
    // Apply optimistic visual stage move
    setOptimisticStages((prev) => ({ ...prev, [lead.id]: targetStage }));

    try {
      await updateLead.mutateAsync({
        id: lead.id,
        payload: {
          version: lead.version,
          status: targetStage,
        },
      });
      toast.success(
        `Moved ${lead.name} to ${STAGES.find((s) => s.id === targetStage)?.label ?? targetStage}`,
      );
      setOptimisticStages((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });
    } catch (err) {
      // Visual rollback on failure
      setOptimisticStages((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });
      const msg = formatApiErrorMessage(err);
      setMoveError(`Failed to move "${lead.name}" — reverted to ${lead.status}. ${msg}`);
      toast.error(`Stage update rolled back: ${msg}`);
    }
  };

  return (
    <PilotShell
      title="Pipeline"
      subtitle="Persistent MariaDB sales pipeline with drag-and-drop stage transitions and live deal values."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={() => {
              void leadsQuery.refetch();
              void dealsQuery.refetch();
            }}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button type="button" size="sm" className="rounded-full" asChild>
            <Link to="/leads">All Leads</Link>
          </Button>
        </div>
      }
    >
      {moveError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{moveError}</span>
        </div>
      )}

      {leadsQuery.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive"
        >
          Failed to load MariaDB pipeline records: {formatApiErrorMessage(leadsQuery.error)}
        </div>
      ) : leadsQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => (
            <Skeleton key={s.id} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      ) : effectiveLeads.length === 0 ? (
        <div
          data-testid="pipeline-empty-state"
          className="rounded-xl border border-dashed border-border bg-card p-10 text-center"
        >
          <p className="text-sm font-semibold text-foreground">
            No leads in your MariaDB pipeline yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first lead from the Leads workspace to start tracking stages here.
          </p>
          <Button type="button" size="sm" className="mt-4" asChild>
            <Link to="/leads">Go to Leads</Link>
          </Button>
        </div>
      ) : (
        <div
          className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          data-testid="pilot-pipeline-board"
        >
          {columns.map((col) => (
            <section
              key={col.id}
              data-testid={`pipeline-stage-${col.id}`}
              aria-label={`${col.label} stage`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTargetStage(col.id);
              }}
              onDragLeave={() => {
                if (dropTargetStage === col.id) setDropTargetStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDropTargetStage(null);
                const leadId = e.dataTransfer.getData("text/plain") || draggedLeadId;
                setDraggedLeadId(null);
                const lead = leads.find((l) => l.id === leadId);
                if (lead) void handleStageChange(lead, col.id);
              }}
              className={cn(
                "flex min-h-[280px] flex-col rounded-lg border border-t-2 border-border/70 bg-muted/20 p-2.5 transition-colors",
                col.accent,
                dropTargetStage === col.id && "border-primary bg-primary/5",
              )}
            >
              <header className="mb-2.5 flex items-center justify-between gap-2 px-1">
                <div>
                  <h2 className="text-xs font-semibold text-foreground">{col.label}</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {col.stageValueInr > 0 ? formatINRCompact(col.stageValueInr) : "₹0"}
                  </p>
                </div>
                <span
                  data-testid={`pipeline-count-${col.id}`}
                  className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-foreground shadow-xs"
                >
                  {col.leads.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2">
                {col.leads.map((lead) => {
                  const linkedDeals = (dealsByLead.get(lead.id) ?? []).filter(
                    (d) => d.status !== "cancelled",
                  );
                  const totalDealInr = linkedDeals.reduce((sum, d) => sum + d.finalAmount, 0);
                  return (
                    <article
                      key={lead.id}
                      draggable
                      data-testid={`pipeline-card-${lead.id}`}
                      onDragStart={(e) => {
                        setDraggedLeadId(lead.id);
                        e.dataTransfer.setData("text/plain", lead.id);
                      }}
                      onDragEnd={() => {
                        setDraggedLeadId(null);
                        setDropTargetStage(null);
                      }}
                      className="rounded-md border border-border/70 bg-card p-2.5 text-xs shadow-xs transition-shadow hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-1 font-semibold text-foreground">
                          <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
                          <Link
                            to="/leads/$id"
                            params={{ id: lead.id }}
                            className="hover:underline"
                          >
                            {lead.name}
                          </Link>
                        </div>
                        <Link
                          to="/leads/$id"
                          params={{ id: lead.id }}
                          aria-label={`Open ${lead.name}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </div>

                      {lead.company && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Building2 className="size-3 shrink-0" />
                          <span className="truncate">{lead.company}</span>
                        </div>
                      )}

                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Phone className="size-3 shrink-0" />
                        <span>{lead.phone}</span>
                      </div>

                      {totalDealInr > 0 && (
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          <IndianRupee className="size-3" />
                          <span>
                            {formatINRCompact(totalDealInr)} ({linkedDeals.length} deal
                            {linkedDeals.length === 1 ? "" : "s"})
                          </span>
                        </div>
                      )}

                      <div className="mt-2 border-t border-border/40 pt-2">
                        <label className="sr-only" htmlFor={`stage-select-${lead.id}`}>
                          Stage for {lead.name}
                        </label>
                        <select
                          id={`stage-select-${lead.id}`}
                          aria-label={`Stage for ${lead.name}`}
                          value={lead.status}
                          onChange={(e) =>
                            void handleStageChange(lead, e.target.value as LeadStatusApi)
                          }
                          className="w-full rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                        >
                          {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </PilotShell>
  );
}
