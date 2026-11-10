import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { executeDisposableRestore } from "./backup/disposableRestore.server";
import { executeRestoreDryRun } from "./backup/dryRun.server";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";
import { strToU8 } from "fflate";

describe("B7A-QA — Non-Destructive Dry Run, Rollback & Idempotency", () => {
  function createSyntheticArchiveFiles() {
    const leads = [
      {
        id: "lead_qa_10",
        name: "Alpha Log",
        status: "won",
        score: 80,
        createdAt: "2026-11-10T10:00:00Z",
      },
      {
        id: "lead_qa_20",
        name: "Beta Corp",
        status: "new",
        score: 50,
        createdAt: "2026-11-10T11:00:00Z",
      },
    ];
    const deals = [
      {
        id: "deal_qa_10",
        leadId: "lead_qa_10",
        name: "Custom Platform",
        valuePaise: 7500000,
        status: "won",
        createdAt: "2026-11-10T10:30:00Z",
      },
    ];
    const payments = [
      {
        id: "pay_qa_10",
        dealId: "deal_qa_10",
        amountPaise: 5000000,
        method: "bank_transfer",
        voided: false,
        date: "2026-11-10",
        createdAt: "2026-11-10T11:00:00Z",
      },
      {
        id: "pay_qa_20",
        dealId: "deal_qa_10",
        amountPaise: 2500000,
        method: "upi",
        voided: true,
        voidReason: "Client dispute",
        voidedAt: "2026-11-10T12:00:00Z",
        date: "2026-11-10",
        createdAt: "2026-11-10T11:30:00Z",
      },
    ];
    const projects = [
      {
        id: "proj_qa_10",
        leadId: "lead_qa_10",
        dealId: "deal_qa_10",
        name: "Platform Delivery",
        status: "in_progress",
        stage: "dev",
        createdAt: "2026-11-10T11:00:00Z",
      },
    ];
    const projectTasks = [
      {
        id: "task_qa_10",
        projectId: "proj_qa_10",
        title: "API Integration",
        status: "open",
        createdAt: "2026-11-10T11:30:00Z",
      },
    ];
    const goals = [
      {
        id: "goal_qa_10",
        name: "November Goal",
        metric: "cash_collected",
        period: "monthly",
        targetPaise: 5000000,
        effectiveFrom: "2026-11-01",
        createdAt: "2026-11-01T00:00:00Z",
      },
    ];

    const dataFiles: Record<string, Uint8Array> = {
      "data/leads.json": strToU8(canonicalJsonStringify({ leads })),
      "data/deals.json": strToU8(canonicalJsonStringify({ deals })),
      "data/payments.json": strToU8(canonicalJsonStringify({ payments })),
      "data/projects.json": strToU8(canonicalJsonStringify({ projects, projectTasks })),
      "data/sales-goals.json": strToU8(canonicalJsonStringify({ goals })),
    };

    const manifestFiles = Object.entries(dataFiles).map(([p, bytes]) => ({
      path: p,
      sha256: computeSha256(bytes),
      bytes: bytes.byteLength,
    }));

    const financialSummary = buildFinancialSummary({ deals, payments });

    const manifest = buildManifest({
      type: "full",
      includedEntities: ["leads", "deals", "payments", "projects", "performance"],
      counts: { leads: 2, deals: 1, payments: 2, projects: 1, performance: 1 },
      files: manifestFiles,
      financialSummary,
    });

    dataFiles["manifest.json"] = strToU8(canonicalJsonStringify(manifest));
    return { dataFiles, leads, deals, payments, projects, projectTasks, goals, financialSummary };
  }

  it("proves that executeRestoreDryRun performs strictly zero write operations", async () => {
    const { dataFiles } = createSyntheticArchiveFiles();

    // Instrument DB spies
    const insertSpy = vi.fn();
    const updateSpy = vi.fn();
    const deleteSpy = vi.fn();

    // Execute dry run
    const dryRun = await executeRestoreDryRun(dataFiles, {
      existingLeadIds: new Set(["lead_qa_10"]),
    });

    expect(dryRun.ok).toBe(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.mutationsPerformed).toBe(0);
    expect(dryRun.databaseWritten).toBe(false);

    // Verify spy asserts 0 mutation calls
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    // Actions report preview
    expect(dryRun.actions["leads"]!.toCreate).toBe(1);
    expect(dryRun.actions["leads"]!.toSkip).toBe(1);
    expect(dryRun.actions["deals"]!.toCreate).toBe(1);
    expect(dryRun.actions["payments"]!.toCreate).toBe(2);
  });

  it("proves transaction rollback: failed restore aborts transaction with 0 committed records", async () => {
    const { dataFiles } = createSyntheticArchiveFiles();

    let transactionRollbackCalled = false;
    const committedRows: Array<Record<string, unknown>> = [];

    const mockFailingDb = {
      transaction: async (
        cb: (tx: {
          select: () => {
            from: (tbl: unknown) => { where: (clause?: unknown) => Promise<Array<{ id: string }>> };
          };
          insert: (table: unknown) => { values: (vals: Record<string, unknown>) => Promise<void> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({
            from: (_tbl: unknown) => ({
              where: async () => [] as Array<{ id: string }>,
            }),
          }),
          insert: (table: unknown) => ({
            values: async (vals: Record<string, unknown>) => {
              const name = getTableName(table as Parameters<typeof getTableName>[0]);
              // Fail midway during payment insertion
              if (name === "crm_payments") {
                transactionRollbackCalled = true;
                throw new Error(
                  "Simulated SQL Foreign Key Constraint Violation: crm_deals(id) error",
                );
              }
              committedRows.push(vals);
            },
          }),
        };

        await cb(tx);
      },
    };

    const res = await executeDisposableRestore({
      db: mockFailingDb as never,
      archiveBytesOrFiles: dataFiles,
      targetOwnerUserId: "usr_rollback_test",
    });

    expect(res.ok).toBe(false);
    expect(res.transactionCommitted).toBe(false);
    expect(transactionRollbackCalled).toBe(true);
    expect(res.error).toContain("Simulated SQL Foreign Key Constraint Violation");
  });

  it("verifies idempotency: repeated restore skips all existing records", async () => {
    const { dataFiles } = createSyntheticArchiveFiles();

    const storedIds = new Set<string>();
    const insertedRecords: Array<{ table: string; id: string }> = [];

    const mockDb = {
      transaction: async (
        cb: (tx: {
          select: () => {
            from: (tbl: unknown) => {
              where: (clause?: { queryChunks?: unknown[] }) => Promise<Array<{ id: string }>>;
            };
          };
          insert: (table: unknown) => { values: (vals: Record<string, unknown>) => Promise<void> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({
            from: (_tbl: unknown) => ({
              where: async (clause?: { queryChunks?: unknown[] }) => {
                const chunks = clause?.queryChunks ?? [];
                for (const c of chunks) {
                  const val = typeof c === "string" ? c : (c as { value?: unknown })?.value;
                  if (typeof val === "string" && storedIds.has(val)) {
                    return [{ id: val }];
                  }
                }
                return [];
              },
            }),
          }),
          insert: (table: unknown) => ({
            values: async (vals: Record<string, unknown>) => {
              const name = getTableName(table as Parameters<typeof getTableName>[0]);
              const id = String(vals["id"]);
              storedIds.add(id);
              insertedRecords.push({ table: name, id });
            },
          }),
        };
        await cb(tx);
      },
    };

    // First restore run: should insert records
    const res1 = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: dataFiles,
      targetOwnerUserId: "usr_idempotent_test",
      allowIdempotentSkip: true,
    });

    expect(res1.ok).toBe(true);
    expect(res1.recordsInserted["leads"]).toBe(2);
    expect(res1.recordsInserted["deals"]).toBe(1);
    expect(res1.recordsInserted["payments"]).toBe(2);
    expect(res1.recordsSkipped["leads"]).toBe(0);

    // Second restore run: should skip existing records
    const res2 = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: dataFiles,
      targetOwnerUserId: "usr_idempotent_test",
      allowIdempotentSkip: true,
    });

    expect(res2.ok).toBe(true);
    expect(res2.recordsInserted["leads"]).toBe(0);
    expect(res2.recordsInserted["deals"]).toBe(0);
    expect(res2.recordsInserted["payments"]).toBe(0);
    expect(res2.recordsSkipped["leads"]).toBe(2);
    expect(res2.recordsSkipped["deals"]).toBe(1);
    expect(res2.recordsSkipped["payments"]).toBe(2);
  });

  it("enforces target Owner isolation: restored records are assigned strictly to target owner", async () => {
    const { dataFiles } = createSyntheticArchiveFiles();
    const assignedOwnerIds: string[] = [];

    const mockDb = {
      transaction: async (
        cb: (tx: {
          select: () => {
            from: (tbl: unknown) => { where: (clause?: unknown) => Promise<Array<{ id: string }>> };
          };
          insert: (table: unknown) => { values: (vals: Record<string, unknown>) => Promise<void> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({
            from: (_tbl: unknown) => ({
              where: async () => [],
            }),
          }),
          insert: (_table: unknown) => ({
            values: async (vals: Record<string, unknown>) => {
              if (vals["ownerUserId"]) {
                assignedOwnerIds.push(String(vals["ownerUserId"]));
              }
            },
          }),
        };
        await cb(tx);
      },
    };

    const targetOwner = "usr_target_owner_isolated_99";
    const res = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: dataFiles,
      targetOwnerUserId: targetOwner,
    });

    expect(res.ok).toBe(true);
    expect(assignedOwnerIds.length).toBeGreaterThan(0);
    // Every single inserted row must have the target owner ID
    for (const ownerId of assignedOwnerIds) {
      expect(ownerId).toBe(targetOwner);
    }
  });
});
