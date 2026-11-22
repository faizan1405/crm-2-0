import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { computeSha256 } from "../backup/manifest.server";
import {
  crmAutomationRules,
  crmCallLogs,
  crmClientSupportTickets,
  crmCustomFields,
  crmDealMilestones,
  crmDeals,
  crmFinanceEvents,
  crmFollowUps,
  crmLeadActivities,
  crmLeadFieldValues,
  crmLeadInboxItems,
  crmLeadRelationships,
  crmLeadTags,
  crmLeads,
  crmOwnerSettings,
  crmPaymentProofBlobs,
  crmPaymentProofs,
  crmPayments,
  crmProjectMilestones,
  crmProjectTasks,
  crmProjects,
  crmQuotationTemplates,
  crmQuotations,
  crmSalesGoals,
  crmSavedViews,
  crmTagDefs,
  crmWhatsAppLogs,
} from "../db/schema.server";
import { assertSafeShadowTarget } from "./guards.server";
import { analyzeMigrationSource, type MappedMigrationPayload } from "./migrationEngine.server";
import { HOSTINGER_EXCLUSIVE_STORAGE_DRIVER } from "./types.server";

const BLOB_CHUNK_BYTES = 256 * 1024;

export interface MariaDbSyntheticImportOptions {
  db: MySql2Database<Record<string, unknown>>;
  databaseName: string;
  hostName?: string;
  ownerUserId: string;
  source: Uint8Array | string | Record<string, unknown>;
  sourceFilename?: string;
  syntheticOnly: boolean;
  confirmDisposableTarget: boolean;
  injectFailureAfterTable?: string;
}

export interface ProofBlobReadbackCheck {
  storageKey: string;
  expectedSha256: string;
  actualSha256: string;
  byteLength: number;
  chunkCount: number;
  matched: boolean;
}

export interface MariaDbSyntheticImportResult {
  ok: boolean;
  databaseName: string;
  hostingPolicy: "hostinger_exclusive";
  cloudflareR2Required: false;
  proofStorageDriver: typeof HOSTINGER_EXCLUSIVE_STORAGE_DRIVER;
  transactionCommitted: boolean;
  rolledBack: boolean;
  insertedCounts: Record<string, number>;
  skippedCounts: Record<string, number>;
  totalInserted: number;
  totalSkipped: number;
  proofBlobsInserted: number;
  proofReadbackChecks: ProofBlobReadbackCheck[];
  allProofSha256Matched: boolean;
  financialParityPassed: boolean;
  dealsDeltaPaise: number;
  activePaymentsDeltaPaise: number;
  voidedPaymentsDeltaPaise: number;
  durationMs: number;
  error?: string;
}

/**
 * Splits binary proof bytes into <= 256 KiB chunks for `crm_payment_proof_blobs`.
 */
export function chunkProofBinaryForMariaDb(params: {
  ownerUserId: string;
  storageKey: string;
  mimeType: string;
  bytes: Uint8Array;
  createdAt: string;
}): Array<{
  id: string;
  ownerUserId: string;
  storageKey: string;
  chunkIndex: number;
  chunkCount: number;
  chunkSize: number;
  totalByteSize: number;
  totalSha256: string;
  mimeType: string;
  blobData: Buffer;
  createdAt: string;
}> {
  const totalSha256 = computeSha256(params.bytes);
  const chunkCount = Math.max(1, Math.ceil(params.bytes.byteLength / BLOB_CHUNK_BYTES));
  const rows = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * BLOB_CHUNK_BYTES;
    const end = Math.min(start + BLOB_CHUNK_BYTES, params.bytes.byteLength);
    const slice = params.bytes.subarray(start, end);
    const keyHash = computeSha256(new TextEncoder().encode(`${params.storageKey}#${i}`)).slice(
      0,
      20,
    );
    rows.push({
      id: `pblob_${keyHash}_${i}`,
      ownerUserId: params.ownerUserId,
      storageKey: params.storageKey,
      chunkIndex: i,
      chunkCount,
      chunkSize: slice.byteLength,
      totalByteSize: params.bytes.byteLength,
      totalSha256,
      mimeType: params.mimeType,
      blobData: Buffer.from(slice),
      createdAt: params.createdAt,
    });
  }
  return rows;
}

/**
 * Executes a real, transactional Drizzle MariaDB import against an explicitly approved
 * disposable staging/shadow database using synthetic data ONLY.
 *
 * Fail-closed guarantees:
 * - Refuses any CRM V1, production, live, or unmarked database name.
 * - Refuses execution unless both `syntheticOnly: true` and `confirmDisposableTarget: true`.
 * - Aborts before any SQL writes if pre-flight validation or 0-paise parity fails.
 * - Enforces idempotent skip on existing PKs (Pass 2 inserts 0 duplicates).
 * - Rolls back atomically on mid-transaction failure (0 orphan records).
 */
export async function executeMariaDbSyntheticImport(
  options: MariaDbSyntheticImportOptions,
): Promise<MariaDbSyntheticImportResult> {
  const startedAt = Date.now();

  if (!options.syntheticOnly) {
    return {
      ok: false,
      databaseName: options.databaseName,
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      transactionCommitted: false,
      rolledBack: false,
      insertedCounts: {},
      skippedCounts: {},
      totalInserted: 0,
      totalSkipped: 0,
      proofBlobsInserted: 0,
      proofReadbackChecks: [],
      allProofSha256Matched: false,
      financialParityPassed: false,
      dealsDeltaPaise: 0,
      activePaymentsDeltaPaise: 0,
      voidedPaymentsDeltaPaise: 0,
      durationMs: Date.now() - startedAt,
      error: "Real customer data import is blocked in B13B; syntheticOnly must be true.",
    };
  }

  if (!options.confirmDisposableTarget) {
    return {
      ok: false,
      databaseName: options.databaseName,
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      transactionCommitted: false,
      rolledBack: false,
      insertedCounts: {},
      skippedCounts: {},
      totalInserted: 0,
      totalSkipped: 0,
      proofBlobsInserted: 0,
      proofReadbackChecks: [],
      allProofSha256Matched: false,
      financialParityPassed: false,
      dealsDeltaPaise: 0,
      activePaymentsDeltaPaise: 0,
      voidedPaymentsDeltaPaise: 0,
      durationMs: Date.now() - startedAt,
      error: "Explicit confirmDisposableTarget=true is required before writing to MariaDB.",
    };
  }

  const guard = assertSafeShadowTarget({
    databaseName: options.databaseName,
    hostName: options.hostName ?? null,
  });
  if (!guard.allowed) {
    return {
      ok: false,
      databaseName: options.databaseName,
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      transactionCommitted: false,
      rolledBack: false,
      insertedCounts: {},
      skippedCounts: {},
      totalInserted: 0,
      totalSkipped: 0,
      proofBlobsInserted: 0,
      proofReadbackChecks: [],
      allProofSha256Matched: false,
      financialParityPassed: false,
      dealsDeltaPaise: 0,
      activePaymentsDeltaPaise: 0,
      voidedPaymentsDeltaPaise: 0,
      durationMs: Date.now() - startedAt,
      error: guard.reason ?? "Unsafe target database rejected.",
    };
  }

  // Pre-flight validation & exact paise financial reconciliation
  const { report, mapped } = analyzeMigrationSource({
    source: options.source,
    sourceFilename: options.sourceFilename ?? "synthetic-b13b.zip",
    ownerUserId: options.ownerUserId,
  });

  if (!report.ok || !report.financialReconciliation.financialParityPassed) {
    return {
      ok: false,
      databaseName: options.databaseName,
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      transactionCommitted: false,
      rolledBack: false,
      insertedCounts: {},
      skippedCounts: {},
      totalInserted: 0,
      totalSkipped: 0,
      proofBlobsInserted: 0,
      proofReadbackChecks: [],
      allProofSha256Matched: false,
      financialParityPassed: false,
      dealsDeltaPaise: report.financialReconciliation.dealsDeltaPaise,
      activePaymentsDeltaPaise: report.financialReconciliation.activePaymentsDeltaPaise,
      voidedPaymentsDeltaPaise: report.financialReconciliation.voidedPaymentsDeltaPaise,
      durationMs: Date.now() - startedAt,
      error: `Pre-import validation failed: ${report.errors.join("; ")}`,
    };
  }

  const insertedCounts: Record<string, number> = {};
  const skippedCounts: Record<string, number> = {};
  let proofBlobsInserted = 0;

  // Ordered FK-safe table insert plan matching src/server/db/schema.server.ts
  const tablePlans = buildOrderedTablePlans(mapped);

  try {
    await options.db.transaction(async (tx) => {
      for (const plan of tablePlans) {
        let ins = 0;
        let skp = 0;

        for (const row of plan.rows) {
          const [existing] = await tx
            .select({ id: plan.idCol })
            .from(plan.table)
            .where(sql`${plan.idCol} = ${row.id}`);
          if (existing) {
            skp++;
            continue;
          }
          await tx.insert(plan.table).values(row as never);
          ins++;
        }

        insertedCounts[plan.name] = ins;
        skippedCounts[plan.name] = skp;

        // Also persist chunked payment proof BLOBs right after crm_payment_proofs
        if (plan.name === "crm_payment_proofs") {
          for (const proof of mapped.paymentProofs) {
            const bytes = mapped.proofBinaries.get(proof.storageKey);
            if (!bytes) continue;
            const chunks = chunkProofBinaryForMariaDb({
              ownerUserId: options.ownerUserId,
              storageKey: proof.storageKey,
              mimeType: proof.mimeType,
              bytes,
              createdAt: String(proof["createdAt"] ?? new Date().toISOString()),
            });
            for (const chunk of chunks) {
              const [existingChunk] = await tx
                .select({ id: crmPaymentProofBlobs.id })
                .from(crmPaymentProofBlobs)
                .where(sql`${crmPaymentProofBlobs.id} = ${chunk.id}`);
              if (existingChunk) {
                skippedCounts["crm_payment_proof_blobs"] =
                  (skippedCounts["crm_payment_proof_blobs"] ?? 0) + 1;
                continue;
              }
              await tx.insert(crmPaymentProofBlobs).values(chunk as never);
              proofBlobsInserted++;
              insertedCounts["crm_payment_proof_blobs"] =
                (insertedCounts["crm_payment_proof_blobs"] ?? 0) + 1;
            }
          }
        }

        if (options.injectFailureAfterTable === plan.name) {
          throw new Error(`Injected mid-transaction interruption after '${plan.name}'`);
        }
      }
    });
  } catch (err) {
    return {
      ok: false,
      databaseName: options.databaseName,
      hostingPolicy: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
      transactionCommitted: false,
      rolledBack: true,
      insertedCounts: {},
      skippedCounts: {},
      totalInserted: 0,
      totalSkipped: 0,
      proofBlobsInserted: 0,
      proofReadbackChecks: [],
      allProofSha256Matched: false,
      financialParityPassed: report.financialReconciliation.financialParityPassed,
      dealsDeltaPaise: report.financialReconciliation.dealsDeltaPaise,
      activePaymentsDeltaPaise: report.financialReconciliation.activePaymentsDeltaPaise,
      voidedPaymentsDeltaPaise: report.financialReconciliation.voidedPaymentsDeltaPaise,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Post-commit payment proof BLOB read-back & SHA-256 verification
  const proofReadbackChecks: ProofBlobReadbackCheck[] = [];
  for (const proof of mapped.paymentProofs) {
    const chunkRows = (await options.db
      .select({
        chunkIndex: crmPaymentProofBlobs.chunkIndex,
        blobData: crmPaymentProofBlobs.blobData,
      })
      .from(crmPaymentProofBlobs)
      .where(eq(crmPaymentProofBlobs.storageKey, proof.storageKey))) as Array<{
      chunkIndex: number;
      blobData: Buffer | Uint8Array;
    }>;

    const sorted = [...chunkRows].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const combined = Buffer.concat(sorted.map((r) => Buffer.from(r.blobData)));
    const actualSha256 = computeSha256(new Uint8Array(combined));
    proofReadbackChecks.push({
      storageKey: proof.storageKey,
      expectedSha256: proof.sha256Hash,
      actualSha256,
      byteLength: combined.byteLength,
      chunkCount: sorted.length,
      matched: actualSha256 === proof.sha256Hash && combined.byteLength === proof.fileSize,
    });
  }

  const allProofSha256Matched = proofReadbackChecks.every((c) => c.matched);
  const totalInserted = Object.values(insertedCounts).reduce((a, b) => a + b, 0);
  const totalSkipped = Object.values(skippedCounts).reduce((a, b) => a + b, 0);

  return {
    ok: allProofSha256Matched && report.financialReconciliation.financialParityPassed,
    databaseName: options.databaseName,
    hostingPolicy: "hostinger_exclusive",
    cloudflareR2Required: false,
    proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
    transactionCommitted: true,
    rolledBack: false,
    insertedCounts,
    skippedCounts,
    totalInserted,
    totalSkipped,
    proofBlobsInserted,
    proofReadbackChecks,
    allProofSha256Matched,
    financialParityPassed: report.financialReconciliation.financialParityPassed,
    dealsDeltaPaise: report.financialReconciliation.dealsDeltaPaise,
    activePaymentsDeltaPaise: report.financialReconciliation.activePaymentsDeltaPaise,
    voidedPaymentsDeltaPaise: report.financialReconciliation.voidedPaymentsDeltaPaise,
    durationMs: Date.now() - startedAt,
  };
}

function buildOrderedTablePlans(mapped: MappedMigrationPayload): Array<{
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idCol: any;
  rows: Array<Record<string, unknown> & { id: string }>;
}> {
  return [
    {
      name: "crm_leads",
      table: crmLeads,
      idCol: crmLeads.id,
      rows: [...mapped.leads, ...mapped.archivedLeads],
    },
    {
      name: "crm_lead_activities",
      table: crmLeadActivities,
      idCol: crmLeadActivities.id,
      rows: mapped.activities,
    },
    { name: "crm_follow_ups", table: crmFollowUps, idCol: crmFollowUps.id, rows: mapped.followUps },
    { name: "crm_call_logs", table: crmCallLogs, idCol: crmCallLogs.id, rows: mapped.callLogs },
    {
      name: "crm_whats_app_logs",
      table: crmWhatsAppLogs,
      idCol: crmWhatsAppLogs.id,
      rows: mapped.whatsAppLogs,
    },
    { name: "crm_deals", table: crmDeals, idCol: crmDeals.id, rows: mapped.deals },
    {
      name: "crm_deal_milestones",
      table: crmDealMilestones,
      idCol: crmDealMilestones.id,
      rows: mapped.dealMilestones,
    },
    { name: "crm_payments", table: crmPayments, idCol: crmPayments.id, rows: mapped.payments },
    {
      name: "crm_finance_events",
      table: crmFinanceEvents,
      idCol: crmFinanceEvents.id,
      rows: mapped.financeEvents,
    },
    {
      name: "crm_payment_proofs",
      table: crmPaymentProofs,
      idCol: crmPaymentProofs.id,
      rows: mapped.paymentProofs,
    },
    {
      name: "crm_quotation_templates",
      table: crmQuotationTemplates,
      idCol: crmQuotationTemplates.id,
      rows: mapped.quotationTemplates,
    },
    {
      name: "crm_quotations",
      table: crmQuotations,
      idCol: crmQuotations.id,
      rows: mapped.quotations,
    },
    { name: "crm_projects", table: crmProjects, idCol: crmProjects.id, rows: mapped.projects },
    {
      name: "crm_project_milestones",
      table: crmProjectMilestones,
      idCol: crmProjectMilestones.id,
      rows: mapped.projectMilestones,
    },
    {
      name: "crm_project_tasks",
      table: crmProjectTasks,
      idCol: crmProjectTasks.id,
      rows: mapped.projectTasks,
    },
    {
      name: "crm_client_support_tickets",
      table: crmClientSupportTickets,
      idCol: crmClientSupportTickets.id,
      rows: mapped.supportTickets,
    },
    {
      name: "crm_custom_fields",
      table: crmCustomFields,
      idCol: crmCustomFields.id,
      rows: mapped.customFields,
    },
    {
      name: "crm_lead_field_values",
      table: crmLeadFieldValues,
      idCol: crmLeadFieldValues.id,
      rows: mapped.leadFieldValues,
    },
    { name: "crm_tag_defs", table: crmTagDefs, idCol: crmTagDefs.id, rows: mapped.tags },
    { name: "crm_lead_tags", table: crmLeadTags, idCol: crmLeadTags.id, rows: mapped.leadTags },
    {
      name: "crm_saved_views",
      table: crmSavedViews,
      idCol: crmSavedViews.id,
      rows: mapped.savedViews,
    },
    {
      name: "crm_lead_inbox_items",
      table: crmLeadInboxItems,
      idCol: crmLeadInboxItems.id,
      rows: mapped.inboxItems,
    },
    {
      name: "crm_lead_relationships",
      table: crmLeadRelationships,
      idCol: crmLeadRelationships.id,
      rows: mapped.leadRelationships,
    },
    {
      name: "crm_automation_rules",
      table: crmAutomationRules,
      idCol: crmAutomationRules.id,
      rows: mapped.automationRules,
    },
    {
      name: "crm_owner_settings",
      table: crmOwnerSettings,
      idCol: crmOwnerSettings.id,
      rows: mapped.ownerSettings,
    },
    {
      name: "crm_sales_goals",
      table: crmSalesGoals,
      idCol: crmSalesGoals.id,
      rows: mapped.salesGoals,
    },
  ];
}
