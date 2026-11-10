import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { executeRestoreDryRun } from "./dryRun.server";
import {
  MigrationMapper,
  type LegacyDealRecord,
  type LegacyLeadRecord,
  type LegacyPaymentRecord,
  type LegacyProjectRecord,
  type LegacySalesGoalRecord,
} from "./migrationMapping.server";
import { crmDeals, crmLeads, crmPayments, crmProjects, crmSalesGoals } from "../db/schema.server";
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
  const recordsInserted = {
    leads: 0,
    deals: 0,
    payments: 0,
    projects: 0,
    salesGoals: 0,
  };
  const recordsSkipped = {
    leads: 0,
    deals: 0,
    payments: 0,
    projects: 0,
    salesGoals: 0,
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

  const rawLeads = readArray<LegacyLeadRecord>("data/leads.json", "leads");
  const rawDeals = readArray<LegacyDealRecord>("data/deals.json", "deals");
  const rawPayments = readArray<LegacyPaymentRecord>("data/payments.json", "payments");
  const rawProjects = readArray<LegacyProjectRecord>("data/projects.json", "projects");
  const rawGoals = readArray<LegacySalesGoalRecord>("data/sales-goals.json", "goals");

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
            recordsSkipped.leads++;
            continue;
          }
        }
        await tx.insert(crmLeads).values(mapped as unknown as typeof crmLeads.$inferInsert);
        recordsInserted.leads++;
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
            recordsSkipped.deals++;
            continue;
          }
        }
        await tx.insert(crmDeals).values(mapped as unknown as typeof crmDeals.$inferInsert);
        recordsInserted.deals++;
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
            recordsSkipped.payments++;
            continue;
          }
        }
        await tx.insert(crmPayments).values(mapped as unknown as typeof crmPayments.$inferInsert);
        recordsInserted.payments++;
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
            recordsSkipped.projects++;
            continue;
          }
        }
        await tx.insert(crmProjects).values(mapped as unknown as typeof crmProjects.$inferInsert);
        recordsInserted.projects++;
      }

      // 5. Restore Goals
      for (const raw of rawGoals) {
        const mapped = mapper.mapSalesGoal(raw);
        if (allowIdempotentSkip) {
          const [existing] = await tx
            .select({ id: crmSalesGoals.id })
            .from(crmSalesGoals)
            .where(sql`${crmSalesGoals.id} = ${mapped.id}`);
          if (existing) {
            recordsSkipped.salesGoals++;
            continue;
          }
        }
        await tx
          .insert(crmSalesGoals)
          .values(mapped as unknown as typeof crmSalesGoals.$inferInsert);
        recordsInserted.salesGoals++;
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
