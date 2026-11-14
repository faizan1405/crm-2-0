/**
 * Scale Flow CRM V2 — Checkpoint B12D
 * Automated Cloudflare R2 Encrypted Backup Engine
 *
 * Security & Reliability Safeguards:
 * - Fails closed if any private decryption key is present on the backup producer runtime.
 * - Enforces streaming O(1) age v1 authenticated encryption with public recipient key.
 * - Prefix Partitioning:
 *     - `backups/rolling/`: daily automated archives subject to 30-day retention.
 *     - `backups/pinned/`: protected recovery baseline copy NEVER touched by lifecycle rules.
 * - Solitary Backup Safeguard: Even within `backups/rolling/`, pruning skips if <= 1 archive remains.
 * - Non-Destructive Writes: Uses `If-None-Match: *` to prevent accidental overwrites.
 * - Secret-Free Metadata Audit: Enforces that `.meta.json` never leaks credentials, hosts, or customer data.
 * - Partial failure safeguard: Failed backups never purge or overwrite existing valid archives.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertBackupProducerEnvHasNoPrivateKey,
  assertSafeBackupFilePath,
  hashFileSha256,
} from "./b11c-backup-crypto.mjs";
import {
  exportEncryptedMariaDbBackup,
  parseConnectionConfigFromEnv,
} from "./b11c-mariadb-backup.mjs";
import { assertR2Configured, CloudflareR2Client, resolveR2Config } from "./b12c-r2-client.mjs";

export const DEFAULT_RETENTION_DAYS = 30;
export const BACKUP_PREFIX = "backups/";
export const ROLLING_BACKUP_PREFIX = "backups/rolling/";
export const PINNED_BACKUP_PREFIX = "backups/pinned/";

/**
 * Asserts that a backup .meta.json payload is strictly secret-free public metadata.
 * Rejects any credentials, connection URLs, hostnames, passwords, or customer personal data.
 */
export function assertMetaJsonIsSecretFree(meta) {
  if (!meta || typeof meta !== "object") {
    throw new Error("Invalid metadata: must be an object.");
  }

  const jsonStr = JSON.stringify(meta);
  const sensitivePatterns = [
    /pass(word)?/i,
    /secret/i,
    /token/i,
    /bearer/i,
    /mysql:\/\//i,
    /postgres:\/\//i,
    /mongodb:\/\//i,
    /hstgr\.io/i,
    /hostingersite\.com/i,
    /localhost/i,
    /127\.0\.0\.1/,
    /@[\w.-]+\.\w+/, // Email address
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(jsonStr)) {
      throw new Error(
        `Security policy violation: .meta.json contains sensitive data matching ${pattern}`,
      );
    }
  }

  // Must match expected schema
  if (meta.format !== "age-v1-gzip-sql") {
    throw new Error(`Invalid metadata format: expected 'age-v1-gzip-sql', got '${meta.format}'`);
  }
  if (
    !meta.recipientPublicKey ||
    !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(meta.recipientPublicKey)
  ) {
    throw new Error("Invalid or missing recipientPublicKey in metadata.");
  }
  if (!meta.encryptedSha256 || !/^[a-f0-9]{64}$/.test(meta.encryptedSha256)) {
    throw new Error("Invalid or missing encryptedSha256 in metadata.");
  }

  return true;
}

/**
 * Parses timestamp from standard archive key:
 * `backups/rolling/crm-v2-backup-YYYY-MM-DDTHH-mm-ss-SSSZ-<suffix>.sql.gz.age`
 */
export function parseArchiveTimestamp(key) {
  const match = /crm-v2-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/i.exec(key);
  if (!match) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z");
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

/**
 * Evaluates which remote archives should be pruned under retention policy.
 *
 * Safeguards:
 * - Strictly keeps at least 1 latest archive regardless of age.
 * - Only flags archives in `backups/rolling/` older than retentionDays.
 * - NEVER flags `backups/pinned/` archives.
 */
export function evaluateRetentionPruning({
  objects,
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = new Date(),
}) {
  const cutoffTime = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  // Filter strictly to rolling primary archive files (.sql.gz.age), excluding pinned baselines
  const rollingArchives = objects
    .filter(
      (o) =>
        (o.key.startsWith(ROLLING_BACKUP_PREFIX) || o.key.startsWith(BACKUP_PREFIX)) &&
        !o.key.startsWith(PINNED_BACKUP_PREFIX) &&
        o.key.endsWith(".sql.gz.age"),
    )
    .map((o) => {
      const ts = parseArchiveTimestamp(o.key) || new Date(o.lastModified || 0);
      return {
        key: o.key,
        size: o.size,
        timestamp: ts,
        timeMs: ts.getTime(),
      };
    })
    .sort((a, b) => b.timeMs - a.timeMs); // Newest first

  if (rollingArchives.length <= 1) {
    return {
      candidatesToPrune: [],
      preservedCount: rollingArchives.length,
      reason: rollingArchives.length === 1 ? "single_valid_backup_safeguard" : "no_archives",
    };
  }

  // Preserve the newest backup unconditionally
  const newest = rollingArchives[0];
  const candidates = [];

  for (let i = 1; i < rollingArchives.length; i++) {
    const arch = rollingArchives[i];
    if (arch.timeMs < cutoffTime) {
      const baseName = arch.key.replace(/\.sql\.gz\.age$/, "");
      candidates.push({
        primaryKey: arch.key,
        baseName,
        keysToDelete: [arch.key, `${arch.key}.manifest.age`, `${arch.key}.meta.json`],
        ageDays: Math.round((now.getTime() - arch.timeMs) / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return {
    candidatesToPrune: candidates,
    preservedCount: rollingArchives.length - candidates.length,
    newestPreservedKey: newest.key,
  };
}

/**
 * Runs full automated encrypted backup to Cloudflare R2.
 */
export async function runR2AutomatedBackup({
  connectionConfig,
  r2Config = resolveR2Config(),
  recipientPublicKey = process.env.BACKUP_AGE_RECIPIENT_PUBKEY,
  retentionDays = DEFAULT_RETENTION_DAYS,
  stagingRoot = os.tmpdir(),
  pinBaseline = true,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const startedAt = new Date();
  assertBackupProducerEnvHasNoPrivateKey(env);

  if (!recipientPublicKey) {
    throw new Error(
      "Missing backup encryption public key: BACKUP_AGE_RECIPIENT_PUBKEY is required.",
    );
  }

  assertR2Configured(r2Config);
  const r2Client = new CloudflareR2Client(r2Config);

  const stageDir = fs.mkdtempSync(path.join(stagingRoot, "sf-r2-backup-"));
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(stageDir, 0o700);
    } catch {}
  }

  const nowIsoFormatted = startedAt.toISOString().replace(/[:.]/g, "-");
  const localArchiveName = `crm-v2-backup-${nowIsoFormatted}.sql.gz.age`;
  const localAgePath = path.join(stageDir, localArchiveName);

  try {
    // 1. Export, Compress & Authenticated age Encrypt
    const exportResult = await exportEncryptedMariaDbBackup({
      connectionConfig,
      outAgePath: localAgePath,
      recipientPublicKey,
      stagingRoot: stageDir,
      env,
    });

    const localManifestAgePath = `${localAgePath}.manifest.age`;
    const localMetaPath = `${localAgePath}.meta.json`;

    if (
      !fs.existsSync(localAgePath) ||
      !fs.existsSync(localManifestAgePath) ||
      !fs.existsSync(localMetaPath)
    ) {
      throw new Error("Export completed but output artifacts are missing from stage directory.");
    }

    const ageBuf = fs.readFileSync(localAgePath);
    const manifestBuf = fs.readFileSync(localManifestAgePath);
    const metaBuf = fs.readFileSync(localMetaPath);
    const metaObj = JSON.parse(metaBuf.toString("utf8"));

    // 2. Audit .meta.json for sensitive data exposure
    assertMetaJsonIsSecretFree(metaObj);

    // 3. Upload Rolling Backup to Cloudflare R2 (Conditional write to prevent overwrite)
    const remoteKeyAge = `${ROLLING_BACKUP_PREFIX}${localArchiveName}`;
    const remoteKeyManifest = `${remoteKeyAge}.manifest.age`;
    const remoteKeyMeta = `${remoteKeyAge}.meta.json`;

    await r2Client.putObject({
      key: remoteKeyAge,
      body: ageBuf,
      contentType: "application/octet-stream",
      ifNoneMatch: "*",
      includeContentMd5: true,
      fetchImpl,
    });

    await r2Client.putObject({
      key: remoteKeyManifest,
      body: manifestBuf,
      contentType: "application/octet-stream",
      ifNoneMatch: "*",
      includeContentMd5: true,
      fetchImpl,
    });

    await r2Client.putObject({
      key: remoteKeyMeta,
      body: metaBuf,
      contentType: "application/json",
      ifNoneMatch: "*",
      includeContentMd5: true,
      fetchImpl,
    });

    // 4. Verify Remote Upload via HeadObject
    const headAge = await r2Client.headObject({ key: remoteKeyAge, fetchImpl });
    const headManifest = await r2Client.headObject({ key: remoteKeyManifest, fetchImpl });
    const headMeta = await r2Client.headObject({ key: remoteKeyMeta, fetchImpl });

    if (!headAge.exists || headAge.contentLength !== ageBuf.byteLength) {
      throw new Error(
        `Remote verification failed for archive ${remoteKeyAge}: length mismatch or not found.`,
      );
    }
    if (!headManifest.exists || headManifest.contentLength !== manifestBuf.byteLength) {
      throw new Error(
        `Remote verification failed for manifest ${remoteKeyManifest}: length mismatch.`,
      );
    }
    if (!headMeta.exists || headMeta.contentLength !== metaBuf.byteLength) {
      throw new Error(`Remote verification failed for metadata ${remoteKeyMeta}: length mismatch.`);
    }

    // 5. Pin Verified Baseline Copy (Immune to Cloudflare Lifecycle Rules)
    let pinnedKey = null;
    if (pinBaseline) {
      pinnedKey = `${PINNED_BACKUP_PREFIX}latest-verified-baseline.sql.gz.age`;
      await r2Client.putObject({
        key: pinnedKey,
        body: ageBuf,
        contentType: "application/octet-stream",
        includeContentMd5: true,
        fetchImpl,
      });
      await r2Client.putObject({
        key: `${pinnedKey}.manifest.age`,
        body: manifestBuf,
        contentType: "application/octet-stream",
        includeContentMd5: true,
        fetchImpl,
      });
      await r2Client.putObject({
        key: `${pinnedKey}.meta.json`,
        body: metaBuf,
        contentType: "application/json",
        includeContentMd5: true,
        fetchImpl,
      });
    }

    // 6. Prune Expired Archives in Rolling Prefix (Safeguarded)
    let prunedArchives = [];
    try {
      const listRes = await r2Client.listObjectsV2({ prefix: ROLLING_BACKUP_PREFIX, fetchImpl });
      const pruning = evaluateRetentionPruning({
        objects: listRes.objects,
        retentionDays,
        now: new Date(),
      });

      for (const cand of pruning.candidatesToPrune) {
        for (const k of cand.keysToDelete) {
          try {
            await r2Client.deleteObject({ key: k, fetchImpl });
          } catch (delErr) {
            console.warn(`Warning: failed to prune expired key ${k}:`, delErr);
          }
        }
        prunedArchives.push(cand.primaryKey);
      }
    } catch (pruneErr) {
      console.warn(
        "Warning: retention pruning step encountered error (backup preserved):",
        pruneErr,
      );
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      ok: true,
      archiveKey: remoteKeyAge,
      manifestKey: remoteKeyManifest,
      metaKey: remoteKeyMeta,
      pinnedKey,
      encryptedByteSize: ageBuf.byteLength,
      tableCount: exportResult.meta.tableCount,
      totalRows: exportResult.meta.totalRows,
      proofCount: exportResult.meta.proofCount,
      proofBlobChunkCount: exportResult.meta.proofBlobChunkCount,
      dumpSha256: exportResult.meta.dumpSha256,
      gzipSha256: exportResult.meta.gzipSha256,
      encryptedSha256: exportResult.meta.encryptedSha256,
      recipientPublicKey,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      verifiedRemote: true,
      prunedArchives,
    };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {}
  }
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMainModule) {
  const cfg = parseConnectionConfigFromEnv("SOURCE_DB", process.env);
  runR2AutomatedBackup({ connectionConfig: cfg })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      process.exit(1);
    });
}
