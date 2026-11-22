import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  FlaskConical,
  HardDrive,
  IndianRupee,
  Lock,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyzeMigrationArchive,
  runSyntheticShadowTest,
  useMigrationReadinessQuery,
  type MigrationAnalysisReport,
  type ShadowMigrationTestReport,
} from "@/lib/api/migrationApi";
import { cn } from "@/lib/utils";

type WizardStep = 1 | 2 | 3 | 4;

const STEPS: Array<{ step: WizardStep; title: string; subtitle: string }> = [
  { step: 1, title: "1. Hostinger Pre-Flight", subtitle: "Guardrails & storage policy" },
  { step: 2, title: "2. Source Upload", subtitle: "ZIP / JSON read-only analysis" },
  { step: 3, title: "3. Entities & Finance", subtitle: "0-paise parity & quota check" },
  { step: 4, title: "4. Shadow Test & Gate", subtitle: "Synthetic verification & lock" },
];

export function PilotMigrationWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MigrationAnalysisReport | null>(null);

  const [isRunningShadow, setIsRunningShadow] = useState(false);
  const [shadowReport, setShadowReport] = useState<ShadowMigrationTestReport | null>(null);

  const { data: readiness, isLoading: isReadinessLoading } = useMigrationReadinessQuery();

  const handleAnalyzeFile = async (file: File) => {
    try {
      setSelectedFile(file);
      setIsAnalyzing(true);
      setAnalysis(null);
      const res = await analyzeMigrationArchive(file);
      setAnalysis(res.analysis);
      setStep(3);
      if (res.analysis.ok) {
        toast.success(
          `Migration analysis passed: ${res.analysis.totalValidRecords} records verified with 0-paise financial delta.`,
        );
      } else {
        toast.warning(
          `Migration analysis found ${res.analysis.errors.length} blocking issue(s) to resolve.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to analyze migration source");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunShadowTest = async () => {
    try {
      setIsRunningShadow(true);
      const res = await runSyntheticShadowTest();
      setShadowReport(res.shadowReport);
      setStep(4);
      if (res.shadowReport.ok) {
        toast.success(
          `Synthetic shadow test passed (${res.shadowReport.assertions.length}/${res.shadowReport.assertions.length} assertions).`,
        );
      } else {
        toast.error("Synthetic shadow test reported failures.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run synthetic shadow test");
    } finally {
      setIsRunningShadow(false);
    }
  };

  const handleDownloadReport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      checkpoint: "B13",
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      analysis,
      shadowReport,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ScaleFlow_B13_Migration_Readiness_Report.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return (
    <div className="space-y-6" data-testid="b13-migration-wizard">
      {/* Stepper Header */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => {
          const isActive = step === s.step;
          const isCompleted =
            (s.step === 1 && step > 1) ||
            (s.step === 2 && Boolean(analysis)) ||
            (s.step === 3 && Boolean(analysis?.ok)) ||
            (s.step === 4 && Boolean(shadowReport?.ok));
          return (
            <button
              key={s.step}
              type="button"
              onClick={() => setStep(s.step)}
              className={cn(
                "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-card hover:bg-muted/40",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{s.title}</span>
                {isCompleted && <CheckCircle2 className="size-3.5 text-emerald-600" />}
              </div>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{s.subtitle}</span>
            </button>
          );
        })}
      </div>

      {/* STEP 1: Hostinger Pre-Flight & Guardrails */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <HardDrive className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  <span>Hostinger-Exclusive Migration Architecture</span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                    Cloudflare R2 Not Required
                  </span>
                </div>
                <p className="text-muted-foreground">
                  All CRM relational entities and payment proof binaries target Hostinger MariaDB
                  11.4 (<code className="font-mono">mariadb-blob</code>) within the 3,072 MiB quota
                  policy (50% warning at 1,536 MiB, 70% hard stop at 2,150 MiB). Cloudflare R2 is
                  not a launch requirement.
                </p>
              </div>
            </div>
          </div>

          {isReadinessLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck className="size-4 text-primary" />
                  Enforced B13 Safety Guardrails
                </h3>
                <ul className="space-y-2 text-xs">
                  {(readiness?.guardrails ?? []).map((g) => (
                    <li key={g.id} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                      <span>{g.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-border/60 bg-card p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Database className="size-4 text-primary" />
                  Scope & Quota Policy
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Mapped Entity Groups</dt>
                    <dd className="font-semibold">{readiness?.mappedEntityCount ?? 27} tables/scopes</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Deferred Browser Collections</dt>
                    <dd className="font-semibold">{readiness?.deferredCollectionCount ?? 5} (non-silent)</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Hostinger MariaDB Quota</dt>
                    <dd className="font-semibold">
                      {readiness?.hostingerQuotaPolicy.quotaMiB ?? 3072} MiB (70% stop:{" "}
                      {readiness?.hostingerQuotaPolicy.hardStopThresholdMiB ?? 2150} MiB)
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Live Production Cutover</dt>
                    <dd className="inline-flex items-center gap-1 font-semibold text-amber-600">
                      <Lock className="size-3" /> Locked (Approval Required)
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => setStep(2)} className="gap-1.5">
              Continue to Source Upload
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleRunShadowTest()}
              disabled={isRunningShadow}
              className="gap-1.5"
            >
              <FlaskConical className="size-3.5" />
              {isRunningShadow ? "Running Synthetic Shadow Test..." : "Run Synthetic Shadow Test"}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: Source Upload & Read-Only Analysis */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
            <Upload className="mx-auto mb-2 size-8 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Upload CRM V1 Export or Data Vault Archive</h3>
            <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
              Accepts a Data Vault <code className="font-mono">.zip</code> backup or legacy CRM{" "}
              <code className="font-mono">.json</code> snapshot. Performs strictly read-only entity
              validation, FK verification, exact paise reconciliation, and Hostinger quota check.{" "}
              <b>Zero database writes.</b>
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                <Upload className="size-3.5" />
                {isAnalyzing ? "Analyzing..." : "Choose .zip or .json file"}
                <input
                  type="file"
                  accept=".zip,.json,application/zip,application/json"
                  className="hidden"
                  disabled={isAnalyzing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleAnalyzeFile(f);
                  }}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRunShadowTest()}
                disabled={isRunningShadow}
                className="gap-1.5"
              >
                <FlaskConical className="size-3.5" />
                {isRunningShadow ? "Running..." : "Or Run Synthetic Shadow Test"}
              </Button>
            </div>
            {selectedFile && (
              <p className="mt-3 text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedFile.name}</span> (
                {(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </div>
      )}

      {/* STEP 3: Entity Mapping & Financial Reconciliation */}
      {step === 3 && (
        <div className="space-y-4">
          {!analysis ? (
            <div className="rounded-lg border border-border/60 bg-card p-6 text-center text-xs text-muted-foreground">
              No migration source analyzed yet. Upload a backup file in Step 2 or run the Synthetic
              Shadow Test in Step 4.
            </div>
          ) : (
            <>
              {/* Financial Reconciliation Card */}
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <IndianRupee className="size-4 text-primary" />
                    Exact Integer-Paise Financial Reconciliation
                  </h3>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      analysis.financialReconciliation.financialParityPassed
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {analysis.financialReconciliation.financialParityPassed ? (
                      <>
                        <CheckCircle2 className="size-3" /> 0-Paise Delta Verified
                      </>
                    ) : (
                      <>
                        <XCircle className="size-3" /> Financial Mismatch Detected
                      </>
                    )}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">Deals Booked (Won+Active)</div>
                    <div className="mt-1 text-sm font-bold">
                      {analysis.financialReconciliation.formattedSummary.dealsBookedInr}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">Active Payments Collected</div>
                    <div className="mt-1 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {analysis.financialReconciliation.formattedSummary.activePaymentsInr}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">Voided Payments Preserved</div>
                    <div className="mt-1 text-sm font-bold">
                      {analysis.financialReconciliation.formattedSummary.voidedPaymentsInr}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">Outstanding Balance</div>
                    <div className="mt-1 text-sm font-bold">
                      {analysis.financialReconciliation.formattedSummary.outstandingInr}
                    </div>
                  </div>
                </div>
              </div>

              {/* Hostinger Capacity Bar */}
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">
                    Hostinger MariaDB Projected Footprint (Cloudflare R2: Not Required)
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {analysis.hostingerCapacity.projectedUsedMiB} MiB /{" "}
                    {analysis.hostingerCapacity.quotaMiB} MiB (
                    {analysis.hostingerCapacity.projectedPercentOfQuota}%)
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full transition-all",
                      analysis.hostingerCapacity.status === "hard_stop_exceeded"
                        ? "bg-destructive"
                        : analysis.hostingerCapacity.status === "warning"
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(2, analysis.hostingerCapacity.projectedPercentOfQuota))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Entity Mapping Table */}
              <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/60 bg-muted/30 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Entity</th>
                      <th className="px-3 py-2">MariaDB Table</th>
                      <th className="px-3 py-2 text-right">Source</th>
                      <th className="px-3 py-2 text-right">To Create</th>
                      <th className="px-3 py-2 text-right">To Skip</th>
                      <th className="px-3 py-2 text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {Object.values(analysis.entities)
                      .filter((e) => e.sourceCount > 0 || e.errorCount > 0)
                      .map((e) => (
                        <tr key={e.entity}>
                          <td className="px-3 py-2 font-medium">{e.label}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {e.tableName}
                          </td>
                          <td className="px-3 py-2 text-right">{e.sourceCount}</td>
                          <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                            {e.toCreate}
                          </td>
                          <td className="px-3 py-2 text-right">{e.toSkip}</td>
                          <td className="px-3 py-2 text-right">
                            {e.errorCount > 0 ? (
                              <span className="font-semibold text-destructive">{e.errorCount}</span>
                            ) : (
                              "0"
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {analysis.deferredCollections.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                  <div className="font-semibold">
                    Deferred Browser-Local Collections (Preserved in Backup, Never Silently Dropped)
                  </div>
                  <ul className="mt-1.5 space-y-1 text-muted-foreground">
                    {analysis.deferredCollections.map((d) => (
                      <li key={d.collection}>
                        <b>{d.label}</b> ({d.sourceCount} record(s)) — {d.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.errors.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="font-semibold">Blocking Validation Errors</div>
                  <ul className="mt-1 list-disc pl-4">
                    {analysis.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleRunShadowTest()}
                  disabled={isRunningShadow}
                  className="gap-1.5"
                >
                  <FlaskConical className="size-3.5" />
                  {isRunningShadow ? "Running Shadow Test..." : "Proceed to Synthetic Shadow Test"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleDownloadReport}>
                  <Download className="mr-1.5 size-3.5" />
                  Download JSON Report
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* STEP 4: Shadow Test Results & Locked Cutover Gate */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Synthetic Staging Shadow Test</h3>
              <p className="text-xs text-muted-foreground">
                Validates all CRM entities, exact paise parity, idempotent re-runs, atomic rollback,
                automation safety, and Hostinger quota fit with zero real DB writes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRunShadowTest()}
                disabled={isRunningShadow}
                className="gap-1.5"
              >
                <FlaskConical className="size-3.5" />
                {isRunningShadow ? "Running..." : "Run Synthetic Shadow Test"}
              </Button>
              {(shadowReport || analysis) && (
                <Button type="button" size="sm" variant="outline" onClick={handleDownloadReport}>
                  <Download className="mr-1.5 size-3.5" />
                  Export Report
                </Button>
              )}
            </div>
          </div>

          {shadowReport && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {shadowReport.ok ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <span>
                    {shadowReport.ok
                      ? "All Synthetic Shadow Migration Assertions Passed"
                      : "Shadow Migration Test Failed"}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {shadowReport.durationMs} ms · realDatabaseTouched: false · cloudflareR2Required: false
                </span>
              </div>

              <div className="grid gap-2">
                {shadowReport.assertions.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-2.5 text-xs"
                  >
                    <div className="flex items-start gap-2">
                      {a.passed ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <div>
                        <div className="font-medium text-foreground">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground">{a.detail}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locked Cutover Gate */}
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-950 dark:text-amber-200">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <div className="font-semibold">
                  Live Production / Remote Data Migration Is Locked
                </div>
                <p className="leading-relaxed">
                  Real customer data migration cannot be executed from the browser UI (
                  <code className="font-mono">POST /api/v1/vault/migration/execute</code> returns{" "}
                  <code className="font-mono">403 MIGRATION_EXECUTION_LOCKED</code>). CRM V1,
                  existing browser storage, and remote Hostinger databases remain completely
                  untouched until explicit Owner approval.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
