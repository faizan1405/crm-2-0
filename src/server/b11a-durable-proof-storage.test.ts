import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import {
  assessProofStorageEnv,
  parseServerEnv,
  summarizeSafeRuntimeEnv,
  verifyDisposableProofTestStorageConfig,
} from "./config/env.server";
import { MigrationMapper } from "./backup/migrationMapping.server";
import { CrmServiceError } from "./crm/errors.server";
import { getHealthStatus } from "./health/health.server";
import { handleApiRequest } from "./http/apiRouter.server";
import {
  DisabledProofStorage,
  DisposableTestProofStorage,
  getProofStorageBackend,
  LocalFsProofStorage,
  ObjectStorageProofStorage,
  resetProofStorageBackend,
} from "./storage/proofStorage.server";
import {
  MAX_PROOF_BYTES,
  normalizeDeclaredProofMimeType,
  sanitizeProofFileName,
  validateProofHeaderAndMetadata,
} from "./storage/proofValidation.server";
import { VAULT_BLOCKERS } from "./vault/vaultService.server";

function buildValidRealJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
  ]);
}

function buildValidRealPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.from([0x00, 0x00, 0x00, 0x0d]);
  const ihdrTag = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x10, // width = 16
    0x00,
    0x00,
    0x00,
    0x10, // height = 16
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
  ]);
  const ihdrCrc = Buffer.alloc(4);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([sig, ihdrLen, ihdrTag, ihdrData, ihdrCrc, iend]);
}

function buildValidRealWebp(): Buffer {
  const payload = Buffer.from("SyntheticWebPPayloadBytes", "ascii");
  const riffBody = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    Buffer.from("VP8 ", "ascii"),
    Buffer.from([payload.length, 0x00, 0x00, 0x00]),
    payload,
  ]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write("RIFF", 0, "ascii");
  riffHeader.writeUInt32LE(riffBody.byteLength, 4);
  return Buffer.concat([riffHeader, riffBody]);
}

function buildValidRealPdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "ascii",
  );
}

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetProofStorageBackend();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("B11A Fail-Closed Production Gating & Zero Silent Fallback", () => {
  it("fails closed in production when using default ephemeral .data/private-proofs", async () => {
    const nonExistentEphemeral = path.join(makeTempDir("b11a-nodata-"), ".data", "private-proofs");
    const env = parseServerEnv({
      NODE_ENV: "production",
      PROOF_STORAGE_DRIVER: "local-fs",
      PROOF_STORAGE_DIR: nonExistentEphemeral,
    });
    const assessment = assessProofStorageEnv(env);
    expect(assessment.failClosed).toBe(true);
    expect(assessment.configured).toBe(false);
    expect(assessment.writable).toBe(false);
    expect(assessment.productionReady).toBe(false);
    expect(assessment.isDefaultEphemeralDir).toBe(true);
    expect(assessment.status).toBe("blocked_ephemeral_path");

    const backend = getProofStorageBackend({ env });
    expect(backend.healthSummary().failClosed).toBe(true);
    // Must never lazily create ephemeral `.data` directory when fail-closed
    expect(fs.existsSync(nonExistentEphemeral)).toBe(false);

    await expect(
      backend.putPrivateObject({
        ownerUserId: "usr_owner1",
        originalFileName: "receipt.pdf",
        content: buildValidRealPdf(),
      }),
    ).rejects.toMatchObject({ status: 503, code: "storage_not_configured" });
  });

  it("blocks production local-fs even on non-default absolute path unless PROOF_PRODUCTION_DURABLE_CONFIRMED=true", async () => {
    const absPrivateDir = makeTempDir("b11a-unconfirmed-");
    const env = parseServerEnv({
      NODE_ENV: "production",
      PROOF_STORAGE_DRIVER: "hostinger-private-fs",
      PROOF_STORAGE_DIR: absPrivateDir,
    });
    const assessment = assessProofStorageEnv(env);
    expect(assessment.failClosed).toBe(true);
    expect(assessment.status).toBe("blocked_durability_unverified");
    expect(assessment.blockedCode).toBe("storage_durability_blocked");

    const backend = getProofStorageBackend({ env });
    await expect(
      backend.stageUpload({
        ownerUserId: "usr_owner1",
        originalFileName: "receipt.pdf",
        streamOrBuffer: buildValidRealPdf(),
      }),
    ).rejects.toMatchObject({ status: 503, code: "storage_durability_blocked" });
  });

  it("rejects Hostinger hbuilds / public_html / .output paths in production even when durable flag is true", async () => {
    const base = makeTempDir("b11a-unsafe-prod-");
    for (const badSegment of ["hbuilds/current/proofs", "public_html/proofs", ".output/proofs"]) {
      const candidate = path.join(base, badSegment);
      const env = parseServerEnv({
        NODE_ENV: "production",
        PROOF_STORAGE_DRIVER: "hostinger-private-fs",
        PROOF_STORAGE_DIR: candidate,
        PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
      });
      const assessment = assessProofStorageEnv(env);
      expect(assessment.failClosed).toBe(true);
      expect(assessment.unsafePublicOrBuildPath).toBe(true);
      expect(assessment.status).toBe("blocked_unsafe_path");

      const backend = getProofStorageBackend({ env });
      await expect(
        backend.putPrivateObject({
          ownerUserId: "usr_owner1",
          originalFileName: "receipt.png",
          content: buildValidRealPng(),
        }),
      ).rejects.toMatchObject({ status: 503, code: "storage_not_configured" });
    }
  });

  it("ObjectStorageProofStorage has ZERO local fallback in dev and production", async () => {
    const storage = new ObjectStorageProofStorage();
    const summary = storage.healthSummary();
    expect(summary.driver).toBe("object-storage");
    expect(summary.configured).toBe(false);
    expect(summary.writable).toBe(false);
    expect(summary.failClosed).toBe(true);
    expect(summary.productionReady).toBe(false);

    await expect(
      storage.putPrivateObject({
        ownerUserId: "usr_owner1",
        originalFileName: "receipt.pdf",
        content: buildValidRealPdf(),
      }),
    ).rejects.toMatchObject({ status: 503, code: "storage_not_configured" });
    await expect(storage.readProofBuffer("any.pdf")).rejects.toMatchObject({
      status: 503,
      code: "storage_not_configured",
    });
    await expect(storage.reconcileStorage(new Set())).rejects.toMatchObject({
      status: 503,
      code: "storage_not_configured",
    });
    const verifyRes = await storage.verifyPrivateObject("any.pdf");
    expect(verifyRes.ok).toBe(false);
    expect(verifyRes.status).toBe("unreadable");
  });

  it("DisabledProofStorage fails closed cleanly", async () => {
    const disabled = new DisabledProofStorage();
    expect(disabled.healthSummary().status).toBe("blocked_disabled");
    expect(disabled.healthSummary().failClosed).toBe(true);
    await expect(
      disabled.stageUpload({
        ownerUserId: "usr_owner1",
        originalFileName: "receipt.jpg",
        streamOrBuffer: buildValidRealJpeg(),
      }),
    ).rejects.toMatchObject({ status: 503, code: "storage_not_configured" });
  });

  it("allows production reads/writes ONLY when explicit non-build absolute private path + durable confirmation are both set", async () => {
    const absPrivateDir = path.join(makeTempDir("b11a-confirmed-"), "private-proofs-vault");
    const env = parseServerEnv({
      NODE_ENV: "production",
      PROOF_STORAGE_DRIVER: "hostinger-private-fs",
      PROOF_STORAGE_DIR: absPrivateDir,
      PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
    });
    const backend = getProofStorageBackend({ env });
    expect(backend.healthSummary().failClosed).toBe(false);
    expect(backend.healthSummary().productionReady).toBe(true);

    const put = await backend.putPrivateObject({
      ownerUserId: "usr_owner1",
      proofId: "proof_prod_ok_1",
      originalFileName: "gst-invoice.pdf",
      declaredMimeType: "application/pdf",
      content: buildValidRealPdf(),
    });
    expect(put.storageKey).toBe("prf_proof_prod_ok_1.pdf");
    const verified = await backend.verifyPrivateObject(put.storageKey, {
      sha256: put.sha256,
      byteSize: put.byteSize,
    });
    expect(verified.ok).toBe(true);
    expect(verified.status).toBe("verified");
  });

  it("summarizes runtime env & /api/v1/health fail-closed diagnostics without exposing paths or secrets", async () => {
    const prevNodeEnv = process.env["NODE_ENV"];
    const prevDriver = process.env["PROOF_STORAGE_DRIVER"];
    const prevDir = process.env["PROOF_STORAGE_DIR"];
    const secretPath = "/home/u256504187/secret-vault/proofs";
    process.env["NODE_ENV"] = "production";
    process.env["PROOF_STORAGE_DRIVER"] = "object-storage";
    process.env["PROOF_STORAGE_DIR"] = secretPath;

    try {
      const env = parseServerEnv(process.env);
      const safeEnv = summarizeSafeRuntimeEnv(env);
      expect(safeEnv.proofStorageFailClosed).toBe(true);
      expect(safeEnv.proofProductionDurableConfirmed).toBe(false);
      expect(JSON.stringify(safeEnv)).not.toContain(secretPath);

      const health = await getHealthStatus();
      expect(health.subsystems.storage.failClosed).toBe(true);
      expect(health.subsystems.storage.productionReady).toBe(false);
      expect(health.subsystems.storage.durabilityStatus).toBe(
        "blocked_object_storage_unconfigured",
      );
      expect(JSON.stringify(health)).not.toContain(secretPath);

      const res = await handleApiRequest(new Request("http://127.0.0.1:4173/api/v1/health"));
      expect(res!.status).toBe(200);
      const text = await res!.text();
      expect(text).not.toContain(secretPath);
      expect(text).not.toContain("secret-vault");
    } finally {
      if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNodeEnv;
      if (prevDriver === undefined) delete process.env["PROOF_STORAGE_DRIVER"];
      else process.env["PROOF_STORAGE_DRIVER"] = prevDriver;
      if (prevDir === undefined) delete process.env["PROOF_STORAGE_DIR"];
      else process.env["PROOF_STORAGE_DIR"] = prevDir;
    }
  });
});

describe("B11A File Validation Hardening & Security Edge Cases", () => {
  it("validates declared MIME vs magic bytes and rejects mismatches", () => {
    expect(normalizeDeclaredProofMimeType("image/jpg; charset=binary")).toBe("image/jpeg");
    expect(normalizeDeclaredProofMimeType("application/octet-stream")).toBeNull();

    // PNG bytes with .png filename but malicious text/html declared MIME -> reject
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "receipt.png",
        fileSize: buildValidRealPng().byteLength,
        headerBytes: buildValidRealPng().subarray(0, 16),
        declaredMimeType: "text/html",
        fullBytes: buildValidRealPng(),
      }),
    ).toThrowError(CrmServiceError);

    // JPEG bytes with .jpg filename but declared image/png -> reject
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "receipt.jpg",
        fileSize: buildValidRealJpeg().byteLength,
        headerBytes: buildValidRealJpeg().subarray(0, 16),
        declaredMimeType: "image/png",
        fullBytes: buildValidRealJpeg(),
      }),
    ).toThrowError(/Declared MIME Content-Type/i);
  });

  it("rejects truncated and structurally corrupted JPEG, PNG, WebP, and PDF payloads", () => {
    // 1. Truncated JPEG missing FF D9 EOI
    const validJpeg = buildValidRealJpeg();
    const truncatedJpeg = validJpeg.subarray(0, validJpeg.length - 4);
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "bad.jpg",
        fileSize: truncatedJpeg.byteLength,
        headerBytes: truncatedJpeg.subarray(0, 16),
        fullBytes: truncatedJpeg,
      }),
    ).toThrowError(/truncated|end-of-image/i);

    // 2. Truncated PNG missing IEND chunk
    const validPng = buildValidRealPng();
    const truncatedPng = validPng.subarray(0, validPng.length - 6);
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "bad.png",
        fileSize: truncatedPng.byteLength,
        headerBytes: truncatedPng.subarray(0, 16),
        fullBytes: truncatedPng,
      }),
    ).toThrowError(/truncated|IEND/i);

    // 3. PNG with zero dimensions in IHDR
    const zeroDimPng = Buffer.from(validPng);
    zeroDimPng.writeUInt32BE(0, 16);
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "zero.png",
        fileSize: zeroDimPng.byteLength,
        headerBytes: zeroDimPng.subarray(0, 16),
        fullBytes: zeroDimPng,
      }),
    ).toThrowError(/zero image dimensions/i);

    // 4. Truncated WebP (RIFF length exceeds actual buffer)
    const validWebp = buildValidRealWebp();
    const truncatedWebp = validWebp.subarray(0, validWebp.length - 5);
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "bad.webp",
        fileSize: truncatedWebp.byteLength,
        headerBytes: truncatedWebp.subarray(0, 16),
        fullBytes: truncatedWebp,
      }),
    ).toThrowError(/RIFF container length/i);

    // 5. Truncated PDF missing %%EOF
    const truncatedPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n", "ascii");
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "bad.pdf",
        fileSize: truncatedPdf.byteLength,
        headerBytes: truncatedPdf.subarray(0, 16),
        fullBytes: truncatedPdf,
      }),
    ).toThrowError(/truncated|%%EOF/i);
  });

  it("handles oversized, empty, traversal, special chars, overly long filenames, and duplicate filenames cleanly", async () => {
    const dir = makeTempDir("b11a-edge-");
    const storage = new DisposableTestProofStorage(dir);

    // Empty and > 10 MiB
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "empty.pdf",
        fileSize: 0,
        headerBytes: Buffer.alloc(0),
      }),
    ).toThrowError(/empty/i);
    expect(() =>
      validateProofHeaderAndMetadata({
        originalName: "huge.pdf",
        fileSize: MAX_PROOF_BYTES + 1,
        headerBytes: buildValidRealPdf().subarray(0, 16),
      }),
    ).toThrowError(/10 MB/i);

    // Long filename preserves extension within <= 128 chars
    const longRaw = `${"customer_neft_receipt_".repeat(15)}.pdf`;
    const sanitizedLong = sanitizeProofFileName(longRaw);
    expect(sanitizedLong.sanitized.endsWith(".pdf")).toBe(true);
    expect(sanitizedLong.sanitized.length).toBeLessThanOrEqual(128);

    // Duplicate filenames get opaque, non-colliding storage keys with zero PII
    const pdfBytes = buildValidRealPdf();
    const a = await storage.putPrivateObject({
      ownerUserId: "usr_owner1",
      proofId: "proof_dup_a",
      originalFileName: "Aarav Sharma <Receipt> #1.pdf",
      declaredMimeType: "application/pdf",
      content: pdfBytes,
    });
    const b = await storage.putPrivateObject({
      ownerUserId: "usr_owner1",
      proofId: "proof_dup_b",
      originalFileName: "Aarav Sharma <Receipt> #1.pdf",
      declaredMimeType: "application/pdf",
      content: pdfBytes,
    });
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(a.storageKey).toBe("prf_proof_dup_a.pdf");
    expect(a.storageKey).not.toContain("Aarav");
    expect(a.storageKey).not.toContain("Sharma");
  });
});

describe("B11A Disposable Test Provider, Fault Injection & Bit-Rot Integrity", () => {
  it("enforces disposable allowlist & blocks unsafe paths", () => {
    expect(verifyDisposableProofTestStorageConfig(".data/private-proofs").ok).toBe(false);
    expect(verifyDisposableProofTestStorageConfig("/var/www/public_html/proofs").ok).toBe(false);
    const allowedDir = makeTempDir("b11a-allow-");
    const insideAllowed = path.join(allowedDir, "run-1");
    expect(
      verifyDisposableProofTestStorageConfig(insideAllowed, {
        PROOF_TEST_STORAGE_ALLOWLIST: allowedDir,
      }).ok,
    ).toBe(true);
    expect(
      verifyDisposableProofTestStorageConfig(makeTempDir("b11a-outside-"), {
        PROOF_TEST_STORAGE_ALLOWLIST: allowedDir,
      }).ok,
    ).toBe(false);
  });

  it("detects missing binaries and SHA-256 bit-rot corruption without serving tampered bytes", async () => {
    const dir = makeTempDir("b11a-integrity-");
    const storage = new DisposableTestProofStorage(dir);

    const pngBytes = buildValidRealPng();
    const put = await storage.putPrivateObject({
      ownerUserId: "usr_owner1",
      proofId: "proof_chk_1",
      originalFileName: "receipt.png",
      declaredMimeType: "image/png",
      content: pngBytes,
    });

    const expectedSha = crypto.createHash("sha256").update(pngBytes).digest("hex");
    expect(put.sha256).toBe(expectedSha);

    const head = await storage.headPrivateObject(put.storageKey);
    expect(head.exists).toBe(true);
    expect(head.byteSize).toBe(pngBytes.byteLength);

    const okGet = await storage.getPrivateObject(put.storageKey, {
      sha256: put.sha256,
      byteSize: put.byteSize,
    });
    expect(okGet!.buffer.equals(pngBytes)).toBe(true);

    // Tamper 1 byte in stored object -> verify & getPrivateObject must detect corruption
    const storedPath = path.join(dir, "proofs", put.storageKey);
    const tampered = Buffer.from(pngBytes);
    tampered[20] = tampered[20]! ^ 0xff;
    fs.writeFileSync(storedPath, tampered);

    const badVerify = await storage.verifyPrivateObject(put.storageKey, {
      sha256: put.sha256,
      byteSize: put.byteSize,
    });
    expect(badVerify.ok).toBe(false);
    expect(badVerify.status).toBe("checksum_mismatch");

    await expect(
      storage.getPrivateObject(put.storageKey, {
        sha256: put.sha256,
        byteSize: put.byteSize,
      }),
    ).rejects.toMatchObject({ status: 500, code: "file_corrupted" });

    // Remove binary -> verify reports missing and getPrivateObject returns null
    fs.unlinkSync(storedPath);
    const missingVerify = await storage.verifyPrivateObject(put.storageKey, {
      sha256: put.sha256,
      byteSize: put.byteSize,
    });
    expect(missingVerify.ok).toBe(false);
    expect(missingVerify.status).toBe("missing");
    expect(await storage.getPrivateObject(put.storageKey)).toBeNull();
  });

  it("cleans up staging files when DisposableTestProofStorage injects persist failure", async () => {
    const dir = makeTempDir("b11a-fault-");
    const storage = new DisposableTestProofStorage(dir);
    storage.setFaults({ failOnPersist: true });

    await expect(
      storage.putPrivateObject({
        ownerUserId: "usr_owner1",
        proofId: "proof_fail_1",
        originalFileName: "receipt.pdf",
        content: buildValidRealPdf(),
      }),
    ).rejects.toMatchObject({ status: 500, code: "storage_error" });

    const orphanReport = await storage.listOrphanedObjects(new Set(), {
      minAgeMs: 0,
      tempMaxAgeMs: 0,
    });
    expect(orphanReport.unreferencedFiles).toEqual([]);
    expect(orphanReport.staleTempFiles).toEqual([]);

    storage.clearFaults();
  });
});

describe("B11A Hostinger Blocker Truthfulness & IndexedDB Migration Mapping", () => {
  it("keeps Data Vault storage blocker truthful and Hostinger-aligned without S3/R2 recommendation", () => {
    const blocker = VAULT_BLOCKERS.find((b) => b.id === "blocker-storage-durability");
    expect(blocker).toBeDefined();
    expect(blocker?.severity).toBe("critical");
    expect(blocker?.status).toBe("unverified");
    expect(blocker?.description).toContain("Hostinger Business");
    expect(blocker?.description).not.toContain("An S3/R2-compatible durable object storage driver");
  });

  it("preserves IndexedDB ProofMeta fields cleanly via MigrationMapper without mutating browser storage", () => {
    const mapper = new MigrationMapper("usr_owner1");
    const mapped = mapper.mapPaymentProof(
      {
        attachmentId: "att_idb_1",
        paymentId: "pay_local_1",
        originalFileName: "upi-screenshot.png",
        mimeType: "image/png",
        fileSize: 2048,
        sha256: "a".repeat(64),
        path: "files/payment-proofs/att_idb_1__upi-screenshot.png",
        uploadedAt: "2026-11-10T10:15:00.000Z",
      },
      "deal_local_1",
    );
    expect(mapped.legacyAttachmentId).toBe("att_idb_1");
    expect(mapped.mimeType).toBe("image/png");
    expect(mapped.fileSize).toBe(2048);
    expect(mapped.sha256Hash).toBe("a".repeat(64));
  });
});
