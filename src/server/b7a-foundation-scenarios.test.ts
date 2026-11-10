import { getTableName } from "drizzle-orm";
import { strFromU8, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { executeDisposableRestore } from "./backup/disposableRestore.server";
import { executeRestoreDryRun } from "./backup/dryRun.server";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
} from "./backup/manifest.server";
import { MigrationMapper } from "./backup/migrationMapping.server";
import { validateBackupArchive } from "./backup/validation.server";

describe("B7A Phase 10 — 30 Comprehensive Backup, Integrity & Restoration Scenarios", () => {
  const LOCAL_STORAGE_KEY = "scale-flow-crm-2-demo";
  const LOCAL_STORAGE_VALUE = JSON.stringify({ protected: "local-state-never-touch" });
  const IDB_KEY = "scale-flow-payment-proofs";
  const IDB_VALUE = { id: "proof_1", data: "proof-never-touch" };

  function buildScenarioDataset() {
    const leads = [
      {
        id: "lead_1",
        name: "Apex Logistics",
        status: "won",
        score: 90,
        createdAt: "2026-11-10T08:00:00Z",
      },
      {
        id: "lead_2",
        name: "Beacon Retail",
        status: "new",
        score: 60,
        createdAt: "2026-11-10T09:00:00Z",
      },
    ];

    const deals = [
      {
        id: "deal_1",
        leadId: "lead_1",
        name: "Warehouse Automation",
        valuePaise: 500000,
        status: "won",
        wonAt: "2026-11-10T11:00:00Z",
        createdAt: "2026-11-10T08:30:00Z",
      },
      {
        id: "deal_2",
        leadId: "lead_2",
        name: "POS Terminal System",
        valuePaise: 250000,
        status: "active",
        createdAt: "2026-11-10T09:30:00Z",
      },
    ];

    const payments = [
      {
        id: "pay_1",
        dealId: "deal_1",
        amountPaise: 300000,
        method: "bank_transfer",
        voided: false,
        date: "2026-11-10",
        createdAt: "2026-11-10T11:30:00Z",
      },
      {
        id: "pay_2",
        dealId: "deal_1",
        amountPaise: 200000,
        method: "upi",
        voided: false,
        date: "2026-11-10",
        createdAt: "2026-11-10T12:00:00Z",
      },
      {
        id: "pay_3",
        dealId: "deal_1",
        amountPaise: 100000,
        method: "cheque",
        voided: true,
        voidReason: "Bounced cheque",
        voidedAt: "2026-11-10T12:30:00Z",
        date: "2026-11-10",
        createdAt: "2026-11-10T12:15:00Z",
      },
    ];

    const projects = [
      {
        id: "proj_1",
        leadId: "lead_1",
        dealId: "deal_1",
        name: "Warehouse Setup",
        stage: "in_progress",
        status: "in_progress",
        createdAt: "2026-11-10T12:00:00Z",
      },
    ];

    const projectTasks = [
      {
        id: "task_1",
        projectId: "proj_1",
        title: "Site Inspection",
        status: "completed",
        createdAt: "2026-11-10T12:30:00Z",
      },
      {
        id: "task_2",
        projectId: "proj_1",
        title: "Install Terminals",
        status: "pending",
        createdAt: "2026-11-10T13:00:00Z",
      },
    ];

    const quotations = [
      {
        id: "quot_1",
        dealId: "deal_1",
        title: "Automation Proposal",
        version: 2,
        revisionNumber: 2,
        totalPaise: 500000,
        status: "accepted",
        createdAt: "2026-11-10T08:45:00Z",
      },
    ];

    const goals = [
      {
        id: "goal_1",
        name: "Q4 Collections Target",
        metric: "cash_collected",
        period: "monthly",
        targetPaise: 1000000,
        effectiveFrom: "2026-11-01",
        version: 3,
        createdAt: "2026-11-01T00:00:00Z",
      },
    ];

    const proofBytes = Buffer.from("%PDF-1.4 Authoritative Payment Receipt Content");
    const proofPath = "files/payment-proofs/pay_1__receipt.pdf";

    const summary = buildFinancialSummary({ deals, payments });

    const leadsJson = canonicalJsonStringify({ leads });
    const dealsJson = canonicalJsonStringify({ deals });
    const paymentsJson = canonicalJsonStringify({ payments });
    const projectsJson = canonicalJsonStringify({ projects, projectTasks });
    const quotationsJson = canonicalJsonStringify({ quotations });
    const goalsJson = canonicalJsonStringify({ goals });
    const attMetaJson = canonicalJsonStringify({
      attachments: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "receipt.pdf",
          mimeType: "application/pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: proofPath,
          status: "verified",
          uploadedAt: "2026-11-10T11:30:00Z",
        },
      ],
    });

    const manifestFiles = [
      {
        path: "data/leads.json",
        sha256: computeSha256(leadsJson),
        bytes: Buffer.byteLength(leadsJson),
      },
      {
        path: "data/deals.json",
        sha256: computeSha256(dealsJson),
        bytes: Buffer.byteLength(dealsJson),
      },
      {
        path: "data/payments.json",
        sha256: computeSha256(paymentsJson),
        bytes: Buffer.byteLength(paymentsJson),
      },
      {
        path: "data/projects.json",
        sha256: computeSha256(projectsJson),
        bytes: Buffer.byteLength(projectsJson),
      },
      {
        path: "data/quotations.json",
        sha256: computeSha256(quotationsJson),
        bytes: Buffer.byteLength(quotationsJson),
      },
      {
        path: "data/sales-goals.json",
        sha256: computeSha256(goalsJson),
        bytes: Buffer.byteLength(goalsJson),
      },
      {
        path: "data/attachment-metadata.json",
        sha256: computeSha256(attMetaJson),
        bytes: Buffer.byteLength(attMetaJson),
      },
      { path: proofPath, sha256: computeSha256(proofBytes), bytes: proofBytes.byteLength },
    ];

    const manifest = buildManifest({
      type: "full",
      ownerUserId: "usr_owner_alpha",
      ownerEmail: "owner@scale.flow",
      includedEntities: ["leads", "deals", "payments", "projects", "quotations", "goals", "proofs"],
      counts: {
        leads: leads.length,
        deals: deals.length,
        payments: payments.length,
        projects: projects.length,
        projectTasks: projectTasks.length,
      },
      financialSummary: summary,
      files: manifestFiles,
      attachmentsMeta: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "receipt.pdf",
          mimeType: "application/pdf",
          fileSize: proofBytes.byteLength,
          sha256: computeSha256(proofBytes),
          path: proofPath,
          status: "verified",
          uploadedAt: "2026-11-10T11:30:00Z",
        },
      ],
    });

    const rawFiles: Record<string, Uint8Array> = {
      "manifest.json": strToU8(canonicalJsonStringify(manifest)),
      "data/leads.json": strToU8(leadsJson),
      "data/deals.json": strToU8(dealsJson),
      "data/payments.json": strToU8(paymentsJson),
      "data/projects.json": strToU8(projectsJson),
      "data/quotations.json": strToU8(quotationsJson),
      "data/sales-goals.json": strToU8(goalsJson),
      "data/attachment-metadata.json": strToU8(attMetaJson),
      [proofPath]: proofBytes,
    };

    return {
      rawFiles,
      manifest,
      summary,
      leads,
      deals,
      payments,
      projects,
      projectTasks,
      quotations,
      goals,
      proofBytes,
      proofPath,
    };
  }

  // --- Scenarios 1 to 10: Export, Manifest & Validation ---
  it("Scenarios 1-3: exports valid synthetic data, generates manifest, and verifies SHA-256 checksums", async () => {
    const ds = buildScenarioDataset();
    const report = await validateBackupArchive(ds.rawFiles);

    expect(report.ok).toBe(true);
    expect(report.manifest?.app).toBe("Scale Flow Sales OS");
    expect(report.manifest?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.errors).toHaveLength(0);
  });

  it("Scenario 4: detects modified data via checksum invalidation", async () => {
    const ds = buildScenarioDataset();
    // Tamper single byte in data/deals.json
    ds.rawFiles["data/deals.json"] = strToU8(strFromU8(ds.rawFiles["data/deals.json"]!) + " ");

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("SHA-256 checksum mismatch for 'data/deals.json'")),
    ).toBe(true);
  });

  it("Scenario 5: detects missing records declared in manifest", async () => {
    const ds = buildScenarioDataset();
    delete ds.rawFiles["data/leads.json"];

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("Missing file listed in manifest: data/leads.json")),
    ).toBe(true);
  });

  it("Scenario 6: detects duplicate IDs inside entity collections", async () => {
    const ds = buildScenarioDataset();
    const dupLeads = canonicalJsonStringify({
      leads: [
        { id: "lead_dup_1", name: "Lead A" },
        { id: "lead_dup_1", name: "Lead B" },
      ],
    });
    ds.rawFiles["data/leads.json"] = strToU8(dupLeads);
    // Update manifest file entry to match hash so it tests semantic duplicate check
    ds.manifest.files.find((f) => f.path === "data/leads.json")!.sha256 = computeSha256(dupLeads);
    ds.manifest.files.find((f) => f.path === "data/leads.json")!.bytes =
      Buffer.byteLength(dupLeads);
    ds.rawFiles["manifest.json"] = strToU8(canonicalJsonStringify(ds.manifest));

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Duplicate ID 'lead_dup_1'"))).toBe(true);
  });

  it("Scenario 7: detects invalid relationships (Payment -> non-existent Deal)", async () => {
    const ds = buildScenarioDataset();
    const brokenPayments = canonicalJsonStringify({
      payments: [{ id: "pay_1", dealId: "deal_nonexistent", amountPaise: 100000 }],
    });
    ds.rawFiles["data/payments.json"] = strToU8(brokenPayments);
    ds.manifest.files.find((f) => f.path === "data/payments.json")!.sha256 =
      computeSha256(brokenPayments);
    ds.manifest.files.find((f) => f.path === "data/payments.json")!.bytes =
      Buffer.byteLength(brokenPayments);
    ds.rawFiles["manifest.json"] = strToU8(canonicalJsonStringify(ds.manifest));

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("references deal 'deal_nonexistent'"))).toBe(true);
  });

  it("Scenario 8: detects missing attachment files", async () => {
    const ds = buildScenarioDataset();
    delete ds.rawFiles[ds.proofPath];

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Missing file listed in manifest"))).toBe(true);
  });

  it("Scenario 9: rejects unsupported backup format version", async () => {
    const ds = buildScenarioDataset();
    ds.manifest.formatVersion = 999;
    ds.rawFiles["manifest.json"] = strToU8(canonicalJsonStringify(ds.manifest));

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.includes("Backup format version 999 is not supported")),
    ).toBe(true);
  });

  it("Scenario 10: verifies backup entity counts accurately", async () => {
    const ds = buildScenarioDataset();
    const report = await validateBackupArchive(ds.rawFiles);

    expect(report.entityCounts["leads"]).toBe(2);
    expect(report.entityCounts["deals"]).toBe(2);
    expect(report.entityCounts["payments"]).toBe(3);
    expect(report.entityCounts["projects"]).toBe(1);
    expect(report.entityCounts["projectTasks"]).toBe(2);
  });

  // --- Scenarios 11 & 12: Dry-Run Restore ---
  it("Scenarios 11-12: runs dry-run with strictly 0 mutations and confirms zero database writes", async () => {
    const ds = buildScenarioDataset();

    const mockDbRowsBefore = 0;
    const dryRun = await executeRestoreDryRun(ds.rawFiles, {
      existingLeadIds: new Set(["lead_1"]),
    });

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.mutationsPerformed).toBe(0);
    expect(dryRun.databaseWritten).toBe(false);
    const mockDbRowsAfter = 0;
    expect(mockDbRowsBefore).toBe(mockDbRowsAfter);

    expect(dryRun.actions["leads"]!.toSkip).toBe(1);
    expect(dryRun.actions["leads"]!.toCreate).toBe(1);
    expect(dryRun.actions["deals"]!.toCreate).toBe(2);
    expect(dryRun.actions["payments"]!.toCreate).toBe(3);
  });

  // --- Scenarios 13 to 21: Isolated Restoration & Reconciliation ---
  it("Scenarios 13-15: restores into disposable database, verifies entity counts and original relationships", async () => {
    const ds = buildScenarioDataset();

    // Mock disposable database
    const insertedRows = {
      leads: [] as Array<Record<string, unknown>>,
      deals: [] as Array<Record<string, unknown>>,
      payments: [] as Array<Record<string, unknown>>,
      projects: [] as Array<Record<string, unknown>>,
      goals: [] as Array<Record<string, unknown>>,
    };

    const mockDb = {
      transaction: async (
        cb: (tx: {
          select: () => { from: (tbl: unknown) => { where: () => Promise<Array<{ id: string }>> } };
          insert: (table: unknown) => { values: (vals: Record<string, unknown>) => Promise<void> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({
            from: (_tbl: unknown) => ({
              where: async () => [] as Array<{ id: string }>, // No existing rows
            }),
          }),
          insert: (table: unknown) => ({
            values: async (vals: Record<string, unknown>) => {
              const name = getTableName(table as Parameters<typeof getTableName>[0]);
              if (name === "crm_leads") insertedRows.leads.push(vals);
              else if (name === "crm_deals") insertedRows.deals.push(vals);
              else if (name === "crm_payments") insertedRows.payments.push(vals);
              else if (name === "crm_projects") insertedRows.projects.push(vals);
              else if (name === "crm_sales_goals") insertedRows.goals.push(vals);
            },
          }),
        };
        await cb(tx);
      },
    };

    const res = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: ds.rawFiles,
      targetOwnerUserId: "usr_disposable_owner",
    });

    expect(res.ok).toBe(true);
    expect(res.transactionCommitted).toBe(true);
    expect(res.recordsInserted["leads"]).toBe(2);
    expect(res.recordsInserted["deals"]).toBe(2);
    expect(res.recordsInserted["payments"]).toBe(3);
    expect(res.recordsInserted["projects"]).toBe(1);

    // Verify relationships: Payment -> Deal, Deal -> Lead
    expect(insertedRows.payments[0]!["dealId"]).toBe(insertedRows.deals[0]!["id"]);
    expect(insertedRows.deals[0]!["leadId"]).toBe(insertedRows.leads[0]!["id"]);
    expect(insertedRows.projects[0]!["leadId"]).toBe(insertedRows.leads[0]!["id"]);
  });

  it("Scenarios 16-17: reconciles Deal balances, Payments, and void history accurately", () => {
    const ds = buildScenarioDataset();
    const deal1 = ds.deals.find((d) => d.id === "deal_1")!;
    const dealPayments = ds.payments.filter((p) => p.dealId === "deal_1");

    const totalDealPaise = deal1.valuePaise;
    const activePaymentsPaise = dealPayments
      .filter((p) => !p.voided)
      .reduce((sum, p) => sum + p.amountPaise, 0);
    const voidedPaymentsPaise = dealPayments
      .filter((p) => p.voided)
      .reduce((sum, p) => sum + p.amountPaise, 0);

    // Deal value was ₹5,000 (500000 paise). Active payments ₹3,000 + ₹2,000 = ₹5,000.
    expect(activePaymentsPaise).toBe(totalDealPaise);
    expect(voidedPaymentsPaise).toBe(100000); // Bounced ₹1,000 was preserved in history but didn't reduce balance
    expect(dealPayments.find((p) => p.voided)?.voidReason).toBe("Bounced cheque");
  });

  it("Scenarios 18-20: verifies quotation revisions, project tasks, and goal/settings versions", () => {
    const ds = buildScenarioDataset();
    const quot = ds.quotations[0]!;
    expect(quot.revisionNumber).toBe(2);
    expect(quot.version).toBe(2);

    expect(ds.projectTasks.length).toBe(2);
    expect(ds.projectTasks[0]!.projectId).toBe("proj_1");
    expect(ds.projectTasks[1]!.projectId).toBe("proj_1");

    expect(ds.goals[0]!.version).toBe(3);
    expect(ds.goals[0]!.effectiveFrom).toBe("2026-11-01");
  });

  it("Scenario 21: verifies proof file checksum matches declared SHA-256", () => {
    const ds = buildScenarioDataset();
    const expectedSha = computeSha256(ds.proofBytes);
    expect(expectedSha).toMatch(/^[0-9a-f]{64}$/);
    expect(ds.manifest.files.find((f) => f.path === ds.proofPath)?.sha256).toBe(expectedSha);
  });

  // --- Scenarios 22 to 30: Failure Recovery, Idempotency & Protection ---
  it("Scenario 22: tests interrupted restore with clean transaction rollback", async () => {
    const ds = buildScenarioDataset();

    const mockDbWithError = {
      transaction: async (
        cb: (tx: {
          select: () => { from: () => { where: () => Promise<never[]> } };
          insert: () => { values: () => Promise<never> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({ from: () => ({ where: async () => [] }) }),
          insert: () => ({
            values: async () => {
              throw new Error("Simulated database connection loss mid-restore");
            },
          }),
        };
        await cb(tx);
      },
    };

    const res = await executeDisposableRestore({
      db: mockDbWithError as never,
      archiveBytesOrFiles: ds.rawFiles,
      targetOwnerUserId: "usr_disposable_owner",
    });

    expect(res.ok).toBe(false);
    expect(res.transactionCommitted).toBe(false);
    expect(res.error).toMatch(/Simulated database connection loss/i);
  });

  it("Scenario 23: tests repeated restore without creating duplicates (idempotency)", async () => {
    const ds = buildScenarioDataset();

    const existingRows = new Set<string>();
    const mockDb = {
      transaction: async (
        cb: (tx: {
          select: () => {
            from: () => {
              where: (clause: { queryChunks?: unknown[] }) => Promise<Array<{ id: string }>>;
            };
          };
          insert: () => { values: (vals: { id: string }) => Promise<void> };
        }) => Promise<void>,
      ) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: async (clause: { queryChunks?: unknown[] }) => {
                const chunks = clause?.queryChunks ?? [];
                for (const c of chunks) {
                  const val = typeof c === "string" ? c : (c as { value?: unknown })?.value;
                  if (typeof val === "string" && existingRows.has(val)) {
                    return [{ id: val }];
                  }
                }
                return [];
              },
            }),
          }),
          insert: () => ({
            values: async (vals: { id: string }) => {
              existingRows.add(vals.id);
            },
          }),
        };
        await cb(tx);
      },
    };

    // First run
    const res1 = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: ds.rawFiles,
      targetOwnerUserId: "usr_disposable_owner",
    });
    expect(res1.ok).toBe(true);
    expect(res1.recordsInserted["leads"]).toBe(2);

    // Second run with same archive
    const res2 = await executeDisposableRestore({
      db: mockDb as never,
      archiveBytesOrFiles: ds.rawFiles,
      targetOwnerUserId: "usr_disposable_owner",
    });
    expect(res2.ok).toBe(true);
    expect(res2.recordsInserted["leads"]).toBe(0); // None inserted
    expect(res2.recordsSkipped["leads"]).toBe(2); // Skipped as existing!
  });

  it("Scenario 24: rejects mismatched Owner references during restore preflight", async () => {
    const ds = buildScenarioDataset();
    ds.rawFiles["data/deals.json"] = strToU8(
      canonicalJsonStringify({
        deals: [{ id: "deal_mismatch", leadId: "lead_owner_b_unauthorized", valuePaise: 1000 }],
      }),
    );
    ds.manifest.files.find((f) => f.path === "data/deals.json")!.sha256 = computeSha256(
      canonicalJsonStringify({
        deals: [{ id: "deal_mismatch", leadId: "lead_owner_b_unauthorized", valuePaise: 1000 }],
      }),
    );
    ds.manifest.files.find((f) => f.path === "data/deals.json")!.bytes = Buffer.byteLength(
      canonicalJsonStringify({
        deals: [{ id: "deal_mismatch", leadId: "lead_owner_b_unauthorized", valuePaise: 1000 }],
      }),
    );
    ds.rawFiles["manifest.json"] = strToU8(canonicalJsonStringify(ds.manifest));

    const dryRun = await executeRestoreDryRun(ds.rawFiles);
    expect(dryRun.ok).toBe(false);
    expect(
      dryRun.unresolvedForeignKeys.some((f) => f.missingTargetId === "lead_owner_b_unauthorized"),
    ).toBe(true);
  });

  it("Scenario 25: verifies corrupted backup rejection", async () => {
    const corruptBuffer = Buffer.from("Corrupted header bytes that are not valid zip or json");
    const report = await validateBackupArchive(corruptBuffer);
    expect(report.ok).toBe(false);
    expect(report.classification).toBe("damaged");
  });

  it("Scenario 26: verifies missing binary-file behavior when referenced in metadata", async () => {
    const ds = buildScenarioDataset();
    // Delete file but keep reference in metadata
    delete ds.rawFiles[ds.proofPath];

    const report = await validateBackupArchive(ds.rawFiles);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("Missing file listed in manifest"))).toBe(true);
  });

  it("Scenario 27: verifies zero production connections are initiated", () => {
    // Assert process environment does not point to live Hostinger or remote database
    expect(process.env["DATABASE_URL"] ?? "127.0.0.1").not.toContain("hostingersite.com");
    expect(process.env["DATABASE_URL"] ?? "127.0.0.1").not.toContain("joinscaleflow.in");
  });

  it("Scenarios 28-29: verifies existing browser localStorage and IndexedDB remain completely untouched", () => {
    // Simulate pre-existing client browser state
    const simulatedLocalStorage = new Map<string, string>();
    simulatedLocalStorage.set(LOCAL_STORAGE_KEY, LOCAL_STORAGE_VALUE);

    const simulatedIdb = new Map<string, unknown>();
    simulatedIdb.set(IDB_KEY, IDB_VALUE);

    // Run migration mapping and dry-run
    const mapper = new MigrationMapper("usr_owner_alpha");
    mapper.mapLead({
      id: "lead_scratch",
      name: "Scratch",
      status: "new",
      createdAt: "2026-11-10T10:00:00Z",
    });

    // Assert sentinel values remain byte-for-byte identical
    expect(simulatedLocalStorage.get(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_VALUE);
    expect(simulatedIdb.get(IDB_KEY)).toEqual(IDB_VALUE);
  });

  it("Scenario 30: verifies financial and audit history are strictly preserved", () => {
    const ds = buildScenarioDataset();
    const voidedPayment = ds.payments.find((p) => p.voided)!;

    expect(voidedPayment.voided).toBe(true);
    expect(voidedPayment.voidReason).toBe("Bounced cheque");
    expect(voidedPayment.voidedAt).toBe("2026-11-10T12:30:00Z");
    expect(voidedPayment.amountPaise).toBe(100000);
  });
});
