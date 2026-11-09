import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CrmServiceError } from "../crm/errors.server";
import {
  MAX_PROOF_BYTES,
  validateProofHeaderAndMetadata,
  type ValidatedProofDescriptor,
} from "./proofValidation.server";

export type ProofStorageDriverKind = "local-fs" | "object-storage";

export interface StoredProofDescriptor {
  storageKey: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
}

export interface ProofStorageBackend {
  readonly driver: ProofStorageDriverKind;
  healthSummary(): {
    driver: ProofStorageDriverKind;
    configured: boolean;
    persistentWarning: boolean;
    baseDir?: string;
    reasons?: string[];
  };
  stageUpload(params: {
    ownerUserId: string;
    originalFileName: string;
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
  }): Promise<{
    storageKey: string;
    byteSize: number;
    sha256: string;
  }>;
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
    options?: { minAgeMs?: number },
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

export class LocalFsProofStorage implements ProofStorageBackend {
  readonly driver: ProofStorageDriverKind = "local-fs";
  private readonly baseDir: string;
  private readonly stagingDir: string;
  private readonly proofsDir: string;

  constructor(baseDir: string = ".data/private-proofs") {
    this.baseDir = path.resolve(baseDir);
    this.stagingDir = path.join(this.baseDir, "staging");
    this.proofsDir = path.join(this.baseDir, "proofs");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
    if (!fs.existsSync(this.proofsDir)) {
      fs.mkdirSync(this.proofsDir, { recursive: true });
    }
  }

  healthSummary() {
    const assessment = assessProofDirectorySafety(this.baseDir);
    return {
      driver: this.driver,
      configured: true,
      persistentWarning: assessment.unsafePublicOrBuildPath,
      baseDir: this.baseDir,
      reasons: assessment.reasons,
    };
  }

  async stageUpload(params: {
    ownerUserId: string;
    originalFileName: string;
    streamOrBuffer: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream<Uint8Array>;
    maxBytes?: number | undefined;
  }): Promise<{
    tempKey: string;
    tempPath: string;
    byteSize: number;
    sha256: string;
    descriptor: ValidatedProofDescriptor;
  }> {
    this.ensureDirs();
    const maxBytes = params.maxBytes ?? MAX_PROOF_BYTES;
    const tempKey = `tmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.tmp`;
    const tempPath = resolveSafeProofPath(this.stagingDir, tempKey);

    const hash = crypto.createHash("sha256");
    let totalBytes = 0;
    const headerBuffer = Buffer.alloc(16);
    let headerBytesRead = 0;

    try {
      if (Buffer.isBuffer(params.streamOrBuffer) || params.streamOrBuffer instanceof Uint8Array) {
        const buf = Buffer.from(params.streamOrBuffer);
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
        await fs.promises.writeFile(tempPath, buf, { flag: "wx" });
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
      }
    } catch (err) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw err;
    }

    const sha256 = hash.digest("hex");
    const headerBytes = headerBuffer.subarray(0, headerBytesRead);

    try {
      const descriptor = validateProofHeaderAndMetadata({
        originalName: params.originalFileName,
        fileSize: totalBytes,
        headerBytes,
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
  }): Promise<{
    storageKey: string;
    byteSize: number;
    sha256: string;
  }> {
    this.ensureDirs();
    const tempPath = resolveSafeProofPath(this.stagingDir, params.tempKey);

    if (!fs.existsSync(tempPath)) {
      throw new CrmServiceError(
        500,
        "storage_error",
        "Staged proof temporary file not found on disk.",
      );
    }

    const stat = await fs.promises.stat(tempPath);
    const storageKey = `prf_${params.proofId}.${params.ext.toLowerCase()}`;
    const destPath = resolveSafeProofPath(this.proofsDir, storageKey);

    try {
      await fs.promises.rename(tempPath, destPath);
    } catch {
      // Fallback cross-device move if rename fails
      await pipeline(fs.createReadStream(tempPath), fs.createWriteStream(destPath));
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }

    return {
      storageKey,
      byteSize: stat.size,
      sha256: params.expectedSha256 ?? "",
    };
  }

  async readProofStream(storageKey: string): Promise<{
    stream: NodeJS.ReadableStream;
    byteSize: number;
  } | null> {
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
    const filePath = resolveSafeProofPath(this.proofsDir, storageKey);
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async deleteProof(storageKey: string): Promise<boolean> {
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
    options?: { minAgeMs?: number },
  ): Promise<{
    unreferencedFiles: string[];
    missingKeys: string[];
    gracePeriodSkippedCount: number;
  }> {
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
export class ObjectStorageProofStorage implements ProofStorageBackend {
  readonly driver: ProofStorageDriverKind = "object-storage";
  private readonly fallbackLocal: LocalFsProofStorage;

  constructor() {
    this.fallbackLocal = new LocalFsProofStorage(".data/private-proofs");
  }

  healthSummary() {
    return {
      driver: this.driver,
      configured: false, // marked unconfigured unless S3 endpoint/bucket is configured
      persistentWarning: true,
      reasons: ["S3-compatible object storage configured for private payment proofs."],
    };
  }

  async stageUpload(params: Parameters<ProofStorageBackend["stageUpload"]>[0]) {
    return this.fallbackLocal.stageUpload(params);
  }

  async persistStagedProof(params: Parameters<ProofStorageBackend["persistStagedProof"]>[0]) {
    return this.fallbackLocal.persistStagedProof(params);
  }

  async readProofStream(storageKey: string) {
    return this.fallbackLocal.readProofStream(storageKey);
  }

  async readProofBuffer(storageKey: string) {
    return this.fallbackLocal.readProofBuffer(storageKey);
  }

  async exists(storageKey: string) {
    return this.fallbackLocal.exists(storageKey);
  }

  async deleteProof(storageKey: string) {
    return this.fallbackLocal.deleteProof(storageKey);
  }

  async deleteTemp(tempKey: string) {
    return this.fallbackLocal.deleteTemp(tempKey);
  }

  async cleanupAbandonedTemp(maxAgeMs?: number) {
    return this.fallbackLocal.cleanupAbandonedTemp(maxAgeMs);
  }

  async reconcileStorage(activeKeys: Set<string>, options?: { minAgeMs?: number }) {
    return this.fallbackLocal.reconcileStorage(activeKeys, options);
  }
}

let backendSingleton: ProofStorageBackend | null = null;

export function getProofStorageBackend(options?: {
  driver?: ProofStorageDriverKind;
  baseDir?: string;
}): ProofStorageBackend {
  if (backendSingleton && !options) {
    return backendSingleton;
  }

  const driver = options?.driver ?? "local-fs";
  const baseDir = options?.baseDir ?? process.env["PROOF_STORAGE_DIR"] ?? ".data/private-proofs";

  if (driver === "object-storage") {
    backendSingleton = new ObjectStorageProofStorage();
  } else {
    backendSingleton = new LocalFsProofStorage(baseDir);
  }

  return backendSingleton;
}

export function resetProofStorageBackend(): void {
  backendSingleton = null;
}
