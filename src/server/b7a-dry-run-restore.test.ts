import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { executeRestoreDryRun } from "./backup/dryRun.server";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";

describe("B7A — Safe Restore Dry-Run Framework (Zero Mutations)", () => {
  function createSyntheticBackupFiles(
    params: {
      leadCount?: number;
      dealCount?: number;
      paymentCount?: number;
      voidedPaymentCount?: number;
      brokenFk?: boolean;
      missingAttachment?: boolean;
    } = {},
  ) {
    const leadCount = params.leadCount ?? 2;
    const dealCount = params.dealCount ?? 1;
    const paymentCount = params.paymentCount ?? 2;
    const voidedPaymentCount = params.voidedPaymentCount ?? 1;

    const leads = Array.from({ length: leadCount }, (_, i) => ({
      id: `lead_${i + 1}`,
      name: `Synthetic Lead ${i + 1}`,
      status: "new",
      createdAt: "2026-11-10T10:00:00Z",
    }));

    const deals = Array.from({ length: dealCount }, (_, i) => ({
      id: `deal_${i + 1}`,
      leadId: `lead_${(i % leadCount) + 1}`,
      name: `Deal ${i + 1}`,
      valuePaise: 100000,
      status: "won",
      createdAt: "2026-11-10T10:00:00Z",
    }));

    const payments = Array.from({ length: paymentCount }, (_, i) => {
      const isVoided = i < voidedPaymentCount;
      return {
        id: `pay_${i + 1}`,
        dealId: params.brokenFk && i === 0 ? "deal_missing_999" : `deal_1`,
        amountPaise: 50000,
        voided: isVoided,
        status: isVoided ? "voided" : "completed",
        date: "2026-11-10",
      };
    });

    const proofBytes = Buffer.from("Synthetic payment receipt PDF buffer content");
    const proofPath = "files/payment-proofs/pay_1__receipt.pdf";

    const summary = buildFinancialSummary({ deals, payments });

    const leadsJson = canonicalJsonStringify({ leads });
    const dealsJson = canonicalJsonStringify({ deals });
    const paymentsJson = canonicalJsonStringify({ payments });
    const attMetaJson = canonicalJsonStringify({
      attachments: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "receipt.pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: params.missingAttachment ? null : proofPath,
        },
      ],
    });

    const files: Record<string, Uint8Array> = {
      "data/leads.json": strToU8(leadsJson),
      "data/deals.json": strToU8(dealsJson),
      "data/payments.json": strToU8(paymentsJson),
      "data/attachment-metadata.json": strToU8(attMetaJson),
    };

    const manifestFiles = [
      {
        path: "data/leads.json",
        sha256: computeSha256(leadsJson),
        bytes: Buffer.byteLength(leadsJson),
      },
      {
        path: "data/deals.json",
        sha256: computeSha256(dealsJson),
        bytes: Buffer.byteLength(dealsJson),
      },
      {
        path: "data/payments.json",
        sha256: computeSha256(paymentsJson),
        bytes: Buffer.byteLength(paymentsJson),
      },
      {
        path: "data/attachment-metadata.json",
        sha256: computeSha256(attMetaJson),
        bytes: Buffer.byteLength(attMetaJson),
      },
    ];

    if (!params.missingAttachment) {
      files[proofPath] = proofBytes;
      manifestFiles.push({
        path: proofPath,
        sha256: computeSha256(proofBytes),
        bytes: proofBytes.byteLength,
      });
    }

    const manifest = buildManifest({
      type: "full",
      includedEntities: ["leads", "deals", "payments", "proofs"],
      counts: {
        leads: leads.length,
        deals: deals.length,
        payments: payments.length,
      },
      financialSummary: summary,
      files: manifestFiles,
      attachmentsMeta: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "receipt.pdf",
          mimeType: "application/pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: params.missingAttachment ? null : proofPath,
          uploadedAt: "2026-11-10T10:00:00Z",
          status: params.missingAttachment ? "missing" : "verified",
        },
      ],
    });

    files["manifest.json"] = strToU8(canonicalJsonStringify(manifest));
    return { files, leads, deals, payments, summary };
  }

  it("dry-run restore performs strictly zero mutations and asserts databaseWritten=false", async () => {
    const { files, summary } = createSyntheticBackupFiles();

    const dryRun = await executeRestoreDryRun(files, {
      existingLeadIds: new Set(["lead_1"]), // lead_1 already exists in target
    });

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.mutationsPerformed).toBe(0);
    expect(dryRun.databaseWritten).toBe(false);
    expect(dryRun.ok).toBe(true);

    // lead_1 is skipped, lead_2 is to create
    expect(dryRun.actions["leads"]!.toSkip).toBe(1);
    expect(dryRun.actions["leads"]!.toCreate).toBe(1);
    expect(dryRun.actions["leads"]!.conflicts[0]!.id).toBe("lead_1");

    // Deals and payments
    expect(dryRun.actions["deals"]!.toCreate).toBe(1);
    expect(dryRun.actions["payments"]!.toCreate).toBe(2);

    // Financial reconciliation
    expect(dryRun.financialReconciliation.reconciled).toBe(true);
    expect(dryRun.financialReconciliation.derivedTotalPaise).toBe(summary.activePaymentsPaise);
    expect(dryRun.financialReconciliation.sourceVoidedPaise).toBe(summary.voidedPaymentsPaise);
  });

  it("dry-run detects unresolved foreign key references and flags them in report", async () => {
    const { files } = createSyntheticBackupFiles({ brokenFk: true });

    const dryRun = await executeRestoreDryRun(files);

    expect(dryRun.ok).toBe(false);
    expect(dryRun.unresolvedForeignKeys.length).toBeGreaterThan(0);
    expect(dryRun.unresolvedForeignKeys[0]).toMatchObject({
      entity: "payments",
      recordId: "pay_1",
      foreignField: "dealId",
      missingTargetId: "deal_missing_999",
    });
  });

  it("dry-run accurately verifies attachments without modifying storage files", async () => {
    const { files } = createSyntheticBackupFiles();

    const dryRun = await executeRestoreDryRun(files);

    expect(dryRun.attachments.expected).toBe(1);
    expect(dryRun.attachments.verified).toBe(1);
    expect(dryRun.attachments.missing).toHaveLength(0);
  });
});
