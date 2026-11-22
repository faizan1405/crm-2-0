import { describe, expect, it } from "vitest";
import {
  isCrmApiEnabled,
  isCrmV2DefaultBackend,
  isLeadPilotAvailable,
  parseServerEnv,
} from "./config/env.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";
import type { ServerEnv } from "./config/env.server";

describe("Checkpoint B14A: Explicit CRM_V2_DEFAULT_BACKEND Deployment Feature Flag", () => {
  it("never auto-enables default MariaDB backend from NODE_ENV=production alone", () => {
    const prodWithoutFlag = parseServerEnv({
      NODE_ENV: "production",
      DEV_LEAD_PILOT: "false",
    });
    expect(isLeadPilotAvailable(prodWithoutFlag)).toBe(false);
    expect(isCrmV2DefaultBackend(prodWithoutFlag)).toBe(false);
    expect(isCrmApiEnabled(prodWithoutFlag)).toBe(false);
  });

  it("enables default MariaDB backend only when CRM_V2_DEFAULT_BACKEND=true is explicitly set", () => {
    const stagingWithFlag = parseServerEnv({
      NODE_ENV: "production",
      DEV_LEAD_PILOT: "false",
      CRM_V2_DEFAULT_BACKEND: "true",
    });
    expect(isLeadPilotAvailable(stagingWithFlag)).toBe(false);
    expect(isCrmV2DefaultBackend(stagingWithFlag)).toBe(true);
    expect(isCrmApiEnabled(stagingWithFlag)).toBe(true);
  });

  it("keeps POST /api/v1/vault/migration/execute strictly 403 locked even when CRM_V2_DEFAULT_BACKEND=true", async () => {
    const envWithFlag = {
      NODE_ENV: "production",
      DEV_LEAD_PILOT: false,
      CRM_V2_DEFAULT_BACKEND: true,
      PORT: 3000,
      HOST: "127.0.0.1",
      APP_ORIGIN: "https://khaki-butterfly-345144.hostingersite.com",
      BUSINESS_TIMEZONE: "Asia/Kolkata",
      DB_PORT: 3306,
      DB_POOL_LIMIT: 8,
      DB_SSL_MODE: "preferred",
      PROOF_STORAGE_DRIVER: "mariadb-blob",
      PROOF_STORAGE_DIR: ".data/private-proofs",
      SESSION_COOKIE_NAME: "sf_session",
      SESSION_TTL_HOURS: 24,
      SESSION_IDLE_MINUTES: 60,
      LOGIN_RATE_LIMIT_MAX: 10,
      LOGIN_RATE_LIMIT_WINDOW_MINUTES: 15,
      TRUST_PROXY: true,
    } as unknown as ServerEnv;

    const req = new Request(
      "https://khaki-butterfly-345144.hostingersite.com/api/v1/vault/migration/execute",
      {
        method: "POST",
        headers: { Origin: "https://khaki-butterfly-345144.hostingersite.com" },
      },
    );
    const res = await handleCrmApiRequest(req, "/api/v1/vault/migration/execute", envWithFlag);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MIGRATION_EXECUTION_LOCKED");
  });
});
