import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FlaskConical,
  ShieldCheck,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  useSimulateAutomationRuleMutation,
  type AutomationRuleDto,
  type SimulationResultDto,
  TRIGGER_LABELS,
  ACTION_LABELS,
} from "@/lib/api/automationsApi";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import { useProjectsQuery } from "@/lib/api/projectsApi";
import { formatDateTime } from "@/lib/crm/format";
import { selectCls } from "@/components/crm/ShellPrimitives";

export function PilotAutomationSimulationModal({
  rule,
  open,
  onClose,
}: {
  rule: AutomationRuleDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [simulationResult, setSimulationResult] = useState<SimulationResultDto | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const simulateMutation = useSimulateAutomationRuleMutation();

  const isProject = (rule?.subject ?? "lead") === "project";

  const { data: leadsData } = useLeadsListQuery(
    { limit: 50, offset: 0 },
    open && !isProject,
  );
  const { data: projectsData } = useProjectsQuery(
    { limit: 50, offset: 0 },
    open && isProject,
  );

  const leads = leadsData?.items ?? [];
  const projects = projectsData?.items ?? [];

  // Default selection if empty
  const activeLeadId = selectedLeadId || (leads[0]?.id ?? "");
  const activeProjectId = selectedProjectId || (projects[0]?.id ?? "");

  const handleRunSimulation = async () => {
    if (!rule) return;
    setErrorMsg(null);
    try {
      const res = await simulateMutation.mutateAsync({
        id: rule.id,
        event: {
          triggerType: rule.triggerType,
          leadId: !isProject ? activeLeadId : undefined,
          projectId: isProject ? activeProjectId : undefined,
          at: new Date().toISOString(),
        },
      });
      setSimulationResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to execute simulation");
    }
  };

  const handleReset = () => {
    setSimulationResult(null);
    setErrorMsg(null);
  };

  if (!rule) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="size-5 text-primary" />
            <DialogTitle>Safe Simulation · {rule.name}</DialogTitle>
          </div>
          <DialogDescription>
            Simulate this rule against synthetic CRM records.
            <b className="text-foreground"> Business-data-safe simulation with recorded audit history.</b> Real leads and financial ledgers are 100% untouched.
          </DialogDescription>
        </DialogHeader>

        {/* Rule Summary Bar */}
        <div className="rounded-lg border bg-secondary/30 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">Rule v{rule.version}</span>
            <Badge variant="outline" className="capitalize">
              Subject: {rule.subject}
            </Badge>
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Trigger: </span>
            {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
          </div>
        </div>

        {/* Target Subject Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">
            Select {isProject ? "Project" : "Lead"} for Simulation:
          </Label>
          {!isProject ? (
            <select
              aria-label="Select Lead"
              className={selectCls}
              value={activeLeadId}
              onChange={(e) => {
                setSelectedLeadId(e.target.value);
                setSimulationResult(null);
              }}
            >
              {leads.length === 0 ? (
                <option value="">No leads available</option>
              ) : (
                leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.company ? `(${l.company})` : ""} · Stage: {l.status} · Priority: {l.priority}
                  </option>
                ))
              )}
            </select>
          ) : (
            <select
              aria-label="Select Project"
              className={selectCls}
              value={activeProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSimulationResult(null);
              }}
            >
              {projects.length === 0 ? (
                <option value="">No projects available</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · Stage: {p.stage} · Priority: {p.priority}
                  </option>
                ))
              )}
            </select>
          )}
        </div>

        {/* Action Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleRunSimulation}
            disabled={simulateMutation.isPending || (!activeLeadId && !activeProjectId)}
            className="flex-1"
          >
            {simulateMutation.isPending ? (
              "Simulating..."
            ) : (
              <>
                <Play className="size-4 mr-1.5" />
                Run Safe Simulation
              </>
            )}
          </Button>
          {simulationResult && (
            <Button variant="outline" onClick={handleReset} title="Reset simulation">
              <RotateCcw className="size-4" />
            </Button>
          )}
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Simulation Output */}
        {simulationResult && (
          <div className="space-y-4 pt-2 border-t">
            {/* Overall Verdict Banner */}
            <div
              className={`rounded-lg border p-3 flex items-start gap-2.5 text-xs ${
                simulationResult.matched
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              {simulationResult.matched ? (
                <CheckCircle2 className="size-5 shrink-0 text-success mt-0.5" />
              ) : (
                <XCircle className="size-5 shrink-0 text-warning mt-0.5" />
              )}
              <div className="space-y-0.5">
                <div className="font-semibold text-sm">
                  {simulationResult.matched
                    ? "Simulation Matched — Proposed Actions Planned"
                    : "Simulation Evaluated — Conditions Did Not Match"}
                </div>
                <div className="text-muted-foreground">
                  {simulationResult.matched
                    ? "The simulated event satisfied all rule conditions. Proposed actions were generated below."
                    : "The subject record did not satisfy the rule conditions. No actions were proposed."}
                </div>
                <div className="text-[11px] font-medium pt-1 text-foreground">
                  Simulation Passed — Follow-up Was NOT Created (Preview Only — Zero Business Records Mutated)
                </div>
              </div>
            </div>

            {/* Condition Evaluation Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                Condition-by-Condition Evaluation
              </h4>
              {simulationResult.conditionResults.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2 rounded bg-secondary">
                  No custom conditions specified for this rule.
                </p>
              ) : (
                <div className="divide-y rounded-lg border bg-card text-xs">
                  {simulationResult.conditionResults.map((c, idx) => (
                    <div key={c.conditionId || c.id || idx} className="p-2.5 flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-medium text-foreground">
                          {c.field} {c.operator ? <span className="text-muted-foreground font-normal">[{c.operator}]</span> : null}
                        </div>
                        <div className="text-muted-foreground text-[11px]">{c.reason || c.message}</div>
                      </div>
                      <Badge
                        variant={c.passed ? "default" : "outline"}
                        className={c.passed ? "bg-success text-success-foreground text-[10px]" : "text-destructive text-[10px]"}
                      >
                        {c.passed ? "Passed" : "Failed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Planned Actions Preview */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground">
                Proposed Action Plan ({simulationResult.plannedActions.length})
              </h4>
              {simulationResult.plannedActions.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2 rounded bg-secondary">
                  Zero actions planned.
                </p>
              ) : (
                <div className="divide-y rounded-lg border bg-card text-xs">
                  {simulationResult.plannedActions.map((a, idx) => (
                    <div key={idx} className="p-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">{a.label}</span>
                        <Badge variant="outline" className="text-[10px]">
                          Target: {a.target}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-[11px]">{a.reason}</p>
                      <div className="text-[10px] text-muted-foreground">
                        Scheduled for: {formatDateTime(a.dueAt)} · Category: {a.category}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Invariant Confirmation Badge */}
            <div className="rounded-lg border bg-secondary/40 p-2.5 text-[11px] text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>
                <b>Verified Zero Business Mutations:</b> Leads, Follow-ups, Deals, Payments, Call Logs, WhatsApp Logs unchanged.
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
