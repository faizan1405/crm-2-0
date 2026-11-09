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

  // B1A keeps AI strictly in deterministic Demo mode; OpenRouter activates in B5.
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["demo"]).default("demo")),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
  aiProvider: ServerEnv["AI_PROVIDER"];
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
    AI_PROVIDER: raw["AI_PROVIDER"],
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
    aiProvider: env.AI_PROVIDER,
  };
}
