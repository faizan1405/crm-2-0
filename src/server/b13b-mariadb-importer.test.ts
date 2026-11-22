import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  buildSyntheticMigrationZip,
  chunkProofBinaryForMariaDb,
  executeMariaDbSyntheticImport,
} from "./migration/index.server";

/**
 * Faithful transactional Drizzle MariaDB test harness supporting:
 * - Atomic `db.transaction(...)` with snapshot/rollback on throw
 * - Real table-keyed PK lookup for idempotent skip checks
 * - Real `crm_payment_proof_blobs` chunk storage and `storageKey` readback
 */
function createTransactionalMariaDbHarness() {
  let tables = new Map<unknown, Map<string, Record<string, unknown>>>();

  const getStore = (table: unknown) => {
    let m = tables.get(table);
    if (!m) {
      m = new Map();
      tables.set(table, m);
    }
    return m;
  };

  const makeTx = () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: async (clause: unknown) => {
          const store = getStore(table);
          // Extract string parameter from drizzle sql/eq clause
          const chunks = (clause as { queryChunks?: unknown[] })?.queryChunks ?? [];
          const paramValues = chunks
            .map((c) =>
              typeof c === "string"
                ? c
                : c && typeof c === "object" && "value" in c
                  ? (c as { value: unknown }).value
                  : null,
            )
            .filter((v): v is string => typeof v === "string");

          const target = paramValues[paramValues.length - 1];
          if (!target) return [];

          // Match by PK `id` or by `storageKey`
          if (store.has(target)) {
            return [store.get(target)!];
          }
          const byKey = Array.from(store.values()).filter((r) => r["storageKey"] === target);
          return byKey;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        const store = getStore(table);
        const id = String(row["id"]);
        if (store.has(id)) {
          throw new Error(`Duplicate entry '${id}' for key 'PRIMARY'`);
        }
        store.set(id, { ...row });
      },
    }),
  });

  const db = {
    ...makeTx(),
    transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
      const snap = new Map<unknown, Map<string, Record<string, unknown>>>();
      for (const [k, v] of tables.entries()) {
        snap.set(k, new Map(v));
      }
      try {
        return await fn(makeTx());
      } catch (err) {
        tables = snap;
        throw err;
      }
    },
  };

  const totalRows = () => {
    let sum = 0;
    for (const m of tables.values()) sum += m.size;
    return sum;
  };

  return { db: db as unknown as MySql2Database<Record<string, unknown>>, totalRows };
}

describe("Checkpoint B13B: Real MariaDB Transactional Importer, Idempotency & Rollback", () => {
  it("imports all synthetic entities + chunked proof BLOBs, verifies SHA-256 readback, and is 100% idempotent on Pass 2", async () => {
    const harness = createTransactionalMariaDbHarness();
    const { zipBytes, filename } = buildSyntheticMigrationZip({ injectCredentialFields: true });

    // Pass 1: Clean disposable DB import
    const pass1 = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "u256504187_crm_b13b_disposable",
      hostName: "127.0.0.1",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      sourceFilename: filename,
      syntheticOnly: true,
      confirmDisposableTarget: true,
    });

    expect(pass1.ok).toBe(true);
    expect(pass1.transactionCommitted).toBe(true);
    expect(pass1.rolledBack).toBe(false);
    expect(pass1.hostingPolicy).toBe("hostinger_exclusive");
    expect(pass1.cloudflareR2Required).toBe(false);
    expect(pass1.proofStorageDriver).toBe("mariadb-blob");
    expect(pass1.financialParityPassed).toBe(true);
    expect(pass1.dealsDeltaPaise).toBe(0);
    expect(pass1.activePaymentsDeltaPaise).toBe(0);
    expect(pass1.voidedPaymentsDeltaPaise).toBe(0);
    expect(pass1.proofBlobsInserted).toBe(2);
    expect(pass1.proofReadbackChecks).toHaveLength(2);
    expect(pass1.allProofSha256Matched).toBe(true);
    expect(pass1.totalInserted).toBeGreaterThan(30);
    expect(pass1.totalSkipped).toBe(0);

    const rowsAfterPass1 = harness.totalRows();
    expect(rowsAfterPass1).toBe(pass1.totalInserted);

    // Pass 2: Re-run identical import -> 0 new inserts, 0 duplicate payments, 100% skipped
    const pass2 = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "u256504187_crm_b13b_disposable",
      hostName: "127.0.0.1",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      sourceFilename: filename,
      syntheticOnly: true,
      confirmDisposableTarget: true,
    });

    expect(pass2.ok).toBe(true);
    expect(pass2.totalInserted).toBe(0);
    expect(pass2.insertedCounts["crm_payments"]).toBe(0);
    expect(pass2.totalSkipped).toBe(pass1.totalInserted);
    expect(pass2.allProofSha256Matched).toBe(true);
    expect(harness.totalRows()).toBe(rowsAfterPass1);
  });

  it("rolls back 100% of rows atomically on mid-transaction interruption leaving 0 orphan records", async () => {
    const harness = createTransactionalMariaDbHarness();
    const { zipBytes } = buildSyntheticMigrationZip();

    const failed = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "u256504187_crm_b13b_disposable",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      syntheticOnly: true,
      confirmDisposableTarget: true,
      injectFailureAfterTable: "crm_payments",
    });

    expect(failed.ok).toBe(false);
    expect(failed.transactionCommitted).toBe(false);
    expect(failed.rolledBack).toBe(true);
    expect(failed.error).toContain("crm_payments");
    expect(harness.totalRows()).toBe(0);
  });

  it("blocks non-synthetic, unconfirmed, CRM V1, and production database targets fail-closed", async () => {
    const harness = createTransactionalMariaDbHarness();
    const { zipBytes } = buildSyntheticMigrationZip();

    const realDataBlocked = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "u256504187_crm_b13b_disposable",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      syntheticOnly: false,
      confirmDisposableTarget: true,
    });
    expect(realDataBlocked.ok).toBe(false);
    expect(realDataBlocked.error).toContain("syntheticOnly");

    const unconfirmedBlocked = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "u256504187_crm_b13b_disposable",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      syntheticOnly: true,
      confirmDisposableTarget: false,
    });
    expect(unconfirmedBlocked.ok).toBe(false);
    expect(unconfirmedBlocked.error).toContain("confirmDisposableTarget");

    const prodBlocked = await executeMariaDbSyntheticImport({
      db: harness.db,
      databaseName: "crm_v1_production",
      hostName: "crm.joinscaleflow.in",
      ownerUserId: "usr_owner_b13b",
      source: zipBytes,
      syntheticOnly: true,
      confirmDisposableTarget: true,
    });
    expect(prodBlocked.ok).toBe(false);
    expect(prodBlocked.error).toContain("blocked");
    expect(harness.totalRows()).toBe(0);
  });

  it("chunks multi-chunk proof binaries cleanly into 256 KiB slices with matching totalSha256", () => {
    const largeBytes = new Uint8Array(600 * 1024); // 600 KiB -> 3 chunks
    largeBytes.fill(0xab);
    const chunks = chunkProofBinaryForMariaDb({
      ownerUserId: "usr_owner_b13b",
      storageKey: "files/payment-proofs/large.pdf",
      mimeType: "application/pdf",
      bytes: largeBytes,
      createdAt: "2026-09-01 00:00:00",
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.chunkCount).toBe(3);
    expect(chunks.reduce((sum, c) => sum + c.chunkSize, 0)).toBe(largeBytes.byteLength);
    expect(chunks.every((c) => c.totalSha256 === chunks[0]!.totalSha256)).toBe(true);
  });

  it("verifies CLI runner scripts/b13b-mariadb-synthetic-import.mjs safety exit codes", () => {
    const scriptPath = path.resolve(process.cwd(), "scripts/b13b-mariadb-synthetic-import.mjs");

    // 1. Safe --dry-run-plan exits 0
    const out = execFileSync(
      process.execPath,
      [scriptPath, "--target-db", "u_crm_b13b_disposable", "--synthetic-only", "--dry-run-plan"],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed["ok"]).toBe(true);
    expect(parsed["remoteDatabaseWritten"]).toBe(false);
    expect(parsed["cloudflareR2Required"]).toBe(false);

    // 2. Missing --synthetic-only exits 2
    let code2 = 0;
    try {
      execFileSync(process.execPath, [scriptPath, "--target-db", "u_crm_b13b_disposable"], {
        stdio: "pipe",
      });
    } catch (e: unknown) {
      code2 = (e as { status?: number }).status ?? 1;
    }
    expect(code2).toBe(2);

    // 3. Protected CRM V1 target exits 3
    let code3 = 0;
    try {
      execFileSync(
        process.execPath,
        [scriptPath, "--target-db", "crm_v1_prod", "--synthetic-only", "--dry-run-plan"],
        { stdio: "pipe" },
      );
    } catch (e: unknown) {
      code3 = (e as { status?: number }).status ?? 1;
    }
    expect(code3).toBe(3);

    // 4. Missing --confirm-disposable-target (without --dry-run-plan) exits 4
    let code4 = 0;
    try {
      execFileSync(
        process.execPath,
        [scriptPath, "--target-db", "u_crm_b13b_disposable", "--synthetic-only"],
        { stdio: "pipe" },
      );
    } catch (e: unknown) {
      code4 = (e as { status?: number }).status ?? 1;
    }
    expect(code4).toBe(4);
  });
});
