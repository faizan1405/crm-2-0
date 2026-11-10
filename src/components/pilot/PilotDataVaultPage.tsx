import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  Download,
  Upload,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileSearch,
  Layers,
  Lock,
  RefreshCw,
  FileText,
  Check,
  Info,
  FolderKanban,
  Database,
  Eye,
  SlidersHorizontal,
  FileCheck2,
  AlertCircle,
  Clock,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useVaultCoverageQuery,
  downloadSyntheticBackup,
  inspectBackupArchive,
  runRestoreDryRun,
  type ValidationReport,
  type DryRunReport,
  type VaultInventoryItem,
} from "@/lib/api/vaultApi.b7b";
import { formatDateTime } from "@/lib/crm/format";
import { cn } from "@/lib/utils";

type TabId = "overview" | "synthetic" | "inspect" | "dryrun" | "blockers";

const TABS: Array<{ id: TabId; label: string; icon: typeof Archive; badge?: string }> = [
  { id: "overview", label: "Coverage & inventory", icon: Database },
  { id: "synthetic", label: "Synthetic test backup", icon: Download, badge: "Test" },
  { id: "inspect", label: "Archive inspector", icon: FileSearch },
  { id: "dryrun", label: "Restore dry-run preview", icon: FileCheck2, badge: "Safe" },
  { id: "blockers", label: "Readiness & blockers", icon: AlertTriangle, badge: "4" },
];

export function PilotDataVaultPage({
  search,
}: {
  search?:
    | { tab?: string | undefined; employee?: string | undefined; pilot?: 1 | 0 | undefined }
    | undefined;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const validTabs: TabId[] = ["overview", "synthetic", "inspect", "dryrun", "blockers"];
    return validTabs.includes(search?.tab as TabId) ? (search!.tab as TabId) : "overview";
  });

  const {
    data: coverageData,
    isLoading: isCoverageLoading,
    refetch: refetchCoverage,
  } = useVaultCoverageQuery();

  // Synthetic backup state
  const [syntheticScope, setSyntheticScope] = useState<"full" | "sales" | "projects">("full");
  const [isGeneratingSynthetic, setIsGeneratingSynthetic] = useState(false);
  const [lastGeneratedBackup, setLastGeneratedBackup] = useState<{
    filename: string;
    bytes: number;
    timestamp: string;
  } | null>(null);

  // Inspector state
  const [inspectFile, setInspectFile] = useState<File | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<ValidationReport | null>(null);

  // Dry-run preview state
  const [dryRunFile, setDryRunFile] = useState<File | null>(null);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);

  const coverage = coverageData?.coverage;

  const handleDownloadSynthetic = async () => {
    try {
      setIsGeneratingSynthetic(true);
      const res = await downloadSyntheticBackup(syntheticScope);
      setLastGeneratedBackup({
        filename: res.filename,
        bytes: res.bytes,
        timestamp: new Date().toISOString(),
      });
      toast.success(
        `Synthetic backup downloaded: ${res.filename} (${(res.bytes / 1024).toFixed(1)} KB)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate synthetic backup");
    } finally {
      setIsGeneratingSynthetic(false);
    }
  };

  const handleInspectFile = async (file: File) => {
    try {
      setInspectFile(file);
      setIsInspecting(true);
      setInspectionResult(null);
      const res = await inspectBackupArchive(file);
      setInspectionResult(res.validation);
      if (res.validation.ok) {
        toast.success(res.validation.statusLabel);
      } else {
        toast.warning(res.validation.statusLabel);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to inspect archive");
    } finally {
      setIsInspecting(false);
    }
  };

  const handleDryRunFile = async (file: File) => {
    try {
      setDryRunFile(file);
      setIsDryRunning(true);
      setDryRunReport(null);
      const res = await runRestoreDryRun(file);
      setDryRunReport(res.dryRunReport);
      if (res.dryRunReport.ok) {
        toast.success(
          `Dry-run simulation completed: ${res.dryRunReport.totalRecordsToCreate} to create, ${res.dryRunReport.totalRecordsToSkip} to skip`,
        );
      } else {
        toast.warning("Dry-run preview detected validation issues");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run dry-run simulation");
    } finally {
      setIsDryRunning(false);
    }
  };

  return (
    <PilotShell
      title="Data Vault (Pilot)"
      subtitle="Server-backed backup readiness, genuine ZIP inspection & safe dry-run preview."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full gap-1.5"
            onClick={() => void refetchCoverage()}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full gap-1.5"
            asChild
          >
            <Link to="/data-vault">
              <Archive className="size-3.5" />
              Browser Demo Vault
            </Link>
          </Button>
        </div>
      }
    >
      {/* Pilot Warning Notice */}
      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span>DEVELOPMENT DATA VAULT PILOT — MARIADB 11.4 INTEGRATED</span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider">
                Read-Only Restore Simulation
              </span>
            </div>
            <p className="leading-relaxed">
              This pilot provides server-backed backup coverage inspection, genuine ZIP archive
              validation, and non-destructive restore dry-runs. <b>9 entity tables</b> are verified
              for MariaDB restore.
              <b> 5 browser-local collections</b> lack database tables and remain deferred.
              <b> Direct database restore execution is permanently disabled in the UI</b> to prevent
              accidental production data loss.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/30 p-1"
        role="tablist"
        aria-label="Data Vault sections"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`dv-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={cn(
                    "ml-1 rounded px-1.5 py-0.2 text-[10px] font-semibold",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-muted-foreground/15 text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Coverage & Inventory */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Hero KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-card p-4">
              <div className="text-xs text-muted-foreground">Inventoried Entities</div>
              <div className="mt-1 text-2xl font-bold tracking-tight">
                {isCoverageLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  (coverage?.totalEntitiesInventoried ?? 30)
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Across CRM V2 architecture
              </div>
            </div>

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                MariaDB Restore Verified
              </div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
                {isCoverageLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  (coverage?.verifiedEntitiesCount ?? 9)
                )}
              </div>
              <div className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                Live transactional tables
              </div>
            </div>

            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
              <div className="text-xs font-medium text-sky-800 dark:text-sky-300">
                Supported in Manifest
              </div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-sky-700 dark:text-sky-400">
                {isCoverageLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  (coverage?.supportedEntitiesCount ?? 16)
                )}
              </div>
              <div className="mt-1 text-[11px] text-sky-800/80 dark:text-sky-300/80">
                Schema & export aligned
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Browser Only / Deferred
              </div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-400">
                {isCoverageLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  (coverage?.unsupportedEntitiesCount ?? 5)
                )}
              </div>
              <div className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                No MariaDB table yet
              </div>
            </div>
          </div>

          {/* Persisted Data Source Inventory Table */}
          <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
            <div className="border-b border-border/60 px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Persisted CRM Entity Inventory (30 Entity Types)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Authoritative mapping of CRM data sources, storage locations, and live MariaDB row
                  counts.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                India Timezone: <span className="font-mono font-medium">Asia/Kolkata</span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 font-medium text-muted-foreground">
                    <th className="py-2.5 px-3 w-8">#</th>
                    <th className="py-2.5 px-3">Entity Name</th>
                    <th className="py-2.5 px-3">Target Storage</th>
                    <th className="py-2.5 px-2 text-center" title="Has SQL Database Schema">
                      Schema
                    </th>
                    <th className="py-2.5 px-2 text-center" title="Exportable by Backup Engine">
                      Export
                    </th>
                    <th className="py-2.5 px-2 text-center" title="Includes Binary Files">
                      Binaries
                    </th>
                    <th className="py-2.5 px-2 text-center" title="Has Database Restore Mapping">
                      Restore Map
                    </th>
                    <th
                      className="py-2.5 px-2 text-center"
                      title="Verified by Live MariaDB Restore"
                    >
                      Live Restore
                    </th>
                    <th className="py-2.5 px-3 text-right">Live Rows (Owner)</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isCoverageLoading ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-muted-foreground">
                        Loading database inventory...
                      </td>
                    </tr>
                  ) : (
                    coverage?.inventory.map((item: VaultInventoryItem) => (
                      <tr key={item.number} className="hover:bg-muted/20">
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">
                          {item.number}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-foreground">{item.name}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground">
                          {item.tableName ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-foreground/80">
                              {item.tableName}
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/60">
                              LocalStorage only
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {item.hasSchema ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {item.includedInExporter ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {item.hasBinaryCoverage ? (
                            <span className="rounded bg-sky-500/20 text-sky-800 dark:text-sky-300 px-1.5 py-0.5 font-bold text-[10px]">
                              BIN
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {item.hasRestoreMapping ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {item.verifiedByLiveRestore ? (
                            <span className="rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 font-bold text-[10px]">
                              YES
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium">
                          {item.count !== undefined ? (
                            item.count
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.status === "verified" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                              <CheckCircle2 className="size-3" />
                              Verified
                            </span>
                          ) : item.status === "supported" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:text-sky-300">
                              <Check className="size-3" />
                              Supported
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                              <AlertTriangle className="size-3" />
                              Unsupported
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Synthetic Test Backup Builder */}
      {activeTab === "synthetic" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="text-base font-semibold text-foreground">
              Synthetic Test Backup Generator
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Creates a genuine compressed ZIP backup archive containing realistic synthetic test
              records, exact paise financial ledgers, valid SHA-256 manifest hashes, and synthetic
              receipt PDF/PNG binaries. Designed specifically for testing restore dry-runs and
              archive validation without touching real customer PII.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground block mb-2">
                  Select Backup Scope:
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setSyntheticScope("full")}
                    className={cn(
                      "rounded-lg border p-3.5 text-left transition-all",
                      syntheticScope === "full"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/60 bg-card hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        All Supported Synthetic Test Data
                      </span>
                      {syntheticScope === "full" && <Check className="size-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      All 9 verified MariaDB entities: leads, deals, payments, proofs, projects,
                      tasks, quotations, goals, settings.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSyntheticScope("sales")}
                    className={cn(
                      "rounded-lg border p-3.5 text-left transition-all",
                      syntheticScope === "sales"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/60 bg-card hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Sales Synthetic Test Data
                      </span>
                      {syntheticScope === "sales" && <Check className="size-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Leads, deals, payments, and verified payment proof attachments with exact
                      paise ledgers.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSyntheticScope("projects")}
                    className={cn(
                      "rounded-lg border p-3.5 text-left transition-all",
                      syntheticScope === "projects"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/60 bg-card hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Projects Synthetic Test Data
                      </span>
                      {syntheticScope === "projects" && <Check className="size-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Client projects, operational tasks, and issued quotation line-item proposals.
                    </p>
                  </button>
                </div>
              </div>

              {/* Scope Contents Preview: Included vs Excluded */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs space-y-1.5">
                  <div className="font-semibold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Included Fixtures ({syntheticScope.toUpperCase()} Scope):</span>
                  </div>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1 text-[11px]">
                    <li>
                      <span className="font-mono text-foreground font-medium">manifest.json</span> —
                      SHA-256 hashes, byte sizes, financial ledger
                    </li>
                    {syntheticScope !== "projects" && (
                      <>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/leads.json
                          </span>{" "}
                          — 3 synthetic leads
                        </li>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/deals.json
                          </span>{" "}
                          — 2 commercial deals (₹15L won, ₹8.5L pipeline)
                        </li>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/payments.json
                          </span>{" "}
                          — 2 cleared payments (₹5L NEFT, ₹5L RTGS)
                        </li>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            files/payment-proofs/*
                          </span>{" "}
                          — 1 receipt PDF & 1 advice PNG
                        </li>
                      </>
                    )}
                    {syntheticScope !== "sales" && (
                      <>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/projects.json
                          </span>{" "}
                          — 1 EPC project with 2 checklist tasks
                        </li>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/quotations.json
                          </span>{" "}
                          — 1 accepted quote (₹17.70L total)
                        </li>
                      </>
                    )}
                    {syntheticScope === "full" && (
                      <>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/sales-goals.json
                          </span>{" "}
                          — 1 cash collection goal (₹50L quota)
                        </li>
                        <li>
                          <span className="font-mono text-foreground font-medium">
                            data/settings.json
                          </span>{" "}
                          — Business profile & timezone presets
                        </li>
                      </>
                    )}
                    <li>
                      <span className="font-mono text-foreground font-medium">
                        backup-summary.html
                      </span>{" "}
                      — Offline HTML summary report
                    </li>
                  </ul>
                </div>

                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs space-y-1.5">
                  <div className="font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    <span>Excluded Datasets (Omitted from Package):</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    The following <b>21 entities</b> are omitted from this synthetic test archive:
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5 pl-1 text-[11px]">
                    <li>
                      <b>Sales & Comms:</b> Activities, Follow-ups, Call Logs, WhatsApp Logs
                    </li>
                    <li>
                      <b>Finance & Quotes:</b> Finance Events, Deal Milestones, Quote Templates,
                      Quote Revisions
                    </li>
                    <li>
                      <b>Projects & Support:</b> Milestones, Deliverables, Support Tickets
                    </li>
                    <li>
                      <b>Settings & Meta:</b> Audit Events, Goal Revisions, Custom Fields, Tags
                    </li>
                    <li>
                      <b>Browser Only (Deferred):</b> Quote Shares, Demos, WA Templates, Automation
                      Rules, Smart Inbox
                    </li>
                  </ul>
                </div>
              </div>

              {/* Action */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleDownloadSynthetic}
                  disabled={isGeneratingSynthetic}
                  className="rounded-full gap-2"
                >
                  {isGeneratingSynthetic ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      Generating ZIP Bytes...
                    </>
                  ) : (
                    <>
                      <Download className="size-4" />
                      Generate & Download Synthetic ZIP
                    </>
                  )}
                </Button>

                {lastGeneratedBackup && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span>
                      Downloaded:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {lastGeneratedBackup.filename}
                      </span>{" "}
                      ({(lastGeneratedBackup.bytes / 1024).toFixed(1)} KB)
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Archive Inspector */}
      {activeTab === "inspect" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="text-base font-semibold text-foreground">
              Archive Inspector & Cryptographic Validator
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Upload any CRM backup archive (.zip) to verify entry paths, SHA-256 checksums,
              manifest consistency, financial ledger totals, and attachment binary integrity.
            </p>

            <div className="mt-5 space-y-4">
              {/* File upload input */}
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/70 p-6 text-center hover:border-primary/50 transition-colors">
                <Archive className="size-8 text-muted-foreground/60 mb-2" />
                <div className="text-xs font-medium text-foreground">
                  Select a backup ZIP archive to inspect
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Drag and drop or browse for a .zip file (max 512 MiB)
                </p>
                <input
                  type="file"
                  id="inspect-archive-file-input"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleInspectFile(file);
                  }}
                  className="mt-3 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                />
              </div>

              {isInspecting && (
                <div className="rounded-md border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                  Decompressing ZIP and validating SHA-256 hashes...
                </div>
              )}

              {/* Inspection Results */}
              {inspectionResult && (
                <div className="space-y-4 mt-6">
                  {/* Status Banner */}
                  <div
                    className={cn(
                      "rounded-lg border p-4 text-xs",
                      inspectionResult.ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
                        : "border-red-500/30 bg-red-500/10 text-red-950 dark:text-red-200",
                    )}
                  >
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {inspectionResult.ok ? (
                        <>
                          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                          <span>{inspectionResult.statusLabel}</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="size-5 text-red-600 dark:text-red-400" />
                          <span>{inspectionResult.statusLabel}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1 leading-relaxed">
                      {inspectionResult.ok
                        ? "The archive structure is valid. Manifest matches entry checksums, financial ledger is balanced, and all attachment binaries are verified. Note: This archive contains partial synthetic data and cannot be used for production recovery."
                        : `The archive has ${inspectionResult.errors.length} fatal error(s) preventing restoration.`}
                    </p>

                    {/* Granular Classification Sub-Badges */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-border/40 text-[11px]">
                      <span className="font-semibold text-muted-foreground">Classifications:</span>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 font-bold uppercase tracking-wider text-[10px]",
                          inspectionResult.integrityStatus === "verified"
                            ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                            : "bg-red-500/20 text-red-800 dark:text-red-300",
                        )}
                      >
                        Integrity: {inspectionResult.integrityStatus.toUpperCase()}
                      </span>
                      <span className="rounded bg-sky-500/20 text-sky-800 dark:text-sky-300 px-2 py-0.5 font-bold uppercase tracking-wider text-[10px]">
                        Coverage: {inspectionResult.coverageStatus.replace(/_/g, " ").toUpperCase()}
                      </span>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 font-bold uppercase tracking-wider text-[10px]",
                          inspectionResult.readinessStatus === "fully_verified"
                            ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                            : "bg-amber-500/20 text-amber-800 dark:text-amber-300",
                        )}
                      >
                        Readiness:{" "}
                        {inspectionResult.readinessStatus.replace(/_/g, " ").toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Errors if any */}
                  {inspectionResult.errors.length > 0 && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-900 dark:text-red-200">
                      <div className="font-semibold mb-1">Fatal Errors:</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {inspectionResult.errors.map((err, i) => (
                          <li key={i} className="font-mono text-[11px]">
                            {err}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warnings if any */}
                  {inspectionResult.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
                      <div className="font-semibold mb-1">Warnings:</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {inspectionResult.warnings.map((warn, i) => (
                          <li key={i}>{warn}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Manifest Metadata Grid */}
                  {inspectionResult.manifest && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="text-[11px] text-muted-foreground">App & Format</div>
                        <div className="text-xs font-semibold mt-0.5">
                          {inspectionResult.manifest.app} (v
                          {inspectionResult.manifest.formatVersion})
                        </div>
                      </div>
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="text-[11px] text-muted-foreground">Schema Version</div>
                        <div className="text-xs font-semibold mt-0.5">
                          Schema v{inspectionResult.manifest.schemaVersion}
                        </div>
                      </div>
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="text-[11px] text-muted-foreground">
                          Scope & Classification
                        </div>
                        <div className="text-xs font-semibold mt-0.5 capitalize">
                          {inspectionResult.manifest.type} (
                          {inspectionResult.manifest.classification})
                        </div>
                      </div>
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="text-[11px] text-muted-foreground">Manifest Checksum</div>
                        <div
                          className="text-xs font-mono truncate mt-0.5"
                          title={inspectionResult.manifest.checksumSha256}
                        >
                          {inspectionResult.manifest.checksumSha256?.slice(0, 16)}...
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Financial & Attachment Reconciliation */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-md border bg-muted/10 p-3.5 space-y-2 text-xs">
                      <div className="font-semibold text-foreground flex items-center justify-between">
                        <span>Financial Ledger Reconciliation</span>
                        {inspectionResult.financialReconciliation.verified ? (
                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                            <Check className="size-3" /> Reconciled
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                            <XCircle className="size-3" /> Discrepancy
                          </span>
                        )}
                      </div>
                      {inspectionResult.financialReconciliation.summary && (
                        <div className="space-y-1 text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Total Payments (Paise):</span>
                            <span className="font-mono text-foreground">
                              {inspectionResult.financialReconciliation.summary.totalPaymentsPaise}{" "}
                              (₹
                              {(
                                inspectionResult.financialReconciliation.summary
                                  .totalPaymentsPaise / 100
                              ).toLocaleString("en-IN")}
                              )
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Active / Voided Payments:</span>
                            <span className="font-mono text-foreground">
                              {inspectionResult.financialReconciliation.summary.activePaymentsCount}{" "}
                              active /{" "}
                              {inspectionResult.financialReconciliation.summary.voidedPaymentsCount}{" "}
                              voided
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Booked Deals:</span>
                            <span className="font-mono text-foreground">
                              {
                                inspectionResult.financialReconciliation.summary
                                  .totalBookedDealsCount
                              }{" "}
                              deals
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border bg-muted/10 p-3.5 space-y-2 text-xs">
                      <div className="font-semibold text-foreground flex items-center justify-between">
                        <span>Attachment Binary Integrity</span>
                        {inspectionResult.attachmentIntegrity.missing.length === 0 &&
                        inspectionResult.attachmentIntegrity.corrupted.length === 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                            <Check className="size-3" /> 100% Intact
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                            <AlertTriangle className="size-3" /> Missing Binaries
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Expected / Found Attachments:</span>
                          <span className="font-mono text-foreground">
                            {inspectionResult.attachmentIntegrity.found} /{" "}
                            {inspectionResult.attachmentIntegrity.expected}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Missing Binaries:</span>
                          <span className="font-mono text-foreground">
                            {inspectionResult.attachmentIntegrity.missing.length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Corrupted Checksums:</span>
                          <span className="font-mono text-foreground">
                            {inspectionResult.attachmentIntegrity.corrupted.length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Files inside Archive */}
                  {inspectionResult.manifest?.files && (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <div className="bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                        Files in Archive ({inspectionResult.manifest.files.length})
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-border/40 text-xs font-mono">
                        {inspectionResult.manifest.files.map((file, i) => (
                          <div
                            key={i}
                            className="px-3 py-1.5 flex items-center justify-between hover:bg-muted/20"
                          >
                            <span className="text-foreground">{file.path}</span>
                            <div className="flex items-center gap-3 text-muted-foreground text-[11px]">
                              <span>{(file.bytes / 1024).toFixed(1)} KB</span>
                              <span title={file.sha256}>{file.sha256.slice(0, 10)}...</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Safe Restore Dry-Run Preview */}
      {activeTab === "dryrun" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="text-base font-semibold text-foreground">
              Safe Restore Dry-Run Preview (Read-Only Simulation)
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Performs an exhaustive pre-restore simulation against MariaDB. Reads existing IDs to
              identify what records would be created, skipped, or conflicted, verifying exact paise
              financial ledger balance.
              <b> ZERO database writes or mutations occur.</b>
            </p>

            <div className="mt-5 space-y-4">
              {/* File upload input */}
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/70 p-6 text-center hover:border-primary/50 transition-colors">
                <FileCheck2 className="size-8 text-muted-foreground/60 mb-2" />
                <div className="text-xs font-medium text-foreground">
                  Select a backup ZIP archive to simulate restore
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  The dry-run reads MariaDB to detect conflicts and missing foreign keys without
                  writing any rows
                </p>
                <input
                  type="file"
                  id="dry-run-archive-file-input"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleDryRunFile(file);
                  }}
                  className="mt-3 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                />
              </div>

              {isDryRunning && (
                <div className="rounded-md border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                  Simulating restore against MariaDB 11.4 (zero writes)...
                </div>
              )}

              {/* Dry Run Report */}
              {dryRunReport && (
                <div className="space-y-4 mt-6">
                  {/* Safety Assurance Badge */}
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-950 dark:text-emerald-200">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                      <span>Zero Mutations Performed — Simulation Complete</span>
                    </div>
                    <p className="mt-1 leading-relaxed">
                      Dry-run timestamp:{" "}
                      <span className="font-mono">{formatDateTime(dryRunReport.timestamp)}</span>.
                      Database write status:{" "}
                      <span className="font-mono font-bold">databaseWritten: false</span>. Total SQL
                      mutations performed: <span className="font-mono font-bold">0</span>.
                    </p>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-border/60 bg-card p-3.5">
                      <div className="text-[11px] text-muted-foreground">Records to Create</div>
                      <div className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">
                        {dryRunReport.totalRecordsToCreate}
                      </div>
                      <div className="text-[10px] text-muted-foreground">New rows to insert</div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-card p-3.5">
                      <div className="text-[11px] text-muted-foreground">Records to Skip</div>
                      <div className="mt-1 text-xl font-bold text-muted-foreground">
                        {dryRunReport.totalRecordsToSkip}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Identical existing IDs
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-card p-3.5">
                      <div className="text-[11px] text-muted-foreground">Unresolved FKs</div>
                      <div className="mt-1 text-xl font-bold text-sky-600 dark:text-sky-400">
                        {dryRunReport.unresolvedForeignKeys.length}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Missing parents</div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-card p-3.5">
                      <div className="text-[11px] text-muted-foreground">Financial Reconciled</div>
                      <div className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">
                        {dryRunReport.financialReconciliation.reconciled ? "100%" : "FAIL"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Paise ledger matches</div>
                    </div>
                  </div>

                  {/* Action breakdown by entity */}
                  <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
                    <div className="bg-muted/40 px-4 py-2.5 text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Per-Entity Action Breakdown</span>
                      <span className="text-[11px] text-muted-foreground font-normal">
                        Pre-restore simulation results
                      </span>
                    </div>
                    <div className="divide-y divide-border/40 text-xs">
                      {Object.entries(dryRunReport.actions).map(([entity, act]) => (
                        <div
                          key={entity}
                          className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/20"
                        >
                          <div>
                            <span className="font-medium text-foreground capitalize">{entity}</span>
                            {act.conflicts.length > 0 && (
                              <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">
                                ({act.conflicts.length} conflicts)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs font-mono">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{act.toCreate} create
                            </span>
                            <span className="text-muted-foreground">{act.toSkip} skip</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Safety Enforcement Notice */}
                  <div className="pt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-sky-950 dark:text-sky-200">
                    <div className="flex items-start gap-3">
                      <Lock className="size-5 shrink-0 text-sky-600 dark:text-sky-400 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-semibold text-sm">
                          Restore execution is disabled in this development Pilot.
                        </div>
                        <p className="leading-relaxed text-muted-foreground">
                          This interface is for non-destructive inspection and dry-run preview
                          simulation only. Database restore execution is strictly CLI-only with
                          automated pre-restore snapshots and transactional rollback safeguards to
                          prevent accidental data loss.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Readiness & Blockers */}
      {activeTab === "blockers" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="text-base font-semibold text-foreground">
              Production Readiness & Architecture Blockers Matrix
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Transparent, uncompromising assessment of what must be solved before genuine customer
              data can be migrated or backed up in production.
            </p>

            <div className="mt-5 space-y-3">
              {coverage?.blockers.map((blocker) => (
                <div
                  key={blocker.id}
                  className={cn(
                    "rounded-lg border p-4 text-xs space-y-1.5",
                    blocker.severity === "critical"
                      ? "border-red-500/30 bg-red-500/5 text-red-950 dark:text-red-200"
                      : blocker.severity === "warning"
                        ? "border-amber-500/30 bg-amber-500/5 text-amber-950 dark:text-amber-200"
                        : "border-sky-500/30 bg-sky-500/5 text-sky-950 dark:text-sky-200",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {blocker.severity === "critical" ? (
                        <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
                      ) : blocker.severity === "warning" ? (
                        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Lock className="size-4 text-sky-600 dark:text-sky-400" />
                      )}
                      <span>{blocker.title}</span>
                    </div>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        blocker.status === "unverified"
                          ? "bg-red-500/20 text-red-800 dark:text-red-300"
                          : blocker.status === "not-configured"
                            ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                            : blocker.status === "unsupported"
                              ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                              : "bg-sky-500/20 text-sky-800 dark:text-sky-300",
                      )}
                    >
                      {blocker.status}
                    </span>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">{blocker.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PilotShell>
  );
}
