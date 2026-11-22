import { describe, expect, it, vi } from "vitest";
import { handleCrmApiRequest } from "./http/crmRoutes.server";
import type { ServerEnv } from "./config/env.server";
import { buildSyntheticMigrationZip } from "./migration/index.server";

vi.mock("./auth/authService.server", () => ({
  resolveAuthenticatedSession: vi.fn(async (token: string | null) => {
    if (token === "valid-owner-token") {
      return {
        status: "authenticated",
        user: { id: "usr_owner_b13", email: "owner@example.test", name: "Owner", roleId: "owner" },
        sessionId: "sess_b13",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
      };
    }
    return { status: "unauthenticated", reason: "missing" };
  }),
}));

vi.mock("./db/index.server", () => ({
  getDatabase: vi.fn(() => ({
    insert: () => {
      throw new Error("MUTATION VIOLATION: DB insert should never be called in B13 API routes");
    },
    update: () => {
      throw new Error("MUTATION VIOLATION: DB update should never be called in B13 API routes");
    },
    delete: () => {
      throw new Error("MUTATION VIOLATION: DB delete should never be called in B13 API routes");
    },
  })),
}));

const DEV_ENV = {
  NODE_ENV: "development",
  DEV_LEAD_PILOT: true,
  PORT: 3000,
  HOST: "127.0.0.1",
  APP_ORIGIN: "http://127.0.0.1:3000",
  BUSINESS_TIMEZONE: "Asia/Kolkata",
  DB_PORT: 3306,
  DB_POOL_LIMIT: 8,
  DB_SSL_MODE: "preferred",
  PROOF_STORAGE_DRIVER: "mariadb-blob",
  PROOF_STORAGE_DIR: ".data/private-proofs",
  SESSION_COOKIE_NAME: "sf_sess",
  SESSION_TTL_HOURS: 24,
  SESSION_IDLE_MINUTES: 60,
  LOGIN_RATE_LIMIT_MAX: 10,
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: 15,
  TRUST_PROXY: false,
} as unknown as ServerEnv;

describe("Checkpoint B13: Migration Wizard HTTP API Endpoints", () => {
  it("GET /api/v1/vault/migration/readiness returns Hostinger-exclusive readiness with R2 not required", async () => {
    const req = new Request("http://127.0.0.1:3000/api/v1/vault/migration/readiness", {
      method: "GET",
      headers: { Cookie: "sf_sess=valid-owner-token" },
    });
    const res = await handleCrmApiRequest(req, "/api/v1/vault/migration/readiness", DEV_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["hostingProvider"]).toBe("hostinger_exclusive");
    expect(body["cloudflareR2Required"]).toBe(false);
    expect(body["proofStorageDriver"]).toBe("mariadb-blob");
    expect(body["liveExecutionLocked"]).toBe(true);
  });

  it("POST /api/v1/vault/migration/analyze validates uploaded synthetic ZIP with zero DB writes", async () => {
    const { zipBytes, filename } = buildSyntheticMigrationZip();
    const fileBase64 = Buffer.from(zipBytes).toString("base64");

    const req = new Request("http://127.0.0.1:3000/api/v1/vault/migration/analyze", {
      method: "POST",
      headers: {
        Cookie: "sf_sess=valid-owner-token",
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
        "x-migration-filename": filename,
      },
      body: JSON.stringify({ fileBase64 }),
    });
    const res = await handleCrmApiRequest(req, "/api/v1/vault/migration/analyze", DEV_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      analysis: { dryRun: boolean; databaseWritten: boolean; financialReconciliation: { financialParityPassed: boolean } };
    };
    expect(body.ok).toBe(true);
    expect(body.analysis.dryRun).toBe(true);
    expect(body.analysis.databaseWritten).toBe(false);
    expect(body.analysis.financialReconciliation.financialParityPassed).toBe(true);
  });

  it("POST /api/v1/vault/migration/synthetic-shadow-test runs isolated shadow test cleanly", async () => {
    const req = new Request("http://127.0.0.1:3000/api/v1/vault/migration/synthetic-shadow-test", {
      method: "POST",
      headers: {
        Cookie: "sf_sess=valid-owner-token",
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ syntheticOnly: true }),
    });
    const res = await handleCrmApiRequest(req, "/api/v1/vault/migration/synthetic-shadow-test", DEV_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      shadowReport: { realDatabaseTouched: boolean; rollbackVerified: boolean; pass2InsertedTotal: number };
    };
    expect(body.ok).toBe(true);
    expect(body.shadowReport.realDatabaseTouched).toBe(false);
    expect(body.shadowReport.rollbackVerified).toBe(true);
    expect(body.shadowReport.pass2InsertedTotal).toBe(0);
  });

  it("POST /api/v1/vault/migration/execute is strictly locked with 403 MIGRATION_EXECUTION_LOCKED", async () => {
    const req = new Request("http://127.0.0.1:3000/api/v1/vault/migration/execute", {
      method: "POST",
      headers: {
        Cookie: "sf_sess=valid-owner-token",
        Origin: "http://127.0.0.1:3000",
      },
    });
    const res = await handleCrmApiRequest(req, "/api/v1/vault/migration/execute", DEV_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MIGRATION_EXECUTION_LOCKED");
  });
});
