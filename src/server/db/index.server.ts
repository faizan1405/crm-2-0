import "@tanstack/react-start/server-only";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import {
  getDatabaseConnectionConfig,
  loadServerEnv,
  type DatabaseConnectionConfig,
} from "../config/env.server";
import { b1aFoundationSchema } from "./schema.server";

export type CrmDatabase = MySql2Database<typeof b1aFoundationSchema>;

export interface DatabaseStatusReport {
  configured: boolean;
  driver: "mysql2";
  source: DatabaseConnectionConfig["source"];
  poolLimit: number;
  ipv4LoopbackSafe: boolean;
  partialConfigDetected: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
}

let cachedPool: Pool | null = null;
let cachedDb: CrmDatabase | null = null;
let cachedConfigKey: string | null = null;

function configFingerprint(cfg: DatabaseConnectionConfig): string {
  return JSON.stringify({
    source: cfg.source,
    url: cfg.url ?? "",
    host: cfg.host ?? "",
    port: cfg.port ?? 3306,
    database: cfg.database ?? "",
    user: cfg.user ?? "",
    poolLimit: cfg.poolLimit,
    sslMode: cfg.sslMode,
  });
}

export function buildMysqlPoolOptions(cfg: DatabaseConnectionConfig): PoolOptions {
  if (!cfg.configured) {
    throw new Error("Database connection is not configured");
  }

  const base: PoolOptions = {
    waitForConnections: true,
    connectionLimit: cfg.poolLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 5_000,
    timezone: "Z",
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: false,
    ...(cfg.sslMode === "required" ? { ssl: { rejectUnauthorized: true } } : {}),
  };

  if (cfg.source === "url" && cfg.url) {
    return {
      ...base,
      uri: cfg.url,
    };
  }

  return {
    ...base,
    ...(cfg.host ? { host: cfg.host } : {}),
    ...(cfg.port ? { port: cfg.port } : {}),
    ...(cfg.database ? { database: cfg.database } : {}),
    ...(cfg.user ? { user: cfg.user } : {}),
    ...(cfg.password !== undefined ? { password: cfg.password } : {}),
  };
}

/** Returns lazy Drizzle+mysql2 instance when DB env is configured; null otherwise. */
export function getDatabase(): CrmDatabase | null {
  const env = loadServerEnv();
  const cfg = getDatabaseConnectionConfig(env);
  if (!cfg.configured) return null;

  const key = configFingerprint(cfg);
  if (cachedDb && cachedConfigKey === key) return cachedDb;

  if (cachedPool) {
    void cachedPool.end().catch(() => undefined);
    cachedPool = null;
    cachedDb = null;
  }

  const pool = mysql.createPool(buildMysqlPoolOptions(cfg));
  cachedPool = pool;
  cachedDb = drizzle(pool, { schema: b1aFoundationSchema, mode: "default" });
  cachedConfigKey = key;
  return cachedDb;
}

/** Closes any active pool cleanly (useful for tests or graceful process shutdown). */
export async function closeDatabasePool(): Promise<void> {
  if (!cachedPool) return;
  const pool = cachedPool;
  cachedPool = null;
  cachedDb = null;
  cachedConfigKey = null;
  await pool.end();
}

/**
 * Returns secret-free database readiness metadata.
 * When `probeConnection` is true and DB is configured, runs `SELECT 1`.
 */
export async function getDatabaseStatus(probeConnection = false): Promise<DatabaseStatusReport> {
  const env = loadServerEnv();
  const cfg = getDatabaseConnectionConfig(env);

  if (!cfg.configured || !probeConnection) {
    return {
      configured: cfg.configured,
      driver: "mysql2",
      source: cfg.source,
      poolLimit: cfg.poolLimit,
      ipv4LoopbackSafe: !cfg.usesLocalhostHostname,
      partialConfigDetected: cfg.partialFieldsPresent,
      reachable: null,
      latencyMs: null,
    };
  }

  const startedAt = Date.now();
  try {
    getDatabase();
    if (!cachedPool) {
      return {
        configured: true,
        driver: "mysql2",
        source: cfg.source,
        poolLimit: cfg.poolLimit,
        ipv4LoopbackSafe: !cfg.usesLocalhostHostname,
        partialConfigDetected: false,
        reachable: false,
        latencyMs: Date.now() - startedAt,
      };
    }
    await cachedPool.query("SELECT 1");
    return {
      configured: true,
      driver: "mysql2",
      source: cfg.source,
      poolLimit: cfg.poolLimit,
      ipv4LoopbackSafe: !cfg.usesLocalhostHostname,
      partialConfigDetected: false,
      reachable: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      configured: true,
      driver: "mysql2",
      source: cfg.source,
      poolLimit: cfg.poolLimit,
      ipv4LoopbackSafe: !cfg.usesLocalhostHostname,
      partialConfigDetected: false,
      reachable: false,
      latencyMs: Date.now() - startedAt,
    };
  }
}
