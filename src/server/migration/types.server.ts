import "@tanstack/react-start/server-only";

export const MIGRATION_WIZARD_VERSION = "b13.1";
export const HOSTINGER_EXCLUSIVE_STORAGE_DRIVER = "mariadb-blob" as const;

export type MigrationSourceFormat = "data-vault-zip" | "legacy-json-snapshot";

export type MigrationEntityKey =
  | "leads"
  | "archivedLeads"
  | "activities"
  | "followUps"
  | "callLogs"
  | "whatsAppLogs"
  | "deals"
  | "dealMilestones"
  | "payments"
  | "financeEvents"
  | "paymentProofs"
  | "quotationTemplates"
  | "quotations"
  | "projects"
  | "projectMilestones"
  | "projectTasks"
  | "supportTickets"
  | "customFields"
  | "leadFieldValues"
  | "tags"
  | "leadTags"
  | "savedViews"
  | "inboxItems"
  | "leadRelationships"
  | "automationRules"
  | "ownerSettings"
  | "salesGoals";

export interface MigrationEntitySummary {
  entity: MigrationEntityKey;
  label: string;
  tableName: string;
  sourceCount: number;
  validCount: number;
  toCreate: number;
  toSkip: number;
  errorCount: number;
  warningCount: number;
  conflicts: Array<{
    legacyId: string;
    mappedId: string;
    reason: string;
    resolution: "skip" | "normalize" | "manual-review";
  }>;
}

export interface DeferredCollectionReport {
  collection: string;
  label: string;
  sourceCount: number;
  status: "deferred_not_dropped";
  reason: string;
}

export interface UnresolvedForeignKeyIssue {
  entity: MigrationEntityKey;
  recordId: string;
  foreignField: string;
  missingTargetId: string;
  severity: "error" | "warning";
}

export interface DealFinancialReconciliationRow {
  dealId: string;
  mappedDealId: string;
  dealName: string;
  status: string;
  finalAmountPaise: number;
  activePaymentsPaise: number;
  voidedPaymentsPaise: number;
  outstandingPaise: number;
  overpaidPaise: number;
  milestoneTotalPaise: number;
  milestoneDeltaPaise: number;
  paymentCount: number;
  voidedPaymentCount: number;
}

export interface FinancialReconciliationReport {
  financialParityPassed: boolean;
  currency: "INR";
  precisionUnit: "integer_paise";
  sourceDealsTotalPaise: number;
  mappedDealsTotalPaise: number;
  dealsDeltaPaise: number;
  wonDealsPaise: number;
  activeDealsPaise: number;
  lostDealsPaise: number;
  cancelledDealsPaise: number;
  sourceActivePaymentsPaise: number;
  mappedActivePaymentsPaise: number;
  activePaymentsDeltaPaise: number;
  sourceVoidedPaymentsPaise: number;
  mappedVoidedPaymentsPaise: number;
  voidedPaymentsDeltaPaise: number;
  totalOutstandingPaise: number;
  overpaidDealsCount: number;
  quotationsTotalPaise: number;
  monetaryGoalsTotalPaise: number;
  formattedSummary: {
    dealsBookedInr: string;
    activePaymentsInr: string;
    voidedPaymentsInr: string;
    outstandingInr: string;
    quotationsTotalInr: string;
  };
  dealBreakdown: DealFinancialReconciliationRow[];
  errors: string[];
  warnings: string[];
}

export interface HostingerCapacityEstimate {
  hostingProvider: "hostinger_exclusive";
  cloudflareR2Required: false;
  proofStorageDriver: typeof HOSTINGER_EXCLUSIVE_STORAGE_DRIVER;
  quotaMiB: number;
  warningThresholdMiB: number;
  hardStopThresholdMiB: number;
  estimatedSqlBytes: number;
  estimatedProofRawBytes: number;
  estimatedProofBlobBytes: number;
  estimatedTotalMigrationBytes: number;
  estimatedTotalMigrationMiB: number;
  baselineUsedMiB: number;
  projectedUsedMiB: number;
  projectedPercentOfQuota: number;
  status: "safe" | "warning" | "hard_stop_exceeded";
  fitsWithinHostingerBudget: boolean;
}

export interface ProofMigrationCheck {
  attachmentId: string;
  paymentId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256Expected: string | null;
  sha256Actual: string | null;
  magicBytesValid: boolean;
  withinSizeLimit: boolean;
  status: "verified" | "missing_binary" | "hash_mismatch" | "invalid_type" | "oversized";
  error?: string;
}

export interface MigrationAnalysisReport {
  ok: boolean;
  wizardVersion: string;
  analyzedAt: string;
  sourceFormat: MigrationSourceFormat;
  sourceFilename: string;
  dryRun: true;
  databaseWritten: false;
  browserStorageModified: false;
  hostingPolicy: {
    provider: "hostinger_exclusive";
    cloudflareR2Required: false;
    proofStorageDriver: typeof HOSTINGER_EXCLUSIVE_STORAGE_DRIVER;
    productionMigrationLocked: true;
  };
  entities: Record<MigrationEntityKey, MigrationEntitySummary>;
  totalSourceRecords: number;
  totalValidRecords: number;
  totalToCreate: number;
  totalToSkip: number;
  deferredCollections: DeferredCollectionReport[];
  unresolvedForeignKeys: UnresolvedForeignKeyIssue[];
  financialReconciliation: FinancialReconciliationReport;
  hostingerCapacity: HostingerCapacityEstimate;
  proofVerification: {
    expected: number;
    verified: number;
    failed: number;
    missingBinaries: number;
    checks: ProofMigrationCheck[];
  };
  safetyChecks: {
    credentialsScrubbed: boolean;
    scrubbedFieldCount: number;
    automationRulesForcedPaused: number;
    followUpActiveLocksResolved: number;
    crmV1Untouched: true;
  };
  errors: string[];
  warnings: string[];
  readyForShadowStaging: boolean;
}

export interface ShadowTestAssertion {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface ShadowMigrationTestReport {
  ok: boolean;
  executedAt: string;
  durationMs: number;
  mode: "synthetic_in_memory_shadow";
  syntheticDataOnly: true;
  realDatabaseTouched: false;
  crmV1Touched: false;
  browserStorageTouched: false;
  hostingPolicy: {
    provider: "hostinger_exclusive";
    cloudflareR2Required: false;
    proofStorageDriver: typeof HOSTINGER_EXCLUSIVE_STORAGE_DRIVER;
  };
  analysisSummary: {
    totalSourceRecords: number;
    totalValidRecords: number;
    financialParityPassed: boolean;
    activePaymentsInr: string;
    voidedPaymentsInr: string;
    dealsBookedInr: string;
    outstandingInr: string;
    proofsVerified: number;
    projectedHostingerQuotaPercent: number;
  };
  pass1InsertedCounts: Record<string, number>;
  pass2SkippedCounts: Record<string, number>;
  pass2InsertedTotal: number;
  rollbackVerified: boolean;
  rollbackResidualRows: number;
  assertions: ShadowTestAssertion[];
  errors: string[];
}

export interface MigrationReadinessResponse {
  ok: true;
  wizardVersion: string;
  hostingProvider: "hostinger_exclusive";
  cloudflareR2Required: false;
  proofStorageDriver: typeof HOSTINGER_EXCLUSIVE_STORAGE_DRIVER;
  liveExecutionLocked: true;
  liveExecutionLockReason: string;
  supportedSourceFormats: MigrationSourceFormat[];
  mappedEntityCount: number;
  deferredCollectionCount: number;
  hostingerQuotaPolicy: {
    quotaMiB: number;
    warningThresholdMiB: number;
    hardStopThresholdMiB: number;
    safetyMarginMiB: number;
  };
  guardrails: Array<{
    id: string;
    label: string;
    enforced: true;
  }>;
}
