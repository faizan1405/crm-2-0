import "@tanstack/react-start/server-only";
import { unzipSync, strFromU8 } from "fflate";
import { computeSha256 } from "../backup/manifest.server";
import {
  MigrationMapper,
  parseLegacyRupeesToPaise,
  type LegacyDealRecord,
  type LegacyLeadRecord,
  type LegacyOwnerSettingsRecord,
  type LegacyPaymentProofRecord,
  type LegacyPaymentRecord,
  type LegacyProjectRecord,
  type LegacyProjectTaskRecord,
  type LegacyQuotationRecord,
  type LegacySalesGoalRecord,
} from "../backup/migrationMapping.server";
import { ARCHIVE_LIMITS, validateArchivePath } from "../backup/validation.server";
import {
  buildFinancialReconciliationReport,
  estimateHostingerMigrationCapacity,
  type ReconcilableDeal,
  type ReconcilableMilestone,
  type ReconcilablePayment,
} from "./financialReconciliation.server";
import { scrubLegacyCredentials, sniffProofMagicBytes } from "./guards.server";
import {
  HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
  MIGRATION_WIZARD_VERSION,
  type DeferredCollectionReport,
  type MigrationAnalysisReport,
  type MigrationEntityKey,
  type MigrationEntitySummary,
  type MigrationSourceFormat,
  type ProofMigrationCheck,
  type UnresolvedForeignKeyIssue,
} from "./types.server";

export const MAX_PROOF_BINARY_BYTES = 10 * 1024 * 1024; // 10 MiB

export interface MigrationExistingContext {
  existingLeadIds?: Set<string>;
  existingDealIds?: Set<string>;
  existingPaymentIds?: Set<string>;
  existingProjectIds?: Set<string>;
  existingQuotationIds?: Set<string>;
  existingGoalIds?: Set<string>;
  existingAutomationIds?: Set<string>;
  baselineUsedMiB?: number;
}

export interface MappedMigrationPayload {
  ownerUserId: string;
  leads: Array<Record<string, unknown> & { id: string }>;
  archivedLeads: Array<Record<string, unknown> & { id: string }>;
  activities: Array<Record<string, unknown> & { id: string; leadId: string }>;
  followUps: Array<
    Record<string, unknown> & { id: string; leadId: string; activeLeadLock: string | null }
  >;
  callLogs: Array<Record<string, unknown> & { id: string; leadId: string }>;
  whatsAppLogs: Array<Record<string, unknown> & { id: string; leadId: string }>;
  deals: Array<Record<string, unknown> & { id: string; leadId: string; valuePaise: number }>;
  dealMilestones: Array<
    Record<string, unknown> & { id: string; dealId: string; amountPaise: number }
  >;
  payments: Array<
    Record<string, unknown> & { id: string; dealId: string; amountPaise: number; voided: boolean }
  >;
  financeEvents: Array<Record<string, unknown> & { id: string; dealId: string }>;
  paymentProofs: Array<
    Record<string, unknown> & {
      id: string;
      paymentId: string;
      dealId: string;
      storageKey: string;
      sha256Hash: string;
      mimeType: string;
      fileSize: number;
    }
  >;
  proofBinaries: Map<string, Uint8Array>;
  quotationTemplates: Array<Record<string, unknown> & { id: string }>;
  quotations: Array<Record<string, unknown> & { id: string }>;
  projects: Array<Record<string, unknown> & { id: string }>;
  projectMilestones: Array<Record<string, unknown> & { id: string; projectId: string }>;
  projectTasks: Array<Record<string, unknown> & { id: string; projectId: string }>;
  supportTickets: Array<Record<string, unknown> & { id: string; projectId: string }>;
  customFields: Array<Record<string, unknown> & { id: string }>;
  leadFieldValues: Array<Record<string, unknown> & { id: string; leadId: string; fieldId: string }>;
  tags: Array<Record<string, unknown> & { id: string }>;
  leadTags: Array<Record<string, unknown> & { id: string; leadId: string; tagId: string }>;
  savedViews: Array<Record<string, unknown> & { id: string }>;
  inboxItems: Array<Record<string, unknown> & { id: string; leadId: string }>;
  leadRelationships: Array<
    Record<string, unknown> & { id: string; leadAId: string; leadBId: string }
  >;
  automationRules: Array<Record<string, unknown> & { id: string; status: string }>;
  ownerSettings: Array<Record<string, unknown> & { id: string }>;
  salesGoals: Array<Record<string, unknown> & { id: string }>;
}

export interface MigrationAnalysisBundle {
  report: MigrationAnalysisReport;
  mapped: MappedMigrationPayload;
}

const ENTITY_META: Record<MigrationEntityKey, { label: string; tableName: string }> = {
  leads: { label: "Active Leads", tableName: "crm_leads" },
  archivedLeads: { label: "Archived / Bin Leads", tableName: "crm_leads" },
  activities: { label: "Lead Activities", tableName: "crm_lead_activities" },
  followUps: { label: "Follow-ups", tableName: "crm_follow_ups" },
  callLogs: { label: "Call Logs", tableName: "crm_call_logs" },
  whatsAppLogs: { label: "WhatsApp Logs", tableName: "crm_whats_app_logs" },
  deals: { label: "Deals", tableName: "crm_deals" },
  dealMilestones: { label: "Deal Milestones", tableName: "crm_deal_milestones" },
  payments: { label: "Payments", tableName: "crm_payments" },
  financeEvents: { label: "Finance Audit Events", tableName: "crm_finance_events" },
  paymentProofs: { label: "Payment Proofs", tableName: "crm_payment_proofs" },
  quotationTemplates: { label: "Quotation Templates", tableName: "crm_quotation_templates" },
  quotations: { label: "Quotations", tableName: "crm_quotations" },
  projects: { label: "Projects", tableName: "crm_projects" },
  projectMilestones: { label: "Project Milestones", tableName: "crm_project_milestones" },
  projectTasks: { label: "Project Tasks", tableName: "crm_project_tasks" },
  supportTickets: { label: "Support Tickets", tableName: "crm_client_support_tickets" },
  customFields: { label: "Custom Fields", tableName: "crm_custom_fields" },
  leadFieldValues: { label: "Lead Field Values", tableName: "crm_lead_field_values" },
  tags: { label: "Tag Definitions", tableName: "crm_tag_defs" },
  leadTags: { label: "Lead-Tag Links", tableName: "crm_lead_tags" },
  savedViews: { label: "Saved Views", tableName: "crm_saved_views" },
  inboxItems: { label: "Smart Inbox Items", tableName: "crm_lead_inbox_items" },
  leadRelationships: { label: "Lead Relationships", tableName: "crm_lead_relationships" },
  automationRules: { label: "Automation Rules", tableName: "crm_automation_rules" },
  ownerSettings: { label: "Owner Settings", tableName: "crm_owner_settings" },
  salesGoals: { label: "Sales Goals", tableName: "crm_sales_goals" },
};

const CANONICAL_LEAD_SOURCES: Record<string, string> = {
  website: "Website",
  referral: "Referral",
  instagram: "Instagram",
  "google ads": "Google Ads",
  linkedin: "LinkedIn",
  "walk-in": "Walk-in",
  whatsapp: "WhatsApp",
  "meta ads": "Meta Ads",
  facebook: "Facebook",
  google: "Google",
  indiamart: "IndiaMART",
  "direct enquiry": "Direct Enquiry",
  other: "Other",
};

function normalizeLeadSource(raw?: string): string {
  const key = (raw ?? "other").trim().toLowerCase();
  return CANONICAL_LEAD_SOURCES[key] ?? "Other";
}

function normalizeLeadPriority(raw?: string): "hot" | "warm" | "cold" {
  const key = (raw ?? "warm").trim().toLowerCase();
  if (key === "hot" || key === "high") return "hot";
  if (key === "cold" || key === "low") return "cold";
  return "warm";
}

function normalizePaymentMethod(
  raw?: string,
): "UPI" | "Bank Transfer" | "Cash" | "Card" | "Cheque" {
  const key = (raw ?? "bank_transfer").trim().toLowerCase();
  if (key === "upi") return "UPI";
  if (key === "cash") return "Cash";
  if (key === "card") return "Card";
  if (key === "cheque" || key === "check") return "Cheque";
  return "Bank Transfer";
}

function normalizePaymentType(raw?: string): "advance" | "milestone" | "final" | "other" {
  const key = (raw ?? "other").trim().toLowerCase();
  if (key === "advance" || key === "milestone" || key === "final") return key;
  return "other";
}

function normalizeProjectStage(raw?: string): string {
  const key = (raw ?? "discovery").trim().toLowerCase();
  if (key === "dev") return "development";
  if (key === "qa") return "testing";
  if (key === "review") return "client_review";
  if (key === "handover") return "ready_to_launch";
  return key;
}

function normalizeDealStorageStatus(
  raw?: string,
): "active" | "completed" | "on_hold" | "cancelled" {
  const key = (raw ?? "active").trim().toLowerCase();
  if (key === "completed") return "completed";
  if (key === "on_hold") return "on_hold";
  if (key === "cancelled" || key === "lost") return "cancelled";
  return "active";
}

function createEmptyEntitySummary(entity: MigrationEntityKey): MigrationEntitySummary {
  const meta = ENTITY_META[entity];
  return {
    entity,
    label: meta.label,
    tableName: meta.tableName,
    sourceCount: 0,
    validCount: 0,
    toCreate: 0,
    toSkip: 0,
    errorCount: 0,
    warningCount: 0,
    conflicts: [],
  };
}

function createEmptyMappedPayload(ownerUserId: string): MappedMigrationPayload {
  return {
    ownerUserId,
    leads: [],
    archivedLeads: [],
    activities: [],
    followUps: [],
    callLogs: [],
    whatsAppLogs: [],
    deals: [],
    dealMilestones: [],
    payments: [],
    financeEvents: [],
    paymentProofs: [],
    proofBinaries: new Map<string, Uint8Array>(),
    quotationTemplates: [],
    quotations: [],
    projects: [],
    projectMilestones: [],
    projectTasks: [],
    supportTickets: [],
    customFields: [],
    leadFieldValues: [],
    tags: [],
    leadTags: [],
    savedViews: [],
    inboxItems: [],
    leadRelationships: [],
    automationRules: [],
    ownerSettings: [],
    salesGoals: [],
  };
}

function asArray<T = Record<string, unknown>>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : [];
}

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

interface ExtractedSourceData {
  format: MigrationSourceFormat;
  collections: Record<string, unknown>;
  binaryFiles: Map<string, Uint8Array>;
  parseErrors: string[];
}

function extractMigrationSource(
  input: Uint8Array | string | Record<string, unknown>,
): ExtractedSourceData {
  const parseErrors: string[] = [];
  const binaryFiles = new Map<string, Uint8Array>();

  if (!(input instanceof Uint8Array) && typeof input !== "string") {
    const obj = asRecord(input);
    const unwrapped =
      obj["state"] && typeof obj["state"] === "object" ? asRecord(obj["state"]) : obj;
    return {
      format: "legacy-json-snapshot",
      collections: unwrapped,
      binaryFiles,
      parseErrors,
    };
  }

  if (input instanceof Uint8Array && isZipBytes(input)) {
    if (input.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
      parseErrors.push(
        `Archive exceeds maximum allowed size (${ARCHIVE_LIMITS.maxArchiveBytes} bytes).`,
      );
      return { format: "data-vault-zip", collections: {}, binaryFiles, parseErrors };
    }

    let files: Record<string, Uint8Array>;
    let totalUncompressed = 0;
    let entryCount = 0;
    const seen = new Set<string>();
    try {
      files = unzipSync(input, {
        filter: (entry) => {
          entryCount++;
          if (entryCount > ARCHIVE_LIMITS.maxEntries) {
            throw new Error(`Archive exceeds maximum entry count (${ARCHIVE_LIMITS.maxEntries}).`);
          }
          if (seen.has(entry.name)) {
            parseErrors.push(`Duplicate archive entry detected: ${entry.name}`);
            return false;
          }
          seen.add(entry.name);

          const pathErr = validateArchivePath(entry.name);
          if (pathErr) {
            parseErrors.push(pathErr);
            return false;
          }
          if (entry.originalSize > ARCHIVE_LIMITS.maxEntryBytes) {
            throw new Error(`Archive entry '${entry.name}' exceeds 25 MiB limit.`);
          }
          totalUncompressed += entry.originalSize;
          if (totalUncompressed > ARCHIVE_LIMITS.maxTotalBytes) {
            throw new Error("Archive uncompressed size exceeds 600 MiB safety limit.");
          }
          if (
            entry.originalSize > ARCHIVE_LIMITS.ratioFloorBytes &&
            entry.originalSize > entry.size * ARCHIVE_LIMITS.maxRatio
          ) {
            throw new Error(`Suspicious compression ratio detected in '${entry.name}'.`);
          }
          return true;
        },
      });
    } catch (err) {
      parseErrors.push(err instanceof Error ? err.message : "Failed to decompress ZIP archive.");
      return { format: "data-vault-zip", collections: {}, binaryFiles, parseErrors };
    }

    const merged: Record<string, unknown> = {};
    for (const [path, bytes] of Object.entries(files)) {
      if (path.startsWith("files/payment-proofs/")) {
        binaryFiles.set(path, bytes);
        continue;
      }
      if (path.startsWith("data/") && path.endsWith(".json")) {
        try {
          const parsed = JSON.parse(strFromU8(bytes)) as Record<string, unknown>;
          if (path === "data/settings.json") {
            merged["settings"] = parsed;
          } else {
            for (const [k, v] of Object.entries(parsed)) {
              if (k in merged && Array.isArray(merged[k]) && Array.isArray(v)) {
                merged[k] = [...(merged[k] as unknown[]), ...v];
              } else {
                merged[k] = v;
              }
            }
          }
        } catch {
          parseErrors.push(`Malformed JSON in archive entry '${path}'.`);
        }
      }
    }

    return {
      format: "data-vault-zip",
      collections: merged,
      binaryFiles,
      parseErrors,
    };
  }

  // JSON string or UTF-8 JSON bytes
  const rawText = input instanceof Uint8Array ? strFromU8(input) : input;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const obj = asRecord(parsed);
    const unwrapped =
      obj["state"] && typeof obj["state"] === "object" ? asRecord(obj["state"]) : obj;
    return {
      format: "legacy-json-snapshot",
      collections: unwrapped,
      binaryFiles,
      parseErrors,
    };
  } catch {
    parseErrors.push("Uploaded file is neither a valid Data Vault ZIP archive nor valid JSON.");
    return { format: "legacy-json-snapshot", collections: {}, binaryFiles, parseErrors };
  }
}

/**
 * Analyzes, validates, maps, and financially reconciles an existing CRM V1 / Data Vault
 * backup archive or JSON snapshot.
 *
 * STRICTLY READ-ONLY: performs ZERO database writes and ZERO browser storage mutations.
 */
export function analyzeMigrationSource(params: {
  source: Uint8Array | string | Record<string, unknown>;
  sourceFilename?: string;
  ownerUserId: string;
  existingContext?: MigrationExistingContext;
}): MigrationAnalysisBundle {
  const { source, ownerUserId, existingContext = {} } = params;
  const sourceFilename = params.sourceFilename ?? "migration-source";
  const extracted = extractMigrationSource(source);

  const { cleaned: collections, scrubbedCount } = scrubLegacyCredentials(extracted.collections);
  const mapper = new MigrationMapper(ownerUserId);
  const mapped = createEmptyMappedPayload(ownerUserId);

  const entities = {} as Record<MigrationEntityKey, MigrationEntitySummary>;
  for (const key of Object.keys(ENTITY_META) as MigrationEntityKey[]) {
    entities[key] = createEmptyEntitySummary(key);
  }

  const errors: string[] = [...extracted.parseErrors];
  const warnings: string[] = [];
  const unresolvedForeignKeys: UnresolvedForeignKeyIssue[] = [];

  const existingLeadIds = existingContext.existingLeadIds ?? new Set<string>();
  const existingDealIds = existingContext.existingDealIds ?? new Set<string>();
  const existingPaymentIds = existingContext.existingPaymentIds ?? new Set<string>();
  const existingProjectIds = existingContext.existingProjectIds ?? new Set<string>();
  const existingQuotationIds = existingContext.existingQuotationIds ?? new Set<string>();
  const existingGoalIds = existingContext.existingGoalIds ?? new Set<string>();
  const existingAutomationIds = existingContext.existingAutomationIds ?? new Set<string>();

  const mappedLeadIds = new Set<string>();
  const mappedDealIds = new Set<string>();
  const mappedPaymentIds = new Set<string>();
  const mappedProjectIds = new Set<string>();
  const mappedCustomFieldIds = new Set<string>();
  const mappedTagIds = new Set<string>();

  const legacyLeadIds = new Set<string>();
  const legacyDealIds = new Set<string>();
  const legacyPaymentToDeal = new Map<string, string>();
  const legacyProjectIds = new Set<string>();

  // 1. Active Leads
  const rawLeads = asArray<LegacyLeadRecord>(collections["leads"]);
  entities.leads.sourceCount = rawLeads.length;
  for (const raw of rawLeads) {
    if (!raw?.id || !raw?.name?.trim()) {
      entities.leads.errorCount++;
      errors.push(`Lead record missing required 'id' or 'name'.`);
      continue;
    }
    const row = mapper.mapLead(raw);
    legacyLeadIds.add(raw.id);
    mappedLeadIds.add(row.id);
    entities.leads.validCount++;
    if (existingLeadIds.has(raw.id) || existingLeadIds.has(row.id)) {
      entities.leads.toSkip++;
      entities.leads.conflicts.push({
        legacyId: raw.id,
        mappedId: row.id,
        reason: "Lead already exists in target database.",
        resolution: "skip",
      });
    } else {
      entities.leads.toCreate++;
      mapped.leads.push({
        ...row,
        source: normalizeLeadSource(row.source),
        priority: normalizeLeadPriority(row.priority),
        legacyId: raw.id,
        lifecycleStatus: "active",
      });
    }
  }

  // 2. Archived / Bin Leads
  const rawBin = asArray<Record<string, unknown>>(collections["bin"]);
  entities.archivedLeads.sourceCount = rawBin.length;
  for (const entry of rawBin) {
    const rawLead = (entry["lead"]
      ? asRecord(entry["lead"])
      : entry) as unknown as LegacyLeadRecord;
    if (!rawLead?.id || !rawLead?.name?.trim()) {
      entities.archivedLeads.errorCount++;
      errors.push("Archived bin lead entry missing required 'id' or 'name'.");
      continue;
    }
    const row = mapper.mapLead(rawLead);
    legacyLeadIds.add(rawLead.id);
    mappedLeadIds.add(row.id);
    entities.archivedLeads.validCount++;
    if (existingLeadIds.has(rawLead.id) || existingLeadIds.has(row.id)) {
      entities.archivedLeads.toSkip++;
      entities.archivedLeads.conflicts.push({
        legacyId: rawLead.id,
        mappedId: row.id,
        reason: "Archived lead already exists in target database.",
        resolution: "skip",
      });
    } else {
      entities.archivedLeads.toCreate++;
      mapped.archivedLeads.push({
        ...row,
        source: normalizeLeadSource(row.source),
        priority: normalizeLeadPriority(row.priority),
        legacyId: rawLead.id,
        lifecycleStatus: "waste",
        archivedAt: mapper.toMysqlUtc(
          String(entry["deletedAt"] ?? rawLead.updatedAt ?? rawLead.createdAt),
        ),
        archiveReason: typeof entry["reason"] === "string" ? entry["reason"] : "Migrated from Bin",
      });
    }
  }

  const hasLead = (leadId?: string) =>
    Boolean(leadId && (legacyLeadIds.has(leadId) || existingLeadIds.has(leadId)));

  // 3. Lead Activities
  const rawActivities = asArray<Record<string, unknown>>(collections["activities"]);
  entities.activities.sourceCount = rawActivities.length;
  for (const raw of rawActivities) {
    const id = String(raw["id"] ?? "");
    const leadId = String(raw["leadId"] ?? "");
    if (!id || !leadId) {
      entities.activities.errorCount++;
      errors.push("Activity record missing required 'id' or 'leadId'.");
      continue;
    }
    if (!hasLead(leadId)) {
      unresolvedForeignKeys.push({
        entity: "activities",
        recordId: id,
        foreignField: "leadId",
        missingTargetId: leadId,
        severity: "error",
      });
      entities.activities.errorCount++;
      continue;
    }
    const mappedId = mapper.mapId(id, "act");
    const mappedLeadId = mapper.mapId(leadId, "lead");
    entities.activities.validCount++;
    entities.activities.toCreate++;
    mapped.activities.push({
      id: mappedId,
      legacyId: id,
      ownerUserId,
      leadId: mappedLeadId,
      actorUserId: ownerUserId,
      type: String(raw["type"] ?? "note"),
      text: String(raw["text"] ?? raw["note"] ?? ""),
      outcome: typeof raw["outcome"] === "string" ? raw["outcome"] : null,
      occurredAt: mapper.toMysqlUtc(
        String(raw["at"] ?? raw["occurredAt"] ?? raw["createdAt"] ?? new Date().toISOString()),
      ),
      createdAt: mapper.toMysqlUtc(
        String(raw["createdAt"] ?? raw["at"] ?? new Date().toISOString()),
      ),
    });
  }

  // 4. Follow-ups (enforcing activeLeadLock: max 1 active pending follow-up per lead)
  const rawFollowUps = asArray<Record<string, unknown>>(collections["followUps"]);
  entities.followUps.sourceCount = rawFollowUps.length;
  const activeFollowUpLockSeen = new Set<string>();
  let followUpActiveLocksResolved = 0;

  // Sort by dueAt ascending so the earliest pending follow-up wins the activeLeadLock deterministically
  const sortedFollowUps = [...rawFollowUps].sort((a, b) =>
    String(a["dueAt"] ?? "").localeCompare(String(b["dueAt"] ?? "")),
  );

  for (const raw of sortedFollowUps) {
    const id = String(raw["id"] ?? "");
    const leadId = String(raw["leadId"] ?? "");
    if (!id || !leadId) {
      entities.followUps.errorCount++;
      errors.push("Follow-up record missing required 'id' or 'leadId'.");
      continue;
    }
    if (!hasLead(leadId)) {
      unresolvedForeignKeys.push({
        entity: "followUps",
        recordId: id,
        foreignField: "leadId",
        missingTargetId: leadId,
        severity: "error",
      });
      entities.followUps.errorCount++;
      continue;
    }
    const mappedId = mapper.mapId(id, "fu");
    const mappedLeadId = mapper.mapId(leadId, "lead");
    const isCompleted = Boolean(raw["done"] || raw["completedAt"]);
    const isCancelled = Boolean(raw["cancelledAt"] || raw["status"] === "cancelled");
    let activeLeadLock: string | null = !isCompleted && !isCancelled ? mappedLeadId : null;
    let cancelReason = typeof raw["cancelReason"] === "string" ? raw["cancelReason"] : null;
    let cancelledAt = isCancelled
      ? mapper.toMysqlUtc(String(raw["cancelledAt"] ?? new Date().toISOString()))
      : null;

    if (activeLeadLock && activeFollowUpLockSeen.has(mappedLeadId)) {
      // Normalize duplicate active follow-up for the same lead to respect MySQL unique active_lead_lock
      activeLeadLock = null;
      cancelledAt = mapper.toMysqlUtc(new Date().toISOString());
      cancelReason = "Normalized duplicate pending follow-up during B13 migration";
      followUpActiveLocksResolved++;
      entities.followUps.warningCount++;
      entities.followUps.conflicts.push({
        legacyId: id,
        mappedId,
        reason: `Lead '${leadId}' had multiple pending follow-ups; earliest due kept active and this one normalized to cancelled.`,
        resolution: "normalize",
      });
      warnings.push(
        `Follow-up '${id}' for lead '${leadId}' was normalized to cancelled to preserve single active follow-up constraint.`,
      );
    } else if (activeLeadLock) {
      activeFollowUpLockSeen.add(mappedLeadId);
    }

    entities.followUps.validCount++;
    entities.followUps.toCreate++;
    mapped.followUps.push({
      id: mappedId,
      legacyId: id,
      ownerUserId,
      leadId: mappedLeadId,
      activeLeadLock,
      type: String(raw["type"] ?? "call"),
      dueAt: mapper.toMysqlUtc(String(raw["dueAt"] ?? new Date().toISOString())),
      dueIstDate:
        mapper.toIstDate(String(raw["dueAt"] ?? new Date().toISOString())) ?? "2026-01-01",
      note: typeof raw["note"] === "string" ? raw["note"] : null,
      completedAt: isCompleted
        ? mapper.toMysqlUtc(String(raw["completedAt"] ?? new Date().toISOString()))
        : null,
      cancelledAt,
      cancelReason,
    });
  }

  // 5. Call Logs (from callOps or callLogs)
  const rawCallLogs = [
    ...asArray<Record<string, unknown>>(collections["callLogs"]),
    ...asArray<Record<string, unknown>>(collections["callOps"]),
  ];
  entities.callLogs.sourceCount = rawCallLogs.length;
  for (const raw of rawCallLogs) {
    const id = String(raw["id"] ?? "");
    const leadId = String(raw["leadId"] ?? "");
    if (!id || !leadId) {
      entities.callLogs.errorCount++;
      errors.push("Call log missing required 'id' or 'leadId'.");
      continue;
    }
    if (!hasLead(leadId)) {
      unresolvedForeignKeys.push({
        entity: "callLogs",
        recordId: id,
        foreignField: "leadId",
        missingTargetId: leadId,
        severity: "error",
      });
      entities.callLogs.errorCount++;
      continue;
    }
    entities.callLogs.validCount++;
    entities.callLogs.toCreate++;
    mapped.callLogs.push({
      id: mapper.mapId(id, "call"),
      legacyId: id,
      ownerUserId,
      leadId: mapper.mapId(leadId, "lead"),
      outcome: String(raw["outcome"] ?? "connected"),
      notes: typeof raw["notes"] === "string" ? raw["notes"] : null,
      occurredAt: mapper.toMysqlUtc(
        String(raw["at"] ?? raw["occurredAt"] ?? new Date().toISOString()),
      ),
    });
  }

  // 6. WhatsApp Logs (explicit whatsappLogs or WhatsApp-typed activities)
  const rawWaLogs = asArray<Record<string, unknown>>(collections["whatsAppLogs"]);
  entities.whatsAppLogs.sourceCount = rawWaLogs.length;
  for (const raw of rawWaLogs) {
    const id = String(raw["id"] ?? "");
    const leadId = String(raw["leadId"] ?? "");
    if (!id || !leadId) {
      entities.whatsAppLogs.errorCount++;
      errors.push("WhatsApp log missing required 'id' or 'leadId'.");
      continue;
    }
    if (!hasLead(leadId)) {
      unresolvedForeignKeys.push({
        entity: "whatsAppLogs",
        recordId: id,
        foreignField: "leadId",
        missingTargetId: leadId,
        severity: "error",
      });
      entities.whatsAppLogs.errorCount++;
      continue;
    }
    entities.whatsAppLogs.validCount++;
    entities.whatsAppLogs.toCreate++;
    mapped.whatsAppLogs.push({
      id: mapper.mapId(id, "wa"),
      legacyId: id,
      ownerUserId,
      leadId: mapper.mapId(leadId, "lead"),
      messageBody: String(raw["messageBody"] ?? raw["text"] ?? ""),
      sentAt: mapper.toMysqlUtc(String(raw["sentAt"] ?? raw["at"] ?? new Date().toISOString())),
    });
  }

  // 7. Deals & Deal Milestones
  const rawDeals = asArray<LegacyDealRecord & { milestones?: Array<Record<string, unknown>> }>(
    collections["deals"],
  );
  entities.deals.sourceCount = rawDeals.length;
  const reconcilableDeals: ReconcilableDeal[] = [];
  const reconcilableMilestones: ReconcilableMilestone[] = [];
  const financialErrors: string[] = [];

  for (const raw of rawDeals) {
    if (!raw?.id || !raw?.name?.trim()) {
      entities.deals.errorCount++;
      errors.push("Deal record missing required 'id' or 'name'.");
      continue;
    }
    if (raw.leadId && !hasLead(raw.leadId)) {
      unresolvedForeignKeys.push({
        entity: "deals",
        recordId: raw.id,
        foreignField: "leadId",
        missingTargetId: raw.leadId,
        severity: "error",
      });
      entities.deals.errorCount++;
      continue;
    }

    let sourcePaise: number;
    if (
      typeof raw.valuePaise === "number" &&
      Number.isSafeInteger(raw.valuePaise) &&
      raw.valuePaise >= 0
    ) {
      sourcePaise = raw.valuePaise;
    } else {
      const parsed = parseLegacyRupeesToPaise(raw.value, {
        allowZero: true,
        entityContext: `deal '${raw.id}'`,
      });
      if (!parsed.ok) {
        entities.deals.errorCount++;
        const msg = `Deal '${raw.id}' has invalid monetary value: ${parsed.error}`;
        errors.push(msg);
        financialErrors.push(msg);
        continue;
      }
      sourcePaise = parsed.paise;
    }

    const row = mapper.mapDeal(raw);
    legacyDealIds.add(raw.id);
    mappedDealIds.add(row.id);
    entities.deals.validCount++;

    reconcilableDeals.push({
      legacyId: raw.id,
      mappedId: row.id,
      name: row.name,
      status: row.status,
      sourcePaise,
      mappedPaise: row.valuePaise,
    });

    if (existingDealIds.has(raw.id) || existingDealIds.has(row.id)) {
      entities.deals.toSkip++;
      entities.deals.conflicts.push({
        legacyId: raw.id,
        mappedId: row.id,
        reason: "Deal already exists in target database.",
        resolution: "skip",
      });
    } else {
      entities.deals.toCreate++;
      mapped.deals.push({
        ...row,
        clientType: row.leadId ? "crm" : "other",
        status: normalizeDealStorageStatus(row.status),
        legacyId: raw.id,
      });
    }

    // Embedded deal milestones
    const embeddedMilestones = asArray<Record<string, unknown>>(raw.milestones);
    for (const ms of embeddedMilestones) {
      entities.dealMilestones.sourceCount++;
      const msId = String(ms["id"] ?? `${raw.id}_ms_${entities.dealMilestones.sourceCount}`);
      const msParsed =
        typeof ms["amountPaise"] === "number" &&
        Number.isSafeInteger(ms["amountPaise"]) &&
        ms["amountPaise"] >= 0
          ? { ok: true as const, paise: ms["amountPaise"] as number }
          : parseLegacyRupeesToPaise(ms["amount"], {
              allowZero: true,
              entityContext: `milestone '${msId}'`,
            });
      if (!msParsed.ok) {
        entities.dealMilestones.errorCount++;
        const msg = `Deal milestone '${msId}' has invalid amount: ${msParsed.error}`;
        errors.push(msg);
        financialErrors.push(msg);
        continue;
      }
      entities.dealMilestones.validCount++;
      entities.dealMilestones.toCreate++;
      reconcilableMilestones.push({ legacyDealId: raw.id, amountPaise: msParsed.paise });
      mapped.dealMilestones.push({
        id: mapper.mapId(msId, "dms"),
        legacyId: msId,
        ownerUserId,
        dealId: row.id,
        title: String(ms["title"] ?? ms["name"] ?? "Milestone"),
        amountPaise: msParsed.paise,
        amount: (msParsed.paise / 100).toFixed(2),
        dueIstDate: mapper.toIstDate(typeof ms["dueDate"] === "string" ? ms["dueDate"] : null),
      });
    }
  }

  const hasDeal = (dealId?: string) =>
    Boolean(dealId && (legacyDealIds.has(dealId) || existingDealIds.has(dealId)));

  // 8. Payments & Finance Events
  const rawPayments = asArray<LegacyPaymentRecord>(collections["payments"]);
  entities.payments.sourceCount = rawPayments.length;
  const reconcilablePayments: ReconcilablePayment[] = [];

  for (const raw of rawPayments) {
    if (!raw?.id || !raw?.dealId) {
      entities.payments.errorCount++;
      errors.push("Payment record missing required 'id' or 'dealId'.");
      continue;
    }
    if (!hasDeal(raw.dealId)) {
      unresolvedForeignKeys.push({
        entity: "payments",
        recordId: raw.id,
        foreignField: "dealId",
        missingTargetId: raw.dealId,
        severity: "error",
      });
      entities.payments.errorCount++;
      continue;
    }

    let sourcePaise: number;
    if (
      typeof raw.amountPaise === "number" &&
      Number.isSafeInteger(raw.amountPaise) &&
      raw.amountPaise >= 0
    ) {
      sourcePaise = raw.amountPaise;
    } else {
      const parsed = parseLegacyRupeesToPaise(raw.amount, {
        allowZero: false,
        entityContext: `payment '${raw.id}'`,
      });
      if (!parsed.ok) {
        entities.payments.errorCount++;
        const msg = `Payment '${raw.id}' has invalid monetary amount: ${parsed.error}`;
        errors.push(msg);
        financialErrors.push(msg);
        continue;
      }
      sourcePaise = parsed.paise;
    }

    const row = mapper.mapPayment(raw);
    legacyPaymentToDeal.set(raw.id, raw.dealId);
    mappedPaymentIds.add(row.id);
    entities.payments.validCount++;

    reconcilablePayments.push({
      legacyId: raw.id,
      legacyDealId: raw.dealId,
      sourcePaise,
      mappedPaise: row.amountPaise,
      voided: row.voided,
      voidReason: row.voidReason,
    });

    if (existingPaymentIds.has(raw.id) || existingPaymentIds.has(row.id)) {
      entities.payments.toSkip++;
      entities.payments.conflicts.push({
        legacyId: raw.id,
        mappedId: row.id,
        reason: "Payment already exists in target database.",
        resolution: "skip",
      });
    } else {
      entities.payments.toCreate++;
      mapped.payments.push({
        ...row,
        method: normalizePaymentMethod(row.method),
        paymentType: normalizePaymentType(row.paymentType),
        legacyId: raw.id,
      });
      // Synthesize immutable finance audit event for every migrated payment
      entities.financeEvents.sourceCount++;
      entities.financeEvents.validCount++;
      entities.financeEvents.toCreate++;
      mapped.financeEvents.push({
        id: mapper.mapId(`${raw.id}_evt`, "fevt"),
        ownerUserId,
        dealId: row.dealId,
        paymentId: row.id,
        eventType: row.voided ? "payment_voided_migrated" : "payment_recorded_migrated",
        amountPaise: row.amountPaise,
        occurredAt: row.createdAt,
      });
    }
  }

  // 9. Payment Proofs & Hostinger Binary Verification
  const rawProofs = asArray<LegacyPaymentProofRecord>(collections["attachments"]);
  entities.paymentProofs.sourceCount = rawProofs.length;
  const proofChecks: ProofMigrationCheck[] = [];
  const verifiedProofSizes: number[] = [];

  for (const raw of rawProofs) {
    const attId = raw.attachmentId || "";
    const paymentId = raw.paymentId || "";
    const fileName = raw.originalFileName || "proof.bin";
    const resolvedDealId = raw.dealId || legacyPaymentToDeal.get(paymentId);

    if (!attId || !paymentId || !resolvedDealId) {
      unresolvedForeignKeys.push({
        entity: "paymentProofs",
        recordId: attId || "(missing-id)",
        foreignField: "paymentId",
        missingTargetId: paymentId || "(none)",
        severity: "error",
      });
      entities.paymentProofs.errorCount++;
      continue;
    }

    const binPath = raw.path ?? `files/payment-proofs/${attId}__${fileName}`;
    const bytes = extracted.binaryFiles.get(binPath);

    if (extracted.format === "data-vault-zip") {
      if (!bytes) {
        entities.paymentProofs.errorCount++;
        const msg = `Payment proof '${attId}' binary missing from archive at '${binPath}'.`;
        errors.push(msg);
        proofChecks.push({
          attachmentId: attId,
          paymentId,
          fileName,
          mimeType: raw.mimeType || "application/octet-stream",
          fileSize: raw.fileSize,
          sha256Expected: raw.sha256 ?? null,
          sha256Actual: null,
          magicBytesValid: false,
          withinSizeLimit: raw.fileSize <= MAX_PROOF_BINARY_BYTES,
          status: "missing_binary",
          error: msg,
        });
        continue;
      }

      const actualSha = computeSha256(bytes);
      const withinSizeLimit = bytes.byteLength > 0 && bytes.byteLength <= MAX_PROOF_BINARY_BYTES;
      const sniffed = sniffProofMagicBytes(bytes);

      if (!withinSizeLimit) {
        entities.paymentProofs.errorCount++;
        const msg = `Payment proof '${attId}' exceeds 10 MiB Hostinger upload limit (${bytes.byteLength} bytes).`;
        errors.push(msg);
        proofChecks.push({
          attachmentId: attId,
          paymentId,
          fileName,
          mimeType: raw.mimeType || "application/octet-stream",
          fileSize: bytes.byteLength,
          sha256Expected: raw.sha256 ?? null,
          sha256Actual: actualSha,
          magicBytesValid: sniffed.valid,
          withinSizeLimit: false,
          status: "oversized",
          error: msg,
        });
        continue;
      }

      if (!sniffed.valid) {
        entities.paymentProofs.errorCount++;
        const msg = `Payment proof '${attId}' failed magic-byte validation (only JPEG, PNG, WebP, PDF allowed).`;
        errors.push(msg);
        proofChecks.push({
          attachmentId: attId,
          paymentId,
          fileName,
          mimeType: raw.mimeType || "application/octet-stream",
          fileSize: bytes.byteLength,
          sha256Expected: raw.sha256 ?? null,
          sha256Actual: actualSha,
          magicBytesValid: false,
          withinSizeLimit: true,
          status: "invalid_type",
          error: msg,
        });
        continue;
      }

      if (raw.sha256 && raw.sha256 !== actualSha) {
        entities.paymentProofs.errorCount++;
        const msg = `Payment proof '${attId}' SHA-256 mismatch (expected ${raw.sha256.slice(0, 12)}..., actual ${actualSha.slice(0, 12)}...).`;
        errors.push(msg);
        proofChecks.push({
          attachmentId: attId,
          paymentId,
          fileName,
          mimeType: sniffed.detectedMime ?? raw.mimeType ?? "application/octet-stream",
          fileSize: bytes.byteLength,
          sha256Expected: raw.sha256,
          sha256Actual: actualSha,
          magicBytesValid: true,
          withinSizeLimit: true,
          status: "hash_mismatch",
          error: msg,
        });
        continue;
      }

      verifiedProofSizes.push(bytes.byteLength);
      proofChecks.push({
        attachmentId: attId,
        paymentId,
        fileName,
        mimeType: sniffed.detectedMime ?? raw.mimeType ?? "application/octet-stream",
        fileSize: bytes.byteLength,
        sha256Expected: raw.sha256 ?? actualSha,
        sha256Actual: actualSha,
        magicBytesValid: true,
        withinSizeLimit: true,
        status: "verified",
      });
    } else {
      verifiedProofSizes.push(raw.fileSize || 0);
      proofChecks.push({
        attachmentId: attId,
        paymentId,
        fileName,
        mimeType: raw.mimeType || "application/octet-stream",
        fileSize: raw.fileSize || 0,
        sha256Expected: raw.sha256 ?? null,
        sha256Actual: null,
        magicBytesValid: true,
        withinSizeLimit: (raw.fileSize || 0) <= MAX_PROOF_BINARY_BYTES,
        status: "missing_binary",
        error:
          "JSON-only snapshot does not embed binary proof files; export a Data Vault ZIP to migrate proof binaries.",
      });
      warnings.push(
        `Proof '${attId}' metadata found in JSON snapshot without binary bytes; use a Data Vault ZIP for full proof migration.`,
      );
    }

    const row = mapper.mapPaymentProof(raw, resolvedDealId);
    const resolvedSha = bytes ? computeSha256(bytes) : raw.sha256 || "";
    const resolvedMime =
      (bytes ? sniffProofMagicBytes(bytes).detectedMime : null) ??
      raw.mimeType ??
      "application/octet-stream";
    const safeStorageKey = `prf_${row.id.replace(/[^A-Za-z0-9._-]/g, "_")}.${row.fileExtension.toLowerCase()}`;
    entities.paymentProofs.validCount++;
    entities.paymentProofs.toCreate++;
    mapped.paymentProofs.push({
      ...row,
      storageKey: safeStorageKey,
      mimeType: resolvedMime,
      sha256Hash: resolvedSha,
      fileSize: bytes ? bytes.byteLength : raw.fileSize,
      storageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
    });
    if (bytes) {
      mapped.proofBinaries.set(safeStorageKey, bytes);
    }
  }

  // 10. Quotation Templates & Quotations
  const rawQuotationTemplates = asArray<Record<string, unknown>>(collections["quotationTemplates"]);
  entities.quotationTemplates.sourceCount = rawQuotationTemplates.length;
  for (const raw of rawQuotationTemplates) {
    const id = String(raw["id"] ?? "");
    if (!id) {
      entities.quotationTemplates.errorCount++;
      continue;
    }
    entities.quotationTemplates.validCount++;
    entities.quotationTemplates.toCreate++;
    mapped.quotationTemplates.push({
      id: mapper.mapId(id, "qtpl"),
      legacyId: id,
      ownerUserId,
      name: String(raw["name"] ?? raw["title"] ?? "Template"),
      active: raw["active"] !== false,
    });
  }

  const rawQuotations = [
    ...asArray<LegacyQuotationRecord>(collections["quotations"]),
    ...asArray<LegacyQuotationRecord>(collections["legacyQuotations"]),
  ];
  entities.quotations.sourceCount = rawQuotations.length;
  let quotationsTotalPaise = 0;

  for (const raw of rawQuotations) {
    if (!raw?.id) {
      entities.quotations.errorCount++;
      continue;
    }
    try {
      const row = mapper.mapQuotation(raw);
      const qPaise =
        typeof raw.totalAmountPaise === "number" && Number.isSafeInteger(raw.totalAmountPaise)
          ? raw.totalAmountPaise
          : parseLegacyRupeesToPaise(raw.total, { allowZero: true }).ok
            ? (
                parseLegacyRupeesToPaise(raw.total, { allowZero: true }) as {
                  ok: true;
                  paise: number;
                }
              ).paise
            : 0;
      quotationsTotalPaise += qPaise;
      entities.quotations.validCount++;
      if (existingQuotationIds.has(raw.id) || existingQuotationIds.has(row.id)) {
        entities.quotations.toSkip++;
      } else {
        entities.quotations.toCreate++;
        mapped.quotations.push(row);
      }
    } catch (err) {
      entities.quotations.errorCount++;
      const msg = err instanceof Error ? err.message : `Invalid quotation '${raw.id}'`;
      errors.push(msg);
      financialErrors.push(msg);
    }
  }

  // 11. Projects, Project Milestones, Project Tasks, Support Tickets
  const rawProjects = asArray<LegacyProjectRecord>(collections["projects"]);
  entities.projects.sourceCount = rawProjects.length;
  for (const raw of rawProjects) {
    if (!raw?.id || !raw?.name?.trim()) {
      entities.projects.errorCount++;
      errors.push("Project record missing required 'id' or 'name'.");
      continue;
    }
    if (raw.leadId && !hasLead(raw.leadId)) {
      unresolvedForeignKeys.push({
        entity: "projects",
        recordId: raw.id,
        foreignField: "leadId",
        missingTargetId: raw.leadId,
        severity: "warning",
      });
    }
    if (raw.dealId && !hasDeal(raw.dealId)) {
      unresolvedForeignKeys.push({
        entity: "projects",
        recordId: raw.id,
        foreignField: "dealId",
        missingTargetId: raw.dealId,
        severity: "warning",
      });
    }
    const row = mapper.mapProject(raw);
    legacyProjectIds.add(raw.id);
    mappedProjectIds.add(row.id);
    entities.projects.validCount++;
    if (existingProjectIds.has(raw.id) || existingProjectIds.has(row.id)) {
      entities.projects.toSkip++;
    } else {
      entities.projects.toCreate++;
      mapped.projects.push({
        ...row,
        stage: normalizeProjectStage(row.stage),
        legacyId: raw.id,
      });
    }
  }

  const hasProject = (projectId?: string) =>
    Boolean(projectId && (legacyProjectIds.has(projectId) || existingProjectIds.has(projectId)));

  const rawProjMilestones = asArray<Record<string, unknown>>(collections["projectMilestones"]);
  entities.projectMilestones.sourceCount = rawProjMilestones.length;
  for (const raw of rawProjMilestones) {
    const id = String(raw["id"] ?? "");
    const projectId = String(raw["projectId"] ?? "");
    if (!id || !hasProject(projectId)) {
      if (id && projectId) {
        unresolvedForeignKeys.push({
          entity: "projectMilestones",
          recordId: id,
          foreignField: "projectId",
          missingTargetId: projectId,
          severity: "error",
        });
      }
      entities.projectMilestones.errorCount++;
      continue;
    }
    entities.projectMilestones.validCount++;
    entities.projectMilestones.toCreate++;
    mapped.projectMilestones.push({
      id: mapper.mapId(id, "pms"),
      legacyId: id,
      ownerUserId,
      projectId: mapper.mapId(projectId, "proj"),
      title: String(raw["title"] ?? raw["name"] ?? "Milestone"),
      status: String(raw["status"] ?? "pending"),
    });
  }

  const rawProjTasks = asArray<LegacyProjectTaskRecord>(collections["projectTasks"]);
  entities.projectTasks.sourceCount = rawProjTasks.length;
  for (const raw of rawProjTasks) {
    if (!raw?.id || !hasProject(raw.projectId)) {
      if (raw?.id && raw?.projectId) {
        unresolvedForeignKeys.push({
          entity: "projectTasks",
          recordId: raw.id,
          foreignField: "projectId",
          missingTargetId: raw.projectId,
          severity: "error",
        });
      }
      entities.projectTasks.errorCount++;
      continue;
    }
    const row = mapper.mapProjectTask(raw);
    entities.projectTasks.validCount++;
    entities.projectTasks.toCreate++;
    mapped.projectTasks.push({ ...row, legacyId: raw.id });
  }

  const rawSupport = asArray<Record<string, unknown>>(collections["supportRequests"]);
  entities.supportTickets.sourceCount = rawSupport.length;
  for (const raw of rawSupport) {
    const id = String(raw["id"] ?? "");
    const projectId = String(raw["projectId"] ?? "");
    if (!id || !hasProject(projectId)) {
      if (id && projectId) {
        unresolvedForeignKeys.push({
          entity: "supportTickets",
          recordId: id,
          foreignField: "projectId",
          missingTargetId: projectId,
          severity: "error",
        });
      }
      entities.supportTickets.errorCount++;
      continue;
    }
    entities.supportTickets.validCount++;
    entities.supportTickets.toCreate++;
    mapped.supportTickets.push({
      id: mapper.mapId(id, "sup"),
      legacyId: id,
      ownerUserId,
      projectId: mapper.mapId(projectId, "proj"),
      title: String(raw["title"] ?? raw["summary"] ?? "Support Request"),
      status: String(raw["status"] ?? "open"),
    });
  }

  // 12. Custom Fields, Field Values, Tags, Lead-Tags, Saved Views
  const rawCustomFields = asArray<Record<string, unknown>>(collections["customFields"]);
  entities.customFields.sourceCount = rawCustomFields.length;
  for (const raw of rawCustomFields) {
    const id = String(raw["id"] ?? "");
    if (!id) {
      entities.customFields.errorCount++;
      continue;
    }
    const mappedId = mapper.mapId(id, "cf");
    mappedCustomFieldIds.add(id);
    mappedCustomFieldIds.add(mappedId);
    entities.customFields.validCount++;
    entities.customFields.toCreate++;
    mapped.customFields.push({
      id: mappedId,
      legacyId: id,
      ownerUserId,
      name: String(raw["name"] ?? raw["label"] ?? id),
      fieldType: String(raw["type"] ?? "text"),
    });
  }

  const rawFieldValues = asRecord(collections["fieldValues"]);
  for (const [leadId, fieldMap] of Object.entries(rawFieldValues)) {
    const entries = Object.entries(asRecord(fieldMap));
    for (const [fieldId, val] of entries) {
      entities.leadFieldValues.sourceCount++;
      if (!hasLead(leadId)) {
        unresolvedForeignKeys.push({
          entity: "leadFieldValues",
          recordId: `${leadId}:${fieldId}`,
          foreignField: "leadId",
          missingTargetId: leadId,
          severity: "error",
        });
        entities.leadFieldValues.errorCount++;
        continue;
      }
      entities.leadFieldValues.validCount++;
      entities.leadFieldValues.toCreate++;
      mapped.leadFieldValues.push({
        id: mapper.mapId(`${leadId}_${fieldId}`, "lfv"),
        ownerUserId,
        leadId: mapper.mapId(leadId, "lead"),
        fieldId: mapper.mapId(fieldId, "cf"),
        value: val,
      });
    }
  }

  const rawTags = asArray<Record<string, unknown>>(collections["tagDefs"]);
  entities.tags.sourceCount = rawTags.length;
  for (const raw of rawTags) {
    const id = String(raw["id"] ?? "");
    if (!id) {
      entities.tags.errorCount++;
      continue;
    }
    const mappedId = mapper.mapId(id, "tag");
    mappedTagIds.add(id);
    mappedTagIds.add(mappedId);
    entities.tags.validCount++;
    entities.tags.toCreate++;
    mapped.tags.push({
      id: mappedId,
      legacyId: id,
      ownerUserId,
      name: String(raw["name"] ?? raw["label"] ?? id),
      color: String(raw["color"] ?? "slate"),
    });
  }

  const rawLeadTags = asRecord(collections["leadTags"]);
  for (const [leadId, tagIdsRaw] of Object.entries(rawLeadTags)) {
    const tagIds = asArray<string>(tagIdsRaw);
    for (const tagId of tagIds) {
      entities.leadTags.sourceCount++;
      if (!hasLead(leadId)) {
        unresolvedForeignKeys.push({
          entity: "leadTags",
          recordId: `${leadId}:${tagId}`,
          foreignField: "leadId",
          missingTargetId: leadId,
          severity: "error",
        });
        entities.leadTags.errorCount++;
        continue;
      }
      entities.leadTags.validCount++;
      entities.leadTags.toCreate++;
      mapped.leadTags.push({
        id: mapper.mapId(`${leadId}_${tagId}`, "ltag"),
        ownerUserId,
        leadId: mapper.mapId(leadId, "lead"),
        tagId: mapper.mapId(tagId, "tag"),
      });
    }
  }

  const rawSavedViews = asArray<Record<string, unknown>>(collections["savedViews"]);
  entities.savedViews.sourceCount = rawSavedViews.length;
  for (const raw of rawSavedViews) {
    const id = String(raw["id"] ?? "");
    if (!id) {
      entities.savedViews.errorCount++;
      continue;
    }
    entities.savedViews.validCount++;
    entities.savedViews.toCreate++;
    mapped.savedViews.push({
      id: mapper.mapId(id, "view"),
      legacyId: id,
      ownerUserId,
      name: String(raw["name"] ?? "Saved View"),
      visibility: String(raw["visibility"] ?? "owner"),
    });
  }

  // 13. Smart Inbox & Lead Relationships
  const rawInboxMeta = asRecord(collections["inboxMeta"]);
  for (const [leadId, meta] of Object.entries(rawInboxMeta)) {
    entities.inboxItems.sourceCount++;
    if (!hasLead(leadId)) {
      unresolvedForeignKeys.push({
        entity: "inboxItems",
        recordId: leadId,
        foreignField: "leadId",
        missingTargetId: leadId,
        severity: "warning",
      });
      entities.inboxItems.warningCount++;
      continue;
    }
    const metaObj = asRecord(meta);
    entities.inboxItems.validCount++;
    entities.inboxItems.toCreate++;
    mapped.inboxItems.push({
      id: mapper.mapId(`inbox_${leadId}`, "inb"),
      ownerUserId,
      leadId: mapper.mapId(leadId, "lead"),
      reviewed: Boolean(metaObj["reviewed"]),
      duplicateFlag: Boolean(metaObj["duplicate"]),
    });
  }

  const rawRelations = asArray<Record<string, unknown>>(collections["leadRelations"]);
  entities.leadRelationships.sourceCount = rawRelations.length;
  for (const raw of rawRelations) {
    const id = String(raw["id"] ?? `${raw["a"] ?? ""}_${raw["b"] ?? ""}`);
    const leadA = String(raw["leadAId"] ?? raw["a"] ?? "");
    const leadB = String(raw["leadBId"] ?? raw["b"] ?? "");
    if (!leadA || !leadB || !hasLead(leadA) || !hasLead(leadB)) {
      entities.leadRelationships.warningCount++;
      continue;
    }
    entities.leadRelationships.validCount++;
    entities.leadRelationships.toCreate++;
    mapped.leadRelationships.push({
      id: mapper.mapId(id, "lrel"),
      ownerUserId,
      leadAId: mapper.mapId(leadA, "lead"),
      leadBId: mapper.mapId(leadB, "lead"),
      kind: String(raw["kind"] ?? "related"),
    });
  }

  // 14. Automation Rules (SAFETY: always forced to `paused` status)
  const rawAutomations = asArray<Record<string, unknown>>(collections["automationRules"]);
  entities.automationRules.sourceCount = rawAutomations.length;
  let automationRulesForcedPaused = 0;

  for (const raw of rawAutomations) {
    const id = String(raw["id"] ?? "");
    if (!id) {
      entities.automationRules.errorCount++;
      continue;
    }
    const mappedId = mapper.mapId(id, "auto");
    const originalStatus = String(raw["status"] ?? "paused");
    if (originalStatus !== "paused") {
      automationRulesForcedPaused++;
      entities.automationRules.warningCount++;
      entities.automationRules.conflicts.push({
        legacyId: id,
        mappedId,
        reason: `Automation rule '${id}' was '${originalStatus}' and is forced to 'paused' for safe post-migration review.`,
        resolution: "normalize",
      });
    }
    entities.automationRules.validCount++;
    if (existingAutomationIds.has(id) || existingAutomationIds.has(mappedId)) {
      entities.automationRules.toSkip++;
    } else {
      entities.automationRules.toCreate++;
      mapped.automationRules.push({
        id: mappedId,
        legacyId: id,
        ownerUserId,
        name: String(raw["name"] ?? "Automation Rule"),
        triggerType: String(raw["trigger"] ?? raw["triggerType"] ?? "manual"),
        status: "paused",
      });
    }
  }

  // 15. Owner Settings
  const rawSettings = collections["settings"]
    ? asRecord(collections["settings"])
    : collections["businessProfile"] || collections["owner"]
      ? {
          ownerDisplayName: collections["owner"],
          businessName: collections["business"],
          profileEmail: collections["email"],
          defaultLeadSort: collections["defaultLeadSort"],
          ...asRecord(collections["businessProfile"]),
        }
      : null;

  if (rawSettings && Object.keys(rawSettings).length > 0) {
    entities.ownerSettings.sourceCount = 1;
    const mappedSettings = mapper.mapOwnerSettings(rawSettings as LegacyOwnerSettingsRecord);
    entities.ownerSettings.validCount = 1;
    entities.ownerSettings.toCreate = 1;
    mapped.ownerSettings.push(mappedSettings);
  }

  // 16. Sales Goals
  const rawGoals = asArray<LegacySalesGoalRecord>(collections["goals"]);
  entities.salesGoals.sourceCount = rawGoals.length;
  let monetaryGoalsTotalPaise = 0;
  for (const raw of rawGoals) {
    if (!raw?.id || !raw?.metric) {
      entities.salesGoals.errorCount++;
      continue;
    }
    try {
      const row = mapper.mapSalesGoal(raw);
      if (row.targetUnit === "currency" && typeof row.targetPaise === "number") {
        monetaryGoalsTotalPaise += row.targetPaise;
      }
      entities.salesGoals.validCount++;
      if (existingGoalIds.has(raw.id) || existingGoalIds.has(row.id)) {
        entities.salesGoals.toSkip++;
      } else {
        entities.salesGoals.toCreate++;
        mapped.salesGoals.push(row);
      }
    } catch (err) {
      entities.salesGoals.errorCount++;
      const msg = err instanceof Error ? err.message : `Invalid sales goal '${raw.id}'`;
      errors.push(msg);
      financialErrors.push(msg);
    }
  }

  // 17. Deferred browser-local collections (explicitly reported, never silently dropped)
  const deferredDefinitions: Array<{
    key: string;
    label: string;
    disposition: DeferredCollectionReport["disposition"];
    destinationMapping: string;
    archivePath: string;
    reason: string;
  }> = [
    {
      key: "notes",
      label: "Personal Notes",
      disposition: "preserve_legacy_archive",
      destinationMapping:
        "Preserved in Data Vault ZIP (data/personal-notes.json) with SHA-256 manifest; lead-level notes are migrated via crm_leads.notes and crm_lead_activities.",
      archivePath: "data/personal-notes.json",
      reason:
        "No dedicated crm_personal_notes table in MariaDB yet; preserved intact for future restoration.",
    },
    {
      key: "demos",
      label: "Demo Library",
      disposition: "preserve_legacy_archive",
      destinationMapping:
        "Preserved in Data Vault ZIP (data/demo-library.json) with SHA-256 manifest.",
      archivePath: "data/demo-library.json",
      reason:
        "No dedicated crm_demos table in MariaDB yet; preserved intact for future restoration.",
    },
    {
      key: "employees",
      label: "Employee Profiles",
      disposition: "defer_unsupported_feature",
      destinationMapping:
        "Preserved (credential-scrubbed) in Data Vault ZIP (data/employees.json); crm_users is Owner-only in current launch.",
      archivePath: "data/employees.json",
      reason:
        "Multi-user Team/Employee accounts are intentionally deferred in the Owner-only launch phase.",
    },
    {
      key: "teamEvents",
      label: "Team Activity Events",
      disposition: "defer_unsupported_feature",
      destinationMapping:
        "Preserved in Data Vault ZIP (data/team-activity.json); single-owner audit logs live in crm_lead_activities, crm_finance_events, and module audit tables.",
      archivePath: "data/team-activity.json",
      reason:
        "Multi-user team activity stream is intentionally deferred until employee auth rollout.",
    },
    {
      key: "savedReports",
      label: "Analytics Saved Reports",
      disposition: "preserve_legacy_archive",
      destinationMapping:
        "Preserved in Data Vault ZIP (data/analytics-settings.json); live analytics recompute directly from MariaDB records.",
      archivePath: "data/analytics-settings.json",
      reason:
        "No crm_saved_reports table yet; definitions preserved intact while live analytics compute from MariaDB.",
    },
  ];

  const deferredCollections: DeferredCollectionReport[] = [];
  for (const def of deferredDefinitions) {
    const items = asArray(collections[def.key]);
    if (items.length > 0) {
      deferredCollections.push({
        collection: def.key,
        label: def.label,
        sourceCount: items.length,
        status: "deferred_not_dropped",
        disposition: def.disposition,
        destinationMapping: def.destinationMapping,
        archivePath: def.archivePath,
        reason: def.reason,
      });
    }
  }

  // Financial Reconciliation
  const financialReconciliation = buildFinancialReconciliationReport({
    deals: reconcilableDeals,
    milestones: reconcilableMilestones,
    payments: reconcilablePayments,
    quotationsTotalPaise,
    monetaryGoalsTotalPaise,
    existingErrors: financialErrors,
  });

  // Totals
  let totalSourceRecords = 0;
  let totalValidRecords = 0;
  let totalToCreate = 0;
  let totalToSkip = 0;
  for (const summary of Object.values(entities)) {
    totalSourceRecords += summary.sourceCount;
    totalValidRecords += summary.validCount;
    totalToCreate += summary.toCreate;
    totalToSkip += summary.toSkip;
  }

  // Hostinger MariaDB Capacity Estimate (Cloudflare R2 NOT required)
  const hostingerCapacity = estimateHostingerMigrationCapacity({
    totalSqlRecords: totalToCreate,
    proofSizesBytes: verifiedProofSizes,
    ...(existingContext.baselineUsedMiB !== undefined
      ? { baselineUsedMiB: existingContext.baselineUsedMiB }
      : {}),
  });

  if (!hostingerCapacity.fitsWithinHostingerBudget) {
    errors.push(
      `Estimated migration footprint (${hostingerCapacity.projectedUsedMiB} MiB) exceeds Hostinger MariaDB 70% hard stop (${hostingerCapacity.hardStopThresholdMiB} MiB).`,
    );
  } else if (hostingerCapacity.status === "warning") {
    warnings.push(
      `Estimated migration footprint (${hostingerCapacity.projectedUsedMiB} MiB) exceeds Hostinger MariaDB 50% warning threshold (${hostingerCapacity.warningThresholdMiB} MiB).`,
    );
  }

  const blockingFkErrors = unresolvedForeignKeys.filter((fk) => fk.severity === "error");
  if (blockingFkErrors.length > 0) {
    errors.push(
      `${blockingFkErrors.length} unresolved foreign key reference(s) detected across migrated entities.`,
    );
  }

  const verifiedProofsCount = proofChecks.filter((c) => c.status === "verified").length;
  const missingBinariesCount = proofChecks.filter((c) => c.status === "missing_binary").length;
  const failedProofsCount = proofChecks.filter(
    (c) => c.status !== "verified" && c.status !== "missing_binary",
  ).length;

  const ok =
    errors.length === 0 &&
    financialReconciliation.financialParityPassed &&
    hostingerCapacity.fitsWithinHostingerBudget &&
    blockingFkErrors.length === 0;

  const report: MigrationAnalysisReport = {
    ok,
    wizardVersion: MIGRATION_WIZARD_VERSION,
    analyzedAt: new Date().toISOString(),
    sourceFormat: extracted.format,
    sourceFilename,
    dryRun: true,
    databaseWritten: false,
    browserStorageModified: false,
    hostingPolicy: {
      provider: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      productionMigrationLocked: true,
    },
    entities,
    totalSourceRecords,
    totalValidRecords,
    totalToCreate,
    totalToSkip,
    deferredCollections,
    unresolvedForeignKeys,
    financialReconciliation,
    hostingerCapacity,
    proofVerification: {
      expected: rawProofs.length,
      verified: verifiedProofsCount,
      failed: failedProofsCount,
      missingBinaries: missingBinariesCount,
      checks: proofChecks,
    },
    safetyChecks: {
      credentialsScrubbed: true,
      scrubbedFieldCount: scrubbedCount,
      automationRulesForcedPaused,
      followUpActiveLocksResolved,
      crmV1Untouched: true,
    },
    errors,
    warnings: [...warnings, ...financialReconciliation.warnings],
    readyForShadowStaging: ok,
  };

  return { report, mapped };
}
