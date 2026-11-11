import { useMemo, useState } from "react";
import {
  Workflow,
  Plus,
  Search,
  SlidersHorizontal,
  FlaskConical,
  Pencil,
  Copy,
  Pause,
  Play,
  Archive,
  History,
  AlertTriangle,
  Info,
  CheckCircle2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { selectCls, Empty } from "@/components/crm/ShellPrimitives";
import {
  useAutomationRulesQuery,
  useAutomationDefinitionsQuery,
  useDuplicateAutomationRuleMutation,
  useArchiveAutomationRuleMutation,
  useUpdateAutomationRuleMutation,
  type AutomationRuleDto,
  type RuleStatus,
  TRIGGER_LABELS,
  ACTION_LABELS,
} from "@/lib/api/automationsApi";
import { formatDateTime } from "@/lib/crm/format";
import { PilotRuleBuilderDialog } from "./PilotRuleBuilderDialog";
import { PilotAutomationSimulationModal } from "./PilotAutomationSimulationModal";
import { PilotAutomationRevisionsDrawer } from "./PilotAutomationRevisionsDrawer";
import { toast } from "sonner";

const STATUS_TONE: Record<RuleStatus, string> = {
  enabled: "bg-success/15 text-success border-success/30",
  paused: "bg-warning/15 text-warning border-warning/30",
  draft: "bg-secondary text-muted-foreground border-border",
  archived: "bg-secondary text-muted-foreground border-border",
};

const STATUS_LABEL_MAP: Record<RuleStatus, string> = {
  enabled: "Enabled (Config only — no automatic runner)",
  paused: "Paused",
  draft: "Draft",
  archived: "Archived",
};

export function PilotAutomationPage({
  search: initialSearch,
}: {
  search?: Record<string, unknown>;
}) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Modals state
  const [editingRule, setEditingRule] = useState<AutomationRuleDto | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState<boolean>(false);
  const [simulatingRule, setSimulatingRule] = useState<AutomationRuleDto | null>(null);
  const [revisionsRule, setRevisionsRule] = useState<{ id: string; name: string } | null>(null);

  const { data: defs } = useAutomationDefinitionsQuery();
  const { data: rulesData, isLoading, refetch } = useAutomationRulesQuery({
    search: searchTerm || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    subject: subjectFilter !== "all" ? subjectFilter : undefined,
  });

  const duplicateMutation = useDuplicateAutomationRuleMutation();
  const archiveMutation = useArchiveAutomationRuleMutation();
  const updateMutation = useUpdateAutomationRuleMutation();

  const rules = useMemo(() => {
    const list = rulesData?.items ?? [];
    return list.filter((r) => showArchived || r.status !== "archived");
  }, [rulesData?.items, showArchived]);

  const stats = rulesData?.stats ?? {
    total: 0,
    draft: 0,
    enabled: 0,
    paused: 0,
    archived: 0,
  };

  const handleDuplicate = async (rule: AutomationRuleDto) => {
    try {
      const copy = await duplicateMutation.mutateAsync(rule.id);
      toast.success(`Rule duplicated as draft "${copy.name}"`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to duplicate rule");
    }
  };

  const handleArchive = async (rule: AutomationRuleDto) => {
    if (!window.confirm(`Are you sure you want to archive rule "${rule.name}"? Revisions and simulation history will be retained.`)) {
      return;
    }
    try {
      await archiveMutation.mutateAsync({ id: rule.id, expectedVersion: rule.version });
      toast.success(`Rule "${rule.name}" archived`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to archive rule");
    }
  };

  const handleToggleStatus = async (rule: AutomationRuleDto, newStatus: RuleStatus) => {
    try {
      await updateMutation.mutateAsync({
        id: rule.id,
        input: {
          name: rule.name,
          description: rule.description ?? "",
          templateId: rule.templateId,
          subject: rule.subject,
          triggerType: rule.triggerType,
          status: newStatus,
          conditions: rule.conditions,
          actions: rule.actions,
          settings: rule.settings,
          expectedVersion: rule.version,
        },
      });
      toast.success(
        newStatus === "enabled"
          ? `Rule "${rule.name}" configuration enabled (automatic execution remains inactive)`
          : `Rule "${rule.name}" set to ${newStatus}`,
      );
    } catch (err: any) {
      toast.error(err?.message || `Failed to update rule status`);
    }
  };

  const handleUseTemplate = (tpl: any) => {
    setEditingRule({
      id: "",
      ownerUserId: "",
      name: tpl.name,
      description: tpl.description,
      templateId: tpl.templateId,
      subject: tpl.subject,
      triggerType: tpl.triggerType,
      status: "draft",
      pausedReason: null,
      conditions: tpl.conditions,
      actions: tpl.actions,
      settings: tpl.settings,
      version: 0,
      totalTriggerCount: 0,
      totalActionCount: 0,
      createdAt: "",
      updatedAt: "",
    });
    setIsBuilderOpen(true);
  };

  const conditionSummary = (r: AutomationRuleDto): string => {
    const parts: string[] = [];
    const c = r.conditions;
    if (c.stages?.length) parts.push(`Stages: ${c.stages.join(", ")}`);
    if (c.priorities?.length) parts.push(`Priorities: ${c.priorities.join(", ")}`);
    if (c.sources?.length) parts.push(`Sources: ${c.sources.join(", ")}`);
    if (c.assigned && c.assigned !== "any") parts.push(c.assigned === "assigned" ? "Assigned" : "Unassigned");
    if (c.inboxStatus && c.inboxStatus !== "any") parts.push(`Inbox: ${c.inboxStatus}`);
    if (c.firstContactPending) parts.push("First contact pending");
    if (c.minInactiveHours !== undefined) parts.push(`Inactive ≥ ${c.minInactiveHours}h`);
    if (c.minStageDays !== undefined) parts.push(`In stage ≥ ${c.minStageDays}d`);
    if (c.custom?.length) parts.push(`${c.custom.length} custom field condition(s) [${c.customMode ?? "and"}]`);
    return parts.length ? parts.join(" · ") : "Every record matching trigger";
  };

  return (
    <PilotShell
      title="Automation Studio (Pilot)"
      subtitle="MariaDB-backed Owner reminder and workflow configuration."
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            title="Refresh rules from database"
          >
            <RefreshCw className="size-3.5 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingRule(null);
              setIsBuilderOpen(true);
            }}
          >
            <Plus className="size-3.5 mr-1" />
            New Rule
          </Button>
        </div>
      }
    >
      {/* Pilot Warning Banner */}
      <div
        role="note"
        className="mb-5 flex items-start gap-2.5 rounded-lg border bg-secondary/60 p-3 text-xs text-muted-foreground"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <b className="text-foreground">Development Pilot Notice: </b>
          Rules can be configured and simulated in this development Pilot. Automatic execution and scheduled delivery are not yet enabled.
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Total Rules
          </span>
          <span className="text-2xl font-semibold num text-foreground">{stats.total}</span>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Enabled Configuration
          </span>
          <span className="text-2xl font-semibold num text-success">{stats.enabled}</span>
          <span className="text-[10px] text-muted-foreground block truncate">Automatic Execution Not Activated</span>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Draft Rules
          </span>
          <span className="text-2xl font-semibold num text-muted-foreground">{stats.draft}</span>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Paused Rules
          </span>
          <span className="text-2xl font-semibold num text-warning">{stats.paused}</span>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm col-span-2 sm:col-span-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Archived
          </span>
          <span className="text-2xl font-semibold num text-muted-foreground">{stats.archived}</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search rules"
              placeholder="Search rules..."
              className="h-8 pl-8 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            aria-label="Filter by Status"
            className={`${selectCls} h-8 text-xs`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="enabled">Enabled</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>

          <select
            aria-label="Filter by Subject"
            className={`${selectCls} h-8 text-xs`}
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="all">All subjects</option>
            <option value="lead">Leads only</option>
            <option value="project">Projects only</option>
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          <span>Show archived</span>
        </label>
      </div>

      {/* Rules Grid */}
      <section className="mb-8">
        {isLoading && (
          <p className="text-sm text-muted-foreground py-12 text-center">Loading automation rules from MariaDB...</p>
        )}

        {!isLoading && rules.length === 0 && (
          <div className="rounded-lg border bg-card p-8">
            <Empty
              icon={<Workflow className="size-8 text-muted-foreground" />}
              title="No Automation Rules Found"
              hint="Create your first rule above or start from one of the templates below."
            />
          </div>
        )}

        {!isLoading && rules.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {rules.map((rule) => (
              <article
                key={rule.id}
                className="rounded-lg border bg-card p-4 space-y-3 shadow-sm hover:border-primary/40 transition-colors"
                aria-label={rule.name}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-foreground truncate">{rule.name}</h3>
                      <span className="text-[10px] text-muted-foreground font-mono">v{rule.version}</span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{rule.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {rule.subject}
                    </Badge>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_TONE[rule.status]
                      }`}
                    >
                      {STATUS_LABEL_MAP[rule.status]}
                    </span>
                  </div>
                </div>

                <dl className="grid gap-1.5 text-xs bg-secondary/40 rounded-lg p-2.5 border">
                  <div>
                    <dt className="inline font-semibold text-muted-foreground">WHEN </dt>
                    <dd className="inline text-foreground">
                      {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-muted-foreground">IF </dt>
                    <dd className="inline text-foreground">{conditionSummary(rule)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-muted-foreground">THEN </dt>
                    <dd className="inline text-foreground">
                      {rule.actions.map((a) => ACTION_LABELS[a] || a).join(" · ")}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    Cooldown: <b className="text-foreground">{rule.settings.cooldownHours}h</b>
                  </span>
                  <span>
                    Last evaluated: {rule.lastEvaluatedAt ? formatDateTime(rule.lastEvaluatedAt) : "never"}
                  </span>
                  <span>
                    Last triggered: {rule.lastTriggeredAt ? formatDateTime(rule.lastTriggeredAt) : "never"}
                  </span>
                </div>

                {/* Card Actions */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setSimulatingRule(rule)}
                  >
                    <FlaskConical className="size-3 mr-1" />
                    Simulate
                  </Button>

                  {rule.status === "enabled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleToggleStatus(rule, "paused")}
                    >
                      <Pause className="size-3 mr-1" />
                      Pause
                    </Button>
                  ) : rule.status !== "archived" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleToggleStatus(rule, "enabled")}
                    >
                      <Play className="size-3 mr-1" />
                      Enable
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditingRule(rule);
                      setIsBuilderOpen(true);
                    }}
                  >
                    <Pencil className="size-3 mr-1" />
                    Edit
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleDuplicate(rule)}
                  >
                    <Copy className="size-3 mr-1" />
                    Duplicate
                  </Button>

                  {rule.status !== "archived" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => handleArchive(rule)}
                    >
                      <Archive className="size-3 mr-1" />
                      Archive
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => handleToggleStatus(rule, "draft")}
                    >
                      Restore
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setRevisionsRule({ id: rule.id, name: rule.name })}
                  >
                    <History className="size-3 mr-1" />
                    History
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Templates Section */}
      {defs?.templates && defs.templates.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" />
            Rule Templates
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {defs.templates.map((tpl) => (
              <div
                key={tpl.templateId}
                className="rounded-lg border bg-card p-3.5 flex flex-col justify-between space-y-2 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-foreground">{tpl.name}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {tpl.subject}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start text-xs h-7 mt-2"
                  onClick={() => handleUseTemplate(tpl)}
                >
                  <Plus className="size-3 mr-1" />
                  Use Template
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Dialogs */}
      {isBuilderOpen && (
        <PilotRuleBuilderDialog
          initialRule={editingRule}
          open={isBuilderOpen}
          onClose={() => {
            setIsBuilderOpen(false);
            setEditingRule(null);
          }}
        />
      )}

      {simulatingRule && (
        <PilotAutomationSimulationModal
          rule={simulatingRule}
          open={Boolean(simulatingRule)}
          onClose={() => setSimulatingRule(null)}
        />
      )}

      {revisionsRule && (
        <PilotAutomationRevisionsDrawer
          ruleId={revisionsRule.id}
          ruleName={revisionsRule.name}
          open={Boolean(revisionsRule)}
          onClose={() => setRevisionsRule(null)}
        />
      )}
    </PilotShell>
  );
}
