import "@tanstack/react-start/server-only";
import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalString = () => z.preprocess(emptyToUndefined, z.string().min(1).optional());

const optionalIntInRange = (min: number, max: number, fallback: number) =>
  z.preprocess(
    (value) => (emptyToUndefined(value) === undefined ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );

export const serverEnvSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  PORT: optionalIntInRange(1, 65535, 3000),
  HOST: z.preprocess(emptyToUndefined, z.string().min(1).default("0.0.0.0")),
  APP_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  BUSINESS_TIMEZONE: z.preprocess(emptyToUndefined, z.string().min(1).default("Asia/Kolkata")),

  DATABASE_URL: optionalString(),
  DB_HOST: optionalString(),
  DB_PORT: optionalIntInRange(1, 65535, 3306),
  DB_NAME: optionalString(),
  DB_USER: optionalString(),
  DB_PASSWORD: z.string().optional(),
  DB_POOL_LIMIT: optionalIntInRange(1, 20, 8),
  DB_SSL_MODE: z.preprocess(
    emptyToUndefined,
    z.enum(["disabled", "preferred", "required"]).default("disabled"),
  ),

  PROOF_STORAGE_DRIVER: z.preprocess(
    emptyToUndefined,
    z
      .enum([
        "local-fs",
        "object-storage",
        "hostinger-private-fs",
        "mariadb-blob",
        "disposable-test",
        "disabled",
      ])
      .default("local-fs"),
  ),
  PROOF_STORAGE_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(".data/private-proofs"),
  ),
  PROOF_PRODUCTION_DURABLE_CONFIRMED: z.preprocess(
    emptyToUndefined,
    z.enum(["true", "false"]).optional(),
  ),
  PROOF_DB_MAX_BLOB_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int()
      .min(1024)
      .max(10 * 1024 * 1024)
      .optional(),
  ),
  PROOF_TEST_STORAGE_ALLOWLIST: z.preprocess(emptyToUndefined, z.string().max(1000).optional()),

  // B1B Owner authentication & session lifecycle configuration
  SESSION_COOKIE_NAME: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,40}$/)
      .default("sf_session"),
  ),
  SESSION_IDLE_TTL_SECONDS: optionalIntInRange(1, 2_592_000, 43_200),
  SESSION_ABSOLUTE_TTL_SECONDS: optionalIntInRange(1, 31_536_000, 604_800),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: optionalIntInRange(1, 50, 5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: optionalIntInRange(1, 86_400, 900),
  AUTH_LOCKOUT_SECONDS: optionalIntInRange(1, 86_400, 900),
  AUTH_TRUST_PROXY: z.preprocess((value) => {
    const cleaned = emptyToUndefined(value);
    if (cleaned === true || cleaned === "1" || cleaned === "true") return true;
    if (cleaned === false || cleaned === "0" || cleaned === "false" || cleaned === undefined) {
      return false;
    }
    return cleaned;
  }, z.boolean().default(false)),
  // Optional server secret (>=32 chars when supplied; opaque session tokens remain CSPRNG DB-backed)
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),

  // B1A/B1B keeps AI strictly in deterministic Demo mode; OpenRouter activates in B5.
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["demo"]).default("demo")),

  // B2B1 Dev-only Lead API Pilot gate (server-enforced; always false in NODE_ENV=production).
  DEV_LEAD_PILOT: z.preprocess((value) => {
    const cleaned = emptyToUndefined(value);
    if (cleaned === true || cleaned === "1" || cleaned === "true") return true;
    if (cleaned === false || cleaned === "0" || cleaned === "false" || cleaned === undefined) {
      return false;
    }
    return cleaned;
  }, z.boolean().default(false)),

  // B10C-QA Exact allowlist of disposable MariaDB databases permitted for POST /automations/:id/execute-test.
  AUTOMATION_TEST_DB_ALLOWLIST: z.preprocess(
    (value) => emptyToUndefined(value),
    z.string().max(500).optional(),
  ),
  AUTOMATION_TEST_RATE_LIMIT_MAX: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(1).max(500).optional(),
  ),
  AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(1).max(3600).optional(),
  ),

  // B11C-LAUNCH-HARDENING Database capacity threshold overrides & backup public recipient key
  MARIADB_QUOTA_MIB: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(10).max(1_048_576).optional(),
  ),
  MARIADB_WARNING_MIB: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(1).max(1_048_576).optional(),
  ),
  MARIADB_HARD_STOP_MIB: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(1).max(1_048_576).optional(),
  ),
  MARIADB_CAPACITY_SAFETY_MARGIN_MIB: z.preprocess(
    (value) => emptyToUndefined(value),
    z.coerce.number().int().min(0).max(1024).optional(),
  ),
  BACKUP_AGE_PUBLIC_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/)
      .optional(),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Resolved fixed-window rate limit policy for manual automation test execution. */
export function getAutomationTestRateLimitPolicy(
  env: Pick<
    ServerEnv,
    "AUTOMATION_TEST_RATE_LIMIT_MAX" | "AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS"
  >,
): { maxRequests: number; windowSeconds: number } {
  return {
    maxRequests: env.AUTOMATION_TEST_RATE_LIMIT_MAX ?? 60,
    windowSeconds: env.AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS ?? 60,
  };
}

export interface MariadbQuotaPolicy {
  quotaMiB: number;
  warningThresholdMiB: number;
  hardStopThresholdMiB: number;
  safetyMarginMiB: number;
}

/** Resolved MariaDB storage capacity enforcement policy (50% warn, 70% hard-stop, 16 MiB safety margin). */
export function getMariadbQuotaPolicyFromEnv(
  env?: Partial<
    Pick<
      ServerEnv,
      | "MARIADB_QUOTA_MIB"
      | "MARIADB_WARNING_MIB"
      | "MARIADB_HARD_STOP_MIB"
      | "MARIADB_CAPACITY_SAFETY_MARGIN_MIB"
    >
  >,
): MariadbQuotaPolicy {
  const quotaMiB = env?.MARIADB_QUOTA_MIB ?? 3072;
  const hardStopThresholdMiB = Math.min(
    quotaMiB,
    env?.MARIADB_HARD_STOP_MIB ?? Math.floor(quotaMiB * 0.7),
  );
  const warningThresholdMiB = Math.min(
    hardStopThresholdMiB,
    env?.MARIADB_WARNING_MIB ?? Math.floor(quotaMiB * 0.5),
  );
  const safetyMarginMiB = Math.min(hardStopThresholdMiB, env?.MARIADB_CAPACITY_SAFETY_MARGIN_MIB ?? 16);
  return {
    quotaMiB,
    warningThresholdMiB,
    hardStopThresholdMiB,
    safetyMarginMiB,
  };
}

/** Server-enforced pilot gate: strictly disabled in production regardless of client URL/storage. */
export function isLeadPilotAvailable(env: Pick<ServerEnv, "NODE_ENV" | "DEV_LEAD_PILOT">): boolean {
  return env.NODE_ENV !== "production" && env.DEV_LEAD_PILOT === true;
}

const LOOPBACK_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const FORBIDDEN_AUTOMATION_DB_PATTERN =
  /(^|[_-])(prod|production|staging|live|hostinger)([_-]|$)|^u\d{6,}_/i;

export type DisposableDbGuardResult =
  { ok: true; database: string; host: string } | { ok: false; code: string; message: string };

function readRuntimeNodeEnv(
  raw: Record<string, string | undefined> = process.env,
): string | undefined {
  const envKey = ["NODE", "ENV"].join("_");
  return raw[envKey];
}

/**
 * Verifies that automation test execution can run only in non-production runtime,
 * against a loopback MariaDB host, on an explicitly allowlisted disposable database.
 */
export function verifyDisposableAutomationTestDatabaseConfig(
  env: ServerEnv,
  liveDatabaseName?: string | null,
): DisposableDbGuardResult {
  if (readRuntimeNodeEnv() === "production" || env.NODE_ENV === "production") {
    return {
      ok: false,
      code: "automation_test_disabled_in_production",
      message: "Automation test execution is strictly disabled in production mode.",
    };
  }
  if (!isLeadPilotAvailable(env)) {
    return {
      ok: false,
      code: "pilot_disabled",
      message: "Automation test execution requires DEV_LEAD_PILOT to be explicitly enabled.",
    };
  }

  const dbCfg = getDatabaseConnectionConfig(env);
  if (!dbCfg.configured) {
    return {
      ok: false,
      code: "database_unconfigured",
      message: "Database connection is not configured for automation test execution.",
    };
  }

  let rawHost = dbCfg.host ?? "";
  let rawDatabase = dbCfg.database ?? "";
  if (dbCfg.source === "url" && dbCfg.url) {
    try {
      const parsed = new URL(dbCfg.url);
      rawHost = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
      rawDatabase = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    } catch {
      return {
        ok: false,
        code: "database_unconfigured",
        message: "Database URL could not be parsed safely.",
      };
    }
  }

  const host = rawHost.trim().toLowerCase();
  if (!LOOPBACK_DB_HOSTS.has(host)) {
    return {
      ok: false,
      code: "non_local_database_blocked",
      message: "Automation test execution is permitted only against a local loopback database.",
    };
  }

  const rawAllowlist = (env.AUTOMATION_TEST_DB_ALLOWLIST ?? "").trim();
  if (!rawAllowlist) {
    return {
      ok: false,
      code: "disposable_db_allowlist_required",
      message:
        "AUTOMATION_TEST_DB_ALLOWLIST must list at least one explicit disposable test database name.",
    };
  }

  const entries = rawAllowlist
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (entries.length === 0 || entries.some((item) => /[*?%\s/\\]/.test(item))) {
    return {
      ok: false,
      code: "invalid_disposable_db_allowlist",
      message: "AUTOMATION_TEST_DB_ALLOWLIST must contain exact database names without wildcards.",
    };
  }

  const configuredDb = rawDatabase.trim();
  const liveDb = typeof liveDatabaseName === "string" ? liveDatabaseName.trim() : "";
  if (!configuredDb || (liveDatabaseName !== undefined && !liveDb)) {
    return {
      ok: false,
      code: "database_name_unknown",
      message: "Connected database name could not be verified.",
    };
  }
  if (liveDatabaseName !== undefined && configuredDb !== liveDb) {
    return {
      ok: false,
      code: "database_name_mismatch",
      message: "Configured database name does not match the active database connection.",
    };
  }

  const targetDb = liveDatabaseName !== undefined ? liveDb : configuredDb;
  if (FORBIDDEN_AUTOMATION_DB_PATTERN.test(targetDb)) {
    return {
      ok: false,
      code: "protected_database_blocked",
      message:
        "Automation test execution is permanently blocked on production, staging, or hosted databases.",
    };
  }

  if (!entries.includes(targetDb)) {
    return {
      ok: false,
      code: "database_not_allowlisted",
      message: "Connected database is not in AUTOMATION_TEST_DB_ALLOWLIST.",
    };
  }

  return { ok: true, database: targetDb, host };
}

export interface DatabaseConnectionConfig {
  configured: boolean;
  source: "url" | "fields" | "none";
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  poolLimit: number;
  sslMode: ServerEnv["DB_SSL_MODE"];
  usesLocalhostHostname: boolean;
  partialFieldsPresent: boolean;
}

export interface SafeRuntimeEnvSummary {
  nodeEnv: ServerEnv["NODE_ENV"];
  businessTimezone: string;
  dbConfigured: boolean;
  dbConfigSource: DatabaseConnectionConfig["source"];
  dbHostLoopbackSafe: boolean;
  dbPoolLimit: number;
  dbSslMode: ServerEnv["DB_SSL_MODE"];
  proofStorageDriver: ServerEnv["PROOF_STORAGE_DRIVER"];
  proofProductionDurableConfirmed: boolean;
  proofStorageFailClosed: boolean;
  sessionIdleTtlSeconds: number;
  sessionAbsoluteTtlSeconds: number;
  aiProvider: ServerEnv["AI_PROVIDER"];
  leadPilotAvailable: boolean;
}

function readEnvSnapshot(
  raw: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    NODE_ENV: raw["NODE_ENV"],
    PORT: raw["PORT"] ?? raw["NITRO_PORT"],
    HOST: raw["HOST"] ?? raw["NITRO_HOST"],
    APP_ORIGIN: raw["APP_ORIGIN"],
    BUSINESS_TIMEZONE: raw["BUSINESS_TIMEZONE"],
    DATABASE_URL: raw["DATABASE_URL"],
    DB_HOST: raw["DB_HOST"],
    DB_PORT: raw["DB_PORT"],
    DB_NAME: raw["DB_NAME"],
    DB_USER: raw["DB_USER"],
    DB_PASSWORD: raw["DB_PASSWORD"],
    DB_POOL_LIMIT: raw["DB_POOL_LIMIT"],
    DB_SSL_MODE: raw["DB_SSL_MODE"],
    PROOF_STORAGE_DRIVER: raw["PROOF_STORAGE_DRIVER"],
    PROOF_STORAGE_DIR: raw["PROOF_STORAGE_DIR"],
    PROOF_PRODUCTION_DURABLE_CONFIRMED: raw["PROOF_PRODUCTION_DURABLE_CONFIRMED"],
    PROOF_DB_MAX_BLOB_BYTES: raw["PROOF_DB_MAX_BLOB_BYTES"],
    PROOF_TEST_STORAGE_ALLOWLIST: raw["PROOF_TEST_STORAGE_ALLOWLIST"],
    SESSION_COOKIE_NAME: raw["SESSION_COOKIE_NAME"],
    SESSION_IDLE_TTL_SECONDS: raw["SESSION_IDLE_TTL_SECONDS"],
    SESSION_ABSOLUTE_TTL_SECONDS: raw["SESSION_ABSOLUTE_TTL_SECONDS"],
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: raw["AUTH_RATE_LIMIT_MAX_ATTEMPTS"],
    AUTH_RATE_LIMIT_WINDOW_SECONDS: raw["AUTH_RATE_LIMIT_WINDOW_SECONDS"],
    AUTH_LOCKOUT_SECONDS: raw["AUTH_LOCKOUT_SECONDS"],
    AUTH_TRUST_PROXY: raw["AUTH_TRUST_PROXY"],
    AUTH_SECRET: raw["AUTH_SECRET"],
    AI_PROVIDER: raw["AI_PROVIDER"],
    DEV_LEAD_PILOT: raw["DEV_LEAD_PILOT"],
    AUTOMATION_TEST_DB_ALLOWLIST: raw["AUTOMATION_TEST_DB_ALLOWLIST"],
    AUTOMATION_TEST_RATE_LIMIT_MAX: raw["AUTOMATION_TEST_RATE_LIMIT_MAX"],
    AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS: raw["AUTOMATION_TEST_RATE_LIMIT_WINDOW_SECONDS"],
    MARIADB_QUOTA_MIB: raw["MARIADB_QUOTA_MIB"],
    MARIADB_WARNING_MIB: raw["MARIADB_WARNING_MIB"],
    MARIADB_HARD_STOP_MIB: raw["MARIADB_HARD_STOP_MIB"],
    MARIADB_CAPACITY_SAFETY_MARGIN_MIB: raw["MARIADB_CAPACITY_SAFETY_MARGIN_MIB"],
    BACKUP_AGE_PUBLIC_KEY: raw["BACKUP_AGE_PUBLIC_KEY"],
  };
}

/** Validates backend environment variables without leaking raw secret values in errors. */
export function parseServerEnv(raw: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(readEnvSnapshot(raw));
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "env"))];
    throw new Error(`Invalid server environment configuration for keys: ${keys.join(", ")}`);
  }
  return parsed.data;
}

export function loadServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

function extractHostnameFromMysqlUrl(urlString: string): string | null {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getDatabaseConnectionConfig(env: ServerEnv): DatabaseConnectionConfig {
  if (env.DATABASE_URL) {
    const hostname = extractHostnameFromMysqlUrl(env.DATABASE_URL);
    return {
      configured: true,
      source: "url",
      url: env.DATABASE_URL,
      poolLimit: env.DB_POOL_LIMIT,
      sslMode: env.DB_SSL_MODE,
      usesLocalhostHostname: hostname === "localhost",
      partialFieldsPresent: false,
    };
  }

  const dbName = env.DB_NAME;
  const dbUser = env.DB_USER;
  const hasHost = env.DB_HOST !== undefined;
  const hasPassword = env.DB_PASSWORD !== undefined && env.DB_PASSWORD !== "";
  const anyField = dbName !== undefined || dbUser !== undefined || hasHost || hasPassword;

  if (dbName !== undefined && dbUser !== undefined) {
    const host = env.DB_HOST ?? "127.0.0.1";
    return {
      configured: true,
      source: "fields",
      host,
      port: env.DB_PORT,
      database: dbName,
      user: dbUser,
      ...(env.DB_PASSWORD !== undefined ? { password: env.DB_PASSWORD } : {}),
      poolLimit: env.DB_POOL_LIMIT,
      sslMode: env.DB_SSL_MODE,
      usesLocalhostHostname: host.trim().toLowerCase() === "localhost",
      partialFieldsPresent: false,
    };
  }

  return {
    configured: false,
    source: "none",
    poolLimit: env.DB_POOL_LIMIT,
    sslMode: env.DB_SSL_MODE,
    usesLocalhostHostname: env.DB_HOST?.trim().toLowerCase() === "localhost",
    partialFieldsPresent: anyField,
  };
}

/** Safe, secret-free summary suitable for diagnostics and `/api/v1/health`. */
export function summarizeSafeRuntimeEnv(env: ServerEnv): SafeRuntimeEnvSummary {
  const db = getDatabaseConnectionConfig(env);
  const storageAssessment = assessProofStorageEnv(env);
  return {
    nodeEnv: env.NODE_ENV,
    businessTimezone: env.BUSINESS_TIMEZONE,
    dbConfigured: db.configured,
    dbConfigSource: db.source,
    dbHostLoopbackSafe: !db.usesLocalhostHostname,
    dbPoolLimit: db.poolLimit,
    dbSslMode: db.sslMode,
    proofStorageDriver: env.PROOF_STORAGE_DRIVER,
    proofProductionDurableConfirmed: env.PROOF_PRODUCTION_DURABLE_CONFIRMED === "true",
    proofStorageFailClosed: storageAssessment.failClosed,
    sessionIdleTtlSeconds: env.SESSION_IDLE_TTL_SECONDS,
    sessionAbsoluteTtlSeconds: env.SESSION_ABSOLUTE_TTL_SECONDS,
    aiProvider: env.AI_PROVIDER,
    leadPilotAvailable: isLeadPilotAvailable(env),
  };
}

export interface ProofStorageEnvAssessment {
  driver: ServerEnv["PROOF_STORAGE_DRIVER"];
  configured: boolean;
  writable: boolean;
  productionReady: boolean;
  failClosed: boolean;
  unsafePublicOrBuildPath: boolean;
  isDefaultEphemeralDir: boolean;
  status:
    | "dev_local_only"
    | "production_verified_private_dir"
    | "production_verified_mariadb_blob"
    | "blocked_disabled"
    | "blocked_object_storage_unconfigured"
    | "blocked_unsafe_path"
    | "blocked_ephemeral_path"
    | "blocked_durability_unverified";
  blockedCode?: "storage_not_configured" | "storage_durability_blocked";
  reasons: string[];
}

const UNSAFE_PUBLIC_OR_BUILD_DIR_REGEX =
  /public_html|public[\\/]|hbuilds|\.output|\.next|[\\/]dist(?:[\\/]|$)/i;
const DEFAULT_EPHEMERAL_DIR_REGEX = /(?:^|[\\/])\.data(?:[\\/]|$)/i;

function isAbsolutePathCrossPlatform(dirPath: string): boolean {
  const trimmed = dirPath.trim();
  return /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(trimmed);
}

/**
 * Assesses whether the configured payment-proof storage settings are safe and permitted
 * in the active NODE_ENV. Production mode is strictly fail-closed until a verified durable
 * private directory (or approved durable driver) is explicitly configured.
 */
export function assessProofStorageEnv(env: ServerEnv): ProofStorageEnvAssessment {
  const driver = env.PROOF_STORAGE_DRIVER;
  const rawDir = env.PROOF_STORAGE_DIR.trim();
  const isDbBlobDriver = driver === "mariadb-blob";
  const unsafePublicOrBuildPath = isDbBlobDriver
    ? false
    : UNSAFE_PUBLIC_OR_BUILD_DIR_REGEX.test(rawDir);
  const isDefaultEphemeralDir = isDbBlobDriver
    ? false
    : rawDir === ".data/private-proofs" || DEFAULT_EPHEMERAL_DIR_REGEX.test(rawDir);
  const reasons: string[] = [];

  if (unsafePublicOrBuildPath) {
    reasons.push(
      "Configured proof storage path lies inside a webroot or build/deploy artifact directory (public_html/public/hbuilds/.output/dist).",
    );
  }

  if (driver === "disabled") {
    return {
      driver,
      configured: false,
      writable: false,
      productionReady: false,
      failClosed: true,
      unsafePublicOrBuildPath,
      isDefaultEphemeralDir,
      status: "blocked_disabled",
      blockedCode: "storage_not_configured",
      reasons: [
        ...reasons,
        "PROOF_STORAGE_DRIVER is disabled; payment proof operations fail closed.",
      ],
    };
  }

  if (driver === "object-storage") {
    return {
      driver,
      configured: false,
      writable: false,
      productionReady: false,
      failClosed: true,
      unsafePublicOrBuildPath,
      isDefaultEphemeralDir,
      status: "blocked_object_storage_unconfigured",
      blockedCode: "storage_not_configured",
      reasons: [
        ...reasons,
        "Object storage driver is not configured or approved for Hostinger Business hosting. Production and uploads fail closed with zero local fallback.",
      ],
    };
  }

  if (unsafePublicOrBuildPath) {
    return {
      driver,
      configured: false,
      writable: false,
      productionReady: false,
      failClosed: true,
      unsafePublicOrBuildPath: true,
      isDefaultEphemeralDir,
      status: "blocked_unsafe_path",
      blockedCode: "storage_not_configured",
      reasons,
    };
  }

  if (env.NODE_ENV === "production") {
    if (driver === "disposable-test") {
      return {
        driver,
        configured: false,
        writable: false,
        productionReady: false,
        failClosed: true,
        unsafePublicOrBuildPath: false,
        isDefaultEphemeralDir,
        status: "blocked_disabled",
        blockedCode: "storage_not_configured",
        reasons: ["disposable-test storage driver is forbidden in production."],
      };
    }

    if (isDbBlobDriver) {
      const dbConfig = getDatabaseConnectionConfig(env);
      if (!dbConfig.configured) {
        return {
          driver,
          configured: false,
          writable: false,
          productionReady: false,
          failClosed: true,
          unsafePublicOrBuildPath: false,
          isDefaultEphemeralDir: false,
          status: "blocked_durability_unverified",
          blockedCode: "storage_not_configured",
          reasons: [
            "MariaDB proof storage requires database connection configuration (DATABASE_URL or DB_NAME/DB_USER).",
          ],
        };
      }

      if (env.PROOF_PRODUCTION_DURABLE_CONFIRMED !== "true") {
        return {
          driver,
          configured: false,
          writable: false,
          productionReady: false,
          failClosed: true,
          unsafePublicOrBuildPath: false,
          isDefaultEphemeralDir: false,
          status: "blocked_durability_unverified",
          blockedCode: "storage_durability_blocked",
          reasons: [
            "MariaDB BLOB proof storage in production requires live staging & Hostinger backup/restore verification (PROOF_PRODUCTION_DURABLE_CONFIRMED is not 'true'). Production uploads fail closed.",
          ],
        };
      }

      return {
        driver,
        configured: true,
        writable: true,
        productionReady: true,
        failClosed: false,
        unsafePublicOrBuildPath: false,
        isDefaultEphemeralDir: false,
        status: "production_verified_mariadb_blob",
        reasons: ["Explicitly confirmed chunked MariaDB LONGBLOB private proof storage active."],
      };
    }

    if (isDefaultEphemeralDir || !isAbsolutePathCrossPlatform(rawDir)) {
      return {
        driver,
        configured: false,
        writable: false,
        productionReady: false,
        failClosed: true,
        unsafePublicOrBuildPath: false,
        isDefaultEphemeralDir: true,
        status: "blocked_ephemeral_path",
        blockedCode: "storage_not_configured",
        reasons: [
          "Production proof storage cannot use the relative ephemeral '.data/private-proofs' directory.",
        ],
      };
    }

    if (env.PROOF_PRODUCTION_DURABLE_CONFIRMED !== "true") {
      return {
        driver,
        configured: false,
        writable: false,
        productionReady: false,
        failClosed: true,
        unsafePublicOrBuildPath: false,
        isDefaultEphemeralDir: false,
        status: "blocked_durability_unverified",
        blockedCode: "storage_durability_blocked",
        reasons: [
          "Production private proof storage durability is unverified on Hostinger Business shared hosting (PROOF_PRODUCTION_DURABLE_CONFIRMED is not 'true'). Production uploads fail closed.",
        ],
      };
    }

    return {
      driver,
      configured: true,
      writable: true,
      productionReady: true,
      failClosed: false,
      unsafePublicOrBuildPath: false,
      isDefaultEphemeralDir: false,
      status: "production_verified_private_dir",
      reasons: ["Explicitly confirmed persistent private filesystem storage active."],
    };
  }

  return {
    driver,
    configured: true,
    writable: true,
    productionReady: false,
    failClosed: false,
    unsafePublicOrBuildPath: false,
    isDefaultEphemeralDir,
    status: "dev_local_only",
    reasons: [
      isDbBlobDriver
        ? "Development/test MariaDB BLOB proof storage active; Hostinger live staging & backup/restore verification still required before production."
        : isDefaultEphemeralDir
          ? "Development/test local proof storage active; ephemeral .data fallback is forbidden in production."
          : "Development/test local proof storage active; Hostinger production durability remains unverified.",
    ],
  };
}

export type DisposableProofStorageValidationResult =
  | { ok: true; normalizedDir: string }
  | {
      ok: false;
      code:
        | "storage_dir_missing"
        | "ephemeral_default_dir_forbidden"
        | "unsafe_web_or_build_dir"
        | "storage_dir_not_allowlisted";
      message: string;
    };

/**
 * Guards disposable test storage harnesses so isolated integration tests never point at
 * production directories, `.data/private-proofs`, webroots, or unallowlisted paths.
 */
export function verifyDisposableProofTestStorageConfig(
  targetDir: string,
  rawEnv: Record<string, string | undefined> = process.env,
): DisposableProofStorageValidationResult {
  const trimmed = targetDir.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "storage_dir_missing",
      message: "Disposable test proof storage directory must be explicitly provided.",
    };
  }

  if (UNSAFE_PUBLIC_OR_BUILD_DIR_REGEX.test(trimmed)) {
    return {
      ok: false,
      code: "unsafe_web_or_build_dir",
      message: "Disposable test storage directory cannot reside inside public/build directories.",
    };
  }

  if (trimmed === ".data/private-proofs" || DEFAULT_EPHEMERAL_DIR_REGEX.test(trimmed)) {
    return {
      ok: false,
      code: "ephemeral_default_dir_forbidden",
      message: "Disposable test storage directory cannot use '.data' paths.",
    };
  }

  const normalizedTarget = trimmed
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  const rawAllowlist = (rawEnv["PROOF_TEST_STORAGE_ALLOWLIST"] ?? "").trim();
  if (rawAllowlist) {
    const allowedPrefixes = rawAllowlist
      .split(",")
      .map((s) =>
        s
          .trim()
          .replace(/[\\/]+/g, "/")
          .replace(/\/+$/, "")
          .toLowerCase(),
      )
      .filter((s) => s.length > 0);
    const matches = allowedPrefixes.some(
      (prefix) => normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`),
    );
    if (!matches) {
      return {
        ok: false,
        code: "storage_dir_not_allowlisted",
        message: "Disposable test storage directory does not match PROOF_TEST_STORAGE_ALLOWLIST.",
      };
    }
  }

  return { ok: true, normalizedDir: trimmed };
}
