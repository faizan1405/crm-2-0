import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Database,
  History,
  Info,
  Laptop,
  Moon,
  RefreshCw,
  RotateCw,
  Shield,
  SlidersHorizontal,
  Sun,
  Target,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PilotShell } from "./PilotShell";
import { selectCls } from "@/components/crm/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { logoutOwner, useResolvedAuthState } from "@/lib/auth/authClient";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import {
  DEFAULT_LEAD_SORTS_API,
  type DefaultLeadSortApi,
  type OwnerSettingsDto,
  type SettingsAuditSectionApi,
} from "@/lib/api/schemas";
import {
  extractForbiddenSettingKey,
  extractSettingsOrGoalFieldErrors,
  extractStaleConflict,
  formatApiErrorMessage,
} from "@/lib/api/errors";
import {
  DEFAULT_LEAD_SORT_LABELS,
  SETTINGS_AUDIT_SECTION_LABELS,
  SETTINGS_FIELD_LABELS,
  buildSettingsDiffPayload,
  clientValidateSettingsDraft,
  clientValidateSettingsField,
  createIdempotencyKey,
  dtoToSettingsDraft,
  getOwnerSettings,
  useOwnerSettingsQuery,
  useSettingsAuditQuery,
  useSettingsDefinitionsQuery,
  useUpdateOwnerSettingsMutation,
  type SettingsFormDraft,
} from "@/lib/api/settingsApi";
import { formatDateTime, initials } from "@/lib/crm/format";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "profile", label: "Profile & business", icon: User, serverForm: true },
  { id: "crm", label: "Regional & CRM", icon: SlidersHorizontal, serverForm: true },
  { id: "notifications", label: "Notifications & goals", icon: Bell, serverForm: true },
  { id: "history", label: "Change history", icon: History, serverForm: false },
  { id: "device", label: "Device preferences", icon: Laptop, serverForm: false },
  { id: "security", label: "Security & sessions", icon: Shield, serverForm: false },
  { id: "data", label: "Boundaries & backup", icon: Database, serverForm: false },
] as const;

type SettingsSectionId = (typeof SECTIONS)[number]["id"];

const EMPTY_DRAFT: SettingsFormDraft = {
  ownerDisplayName: "",
  businessName: "",
  profileEmail: "",
  businessPhone: "",
  businessWebsite: "",
  businessAddress: "",
  gstin: "",
  paymentInstructions: "",
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
  notifyGoalAchieved: true,
  notifyTeamGoal: true,
  notifyMilestone: false,
  notifyOverdue: true,
  overdueThreshold: "10",
};

const FIELD_TO_SECTION: Record<string, SettingsSectionId> = {
  ownerDisplayName: "profile",
  businessName: "profile",
  profileEmail: "profile",
  businessPhone: "profile",
  businessWebsite: "profile",
  businessAddress: "profile",
  gstin: "profile",
  paymentInstructions: "profile",
  defaultLeadSort: "crm",
  overdueThreshold: "notifications",
};

function formatAuditValue(val: unknown): string {
  if (val === null || val === undefined) return "Not configured";
  if (typeof val === "boolean") return val ? "Enabled" : "Disabled";
  return String(val);
}

export function PilotSettingsPage({
  search,
}: {
  search?: { section?: string | undefined; pilot?: 1 | 0 | undefined };
}) {
  const navigate = useNavigate();
  const { user: authUser, idleExpiresAt, expiresAt } = useResolvedAuthState();

  const initialSec: SettingsSectionId = SECTIONS.some((s) => s.id === search?.section)
    ? (search?.section as SettingsSectionId)
    : "profile";
  const [sec, setSec] = useState<SettingsSectionId>(initialSec);

  useEffect(() => {
    if (search?.section && SECTIONS.some((s) => s.id === search.section)) {
      setSec(search.section as SettingsSectionId);
    }
  }, [search?.section]);

  const settingsQ = useOwnerSettingsQuery();
  const defsQ = useSettingsDefinitionsQuery();
  const updateMut = useUpdateOwnerSettingsMutation();

  const [auditSection, setAuditSection] = useState<SettingsAuditSectionApi>("all");
  const [auditOffset, setAuditOffset] = useState(0);
  const auditQ = useSettingsAuditQuery(
    { section: auditSection, limit: 20, offset: auditOffset },
    sec === "history",
  );

  const [baseline, setBaseline] = useState<OwnerSettingsDto | null>(null);
  const [draft, setDraft] = useState<SettingsFormDraft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<{
    expectedVersion?: number | undefined;
    currentVersion?: number | undefined;
  } | null>(null);
  const [rebasing, setRebasing] = useState(false);
  const [savedBanner, setSavedBanner] = useState<{
    version: number;
    at: string;
    changed: boolean;
  } | null>(null);
  const [sessionBusy, setSessionBusy] = useState<"logout" | "logout-all" | null>(null);
  const [localDark, setLocalDark] = useState(false);

  const idemKeyRef = useRef<string>(createIdempotencyKey());
  const ownerNameRef = useRef<HTMLInputElement>(null);
  const businessNameRef = useRef<HTMLInputElement>(null);
  const profileEmailRef = useRef<HTMLInputElement>(null);
  const businessPhoneRef = useRef<HTMLInputElement>(null);
  const businessWebsiteRef = useRef<HTMLInputElement>(null);
  const businessAddressRef = useRef<HTMLTextAreaElement>(null);
  const gstinRef = useRef<HTMLInputElement>(null);
  const paymentInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const leadSortRef = useRef<HTMLSelectElement>(null);
  const overdueThresholdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Initialize draft once server settings load; never clobber unsaved edits on background refetch.
  useEffect(() => {
    const srv = settingsQ.data?.settings;
    if (!srv) return;
    if (!baseline) {
      setBaseline(srv);
      setDraft(dtoToSettingsDraft(srv));
      idemKeyRef.current = createIdempotencyKey();
    }
  }, [settingsQ.data?.settings, baseline]);

  const diff = useMemo(() => {
    if (!baseline) {
      return { hasChanges: false, changedKeys: [] as string[], payload: {} };
    }
    return buildSettingsDiffPayload(baseline, draft);
  }, [baseline, draft]);

  const isDirty = diff.hasChanges;

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });

  const updateField = <K extends keyof SettingsFormDraft>(key: K, value: SettingsFormDraft[K]) => {
    idemKeyRef.current = createIdempotencyKey();
    setSavedBanner(null);
    setSaveError(null);
    setConflictInfo(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleFieldBlur = (field: keyof SettingsFormDraft) => {
    const err = clientValidateSettingsField(field, draft);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const focusField = (field: string) => {
    const targetSec = FIELD_TO_SECTION[field];
    if (targetSec && targetSec !== sec) {
      setSec(targetSec);
    }
    const focusTarget = () => {
      const refMap: Record<string, { current: HTMLElement | null }> = {
        ownerDisplayName: ownerNameRef,
        businessName: businessNameRef,
        profileEmail: profileEmailRef,
        businessPhone: businessPhoneRef,
        businessWebsite: businessWebsiteRef,
        businessAddress: businessAddressRef,
        gstin: gstinRef,
        paymentInstructions: paymentInstructionsRef,
        defaultLeadSort: leadSortRef,
        overdueThreshold: overdueThresholdRef,
      };
      refMap[field]?.current?.focus();
    };
    requestAnimationFrame(focusTarget);
  };

  const handleReloadLatest = async (keepEdits: boolean) => {
    setRebasing(true);
    try {
      const res = await getOwnerSettings();
      const latest = res.settings;
      setBaseline(latest);
      setConflictInfo(null);
      setSaveError(null);
      idemKeyRef.current = createIdempotencyKey();
      if (keepEdits) {
        toast.info(
          `Rebased your unsaved edits onto server version v${latest.version}. Click Save settings to apply.`,
        );
      } else {
        setDraft(dtoToSettingsDraft(latest));
        setFieldErrors({});
        toast.success(`Reloaded server settings (v${latest.version}).`);
      }
    } catch (err) {
      setSaveError(formatApiErrorMessage(err, "Failed to reload latest settings from MariaDB."));
    } finally {
      setRebasing(false);
    }
  };

  const handleDiscardEdits = () => {
    if (!baseline) return;
    setDraft(dtoToSettingsDraft(baseline));
    setFieldErrors({});
    setSaveError(null);
    setConflictInfo(null);
    setSavedBanner(null);
    idemKeyRef.current = createIdempotencyKey();
    toast.info("Discarded unsaved edits.");
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseline) return;

    setSaveError(null);
    setConflictInfo(null);

    const clientErrors = clientValidateSettingsDraft(draft);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      const firstKey = Object.keys(clientErrors)[0];
      if (firstKey) focusField(firstKey);
      setSaveError("Fix the highlighted validation errors before saving to MariaDB.");
      return;
    }

    if (!diff.hasChanges) {
      setSavedBanner({
        version: baseline.version,
        at: baseline.updatedAt ?? new Date().toISOString(),
        changed: false,
      });
      toast.info("No changes to save — settings already match MariaDB.");
      return;
    }

    try {
      const method = baseline.configured ? "PATCH" : "PUT";
      const res = await updateMut.mutateAsync({
        method,
        idempotencyKey: idemKeyRef.current,
        payload: {
          ...diff.payload,
          expectedVersion: baseline.version,
          idempotencyKey: idemKeyRef.current,
        },
      });
      setBaseline(res.settings);
      setDraft(dtoToSettingsDraft(res.settings));
      setFieldErrors({});
      idemKeyRef.current = createIdempotencyKey();
      setSavedBanner({
        version: res.settings.version,
        at: res.settings.updatedAt ?? new Date().toISOString(),
        changed: res.changed,
      });
      toast.success(
        res.changed
          ? `Business settings saved to MariaDB (v${res.settings.version})`
          : "Settings already matched MariaDB",
      );
    } catch (err) {
      const stale = extractStaleConflict(err);
      if (stale) {
        setConflictInfo({
          expectedVersion: stale.expectedVersion ?? baseline.version,
          currentVersion: stale.currentVersion,
        });
        setSaveError(
          `Settings were modified elsewhere (your base was v${stale.expectedVersion ?? baseline.version}, server is v${stale.currentVersion ?? "newer"}).`,
        );
        return;
      }

      const forbiddenKey = extractForbiddenSettingKey(err);
      const mappedFields = extractSettingsOrGoalFieldErrors(err);
      if (Object.keys(mappedFields).length > 0) {
        setFieldErrors(mappedFields);
        const firstServerField = Object.keys(mappedFields).find((k) => k in FIELD_TO_SECTION);
        if (firstServerField) focusField(firstServerField);
      }

      setSaveError(
        forbiddenKey
          ? `Setting key '${forbiddenKey}' is server-protected and cannot be modified via Settings.`
          : formatApiErrorMessage(err, "Could not save Owner settings to MariaDB."),
      );
    }
  };

  const renderClearButton = (field: keyof SettingsFormDraft, value: string, label: string) =>
    value.trim().length > 0 ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground shrink-0"
        aria-label={`Clear ${label}`}
        onClick={() => updateField(field, "")}
      >
        <X className="size-3.5 mr-1" />
        Clear
      </Button>
    ) : (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
        Not configured
      </span>
    );

  const currentSecMeta = SECTIONS.find((s) => s.id === sec)!;
  const defs = defsQ.data?.definitions;
  const isServerFormSec = currentSecMeta.serverForm;

  const displayNameForHeader =
    baseline?.ownerDisplayName ?? authUser?.name ?? "Owner (unset in workspace profile)";
  const displayEmailForHeader =
    baseline?.profileEmail ?? authUser?.email ?? "No business contact email configured";

  return (
    <PilotShell
      title="Settings"
      subtitle="Owner business configuration in MariaDB · Device-local display stays on this browser"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild type="button" size="sm" variant="outline" className="rounded-lg gap-1.5">
            <Link to="/my-performance" search={pilotLinkSearch()}>
              <Target className="size-3.5" />
              Sales Goals
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg gap-1.5"
            disabled={settingsQ.isFetching}
            onClick={() => void handleReloadLatest(isDirty)}
          >
            <RotateCw className={cn("size-3.5", settingsQ.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      }
    >
      {settingsQ.isLoading && !baseline && (
        <div
          className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]"
          aria-label="Loading settings"
        >
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {settingsQ.error && !baseline && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              Failed to load Owner settings from MariaDB:{" "}
              {formatApiErrorMessage(settingsQ.error, "Unknown error.")}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void settingsQ.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {baseline && (
        <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto xl:flex-col">
            {SECTIONS.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                onClick={() => setSec(item.id)}
                aria-current={sec === item.id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 justify-start items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  sec === item.id
                    ? "bg-card font-medium text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Button>
            ))}
          </nav>

          <section className="settings-content surface p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{currentSecMeta.label}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {currentSecMeta.serverForm
                    ? baseline.configured
                      ? `MariaDB record v${baseline.version} · Last saved ${baseline.updatedAt ? formatDateTime(baseline.updatedAt) : "recently"}`
                      : "Server settings not initialized yet (v0). Unset fields remain unconfigured until you save."
                    : "Scoped view outside MariaDB business config fields."}
                </p>
              </div>
              {isServerFormSec && (
                <span className="pf-badge" data-status={baseline.configured ? "active" : undefined}>
                  {baseline.configured ? `MariaDB v${baseline.version}` : "Not configured (v0)"}
                </span>
              )}
            </div>

            {conflictInfo && (
              <div
                role="alert"
                className="rounded-xl border border-warning/40 bg-warning-soft p-3.5 text-xs text-foreground space-y-2"
              >
                <div className="flex items-start gap-2 font-medium">
                  <AlertCircle className="size-4 shrink-0 text-warning mt-0.5" />
                  <span>
                    Stale version conflict: your base version was v{conflictInfo.expectedVersion},
                    server version is v{conflictInfo.currentVersion ?? "newer"}.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={rebasing}
                    onClick={() => void handleReloadLatest(false)}
                  >
                    <RefreshCw className="size-3.5 mr-1" />
                    Reload server settings
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={rebasing}
                    onClick={() => void handleReloadLatest(true)}
                  >
                    Keep my edits & rebase
                  </Button>
                </div>
              </div>
            )}

            {saveError && !conflictInfo && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{saveError}</span>
              </div>
            )}

            {savedBanner && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft p-3 text-xs text-foreground"
              >
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
                <span>
                  {savedBanner.changed
                    ? `Confirmed saved to MariaDB (v${savedBanner.version}) at ${formatDateTime(savedBanner.at)}.`
                    : `Verified settings already match MariaDB (v${savedBanner.version}).`}
                </span>
              </div>
            )}

            {isDirty && !isServerFormSec && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/35 bg-warning-soft p-3 text-xs text-foreground">
                <span>
                  You have unsaved changes ({diff.changedKeys.length} field
                  {diff.changedKeys.length === 1 ? "" : "s"}:{" "}
                  {diff.changedKeys.map((k) => SETTINGS_FIELD_LABELS[k] ?? k).join(", ")}).
                </span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={handleDiscardEdits}>
                    Discard
                  </Button>
                  <Button type="button" size="sm" onClick={() => setSec("profile")}>
                    Review changes
                  </Button>
                </div>
              </div>
            )}

            {isServerFormSec && (
              <form noValidate onSubmit={(e) => void handleSaveSubmit(e)} className="space-y-4">
                {sec === "profile" && (
                  <div className="divide-y">
                    <div className="flex items-center gap-4 pb-4">
                      <div className="grid size-14 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                        {initials(displayNameForHeader)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{displayNameForHeader}</div>
                        <div className="text-sm text-muted-foreground truncate">
                          {baseline.businessName ?? "Business profile unset"} ·{" "}
                          {displayEmailForHeader}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-ownerDisplayName">Owner display name</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Shown in workspace headers & customer-facing docs.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={ownerNameRef}
                            id="set-ownerDisplayName"
                            value={draft.ownerDisplayName}
                            placeholder="Not configured"
                            aria-invalid={Boolean(fieldErrors["ownerDisplayName"])}
                            aria-describedby={
                              fieldErrors["ownerDisplayName"] ? "err-ownerDisplayName" : undefined
                            }
                            onChange={(e) => updateField("ownerDisplayName", e.target.value)}
                            onBlur={() => handleFieldBlur("ownerDisplayName")}
                          />
                          {renderClearButton(
                            "ownerDisplayName",
                            draft.ownerDisplayName,
                            "Owner display name",
                          )}
                        </div>
                        {fieldErrors["ownerDisplayName"] && (
                          <p id="err-ownerDisplayName" className="text-xs text-destructive">
                            {fieldErrors["ownerDisplayName"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-businessName">Business name</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Legal or trading studio name.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={businessNameRef}
                            id="set-businessName"
                            value={draft.businessName}
                            placeholder="Not configured"
                            aria-invalid={Boolean(fieldErrors["businessName"])}
                            aria-describedby={
                              fieldErrors["businessName"] ? "err-businessName" : undefined
                            }
                            onChange={(e) => updateField("businessName", e.target.value)}
                            onBlur={() => handleFieldBlur("businessName")}
                          />
                          {renderClearButton("businessName", draft.businessName, "Business name")}
                        </div>
                        {fieldErrors["businessName"] && (
                          <p id="err-businessName" className="text-xs text-destructive">
                            {fieldErrors["businessName"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-profileEmail">Business email</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Public contact email (normalized lowercase).
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={profileEmailRef}
                            id="set-profileEmail"
                            type="email"
                            value={draft.profileEmail}
                            placeholder="Not configured (e.g. billing@studio.in)"
                            aria-invalid={Boolean(fieldErrors["profileEmail"])}
                            aria-describedby={
                              fieldErrors["profileEmail"] ? "err-profileEmail" : undefined
                            }
                            onChange={(e) => updateField("profileEmail", e.target.value)}
                            onBlur={() => handleFieldBlur("profileEmail")}
                          />
                          {renderClearButton("profileEmail", draft.profileEmail, "Business email")}
                        </div>
                        {fieldErrors["profileEmail"] && (
                          <p id="err-profileEmail" className="text-xs text-destructive">
                            {fieldErrors["profileEmail"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-businessPhone">Business phone</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          7–15 digits for proposals & invoices.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={businessPhoneRef}
                            id="set-businessPhone"
                            type="tel"
                            value={draft.businessPhone}
                            placeholder="Not configured (e.g. +91 98765 43210)"
                            aria-invalid={Boolean(fieldErrors["businessPhone"])}
                            aria-describedby={
                              fieldErrors["businessPhone"] ? "err-businessPhone" : undefined
                            }
                            onChange={(e) => updateField("businessPhone", e.target.value)}
                            onBlur={() => handleFieldBlur("businessPhone")}
                          />
                          {renderClearButton(
                            "businessPhone",
                            draft.businessPhone,
                            "Business phone",
                          )}
                        </div>
                        {fieldErrors["businessPhone"] && (
                          <p id="err-businessPhone" className="text-xs text-destructive">
                            {fieldErrors["businessPhone"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-businessWebsite">Website</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Must use http:// or https://.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={businessWebsiteRef}
                            id="set-businessWebsite"
                            type="url"
                            value={draft.businessWebsite}
                            placeholder="Not configured (e.g. https://scaleflow.in)"
                            aria-invalid={Boolean(fieldErrors["businessWebsite"])}
                            aria-describedby={
                              fieldErrors["businessWebsite"] ? "err-businessWebsite" : undefined
                            }
                            onChange={(e) => updateField("businessWebsite", e.target.value)}
                            onBlur={() => handleFieldBlur("businessWebsite")}
                          />
                          {renderClearButton("businessWebsite", draft.businessWebsite, "Website")}
                        </div>
                        {fieldErrors["businessWebsite"] && (
                          <p id="err-businessWebsite" className="text-xs text-destructive">
                            {fieldErrors["businessWebsite"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-gstin">GSTIN</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Optional 15-character Indian GST registration ID.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={gstinRef}
                            id="set-gstin"
                            value={draft.gstin}
                            maxLength={15}
                            placeholder="Not configured (e.g. 27ABCDE1234F1Z5)"
                            aria-invalid={Boolean(fieldErrors["gstin"])}
                            aria-describedby={fieldErrors["gstin"] ? "err-gstin" : undefined}
                            onChange={(e) => updateField("gstin", e.target.value.toUpperCase())}
                            onBlur={() => handleFieldBlur("gstin")}
                          />
                          {renderClearButton("gstin", draft.gstin, "GSTIN")}
                        </div>
                        {fieldErrors["gstin"] && (
                          <p id="err-gstin" className="text-xs text-destructive">
                            {fieldErrors["gstin"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-businessAddress">Business address</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Registered office address (max 1,000 chars).
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <Textarea
                            ref={businessAddressRef}
                            id="set-businessAddress"
                            rows={2}
                            value={draft.businessAddress}
                            placeholder="Not configured"
                            aria-invalid={Boolean(fieldErrors["businessAddress"])}
                            aria-describedby={
                              fieldErrors["businessAddress"] ? "err-businessAddress" : undefined
                            }
                            onChange={(e) => updateField("businessAddress", e.target.value)}
                            onBlur={() => handleFieldBlur("businessAddress")}
                          />
                          {renderClearButton(
                            "businessAddress",
                            draft.businessAddress,
                            "Business address",
                          )}
                        </div>
                        {fieldErrors["businessAddress"] && (
                          <p id="err-businessAddress" className="text-xs text-destructive">
                            {fieldErrors["businessAddress"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-paymentInstructions">Payment instructions</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Non-secret remittance note (e.g. bank name & UPI handle). Secret tokens
                          are blocked by the server.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <Textarea
                            ref={paymentInstructionsRef}
                            id="set-paymentInstructions"
                            rows={3}
                            value={draft.paymentInstructions}
                            placeholder="Not configured (e.g. NEFT/UPI remittance steps)"
                            aria-invalid={Boolean(fieldErrors["paymentInstructions"])}
                            aria-describedby={
                              fieldErrors["paymentInstructions"]
                                ? "err-paymentInstructions"
                                : undefined
                            }
                            onChange={(e) => updateField("paymentInstructions", e.target.value)}
                            onBlur={() => handleFieldBlur("paymentInstructions")}
                          />
                          {renderClearButton(
                            "paymentInstructions",
                            draft.paymentInstructions,
                            "Payment instructions",
                          )}
                        </div>
                        {fieldErrors["paymentInstructions"] && (
                          <p id="err-paymentInstructions" className="text-xs text-destructive">
                            {fieldErrors["paymentInstructions"]}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {sec === "crm" && (
                  <div className="divide-y">
                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-center">
                      <div>
                        <Label htmlFor="set-timezone">Business timezone</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Locked invariant across analytics, follow-ups, and weekly Mon–Sun IST
                          goals.
                        </p>
                      </div>
                      <Input
                        id="set-timezone"
                        value={`${defs?.invariants.businessTimezone ?? baseline.businessTimezone} (IST · Read-only)`}
                        disabled
                      />
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-center">
                      <div>
                        <Label htmlFor="set-currency">Currency</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Exact integer paise accounting in INR.
                        </p>
                      </div>
                      <Input
                        id="set-currency"
                        value={`${defs?.invariants.currencyCode ?? baseline.currencyCode} (Indian Rupee ₹ · Read-only)`}
                        disabled
                      />
                    </div>

                    <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                      <div>
                        <Label htmlFor="set-defaultLeadSort">Default lead sort</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Server-persisted Owner default ordering preference.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <select
                          ref={leadSortRef}
                          id="set-defaultLeadSort"
                          className={selectCls}
                          value={draft.defaultLeadSort}
                          aria-invalid={Boolean(fieldErrors["defaultLeadSort"])}
                          onChange={(e) =>
                            updateField("defaultLeadSort", e.target.value as DefaultLeadSortApi)
                          }
                          onBlur={() => handleFieldBlur("defaultLeadSort")}
                        >
                          {(defs?.defaultLeadSortOptions ?? DEFAULT_LEAD_SORTS_API).map((opt) => (
                            <option key={opt} value={opt}>
                              {DEFAULT_LEAD_SORT_LABELS[opt]}
                            </option>
                          ))}
                        </select>
                        {fieldErrors["defaultLeadSort"] && (
                          <p className="text-xs text-destructive">
                            {fieldErrors["defaultLeadSort"]}
                          </p>
                        )}
                      </div>
                    </div>

                    {defs && (
                      <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                        <div>
                          <div className="text-sm font-medium">Protected CRM stages & sources</div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Fixed server definitions (cannot be altered via Settings).
                          </p>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex flex-wrap gap-1.5">
                            {defs.leadStatuses.map((st) => (
                              <span key={st} className="pf-badge">
                                {st}
                              </span>
                            ))}
                          </div>
                          <div className="text-muted-foreground">
                            Sources: {defs.leadSources.join(", ")}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {sec === "notifications" && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 rounded-xl border bg-muted/35 p-3 text-xs text-muted-foreground">
                      <Info className="size-4 shrink-0 mt-0.5 text-primary" />
                      <span>
                        Alert preferences below are saved to MariaDB when you click{" "}
                        <b>Save settings</b>. Outbound email/push delivery channels are not active
                        yet in this environment.
                      </span>
                    </div>

                    <div className="divide-y">
                      {(
                        [
                          [
                            "notifyFollowUps",
                            "Follow-up reminders",
                            "Flag upcoming scheduled follow-ups",
                          ],
                          [
                            "notifyPayments",
                            "Payment alerts",
                            "Highlight overdue installment payments",
                          ],
                          ["notifyDigest", "Morning digest", "Daily Briefing summary at 9 AM IST"],
                          [
                            "notifyGoalAchieved",
                            "Goal achieved alerts",
                            "Surface notice when a measurable Sales Goal hits 100%",
                          ],
                          [
                            "notifyTeamGoal",
                            "Team goal alerts",
                            "Highlight organization team-scoped goal progress",
                          ],
                          [
                            "notifyMilestone",
                            "Halfway milestone alerts",
                            "Notify at 50% progress on active goals",
                          ],
                          [
                            "notifyOverdue",
                            "Severe overdue alerts",
                            "Flag when open overdue count exceeds threshold",
                          ],
                        ] as const
                      ).map(([key, label, hint]) => (
                        <div
                          key={key}
                          className="grid gap-3 py-3.5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-center"
                        >
                          <div>
                            <Label htmlFor={`set-${key}`}>{label}</Label>
                            <p className="text-xs text-muted-foreground">{hint}</p>
                          </div>
                          <div>
                            <Switch
                              id={`set-${key}`}
                              checked={draft[key]}
                              onCheckedChange={(checked) => updateField(key, checked)}
                            />
                          </div>
                        </div>
                      ))}

                      <div className="grid gap-3 py-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
                        <div>
                          <Label htmlFor="set-overdueThreshold">Overdue alert threshold</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Integer between 1 and 1,000 overdue items.
                          </p>
                        </div>
                        <div className="space-y-1.5 max-w-xs">
                          <Input
                            ref={overdueThresholdRef}
                            id="set-overdueThreshold"
                            type="number"
                            min={1}
                            max={1000}
                            step={1}
                            value={draft.overdueThreshold}
                            aria-invalid={Boolean(fieldErrors["overdueThreshold"])}
                            aria-describedby={
                              fieldErrors["overdueThreshold"] ? "err-overdueThreshold" : undefined
                            }
                            onChange={(e) => updateField("overdueThreshold", e.target.value)}
                            onBlur={() => handleFieldBlur("overdueThreshold")}
                          />
                          {fieldErrors["overdueThreshold"] && (
                            <p id="err-overdueThreshold" className="text-xs text-destructive">
                              {fieldErrors["overdueThreshold"]}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-dashed p-3.5 text-xs flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Configure target metrics & track MariaDB progress in My Performance.
                      </span>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link to="/my-performance" search={pilotLinkSearch()}>
                          <Target className="size-3.5 mr-1" />
                          Open Sales Goals
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <span className="text-xs text-muted-foreground">
                    {isDirty
                      ? `Pending changes (${diff.changedKeys.map((k) => SETTINGS_FIELD_LABELS[k] ?? k).join(", ")})`
                      : "All business settings match MariaDB."}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={updateMut.isPending || !isDirty}
                      onClick={handleDiscardEdits}
                    >
                      Discard changes
                    </Button>
                    <Button type="submit" disabled={updateMut.isPending}>
                      {updateMut.isPending ? "Saving…" : "Save settings"}
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {sec === "history" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Immutable settings audit log persisted to MariaDB (`crm_settings_audit_events`).
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="audit-section-filter" className="text-xs text-muted-foreground">
                      Section:
                    </Label>
                    <select
                      id="audit-section-filter"
                      className={`${selectCls} h-8 text-xs`}
                      value={auditSection}
                      onChange={(e) => {
                        setAuditSection(e.target.value as SettingsAuditSectionApi);
                        setAuditOffset(0);
                      }}
                    >
                      {(
                        Object.keys(SETTINGS_AUDIT_SECTION_LABELS) as SettingsAuditSectionApi[]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {SETTINGS_AUDIT_SECTION_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {auditQ.isLoading && (
                  <div className="space-y-2">
                    <Skeleton className="h-20 rounded-xl" />
                    <Skeleton className="h-20 rounded-xl" />
                  </div>
                )}

                {auditQ.error && (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    <span>
                      {formatApiErrorMessage(auditQ.error, "Failed to load audit history.")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void auditQ.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {!auditQ.isLoading && !auditQ.error && (auditQ.data?.items.length ?? 0) === 0 && (
                  <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                    No material business settings changes have been saved yet.
                  </div>
                )}

                {(auditQ.data?.items.length ?? 0) > 0 && (
                  <ol className="space-y-2.5" aria-label="Settings change history">
                    {auditQ.data!.items.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-xl border bg-background p-3.5 text-xs space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            {ev.summary} · v{ev.versionBefore} → v{ev.versionAfter}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDateTime(ev.createdAt)} · {ev.occurredIstDate}
                          </span>
                        </div>
                        <div className="grid gap-1 text-[11px] text-muted-foreground">
                          {ev.changedFields.map((field) => (
                            <div key={field} className="flex flex-wrap gap-1.5">
                              <span className="font-medium text-foreground">
                                {SETTINGS_FIELD_LABELS[field] ?? field}:
                              </span>
                              <span>{formatAuditValue(ev.before?.[field])}</span>
                              <span>→</span>
                              <span className="font-medium text-foreground">
                                {formatAuditValue(ev.after[field])}
                              </span>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {auditQ.data && auditQ.data.total > auditQ.data.limit && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                    <span>
                      Showing {auditOffset + 1}–
                      {Math.min(auditOffset + auditQ.data.items.length, auditQ.data.total)} of{" "}
                      {auditQ.data.total}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={auditOffset === 0}
                        onClick={() => setAuditOffset((o) => Math.max(0, o - 20))}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={auditOffset + 20 >= auditQ.data.total}
                        onClick={() => setAuditOffset((o) => o + 20)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {sec === "device" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/35 p-3.5 text-xs">
                  <div>
                    <div className="font-semibold text-foreground">
                      Device-local display preferences only (never synced to MariaDB)
                    </div>
                    <p className="text-muted-foreground mt-0.5">
                      Sidebar state, appearance, density, and date/time formats stay in this browser
                      alone and never overwrite Owner business settings in MariaDB.
                    </p>
                  </div>
                  <span className="pf-badge">Device-local only</span>
                </div>

                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <div className="text-sm font-medium">Theme preview (current tab)</div>
                    <div className="text-xs text-muted-foreground">
                      Toggles light/dark class on this browser tab without touching MariaDB or local
                      Zustand store.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next = !localDark;
                      setLocalDark(next);
                      document.documentElement.classList.toggle("dark", next);
                    }}
                  >
                    {localDark ? (
                      <Sun className="size-4 mr-1.5" />
                    ) : (
                      <Moon className="size-4 mr-1.5" />
                    )}
                    {localDark ? "Switch to light" : "Switch to dark"}
                  </Button>
                </div>

                <div className="rounded-xl border p-4 space-y-2 text-xs">
                  <div className="font-medium text-foreground">
                    Device-local keys classified outside MariaDB sync
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      defs?.deviceLocalPreferences ?? [
                        "theme",
                        "accent",
                        "density",
                        "timeFormat",
                        "dateStyle",
                        "scale-flow-sidebar-collapsed",
                        "scale-flow-sidebar-groups",
                      ]
                    ).map((k) => (
                      <code key={k} className="rounded bg-muted px-2 py-0.5 text-[11px]">
                        {k}
                      </code>
                    ))}
                  </div>
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLeadPilotSessionOptIn(false);
                        void navigate({ to: "/settings", search: { pilot: 0 } });
                      }}
                    >
                      Open browser-local Settings
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {sec === "security" && (
              <div className="space-y-4">
                <div className="rounded-xl border bg-muted/40 p-3.5 text-sm">
                  <div className="font-medium text-foreground">
                    Authenticated Owner session: {authUser?.email ?? "Active Owner"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {idleExpiresAt
                      ? `Idle timeout: ${formatDateTime(idleExpiresAt)}`
                      : "HttpOnly server session active"}
                    {expiresAt ? ` · Max expiry: ${formatDateTime(expiresAt)}` : ""}
                  </div>
                </div>

                <div className="rounded-xl border p-4 space-y-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Password & server secrets</div>
                  <p>
                    Authentication secrets, session keys, database credentials, and OpenRouter keys
                    cannot be viewed or edited through Settings. Password rotation runs via the
                    authenticated server CLI (`--reset-password`).
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sessionBusy !== null}
                    onClick={() => {
                      setSessionBusy("logout");
                      void logoutOwner({ allSessions: false });
                    }}
                  >
                    {sessionBusy === "logout" ? "Signing out…" : "Log out"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={sessionBusy !== null}
                    onClick={() => {
                      setSessionBusy("logout-all");
                      void logoutOwner({ allSessions: true });
                    }}
                  >
                    {sessionBusy === "logout-all" ? "Revoking sessions…" : "Log out all sessions"}
                  </Button>
                </div>
              </div>
            )}

            {sec === "data" && defs && (
              <div className="space-y-4 text-xs">
                <div className="rounded-xl border bg-muted/35 p-4 space-y-2">
                  <div className="text-sm font-semibold text-foreground">
                    Module & Storage Boundary (B6A / B6B)
                  </div>
                  <p className="text-muted-foreground">
                    Pilot mode never reads or writes `scale-flow-crm-2-demo` localStorage or
                    `scale-flow-payment-proofs` IndexedDB. Data Vault exports remain local to the
                    browser dataset.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-semibold text-foreground">
                      Existing server template endpoints
                    </div>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>
                        Quotations: <code>{defs.existingTemplateEndpoints.quotationTemplates}</code>
                      </li>
                      <li>
                        Projects: <code>{defs.existingTemplateEndpoints.projectTemplates}</code>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-semibold text-foreground">
                      Deferred beyond B6A (handled separately)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {defs.deferredModules.map((mod) => (
                        <span key={mod} className="pf-badge">
                          {mod}
                        </span>
                      ))}
                    </div>
                    <div className="pt-2">
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link to="/crm-config" search={pilotLinkSearch()}>
                          Inspect CRM Config Boundary
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogTitle>Discard unsaved settings?</DialogTitle>
          <DialogDescription>
            Your business settings changes haven’t been saved to MariaDB yet. Leaving now keeps the
            last saved server configuration.
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
    </PilotShell>
  );
}
