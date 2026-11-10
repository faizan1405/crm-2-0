import "@tanstack/react-start/server-only";

export const BACKUP_APP_NAME = "Scale Flow Sales OS";
export const BACKUP_FORMAT_VERSION = 2;
export const CURRENT_CRM_SCHEMA_VERSION = 10;
export const BUSINESS_TIMEZONE = "Asia/Kolkata";

export type BackupScopeType = "full" | "custom" | "employee" | "mariadb-snapshot";

export type BackupClassification =
  "complete" | "selective" | "employee" | "incomplete-full" | "damaged";

export interface BackupManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface BackupFinancialSummary {
  totalPaymentsCount: number;
  totalPaymentsPaise: number;
  totalPaymentsFormattedInr: string;
  activePaymentsCount: number;
  activePaymentsPaise: number;
  voidedPaymentsCount: number;
  voidedPaymentsPaise: number;
  totalBookedDealsCount: number;
  totalBookedDealsPaise: number;
  dealsWonCount: number;
  dealsLostCount: number;
  dealsActiveCount: number;
}

export interface BackupAttachmentMeta {
  attachmentId: string;
  paymentId: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string | null;
  path: string | null;
  uploadedAt: string;
  status: "verified" | "missing" | "unreadable";
}

export interface BackupManifest {
  app: string;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  timezone: string;
  type: BackupScopeType;
  complete: boolean;
  classification: BackupClassification;
  ownerUserId?: string;
  ownerEmail?: string;
  includedEntities: string[];
  omittedEntities: string[];
  counts: Record<string, number>;
  financialSummary: BackupFinancialSummary;
  attachments: {
    expected: number;
    included: number;
    missingCount: number;
    missingPaymentIds: string[];
  };
  relationships: string[];
  warnings: string[];
  files: BackupManifestFile[];
  checksumSha256?: string;
}

export interface ValidationReport {
  ok: boolean;
  classification: BackupClassification;
  errors: string[];
  warnings: string[];
  manifest?: BackupManifest;
  restoreAvailable: boolean;
  entityCounts: Record<string, number>;
  financialReconciliation: {
    verified: boolean;
    discrepancies: string[];
    summary?: BackupFinancialSummary;
  };
  attachmentIntegrity: {
    expected: number;
    found: number;
    missing: string[];
    corrupted: string[];
  };
}

export interface DryRunActionSummary {
  entity: string;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  conflicts: Array<{
    id: string;
    reason: string;
    resolution: "skip" | "replace" | "manual-review";
  }>;
}

export interface DryRunReport {
  ok: boolean;
  dryRun: true;
  mutationsPerformed: 0;
  databaseWritten: false;
  timestamp: string;
  sourceManifest: {
    formatVersion: number;
    schemaVersion: number;
    type: BackupScopeType;
    createdAt: string;
  };
  actions: Record<string, DryRunActionSummary>;
  totalRecordsToCreate: number;
  totalRecordsToUpdate: number;
  totalRecordsToSkip: number;
  unresolvedForeignKeys: Array<{
    entity: string;
    recordId: string;
    foreignField: string;
    missingTargetId: string;
  }>;
  financialReconciliation: {
    reconciled: boolean;
    sourceTotalPaise: number;
    derivedTotalPaise: number;
    sourceVoidedPaise: number;
    notes: string[];
  };
  attachments: {
    expected: number;
    verified: number;
    missing: string[];
  };
  validationErrors: string[];
  warnings: string[];
}

export interface RestoreExecutionResult {
  ok: boolean;
  database: string;
  transactionCommitted: boolean;
  recordsInserted: Record<string, number>;
  recordsUpdated: Record<string, number>;
  recordsSkipped: Record<string, number>;
  financialsReconciled: boolean;
  idempotencyVerified: boolean;
  error?: string;
  durationMs: number;
}
