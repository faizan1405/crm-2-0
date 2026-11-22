import { describe, expect, it } from "vitest";
import {
  analyzeMigrationSource,
  buildSyntheticMigrationZip,
  estimateHostingerMigrationCapacity,
  formatPaiseInr,
  scrubLegacyCredentials,
} from "./migration/index.server";

describe("Checkpoint B13: Existing Data Migration Engine & Financial Accuracy", () => {
  it("validates and maps all CRM entities from a synthetic Data Vault ZIP with 0-paise financial delta", () => {
    const { zipBytes, filename } = buildSyntheticMigrationZip({ injectCredentialFields: true });
    const { report, mapped } = analyzeMigrationSource({
      source: zipBytes,
      sourceFilename: filename,
      ownerUserId: "usr_owner_b13",
    });

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.databaseWritten).toBe(false);
    expect(report.browserStorageModified).toBe(false);
    expect(report.hostingPolicy.provider).toBe("hostinger_exclusive");
    expect(report.hostingPolicy.cloudflareR2Required).toBe(false);
    expect(report.hostingPolicy.proofStorageDriver).toBe("mariadb-blob");
    expect(report.hostingPolicy.productionMigrationLocked).toBe(true);

    // Core CRM entity counts
    expect(report.entities.leads.validCount).toBe(3);
    expect(report.entities.archivedLeads.validCount).toBe(1);
    expect(report.entities.activities.validCount).toBe(2);
    expect(report.entities.followUps.validCount).toBe(3);
    expect(report.entities.callLogs.validCount).toBe(1);
    expect(report.entities.whatsAppLogs.validCount).toBe(1);
    expect(report.entities.deals.validCount).toBe(3);
    expect(report.entities.dealMilestones.validCount).toBe(2);
    expect(report.entities.payments.validCount).toBe(3);
    expect(report.entities.financeEvents.validCount).toBe(3);
    expect(report.entities.paymentProofs.validCount).toBe(2);
    expect(report.entities.quotationTemplates.validCount).toBe(1);
    expect(report.entities.quotations.validCount).toBe(1);
    expect(report.entities.projects.validCount).toBe(1);
    expect(report.entities.projectMilestones.validCount).toBe(1);
    expect(report.entities.projectTasks.validCount).toBe(1);
    expect(report.entities.supportTickets.validCount).toBe(1);
    expect(report.entities.customFields.validCount).toBe(1);
    expect(report.entities.leadFieldValues.validCount).toBe(1);
    expect(report.entities.tags.validCount).toBe(1);
    expect(report.entities.leadTags.validCount).toBe(1);
    expect(report.entities.savedViews.validCount).toBe(1);
    expect(report.entities.inboxItems.validCount).toBe(1);
    expect(report.entities.leadRelationships.validCount).toBe(1);
    expect(report.entities.automationRules.validCount).toBe(1);
    expect(report.entities.ownerSettings.validCount).toBe(1);
    expect(report.entities.salesGoals.validCount).toBe(2);

    // Exact integer-paise financial reconciliation
    const fin = report.financialReconciliation;
    expect(fin.financialParityPassed).toBe(true);
    expect(fin.dealsDeltaPaise).toBe(0);
    expect(fin.activePaymentsDeltaPaise).toBe(0);
    expect(fin.voidedPaymentsDeltaPaise).toBe(0);
    // Won (123456.78) + Active (19999.99) + Lost (45000.00) = 188456.77 -> 18,845,677 paise
    expect(fin.mappedDealsTotalPaise).toBe(18845677);
    // Active payments: 61728.39 + 0.01 = 61728.40 -> 6,172,840 paise
    expect(fin.mappedActivePaymentsPaise).toBe(6172840);
    // Voided payments: 10000.00 -> 1,000,000 paise
    expect(fin.mappedVoidedPaymentsPaise).toBe(1000000);
    // Outstanding: (123456.78 - 61728.39) + (19999.99 - 0.01) = 61728.39 + 19999.98 = 81728.37 -> 8,172,837 paise
    expect(fin.totalOutstandingPaise).toBe(8172837);
    expect(fin.formattedSummary.activePaymentsInr).toBe("₹61,728.40");
    expect(fin.formattedSummary.voidedPaymentsInr).toBe("₹10,000.00");
    expect(fin.formattedSummary.outstandingInr).toBe("₹81,728.37");

    // Safety checks
    expect(report.safetyChecks.credentialsScrubbed).toBe(true);
    expect(report.safetyChecks.scrubbedFieldCount).toBe(3);
    expect(report.safetyChecks.automationRulesForcedPaused).toBe(1);
    expect(mapped.automationRules.every((r) => r.status === "paused")).toBe(true);
    expect(report.safetyChecks.followUpActiveLocksResolved).toBe(1);
    expect(report.safetyChecks.crmV1Untouched).toBe(true);

    // Proof binary verification for Hostinger mariadb-blob
    expect(report.proofVerification.expected).toBe(2);
    expect(report.proofVerification.verified).toBe(2);
    expect(report.proofVerification.failed).toBe(0);
    expect(mapped.paymentProofs.every((p) => p["storageDriver"] === "mariadb-blob")).toBe(true);

    // Deferred collections are explicitly reported, never silently dropped
    expect(report.deferredCollections.map((d) => d.collection)).toEqual(
      expect.arrayContaining(["notes", "demos"]),
    );
    expect(report.deferredCollections.every((d) => d.status === "deferred_not_dropped")).toBe(true);
  });

  it("rejects fractional paise amounts (>2 decimals) and fails financial parity", () => {
    const { zipBytes } = buildSyntheticMigrationZip({ injectInvalidPaise: true });
    const { report } = analyzeMigrationSource({
      source: zipBytes,
      ownerUserId: "usr_owner_b13",
    });

    expect(report.ok).toBe(false);
    expect(report.financialReconciliation.financialParityPassed).toBe(false);
    expect(
      report.errors.some((e) => e.includes("syn_pay_01") && e.includes("invalid monetary")),
    ).toBe(true);
  });

  it("detects and blocks orphan payment foreign keys", () => {
    const { zipBytes } = buildSyntheticMigrationZip({ injectOrphanPayment: true });
    const { report } = analyzeMigrationSource({
      source: zipBytes,
      ownerUserId: "usr_owner_b13",
    });

    expect(report.ok).toBe(false);
    expect(
      report.unresolvedForeignKeys.some(
        (fk) =>
          fk.entity === "payments" &&
          fk.recordId === "syn_pay_orphan" &&
          fk.missingTargetId === "nonexistent_deal_999",
      ),
    ).toBe(true);
  });

  it("detects tampered payment proof SHA-256 hashes", () => {
    const { zipBytes } = buildSyntheticMigrationZip({ injectTamperedProofHash: true });
    const { report } = analyzeMigrationSource({
      source: zipBytes,
      ownerUserId: "usr_owner_b13",
    });

    expect(report.ok).toBe(false);
    expect(report.proofVerification.failed).toBe(1);
    expect(
      report.proofVerification.checks.some(
        (c) => c.attachmentId === "syn_att_01" && c.status === "hash_mismatch",
      ),
    ).toBe(true);
  });

  it("accepts raw Zustand JSON snapshots and unwraps state cleanly", () => {
    const snapshot = {
      version: 7,
      state: {
        leads: [
          {
            id: "l1",
            name: "JSON Snapshot Client",
            phone: "9876543210",
            status: "new",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        deals: [
          {
            id: "d1",
            leadId: "l1",
            name: "JSON Deal",
            value: "25000.50",
            status: "active",
            createdAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        payments: [{ id: "p1", dealId: "d1", amount: "10000.25", date: "2026-09-03" }],
      },
    };
    const { report } = analyzeMigrationSource({
      source: JSON.stringify(snapshot),
      sourceFilename: "legacy-export.json",
      ownerUserId: "usr_owner_b13",
    });

    expect(report.ok).toBe(true);
    expect(report.sourceFormat).toBe("legacy-json-snapshot");
    expect(report.financialReconciliation.mappedDealsTotalPaise).toBe(2500050);
    expect(report.financialReconciliation.mappedActivePaymentsPaise).toBe(1000025);
    expect(report.financialReconciliation.totalOutstandingPaise).toBe(1500025);
  });

  it("evaluates Hostinger 3,072 MiB quota thresholds (safe / warning / hard_stop_exceeded) without Cloudflare R2", () => {
    const safe = estimateHostingerMigrationCapacity({
      totalSqlRecords: 500,
      proofSizesBytes: [1024 * 500],
      baselineUsedMiB: 20,
    });
    expect(safe.cloudflareR2Required).toBe(false);
    expect(safe.status).toBe("safe");
    expect(safe.fitsWithinHostingerBudget).toBe(true);

    const warn = estimateHostingerMigrationCapacity({
      totalSqlRecords: 100,
      proofSizesBytes: [],
      baselineUsedMiB: 1600,
    });
    expect(warn.status).toBe("warning");
    expect(warn.fitsWithinHostingerBudget).toBe(true);

    const hardStop = estimateHostingerMigrationCapacity({
      totalSqlRecords: 100,
      proofSizesBytes: [5 * 1024 * 1024],
      baselineUsedMiB: 2150,
    });
    expect(hardStop.status).toBe("hard_stop_exceeded");
    expect(hardStop.fitsWithinHostingerBudget).toBe(false);
  });

  it("formats INR paise accurately in Indian numbering format and scrubs credentials recursively", () => {
    expect(formatPaiseInr(12345678)).toBe("₹1,23,456.78");
    expect(formatPaiseInr(1)).toBe("₹0.01");
    expect(formatPaiseInr(50000000)).toBe("₹5,00,000.00");

    const { cleaned, scrubbedCount } = scrubLegacyCredentials({
      name: "Safe",
      passwordHash: "secret",
      nested: { apiKey: "k1", ok: true },
      fieldValues: { lead1: { cf_token_note: "keep custom field value" } },
    });
    expect(scrubbedCount).toBe(2);
    expect(cleaned).not.toHaveProperty("passwordHash");
    expect((cleaned.nested as Record<string, unknown>)["apiKey"]).toBeUndefined();
    expect(
      ((cleaned.fieldValues as Record<string, Record<string, unknown>>)["lead1"] ?? {})[
        "cf_token_note"
      ],
    ).toBe("keep custom field value");
  });
});
