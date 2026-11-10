import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildBackupZipArchive } from "./backup/archive.server";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";
import { ARCHIVE_LIMITS, validateBackupArchive } from "./backup/validation.server";

describe("B7A-QA — Real ZIP Archive Generation & Security Defense", () => {
  function createRealZipFixture() {
    const leads = [
      {
        id: "lead_real_1",
        name: "Metro Retail",
        status: "won",
        score: 85,
        createdAt: "2026-11-10T10:00:00Z",
      },
      {
        id: "lead_real_2",
        name: "Cosmo Tech",
        status: "new",
        score: 70,
        createdAt: "2026-11-10T11:00:00Z",
      },
    ];
    const deals = [
      {
        id: "deal_real_1",
        leadId: "lead_real_1",
        name: "ERP Upgrade",
        valuePaise: 4000000,
        status: "won",
        createdAt: "2026-11-10T10:30:00Z",
      },
    ];
    const payments = [
      {
        id: "pay_real_1",
        dealId: "deal_real_1",
        amountPaise: 4000000,
        method: "bank_transfer",
        voided: false,
        date: "2026-11-10",
        createdAt: "2026-11-10T11:00:00Z",
      },
    ];

    const pdfBytes = Buffer.from(
      "%PDF-1.4 Genuine PDF receipt file synthetic bytes for QA testing",
    );
    const pngBytes = Buffer.from("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRGenuine PNG image bytes");
    const jpegBytes = Buffer.from("\xFF\xD8\xFF\xE0\x00\x10JFIFGenuine JPEG proof bytes");

    const pdfPath = "files/payment-proofs/pay_real_1__receipt.pdf";
    const pngPath = "files/payment-proofs/pay_real_1__screenshot.png";
    const jpegPath = "files/payment-proofs/pay_real_1__bank_slip.jpg";

    const attachmentsMeta = [
      {
        attachmentId: "proof_pdf",
        paymentId: "pay_real_1",
        originalFileName: "receipt.pdf",
        mimeType: "application/pdf",
        fileSize: pdfBytes.byteLength,
        sha256: computeSha256(pdfBytes),
        path: pdfPath,
      },
      {
        attachmentId: "proof_png",
        paymentId: "pay_real_1",
        originalFileName: "screenshot.png",
        mimeType: "image/png",
        fileSize: pngBytes.byteLength,
        sha256: computeSha256(pngBytes),
        path: pngPath,
      },
      {
        attachmentId: "proof_jpg",
        paymentId: "pay_real_1",
        originalFileName: "bank_slip.jpg",
        mimeType: "image/jpeg",
        fileSize: jpegBytes.byteLength,
        sha256: computeSha256(jpegBytes),
        path: jpegPath,
      },
    ];

    const dataFiles: Record<string, unknown> = {
      "data/leads.json": { leads },
      "data/deals.json": { deals },
      "data/payments.json": { payments },
      "data/attachment-metadata.json": { attachments: attachmentsMeta },
    };

    const attachmentBytesMap: Record<string, Uint8Array> = {
      [pdfPath]: new Uint8Array(pdfBytes),
      [pngPath]: new Uint8Array(pngBytes),
      [jpegPath]: new Uint8Array(jpegBytes),
    };

    // Calculate files manifest
    const manifestFiles = [
      ...Object.entries(dataFiles).map(([p, data]) => {
        const b = strToU8(canonicalJsonStringify(data));
        return { path: p, sha256: computeSha256(b), bytes: b.byteLength };
      }),
      ...Object.entries(attachmentBytesMap).map(([p, b]) => ({
        path: p,
        sha256: computeSha256(b),
        bytes: b.byteLength,
      })),
    ];

    const financialSummary = buildFinancialSummary({ deals, payments });

    const manifest = buildManifest({
      type: "full",
      includedEntities: ["leads", "deals", "payments", "proofs"],
      counts: { leads: 2, deals: 1, payments: 1, proofs: 3 },
      files: manifestFiles,
      financialSummary,
    });

    const zipBytes = buildBackupZipArchive({
      manifest,
      dataFiles,
      attachments: attachmentBytesMap,
    });

    return { zipBytes, manifest, dataFiles, attachmentBytesMap };
  }

  it("generates a genuine ZIP archive and validates it end-to-end", async () => {
    const fixture = createRealZipFixture();
    expect(fixture.zipBytes instanceof Uint8Array).toBe(true);
    expect(fixture.zipBytes.byteLength).toBeGreaterThan(100);

    // Independent ZIP reader (unzipSync) opens it cleanly
    const unpacked = unzipSync(fixture.zipBytes);
    expect(unpacked["manifest.json"]).toBeDefined();
    expect(unpacked["data/leads.json"]).toBeDefined();
    expect(unpacked["data/deals.json"]).toBeDefined();
    expect(unpacked["data/payments.json"]).toBeDefined();
    expect(unpacked["files/payment-proofs/pay_real_1__receipt.pdf"]).toBeDefined();

    // Validation engine processes real ZIP bytes
    const report = await validateBackupArchive(fixture.zipBytes);
    expect(report.ok).toBe(true);
    expect(report.classification).toBe("complete");
    expect(report.entityCounts["leads"]).toBe(2);
    expect(report.entityCounts["deals"]).toBe(1);
    expect(report.entityCounts["payments"]).toBe(1);
    expect(report.attachmentIntegrity.found).toBe(3);
    expect(report.financialReconciliation.verified).toBe(true);
    expect(report.financialReconciliation.summary?.activePaymentsPaise).toBe(4000000);
  });

  it("detects single-byte data tampering in genuine ZIP payload", async () => {
    const fixture = createRealZipFixture();
    const unpacked = unzipSync(fixture.zipBytes);

    // Tamper single byte in data/leads.json
    const originalLeads = unpacked["data/leads.json"]!;
    const tamperedLeads = new Uint8Array(originalLeads);
    tamperedLeads[10] = tamperedLeads[10]! ^ 0xff; // Flip bits
    unpacked["data/leads.json"] = tamperedLeads;

    const tamperedZip = zipSync(unpacked);
    const report = await validateBackupArchive(tamperedZip);

    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("checksum mismatch") || e.includes("Corrupt JSON")),
    ).toBe(true);
  });

  it("detects single-byte corruption in binary attachment inside genuine ZIP", async () => {
    const fixture = createRealZipFixture();
    const unpacked = unzipSync(fixture.zipBytes);

    // Corrupt one byte of PDF proof
    const pdfPath = "files/payment-proofs/pay_real_1__receipt.pdf";
    const originalPdf = unpacked[pdfPath]!;
    const corruptedPdf = new Uint8Array(originalPdf);
    corruptedPdf[5] = corruptedPdf[5]! ^ 0xff;
    unpacked[pdfPath] = corruptedPdf;

    const tamperedZip = zipSync(unpacked);
    const report = await validateBackupArchive(tamperedZip);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("checksum mismatch"))).toBe(true);
  });

  it("blocks directory traversal attempts in ZIP entries", async () => {
    const fixture = createRealZipFixture();
    const unpacked = unzipSync(fixture.zipBytes);

    // Inject traversal entry
    unpacked["../secret_system_file.json"] = strToU8('{"hack": true}');
    const maliciousZip = zipSync(unpacked);

    const report = await validateBackupArchive(maliciousZip);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some(
        (e) => e.includes("Unsafe path traversal") || e.includes("Unexpected file"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate archive record IDs in data files", async () => {
    const fixture = createRealZipFixture();
    const unpacked = unzipSync(fixture.zipBytes);
    const duplicateIdFiles = {
      ...unpacked,
      "data/leads.json": strToU8(
        JSON.stringify({
          leads: [
            { id: "lead_1", name: "Lead 1" },
            { id: "lead_1", name: "Lead 1 Dup" },
          ],
        }),
      ),
    };
    const report = await validateBackupArchive(zipSync(duplicateIdFiles));
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Duplicate ID 'lead_1'"))).toBe(true);
  });

  it("enforces archive size and entry limits", async () => {
    const tooLarge = new Uint8Array(ARCHIVE_LIMITS.maxArchiveBytes + 1024);
    const report = await validateBackupArchive(tooLarge);

    expect(report.ok).toBe(false);
    expect(report.classification).toBe("damaged");
    expect(report.errors[0]).toContain("exceeds maximum allowable size");
  });
});
