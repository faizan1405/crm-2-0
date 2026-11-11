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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Plus,
  Trash2,
  Sliders,
  Play,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";
import {
  useCreateAutomationRuleMutation,
  useUpdateAutomationRuleMutation,
  useAutomationDefinitionsQuery,
  type AutomationRuleDto,
  type RuleSubject,
  type TriggerType,
  type ActionType,
  type RuleStatus,
  type RuleConditions,
  type RuleSettings,
  type RuleConditionCustomItem,
  CUSTOM_CONDITION_OPERATORS,
  TRIGGER_LABELS,
  ACTION_LABELS,
  LEAD_TRIGGERS,
  PROJECT_TRIGGERS,
} from "@/lib/api/automationsApi";
import { selectCls } from "@/components/crm/ShellPrimitives";
import { toast } from "sonner";

const DANGEROUS_EXPRESSION_REGEX =
  /(<script\b|javascript:|eval\(|function\(|constructor\(|drop\s+table|union\s+select|--\s*$|\/\*|\*\/|['"]\s*(or|and)\s*['"]?\d['"]?\s*=\s*['"]?\d)/i;

const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
const PRIORITIES = ["hot", "warm", "cold"];
const SOURCES = ["Website", "Referral", "LinkedIn", "Inbound Call", "Outbound", "Organic", "Other"];

export function PilotRuleBuilderDialog({
  initialRule,
  open,
  onClose,
}: {
  initialRule: AutomationRuleDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const isEditing = Boolean(initialRule?.id);

  // Form State
  const [name, setName] = useState(initialRule?.name ?? "");
  const [description, setDescription] = useState(initialRule?.description ?? "");
  const [subject, setSubject] = useState<RuleSubject>(initialRule?.subject ?? "lead");
  const [triggerType, setTriggerType] = useState<TriggerType>(
    initialRule?.triggerType ?? "lead_created",
  );
  const [status, setStatus] = useState<RuleStatus>(initialRule?.status ?? "draft");
  const [actions, setActions] = useState<ActionType[]>(
    initialRule?.actions?.length ? initialRule.actions : ["reminder"],
  );

  // Conditions
  const [sources, setSources] = useState<string[]>(initialRule?.conditions?.sources ?? []);
  const [stages, setStages] = useState<string[]>(initialRule?.conditions?.stages ?? []);
  const [priorities, setPriorities] = useState<string[]>(initialRule?.conditions?.priorities ?? []);
  const [assigned, setAssigned] = useState<"any" | "assigned" | "unassigned">(
    initialRule?.conditions?.assigned ?? "any",
  );
  const [inboxStatus, setInboxStatus] = useState<"any" | "needs_review" | "reviewed">(
    initialRule?.conditions?.inboxStatus ?? "any",
  );
  const [firstContactPending, setFirstContactPending] = useState<boolean>(
    Boolean(initialRule?.conditions?.firstContactPending),
  );
  const [minCreatedMinutes, setMinCreatedMinutes] = useState<number | undefined>(
    initialRule?.conditions?.minCreatedMinutes,
  );
  const [minSinceAttemptMinutes, setMinSinceAttemptMinutes] = useState<number | undefined>(
    initialRule?.conditions?.minSinceAttemptMinutes,
  );
  const [minStageDays, setMinStageDays] = useState<number | undefined>(
    initialRule?.conditions?.minStageDays,
  );
  const [minInactiveHours, setMinInactiveHours] = useState<number | undefined>(
    initialRule?.conditions?.minInactiveHours,
  );
  const [customMode, setCustomMode] = useState<"and" | "or">(
    initialRule?.conditions?.customMode ?? "and",
  );
  const [customConditions, setCustomConditions] = useState<RuleConditionCustomItem[]>(
    initialRule?.conditions?.custom ?? [],
  );

  // Settings
  const [cooldownHours, setCooldownHours] = useState<number>(
    initialRule?.settings?.cooldownHours ?? 24,
  );
  const [escalateOwnerAfterMinutes, setEscalateOwnerAfterMinutes] = useState<number | undefined>(
    initialRule?.settings?.escalateOwnerAfterMinutes,
  );
  const [followupInHours, setFollowupInHours] = useState<number | undefined>(
    initialRule?.settings?.followupInHours,
  );
  const [taskTitle, setTaskTitle] = useState<string>(
    initialRule?.settings?.taskTitle ?? "",
  );
  const [taskDueInDays, setTaskDueInDays] = useState<number | undefined>(
    initialRule?.settings?.taskDueInDays,
  );
  const [withinDays, setWithinDays] = useState<number | undefined>(
    initialRule?.settings?.withinDays,
  );

  // Optimistic conflict state
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const { data: defs } = useAutomationDefinitionsQuery();
  const createMutation = useCreateAutomationRuleMutation();
  const updateMutation = useUpdateAutomationRuleMutation();

  const triggersList = (subject === "lead" ? LEAD_TRIGGERS : PROJECT_TRIGGERS) as readonly TriggerType[];
  const actionsList = (subject === "lead"
    ? ["reminder", "notify", "flag", "followup", "activity", "owner_review"]
    : ["reminder", "notify", "flag", "owner_review", "activity", "task"]) as ActionType[];

  const handleSubjectChange = (newSub: RuleSubject) => {
    setIsDirty(true);
    setSubject(newSub);
    const newTriggers = newSub === "lead" ? LEAD_TRIGGERS : PROJECT_TRIGGERS;
    setTriggerType(newTriggers[0]!);
    setActions(["reminder"]);
  };

  const handleAddCustomCondition = () => {
    if (customConditions.length >= 25) {
      toast.error("Maximum 25 custom conditions allowed");
      return;
    }
    setIsDirty(true);
    setCustomConditions([
      ...customConditions,
      {
        id: `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        field: subject === "lead" ? "l.stage" : "p.stage",
        op: "is",
        value: "",
      },
    ]);
  };

  const handleRemoveCustomCondition = (index: number) => {
    setIsDirty(true);
    setCustomConditions(customConditions.filter((_, i) => i !== index));
  };

  const handleCustomConditionChange = (
    index: number,
    patch: Partial<RuleConditionCustomItem>,
  ) => {
    setIsDirty(true);
    setCustomConditions(
      customConditions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const toggleArrayItem = (list: string[], item: string, setter: (val: string[]) => void) => {
    setIsDirty(true);
    if (list.includes(item)) {
      setter(list.filter((x) => x !== item));
    } else {
      setter([...list, item]);
    }
  };

  const toggleAction = (a: ActionType) => {
    setIsDirty(true);
    if (actions.includes(a)) {
      if (actions.length === 1) {
        toast.error("At least one action is required");
        return;
      }
      setActions(actions.filter((x) => x !== a));
    } else {
      setActions([...actions, a]);
    }
  };

  // Validation
  const validateForm = (): string | null => {
    if (!name.trim()) return "Rule name is required";
    if (DANGEROUS_EXPRESSION_REGEX.test(name) || DANGEROUS_EXPRESSION_REGEX.test(description)) {
      return "Potentially dangerous script or SQL injection tokens detected in name or description";
    }
    if (actions.length === 0) return "Choose at least one action";
    if (cooldownHours < 1) return "Cooldown hours must be at least 1";

    for (const c of customConditions) {
      if (!c.field.trim()) return "Condition field cannot be empty";
      if (DANGEROUS_EXPRESSION_REGEX.test(c.field) || (typeof c.value === "string" && DANGEROUS_EXPRESSION_REGEX.test(c.value))) {
        return "Potentially dangerous script or expression detected in conditions";
      }
    }
    return null;
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }
    setConflictError(null);

    const conditionsPayload: RuleConditions = {
      ...(sources.length ? { sources } : {}),
      ...(stages.length ? { stages } : {}),
      ...(priorities.length ? { priorities } : {}),
      ...(assigned !== "any" ? { assigned } : {}),
      ...(inboxStatus !== "any" ? { inboxStatus } : {}),
      ...(firstContactPending ? { firstContactPending: true } : {}),
      ...(minCreatedMinutes !== undefined ? { minCreatedMinutes } : {}),
      ...(minSinceAttemptMinutes !== undefined ? { minSinceAttemptMinutes } : {}),
      ...(minStageDays !== undefined ? { minStageDays } : {}),
      ...(minInactiveHours !== undefined ? { minInactiveHours } : {}),
      ...(customConditions.length ? { custom: customConditions, customMode } : {}),
    };

    const settingsPayload: RuleSettings = {
      cooldownHours,
      ...(escalateOwnerAfterMinutes !== undefined ? { escalateOwnerAfterMinutes } : {}),
      ...(followupInHours !== undefined ? { followupInHours } : {}),
      ...(taskTitle.trim() ? { taskTitle: taskTitle.trim() } : {}),
      ...(taskDueInDays !== undefined ? { taskDueInDays } : {}),
      ...(withinDays !== undefined ? { withinDays } : {}),
    };

    try {
      if (isEditing && initialRule) {
        await updateMutation.mutateAsync({
          id: initialRule.id,
          input: {
            name: name.trim(),
            description: description.trim(),
            subject,
            triggerType,
            status,
            conditions: conditionsPayload,
            actions,
            settings: settingsPayload,
            expectedVersion: initialRule.version,
          },
        });
        toast.success(`Rule "${name}" updated to v${initialRule.version + 1}`);
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          subject,
          triggerType,
          status,
          conditions: conditionsPayload,
          actions,
          settings: settingsPayload,
        });
        toast.success(`Rule "${name}" created successfully`);
      }
      onClose();
    } catch (err: any) {
      if (err?.code === "stale_conflict" || err?.status === 409) {
        setConflictError(
          "Stale version conflict: This rule was modified by another session or browser tab. Please reload the latest rule to prevent overwriting changes.",
        );
      } else {
        toast.error(err?.message || "Failed to save rule");
      }
    }
  };

  const handleClose = () => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard changes and close?")) {
      return;
    }
    onClose();
  };

  const chipCls = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? "border-primary bg-primary/10 text-primary font-medium"
        : "border-border bg-card text-muted-foreground hover:bg-secondary"
    }`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sliders className="size-5 text-primary" />
            <DialogTitle>{isEditing ? `Edit Rule · v${initialRule?.version}` : "New Automation Rule"}</DialogTitle>
          </div>
          <DialogDescription>
            Configure WHEN CRM events happen, IF conditions match, and THEN which proposed actions are planned.
            <b className="text-foreground"> Preview only — unattended execution is not active.</b>
          </DialogDescription>
        </DialogHeader>

        {conflictError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{conflictError}</p>
              <Button size="sm" variant="outline" onClick={onClose}>
                Close and Reload
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-4 pt-2">
          {/* Section 1: Basic Info */}
          <div className="rounded-lg border bg-card p-3.5 space-y-3">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              1. Rule Information
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rule-name" className="text-xs font-medium">
                  Rule Name *
                </Label>
                <Input
                  id="rule-name"
                  placeholder="e.g. Hot lead response reminder"
                  value={name}
                  onChange={(e) => {
                    setIsDirty(true);
                    setName(e.target.value);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-status" className="text-xs font-medium">
                  Configuration Status
                </Label>
                <select
                  id="rule-status"
                  aria-label="Configuration Status"
                  className={selectCls}
                  value={status}
                  onChange={(e) => {
                    setIsDirty(true);
                    setStatus(e.target.value as RuleStatus);
                  }}
                >
                  <option value="draft">Draft (Inactive)</option>
                  <option value="enabled">Enabled Configuration (Automatic Execution Not Active)</option>
                  <option value="paused">Paused</option>
                  {isEditing && <option value="archived">Archived</option>}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="rule-desc" className="text-xs font-medium">
                Description (Optional)
              </Label>
              <Input
                id="rule-desc"
                placeholder="Brief summary of rule intention"
                value={description}
                onChange={(e) => {
                  setIsDirty(true);
                  setDescription(e.target.value);
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rule-subject" className="text-xs font-medium">
                  Subject Entity
                </Label>
                <select
                  id="rule-subject"
                  aria-label="Subject Entity"
                  className={selectCls}
                  value={subject}
                  disabled={isEditing}
                  onChange={(e) => handleSubjectChange(e.target.value as RuleSubject)}
                >
                  <option value="lead">Leads</option>
                  <option value="project">Projects</option>
                </select>
                {isEditing && (
                  <p className="text-[10px] text-muted-foreground">Subject cannot be changed once saved.</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-trigger" className="text-xs font-medium">
                  WHEN Event Happens (Trigger) *
                </Label>
                <select
                  id="rule-trigger"
                  aria-label="Trigger"
                  className={selectCls}
                  value={triggerType}
                  onChange={(e) => {
                    setIsDirty(true);
                    setTriggerType(e.target.value as TriggerType);
                  }}
                >
                  {triggersList.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t] || t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Conditions */}
          <div className="rounded-lg border bg-card p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                2. IF Conditions Match
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Custom Logic:</span>
                <select
                  aria-label="Condition Group Mode"
                  className="rounded border bg-secondary px-2 py-0.5 text-xs"
                  value={customMode}
                  onChange={(e) => {
                    setIsDirty(true);
                    setCustomMode(e.target.value as "and" | "or");
                  }}
                >
                  <option value="and">ALL match (AND)</option>
                  <option value="or">ANY matches (OR)</option>
                </select>
              </div>
            </div>

            {subject === "lead" ? (
              <div className="space-y-3">
                {/* Stages */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">Pipeline Stages:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.map((s) => (
                      <button
                        type="button"
                        key={s}
                        className={chipCls(stages.includes(s))}
                        onClick={() => toggleArrayItem(stages, s, setStages)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Priorities */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">Priorities:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRIORITIES.map((p) => (
                      <button
                        type="button"
                        key={p}
                        className={chipCls(priorities.includes(p))}
                        onClick={() => toggleArrayItem(priorities, p, setPriorities)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sources */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">Sources:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SOURCES.map((src) => (
                      <button
                        type="button"
                        key={src}
                        className={chipCls(sources.includes(src))}
                        onClick={() => toggleArrayItem(sources, src, setSources)}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Assigned & Inbox status */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Assignment Status</Label>
                    <select
                      aria-label="Assignment Status"
                      className={selectCls}
                      value={assigned}
                      onChange={(e) => {
                        setIsDirty(true);
                        setAssigned(e.target.value as any);
                      }}
                    >
                      <option value="any">Assigned or unassigned</option>
                      <option value="assigned">Assigned</option>
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Smart Inbox Status</Label>
                    <select
                      aria-label="Smart Inbox Status"
                      className={selectCls}
                      value={inboxStatus}
                      onChange={(e) => {
                        setIsDirty(true);
                        setInboxStatus(e.target.value as any);
                      }}
                    >
                      <option value="any">Any review state</option>
                      <option value="needs_review">Needs review</option>
                      <option value="reviewed">Reviewed</option>
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={firstContactPending}
                    onChange={(e) => {
                      setIsDirty(true);
                      setFirstContactPending(e.target.checked);
                    }}
                  />
                  <span>First contact pending (no call connected or message sent)</span>
                </label>

                {/* Numeric thresholds */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Min. Inactive Hours</Label>
                    <Input
                      type="number"
                      min={0}
                      value={minInactiveHours ?? ""}
                      placeholder="e.g. 48"
                      onChange={(e) => {
                        setIsDirty(true);
                        setMinInactiveHours(e.target.value ? Number(e.target.value) : undefined);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Min. Stage Days</Label>
                    <Input
                      type="number"
                      min={0}
                      value={minStageDays ?? ""}
                      placeholder="e.g. 7"
                      onChange={(e) => {
                        setIsDirty(true);
                        setMinStageDays(e.target.value ? Number(e.target.value) : undefined);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Min. Created Minutes</Label>
                    <Input
                      type="number"
                      min={0}
                      value={minCreatedMinutes ?? ""}
                      placeholder="e.g. 30"
                      onChange={(e) => {
                        setIsDirty(true);
                        setMinCreatedMinutes(e.target.value ? Number(e.target.value) : undefined);
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Custom Field / Tag Conditions */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Custom Field & Tag Conditions ({customConditions.length}/25)
                </span>
                <Button size="sm" variant="outline" onClick={handleAddCustomCondition}>
                  <Plus className="size-3 mr-1" />
                  Add Condition
                </Button>
              </div>

              {customConditions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center border rounded border-dashed">
                  No custom field conditions added.
                </p>
              ) : (
                <div className="space-y-2">
                  {customConditions.map((cond, idx) => (
                    <div key={cond.id || idx} className="flex items-center gap-2 text-xs">
                      <Input
                        aria-label="Condition Field"
                        placeholder="Field (e.g. l.budget or cf:budget)"
                        value={cond.field}
                        className="w-1/3"
                        onChange={(e) => handleCustomConditionChange(idx, { field: e.target.value })}
                      />
                      <select
                        aria-label="Condition Operator"
                        className={`${selectCls} w-1/4`}
                        value={cond.op}
                        onChange={(e) =>
                          handleCustomConditionChange(idx, { op: e.target.value as any })
                        }
                      >
                        {CUSTOM_CONDITION_OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label="Condition Value"
                        placeholder="Expected Value (INR, text, date)"
                        value={String(cond.value ?? "")}
                        className="flex-1"
                        onChange={(e) => handleCustomConditionChange(idx, { value: e.target.value })}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveCustomCondition(idx)}
                        className="text-destructive hover:bg-destructive/10"
                        title="Remove condition"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Actions */}
          <div className="rounded-lg border bg-card p-3.5 space-y-3">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              3. THEN Proposed Actions & Settings
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Choose the internal actions this rule proposes when conditions match.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {actionsList.map((a) => (
                <label
                  key={a}
                  className="flex items-center gap-2 text-xs rounded border p-2 hover:bg-secondary cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={actions.includes(a)}
                    onChange={() => toggleAction(a)}
                  />
                  <span className="font-medium">{ACTION_LABELS[a] || a}</span>
                </label>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 pt-2">
              <div className="space-y-1">
                <Label htmlFor="cooldown" className="text-xs font-medium">
                  Cooldown (Hours) *
                </Label>
                <Input
                  id="cooldown"
                  type="number"
                  min={1}
                  value={cooldownHours}
                  onChange={(e) => {
                    setIsDirty(true);
                    setCooldownHours(Math.max(1, Number(e.target.value) || 1));
                  }}
                />
                <p className="text-[10px] text-muted-foreground">Min 1 hr to prevent repeat loops.</p>
              </div>

              {actions.includes("reminder") && (
                <div className="space-y-1">
                  <Label htmlFor="escalate" className="text-xs font-medium">
                    Escalate after (Min)
                  </Label>
                  <Input
                    id="escalate"
                    type="number"
                    min={0}
                    value={escalateOwnerAfterMinutes ?? ""}
                    placeholder="e.g. 120"
                    onChange={(e) => {
                      setIsDirty(true);
                      setEscalateOwnerAfterMinutes(
                        e.target.value ? Number(e.target.value) : undefined,
                      );
                    }}
                  />
                </div>
              )}

              {actions.includes("followup") && (
                <div className="space-y-1">
                  <Label htmlFor="followup-hours" className="text-xs font-medium">
                    Follow-up due in (Hours)
                  </Label>
                  <Input
                    id="followup-hours"
                    type="number"
                    min={1}
                    value={followupInHours ?? ""}
                    placeholder="e.g. 24"
                    onChange={(e) => {
                      setIsDirty(true);
                      setFollowupInHours(e.target.value ? Number(e.target.value) : undefined);
                    }}
                  />
                </div>
              )}

              {actions.includes("task") && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="task-title" className="text-xs font-medium">
                    Proposed Task Title
                  </Label>
                  <Input
                    id="task-title"
                    value={taskTitle}
                    placeholder="e.g. Complete project milestone review"
                    onChange={(e) => {
                      setIsDirty(true);
                      setTaskTitle(e.target.value);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Operational Readiness Notice */}
          <div className="rounded-lg border bg-secondary/50 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <HelpCircle className="size-4 shrink-0 mt-0.5 text-primary" />
            <div>
              <b className="text-foreground">Development Pilot Notice:</b> Rules are stored in MariaDB and can be tested using the Simulation Inspector. Automatic execution, scheduled email/WhatsApp delivery, and 24/7 background jobs are not yet activated.
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={createMutation.isPending || updateMutation.isPending || !name.trim()}
          >
            {createMutation.isPending || updateMutation.isPending
              ? "Saving..."
              : isEditing
              ? "Update Rule"
              : "Save Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
