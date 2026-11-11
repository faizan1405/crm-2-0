import crypto from "node:crypto";
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "./config/env.server";
import type { CrmDatabase } from "./db/index.server";
import * as dbSchema from "./db/schema.server";
import {
  handleCrmApiRequest,
  MAX_PROOF_BYTES,
  MAX_PROOF_MULTIPART_BODY_BYTES,
  MAX_PROOF_MULTIPART_OVERHEAD_BYTES,
  parseProofUploadRequest,
} from "./http/crmRoutes.server";
import { MARIADB_PROOF_CHUNK_BYTES } from "./storage/mariadbBlobProofStorage.server";
import {
  assertSafeRestoreTarget,
  encodeSqlValue,
  escapeMysqlString,
  evaluateMariadbStorageCapacity,
  splitSqlStatements,
} from "../../scripts/b11c-mariadb-backup.mjs";

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

function buildValidJpeg(extraBytes = 64): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20,
  ]);
  const filler = extraBytes > 0 ? Buffer.alloc(extraBytes, 0x42) : Buffer.alloc(0);
  return Buffer.concat([header, filler, Buffer.from([0xff, 0xd9])]);
}

function buildValidPdfExactSize(targetTotalBytes: number): Buffer {
  const prefix = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Note (B11C-QA) >>\nendobj\n%",
    "ascii",
  );
  const suffix = Buffer.from("\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "ascii");
  if (targetTotalBytes < prefix.length + suffix.length) {
    throw new Error(`targetTotalBytes ${targetTotalBytes} too small for valid PDF envelope`);
  }
  const padLen = targetTotalBytes - prefix.length - suffix.length;
  const padding = Buffer.alloc(padLen, 0x58); // 'X' inside PDF comment line
  const out = Buffer.concat([prefix, padding, suffix]);
  if (out.byteLength !== targetTotalBytes) {
    throw new Error(`Expected ${targetTotalBytes} bytes, got ${out.byteLength}`);
  }
  return out;
}

function buildManualMultipartBody(params: {
  boundary: string;
  fileName: string;
  fileMimeType: string;
  fileBytes: Buffer;
  extraFields?: Record<string, string>;
}): Buffer {
  const { boundary, fileName, fileMimeType, fileBytes, extraFields } = params;
  const chunks: Buffer[] = [];
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
          "utf8",
        ),
      );
    }
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${fileMimeType}\r\n\r\n`,
      "utf8",
    ),
  );
  chunks.push(fileBytes);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

/**
 * Self-contained Drizzle-compatible relational DB stub scoped strictly to this QA test suite.
 */
function createQaRelationalDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const colToPropByTable = new Map<string, Map<string, string>>();

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
      const nullMatch = /(?:`[^`]+`\.)?`([^`]+)`\s+is\s+null/i.exec(part);
      if (nullMatch) {
        const prop = resolveProp(tableName, nullMatch[1]!);
        if (row[prop] !== null && row[prop] !== undefined) return false;
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
          let limitCount: number | undefined;

          const execQuery = () => {
            let rows = (tables.get(tableName) ?? []).filter((r) =>
              evaluateWhere(r, tableName, whereClause),
            );
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
            if (!projection) return rows.map((r) => ({ ...r }));
            return rows.map((r) => {
              const out: Record<string, unknown> = {};
              for (const alias of Object.keys(projection)) {
                out[alias] = r[alias];
              }
              return out;
            });
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
            limit(n: number) {
              limitCount = n;
              return builder;
            },
            offset() {
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
              tables.get(tableName)!.push({ ...row });
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
            const kept: Record<string, unknown>[] = [];
            let deleted = 0;
            for (const row of list) {
              if (evaluateWhere(row, tableName, cond)) deleted++;
              else kept.push(row);
            }
            tables.set(tableName, kept);
            return [{ affectedRows: deleted }, undefined];
          };
          return {
            then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return Promise.resolve().then(runDelete).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
    async execute(queryObj: unknown): Promise<[Record<string, unknown>[], undefined]> {
      const sqlStr = DIALECT.sqlToQuery(
        queryObj as Parameters<typeof DIALECT.sqlToQuery>[0],
      ).sql;
      if (/GET_LOCK/i.test(sqlStr)) {
        return [[{ acquired: 1 }], undefined];
      }
      if (/RELEASE_LOCK/i.test(sqlStr)) {
        return [[{ released: 1 }], undefined];
      }
      if (/INFORMATION_SCHEMA\.TABLES/i.test(sqlStr)) {
        const blobRows = tables.get("crm_payment_proof_blobs") ?? [];
        let blobBytes = 0;
        for (const r of blobRows) {
          blobBytes += Number(r["chunkSize"] ?? r["chunk_size"] ?? 0);
        }
        return [
          [
            {
              tableName: "crm_payment_proofs",
              logicalBytes: (tables.get("crm_payment_proofs") ?? []).length * 1024 + 16384,
              dataFreeBytes: 0,
            },
            {
              tableName: "crm_payment_proof_blobs",
              logicalBytes: blobBytes,
              dataFreeBytes: 0,
            },
          ],
          undefined,
        ];
      }
      if (/crm_payment_proof_blobs/i.test(sqlStr)) {
        const blobRows = tables.get("crm_payment_proof_blobs") ?? [];
        let total = 0;
        for (const r of blobRows) {
          total += Number(r["chunkSize"] ?? r["chunk_size"] ?? 0);
        }
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
        for (const [k, rows] of backup.entries()) {
          tables.set(k, rows);
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

describe("Checkpoint B11C-BUSINESS-QA — 10 MiB Multipart Boundary, Backup Fidelity & Storage Policy", () => {
  const testEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_URL: "mysql://qa_user:qa_pass@127.0.0.1:3306/crm_qa_test",
    SESSION_COOKIE_NAME: "sf_session",
    SESSION_SECRET: "qa-test-secret-at-least-32-characters-long",
    PROOF_STORAGE_DRIVER: "mariadb-blob",
    PROOF_PRODUCTION_DURABLE_CONFIRMED: "false",
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

  let memDb: ReturnType<typeof createQaRelationalDb>;

  beforeEach(() => {
    memDb = createQaRelationalDb();
    memDb.seed(dbSchema.crmDeals, [
      {
        id: "deal_a_1",
        legacyId: null,
        ownerUserId: ownerA.id,
        leadId: null,
        title: "QA Deal A",
        service: "Performance",
        agreedAmount: "100000.00",
        collectedAmount: "25000.00",
        pendingAmount: "75000.00",
        status: "active",
        wonIstDate: "2026-11-10",
        notes: null,
        createdByUserId: ownerA.id,
        updatedByUserId: ownerA.id,
        version: 1,
        opId: null,
        idempotencyKey: null,
        createdAt: "2026-11-10 08:00:00",
        updatedAt: "2026-11-10 08:00:00",
      },
    ]);
    memDb.seed(dbSchema.crmPayments, [
      {
        id: "pay_a_1",
        legacyId: null,
        ownerUserId: ownerA.id,
        dealId: "deal_a_1",
        amount: "25000.00",
        paymentIstDate: "2026-11-10",
        paymentType: "advance",
        method: "upi",
        reference: "UPI-QA-001",
        notes: null,
        status: "received",
        voided: false,
        voidedAt: null,
        voidedIstDate: null,
        voidedByUserId: null,
        voidReason: null,
        recordedByUserId: ownerA.id,
        updatedByUserId: ownerA.id,
        version: 1,
        opId: null,
        idempotencyKey: null,
        createdAt: "2026-11-10 08:00:00",
        updatedAt: "2026-11-10 08:00:00",
      },
    ]);

    authMocks.activeDb = memDb;
    authMocks.resolveSession = async (token) => {
      if (token === "tok_owner_a") return { status: "authenticated", user: ownerA };
      if (token === "tok_owner_b") return { status: "authenticated", user: ownerB };
      return { status: "unauthenticated", reason: token ? "invalid" : "missing" };
    };
  });

  afterEach(() => {
    authMocks.activeDb = null;
    authMocks.resolveSession = null;
  });

  describe("1. Phase 2 — 10 Required Payment-Proof Upload Boundary & HTTP Regression Tests", () => {
    it("1) accepts a valid small JPEG upload via multipart/form-data (201) and downloads identical bytes", async () => {
      const jpeg = buildValidJpeg(128);
      const expectedSha = crypto.createHash("sha256").update(jpeg).digest("hex");
      const boundary = "----B11CQAJpegBoundary";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "small-receipt.jpg",
        fileMimeType: "image/jpeg",
        fileBytes: jpeg,
      });

      const req = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(201);
      const json = (await res!.json()) as {
        ok: boolean;
        proof: { sha256: string; fileSize: number; storageDriver: string };
      };
      expect(json.ok).toBe(true);
      expect(json.proof.storageDriver).toBe("mariadb-blob");
      expect(json.proof.fileSize).toBe(jpeg.byteLength);
      expect(json.proof.sha256).toBe(expectedSha);

      const dlReq = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof/download", {
        method: "GET",
        headers: { cookie: "sf_session=tok_owner_a" },
      });
      const dlRes = await handleCrmApiRequest(
        dlReq,
        "/api/v1/payments/pay_a_1/proof/download",
        testEnv,
      );
      expect(dlRes?.status).toBe(200);
      const downloaded = Buffer.from(await dlRes!.arrayBuffer());
      expect(downloaded.equals(jpeg)).toBe(true);
    });

    it("2) accepts a valid PDF upload via multipart/form-data (201) and downloads identical bytes", async () => {
      const pdf = buildValidPdfExactSize(4096);
      const expectedSha = crypto.createHash("sha256").update(pdf).digest("hex");
      const boundary = "----B11CQAPdfBoundary";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "invoice.pdf",
        fileMimeType: "application/pdf",
        fileBytes: pdf,
      });

      const req = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(201);
      const json = (await res!.json()) as { ok: boolean; proof: { sha256: string } };
      expect(json.ok).toBe(true);
      expect(json.proof.sha256).toBe(expectedSha);
    });

    it("3) accepts an EXACT 10 MiB (10,485,760 bytes) valid PDF in multipart/form-data even though Content-Length > 10 MiB, chunks into 10 MariaDB rows, and downloads byte-for-byte", async () => {
      expect(MAX_PROOF_BYTES).toBe(10 * 1024 * 1024);
      const exact10MiBPdf = buildValidPdfExactSize(MAX_PROOF_BYTES);
      const expectedSha = crypto.createHash("sha256").update(exact10MiBPdf).digest("hex");
      const boundary = "----B11CExact10MiB";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "exact-10mib.pdf",
        fileMimeType: "application/pdf",
        fileBytes: exact10MiBPdf,
      });

      // Crucial regression check: Content-Length is strictly > 10 MiB due to multipart boundaries
      expect(body.byteLength).toBeGreaterThan(MAX_PROOF_BYTES);
      expect(body.byteLength).toBeLessThanOrEqual(MAX_PROOF_MULTIPART_BODY_BYTES);

      const req = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(201);
      const json = (await res!.json()) as {
        ok: boolean;
        proof: { fileSize: number; sha256: string };
      };
      expect(json.ok).toBe(true);
      expect(json.proof.fileSize).toBe(MAX_PROOF_BYTES);
      expect(json.proof.sha256).toBe(expectedSha);

      // Verify MariaDB BLOB chunking: exact 10 MiB at 1 MiB chunking = 10 chunk rows
      const blobRows = memDb.tables.get("crm_payment_proof_blobs") ?? [];
      expect(blobRows).toHaveLength(10);
      for (const chunk of blobRows) {
        expect(Number(chunk["chunkSize"])).toBeLessThanOrEqual(MARIADB_PROOF_CHUNK_BYTES);
      }

      // Download back over HTTP and confirm byte-for-byte SHA-256 identity
      const dlReq = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof/download", {
        method: "GET",
        headers: { cookie: "sf_session=tok_owner_a" },
      });
      const dlRes = await handleCrmApiRequest(
        dlReq,
        "/api/v1/payments/pay_a_1/proof/download",
        testEnv,
      );
      expect(dlRes?.status).toBe(200);
      const dlBuf = Buffer.from(await dlRes!.arrayBuffer());
      expect(dlBuf.byteLength).toBe(MAX_PROOF_BYTES);
      expect(crypto.createHash("sha256").update(dlBuf).digest("hex")).toBe(expectedSha);
    });

    it("4) rejects 10 MiB + 1 byte (10,485,761 bytes) PDF with 400 file_too_large and leaves storage clean", async () => {
      const over1BytePdf = buildValidPdfExactSize(MAX_PROOF_BYTES + 1);
      const boundary = "----B11COverBy1Byte";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "over-1-byte.pdf",
        fileMimeType: "application/pdf",
        fileBytes: over1BytePdf,
      });

      const req = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(400);
      const json = (await res!.json()) as { ok: boolean; error: { code: string } };
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("file_too_large");
      expect(memDb.tables.get("crm_payment_proofs") ?? []).toHaveLength(0);
      expect(memDb.tables.get("crm_payment_proof_blobs") ?? []).toHaveLength(0);
    });

    it("5) accepts valid 10 MiB PDF with extra multipart overhead fields (reason, idempotencyKey, mimeType) pushing Content-Length > 10 MiB", async () => {
      const exact10MiBPdf = buildValidPdfExactSize(MAX_PROOF_BYTES);
      const boundary = "----B11CWithFields";
      const idemKey = "idem-10mib-multipart-overhead-1";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "10mib-with-fields.pdf",
        fileMimeType: "application/pdf",
        fileBytes: exact10MiBPdf,
        extraFields: {
          mimeType: "application/pdf",
          reason: "Reconciled UTR statement from corporate banking portal",
          idempotencyKey: idemKey,
        },
      });

      expect(body.byteLength).toBeGreaterThan(MAX_PROOF_BYTES);
      expect(MAX_PROOF_MULTIPART_OVERHEAD_BYTES).toBe(256 * 1024);

      const req = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "idempotency-key": idemKey,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(req, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(201);

      // Replace (PUT) flow also supports exact 10 MiB file + reason + expectedProofVersion overhead
      const replacementJpeg = buildValidJpeg(MAX_PROOF_BYTES - 48); // exact 10 MiB JPEG
      expect(replacementJpeg.byteLength).toBe(MAX_PROOF_BYTES);
      const putBody = buildManualMultipartBody({
        boundary: "----B11CPutExact10MiB",
        fileName: "replacement-10mib.jpg",
        fileMimeType: "image/jpeg",
        fileBytes: replacementJpeg,
        extraFields: {
          reason: "Higher resolution bank scan",
          expectedProofVersion: "1",
        },
      });
      const putReq = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "PUT",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": "multipart/form-data; boundary=----B11CPutExact10MiB",
          "content-length": String(putBody.byteLength),
        },
        body: new Uint8Array(putBody),
      });
      const putRes = await handleCrmApiRequest(putReq, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(putRes?.status).toBe(200);
    });

    it("6) rejects excessively large request bodies safely BEFORE unbounded buffering (both Content-Length precheck and chunked stream abort)", async () => {
      // 6a: Explicit oversized Content-Length must reject without pulling any chunks from body stream
      let headerOnlyChunksPulled = 0;
      const neverDrainedStream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            headerOnlyChunksPulled++;
            controller.enqueue(new Uint8Array(1024));
          },
        },
        { highWaterMark: 0 },
      );

      const oversizedHeaderReq = new Request(
        "http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof",
        {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3000",
            cookie: "sf_session=tok_owner_a",
            "content-type": "multipart/form-data; boundary=----BigBoundary",
            "content-length": String(MAX_PROOF_MULTIPART_BODY_BYTES + 1024 * 1024),
          },
          body: neverDrainedStream,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );

      const resHeaderOnly = await handleCrmApiRequest(
        oversizedHeaderReq,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(resHeaderOnly?.status).toBe(413);
      const errHeader = (await resHeaderOnly!.json()) as { error: { code: string } };
      expect(errHeader.error.code).toBe("file_too_large");
      expect(headerOnlyChunksPulled).toBe(0);

      // 6b: Transfer-Encoding: chunked (no Content-Length) must abort stream reading early once ceiling crossed
      let streamedChunksPulled = 0;
      const oneMib = new Uint8Array(1024 * 1024);
      const unboundedChunkStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (streamedChunksPulled >= 30) {
            controller.close();
            return;
          }
          streamedChunksPulled++;
          controller.enqueue(oneMib);
        },
      });

      const chunkedReq = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": "multipart/form-data; boundary=----BigChunkedBoundary",
        },
        body: unboundedChunkStream,
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      const resChunked = await handleCrmApiRequest(
        chunkedReq,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(resChunked?.status).toBe(413);
      // 10.25 MiB ceiling crossed on chunk 11 -> never pulls anywhere near 30 chunks
      expect(streamedChunksPulled).toBeLessThanOrEqual(12);
    });

    it("7) rejects invalid or missing multipart boundary safely with 400 validation_error", async () => {
      const reqNoBoundary = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": "multipart/form-data",
        },
        body: '--missing\r\nContent-Disposition: form-data; name="file"\r\n\r\n%PDF-1.4\r\n--missing--',
      });

      const res1 = await handleCrmApiRequest(
        reqNoBoundary,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(res1?.status).toBe(400);
      const j1 = (await res1!.json()) as { ok: boolean; error: { code: string } };
      expect(j1.ok).toBe(false);
      expect(j1.error.code).toBe("validation_error");

      const reqWrongBoundary = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": "multipart/form-data; boundary=ExpectedBoundaryXYZ",
        },
        body: "completely-malformed-non-multipart-garbage",
      });

      const res2 = await handleCrmApiRequest(
        reqWrongBoundary,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(res2?.status).toBe(400);
      const j2 = (await res2!.json()) as { error: { code: string } };
      expect(j2.error.code).toBe("validation_error");
    });

    it("8) rejects truncated multipart and truncated Content-Length uploads cleanly with 400 validation_error", async () => {
      // Truncated multipart (missing closing --boundary--)
      const truncatedMultipart =
        '------TruncBound\r\nContent-Disposition: form-data; name="file"; filename="cut.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\nincomplete';
      const reqTruncMultipart = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_a",
          "content-type": "multipart/form-data; boundary=----TruncBound",
        },
        body: truncatedMultipart,
      });

      const res1 = await handleCrmApiRequest(
        reqTruncMultipart,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(res1?.status).toBe(400);
      expect(((await res1!.json()) as { error: { code: string } }).error.code).toBe(
        "validation_error",
      );

      // Direct parseProofUploadRequest check with declared Content-Length > actual bytes received
      const truncatedStreamReq = new Request(
        "http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof",
        {
          method: "POST",
          headers: {
            "content-type": "application/pdf",
            "content-length": "5000",
          },
          body: new Uint8Array(buildValidPdfExactSize(256)),
        },
      );
      const parsed = await parseProofUploadRequest(truncatedStreamReq);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.response.status).toBe(400);
        const body = (await parsed.response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("validation_error");
      }
    });

    it("9) rejects unauthenticated or invalid-cookie uploads with 401 and leaves proofs & balances untouched", async () => {
      const boundary = "----B11CUnauth";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "unauth.jpg",
        fileMimeType: "image/jpeg",
        fileBytes: buildValidJpeg(64),
      });

      const reqNoCookie = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      });
      const resNoCookie = await handleCrmApiRequest(
        reqNoCookie,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(resNoCookie?.status).toBe(401);

      const reqBadCookie = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=forged_invalid_token",
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      });
      const resBadCookie = await handleCrmApiRequest(
        reqBadCookie,
        "/api/v1/payments/pay_a_1/proof",
        testEnv,
      );
      expect(resBadCookie?.status).toBe(401);
      expect(memDb.tables.get("crm_payment_proofs") ?? []).toHaveLength(0);
    });

    it("10) rejects cross-owner upload from Owner B onto Owner A payment without mutating Deal or Payment balances", async () => {
      const boundary = "----B11CCrossOwner";
      const body = buildManualMultipartBody({
        boundary,
        fileName: "cross-owner.jpg",
        fileMimeType: "image/jpeg",
        fileBytes: buildValidJpeg(64),
      });

      const reqOwnerB = new Request("http://127.0.0.1:3000/api/v1/payments/pay_a_1/proof", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          cookie: "sf_session=tok_owner_b",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });

      const res = await handleCrmApiRequest(reqOwnerB, "/api/v1/payments/pay_a_1/proof", testEnv);
      expect(res?.status).toBe(404);
      const json = (await res!.json()) as { ok: boolean; error: { code: string } };
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not_found");

      // Financial & proof isolation invariants
      expect(memDb.tables.get("crm_payment_proofs") ?? []).toHaveLength(0);
      expect(memDb.tables.get("crm_payment_proof_blobs") ?? []).toHaveLength(0);
      const dealA = memDb.tables.get("crm_deals")![0]!;
      const payA = memDb.tables.get("crm_payments")![0]!;
      expect(dealA["agreedAmount"]).toBe("100000.00");
      expect(dealA["collectedAmount"]).toBe("25000.00");
      expect(dealA["pendingAmount"]).toBe("75000.00");
      expect(payA["amount"]).toBe("25000.00");
    });
  });

  describe("2. Phase 3 — Binary-Safe MariaDB Logical Backup & Restore Safety Guards", () => {
    it("serializes arbitrary 0x00..0xFF binary buffers as hex literals without corruption and escapes strings safely", () => {
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const sqlHex = encodeSqlValue(allBytes);
      expect(sqlHex).toMatch(/^0x[0-9a-f]{512}$/);
      const roundTripped = Buffer.from(sqlHex.slice(2), "hex");
      expect(roundTripped.equals(allBytes)).toBe(true);

      expect(encodeSqlValue(Buffer.alloc(0))).toBe("X''");
      expect(encodeSqlValue(null)).toBe("NULL");
      expect(encodeSqlValue(true)).toBe("1");
      expect(encodeSqlValue(false)).toBe("0");
      expect(escapeMysqlString("O'Reilly\\path\0\n\r\x1a")).toBe(
        "'O\\'Reilly\\\\path\\0\\n\\r\\Z'",
      );
    });

    it("splits SQL dump statements accurately across quotes, semicolons inside strings, and comments", () => {
      const sampleSql = [
        "-- Leading comment; with semicolon",
        "SET FOREIGN_KEY_CHECKS = 0;",
        "/* Block; comment */ CREATE TABLE `t` (`id` varchar(32), `note` text);",
        "INSERT INTO `t` VALUES ('id;1', 'it\\'s a \\\\; test''s \"quoted\"; end'), ('id;2', 0x00ff0a3b);",
        "# Trailing hash comment;",
        "/*!40101 SET NAMES utf8mb4 */;",
      ].join("\n");

      const stmts = splitSqlStatements(sampleSql);
      expect(stmts).toHaveLength(4);
      expect(stmts[0]).toBe("SET FOREIGN_KEY_CHECKS = 0");
      expect(stmts[1]).toBe("CREATE TABLE `t` (`id` varchar(32), `note` text)");
      expect(stmts[2]).toContain("'it\\'s a \\\\; test''s \"quoted\"; end'");
      expect(stmts[2]).toContain("0x00ff0a3b");
      expect(stmts[3]).toBe("/*!40101 SET NAMES utf8mb4 */");
    });

    it("fails closed on restore unless --confirm-clean-target is passed onto an empty non-protected disposable DB", () => {
      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: false,
        }),
      ).toThrow(/confirmCleanTarget/);

      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_stg",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toThrow(/matches source database/);

      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "crm_v1",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toThrow(/protected/);

      expect(() =>
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: ["crm_leads"],
          confirmCleanTarget: true,
        }),
      ).toThrow(/NOT empty/);

      expect(
        assertSafeRestoreTarget({
          targetDbName: "u256504187_crm_b11c_rst",
          sourceDbName: "u256504187_crm_b11c_stg",
          existingTables: [],
          confirmCleanTarget: true,
        }),
      ).toEqual({ ok: true, targetDbName: "u256504187_crm_b11c_rst" });
    });
  });

  describe("3. Phase 7 — MariaDB 3 GB Storage Capacity & Quota Threshold Policy", () => {
    it("computes healthy, warning (50%), hard-stop (70%), and exhausted states from B11C live telemetry", () => {
      const stagingObserved = evaluateMariadbStorageCapacity({ usedMiB: 33 });
      expect(stagingObserved.status).toBe("ok");
      expect(stagingObserved.allowNewProofUploads).toBe(true);
      expect(stagingObserved.percentUsed).toBeCloseTo(1.07, 2);
      expect(stagingObserved.estimatedRemaining1MiBReceipts).toBeGreaterThan(2000);

      const warning = evaluateMariadbStorageCapacity({ usedMiB: 1536 });
      expect(warning.status).toBe("warning");
      expect(warning.allowNewProofUploads).toBe(true);
      expect(warning.percentUsed).toBe(50);

      const hardStop = evaluateMariadbStorageCapacity({ usedMiB: 2150 });
      expect(hardStop.status).toBe("hard_stop_uploads");
      expect(hardStop.allowNewProofUploads).toBe(false);
      expect(hardStop.remainingQuotaMiB).toBe(922);

      const exhausted = evaluateMariadbStorageCapacity({ usedMiB: 3072 });
      expect(exhausted.status).toBe("quota_exhausted");
      expect(exhausted.allowNewProofUploads).toBe(false);
    });
  });
});
