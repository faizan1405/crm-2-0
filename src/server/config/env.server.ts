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
    z.enum(["local-fs", "object-storage"]).default("local-fs"),
  ),
  PROOF_STORAGE_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(".data/private-proofs"),
  ),

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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Server-enforced pilot gate: strictly disabled in production regardless of client URL/storage. */
export function isLeadPilotAvailable(env: Pick<ServerEnv, "NODE_ENV" | "DEV_LEAD_PILOT">): boolean {
  return env.NODE_ENV !== "production" && env.DEV_LEAD_PILOT === true;
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
  return {
    nodeEnv: env.NODE_ENV,
    businessTimezone: env.BUSINESS_TIMEZONE,
    dbConfigured: db.configured,
    dbConfigSource: db.source,
    dbHostLoopbackSafe: !db.usesLocalhostHostname,
    dbPoolLimit: db.poolLimit,
    dbSslMode: db.sslMode,
    proofStorageDriver: env.PROOF_STORAGE_DRIVER,
    sessionIdleTtlSeconds: env.SESSION_IDLE_TTL_SECONDS,
    sessionAbsoluteTtlSeconds: env.SESSION_ABSOLUTE_TTL_SECONDS,
    aiProvider: env.AI_PROVIDER,
    leadPilotAvailable: isLeadPilotAvailable(env),
  };
}
