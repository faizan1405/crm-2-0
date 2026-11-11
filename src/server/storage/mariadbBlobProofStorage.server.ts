import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { asc, eq, sql } from "drizzle-orm";
import { generateServerId } from "../auth/security.server";
import {
  assessProofStorageEnv,
  getDatabaseConnectionConfig,
  parseServerEnv,
  type ProofStorageEnvAssessment,
  type ServerEnv,
} from "../config/env.server";
import { CrmServiceError } from "../crm/errors.server";
import {
  enforceMariadbProofQuota,
  isMariadbQuotaCheckedInScope,
  measureMariadbCapacityFromDb,
  resolveMariadbQuotaPolicy,
  withMariadbCapacityWriteLock,
  type MariadbCapacityLogEvent,
  type MariadbUsageMeasurement,
} from "./mariadbCapacity.server";
import type { MariadbQuotaPolicy } from "../config/env.server";
import { getDatabase, type CrmDatabase } from "../db/index.server";
import { crmPaymentProofBlobs } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import {
  isValidProofStorageKey,
  type GetPrivateObjectResult,
  type ProofHeadResult,
  type ProofOrphanListingResult,
  type ProofStorageBackend,
  type ProofStorageDriverKind,
  type ProofStorageHealthSummary,
  type ProofVerificationResult,
  type PutPrivateObjectParams,
  type StoredProofDescriptor,
} from "./proofStorage.server";
import {
  MAX_PROOF_BYTES,
  sniffProofKind,
  validateProofHeaderAndMetadata,
  type ValidatedProofDescriptor,
} from "./proofValidation.server";

/**
 * 1 MiB chunk ceiling stays ~15x under Hostinger Business MySQL's documented
 * 16 MB `max_allowed_packet` limit even for maximum-size 10 MiB payment proof PDFs.
 */
export const MARIADB_PROOF_CHUNK_BYTES = 1_048_576;

interface StagedMemoryUpload {
  ownerUserId: string;
  buffer: Buffer;
  byteSize: number;
  sha256: string;
  descriptor: ValidatedProofDescriptor;
  createdAtMs: number;
}

export interface MariadbBlobProofStorageOptions {
  db?: CrmDatabase | null | undefined;
  nodeEnv?: ServerEnv["NODE_ENV"] | undefined;
  productionDurableConfirmed?: boolean | undefined;
  dbConfigured?: boolean | undefined;
  maxBlobBytes?: number | undefined;
  chunkBytes?: number | undefined;
  tempTtlMs?: number | undefined;
  env?: ServerEnv | undefined;
  quotaPolicy?: MariadbQuotaPolicy | undefined;
  retainHistoricalBlobs?: boolean | undefined;
  onCapacityEvent?: ((entry: MariadbCapacityLogEvent) => void) | undefined;
}

/**
 * Splits a binary buffer into bounded sequential chunks so no SQL packet nears
 * Hostinger's 16 MB MySQL packet ceiling.
 */
export function splitBufferIntoProofChunks(
  buffer: Buffer,
  chunkBytes: number = MARIADB_PROOF_CHUNK_BYTES,
): Buffer[] {
  const safeChunkSize = Math.max(1, Math.min(chunkBytes, MARIADB_PROOF_CHUNK_BYTES));
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += safeChunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(buffer.byteLength, offset + safeChunkSize)));
  }
  return chunks;
}

async function collectUploadBuffer(
  streamOrBuffer: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  if (Buffer.isBuffer(streamOrBuffer) || streamOrBuffer instanceof Uint8Array) {
    const buf = Buffer.from(streamOrBuffer);
    if (buf.byteLength > maxBytes) {
      throw new CrmServiceError(
        400,
        "file_too_large",
        `Payment proof file exceeds ${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB limit.`,
      );
    }
    if (buf.byteLength === 0) {
      throw new CrmServiceError(400, "empty_file", "Payment proof file is empty.");
    }
    return buf;
  }

  const nodeReadable =
    "getReader" in streamOrBuffer
      ? Readable.fromWeb(streamOrBuffer as unknown as import("node:stream/web").ReadableStream)
      : (streamOrBuffer as NodeJS.ReadableStream);

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of nodeReadable) {
    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += chunkBuf.byteLength;
    if (totalBytes > maxBytes) {
      throw new CrmServiceError(
        400,
        "file_too_large",
        `Payment proof file exceeds ${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB limit.`,
      );
    }
    chunks.push(chunkBuf);
  }

  if (totalBytes === 0) {
    throw new CrmServiceError(400, "empty_file", "Payment proof file is empty.");
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * Option B payment-receipt backend: stores validated private proof files inside
 * chunked MariaDB LONGBLOB rows (`crm_payment_proof_blobs`) so proof binaries live
 * in the same transactional database & automated Hostinger MySQL backups as payment records.
 */
export class MariadbBlobProofStorage implements ProofStorageBackend {
  readonly driver: ProofStorageDriverKind = "mariadb-blob";
  private readonly explicitDb: CrmDatabase | null | undefined;
  private readonly options: MariadbBlobProofStorageOptions;
  private readonly maxBlobBytes: number;
  private readonly chunkBytes: number;
  private readonly tempTtlMs: number;
  private readonly stagedUploads = new Map<string, StagedMemoryUpload>();

  constructor(options: MariadbBlobProofStorageOptions = {}) {
    this.options = options;
    this.explicitDb = options.db;
    const configuredMax =
      options.maxBlobBytes ?? options.env?.PROOF_DB_MAX_BLOB_BYTES ?? MAX_PROOF_BYTES;
    this.maxBlobBytes = Math.max(1024, Math.min(configuredMax, MAX_PROOF_BYTES));
    this.chunkBytes = Math.max(
      1,
      Math.min(options.chunkBytes ?? MARIADB_PROOF_CHUNK_BYTES, MARIADB_PROOF_CHUNK_BYTES),
    );
    this.tempTtlMs = options.tempTtlMs ?? 15 * 60 * 1000;
  }

  private resolveDb(): CrmDatabase | null {
    if (this.explicitDb !== undefined) return this.explicitDb;
    return getDatabase();
  }

  /** Returns resolved MariaDB quota policy and telemetry options configured for this backend. */
  resolveCapacityOptions(): {
    policy: MariadbQuotaPolicy;
    env: ServerEnv | undefined;
    retainHistoricalBlobs: boolean;
    onCapacityEvent: ((entry: MariadbCapacityLogEvent) => void) | undefined;
  } {
    return {
      policy: this.options.quotaPolicy ?? resolveMariadbQuotaPolicy(this.options.env),
      env: this.options.env,
      retainHistoricalBlobs: this.options.retainHistoricalBlobs ?? true,
      onCapacityEvent: this.options.onCapacityEvent,
    };
  }

  /** Measures live MariaDB storage usage fail-closed using configured quota thresholds. */
  async inspectCapacity(): Promise<MariadbUsageMeasurement> {
    const db = this.requireDbAndWritable();
    const { policy, env } = this.resolveCapacityOptions();
    return measureMariadbCapacityFromDb(db, { policy, env });
  }

  private computeEnvAssessment(): ProofStorageEnvAssessment {
    const baseEnv = this.options.env;
    const nodeEnv =
      this.options.nodeEnv ??
      baseEnv?.NODE_ENV ??
      (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "test"
        ? process.env["NODE_ENV"]
        : "development");
    const prodConfirmed =
      this.options.productionDurableConfirmed ??
      (baseEnv
        ? baseEnv.PROOF_PRODUCTION_DURABLE_CONFIRMED === "true"
        : process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"] === "true");

    const envDbConfigured = baseEnv ? getDatabaseConnectionConfig(baseEnv).configured : false;
    const hasDb = this.options.dbConfigured ?? (Boolean(this.resolveDb()) || envDbConfigured);

    return assessProofStorageEnv(
      parseServerEnv({
        NODE_ENV: nodeEnv,
        PROOF_STORAGE_DRIVER: "mariadb-blob",
        PROOF_PRODUCTION_DURABLE_CONFIRMED: prodConfirmed ? "true" : "false",
        ...(hasDb
          ? baseEnv?.DATABASE_URL
            ? { DATABASE_URL: baseEnv.DATABASE_URL }
            : {
                DB_HOST: baseEnv?.DB_HOST ?? "127.0.0.1",
                DB_NAME: baseEnv?.DB_NAME ?? "crm_db",
                DB_USER: baseEnv?.DB_USER ?? "crm_user",
              }
          : {}),
      }),
    );
  }

  private requireDbAndWritable(): CrmDatabase {
    const assessment = this.computeEnvAssessment();
    if (assessment.failClosed) {
      throw new CrmServiceError(
        503,
        assessment.blockedCode ?? "storage_durability_blocked",
        assessment.reasons[0] ??
          "MariaDB BLOB payment proof storage is not approved for production without durability verification.",
      );
    }

    const db = this.resolveDb();
    if (!db) {
      throw new CrmServiceError(
        503,
        "storage_not_configured",
        "MariaDB BLOB proof storage requires an active database connection.",
      );
    }

    return db;
  }

  private pruneExpiredStaging(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [key, item] of this.stagedUploads.entries()) {
      if (nowMs - item.createdAtMs > this.tempTtlMs) {
        this.stagedUploads.delete(key);
        removed++;
      }
    }
    return removed;
  }

  healthSummary(): ProofStorageHealthSummary {
    const dbAvailable = Boolean(this.resolveDb());
    const envAssessment = this.computeEnvAssessment();
    const reasons = [...envAssessment.reasons];
    if (!dbAvailable) {
      reasons.push("Active MariaDB database pool is not currently attached.");
    }
    const resolvedBlockedCode: ProofStorageHealthSummary["blockedCode"] =
      envAssessment.blockedCode ?? (!dbAvailable ? "storage_not_configured" : undefined);
    return {
      driver: this.driver,
      configured: envAssessment.configured && dbAvailable,
      writable: envAssessment.writable && dbAvailable,
      productionReady: envAssessment.productionReady && dbAvailable,
      failClosed: envAssessment.failClosed || !dbAvailable,
      persistentWarning: !envAssessment.productionReady,
      status: envAssessment.status,
      ...(resolvedBlockedCode ? { blockedCode: resolvedBlockedCode } : {}),
      reasons,
    };
  }

  async stageUpload(params: {
    ownerUserId: string;
    originalFileName: string;
    declaredMimeType?: string | null | undefined;
    streamOrBuffer: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>;
    maxBytes?: number | undefined;
  }): Promise<{
    tempKey: string;
    tempPath: string;
    byteSize: number;
    sha256: string;
    descriptor: ValidatedProofDescriptor;
  }> {
    this.requireDbAndWritable();
    this.pruneExpiredStaging();

    const effectiveMaxBytes = Math.min(params.maxBytes ?? this.maxBlobBytes, this.maxBlobBytes);
    const buffer = await collectUploadBuffer(params.streamOrBuffer, effectiveMaxBytes);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const headerBytes = buffer.subarray(0, Math.min(16, buffer.byteLength));
    const descriptor = validateProofHeaderAndMetadata({
      originalName: params.originalFileName,
      fileSize: buffer.byteLength,
      headerBytes,
      declaredMimeType: params.declaredMimeType,
      fullBytes: buffer,
    });

    const tempKey = `tmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.tmp`;
    this.stagedUploads.set(tempKey, {
      ownerUserId: params.ownerUserId,
      buffer,
      byteSize: buffer.byteLength,
      sha256,
      descriptor,
      createdAtMs: Date.now(),
    });

    return {
      tempKey,
      tempPath: `mariadb-staging://${tempKey}`,
      byteSize: buffer.byteLength,
      sha256,
      descriptor,
    };
  }

  async persistStagedProof(params: {
    ownerUserId: string;
    proofId: string;
    tempKey: string;
    ext: string;
    expectedSha256?: string | undefined;
    expectedByteSize?: number | undefined;
  }): Promise<{
    storageKey: string;
    byteSize: number;
    sha256: string;
  }> {
    const db = this.requireDbAndWritable();
    const staged = this.stagedUploads.get(params.tempKey);
    if (!staged) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Staged proof temporary object was not found in MariaDB staging buffer.",
      );
    }

    if (staged.ownerUserId !== params.ownerUserId) {
      throw new CrmServiceError(
        403,
        "storage_error",
        "Refusing cross-owner staged proof persistence.",
      );
    }

    if (
      (params.expectedByteSize !== undefined && staged.byteSize !== params.expectedByteSize) ||
      (params.expectedSha256 !== undefined && staged.sha256 !== params.expectedSha256.toLowerCase())
    ) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Staged payment proof checksum or byte size mismatch before MariaDB persistence.",
      );
    }

    const storageKey = `prf_${params.proofId}.${params.ext.toLowerCase()}`;
    if (!isValidProofStorageKey(storageKey)) {
      throw new CrmServiceError(400, "storage_error", "Invalid payment proof storage key.");
    }

    const chunks = splitBufferIntoProofChunks(staged.buffer, this.chunkBytes);
    const nowUtc = toMysqlUtcDateTime(new Date());
    const capOpts = this.resolveCapacityOptions();

    await withMariadbCapacityWriteLock(db, async () => {
      if (!isMariadbQuotaCheckedInScope(db)) {
        await enforceMariadbProofQuota({
          db,
          operation: "upload",
          paymentId: params.proofId,
          incomingBytes: staged.byteSize,
          retainHistoricalBlobs: capOpts.retainHistoricalBlobs,
          env: capOpts.env,
          policy: capOpts.policy,
          onCapacityEvent: capOpts.onCapacityEvent,
        });
      }

      const existing = await db
        .select({ id: crmPaymentProofBlobs.id })
        .from(crmPaymentProofBlobs)
        .where(eq(crmPaymentProofBlobs.storageKey, storageKey))
        .limit(1);

      if (existing[0]) {
        throw new CrmServiceError(
          409,
          "storage_error",
          "Target private proof storage key already exists in MariaDB; refusing overwrite.",
        );
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          await tx.insert(crmPaymentProofBlobs).values({
            id: generateServerId("pblob"),
            ownerUserId: params.ownerUserId,
            storageKey,
            chunkIndex: i,
            chunkCount: chunks.length,
            chunkSize: chunk.byteLength,
            totalByteSize: staged.byteSize,
            totalSha256: staged.sha256,
            mimeType: staged.descriptor.mimeType,
            blobData: chunk,
            createdAt: nowUtc,
          });
        }
      });
    });

    this.stagedUploads.delete(params.tempKey);

    const verify = await this.verifyPrivateObject(storageKey, {
      sha256: staged.sha256,
      byteSize: staged.byteSize,
    });
    if (!verify.ok || !verify.sha256) {
      await this.deleteProof(storageKey).catch(() => undefined);
      throw new CrmServiceError(
        500,
        "storage_error",
        "Persisted MariaDB payment proof failed post-write integrity verification.",
      );
    }

    return {
      storageKey,
      byteSize: verify.byteSize,
      sha256: verify.sha256,
    };
  }

  async putPrivateObject(params: PutPrivateObjectParams): Promise<StoredProofDescriptor> {
    this.requireDbAndWritable();
    const staged = await this.stageUpload({
      ownerUserId: params.ownerUserId,
      originalFileName: params.originalFileName,
      declaredMimeType: params.declaredMimeType,
      streamOrBuffer: params.content,
      maxBytes: params.maxBytes,
    });
    const proofId =
      params.proofId && /^[A-Za-z0-9_-]{3,80}$/.test(params.proofId)
        ? params.proofId
        : crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    try {
      const persisted = await this.persistStagedProof({
        ownerUserId: params.ownerUserId,
        proofId,
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
        expectedByteSize: staged.byteSize,
      });
      return {
        storageKey: persisted.storageKey,
        byteSize: persisted.byteSize,
        sha256: persisted.sha256,
        mimeType: staged.descriptor.mimeType,
      };
    } catch (err) {
      await this.deleteTemp(staged.tempKey).catch(() => undefined);
      throw err;
    }
  }

  private async loadVerifiedChunks(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<{ verification: ProofVerificationResult; buffer: Buffer | null }> {
    const db = this.requireDbAndWritable();
    if (!isValidProofStorageKey(storageKey)) {
      throw new CrmServiceError(400, "storage_error", "Invalid payment proof storage key.");
    }

    const rows = await db
      .select()
      .from(crmPaymentProofBlobs)
      .where(eq(crmPaymentProofBlobs.storageKey, storageKey))
      .orderBy(asc(crmPaymentProofBlobs.chunkIndex));

    if (rows.length === 0) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "missing",
          byteSize: 0,
          sha256: null,
          reason: "Stored payment proof blob was not found in MariaDB.",
        },
      };
    }

    const expectedChunkCount = rows[0]!.chunkCount;
    const declaredTotalBytes = rows[0]!.totalByteSize;
    const declaredSha256 = rows[0]!.totalSha256.toLowerCase();

    if (expectedChunkCount <= 0 || rows.length !== expectedChunkCount) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "size_mismatch",
          byteSize: 0,
          sha256: null,
          reason: `Missing or extra BLOB chunks (expected ${expectedChunkCount}, found ${rows.length}).`,
        },
      };
    }

    const parts: Buffer[] = [];
    let actualTotalBytes = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const chunkBuf = Buffer.isBuffer(row.blobData) ? row.blobData : Buffer.from(row.blobData);
      if (
        row.chunkIndex !== i ||
        row.chunkCount !== expectedChunkCount ||
        row.totalByteSize !== declaredTotalBytes ||
        row.totalSha256.toLowerCase() !== declaredSha256 ||
        chunkBuf.byteLength !== row.chunkSize
      ) {
        return {
          buffer: null,
          verification: {
            ok: false,
            status: "checksum_mismatch",
            byteSize: actualTotalBytes,
            sha256: null,
            reason: `Chunk ${i} metadata or byte size mismatch in MariaDB BLOB storage.`,
          },
        };
      }
      parts.push(chunkBuf);
      actualTotalBytes += chunkBuf.byteLength;
    }

    if (actualTotalBytes === 0 || actualTotalBytes !== declaredTotalBytes) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "size_mismatch",
          byteSize: actualTotalBytes,
          sha256: null,
          reason: `Reassembled BLOB byte size (${actualTotalBytes}) does not match declared (${declaredTotalBytes}).`,
        },
      };
    }

    if (expected?.byteSize !== undefined && actualTotalBytes !== expected.byteSize) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "size_mismatch",
          byteSize: actualTotalBytes,
          sha256: null,
          reason: `Stored BLOB byte size (${actualTotalBytes}) does not match expected (${expected.byteSize}).`,
        },
      };
    }

    const combined = Buffer.concat(parts, actualTotalBytes);
    const actualSha256 = crypto.createHash("sha256").update(combined).digest("hex");

    if (actualSha256 !== declaredSha256) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "checksum_mismatch",
          byteSize: actualTotalBytes,
          sha256: actualSha256,
          reason: "Reassembled BLOB SHA-256 digest does not match chunk header checksum.",
        },
      };
    }

    if (expected?.sha256 && actualSha256 !== expected.sha256.toLowerCase()) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "checksum_mismatch",
          byteSize: actualTotalBytes,
          sha256: actualSha256,
          reason: "Stored payment proof SHA-256 digest does not match recorded database digest.",
        },
      };
    }

    if (!sniffProofKind(combined.subarray(0, 16))) {
      return {
        buffer: null,
        verification: {
          ok: false,
          status: "unreadable",
          byteSize: actualTotalBytes,
          sha256: actualSha256,
          reason: "Stored binary header signature could not be validated.",
        },
      };
    }

    return {
      buffer: combined,
      verification: {
        ok: true,
        status: "verified",
        byteSize: actualTotalBytes,
        sha256: actualSha256,
      },
    };
  }

  async verifyPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<ProofVerificationResult> {
    const { verification } = await this.loadVerifiedChunks(storageKey, expected);
    return verification;
  }

  async headPrivateObject(storageKey: string): Promise<ProofHeadResult> {
    const db = this.requireDbAndWritable();
    if (!isValidProofStorageKey(storageKey)) {
      throw new CrmServiceError(400, "storage_error", "Invalid payment proof storage key.");
    }

    const rows = await db
      .select({
        totalByteSize: crmPaymentProofBlobs.totalByteSize,
        createdAt: crmPaymentProofBlobs.createdAt,
      })
      .from(crmPaymentProofBlobs)
      .where(eq(crmPaymentProofBlobs.storageKey, storageKey))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { exists: false, byteSize: 0, updatedAtMs: 0 };
    }
    const parsedMs = Date.parse(`${String(row.createdAt).replace(" ", "T")}Z`);
    return {
      exists: true,
      byteSize: row.totalByteSize,
      updatedAtMs: Number.isFinite(parsedMs) ? parsedMs : 0,
    };
  }

  async getPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<GetPrivateObjectResult | null> {
    const { verification, buffer } = await this.loadVerifiedChunks(storageKey, expected);
    if (!verification.ok || !buffer) {
      if (verification.status === "missing") {
        return null;
      }
      throw new CrmServiceError(
        500,
        "file_corrupted",
        verification.reason ??
          "Stored payment proof binary failed SHA-256 and byte-length integrity verification.",
      );
    }

    return {
      buffer,
      stream: Readable.from(buffer),
      byteSize: verification.byteSize,
      sha256: verification.sha256!,
    };
  }

  async readProofStream(storageKey: string): Promise<{
    stream: NodeJS.ReadableStream;
    byteSize: number;
  } | null> {
    const obj = await this.getPrivateObject(storageKey);
    if (!obj) return null;
    return {
      stream: obj.stream,
      byteSize: obj.byteSize,
    };
  }

  async readProofBuffer(storageKey: string): Promise<Buffer | null> {
    const obj = await this.getPrivateObject(storageKey);
    return obj ? obj.buffer : null;
  }

  async exists(storageKey: string): Promise<boolean> {
    const head = await this.headPrivateObject(storageKey);
    return head.exists;
  }

  async deletePrivateObject(storageKey: string): Promise<boolean> {
    return this.deleteProof(storageKey);
  }

  async deleteProof(storageKey: string): Promise<boolean> {
    const db = this.requireDbAndWritable();
    if (!isValidProofStorageKey(storageKey)) {
      throw new CrmServiceError(400, "storage_error", "Invalid payment proof storage key.");
    }

    const existing = await db
      .select({ id: crmPaymentProofBlobs.id })
      .from(crmPaymentProofBlobs)
      .where(eq(crmPaymentProofBlobs.storageKey, storageKey))
      .limit(1);

    if (!existing[0]) {
      return false;
    }

    await db.delete(crmPaymentProofBlobs).where(eq(crmPaymentProofBlobs.storageKey, storageKey));
    return true;
  }

  async deleteTemp(tempKey: string): Promise<boolean> {
    return this.stagedUploads.delete(tempKey);
  }

  async cleanupAbandonedTemp(maxAgeMs: number = 3_600_000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, item] of this.stagedUploads.entries()) {
      if (now - item.createdAtMs > maxAgeMs) {
        this.stagedUploads.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  async reconcileStorage(
    activeKeys: Set<string>,
    options?: { minAgeMs?: number | undefined },
  ): Promise<{
    unreferencedFiles: string[];
    missingKeys: string[];
    gracePeriodSkippedCount: number;
  }> {
    const db = this.requireDbAndWritable();
    const minAgeMs = options?.minAgeMs ?? 15 * 60 * 1000;
    const now = Date.now();

    const storedRows = await db
      .select({
        storageKey: crmPaymentProofBlobs.storageKey,
        createdAt: sql<string>`MIN(${crmPaymentProofBlobs.createdAt})`.as("minCreatedAt"),
      })
      .from(crmPaymentProofBlobs)
      .groupBy(crmPaymentProofBlobs.storageKey);

    const existingKeys = new Set<string>();
    const unreferencedFiles: string[] = [];
    let gracePeriodSkippedCount = 0;

    for (const row of storedRows) {
      existingKeys.add(row.storageKey);
      if (!activeKeys.has(row.storageKey)) {
        const createdMs = Date.parse(`${String(row.createdAt).replace(" ", "T")}Z`);
        if (minAgeMs > 0 && Number.isFinite(createdMs) && now - createdMs < minAgeMs) {
          gracePeriodSkippedCount++;
          continue;
        }
        unreferencedFiles.push(row.storageKey);
      }
    }

    const missingKeys: string[] = [];
    for (const key of activeKeys) {
      if (!existingKeys.has(key)) {
        missingKeys.push(key);
      }
    }

    return {
      unreferencedFiles,
      missingKeys,
      gracePeriodSkippedCount,
    };
  }

  async listOrphanedObjects(
    referencedKeys: ReadonlySet<string>,
    options?: { minAgeMs?: number | undefined; tempMaxAgeMs?: number | undefined },
  ): Promise<ProofOrphanListingResult> {
    const reconcile = await this.reconcileStorage(new Set(referencedKeys), {
      minAgeMs: options?.minAgeMs,
    });
    const staleTempFiles: string[] = [];
    const tempMaxAgeMs = options?.tempMaxAgeMs ?? 3_600_000;
    const now = Date.now();
    for (const [key, item] of this.stagedUploads.entries()) {
      if (now - item.createdAtMs >= tempMaxAgeMs) {
        staleTempFiles.push(key);
      }
    }
    return {
      ...reconcile,
      staleTempFiles,
    };
  }
}
