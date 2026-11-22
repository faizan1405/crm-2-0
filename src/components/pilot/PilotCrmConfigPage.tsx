import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useState, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  Info,
  Lock,
  Pencil,
  Plus,
  RotateCw,
  Settings,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatApiErrorMessage } from "@/lib/api/errors";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import {
  useSettingsDefinitionsQuery,
  type SettingsDefinitionsResponse,
} from "@/lib/api/settingsApi";
import {
  type CustomFieldDto,
  type FieldTypeApi,
  FIELD_TYPES_API,
  type TagDto,
  type TagColorApi,
  TAG_COLORS_API,
  type TagScopeApi,
  type SavedViewDto,
  type ViewConditionApi,
  type ViewFilterApi,
  useCustomFieldsQuery,
  useCreateCustomFieldMutation,
  useUpdateCustomFieldMutation,
  useArchiveCustomFieldMutation,
  useTagsQuery,
  useCreateTagMutation,
  useUpdateTagMutation,
  useArchiveTagMutation,
  useSavedViewsQuery,
  useCreateSavedViewMutation,
  useUpdateSavedViewMutation,
  useArchiveSavedViewMutation,
  useDuplicateSavedViewMutation,
} from "@/lib/api/customizationsApi";
import { cn } from "@/lib/utils";

const FIELD_TYPE_METADATA: Record<FieldTypeApi, { label: string; hint: string }> = {
  text: { label: "Short text", hint: "Single-line string, up to 200 characters." },
  longtext: { label: "Long text", hint: "Multi-line text, up to 5,000 characters." },
  number: { label: "Number", hint: "Decimal or integer numeric value." },
  currency: { label: "Currency (INR)", hint: "Exact amount in rupees." },
  date: { label: "Date", hint: "Calendar day (YYYY-MM-DD)." },
  checkbox: { label: "Yes / No", hint: "Boolean state." },
  select: { label: "Single choice", hint: "Choose one option from defined list." },
  multiselect: { label: "Multiple choice", hint: "Choose multiple options." },
  url: { label: "Website URL", hint: "Valid http:// or https:// address." },
  email: { label: "Email address", hint: "Normalized lowercase email." },
  phone: { label: "Phone number", hint: "Standard phone or mobile number." },
};

const TAG_COLOR_STYLES: Record<TagColorApi, { badge: string; dot: string; label: string }> = {
  graphite: {
    badge: "bg-zinc-800 text-zinc-100 border-zinc-700",
    dot: "bg-zinc-400",
    label: "Graphite",
  },
  green: {
    badge: "bg-emerald-950/70 text-emerald-300 border-emerald-800/60",
    dot: "bg-emerald-400",
    label: "Green",
  },
  amber: {
    badge: "bg-amber-950/70 text-amber-300 border-amber-800/60",
    dot: "bg-amber-400",
    label: "Amber",
  },
  rose: {
    badge: "bg-rose-950/70 text-rose-300 border-rose-800/60",
    dot: "bg-rose-400",
    label: "Rose",
  },
  sky: { badge: "bg-sky-950/70 text-sky-300 border-sky-800/60", dot: "bg-sky-400", label: "Sky" },
  violet: {
    badge: "bg-purple-950/70 text-purple-300 border-purple-800/60",
    dot: "bg-purple-400",
    label: "Violet",
  },
};

const OPERATOR_LABELS: Record<string, string> = {
  is: "is",
  is_not: "is not",
  any_of: "is any of",
  contains: "contains",
  equals: "equals",
  gt: "greater than (>)",
  lt: "less than (<)",
  between: "between (range)",
  before: "before date",
  after: "after date",
  on: "on date",
  within_days: "within past N days",
  today: "is today",
  overdue: "is overdue",
  yes: "is Yes (true)",
  no: "is No (false)",
  contains_any: "contains any of",
  contains_all: "contains all of",
  empty: "is empty / unset",
  not_empty: "is set / not empty",
};

const DEFERRED_MODULE_LABELS: Record<string, { label: string; note: string }> = {
  customFieldsCrud: {
    label: "Custom Lead & Project Fields",
    note: "Server-backed MariaDB Custom Fields Pilot active in B8B.",
  },
  tagsCrud: {
    label: "Tags & Tag Assignments",
    note: "Server-backed MariaDB Tags Pilot active in B8B.",
  },
  savedViews: {
    label: "Saved Pipeline Views",
    note: "Server-backed MariaDB Saved Views Pilot active in B8B.",
  },
  whatsappTemplatesLibrary: {
    label: "WhatsApp Templates Library",
    note: "Deferred past B8B; quick composer templates run separately.",
  },
  demoLinksLibrary: {
    label: "Demo Links Library",
    note: "Deferred past B8B.",
  },
  analyticsForecastConfig: {
    label: "Analytics & Forecast Config",
    note: "Deferred past B8B.",
  },
  teamUsersAndRbac: {
    label: "Team Users & Employee RBAC",
    note: "Deferred until multi-user Team CRM authentication.",
  },
  automationRules: {
    label: "Workflow Automation Rules",
    note: "Deferred past B8B.",
  },
};

type TabKey = "fields" | "tags" | "views" | "invariants";

export function PilotCrmConfigPage(props: { search?: Record<string, unknown> }) {
  const navigate = useNavigate();
  const initialTab =
    props.search?.["tab"] === "tags"
      ? "tags"
      : props.search?.["tab"] === "views"
        ? "views"
        : props.search?.["tab"] === "invariants"
          ? "invariants"
          : "fields";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const defsQ = useSettingsDefinitionsQuery();
  const defs = defsQ.data?.definitions;

  return (
    <PilotShell
      title="CRM Configuration"
      subtitle="MariaDB-Backed Custom Fields, Lead Tags & Saved Views Pilot"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm" variant="outline" className="rounded-lg gap-1.5">
            <Link to="/leads" search={pilotLinkSearch()}>
              <ExternalLink className="size-3.5" />
              Open Leads Pilot
            </Link>
          </Button>
          <Button asChild type="button" size="sm" variant="outline" className="rounded-lg gap-1.5">
            <Link to="/settings" search={pilotLinkSearch()}>
              <Settings className="size-3.5" />
              Owner Settings
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg"
            onClick={() => {
              setLeadPilotSessionOptIn(false);
              void navigate({ to: "/crm-config", search: { pilot: 0 } });
            }}
          >
            Open Local CRM Config
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Authoritative Banner */}
        <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <Database className="size-4 shrink-0 text-primary mt-0.5" />
          <span>
            <b className="font-semibold text-foreground">
              Authoritative MariaDB Customization Pilot.
            </b>{" "}
            Custom fields, lead tags, and saved views are validated and persisted directly to
            MariaDB tables (<code>crm_custom_fields</code>, <code>crm_tag_defs</code>,{" "}
            <code>crm_saved_views</code>). Browser-local records remain completely untouched.
          </span>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          aria-label="Configuration tabs"
          className="flex border-b border-border gap-2 overflow-x-auto pb-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "fields"}
            onClick={() => setActiveTab("fields")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "fields"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
            Custom Fields
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tags"}
            onClick={() => setActiveTab("tags")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "tags"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <TagIcon className="size-4" />
            Tags
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "views"}
            onClick={() => setActiveTab("views")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "views"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="size-4" />
            Saved Views
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "invariants"}
            onClick={() => setActiveTab("invariants")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "invariants"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Lock className="size-4" />
            System Invariants & Schema
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === "fields" && <CustomFieldsTab />}
        {activeTab === "tags" && <TagsTab />}
        {activeTab === "views" && <SavedViewsTab />}
        {activeTab === "invariants" && (
          <ServerInvariantsTab
            defs={defs}
            isLoading={defsQ.isLoading}
            error={defsQ.error}
            refetch={() => void defsQ.refetch()}
          />
        )}

        {/* Always visible bottom summary section so existing B6B invariants assertions pass smoothly */}
        {activeTab !== "invariants" && defs && (
          <div className="pt-4 border-t border-dashed">
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium hover:text-foreground">
                View System Invariants & Schema Overview ({defs.leadStatuses.length} stages ·{" "}
                {defs.deferredModules.length} deferred modules)
              </summary>
              <div className="mt-3 p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="font-semibold text-foreground">
                  Protected Pipeline & Business Invariants
                </div>
                <p>
                  Quotation templates endpoint:{" "}
                  <code>{defs.existingTemplateEndpoints.quotationTemplates}</code>
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {defs.deferredModules.map((m) => (
                    <span key={m} className="px-2 py-0.5 rounded border text-[11px]">
                      {DEFERRED_MODULE_LABELS[m]?.label ?? m}
                    </span>
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </PilotShell>
  );
}

// ============================================================================
// 1. CUSTOM FIELDS TAB
// ============================================================================

function CustomFieldsTab() {
  const fieldsQ = useCustomFieldsQuery("lead");
  const createMut = useCreateCustomFieldMutation();
  const updateMut = useUpdateCustomFieldMutation();
  const archiveMut = useArchiveCustomFieldMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDto | null>(null);

  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldTypeApi>("text");
  const [required, setRequired] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const [visibility, setVisibility] = useState<"team" | "owner">("team");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [options, setOptions] = useState<{ id?: string; label: string; archived?: boolean }[]>([]);
  const [newOptionText, setNewOptionText] = useState("");
  const [confirmConversion, setConfirmConversion] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(editingField);
  const typeChanged = isEditing && editingField?.type !== type;

  const openCreateDialog = () => {
    setEditingField(null);
    setLabel("");
    setType("text");
    setRequired(false);
    setHighlight(false);
    setVisibility("team");
    setDescription("");
    setCurrency("INR");
    setOptions([]);
    setNewOptionText("");
    setConfirmConversion(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (f: CustomFieldDto) => {
    setEditingField(f);
    setLabel(f.label);
    setType(f.type);
    setRequired(f.required);
    setHighlight(f.highlight);
    setVisibility(f.visibility);
    setDescription(f.description ?? "");
    setCurrency(f.currency ?? "INR");
    setOptions(
      f.options.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.archived !== undefined ? { archived: o.archived } : {}),
      })),
    );
    setNewOptionText("");
    setConfirmConversion(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleAddOption = () => {
    const trimmed = newOptionText.trim();
    if (!trimmed) return;
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20);
    const optId = `opt_${slug}_${Date.now().toString(36).slice(-4)}`;
    setOptions((prev) => [...prev, { id: optId, label: trimmed }]);
    setNewOptionText("");
  };

  const handleRemoveOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveField = async () => {
    setFormError(null);
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setFormError("Field label is required.");
      return;
    }

    if (typeChanged && !confirmConversion) {
      setFormError("Please acknowledge the type conversion warning before continuing.");
      return;
    }

    const mappedOptions = options.map((o) => ({
      id:
        o.id ||
        `opt_${o.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)}_${Math.random().toString(36).slice(2, 6)}`,
      label: o.label.trim(),
      ...(o.archived !== undefined ? { archived: o.archived } : {}),
    }));

    try {
      if (isEditing && editingField) {
        await updateMut.mutateAsync({
          id: editingField.id,
          data: {
            expectedVersion: editingField.version,
            label: trimmedLabel,
            type,
            required,
            highlight,
            visibility,
            description: description.trim() || null,
            currency: type === "currency" ? currency : null,
            ...(type === "select" || type === "multiselect" ? { options: mappedOptions } : {}),
          },
        });
      } else {
        await createMut.mutateAsync({
          entity: "lead",
          label: trimmedLabel,
          type,
          required,
          highlight,
          visibility,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(type === "currency" ? { currency } : {}),
          ...(type === "select" || type === "multiselect" ? { options: mappedOptions } : {}),
        });
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(formatApiErrorMessage(err, "Failed to save custom field."));
    }
  };

  const handleArchiveField = async (f: CustomFieldDto) => {
    if (!window.confirm(`Archive custom field "${f.label}"? Historical lead values remain safe.`))
      return;
    try {
      await archiveMut.mutateAsync({ id: f.id, expectedVersion: f.version });
    } catch (err) {
      alert(formatApiErrorMessage(err, "Failed to archive custom field."));
    }
  };

  const fields = fieldsQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Lead Custom Fields</h2>
          <p className="text-xs text-muted-foreground">
            Configure custom fields shown on lead forms and detail pages. All 11 field types
            supported with strict validation.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreateDialog} className="gap-1.5 rounded-lg">
          <Plus className="size-4" />
          Add Custom Field
        </Button>
      </div>

      {fieldsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {fieldsQ.error && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center justify-between">
          <span>
            Failed to load custom fields: {formatApiErrorMessage(fieldsQ.error, "Unknown error.")}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void fieldsQ.refetch()}>
            <RotateCw className="size-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {!fieldsQ.isLoading && fields.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
          <SlidersHorizontal className="size-8 mx-auto text-muted-foreground opacity-60" />
          <div className="font-medium text-sm">No Custom Fields Configured</div>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Click "Add Custom Field" to define your first MariaDB-backed custom field for leads.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreateDialog}
            className="mt-2"
          >
            Create First Field
          </Button>
        </div>
      )}

      <div className="grid gap-3">
        {fields.map((f) => (
          <div
            key={f.id}
            data-testid={`custom-field-row-${f.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors"
          >
            <div className="space-y-1 min-w-[200px]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">{f.label}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                  {f.id}
                </span>
                {f.required && (
                  <span className="rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.2 text-[10px] font-medium">
                    Required
                  </span>
                )}
                {f.visibility === "owner" && (
                  <span className="rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.2 text-[10px] font-medium flex items-center gap-1">
                    <Lock className="size-2.5" /> Owner Only
                  </span>
                )}
                {f.status === "archived" && (
                  <span className="rounded bg-destructive/10 text-destructive px-1.5 py-0.2 text-[10px] font-medium">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-primary">
                  {FIELD_TYPE_METADATA[f.type]?.label ?? f.type}
                </span>
                {f.type === "currency" && <span>({f.currency ?? "INR"})</span>}
                {f.description && <span>· {f.description}</span>}
                {f.options.length > 0 && <span>· {f.options.length} option(s)</span>}
                <span>· v{f.version}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openEditDialog(f)}
                className="h-8 gap-1 rounded-lg"
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              {f.status !== "archived" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleArchiveField(f)}
                  className="h-8 text-destructive hover:bg-destructive/10 rounded-lg"
                >
                  <Archive className="size-3.5" />
                  Archive
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? `Edit Field: ${editingField?.label}` : "Add Custom Field"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update field configuration. Incompatible type changes will be rejected by the server to protect data."
                : "Create a new custom field for leads, stored authoritatively in MariaDB."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="field-label">Field Label *</Label>
              <Input
                id="field-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Budget, Website Link, Preferred Time"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="field-type">Field Type *</Label>
              <select
                id="field-type"
                value={type}
                onChange={(e) => setType(e.target.value as FieldTypeApi)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {FIELD_TYPES_API.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_METADATA[t].label} — {FIELD_TYPE_METADATA[t].hint}
                  </option>
                ))}
              </select>
            </div>

            {/* Type Conversion Warning */}
            {typeChanged && (
              <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-500 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-4" />
                  Type Conversion Warning
                </div>
                <p>
                  You are changing the type from{" "}
                  <b>{FIELD_TYPE_METADATA[editingField!.type].label}</b> to{" "}
                  <b>{FIELD_TYPE_METADATA[type].label}</b>. Supported conversions (e.g., Currency to
                  Number, Select to Multi-select) convert existing values safely. Incompatible
                  conversions will be blocked by the server with a clean rollback.
                </p>
                <label className="flex items-center gap-2 pt-1 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmConversion}
                    onChange={(e) => setConfirmConversion(e.target.checked)}
                    className="rounded"
                  />
                  I understand that existing lead values will be converted.
                </label>
              </div>
            )}

            {/* Currency Code */}
            {type === "currency" && (
              <div className="space-y-1.5">
                <Label htmlFor="currency-code">Currency Code</Label>
                <Input
                  id="currency-code"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="INR"
                  maxLength={6}
                />
              </div>
            )}

            {/* Select / Multi-select Option Manager */}
            {(type === "select" || type === "multiselect") && (
              <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
                <Label>Options</Label>
                <div className="flex gap-2">
                  <Input
                    value={newOptionText}
                    onChange={(e) => setNewOptionText(e.target.value)}
                    placeholder="Option name (e.g. Gold, Enterprise)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddOption();
                      }
                    }}
                  />
                  <Button type="button" size="sm" onClick={handleAddOption} variant="secondary">
                    Add
                  </Button>
                </div>

                <div className="space-y-1 pt-2">
                  {options.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No options added yet.</p>
                  )}
                  {options.map((opt, idx) => (
                    <div
                      key={opt.id ?? idx}
                      className="flex items-center justify-between rounded border bg-background px-2.5 py-1.5 text-xs"
                    >
                      <span>{opt.label}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveOption(idx)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="field-desc">Description (Optional)</Label>
              <Textarea
                id="field-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Guidance shown below input in lead detail"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-xs font-semibold">Required</Label>
                  <p className="text-[11px] text-muted-foreground">Lead cannot be saved empty</p>
                </div>
                <Switch checked={required} onCheckedChange={setRequired} />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-xs font-semibold">Highlight</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Always visible in card overview
                  </p>
                </div>
                <Switch checked={highlight} onCheckedChange={setHighlight} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="field-visibility">Visibility</Label>
              <select
                id="field-visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "team" | "owner")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="team">Team (Visible to all members)</option>
                <option value="owner">Owner Only (Confidential financial/strategic)</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveField}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// 2. TAGS TAB
// ============================================================================

function TagsTab() {
  const tagsQ = useTagsQuery();
  const createMut = useCreateTagMutation();
  const updateMut = useUpdateTagMutation();
  const archiveMut = useArchiveTagMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagDto | null>(null);

  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColorApi>("graphite");
  const [scope, setScope] = useState<TagScopeApi>("both");
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(editingTag);

  const openCreateDialog = () => {
    setEditingTag(null);
    setName("");
    setColor("graphite");
    setScope("both");
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (t: TagDto) => {
    setEditingTag(t);
    setName(t.name);
    setColor(t.color);
    setScope(t.scope);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSaveTag = async () => {
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Tag name is required.");
      return;
    }

    try {
      if (isEditing && editingTag) {
        await updateMut.mutateAsync({
          id: editingTag.id,
          data: {
            expectedVersion: editingTag.version,
            name: trimmed,
            color,
            scope,
          },
        });
      } else {
        await createMut.mutateAsync({
          name: trimmed,
          color,
          scope,
        });
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(formatApiErrorMessage(err, "Failed to save tag."));
    }
  };

  const handleArchiveTag = async (t: TagDto) => {
    if (!window.confirm(`Archive tag "${t.name}"? Existing lead tag associations are preserved.`))
      return;
    try {
      await archiveMut.mutateAsync({ id: t.id, expectedVersion: t.version });
    } catch (err) {
      alert(formatApiErrorMessage(err, "Failed to archive tag."));
    }
  };

  const tags = tagsQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Lead Tags & Taxonomy</h2>
          <p className="text-xs text-muted-foreground">
            Create visual tags for leads and projects. Scoped, color-coded, and backed by MariaDB{" "}
            <code>crm_tag_defs</code>.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreateDialog} className="gap-1.5 rounded-lg">
          <Plus className="size-4" />
          Create Tag
        </Button>
      </div>

      {tagsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {tagsQ.error && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center justify-between">
          <span>Failed to load tags: {formatApiErrorMessage(tagsQ.error, "Unknown error.")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void tagsQ.refetch()}>
            <RotateCw className="size-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {!tagsQ.isLoading && tags.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
          <TagIcon className="size-8 mx-auto text-muted-foreground opacity-60" />
          <div className="font-medium text-sm">No Tags Created</div>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Click "Create Tag" to define your first MariaDB-backed tag for segmenting leads.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreateDialog}
            className="mt-2"
          >
            Create First Tag
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tags.map((t) => {
          const style = TAG_COLOR_STYLES[t.color] ?? TAG_COLOR_STYLES.graphite;
          return (
            <div
              key={t.id}
              data-testid={`tag-card-${t.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3.5 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                      style.badge,
                    )}
                  >
                    <span className={cn("size-2 rounded-full", style.dot)} />
                    {t.name}
                  </span>
                  {t.status === "archived" && (
                    <span className="text-[10px] text-destructive font-medium">Archived</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                  <span>Scope: {t.scope}</span>
                  <span>· v{t.version}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openEditDialog(t)}
                  className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </Button>
                {t.status !== "archived" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleArchiveTag(t)}
                    className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <Archive className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tag Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? `Edit Tag: ${editingTag?.name}` : "Create Tag"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Rename tag or update color."
                : "Define a new tag for categorizing leads."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="tag-name">Tag Name *</Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. VIP, Urgent, Enterprise"
                maxLength={32}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color Preset</Label>
              <div className="grid grid-cols-3 gap-2">
                {TAG_COLORS_API.map((c) => {
                  const style = TAG_COLOR_STYLES[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2 text-xs font-medium transition-all text-left",
                        color === c
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:bg-muted/30",
                      )}
                    >
                      <span className={cn("size-3 rounded-full shrink-0", style.dot)} />
                      <span>{style.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tag-scope">Tag Scope</Label>
              <select
                id="tag-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as TagScopeApi)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="both">Both Leads & Projects</option>
                <option value="lead">Leads Only</option>
                <option value="project">Projects Only (Deferred entity)</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Tag definitions support scoping. Project tag assignment is safely reserved for
                future Project modules.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveTag}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create Tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// 3. SAVED VIEWS TAB
// ============================================================================

function SavedViewsTab() {
  const viewsQ = useSavedViewsQuery();
  const fieldsQ = useCustomFieldsQuery("lead");
  const createMut = useCreateSavedViewMutation();
  const updateMut = useUpdateSavedViewMutation();
  const archiveMut = useArchiveSavedViewMutation();
  const duplicateMut = useDuplicateSavedViewMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<SavedViewDto | null>(null);

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"personal" | "company">("company");
  const [sort, setSort] = useState("recent");
  const [filterMode, setFilterMode] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<ViewConditionApi[]>([
    { id: "c1", field: "stage", op: "is", value: "new" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(editingView);

  const openCreateDialog = () => {
    setEditingView(null);
    setName("");
    setVisibility("company");
    setSort("recent");
    setFilterMode("and");
    setConditions([{ id: "c1", field: "stage", op: "is", value: "new" }]);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (v: SavedViewDto) => {
    setEditingView(v);
    setName(v.name);
    setVisibility(v.visibility);
    setSort(v.sort);
    setFilterMode(v.filter.mode);
    setConditions(v.filter.conditions);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleAddCondition = () => {
    const nextId = `c${conditions.length + 1}_${Date.now().toString(36).slice(-4)}`;
    setConditions((prev) => [...prev, { id: nextId, field: "stage", op: "is", value: "new" }]);
  };

  const handleRemoveCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateCondition = (idx: number, patch: Partial<ViewConditionApi>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const handleSaveView = async () => {
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("View name is required.");
      return;
    }

    if (conditions.length === 0) {
      setFormError("Add at least one filter condition.");
      return;
    }

    try {
      if (isEditing && editingView) {
        await updateMut.mutateAsync({
          id: editingView.id,
          data: {
            expectedVersion: editingView.version,
            name: trimmed,
            visibility,
            sort,
            filter: {
              mode: filterMode,
              conditions,
            },
          },
        });
      } else {
        await createMut.mutateAsync({
          name: trimmed,
          visibility,
          sort,
          filter: {
            mode: filterMode,
            conditions,
          },
        });
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(formatApiErrorMessage(err, "Failed to save view."));
    }
  };

  const handleDuplicateView = async (v: SavedViewDto) => {
    try {
      await duplicateMut.mutateAsync(v.id);
    } catch (err) {
      alert(formatApiErrorMessage(err, "Failed to duplicate view."));
    }
  };

  const handleArchiveView = async (v: SavedViewDto) => {
    if (!window.confirm(`Archive saved view "${v.name}"?`)) return;
    try {
      await archiveMut.mutateAsync({ id: v.id, expectedVersion: v.version });
    } catch (err) {
      alert(formatApiErrorMessage(err, "Failed to archive view."));
    }
  };

  const views = viewsQ.data?.items ?? [];
  const customFields = fieldsQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Saved Lead Views</h2>
          <p className="text-xs text-muted-foreground">
            Multi-condition filter presets stored in <code>crm_saved_views</code>. Supports all 20
            filter operators, AND/OR logic, and custom field subqueries.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreateDialog} className="gap-1.5 rounded-lg">
          <Plus className="size-4" />
          Create Saved View
        </Button>
      </div>

      {viewsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {viewsQ.error && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center justify-between">
          <span>
            Failed to load saved views: {formatApiErrorMessage(viewsQ.error, "Unknown error.")}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void viewsQ.refetch()}>
            <RotateCw className="size-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {!viewsQ.isLoading && views.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
          <Eye className="size-8 mx-auto text-muted-foreground opacity-60" />
          <div className="font-medium text-sm">No Saved Views Created</div>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Click "Create Saved View" to save your lead filter queries for fast 1-click access.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreateDialog}
            className="mt-2"
          >
            Create First View
          </Button>
        </div>
      )}

      <div className="grid gap-3">
        {views.map((v) => (
          <div
            key={v.id}
            data-testid={`saved-view-card-${v.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors"
          >
            <div className="space-y-1 min-w-[200px]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">{v.name}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                  {v.id}
                </span>
                <span className="rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.2 text-[10px] font-medium uppercase">
                  {v.visibility}
                </span>
                {v.archived && (
                  <span className="rounded bg-destructive/10 text-destructive px-1.5 py-0.2 text-[10px] font-medium">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {v.filter.mode.toUpperCase()}: {v.filter.conditions.length} condition(s)
                </span>
                <span>· Sort: {v.sort}</span>
                <span>· v{v.version}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="secondary" className="h-8 gap-1 rounded-lg">
                <Link to="/leads" search={pilotLinkSearch({ view: v.id })}>
                  <ExternalLink className="size-3.5" />
                  Open in Leads
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleDuplicateView(v)}
                className="h-8 gap-1 rounded-lg"
              >
                <Copy className="size-3.5" />
                Duplicate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openEditDialog(v)}
                className="h-8 gap-1 rounded-lg"
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              {!v.archived && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleArchiveView(v)}
                  className="h-8 text-destructive hover:bg-destructive/10 rounded-lg"
                >
                  <Archive className="size-3.5" />
                  Archive
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* View Builder Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? `Edit View: ${editingView?.name}` : "Create Saved View"}
            </DialogTitle>
            <DialogDescription>
              Build multi-condition filters using MariaDB <code>crm_saved_views</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="view-name">View Name *</Label>
                <Input
                  id="view-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. High Value Tech Leads"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="view-sort">Sort Preset</Label>
                <select
                  id="view-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="recent">Newest Created</option>
                  <option value="updated">Recently Updated</option>
                  <option value="score">Highest Score</option>
                  <option value="value">Highest Value</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="view-visibility">Visibility Scope</Label>
                <select
                  id="view-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as "personal" | "company")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="company">Company (Saved for Owner organization)</option>
                  <option value="personal">Personal (Private to this account)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="view-mode">Condition Matching Mode</Label>
                <select
                  id="view-mode"
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value as "and" | "or")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold"
                >
                  <option value="and">AND (Match ALL conditions)</option>
                  <option value="or">OR (Match ANY condition)</option>
                </select>
              </div>
            </div>

            {/* Condition List */}
            <div className="space-y-2 rounded-xl border p-4 bg-muted/10">
              <div className="flex items-center justify-between pb-1 border-b">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Filter Conditions ({conditions.length})
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleAddCondition}
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="size-3.5" /> Add Condition
                </Button>
              </div>

              <div className="space-y-3 pt-2">
                {conditions.map((c, idx) => {
                  const isCustom = c.field.startsWith("cf:");
                  return (
                    <div
                      key={c.id}
                      className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-lg border bg-background p-2 text-xs"
                    >
                      {/* Field Select */}
                      <select
                        data-testid={`view-condition-field-${idx}`}
                        value={c.field}
                        onChange={(e) => {
                          const nextField = e.target.value;
                          let nextOp = "is";
                          if (nextField === "tags") nextOp = "not_empty";
                          else if (nextField === "created") nextOp = "today";
                          else if (nextField === "quick") nextOp = "not_empty";
                          handleUpdateCondition(idx, {
                            field: nextField,
                            op: nextOp,
                            value: undefined,
                          });
                        }}
                        className="rounded border border-input bg-background px-2 py-1.5 text-xs w-full sm:w-44"
                      >
                        <optgroup label="Standard Fields">
                          <option value="stage">Stage</option>
                          <option value="priority">Priority</option>
                          <option value="source">Source</option>
                          <option value="quick">Quick Status</option>
                          <option value="search">Search Keywords</option>
                          <option value="created">Created Date</option>
                          <option value="tags">Tags</option>
                        </optgroup>
                        {customFields.length > 0 && (
                          <optgroup label="Custom Fields">
                            {customFields.map((cf) => (
                              <option key={cf.id} value={`cf:${cf.id}`}>
                                CF: {cf.label} ({cf.type})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>

                      {/* Operator Select */}
                      <select
                        value={c.op}
                        onChange={(e) => handleUpdateCondition(idx, { op: e.target.value })}
                        className="rounded border border-input bg-background px-2 py-1.5 text-xs w-full sm:w-36"
                      >
                        {getOperatorsForField(c.field, customFields).map((op) => (
                          <option key={op} value={op}>
                            {OPERATOR_LABELS[op] ?? op}
                          </option>
                        ))}
                      </select>

                      {/* Value Input */}
                      <div className="flex-1 min-w-[120px]">
                        <ConditionValueInput
                          testId={`view-condition-value-${idx}`}
                          field={c.field}
                          op={c.op}
                          value={c.value}
                          onChange={(v) => handleUpdateCondition(idx, { value: v })}
                          customFields={customFields}
                        />
                      </div>

                      {/* Remove Button */}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveCondition(idx)}
                        disabled={conditions.length === 1}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="save-view-submit-btn"
              onClick={handleSaveView}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving..."
                : isEditing
                  ? "Save View"
                  : "Create View"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getOperatorsForField(field: string, customFields: CustomFieldDto[]): string[] {
  if (field === "stage" || field === "priority" || field === "source") {
    return ["is", "is_not", "any_of", "contains_any"];
  }
  if (field === "quick") {
    return ["not_empty", "empty", "is", "is_not"];
  }
  if (field === "search") {
    return ["contains", "equals", "is"];
  }
  if (field === "created") {
    return ["today", "within_days", "before", "after", "on", "overdue"];
  }
  if (field === "tags") {
    return ["not_empty", "empty", "is", "contains_any", "contains_all"];
  }
  if (field.startsWith("cf:")) {
    const cfId = field.slice(3);
    const cf = customFields.find((f) => f.id === cfId);
    if (!cf) return ["equals", "is", "contains", "empty", "not_empty"];
    switch (cf.type) {
      case "number":
      case "currency":
        return ["equals", "is", "gt", "lt", "between", "empty", "not_empty"];
      case "checkbox":
        return ["yes", "no", "empty", "not_empty"];
      case "date":
        return ["on", "before", "after", "today", "within_days", "overdue", "empty", "not_empty"];
      case "select":
        return ["is", "is_not", "any_of", "contains_any", "empty", "not_empty"];
      case "multiselect":
        return ["contains_any", "contains_all", "empty", "not_empty"];
      default:
        return ["contains", "equals", "is", "is_not", "empty", "not_empty"];
    }
  }
  return ["is", "contains", "empty", "not_empty"];
}

function ConditionValueInput({
  field,
  op,
  value,
  onChange,
  customFields,
  testId,
}: {
  field: string;
  op: string;
  value: unknown;
  onChange: (val: unknown) => void;
  customFields: CustomFieldDto[];
  testId?: string;
}) {
  if (
    op === "today" ||
    op === "overdue" ||
    op === "yes" ||
    op === "no" ||
    op === "empty" ||
    op === "not_empty"
  ) {
    return <span data-testid={testId} className="text-[11px] text-muted-foreground italic px-2">No value needed</span>;
  }

  if (op === "within_days") {
    return (
      <Input
        data-testid={testId}
        type="number"
        value={typeof value === "number" ? value : String(value ?? 7)}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="7"
        className="h-8 text-xs"
      />
    );
  }

  if (op === "between") {
    const arr = Array.isArray(value) ? value : [0, 100000];
    return (
      <div data-testid={testId} className="flex items-center gap-1">
        <Input
          type="number"
          value={arr[0] ?? 0}
          onChange={(e) => onChange([Number(e.target.value), arr[1] ?? 100000])}
          placeholder="Min"
          className="h-8 text-xs"
        />
        <span className="text-muted-foreground">-</span>
        <Input
          type="number"
          value={arr[1] ?? 100000}
          onChange={(e) => onChange([arr[0] ?? 0, Number(e.target.value)])}
          placeholder="Max"
          className="h-8 text-xs"
        />
      </div>
    );
  }

  if (op === "before" || op === "after" || op === "on") {
    return (
      <Input
        data-testid={testId}
        type="date"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    );
  }

  if (field === "stage" && (op === "is" || op === "is_not")) {
    return (
      <select
        data-testid={testId}
        value={String(value ?? "new")}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-input bg-background px-2 py-1 text-xs w-full h-8"
      >
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="proposal">Proposal</option>
        <option value="negotiation">Negotiation</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
    );
  }

  if (op === "any_of" || op === "contains_any" || op === "contains_all") {
    const str = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    return (
      <Input
        data-testid={testId}
        value={str}
        onChange={(e) => {
          const parts = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parts);
        }}
        placeholder="Comma-separated values"
        className="h-8 text-xs"
      />
    );
  }

  return (
    <Input
      data-testid={testId}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value..."
      className="h-8 text-xs"
    />
  );
}

// ============================================================================
// 4. SERVER INVARIANTS TAB
// ============================================================================

function ServerInvariantsTab({
  defs,
  isLoading,
  error,
  refetch,
}: {
  defs: SettingsDefinitionsResponse["definitions"] | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}) {
  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      )}

      {Boolean(error) && (
        <div
          role="alert"
          className="flex items-center justify-between p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive"
        >
          <span>
            Failed to load server definitions: {formatApiErrorMessage(error, "Unknown error.")}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={refetch}>
            <RotateCw className="size-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {defs && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 space-y-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Lock className="size-4 text-primary" />
              Protected Pipeline & Business Invariants
            </h2>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="flex items-center justify-between border-b pb-2">
                <span>Database Engine</span>
                <span className="font-mono text-foreground font-semibold">MariaDB 11.4 LTS</span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>Default Currency</span>
                <span className="font-mono text-foreground font-semibold">
                  {defs.invariants?.currencyCode ?? "INR"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>Business Timezone</span>
                <span className="font-mono text-foreground font-semibold">
                  {defs.invariants?.businessTimezone ?? "Asia/Kolkata"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span>Pipeline Stages</span>
                <span className="font-mono text-foreground font-semibold">
                  {defs.leadStatuses.join(" → ")}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 space-y-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ExternalLink className="size-4 text-primary" />
              Production Endpoints & Template Schemas
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                <span className="font-medium">Quotation Templates</span>
                <code className="text-muted-foreground">
                  {defs.existingTemplateEndpoints.quotationTemplates}
                </code>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                <span className="font-medium">Project Templates</span>
                <code className="text-muted-foreground">
                  {defs.existingTemplateEndpoints.projectTemplates}
                </code>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Info className="size-4 text-muted-foreground" />
                Deferred Modules & System Roadmap
              </h2>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {defs.deferredModules.map((mod: string) => {
                const info = DEFERRED_MODULE_LABELS[mod];
                return (
                  <div key={mod} className="rounded-xl border border-dashed p-3 text-xs space-y-1">
                    <div className="font-medium text-foreground">{info?.label ?? mod}</div>
                    <p className="text-[11px] text-muted-foreground">{info?.note ?? "Deferred."}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
