import "@tanstack/react-start/server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  assessProofStorageEnv,
  loadServerEnv,
  summarizeSafeRuntimeEnv,
  type ServerEnv,
} from "../config/env.server";
import {
  getDatabase,
  getDatabaseStatus,
  type CrmDatabase,
  type DatabaseStatusReport,
} from "../db/index.server";
import { crmAuthAudit, crmPaymentProofs, crmSessions } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import {
  evaluateBackupHealth,
  loadBackupHealthState,
  type BackupHealthReport,
} from "../backup/backupHealth.server";
import {
  measureMariadbCapacityFromDb,
  type MariadbUsageMeasurement,
} from "../storage/mariadbCapacity.server";
import {
  getMonitoringCountersSnapshot,
  recordDbConnectivityFailure,
  type MonitoringCountersSnapshot,
} from "./logger.server";

export type MonitoringAlertSeverity = "warning" | "critical";

export interface MonitoringAlert {
  severity: MonitoringAlertSeverity;
  subsystem: "database" | "storage" | "proofs" | "backup" | "auth" | "application";
  code: string;
  message: string;
}

export interface ProofHealthCounts {
  total: number;
  verified: number;
  pendingVerify: number;
  corrupted: number;
  missing: number;
  failed: number;
}

export interface AuthHealthLast24h {
  windowHours: 24;
  loginSucceeded: number;
  loginFailed: number;
  rateLimited: number;
  sessionRejected: number;
  activeSessions: number;
}

export interface OwnerMonitoringSnapshot {
  ok: true;
  status: "healthy" | "degraded" | "critical";
  evaluatedAt: string;
  runtime: {
    node: string;
    env: ServerEnv["NODE_ENV"];
    timezone: string;
    uptimeSeconds: number;
    memoryRssMiB: number;
    memoryHeapUsedMiB: number;
  };
  database: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    poolLimit: number;
    ipv4LoopbackSafe: boolean;
  };
  storage: {
    driver: ServerEnv["PROOF_STORAGE_DRIVER"];
    productionReady: boolean;
    durabilityStatus: string;
    capacity: MariadbUsageMeasurement | null;
  };
  proofs: ProofHealthCounts | null;
  auth: AuthHealthLast24h | null;
  backup: {
    hostingerDailyHpanelBackups: "managed_by_hostinger_business";
    trackedStatePresent: boolean;
    report: BackupHealthReport | null;
  };
  telemetry: MonitoringCountersSnapshot;
  alerts: MonitoringAlert[];
}

export interface MonitoringDependencies {
  db?: CrmDatabase | null;
  env?: ServerEnv;
  now?: Date;
  backupStatePath?: string | null;
  probeDatabase?: () => Promise<DatabaseStatusReport>;
  measureCapacity?: (db: CrmDatabase, env: ServerEnv) => Promise<MariadbUsageMeasurement>;
  queryProofCounts?: (db: CrmDatabase, ownerUserId: string) => Promise<ProofHealthCounts>;
  queryAuthSummary?: (
    db: CrmDatabase,
    sinceIso: string,
    nowIso: string,
  ) => Promise<AuthHealthLast24h>;
}

async function defaultQueryProofCounts(
  db: CrmDatabase,
  ownerUserId: string,
): Promise<ProofHealthCounts> {
  const rows = await db
    .select({
      storageStatus: crmPaymentProofs.storageStatus,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(crmPaymentProofs)
    .where(eq(crmPaymentProofs.ownerUserId, ownerUserId))
    .groupBy(crmPaymentProofs.storageStatus);

  const counts: ProofHealthCounts = {
    total: 0,
    verified: 0,
    pendingVerify: 0,
    corrupted: 0,
    missing: 0,
    failed: 0,
  };

  for (const row of rows) {
    const n = Number(row.cnt ?? 0);
    counts.total += n;
    switch (row.storageStatus) {
      case "verified":
        counts.verified += n;
        break;
      case "pending_verify":
        counts.pendingVerify += n;
        break;
      case "corrupted":
        counts.corrupted += n;
        break;
      case "missing":
        counts.missing += n;
        break;
      case "failed":
        counts.failed += n;
        break;
      default:
        break;
    }
  }
  return counts;
}

async function defaultQueryAuthSummary(
  db: CrmDatabase,
  sinceMysqlUtc: string,
  nowMysqlUtc: string,
): Promise<AuthHealthLast24h> {
  const auditRows = await db
    .select({
      eventType: crmAuthAudit.eventType,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(crmAuthAudit)
    .where(sql`${crmAuthAudit.createdAt} >= ${sinceMysqlUtc}`)
    .groupBy(crmAuthAudit.eventType);

  const activeSessionRows = await db
    .select({
      cnt: sql<number>`COUNT(*)`,
    })
    .from(crmSessions)
    .where(and(isNull(crmSessions.revokedAt), gt(crmSessions.expiresAt, nowMysqlUtc)));

  const summary: AuthHealthLast24h = {
    windowHours: 24,
    loginSucceeded: 0,
    loginFailed: 0,
    rateLimited: 0,
    sessionRejected: 0,
    activeSessions: Number(activeSessionRows[0]?.cnt ?? 0),
  };

  for (const row of auditRows) {
    const n = Number(row.cnt ?? 0);
    const ev = String(row.eventType ?? "");
    if (ev === "login_succeeded" || ev === "login_success") {
      summary.loginSucceeded += n;
    } else if (ev === "login_failed" || ev === "login_invalid_credentials") {
      summary.loginFailed += n;
    } else if (ev === "login_rate_limited" || ev === "rate_limited") {
      summary.rateLimited += n;
    } else if (
      ev.includes("session") &&
      (ev.includes("reject") || ev.includes("expired") || ev.includes("invalid"))
    ) {
      summary.sessionRejected += n;
    }
  }

  return summary;
}

/**
 * Pure alert rollup function so alert thresholds are unit-testable without a live DB.
 */
export function evaluateMonitoringAlerts(input: {
  databaseReachable: boolean;
  databaseConfigured: boolean;
  storageCapacity: MariadbUsageMeasurement | null;
  proofs: ProofHealthCounts | null;
  auth: AuthHealthLast24h | null;
  backupReport: BackupHealthReport | null;
  telemetry: MonitoringCountersSnapshot;
}): { status: "healthy" | "degraded" | "critical"; alerts: MonitoringAlert[] } {
  const alerts: MonitoringAlert[] = [];

  if (!input.databaseConfigured || !input.databaseReachable) {
    alerts.push({
      severity: "critical",
      subsystem: "database",
      code: "database_unreachable",
      message: "MariaDB connectivity check failed or database is not configured.",
    });
  }

  if (input.storageCapacity) {
    if (
      input.storageCapacity.status === "hard_stop_uploads" ||
      input.storageCapacity.status === "quota_exhausted"
    ) {
      alerts.push({
        severity: "critical",
        subsystem: "storage",
        code: "storage_quota_hard_stop",
        message: `MariaDB storage is at ${input.storageCapacity.percentOfQuota}% (${input.storageCapacity.effectiveUsedMiB} MiB / ${input.storageCapacity.quotaMiB} MiB). New proof uploads are blocked.`,
      });
    } else if (input.storageCapacity.status === "warning") {
      alerts.push({
        severity: "warning",
        subsystem: "storage",
        code: "storage_quota_warning",
        message: `MariaDB storage crossed 50% warning threshold (${input.storageCapacity.effectiveUsedMiB} MiB / ${input.storageCapacity.quotaMiB} MiB).`,
      });
    }
  }

  if (input.proofs) {
    const brokenCount = input.proofs.corrupted + input.proofs.missing + input.proofs.failed;
    if (brokenCount > 0) {
      alerts.push({
        severity: "critical",
        subsystem: "proofs",
        code: "proof_integrity_degraded",
        message: `${brokenCount} payment proof record(s) have degraded status (corrupted=${input.proofs.corrupted}, missing=${input.proofs.missing}, failed=${input.proofs.failed}).`,
      });
    }
  }

  if (input.telemetry.proofUploadFailuresTotal > 0) {
    alerts.push({
      severity: "warning",
      subsystem: "proofs",
      code: "recent_proof_upload_failures",
      message: `${input.telemetry.proofUploadFailuresTotal} proof upload failure(s) recorded since process start (last code: ${input.telemetry.lastProofUploadFailureCode ?? "unknown"}).`,
    });
  }

  if (input.auth && (input.auth.rateLimited > 0 || input.auth.loginFailed >= 5)) {
    alerts.push({
      severity: "warning",
      subsystem: "auth",
      code: "elevated_auth_failures",
      message: `Elevated authentication failures in last 24h (failed=${input.auth.loginFailed}, rateLimited=${input.auth.rateLimited}).`,
    });
  }

  if (input.backupReport) {
    if (input.backupReport.status === "critical") {
      alerts.push({
        severity: "critical",
        subsystem: "backup",
        code: "backup_critical",
        message: input.backupReport.requiredOwnerAction,
      });
    } else if (input.backupReport.status === "warning") {
      alerts.push({
        severity: "warning",
        subsystem: "backup",
        code: "backup_warning",
        message: input.backupReport.requiredOwnerAction,
      });
    }
  }

  if (input.telemetry.unhandledErrorsTotal > 0) {
    alerts.push({
      severity: "warning",
      subsystem: "application",
      code: "unhandled_api_errors",
      message: `${input.telemetry.unhandledErrorsTotal} unhandled API error(s) since process start.`,
    });
  }

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const hasWarning = alerts.some((a) => a.severity === "warning");
  const status = hasCritical ? "critical" : hasWarning ? "degraded" : "healthy";

  return { status, alerts };
}

/**
 * Produces a lightweight, strictly secret-free Owner monitoring snapshot
 * compatible with Hostinger Business Node.js 22 hosting.
 */
export async function getOwnerMonitoringSnapshot(
  ownerUserId: string,
  deps: MonitoringDependencies = {},
): Promise<OwnerMonitoringSnapshot> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? loadServerEnv();
  const safeEnv = summarizeSafeRuntimeEnv(env);
  const storageEnv = assessProofStorageEnv(env);

  const dbReport = deps.probeDatabase ? await deps.probeDatabase() : await getDatabaseStatus(true);

  const dbReachable = Boolean(dbReport.configured && dbReport.reachable === true);
  if (dbReport.configured && !dbReachable) {
    recordDbConnectivityFailure({ reason: "SELECT 1 probe failed", now });
  }

  const db = deps.db !== undefined ? deps.db : getDatabase();

  let capacity: MariadbUsageMeasurement | null = null;
  let proofs: ProofHealthCounts | null = null;
  let auth: AuthHealthLast24h | null = null;

  if (db && dbReachable) {
    if (safeEnv.proofStorageDriver === "mariadb-blob") {
      try {
        capacity = deps.measureCapacity
          ? await deps.measureCapacity(db, env)
          : await measureMariadbCapacityFromDb(db, { env, now });
      } catch {
        capacity = null;
      }
    }

    try {
      proofs = deps.queryProofCounts
        ? await deps.queryProofCounts(db, ownerUserId)
        : await defaultQueryProofCounts(db, ownerUserId);
    } catch {
      proofs = null;
    }

    try {
      const sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sinceMysql = toMysqlUtcDateTime(sinceDate);
      const nowMysql = toMysqlUtcDateTime(now);
      auth = deps.queryAuthSummary
        ? await deps.queryAuthSummary(db, sinceMysql, nowMysql)
        : await defaultQueryAuthSummary(db, sinceMysql, nowMysql);
    } catch {
      auth = null;
    }
  }

  const statePath =
    deps.backupStatePath !== undefined
      ? deps.backupStatePath
      : process.env["BACKUP_HEALTH_STATE_PATH"]?.trim() || null;

  let trackedStatePresent = false;
  let backupReport: BackupHealthReport | null = null;
  if (statePath) {
    const state = loadBackupHealthState(statePath);
    trackedStatePresent = Boolean(state.lastSuccessfulBackupAt || state.lastError);
    backupReport = evaluateBackupHealth(state, now);
  }

  const telemetry = getMonitoringCountersSnapshot(now);
  const rollup = evaluateMonitoringAlerts({
    databaseReachable: dbReachable,
    databaseConfigured: dbReport.configured,
    storageCapacity: capacity,
    proofs,
    auth,
    backupReport,
    telemetry,
  });

  const mem = process.memoryUsage();
  const toMiB = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(2));

  return {
    ok: true,
    status: rollup.status,
    evaluatedAt: now.toISOString(),
    runtime: {
      node: process.version,
      env: safeEnv.nodeEnv,
      timezone: safeEnv.businessTimezone,
      uptimeSeconds: telemetry.uptimeSeconds,
      memoryRssMiB: toMiB(mem.rss),
      memoryHeapUsedMiB: toMiB(mem.heapUsed),
    },
    database: {
      configured: dbReport.configured,
      reachable: dbReachable,
      latencyMs: dbReport.latencyMs,
      poolLimit: dbReport.poolLimit,
      ipv4LoopbackSafe: dbReport.ipv4LoopbackSafe,
    },
    storage: {
      driver: safeEnv.proofStorageDriver,
      productionReady: storageEnv.productionReady,
      durabilityStatus: storageEnv.status,
      capacity,
    },
    proofs,
    auth,
    backup: {
      hostingerDailyHpanelBackups: "managed_by_hostinger_business",
      trackedStatePresent,
      report: backupReport,
    },
    telemetry,
    alerts: rollup.alerts,
  };
}
