import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleApiRequest } from "./http/apiRouter.server";
import { parseServerEnv } from "./config/env.server";
import {
  getMonitoringCountersSnapshot,
  logOperationalEvent,
  recordAuthFailure,
  recordDbConnectivityFailure,
  recordProofUploadFailure,
  recordUnhandledApiError,
  resetMonitoringTelemetryForTests,
  sanitizeLogMeta,
} from "./monitoring/logger.server";
import {
  evaluateMonitoringAlerts,
  getOwnerMonitoringSnapshot,
} from "./monitoring/monitoringService.server";
import { strToU8, zipSync } from "fflate";
import {
  splitBufferIntoProofChunks,
  MARIADB_PROOF_CHUNK_BYTES,
} from "./storage/mariadbBlobProofStorage.server";
import { validateProofHeaderAndMetadata } from "./storage/proofValidation.server";
import { executeRestoreDryRun } from "./backup/dryRun.server";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";
import type { MariadbUsageMeasurement } from "./storage/mariadbCapacity.server";

function makeCapacity(overrides: Partial<MariadbUsageMeasurement> = {}): MariadbUsageMeasurement {
  return {
    tableCount: 49,
    logicalInfoSchemaBytes: 8 * 1024 * 1024,
    nonBlobInfoSchemaBytes: 8 * 1024 * 1024,
    blobTableInfoSchemaBytes: 0,
    dataFreeBytes: 0,
    blobChunkCount: 0,
    blobPayloadBytes: 0,
    liveBlobWithOverheadBytes: 0,
    rawMeasuredBytes: 8 * 1024 * 1024,
    safetyMarginBytes: 16 * 1024 * 1024,
    effectiveUsedBytes: 24 * 1024 * 1024,
    effectiveUsedMiB: 24,
    quotaMiB: 3072,
    warningThresholdMiB: 1536,
    hardStopThresholdMiB: 2150,
    safetyMarginMiB: 16,
    percentOfQuota: 0.78,
    remainingProofBudgetBytes: 2126 * 1024 * 1024,
    remainingProofBudgetMiB: 2126,
    status: "ok",
    allowNewProofUploads: true,
    measuredAtIso: "2026-11-22T17:00:00.000Z",
    ...overrides,
  };
}

describe("B16A Production Monitoring & Hardening", () => {
  beforeEach(() => {
    resetMonitoringTelemetryForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMonitoringTelemetryForTests();
  });

  it("emits Hostinger-compatible structured JSON logs and redacts secrets & DSNs", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rec = logOperationalEvent(
      "ERROR",
      "test_error",
      "Synthetic failure",
      {
        password: "super-secret-password",
        authSecret: "hex-secret-token",
        cookie: "sf_session=rawtoken",
        dsn: "mysql://user:pass@127.0.0.1:3306/prod",
        note: "Connecting to mysql://u:p@srv469.hstgr.io:3306/db failed",
        safeCode: "ECONNRESET",
      },
      new Date("2026-11-22T17:00:00.000Z"),
    );

    expect(rec.timestamp).toBe("2026-11-22T17:00:00.000Z");
    expect(rec.level).toBe("ERROR");
    expect(rec.message).toBe("Synthetic failure");
    expect(rec.service).toBe("scale-flow-crm-v2");
    expect(errSpy).toHaveBeenCalledTimes(1);

    const emittedLine = String(errSpy.mock.calls[0]?.[0] ?? "");
    const parsed = JSON.parse(emittedLine) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBe("2026-11-22T17:00:00.000Z");
    expect(parsed["level"]).toBe("ERROR");
    expect(parsed["message"]).toBe("Synthetic failure");
    expect(emittedLine).not.toContain("super-secret-password");
    expect(emittedLine).not.toContain("hex-secret-token");
    expect(emittedLine).not.toContain("rawtoken");
    expect(emittedLine).not.toContain("user:pass");
    expect(emittedLine).not.toContain("u:p@srv469");
    expect(emittedLine).toContain("ECONNRESET");

    const sanitized = sanitizeLogMeta({ api_key: "sk-123", nested: { token: "abc", ok: true } });
    expect(sanitized?.["api_key"]).toBe("[REDACTED]");
    expect((sanitized?.["nested"] as Record<string, unknown>)?.["token"]).toBe("[REDACTED]");
    expect((sanitized?.["nested"] as Record<string, unknown>)?.["ok"]).toBe(true);
  });

  it("tracks bounded in-process operational telemetry counters for errors, uploads, auth, and DB", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    recordUnhandledApiError({
      path: "/api/v1/leads",
      method: "GET",
      status: 500,
      error: new Error("boom"),
    });
    recordProofUploadFailure({
      path: "/api/v1/payments/p1/proof",
      code: "storage_quota_hard_stop",
      status: 507,
    });
    recordAuthFailure({
      event: "auth_login_failed",
      reason: "rate_limited",
      status: 429,
      path: "/api/v1/auth/login",
      ipPrefix: "203.0.113.0/24",
    });
    recordDbConnectivityFailure({ reason: "ETIMEDOUT" });

    const snap = getMonitoringCountersSnapshot();
    expect(snap.unhandledErrorsTotal).toBe(1);
    expect(snap.proofUploadFailuresTotal).toBe(1);
    expect(snap.lastProofUploadFailureCode).toBe("storage_quota_hard_stop");
    expect(snap.authFailuresTotal).toBe(1);
    expect(snap.lastAuthFailureReason).toBe("rate_limited");
    expect(snap.dbConnectivityFailuresTotal).toBe(1);
    expect(snap.recentErrors.length).toBe(4);
  });

  it("evaluates healthy, degraded, and critical monitoring alert states accurately", () => {
    const cleanTelemetry = getMonitoringCountersSnapshot();
    const healthy = evaluateMonitoringAlerts({
      databaseReachable: true,
      databaseConfigured: true,
      storageCapacity: makeCapacity(),
      proofs: { total: 5, verified: 5, pendingVerify: 0, corrupted: 0, missing: 0, failed: 0 },
      auth: {
        windowHours: 24,
        loginSucceeded: 3,
        loginFailed: 1,
        rateLimited: 0,
        sessionRejected: 0,
        activeSessions: 1,
      },
      backupReport: null,
      telemetry: cleanTelemetry,
    });
    expect(healthy.status).toBe("healthy");
    expect(healthy.alerts).toHaveLength(0);

    const warning = evaluateMonitoringAlerts({
      databaseReachable: true,
      databaseConfigured: true,
      storageCapacity: makeCapacity({
        status: "warning",
        effectiveUsedMiB: 1600,
        percentOfQuota: 52.08,
      }),
      proofs: { total: 5, verified: 5, pendingVerify: 0, corrupted: 0, missing: 0, failed: 0 },
      auth: {
        windowHours: 24,
        loginSucceeded: 1,
        loginFailed: 6,
        rateLimited: 1,
        sessionRejected: 0,
        activeSessions: 1,
      },
      backupReport: null,
      telemetry: cleanTelemetry,
    });
    expect(warning.status).toBe("degraded");
    expect(warning.alerts.map((a) => a.code)).toContain("storage_quota_warning");
    expect(warning.alerts.map((a) => a.code)).toContain("elevated_auth_failures");

    const critical = evaluateMonitoringAlerts({
      databaseReachable: false,
      databaseConfigured: true,
      storageCapacity: makeCapacity({
        status: "hard_stop_uploads",
        effectiveUsedMiB: 2200,
        percentOfQuota: 71.61,
        allowNewProofUploads: false,
      }),
      proofs: { total: 5, verified: 4, pendingVerify: 0, corrupted: 1, missing: 0, failed: 0 },
      auth: null,
      backupReport: null,
      telemetry: cleanTelemetry,
    });
    expect(critical.status).toBe("critical");
    expect(critical.alerts.map((a) => a.code)).toEqual(
      expect.arrayContaining([
        "database_unreachable",
        "storage_quota_hard_stop",
        "proof_integrity_degraded",
      ]),
    );
  });

  it("builds a complete secret-free Owner monitoring snapshot with backup freshness evaluation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-b16a-mon-"));
    const stateFile = path.join(tmpDir, "backup-health.json");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        lastSuccessfulBackupAt: "2026-11-22T15:00:00.000Z",
        lastSuccessfulOffsiteUploadAt: "2026-11-22T15:05:00.000Z",
        lastVerifiedRestoreAt: "2026-11-22T15:15:00.000Z",
        lastArchiveSizeBytes: 12 * 1024 * 1024,
        lastArchiveSha256: "abc123",
        lastArchiveKey: "daily/2026-11-22.age",
        lastError: null,
        lastErrorAt: null,
        totalArchivesTracked: 7,
        estimatedR2StorageMiB: 84,
      }),
      "utf8",
    );

    try {
      const env = parseServerEnv({
        NODE_ENV: "production",
        DB_HOST: "127.0.0.1",
        DB_NAME: "u256504187_crm_v2_prod",
        DB_USER: "u256504187_crm_v2_usr",
        DB_PASSWORD: "never-leak-this-password",
        PROOF_STORAGE_DRIVER: "mariadb-blob",
        PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
      });

      const snapshot = await getOwnerMonitoringSnapshot("usr_owner_1", {
        env,
        now: new Date("2026-11-22T17:00:00.000Z"),
        backupStatePath: stateFile,
        db: {} as never,
        probeDatabase: async () => ({
          configured: true,
          driver: "mysql2",
          source: "fields",
          poolLimit: 8,
          ipv4LoopbackSafe: true,
          partialConfigDetected: false,
          reachable: true,
          latencyMs: 4,
        }),
        measureCapacity: async () => makeCapacity(),
        queryProofCounts: async () => ({
          total: 2,
          verified: 2,
          pendingVerify: 0,
          corrupted: 0,
          missing: 0,
          failed: 0,
        }),
        queryAuthSummary: async () => ({
          windowHours: 24,
          loginSucceeded: 2,
          loginFailed: 0,
          rateLimited: 0,
          sessionRejected: 0,
          activeSessions: 1,
        }),
      });

      expect(snapshot.ok).toBe(true);
      expect(snapshot.status).toBe("healthy");
      expect(snapshot.database.reachable).toBe(true);
      expect(snapshot.database.latencyMs).toBe(4);
      expect(snapshot.storage.productionReady).toBe(true);
      expect(snapshot.storage.capacity?.percentOfQuota).toBe(0.78);
      expect(snapshot.proofs?.verified).toBe(2);
      expect(snapshot.backup.trackedStatePresent).toBe(true);
      expect(snapshot.backup.report?.status).toBe("healthy");
      expect(snapshot.backup.report?.recoveryVerified).toBe(true);

      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("never-leak-this-password");
      expect(serialized).not.toContain("u256504187_crm_v2_usr");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces fail-closed auth and method rules on GET /api/v1/monitoring/summary", async () => {
    const postRes = await handleApiRequest(
      new Request("https://crm2.joinscaleflow.in/api/v1/monitoring/summary", { method: "POST" }),
    );
    expect(postRes?.status).toBe(405);

    const getRes = await handleApiRequest(
      new Request("https://crm2.joinscaleflow.in/api/v1/monitoring/summary", { method: "GET" }),
    );
    // Unauthenticated or unconfigured DB must fail closed (401 or 503), never 200
    expect([401, 503]).toContain(getRes?.status);
  });

  it("verifies isolated payment-proof chunking, SHA-256 integrity, validation, and backup dry-run parity", async () => {
    // 1. Construct a valid 2.2 MiB PDF buffer (forces 3 MariaDB 1 MiB chunks)
    const pdfHeader = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n", "utf8");
    const pdfFooter = Buffer.from("\n%%EOF\n", "utf8");
    const filler = crypto.randomBytes(2_200_000);
    const fullPdf = Buffer.concat([pdfHeader, filler, pdfFooter]);

    const validation = validateProofHeaderAndMetadata({
      originalName: "receipt-b16a-qa.pdf",
      fileSize: fullPdf.byteLength,
      headerBytes: fullPdf.subarray(0, 64),
      declaredMimeType: "application/pdf",
      fullBytes: fullPdf,
    });
    expect(validation.mimeType).toBe("application/pdf");
    expect(validation.fileSize).toBe(fullPdf.byteLength);

    // 2. Chunk into 1 MiB MariaDB LONGBLOB slices & reassemble with SHA-256 parity
    const expectedSha256 = crypto.createHash("sha256").update(fullPdf).digest("hex");
    const chunks = splitBufferIntoProofChunks(fullPdf, MARIADB_PROOF_CHUNK_BYTES);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.byteLength).toBe(MARIADB_PROOF_CHUNK_BYTES);

    const reassembled = Buffer.concat(chunks);
    const actualSha256 = crypto.createHash("sha256").update(reassembled).digest("hex");
    expect(actualSha256).toBe(expectedSha256);

    // 3. Flip 1 bit and verify SHA-256 detects corruption immediately
    const corrupted = Buffer.from(reassembled);
    corrupted[1024] = (corrupted[1024] ?? 0) ^ 0x01;
    const corruptedSha256 = crypto.createHash("sha256").update(corrupted).digest("hex");
    expect(corruptedSha256).not.toBe(expectedSha256);

    // 4. Verify isolated zero-mutation backup archive + dry-run verification
    const leads = [
      {
        id: "lead_qa_1",
        name: "QA Synthetic Lead",
        status: "new",
        createdAt: "2026-11-22T12:00:00Z",
      },
    ];
    const deals = [
      {
        id: "deal_qa_1",
        leadId: "lead_qa_1",
        name: "QA Deal",
        valuePaise: 5000000,
        status: "won",
        createdAt: "2026-11-22T12:00:00Z",
      },
    ];
    const payments = [
      {
        id: "pay_qa_1",
        dealId: "deal_qa_1",
        amountPaise: 5000000,
        voided: false,
        status: "completed",
        date: "2026-11-22",
      },
    ];
    const proofPath = "files/payment-proofs/pay_qa_1__receipt.pdf";

    const leadsBytes = strToU8(canonicalJsonStringify({ leads }));
    const dealsBytes = strToU8(canonicalJsonStringify({ deals }));
    const paymentsBytes = strToU8(canonicalJsonStringify({ payments }));
    const attMetaBytes = strToU8(
      canonicalJsonStringify({
        attachments: [
          {
            attachmentId: "proof_qa_1",
            paymentId: "pay_qa_1",
            originalFileName: "receipt-b16a-qa.pdf",
            mimeType: "application/pdf",
            fileSize: fullPdf.byteLength,
            sha256: expectedSha256,
            path: proofPath,
          },
        ],
      }),
    );

    const manifest = buildManifest({
      type: "full",
      includedEntities: ["leads", "deals", "payments", "proofs"],
      counts: { leads: 1, deals: 1, payments: 1 },
      financialSummary: buildFinancialSummary({ deals, payments }),
      files: [
        {
          path: "data/leads.json",
          bytes: leadsBytes.byteLength,
          sha256: computeSha256(leadsBytes),
        },
        {
          path: "data/deals.json",
          bytes: dealsBytes.byteLength,
          sha256: computeSha256(dealsBytes),
        },
        {
          path: "data/payments.json",
          bytes: paymentsBytes.byteLength,
          sha256: computeSha256(paymentsBytes),
        },
        {
          path: "data/attachment-metadata.json",
          bytes: attMetaBytes.byteLength,
          sha256: computeSha256(attMetaBytes),
        },
        { path: proofPath, bytes: fullPdf.byteLength, sha256: expectedSha256 },
      ],
      attachmentsMeta: [
        {
          attachmentId: "proof_qa_1",
          paymentId: "pay_qa_1",
          originalFileName: "receipt-b16a-qa.pdf",
          mimeType: "application/pdf",
          fileSize: fullPdf.byteLength,
          sha256: expectedSha256,
          path: proofPath,
          uploadedAt: "2026-11-22T12:00:00Z",
          status: "verified",
        },
      ],
    });
    const zipBytes = zipSync({
      "manifest.json": strToU8(canonicalJsonStringify(manifest)),
      "data/leads.json": leadsBytes,
      "data/deals.json": dealsBytes,
      "data/payments.json": paymentsBytes,
      "data/attachment-metadata.json": attMetaBytes,
      [proofPath]: new Uint8Array(fullPdf),
    });

    const dryRun = await executeRestoreDryRun(zipBytes);
    expect(dryRun.databaseWritten).toBe(false);
    expect(dryRun.mutationsPerformed).toBe(0);
    expect(dryRun.ok).toBe(true);
    expect(dryRun.financialReconciliation.reconciled).toBe(true);
    expect(dryRun.unresolvedForeignKeys).toHaveLength(0);
  });
});
