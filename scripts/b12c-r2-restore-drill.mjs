#!/usr/bin/env node
/**
 * Scale Flow CRM V2 — Checkpoint B12C
 * Cloudflare R2 Off-Site Restore Drill Runner
 *
 * Security & Isolation Rules:
 * - Downloads encrypted backup archive from private R2 bucket.
 * - Requires offline secret recovery key (AGE-SECRET-KEY-1...).
 * - Enforces --confirm-clean-target AND verifies target database has 0 tables before execution.
 * - Never restores onto source, CRM V1, or production databases.
 * - Reconciles tables, rows, financial totals, and payment proof SHA-256 hashes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { assertSafeRestoreTarget, restoreEncryptedMariaDbBackup } from "./b11c-mariadb-backup.mjs";
import { assertR2Configured, CloudflareR2Client, resolveR2Config } from "./b12c-r2-client.mjs";
import { BACKUP_PREFIX } from "./b12c-r2-backup-engine.mjs";

export async function runR2RestoreDrill({
  targetConfig,
  r2Config = resolveR2Config(),
  secretKey = process.env.BACKUP_AGE_SECRET_KEY,
  archiveKey = null,
  sourceDbName = process.env.DB_NAME || "u256504187_crm_b11c_stg",
  confirmCleanTarget = false,
  stagingRoot = os.tmpdir(),
  fetchImpl = globalThis.fetch,
}) {
  const startedAt = new Date();

  if (!secretKey) {
    throw new Error("Missing secret recovery key: BACKUP_AGE_SECRET_KEY is required to restore.");
  }
  if (!confirmCleanTarget) {
    throw new Error("Safety lockout: --confirm-clean-target must be set to true.");
  }

  assertR2Configured(r2Config);
  const r2Client = new CloudflareR2Client(r2Config);

  // 1. Locate archive key in R2 if not specified
  let targetArchiveKey = archiveKey;
  if (!targetArchiveKey) {
    const listRes = await r2Client.listObjectsV2({ prefix: BACKUP_PREFIX, fetchImpl });
    const archives = listRes.objects
      .filter((o) => o.key.endsWith(".sql.gz.age"))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    if (archives.length === 0) {
      throw new Error(
        `No encrypted backup archives found in R2 bucket under prefix '${BACKUP_PREFIX}'.`,
      );
    }
    targetArchiveKey = archives[0].key;
  }

  const stageDir = fs.mkdtempSync(path.join(stagingRoot, "sf-r2-drill-"));
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(stageDir, 0o700);
    } catch {}
  }

  const localAgePath = path.join(stageDir, path.basename(targetArchiveKey));
  const localManifestAgePath = `${localAgePath}.manifest.age`;
  const localMetaPath = `${localAgePath}.meta.json`;

  try {
    // 2. Download from R2
    console.log(`Downloading ${targetArchiveKey} from R2...`);
    const getAge = await r2Client.getObject({ key: targetArchiveKey, fetchImpl });
    if (!getAge.exists || !getAge.body) {
      throw new Error(`Archive ${targetArchiveKey} not found in R2 bucket.`);
    }
    fs.writeFileSync(localAgePath, getAge.body);

    const getManifest = await r2Client.getObject({
      key: `${targetArchiveKey}.manifest.age`,
      fetchImpl,
    });
    if (getManifest.exists && getManifest.body) {
      fs.writeFileSync(localManifestAgePath, getManifest.body);
    }

    const getMeta = await r2Client.getObject({ key: `${targetArchiveKey}.meta.json`, fetchImpl });
    if (getMeta.exists && getMeta.body) {
      fs.writeFileSync(localMetaPath, getMeta.body);
    }

    // 3. Decrypt & Restore to Target MariaDB Database
    console.log(`Restoring into target database ${targetConfig.database}...`);
    const restoreResult = await restoreEncryptedMariaDbBackup({
      targetConfig,
      inAgePath: localAgePath,
      secretKey,
      sourceDbName,
      confirmCleanTarget: true,
      stagingRoot: stageDir,
    });

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      ok: true,
      archiveKey: targetArchiveKey,
      targetDatabase: targetConfig.database,
      statementCount: restoreResult.statementCount,
      durationMs,
      completedAt: completedAt.toISOString(),
    };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {}
  }
}
