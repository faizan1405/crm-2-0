import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  assessProofStorageEnv,
  parseServerEnv,
  verifyDisposableProofTestStorageConfig,
  type ProofStorageEnvAssessment,
  type ServerEnv,
} from "../config/env.server";
import { CrmServiceError } from "../crm/errors.server";
import {
  MAX_PROOF_BYTES,
  sniffProofKind,
  validateProofHeaderAndMetadata,
  type ValidatedProofDescriptor,
} from "./proofValidation.server";

export type ProofStorageDriverKind =
  "local-fs" | "object-storage" | "hostinger-private-fs" | "disposable-test" | "disabled";

export interface StoredProofDescriptor {
  storageKey: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
}

export interface ProofStorageHealthSummary {
  driver: ProofStorageDriverKind;
  configured: boolean;
  writable: boolean;
  productionReady: boolean;
  failClosed: boolean;
  persistentWarning: boolean;
  status: ProofStorageEnvAssessment["status"] | "operational_test";
  baseDir?: string;
  blockedCode?: "storage_not_configured" | "storage_durability_blocked";
  reasons?: string[];
}

export interface ProofHeadResult {
  exists: boolean;
  byteSize: number;
  updatedAtMs: number;
}

export interface ProofVerificationResult {
  ok: boolean;
  status: "verified" | "missing" | "size_mismatch" | "checksum_mismatch" | "unreadable";
  byteSize: number;
  sha256: string | null;
  reason?: string;
}

export interface PutPrivateObjectParams {
  ownerUserId: string;
  proofId?: string | undefined;
  originalFileName: string;
  declaredMimeType?: string | null | undefined;
  content: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>;
  maxBytes?: number | undefined;
}

export interface GetPrivateObjectResult {
  buffer: Buffer;
  stream: NodeJS.ReadableStream;
  byteSize: number;
  sha256: string;
}

export interface ProofOrphanListingResult {
  unreferencedFiles: string[];
  missingKeys: string[];
  staleTempFiles: string[];
  gracePeriodSkippedCount: number;
}

export interface ProofStorageBackend {
  readonly driver: ProofStorageDriverKind;
  healthSummary(): ProofStorageHealthSummary;
  stageUpload(params: {
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
  }>;
  persistStagedProof(params: {
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
  }>;
  putPrivateObject(params: PutPrivateObjectParams): Promise<StoredProofDescriptor>;
  getPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<GetPrivateObjectResult | null>;
  headPrivateObject(storageKey: string): Promise<ProofHeadResult>;
  verifyPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<ProofVerificationResult>;
  deletePrivateObject(storageKey: string): Promise<boolean>;
  listOrphanedObjects(
    referencedKeys: ReadonlySet<string>,
    options?: { minAgeMs?: number | undefined; tempMaxAgeMs?: number | undefined },
  ): Promise<ProofOrphanListingResult>;
  readProofStream(storageKey: string): Promise<{
    stream: NodeJS.ReadableStream;
    byteSize: number;
  } | null>;
  readProofBuffer(storageKey: string): Promise<Buffer | null>;
  exists(storageKey: string): Promise<boolean>;
  deleteProof(storageKey: string): Promise<boolean>;
  deleteTemp(tempKey: string): Promise<boolean>;
  cleanupAbandonedTemp(maxAgeMs?: number): Promise<number>;
  reconcileStorage(
    activeKeys: Set<string>,
    options?: { minAgeMs?: number | undefined },
  ): Promise<{
    unreferencedFiles: string[];
    missingKeys: string[];
    gracePeriodSkippedCount: number;
  }>;
}

const SAFE_STORAGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Validates a proof storage key so path traversal and OS-specific separators are impossible. */
export function isValidProofStorageKey(key: string): boolean {
  if (!SAFE_STORAGE_KEY_RE.test(key)) return false;
  if (key.includes("..")) return false;
  return true;
}

/**
 * Resolves an attachment storage path inside `baseDir` and refuses any escape outside `baseDir`.
 */
export function resolveSafeProofPath(baseDir: string, storageKey: string): string {
  if (!isValidProofStorageKey(storageKey)) {
    throw new CrmServiceError(400, "storage_error", "Invalid payment proof storage key.");
  }
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, storageKey);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new CrmServiceError(
      400,
      "storage_error",
      "Refusing payment proof path outside private storage root.",
    );
  }
  return candidate;
}

export interface ProofDirectoryAssessment {
  resolvedPath: string;
  unsafePublicOrBuildPath: boolean;
  reasons: string[];
}

const UNSAFE_SEGMENTS = ["public_html", "public", ".output", "dist", "hbuilds"];

/**
 * Flags local filesystem paths that are web-exposed (`public_html`, `public`)
 * or ephemeral across Hostinger redeployments (`hbuilds`, `.output`, `dist`).
 */
export function assessProofDirectorySafety(
  rawDir: string,
  appCwd: string = process.cwd(),
): ProofDirectoryAssessment {
  const resolvedPath = path.isAbsolute(rawDir)
    ? path.resolve(rawDir)
    : path.resolve(appCwd, rawDir);

  const normalized = resolvedPath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const reasons: string[] = [];

  for (const segment of UNSAFE_SEGMENTS) {
    if (segments.includes(segment)) {
      reasons.push(
        `Path passes through "${segment}", which may be public or replaced on redeploy.`,
      );
    }
  }

  return {
    resolvedPath,
    unsafePublicOrBuildPath: reasons.length > 0,
    reasons,
  };
}

export interface LocalProofStorageOptions {
  driver?: Extract<ProofStorageDriverKind, "local-fs" | "hostinger-private-fs" | "disposable-test">;
  nodeEnv?: ServerEnv["NODE_ENV"];
  productionDurableConfirmed?: boolean;
}

function buildLocalEnvAssessment(
  driver: Extract<ProofStorageDriverKind, "local-fs" | "hostinger-private-fs" | "disposable-test">,
  rawBaseDir: string,
  options?: LocalProofStorageOptions,
): ProofStorageEnvAssessment {
  const nodeEnv =
    options?.nodeEnv ??
    (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "test"
      ? process.env["NODE_ENV"]
      : "development");
  const productionDurableConfirmed =
    options?.productionDurableConfirmed ??
    process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"] === "true";

  return assessProofStorageEnv(
    parseServerEnv({
      NODE_ENV: nodeEnv,
      PROOF_STORAGE_DRIVER: driver,
      PROOF_STORAGE_DIR: rawBaseDir,
      PROOF_PRODUCTION_DURABLE_CONFIRMED: productionDurableConfirmed ? "true" : "false",
    }),
  );
}

export class LocalFsProofStorage implements ProofStorageBackend {
  readonly driver: ProofStorageDriverKind;
  protected readonly rawBaseDir: string;
  protected readonly baseDir: string;
  protected readonly stagingDir: string;
  protected readonly proofsDir: string;
  protected readonly initOptions: LocalProofStorageOptions | undefined;

  constructor(baseDir: string = ".data/private-proofs", options?: LocalProofStorageOptions) {
    this.driver = options?.driver ?? "local-fs";
    this.rawBaseDir = baseDir;
    this.baseDir = path.resolve(baseDir);
    this.stagingDir = path.join(this.baseDir, "staging");
    this.proofsDir = path.join(this.baseDir, "proofs");
    this.initOptions = options;

    // Never create `.data/private-proofs` or build directories when fail-closed in production.
    const assessment = this.computeEnvAssessment();
    if (!assessment.failClosed) {
      this.ensureDirs();
    }
  }

  protected computeEnvAssessment(): ProofStorageEnvAssessment {
    const allowedDriver: Extract<
      ProofStorageDriverKind,
      "local-fs" | "hostinger-private-fs" | "disposable-test"
    > =
      this.driver === "hostinger-private-fs" || this.driver === "disposable-test"
        ? this.driver
        : "local-fs";
    return buildLocalEnvAssessment(allowedDriver, this.rawBaseDir, this.initOptions);
  }

  protected assertWritable(): void {
    const assessment = this.computeEnvAssessment();
    if (assessment.failClosed) {
      throw new CrmServiceError(
        503,
        assessment.blockedCode ?? "storage_not_configured",
        assessment.reasons[0] ??
          "Private payment proof storage is not durably configured for this runtime.",
      );
    }
  }

  protected ensureDirs(): void {
    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
    if (!fs.existsSync(this.proofsDir)) {
      fs.mkdirSync(this.proofsDir, { recursive: true });
    }
  }

  healthSummary(): ProofStorageHealthSummary {
    const dirAssessment = assessProofDirectorySafety(this.baseDir);
    const envAssessment = this.computeEnvAssessment();
    const reasons = [...new Set([...dirAssessment.reasons, ...envAssessment.reasons])];
    return {
      driver: this.driver,
      configured: envAssessment.configured,
      writable: envAssessment.writable,
      productionReady: envAssessment.productionReady,
      failClosed: envAssessment.failClosed,
      persistentWarning: dirAssessment.unsafePublicOrBuildPath || !envAssessment.productionReady,
      status: envAssessment.status,
      baseDir: this.baseDir,
      ...(envAssessment.blockedCode ? { blockedCode: envAssessment.blockedCode } : {}),
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
    this.assertWritable();
    this.ensureDirs();
    const maxBytes = params.maxBytes ?? MAX_PROOF_BYTES;
    const tempKey = `tmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.tmp`;
    const tempPath = resolveSafeProofPath(this.stagingDir, tempKey);

    const hash = crypto.createHash("sha256");
    let totalBytes = 0;
    const headerBuffer = Buffer.alloc(16);
    let headerBytesRead = 0;
    let inMemoryBuf: Buffer | null = null;

    try {
      if (Buffer.isBuffer(params.streamOrBuffer) || params.streamOrBuffer instanceof Uint8Array) {
        const buf = Buffer.from(params.streamOrBuffer);
        inMemoryBuf = buf;
        totalBytes = buf.byteLength;
        if (totalBytes > maxBytes) {
          throw new CrmServiceError(400, "file_too_large", "Payment proof file exceeds 10 MB.");
        }
        if (totalBytes === 0) {
          throw new CrmServiceError(400, "empty_file", "Payment proof file is empty.");
        }
        hash.update(buf);
        buf.copy(headerBuffer, 0, 0, Math.min(16, buf.byteLength));
        headerBytesRead = Math.min(16, buf.byteLength);
        const fh = await fs.promises.open(tempPath, "wx");
        try {
          await fh.writeFile(buf);
          await fh.sync();
        } finally {
          await fh.close();
        }
      } else {
        // Streaming mode
        const outStream = fs.createWriteStream(tempPath, { flags: "wx" });
        const nodeReadable =
          "getReader" in params.streamOrBuffer
            ? Readable.fromWeb(
                params.streamOrBuffer as unknown as import("node:stream/web").ReadableStream,
              )
            : (params.streamOrBuffer as NodeJS.ReadableStream);

        try {
          for await (const chunk of nodeReadable) {
            const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += chunkBuf.byteLength;

            if (totalBytes > maxBytes) {
              outStream.destroy();
              await fs.promises.unlink(tempPath).catch(() => undefined);
              throw new CrmServiceError(400, "file_too_large", "Payment proof file exceeds 10 MB.");
            }

            if (headerBytesRead < 16) {
              const need = 16 - headerBytesRead;
              const take = Math.min(need, chunkBuf.byteLength);
              chunkBuf.copy(headerBuffer, headerBytesRead, 0, take);
              headerBytesRead += take;
            }

            hash.update(chunkBuf);
            const ok = outStream.write(chunkBuf);
            if (!ok) {
              await new Promise<void>((resolve) => {
                outStream.once("drain", () => resolve());
              });
            }
          }

          await new Promise<void>((resolve, reject) => {
            outStream.end(() => resolve());
            outStream.on("error", reject);
          });
        } catch (streamErr) {
          outStream.destroy();
          throw streamErr;
        }

        if (totalBytes === 0) {
          await fs.promises.unlink(tempPath).catch(() => undefined);
          throw new CrmServiceError(400, "empty_file", "Payment proof file is empty.");
        }

        const fh = await fs.promises.open(tempPath, "r+");
        try {
          await fh.sync();
        } finally {
          await fh.close();
        }
      }
    } catch (err) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw err;
    }

    const sha256 = hash.digest("hex");
    const headerBytes = headerBuffer.subarray(0, headerBytesRead);

    try {
      const fullBytes = inMemoryBuf ?? (await fs.promises.readFile(tempPath));
      const descriptor = validateProofHeaderAndMetadata({
        originalName: params.originalFileName,
        fileSize: totalBytes,
        headerBytes,
        declaredMimeType: params.declaredMimeType,
        fullBytes,
      });

      return {
        tempKey,
        tempPath,
        byteSize: totalBytes,
        sha256,
        descriptor,
      };
    } catch (valErr) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw valErr;
    }
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
    this.assertWritable();
    this.ensureDirs();
    const tempPath = resolveSafeProofPath(this.stagingDir, params.tempKey);

    if (!fs.existsSync(tempPath)) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Staged proof temporary object was not found in private staging storage.",
      );
    }

    const stat = await fs.promises.stat(tempPath);
    const storageKey = `prf_${params.proofId}.${params.ext.toLowerCase()}`;
    const destPath = resolveSafeProofPath(this.proofsDir, storageKey);

    if (fs.existsSync(destPath)) {
      throw new CrmServiceError(
        409,
        "storage_error",
        "Target private proof storage key already exists; refusing overwrite.",
      );
    }

    try {
      await fs.promises.rename(tempPath, destPath);
    } catch {
      // Fallback cross-device atomic copy then unlink
      const tmpCrossPath = `${destPath}.part_${crypto.randomUUID().slice(0, 8)}`;
      try {
        await pipeline(
          fs.createReadStream(tempPath),
          fs.createWriteStream(tmpCrossPath, { flags: "wx" }),
        );
        await fs.promises.rename(tmpCrossPath, destPath);
        await fs.promises.unlink(tempPath).catch(() => undefined);
      } catch (crossErr) {
        await fs.promises.unlink(tmpCrossPath).catch(() => undefined);
        throw crossErr;
      }
    }

    const verify = await this.verifyPrivateObject(storageKey, {
      sha256: params.expectedSha256,
      byteSize: params.expectedByteSize ?? stat.size,
    });
    if (!verify.ok || !verify.sha256) {
      await fs.promises.unlink(destPath).catch(() => undefined);
      throw new CrmServiceError(
        500,
        "storage_error",
        "Persisted payment proof failed post-write integrity verification.",
      );
    }

    return {
      storageKey,
      byteSize: verify.byteSize,
      sha256: verify.sha256,
    };
  }

  async putPrivateObject(params: PutPrivateObjectParams): Promise<StoredProofDescriptor> {
    this.assertWritable();
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

  async verifyPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<ProofVerificationResult> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return {
          ok: false,
          status: "unreadable",
          byteSize: 0,
          sha256: null,
          reason: "Stored payment proof path is not a regular file.",
        };
      }
      if (expected?.byteSize !== undefined && stat.size !== expected.byteSize) {
        return {
          ok: false,
          status: "size_mismatch",
          byteSize: stat.size,
          sha256: null,
          reason: `Stored binary byte size (${stat.size}) does not match expected (${expected.byteSize}).`,
        };
      }
      const bytes = await fs.promises.readFile(filePath);
      if (bytes.byteLength === 0) {
        return {
          ok: false,
          status: "size_mismatch",
          byteSize: 0,
          sha256: null,
          reason: "Stored payment proof file is zero bytes.",
        };
      }
      const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (expected?.sha256 && actualSha256 !== expected.sha256.toLowerCase()) {
        return {
          ok: false,
          status: "checksum_mismatch",
          byteSize: bytes.byteLength,
          sha256: actualSha256,
          reason: "Stored payment proof SHA-256 digest does not match recorded database digest.",
        };
      }
      if (!sniffProofKind(bytes.subarray(0, 16))) {
        return {
          ok: false,
          status: "unreadable",
          byteSize: bytes.byteLength,
          sha256: actualSha256,
          reason: "Stored binary header signature could not be validated.",
        };
      }
      return {
        ok: true,
        status: "verified",
        byteSize: bytes.byteLength,
        sha256: actualSha256,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          ok: false,
          status: "missing",
          byteSize: 0,
          sha256: null,
          reason: "Stored payment proof object was not found in private storage.",
        };
      }
      return {
        ok: false,
        status: "unreadable",
        byteSize: 0,
        sha256: null,
        reason: "Stored payment proof could not be read from private storage.",
      };
    }
  }

  async headPrivateObject(storageKey: string): Promise<ProofHeadResult> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return { exists: false, byteSize: 0, updatedAtMs: 0 };
      }
      return {
        exists: true,
        byteSize: stat.size,
        updatedAtMs: stat.mtimeMs,
      };
    } catch {
      return { exists: false, byteSize: 0, updatedAtMs: 0 };
    }
  }

  async getPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<GetPrivateObjectResult | null> {
    this.assertWritable();
    const verification = await this.verifyPrivateObject(storageKey, expected);
    if (!verification.ok) {
      if (verification.status === "missing") {
        return null;
      }
      throw new CrmServiceError(
        500,
        "file_corrupted",
        "Stored payment proof binary failed SHA-256 and byte-length integrity verification.",
      );
    }

    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    const buffer = await fs.promises.readFile(filePath);
    const stream = Readable.from(buffer);
    return {
      buffer,
      stream,
      byteSize: verification.byteSize,
      sha256: verification.sha256!,
    };
  }

  async deletePrivateObject(storageKey: string): Promise<boolean> {
    this.assertWritable();
    return this.deleteProof(storageKey);
  }

  async listOrphanedObjects(
    referencedKeys: ReadonlySet<string>,
    options?: { minAgeMs?: number | undefined; tempMaxAgeMs?: number | undefined },
  ): Promise<ProofOrphanListingResult> {
    this.assertWritable();
    const reconcile = await this.reconcileStorage(new Set(referencedKeys), {
      minAgeMs: options?.minAgeMs,
    });
    const staleTempFiles: string[] = [];
    const tempMaxAgeMs = options?.tempMaxAgeMs ?? 3_600_000;
    const now = Date.now();
    if (fs.existsSync(this.stagingDir)) {
      const staged = await fs.promises.readdir(this.stagingDir);
      for (const file of staged) {
        const full = path.join(this.stagingDir, file);
        try {
          const stat = await fs.promises.stat(full);
          if (now - stat.mtimeMs >= tempMaxAgeMs) {
            staleTempFiles.push(file);
          }
        } catch {
          // ignore race
        }
      }
    }
    return {
      ...reconcile,
      staleTempFiles,
    };
  }

  async readProofStream(storageKey: string): Promise<{
    stream: NodeJS.ReadableStream;
    byteSize: number;
  } | null> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      const stream = fs.createReadStream(filePath);
      return { stream, byteSize: stat.size };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async readProofBuffer(storageKey: string): Promise<Buffer | null> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      return await fs.promises.readFile(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async deleteProof(storageKey: string): Promise<boolean> {
    this.assertWritable();
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async deleteTemp(tempKey: string): Promise<boolean> {
    const tempPath = resolveSafeProofPath(this.stagingDir, tempKey);
    try {
      await fs.promises.unlink(tempPath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanupAbandonedTemp(maxAgeMs: number = 3_600_000): Promise<number> {
    if (!fs.existsSync(this.stagingDir)) return 0;
    const files = await fs.promises.readdir(this.stagingDir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const full = path.join(this.stagingDir, file);
      try {
        const stat = await fs.promises.stat(full);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(full);
          cleaned += 1;
        }
      } catch {
        // ignore race
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
    this.assertWritable();
    const unreferencedFiles: string[] = [];
    const missingKeys: string[] = [];
    let gracePeriodSkippedCount = 0;
    const minAgeMs = options?.minAgeMs ?? 15 * 60 * 1000;
    const now = Date.now();

    if (fs.existsSync(this.proofsDir)) {
      const existing = await fs.promises.readdir(this.proofsDir);
      for (const item of existing) {
        if (!activeKeys.has(item)) {
          const fullPath = path.join(this.proofsDir, item);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (minAgeMs > 0 && now - stat.mtimeMs < minAgeMs) {
              gracePeriodSkippedCount++;
              continue;
            }
          } catch {
            // file removed or inaccessible
          }
          unreferencedFiles.push(item);
        }
      }
    }

    for (const key of activeKeys) {
      const full = path.join(this.proofsDir, key);
      if (!fs.existsSync(full)) {
        missingKeys.push(key);
      }
    }

    return { unreferencedFiles, missingKeys, gracePeriodSkippedCount };
  }
}

/**
 * Pluggable S3-compatible Object Storage implementation (Option B).
 * Used when Hostinger managed filesystem durability cannot be guaranteed.
 */
function unconfiguredObjectStorageError(): CrmServiceError {
  return new CrmServiceError(
    503,
    "storage_not_configured",
    "External object storage is not configured or approved for Hostinger Business hosting. Production payment proof operations fail closed without local fallback.",
  );
}

/**
 * Fail-closed S3-compatible / external object storage stub.
 * Zero silent fallback to ephemeral `.data/private-proofs`: every storage operation throws `503 storage_not_configured`
 * until an Owner-approved durable object storage driver and credentials are configured.
 */
export class ObjectStorageProofStorage implements ProofStorageBackend {
  readonly driver: ProofStorageDriverKind = "object-storage";

  healthSummary(): ProofStorageHealthSummary {
    return {
      driver: this.driver,
      configured: false,
      writable: false,
      productionReady: false,
      failClosed: true,
      persistentWarning: true,
      status: "blocked_object_storage_unconfigured",
      blockedCode: "storage_not_configured",
      reasons: [
        "Object storage driver is not configured or approved; Hostinger Business fails closed without local disk fallback.",
      ],
    };
  }

  async stageUpload(_params: Parameters<ProofStorageBackend["stageUpload"]>[0]): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async persistStagedProof(
    _params: Parameters<ProofStorageBackend["persistStagedProof"]>[0],
  ): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async putPrivateObject(_params: PutPrivateObjectParams): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async getPrivateObject(
    _storageKey: string,
    _expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async headPrivateObject(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async verifyPrivateObject(
    _storageKey: string,
    _expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<ProofVerificationResult> {
    return {
      ok: false,
      status: "unreadable",
      byteSize: 0,
      sha256: null,
      reason: "Object storage driver is not configured.",
    };
  }

  async deletePrivateObject(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async listOrphanedObjects(
    _referencedKeys: ReadonlySet<string>,
    _options?: { minAgeMs?: number | undefined; tempMaxAgeMs?: number | undefined },
  ): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async readProofStream(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async readProofBuffer(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async exists(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async deleteProof(_storageKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async deleteTemp(_tempKey: string): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async cleanupAbandonedTemp(_maxAgeMs?: number): Promise<never> {
    throw unconfiguredObjectStorageError();
  }

  async reconcileStorage(
    _activeKeys: Set<string>,
    _options?: { minAgeMs?: number | undefined },
  ): Promise<never> {
    throw unconfiguredObjectStorageError();
  }
}

export class DisabledProofStorage extends ObjectStorageProofStorage {
  override readonly driver: ProofStorageDriverKind = "disabled";

  override healthSummary(): ProofStorageHealthSummary {
    return {
      driver: "disabled",
      configured: false,
      writable: false,
      productionReady: false,
      failClosed: true,
      persistentWarning: true,
      status: "blocked_disabled",
      blockedCode: "storage_not_configured",
      reasons: ["Payment proof storage driver is disabled; all operations fail closed."],
    };
  }
}

export interface ProofStorageFaults {
  failOnStageWrite?: boolean;
  failOnPersist?: boolean;
  failOnPostPersistVerify?: boolean;
  failOnRead?: boolean;
  corruptHashOnVerify?: boolean;
  simulateMissingOnVerify?: boolean;
  failOnDelete?: boolean;
}

/**
 * Isolated disposable test storage provider with explicit allowlist enforcement and
 * deterministic fault injection hooks for verifying rollbacks, integrity failures, and crash recovery.
 */
export class DisposableTestProofStorage extends LocalFsProofStorage {
  private faults: ProofStorageFaults = {};

  constructor(baseDir: string, rawEnv: Record<string, string | undefined> = process.env) {
    const check = verifyDisposableProofTestStorageConfig(baseDir, rawEnv);
    if (!check.ok) {
      throw new CrmServiceError(503, "storage_not_configured", check.message);
    }
    super(check.normalizedDir, {
      driver: "disposable-test",
      nodeEnv: rawEnv["NODE_ENV"] === "test" ? "test" : "development",
    });
  }

  setFaults(faults: ProofStorageFaults): void {
    this.faults = { ...faults };
  }

  clearFaults(): void {
    this.faults = {};
  }

  override healthSummary(): ProofStorageHealthSummary {
    const base = super.healthSummary();
    return {
      ...base,
      driver: "disposable-test",
      status: "operational_test",
      productionReady: false,
    };
  }

  override async stageUpload(
    params: Parameters<LocalFsProofStorage["stageUpload"]>[0],
  ): ReturnType<LocalFsProofStorage["stageUpload"]> {
    if (this.faults.failOnStageWrite) {
      throw new CrmServiceError(500, "storage_error", "Simulated storage stage write failure.");
    }
    return super.stageUpload(params);
  }

  override async persistStagedProof(
    params: Parameters<LocalFsProofStorage["persistStagedProof"]>[0],
  ): ReturnType<LocalFsProofStorage["persistStagedProof"]> {
    if (this.faults.failOnPersist) {
      throw new CrmServiceError(500, "storage_error", "Simulated storage persist failure.");
    }
    if (this.faults.failOnPostPersistVerify) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Simulated post-persist checksum verification failure.",
      );
    }
    return super.persistStagedProof(params);
  }

  override async verifyPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<ProofVerificationResult> {
    if (this.faults.simulateMissingOnVerify) {
      return {
        ok: false,
        status: "missing",
        byteSize: 0,
        sha256: null,
        reason: "Simulated missing storage object.",
      };
    }
    if (this.faults.corruptHashOnVerify) {
      return {
        ok: false,
        status: "checksum_mismatch",
        byteSize: expected?.byteSize ?? 0,
        sha256: "0".repeat(64),
        reason: "Simulated checksum corruption.",
      };
    }
    return super.verifyPrivateObject(storageKey, expected);
  }

  override async getPrivateObject(
    storageKey: string,
    expected?: { sha256?: string | undefined; byteSize?: number | undefined },
  ): Promise<GetPrivateObjectResult | null> {
    if (this.faults.failOnRead) {
      throw new CrmServiceError(500, "storage_error", "Simulated storage read outage.");
    }
    return super.getPrivateObject(storageKey, expected);
  }

  override async deleteProof(storageKey: string): Promise<boolean> {
    if (this.faults.failOnDelete) {
      throw new CrmServiceError(500, "storage_error", "Simulated storage delete failure.");
    }
    return super.deleteProof(storageKey);
  }
}

let backendSingleton: ProofStorageBackend | null = null;
let backendSignature: string | null = null;

export function getProofStorageBackend(options?: {
  driver?: ProofStorageDriverKind;
  baseDir?: string;
  env?: ServerEnv;
}): ProofStorageBackend {
  const rawNodeEnv =
    options?.env?.NODE_ENV ??
    (process.env["NODE_ENV"] === "production"
      ? "production"
      : process.env["NODE_ENV"] === "test"
        ? "test"
        : "development");
  const rawDriver =
    options?.driver ??
    options?.env?.PROOF_STORAGE_DRIVER ??
    (process.env["PROOF_STORAGE_DRIVER"] as ProofStorageDriverKind | undefined) ??
    "local-fs";
  const baseDir =
    options?.baseDir ??
    options?.env?.PROOF_STORAGE_DIR ??
    process.env["PROOF_STORAGE_DIR"] ??
    ".data/private-proofs";
  const prodConfirmed =
    options?.env?.PROOF_PRODUCTION_DURABLE_CONFIRMED === "true" ||
    process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"] === "true";

  const signature = `${rawNodeEnv}|${rawDriver}|${baseDir}|${prodConfirmed}`;
  if (backendSingleton && !options && backendSignature === signature) {
    return backendSingleton;
  }

  let instance: ProofStorageBackend;
  if (rawDriver === "disabled") {
    instance = new DisabledProofStorage();
  } else if (rawDriver === "object-storage") {
    instance = new ObjectStorageProofStorage();
  } else if (rawDriver === "disposable-test") {
    instance = new DisposableTestProofStorage(baseDir, {
      ...process.env,
      NODE_ENV: rawNodeEnv,
    });
  } else {
    instance = new LocalFsProofStorage(baseDir, {
      driver: rawDriver === "hostinger-private-fs" ? "hostinger-private-fs" : "local-fs",
      nodeEnv: rawNodeEnv,
      productionDurableConfirmed: prodConfirmed,
    });
  }

  if (!options) {
    backendSingleton = instance;
    backendSignature = signature;
  }

  return instance;
}

export function resetProofStorageBackend(): void {
  backendSingleton = null;
  backendSignature = null;
}
