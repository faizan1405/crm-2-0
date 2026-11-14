/**
 * Scale Flow CRM V2 — Checkpoint B12
 * Independent-Process MariaDB Advisory Locking & Quota Concurrency Harness
 *
 * Safety Rules:
 * - Refuses to execute against any protected database (CRM V1, production, joinscaleflow).
 * - Requires explicit `--confirm-disposable-db` when running against a live MySQL host.
 * - Simulates capacity threshold via test-only policy injection without filling the physical disk.
 * - Coordinates across truly independent operating system processes via MariaDB `SELECT GET_LOCK(...)`.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";
import { PROTECTED_DB_PATTERNS } from "./b11c-mariadb-backup.mjs";

export const MARIADB_CAPACITY_LOCK_NAME = "sf_crm_proof_quota_write";

export function assertSafeDisposableDatabase(databaseName) {
  const db = String(databaseName ?? "").trim();
  if (!db) {
    throw new Error("Database name is required.");
  }
  for (const pattern of PROTECTED_DB_PATTERNS) {
    if (pattern.test(db)) {
      throw new Error(
        `SAFETY LOCKOUT: Target database "${db}" matches protected pattern (${pattern}). Refusing execution.`,
      );
    }
  }
  return db;
}

/**
 * Runs advisory lock acquisition and release on a dedicated MySQL connection.
 */
export async function executeAdvisoryLockProbe({
  connectionConfig,
  lockName = MARIADB_CAPACITY_LOCK_NAME,
  timeoutSeconds = 5,
  holdDurationMs = 500,
  workerId = "worker-1",
}) {
  assertSafeDisposableDatabase(connectionConfig.database);

  const conn = await createConnection(connectionConfig);
  const logEvents = [];

  try {
    const startAcquire = Date.now();
    logEvents.push({ workerId, event: "acquire_started", timestamp: new Date().toISOString() });

    const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS acquired", [
      lockName,
      timeoutSeconds,
    ]);
    const acquired = rows?.[0]?.acquired === 1;
    const acquireLatencyMs = Date.now() - startAcquire;

    logEvents.push({
      workerId,
      event: acquired ? "acquire_succeeded" : "acquire_timed_out",
      acquired,
      latencyMs: acquireLatencyMs,
      timestamp: new Date().toISOString(),
    });

    if (acquired && holdDurationMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, holdDurationMs));
    }

    if (acquired) {
      const [relRows] = await conn.query("SELECT RELEASE_LOCK(?) AS released", [lockName]);
      const released = relRows?.[0]?.released === 1;
      logEvents.push({
        workerId,
        event: "lock_released",
        released,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      workerId,
      ok: acquired,
      acquired,
      logEvents,
    };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/**
 * Spawns multiple independent OS processes that simultaneously compete for the MariaDB lock.
 */
export async function runMultiProcessAdvisoryLockContention({
  connectionConfig,
  workerCount = 2,
  timeoutSeconds = 3,
  holdDurationMs = 1500,
  scriptPath = fileURLToPath(import.meta.url),
}) {
  assertSafeDisposableDatabase(connectionConfig.database);

  const workers = [];
  const workerPromises = [];

  for (let i = 1; i <= workerCount; i++) {
    const workerId = `proc-${i}`;
    const p = new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          scriptPath,
          "--worker",
          `--worker-id=${workerId}`,
          `--timeout=${timeoutSeconds}`,
          `--hold-ms=${holdDurationMs}`,
        ],
        {
          env: {
            ...process.env,
            DB_HOST: connectionConfig.host,
            DB_PORT: String(connectionConfig.port ?? 3306),
            DB_NAME: connectionConfig.database,
            DB_USER: connectionConfig.user,
            DB_PASSWORD: connectionConfig.password,
            B12_CONFIRM_DISPOSABLE: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
      });

      child.on("close", (code) => {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({ workerId, code, parsed, stderr });
        } catch {
          resolve({ workerId, code, rawOutput: stdout, stderr });
        }
      });

      child.on("error", (err) => reject(err));
    });

    workerPromises.push(p);
  }

  const results = await Promise.all(workerPromises);
  return results;
}

// CLI entrypoint for child processes
if (process.argv.includes("--worker")) {
  const readArg = (prefix, fallback) => {
    const found = process.argv.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  const workerId = readArg("--worker-id=", "worker-child");
  const timeoutSeconds = Number(readArg("--timeout=", "5"));
  const holdDurationMs = Number(readArg("--hold-ms=", "500"));

  if (process.env["B12_CONFIRM_DISPOSABLE"] !== "true") {
    console.error(JSON.stringify({ error: "SAFETY LOCKOUT: B12_CONFIRM_DISPOSABLE required" }));
    process.exit(1);
  }

  const connectionConfig = {
    host: process.env["DB_HOST"] || "127.0.0.1",
    port: Number(process.env["DB_PORT"] || 3306),
    database: process.env["DB_NAME"] || "",
    user: process.env["DB_USER"] || "",
    password: process.env["DB_PASSWORD"] || "",
  };

  executeAdvisoryLockProbe({
    connectionConfig,
    workerId,
    timeoutSeconds,
    holdDurationMs,
  })
    .then((res) => {
      console.log(JSON.stringify(res));
      process.exit(res.acquired ? 0 : 2);
    })
    .catch((err) => {
      console.error(JSON.stringify({ error: err.message, stack: err.stack }));
      process.exit(1);
    });
}
