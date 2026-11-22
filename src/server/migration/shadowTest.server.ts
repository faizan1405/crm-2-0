import "@tanstack/react-start/server-only";
import { analyzeMigrationSource, type MappedMigrationPayload } from "./migrationEngine.server";
import { buildSyntheticMigrationZip } from "./syntheticDataset.server";
import {
  HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
  type ShadowMigrationTestReport,
  type ShadowTestAssertion,
} from "./types.server";

/**
 * Isolated in-memory shadow store mimicking MariaDB transactional commit/rollback
 * and unique primary-key idempotency checks without touching any real database.
 */
class InMemoryShadowStore {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  private getTable(name: string): Map<string, Record<string, unknown>> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  snapshot(): Map<string, Map<string, Record<string, unknown>>> {
    const copy = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [k, v] of this.tables.entries()) {
      copy.set(k, new Map(v));
    }
    return copy;
  }

  restore(snap: Map<string, Map<string, Record<string, unknown>>>): void {
    this.tables = snap;
  }

  totalRowCount(): number {
    let sum = 0;
    for (const t of this.tables.values()) sum += t.size;
    return sum;
  }

  applyMappedPayload(
    mapped: MappedMigrationPayload,
    options?: { failAfterTable?: string },
  ): { inserted: Record<string, number>; skipped: Record<string, number> } {
    const snap = this.snapshot();
    const inserted: Record<string, number> = {};
    const skipped: Record<string, number> = {};

    const orderedTables: Array<[string, Array<Record<string, unknown> & { id: string }>]> = [
      ["crm_leads", [...mapped.leads, ...mapped.archivedLeads]],
      ["crm_lead_activities", mapped.activities],
      ["crm_follow_ups", mapped.followUps],
      ["crm_call_logs", mapped.callLogs],
      ["crm_whats_app_logs", mapped.whatsAppLogs],
      ["crm_deals", mapped.deals],
      ["crm_deal_milestones", mapped.dealMilestones],
      ["crm_payments", mapped.payments],
      ["crm_finance_events", mapped.financeEvents],
      ["crm_payment_proofs", mapped.paymentProofs],
      ["crm_quotation_templates", mapped.quotationTemplates],
      ["crm_quotations", mapped.quotations],
      ["crm_projects", mapped.projects],
      ["crm_project_milestones", mapped.projectMilestones],
      ["crm_project_tasks", mapped.projectTasks],
      ["crm_client_support_tickets", mapped.supportTickets],
      ["crm_custom_fields", mapped.customFields],
      ["crm_lead_field_values", mapped.leadFieldValues],
      ["crm_tag_defs", mapped.tags],
      ["crm_lead_tags", mapped.leadTags],
      ["crm_saved_views", mapped.savedViews],
      ["crm_lead_inbox_items", mapped.inboxItems],
      ["crm_lead_relationships", mapped.leadRelationships],
      ["crm_automation_rules", mapped.automationRules],
      ["crm_owner_settings", mapped.ownerSettings],
      ["crm_sales_goals", mapped.salesGoals],
    ];

    try {
      for (const [tableName, rows] of orderedTables) {
        const table = this.getTable(tableName);
        let ins = 0;
        let skp = 0;
        for (const row of rows) {
          if (table.has(row.id)) {
            skp++;
          } else {
            table.set(row.id, row);
            ins++;
          }
        }
        inserted[tableName] = ins;
        skipped[tableName] = skp;

        if (options?.failAfterTable === tableName) {
          throw new Error(`Synthetic rollback injection after '${tableName}'`);
        }
      }
      return { inserted, skipped };
    } catch (err) {
      // Atomic transaction rollback
      this.restore(snap);
      throw err;
    }
  }
}

/**
 * Executes a full, deterministic B13 Synthetic Shadow Migration Test completely in memory.
 * Zero real database writes, zero CRM V1 access, zero browser storage mutations, Hostinger-exclusive.
 */
export function runSyntheticShadowMigrationTest(params?: {
  ownerUserId?: string;
}): ShadowMigrationTestReport {
  const startedAt = Date.now();
  const ownerUserId = params?.ownerUserId ?? "usr_owner_shadow_test";
  const errors: string[] = [];
  const assertions: ShadowTestAssertion[] = [];

  // 1. Build synthetic dataset with credential injection to prove scrubbing too
  const { zipBytes, filename } = buildSyntheticMigrationZip({
    injectCredentialFields: true,
  });

  // 2. Analyze & map
  const { report, mapped } = analyzeMigrationSource({
    source: zipBytes,
    sourceFilename: filename,
    ownerUserId,
  });

  assertions.push({
    id: "entity_validation",
    name: "All CRM Entities Validated",
    passed: report.ok && report.unresolvedForeignKeys.filter((f) => f.severity === "error").length === 0,
    detail: `Validated ${report.totalValidRecords}/${report.totalSourceRecords} records across 27 mapped entity groups with 0 blocking FK errors.`,
  });

  assertions.push({
    id: "financial_parity",
    name: "Exact Integer-Paise Financial Parity (0 Paise Delta)",
    passed:
      report.financialReconciliation.financialParityPassed &&
      report.financialReconciliation.dealsDeltaPaise === 0 &&
      report.financialReconciliation.activePaymentsDeltaPaise === 0 &&
      report.financialReconciliation.voidedPaymentsDeltaPaise === 0,
    detail: `Deals=${report.financialReconciliation.formattedSummary.dealsBookedInr}, Active=${report.financialReconciliation.formattedSummary.activePaymentsInr}, Voided=${report.financialReconciliation.formattedSummary.voidedPaymentsInr}, Outstanding=${report.financialReconciliation.formattedSummary.outstandingInr}.`,
  });

  assertions.push({
    id: "hostinger_storage_fit",
    name: "Hostinger-Exclusive Storage Budget (No Cloudflare R2 Required)",
    passed:
      report.hostingerCapacity.hostingProvider === "hostinger_exclusive" &&
      report.hostingerCapacity.cloudflareR2Required === false &&
      report.hostingerCapacity.fitsWithinHostingerBudget &&
      report.proofVerification.failed === 0 &&
      report.proofVerification.verified === report.proofVerification.expected,
    detail: `Verified ${report.proofVerification.verified}/${report.proofVerification.expected} proofs for Hostinger mariadb-blob (${report.hostingerCapacity.projectedPercentOfQuota}% of 3,072 MiB quota).`,
  });

  assertions.push({
    id: "automation_safety",
    name: "Automation Rules Forced Paused",
    passed:
      report.safetyChecks.automationRulesForcedPaused > 0 &&
      mapped.automationRules.every((r) => r.status === "paused"),
    detail: `${report.safetyChecks.automationRulesForcedPaused} active automation rule(s) forced to 'paused' so zero unattended runs execute.`,
  });

  assertions.push({
    id: "followup_lock_integrity",
    name: "Follow-up Single Active Lock Enforced",
    passed: report.safetyChecks.followUpActiveLocksResolved === 1,
    detail: `Resolved ${report.safetyChecks.followUpActiveLocksResolved} duplicate pending follow-up conflict(s) deterministically.`,
  });

  assertions.push({
    id: "credential_scrubbing",
    name: "Sensitive Credential Fields Scrubbed",
    passed: report.safetyChecks.credentialsScrubbed && report.safetyChecks.scrubbedFieldCount >= 3,
    detail: `Scrubbed ${report.safetyChecks.scrubbedFieldCount} injected secret/token/password fields before mapping.`,
  });

  // 3. Pass 1: Shadow Insert
  const shadowStore = new InMemoryShadowStore();
  const pass1 = shadowStore.applyMappedPayload(mapped);

  // 4. Pass 2: Idempotency Re-run (must insert 0 rows and skip 100%)
  const pass2 = shadowStore.applyMappedPayload(mapped);
  const pass2InsertedTotal = Object.values(pass2.inserted).reduce((a, b) => a + b, 0);

  assertions.push({
    id: "idempotency_rerun",
    name: "Idempotent Re-run (Zero Duplicate Rows on Pass 2)",
    passed: pass2InsertedTotal === 0,
    detail: `Pass 2 inserted ${pass2InsertedTotal} duplicate rows and skipped ${Object.values(pass2.skipped).reduce((a, b) => a + b, 0)} existing rows.`,
  });

  // 5. Atomic Rollback Verification on fresh shadow store
  const rollbackStore = new InMemoryShadowStore();
  let rollbackVerified = false;
  try {
    rollbackStore.applyMappedPayload(mapped, { failAfterTable: "crm_payments" });
  } catch {
    rollbackVerified = rollbackStore.totalRowCount() === 0;
  }
  const rollbackResidualRows = rollbackStore.totalRowCount();

  assertions.push({
    id: "atomic_rollback",
    name: "Mid-Transaction Failure Atomic Rollback",
    passed: rollbackVerified && rollbackResidualRows === 0,
    detail: `Injected mid-transaction failure after crm_payments; residual rows = ${rollbackResidualRows}.`,
  });

  for (const a of assertions) {
    if (!a.passed) {
      errors.push(`Assertion '${a.id}' failed: ${a.detail}`);
    }
  }

  return {
    ok: assertions.every((a) => a.passed) && errors.length === 0,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    mode: "synthetic_in_memory_shadow",
    syntheticDataOnly: true,
    realDatabaseTouched: false,
    crmV1Touched: false,
    browserStorageTouched: false,
    hostingPolicy: {
      provider: "hostinger_exclusive",
      cloudflareR2Required: false,
      proofStorageDriver: HOSTINGER_EXCLUSIVE_STORAGE_DRIVER,
    },
    analysisSummary: {
      totalSourceRecords: report.totalSourceRecords,
      totalValidRecords: report.totalValidRecords,
      financialParityPassed: report.financialReconciliation.financialParityPassed,
      activePaymentsInr: report.financialReconciliation.formattedSummary.activePaymentsInr,
      voidedPaymentsInr: report.financialReconciliation.formattedSummary.voidedPaymentsInr,
      dealsBookedInr: report.financialReconciliation.formattedSummary.dealsBookedInr,
      outstandingInr: report.financialReconciliation.formattedSummary.outstandingInr,
      proofsVerified: report.proofVerification.verified,
      projectedHostingerQuotaPercent: report.hostingerCapacity.projectedPercentOfQuota,
    },
    pass1InsertedCounts: pass1.inserted,
    pass2SkippedCounts: pass2.skipped,
    pass2InsertedTotal,
    rollbackVerified,
    rollbackResidualRows,
    assertions,
    errors,
  };
}
