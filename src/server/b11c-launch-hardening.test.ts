import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatApiErrorMessage } from "../lib/api/errors";
import { replacePaymentProof, uploadPaymentProof } from "../lib/api/financeApi";
import { parseServerEnv } from "./config/env.server";
import {
  buildHostingerCronCommand,
  computeCronWindowContext,
  HOSTINGER_CRON_MAX_COMMAND_CHARS,
  runAutomationCronTick,
} from "./crm/automationCron.server";
import { CrmServiceError } from "./crm/errors.server";
import { createPaymentRecord, listPaymentsForDeal } from "./crm/paymentsService.server";
import {
  attachPaymentProofRecord,
  getActivePaymentProof,
  readPaymentProofContent,
  removePaymentProofRecord,
  replacePaymentProofRecord,
} from "./crm/proofService.server";
import type { CrmDatabase } from "./db/index.server";
import * as dbSchema from "./db/schema.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";
import { MariadbBlobProofStorage } from "./storage/mariadbBlobProofStorage.server";
import {
  estimateProofGrowthBytes,
  measureMariadbCapacityFromDb,
  MIB_BYTES,
  type MariadbCapacityLogEvent,
} from "./storage/mariadbCapacity.server";
import {
  assertBackupProducerEnvHasNoPrivateKey,
  assertSafeBackupFilePath,
  decryptFileWithAgeX25519,
  encryptFileWithAgeX25519,
  evaluateEncryptedBackupHealth,
  generateAgeX25519KeyPair,
} from "../../scripts/b11c-backup-crypto.mjs";
import {
  assertSafeRestoreTarget,
  packageEncryptedBackupBundle,
  splitSqlStatements,
  withDecryptedBackupBundle,
} from "../../scripts/b11c-mariadb-backup.mjs";
import {
  assessEnvStatSecurity,
  buildHostingerCliCommand,
  computeCronBucketsJs,
  parseDotEnvSafely,
  resolveAndLoadCronEnv,
} from "../../scripts/run-automation-cron.mjs";

type SessionAuthOutcome =
  | {
      status: "authenticated";
      user: {
        id: string;
        email: string;
        name: string;
        roleId: "owner" | "staff";
        status: "active";
        sessionId: string;
      };
    }
  | { status: "unauthenticated"; reason: "missing" | "invalid" | "expired" };

const authMocks = vi.hoisted(() => ({
  activeDb: null as CrmDatabase | null,
  resolveSession: null as ((token: string | null) => Promise<SessionAuthOutcome>) | null,
}));

vi.mock("./auth/authService.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth/authService.server")>();
  return {
    ...actual,
    resolveAuthenticatedSession: async (
      token: string | null,
      env: Parameters<typeof actual.resolveAuthenticatedSession>[1],
      opts?: Parameters<typeof actual.resolveAuthenticatedSession>[2],
    ) => {
      if (authMocks.resolveSession) {
        return authMocks.resolveSession(token);
      }
      return actual.resolveAuthenticatedSession(token, env, opts);
    },
  };
});

vi.mock("./db/index.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/index.server")>();
  return {
    ...actual,
    getDatabase: () => authMocks.activeDb ?? actual.getDatabase(),
  };
});

const DIALECT = new MySqlDialect();

function buildValidPdfExactSize(targetTotalBytes: number): Buffer {
  const prefix = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Note (B11C-HARDENING) >>\nendobj\n%",
    "ascii",
  );
  const suffix = Buffer.from("\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "ascii");
  if (targetTotalBytes < prefix.length + suffix.length) {
    throw new Error(`targetTotalBytes ${targetTotalBytes} too small`);
  }
  const padLen = targetTotalBytes - prefix.length - suffix.length;
  return Buffer.concat([prefix, Buffer.alloc(padLen, 0x58), suffix]);
}

async function readableToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildManualMultipartBody(params: {
  boundary: string;
  fileName: string;
  fileMimeType: string;
  fileBytes: Buffer;
}): Buffer {
  const head = Buffer.from(
    `--${params.boundary}\r\nContent-Disposition: form-data; name="file"; filename="${params.fileName}"\r\nContent-Type: ${params.fileMimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${params.boundary}--\r\n`, "utf8");
  return Buffer.concat([head, params.fileBytes, tail]);
}

interface HardeningDbOptions {
  baseNonBlobInfoSchemaBytes?: number;
  simulateInfoSchemaLagOnBlobs?: boolean;
  failCapacityQuery?: boolean;
  corruptCapacityValue?: "NaN" | "empty_tables" | "null" | undefined;
  failGetLock?: boolean;
  asyncTickMs?: number;
}

/**
 * In-memory Drizzle MySQL test database simulating INFORMATION_SCHEMA metrics,
 * live chunk sums, optional stats lag, GET_LOCK contention, and transactional rollback.
 */
function createHardeningRelationalDb(opts: HardeningDbOptions = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const colToPropByTable = new Map<string, Map<string, string>>();
  let getLockHeld = false;

  const delayTick = async () => {
    if (opts.asyncTickMs && opts.asyncTickMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.asyncTickMs));
    }
  };

  function registerTable(table: unknown): string {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    if (!tables.has(name)) tables.set(name, []);
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
    let pIdx = 0;
    for (const rawPart of parts) {
      const part = rawPart.trim().replace(/^\(+|\)+$/g, "");
      const eqMatch = /(?:`[^`]+`\.)?`([^`]+)`\s*=\s*\?/.exec(part);
      if (eqMatch) {
        const prop = resolveProp(tableName, eqMatch[1]!);
        const expected = query.params[pIdx++];
        if (row[prop] !== expected) return false;
        continue;
      }
      const lteMatch = /(?:`[^`]+`\.)?`([^`]+)`\s*<=\s*\?/.exec(part);
      if (lteMatch) {
        const prop = resolveProp(tableName, lteMatch[1]!);
        const bound = String(query.params[pIdx++] ?? "");
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
        const count = inMatch[2]!.split(",").length;
        const allowed = query.params.slice(pIdx, pIdx + count);
        pIdx += count;
        if (!allowed.includes(row[prop])) return false;
        continue;
      }
    }
    return true;
  }

  function snapshotTables(): Map<string, Record<string, unknown>[]> {
    const snap = new Map<string, Record<string, unknown>[]>();
    for (const [name, rows] of tables.entries()) {
      snap.set(
        name,
        rows.map((r) => ({ ...r })),
      );
    }
    return snap;
  }

  function projectRow(
    row: Record<string, unknown>,
    projection?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!projection) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(projection)) {
      if (key in row) out[key] = row[key];
    }
    return out;
  }

  const dbApi = {
    tables,
    setBaseNonBlobBytes(bytes: number) {
      opts.baseNonBlobInfoSchemaBytes = bytes;
    },
    setFailureMode(patch: Partial<HardeningDbOptions>) {
      Object.assign(opts, patch);
    },
    seed(table: unknown, rows: Record<string, unknown>[]) {
      const name = registerTable(table);
      const list = tables.get(name)!;
      for (const r of rows) list.push({ ...r });
    },
    select(projection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const tableName = registerTable(table);
          let whereClause: unknown;
          let orderClause: unknown;
          let groupCols: unknown[] = [];
          let limitCount: number | undefined;
          const execQuery = async () => {
            await delayTick();
            let rows = (tables.get(tableName) ?? []).filter((r) =>
              evaluateWhere(r, tableName, whereClause),
            );
            if (groupCols.length > 0 && tableName === "crm_payment_proof_blobs") {
              const grouped = new Map<string, Record<string, unknown>>();
              for (const r of rows) {
                const k = String(r["storageKey"]);
                const prev = grouped.get(k);
                if (!prev || String(r["createdAt"]) < String(prev["createdAt"])) {
                  grouped.set(k, { storageKey: r["storageKey"], createdAt: r["createdAt"] });
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
            if (limitCount !== undefined) rows = rows.slice(0, limitCount);
            return rows.map((r) => (groupCols.length > 0 ? r : projectRow(r, projection)));
          };
          const builder: Record<string, unknown> = {
            where(c: unknown) {
              whereClause = c;
              return builder;
            },
            orderBy(o: unknown) {
              orderClause = o;
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
            then(onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve().then(execQuery).then(onF, onR);
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
          const runInsert = async () => {
            await delayTick();
            const list = tables.get(tableName)!;
            for (const row of rowsToInsert) {
              if (tableName === "crm_payment_proof_blobs") {
                const dup = list.find(
                  (r) =>
                    r["storageKey"] === row["storageKey"] && r["chunkIndex"] === row["chunkIndex"],
                );
                if (dup) throw { code: "ER_DUP_ENTRY", errno: 1062 };
              }
              if (tableName === "crm_idempotency_keys") {
                const dup = list.find(
                  (r) =>
                    r["ownerUserId"] === row["ownerUserId"] &&
                    r["scope"] === row["scope"] &&
                    r["idempotencyKey"] === row["idempotencyKey"],
                );
                if (dup) throw { code: "ER_DUP_ENTRY", errno: 1062 };
              }
              list.push({ ...row });
            }
            return [{ affectedRows: rowsToInsert.length }, undefined];
          };
          const exec = {
            then(onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve().then(runInsert).then(onF, onR);
            },
          };
          return exec;
        },
      };
    },
    update(table: unknown) {
      const tableName = registerTable(table);
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const runUpdate = async () => {
                await delayTick();
                let updated = 0;
                for (const row of tables.get(tableName) ?? []) {
                  if (evaluateWhere(row, tableName, cond)) {
                    for (const [k, v] of Object.entries(patch)) {
                      if (k === "version" && v && typeof v === "object") {
                        row["version"] = Number(row["version"] ?? 0) + 1;
                      } else {
                        row[k] = v;
                      }
                    }
                    updated++;
                  }
                }
                return [{ affectedRows: updated }, undefined];
              };
              return {
                then(onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
                  return Promise.resolve().then(runUpdate).then(onF, onR);
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
            tables.set(tableName, kept);
            return [{ affectedRows: list.length - kept.length }, undefined];
          };
          return {
            then(onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve().then(runDelete).then(onF, onR);
            },
          };
        },
      };
    },
    async execute(queryObj: unknown): Promise<[Record<string, unknown>[], undefined]> {
      await delayTick();
      const sqlStr = DIALECT.sqlToQuery(queryObj as Parameters<typeof DIALECT.sqlToQuery>[0]).sql;
      if (/GET_LOCK/i.test(sqlStr)) {
        if (opts.failGetLock || getLockHeld) {
          return [[{ acquired: 0 }], undefined];
        }
        getLockHeld = true;
        return [[{ acquired: 1 }], undefined];
      }
      if (/RELEASE_LOCK/i.test(sqlStr)) {
        getLockHeld = false;
        return [[{ released: 1 }], undefined];
      }
      if (opts.failCapacityQuery) {
        throw new Error("Simulated INFORMATION_SCHEMA query failure");
      }
      if (/INFORMATION_SCHEMA\.TABLES/i.test(sqlStr)) {
        if (opts.corruptCapacityValue === "empty_tables") {
          return [[], undefined];
        }
        if (opts.corruptCapacityValue === "NaN") {
          return [
            [{ tableName: "crm_deals", logicalBytes: "not-a-number", dataFreeBytes: 0 }],
            undefined,
          ];
        }
        if (opts.corruptCapacityValue === "null") {
          return [[{ tableName: "crm_deals", logicalBytes: null, dataFreeBytes: 0 }], undefined];
        }
        const blobRows = tables.get("crm_payment_proof_blobs") ?? [];
        const liveBlobBytes = blobRows.reduce((sum, r) => sum + Number(r["chunkSize"] ?? 0), 0);
        return [
          [
            {
              tableName: "crm_deals",
              logicalBytes: opts.baseNonBlobInfoSchemaBytes ?? 4 * MIB_BYTES,
              dataFreeBytes: 0,
            },
            {
              tableName: "crm_payment_proof_blobs",
              logicalBytes: opts.simulateInfoSchemaLagOnBlobs ? 0 : liveBlobBytes,
              dataFreeBytes: 0,
            },
          ],
          undefined,
        ];
      }
      if (/crm_payment_proof_blobs/i.test(sqlStr)) {
        const blobRows = tables.get("crm_payment_proof_blobs") ?? [];
        const total = blobRows.reduce((sum, r) => sum + Number(r["chunkSize"] ?? 0), 0);
        return [[{ blobChunkCount: blobRows.length, blobPayloadBytes: total }], undefined];
      }
      return [[], undefined];
    },
    async transaction<T>(fn: (tx: CrmDatabase) => Promise<T>): Promise<T> {
      const backup = snapshotTables();
      try {
        return await fn(dbApi as unknown as CrmDatabase);
      } catch (err) {
        tables.clear();
        for (const [k, rows] of backup.entries()) tables.set(k, rows);
        throw err;
      }
    },
  };

  return dbApi as unknown as CrmDatabase & typeof dbApi;
}

function seedOwnerDealAndPayments(
  db: ReturnType<typeof createHardeningRelationalDb>,
  ownerId: string,
  suffix: string,
) {
  const nowUtc = "2026-11-12 01:00:00.000";
  const leadId = `lead_${suffix}`;
  const dealId = `deal_${suffix}`;
  const payment1Id = `pay_${suffix}_1`;
  const payment2Id = `pay_${suffix}_2`;

  db.seed(dbSchema.crmLeads, [
    {
      id: leadId,
      ownerUserId: ownerId,
      name: `Synthetic Client ${suffix}`,
      phone: `+91990000${suffix.slice(0, 4).padEnd(4, "0")}`,
      normalizedPhone: `91990000${suffix.slice(0, 4).padEnd(4, "0")}`,
      email: `client.${suffix}@example.test`,
      company: "Synthetic Co",
      city: "Mumbai",
      source: "Website",
      stage: "Won",
      dealValue: "100000.00",
      expectedCloseDate: "2026-11-30",
      tagsJson: "[]",
      notes: "",
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
      deletedAt: null,
    },
  ]);

  db.seed(dbSchema.crmDeals, [
    {
      id: dealId,
      ownerUserId: ownerId,
      leadId,
      clientType: "lead",
      clientName: `Synthetic Client ${suffix}`,
      company: "Synthetic Co",
      phone: `+91990000${suffix.slice(0, 4).padEnd(4, "0")}`,
      name: `Synthetic Deal ${suffix}`,
      quotedAmount: "100000.00",
      finalAmount: "100000.00",
      status: "active",
      dueDate: "2026-11-30",
      wonAt: nowUtc,
      wonIstDate: "2026-11-12",
      createdByUserId: ownerId,
      updatedByUserId: ownerId,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    },
  ]);

  db.seed(dbSchema.crmPayments, [
    {
      id: payment1Id,
      ownerUserId: ownerId,
      dealId,
      amount: "20000.00",
      paymentIstDate: "2026-11-12",
      method: "UPI",
      paymentType: "advance",
      reference: `REF-${suffix}-1`,
      notes: null,
      status: "posted",
      voided: false,
      voidedAt: null,
      voidedIstDate: null,
      voidedByUserId: null,
      voidReason: null,
      recordedByUserId: ownerId,
      updatedByUserId: ownerId,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    },
    {
      id: payment2Id,
      ownerUserId: ownerId,
      dealId,
      amount: "20000.00",
      paymentIstDate: "2026-11-12",
      method: "Bank Transfer",
      paymentType: "installment",
      reference: `REF-${suffix}-2`,
      notes: null,
      status: "posted",
      voided: false,
      voidedAt: null,
      voidedIstDate: null,
      voidedByUserId: null,
      voidReason: null,
      recordedByUserId: ownerId,
      updatedByUserId: ownerId,
      version: 1,
      createdAt: nowUtc,
      updatedAt: nowUtc,
    },
  ]);

  return { leadId, dealId, payment1Id, payment2Id };
}

describe("Checkpoint B11C-LAUNCH-HARDENING — Quota, Cron Reliability & Encrypted Off-Site Backups", () => {
  const testEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_URL: "mysql://hardening_user:secret_pass_value@127.0.0.1:3306/crm_hardening_test",
    SESSION_COOKIE_NAME: "sf_session",
    PROOF_STORAGE_DRIVER: "mariadb-blob",
    PROOF_PRODUCTION_DURABLE_CONFIRMED: "false",
    MARIADB_QUOTA_MIB: "3072",
    MARIADB_WARNING_MIB: "1536",
    MARIADB_HARD_STOP_MIB: "2150",
    MARIADB_CAPACITY_SAFETY_MARGIN_MIB: "16",
  });

  const ownerA = {
    id: "usr_owner_a",
    email: "owner.a@example.test",
    name: "Owner A",
    roleId: "owner" as const,
    status: "active" as const,
    sessionId: "sess_owner_a",
  };
  const ownerB = {
    id: "usr_owner_b",
    email: "owner.b@example.test",
    name: "Owner B",
    roleId: "owner" as const,
    status: "active" as const,
    sessionId: "sess_owner_b",
  };

  let tmpDirs: string[] = [];

  beforeEach(() => {
    authMocks.activeDb = null;
    authMocks.resolveSession = null;
  });

  afterEach(() => {
    authMocks.activeDb = null;
    authMocks.resolveSession = null;
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  describe("Phase 2 — Database Capacity Limit Enforcement & Concurrency", () => {
    it("1-4. permits low/sub-50% uploads cleanly, warns at >=50% (1,536 MiB), and tracks safety margin + lag", async () => {
      const db = createHardeningRelationalDb({
        baseNonBlobInfoSchemaBytes: 20 * MIB_BYTES,
        simulateInfoSchemaLagOnBlobs: true,
      });
      const { payment1Id, payment2Id } = seedOwnerDealAndPayments(db, ownerA.id, "p2a");
      const events: MariadbCapacityLogEvent[] = [];
      const storage = new MariadbBlobProofStorage({
        db,
        env: testEnv,
        onCapacityEvent: (e) => events.push(e),
      });

      // Scenario 1: Low usage (~36 MiB effective) -> succeeds with zero warnings
      const smallPdf = buildValidPdfExactSize(64 * 1024);
      const r1 = await attachPaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        payment1Id,
        {
          originalFileName: "low.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: smallPdf,
        },
        { storageBackend: storage },
      );
      expect(r1.status).toBe(201);
      expect(events).toHaveLength(0);

      // Scenario 2 & 3: Just below 50% vs crossing 50% (1,536 MiB)
      db.setBaseNonBlobBytes(1522 * MIB_BYTES); // + 16 MiB margin = 1538 MiB (>= 1536 warning!)
      const r2 = await attachPaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        payment2Id,
        {
          originalFileName: "warn.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: smallPdf,
        },
        { storageBackend: storage },
      );
      expect(r2.status).toBe(201);
      expect(events.some((e) => e.event === "storage_capacity_warning")).toBe(true);
      const warnEvent = events.find((e) => e.event === "storage_capacity_warning")!;
      // Ensure zero secrets leaked into log event
      const serialized = JSON.stringify(warnEvent);
      expect(serialized).not.toContain("secret_pass_value");
      expect(serialized).not.toContain("mysql://");
    });

    it("5-6. allows just under 70% hard stop (2,150 MiB) and fails closed (507) cleanly at/above 70% with zero orphan blobs", async () => {
      const db = createHardeningRelationalDb({
        baseNonBlobInfoSchemaBytes: 2123 * MIB_BYTES, // + 16 MiB margin = 2,139 MiB (11 MiB remaining!)
        simulateInfoSchemaLagOnBlobs: true,
      });
      const { payment1Id, payment2Id } = seedOwnerDealAndPayments(db, ownerA.id, "p2b");
      const events: MariadbCapacityLogEvent[] = [];
      const storage = new MariadbBlobProofStorage({
        db,
        env: testEnv,
        onCapacityEvent: (e) => events.push(e),
      });

      // Scenario 4: Just under 70% (2 MiB -> ~2.13 MiB growth => ~2,141.13 MiB < 2,150 MiB) succeeds
      const pdf2MiB = buildValidPdfExactSize(2 * MIB_BYTES);
      const okRes = await attachPaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        payment1Id,
        {
          originalFileName: "under-cap.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: pdf2MiB,
        },
        { storageBackend: storage },
      );
      expect(okRes.status).toBe(201);

      const blobsBeforeReject = (db.tables.get("crm_payment_proof_blobs") ?? []).length;
      const proofsBeforeReject = (db.tables.get("crm_payment_proofs") ?? []).length;

      // Scenario 5: Next 10 MiB crosses >= 2,150 MiB -> blocked (507), zero orphan chunks
      await expect(
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment2Id,
          {
            originalFileName: "over-cap.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: buildValidPdfExactSize(10 * MIB_BYTES),
          },
          { storageBackend: storage },
        ),
      ).rejects.toMatchObject({ status: 507, code: "storage_quota_exceeded" });

      // Scenario 6: Push base usage already >= 2,150 MiB -> even tiny 16 KiB upload rejected
      db.setBaseNonBlobBytes(2140 * MIB_BYTES); // + 16 margin = 2,156 MiB >= 2,150
      await expect(
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment2Id,
          {
            originalFileName: "tiny-at-cap.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: buildValidPdfExactSize(16 * 1024),
          },
          { storageBackend: storage },
        ),
      ).rejects.toMatchObject({ status: 507, code: "storage_quota_exceeded" });

      expect((db.tables.get("crm_payment_proof_blobs") ?? []).length).toBe(blobsBeforeReject);
      expect((db.tables.get("crm_payment_proofs") ?? []).length).toBe(proofsBeforeReject);
      expect(events.some((e) => e.event === "storage_quota_hard_stop")).toBe(true);
    });

    it("7. serializes concurrent competing uploads near 70% so both cannot bypass quota", async () => {
      // Base 2,129 MiB + 16 MiB margin = 2,145 MiB effective => only ~5 MiB headroom left before 2,150 MiB!
      const db = createHardeningRelationalDb({
        baseNonBlobInfoSchemaBytes: 2129 * MIB_BYTES,
        simulateInfoSchemaLagOnBlobs: true, // proves zero-lag chunk sum prevents race even under INFORMATION_SCHEMA lag!
        asyncTickMs: 8,
      });
      const { payment1Id, payment2Id } = seedOwnerDealAndPayments(db, ownerA.id, "race");
      const storage = new MariadbBlobProofStorage({ db, env: testEnv });

      const pdf3MiB = buildValidPdfExactSize(3 * MIB_BYTES); // ~3.19 MiB each: ONE fits (2,148.19 < 2,150), TWO breach (2,151.38 >= 2,150)!
      const results = await Promise.allSettled([
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment1Id,
          {
            originalFileName: "race-1.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: pdf3MiB,
          },
          { storageBackend: storage },
        ),
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment2Id,
          {
            originalFileName: "race-2.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: pdf3MiB,
          },
          { storageBackend: storage },
        ),
      ]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 507,
        code: "storage_quota_exceeded",
      });

      // Exactly 1 proof & 3 chunks (never partial/orphan chunks from second concurrent upload)
      expect(db.tables.get("crm_payment_proofs") ?? []).toHaveLength(1);
      expect(db.tables.get("crm_payment_proof_blobs") ?? []).toHaveLength(3);
      const usageAfter = await measureMariadbCapacityFromDb(db, { env: testEnv });
      expect(usageAfter.effectiveUsedMiB).toBeLessThan(2150);
    });

    it("8-9. handles replacements by actual net growth (smaller allowed under headroom, oversized blocked cleanly, historical downloadable)", async () => {
      const db = createHardeningRelationalDb({
        baseNonBlobInfoSchemaBytes: 2124 * MIB_BYTES, // + 16 margin = 2,140 MiB
        simulateInfoSchemaLagOnBlobs: true,
      });
      const { payment1Id } = seedOwnerDealAndPayments(db, ownerA.id, "rep");
      const storage = new MariadbBlobProofStorage({ db, env: testEnv });

      const initial4MiB = buildValidPdfExactSize(4 * MIB_BYTES);
      const firstAttach = await attachPaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        payment1Id,
        {
          originalFileName: "v1.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: initial4MiB,
        },
        { storageBackend: storage },
      );
      // Effective usage is now ~2,144.25 MiB (~5.75 MiB remaining before 2,150 MiB).

      // Scenario 8: Lower net-growth replacement (512 KiB < remaining 5.75 MiB) succeeds!
      const smallV2 = buildValidPdfExactSize(512 * 1024);
      const repOk = await replacePaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        payment1Id,
        {
          originalFileName: "v2-small.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: smallV2,
        },
        { reason: "Clearer compressed receipt" },
        { storageBackend: storage },
      );
      expect(repOk.status).toBe(200);

      // Pure non-retained delta check too (explicit retainHistoricalBlobs: false => netGrowth = 0 when replacing larger with smaller)
      const nonRetainedDelta = estimateProofGrowthBytes({
        incomingBytes: 512 * 1024,
        existingProofBytes: 4 * MIB_BYTES,
        retainHistoricalBlobs: false,
      });
      expect(nonRetainedDelta.netGrowthBytes).toBe(0);

      // Scenario 9: Higher net-growth replacement (8 MiB exceeds remaining headroom) rejected cleanly!
      const largeV3 = buildValidPdfExactSize(8 * MIB_BYTES);
      await expect(
        replacePaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment1Id,
          {
            originalFileName: "v3-huge.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: largeV3,
          },
          { reason: "Too large scan" },
          { storageBackend: storage },
        ),
      ).rejects.toMatchObject({ status: 507, code: "storage_quota_exceeded" });

      // Existing active (v2) AND historical (v1) remain intact & downloadable!
      const active = await getActivePaymentProof(db, ownerA.id, payment1Id);
      expect(active?.id).toBe(repOk.body.proof.id);
      const dlActive = await readPaymentProofContent(db, ownerA.id, payment1Id, {
        storageBackend: storage,
      });
      expect((await readableToBuffer(dlActive.stream)).equals(smallV2)).toBe(true);
      const dlHistory = await readPaymentProofContent(db, ownerA.id, payment1Id, {
        proofId: firstAttach.body.proof.id,
        storageBackend: storage,
      });
      expect((await readableToBuffer(dlHistory.stream)).equals(initial4MiB)).toBe(true);
    });

    it("10. fails closed (503 storage_capacity_unavailable) on query errors, corrupt/null/empty metrics, or GET_LOCK failure", async () => {
      const db = createHardeningRelationalDb({ baseNonBlobInfoSchemaBytes: 10 * MIB_BYTES });
      const { payment1Id } = seedOwnerDealAndPayments(db, ownerA.id, "fc");
      const storage = new MariadbBlobProofStorage({ db, env: testEnv });
      const pdf = buildValidPdfExactSize(16 * 1024);

      db.setFailureMode({ failCapacityQuery: true });
      await expect(
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment1Id,
          { originalFileName: "fc1.pdf", declaredMimeType: "application/pdf", streamOrBuffer: pdf },
          { storageBackend: storage },
        ),
      ).rejects.toMatchObject({ status: 503, code: "storage_capacity_unavailable" });

      db.setFailureMode({ failCapacityQuery: false, corruptCapacityValue: "NaN" });
      await expect(measureMariadbCapacityFromDb(db, { env: testEnv })).rejects.toMatchObject({
        status: 503,
        code: "storage_capacity_unavailable",
      });

      db.setFailureMode({ corruptCapacityValue: "empty_tables" });
      await expect(measureMariadbCapacityFromDb(db, { env: testEnv })).rejects.toMatchObject({
        status: 503,
        code: "storage_capacity_unavailable",
      });

      db.setFailureMode({ corruptCapacityValue: "null" });
      await expect(measureMariadbCapacityFromDb(db, { env: testEnv })).rejects.toMatchObject({
        status: 503,
        code: "storage_capacity_unavailable",
      });

      db.setFailureMode({ corruptCapacityValue: undefined, failGetLock: true });
      await expect(
        attachPaymentProofRecord(
          db,
          ownerA.id,
          ownerA.id,
          payment1Id,
          {
            originalFileName: "lock-fail.pdf",
            declaredMimeType: "application/pdf",
            streamOrBuffer: pdf,
          },
          { storageBackend: storage },
        ),
      ).rejects.toMatchObject({ status: 503, code: "storage_capacity_unavailable" });

      expect(db.tables.get("crm_payment_proof_blobs") ?? []).toHaveLength(0);
    });

    it("11-14. preserves downloads & payment/deal records at 70%+, isolates owners, and surfaces HTTP 507 + UI message", async () => {
      const db = createHardeningRelationalDb({ baseNonBlobInfoSchemaBytes: 20 * MIB_BYTES });
      const seedA = seedOwnerDealAndPayments(db, ownerA.id, "httpa");
      seedOwnerDealAndPayments(db, ownerB.id, "httpb");
      authMocks.activeDb = db;
      let activeUser = ownerA;
      authMocks.resolveSession = async () => ({ status: "authenticated", user: activeUser });

      const storage = new MariadbBlobProofStorage({ db, env: testEnv });
      const validPdf = buildValidPdfExactSize(128 * 1024);

      // Attach valid proof before cap hits
      const attached = await attachPaymentProofRecord(
        db,
        ownerA.id,
        ownerA.id,
        seedA.payment1Id,
        {
          originalFileName: "existing.pdf",
          declaredMimeType: "application/pdf",
          streamOrBuffer: validPdf,
        },
        { storageBackend: storage },
      );

      // Push DB over 70% hard stop (2,200 MiB)
      db.setBaseNonBlobBytes(2200 * MIB_BYTES);

      // Scenario 11: Downloading existing proof STILL succeeds at 70%+!
      const dlReq = new Request(
        `http://127.0.0.1:3000/api/v1/payments/${seedA.payment1Id}/proof/download`,
        { method: "GET", headers: { cookie: "sf_session=tok_a" } },
      );
      const dlRes = await handleCrmApiRequest(
        dlReq,
        `/api/v1/payments/${seedA.payment1Id}/proof/download`,
        testEnv,
      );
      if (!dlRes) throw new Error("Expected dlRes Response");
      expect(dlRes.status).toBe(200);
      const dlBytes = Buffer.from(await dlRes.arrayBuffer());
      expect(dlBytes.equals(validPdf)).toBe(true);

      // Scenario 12: Payment creation still succeeds and rejected upload does not alter deal paid/collected totals
      const summaryBefore = await listPaymentsForDeal(db, ownerA.id, seedA.dealId, {
        includeVoided: false,
        method: "all",
        type: "all",
        limit: 50,
        offset: 0,
      });
      expect(summaryBefore.dealSummary.collected).toBe(40000);
      const newPay = await createPaymentRecord(db, ownerA.id, ownerA.id, seedA.dealId, {
        amount: "5000.00",
        date: "2026-11-12",
        method: "UPI",
        type: "milestone",
      });
      expect(newPay.status).toBe(201);
      expect(newPay.body.dealSummary.collected).toBe(45000);
      expect(newPay.body.dealSummary.outstanding).toBe(55000);

      // Scenario 13: Real HTTP POST /proof returns HTTP 507 & client financeApi + formatApiErrorMessage format clear UI guidance
      const boundary = "B11cLaunchBoundary";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "blocked.pdf",
        fileMimeType: "application/pdf",
        fileBytes: validPdf,
      });
      const uploadReq = new Request(
        `http://127.0.0.1:3000/api/v1/payments/${seedA.payment2Id}/proof`,
        {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3000",
            cookie: "sf_session=tok_a",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          body: new Uint8Array(body),
        },
      );
      const httpRes = await handleCrmApiRequest(
        uploadReq,
        `/api/v1/payments/${seedA.payment2Id}/proof`,
        testEnv,
      );
      if (!httpRes) throw new Error("Expected httpRes Response");
      expect(httpRes.status).toBe(507);
      const cloneForClient = httpRes.clone();
      const jsonBody = (await httpRes.json()) as {
        ok: boolean;
        error: { code: string; details?: Record<string, unknown> };
      };
      expect(jsonBody.ok).toBe(false);
      expect(jsonBody.error.code).toBe("storage_quota_exceeded");
      expect(Number(jsonBody.error.details?.["quotaMiB"])).toBe(3072);

      // Exercise real financeApi uploadPaymentProof/replacePaymentProof error handling against this HTTP 507
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => cloneForClient),
      );
      let clientErr: unknown;
      try {
        await uploadPaymentProof({
          paymentId: seedA.payment2Id,
          file: new Blob([new Uint8Array(validPdf)], { type: "application/pdf" }),
          originalFileName: "blocked.pdf",
        });
      } catch (e) {
        clientErr = e;
      }
      expect(clientErr).toBeTruthy();
      const uiMessage = formatApiErrorMessage(clientErr);
      expect(uiMessage).toContain("Payment proof storage limit reached");
      expect(uiMessage).toContain("3072 MiB");

      // Also verify replacePaymentProof parses ApiError details cleanly
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(jsonBody), { status: 507 })),
      );
      await expect(
        replacePaymentProof({
          paymentId: seedA.payment1Id,
          file: new Blob([new Uint8Array(validPdf)], { type: "application/pdf" }),
          originalFileName: "blocked-replace.pdf",
        }),
      ).rejects.toMatchObject({ status: 507, code: "storage_quota_exceeded" });

      // Deal balance unaffected by failed proof upload
      const summaryAfterReject = await listPaymentsForDeal(db, ownerA.id, seedA.dealId, {
        includeVoided: false,
        method: "all",
        type: "all",
        limit: 50,
        offset: 0,
      });
      expect(summaryAfterReject.dealSummary.collected).toBe(45000);
      expect(summaryAfterReject.dealSummary.outstanding).toBe(55000);

      // Removal of proof record STILL works cleanly at 70%+
      const removed = await removePaymentProofRecord(db, ownerA.id, ownerA.id, seedA.payment1Id, {
        reason: "Cleanup request",
      });
      expect(removed.status).toBe(200);
      expect(removed.body.proof.id).toBe(attached.body.proof.id);

      // Scenario 14: Cross-owner isolation preserved under capacity limit
      activeUser = ownerB;
      const crossOwnerDl = await handleCrmApiRequest(
        new Request(`http://127.0.0.1:3000/api/v1/payments/${seedA.payment1Id}/proof/download`, {
          method: "GET",
          headers: { cookie: "sf_session=tok_b" },
        }),
        `/api/v1/payments/${seedA.payment1Id}/proof/download`,
        testEnv,
      );
      if (!crossOwnerDl) throw new Error("Expected crossOwnerDl Response");
      expect(crossOwnerDl.status).toBe(404);
    });
  });

  describe("Phase 3 — Hostinger Cron Command Reliability & Secure Relative .env Loading", () => {
    it("1-2. builds verified /usr/bin/node shell-operator-free commands well under 255 chars", () => {
      const stg = buildHostingerCronCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
        nodeMajor: "22",
      });
      const cli = buildHostingerCliCommand({
        username: "u256504187",
        domain: "khaki-butterfly-345144.hostingersite.com",
        nodeMajor: "22",
      });

      expect(stg.command).toBe(cli.command);
      expect(stg.nodeBinary).toBe("/opt/alt/alt-nodejs22/root/usr/bin/node");
      expect(stg.command.startsWith("/opt/alt/alt-nodejs22/root/usr/bin/node ")).toBe(true);
      expect(stg.usesShellOperators).toBe(false);
      expect(stg.autoDiscoversEnv).toBe(true);
      expect(stg.command).not.toMatch(/&&|\|\||[;|&><`$]/);
      expect(stg.length).toBeLessThan(200);
      expect(stg.fitsHostinger255Limit).toBe(true);

      // Long custom domain + --owner still fits < 255 chars cleanly!
      const custom = buildHostingerCronCommand({
        username: "u256504187",
        domain: "crm-production-portal.scaleflowagency-enterprise.in",
        args: ["--dry-run", "--owner=usr_owner_main_1"],
      });
      expect(custom.fitsHostinger255Limit).toBe(true);
      expect(custom.length).toBeLessThanOrEqual(HOSTINGER_CRON_MAX_COMMAND_CHARS);
    });

    it("3-4 & 8. resolves ../../../config/.env automatically across release layout regardless of cwd & never leaks secrets", () => {
      const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cron-rel-"));
      tmpDirs.push(workRoot);

      const hbuilds = path.join(workRoot, "hbuilds");
      const releaseServerDir = path.join(hbuilds, "rel-uuid-001", "nodejs", "server");
      const configDir = path.join(hbuilds, "config");
      fs.mkdirSync(releaseServerDir, { recursive: true });
      fs.mkdirSync(configDir, { recursive: true });

      const dummyScript = path.join(releaseServerDir, "run-cron.mjs");
      fs.copyFileSync(path.resolve(process.cwd(), "scripts/run-automation-cron.mjs"), dummyScript);

      const secretPass = "SuperSecretDbPass_DoNotPrint_99182";
      const secretAuth = "UltraSecretAuthTokenValue_DoNotPrint_7721";
      fs.writeFileSync(
        path.join(configDir, ".env"),
        [
          "NODE_ENV=development",
          "DB_HOST=127.0.0.1",
          "DB_NAME=u256504187_crm_stg",
          "DB_USER=u256504187_crm_user",
          `DB_PASSWORD=${secretPass}`,
          `AUTH_SECRET=${secretAuth}`,
        ].join("\n"),
        { encoding: "utf8", mode: 0o600 },
      );

      // Direct load test independent of cwd
      const sandboxEnv: Record<string, string | undefined> = {};
      const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "sf-unrelated-cwd-"));
      tmpDirs.push(unrelatedCwd);

      const loaded = resolveAndLoadCronEnv({
        scriptFilePath: dummyScript,
        cwd: unrelatedCwd,
        targetEnv: sandboxEnv,
        requireEnvFile: true,
      });
      expect(loaded.loaded).toBe(true);
      expect(loaded.source).toBe("auto_discovered_env_file");
      expect(sandboxEnv["DB_NAME"]).toBe("u256504187_crm_stg");
      expect(sandboxEnv["DB_PASSWORD"]).toBe(secretPass);

      // Live subprocess test without --env-file using copied script + unrelated cwd!
      const cleanEnv: Record<string, string> = {
        PATH: process.env["PATH"] ?? "",
        SystemRoot: process.env["SystemRoot"] ?? "",
        COMSPEC: process.env["COMSPEC"] ?? "",
      };
      const out = execFileSync(process.execPath, [dummyScript, "--verify-config"], {
        cwd: unrelatedCwd,
        env: cleanEnv,
        encoding: "utf8",
      });
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed["ok"]).toBe(true);
      expect(parsed["mode"]).toBe("verify_config");
      expect(parsed["envSource"]).toBe("auto_discovered_env_file");
      expect(parsed["outboundDeliveryGuaranteedDisabled"]).toBe(true);
      expect(out).not.toContain(secretPass);
      expect(out).not.toContain(secretAuth);
    });

    it("5-7. fails closed on missing/invalid/untrusted/world-writable/wrong-uid env files", () => {
      const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cron-neg-"));
      tmpDirs.push(workRoot);

      // Missing env file in isolated subprocess exits non-zero with explicit JSON code (never empty stdout/stderr)
      const isolatedScript = path.join(workRoot, "run-cron.mjs");
      fs.copyFileSync(
        path.resolve(process.cwd(), "scripts/run-automation-cron.mjs"),
        isolatedScript,
      );
      let failed = false;
      let errOutput = "";
      try {
        execFileSync(process.execPath, [isolatedScript, "--verify-config"], {
          cwd: workRoot,
          env: { PATH: process.env["PATH"] ?? "" },
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (e: unknown) {
        failed = true;
        errOutput = String((e as { stderr?: string }).stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(errOutput).toContain("env_file_missing");

      // Invalid syntax & NUL byte detection
      expect(() => parseDotEnvSafely("GOOD=1\nMALFORMED LINE WITHOUT EQUALS\n")).toThrow();
      expect(() => parseDotEnvSafely("DB_PASSWORD=abc\0def")).toThrow();
      expect(() => parseDotEnvSafely("NODE_ENV=bogus_env")).toThrow();

      // Security checks: public webroot, symlink, world-writable (POSIX), wrong uid (POSIX)
      expect(
        assessEnvStatSecurity(
          { mode: 0o100600, uid: 1000, isFile: () => true, isSymbolicLink: () => false },
          "/home/u256504187/domains/example.com/public_html/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(false);

      expect(
        assessEnvStatSecurity(
          { mode: 0o100600, uid: 1000, isFile: () => true, isSymbolicLink: () => true },
          "/home/u256504187/domains/example.com/hbuilds/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(false);

      expect(
        assessEnvStatSecurity(
          { mode: 0o100666, uid: 1000, isFile: () => true, isSymbolicLink: () => false },
          "/home/u256504187/domains/example.com/hbuilds/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(false);

      expect(
        assessEnvStatSecurity(
          { mode: 0o100600, uid: 2000, isFile: () => true, isSymbolicLink: () => false },
          "/home/u256504187/domains/example.com/hbuilds/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(false);

      expect(
        assessEnvStatSecurity(
          { mode: 0o100600, uid: 1000, isFile: () => true, isSymbolicLink: () => false },
          "/home/u256504187/domains/example.com/hbuilds/config/.env",
          { platform: "linux", currentUid: 1000 },
        ).ok,
      ).toBe(true);
    });

    it("9-10. preserves UTC/IST buckets across rollover, enforces advisory lock, and blocks unattended production mutations", async () => {
      const utcRollover = new Date("2026-11-11T19:07:30.000Z"); // 2026-11-12 00:37:30 IST
      const jsBuckets = computeCronBucketsJs(utcRollover, 15);
      const srvBuckets = computeCronWindowContext(utcRollover, 15);
      expect(jsBuckets.utcBucketKey).toBe(srvBuckets.utcBucketKey);
      expect(jsBuckets.istBucketKey).toBe(srvBuckets.istBucketKey);

      const db = createHardeningRelationalDb();
      const lockSkip = await runAutomationCronTick(db, {
        dryRun: true,
        now: utcRollover,
        acquireLock: async () => false,
      });
      expect(lockSkip.lockAcquired).toBe(false);
      expect(lockSkip.outboundDeliveryGuaranteedDisabled).toBe(true);

      await expect(
        runAutomationCronTick(db, {
          dryRun: false,
          allowExecution: true,
          env: parseServerEnv({
            NODE_ENV: "production",
            DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/crm_prod",
          }),
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("Phases 4 & 5 — Age v1 Encrypted Backups, Clean-Target Restore Safety & Watchdog", () => {
    it("1-3 & 7. generates offline keypairs, blocks secret keys on producer, encrypts/decrypts multi-chunk STREAM round-trip, and wipes plaintext temp dirs", async () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-age-rt-"));
      tmpDirs.push(workDir);

      const pair = generateAgeX25519KeyPair();
      expect(pair.publicKey).toMatch(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/);
      expect(pair.secretKey).toMatch(/^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/);

      // Hosting/producer env MUST reject storing decryption secret keys
      expect(() =>
        assertBackupProducerEnvHasNoPrivateKey({ BACKUP_AGE_SECRET_KEY: pair.secretKey }),
      ).toThrow();
      expect(() =>
        assertBackupProducerEnvHasNoPrivateKey({ BACKUP_AGE_PUBLIC_KEY: pair.publicKey }),
      ).not.toThrow();

      // Webroot & build path rejection
      expect(() => assertSafeBackupFilePath("/home/user/public_html/dump.sql.gz.age")).toThrow();
      expect(() => assertSafeBackupFilePath("/home/user/hbuilds/current/dump.sql")).toThrow();

      // Multi-chunk SQL (> 192 KiB so STREAM exercises chunk 0, 1, 2 + final flag) + binary hex BLOBs
      const sqlPath = path.join(workDir, "synthetic.sql");
      const manifestPath = path.join(workDir, "synthetic.manifest.json");
      const repeatedRow = Array.from(
        { length: 800 },
        (_, i) =>
          `INSERT INTO \`crm_payment_proof_blobs\` VALUES ('pb_${i}','usr_a','prf_${i}.pdf',0,1,4,4,'abcd','application/pdf',0x25504446,'2026-11-12 01:00:00.000');`,
      ).join("\n");
      const sqlContent = `SET NAMES utf8mb4;\nCREATE TABLE \`crm_payment_proof_blobs\` (id VARCHAR(64));\n${repeatedRow}\n`;
      fs.writeFileSync(sqlPath, sqlContent, "utf8");
      const sqlSha256 = crypto.createHash("sha256").update(sqlContent, "utf8").digest("hex");

      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          formatVersion: "1.0",
          sourceDatabase: "u256504187_crm_b11c_stg",
          tableCount: 49,
          totalRows: 800,
          proofCount: 23,
          proofBlobChunkCount: 800,
          dumpFileBytes: Buffer.byteLength(sqlContent, "utf8"),
          dumpSha256: sqlSha256,
        }),
        "utf8",
      );

      const stagingRoot = path.join(workDir, "staging");
      fs.mkdirSync(stagingRoot, { recursive: true });
      const outAgePath = path.join(workDir, "offsite", "crm-v2-daily.sql.gz.age");

      const packaged = await packageEncryptedBackupBundle({
        sqlPath,
        manifestPath,
        outAgePath,
        recipientPublicKey: pair.publicKey,
        stagingRoot,
        env: { BACKUP_AGE_PUBLIC_KEY: pair.publicKey },
      });

      // Ciphertext format starts with age-encryption.org/v1 & exposes ZERO plaintext SQL
      const encRaw = fs.readFileSync(packaged.outAgePath);
      expect(encRaw.subarray(0, 21).toString("utf8")).toBe("age-encryption.org/v1");
      expect(encRaw.includes(Buffer.from("INSERT INTO"))).toBe(false);
      // Staging plaintext temp folder removed cleanly
      expect(fs.readdirSync(stagingRoot)).toHaveLength(0);

      // Decrypt & verify exact SQL byte-for-byte identity + statement splitter parity
      const decStaging = path.join(workDir, "dec-staging");
      fs.mkdirSync(decStaging, { recursive: true });
      let restoredSqlStatements = 0;
      await withDecryptedBackupBundle(
        { inAgePath: packaged.outAgePath, secretKey: pair.secretKey, stagingRoot: decStaging },
        async (ctx) => {
          expect(ctx.sqlSha256).toBe(sqlSha256);
          expect(ctx.manifest?.["tableCount"]).toBe(49);
          expect(ctx.manifest?.["proofCount"]).toBe(23);
          const restoredText = fs.readFileSync(ctx.sqlPath, "utf8");
          expect(restoredText).toBe(sqlContent);
          restoredSqlStatements = splitSqlStatements(restoredText).length;
        },
      );
      expect(restoredSqlStatements).toBe(802);
      // Decrypted temp files purged immediately after callback finishes
      expect(fs.readdirSync(decStaging)).toHaveLength(0);
    });

    it("4-6 & 8-9. rejects wrong key, bit-flip tampering, truncation, unsafe restore targets, and stale/corrupt backups in watchdog", async () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-age-sec-"));
      tmpDirs.push(workDir);

      const ownerKeys = generateAgeX25519KeyPair();
      const attackerKeys = generateAgeX25519KeyPair();

      const plainFile = path.join(workDir, "sample.bin");
      const ageFile = path.join(workDir, "offsite", "sample.sql.gz.age");
      const decOut = path.join(workDir, "dec.bin");
      fs.writeFileSync(plainFile, crypto.randomBytes(140 * 1024)); // spans 3 STREAM chunks

      await encryptFileWithAgeX25519({
        inputPath: plainFile,
        outputPath: ageFile,
        recipientPublicKey: ownerKeys.publicKey,
      });

      // Wrong key fails closed
      await expect(
        decryptFileWithAgeX25519({
          inputPath: ageFile,
          outputPath: decOut,
          secretKey: attackerKeys.secretKey,
        }),
      ).rejects.toThrow(/does not match any recipient/);

      // Bit-flip corruption in ciphertext fails Poly1305 check
      const tamperedFile = path.join(workDir, "tampered.age");
      const originalBytes = fs.readFileSync(ageFile);
      const flipped = Buffer.from(originalBytes);
      flipped[flipped.byteLength - 25]! ^= 0x01;
      fs.writeFileSync(tamperedFile, flipped);
      await expect(
        decryptFileWithAgeX25519({
          inputPath: tamperedFile,
          outputPath: decOut,
          secretKey: ownerKeys.secretKey,
        }),
      ).rejects.toThrow(/corrupted|tampered|auth|HMAC/i);

      // Truncated archive fails closed (dropping trailing chunk)
      const truncatedFile = path.join(workDir, "truncated.age");
      fs.writeFileSync(truncatedFile, originalBytes.subarray(0, originalBytes.byteLength - 512));
      await expect(
        decryptFileWithAgeX25519({
          inputPath: truncatedFile,
          outputPath: decOut,
          secretKey: ownerKeys.secretKey,
        }),
      ).rejects.toThrow();

      // Clean-target restore safety checks
      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst2",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: false,
        }),
      ).toThrow(/confirmCleanTarget/);

      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_v1_prod",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toThrow(/protected/);

      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst2",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: ["crm_leads"],
          confirmCleanTarget: true,
        }),
      ).toThrow(/NOT empty/);

      expect(
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst2",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }).ok,
      ).toBe(true);

      // Watchdog health tests: healthy -> stale -> manifest_mismatch -> missing
      const offsiteDir = path.join(workDir, "offsite");
      const metaSha = crypto.createHash("sha256").update(originalBytes).digest("hex");
      fs.writeFileSync(
        `${ageFile}.meta.json`,
        JSON.stringify({
          encryptedSha256: metaSha,
          createdAtUtc: new Date("2026-11-12T00:00:00.000Z").toISOString(),
        }),
      );

      const healthy = await evaluateEncryptedBackupHealth({
        backupDir: offsiteDir,
        now: new Date("2026-11-12T01:00:00.000Z"),
        maxAgeHours: 26,
      });
      expect(healthy.ok).toBe(true);
      expect(healthy.code).toBe("backup_healthy");

      const stale = await evaluateEncryptedBackupHealth({
        backupDir: offsiteDir,
        now: new Date("2026-11-14T00:00:00.000Z"),
        maxAgeHours: 26,
      });
      expect(stale.ok).toBe(false);
      expect(stale.code).toBe("backup_stale");

      // Corrupt archive detected by companion SHA mismatch
      fs.writeFileSync(ageFile, flipped);
      const mismatched = await evaluateEncryptedBackupHealth({
        backupDir: offsiteDir,
        now: new Date("2026-11-12T01:00:00.000Z"),
      });
      expect(mismatched.ok).toBe(false);
      expect(mismatched.code).toBe("manifest_mismatch");

      const missing = await evaluateEncryptedBackupHealth({
        backupDir: path.join(workDir, "missing-dir"),
      });
      expect(missing.ok).toBe(false);
      expect(missing.code).toBe("backup_missing");
    });

    it("10. validates bidirectional interoperability with standard age CLI (v1.3.2) when available", async () => {
      const candidates = [
        "C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/age/age/age.exe",
        "age.exe",
        "age",
      ];
      let ageExePath: string | null = null;
      for (const cand of candidates) {
        try {
          if (cand.includes("/") || cand.includes("\\")) {
            if (fs.existsSync(cand)) {
              ageExePath = cand;
              break;
            }
          } else {
            execFileSync(cand, ["--version"], { stdio: "ignore" });
            ageExePath = cand;
            break;
          }
        } catch {
          // ignore candidate if missing or not executable
        }
      }

      if (!ageExePath) {
        // Skip if age CLI is not locally installed
        return;
      }

      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-age-cli-interop-"));
      tmpDirs.push(workDir);

      const pair = generateAgeX25519KeyPair();
      const plain = Buffer.from(
        "Scale Flow CRM v2: standard age CLI interoperability verification payload.\n" +
          "Ensuring RFC-compliant X25519 stanza + 64 KiB ChaCha20-Poly1305 STREAM interoperability.\n",
        "utf8",
      );
      const plainPath = path.join(workDir, "plain.txt");
      fs.writeFileSync(plainPath, plain);

      // A. Our Encrypt -> age.exe Decrypt
      const ourAgeFile = path.join(workDir, "our.age");
      await encryptFileWithAgeX25519({
        inputPath: plainPath,
        outputPath: ourAgeFile,
        recipientPublicKey: pair.publicKey,
      });

      const keyFile = path.join(workDir, "key.txt");
      fs.writeFileSync(keyFile, `${pair.secretKey}\n`, "utf8");

      const ageDecrypted = execFileSync(ageExePath, ["--decrypt", "-i", keyFile, ourAgeFile]);
      expect(ageDecrypted.equals(plain)).toBe(true);

      // B. age.exe Encrypt -> Our Decrypt
      const cliAgeFile = path.join(workDir, "cli.age");
      execFileSync(ageExePath, ["-r", pair.publicKey, "-o", cliAgeFile, plainPath]);

      const ourDecryptedPath = path.join(workDir, "our_dec.txt");
      await decryptFileWithAgeX25519({
        inputPath: cliAgeFile,
        outputPath: ourDecryptedPath,
        secretKey: pair.secretKey,
      });
      const ourDecrypted = fs.readFileSync(ourDecryptedPath);
      expect(ourDecrypted.equals(plain)).toBe(true);

      // C. Multi-chunk payload (192 KiB spanning 3 STREAM chunks)
      const multiChunkPlain = crypto.randomBytes(192 * 1024);
      const multiPlainPath = path.join(workDir, "multi.bin");
      fs.writeFileSync(multiPlainPath, multiChunkPlain);

      const multiAgePath = path.join(workDir, "multi.age");
      await encryptFileWithAgeX25519({
        inputPath: multiPlainPath,
        outputPath: multiAgePath,
        recipientPublicKey: pair.publicKey,
      });
      const multiDecrypted = execFileSync(ageExePath, ["--decrypt", "-i", keyFile, multiAgePath]);
      expect(multiDecrypted.equals(multiChunkPlain)).toBe(true);

      // D. Wrong-key rejection in age.exe
      const wrongPair = generateAgeX25519KeyPair();
      const wrongKeyFile = path.join(workDir, "wrong_key.txt");
      fs.writeFileSync(wrongKeyFile, `${wrongPair.secretKey}\n`, "utf8");
      expect(() => {
        execFileSync(ageExePath!, ["--decrypt", "-i", wrongKeyFile, ourAgeFile], { stdio: "pipe" });
      }).toThrow();

      // E. Tampered ciphertext rejection in age.exe
      const tamperedBytes = Buffer.from(fs.readFileSync(ourAgeFile));
      tamperedBytes[tamperedBytes.length - 10]! ^= 0x55;
      const tamperedAgePath = path.join(workDir, "tampered.age");
      fs.writeFileSync(tamperedAgePath, tamperedBytes);
      expect(() => {
        execFileSync(ageExePath!, ["--decrypt", "-i", keyFile, tamperedAgePath], { stdio: "pipe" });
      }).toThrow();
    });
  });
});
