import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useRef, useState, type FormEvent } from "react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  CalendarSync,
  Check,
  Mail,
  Pencil,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Sparkles,
  SunMedium,
  XCircle,
  FileText,
  Lock,
  Plus,
} from "lucide-react";
import { useCreateActivityMutation, useLeadActivitiesQuery } from "@/lib/api/activitiesApi";
import { useLeadCallsQuery } from "@/lib/api/callsApi";
import { createIdempotencyKey } from "@/lib/api/client";
import { useLeadWhatsAppMessagesQuery } from "@/lib/api/whatsappApi";
import { useLeadQuotationsQuery } from "@/lib/api/quotationsApi";
import {
  extractDuplicateLeadConflict,
  extractFieldValidationErrors,
  extractStaleConflict,
  formatApiErrorMessage,
  isApiError,
} from "@/lib/api/errors";
import {
  addIstOneDaySameTimeIso,
  formatIstTimeLabel,
  useCompleteFollowUpMutation,
  useLeadFollowUpsQuery,
  useRescheduleFollowUpMutation,
} from "@/lib/api/followupsApi";
import {
  getLead,
  leadKeys,
  useArchiveLeadMutation,
  useLeadQuery,
  useRestoreLeadMutation,
  useUpdateLeadMutation,
} from "@/lib/api/leadsApi";
import {
  useCustomFieldsQuery,
  useLeadCustomFieldsQuery,
  useSetLeadCustomFieldsMutation,
  useTagsQuery,
  useLeadTagsQuery,
  useAddTagToLeadMutation,
  useRemoveTagFromLeadMutation,
  type CustomFieldDto,
  type TagDto,
  type TagColorApi,
} from "@/lib/api/customizationsApi";
import {
  MANUAL_ACTIVITY_TYPES_API,
  type DuplicateLeadConflict,
  type FollowUpDto,
  type LeadDto,
  type LeadPriorityApi,
  type LeadSourceApi,
  type LeadStatusApi,
  type ManualActivityTypeApi,
  type QuickStatusApi,
} from "@/lib/api/schemas";
import { changedKeys, externalKeys, rebaseDraft } from "@/lib/crm/crossTab";
import { formatDateTime, formatINR, relative } from "@/lib/crm/format";
import { QUICK_LABEL, QUICK_STATUSES, staleDays } from "@/lib/crm/leadtools";
import { FOLLOWUP_LABEL, LEAD_SOURCES, LEAD_STATUSES, STATUS_LABEL } from "@/lib/crm/types";
import { amountFieldError, mailtoHref, validEmail, validPhone } from "@/lib/crm/validation";
import { WA_LABEL } from "@/lib/crm/whatsapp";
import { Empty, Identity, PriorityBadge, selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PilotArchiveDialog, PilotLostReasonDialog } from "./PilotDialogs";
import { PilotCallDialog, PilotCallLink } from "./PilotCallDialog";
import { usePilotCallLauncher } from "./pilotCallLauncher";
import {
  PilotCancelFollowUpDialog,
  PilotEditFollowUpDialog,
  PilotScheduleFollowUpDialog,
} from "./PilotFollowUpDialogs";
import { PilotNewQuotationDialog } from "./PilotNewQuotationDialog";
import { PilotQuotationDetailDrawer } from "./PilotQuotationDetailDrawer";
import { PilotShell } from "./PilotShell";
import { PilotWhatsAppButton, PilotWhatsAppDialog } from "./PilotWhatsAppDialog";
import { usePilotWhatsAppLauncher } from "./pilotWhatsAppLauncher";
import { PilotLeadRelationshipsCard } from "./PilotLeadRelationshipsCard";

const ACTIVITY_TYPE_LABEL: Record<ManualActivityTypeApi, string> = {
  note: "Note",
  meeting: "Meeting",
  email: "Email",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  company: "Company",
  requirement: "Requirement",
  source: "Source",
  priority: "Priority",
  budget: "Budget",
  quotedAmount: "Quoted",
  notes: "Notes",
};

const formOf = (l: LeadDto): Record<string, string> => ({
  name: l.name,
  phone: l.phone,
  email: l.email ?? "",
  company: l.company ?? "",
  requirement: l.requirement ?? "",
  source: l.source,
  priority: l.priority,
  budget: l.budget !== undefined ? String(l.budget) : "",
  quotedAmount: l.quotedAmount !== undefined ? String(l.quotedAmount) : "",
  notes: l.notes ?? "",
});

const TAG_COLOR_BADGES: Record<TagColorApi, string> = {
  graphite: "bg-zinc-800 text-zinc-100 border-zinc-700",
  green: "bg-emerald-950/70 text-emerald-300 border-emerald-800/60",
  amber: "bg-amber-950/70 text-amber-300 border-amber-800/60",
  rose: "bg-rose-950/70 text-rose-300 border-rose-800/60",
  sky: "bg-sky-950/70 text-sky-300 border-sky-800/60",
  violet: "bg-purple-950/70 text-purple-300 border-purple-800/60",
};

const TAG_COLOR_DOTS: Record<TagColorApi, string> = {
  graphite: "bg-zinc-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  sky: "bg-sky-400",
  violet: "bg-purple-400",
};

function formatCustomFieldValue(field: CustomFieldDto, val: unknown): React.ReactNode {
  if (val === undefined || val === null || val === "") {
    return field.required ? (
      <span className="text-amber-500 font-semibold">Needs completion</span>
    ) : (
      "—"
    );
  }
  if (field.type === "currency") {
    if (typeof val === "object" && val !== null && "amount" in val) {
      return formatINR((val as { amount: number }).amount);
    }
    if (typeof val === "number") return formatINR(val);
  }
  if (field.type === "checkbox") {
    return val ? "Yes" : "No";
  }
  if (field.type === "select") {
    const opt = field.options.find((o) => o.id === val);
    return opt?.label ?? String(val);
  }
  if (field.type === "multiselect" && Array.isArray(val)) {
    const labels = val.map((v) => {
      const opt = field.options.find((o) => o.id === v);
      return opt?.label ?? String(v);
    });
    return labels.join(", ") || "—";
  }
  if (field.type === "url") {
    const s = String(val);
    const href = s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
        {s}
      </a>
    );
  }
  return String(val);
}

function CustomFieldValueInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDto;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  switch (field.type) {
    case "checkbox": {
      const isTrue = value === true || value === "true" || value === 1;
      const isFalse = value === false || value === "false" || value === 0;
      return (
        <div className="flex items-center gap-3 text-xs pt-1">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`cf-${field.id}`}
              checked={isTrue}
              onChange={() => onChange(true)}
            />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`cf-${field.id}`}
              checked={isFalse}
              onChange={() => onChange(false)}
            />
            <span>No</span>
          </label>
          {(isTrue || isFalse) && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-muted-foreground hover:text-foreground underline text-[11px]"
            >
              Clear
            </button>
          )}
        </div>
      );
    }

    case "select":
      return (
        <select
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
        >
          <option value="">— Unset —</option>
          {field.options
            .filter((o) => !o.archived || o.id === value)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.archived ? " (archived)" : ""}
              </option>
            ))}
        </select>
      );

    case "multiselect": {
      const cur = Array.isArray(value) ? value : [];
      return (
        <div id={`cf-input-${field.id}`} data-testid={`cf-input-${field.id}`} className="flex flex-wrap gap-1.5 pt-1">
          {field.options.map((o) => {
            const isSelected = cur.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    onChange(cur.filter((id) => id !== o.id));
                  } else {
                    onChange([...cur, o.id]);
                  }
                }}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "date":
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
          className="h-8 text-xs"
        />
      );

    case "currency": {
      const numVal =
        typeof value === "object" && value !== null && "amount" in value
          ? (value as { amount: number }).amount
          : typeof value === "number"
            ? value
            : String(value ?? "");
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-2 text-xs text-muted-foreground">
            ₹
          </span>
          <Input
            id={`cf-input-${field.id}`}
            data-testid={`cf-input-${field.id}`}
            type="number"
            className="pl-6 h-8 text-xs"
            placeholder="0"
            value={numVal}
            onChange={(e) => {
              const str = e.target.value;
              onChange(
                str === "" ? undefined : { amount: Number(str), currency: field.currency ?? "INR" },
              );
            }}
          />
        </div>
      );
    }

    case "number":
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="number"
          placeholder="0"
          value={value !== undefined ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="h-8 text-xs"
        />
      );

    case "longtext":
      return (
        <Textarea
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          className="text-xs"
          placeholder={field.description ?? "Enter notes..."}
        />
      );

    case "email":
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="email"
          placeholder="email@example.com"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          className="h-8 text-xs"
        />
      );

    case "url":
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="url"
          placeholder="https://..."
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          className="h-8 text-xs"
        />
      );

    case "phone":
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="tel"
          placeholder="9876543210"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          className="h-8 text-xs"
        />
      );

    default:
      return (
        <Input
          id={`cf-input-${field.id}`}
          data-testid={`cf-input-${field.id}`}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          className="h-8 text-xs"
        />
      );
  }
}

export function PilotLeadDetailPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const leadQuery = useLeadQuery(id);
  const callsQuery = useLeadCallsQuery(id, { limit: 25 });
  const waMessagesQuery = useLeadWhatsAppMessagesQuery(id, { limit: 25 });
  const activitiesQuery = useLeadActivitiesQuery(id, { limit: 100 });
  const leadFollowUpsQuery = useLeadFollowUpsQuery(id);
  const leadQuotationsQuery = useLeadQuotationsQuery(id);
  const { target: callTarget, dialLead, openLogOnly, close: closeCall } = usePilotCallLauncher();
  const {
    target: waTarget,
    openComposer: openWhatsAppComposer,
    close: closeWhatsApp,
  } = usePilotWhatsAppLauncher();
  const updateMutation = useUpdateLeadMutation();
  const archiveMutation = useArchiveLeadMutation();
  const restoreMutation = useRestoreLeadMutation();
  const createActivityMutation = useCreateActivityMutation();
  const completeFollowUpMutation = useCompleteFollowUpMutation();
  const rescheduleFollowUpMutation = useRescheduleFollowUpMutation();

  const leadTagsQuery = useLeadTagsQuery(id);
  const allTagsQuery = useTagsQuery();
  const addTagMutation = useAddTagToLeadMutation(id);
  const removeTagMutation = useRemoveTagFromLeadMutation(id);

  const customFieldsQuery = useCustomFieldsQuery("lead");
  const leadCustomFieldsQuery = useLeadCustomFieldsQuery(id);
  const setLeadCustomFieldsMutation = useSetLeadCustomFieldsMutation(id);

  const [editingCustomFields, setEditingCustomFields] = useState(false);
  const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, unknown>>({});
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  const [edit, setEdit] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostError, setLostError] = useState<string | null>(null);
  const [archiveKind, setArchiveKind] = useState<"waste" | "deleted" | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [sideAlert, setSideAlert] = useState<{ message: string; isStale: boolean } | null>(null);

  const [fuScheduleOpen, setFuScheduleOpen] = useState(false);
  const [fuEditTarget, setFuEditTarget] = useState<FollowUpDto | null>(null);
  const [fuCancelTarget, setFuCancelTarget] = useState<FollowUpDto | null>(null);
  const [fuBusy, setFuBusy] = useState(false);
  const fuBusyRef = useRef(false);

  const [newQuoteOpen, setNewQuoteOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const [actType, setActType] = useState<ManualActivityTypeApi>("note");
  const [actText, setActText] = useState("");
  const [actError, setActError] = useState<string | null>(null);
  const actIdemKeyRef = useRef<string>(createIdempotencyKey());

  if (leadQuery.isLoading) {
    return (
      <PilotShell title="Loading lead…">
        <div className="panel grid gap-4 p-6">
          <div className="h-12 w-64 animate-pulse rounded-lg bg-muted" />
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </div>
      </PilotShell>
    );
  }

  if (leadQuery.isError) {
    const is404 = isApiError(leadQuery.error) && leadQuery.error.status === 404;
    return (
      <PilotShell title={is404 ? "Lead not found" : "Unable to load lead"}>
        <div className="panel">
          <Empty
            icon={<Archive />}
            title={is404 ? "Lead not found" : "Server error loading lead"}
            hint={
              is404
                ? "This lead does not exist in MariaDB for this Owner account."
                : formatApiErrorMessage(leadQuery.error)
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {!is404 && (
                  <Button type="button" variant="outline" onClick={() => void leadQuery.refetch()}>
                    Retry
                  </Button>
                )}
                <Button type="button" asChild>
                  <Link to="/leads" search={pilotLinkSearch()}>
                    Back to Pilot leads
                  </Link>
                </Button>
              </div>
            }
          />
        </div>
      </PilotShell>
    );
  }

  const lead = leadQuery.data;
  if (!lead) {
    return (
      <PilotShell title="Lead not found">
        <Link to="/leads" search={pilotLinkSearch()} className="text-primary underline">
          Back to Pilot leads
        </Link>
      </PilotShell>
    );
  }

  const archived = lead.lifecycleStatus !== "active";
  const callItems = callsQuery.data?.items ?? [];
  const callSummary = callsQuery.data?.summary ?? { total: 0, connected: 0, attempts: 0 };
  const waItems = waMessagesQuery.data?.items ?? [];
  const waTotal = waMessagesQuery.data?.total ?? 0;
  const acts = activitiesQuery.data?.items ?? [];
  const leadFollowUps = leadFollowUpsQuery.data?.items ?? [];
  const leadQuotations = leadQuotationsQuery.data?.items ?? [];
  const activeFollowUp =
    leadFollowUps.find((f) => f.id === leadFollowUpsQuery.data?.activeFollowUpId) ?? null;
  const pastFollowUps = leadFollowUps.filter((f) => f.id !== activeFollowUp?.id);
  const staleCount = archived ? undefined : staleDays(lead as never, new Date());

  const completeLeadFollowUp = async (fu: FollowUpDto) => {
    if (archived || fuBusyRef.current) return;
    fuBusyRef.current = true;
    setFuBusy(true);
    setSideAlert(null);
    try {
      await completeFollowUpMutation.mutateAsync({
        id: fu.id,
        payload: { version: fu.version },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success("Follow-up completed");
    } catch (err) {
      const stale = extractStaleConflict(err);
      const msg = formatApiErrorMessage(err, "Could not complete follow-up.");
      setSideAlert({
        message: msg,
        isStale: Boolean(stale || (isApiError(err) && err.code === "followup_already_closed")),
      });
      toast.error(msg);
      if (stale || (isApiError(err) && err.code === "followup_already_closed")) {
        void leadFollowUpsQuery.refetch();
      }
    } finally {
      fuBusyRef.current = false;
      setFuBusy(false);
    }
  };

  const moveLeadFollowUpTomorrow = async (fu: FollowUpDto) => {
    if (archived || fuBusyRef.current) return;
    const nextDue = addIstOneDaySameTimeIso(fu.dueAt);
    if (!nextDue) return;
    fuBusyRef.current = true;
    setFuBusy(true);
    setSideAlert(null);
    try {
      await rescheduleFollowUpMutation.mutateAsync({
        id: fu.id,
        payload: { version: fu.version, dueAt: nextDue },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(`Moved to tomorrow, ${formatIstTimeLabel(fu.dueAt)}`);
    } catch (err) {
      const stale = extractStaleConflict(err);
      const msg = formatApiErrorMessage(err, "Could not reschedule follow-up.");
      setSideAlert({
        message: msg,
        isStale: Boolean(stale || (isApiError(err) && err.code === "followup_already_closed")),
      });
      toast.error(msg);
      if (stale || (isApiError(err) && err.code === "followup_already_closed")) {
        void leadFollowUpsQuery.refetch();
      }
    } finally {
      fuBusyRef.current = false;
      setFuBusy(false);
    }
  };

  const runSidePatch = async (patch: Record<string, unknown>, okMsg: string) => {
    setSideAlert(null);
    try {
      await updateMutation.mutateAsync({
        id: lead.id,
        payload: { version: lead.version, ...patch },
        idempotencyKey: createIdempotencyKey(),
      });
      toast.success(okMsg);
    } catch (err) {
      const stale = extractStaleConflict(err);
      const msg = stale
        ? `${lead.name} changed in another session (server v${stale.currentVersion ?? "?"}). Reload latest before changing.`
        : formatApiErrorMessage(err);
      setSideAlert({ message: msg, isStale: Boolean(stale) });
      toast.error(msg);
    }
  };

  const handleStageChange = (nextStatus: LeadStatusApi) => {
    if (nextStatus === lead.status) return;
    if (nextStatus === "lost") {
      setLostError(null);
      setLostOpen(true);
      return;
    }
    void runSidePatch({ status: nextStatus }, `Stage changed to ${STATUS_LABEL[nextStatus]}`);
  };

  const handleConfirmLost = async (reason: string) => {
    setLostError(null);
    try {
      await updateMutation.mutateAsync({
        id: lead.id,
        payload: { version: lead.version, status: "lost", lostReason: reason },
        idempotencyKey: createIdempotencyKey(),
      });
      setLostOpen(false);
      toast.success("Lead marked as Lost");
    } catch (err) {
      setLostError(formatApiErrorMessage(err));
    }
  };

  const handleConfirmArchive = async (reason?: string) => {
    if (!archiveKind) return;
    setArchiveError(null);
    try {
      await archiveMutation.mutateAsync({
        id: lead.id,
        payload: { kind: archiveKind, version: lead.version, ...(reason ? { reason } : {}) },
      });
      toast.success(
        archiveKind === "waste" ? "Moved to Waste" : "Deleted — restore from Recently Deleted",
      );
      setArchiveKind(null);
      void navigate({ to: "/leads", search: pilotLinkSearch() });
    } catch (err) {
      setArchiveError(formatApiErrorMessage(err));
    }
  };

  const handleRestore = async () => {
    setSideAlert(null);
    try {
      await restoreMutation.mutateAsync({
        id: lead.id,
        payload: { version: lead.version },
      });
      toast.success(`${lead.name} restored to active Leads`);
    } catch (err) {
      const dup = extractDuplicateLeadConflict(err);
      const msg = dup
        ? `Cannot restore because another active lead already uses ${dup.matches.map((m) => `${m.name} (${m.phone})`).join(", ")}.`
        : formatApiErrorMessage(err);
      setSideAlert({ message: msg, isStale: Boolean(extractStaleConflict(err)) });
      toast.error(msg);
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
      toast.success(`${ACTIVITY_TYPE_LABEL[actType]} recorded on MariaDB`);
    } catch (err) {
      const msg = formatApiErrorMessage(err, "Failed to record activity. Draft preserved.");
      setActError(msg);
      toast.error(msg);
    }
  };

  const fieldEntries = Object.entries(lead.fieldValues);

  return (
    <PilotShell
      title={lead.name}
      subtitle={[lead.company, STATUS_LABEL[lead.status], `v${lead.version}`]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <div className="flex flex-wrap gap-2">
          <PilotCallLink
            lead={lead}
            dialSource="Lead detail"
            onDialStarted={dialLead}
            className="h-9 px-4 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            disabled={archived}
            onClick={() => openLogOnly(lead, "Lead detail")}
            className={archived ? "h-9 px-4 opacity-60" : "h-9 px-4"}
            title={archived ? "Restore archived lead to log calls" : "Record a call outcome"}
          >
            <PhoneCall className="size-4" />
            Log call
          </Button>
          <PilotWhatsAppButton
            lead={lead}
            composerSource="Lead detail"
            onOpenComposer={openWhatsAppComposer}
            className="h-9 px-4 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            disabled
            className="h-9 px-4 opacity-60"
            title="AI Copilot connects in B5"
          >
            <Sparkles className="size-4" />
            Ask AI (B5)
          </Button>
          <Button
            type="button"
            disabled={archived}
            onClick={() => setFuScheduleOpen(true)}
            className={archived ? "h-9 px-4 opacity-60" : "h-9 px-4"}
            title={archived ? "Restore archived lead to schedule follow-ups" : "Schedule follow-up"}
          >
            <CalendarPlus className="size-4" />
            Follow-up
          </Button>
        </div>
      }
    >
      <Link
        to={archived ? "/leads/bin" : "/leads"}
        search={pilotLinkSearch()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {archived ? "Back to Waste & Recently Deleted" : "All Pilot leads"}
      </Link>

      {archived && (
        <div
          role="status"
          data-testid="pilot-archived-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              Archived ({lead.lifecycleStatus === "waste" ? "Waste" : "Recently Deleted"})
              {lead.archivedAt ? ` · ${formatDateTime(lead.archivedAt)}` : ""}
            </p>
            {lead.archiveReason && (
              <p className="text-xs text-muted-foreground">Reason: {lead.archiveReason}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Archived records are read-only (`409 lead_archived`). Restore to edit or log activity.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={restoreMutation.isPending}
            onClick={() => void handleRestore()}
          >
            <RotateCcw className="size-4" />
            {restoreMutation.isPending ? "Restoring…" : "Restore lead"}
          </Button>
        </div>
      )}

      {sideAlert && (
        <div
          role="alert"
          data-testid="pilot-detail-alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{sideAlert.message}</span>
          <div className="flex gap-2">
            {sideAlert.isStale && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSideAlert(null);
                  void leadQuery.refetch();
                  void callsQuery.refetch();
                  void waMessagesQuery.refetch();
                  void activitiesQuery.refetch();
                  void leadFollowUpsQuery.refetch();
                }}
              >
                <RefreshCw className="size-3.5" />
                Reload latest
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setSideAlert(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-5">
          <div className="mb-2 border-b pb-5">
            <Identity
              name={lead.name}
              company={lead.company}
              className="[&_.identity-avatar]:size-14 [&_.identity-avatar]:text-lg"
            />
          </div>

          <section className="surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Details</h2>
              {!edit && !archived && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
              )}
            </div>
            {edit ? (
              <EditPilotLead lead={lead} onDone={() => setEdit(false)} />
            ) : (
              <dl className="grid gap-6 text-sm sm:grid-cols-3">
                {[
                  ["Phone", lead.phone],
                  ["Email", lead.email ?? "—"],
                  ["Source", lead.source],
                  ["Budget", formatINR(lead.budget)],
                  ["Quoted", formatINR(lead.quotedAmount)],
                  ["Score", lead.aiScore ?? "—"],
                  ["Last contact", relative(lead.lastContact)],
                  ["Next follow-up", lead.nextFollowUp ? formatDateTime(lead.nextFollowUp) : "—"],
                  ["Requirement", lead.requirement ?? "—"],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 break-words font-medium">{v}</dd>
                  </div>
                ))}
                {lead.lostReason && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs text-muted-foreground">Lost reason</dt>
                    <dd className="mt-0.5 font-medium text-destructive">{lead.lostReason}</dd>
                  </div>
                )}
                {lead.notes && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs text-muted-foreground">Notes</dt>
                    <dd className="mt-0.5 whitespace-pre-line">{lead.notes}</dd>
                  </div>
                )}
              </dl>
            )}

            {/* Server-Backed Tags Section */}
            <div className="mt-5 border-t pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Lead Tags
                </span>
                {!archived && (
                  <div className="relative">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setTagPickerOpen((o) => !o)}
                      className="h-6 px-2 text-[11px] gap-1 rounded-md"
                    >
                      <Plus className="size-3" /> Add Tag
                    </Button>
                    {tagPickerOpen && (
                      <div className="absolute right-0 top-7 z-20 w-48 rounded-lg border bg-popover p-1 shadow-md">
                        <div className="text-[10px] font-semibold text-muted-foreground px-2 py-1">
                          Select a tag to assign
                        </div>
                        {(() => {
                          const assignedIds = new Set(
                            leadTagsQuery.data?.tags.map((t) => t.id) ?? lead.tagIds,
                          );
                          const unassigned = (allTagsQuery.data?.items ?? []).filter(
                            (t) => t.status === "active" && !assignedIds.has(t.id),
                          );
                          if (unassigned.length === 0) {
                            return (
                              <div className="p-2 text-xs text-muted-foreground italic">
                                No unassigned tags
                              </div>
                            );
                          }
                          return unassigned.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={async () => {
                                try {
                                  await addTagMutation.mutateAsync(t.id);
                                  toast.success(`Tag "${t.name}" added`);
                                  setTagPickerOpen(false);
                                } catch (err) {
                                  toast.error(formatApiErrorMessage(err, "Failed to add tag"));
                                }
                              }}
                              className="flex w-full items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-muted text-left"
                            >
                              <span
                                className={cn("size-2 rounded-full", TAG_COLOR_DOTS[t.color])}
                              />
                              {t.name}
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {leadTagsQuery.isLoading ? (
                <div className="flex gap-2">
                  <div className="h-5 w-16 bg-muted rounded-full animate-pulse" />
                </div>
              ) : (leadTagsQuery.data?.tags ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5" data-testid="lead-tags-container">
                  {leadTagsQuery.data!.tags.map((t) => {
                    const style = TAG_COLOR_BADGES[t.color] ?? TAG_COLOR_BADGES.graphite;
                    return (
                      <span
                        key={t.id}
                        data-testid={`lead-tag-chip-${t.id}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                          style,
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", TAG_COLOR_DOTS[t.color])} />
                        {t.name}
                        {!archived && (
                          <button
                            type="button"
                            aria-label={`Remove tag ${t.name}`}
                            onClick={async () => {
                              try {
                                await removeTagMutation.mutateAsync(t.id);
                                toast.success(`Tag "${t.name}" removed`);
                              } catch (err) {
                                toast.error(formatApiErrorMessage(err, "Failed to remove tag"));
                              }
                            }}
                            className="hover:text-destructive p-0.5"
                          >
                            <XCircle className="size-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No tags assigned to this lead.
                </p>
              )}
            </div>

            {/* Server-Backed Custom Fields Section */}
            <div className="mt-5 border-t pt-4 space-y-3">
              {(() => {
                const activeFields = (customFieldsQuery.data?.items ?? []).filter(
                  (f) => f.status === "active",
                );
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Custom Information ({activeFields.length} field
                        {activeFields.length === 1 ? "" : "s"})
                      </span>
                      {!archived && activeFields.length > 0 && !editingCustomFields && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCustomFieldsDraft(
                              leadCustomFieldsQuery.data?.values ?? lead.fieldValues ?? {},
                            );
                            setCustomFieldsError(null);
                            setEditingCustomFields(true);
                          }}
                          className="h-6 px-2 text-[11px] gap-1 rounded-md"
                        >
                          <Pencil className="size-3" /> Edit Fields
                        </Button>
                      )}
                    </div>

                    {customFieldsQuery.isLoading || leadCustomFieldsQuery.isLoading ? (
                      <div className="space-y-2">
                        <div className="h-6 w-full bg-muted rounded animate-pulse" />
                        <div className="h-6 w-full bg-muted rounded animate-pulse" />
                      </div>
                    ) : activeFields.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic flex items-center justify-between">
                        <span>No custom fields configured yet.</span>
                        <Link
                          to="/crm-config"
                          search={pilotLinkSearch()}
                          className="text-primary underline font-medium"
                        >
                          Configure Custom Fields
                        </Link>
                      </div>
                    ) : editingCustomFields ? (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setCustomFieldsError(null);
                          try {
                            await setLeadCustomFieldsMutation.mutateAsync(customFieldsDraft);
                            toast.success("Custom fields saved to MariaDB");
                            setEditingCustomFields(false);
                          } catch (err) {
                            setCustomFieldsError(
                              formatApiErrorMessage(err, "Failed to save custom fields"),
                            );
                          }
                        }}
                        className="space-y-3 pt-1"
                      >
                        {customFieldsError && (
                          <div className="p-2.5 rounded border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                            {customFieldsError}
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                          {activeFields.map((f) => (
                            <div
                              key={f.id}
                              className={cn(
                                "space-y-1",
                                (f.type === "longtext" || f.type === "multiselect") &&
                                  "sm:col-span-2",
                              )}
                            >
                              <Label
                                htmlFor={`cf-input-${f.id}`}
                                className="text-xs font-medium flex items-center gap-1"
                              >
                                {f.label}
                                {f.required && <span className="text-destructive">*</span>}
                                {f.visibility === "owner" && (
                                  <Lock
                                    className="size-2.5 text-muted-foreground"
                                    aria-label="Owner only"
                                  />
                                )}
                              </Label>
                              <CustomFieldValueInput
                                field={f}
                                value={customFieldsDraft[f.id]}
                                onChange={(val) =>
                                  setCustomFieldsDraft((prev) => ({ ...prev, [f.id]: val }))
                                }
                              />
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingCustomFields(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={setLeadCustomFieldsMutation.isPending}
                          >
                            {setLeadCustomFieldsMutation.isPending
                              ? "Saving..."
                              : "Save Custom Fields"}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <dl className="grid gap-3 text-xs sm:grid-cols-2">
                        {activeFields.map((f) => {
                          const rawVal =
                            leadCustomFieldsQuery.data?.values?.[f.id] ?? lead.fieldValues?.[f.id];
                          return (
                            <div key={f.id} data-testid={`lead-custom-field-${f.id}`}>
                              <dt className="text-muted-foreground flex items-center gap-1">
                                {f.label}
                                {f.visibility === "owner" && (
                                  <Lock
                                    className="size-2.5 text-muted-foreground"
                                    aria-label="Owner only"
                                  />
                                )}
                              </dt>
                              <dd className="font-medium mt-0.5 break-words">
                                {formatCustomFieldValue(f, rawVal)}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </>
                );
              })()}
            </div>
          </section>

          {/* Active Lead Relationships */}
          <div data-testid="pilot-lead-relationships-section">
            <PilotLeadRelationshipsCard leadId={id} />
          </div>

          <section className="surface p-5" data-testid="pilot-lead-calls-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Calls (MariaDB)</h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  User-recorded
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="num">
                  {callSummary.total} total · {callSummary.connected} connected ·{" "}
                  {callSummary.attempts} {callSummary.attempts === 1 ? "attempt" : "attempts"}
                </span>
                {!archived && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-3 text-xs"
                    onClick={() => openLogOnly(lead, "Lead detail")}
                  >
                    <PhoneCall className="size-3" />
                    Log call
                  </Button>
                )}
              </div>
            </div>

            {callsQuery.isLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            ) : callsQuery.isError ? (
              <div role="alert" className="grid gap-2 text-xs text-destructive">
                <span>{formatApiErrorMessage(callsQuery.error, "Failed to load call logs.")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void callsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : callItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No calls logged yet. Clicking Call opens your device dialer; call logs are saved
                only after you pick an outcome and save.
              </p>
            ) : (
              <ol className="grid gap-2.5 text-sm">
                {callItems.map((c) => (
                  <li key={c.id} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{c.outcome}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                            c.connected
                              ? "bg-success-soft text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {c.connected ? "Connected" : "Attempt"}
                        </span>
                        {c.stageBefore !== c.stageAfter && (
                          <span className="text-xs text-muted-foreground">
                            {STATUS_LABEL[c.stageBefore]} → {STATUS_LABEL[c.stageAfter]}
                          </span>
                        )}
                      </div>
                      <span className="num text-xs text-muted-foreground">
                        {c.dialSource} · {formatDateTime(c.at)}
                      </span>
                    </div>
                    {c.notes && (
                      <p className="mt-1.5 whitespace-pre-line break-words text-xs text-muted-foreground">
                        {c.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="surface p-5" data-testid="pilot-lead-whatsapp-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">WhatsApp (MariaDB)</h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  Owner-confirmed sent
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="num">
                  {waTotal} {waTotal === 1 ? "confirmed message" : "confirmed messages"}
                </span>
                {!archived && (
                  <PilotWhatsAppButton
                    lead={lead}
                    composerSource="Lead detail"
                    onOpenComposer={openWhatsAppComposer}
                    className="h-7 rounded-full px-3 text-xs"
                  />
                )}
              </div>
            </div>

            {waMessagesQuery.isLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            ) : waMessagesQuery.isError ? (
              <div role="alert" className="grid gap-2 text-xs text-destructive">
                <span>
                  {formatApiErrorMessage(waMessagesQuery.error, "Failed to load WhatsApp logs.")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void waMessagesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : waItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No confirmed WhatsApp messages logged yet. Opening WhatsApp does not log
                automatically — records save only when you confirm the message was sent.
              </p>
            ) : (
              <ol className="grid gap-2.5 text-sm">
                {waItems.map((m) => (
                  <li key={m.id} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{WA_LABEL[m.purpose]}</span>
                        {m.templateName && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {m.templateName}
                          </span>
                        )}
                        <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                          Owner-confirmed sent
                        </span>
                      </div>
                      <span className="num text-xs text-muted-foreground">
                        {m.composerSource} · {formatDateTime(m.confirmedAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line break-words text-xs text-muted-foreground">
                      {m.messageText}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Activity (MariaDB)</h2>
            {!archived ? (
              <form
                noValidate
                onSubmit={submitActivity}
                className="mb-5 grid gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="detail-act-type" className="text-xs text-muted-foreground">
                    Manual activity type
                  </Label>
                  <select
                    id="detail-act-type"
                    className={`${selectCls} h-8 text-xs`}
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
                  aria-label="Activity details"
                  rows={3}
                  maxLength={5000}
                  value={actText}
                  disabled={createActivityMutation.isPending}
                  onChange={(e) => {
                    setActText(e.target.value);
                    actIdemKeyRef.current = createIdempotencyKey();
                    if (actError) setActError(null);
                  }}
                  placeholder={`Record a ${ACTIVITY_TYPE_LABEL[actType].toLowerCase()} summary for ${lead.name}…`}
                />
                {actError && (
                  <p role="alert" className="text-xs text-destructive">
                    {actError}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Allowed in B2B1: Note, Meeting, Email (max 5000 chars)</span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!actText.trim() || createActivityMutation.isPending}
                  >
                    {createActivityMutation.isPending
                      ? "Saving…"
                      : `Save ${ACTIVITY_TYPE_LABEL[actType].toLowerCase()}`}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="mb-4 text-xs text-muted-foreground">
                Restore this lead to record new manual activities.
              </p>
            )}

            {activitiesQuery.isError ? (
              <div role="alert" className="text-xs text-destructive">
                {formatApiErrorMessage(activitiesQuery.error, "Failed to load activity timeline.")}
              </div>
            ) : (
              <ol className="relative grid gap-4 border-l pl-5">
                {acts.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                    <div className="whitespace-pre-line break-words">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
                        {a.type}
                      </span>
                      {a.text}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(a.at)}</div>
                  </li>
                ))}
                {!activitiesQuery.isLoading && acts.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    No server activity recorded yet.
                  </li>
                )}
              </ol>
            )}
          </section>
        </div>

        <div className="grid content-start gap-5">
          <section className="surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Stage</h2>
              <PriorityBadge p={lead.priority} />
            </div>
            <select
              aria-label="Stage"
              disabled={archived || updateMutation.isPending}
              className={`${selectCls} w-full`}
              value={lead.status}
              onChange={(e) => handleStageChange(e.target.value as LeadStatusApi)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>

            <h3 className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">
              Quick status <span className="font-normal">(does not change stage)</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_STATUSES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={archived || updateMutation.isPending}
                  aria-pressed={lead.quickStatus === q}
                  onClick={() =>
                    void runSidePatch(
                      { quickStatus: lead.quickStatus === q ? null : (q as QuickStatusApi) },
                      lead.quickStatus === q
                        ? "Quick status cleared"
                        : `Quick status set to ${QUICK_LABEL[q]}`,
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    lead.quickStatus === q
                      ? "border-primary bg-primary-soft text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {QUICK_LABEL[q]}
                </button>
              ))}
            </div>

            {staleCount !== undefined && (
              <p className="mt-3 rounded-lg bg-warning/15 p-2 text-xs text-warning">
                Stale — no contact for {staleCount} days and no upcoming follow-up.
              </p>
            )}

            {!archived && (
              <div className="mt-4 flex gap-2 border-t pt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setArchiveError(null);
                    setArchiveKind("waste");
                  }}
                >
                  Move to Waste
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-destructive"
                  onClick={() => {
                    setArchiveError(null);
                    setArchiveKind("deleted");
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
          </section>

          <section className="surface p-5" data-testid="pilot-lead-followups-panel">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Follow-ups (MariaDB)</h2>
              <Link
                to="/follow-ups"
                search={pilotLinkSearch()}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Agenda
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>

            {leadFollowUpsQuery.isLoading ? (
              <div className="h-20 animate-pulse rounded-lg bg-muted" />
            ) : leadFollowUpsQuery.isError ? (
              <div role="alert" className="grid gap-2 text-xs text-destructive">
                <span>
                  {formatApiErrorMessage(
                    leadFollowUpsQuery.error,
                    "Failed to load follow-ups for this lead.",
                  )}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void leadFollowUpsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : activeFollowUp ? (
              <div
                data-testid="pilot-detail-active-fu"
                className="grid gap-2 rounded-lg border bg-card p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="fu-type">{FOLLOWUP_LABEL[activeFollowUp.type]}</span>
                  <span className="num text-[11px] text-muted-foreground">
                    v{activeFollowUp.version}
                  </span>
                </div>
                <div className="num text-sm font-semibold">
                  {formatDateTime(activeFollowUp.dueAt)}
                </div>
                {activeFollowUp.note && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {activeFollowUp.note}
                  </p>
                )}
                {!archived ? (
                  <div className="mt-1 flex flex-wrap gap-1.5 border-t pt-2.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full px-2.5 text-xs"
                      disabled={fuBusy}
                      onClick={() => setFuEditTarget(activeFollowUp)}
                    >
                      <CalendarSync className="size-3" />
                      Edit / Reschedule
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-full px-2.5 text-xs"
                      disabled={fuBusy}
                      onClick={() => void moveLeadFollowUpTomorrow(activeFollowUp)}
                    >
                      <SunMedium className="size-3" />
                      Tomorrow {formatIstTimeLabel(activeFollowUp.dueAt)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-full px-2.5 text-xs text-destructive"
                      disabled={fuBusy}
                      onClick={() => setFuCancelTarget(activeFollowUp)}
                    >
                      <XCircle className="size-3" />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto h-7 rounded-full px-2.5 text-xs"
                      disabled={fuBusy}
                      onClick={() => void completeLeadFollowUp(activeFollowUp)}
                    >
                      <Check className="size-3" />
                      Complete
                    </Button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Archived lead — restore to modify or complete this follow-up.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border p-3 text-xs">
                <p className="text-muted-foreground">No active follow-up scheduled.</p>
                {!archived && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 rounded-full px-3 text-xs"
                    onClick={() => setFuScheduleOpen(true)}
                  >
                    <CalendarPlus className="size-3" />
                    Schedule follow-up
                  </Button>
                )}
              </div>
            )}

            {pastFollowUps.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Recent follow-up history ({pastFollowUps.length})
                </h3>
                <ul className="grid gap-2 text-xs">
                  {pastFollowUps.slice(0, 6).map((pf) => (
                    <li key={pf.id} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-medium">
                          {FOLLOWUP_LABEL[pf.type]} ·{" "}
                          <span className="num">
                            {formatDateTime(pf.completedAt ?? pf.cancelledAt ?? pf.dueAt)}
                          </span>
                        </span>
                        <span
                          className={`fu-flag ${
                            pf.status === "completed" ? "is-done" : "is-muted"
                          }`}
                        >
                          {pf.status === "completed"
                            ? "Done"
                            : pf.replacedBy
                              ? "Replaced"
                              : "Cancelled"}
                        </span>
                      </div>
                      {pf.note && (
                        <p className="mt-1 line-clamp-2 text-muted-foreground">{pf.note}</p>
                      )}
                      {pf.cancelReason && (
                        <p className="mt-1 text-muted-foreground">Reason: {pf.cancelReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="surface p-5" data-testid="pilot-lead-quotations-panel">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Quotations (MariaDB)</h2>
                {leadQuotations.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {leadQuotations.length}
                  </span>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 rounded-full text-xs"
                disabled={archived}
                onClick={() => setNewQuoteOpen(true)}
              >
                <Plus className="size-3.5" />
                New Quote
              </Button>
            </div>

            {leadQuotationsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading quotations…</p>
            ) : leadQuotationsQuery.isError ? (
              <p className="text-xs text-destructive">
                Failed to load quotations: {formatApiErrorMessage(leadQuotationsQuery.error)}
              </p>
            ) : leadQuotations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  No proposals or quotations created for this lead yet.
                </p>
                {!archived && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2 text-xs text-primary"
                    onClick={() => setNewQuoteOpen(true)}
                  >
                    + Create First Proposal
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                {leadQuotations.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuoteId(q.id)}
                    className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-muted-foreground">
                        {q.quotationNumber}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          q.status === "accepted" && "bg-emerald-500/10 text-emerald-500",
                          q.status === "sent" && "bg-blue-500/10 text-blue-500",
                          q.status === "draft" && "bg-amber-500/10 text-amber-500",
                          q.status === "rejected" && "bg-rose-500/10 text-rose-500",
                        )}
                      >
                        {q.status}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-foreground line-clamp-1">
                      {q.title}
                    </div>
                    <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                      <span>
                        {q.items?.length ?? 0} item{(q.items?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {formatINR(q.totalAmount)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {mailtoHref(lead.email) && (
            <Button variant="outline" asChild>
              <a href={mailtoHref(lead.email)!}>
                <Mail className="size-4" />
                Email {lead.email}
              </a>
            </Button>
          )}
        </div>
      </div>

      <PilotLostReasonDialog
        open={lostOpen}
        leadName={lead.name}
        pending={updateMutation.isPending}
        errorMessage={lostError}
        onCancel={() => {
          setLostOpen(false);
          setLostError(null);
        }}
        onConfirm={(reason) => void handleConfirmLost(reason)}
      />

      <PilotArchiveDialog
        open={Boolean(archiveKind)}
        kind={archiveKind ?? "waste"}
        leadName={lead.name}
        pending={archiveMutation.isPending}
        errorMessage={archiveError}
        onCancel={() => {
          setArchiveKind(null);
          setArchiveError(null);
        }}
        onConfirm={(reason) => void handleConfirmArchive(reason)}
      />

      <PilotScheduleFollowUpDialog
        open={fuScheduleOpen}
        onOpenChange={setFuScheduleOpen}
        leadId={lead.id}
        leadName={lead.name}
        leadCompany={lead.company}
      />

      <PilotEditFollowUpDialog
        followUp={fuEditTarget}
        leadName={lead.name}
        onOpenChange={(o) => !o && setFuEditTarget(null)}
      />

      <PilotCancelFollowUpDialog
        followUp={fuCancelTarget}
        leadName={lead.name}
        onOpenChange={(o) => !o && setFuCancelTarget(null)}
      />

      <PilotNewQuotationDialog
        open={newQuoteOpen}
        onOpenChange={setNewQuoteOpen}
        preselectedLeadId={lead.id}
        onCreated={(id) => {
          setSelectedQuoteId(id);
        }}
      />

      <PilotQuotationDetailDrawer
        quotationId={selectedQuoteId}
        onClose={() => setSelectedQuoteId(null)}
      />

      <PilotCallDialog target={callTarget} onClose={closeCall} />
      <PilotWhatsAppDialog target={waTarget} onClose={closeWhatsApp} />
    </PilotShell>
  );
}

function EditPilotLead({ lead, onDone }: { lead: LeadDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateLeadMutation();

  const [start, setStart] = useState<Record<string, string>>(() => formOf(lead));
  const [baseVersion, setBaseVersion] = useState<number>(() => lead.version);
  const [f, setF] = useState<Record<string, string>>(() => formOf(lead));
  const [conflictLatest, setConflictLatest] = useState<LeadDto | null>(null);
  const [review, setReview] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [dupConflict, setDupConflict] = useState<DuplicateLeadConflict | null>(null);
  const [allowDupEmail, setAllowDupEmail] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const editIdemKeyRef = useRef<string>(createIdempotencyKey());

  const mine = changedKeys(start, f);
  const latestLead = conflictLatest ?? (lead.version !== baseVersion ? lead : null);
  const latestMap = latestLead ? formOf(latestLead) : null;
  const stale = Boolean(latestLead && latestLead.version !== baseVersion);
  const theirs = stale && latestMap ? externalKeys(start, latestMap) : [];

  const blocker = useBlocker({
    shouldBlockFn: () => mine.length > 0,
    enableBeforeUnload: () => mine.length > 0,
    withResolver: true,
  });

  const setField = (k: string) => (e: { target: { value: string } }) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    if (errs[k]) {
      setErrs((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
    if (k === "phone" || k === "email") {
      setDupConflict(null);
      setAllowDupEmail(false);
    }
    setSubmitError(null);
    editIdemKeyRef.current = createIdempotencyKey();
  };

  const keepMyDraft = () => {
    if (!latestLead || !latestMap) return;
    setF(rebaseDraft(start, f, latestMap));
    setStart(latestMap);
    setBaseVersion(latestLead.version);
    setConflictLatest(null);
    setReview(false);
    setSubmitError(null);
    editIdemKeyRef.current = createIdempotencyKey();
    toast(
      `Draft rebased onto server v${latestLead.version} — untouched fields updated, your edits preserved`,
    );
  };

  const reloadRecord = () => {
    if (!latestLead || !latestMap) return;
    setF(latestMap);
    setStart(latestMap);
    setBaseVersion(latestLead.version);
    setConflictLatest(null);
    setReview(false);
    setErrs({});
    setDupConflict(null);
    setSubmitError(null);
    editIdemKeyRef.current = createIdempotencyKey();
    toast(`Loaded latest saved lead (v${latestLead.version})`);
  };

  const handleCancel = () => {
    if (mine.length > 0) {
      setAskDiscard(true);
    } else {
      onDone();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (updateMutation.isPending) return;

    if (stale) {
      setReview(true);
      setSubmitError("This lead changed on the server. Review or rebase your draft before saving.");
      return;
    }

    if (mine.length === 0) {
      onDone();
      return;
    }

    const nextErrs: Record<string, string> = {};
    if (!f["name"]?.trim()) nextErrs["name"] = "Name is required";
    if (!validPhone(f["phone"] ?? "")) nextErrs["phone"] = "Enter a valid 10-digit mobile number";
    if ((f["email"] ?? "").trim() && !validEmail((f["email"] ?? "").trim())) {
      nextErrs["email"] = "Invalid email";
    }
    const bErr = amountFieldError(f["budget"] ?? "");
    const qErr = amountFieldError(f["quotedAmount"] ?? "");
    if (bErr) nextErrs["budget"] = bErr;
    if (qErr) nextErrs["quotedAmount"] = qErr;

    setErrs(nextErrs);
    if (Object.keys(nextErrs).length > 0) {
      const firstBad = (["name", "phone", "email", "budget", "quotedAmount"] as const).find(
        (k) => nextErrs[k],
      );
      if (firstBad) {
        requestAnimationFrame(() => document.getElementById(`pilot-edit-${firstBad}`)?.focus());
      }
      return;
    }

    const patch: Record<string, unknown> = {
      version: baseVersion,
    };

    for (const k of mine) {
      const val = (f[k] ?? "").trim();
      if (k === "budget" || k === "quotedAmount") {
        patch[k] = val === "" ? null : Number(val);
      } else if (k === "email" || k === "company" || k === "requirement" || k === "notes") {
        patch[k] = val === "" ? null : val;
      } else if (k === "source") {
        patch[k] = f[k] as LeadSourceApi;
      } else if (k === "priority") {
        patch[k] = f[k] as LeadPriorityApi;
      } else {
        patch[k] = val;
      }
    }

    if (allowDupEmail) {
      patch["allowDuplicate"] = true;
    }

    setSubmitError(null);

    try {
      await updateMutation.mutateAsync({
        id: lead.id,
        payload: patch as never,
        idempotencyKey: editIdemKeyRef.current,
      });
      toast.success("Lead updated in MariaDB");
      onDone();
    } catch (err) {
      const staleInfo = extractStaleConflict(err);
      if (staleInfo) {
        try {
          const fresh = await getLead(lead.id);
          queryClient.setQueryData(leadKeys.detail(lead.id), fresh);
          setConflictLatest(fresh);
          setReview(true);
        } catch {
          setSubmitError(formatApiErrorMessage(err));
          return;
        }
        setSubmitError(
          "This lead was modified in another session. Review the latest values, rebase your draft, or reload.",
        );
        return;
      }

      const dup = extractDuplicateLeadConflict(err);
      if (dup) {
        setDupConflict(dup);
        setSubmitError(
          dup.matchReasons.includes("phone")
            ? "Another active lead already uses this phone number. Phone collisions cannot be duplicated on edit."
            : "Another active lead already uses this email address.",
        );
        return;
      }

      const serverFieldErrs = extractFieldValidationErrors(err);
      if (Object.keys(serverFieldErrs).length > 0) {
        setErrs(serverFieldErrs);
      }
      setSubmitError(formatApiErrorMessage(err, "Save failed. Your draft edits remain intact."));
    }
  };

  const renderField = (k: string, label: string, type = "text") => {
    const er = errs[k];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`pilot-edit-${k}`}>{label}</Label>
        <Input
          id={`pilot-edit-${k}`}
          type={type}
          value={f[k] ?? ""}
          onChange={setField(k)}
          disabled={updateMutation.isPending}
          aria-invalid={er ? true : undefined}
          aria-describedby={er ? `pilot-edit-${k}-error` : undefined}
        />
        {er && (
          <p id={`pilot-edit-${k}-error`} className="text-xs text-destructive" role="alert">
            {er}
          </p>
        )}
      </div>
    );
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      {stale && latestLead && latestMap && (
        <div
          role="alert"
          data-testid="pilot-stale-conflict"
          className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2"
        >
          <p className="font-medium">
            Stale version (v{baseVersion} vs server v{latestLead.version}): another session updated
            this lead.
          </p>
          <p className="text-xs text-muted-foreground">
            Your draft is safe and nothing has been saved yet.
          </p>
          {review && (
            <ul className="grid gap-1 text-xs" aria-label="Latest server changes">
              {theirs.length === 0 && (
                <li className="text-muted-foreground">
                  Fields outside this form changed (such as stage, pin, or follow-up metadata).
                </li>
              )}
              {theirs.map((k) => (
                <li key={k}>
                  <span className="font-medium">{FIELD_LABEL[k] ?? k}</span>: {start[k] || "—"} →{" "}
                  <span className="font-medium">{latestMap[k] || "—"}</span>
                  {mine.includes(k) && (
                    <span className="text-warning"> (your draft: {f[k] || "—"})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setReview((r) => !r)}>
              {review ? "Hide latest" : "Review latest"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={keepMyDraft}>
              Keep my draft
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reloadRecord}>
              Reload record
            </Button>
          </div>
        </div>
      )}

      {dupConflict && (
        <div
          role="alert"
          data-testid="pilot-edit-duplicate"
          className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs sm:col-span-2"
        >
          <p className="font-medium text-warning">
            {dupConflict.matchReasons.includes("phone")
              ? "Active phone collision — cannot change phone onto another active lead's number."
              : "Active email collision detected."}
          </p>
          <ul className="grid gap-1">
            {dupConflict.matches.map((m) => (
              <li key={m.id}>
                <b>{m.name}</b> · {m.phone}
                {m.email ? ` · ${m.email}` : ""}
              </li>
            ))}
          </ul>
          {!dupConflict.matchReasons.includes("phone") && (
            <label className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
              <input
                type="checkbox"
                checked={allowDupEmail}
                onChange={(e) => {
                  setAllowDupEmail(e.target.checked);
                  editIdemKeyRef.current = createIdempotencyKey();
                }}
              />
              Allow duplicate email address on save
            </label>
          )}
        </div>
      )}

      {submitError && !stale && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive sm:col-span-2"
        >
          {submitError}
        </div>
      )}

      {renderField("name", "Name")}
      {renderField("phone", "Phone")}
      {renderField("email", "Email", "email")}
      {renderField("company", "Company")}
      <div className="sm:col-span-2">{renderField("requirement", "Requirement")}</div>
      {renderField("budget", "Budget (₹)", "number")}
      {renderField("quotedAmount", "Quoted (₹)", "number")}

      <div className="grid gap-1.5">
        <Label htmlFor="pilot-edit-source">Source</Label>
        <select
          id="pilot-edit-source"
          className={selectCls}
          value={f["source"]}
          onChange={setField("source")}
          disabled={updateMutation.isPending}
        >
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pilot-edit-priority">Priority</Label>
        <select
          id="pilot-edit-priority"
          className={selectCls}
          value={f["priority"]}
          onChange={setField("priority")}
          disabled={updateMutation.isPending}
        >
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
      </div>

      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="pilot-edit-notes">Notes</Label>
        <Textarea
          id="pilot-edit-notes"
          value={f["notes"]}
          onChange={setField("notes")}
          disabled={updateMutation.isPending}
        />
      </div>

      {askDiscard && (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2"
        >
          <p className="font-medium">Discard unsaved changes?</p>
          <p className="text-xs text-muted-foreground">
            Your edits haven&apos;t been saved to the server.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" autoFocus onClick={() => setAskDiscard(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => {
                setAskDiscard(false);
                setF(start);
                onDone();
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleCancel}
          disabled={updateMutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Dialog open={blocker.status === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            Your unsaved edits on {lead.name} have not been saved to the server.
          </DialogDescription>
          <DialogFooter>
            <Button type="button" autoFocus onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              onClick={() => blocker.proceed?.()}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
