/**
 * Scale Flow CRM V2 — Checkpoint B12C
 * Operational Backup & Off-Site Recovery Health Service
 *
 * Requirements:
 * - Tracks last successful backup, off-site upload, and verified restore drill.
 * - Enforces rule: "A successful upload alone must not count as a verified recovery."
 * - Flags stale backups when age exceeds 26 hours.
 * - Computes storage consumption and gives actionable Owner guidance on errors.
 */

import fs from "node:fs";
import path from "node:path";

export const STALE_BACKUP_THRESHOLD_HOURS = 26;
export const RESTORE_CADENCE_RECOMMENDED_DAYS = 30;

export interface BackupHealthState {
  lastSuccessfulBackupAt: string | null;
  lastSuccessfulOffsiteUploadAt: string | null;
  lastVerifiedRestoreAt: string | null;
  lastArchiveSizeBytes: number;
  lastArchiveSha256: string | null;
  lastArchiveKey: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  totalArchivesTracked: number;
  estimatedR2StorageMiB: number;
}

export interface BackupHealthReport {
  status: "healthy" | "warning" | "critical";
  lastSuccessfulBackup: string | null;
  lastSuccessfulOffsiteUpload: string | null;
  lastVerifiedRestore: string | null;
  archiveSizeBytes: number;
  archiveSizeMiB: number;
  backupAgeHours: number | null;
  isStale: boolean;
  recoveryVerified: boolean;
  retentionStatus: "healthy" | "warning" | "pruning_needed";
  storageConsumptionMiB: number;
  lastError: string | null;
  requiredOwnerAction: string;
  evaluatedAt: string;
}

export const DEFAULT_INITIAL_STATE: BackupHealthState = {
  lastSuccessfulBackupAt: null,
  lastSuccessfulOffsiteUploadAt: null,
  lastVerifiedRestoreAt: null,
  lastArchiveSizeBytes: 0,
  lastArchiveSha256: null,
  lastArchiveKey: null,
  lastError: null,
  lastErrorAt: null,
  totalArchivesTracked: 0,
  estimatedR2StorageMiB: 0,
};

/**
 * Pure evaluation function for backup health state.
 */
export function evaluateBackupHealth(
  state: BackupHealthState,
  now: Date = new Date(),
): BackupHealthReport {
  const evaluatedAt = now.toISOString();

  let backupAgeHours: number | null = null;
  let isStale = true;

  if (state.lastSuccessfulBackupAt) {
    const backupTime = new Date(state.lastSuccessfulBackupAt).getTime();
    if (!Number.isNaN(backupTime)) {
      backupAgeHours = Math.max(
        0,
        Number(((now.getTime() - backupTime) / (1000 * 60 * 60)).toFixed(1)),
      );
      isStale = backupAgeHours > STALE_BACKUP_THRESHOLD_HOURS;
    }
  }

  // A successful upload alone must not count as a verified recovery!
  const recoveryVerified = Boolean(state.lastVerifiedRestoreAt);

  let status: "healthy" | "warning" | "critical" = "healthy";
  let requiredOwnerAction = "None. Off-site backup automation is operating normally.";

  if (!state.lastSuccessfulBackupAt) {
    status = "critical";
    requiredOwnerAction = "No backup has been recorded. Trigger initial backup.";
  } else if (state.lastError) {
    status = "critical";
    requiredOwnerAction = `Resolve recent backup error: ${state.lastError}`;
  } else if (isStale) {
    status = "warning";
    requiredOwnerAction = `Backup is stale (${backupAgeHours}h old > ${STALE_BACKUP_THRESHOLD_HOURS}h threshold). Verify Hostinger cron execution.`;
  } else if (!state.lastSuccessfulOffsiteUploadAt) {
    status = "warning";
    requiredOwnerAction =
      "Off-site upload to Cloudflare R2 has not yet occurred. Verify R2 credentials.";
  } else if (!recoveryVerified) {
    status = "warning";
    requiredOwnerAction =
      "Off-site upload succeeded, but clean-target restore drill is PENDING verification.";
  }

  const archiveSizeMiB = Number((state.lastArchiveSizeBytes / (1024 * 1024)).toFixed(2));
  const storageConsumptionMiB = Number(
    (
      state.estimatedR2StorageMiB || archiveSizeMiB * Math.max(1, state.totalArchivesTracked)
    ).toFixed(2),
  );

  const retentionStatus: "healthy" | "warning" | "pruning_needed" =
    state.totalArchivesTracked > 35 ? "pruning_needed" : "healthy";

  return {
    status,
    lastSuccessfulBackup: state.lastSuccessfulBackupAt,
    lastSuccessfulOffsiteUpload: state.lastSuccessfulOffsiteUploadAt,
    lastVerifiedRestore: state.lastVerifiedRestoreAt,
    archiveSizeBytes: state.lastArchiveSizeBytes,
    archiveSizeMiB,
    backupAgeHours,
    isStale,
    recoveryVerified,
    retentionStatus,
    storageConsumptionMiB,
    lastError: state.lastError,
    requiredOwnerAction,
    evaluatedAt,
  };
}

/**
 * Loads persisted backup health state from a JSON file.
 */
export function loadBackupHealthState(filePath: string): BackupHealthState {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      return { ...DEFAULT_INITIAL_STATE, ...JSON.parse(data) };
    }
  } catch (err) {
    console.warn(`Warning: failed to read backup health state from ${filePath}:`, err);
  }
  return { ...DEFAULT_INITIAL_STATE };
}

/**
 * Persists backup health state to a JSON file safely with atomic replace.
 */
export function persistBackupHealthState(filePath: string, state: BackupHealthState): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}
