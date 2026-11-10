import "@tanstack/react-start/server-only";
import { unzipSync, strFromU8 } from "fflate";
import { computeSha256 } from "./manifest.server";
import { parseLegacyRupeesToPaise } from "./migrationMapping.server";
import {
  BACKUP_APP_NAME,
  BACKUP_FORMAT_VERSION,
  CURRENT_CRM_SCHEMA_VERSION,
  type BackupClassification,
  type BackupManifest,
  type ValidationReport,
} from "./types.server";

export const ARCHIVE_LIMITS = {
  maxArchiveBytes: 512 * 1024 * 1024, // 512 MiB
  maxEntries: 5000,
  maxEntryBytes: 25 * 1024 * 1024, // 25 MiB
  maxTotalBytes: 600 * 1024 * 1024, // 600 MiB
  maxRatio: 200,
  ratioFloorBytes: 1024 * 1024,
};

const SAFE_PATH_PATTERN =
  /^(manifest\.json|backup-summary\.html|data\/[a-z0-9_-]+\.json|files\/payment-proofs\/[A-Za-z0-9._-]+)$/;

/**
 * Validates an archive entry path to prevent directory traversal or unexpected files.
 */
export function validateArchivePath(name: string): string | null {
  if (name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.includes("\0")) {
    return `Unsafe absolute or platform path in archive: ${name}`;
  }
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === ".")) {
    return `Unsafe path traversal in archive: ${name}`;
  }
  if (!SAFE_PATH_PATTERN.test(name)) {
    return `Unexpected file or forbidden path in archive: ${name}`;
  }
  return null;
}

/**
 * Parses and verifies a raw backup ZIP buffer or file mapping.
 */
export async function validateBackupArchive(
  bytesOrFiles: Uint8Array | Record<string, Uint8Array>,
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entityCounts: Record<string, number> = {};

  let files: Record<string, Uint8Array>;

  if (bytesOrFiles instanceof Uint8Array) {
    if (bytesOrFiles.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
      return {
        ok: false,
        classification: "damaged",
        errors: [
          `Archive exceeds maximum allowable size (${ARCHIVE_LIMITS.maxArchiveBytes} bytes).`,
        ],
        warnings: [],
        restoreAvailable: false,
        entityCounts: {},
        financialReconciliation: { verified: false, discrepancies: ["Archive too large"] },
        attachmentIntegrity: { expected: 0, found: 0, missing: [], corrupted: [] },
      };
    }

    const seen = new Set<string>();
    let totalUncompressed = 0;
    let entryCount = 0;
    let decompressionError: string | null = null;

    try {
      files = unzipSync(bytesOrFiles, {
        filter: (entry) => {
          entryCount++;
          if (entryCount > ARCHIVE_LIMITS.maxEntries) {
            decompressionError = `Archive contains more than ${ARCHIVE_LIMITS.maxEntries} entries.`;
            throw new Error(decompressionError);
          }
          if (seen.has(entry.name)) {
            errors.push(`Duplicate archive entry: ${entry.name}`);
            return false;
          }
          seen.add(entry.name);

          const pathErr = validateArchivePath(entry.name);
          if (pathErr) {
            errors.push(pathErr);
            return false;
          }

          if (entry.originalSize > ARCHIVE_LIMITS.maxEntryBytes) {
            decompressionError = `Archive entry ${entry.name} exceeds max entry size of 25MB.`;
            throw new Error(decompressionError);
          }

          totalUncompressed += entry.originalSize;
          if (totalUncompressed > ARCHIVE_LIMITS.maxTotalBytes) {
            decompressionError = `Archive total uncompressed size exceeds limit of 600MB.`;
            throw new Error(decompressionError);
          }

          if (
            entry.originalSize > ARCHIVE_LIMITS.ratioFloorBytes &&
            entry.originalSize > entry.size * ARCHIVE_LIMITS.maxRatio
          ) {
            decompressionError = `Archive entry ${entry.name} has suspicious compression ratio (possible ZIP bomb).`;
            throw new Error(decompressionError);
          }

          return true;
        },
      });
    } catch {
      return {
        ok: false,
        classification: "damaged",
        errors: [
          decompressionError ??
            "Archive is not a readable or valid ZIP file (damaged, truncated, or corrupt).",
        ],
        warnings: [],
        restoreAvailable: false,
        entityCounts: {},
        financialReconciliation: { verified: false, discrepancies: ["Corrupted ZIP"] },
        attachmentIntegrity: { expected: 0, found: 0, missing: [], corrupted: [] },
      };
    }
  } else {
    files = bytesOrFiles;
  }

  // 1. Manifest Presence
  if (!files["manifest.json"]) {
    errors.push(
      "No manifest.json found in root of archive — this is not a valid Scale Flow backup.",
    );
    return {
      ok: false,
      classification: "damaged",
      errors,
      warnings,
      restoreAvailable: false,
      entityCounts,
      financialReconciliation: { verified: false, discrepancies: ["Missing manifest"] },
      attachmentIntegrity: { expected: 0, found: 0, missing: [], corrupted: [] },
    };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(files["manifest.json"]));
  } catch {
    errors.push("manifest.json is damaged and cannot be parsed as JSON.");
    return {
      ok: false,
      classification: "damaged",
      errors,
      warnings,
      restoreAvailable: false,
      entityCounts,
      financialReconciliation: { verified: false, discrepancies: ["Unreadable manifest"] },
      attachmentIntegrity: { expected: 0, found: 0, missing: [], corrupted: [] },
    };
  }

  // 2. Application & Format Version Checks
  if (manifest.app !== BACKUP_APP_NAME) {
    errors.push(`Manifest declares app '${manifest.app}', but '${BACKUP_APP_NAME}' is expected.`);
  }

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION && manifest.formatVersion !== 1) {
    errors.push(
      `Backup format version ${manifest.formatVersion} is not supported (supported: 1, ${BACKUP_FORMAT_VERSION}).`,
    );
  }

  if (manifest.schemaVersion > CURRENT_CRM_SCHEMA_VERSION) {
    warnings.push(
      `Backup was produced by a newer CRM schema (v${manifest.schemaVersion}) than this server (v${CURRENT_CRM_SCHEMA_VERSION}).`,
    );
  }

  // 3. File List & Checksum Verification
  const listedPaths = new Set<string>();
  for (const fileEntry of manifest.files ?? []) {
    if (listedPaths.has(fileEntry.path)) {
      errors.push(`Manifest lists file '${fileEntry.path}' more than once.`);
      continue;
    }
    listedPaths.add(fileEntry.path);

    const actualBytes = files[fileEntry.path];
    if (!actualBytes) {
      errors.push(`Missing file listed in manifest: ${fileEntry.path}`);
      continue;
    }

    if (actualBytes.byteLength !== fileEntry.bytes) {
      errors.push(
        `File byte size mismatch for '${fileEntry.path}': manifest declares ${fileEntry.bytes}, found ${actualBytes.byteLength}.`,
      );
    }

    const actualSha = computeSha256(actualBytes);
    if (actualSha !== fileEntry.sha256) {
      errors.push(
        `SHA-256 checksum mismatch for '${fileEntry.path}': manifest declares ${fileEntry.sha256}, actual is ${actualSha}.`,
      );
    }
  }

  // Check for unlisted files (excluding manifest and summary html)
  for (const filePath of Object.keys(files)) {
    if (filePath !== "manifest.json" && filePath !== "backup-summary.html") {
      if (!listedPaths.has(filePath)) {
        errors.push(`Archive contains unlisted file not in manifest: ${filePath}`);
      }
    }
  }

  // 4. Entity Data Integrity & Count Verification
  const parsedDataCache = new Map<string, Record<string, unknown>>();
  const getJson = (path: string): Record<string, unknown> | null => {
    if (parsedDataCache.has(path)) return parsedDataCache.get(path)!;
    const raw = files[path];
    if (!raw) return null;
    try {
      const parsed = JSON.parse(strFromU8(raw)) as Record<string, unknown>;
      parsedDataCache.set(path, parsed);
      return parsed;
    } catch {
      errors.push(`Corrupt JSON data in archive file: ${path}`);
      return null;
    }
  };

  // Inspect data files
  const leadsData = getJson("data/leads.json");
  const dealsData = getJson("data/deals.json");
  const paymentsData = getJson("data/payments.json");
  const followupsData = getJson("data/followups.json");
  const projectsData = getJson("data/projects.json");
  const attMetaData = getJson("data/attachment-metadata.json");

  // Collect records
  const leads = (Array.isArray(leadsData?.["leads"]) ? leadsData!["leads"] : []) as Array<{
    id: string;
    [k: string]: unknown;
  }>;
  const deals = (Array.isArray(dealsData?.["deals"]) ? dealsData!["deals"] : []) as Array<{
    id: string;
    leadId?: string;
    valuePaise?: number;
    value?: number;
    status?: string;
    [k: string]: unknown;
  }>;
  const payments = (
    Array.isArray(paymentsData?.["payments"]) ? paymentsData!["payments"] : []
  ) as Array<{
    id: string;
    dealId?: string;
    amountPaise?: number;
    amount?: number;
    voided?: boolean;
    status?: string;
    [k: string]: unknown;
  }>;
  const followups = (
    Array.isArray(followupsData?.["followUps"]) ? followupsData!["followUps"] : []
  ) as Array<{
    id: string;
    leadId?: string;
    [k: string]: unknown;
  }>;
  const projects = (
    Array.isArray(projectsData?.["projects"]) ? projectsData!["projects"] : []
  ) as Array<{
    id: string;
    leadId?: string;
    dealId?: string;
    [k: string]: unknown;
  }>;
  const projectTasks = (
    Array.isArray(projectsData?.["projectTasks"]) ? projectsData!["projectTasks"] : []
  ) as Array<{
    id: string;
    projectId?: string;
    [k: string]: unknown;
  }>;

  entityCounts["leads"] = leads.length;
  entityCounts["deals"] = deals.length;
  entityCounts["payments"] = payments.length;
  entityCounts["followups"] = followups.length;
  entityCounts["projects"] = projects.length;
  entityCounts["projectTasks"] = projectTasks.length;

  // Verify counts against manifest if present
  if (manifest.counts) {
    for (const [entityKey, count] of Object.entries(manifest.counts)) {
      if (entityCounts[entityKey] !== undefined && entityCounts[entityKey] !== count) {
        errors.push(
          `Entity count mismatch for '${entityKey}': manifest declares ${count}, actual found is ${entityCounts[entityKey]}.`,
        );
      }
    }
  }

  // 5. Duplicate ID Checks
  const checkDuplicateIds = (records: Array<{ id: string }>, entityName: string) => {
    const seenIds = new Set<string>();
    for (const rec of records) {
      if (!rec.id) {
        errors.push(`Missing id on record in ${entityName}.`);
        continue;
      }
      if (seenIds.has(rec.id)) {
        errors.push(`Duplicate ID '${rec.id}' detected in ${entityName}.`);
      }
      seenIds.add(rec.id);
    }
  };

  checkDuplicateIds(leads, "leads");
  checkDuplicateIds(deals, "deals");
  checkDuplicateIds(payments, "payments");
  checkDuplicateIds(followups, "followups");
  checkDuplicateIds(projects, "projects");
  checkDuplicateIds(projectTasks, "projectTasks");

  // 6. Foreign Key & Relationship Integrity
  const leadIdSet = new Set(leads.map((l) => l.id));
  const dealIdSet = new Set(deals.map((d) => d.id));
  const projectIdSet = new Set(projects.map((p) => p.id));

  // Payment -> Deal is mandatory
  for (const pay of payments) {
    if (!pay.dealId) {
      errors.push(`Payment '${pay.id}' has no dealId associated.`);
    } else if (deals.length > 0 && !dealIdSet.has(pay.dealId)) {
      errors.push(
        `Payment '${pay.id}' references deal '${pay.dealId}' which does not exist in archive.`,
      );
    }
  }

  // Deal -> Lead
  for (const deal of deals) {
    if (deal.leadId && leads.length > 0 && !leadIdSet.has(deal.leadId)) {
      warnings.push(`Deal '${deal.id}' references lead '${deal.leadId}' not found in archive.`);
    }
  }

  // Project -> Task
  for (const task of projectTasks) {
    if (!task.projectId || !projectIdSet.has(task.projectId)) {
      errors.push(`Project task '${task.id}' references missing project '${task.projectId}'.`);
    }
  }

  // 7. Binary Proof & Attachment Integrity
  const missingProofs: string[] = [];
  const corruptedProofs: string[] = [];
  let proofsFound = 0;
  const attachmentsList = (
    Array.isArray(attMetaData?.["attachments"]) ? attMetaData!["attachments"] : []
  ) as Array<{
    attachmentId: string;
    paymentId: string;
    path: string | null;
    sha256: string | null;
    fileSize: number;
    mimeType?: string;
  }>;

  const paymentIdSet = new Set(payments.map((p) => p.id));

  for (const att of attachmentsList) {
    if (!att.paymentId || !paymentIdSet.has(att.paymentId)) {
      errors.push(
        `Attachment metadata '${att.attachmentId}' references missing payment '${att.paymentId}'.`,
      );
    }
    if (!att.path) {
      missingProofs.push(att.paymentId);
      continue;
    }
    const binaryBytes = files[att.path];
    if (!binaryBytes) {
      missingProofs.push(att.paymentId);
      errors.push(
        `Payment proof file '${att.path}' is declared in metadata but missing from archive.`,
      );
      continue;
    }

    proofsFound++;
    if (binaryBytes.byteLength !== att.fileSize) {
      corruptedProofs.push(att.path);
      errors.push(
        `Proof file '${att.path}' size mismatch: expected ${att.fileSize}, found ${binaryBytes.byteLength}.`,
      );
    }

    const calculatedSha = computeSha256(binaryBytes);
    if (att.sha256 && calculatedSha !== att.sha256) {
      corruptedProofs.push(att.path);
      errors.push(
        `Proof file '${att.path}' checksum mismatch: expected ${att.sha256}, actual is ${calculatedSha}.`,
      );
    }
  }

  // 8. Independent Financial Reconciliation
  let verifiedFinancials = true;
  const financialDiscrepancies: string[] = [];

  let calculatedActivePaise = 0;
  let calculatedVoidedPaise = 0;
  for (const pay of payments) {
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
      if (parsed.ok) {
        paise = parsed.paise;
      } else {
        errors.push(`Payment '${pay.id}' has invalid financial amount: ${parsed.error}`);
        continue;
      }
    }

    if (isVoided) {
      calculatedVoidedPaise += paise;
    } else {
      calculatedActivePaise += paise;
    }
  }

  if (manifest.financialSummary) {
    if (manifest.financialSummary.activePaymentsPaise !== calculatedActivePaise) {
      verifiedFinancials = false;
      const msg = `Financial discrepancy: Manifest active paise (${manifest.financialSummary.activePaymentsPaise}) != calculated from payments (${calculatedActivePaise}).`;
      errors.push(msg);
      financialDiscrepancies.push(msg);
    }
    if (manifest.financialSummary.voidedPaymentsPaise !== calculatedVoidedPaise) {
      verifiedFinancials = false;
      const msg = `Financial discrepancy: Manifest voided paise (${manifest.financialSummary.voidedPaymentsPaise}) != calculated from payments (${calculatedVoidedPaise}).`;
      errors.push(msg);
      financialDiscrepancies.push(msg);
    }
  }

  const ok = errors.length === 0;
  let classification: BackupClassification = "complete";
  if (!ok) {
    classification = "damaged";
  } else if (manifest.type === "employee") {
    classification = "employee";
  } else if (manifest.type === "custom") {
    classification = "selective";
  } else if (!manifest.complete) {
    classification = "incomplete-full";
  }

  return {
    ok,
    classification,
    errors,
    warnings,
    manifest,
    restoreAvailable: ok && classification === "complete",
    entityCounts,
    financialReconciliation: {
      verified: verifiedFinancials && ok,
      discrepancies: financialDiscrepancies,
      summary: manifest.financialSummary,
    },
    attachmentIntegrity: {
      expected: attachmentsList.length,
      found: proofsFound,
      missing: missingProofs,
      corrupted: corruptedProofs,
    },
  };
}
