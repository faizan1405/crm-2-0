import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, describe, expect, it } from "vitest";
import { assessProofStorageEnv, parseServerEnv } from "./config/env.server";
import {
  buildDeterministicCronEventId,
  buildHostingerCronCommand,
  computeCronWindowContext,
  HOSTINGER_CRON_MAX_COMMAND_CHARS,
  isCronActionSafeInternalOnly,
  runAutomationCronTick,
} from "./crm/automationCron.server";
import { CrmServiceError } from "./crm/errors.server";
import type { CrmDatabase } from "./db/index.server";
import * as dbSchema from "./db/schema.server";
import { getHealthStatus } from "./health/health.server";
import {
  getProofStorageBackend,
  MARIADB_PROOF_CHUNK_BYTES,
  MariadbBlobProofStorage,
  resetProofStorageBackend,
  splitBufferIntoProofChunks,
} from "./storage/proofStorage.server";
import {
  buildHostingerCliCommand,
  parseCronCliArgs,
  toIstPartsJs,
} from "../../scripts/run-automation-cron.mjs";

const DIALECT = new MySqlDialect();

function buildValidRealJpeg(extraBytes = 0): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20,
  ]);
  const filler = extraBytes > 0 ? Buffer.alloc(extraBytes, 0x41) : Buffer.alloc(0);
  return Buffer.concat([header, filler, Buffer.from([0xff, 0xd9])]);
}

function buildValidRealPdf(bodyText = "SyntheticReceiptPayload"): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Note (${bodyText}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    "ascii",
  );
}

/**
 * Minimal deterministic in-memory Drizzle MySQL test engine supporting `select`, `insert`, `update`,
 * `delete`, `transaction` rollback, `ASC` ordering, `groupBy`, `limit`, and unique index checks.
 */
function createInMemoryRelationalDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const colToPropByTable = new Map<string, Map<string, string>>();

  function registerTable(table: unknown) {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    if (!tables.has(name)) {
      tables.set(name, []);
    }
    if (!colToPropByTable.has(name)) {
      const cols = getTableColumns(table as Parameters<typeof getTableColumns>[0]);
      const map = new Map<string, string>();
      for (const [prop, col] of Object.entries(cols)) {
        map.set((col as Column).name, prop);
      }
      colToPropByTable.set(name, map);
    }
    return name;
  }

  function resolveProp(tableName: string, sqlColName: string): string {
    return colToPropByTable.get(tableName)?.get(sqlColName) ?? sqlColName;
  }

  function evaluateWhere(
    row: Record<string, unknown>,
    tableName: string,
    whereClause: unknown,
  ): boolean {
    if (!whereClause) return true;
    const query = DIALECT.sqlToQuery(whereClause as Parameters<typeof DIALECT.sqlToQuery>[0]);
    let expr = query.sql.trim();
    while (expr.startsWith("(") && expr.endsWith(")")) {
      // Strip matching outer parentheses safely only when outer wraps whole clause
      let depth = 0;
      let wrapsWhole = true;
      for (let i = 0; i < expr.length; i++) {
        if (expr[i] === "(") depth++;
        else if (expr[i] === ")") {
          depth--;
          if (depth === 0 && i < expr.length - 1) {
            wrapsWhole = false;
            break;
          }
        }
      }
      if (!wrapsWhole) break;
      expr = expr.slice(1, -1).trim();
    }

    const parts = expr.split(/\s+and\s+/i);
    let paramIdx = 0;

    for (const rawPart of parts) {
      const part = rawPart.trim().replace(/^\(+|\)+$/g, "");
      const eqMatch = /(?:`[^`]+`\.)?`([^`]+)`\s*=\s*\?/.exec(part);
      if (eqMatch) {
        const prop = resolveProp(tableName, eqMatch[1]!);
        const expected = query.params[paramIdx++];
        if (row[prop] !== expected) return false;
        continue;
      }

      const lteMatch = /(?:`[^`]+`\.)?`([^`]+)`\s*<=\s*\?/.exec(part);
      if (lteMatch) {
        const prop = resolveProp(tableName, lteMatch[1]!);
        const bound = String(query.params[paramIdx++] ?? "");
        if (String(row[prop] ?? "") > bound) return false;
        continue;
      }

      const nullMatch = /(?:`[^`]+`\.)?`([^`]+)`\s+is\s+null/i.exec(part);
      if (nullMatch) {
        const prop = resolveProp(tableName, nullMatch[1]!);
        if (row[prop] !== null && row[prop] !== undefined) return false;
        continue;
      }

      const inMatch = /(?:`[^`]+`\.)?`([^`]+)`\s+in\s+\(([^)]+)\)/i.exec(part);
      if (inMatch) {
        const prop = resolveProp(tableName, inMatch[1]!);
        const placeholderCount = inMatch[2]!.split("?").length - 1;
        const allowed = query.params.slice(paramIdx, paramIdx + placeholderCount);
        paramIdx += placeholderCount;
        if (!allowed.includes(row[prop])) return false;
        continue;
      }
    }

    return true;
  }

  function snapshotTables(): Map<string, Record<string, unknown>[]> {
    const copy = new Map<string, Record<string, unknown>[]>();
    for (const [k, rows] of tables.entries()) {
      copy.set(
        k,
        rows.map((r) => ({ ...r })),
      );
    }
    return copy;
  }

  function enforceUnique(tableName: string, candidate: Record<string, unknown>): void {
    const existing = tables.get(tableName) ?? [];
    if (tableName === "crm_payment_proof_blobs") {
      if (
        existing.some(
          (r) =>
            r["storageKey"] === candidate["storageKey"] &&
            r["chunkIndex"] === candidate["chunkIndex"],
        )
      ) {
        const err = new Error("Duplicate entry for uq_crm_proof_blobs_key_chunk") as Error & {
          code?: string;
        };
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
    } else if (tableName === "crm_follow_ups") {
      if (
        candidate["activeLeadLock"] &&
        existing.some(
          (r) =>
            r["ownerUserId"] === candidate["ownerUserId"] &&
            r["activeLeadLock"] === candidate["activeLeadLock"],
        )
      ) {
        const err = new Error("Duplicate entry for uq_crm_followups_active_lead") as Error & {
          code?: string;
        };
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
    } else if (tableName === "crm_internal_reminders") {
      if (
        existing.some(
          (r) =>
            r["ownerUserId"] === candidate["ownerUserId"] &&
            r["reminderKey"] === candidate["reminderKey"],
        )
      ) {
        const err = new Error("Duplicate entry for uq_crm_reminders_owner_key") as Error & {
          code?: string;
        };
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
    } else if (tableName === "crm_automation_runs") {
      if (
        candidate["executionKey"] &&
        existing.some(
          (r) =>
            r["ownerUserId"] === candidate["ownerUserId"] &&
            r["executionKey"] === candidate["executionKey"],
        )
      ) {
        const err = new Error("Duplicate entry for uq_crm_auto_runs_owner_exec_key") as Error & {
          code?: string;
        };
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
    }
  }

  function projectRow(
    row: Record<string, unknown>,
    projection?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!projection) return { ...row };
    const out: Record<string, unknown> = {};
    for (const [alias, colRef] of Object.entries(projection)) {
      if (colRef && typeof colRef === "object" && "name" in colRef) {
        const sqlName = (colRef as Column).name;
        const matchedEntry = Object.entries(row).find(([k]) => k === alias || k === sqlName);
        out[alias] = matchedEntry ? matchedEntry[1] : row[alias];
      } else {
        out[alias] = row[alias] ?? row["createdAt"];
      }
    }
    return out;
  }

  const dbApi: Record<string, unknown> = {
    tables,
    seed(table: unknown, rows: Record<string, unknown>[]) {
      const name = registerTable(table);
      tables.set(
        name,
        rows.map((r) => ({ ...r })),
      );
    },
    select(projection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const tableName = registerTable(table);
          let whereClause: unknown;
          let orderClause: unknown;
          let groupCols: unknown[] = [];
          let limitCount: number | undefined;

          const execQuery = () => {
            let rows = (tables.get(tableName) ?? []).filter((r) =>
              evaluateWhere(r, tableName, whereClause),
            );
            if (groupCols.length > 0 && tableName === "crm_payment_proof_blobs") {
              const grouped = new Map<string, Record<string, unknown>>();
              for (const r of rows) {
                const k = String(r["storageKey"]);
                const prev = grouped.get(k);
                if (!prev || String(r["createdAt"]) < String(prev["createdAt"])) {
                  grouped.set(k, {
                    storageKey: r["storageKey"],
                    createdAt: r["createdAt"],
                  });
                }
              }
              rows = [...grouped.values()];
            }
            if (orderClause) {
              const orderSql = DIALECT.sqlToQuery(
                orderClause as Parameters<typeof DIALECT.sqlToQuery>[0],
              ).sql;
              const match = /`([^`]+)`(?:\s+(asc|desc))?/i.exec(orderSql);
              const colName = match?.[1];
              const isDesc = match?.[2]?.toLowerCase() === "desc";
              if (colName) {
                const prop = resolveProp(tableName, colName);
                rows = [...rows].sort((a, b) => {
                  const va = a[prop];
                  const vb = b[prop];
                  const cmp =
                    typeof va === "number" && typeof vb === "number"
                      ? va - vb
                      : String(va ?? "").localeCompare(String(vb ?? ""));
                  return isDesc ? -cmp : cmp;
                });
              }
            }
            if (limitCount !== undefined) {
              rows = rows.slice(0, limitCount);
            }
            return rows.map((r) => (groupCols.length > 0 ? r : projectRow(r, projection)));
          };

          const builder: Record<string, unknown> = {
            where(cond: unknown) {
              whereClause = cond;
              return builder;
            },
            orderBy(ord: unknown) {
              orderClause = ord;
              return builder;
            },
            groupBy(...cols: unknown[]) {
              groupCols = cols;
              return builder;
            },
            limit(n: number) {
              limitCount = n;
              return builder;
            },
            for() {
              return builder;
            },
            then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return Promise.resolve().then(execQuery).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
    insert(table: unknown) {
      const tableName = registerTable(table);
      return {
        values(rawRow: Record<string, unknown> | Record<string, unknown>[]) {
          const rowsToInsert = Array.isArray(rawRow) ? rawRow : [rawRow];
          const runInsert = () => {
            for (const row of rowsToInsert) {
              const copy = { ...row };
              enforceUnique(tableName, copy);
              tables.get(tableName)!.push(copy);
            }
            return [{ affectedRows: rowsToInsert.length }, undefined];
          };
          return {
            then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return Promise.resolve().then(runInsert).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
    update(table: unknown) {
      const tableName = registerTable(table);
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const runUpdate = () => {
                const list = tables.get(tableName) ?? [];
                let updated = 0;
                for (const row of list) {
                  if (evaluateWhere(row, tableName, cond)) {
                    Object.assign(row, patch);
                    updated++;
                  }
                }
                return [{ affectedRows: updated }, undefined];
              };
              return {
                then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
                  return Promise.resolve().then(runUpdate).then(onFulfilled, onRejected);
                },
              };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      const tableName = registerTable(table);
      return {
        where(cond: unknown) {
          const runDelete = () => {
            const list = tables.get(tableName) ?? [];
            const kept = list.filter((r) => !evaluateWhere(r, tableName, cond));
            const deletedCount = list.length - kept.length;
            tables.set(tableName, kept);
            return [{ affectedRows: deletedCount }, undefined];
          };
          return {
            then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return Promise.resolve().then(runDelete).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
    async transaction<T>(fn: (tx: CrmDatabase) => Promise<T>): Promise<T> {
      const backup = snapshotTables();
      try {
        return await fn(dbApi as unknown as CrmDatabase);
      } catch (err) {
        tables.clear();
        for (const [k, v] of backup.entries()) {
          tables.set(k, v);
        }
        throw err;
      }
    },
  };

  return dbApi as unknown as CrmDatabase & {
    tables: Map<string, Record<string, unknown>[]>;
    seed: (table: unknown, rows: Record<string, unknown>[]) => void;
  };
}

describe("Checkpoint B11C-BUSINESS — Hostinger Business Feasibility Prototypes", () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevDriver = process.env["PROOF_STORAGE_DRIVER"];
  const prevConfirmed = process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"];

  afterEach(() => {
    process.env["NODE_ENV"] = prevNodeEnv;
    if (prevDriver === undefined) delete process.env["PROOF_STORAGE_DRIVER"];
    else process.env["PROOF_STORAGE_DRIVER"] = prevDriver;
    if (prevConfirmed === undefined) delete process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"];
    else process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"] = prevConfirmed;
    resetProofStorageBackend();
  });

  describe("1. Step 2 Schema & Env Gate — MariaDB BLOB Option B vs Fail-Closed Guard", () => {
    it("registers crm_payment_proof_blobs in Drizzle schema & migration 0015", () => {
      expect(getTableName(dbSchema.crmPaymentProofBlobs)).toBe("crm_payment_proof_blobs");
      expect(dbSchema.crmFinanceSchema.crmPaymentProofBlobs).toBe(dbSchema.crmPaymentProofBlobs);
      expect(dbSchema.crmCoreSchema.crmPaymentProofBlobs).toBe(dbSchema.crmPaymentProofBlobs);

      const cols = getTableColumns(dbSchema.crmPaymentProofBlobs);
      expect(cols.storageKey).toBeDefined();
      expect(cols.chunkIndex).toBeDefined();
      expect(cols.chunkCount).toBeDefined();
      expect(cols.blobData).toBeDefined();
      expect(cols.totalSha256).toBeDefined();

      const mig0015 = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/db/migrations/0015_b11c_business_mariadb_blob.sql"),
        "utf8",
      );
      expect(mig0015).toContain("CREATE TABLE `crm_payment_proof_blobs`");
      expect(mig0015).toContain("`blob_data` longblob NOT NULL");
      expect(mig0015).toContain("uq_crm_proof_blobs_key_chunk");
      expect(mig0015).toContain("ON DELETE restrict");
    });

    it("fails closed in production for mariadb-blob until DB config AND live durability confirmation exist", () => {
      const missingConfirm = parseServerEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://khaki-butterfly-345144.hostingersite.com",
        DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/crm_v2",
        PROOF_STORAGE_DRIVER: "mariadb-blob",
        PROOF_PRODUCTION_DURABLE_CONFIRMED: "false",
      });
      const blocked = assessProofStorageEnv(missingConfirm);
      expect(blocked.failClosed).toBe(true);
      expect(blocked.productionReady).toBe(false);
      expect(blocked.blockedCode).toBe("storage_durability_blocked");

      const missingDb = parseServerEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://khaki-butterfly-345144.hostingersite.com",
        PROOF_STORAGE_DRIVER: "mariadb-blob",
        PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
      });
      const blockedNoDb = assessProofStorageEnv(missingDb);
      expect(blockedNoDb.failClosed).toBe(true);
      expect(blockedNoDb.blockedCode).toBe("storage_not_configured");

      const approved = parseServerEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://khaki-butterfly-345144.hostingersite.com",
        DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/crm_v2",
        PROOF_STORAGE_DRIVER: "mariadb-blob",
        PROOF_PRODUCTION_DURABLE_CONFIRMED: "true",
      });
      const ready = assessProofStorageEnv(approved);
      expect(ready.failClosed).toBe(false);
      expect(ready.productionReady).toBe(true);
      expect(ready.status).toBe("production_verified_mariadb_blob");
      expect(ready.unsafePublicOrBuildPath).toBe(false);
    });

    it("health check marks mariadb-blob isolationSafe without filesystem path even when prodBlocked", async () => {
      process.env["NODE_ENV"] = "production";
      process.env["PROOF_STORAGE_DRIVER"] = "mariadb-blob";
      process.env["PROOF_PRODUCTION_DURABLE_CONFIRMED"] = "false";
      const health = await getHealthStatus();
      expect(health.subsystems.storage.driver).toBe("mariadb-blob");
      expect(health.subsystems.storage.isolationSafe).toBe(true);
      expect(health.subsystems.storage.failClosed).toBe(true);
    });
  });

  describe("2. Step 2 MariadbBlobProofStorage — Chunked Packet Safety, Integrity & Isolation", () => {
    it("chunks payloads cleanly at <= 1 MiB to stay ~15x below Hostinger 16 MB max_allowed_packet", () => {
      expect(MARIADB_PROOF_CHUNK_BYTES).toBe(1_048_576);
      const tenMbBuffer = Buffer.alloc(10 * 1024 * 1024, 0x20);
      const chunks = splitBufferIntoProofChunks(tenMbBuffer);
      expect(chunks).toHaveLength(10);
      for (const c of chunks) {
        expect(c.byteLength).toBeLessThanOrEqual(MARIADB_PROOF_CHUNK_BYTES);
        expect(c.byteLength).toBeLessThan(16 * 1024 * 1024);
      }
    });

    it("stages, chunks across multiple rows, persists atomically, verifies SHA-256, streams & deletes", async () => {
      const db = createInMemoryRelationalDb();
      const storage = new MariadbBlobProofStorage({
        db,
        nodeEnv: "test",
        chunkBytes: 32, // force multi-chunk storage even on small JPEG
        maxBlobBytes: 64 * 1024,
      });

      const realJpeg = buildValidRealJpeg(48);
      const expectedSha = crypto.createHash("sha256").update(realJpeg).digest("hex");

      const staged = await storage.stageUpload({
        ownerUserId: "usr_owner_1",
        originalFileName: "upi receipt #1.jpg",
        declaredMimeType: "image/jpeg",
        streamOrBuffer: realJpeg,
      });
      expect(staged.sha256).toBe(expectedSha);

      const persisted = await storage.persistStagedProof({
        ownerUserId: "usr_owner_1",
        proofId: "proof_1",
        tempKey: staged.tempKey,
        ext: staged.descriptor.fileExtension,
        expectedSha256: staged.sha256,
        expectedByteSize: staged.byteSize,
      });
      expect(persisted.storageKey).toBe("prf_proof_1.jpg");

      const blobRows = db.tables.get("crm_payment_proof_blobs") ?? [];
      expect(blobRows.length).toBeGreaterThanOrEqual(3);

      const head = await storage.headPrivateObject(persisted.storageKey);
      expect(head.exists).toBe(true);
      expect(head.byteSize).toBe(realJpeg.byteLength);

      const loaded = await storage.getPrivateObject(persisted.storageKey, {
        sha256: expectedSha,
        byteSize: realJpeg.byteLength,
      });
      expect(loaded).not.toBeNull();
      expect(loaded!.buffer.equals(realJpeg)).toBe(true);
      expect(loaded!.sha256).toBe(expectedSha);

      // Reconcile distinguishes referenced vs orphaned blobs
      const rec1 = await storage.reconcileStorage(new Set([persisted.storageKey]), { minAgeMs: 0 });
      expect(rec1.unreferencedFiles).toEqual([]);
      expect(rec1.missingKeys).toEqual([]);

      const rec2 = await storage.reconcileStorage(new Set(["prf_missing.pdf"]), { minAgeMs: 0 });
      expect(rec2.unreferencedFiles).toEqual([persisted.storageKey]);
      expect(rec2.missingKeys).toEqual(["prf_missing.pdf"]);

      // Delete removes all chunk rows
      expect(await storage.deletePrivateObject(persisted.storageKey)).toBe(true);
      expect(db.tables.get("crm_payment_proof_blobs")).toHaveLength(0);
    });

    it("detects bit-flip corruption, rejects cross-owner persistence, enforces maxBlobBytes, and fails closed without DB", async () => {
      const db = createInMemoryRelationalDb();
      const storage = new MariadbBlobProofStorage({
        db,
        nodeEnv: "test",
        chunkBytes: 32,
        maxBlobBytes: 1024,
      });

      const pdf = buildValidRealPdf("OwnerSecretInvoice");
      const put = await storage.putPrivateObject({
        ownerUserId: "usr_owner_1",
        proofId: "proof_corrupt_test",
        originalFileName: "invoice.pdf",
        content: pdf,
      });

      // Corrupt 1 byte inside chunk 0
      const rows = db.tables.get("crm_payment_proof_blobs")!;
      const chunk0 = rows.find((r) => r["chunkIndex"] === 0)!;
      const mutated = Buffer.from(chunk0["blobData"] as Buffer);
      mutated[mutated.length - 1] = (mutated[mutated.length - 1]! ^ 0xff) & 0xff;
      chunk0["blobData"] = mutated;

      const verified = await storage.verifyPrivateObject(put.storageKey, {
        sha256: put.sha256,
        byteSize: put.byteSize,
      });
      expect(verified.ok).toBe(false);
      expect(verified.status).toBe("checksum_mismatch");
      await expect(
        storage.getPrivateObject(put.storageKey, { sha256: put.sha256, byteSize: put.byteSize }),
      ).rejects.toMatchObject({ code: "file_corrupted" });

      // Cross-owner persist refusal
      const staged = await storage.stageUpload({
        ownerUserId: "usr_owner_1",
        originalFileName: "ok.jpg",
        streamOrBuffer: buildValidRealJpeg(),
      });
      await expect(
        storage.persistStagedProof({
          ownerUserId: "usr_owner_other",
          proofId: "proof_x",
          tempKey: staged.tempKey,
          ext: "jpg",
        }),
      ).rejects.toMatchObject({ status: 403 });

      // Quota cap enforcement (`maxBlobBytes = 1024`)
      await expect(
        storage.stageUpload({
          ownerUserId: "usr_owner_1",
          originalFileName: "huge.jpg",
          streamOrBuffer: buildValidRealJpeg(2048),
        }),
      ).rejects.toMatchObject({ code: "file_too_large" });

      // No DB handle fails closed via factory
      const noDbBackend = getProofStorageBackend({
        driver: "mariadb-blob",
        db: null,
        env: parseServerEnv({
          NODE_ENV: "production",
          PROOF_STORAGE_DRIVER: "mariadb-blob",
          PROOF_PRODUCTION_DURABLE_CONFIRMED: "false",
        }),
      });
      expect(noDbBackend.healthSummary().failClosed).toBe(true);
      await expect(
        noDbBackend.stageUpload({
          ownerUserId: "usr_owner_1",
          originalFileName: "test.jpg",
          streamOrBuffer: buildValidRealJpeg(),
        }),
      ).rejects.toMatchObject({ status: 503 });
    });
  });

  describe("3. Step 3 Hostinger Cron Compatibility, Timezones & Zero Duplicate Follow-ups", () => {
    it("enforces Hostinger 255-char command ceiling and reveals why compact cd command is required", () => {
      const stagingCmd = buildHostingerCronCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
        nodeMajor: "22",
      });
      // Compact `cd .../hbuilds && ...` saves ~80+ characters compared to repeating full hbuilds path twice
      expect(stagingCmd.fitsHostinger255Limit).toBe(true);
      expect(stagingCmd.compactLength).toBeLessThanOrEqual(HOSTINGER_CRON_MAX_COMMAND_CHARS);
      expect(stagingCmd.compactLength).toBeLessThan(stagingCmd.naiveAbsoluteLength);
      expect(stagingCmd.compactCommand).toContain("--env-file=config/.env");

      const stagingWithOwnerCmd = buildHostingerCronCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
        nodeMajor: "22",
        args: ["--dry-run", "--owner=usr_owner_main"],
      });
      // Adding even one CLI flag overflows naive dual-path Hostinger command (>255), while compact stays under!
      expect(stagingWithOwnerCmd.naiveFitsHostinger255Limit).toBe(false);
      expect(stagingWithOwnerCmd.naiveAbsoluteLength).toBeGreaterThan(
        HOSTINGER_CRON_MAX_COMMAND_CHARS,
      );
      expect(stagingWithOwnerCmd.fitsHostinger255Limit).toBe(true);

      const cliSpec = buildHostingerCliCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
      });
      expect(cliSpec.compactCommand).toBe(stagingCmd.compactCommand);

      expect(() =>
        buildHostingerCronCommand({
          username: "u256504187; rm -rf /",
          domain: "example.com",
        }),
      ).toThrow();
    });

    it("converts UTC cron timestamps cleanly into Asia/Kolkata IST across UTC midnight rollover", () => {
      // 2026-11-11 19:07:30 UTC === 2026-11-12 00:37:30 IST (+05:30)
      const utcLateEvening = new Date("2026-11-11T19:07:30.000Z");
      const win = computeCronWindowContext(utcLateEvening, 15);
      expect(win.istDate).toBe("2026-11-12");
      expect(win.istTime).toBe("00:37");
      expect(win.istBucketKey).toBe("2026-11-12T00:30+0530");
      expect(win.utcBucketKey).toBe("2026-11-11T19:00Z");

      const jsIst = toIstPartsJs(utcLateEvening);
      expect(jsIst.istDate).toBe("2026-11-12");
      expect(jsIst.istTime).toBe("00:37");
    });

    it("blocks outbound notification actions and refuses non-dry-run production execution", async () => {
      expect(isCronActionSafeInternalOnly("followup")).toBe(true);
      expect(isCronActionSafeInternalOnly("reminder")).toBe(true);
      expect(isCronActionSafeInternalOnly("notify")).toBe(false);

      const db = createInMemoryRelationalDb();
      await expect(
        runAutomationCronTick(db, {
          dryRun: false,
          allowExecution: true,
          env: parseServerEnv({
            NODE_ENV: "production",
            APP_ORIGIN: "https://khaki-butterfly-345144.hostingersite.com",
          }),
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("skips overlapping cron runs safely via advisory lock and exits gracefully on runtime budget", async () => {
      const db = createInMemoryRelationalDb();
      let lockReleased = false;

      const contended = await runAutomationCronTick(db, {
        ownerUserId: "usr_owner_cron",
        dryRun: true,
        acquireLock: async () => false,
        releaseLock: async () => {
          lockReleased = true;
        },
      });
      expect(contended.lockAcquired).toBe(false);
      expect(contended.checkedRules).toBe(0);
      expect(lockReleased).toBe(false);

      // Seed 2 rules and force budget expiry immediately after owner begins
      db.seed(dbSchema.crmAutomationRules, [
        {
          id: "ar_1",
          ownerUserId: "usr_owner_cron",
          name: "Rule 1",
          subject: "lead",
          triggerType: "followup_overdue",
          status: "enabled",
          conditionsJson: "{}",
          actionsJson: '["reminder"]',
          settingsJson: '{"cooldownHours":24}',
          version: 1,
          createdAt: "2026-11-01 00:00:00.000",
          updatedAt: "2026-11-01 00:00:00.000",
        },
      ]);

      let calls = 0;
      const budgeted = await runAutomationCronTick(db, {
        ownerUserId: "usr_owner_cron",
        dryRun: true,
        maxRuntimeMs: 50,
        getElapsedMs: () => (++calls >= 2 ? 100 : 10),
        acquireLock: async () => true,
        releaseLock: async () => {
          lockReleased = true;
        },
      });
      expect(budgeted.stoppedEarlyByBudget).toBe(true);
      expect(lockReleased).toBe(true);
    });

    it("runs overdue follow-up & inactivity tick idempotently: zero duplicate follow-ups or reminders across restarts", async () => {
      const db = createInMemoryRelationalDb();
      const now = new Date("2026-11-11T10:07:00.000Z"); // 15:37 IST

      db.seed(dbSchema.crmLeads, [
        {
          id: "lead_overdue_1",
          ownerUserId: "usr_owner_cron",
          name: "Asha Mehta",
          phone: "9876543210",
          email: null,
          source: "meta",
          status: "qualified",
          priority: "high",
          lifecycleStatus: "active",
          nextFollowUpAt: "2026-11-11 08:00:00.000",
          version: 1,
          createdAt: "2026-11-01 08:00:00.000",
          updatedAt: "2026-11-01 08:00:00.000",
        },
        {
          id: "lead_inactive_2",
          ownerUserId: "usr_owner_cron",
          name: "Rohan Shah",
          phone: "9876500001",
          email: null,
          source: "website",
          status: "new",
          priority: "medium",
          lifecycleStatus: "active",
          nextFollowUpAt: null,
          version: 1,
          createdAt: "2026-11-01 08:00:00.000",
          updatedAt: "2026-11-01 08:00:00.000",
        },
      ]);

      // Lead 1 already has an overdue active follow-up (so followup action must skip duplicate, while reminder runs ONCE)
      db.seed(dbSchema.crmFollowUps, [
        {
          id: "fu_overdue_1",
          ownerUserId: "usr_owner_cron",
          leadId: "lead_overdue_1",
          activeLeadLock: "lead_overdue_1",
          type: "call",
          dueAt: "2026-11-11 08:00:00.000",
          dueIstDate: "2026-11-11",
          dueIstTime: "13:30",
          note: "Existing follow-up",
          completedAt: null,
          cancelledAt: null,
          opId: null,
          createdByUserId: "usr_owner_cron",
          updatedByUserId: "usr_owner_cron",
          version: 1,
          createdAt: "2026-11-10 08:00:00.000",
          updatedAt: "2026-11-10 08:00:00.000",
        },
      ]);

      db.seed(dbSchema.crmAutomationRules, [
        {
          id: "ar_fu_overdue",
          ownerUserId: "usr_owner_cron",
          name: "Overdue Escalator",
          subject: "lead",
          triggerType: "followup_overdue",
          status: "enabled",
          conditionsJson: JSON.stringify({ sources: ["meta"] }),
          actionsJson: JSON.stringify(["reminder", "followup", "notify"]), // notify must be stripped
          settingsJson: JSON.stringify({ cooldownHours: 24, followupInHours: 12 }),
          version: 1,
          createdAt: "2026-11-01 00:00:00.000",
          updatedAt: "2026-11-01 00:00:00.000",
        },
        {
          id: "ar_inactivity",
          ownerUserId: "usr_owner_cron",
          name: "New Lead Followup",
          subject: "lead",
          triggerType: "inactivity",
          status: "enabled",
          conditionsJson: JSON.stringify({ sources: ["website"] }),
          actionsJson: JSON.stringify(["followup"]),
          settingsJson: JSON.stringify({ cooldownHours: 24, followupInHours: 24 }),
          version: 1,
          createdAt: "2026-11-01 00:00:00.000",
          updatedAt: "2026-11-01 00:00:00.000",
        },
      ]);

      // 1. Dry-run tick makes zero writes
      const dryReport = await runAutomationCronTick(db, {
        ownerUserId: "usr_owner_cron",
        now,
        dryRun: true,
      });
      expect(dryReport.checkedRules).toBe(2);
      expect(dryReport.outboundBlockedCount).toBe(1);
      expect(db.tables.get("crm_internal_reminders") ?? []).toHaveLength(0);
      expect(db.tables.get("crm_follow_ups")).toHaveLength(1);

      // 2. First safe disposable execution
      const run1 = await runAutomationCronTick(db, {
        ownerUserId: "usr_owner_cron",
        now,
        dryRun: false,
        allowExecution: true,
        allowTestExecutionInMock: true,
      });
      expect(run1.createdReminders).toBe(1); // Only 1 reminder for lead_overdue_1
      expect(run1.skippedActiveFollowUp).toBe(1); // Did NOT create second active follow-up on lead_overdue_1
      expect(run1.createdFollowUps).toBe(1); // Created exactly 1 follow-up for lead_inactive_2
      expect(db.tables.get("crm_follow_ups")).toHaveLength(2);
      expect(db.tables.get("crm_internal_reminders")).toHaveLength(1);

      // 3. Simulated crash-restart / duplicate cron fire inside same 15-min bucket
      const run2 = await runAutomationCronTick(db, {
        ownerUserId: "usr_owner_cron",
        now: new Date(now.getTime() + 120_000),
        dryRun: false,
        allowExecution: true,
        allowTestExecutionInMock: true,
      });
      expect(run2.createdFollowUps).toBe(0);
      expect(run2.createdReminders).toBe(0);
      expect(run2.skippedDuplicates).toBeGreaterThanOrEqual(2);
      expect(db.tables.get("crm_follow_ups")).toHaveLength(2);
      expect(db.tables.get("crm_internal_reminders")).toHaveLength(1);

      const ev1 = buildDeterministicCronEventId({
        triggerType: "followup_overdue",
        ruleId: "ar_fu_overdue",
        ruleVersion: 1,
        targetId: "fu_overdue_1",
        istBucketKey: run1.window.istBucketKey,
      });
      expect(ev1.length).toBeLessThanOrEqual(128);
    });

    it("standalone scripts/run-automation-cron.mjs runs --print-command & --help cleanly and blocks --execute-disposable", () => {
      const parsed = parseCronCliArgs(["--owner=usr_1", "--bucket-minutes=30"]);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.ownerId).toBe("usr_1");
      expect(parsed.bucketMinutes).toBe(30);

      const helpOut = execFileSync(
        process.execPath,
        [path.resolve(process.cwd(), "scripts/run-automation-cron.mjs"), "--help"],
        { encoding: "utf8" },
      );
      expect(JSON.parse(helpOut).ok).toBe(true);

      const printOut = execFileSync(
        process.execPath,
        [path.resolve(process.cwd(), "scripts/run-automation-cron.mjs"), "--print-command"],
        { encoding: "utf8" },
      );
      const parsedPrint = JSON.parse(printOut) as { fitsHostinger255Limit: boolean };
      expect(parsedPrint.fitsHostinger255Limit).toBe(true);

      let execFailed = false;
      try {
        execFileSync(
          process.execPath,
          [path.resolve(process.cwd(), "scripts/run-automation-cron.mjs"), "--execute-disposable"],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err: unknown) {
        execFailed = true;
        const stderr = (err as { stderr?: string }).stderr ?? "";
        expect(stderr).toContain("automation_cron_mutations_disabled");
      }
      expect(execFailed).toBe(true);
    });
  });
});
