import type { R2Config, S3ObjectSummary } from "./b12c-r2-client.mjs";

export interface RetentionPruneCandidate {
  primaryKey: string;
  baseName: string;
  keysToDelete: string[];
  ageDays: number;
}

export interface RetentionEvaluationResult {
  candidatesToPrune: RetentionPruneCandidate[];
  preservedCount: number;
  newestPreservedKey?: string;
  reason?: string;
}

export interface R2BackupResult {
  ok: boolean;
  archiveKey: string;
  manifestKey: string;
  metaKey: string;
  encryptedByteSize: number;
  tableCount: number;
  totalRows: number;
  proofCount: number;
  proofBlobChunkCount: number;
  dumpSha256: string;
  gzipSha256: string;
  encryptedSha256: string;
  recipientPublicKey: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  verifiedRemote: boolean;
  prunedArchives: string[];
}

export declare const DEFAULT_RETENTION_DAYS: number;
export declare const BACKUP_PREFIX: string;

export declare function parseArchiveTimestamp(key: string): Date | null;

export declare function evaluateRetentionPruning(params: {
  objects: S3ObjectSummary[];
  retentionDays?: number;
  now?: Date;
}): RetentionEvaluationResult;

export declare function runR2AutomatedBackup(params: {
  connectionConfig?: Record<string, unknown>;
  r2Config?: R2Config;
  recipientPublicKey?: string;
  retentionDays?: number;
  stagingRoot?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<R2BackupResult>;
