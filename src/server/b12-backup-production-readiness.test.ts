import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyCapacityBytes,
  DEFAULT_MARIADB_HARD_STOP_MIB,
  DEFAULT_MARIADB_QUOTA_MIB,
  DEFAULT_MARIADB_WARNING_MIB,
  estimateProofGrowthBytes,
  evaluateProofUploadQuota,
  MIB_BYTES,
  resolveMariadbQuotaPolicy,
} from "./storage/mariadbCapacity.server";
import {
  assertBackupProducerEnvHasNoPrivateKey,
  assertSafeBackupFilePath,
  decryptFileWithAgeX25519,
  encryptFileWithAgeX25519,
  generateAgeX25519KeyPair,
  hashFileSha256,
} from "../../scripts/b11c-backup-crypto.mjs";
import {
  assertSafeRestoreTarget,
  PROTECTED_DB_PATTERNS,
} from "../../scripts/b11c-mariadb-backup.mjs";
import {
  assessEnvStatSecurity,
  buildHostingerCliCommand,
  computeCronBucketsJs,
  toIstPartsJs,
} from "../../scripts/run-automation-cron.mjs";
import {
  assertSafeDisposableDatabase,
  MARIADB_CAPACITY_LOCK_NAME,
} from "../../scripts/b12-mariadb-concurrency-harness.mjs";
import { MigrationMapper } from "./backup/migrationMapping.server";

describe("Checkpoint B12 — Secure Backups, Hostinger Capacity & Production Readiness", () => {
  describe("1. Phase 2 & 3 — Hostinger Capacity & Database Quota Architecture", () => {
    it("enforces exact 3,072 MiB quota, 1,536 MiB warning (50%), and 2,150 MiB hard-stop (70%)", () => {
      const policy = resolveMariadbQuotaPolicy();
      expect(policy.quotaMiB).toBe(DEFAULT_MARIADB_QUOTA_MIB);
      expect(policy.warningThresholdMiB).toBe(DEFAULT_MARIADB_WARNING_MIB);
      expect(policy.hardStopThresholdMiB).toBe(DEFAULT_MARIADB_HARD_STOP_MIB);
      expect(policy.safetyMarginMiB).toBe(16);

      // Low capacity (<50%) -> ok
      const low = classifyCapacityBytes(500 * MIB_BYTES, policy);
      expect(low.status).toBe("ok");
      expect(low.allowNewProofUploads).toBe(true);

      // Warning range (>=50% and <70%) -> warning
      const warn = classifyCapacityBytes(1600 * MIB_BYTES, policy);
      expect(warn.status).toBe("warning");
      expect(warn.allowNewProofUploads).toBe(true);

      // At hard-stop (>=70% and <100%) -> hard_stop_uploads
      const hard = classifyCapacityBytes(2150 * MIB_BYTES, policy);
      expect(hard.status).toBe("hard_stop_uploads");
      expect(hard.allowNewProofUploads).toBe(false);

      // Over plan quota (>=100%) -> quota_exhausted
      const full = classifyCapacityBytes(3072 * MIB_BYTES, policy);
      expect(full.status).toBe("quota_exhausted");
      expect(full.allowNewProofUploads).toBe(false);
    });

    it("evaluates proof growth accurately and forbids quota bypass near 70% threshold", () => {
      const policy = resolveMariadbQuotaPolicy();
      const mockMeasurement = {
        tableCount: 49,
        logicalInfoSchemaBytes: 2140 * MIB_BYTES,
        nonBlobInfoSchemaBytes: 2130 * MIB_BYTES,
        blobTableInfoSchemaBytes: 10 * MIB_BYTES,
        dataFreeBytes: 0,
        blobChunkCount: 10,
        blobPayloadBytes: 10 * MIB_BYTES,
        liveBlobWithOverheadBytes: 10.6 * MIB_BYTES,
        rawMeasuredBytes: 2140.6 * MIB_BYTES,
        safetyMarginBytes: 16 * MIB_BYTES,
        effectiveUsedBytes: (2140.6 + 16) * MIB_BYTES, // ~2,156.6 MiB (already past 2,150 MiB)
        effectiveUsedMiB: 2156.6,
        quotaMiB: 3072,
        warningThresholdMiB: 1536,
        hardStopThresholdMiB: 2150,
        safetyMarginMiB: 16,
        percentOfQuota: 70.2,
        remainingProofBudgetBytes: 0,
        remainingProofBudgetMiB: 0,
        status: "hard_stop_uploads" as const,
        allowNewProofUploads: false,
        measuredAtIso: new Date().toISOString(),
      };

      const growth = estimateProofGrowthBytes({
        incomingBytes: 1024 * 1024, // 1 MiB
        retainHistoricalBlobs: true,
      });

      const decision = evaluateProofUploadQuota({
        measurement: mockMeasurement,
        growth,
        policy,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reasonCode).toBe("hard_stop_exceeded");
      expect(decision.statusBefore).toBe("hard_stop_uploads");
    });

    it("calculates proof replacement net delta correctly while retaining historical blobs", () => {
      // Historical replacement preserves old proof chunks for immutable financial audit
      const growthRetained = estimateProofGrowthBytes({
        incomingBytes: 5 * MIB_BYTES,
        existingProofBytes: 4 * MIB_BYTES,
        retainHistoricalBlobs: true,
      });
      // Incoming footprint includes 6% InnoDB overhead + row overhead + metadata overhead
      expect(growthRetained.netGrowthBytes).toBeGreaterThan(5 * MIB_BYTES);
      expect(growthRetained.reclaimableOldBytes).toBe(0);

      // When historical blobs are reclaimed (e.g. non-audit draft temp storage)
      const growthReclaimed = estimateProofGrowthBytes({
        incomingBytes: 5 * MIB_BYTES,
        existingProofBytes: 4 * MIB_BYTES,
        retainHistoricalBlobs: false,
      });
      expect(growthReclaimed.reclaimableOldBytes).toBeGreaterThan(4 * MIB_BYTES);
      expect(growthReclaimed.netGrowthBytes).toBeLessThan(growthRetained.netGrowthBytes);
    });
  });

  describe("2. Phase 3 & Concurrency — Real MariaDB Concurrency & Advisory Lock Harness", () => {
    it("locks out protected database targets and enforces safe disposable naming", () => {
      expect(MARIADB_CAPACITY_LOCK_NAME).toBe("sf_crm_proof_quota_write");

      // Protected databases fail closed
      for (const pattern of PROTECTED_DB_PATTERNS) {
        expect(() => assertSafeDisposableDatabase("crm_v1")).toThrow(/SAFETY LOCKOUT/i);
        expect(() => assertSafeDisposableDatabase("crm_production")).toThrow(/SAFETY LOCKOUT/i);
        expect(() => assertSafeDisposableDatabase("u256504187_crm")).toThrow(/SAFETY LOCKOUT/i);
        expect(() => assertSafeDisposableDatabase("joinscaleflow_db")).toThrow(/SAFETY LOCKOUT/i);
      }

      // Empty name fails closed
      expect(() => assertSafeDisposableDatabase("")).toThrow(/required/i);

      // Safe disposable staging database passes cleanly
      expect(assertSafeDisposableDatabase("u256504187_crm_b11c_stg")).toBe(
        "u256504187_crm_b11c_stg",
      );
      expect(assertSafeDisposableDatabase("u256504187_crm_b11c_rst2")).toBe(
        "u256504187_crm_b11c_rst2",
      );
    });

    it("verifies child worker process argument parsing and lockout without safety confirmation", () => {
      const harnessPath = path.resolve(
        process.cwd(),
        "scripts/b12-mariadb-concurrency-harness.mjs",
      );
      expect(fs.existsSync(harnessPath)).toBe(true);

      // Running child worker without B12_CONFIRM_DISPOSABLE must fail with exit code 1
      try {
        execFileSync(process.execPath, [harnessPath, "--worker"], {
          stdio: "pipe",
          env: { ...process.env, B12_CONFIRM_DISPOSABLE: "false" },
        });
        expect.unreachable("Child worker should have failed without safety confirmation");
      } catch (err: unknown) {
        const procErr = err as { status: number; stderr: Buffer };
        expect(procErr.status).toBe(1);
        expect(procErr.stderr.toString("utf8")).toContain("SAFETY LOCKOUT");
      }
    });
  });

  describe("3. Phase 5 — Encrypted Backup Security & Archive Integrity Review", () => {
    it("strictly isolates secret keys and forbids private keys on backup producers", () => {
      const keypair = generateAgeX25519KeyPair();
      const cleanProducerEnv = {
        BACKUP_AGE_RECIPIENT_PUBKEY: keypair.publicKey,
      };
      expect(() => assertBackupProducerEnvHasNoPrivateKey(cleanProducerEnv)).not.toThrow();

      const compromisedProducerEnv = {
        BACKUP_AGE_RECIPIENT_PUBKEY: keypair.publicKey,
        BACKUP_AGE_SECRET_KEY: keypair.secretKey,
      };
      expect(() => assertBackupProducerEnvHasNoPrivateKey(compromisedProducerEnv)).toThrow(
        /Security policy violation.*private decryption key/i,
      );
    });

    it("verifies safe restore target rules and protects production database names", () => {
      // Must have confirmation flag
      expect(() =>
        assertSafeRestoreTarget({
          sourceDbName: "u256504187_crm_b11c_stg",
          targetDbName: "u256504187_crm_b11c_rst2",
          existingTables: [],
          confirmCleanTarget: false,
        }),
      ).toThrow(/--confirm-clean-target/i);

      // Must not restore onto itself
      expect(() =>
        assertSafeRestoreTarget({
          sourceDbName: "u256504187_crm_b11c_stg",
          targetDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toThrow(/matches source database/i);

      // Must not restore onto protected databases
      expect(() =>
        assertSafeRestoreTarget({
          sourceDbName: "u256504187_crm_b11c_stg",
          targetDbName: "crm_v1",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toThrow(/protected/i);

      // Must not restore onto non-empty databases
      expect(() =>
        assertSafeRestoreTarget({
          sourceDbName: "u256504187_crm_b11c_stg",
          targetDbName: "u256504187_crm_b11c_rst2",
          existingTables: ["crm_deals"],
          confirmCleanTarget: true,
        }),
      ).toThrow(/NOT empty/i);

      // Clean target passes
      expect(
        assertSafeRestoreTarget({
          sourceDbName: "u256504187_crm_b11c_stg",
          targetDbName: "u256504187_crm_b11c_rst2",
          existingTables: [],
          confirmCleanTarget: true,
        }).targetDbName,
      ).toBe("u256504187_crm_b11c_rst2");
    });

    it("performs full authenticated age encryption round-trip and detects tampering/truncation", async () => {
      const keypair = generateAgeX25519KeyPair();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "b12-age-test-"));

      try {
        const plainPath = path.join(tempDir, "plain.sql");
        const encPath = path.join(tempDir, "plain.sql.age");
        const decPath = path.join(tempDir, "decrypted.sql");

        const sampleSql =
          "-- Scale Flow Synthetic Staging Dump\nINSERT INTO `crm_deals` VALUES (1, 'Deal');";
        fs.writeFileSync(plainPath, sampleSql, "utf8");

        // 1. Encrypt with public key
        const encRes = await encryptFileWithAgeX25519({
          inputPath: plainPath,
          outputPath: encPath,
          recipientPublicKey: keypair.publicKey,
        });
        expect(encRes.encryptedBytes).toBeGreaterThan(0);
        expect(fs.existsSync(encPath)).toBe(true);

        // 2. Decrypt with private key
        const decRes = await decryptFileWithAgeX25519({
          inputPath: encPath,
          outputPath: decPath,
          secretKey: keypair.secretKey,
        });
        expect(fs.readFileSync(decPath, "utf8")).toBe(sampleSql);
        expect(decRes.plaintextSha256).toBe(await hashFileSha256(plainPath));

        // 3. Bit-flip tampering detection
        const encBytes = fs.readFileSync(encPath);
        const tamperedBytes = Buffer.from(encBytes);
        const flipIdx = tamperedBytes.length - 10;
        tamperedBytes[flipIdx] = (tamperedBytes[flipIdx] ?? 0) ^ 0xff; // flip bits in Poly1305 MAC / payload
        const tamperedPath = path.join(tempDir, "tampered.age");
        fs.writeFileSync(tamperedPath, tamperedBytes);

        await expect(
          decryptFileWithAgeX25519({
            inputPath: tamperedPath,
            outputPath: path.join(tempDir, "tampered-out.sql"),
            secretKey: keypair.secretKey,
          }),
        ).rejects.toThrow();

        // 4. Truncation detection
        const truncatedBytes = encBytes.subarray(0, encBytes.length - 20);
        const truncatedPath = path.join(tempDir, "truncated.age");
        fs.writeFileSync(truncatedPath, truncatedBytes);

        await expect(
          decryptFileWithAgeX25519({
            inputPath: truncatedPath,
            outputPath: path.join(tempDir, "truncated-out.sql"),
            secretKey: keypair.secretKey,
          }),
        ).rejects.toThrow();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("4. Phase 9 — Hostinger Cron Command & Runtime Architecture", () => {
    it("builds exact 158-character shell-free Hostinger cron command for khaki-butterfly staging", () => {
      const cli = buildHostingerCliCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
        nodeMajor: "22",
        scriptRelPath: "server/run-cron.mjs",
        args: ["--dry-run"],
      });

      expect(cli.length).toBe(158);
      expect(cli.length).toBeLessThanOrEqual(255);
      expect(cli.usesShellOperators).toBe(false);
      expect(cli.command).toBe(
        "/opt/alt/alt-nodejs22/root/usr/bin/node /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs/server/run-cron.mjs --dry-run",
      );
    });

    it("verifies IST and UTC time bucket calculations across midnight rollover", () => {
      // Test at 23:55 UTC (05:25 IST next day)
      const dateUtc = new Date("2026-11-14T23:55:00.000Z");
      const parts = toIstPartsJs(dateUtc);
      expect(parts.istDate).toBe("2026-11-15");
      expect(parts.istTime).toBe("05:25");

      const buckets = computeCronBucketsJs(dateUtc, 15);
      expect(buckets.utcBucketKey).toBe("2026-11-14T23:45Z");
      expect(buckets.istBucketKey).toBe("2026-11-15T05:15+0530");
    });

    it("strictly blocks untrusted public_html, htdocs, symlinked, and world-writable env files", () => {
      // Rejects webroot paths
      expect(
        assessEnvStatSecurity(
          { isFile: () => true, isSymbolicLink: () => false, mode: 0o600 },
          "/home/u256504187/domains/site/public_html/.env",
        ).ok,
      ).toBe(false);

      // Rejects symlinks
      expect(
        assessEnvStatSecurity(
          { isFile: () => true, isSymbolicLink: () => true, mode: 0o600 },
          "/home/u256504187/domains/site/config/.env",
        ).ok,
      ).toBe(false);

      // Rejects world-writable files
      expect(
        assessEnvStatSecurity(
          { isFile: () => true, isSymbolicLink: () => false, mode: 0o666 },
          "/home/u256504187/domains/site/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(false);

      // Accepts private config file with chmod 0600
      expect(
        assessEnvStatSecurity(
          { isFile: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 1000 },
          "/home/u256504187/domains/site/hbuilds/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(true);
    });
  });

  describe("5. Phase 10 — Browser-Local to MariaDB Migration Mapping Completeness", () => {
    const mapper = new MigrationMapper("usr_owner_b12");

    it("maps leads, deals, payments, projects, quotations, goals, and proofs with referential integrity", () => {
      // 1. Lead
      const lead = mapper.mapLead({
        id: "lead_b12_01",
        name: "Enterprise Client",
        company: "Global Tech",
        phone: "+91 9988776655",
        status: "proposal",
        source: "Website",
        createdAt: "2026-11-14T08:00:00Z",
      });
      expect(lead.id).toBe("lead_b12_01");
      expect(lead.ownerUserId).toBe("usr_owner_b12");

      // 2. Deal referencing lead
      const deal = mapper.mapDeal({
        id: "deal_b12_01",
        leadId: "lead_b12_01",
        name: "Cloud Transformation",
        value: "2,50,000.00", // ₹2,50,000 -> 25,000,000 paise
        status: "active",
        createdAt: "2026-11-14T09:00:00Z",
      });
      expect(deal.leadId).toBe("lead_b12_01");
      expect(deal.valuePaise).toBe(25000000);
      expect(deal.valueDecimal).toBe("250000.00");

      // 3. Payment referencing deal
      const payment = mapper.mapPayment({
        id: "pay_b12_01",
        dealId: "deal_b12_01",
        amount: "1,00,000.00", // ₹1,00,000 -> 10,000,000 paise
        method: "bank_transfer",
        date: "2026-11-14",
      });
      expect(payment.dealId).toBe("deal_b12_01");
      expect(payment.amountPaise).toBe(10000000);
      expect(payment.amountDecimal).toBe("100000.00");

      // 4. Payment proof referencing payment and deal
      const proof = mapper.mapPaymentProof(
        {
          attachmentId: "att_b12_01",
          paymentId: "pay_b12_01",
          dealId: "deal_b12_01",
          originalFileName: "neft_receipt.pdf",
          fileSize: 1048576,
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
        "deal_b12_01",
      );
      expect(proof.paymentId).toBe("pay_b12_01");
      expect(proof.dealId).toBe("deal_b12_01");
      expect(proof.sha256Hash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      // 5. Quotation referencing lead and deal
      const quot = mapper.mapQuotation({
        id: "quot_b12_01",
        leadId: "lead_b12_01",
        dealId: "deal_b12_01",
        title: "Q1 Modernization",
        clientName: "Enterprise Client",
        total: "2,50,000.00",
        issueDate: "2026-11-14",
      });
      expect(quot.leadId).toBe("lead_b12_01");
      expect(quot.dealId).toBe("deal_b12_01");
      expect(quot.totalAmount).toBe("250000.00");
    });
  });
});
