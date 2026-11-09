import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ServerEnv } from "./config/env.server";
import { CrmServiceError } from "./crm/errors.server";
import { hashIdempotentRequest } from "./crm/idempotency.server";
import {
  toFinanceEventDto,
  toPaymentDto,
  toPaymentProofDto,
  type FinanceEventRow,
  type PaymentProofRow,
  type PaymentRow,
} from "./crm/mappers.server";
import {
  listProofHistoryQuerySchema,
  removeProofBodySchema,
  replaceProofBodySchema,
} from "./crm/validation.server";
import { crmCoreSchema, crmFinanceSchema, crmPaymentProofs } from "./db/schema.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";
import {
  assessProofDirectorySafety,
  LocalFsProofStorage,
  resolveSafeProofPath,
} from "./storage/proofStorage.server";
import {
  extensionToProofKind,
  MAX_PROOF_BYTES,
  sanitizeProofFileName,
  sniffProofKind,
  validateProofHeaderAndMetadata,
} from "./storage/proofValidation.server";

// Synthetic valid file headers for testing
const VALID_JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const VALID_PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const VALID_WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from("VP8 ", "ascii"),
]);
const VALID_PDF_HEADER = Buffer.from("%PDF-1.4\n%synthetic test content\n");

describe("B3B Schema & Drizzle Migration Safety", () => {
  it("registers crm_payment_proofs in Drizzle schema with correct name and columns", () => {
    expect(getTableName(crmPaymentProofs)).toBe("crm_payment_proofs");
    expect(crmFinanceSchema.crmPaymentProofs).toBe(crmPaymentProofs);
    expect(crmCoreSchema.crmPaymentProofs).toBe(crmPaymentProofs);

    const cols = Object.keys(getTableColumns(crmPaymentProofs));
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "ownerUserId",
        "paymentId",
        "dealId",
        "legacyAttachmentId",
        "originalFileName",
        "fileExtension",
        "mimeType",
        "fileSize",
        "sha256Hash",
        "storageDriver",
        "storageKey",
        "lifecycleStatus",
        "activePaymentLock",
        "replacedByProofId",
        "replacementReason",
        "removalReason",
        "uploadedByUserId",
        "removedByUserId",
        "version",
        "uploadedAt",
        "removedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("0006_b3b_payment_proofs.sql migration file exists and enforces ON DELETE RESTRICT", () => {
    const migrationPath = path.resolve(__dirname, "db/migrations/0006_b3b_payment_proofs.sql");
    expect(fs.existsSync(migrationPath)).toBe(true);

    const content = fs.readFileSync(migrationPath, "utf8");
    expect(content).toContain("CREATE TABLE `crm_payment_proofs`");
    expect(content).toContain("uq_crm_payment_proofs_active_pay");
    expect(content).toContain(
      "FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON DELETE restrict",
    );
    expect(content).toContain(
      "FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict",
    );
    expect(content).toContain(
      "FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict",
    );
  });
});

describe("B3B File Magic-Byte Sniffing & Extension Validation", () => {
  it("detects valid JPEG magic bytes", () => {
    expect(sniffProofKind(VALID_JPEG_HEADER)).toBe("image/jpeg");
  });

  it("detects valid PNG magic bytes", () => {
    expect(sniffProofKind(VALID_PNG_HEADER)).toBe("image/png");
  });

  it("detects valid WebP magic bytes", () => {
    expect(sniffProofKind(VALID_WEBP_HEADER)).toBe("image/webp");
  });

  it("detects valid PDF magic bytes", () => {
    expect(sniffProofKind(VALID_PDF_HEADER)).toBe("application/pdf");
  });

  it("rejects non-allowlisted formats and corrupted headers", () => {
    expect(
      sniffProofKind(Buffer.from("<!DOCTYPE html><html><body>malicious</body></html>")),
    ).toBeNull();
    expect(sniffProofKind(Buffer.from("MZ\x90\x00\x03\x00\x00\x00"))).toBeNull(); // PE executable
    expect(sniffProofKind(Buffer.from("Hello, this is just plain text."))).toBeNull();
    expect(sniffProofKind(Buffer.alloc(0))).toBeNull();
  });

  it("maps extensions to proof kinds correctly", () => {
    expect(extensionToProofKind("invoice.pdf")).toBe("application/pdf");
    expect(extensionToProofKind("receipt.jpg")).toBe("image/jpeg");
    expect(extensionToProofKind("receipt.jpeg")).toBe("image/jpeg");
    expect(extensionToProofKind("screenshot.png")).toBe("image/png");
    expect(extensionToProofKind("proof.webp")).toBe("image/webp");
    expect(extensionToProofKind("document.docx")).toBeNull();
    expect(extensionToProofKind("script.sh")).toBeNull();
  });

  it("validates matching header and extension", () => {
    const desc = validateProofHeaderAndMetadata({
      originalName: "payment_receipt.pdf",
      fileSize: 1024,
      headerBytes: VALID_PDF_HEADER,
    });
    expect(desc.mimeType).toBe("application/pdf");
    expect(desc.fileExtension).toBe("pdf");
    expect(desc.sanitizedFileName).toBe("payment_receipt.pdf");
  });

  it("rejects extension/magic-byte mismatch (e.g. PNG with .pdf extension)", () => {
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "fake_invoice.pdf",
        fileSize: 1024,
        headerBytes: VALID_PNG_HEADER,
      }),
    ).toThrowError(/signature does not match/i);
  });

  it("rejects zero-byte files", () => {
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "receipt.png",
        fileSize: 0,
        headerBytes: Buffer.alloc(0),
      }),
    ).toThrowError(/empty/i);
  });

  it("rejects files exceeding 10 MiB limit", () => {
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "large_receipt.png",
        fileSize: MAX_PROOF_BYTES + 1,
        headerBytes: VALID_PNG_HEADER,
      }),
    ).toThrowError(/exceeds the 10 MB limit/i);
  });
});

describe("B3B Filename Sanitization & Directory Traversal Guards", () => {
  it("strips path traversal sequences (../ and ..\\)", () => {
    const res = sanitizeProofFileName("../../../etc/passwd.pdf");
    expect(res.sanitized).toBe("passwd.pdf");
    expect(res.ext).toBe("pdf");
    expect(res.sanitized).not.toContain("/");
    expect(res.sanitized).not.toContain("\\");
    expect(res.sanitized).not.toContain("..");
  });

  it("strips windows backslashes and drives", () => {
    const res = sanitizeProofFileName("C:\\Windows\\System32\\calc.png");
    expect(res.sanitized).toBe("calc.png");
    expect(res.ext).toBe("png");
  });

  it("strips null bytes and control characters", () => {
    const res = sanitizeProofFileName("receipt\x00evil.jpg");
    expect(res.sanitized).toBe("receiptevil.jpg");
    expect(res.ext).toBe("jpg");
  });

  it("resolveSafeProofPath strictly forbids escaping base directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-proof-test-"));
    try {
      expect(() => resolveSafeProofPath(tempDir, "../../../outside.pdf")).toThrowError(
        CrmServiceError,
      );
      expect(() => resolveSafeProofPath(tempDir, "..\\..\\outside.pdf")).toThrowError(
        CrmServiceError,
      );
      const safe = resolveSafeProofPath(tempDir, "safe_file.pdf");
      expect(safe.startsWith(tempDir)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("B3B Storage Adapter & Local Filesystem Durability", () => {
  it("stages, persists and streams file correctly with LocalFsProofStorage", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-storage-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      const testContent = Buffer.concat([VALID_PDF_HEADER, Buffer.from("Extra PDF body content")]);

      // Stage
      const staged = await storage.stageUpload({
        ownerUserId: "usr_owner1",
        originalFileName: "my invoice #123.pdf",
        streamOrBuffer: testContent,
      });

      expect(staged.tempKey).toMatch(/^tmp_/);
      expect(staged.byteSize).toBe(testContent.byteLength);
      expect(staged.descriptor.mimeType).toBe("application/pdf");
      expect(staged.descriptor.sanitizedFileName).toBe("my invoice _123.pdf");
      expect(fs.existsSync(staged.tempPath)).toBe(true);

      // Persist
      const persisted = await storage.persistStagedProof({
        ownerUserId: "usr_owner1",
        proofId: "prf_test1",
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
      });

      expect(persisted.byteSize).toBe(testContent.byteLength);
      expect(persisted.sha256).toBe(staged.sha256);
      expect(persisted.storageKey).toMatch(/\.pdf$/);
      expect(fs.existsSync(staged.tempPath)).toBe(false); // temp file cleaned up

      // Read back
      const readResult = await storage.readProofBuffer(persisted.storageKey);
      expect(readResult).not.toBeNull();
      expect(readResult?.equals(testContent)).toBe(true);

      // Stream read
      const streamResult = await storage.readProofStream(persisted.storageKey);
      expect(streamResult).not.toBeNull();
      expect(streamResult?.byteSize).toBe(testContent.byteLength);

      const chunks: Buffer[] = [];
      for await (const chunk of streamResult!.stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).equals(testContent)).toBe(true);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("stages and persists all 4 supported formats (JPEG, PNG, WebP, PDF) with byte-for-byte fidelity", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-formats-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      const testCases = [
        { name: "receipt.jpg", header: VALID_JPEG_HEADER, ext: "jpg", mime: "image/jpeg" },
        { name: "receipt.png", header: VALID_PNG_HEADER, ext: "png", mime: "image/png" },
        { name: "receipt.webp", header: VALID_WEBP_HEADER, ext: "webp", mime: "image/webp" },
        { name: "receipt.pdf", header: VALID_PDF_HEADER, ext: "pdf", mime: "application/pdf" },
      ];

      for (const tc of testCases) {
        const fullContent = Buffer.concat([
          tc.header,
          Buffer.from("arbitrary content for format testing"),
        ]);
        const staged = await storage.stageUpload({
          ownerUserId: "usr_owner1",
          originalFileName: tc.name,
          streamOrBuffer: fullContent,
        });
        expect(staged.descriptor.mimeType).toBe(tc.mime);

        const persisted = await storage.persistStagedProof({
          ownerUserId: "usr_owner1",
          proofId: `prf_${tc.ext}`,
          tempKey: staged.tempKey,
          ext: staged.descriptor.fileExtension,
          expectedSha256: staged.sha256,
        });

        const buf = await storage.readProofBuffer(persisted.storageKey);
        expect(buf).not.toBeNull();
        expect(buf!.equals(fullContent)).toBe(true);
      }
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("preserves previous proof files on replacement and removal (physical evidence immutability)", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-retention-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      const contentV1 = Buffer.concat([VALID_PDF_HEADER, Buffer.from("Receipt Version 1")]);
      const contentV2 = Buffer.concat([
        VALID_PDF_HEADER,
        Buffer.from("Receipt Version 2 - Replaced"),
      ]);

      // Stage and persist V1
      const stagedV1 = await storage.stageUpload({
        ownerUserId: "usr_owner1",
        originalFileName: "v1.pdf",
        streamOrBuffer: contentV1,
      });
      const persistedV1 = await storage.persistStagedProof({
        ownerUserId: "usr_owner1",
        proofId: "prf_v1",
        tempKey: stagedV1.tempKey,
        ext: stagedV1.descriptor.fileExtension,
      });

      // Stage and persist V2 (replacement)
      const stagedV2 = await storage.stageUpload({
        ownerUserId: "usr_owner1",
        originalFileName: "v2.pdf",
        streamOrBuffer: contentV2,
      });
      const persistedV2 = await storage.persistStagedProof({
        ownerUserId: "usr_owner1",
        proofId: "prf_v2",
        tempKey: stagedV2.tempKey,
        ext: stagedV2.descriptor.fileExtension,
      });

      // Both physical files must remain on disk
      expect(await storage.exists(persistedV1.storageKey)).toBe(true);
      expect(await storage.exists(persistedV2.storageKey)).toBe(true);

      const buf1 = await storage.readProofBuffer(persistedV1.storageKey);
      const buf2 = await storage.readProofBuffer(persistedV2.storageKey);
      expect(buf1?.equals(contentV1)).toBe(true);
      expect(buf2?.equals(contentV2)).toBe(true);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("cleans up staged temporary file when validation fails (no orphan leaks)", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-clean-fail-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      const stagingDir = path.join(testDir, "staging");

      // Attempt to stage a text file with a .pdf name (magic-byte mismatch)
      await expect(
        storage.stageUpload({
          ownerUserId: "usr_owner1",
          originalFileName: "fake.pdf",
          streamOrBuffer: Buffer.from("This is not a PDF!"),
        }),
      ).rejects.toThrowError(/do not match any recognized/i);

      // Verify no orphan files remain in staging directory
      if (fs.existsSync(stagingDir)) {
        const files = fs.readdirSync(stagingDir);
        expect(files.length).toBe(0);
      }
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("cleans up expired staging orphans but leaves fresh files", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-orphan-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      const stagingDir = path.join(testDir, "staging");
      fs.mkdirSync(stagingDir, { recursive: true });

      const oldFile = path.join(stagingDir, "tmp_old.tmp");
      const newFile = path.join(stagingDir, "tmp_new.tmp");

      fs.writeFileSync(oldFile, "old staged data");
      fs.writeFileSync(newFile, "new staged data");

      // Set old file mtime to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, twoHoursAgo, twoHoursAgo);

      const cleaned = await storage.cleanupAbandonedTemp(60 * 60 * 1000); // 1 hour max age
      expect(cleaned).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("assesses directory safety and flags ephemeral build directories", () => {
    const safeResult = assessProofDirectorySafety("/var/data/proofs");
    expect(safeResult.unsafePublicOrBuildPath).toBe(false);

    const publicResult = assessProofDirectorySafety("/home/user/public_html/proofs");
    expect(publicResult.unsafePublicOrBuildPath).toBe(true);
    expect(publicResult.reasons.some((r) => r.includes("public_html"))).toBe(true);

    const hbuildsResult = assessProofDirectorySafety("/home/user/hbuilds/current/proofs");
    expect(hbuildsResult.unsafePublicOrBuildPath).toBe(true);
    expect(hbuildsResult.reasons.some((r) => r.includes("hbuilds"))).toBe(true);
  });
});

describe("B3B Mappers & Validation Schemas", () => {
  it("toPaymentProofDto formats database row correctly", () => {
    const mockRow: PaymentProofRow = {
      id: "prf_123",
      ownerUserId: "usr_owner1",
      paymentId: "pay_123",
      dealId: "del_123",
      legacyAttachmentId: null,
      originalFileName: "receipt.pdf",
      fileExtension: "pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
      sha256Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      storageDriver: "local-fs",
      storageKey: "proofs/2026/04/abc-receipt.pdf",
      lifecycleStatus: "active",
      activePaymentLock: "pay_123",
      replacedByProofId: null,
      replacementReason: null,
      removalReason: null,
      uploadedByUserId: "usr_owner1",
      removedByUserId: null,
      version: 1,
      uploadedAt: "2026-04-12 10:00:00",
      removedAt: null,
      createdAt: "2026-04-12 10:00:00",
      updatedAt: "2026-04-12 10:00:00",
    };

    const dto = toPaymentProofDto(mockRow);
    expect(dto.id).toBe("prf_123");
    expect(dto.paymentId).toBe("pay_123");
    expect(dto.originalFileName).toBe("receipt.pdf");
    expect(dto.mimeType).toBe("application/pdf");
    expect(dto.fileSize).toBe(1024);
    expect(dto.lifecycleStatus).toBe("active");
  });

  it("toPaymentDto includes hasProof and proof when active", () => {
    const mockPayment: PaymentRow = {
      id: "pay_123",
      legacyId: null,
      ownerUserId: "usr_owner1",
      dealId: "del_123",
      amount: "50000.00",
      paymentIstDate: "2026-04-12",
      paymentType: "installment",
      method: "bank_transfer",
      reference: "NEFT123",
      notes: "First payment",
      status: "received",
      voided: false,
      voidedAt: null,
      voidedIstDate: null,
      voidedByUserId: null,
      voidReason: null,
      recordedByUserId: "usr_owner1",
      updatedByUserId: "usr_owner1",
      version: 1,
      opId: null,
      idempotencyKey: null,
      createdAt: "2026-04-12 10:00:00",
      updatedAt: "2026-04-12 10:00:00",
    };

    const mockProof: PaymentProofRow = {
      id: "prf_123",
      ownerUserId: "usr_owner1",
      paymentId: "pay_123",
      dealId: "del_123",
      legacyAttachmentId: null,
      originalFileName: "receipt.pdf",
      fileExtension: "pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
      sha256Hash: "abc",
      storageDriver: "local-fs",
      storageKey: "proofs/2026/04/abc-receipt.pdf",
      lifecycleStatus: "active",
      activePaymentLock: "pay_123",
      replacedByProofId: null,
      replacementReason: null,
      removalReason: null,
      uploadedByUserId: "usr_owner1",
      removedByUserId: null,
      version: 1,
      uploadedAt: "2026-04-12 10:00:00",
      removedAt: null,
      createdAt: "2026-04-12 10:00:00",
      updatedAt: "2026-04-12 10:00:00",
    };

    // With active proof
    const dtoWithProof = toPaymentDto(mockPayment, mockProof);
    expect(dtoWithProof.hasProof).toBe(true);
    expect(dtoWithProof.proof?.id).toBe("prf_123");

    // Without proof
    const dtoWithoutProof = toPaymentDto(mockPayment, null);
    expect(dtoWithoutProof.hasProof).toBe(false);
    expect(dtoWithoutProof.proof).toBeUndefined();

    // With replaced/inactive proof
    const dtoWithReplacedProof = toPaymentDto(mockPayment, {
      ...mockProof,
      lifecycleStatus: "replaced",
    });
    expect(dtoWithReplacedProof.hasProof).toBe(false);
    expect(dtoWithReplacedProof.proof).toBeUndefined();
  });

  it("validates replaceProofBodySchema and removeProofBodySchema", () => {
    expect(replaceProofBodySchema.parse({})).toEqual({});
    expect(replaceProofBodySchema.parse({ reason: "Replaced with clearer receipt" })).toEqual({
      reason: "Replaced with clearer receipt",
    });

    expect(removeProofBodySchema.parse({})).toEqual({});
    expect(removeProofBodySchema.parse({ reason: "Uploaded wrong document" })).toEqual({
      reason: "Uploaded wrong document",
    });
  });

  it("validates listProofHistoryQuerySchema defaults and bounds", () => {
    expect(listProofHistoryQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listProofHistoryQuerySchema.parse({ limit: "20", offset: "10" })).toEqual({
      limit: 20,
      offset: 10,
    });
    expect(listProofHistoryQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("B3B HTTP Endpoints Route Recognition (Offline)", () => {
  const dummyEnv = {
    NODE_ENV: "test" as const,
    DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/db",
    SESSION_COOKIE_NAME: "sf_session",
    SESSION_SECRET: "test-secret-at-least-32-characters-long",
    OWNER_EMAIL: "owner@scaleflow.com",
    OWNER_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    AUTH_TRUST_PROXY: false,
    SESSION_TTL_HOURS: 168,
    SESSION_IDLE_HOURS: 48,
    DEV_BYPASS_LOCAL_AUTH: false,
    DEV_ENABLE_LEAD_PILOT: false,
    ALLOWED_ORIGINS: [],
  } as unknown as ServerEnv;

  it("routes GET /api/v1/payments/:id/proof to CRM handler", async () => {
    const req = new Request("http://127.0.0.1/api/v1/payments/pay_123/proof", {
      method: "GET",
    });
    const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_123/proof", dummyEnv);
    expect(res).not.toBeNull();
    // In unconfigured offline mode without DB, it returns 503
    expect([401, 503]).toContain(res?.status);
  });

  it("routes GET /api/v1/payments/:id/proof/download to CRM handler", async () => {
    const req = new Request("http://127.0.0.1/api/v1/payments/pay_123/proof/download", {
      method: "GET",
    });
    const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_123/proof/download", dummyEnv);
    expect(res).not.toBeNull();
    expect([401, 503]).toContain(res?.status);
  });

  it("routes GET /api/v1/payments/:id/proof/history to CRM handler", async () => {
    const req = new Request("http://127.0.0.1/api/v1/payments/pay_123/proof/history", {
      method: "GET",
    });
    const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_123/proof/history", dummyEnv);
    expect(res).not.toBeNull();
    expect([401, 503]).toContain(res?.status);
  });

  it("returns 405 on invalid method for /api/v1/payments/:id/proof/download", async () => {
    const req = new Request("http://127.0.0.1/api/v1/payments/pay_123/proof/download", {
      method: "POST",
    });
    const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_123/proof/download", dummyEnv);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
  });
});

describe("B3B Idempotency & Financial Consistency Guards", () => {
  it("computes deterministic idempotency hashes for proof attachments", () => {
    const scope = "payment-proof:attach:pay_123";
    const payload = {
      paymentId: "pay_123",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      byteSize: 1024,
      originalName: "receipt.pdf",
    };

    const hash1 = hashIdempotentRequest(scope, payload);
    const hash2 = hashIdempotentRequest(scope, payload);
    expect(hash1).toBe(hash2);

    const hashDifferent = hashIdempotentRequest(scope, { ...payload, byteSize: 2048 });
    expect(hashDifferent).not.toBe(hash1);
  });

  it("verifies CrmServiceError mapping for voided payment protection and conflict codes", () => {
    const voidErr = new CrmServiceError(
      409,
      "payment_already_voided",
      "Cannot attach proof to a voided payment.",
    );
    expect(voidErr.status).toBe(409);
    expect(voidErr.code).toBe("payment_already_voided");
    expect(voidErr.toResponseBody()).toEqual({
      ok: false,
      error: {
        code: "payment_already_voided",
        message: "Cannot attach proof to a voided payment.",
      },
    });

    const existsErr = new CrmServiceError(
      409,
      "proof_already_exists",
      "Payment already has an active proof. Use replace proof.",
    );
    expect(existsErr.status).toBe(409);
    expect(existsErr.code).toBe("proof_already_exists");
  });

  it("ensures browser-local storage and IndexedDB proof stores remain unmutated", () => {
    // Audit that the server-side modules never import or reference client IndexedDB or localStorage
    const serverSchemaContent = fs.readFileSync(
      path.resolve(__dirname, "db/schema.server.ts"),
      "utf8",
    );
    expect(serverSchemaContent).not.toContain("localStorage");
    expect(serverSchemaContent).not.toContain("indexedDB");
    expect(serverSchemaContent).not.toContain("scale-flow-payment-proofs");

    const proofServiceContent = fs.readFileSync(
      path.resolve(__dirname, "crm/proofService.server.ts"),
      "utf8",
    );
    expect(proofServiceContent).not.toContain("localStorage");
    expect(proofServiceContent).not.toContain("indexedDB");
  });

  it("verifies reconcileOrphanProofFiles correctly identifies and purges unreferenced disk files", async () => {
    const { reconcileOrphanProofFiles } = await import("./crm/proofService.server");
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-proof-reconcile-test-"));
    try {
      const storage = new LocalFsProofStorage(testDir);
      // Stage & persist one file
      const staged1 = await storage.stageUpload({
        ownerUserId: "usr_test1",
        originalFileName: "recorded.png",
        streamOrBuffer: VALID_PNG_HEADER,
      });
      const p1 = await storage.persistStagedProof({
        tempKey: staged1.tempKey,
        ownerUserId: "usr_test1",
        proofId: "proof1",
        ext: staged1.descriptor.fileExtension,
        expectedSha256: staged1.sha256,
      });

      // Stage & persist an orphan file (simulating crash before DB commit)
      const staged2 = await storage.stageUpload({
        ownerUserId: "usr_test1",
        originalFileName: "orphan.pdf",
        streamOrBuffer: VALID_PDF_HEADER,
      });
      const p2 = await storage.persistStagedProof({
        tempKey: staged2.tempKey,
        ownerUserId: "usr_test1",
        proofId: "proof2",
        ext: staged2.descriptor.fileExtension,
        expectedSha256: staged2.sha256,
      });

      // Mock DB that only knows about p1.storageKey
      const mockDb = {
        select: () => ({
          from: async () => [{ storageKey: p1.storageKey }],
        }),
      } as unknown as import("./db/index.server").CrmDatabase;

      // 1. Dry run reconcile
      const preview = await reconcileOrphanProofFiles(mockDb, {
        storageBackend: storage,
        deleteOrphans: false,
      });
      expect(preview.activeDbCount).toBe(1);
      expect(preview.unreferencedFiles).toEqual([p2.storageKey]);
      expect(preview.deletedOrphans).toEqual([]);
      expect(await storage.exists(p2.storageKey)).toBe(true);

      // 2. Reconcile with delete
      const pruned = await reconcileOrphanProofFiles(mockDb, {
        storageBackend: storage,
        deleteOrphans: true,
      });
      expect(pruned.unreferencedFiles).toEqual([p2.storageKey]);
      expect(pruned.deletedOrphans).toEqual([p2.storageKey]);
      expect(await storage.exists(p2.storageKey)).toBe(false);
      expect(await storage.exists(p1.storageKey)).toBe(true);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
