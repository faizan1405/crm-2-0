import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Database,
  FileText,
  FolderKanban,
  Info,
  Lock,
  RotateCw,
  Settings,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatApiErrorMessage } from "@/lib/api/errors";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import { DEFAULT_LEAD_SORT_LABELS, useSettingsDefinitionsQuery } from "@/lib/api/settingsApi";

const DEFERRED_MODULE_LABELS: Record<string, { label: string; note: string }> = {
  customFieldsCrud: {
    label: "Custom Lead & Project Fields",
    note: "Schema & CRUD tables deferred past B6A; available in browser-local mode.",
  },
  tagsCrud: {
    label: "Tags & Tag Assignments",
    note: "Deferred past B6A; available in browser-local mode.",
  },
  savedViews: {
    label: "Saved Pipeline Views",
    note: "Deferred past B6A; available in browser-local mode.",
  },
  whatsappTemplatesLibrary: {
    label: "WhatsApp Templates Library",
    note: "Deferred past B6A; quick composer templates run separately.",
  },
  demoLinksLibrary: {
    label: "Demo Links Library",
    note: "Deferred past B6A.",
  },
  analyticsForecastConfig: {
    label: "Analytics & Forecast Config",
    note: "Deferred past B6A.",
  },
  teamUsersAndRbac: {
    label: "Team Users & Employee RBAC",
    note: "Deferred until multi-user Team CRM authentication.",
  },
  automationRules: {
    label: "Workflow Automation Rules",
    note: "Deferred past B6A.",
  },
};

export function PilotCrmConfigPage(_props: { search?: Record<string, unknown> }) {
  const navigate = useNavigate();
  const defsQ = useSettingsDefinitionsQuery();
  const defs = defsQ.data?.definitions;

  return (
    <PilotShell
      title="CRM Configuration"
      subtitle="B6A / B6B Module Boundary · Protected Server Definitions & Deferred Features"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm" variant="outline" className="rounded-lg gap-1.5">
            <Link to="/settings" search={{ pilot: 1 }}>
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
      <div className="space-y-5">
        <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <Database className="size-4 shrink-0 text-primary mt-0.5" />
          <span>
            <b className="font-semibold text-foreground">Server-Enforced Boundary.</b> Pilot CRM
            Configuration reads exclusively from <code>GET /api/v1/settings/definitions</code> in
            MariaDB and never reads or writes browser-local custom fields, tags, or saved views.
          </span>
        </div>

        {defsQ.isLoading && (
          <div className="grid gap-4 md:grid-cols-2" aria-label="Loading CRM definitions">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        )}

        {defsQ.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                Failed to load server CRM definitions:{" "}
                {formatApiErrorMessage(defsQ.error, "Unknown error.")}
              </span>
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void defsQ.refetch()}>
              <RotateCw className="size-3.5 mr-1" />
              Retry
            </Button>
          </div>
        )}

        {defs && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Lock className="size-4 text-primary" />
                  Protected Pipeline & Business Invariants
                </h2>
                <span className="pf-badge">Read-only</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Stages, lead sources, timezone, and currency invariants are enforced by the B6A
                server and cannot be edited through generic settings.
              </p>

              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border bg-background p-3">
                  <dt className="text-muted-foreground">Business Timezone</dt>
                  <dd className="mt-1 font-semibold text-foreground">
                    {defs.invariants.businessTimezone} (IST)
                  </dd>
                </div>
                <div className="rounded-xl border bg-background p-3">
                  <dt className="text-muted-foreground">Accounting Currency</dt>
                  <dd className="mt-1 font-semibold text-foreground">
                    {defs.invariants.currencyCode} (exact paise)
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 text-xs">
                <div className="font-medium text-foreground">Pipeline Stages</div>
                <div className="flex flex-wrap gap-1.5">
                  {defs.leadStatuses.map((status) => (
                    <span key={status} className="pf-badge">
                      {status}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="font-medium text-foreground">Lead Sources</div>
                <div className="flex flex-wrap gap-1.5">
                  {defs.leadSources.map((source) => (
                    <span key={source} className="pf-badge">
                      {source}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="font-medium text-foreground">Supported Default Lead Sorts</div>
                <div className="text-muted-foreground">
                  {defs.defaultLeadSortOptions
                    .map((k) => `${DEFAULT_LEAD_SORT_LABELS[k]} (${k})`)
                    .join(" · ")}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-primary" />
                  Live MariaDB Configuration Modules
                </h2>
                <span className="pf-badge" data-status="active">
                  Server-backed
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Templates and workspace settings already persisted to MariaDB live in their
                dedicated Pilot modules:
              </p>

              <div className="grid gap-2.5 text-xs">
                <Link
                  to="/settings"
                  search={{ pilot: 1 }}
                  className="flex items-center justify-between rounded-xl border bg-background p-3 hover:border-primary/40 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <Settings className="size-4 text-primary" />
                    Owner Business Settings & Alerts
                  </span>
                  <span className="text-muted-foreground">/api/v1/settings</span>
                </Link>
                <Link
                  to="/my-performance"
                  search={{ pilot: 1 }}
                  className="flex items-center justify-between rounded-xl border bg-background p-3 hover:border-primary/40 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <Target className="size-4 text-primary" />
                    Sales Goals & Revision History ({defs.goalMetrics.length} metrics)
                  </span>
                  <span className="text-muted-foreground">/api/v1/goals</span>
                </Link>
                <Link
                  to="/sales-studio"
                  search={{ pilot: 1 }}
                  className="flex items-center justify-between rounded-xl border bg-background p-3 hover:border-primary/40 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <FileText className="size-4 text-primary" />
                    Quotation Templates
                  </span>
                  <code className="text-[11px] text-muted-foreground">
                    {defs.existingTemplateEndpoints.quotationTemplates}
                  </code>
                </Link>
                <Link
                  to="/projects"
                  search={{ pilot: 1 }}
                  className="flex items-center justify-between rounded-xl border bg-background p-3 hover:border-primary/40 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <FolderKanban className="size-4 text-primary" />
                    Project Templates
                  </span>
                  <code className="text-[11px] text-muted-foreground">
                    {defs.existingTemplateEndpoints.projectTemplates}
                  </code>
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 space-y-3 lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Info className="size-4 text-muted-foreground" />
                  Deferred Customization Modules (Outside B6A Schema)
                </h2>
                <span className="pf-badge">Deferred</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The modules below are intentionally not fabricated in Pilot mode because B6A does
                not define MariaDB tables for them yet. Switch to Local CRM Configuration outside
                Pilot to work with browser-local demo fields, tags, and views.
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {defs.deferredModules.map((mod) => {
                  const info = DEFERRED_MODULE_LABELS[mod];
                  return (
                    <div
                      key={mod}
                      className="rounded-xl border border-dashed p-3 text-xs space-y-1"
                    >
                      <div className="font-medium text-foreground">{info?.label ?? mod}</div>
                      <p className="text-[11px] text-muted-foreground">
                        {info?.note ?? "Deferred beyond B6A."}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </PilotShell>
  );
}
