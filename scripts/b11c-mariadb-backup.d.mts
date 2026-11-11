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
