export const PROTECTED_DB_PATTERNS: RegExp[];
export const DEFAULT_MAX_INSERT_BYTES: number;

export const STORAGE_QUOTA_POLICY_DEFAULTS: {
  quotaMiB: number;
  warningMiB: number;
  hardStopMiB: number;
  measuredBaseSchemaMiB: number;
  measuredBlobOverheadRatio: number;
};

export function escapeMysqlString(value: string): string;
export function escapeMysqlIdentifier(identifier: string): string;
export function encodeSqlValue(val: unknown): string;
export function splitSqlStatements(sqlText: string): string[];

export function assertSafeRestoreTarget(params: {
  targetDbName: string;
  sourceDbName?: string;
  existingTables: string[];
  confirmCleanTarget: boolean;
}): { ok: true; targetDbName: string };

export function evaluateMariadbStorageCapacity(params: {
  usedMiB: number;
  quotaMiB?: number;
  warningMiB?: number;
  hardStopMiB?: number;
  overheadRatio?: number;
}): {
  usedMiB: number;
  quotaMiB: number;
  warningMiB: number;
  hardStopMiB: number;
  percentUsed: number;
  remainingQuotaMiB: number;
  remainingProofBudgetMiB: number;
  estimatedRemaining1MiBReceipts: number;
  estimatedRemaining200KiBReceipts: number;
  allowNewProofUploads: boolean;
  status: "ok" | "warning" | "hard_stop_uploads" | "quota_exhausted";
};

export function packageEncryptedBackupBundle(params: {
  sqlPath: string;
  manifestPath: string;
  outAgePath: string;
  recipientPublicKey: string;
  stagingRoot?: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  outAgePath: string;
  manifestAgePath: string;
  metaPath: string;
  meta: {
    format: string;
    createdAtUtc: string;
    recipientPublicKey: string;
    encryptedArchiveName: string;
    encryptedBytes: number;
    encryptedSha256: string;
    gzipBytes: number;
    gzipSha256: string;
    dumpFileBytes: number;
    dumpSha256: string;
    tableCount: number;
    totalRows: number;
    proofCount: number;
    proofBlobChunkCount: number;
  };
}>;

export function withDecryptedBackupBundle<T>(
  params: {
    inAgePath: string;
    secretKey: string;
    stagingRoot?: string;
  },
  onVerifiedPlaintext: (ctx: {
    sqlPath: string;
    manifestPath: string | null;
    manifest: Record<string, unknown> | null;
    sqlSha256: string;
    sqlByteSize: number;
    gzipSha256: string;
    encryptedByteSize: number;
    decryptedTempDir: string;
  }) => Promise<T>,
): Promise<T>;
