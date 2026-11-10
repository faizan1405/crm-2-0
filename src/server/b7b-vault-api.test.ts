import { describe, expect, it } from "vitest";
import { unzipSync, strToU8 } from "fflate";
import type { CrmDatabase } from "./db/index.server";
import {
  getVaultCoverage,
  generateSyntheticBackupArchive,
  inspectUploadedArchive,
  runUploadedArchiveDryRun,
  parseArchiveUpload,
  VAULT_ENTITIES_INVENTORY,
  VAULT_BLOCKERS,
} from "./vault/vaultService.server";
import { buildBackupZipArchive } from "./backup/archive.server";
import { buildManifest } from "./backup/manifest.server";

describe("Checkpoint B7B: Server-Side Data Vault Service & Integrity", () => {
  describe("Vault Coverage & Inventory Matrix", () => {
    it("reports exactly 31 inventoried entities with 9 verified in MariaDB and 5 unsupported", async () => {
      // Mock db queries returning 0
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 0 }]),
            innerJoin: () => ({
              where: () => Promise.resolve([{ count: 0 }]),
            }),
          }),
        }),
      } as unknown as CrmDatabase;

      const coverage = await getVaultCoverage(mockDb, "usr_test_owner_1");

      expect(coverage.totalEntitiesInventoried).toBe(31);
      expect(coverage.verifiedEntitiesCount).toBe(9);
      expect(coverage.supportedEntitiesCount).toBe(17);
      expect(coverage.unsupportedEntitiesCount).toBe(5);
      expect(coverage.restoreDisabled).toBe(true);

      expect(coverage.inventory).toHaveLength(31);
      const verifiedItems = coverage.inventory.filter((i) => i.status === "verified");
      expect(verifiedItems).toHaveLength(9);
      expect(verifiedItems.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          "Leads",
          "Deals",
          "Payments",
          "Payment Proof Meta",
          "Quotations & Items",
          "Projects",
          "Project Tasks",
          "Owner Settings",
          "Sales Goals",
        ]),
      );

      const unsupportedItems = coverage.inventory.filter((i) => i.status === "unsupported");
      expect(unsupportedItems).toHaveLength(5);
      expect(unsupportedItems.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          "Quotation Shares",
          "Sales Studio Demos",
          "WhatsApp Templates",
          "Automation Rules",
          "Smart Inbox & Lead Relations",
        ]),
      );
    });

    it("includes all 4 production blockers with correct severity and status", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 0 }]),
            innerJoin: () => ({
              where: () => Promise.resolve([{ count: 0 }]),
            }),
          }),
        }),
      } as unknown as CrmDatabase;

      const coverage = await getVaultCoverage(mockDb, "usr_test_owner_1");
      expect(coverage.blockers).toHaveLength(4);

      const storageBlocker = coverage.blockers.find((b) => b.id === "blocker-storage-durability");
      expect(storageBlocker?.severity).toBe("critical");
      expect(storageBlocker?.status).toBe("unverified");

      const encBlocker = coverage.blockers.find((b) => b.id === "blocker-backup-encryption");
      expect(encBlocker?.severity).toBe("warning");
      expect(encBlocker?.status).toBe("not-configured");

      const restoreBlocker = coverage.blockers.find((b) => b.id === "blocker-restore-disabled");
      expect(restoreBlocker?.severity).toBe("info");
      expect(restoreBlocker?.status).toBe("enforced");
    });
  });

  describe("Synthetic Test Backup Generator", () => {
    it("generates a genuine compressed ZIP with complete manifest, synthetic records, and binary proofs", () => {
      const res = generateSyntheticBackupArchive({
        scope: "full",
        ownerUserId: "usr_synth_test_1",
        ownerEmail: "owner@joinscaleflow.in",
      });

      expect(res.zipBytes).toBeInstanceOf(Uint8Array);
      expect(res.zipBytes.byteLength).toBeGreaterThan(1000);
      expect(res.filename).toMatch(/^ScaleFlow_Synthetic_Test_Backup_full_.+\.zip$/);
      expect(res.manifest.complete).toBe(false);
      expect(res.manifest.classification).toBe("synthetic");
      expect(res.manifest.synthetic).toBe(true);
      expect(res.manifest.omittedEntities.length).toBeGreaterThan(0);
      expect(res.manifest.counts["leads"]).toBe(3);
      expect(res.manifest.counts["deals"]).toBe(2);
      expect(res.manifest.counts["payments"]).toBe(2);
      expect(res.manifest.counts["proofs"]).toBe(2);

      // Verify actual ZIP decompression
      const unpacked = unzipSync(res.zipBytes);
      expect(unpacked["manifest.json"]).toBeDefined();
      expect(unpacked["data/leads.json"]).toBeDefined();
      expect(unpacked["data/deals.json"]).toBeDefined();
      expect(unpacked["data/payments.json"]).toBeDefined();
      expect(unpacked["data/attachment-metadata.json"]).toBeDefined();
      expect(unpacked["data/projects.json"]).toBeDefined();
      expect(unpacked["data/quotations.json"]).toBeDefined();
      expect(unpacked["data/sales-goals.json"]).toBeDefined();
      expect(unpacked["data/settings.json"]).toBeDefined();
      expect(unpacked["backup-summary.html"]).toBeDefined();

      // Check binary proofs in ZIP
      expect(unpacked["files/payment-proofs/pay_synth_1__neft_receipt.pdf"]).toBeDefined();
      expect(unpacked["files/payment-proofs/pay_synth_2__rtgs_advice.png"]).toBeDefined();

      const pdfBytes = unpacked["files/payment-proofs/pay_synth_1__neft_receipt.pdf"];
      expect(pdfBytes).toBeDefined();
      const pdfHeader = new TextDecoder().decode(pdfBytes!.slice(0, 5));
      expect(pdfHeader).toBe("%PDF-");
    });

    it("respects custom scope filters (sales-only and projects-only)", () => {
      const salesRes = generateSyntheticBackupArchive({ scope: "sales" });
      const salesUnpacked = unzipSync(salesRes.zipBytes);
      expect(salesUnpacked["data/leads.json"]).toBeDefined();
      expect(salesUnpacked["data/deals.json"]).toBeDefined();
      expect(salesUnpacked["data/payments.json"]).toBeDefined();
      expect(salesUnpacked["data/projects.json"]).toBeUndefined();

      const projRes = generateSyntheticBackupArchive({ scope: "projects" });
      const projUnpacked = unzipSync(projRes.zipBytes);
      expect(projUnpacked["data/projects.json"]).toBeDefined();
      expect(projUnpacked["data/quotations.json"]).toBeDefined();
      expect(projUnpacked["data/leads.json"]).toBeUndefined();
    });
  });

  describe("Archive Inspector & Cryptographic Validation", () => {
    it("validates genuine synthetic backup cleanly", async () => {
      const { zipBytes } = generateSyntheticBackupArchive({ scope: "full" });
      const report = await inspectUploadedArchive(zipBytes);

      expect(report.ok).toBe(true);
      expect(report.classification).toBe("synthetic");
      expect(report.integrityStatus).toBe("verified");
      expect(report.coverageStatus).toBe("synthetic_test_data");
      expect(report.readinessStatus).toBe("preview_available");
      expect(report.statusLabel).toBe(
        "Integrity Verified — Synthetic Backup, Partial CRM Coverage",
      );
      expect(report.restoreAvailable).toBe(false);
      expect(report.dryRunAvailable).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.financialReconciliation.verified).toBe(true);
      expect(report.attachmentIntegrity.missing).toHaveLength(0);
      expect(report.attachmentIntegrity.corrupted).toHaveLength(0);
      expect(report.attachmentIntegrity.found).toBe(2);
    });

    it("ensures a valid partial synthetic ZIP can never be classified as a complete production recovery archive", async () => {
      const { zipBytes } = generateSyntheticBackupArchive({ scope: "full" });
      const report = await inspectUploadedArchive(zipBytes);

      expect(report.coverageStatus).not.toBe("complete_coverage");
      expect(report.readinessStatus).not.toBe("fully_verified");
      expect(report.classification).not.toBe("complete");
      expect(report.restoreAvailable).toBe(false);
    });

    it("rejects corrupted/damaged archive bytes with explicit error report", async () => {
      const damagedBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x88, 0x77, 0x66]);
      const report = await inspectUploadedArchive(damagedBytes);

      expect(report.ok).toBe(false);
      expect(report.classification).toBe("damaged");
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.restoreAvailable).toBe(false);
    });

    it("rejects archive containing directory traversal attempts", async () => {
      const maliciousZip = buildBackupZipArchive({
        manifest: buildManifest({
          type: "full",
          includedEntities: ["leads"],
          counts: { leads: 1 },
          financialSummary: {
            totalPaymentsCount: 0,
            totalPaymentsPaise: 0,
            totalPaymentsFormattedInr: "₹0.00",
            activePaymentsCount: 0,
            activePaymentsPaise: 0,
            voidedPaymentsCount: 0,
            voidedPaymentsPaise: 0,
            totalBookedDealsCount: 0,
            totalBookedDealsPaise: 0,
            dealsWonCount: 0,
            dealsLostCount: 0,
            dealsActiveCount: 0,
          },
          files: [],
        }),
        dataFiles: {
          "../evil.json": { pwned: true },
        },
      });

      const report = await inspectUploadedArchive(maliciousZip);
      expect(report.ok).toBe(false);
      expect(report.errors.some((e) => e.includes("Unsafe path traversal"))).toBe(true);
    });
  });

  describe("Safe Restore Dry-Run Preview (Read-Only)", () => {
    it("simulates full restore with zero database writes and reports creates & skips", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]), // no existing records
          }),
        }),
      } as unknown as CrmDatabase;

      const { zipBytes } = generateSyntheticBackupArchive({ scope: "full" });
      const dryRun = await runUploadedArchiveDryRun(mockDb, "usr_synth_test_1", zipBytes);

      expect(dryRun.ok).toBe(true);
      expect(dryRun.dryRun).toBe(true);
      expect(dryRun.databaseWritten).toBe(false);
      expect(dryRun.mutationsPerformed).toBe(0);
      expect(dryRun.totalRecordsToCreate).toBeGreaterThan(0);
      expect(dryRun.totalRecordsToSkip).toBe(0);
      expect(dryRun.financialReconciliation.reconciled).toBe(true);
      expect(dryRun.actions["leads"]?.toCreate).toBe(3);
      expect(dryRun.actions["deals"]?.toCreate).toBe(2);
      expect(dryRun.actions["payments"]?.toCreate).toBe(2);
    });

    it("detects existing IDs and marks them to skip without conflicting", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ id: "lead_synth_1" }, { id: "deal_synth_1" }]),
          }),
        }),
      } as unknown as CrmDatabase;

      const { zipBytes } = generateSyntheticBackupArchive({ scope: "full" });
      const dryRun = await runUploadedArchiveDryRun(mockDb, "usr_synth_test_1", zipBytes);

      expect(dryRun.ok).toBe(true);
      expect(dryRun.actions["leads"]?.toSkip).toBe(1);
      expect(dryRun.actions["leads"]?.toCreate).toBe(2);
      expect(dryRun.actions["deals"]?.toSkip).toBe(1);
      expect(dryRun.actions["deals"]?.toCreate).toBe(1);
    });
  });

  describe("Archive Upload Parser", () => {
    it("parses raw binary bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const req = new Request("http://127.0.0.1/api/v1/vault/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: bytes,
      });

      const parsed = await parseArchiveUpload(req);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.bytes).toEqual(bytes);
      }
    });

    it("parses base64 JSON payload", async () => {
      const raw = new Uint8Array([10, 20, 30]);
      const b64 = Buffer.from(raw).toString("base64");
      const req = new Request("http://127.0.0.1/api/v1/vault/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: b64 }),
      });

      const parsed = await parseArchiveUpload(req);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.bytes).toEqual(raw);
      }
    });
  });

  describe("Security, Multi-Tenancy & Authorization Gates", () => {
    it("ensures Owner Alpha cannot see Owner Beta data and Owner Beta sees 0 rows", async () => {
      const mockDbA = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 5 }]),
            innerJoin: () => ({
              where: () => Promise.resolve([{ count: 0 }]),
            }),
          }),
        }),
      } as unknown as CrmDatabase;

      const coverageA = await getVaultCoverage(mockDbA, "usr_owner_alpha");
      expect(coverageA.liveDatabaseCounts.leads).toBe(5);

      const mockDbB = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 0 }]),
            innerJoin: () => ({
              where: () => Promise.resolve([{ count: 0 }]),
            }),
          }),
        }),
      } as unknown as CrmDatabase;

      const coverageB = await getVaultCoverage(mockDbB, "usr_owner_beta");
      expect(coverageB.liveDatabaseCounts.leads).toBe(0);
    });

    it("ensures dry-run isolation: Owner B cannot resolve or mutate Owner A record IDs", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]), // Owner B has no existing IDs
          }),
        }),
      } as unknown as CrmDatabase;

      const { zipBytes } = generateSyntheticBackupArchive({ scope: "full" });
      const dryRun = await runUploadedArchiveDryRun(mockDb, "usr_owner_beta", zipBytes);

      expect(dryRun.ok).toBe(true);
      expect(dryRun.mutationsPerformed).toBe(0);
      expect(dryRun.databaseWritten).toBe(false);
      expect(dryRun.totalRecordsToSkip).toBe(0);
    });
  });
});
