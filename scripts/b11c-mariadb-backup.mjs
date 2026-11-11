/**
 * Scale Flow CRM V2 — Checkpoint B11C-BUSINESS-QA
 * Binary-Safe MariaDB Logical Backup, Clean-Target Restore & Capacity Utility
 *
 * Security & Isolation Rules:
 * - Reads database credentials ONLY from environment variables (never hardcoded or CLI args).
 * - Never prints passwords, tokens, or connection URLs in logs, manifests, or SQL dumps.
 * - Restore mode FAILS CLOSED unless `--confirm-clean-target` is passed AND the target
 *   database is confirmed completely empty (`SHOW TABLES` === 0) AND not CRM V1 / source DB.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";

export const PROTECTED_DB_PATTERNS = [
  /^crm_?v?1$/i,
  /prod(uction)?/i,
  /^u256504187_crm$/i,
  /joinscaleflow/i,
];

export const DEFAULT_MAX_INSERT_BYTES = 1_572_864; // 1.5 MiB statements -> safely << 16 MB max_allowed_packet

export const STORAGE_QUOTA_POLICY_DEFAULTS = {
  quotaMiB: 3072, // 3 GB Hostinger Business MariaDB quota
  warningMiB: 1536, // 50% capacity alert
  hardStopMiB: 2150, // 70% hard stop for new BLOB uploads (~922 MiB CRM/index/log headroom)
  measuredBaseSchemaMiB: 4.22,
  measuredBlobOverheadRatio: 1.0367, // 15.52 MiB InnoDB / 14.97 MiB raw payload
};

/**
 * Escapes backslashes, single quotes, NUL, newlines, CR, and Ctrl-Z for single-quoted MariaDB strings.
 * Matches MySQL `--hex-blob` / standard C-style backslash escaping with NO_BACKSLASH_ESCAPES off.
 */
export function escapeMysqlString(value) {
  let out = "'";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch === "\0") out += "\\0";
    else if (ch === "'") out += "\\'";
    else if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\x1a") out += "\\Z";
    else out += ch;
  }
  out += "'";
  return out;
}

/**
 * Escapes backtick-quoted SQL identifiers safely.
 */
export function escapeMysqlIdentifier(identifier) {
  return "`" + String(identifier).replace(/`/g, "``") + "`";
}

/**
 * Binary-safe SQL value serializer (`--hex-blob` equivalent).
 * - Buffers / Uint8Arrays -> `X''` (empty) or `0x<hex>`
 * - NULL / undefined -> `NULL`
 * - Booleans -> `1` / `0`
 * - Numbers / BigInts -> exact numeric literal
 * - Dates -> `'YYYY-MM-DD HH:MM:SS'` UTC
 * - Strings -> escaped UTF-8 SQL string literal
 * - Objects (JSON) -> JSON stringified and escaped
 */
export function encodeSqlValue(val) {
  if (val === null || val === undefined) {
    return "NULL";
  }
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    const buf = Buffer.isBuffer(val) ? val : Buffer.from(val);
    if (buf.byteLength === 0) {
      return "X''";
    }
    return "0x" + buf.toString("hex");
  }
  if (typeof val === "boolean") {
    return val ? "1" : "0";
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "NULL";
    return String(val);
  }
  if (typeof val === "bigint") {
    return val.toString();
  }
  if (val instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = val.getUTCFullYear();
    const mm = pad(val.getUTCMonth() + 1);
    const dd = pad(val.getUTCDate());
    const hh = pad(val.getUTCHours());
    const mi = pad(val.getUTCMinutes());
    const ss = pad(val.getUTCSeconds());
    return `'${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}'`;
  }
  if (typeof val === "string") {
    return escapeMysqlString(val);
  }
  if (typeof val === "object") {
    return escapeMysqlString(JSON.stringify(val));
  }
  return escapeMysqlString(String(val));
}

/**
 * Deterministic SQL statement splitter respecting single-quoted strings (`\'` and `''`),
 * double-quoted strings, backtick identifiers, `--` / `#` line comments, and `/* ... * /`
 * block comments (preserving MySQL conditional comments `/*!40101 ... * /` inside statements).
 */
export function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let blockCommentIsConditional = false;

  const len = sqlText.length;
  for (let i = 0; i < len; i++) {
    const ch = sqlText[i];
    const next = i + 1 < len ? sqlText[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += "\n";
      }
      continue;
    }

    if (inBlockComment) {
      if (blockCommentIsConditional) {
        current += ch;
      }
      if (ch === "*" && next === "/") {
        if (blockCommentIsConditional) {
          current += "/";
        }
        inBlockComment = false;
        blockCommentIsConditional = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < len) {
          current += next;
          i++;
        }
      } else if (ch === "'") {
        if (next === "'") {
          current += "'";
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < len) {
          current += next;
          i++;
        }
      } else if (ch === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === "`") {
        if (next === "`") {
          current += "`";
          i++;
        } else {
          inBacktick = false;
        }
      }
      continue;
    }

    // Comments outside quotes/identifiers
    if (ch === "#" || (ch === "-" && next === "-" && (i + 2 >= len || /\s/.test(sqlText[i + 2])))) {
      inLineComment = true;
      continue;
    }

    if (ch === "/" && next === "*") {
      const third = i + 2 < len ? sqlText[i + 2] : "";
      if (third === "!") {
        inBlockComment = true;
        blockCommentIsConditional = true;
        current += "/*";
        i++;
      } else {
        inBlockComment = true;
        blockCommentIsConditional = false;
        i++;
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }

    if (ch === "`") {
      inBacktick = true;
      current += ch;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

/**
 * Enforces fail-closed clean-target guard before executing ANY restore SQL.
 */
export function assertSafeRestoreTarget(params) {
  const { targetDbName, sourceDbName, existingTables, confirmCleanTarget } = params;

  if (confirmCleanTarget !== true) {
    throw new Error(
      "Restore blocked: explicit confirmCleanTarget=true (--confirm-clean-target) is required.",
    );
  }

  if (!targetDbName || typeof targetDbName !== "string" || !targetDbName.trim()) {
    throw new Error("Restore blocked: target database name is empty.");
  }

  const cleanTarget = targetDbName.trim();
  if (sourceDbName && cleanTarget === sourceDbName.trim()) {
    throw new Error(
      `Restore blocked: target database "${cleanTarget}" matches source database "${sourceDbName}". Use a NEW empty database.`,
    );
  }

  for (const pat of PROTECTED_DB_PATTERNS) {
    if (pat.test(cleanTarget)) {
      throw new Error(
        `Restore blocked: target database "${cleanTarget}" matches a protected production/CRM-V1 pattern.`,
      );
    }
  }

  if (!Array.isArray(existingTables)) {
    throw new Error("Restore blocked: existingTables must be inspected before restore.");
  }

  if (existingTables.length > 0) {
    throw new Error(
      `Restore blocked: target database "${cleanTarget}" is NOT empty (${existingTables.length} existing tables detected). Only an empty disposable target is permitted.`,
    );
  }

  return { ok: true, targetDbName: cleanTarget };
}

/**
 * Evaluates MariaDB storage utilization against the 3 GB Hostinger Business quota and thresholds.
 */
export function evaluateMariadbStorageCapacity(params) {
  const usedMiB = Number(params.usedMiB ?? 0);
  const quotaMiB = Number(params.quotaMiB ?? STORAGE_QUOTA_POLICY_DEFAULTS.quotaMiB);
  const warningMiB = Number(params.warningMiB ?? STORAGE_QUOTA_POLICY_DEFAULTS.warningMiB);
  const hardStopMiB = Number(params.hardStopMiB ?? STORAGE_QUOTA_POLICY_DEFAULTS.hardStopMiB);
  const overheadRatio = Number(
    params.overheadRatio ?? STORAGE_QUOTA_POLICY_DEFAULTS.measuredBlobOverheadRatio,
  );

  if (!Number.isFinite(usedMiB) || usedMiB < 0) {
    throw new Error("usedMiB must be a non-negative number.");
  }

  const percentUsed = Number(((usedMiB / quotaMiB) * 100).toFixed(2));
  const remainingQuotaMiB = Number(Math.max(0, quotaMiB - usedMiB).toFixed(2));
  const remainingProofBudgetMiB = Number(Math.max(0, hardStopMiB - usedMiB).toFixed(2));

  let status = "ok";
  if (usedMiB >= quotaMiB) status = "quota_exhausted";
  else if (usedMiB >= hardStopMiB) status = "hard_stop_uploads";
  else if (usedMiB >= warningMiB) status = "warning";

  return {
    usedMiB: Number(usedMiB.toFixed(2)),
    quotaMiB,
    warningMiB,
    hardStopMiB,
    percentUsed,
    remainingQuotaMiB,
    remainingProofBudgetMiB,
    estimatedRemaining1MiBReceipts: Math.floor(remainingProofBudgetMiB / overheadRatio),
    estimatedRemaining200KiBReceipts: Math.floor(remainingProofBudgetMiB / (0.2 * overheadRatio)),
    allowNewProofUploads: usedMiB < hardStopMiB,
    status,
  };
}

/**
 * Parses MariaDB connection config safely from environment variables without exposing secrets.
 */
export function parseConnectionConfigFromEnv(envPrefix = "DB", env = process.env) {
  const specificUrl = env[`${envPrefix}_URL`];
  const fallbackUrl = envPrefix === "DB" ? env["DATABASE_URL"] : undefined;
  const rawUrl = specificUrl || fallbackUrl;

  if (rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
      throw new Error(`Unsupported database URL protocol for ${envPrefix}_URL`);
    }
    const sslMode =
      parsed.searchParams.get("sslMode") ??
      parsed.searchParams.get("sslmode") ??
      parsed.searchParams.get("ssl");
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      ssl:
        sslMode === "true" ||
        sslMode === "1" ||
        sslMode === "REQUIRED" ||
        parsed.hostname !== "127.0.0.1"
          ? { rejectUnauthorized: false }
          : undefined,
    };
  }

  const host = env[`${envPrefix}_HOST`] ?? env["DB_HOST"];
  const user = env[`${envPrefix}_USER`] ?? env["DB_USER"];
  const password = env[`${envPrefix}_PASSWORD`] ?? env["DB_PASSWORD"] ?? "";
  const database = env[`${envPrefix}_NAME`] ?? env["DB_NAME"];
  const port = Number(env[`${envPrefix}_PORT`] ?? env["DB_PORT"] ?? "3306");

  if (!host || !user || !database) {
    throw new Error(
      `Missing MariaDB connection env vars for prefix "${envPrefix}" (expected ${envPrefix}_URL or ${envPrefix}_HOST/_USER/_NAME).`,
    );
  }

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: host !== "127.0.0.1" && host !== "localhost" ? { rejectUnauthorized: false } : undefined,
  };
}

async function openSafeMysqlConnection(config) {
  const conn = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    timezone: "Z",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  await conn.query("SET SESSION TIME_ZONE = '+00:00'");
  return conn;
}

/**
 * Exports a consistent-snapshot, binary-safe MariaDB logical SQL dump + integrity manifest.
 */
export async function exportMariaDbBackup({
  connectionConfig,
  outSqlPath,
  outManifestPath,
  maxInsertBytes = DEFAULT_MAX_INSERT_BYTES,
}) {
  const conn = await openSafeMysqlConnection(connectionConfig);
  try {
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const [[versionRow]] = await conn.query(
      "SELECT VERSION() AS serverVersion, DATABASE() AS dbName",
    );
    const dbName = versionRow.dbName;

    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME ASC`,
    );
    const tables = tableRows.map((r) => String(r.tableName));

    const [views] = await conn.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
    );
    const [triggers] = await conn.query(
      `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`,
    );
    const [routines] = await conn.query(
      `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME`,
    );
    const [events] = await conn.query(
      `SELECT EVENT_NAME FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = DATABASE() ORDER BY EVENT_NAME`,
    );

    const outDir = path.dirname(outSqlPath);
    fs.mkdirSync(outDir, { recursive: true });
    const writeStream = fs.createWriteStream(outSqlPath, { encoding: "utf8" });

    const writeChunk = (text) =>
      new Promise((resolve, reject) => {
        const onError = (err) => {
          writeStream.off("drain", onDrain);
          reject(err);
        };
        const onDrain = () => {
          writeStream.off("error", onError);
          resolve();
        };
        writeStream.once("error", onError);
        if (writeStream.write(text)) {
          writeStream.off("error", onError);
          resolve();
        } else {
          writeStream.once("drain", onDrain);
        }
      });

    await writeChunk(
      [
        "-- Scale Flow CRM V2 Binary-Safe Logical Backup",
        `-- Exported UTC: ${new Date().toISOString()}`,
        `-- Server Version: ${versionRow.serverVersion}`,
        `-- Source Database: ${dbName}`,
        `-- Tables: ${tables.length}`,
        "SET NAMES utf8mb4;",
        "SET TIME_ZONE = '+00:00';",
        "SET FOREIGN_KEY_CHECKS = 0;",
        "SET UNIQUE_CHECKS = 0;",
        "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
        "",
      ].join("\n"),
    );

    const tableRowCounts = {};
    let totalRows = 0;

    for (const tableName of tables) {
      const quotedTable = escapeMysqlIdentifier(tableName);
      const [createRes] = await conn.query(`SHOW CREATE TABLE ${quotedTable}`);
      const createSql = createRes[0]["Create Table"];

      await writeChunk(`-- Table: ${tableName}\n`);
      await writeChunk(`DROP TABLE IF EXISTS ${quotedTable};\n`);
      await writeChunk(`${createSql};\n\n`);

      const [rows, fields] = await conn.query({
        sql: `SELECT * FROM ${quotedTable}`,
        rowsAsArray: true,
      });

      tableRowCounts[tableName] = rows.length;
      totalRows += rows.length;

      if (rows.length > 0) {
        const colNames = fields.map((f) => escapeMysqlIdentifier(f.name)).join(", ");
        const insertPrefix = `INSERT INTO ${quotedTable} (${colNames}) VALUES\n`;
        let batchValues = [];
        let batchBytes = Buffer.byteLength(insertPrefix, "utf8");

        const flushBatch = async () => {
          if (batchValues.length === 0) return;
          await writeChunk(insertPrefix + batchValues.join(",\n") + ";\n");
          batchValues = [];
          batchBytes = Buffer.byteLength(insertPrefix, "utf8");
        };

        for (const row of rows) {
          const encodedCells = row.map((cell) => encodeSqlValue(cell));
          const tupleStr = `  (${encodedCells.join(", ")})`;
          const tupleBytes = Buffer.byteLength(tupleStr, "utf8") + 2;

          if (batchValues.length > 0 && batchBytes + tupleBytes > maxInsertBytes) {
            await flushBatch();
          }

          batchValues.push(tupleStr);
          batchBytes += tupleBytes;

          if (batchBytes >= maxInsertBytes) {
            await flushBatch();
          }
        }
        await flushBatch();
        await writeChunk("\n");
      }
    }

    await writeChunk(["SET UNIQUE_CHECKS = 1;", "SET FOREIGN_KEY_CHECKS = 1;", ""].join("\n"));

    await new Promise((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    // Capture exact binary checksums for proof metadata & chunks inside same consistent snapshot
    const proofMetadata = tables.includes("crm_payment_proofs")
      ? (
          await conn.query(
            `SELECT id, payment_id AS paymentId, storage_key AS storageKey, file_size AS fileSize, sha256_hash AS sha256Hash, lifecycle_status AS lifecycleStatus
             FROM crm_payment_proofs
             ORDER BY id ASC`,
          )
        )[0]
      : [];

    const blobChecksums = tables.includes("crm_payment_proof_blobs")
      ? (
          await conn.query(
            `SELECT storage_key AS storageKey, chunk_index AS chunkIndex, chunk_size AS chunkSize, LOWER(SHA2(blob_data, 256)) AS chunkSha256
             FROM crm_payment_proof_blobs
             ORDER BY storage_key ASC, chunk_index ASC`,
          )
        )[0]
      : [];

    await conn.query("COMMIT");

    const dumpHash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(outSqlPath);
      rs.on("data", (d) => dumpHash.update(d));
      rs.on("end", resolve);
      rs.on("error", reject);
    });

    const sqlStats = fs.statSync(outSqlPath);
    const manifest = {
      checkpoint: "B11C-BUSINESS-QA",
      exportedAtUtc: new Date().toISOString(),
      sourceDatabase: dbName,
      serverVersion: String(versionRow.serverVersion),
      tableCount: tables.length,
      tables,
      objectCounts: {
        views: views.length,
        triggers: triggers.length,
        routines: routines.length,
        events: events.length,
      },
      totalRows,
      tableRowCounts,
      proofCount: proofMetadata.length,
      proofBlobChunkCount: blobChecksums.length,
      proofMetadata,
      blobChecksums,
      dumpFileBytes: sqlStats.size,
      dumpSha256: dumpHash.digest("hex"),
    };

    if (outManifestPath) {
      fs.writeFileSync(outManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    }

    return manifest;
  } finally {
    await conn.end();
  }
}

/**
 * Restores a binary-safe SQL dump ONLY into an explicitly confirmed, empty, disposable target DB,
 * then verifies all tables, row counts, and binary proof chunk SHA-256 checksums against the manifest.
 */
export async function restoreMariaDbBackup({
  targetConfig,
  inSqlPath,
  manifestPath,
  sourceDbName,
  confirmCleanTarget,
}) {
  const conn = await openSafeMysqlConnection(targetConfig);
  try {
    const [existingRows] = await conn.query("SHOW TABLES");
    const existingTables = existingRows.map((r) => String(Object.values(r)[0]));

    assertSafeRestoreTarget({
      targetDbName: targetConfig.database,
      sourceDbName,
      existingTables,
      confirmCleanTarget,
    });

    const sqlText = fs.readFileSync(inSqlPath, "utf8");
    const statements = splitSqlStatements(sqlText);

    await conn.query("SET SESSION TIME_ZONE = '+00:00'");
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query("SET UNIQUE_CHECKS = 0");

    let executedCount = 0;
    for (const stmt of statements) {
      await conn.query(stmt);
      executedCount++;
    }

    await conn.query("SET UNIQUE_CHECKS = 1");
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    const verification = await verifyRestoredBackup(conn, manifestPath);
    return {
      ok: verification.ok,
      targetDatabase: targetConfig.database,
      executedStatements: executedCount,
      verification,
    };
  } finally {
    await conn.end();
  }
}

/**
 * Verifies restored target DB tables, exact row counts, and binary proof BLOB SHA-256 checksums.
 */
export async function verifyRestoredBackup(connOrConfig, manifestPath) {
  const ownConn = typeof connOrConfig.query !== "function";
  const conn = ownConn ? await openSafeMysqlConnection(connOrConfig) : connOrConfig;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME ASC`,
    );
    const restoredTables = tableRows.map((r) => String(r.tableName));
    const missingTables = manifest.tables.filter((t) => !restoredTables.includes(t));
    const extraTables = restoredTables.filter((t) => !manifest.tables.includes(t));

    const rowMismatches = [];
    for (const tableName of restoredTables) {
      if (!(tableName in manifest.tableRowCounts)) continue;
      const [[countRow]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM ${escapeMysqlIdentifier(tableName)}`,
      );
      const actualCount = Number(countRow.cnt);
      const expectedCount = Number(manifest.tableRowCounts[tableName]);
      if (actualCount !== expectedCount) {
        rowMismatches.push({ tableName, expectedCount, actualCount });
      }
    }

    const [restoredBlobs] = restoredTables.includes("crm_payment_proof_blobs")
      ? await conn.query(
          `SELECT storage_key AS storageKey, chunk_index AS chunkIndex, chunk_size AS chunkSize, LOWER(SHA2(blob_data, 256)) AS chunkSha256
           FROM crm_payment_proof_blobs
           ORDER BY storage_key ASC, chunk_index ASC`,
        )
      : [[]];

    const blobMap = new Map(restoredBlobs.map((b) => [`${b.storageKey}#${b.chunkIndex}`, b]));
    const blobMismatches = [];
    for (const expected of manifest.blobChecksums ?? []) {
      const key = `${expected.storageKey}#${expected.chunkIndex}`;
      const actual = blobMap.get(key);
      if (
        !actual ||
        Number(actual.chunkSize) !== Number(expected.chunkSize) ||
        String(actual.chunkSha256) !== String(expected.chunkSha256)
      ) {
        blobMismatches.push({
          key,
          expectedSha256: expected.chunkSha256,
          actualSha256: actual ? actual.chunkSha256 : null,
        });
      }
    }

    // Reassemble complete multi-chunk proof payloads in Node and verify full-file SHA-256
    const proofIntegrityResults = [];
    for (const proof of manifest.proofMetadata ?? []) {
      const [chunkRows] = await conn.query(
        `SELECT chunk_index AS chunkIndex, blob_data AS blobData
         FROM crm_payment_proof_blobs
         WHERE storage_key = ?
         ORDER BY chunk_index ASC`,
        [proof.storageKey],
      );
      const fullBuf = Buffer.concat(chunkRows.map((c) => Buffer.from(c.blobData)));
      const actualFileSha256 = crypto.createHash("sha256").update(fullBuf).digest("hex");
      const matched =
        fullBuf.byteLength === Number(proof.fileSize) &&
        actualFileSha256 === String(proof.sha256Hash);
      proofIntegrityResults.push({
        proofId: proof.id,
        storageKey: proof.storageKey,
        expectedBytes: Number(proof.fileSize),
        actualBytes: fullBuf.byteLength,
        matched,
      });
    }

    const ok =
      missingTables.length === 0 &&
      extraTables.length === 0 &&
      rowMismatches.length === 0 &&
      blobMismatches.length === 0 &&
      proofIntegrityResults.every((p) => p.matched);

    return {
      ok,
      restoredTableCount: restoredTables.length,
      expectedTableCount: manifest.tableCount,
      missingTables,
      extraTables,
      rowMismatches,
      blobMismatches,
      verifiedProofCount: proofIntegrityResults.length,
      proofIntegrityResults,
    };
  } finally {
    if (ownConn) {
      await conn.end();
    }
  }
}

function parseCliArgs(argv) {
  const args = {
    mode: "help",
    outSql: "",
    outManifest: "",
    inSql: "",
    manifest: "",
    sourceDbName: "",
    confirmCleanTarget: false,
    usedMiB: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--export") args.mode = "export";
    else if (a === "--restore") args.mode = "restore";
    else if (a === "--verify") args.mode = "verify";
    else if (a === "--capacity") args.mode = "capacity";
    else if (a === "--confirm-clean-target") args.confirmCleanTarget = true;
    else if (a === "--out-sql" && argv[i + 1]) args.outSql = argv[++i];
    else if (a === "--out-manifest" && argv[i + 1]) args.outManifest = argv[++i];
    else if (a === "--in-sql" && argv[i + 1]) args.inSql = argv[++i];
    else if (a === "--manifest" && argv[i + 1]) args.manifest = argv[++i];
    else if (a === "--source-db" && argv[i + 1]) args.sourceDbName = argv[++i];
    else if (a === "--used-mib" && argv[i + 1]) args.usedMiB = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.mode === "help") {
    console.log(
      JSON.stringify({
        ok: true,
        usage:
          "node scripts/b11c-mariadb-backup.mjs [--export --out-sql <path> --out-manifest <path> | --restore --in-sql <path> --manifest <path> --source-db <name> --confirm-clean-target | --verify --manifest <path> | --capacity --used-mib <n>]",
      }),
    );
    return;
  }

  if (args.mode === "capacity") {
    console.log(
      JSON.stringify(evaluateMariadbStorageCapacity({ usedMiB: args.usedMiB ?? 0 }), null, 2),
    );
    return;
  }

  if (args.mode === "export") {
    if (!args.outSql) throw new Error("--out-sql is required for --export");
    const cfg = parseConnectionConfigFromEnv("SOURCE_DB");
    const manifestPath = args.outManifest || `${args.outSql}.manifest.json`;
    const manifest = await exportMariaDbBackup({
      connectionConfig: cfg,
      outSqlPath: args.outSql,
      outManifestPath: manifestPath,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "export",
          manifestSummary: {
            sourceDatabase: manifest.sourceDatabase,
            tableCount: manifest.tableCount,
            totalRows: manifest.totalRows,
            proofCount: manifest.proofCount,
            proofBlobChunkCount: manifest.proofBlobChunkCount,
            dumpFileBytes: manifest.dumpFileBytes,
            dumpSha256: manifest.dumpSha256,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.mode === "restore") {
    if (!args.inSql || !args.manifest) {
      throw new Error("--in-sql and --manifest are required for --restore");
    }
    const cfg = parseConnectionConfigFromEnv("TARGET_DB");
    const result = await restoreMariaDbBackup({
      targetConfig: cfg,
      inSqlPath: args.inSql,
      manifestPath: args.manifest,
      sourceDbName: args.sourceDbName,
      confirmCleanTarget: args.confirmCleanTarget,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (args.mode === "verify") {
    if (!args.manifest) throw new Error("--manifest is required for --verify");
    const cfg = parseConnectionConfigFromEnv("TARGET_DB");
    const result = await verifyRestoredBackup(cfg, args.manifest);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  }
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMainModule) {
  main().catch((err) => {
    console.error(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    process.exit(1);
  });
}
