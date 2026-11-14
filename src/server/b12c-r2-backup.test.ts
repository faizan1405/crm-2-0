import { describe, expect, it, vi } from "vitest";
import {
  assertR2Configured,
  buildR2Endpoint,
  CloudflareR2Client,
  DEFAULT_R2_REGION,
  parseS3ListObjectsV2Xml,
  resolveR2Config,
  retryWithBackoff,
  signR2Request,
} from "../../scripts/b12c-r2-client.mjs";
import {
  assertMetaJsonIsSecretFree,
  DEFAULT_RETENTION_DAYS,
  evaluateRetentionPruning,
  parseArchiveTimestamp,
  promoteVerifiedBaselineToR2,
} from "../../scripts/b12c-r2-backup-engine.mjs";
import {
  assertBackupProducerEnvHasNoPrivateKey,
  assertNoPrivateKeyInDotEnv,
  decryptFileWithAgeX25519,
  encryptFileWithAgeX25519,
  generateAgeX25519KeyPair,
} from "../../scripts/b11c-backup-crypto.mjs";
import {
  evaluateBackupHealth,
  STALE_BACKUP_THRESHOLD_HOURS,
  type BackupHealthState,
} from "./backup/backupHealth.server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Checkpoint B12C — Cloudflare R2 Automated Encrypted Backups", () => {
  describe("1. Cloudflare R2 Client & SigV4 Protocol Verification", () => {
    it("resolves and asserts configuration from environment variables", () => {
      const emptyConfig = resolveR2Config({});
      expect(emptyConfig.region).toBe(DEFAULT_R2_REGION);
      expect(emptyConfig.bucketName).toBe("scaleflow-crm-backups");
      expect(() => assertR2Configured(emptyConfig)).toThrow(/missing environment variable/i);

      const validConfig = resolveR2Config({
        CLOUDFLARE_ACCOUNT_ID: "abc123def456",
        R2_ACCESS_KEY_ID: "key_id_789",
        R2_SECRET_ACCESS_KEY: "secret_val_xyz",
        R2_BUCKET_NAME: "scaleflow-crm-backups",
      });
      expect(() => assertR2Configured(validConfig)).not.toThrow();
      expect(buildR2Endpoint(validConfig)).toBe("https://abc123def456.r2.cloudflarestorage.com");
    });

    it("generates valid AWS Signature Version 4 headers for R2 S3 API", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const signed = signR2Request({
        method: "PUT",
        url: "https://abc123def456.r2.cloudflarestorage.com/scaleflow-crm-backups/test.txt",
        headers: {
          "content-type": "text/plain",
        },
        body: Buffer.from("hello world"),
        accessKeyId: "mock_key_id",
        secretAccessKey: "mock_secret_key",
        region: "auto",
        now,
      });

      expect(signed["host"]).toBe("abc123def456.r2.cloudflarestorage.com");
      expect(signed["x-amz-date"]).toBe("20261114T120000Z");
      expect(signed["x-amz-content-sha256"]).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
      expect(signed["authorization"]).toMatch(
        /^AWS4-HMAC-SHA256 Credential=mock_key_id\/20261114\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[a-f0-9]{64}$/,
      );
    });

    it("parses S3 ListObjectsV2 XML response with zero dependencies", () => {
      const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>scaleflow-crm-backups</Name>
    <Prefix>backups/</Prefix>
    <KeyCount>2</KeyCount>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>backups/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age</Key>
        <LastModified>2026-11-14T10:01:00.000Z</LastModified>
        <ETag>"etag123"</ETag>
        <Size>15000000</Size>
    </Contents>
    <Contents>
        <Key>backups/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age.manifest.age</Key>
        <LastModified>2026-11-14T10:01:05.000Z</LastModified>
        <ETag>"etag456"</ETag>
        <Size>2048</Size>
    </Contents>
</ListBucketResult>`;

      const parsed = parseS3ListObjectsV2Xml(mockXml);
      expect(parsed.isTruncated).toBe(false);
      expect(parsed.nextContinuationToken).toBeNull();
      expect(parsed.objects).toHaveLength(2);
      expect(parsed.objects[0]!.key).toBe(
        "backups/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age",
      );
      expect(parsed.objects[0]!.size).toBe(15000000);
      expect(parsed.objects[0]!.etag).toBe("etag123");
    });

    it("executes R2 operations via fetch with mocked responses", async () => {
      const config = {
        accountId: "test_account",
        accessKeyId: "test_key",
        secretAccessKey: "test_secret",
        bucketName: "test-bucket",
        region: "auto",
        endpointOverride: "",
      };
      const client = new CloudflareR2Client(config);

      // Test PutObject
      const mockFetchPut = vi.fn<typeof fetch>(async (_url, init) => {
        expect(init?.method).toBe("PUT");
        return new Response("", {
          status: 200,
          headers: { etag: '"etag_put_success"' },
        });
      });

      const putRes = await client.putObject({
        key: "backups/test.age",
        body: Buffer.from("encrypted payload"),
        fetchImpl: mockFetchPut,
      });
      expect(putRes.ok).toBe(true);
      expect(putRes.etag).toBe("etag_put_success");

      // Test HeadObject (Found)
      const mockFetchHead = vi.fn<typeof fetch>(async () => {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "1024",
            etag: '"etag_head_success"',
            "last-modified": "Sat, 14 Nov 2026 12:00:00 GMT",
          },
        });
      });
      const headRes = await client.headObject({
        key: "backups/test.age",
        fetchImpl: mockFetchHead,
      });
      expect(headRes.exists).toBe(true);
      expect(headRes.contentLength).toBe(1024);

      // Test HeadObject (404 Not Found)
      const mockFetchHead404 = vi.fn<typeof fetch>(async () => {
        return new Response(null, { status: 404 });
      });
      const head404Res = await client.headObject({
        key: "backups/missing.age",
        fetchImpl: mockFetchHead404,
      });
      expect(head404Res.exists).toBe(false);
      expect(head404Res.status).toBe(404);
    });
  });

  describe("2. Retention Policy & Solitary Archive Protection", () => {
    it("parses ISO timestamp from standard backup key correctly", () => {
      const key = "backups/crm-v2-backup-2026-11-14T10-30-00-000Z-abc123.sql.gz.age";
      const ts = parseArchiveTimestamp(key);
      expect(ts).not.toBeNull();
      expect(ts?.toISOString()).toBe("2026-11-14T10:30:00.000Z");
    });

    it("NEVER prunes when only 1 archive exists, even if older than retention threshold", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      // 60 days old backup (past 30 day threshold)
      const singleOldBackup = [
        {
          key: "backups/crm-v2-backup-2026-09-14T12-00-00-000Z.sql.gz.age",
          size: 15000000,
          lastModified: "2026-09-14T12:00:00.000Z",
          etag: "etag1",
        },
      ];

      const result = evaluateRetentionPruning({
        objects: singleOldBackup,
        retentionDays: 30,
        now,
      });

      // Crucial safeguard: preservedCount must be 1, candidatesToPrune must be empty!
      expect(result.candidatesToPrune).toHaveLength(0);
      expect(result.preservedCount).toBe(1);
      expect(result.reason).toBe("single_valid_backup_safeguard");
    });

    it("identifies expired archives beyond 30 days while preserving newest unconditionally", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const objects = [
        // 1. Fresh backup (today)
        {
          key: "backups/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age",
          size: 17000000,
          lastModified: "2026-11-14T10:00:00.000Z",
          etag: "fresh",
        },
        // 2. Active backup (10 days old)
        {
          key: "backups/crm-v2-backup-2026-11-04T10-00-00-000Z.sql.gz.age",
          size: 16500000,
          lastModified: "2026-11-04T10:00:00.000Z",
          etag: "active",
        },
        // 3. Expired backup (35 days old)
        {
          key: "backups/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age",
          size: 16000000,
          lastModified: "2026-10-10T10:00:00.000Z",
          etag: "expired1",
        },
        // 4. Expired backup (45 days old)
        {
          key: "backups/crm-v2-backup-2026-09-30T10-00-00-000Z.sql.gz.age",
          size: 15500000,
          lastModified: "2026-09-30T10:00:00.000Z",
          etag: "expired2",
        },
      ];

      const result = evaluateRetentionPruning({
        objects,
        retentionDays: DEFAULT_RETENTION_DAYS,
        now,
      });

      expect(result.preservedCount).toBe(2); // fresh + active
      expect(result.newestPreservedKey).toBe(
        "backups/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age",
      );
      expect(result.candidatesToPrune).toHaveLength(2);

      // Verify companion files are scheduled for deletion
      expect(result.candidatesToPrune[0]!.keysToDelete).toContain(
        "backups/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age",
      );
      expect(result.candidatesToPrune[0]!.keysToDelete).toContain(
        "backups/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age.manifest.age",
      );
      expect(result.candidatesToPrune[0]!.keysToDelete).toContain(
        "backups/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age.meta.json",
      );
    });
  });

  describe("3. Encryption Key Custody & Security Policy", () => {
    it("generates standard age v1 X25519 keypair and verifies custody policy", () => {
      const keypair = generateAgeX25519KeyPair();
      expect(keypair.publicKey).toMatch(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
      expect(keypair.secretKey).toMatch(/^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/);

      // Safe producer env has public key only
      expect(() =>
        assertBackupProducerEnvHasNoPrivateKey({
          BACKUP_AGE_RECIPIENT_PUBKEY: keypair.publicKey,
        }),
      ).not.toThrow();

      // Producer env with private key must throw
      expect(() =>
        assertBackupProducerEnvHasNoPrivateKey({
          BACKUP_AGE_RECIPIENT_PUBKEY: keypair.publicKey,
          BACKUP_AGE_SECRET_KEY: keypair.secretKey,
        }),
      ).toThrow(/Security policy violation.*private decryption key/i);
    });

    it("verifies encrypted roundtrip and detects ciphertext corruption", async () => {
      const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-crypto-test-"));
      try {
        const keypair = generateAgeX25519KeyPair();
        const plaintextPath = path.join(stageDir, "test.txt");
        const encryptedPath = path.join(stageDir, "test.txt.age");
        const decryptedPath = path.join(stageDir, "test-dec.txt");

        const originalText = "CRITICAL CRM FINANCIAL LEDGER AUDIT DATA";
        fs.writeFileSync(plaintextPath, originalText, "utf8");

        await encryptFileWithAgeX25519({
          inputPath: plaintextPath,
          outputPath: encryptedPath,
          recipientPublicKey: keypair.publicKey,
        });

        // 1. Clean decryption succeeds
        await decryptFileWithAgeX25519({
          inputPath: encryptedPath,
          outputPath: decryptedPath,
          secretKey: keypair.secretKey,
        });
        expect(fs.readFileSync(decryptedPath, "utf8")).toBe(originalText);

        // 2. Corrupted ciphertext fails with authentication error
        const corruptedPath = path.join(stageDir, "corrupted.age");
        const encBytes = fs.readFileSync(encryptedPath);
        // Tamper with payload byte after header
        encBytes[encBytes.length - 20] = encBytes[encBytes.length - 20]! ^ 0xff;
        fs.writeFileSync(corruptedPath, encBytes);

        const badDecPath = path.join(stageDir, "bad-dec.txt");
        await expect(
          decryptFileWithAgeX25519({
            inputPath: corruptedPath,
            outputPath: badDecPath,
            secretKey: keypair.secretKey,
          }),
        ).rejects.toThrow();
      } finally {
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
    });
  });

  describe("4. Operational Monitoring & Disaster Recovery Health Evaluation", () => {
    it("enforces rule: 'A successful upload alone must not count as a verified recovery'", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const stateWithUploadOnly: BackupHealthState = {
        lastSuccessfulBackupAt: "2026-11-14T10:00:00.000Z",
        lastSuccessfulOffsiteUploadAt: "2026-11-14T10:05:00.000Z",
        lastVerifiedRestoreAt: null, // No verified restore drill has been completed!
        lastArchiveSizeBytes: 17258336,
        lastArchiveSha256: "abc123sha",
        lastArchiveKey: "backups/crm-v2-backup-1.sql.gz.age",
        lastError: null,
        lastErrorAt: null,
        totalArchivesTracked: 1,
        estimatedR2StorageMiB: 16.46,
      };

      const report = evaluateBackupHealth(stateWithUploadOnly, now);
      expect(report.recoveryVerified).toBe(false);
      expect(report.status).toBe("warning");
      expect(report.requiredOwnerAction).toMatch(/clean-target restore drill is PENDING/i);
    });

    it("evaluates healthy status when both off-site upload and restore drill are verified", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const verifiedState: BackupHealthState = {
        lastSuccessfulBackupAt: "2026-11-14T10:00:00.000Z",
        lastSuccessfulOffsiteUploadAt: "2026-11-14T10:05:00.000Z",
        lastVerifiedRestoreAt: "2026-11-14T11:00:00.000Z",
        lastArchiveSizeBytes: 17258336,
        lastArchiveSha256: "abc123sha",
        lastArchiveKey: "backups/crm-v2-backup-1.sql.gz.age",
        lastError: null,
        lastErrorAt: null,
        totalArchivesTracked: 5,
        estimatedR2StorageMiB: 82.3,
      };

      const report = evaluateBackupHealth(verifiedState, now);
      expect(report.status).toBe("healthy");
      expect(report.recoveryVerified).toBe(true);
      expect(report.isStale).toBe(false);
      expect(report.backupAgeHours).toBe(2);
      expect(report.requiredOwnerAction).toBe(
        "None. Off-site backup automation is operating normally.",
      );
    });

    it("flags stale backups when age exceeds 26 hours", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const staleState: BackupHealthState = {
        lastSuccessfulBackupAt: "2026-11-13T08:00:00.000Z", // 28 hours old
        lastSuccessfulOffsiteUploadAt: "2026-11-13T08:05:00.000Z",
        lastVerifiedRestoreAt: "2026-11-13T09:00:00.000Z",
        lastArchiveSizeBytes: 17258336,
        lastArchiveSha256: "abc123sha",
        lastArchiveKey: "backups/crm-v2-backup-1.sql.gz.age",
        lastError: null,
        lastErrorAt: null,
        totalArchivesTracked: 5,
        estimatedR2StorageMiB: 82.3,
      };

      const report = evaluateBackupHealth(staleState, now);
      expect(report.isStale).toBe(true);
      expect(report.backupAgeHours).toBe(28);
      expect(report.status).toBe("warning");
      expect(report.requiredOwnerAction).toMatch(/Backup is stale/i);
    });
  });

  describe("5. B12D — S3 Protocol Hardening, Retries, Metadata Audit & Prefix Partitioning", () => {
    it("strictly verifies .meta.json is secret-free and rejects credentials or PII", () => {
      const cleanMeta = {
        format: "age-v1-gzip-sql",
        createdAtUtc: "2026-11-14T12:00:00.000Z",
        recipientPublicKey: "age1cmre4vsnvanvvjnhvnmrwp6hxvady5ucah6e93wmnm980h2tyf0s5p4v3s",
        encryptedArchiveName: "crm-v2-backup.sql.gz.age",
        encryptedBytes: 17258336,
        encryptedSha256: "49caef3c961674d98f51eb1ec6ba1354fc0f9debf79dc4cb2eb0be6eb16c9e11",
        gzipBytes: 17253928,
        gzipSha256: "240b71cad1b06a1396ce1fb13af642f7bfbca834277e4b1b4603a547154ae91d",
        dumpFileBytes: 178511466,
        dumpSha256: "8ca9dc888be822286c70c2e7caf7d7e225149fd0d199bdd77ea8aaefee665447",
        tableCount: 49,
        totalRows: 311,
        proofCount: 23,
        proofBlobChunkCount: 97,
      };

      // Clean metadata passes
      expect(assertMetaJsonIsSecretFree(cleanMeta)).toBe(true);

      // Metadata with password / credential leak fails closed
      expect(() =>
        assertMetaJsonIsSecretFree({ ...cleanMeta, dbPassword: "secretPassword123!" }),
      ).toThrow(/Security policy violation/i);

      // Metadata with connection URL leak fails closed
      expect(() =>
        assertMetaJsonIsSecretFree({ ...cleanMeta, databaseUrl: "mysql://user:pass@hstgr.io/db" }),
      ).toThrow(/Security policy violation/i);

      // Metadata with customer email leak fails closed
      expect(() =>
        assertMetaJsonIsSecretFree({ ...cleanMeta, sampleUser: "customer@example.com" }),
      ).toThrow(/Security policy violation/i);

      // Metadata with host leak fails closed
      expect(() =>
        assertMetaJsonIsSecretFree({ ...cleanMeta, host: "srv469.hstgr.io" }),
      ).toThrow(/Security policy violation/i);
    });

    it("retries transient 5xx errors with exponential backoff and succeeds on subsequent try", async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("503 Service Unavailable");
        }
        return "success_on_attempt_3";
      });

      const res = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
      expect(res).toBe("success_on_attempt_3");
      expect(attempts).toBe(3);
    });

    it("enforces conditional writes with If-None-Match to block overwriting existing backups", async () => {
      const config = {
        accountId: "test_account",
        accessKeyId: "test_key",
        secretAccessKey: "test_secret",
        bucketName: "test-bucket",
        region: "auto",
        endpointOverride: "",
      };
      const client = new CloudflareR2Client(config);

      const mockFetchPreconditionFailed = vi.fn<typeof fetch>(async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["if-none-match"]).toBe("*");
        expect(headers["content-md5"]).toBeDefined();
        return new Response("Precondition Failed", { status: 412 });
      });

      await expect(
        client.putObject({
          key: "backups/rolling/crm-v2-backup-1.sql.gz.age",
          body: Buffer.from("data"),
          ifNoneMatch: "*",
          maxRetries: 1,
          fetchImpl: mockFetchPreconditionFailed,
        }),
      ).rejects.toThrow(/412 Precondition Failed.*already exists/i);
    });

    it("never prunes pinned baselines even when rolling backups are pruned", () => {
      const now = new Date("2026-11-14T12:00:00.000Z");
      const mixedObjects = [
        // 1. Versioned immutable pinned baseline (60 days old, MUST NEVER BE PRUNED)
        {
          key: "backups/pinned/crm-v2-baseline-2026-09-14T12-00-00-000Z.sql.gz.age",
          size: 17000000,
          lastModified: "2026-09-14T12:00:00.000Z",
          etag: "pinned",
        },
        // 2. Fresh rolling backup
        {
          key: "backups/rolling/crm-v2-backup-2026-11-14T10-00-00-000Z.sql.gz.age",
          size: 17000000,
          lastModified: "2026-11-14T10:00:00.000Z",
          etag: "fresh",
        },
        // 3. Expired rolling backup (35 days old)
        {
          key: "backups/rolling/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age",
          size: 16000000,
          lastModified: "2026-10-10T10:00:00.000Z",
          etag: "expired",
        },
      ];

      const result = evaluateRetentionPruning({
        objects: mixedObjects,
        retentionDays: 30,
        now,
      });

      // Pinned backup must NOT be in candidatesToPrune!
      for (const cand of result.candidatesToPrune) {
        expect(cand.primaryKey).not.toContain("pinned");
      }
      expect(result.candidatesToPrune).toHaveLength(1);
      expect(result.candidatesToPrune[0]!.primaryKey).toBe(
        "backups/rolling/crm-v2-backup-2026-10-10T10-00-00-000Z.sql.gz.age",
      );
    });

    it("assertNoPrivateKeyInDotEnv rejects private age recovery keys in project env files", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-test-env-"));
      try {
        // Safe .env without private keys
        fs.writeFileSync(
          path.join(tempDir, ".env"),
          "BACKUP_AGE_RECIPIENT_PUBKEY=age1lvufavuhu4dmzv...\nDB_USER=test\n",
        );
        expect(() => assertNoPrivateKeyInDotEnv(tempDir)).not.toThrow();

        // Dangerous .env with private key
        fs.writeFileSync(
          path.join(tempDir, ".env"),
          "BACKUP_AGE_SECRET_KEY=AGE-SECRET-KEY-1...\n",
        );
        expect(() => assertNoPrivateKeyInDotEnv(tempDir)).toThrow(/Security policy violation/i);

        // Dangerous .env.local with private key
        fs.unlinkSync(path.join(tempDir, ".env"));
        fs.writeFileSync(
          path.join(tempDir, ".env.local"),
          "AGE_SECRET_KEY=AGE-SECRET-KEY-1...\n",
        );
        expect(() => assertNoPrivateKeyInDotEnv(tempDir)).toThrow(/Security policy violation/i);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("promoteVerifiedBaselineToR2 promotes verified archive to versioned immutable pinned key", async () => {
      const uploadedKeys: string[] = [];
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const pathname = new URL(url).pathname;
        const key = pathname.replace(/^\/[^/]+\//, "");

        if (method === "PUT") {
          uploadedKeys.push(key);
          return new Response(null, { status: 200, headers: { etag: '"promoted-etag"' } });
        }
        if (method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "content-length": "100",
              etag: '"promoted-etag"',
            },
          });
        }
        return new Response(null, { status: 404 });
      });

      const result = await promoteVerifiedBaselineToR2({
        r2Config: {
          accountId: "test_acc",
          accessKeyId: "test_key",
          secretAccessKey: "test_secret",
          bucketName: "scaleflow-crm-backups",
          region: "auto",
        },
        rollingArchiveKey: "backups/rolling/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age",
        archiveBuffer: Buffer.alloc(100),
        manifestBuffer: Buffer.alloc(100),
        metaBuffer: Buffer.alloc(100),
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(result.ok).toBe(true);
      expect(result.pinnedArchiveKey).toBe(
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age",
      );
      expect(result.pinnedManifestKey).toBe(
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age.manifest.age",
      );
      expect(result.pinnedMetaKey).toBe(
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age.meta.json",
      );
      expect(uploadedKeys).toEqual([
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age",
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age.manifest.age",
        "backups/pinned/crm-v2-backup-2026-11-14T12-00-00-000Z.sql.gz.age.meta.json",
      ]);
    });
  });
});
