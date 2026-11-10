import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import {
  BACKUP_APP_NAME,
  BACKUP_FORMAT_VERSION,
  BUSINESS_TIMEZONE,
  CURRENT_CRM_SCHEMA_VERSION,
  type BackupAttachmentMeta,
  type BackupClassification,
  type BackupFinancialSummary,
  type BackupManifest,
  type BackupManifestFile,
  type BackupScopeType,
} from "./types.server";

const FORBIDDEN_KEY_PATTERN = /pass(word)?|hash|token|secret|session|cookie|api.?key|auth_secret/i;

/**
 * Recursively deep-copies an object, stripping any credential-like or auth-token keys.
 */
export function scrubSensitiveFields<T>(val: T): T {
  if (Array.isArray(val)) {
    return val.map((item) => scrubSensitiveFields(item)) as unknown as T;
  }
  if (val !== null && typeof val === "object" && !(val instanceof Date)) {
    const entries = Object.entries(val as Record<string, unknown>).filter(
      ([key]) => !FORBIDDEN_KEY_PATTERN.test(key),
    );
    return Object.fromEntries(
      entries.map(([k, v]) => [k, scrubSensitiveFields(v)]),
    ) as unknown as T;
  }
  return val;
}

/**
 * Computes deterministic SHA-256 hex string from byte array or Buffer.
 */
export function computeSha256(bytes: Uint8Array | Buffer | string): string {
  const hash = crypto.createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

/**
 * Produces deterministic, sorted-key JSON stringification.
 */
export function canonicalJsonStringify(obj: unknown, space = 2): string {
  return JSON.stringify(sortKeysRecursively(obj), null, space);
}

function sortKeysRecursively(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortKeysRecursively);
  }
  if (val !== null && typeof val === "object" && !(val instanceof Date)) {
    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortKeysRecursively((val as Record<string, unknown>)[key]);
    }
    return result;
  }
  return val;
}

/**
 * Builds a deterministic financial summary from raw deal and payment records.
 */
export function buildFinancialSummary(params: {
  deals: Array<{ id: string; status?: string; valuePaise?: number; value?: number | string }>;
  payments: Array<{
    id: string;
    dealId?: string;
    amountPaise?: number;
    amount?: number | string;
    voided?: boolean;
    status?: string;
  }>;
}): BackupFinancialSummary {
  let totalPaymentsPaise = 0;
  let activePaymentsPaise = 0;
  let voidedPaymentsPaise = 0;
  let activePaymentsCount = 0;
  let voidedPaymentsCount = 0;

  for (const pay of params.payments) {
    const isVoided = Boolean(pay.voided || pay.status === "voided");
    const paise =
      typeof pay.amountPaise === "number"
        ? Math.round(pay.amountPaise)
        : Math.round(Number(pay.amount ?? 0) * 100);

    totalPaymentsPaise += paise;
    if (isVoided) {
      voidedPaymentsPaise += paise;
      voidedPaymentsCount += 1;
    } else {
      activePaymentsPaise += paise;
      activePaymentsCount += 1;
    }
  }

  let totalBookedDealsPaise = 0;
  let dealsWonCount = 0;
  let dealsLostCount = 0;
  let dealsActiveCount = 0;

  for (const deal of params.deals) {
    const paise =
      typeof deal.valuePaise === "number"
        ? Math.round(deal.valuePaise)
        : Math.round(Number(deal.value ?? 0) * 100);

    totalBookedDealsPaise += paise;
    const st = (deal.status ?? "active").toLowerCase();
    if (st === "won") dealsWonCount++;
    else if (st === "lost") dealsLostCount++;
    else dealsActiveCount++;
  }

  const inrRupees = (activePaymentsPaise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    totalPaymentsCount: params.payments.length,
    totalPaymentsPaise,
    totalPaymentsFormattedInr: `₹${inrRupees}`,
    activePaymentsCount,
    activePaymentsPaise,
    voidedPaymentsCount,
    voidedPaymentsPaise,
    totalBookedDealsCount: params.deals.length,
    totalBookedDealsPaise,
    dealsWonCount,
    dealsLostCount,
    dealsActiveCount,
  };
}

/**
 * Constructs a comprehensive, validated BackupManifest.
 */
export function buildManifest(params: {
  type: BackupScopeType;
  ownerUserId?: string;
  ownerEmail?: string;
  schemaVersion?: number;
  formatVersion?: number;
  createdAt?: string;
  includedEntities: string[];
  omittedEntities?: string[];
  counts: Record<string, number>;
  financialSummary: BackupFinancialSummary;
  attachmentsMeta?: BackupAttachmentMeta[];
  files: BackupManifestFile[];
  warnings?: string[];
  relationships?: string[];
}): BackupManifest {
  const formatVersion = params.formatVersion ?? BACKUP_FORMAT_VERSION;
  const schemaVersion = params.schemaVersion ?? CURRENT_CRM_SCHEMA_VERSION;
  const createdAt = params.createdAt ?? new Date().toISOString();
  const warnings = [...(params.warnings ?? [])];
  const relationships = [...(params.relationships ?? [])];

  const attMeta = params.attachmentsMeta ?? [];
  const missingAtts = attMeta.filter((a) => a.status === "missing" || !a.path);
  const includedAttCount = attMeta.filter((a) => a.status === "verified" && a.path).length;

  const omitted = params.omittedEntities ?? [];
  const isComplete = params.type === "full" && omitted.length === 0 && missingAtts.length === 0;

  let classification: BackupClassification = "complete";
  if (params.type === "employee") {
    classification = "employee";
  } else if (params.type === "custom") {
    classification = "selective";
  } else if (!isComplete) {
    classification = "incomplete-full";
  }

  const manifest: BackupManifest = {
    app: BACKUP_APP_NAME,
    formatVersion,
    schemaVersion,
    createdAt,
    timezone: BUSINESS_TIMEZONE,
    type: params.type,
    complete: isComplete,
    classification,
    ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
    ...(params.ownerEmail ? { ownerEmail: params.ownerEmail } : {}),
    includedEntities: params.includedEntities,
    omittedEntities: omitted,
    counts: params.counts,
    financialSummary: params.financialSummary,
    attachments: {
      expected: attMeta.length,
      included: includedAttCount,
      missingCount: missingAtts.length,
      missingPaymentIds: missingAtts.map((a) => a.paymentId),
    },
    relationships,
    warnings,
    files: params.files.sort((a, b) => a.path.localeCompare(b.path)),
  };

  // Compute self checksum
  const manifestBytes = Buffer.from(canonicalJsonStringify(manifest));
  manifest.checksumSha256 = computeSha256(manifestBytes);

  return manifest;
}
