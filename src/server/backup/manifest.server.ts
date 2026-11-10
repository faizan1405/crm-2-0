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

import { parseLegacyRupeesToPaise, FinancialValidationError } from "./migrationMapping.server";

/**
 * Disallowed sensitive credential keys.
 * Explicitly preserves integrity checksums, file hashes, references, and IDs.
 */
const PRESERVED_INTEGRITY_KEY_PATTERN =
  /^(sha256|sha256_?hash|file_?hash|proof_?hash|tx_?hash|transaction_?hash|checksum|reference|id)$/i;

export function isSensitiveKey(key: string): boolean {
  if (PRESERVED_INTEGRITY_KEY_PATTERN.test(key)) {
    return false;
  }
  const lower = key.toLowerCase();
  if (
    lower.includes("password") ||
    lower.includes("passwd") ||
    lower.includes("secret") ||
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("authtoken") ||
    lower.includes("auth_token") ||
    lower.includes("sessiontoken") ||
    lower.includes("session_token") ||
    lower.includes("privatekey") ||
    lower.includes("private_key") ||
    lower.includes("encryptionkey") ||
    lower.includes("encryption_key") ||
    lower.includes("token") ||
    lower.includes("cookie") ||
    lower.includes("session") ||
    lower.includes("hash")
  ) {
    return true;
  }
  return false;
}

/**
 * Recursively deep-copies an object, stripping any credential-like or auth-token keys.
 * Integrity hashes (sha256, fileHash, etc.), references, and customer notes are preserved.
 *
 * NOTE: Customer-entered free text (in notes, descriptions) is preserved as entered.
 * It cannot be reliably cleaned with regex without corrupting legitimate business content.
 * Residual privacy risk remains if an owner pastes credentials into CRM notes.
 */
export function scrubSensitiveFields<T>(val: T): T {
  if (Array.isArray(val)) {
    return val.map((item) => scrubSensitiveFields(item)) as unknown as T;
  }
  if (val !== null && typeof val === "object" && !(val instanceof Date)) {
    const entries = Object.entries(val as Record<string, unknown>).filter(
      ([key]) => !isSensitiveKey(key),
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
    let paise = 0;
    if (
      typeof pay.amountPaise === "number" &&
      Number.isSafeInteger(pay.amountPaise) &&
      pay.amountPaise >= 0
    ) {
      paise = pay.amountPaise;
    } else {
      const parsed = parseLegacyRupeesToPaise(pay.amount ?? 0, { allowZero: true });
      if (!parsed.ok) {
        throw new FinancialValidationError(
          `Payment '${pay.id}' has invalid monetary amount: ${parsed.error}`,
        );
      }
      paise = parsed.paise;
    }

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
    let paise = 0;
    if (
      typeof deal.valuePaise === "number" &&
      Number.isSafeInteger(deal.valuePaise) &&
      deal.valuePaise >= 0
    ) {
      paise = deal.valuePaise;
    } else {
      const parsed = parseLegacyRupeesToPaise(deal.value ?? 0, { allowZero: true });
      if (!parsed.ok) {
        throw new FinancialValidationError(
          `Deal '${deal.id}' has invalid monetary value: ${parsed.error}`,
        );
      }
      paise = parsed.paise;
    }

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
