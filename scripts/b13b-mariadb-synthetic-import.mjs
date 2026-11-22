#!/usr/bin/env node
/**
 * Checkpoint B13B — Isolated Disposable MariaDB Synthetic Import & Reconciliation Runner
 *
 * Strictly restricted to:
 * - Explicitly approved disposable/shadow/staging MariaDB databases
 * - Synthetic test records ONLY (`--synthetic-only`)
 * - Hostinger Business MariaDB 11.4 (`mariadb-blob`, Cloudflare R2 NOT required)
 *
 * Refuses execution against CRM V1, production, live, or unmarked databases (fail-closed).
 */
const PROTECTED_PATTERNS = [
  /crm\.joinscaleflow\.in/i,
  /^prod(_|-|$)/i,
  /(_|-)prod(_|-|$)/i,
  /production/i,
  /crm[_-]?v1/i,
  /(_|-)live(_|-|$)/i,
  /^live(_|-|$)/i,
];

function parseArgs(argv) {
  const opts = {
    targetDb: "",
    targetHost: "127.0.0.1",
    syntheticOnly: false,
    confirmDisposableTarget: false,
    dryRunPlanOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target-db" && argv[i + 1]) opts.targetDb = argv[++i];
    else if (a === "--target-host" && argv[i + 1]) opts.targetHost = argv[++i];
    else if (a === "--synthetic-only") opts.syntheticOnly = true;
    else if (a === "--confirm-disposable-target") opts.confirmDisposableTarget = true;
    else if (a === "--dry-run-plan") opts.dryRunPlanOnly = true;
  }
  return opts;
}

function validateTarget(targetDb, targetHost) {
  if (!targetDb || !targetDb.trim()) {
    return { ok: false, code: "MISSING_TARGET_DB", message: "--target-db is required." };
  }
  for (const re of PROTECTED_PATTERNS) {
    if (re.test(targetDb)) {
      return {
        ok: false,
        code: "PROTECTED_TARGET_BLOCKED",
        message: `Refused protected production / CRM V1 database: '${targetDb}'.`,
      };
    }
    if (re.test(targetHost)) {
      return {
        ok: false,
        code: "PROTECTED_TARGET_BLOCKED",
        message: `Refused protected production / CRM V1 host: '${targetHost}'.`,
      };
    }
  }
  if (!/shadow|staging|stg|disposable|test|sandbox|tmp/i.test(targetDb)) {
    return {
      ok: false,
      code: "UNMARKED_TARGET_BLOCKED",
      message: `Target database '${targetDb}' must explicitly contain shadow/staging/stg/disposable/test.`,
    };
  }
  return { ok: true };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.syntheticOnly) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "SYNTHETIC_ONLY_REQUIRED",
        message:
          "Real customer data import is locked in B13B. Pass --synthetic-only to run disposable synthetic acceptance tests.",
      }),
    );
    process.exit(2);
  }

  const guard = validateTarget(opts.targetDb, opts.targetHost);
  if (!guard.ok) {
    console.error(JSON.stringify(guard));
    process.exit(3);
  }

  if (!opts.confirmDisposableTarget && !opts.dryRunPlanOnly) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "OWNER_APPROVAL_REQUIRED",
        message:
          "Remote MariaDB write requires explicit Owner approval and --confirm-disposable-target. Use --dry-run-plan to inspect the execution plan with zero DB writes.",
      }),
    );
    process.exit(4);
  }

  const plan = {
    ok: true,
    checkpoint: "B13B",
    mode: opts.dryRunPlanOnly ? "dry_run_plan_only" : "disposable_mariadb_ready",
    hostingPolicy: "hostinger_exclusive",
    cloudflareR2Required: false,
    proofStorageDriver: "mariadb-blob",
    targetDb: opts.targetDb,
    targetHost: opts.targetHost,
    syntheticOnly: true,
    remoteDatabaseWritten: false,
    steps: [
      "1. Verify empty disposable MariaDB schema via Drizzle migrations (0000..latest)",
      "2. Pass 1: Atomic transaction insert of all 27 mapped entity groups + crm_payment_proof_blobs",
      "3. Post-commit readback: Verify 100% SHA-256 parity on reassembled payment proof BLOBs",
      "4. Post-commit SQL reconciliation: Verify 0-paise delta on deals, active payments, voided payments, outstanding balances",
      "5. Pass 2: Re-run identical synthetic dataset to verify 0 duplicate rows and 0 duplicate payments",
      "6. Interruption/Rollback drill: Inject failure after crm_payments on clean target and verify 0 residual/orphan rows",
    ],
  };

  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

main();
