import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  getDatabaseConnectionConfig,
  isLeadPilotAvailable,
  parseServerEnv,
  summarizeSafeRuntimeEnv,
} from "./config/env.server";
import { buildMysqlPoolOptions } from "./db/index.server";
import {
  decimalStringToPaise,
  decimalStringToRupees,
  isValidInrAmount,
  outstandingPaise,
  paiseToDecimalString,
  rupeesToPaise,
  sumPaise,
} from "./db/money.server";
import { crmSchemaMeta } from "./db/schema.server";
import { handleApiRequest, isApiRequestPath } from "./http/apiRouter.server";
import {
  assessProofDirectorySafety,
  isValidProofStorageKey,
  resolveSafeProofPath,
} from "./storage/proofStorage.server";

describe("B1A Server Foundation — environment & secret hygiene", () => {
  it("parses empty env cleanly with safe defaults", () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.BUSINESS_TIMEZONE).toBe("Asia/Kolkata");
    expect(env.DB_POOL_LIMIT).toBe(8);
    expect(env.PROOF_STORAGE_DRIVER).toBe("local-fs");
    expect(env.AI_PROVIDER).toBe("demo");

    const dbCfg = getDatabaseConnectionConfig(env);
    expect(dbCfg.configured).toBe(false);
    expect(dbCfg.source).toBe("none");
  });

  it("does not echo secret values when validation fails", () => {
    const secretSentinel = "SuperSecretDbPassword_DO_NOT_LEAK_991";
    expect(() =>
      parseServerEnv({
        DB_PASSWORD: secretSentinel,
        PORT: "not-a-port",
      }),
    ).toThrow(/PORT/);

    try {
      parseServerEnv({
        DB_PASSWORD: secretSentinel,
        PORT: "not-a-port",
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretSentinel);
    }
  });

  it("flags Hostinger IPv6 localhost hostname while accepting 127.0.0.1", () => {
    const unsafe = getDatabaseConnectionConfig(
      parseServerEnv({
        DB_HOST: "localhost",
        DB_NAME: "crm_test",
        DB_USER: "crm_user",
        DB_PASSWORD: "synthetic-only-password",
      }),
    );
    expect(unsafe.configured).toBe(true);
    expect(unsafe.usesLocalhostHostname).toBe(true);

    const safe = getDatabaseConnectionConfig(
      parseServerEnv({
        DB_HOST: "127.0.0.1",
        DB_NAME: "crm_test",
        DB_USER: "crm_user",
        DB_PASSWORD: "synthetic-only-password",
      }),
    );
    expect(safe.configured).toBe(true);
    expect(safe.usesLocalhostHostname).toBe(false);

    const urlUnsafe = getDatabaseConnectionConfig(
      parseServerEnv({
        DATABASE_URL: "mysql://u:p@localhost:3306/crm_test",
      }),
    );
    expect(urlUnsafe.usesLocalhostHostname).toBe(true);
  });

  it("summarizes runtime state without exposing credentials or paths", () => {
    const summary = summarizeSafeRuntimeEnv(
      parseServerEnv({
        DB_HOST: "127.0.0.1",
        DB_NAME: "crm_prod_like",
        DB_USER: "secret_db_user",
        DB_PASSWORD: "secret_db_password_xyz",
        PROOF_STORAGE_DIR: "/home/secret/path/proofs",
      }),
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret_db_user");
    expect(serialized).not.toContain("secret_db_password_xyz");
    expect(serialized).not.toContain("crm_prod_like");
    expect(serialized).not.toContain("/home/secret/path");
    expect(summary.dbConfigured).toBe(true);
    expect(summary.dbHostLoopbackSafe).toBe(true);
  });

  it("enforces server-only DEV_LEAD_PILOT gate and disables pilot unconditionally in production", () => {
    expect(isLeadPilotAvailable(parseServerEnv({}))).toBe(false);
    expect(
      isLeadPilotAvailable(parseServerEnv({ NODE_ENV: "development", DEV_LEAD_PILOT: "false" })),
    ).toBe(false);
    expect(
      isLeadPilotAvailable(parseServerEnv({ NODE_ENV: "development", DEV_LEAD_PILOT: "true" })),
    ).toBe(true);
    expect(isLeadPilotAvailable(parseServerEnv({ NODE_ENV: "test", DEV_LEAD_PILOT: "true" }))).toBe(
      true,
    );
    expect(
      isLeadPilotAvailable(parseServerEnv({ NODE_ENV: "production", DEV_LEAD_PILOT: "true" })),
    ).toBe(false);
  });
});

describe("B1A Database Foundation — money precision, pool flags, schema", () => {
  it("converts rupees <-> integer paise <-> DECIMAL(15,2) strings without float drift", () => {
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(850_000_000.5)).toBe(85_000_000_050);

    expect(paiseToDecimalString(1999)).toBe("19.99");
    expect(paiseToDecimalString(125005)).toBe("1250.05");
    expect(decimalStringToPaise("1250.05")).toBe(125005);
    expect(decimalStringToPaise("850000000.5")).toBe(85_000_000_050);
    expect(decimalStringToRupees("19.99")).toBe(19.99);

    // Classic IEEE-754 drift (0.1 + 0.2 = 0.30000000000000004) stays exact in paise
    const exactSum = sumPaise([rupeesToPaise(0.1), rupeesToPaise(0.2)]);
    expect(paiseToDecimalString(exactSum)).toBe("0.30");
    expect(outstandingPaise(100_000, 125_000)).toBe(0);
    expect(outstandingPaise(100_000, 35_000)).toBe(65_000);
  });

  it("rejects invalid, negative, >2dp, and malformed DECIMAL amounts", () => {
    expect(isValidInrAmount(-1)).toBe(false);
    expect(isValidInrAmount(Number.NaN)).toBe(false);
    expect(isValidInrAmount(10.123)).toBe(false);
    expect(() => rupeesToPaise(10.129)).toThrow(RangeError);
    expect(() => decimalStringToPaise("-50.00")).toThrow(RangeError);
    expect(() => decimalStringToPaise("12.345")).toThrow(RangeError);
    expect(() => decimalStringToPaise("invalid")).toThrow(RangeError);
  });

  it("enforces UTC, exact decimal strings, and multipleStatements=false on mysql2 pool", () => {
    const cfg = getDatabaseConnectionConfig(
      parseServerEnv({
        DB_HOST: "127.0.0.1",
        DB_NAME: "crm_dev",
        DB_USER: "crm_user",
        DB_PASSWORD: "pw",
        DB_POOL_LIMIT: "6",
      }),
    );
    const poolOptions = buildMysqlPoolOptions(cfg);
    expect(poolOptions.timezone).toBe("Z");
    expect(poolOptions.decimalNumbers).toBe(false);
    expect(poolOptions.dateStrings).toBe(true);
    expect(poolOptions.multipleStatements).toBe(false);
    expect(poolOptions.connectionLimit).toBe(6);
  });

  it("defines the foundation _crm_schema_meta MySQL table", () => {
    expect(getTableName(crmSchemaMeta)).toBe("_crm_schema_meta");
    const cols = Object.keys(getTableColumns(crmSchemaMeta));
    expect(cols).toEqual(["metaKey", "metaValue", "version", "createdAt", "updatedAt"]);
  });
});

describe("B1A Private Storage Boundary — traversal & webroot safety", () => {
  it("accepts clean storage keys and blocks traversal patterns", () => {
    expect(isValidProofStorageKey("pay_123__receipt.pdf")).toBe(true);
    expect(isValidProofStorageKey("../etc/passwd")).toBe(false);
    expect(isValidProofStorageKey("sub/file.png")).toBe(false);
    expect(isValidProofStorageKey("sub\\file.png")).toBe(false);

    const root = path.resolve("private-proofs-test");
    const safe = resolveSafeProofPath(root, "pay_abc__proof.png");
    expect(safe).toBe(path.resolve(root, "pay_abc__proof.png"));
    expect(() => resolveSafeProofPath(root, "..\\secret.txt")).toThrow();
  });

  it("flags public_html, public, .output, and Hostinger hbuilds directories", () => {
    const bad = assessProofDirectorySafety("/home/u1/domains/x.in/hbuilds/current/nodejs/proofs");
    expect(bad.unsafePublicOrBuildPath).toBe(true);
    expect(bad.reasons.length).toBeGreaterThan(0);

    const badWeb = assessProofDirectorySafety("/home/u1/domains/x.in/public_html/proofs");
    expect(badWeb.unsafePublicOrBuildPath).toBe(true);

    const good = assessProofDirectorySafety("/home/u1/domains/x.in/private-data/payment-proofs");
    expect(good.unsafePublicOrBuildPath).toBe(false);
    expect(good.reasons).toEqual([]);
  });
});

describe("B1A HTTP API Router & Health Endpoint", () => {
  it("routes /api/* separately from SSR UI routes", () => {
    expect(isApiRequestPath("/api")).toBe(true);
    expect(isApiRequestPath("/api/v1/health")).toBe(true);
    expect(isApiRequestPath("/leads")).toBe(false);
    expect(isApiRequestPath("/data-vault")).toBe(false);
  });

  it("serves GET/HEAD /api/v1/health without exposing secrets and rejects POST with 405", async () => {
    const prevPassword = process.env["DB_PASSWORD"];
    const prevOpenRouter = process.env["OPENROUTER_API_KEY"];
    process.env["DB_PASSWORD"] = "LEAK_TEST_DB_PASS_001";
    process.env["OPENROUTER_API_KEY"] = "sk-or-v1-LEAK-TEST-KEY";

    try {
      const res = await handleApiRequest(new Request("http://127.0.0.1:4173/api/v1/health"));
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      expect(res!.headers.get("cache-control")).toBe("no-store");
      expect(res!.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res!.headers.get("x-frame-options")).toBe("DENY");

      const text = await res!.text();
      expect(text).not.toContain("LEAK_TEST_DB_PASS_001");
      expect(text).not.toContain("sk-or-v1-LEAK-TEST-KEY");
      expect(text).not.toContain("OPENROUTER");

      const json = JSON.parse(text) as {
        ok: boolean;
        status: string;
        checkpoint: string;
        runtime: { nitroPreset: string };
        subsystems: { ai: { mode: string } };
      };
      expect(json.ok).toBe(true);
      expect(json.status).toBe("ok");
      expect(json.checkpoint).toBe("b1a");
      expect(json.runtime.nitroPreset).toBe("node-server");
      expect(json.subsystems.ai.mode).toBe("demo");

      const head = await handleApiRequest(
        new Request("http://127.0.0.1:4173/api/v1/health", { method: "HEAD" }),
      );
      expect(head!.status).toBe(200);

      const post = await handleApiRequest(
        new Request("http://127.0.0.1:4173/api/v1/health", { method: "POST" }),
      );
      expect(post!.status).toBe(405);
      expect(post!.headers.get("allow")).toBe("GET, HEAD");
    } finally {
      if (prevPassword === undefined) delete process.env["DB_PASSWORD"];
      else process.env["DB_PASSWORD"] = prevPassword;
      if (prevOpenRouter === undefined) delete process.env["OPENROUTER_API_KEY"];
      else process.env["OPENROUTER_API_KEY"] = prevOpenRouter;
    }
  });

  it("returns structured 404 JSON for unknown /api paths and null for frontend pages", async () => {
    const missing = await handleApiRequest(new Request("http://127.0.0.1:4173/api/v1/unknown"));
    expect(missing).not.toBeNull();
    expect(missing!.status).toBe(404);
    expect(missing!.headers.get("content-type")).toContain("application/json");
    const body = (await missing!.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("not_found");

    const uiRoute = await handleApiRequest(new Request("http://127.0.0.1:4173/leads"));
    expect(uiRoute).toBeNull();
  });
});
