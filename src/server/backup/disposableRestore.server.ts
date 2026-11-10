import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { executeRestoreDryRun } from "./dryRun.server";
import {
  MigrationMapper,
  type LegacyDealRecord,
  type LegacyLeadRecord,
  type LegacyOwnerSettingsRecord,
  type LegacyPaymentProofRecord,
  type LegacyPaymentRecord,
  type LegacyProjectRecord,
  type LegacyProjectTaskRecord,
  type LegacyQuotationRecord,
  type LegacySalesGoalRecord,
} from "./migrationMapping.server";
import {
  crmDeals,
  crmLeads,
  crmOwnerSettings,
  crmPaymentProofs,
  crmPayments,
  crmProjectTasks,
  crmProjects,
  crmQuotations,
  crmSalesGoals,
} from "../db/schema.server";
import type { RestoreExecutionResult } from "./types.server";

export interface DisposableRestoreOptions {
  db: MySql2Database<Record<string, unknown>>;
  archiveBytesOrFiles: Uint8Array | Record<string, Uint8Array>;
  targetOwnerUserId: string;
  allowIdempotentSkip?: boolean;
}

/**
 * Restores synthetic backup records into an isolated disposable MariaDB database.
 * Never executes against production databases.
 *
 * EXTERNAL BINARY FILES WARNING:
 * A MariaDB database transaction rollback ONLY rolls back SQL rows.
 * It CANNOT undo filesystem writes or S3/R2 object storage uploads.
 * Therefore, in real deployments, external binary files must be staged to a temporary
 * staging area and only committed to permanent storage AFTER this transaction commits.
 */
export async function executeDisposableRestore(
  options: DisposableRestoreOptions,
): Promise<RestoreExecutionResult> {
  const startTime = Date.now();
  const { db, archiveBytesOrFiles, targetOwnerUserId, allowIdempotentSkip = true } = options;

  // 1. Dry run pre-check
  const dryRun = await executeRestoreDryRun(archiveBytesOrFiles);
  if (!dryRun.ok) {
    return {
      ok: false,
      database: "disposable_mariadb",
      transactionCommitted: false,
      recordsInserted: {},
      recordsUpdated: {},
      recordsSkipped: {},
      financialsReconciled: false,
      idempotencyVerified: false,
      error: `Pre-restore validation failed: ${dryRun.validationErrors.join("; ")}`,
      durationMs: Date.now() - startTime,
    };
  }

  const mapper = new MigrationMapper(targetOwnerUserId);
  const recordsInserted: Record<string, number> = {
    leads: 0,
    deals: 0,
    payments: 0,
    projects: 0,
    projectTasks: 0,
    paymentProofs: 0,
    quotations: 0,
    salesGoals: 0,
    settings: 0,
  };
  const recordsSkipped: Record<string, number> = {
    leads: 0,
    deals: 0,
    payments: 0,
    projects: 0,
    projectTasks: 0,
    paymentProofs: 0,
    quotations: 0,
    salesGoals: 0,
    settings: 0,
  };

  // Extract raw files
  let files: Record<string, Uint8Array>;
  if (archiveBytesOrFiles instanceof Uint8Array) {
    const { unzipSync } = await import("fflate");
    files = unzipSync(archiveBytesOrFiles);
  } else {
    files = archiveBytesOrFiles;
  }

  const { strFromU8 } = await import("fflate");
  const readArray = <T>(path: string, key: string): T[] => {
    const raw = files[path];
    if (!raw) return [];
    try {
      const obj = JSON.parse(strFromU8(raw)) as Record<string, unknown>;
      return Array.isArray(obj[key]) ? (obj[key] as T[]) : [];
    } catch {
      return [];
    }
  };

  const readObject = <T>(path: string): T | null => {
    const raw = files[path];
    if (!raw) return null;
    try {
      return JSON.parse(strFromU8(raw)) as T;
    } catch {
      return null;
    }
  };

  const rawLeads = readArray<LegacyLeadRecord>("data/leads.json", "leads");
  const rawDeals = readArray<LegacyDealRecord>("data/deals.json", "deals");
  const rawPayments = readArray<LegacyPaymentRecord>("data/payments.json", "payments");
  const rawProjects = readArray<LegacyProjectRecord>("data/projects.json", "projects");
  const rawProjectTasks = readArray<LegacyProjectTaskRecord>("data/projects.json", "projectTasks");
  const rawGoals = readArray<LegacySalesGoalRecord>("data/sales-goals.json", "goals");
  const rawQuotations = [
    ...readArray<LegacyQuotationRecord>("data/quotation-templates.json", "legacyQuotations"),
    ...readArray<LegacyQuotationRecord>("data/quotations.json", "quotations"),
  ];
  const rawProofs = readArray<LegacyPaymentProofRecord>(
    "data/attachment-metadata.json",
    "attachments",
  );
  const rawSettings = readObject<LegacyOwnerSettingsRecord>("data/settings.json");

  // Map payment ID to deal ID for proof linking
  const paymentToDealMap = new Map<string, string>();
  for (const pay of rawPayments) {
    paymentToDealMap.set(pay.id, pay.dealId);
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Restore Leads
      for (const raw of rawLeads) {
        const mapped = mapper.mapLead(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmLeads.id })
            .from(crmLeads)
            .where(sql`${crmLeads.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["leads"] = (recordsSkipped["leads"] ?? 0) + 1;
            continue;
          }
        }
        await tx.insert(crmLeads).values(mapped as unknown as typeof crmLeads.$inferInsert);
        recordsInserted["leads"] = (recordsInserted["leads"] ?? 0) + 1;
      }

      // 2. Restore Deals
      for (const raw of rawDeals) {
        const mapped = mapper.mapDeal(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(sql`${crmDeals.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["deals"] = (recordsSkipped["deals"] ?? 0) + 1;
            continue;
          }
        }
        await tx.insert(crmDeals).values(mapped as unknown as typeof crmDeals.$inferInsert);
        recordsInserted["deals"] = (recordsInserted["deals"] ?? 0) + 1;
      }

      // 3. Restore Payments
      for (const raw of rawPayments) {
        const mapped = mapper.mapPayment(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmPayments.id })
            .from(crmPayments)
            .where(sql`${crmPayments.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["payments"] = (recordsSkipped["payments"] ?? 0) + 1;
            continue;
          }
        }
        await tx.insert(crmPayments).values(mapped as unknown as typeof crmPayments.$inferInsert);
        recordsInserted["payments"] = (recordsInserted["payments"] ?? 0) + 1;
      }

      // 4. Restore Projects
      for (const raw of rawProjects) {
        const mapped = mapper.mapProject(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmProjects.id })
            .from(crmProjects)
            .where(sql`${crmProjects.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["projects"] = (recordsSkipped["projects"] ?? 0) + 1;
            continue;
          }
        }
        await tx.insert(crmProjects).values(mapped as unknown as typeof crmProjects.$inferInsert);
        recordsInserted["projects"] = (recordsInserted["projects"] ?? 0) + 1;
      }

      // 5. Restore Project Tasks
      for (const raw of rawProjectTasks) {
        const mapped = mapper.mapProjectTask(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmProjectTasks.id })
            .from(crmProjectTasks)
            .where(sql`${crmProjectTasks.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["projectTasks"] = (recordsSkipped["projectTasks"] ?? 0) + 1;
            continue;
          }
        }
        await tx
          .insert(crmProjectTasks)
          .values(mapped as unknown as typeof crmProjectTasks.$inferInsert);
        recordsInserted["projectTasks"] = (recordsInserted["projectTasks"] ?? 0) + 1;
      }

      // 6. Restore Payment Proofs metadata
      for (const raw of rawProofs) {
        const dealId = raw.dealId || paymentToDealMap.get(raw.paymentId) || "unknown_deal";
        const mapped = mapper.mapPaymentProof(raw, dealId);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmPaymentProofs.id })
            .from(crmPaymentProofs)
            .where(sql`${crmPaymentProofs.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["paymentProofs"] = (recordsSkipped["paymentProofs"] ?? 0) + 1;
            continue;
          }
        }
        await tx
          .insert(crmPaymentProofs)
          .values(mapped as unknown as typeof crmPaymentProofs.$inferInsert);
        recordsInserted["paymentProofs"] = (recordsInserted["paymentProofs"] ?? 0) + 1;
      }

      // 7. Restore Quotations
      for (const raw of rawQuotations) {
        const mapped = mapper.mapQuotation(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmQuotations.id })
            .from(crmQuotations)
            .where(sql`${crmQuotations.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["quotations"] = (recordsSkipped["quotations"] ?? 0) + 1;
            continue;
          }
        }
        await tx
          .insert(crmQuotations)
          .values(mapped as unknown as typeof crmQuotations.$inferInsert);
        recordsInserted["quotations"] = (recordsInserted["quotations"] ?? 0) + 1;
      }

      // 8. Restore Goals
      for (const raw of rawGoals) {
        const mapped = mapper.mapSalesGoal(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmSalesGoals.id })
            .from(crmSalesGoals)
            .where(sql`${crmSalesGoals.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped["salesGoals"] = (recordsSkipped["salesGoals"] ?? 0) + 1;
            continue;
          }
        }
        await tx
          .insert(crmSalesGoals)
          .values(mapped as unknown as typeof crmSalesGoals.$inferInsert);
        recordsInserted["salesGoals"] = (recordsInserted["salesGoals"] ?? 0) + 1;
      }

      // 9. Restore Settings (if present)
      if (rawSettings && typeof rawSettings === "object") {
        const mapped = mapper.mapOwnerSettings(rawSettings);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmOwnerSettings.id })
            .from(crmOwnerSettings)
            .where(sql`${crmOwnerSettings.ownerUserId} = ${targetOwnerUserId}`);
          if (existing) {
            recordsSkipped["settings"] = (recordsSkipped["settings"] ?? 0) + 1;
          } else {
            await tx
              .insert(crmOwnerSettings)
              .values(mapped as unknown as typeof crmOwnerSettings.$inferInsert);
            recordsInserted["settings"] = (recordsInserted["settings"] ?? 0) + 1;
          }
        } else {
          await tx
            .insert(crmOwnerSettings)
            .values(mapped as unknown as typeof crmOwnerSettings.$inferInsert);
          recordsInserted["settings"] = (recordsInserted["settings"] ?? 0) + 1;
        }
      }
    });

    return {
      ok: true,
      database: "disposable_mariadb",
      transactionCommitted: true,
      recordsInserted,
      recordsUpdated: {},
      recordsSkipped,
      financialsReconciled: dryRun.financialReconciliation.reconciled,
      idempotencyVerified: true,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      database: "disposable_mariadb",
      transactionCommitted: false,
      recordsInserted: {},
      recordsUpdated: {},
      recordsSkipped: {},
      financialsReconciled: false,
      idempotencyVerified: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
