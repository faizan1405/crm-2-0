import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";
import { validateArchivePath, validateBackupArchive } from "./backup/validation.server";

describe("B7A — Backup Validation & Archive Integrity Checks", () => {
  it("validateArchivePath rejects path traversal, absolute paths, and unexpected directories", () => {
    expect(validateArchivePath("../etc/passwd")).toMatch(/Unsafe path traversal/i);
    expect(validateArchivePath("data/../../secrets.json")).toMatch(/Unsafe path traversal/i);
    expect(validateArchivePath("C:\\Windows\\System32")).toMatch(/Unsafe absolute/i);
    expect(validateArchivePath("/var/log/syslog")).toMatch(/Unsafe absolute/i);
    expect(validateArchivePath("public/hack.js")).toMatch(/Unexpected file/i);
    expect(validateArchivePath(".env")).toMatch(/Unexpected file/i);

    expect(validateArchivePath("manifest.json")).toBeNull();
    expect(validateArchivePath("backup-summary.html")).toBeNull();
    expect(validateArchivePath("data/leads.json")).toBeNull();
    expect(validateArchivePath("data/deals.json")).toBeNull();
    expect(validateArchivePath("files/payment-proofs/pay_1__proof.pdf")).toBeNull();
  });

  function createValidArchiveFixture(
    overrides: {
      tamperJsonFile?: string;
      tamperBinaryFile?: string;
      unlistedFile?: string;
      tamperCounts?: boolean;
      tamperChecksum?: boolean;
      tamperFinancials?: boolean;
      duplicateLeadId?: boolean;
      brokenPaymentDealId?: boolean;
      missingAttachmentFile?: boolean;
    } = {},
  ) {
    const leads = [
      { id: "lead_1", name: "Alpha Systems", status: "new", createdAt: "2026-11-10T10:00:00Z" },
      {
        id: overrides.duplicateLeadId ? "lead_1" : "lead_2",
        name: "Beta Corp",
        status: "contacted",
        createdAt: "2026-11-10T10:00:00Z",
      },
    ];

    const deals = [
      {
        id: "deal_1",
        leadId: "lead_1",
        name: "Website Rebuild",
        valuePaise: 200000,
        status: "won",
      },
    ];

    const payments = [
      {
        id: "pay_1",
        dealId: overrides.brokenPaymentDealId ? "deal_nonexistent" : "deal_1",
        amountPaise: 200000,
        voided: false,
      },
    ];

    const proofBytes = Buffer.from("%PDF-1.4 Mock Proof Content For Scale Flow CRM Test");
    const proofPath = "files/payment-proofs/pay_1__proof.pdf";

    const summary = buildFinancialSummary({ deals, payments });
    if (overrides.tamperFinancials) {
      summary.activePaymentsPaise = 99999999;
    }

    const leadsJson = canonicalJsonStringify({ leads });
    const dealsJson = canonicalJsonStringify({ deals });
    const paymentsJson = canonicalJsonStringify({ payments });
    const attMetaJson = canonicalJsonStringify({
      attachments: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "proof.pdf",
          mimeType: "application/pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: overrides.missingAttachmentFile ? null : proofPath,
        },
      ],
    });

    const fileList = [
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

    if (!overrides.missingAttachmentFile) {
      fileList.push({
        path: proofPath,
        sha256: overrides.tamperChecksum ? "tampered_sha256_hash_here" : computeSha256(proofBytes),
        bytes: proofBytes.byteLength,
      });
    }

    const manifest = buildManifest({
      type: "full",
      includedEntities: ["leads", "deals", "payments", "proofs"],
      counts: {
        leads: overrides.tamperCounts ? 999 : leads.length,
        deals: deals.length,
        payments: payments.length,
      },
      financialSummary: summary,
      attachmentsMeta: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "proof.pdf",
          mimeType: "application/pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: overrides.missingAttachmentFile ? null : proofPath,
          uploadedAt: "2026-11-10T10:00:00Z",
          status: overrides.missingAttachmentFile ? "missing" : "verified",
        },
      ],
      files: fileList,
    });

    const rawFiles: Record<string, Uint8Array> = {
      "manifest.json": strToU8(canonicalJsonStringify(manifest)),
      "data/leads.json": strToU8(
        overrides.tamperJsonFile === "leads" ? leadsJson + " " : leadsJson,
      ),
      "data/deals.json": strToU8(dealsJson),
      "data/payments.json": strToU8(paymentsJson),
      "data/attachment-metadata.json": strToU8(attMetaJson),
    };

    if (!overrides.missingAttachmentFile) {
      rawFiles[proofPath] = overrides.tamperBinaryFile
        ? Buffer.from("Corrupted Proof Content")
        : proofBytes;
    }

    if (overrides.unlistedFile) {
      rawFiles["data/unlisted.json"] = strToU8(JSON.stringify({ secret: "leak" }));
    }

    return { manifest, rawFiles, zipBuffer: zipSync(rawFiles) };
  }

  it("validates an intact synthetic archive cleanly with ok=true and classification=complete", async () => {
    const { zipBuffer } = createValidArchiveFixture();
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(true);
    expect(report.classification).toBe("complete");
    expect(report.errors).toHaveLength(0);
    expect(report.entityCounts["leads"]).toBe(2);
    expect(report.entityCounts["deals"]).toBe(1);
    expect(report.entityCounts["payments"]).toBe(1);
    expect(report.attachmentIntegrity.found).toBe(1);
    expect(report.financialReconciliation.verified).toBe(true);
  });

  it("detects tampered JSON file with SHA-256 mismatch", async () => {
    const { zipBuffer } = createValidArchiveFixture({ tamperJsonFile: "leads" });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.classification).toBe("damaged");
    expect(
      report.errors.some((e) => e.includes("SHA-256 checksum mismatch for 'data/leads.json'")),
    ).toBe(true);
  });

  it("detects corrupted attachment binary with size/checksum mismatch", async () => {
    const { zipBuffer } = createValidArchiveFixture({ tamperBinaryFile: "proof" });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.classification).toBe("damaged");
    expect(
      report.errors.some((e) => e.includes("checksum mismatch") || e.includes("size mismatch")),
    ).toBe(true);
  });

  it("detects unlisted files present in the archive", async () => {
    const { zipBuffer } = createValidArchiveFixture({ unlistedFile: "data/unlisted.json" });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("unlisted file not in manifest"))).toBe(true);
  });

  it("detects entity count discrepancies against manifest declaration", async () => {
    const { zipBuffer } = createValidArchiveFixture({ tamperCounts: true });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("count mismatch for 'leads'"))).toBe(true);
  });

  it("detects duplicate IDs inside entity collections", async () => {
    const { zipBuffer } = createValidArchiveFixture({ duplicateLeadId: true });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Duplicate ID 'lead_1' detected in leads"))).toBe(
      true,
    );
  });

  it("detects broken foreign key references (Payment referencing non-existent Deal)", async () => {
    const { zipBuffer } = createValidArchiveFixture({ brokenPaymentDealId: true });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("references deal 'deal_nonexistent'"))).toBe(true);
  });

  it("detects financial total discrepancies between manifest summary and individual payments", async () => {
    const { zipBuffer } = createValidArchiveFixture({ tamperFinancials: true });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(false);
    expect(report.financialReconciliation.verified).toBe(false);
    expect(report.errors.some((e) => e.includes("Financial discrepancy"))).toBe(true);
  });

  it("detects missing proof files declared in metadata", async () => {
    const { zipBuffer } = createValidArchiveFixture({ missingAttachmentFile: true });
    const report = await validateBackupArchive(zipBuffer);

    expect(report.ok).toBe(true);
    // When missing attachment is listed honestly in manifest with status=missing and path=null, classification is incomplete-full
    expect(report.classification).toBe("incomplete-full");
    expect(report.attachmentIntegrity.missing.length).toBeGreaterThan(0);
  });

  it("rejects non-ZIP corrupted input cleanly without throwing unhandled exceptions", async () => {
    const corruptBytes = Buffer.from("THIS IS NOT A VALID ZIP FILE HEADER AT ALL");
    const report = await validateBackupArchive(corruptBytes);

    expect(report.ok).toBe(false);
    expect(report.classification).toBe("damaged");
    expect(report.errors[0]).toMatch(/not a readable or valid ZIP file|No manifest\.json found/i);
  });
});
