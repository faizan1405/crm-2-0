import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import {
  getMariadbQuotaPolicyFromEnv,
  type MariadbQuotaPolicy,
  type ServerEnv,
} from "../config/env.server";
import type { CrmDatabase } from "../db/index.server";
import { CrmServiceError } from "../crm/errors.server";

export const MIB_BYTES = 1024 * 1024;
export const DEFAULT_MARIADB_QUOTA_MIB = 3072;
export const DEFAULT_MARIADB_WARNING_MIB = 1536;
export const DEFAULT_MARIADB_HARD_STOP_MIB = 2150;
export const DEFAULT_MARIADB_SAFETY_MARGIN_MIB = 16;

/** Conservative InnoDB page/undo/index expansion multiplier over raw payload bytes. */
export const MARIADB_BLOB_OVERHEAD_RATIO = 1.06;
export const MARIADB_CHUNK_ROW_OVERHEAD_BYTES = 512;
export const CRM_PROOF_METADATA_OVERHEAD_BYTES = 8192;
export const MARIADB_CAPACITY_LOCK_NAME = "sf_crm_proof_quota_write";

export type MariadbCapacityStatus = "ok" | "warning" | "hard_stop_uploads" | "quota_exhausted";

export interface MariadbUsageMeasurement {
  tableCount: number;
  logicalInfoSchemaBytes: number;
  nonBlobInfoSchemaBytes: number;
  blobTableInfoSchemaBytes: number;
  dataFreeBytes: number;
  blobChunkCount: number;
  blobPayloadBytes: number;
  liveBlobWithOverheadBytes: number;
  rawMeasuredBytes: number;
  safetyMarginBytes: number;
  effectiveUsedBytes: number;
  effectiveUsedMiB: number;
  quotaMiB: number;
  warningThresholdMiB: number;
  hardStopThresholdMiB: number;
  safetyMarginMiB: number;
  percentOfQuota: number;
  remainingProofBudgetBytes: number;
  remainingProofBudgetMiB: number;
  status: MariadbCapacityStatus;
  allowNewProofUploads: boolean;
  measuredAtIso: string;
}

export interface ProofGrowthEstimate {
  incomingBytes: number;
  incomingChunkCount: number;
  incomingFootprintBytes: number;
  reclaimableOldBytes: number;
  netGrowthBytes: number;
  netGrowthMiB: number;
  retainHistoricalBlobs: boolean;
}

export interface ProofQuotaDecision {
  allowed: boolean;
  statusBefore: MariadbCapacityStatus;
  statusAfter: MariadbCapacityStatus;
  warningTriggered: boolean;
  reasonCode: "within_budget" | "warning_threshold_reached" | "hard_stop_exceeded";
  measurement: MariadbUsageMeasurement;
  growth: ProofGrowthEstimate;
  projectedUsedBytes: number;
  projectedUsedMiB: number;
  projectedPercentOfQuota: number;
}

export interface MariadbCapacityLogEvent {
  event: "storage_capacity_warning" | "storage_quota_hard_stop" | "storage_capacity_unavailable";
  timestamp: string;
  operation: "upload" | "replace" | "health";
  paymentId?: string;
  usedMiB?: number;
  projectedMiB?: number;
  quotaMiB: number;
  warningThresholdMiB: number;
  hardStopThresholdMiB: number;
  percentOfQuota?: number;
  netGrowthBytes?: number;
  reason: string;
}

const inProcessCapacityQueues = new WeakMap<object, Promise<void>>();

interface CapacityLockScope {
  heldDbs: Set<object>;
  checkedDbs: Set<object>;
}

const capacityLockStorage = new AsyncLocalStorage<CapacityLockScope>();

/** Returns true if an outer capacity-checked write lock has already verified quota for `db`. */
export function isMariadbQuotaCheckedInScope(db: CrmDatabase): boolean {
  const scope = capacityLockStorage.getStore();
  return Boolean(scope && scope.heldDbs.has(db) && scope.checkedDbs.has(db));
}

/** Marks the active lock scope for `db` as having passed capacity enforcement. */
export function markMariadbQuotaCheckedInScope(db: CrmDatabase): void {
  const scope = capacityLockStorage.getStore();
  if (scope && scope.heldDbs.has(db)) {
    scope.checkedDbs.add(db);
  }
}

function toRoundedMiB(bytes: number): number {
  return Number((bytes / MIB_BYTES).toFixed(2));
}

function parseNonNegativeFiniteInt(value: unknown, field: string): number {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") {
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      `Database storage capacity measurement returned invalid ${field}. Proof uploads fail closed.`,
    );
  }
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      `Database storage capacity measurement returned invalid ${field}. Proof uploads fail closed.`,
    );
  }
  return Math.trunc(n);
}

function extractResultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) {
      return first.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"));
    }
    return result.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"));
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"));
    }
  }
  return [];
}

/** Resolves effective capacity policy thresholds from ServerEnv or process.env with safe defaults. */
export function resolveMariadbQuotaPolicy(
  env?: Partial<
    Pick<
      ServerEnv,
      | "MARIADB_QUOTA_MIB"
      | "MARIADB_WARNING_MIB"
      | "MARIADB_HARD_STOP_MIB"
      | "MARIADB_CAPACITY_SAFETY_MARGIN_MIB"
    >
  >,
): MariadbQuotaPolicy {
  if (env) {
    return getMariadbQuotaPolicyFromEnv(env);
  }
  const readPositiveInt = (key: string): number | undefined => {
    const raw = process.env[key];
    if (!raw || !raw.trim()) return undefined;
    const n = Number(raw.trim());
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  return getMariadbQuotaPolicyFromEnv({
    MARIADB_QUOTA_MIB: readPositiveInt("MARIADB_QUOTA_MIB"),
    MARIADB_WARNING_MIB: readPositiveInt("MARIADB_WARNING_MIB"),
    MARIADB_HARD_STOP_MIB: readPositiveInt("MARIADB_HARD_STOP_MIB"),
    MARIADB_CAPACITY_SAFETY_MARGIN_MIB: readPositiveInt("MARIADB_CAPACITY_SAFETY_MARGIN_MIB"),
  });
}

/**
 * Estimates net MariaDB footprint growth for an incoming payment proof upload or replacement.
 * Historical replaced proofs remain immutable audit evidence (`retainHistoricalBlobs = true`),
 * so physical MariaDB storage grows by the incoming proof's full chunk + metadata footprint.
 */
export function estimateProofGrowthBytes(params: {
  incomingBytes: number;
  chunkSizeBytes?: number;
  existingProofBytes?: number;
  existingChunkCount?: number;
  retainHistoricalBlobs?: boolean;
}): ProofGrowthEstimate {
  const incomingBytes = Number(params.incomingBytes);
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    throw new CrmServiceError(
      400,
      "validation_error",
      "Incoming payment proof size must be a non-negative finite byte count.",
    );
  }
  const chunkSizeBytes = Math.max(1024, Math.trunc(params.chunkSizeBytes ?? MIB_BYTES));
  const incomingChunkCount = incomingBytes === 0 ? 0 : Math.ceil(incomingBytes / chunkSizeBytes);
  const incomingFootprintBytes =
    Math.ceil(incomingBytes * MARIADB_BLOB_OVERHEAD_RATIO) +
    incomingChunkCount * MARIADB_CHUNK_ROW_OVERHEAD_BYTES +
    CRM_PROOF_METADATA_OVERHEAD_BYTES;

  const retainHistoricalBlobs = params.retainHistoricalBlobs ?? true;
  const existingProofBytes = Math.max(0, Number(params.existingProofBytes ?? 0));
  const existingChunkCount = Math.max(
    0,
    Math.trunc(
      params.existingChunkCount ??
        (existingProofBytes === 0 ? 0 : Math.ceil(existingProofBytes / chunkSizeBytes)),
    ),
  );
  const reclaimableOldBytes = retainHistoricalBlobs
    ? 0
    : Math.ceil(existingProofBytes * MARIADB_BLOB_OVERHEAD_RATIO) +
      existingChunkCount * MARIADB_CHUNK_ROW_OVERHEAD_BYTES;

  const netGrowthBytes = Math.max(0, incomingFootprintBytes - reclaimableOldBytes);
  return {
    incomingBytes,
    incomingChunkCount,
    incomingFootprintBytes,
    reclaimableOldBytes,
    netGrowthBytes,
    netGrowthMiB: toRoundedMiB(netGrowthBytes),
    retainHistoricalBlobs,
  };
}

/** Computes capacity status and remaining proof upload budget from a byte count. */
export function classifyCapacityBytes(
  usedBytes: number,
  policy: MariadbQuotaPolicy,
): {
  status: MariadbCapacityStatus;
  percentOfQuota: number;
  remainingProofBudgetBytes: number;
  remainingProofBudgetMiB: number;
  allowNewProofUploads: boolean;
} {
  const quotaBytes = policy.quotaMiB * MIB_BYTES;
  const warningBytes = policy.warningThresholdMiB * MIB_BYTES;
  const hardStopBytes = policy.hardStopThresholdMiB * MIB_BYTES;

  const status: MariadbCapacityStatus =
    usedBytes >= quotaBytes
      ? "quota_exhausted"
      : usedBytes >= hardStopBytes
        ? "hard_stop_uploads"
        : usedBytes >= warningBytes
          ? "warning"
          : "ok";

  const remainingProofBudgetBytes = Math.max(0, hardStopBytes - usedBytes);
  return {
    status,
    percentOfQuota: Number(((usedBytes / quotaBytes) * 100).toFixed(2)),
    remainingProofBudgetBytes,
    remainingProofBudgetMiB: toRoundedMiB(remainingProofBudgetBytes),
    allowNewProofUploads: usedBytes < hardStopBytes,
  };
}

/**
 * Measures live MariaDB storage usage fail-closed by combining `INFORMATION_SCHEMA.TABLES`
 * table/index sizes with an exact zero-lag read of `crm_payment_proof_blobs` plus safety margin.
 */
export async function measureMariadbCapacityFromDb(
  db: CrmDatabase,
  options: {
    policy?: MariadbQuotaPolicy | undefined;
    env?: Partial<ServerEnv> | undefined;
    now?: Date | undefined;
  } = {},
): Promise<MariadbUsageMeasurement> {
  const policy = options.policy ?? resolveMariadbQuotaPolicy(options.env);
  if (!db || typeof (db as { execute?: unknown }).execute !== "function") {
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      "Database handle cannot measure storage capacity safely. Proof uploads fail closed.",
    );
  }

  let tableRows: Record<string, unknown>[];
  let blobSummaryRows: Record<string, unknown>[];
  try {
    const infoRes = await db.execute(
      sql`SELECT TABLE_NAME AS tableName, COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS logicalBytes, COALESCE(DATA_FREE, 0) AS dataFreeBytes FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    );
    const blobRes = await db.execute(
      sql`SELECT COUNT(*) AS blobChunkCount, COALESCE(SUM(chunk_size), 0) AS blobPayloadBytes FROM crm_payment_proof_blobs`,
    );
    tableRows = extractResultRows(infoRes);
    blobSummaryRows = extractResultRows(blobRes);
  } catch (error) {
    if (error instanceof CrmServiceError) {
      throw error;
    }
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      "Unable to measure MariaDB storage utilization. Proof uploads fail closed until capacity can be verified.",
    );
  }

  if (tableRows.length === 0 || blobSummaryRows.length === 0) {
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      "Database capacity query returned empty metadata. Proof uploads fail closed.",
    );
  }

  let nonBlobInfoSchemaBytes = 0;
  let blobTableInfoSchemaBytes = 0;
  let dataFreeBytes = 0;

  for (const row of tableRows) {
    const tableName = typeof row["tableName"] === "string" ? row["tableName"].trim() : "";
    if (!tableName) {
      throw new CrmServiceError(
        503,
        "storage_capacity_unavailable",
        "Database capacity query returned an unnamed table row. Proof uploads fail closed.",
      );
    }
    const logical = parseNonNegativeFiniteInt(row["logicalBytes"], `logicalBytes(${tableName})`);
    const free = parseNonNegativeFiniteInt(
      row["dataFreeBytes"] ?? 0,
      `dataFreeBytes(${tableName})`,
    );
    dataFreeBytes += free;
    if (tableName === "crm_payment_proof_blobs") {
      blobTableInfoSchemaBytes += logical;
    } else {
      nonBlobInfoSchemaBytes += logical;
    }
  }

  const blobSummary = blobSummaryRows[0]!;
  const blobChunkCount = parseNonNegativeFiniteInt(blobSummary["blobChunkCount"], "blobChunkCount");
  const blobPayloadBytes = parseNonNegativeFiniteInt(
    blobSummary["blobPayloadBytes"],
    "blobPayloadBytes",
  );

  const logicalInfoSchemaBytes = nonBlobInfoSchemaBytes + blobTableInfoSchemaBytes;
  const liveBlobWithOverheadBytes =
    blobChunkCount === 0 && blobPayloadBytes === 0
      ? 0
      : Math.ceil(blobPayloadBytes * MARIADB_BLOB_OVERHEAD_RATIO) +
        blobChunkCount * MARIADB_CHUNK_ROW_OVERHEAD_BYTES;

  // Guard against INFORMATION_SCHEMA stats lag immediately after concurrent BLOB writes.
  const rawMeasuredBytes = Math.max(
    logicalInfoSchemaBytes,
    nonBlobInfoSchemaBytes + liveBlobWithOverheadBytes,
  );
  const safetyMarginBytes = policy.safetyMarginMiB * MIB_BYTES;
  const effectiveUsedBytes = rawMeasuredBytes + safetyMarginBytes;
  const classification = classifyCapacityBytes(effectiveUsedBytes, policy);

  return {
    tableCount: tableRows.length,
    logicalInfoSchemaBytes,
    nonBlobInfoSchemaBytes,
    blobTableInfoSchemaBytes,
    dataFreeBytes,
    blobChunkCount,
    blobPayloadBytes,
    liveBlobWithOverheadBytes,
    rawMeasuredBytes,
    safetyMarginBytes,
    effectiveUsedBytes,
    effectiveUsedMiB: toRoundedMiB(effectiveUsedBytes),
    quotaMiB: policy.quotaMiB,
    warningThresholdMiB: policy.warningThresholdMiB,
    hardStopThresholdMiB: policy.hardStopThresholdMiB,
    safetyMarginMiB: policy.safetyMarginMiB,
    percentOfQuota: classification.percentOfQuota,
    remainingProofBudgetBytes: classification.remainingProofBudgetBytes,
    remainingProofBudgetMiB: classification.remainingProofBudgetMiB,
    status: classification.status,
    allowNewProofUploads: classification.allowNewProofUploads,
    measuredAtIso: (options.now ?? new Date()).toISOString(),
  };
}

/**
 * Evaluates whether a proof upload or replacement fits safely below the 70% hard-stop limit.
 * Already being at/above hard-stop OR pushing projected usage >= hard-stop fails closed.
 */
export function evaluateProofUploadQuota(params: {
  measurement: MariadbUsageMeasurement;
  growth: ProofGrowthEstimate;
  policy: MariadbQuotaPolicy;
}): ProofQuotaDecision {
  const { measurement, growth, policy } = params;
  const hardStopBytes = policy.hardStopThresholdMiB * MIB_BYTES;
  const warningBytes = policy.warningThresholdMiB * MIB_BYTES;
  const quotaBytes = policy.quotaMiB * MIB_BYTES;

  const projectedUsedBytes = measurement.effectiveUsedBytes + growth.netGrowthBytes;
  const projectedUsedMiB = toRoundedMiB(projectedUsedBytes);
  const projectedPercentOfQuota = Number(((projectedUsedBytes / quotaBytes) * 100).toFixed(2));
  const afterClass = classifyCapacityBytes(projectedUsedBytes, policy);

  const alreadyAtOrAboveHardStop = measurement.effectiveUsedBytes >= hardStopBytes;
  const wouldReachHardStop =
    growth.netGrowthBytes > 0 ? projectedUsedBytes >= hardStopBytes : alreadyAtOrAboveHardStop;
  const allowed = !alreadyAtOrAboveHardStop && !wouldReachHardStop;
  const warningTriggered =
    allowed &&
    (measurement.effectiveUsedBytes >= warningBytes || projectedUsedBytes >= warningBytes);

  return {
    allowed,
    statusBefore: measurement.status,
    statusAfter: afterClass.status,
    warningTriggered,
    reasonCode: !allowed
      ? "hard_stop_exceeded"
      : warningTriggered
        ? "warning_threshold_reached"
        : "within_budget",
    measurement,
    growth,
    projectedUsedBytes,
    projectedUsedMiB,
    projectedPercentOfQuota,
  };
}

/** Builds a secret-free structured capacity telemetry event and logs via console when needed. */
export function emitCapacityLogEvent(
  event: MariadbCapacityLogEvent,
  onCapacityEvent?: (entry: MariadbCapacityLogEvent) => void,
): void {
  onCapacityEvent?.(event);
  const serialized = JSON.stringify(event);
  if (event.event === "storage_capacity_warning") {
    console.warn(`[CRM Capacity] ${serialized}`);
  } else {
    console.error(`[CRM Capacity] ${serialized}`);
  }
}

/** Runs quota measurement + decision checks and throws 507 `storage_quota_exceeded` when blocked. */
export async function enforceMariadbProofQuota(params: {
  db: CrmDatabase;
  operation: "upload" | "replace";
  paymentId: string;
  incomingBytes: number;
  existingProofBytes?: number | undefined;
  retainHistoricalBlobs?: boolean | undefined;
  env?: Partial<ServerEnv> | undefined;
  policy?: MariadbQuotaPolicy | undefined;
  onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
}): Promise<ProofQuotaDecision> {
  const policy = params.policy ?? resolveMariadbQuotaPolicy(params.env);
  let measurement: MariadbUsageMeasurement;
  try {
    measurement = await measureMariadbCapacityFromDb(params.db, { policy, env: params.env });
  } catch (error) {
    const reason =
      error instanceof CrmServiceError
        ? error.message
        : "Failed to verify MariaDB storage capacity safely.";
    emitCapacityLogEvent(
      {
        event: "storage_capacity_unavailable",
        timestamp: new Date().toISOString(),
        operation: params.operation,
        paymentId: params.paymentId,
        quotaMiB: policy.quotaMiB,
        warningThresholdMiB: policy.warningThresholdMiB,
        hardStopThresholdMiB: policy.hardStopThresholdMiB,
        reason,
      },
      params.onCapacityEvent,
    );
    if (error instanceof CrmServiceError) {
      throw error;
    }
    throw new CrmServiceError(503, "storage_capacity_unavailable", reason);
  }

  const growth = estimateProofGrowthBytes({
    incomingBytes: params.incomingBytes,
    existingProofBytes: params.existingProofBytes ?? 0,
    retainHistoricalBlobs: params.retainHistoricalBlobs ?? true,
  });

  const decision = evaluateProofUploadQuota({ measurement, growth, policy });
  const nowIso = new Date().toISOString();

  if (!decision.allowed) {
    emitCapacityLogEvent(
      {
        event: "storage_quota_hard_stop",
        timestamp: nowIso,
        operation: params.operation,
        paymentId: params.paymentId,
        usedMiB: measurement.effectiveUsedMiB,
        projectedMiB: decision.projectedUsedMiB,
        quotaMiB: policy.quotaMiB,
        warningThresholdMiB: policy.warningThresholdMiB,
        hardStopThresholdMiB: policy.hardStopThresholdMiB,
        percentOfQuota: decision.projectedPercentOfQuota,
        netGrowthBytes: growth.netGrowthBytes,
        reason: "MariaDB payment-proof storage hard-stop (70% capacity threshold) reached.",
      },
      params.onCapacityEvent,
    );

    throw new CrmServiceError(
      507,
      "storage_quota_exceeded",
      `Payment proof storage limit reached (${measurement.effectiveUsedMiB} MiB of ${policy.quotaMiB} MiB used; safety limit ${policy.hardStopThresholdMiB} MiB). New uploads are paused to protect CRM database operations; existing proofs and payment records remain safe.`,
      {
        details: {
          usedMiB: measurement.effectiveUsedMiB,
          projectedMiB: decision.projectedUsedMiB,
          hardStopMiB: policy.hardStopThresholdMiB,
          warningMiB: policy.warningThresholdMiB,
          quotaMiB: policy.quotaMiB,
          percentOfQuota: decision.projectedPercentOfQuota,
          remainingProofBudgetMiB: measurement.remainingProofBudgetMiB,
          netGrowthMiB: growth.netGrowthMiB,
          action:
            "Archive or prune historical proofs with your administrator or expand database capacity before uploading additional payment proofs.",
        },
      },
    );
  }

  if (decision.warningTriggered) {
    emitCapacityLogEvent(
      {
        event: "storage_capacity_warning",
        timestamp: nowIso,
        operation: params.operation,
        paymentId: params.paymentId,
        usedMiB: measurement.effectiveUsedMiB,
        projectedMiB: decision.projectedUsedMiB,
        quotaMiB: policy.quotaMiB,
        warningThresholdMiB: policy.warningThresholdMiB,
        hardStopThresholdMiB: policy.hardStopThresholdMiB,
        percentOfQuota: decision.projectedPercentOfQuota,
        netGrowthBytes: growth.netGrowthBytes,
        reason: "MariaDB storage utilization crossed the 50% capacity warning threshold.",
      },
      params.onCapacityEvent,
    );
  }

  return decision;
}

interface PoolLikeClient {
  pool?: { config?: { connectionLimit?: number } };
  getConnection?: () => Promise<{
    query: (sqlText: string, params?: unknown[]) => Promise<unknown>;
    release: () => void;
  }>;
}

/**
 * Serializes concurrent capacity-checked proof writes across BOTH in-process async callers
 * (FIFO mutex per DB handle) AND external Node workers via MariaDB `GET_LOCK` held until
 * the database transaction commits, preventing race-condition quota bypasses.
 */
export async function withMariadbCapacityWriteLock<T>(
  db: CrmDatabase,
  fn: () => Promise<T>,
  lockTimeoutSeconds = 10,
): Promise<T> {
  if (!db || typeof db !== "object") {
    throw new CrmServiceError(
      503,
      "storage_capacity_unavailable",
      "Database handle unavailable for capacity lock. Proof uploads fail closed.",
    );
  }

  const existingScope = capacityLockStorage.getStore();
  if (existingScope?.heldDbs.has(db)) {
    return await fn();
  }

  const nextScope: CapacityLockScope = {
    heldDbs: new Set(existingScope ? [...existingScope.heldDbs, db] : [db]),
    checkedDbs: new Set(existingScope ? [...existingScope.checkedDbs] : []),
  };

  const prev = inProcessCapacityQueues.get(db) ?? Promise.resolve();
  let releaseInProcess!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  const chained = prev.then(
    () => gate,
    () => gate,
  );
  inProcessCapacityQueues.set(db, chained);

  await prev;
  try {
    const client = (db as { $client?: PoolLikeClient }).$client;
    const poolLimit = client?.pool?.config?.connectionLimit;
    const canCheckoutDedicatedConn =
      typeof client?.getConnection === "function" && (poolLimit === undefined || poolLimit > 1);

    if (canCheckoutDedicatedConn && client?.getConnection) {
      let lockConn: Awaited<ReturnType<NonNullable<PoolLikeClient["getConnection"]>>> | null = null;
      let acquiredLock = false;
      try {
        lockConn = await client.getConnection();
        const lockRes = await lockConn.query("SELECT GET_LOCK(?, ?) AS acquired", [
          MARIADB_CAPACITY_LOCK_NAME,
          lockTimeoutSeconds,
        ]);
        const rows = extractResultRows(lockRes);
        const acquired = rows[0] ? Number(rows[0]["acquired"]) : NaN;
        if (acquired !== 1) {
          throw new CrmServiceError(
            503,
            "storage_capacity_unavailable",
            "Could not acquire database capacity lock before upload. Please retry.",
          );
        }
        acquiredLock = true;
        return await capacityLockStorage.run(nextScope, fn);
      } catch (error) {
        if (error instanceof CrmServiceError) {
          throw error;
        }
        throw new CrmServiceError(
          503,
          "storage_capacity_unavailable",
          "Database capacity lock could not be verified. Proof uploads fail closed.",
        );
      } finally {
        if (lockConn) {
          if (acquiredLock) {
            try {
              await lockConn.query("SELECT RELEASE_LOCK(?) AS released", [
                MARIADB_CAPACITY_LOCK_NAME,
              ]);
            } catch {
              // Connection release closes session lock safely on disconnect.
            }
          }
          try {
            lockConn.release();
          } catch {
            // Ignore double release.
          }
        }
      }
    }

    // Fallback for test doubles or single-connection pools (`DB_POOL_LIMIT=1`).
    let acquiredFallbackLock = false;
    try {
      const lockRes = await db.execute(
        sql`SELECT GET_LOCK(${MARIADB_CAPACITY_LOCK_NAME}, ${lockTimeoutSeconds}) AS acquired`,
      );
      const rows = extractResultRows(lockRes);
      const acquired = rows[0] ? Number(rows[0]["acquired"]) : NaN;
      if (acquired !== 1) {
        throw new CrmServiceError(
          503,
          "storage_capacity_unavailable",
          "Could not acquire database capacity lock before upload. Please retry.",
        );
      }
      acquiredFallbackLock = true;
    } catch (error) {
      if (error instanceof CrmServiceError) {
        throw error;
      }
      throw new CrmServiceError(
        503,
        "storage_capacity_unavailable",
        "Database capacity lock could not be verified. Proof uploads fail closed.",
      );
    }

    try {
      return await capacityLockStorage.run(nextScope, fn);
    } finally {
      if (acquiredFallbackLock) {
        try {
          await db.execute(sql`SELECT RELEASE_LOCK(${MARIADB_CAPACITY_LOCK_NAME}) AS released`);
        } catch {
          // Ignore release failure.
        }
      }
    }
  } finally {
    releaseInProcess();
  }
}
