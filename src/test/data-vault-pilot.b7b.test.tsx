import type * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDataVaultPage } from "@/components/pilot/PilotDataVaultPage";
import { AuthSsrProvider, clearClientAuthState, hydrateAuthFromSsr } from "@/lib/auth/authClient";
import * as vaultApi from "@/lib/api/vaultApi.b7b";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a href={to ?? "#"} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    select ? select({ location: { pathname: "/data-vault" } }) : "/data-vault",
  useBlocker: () => ({ status: "idle", reset: vi.fn(), proceed: vi.fn() }),
}));

const SSR_AUTH = {
  checked: true,
  authenticated: true,
  user: {
    id: "usr_owner_alpha",
    name: "Owner Alpha",
    email: "owner.alpha@joinscaleflow.in",
    roleId: "owner" as const,
  },
  idleExpiresAt: null,
  expiresAt: null,
  leadPilotAvailable: true,
};

const MOCK_COVERAGE: vaultApi.VaultCoverageResponse = {
  ok: true,
  coverage: {
    totalEntitiesInventoried: 30,
    verifiedEntitiesCount: 9,
    supportedEntitiesCount: 16,
    unsupportedEntitiesCount: 5,
    liveDatabaseCounts: {
      leads: 3,
      deals: 2,
      payments: 2,
      paymentProofs: 2,
      projects: 1,
      projectTasks: 2,
      quotations: 1,
      salesGoals: 1,
      ownerSettings: 1,
    },
    blockers: [
      {
        id: "blocker-storage-durability",
        severity: "critical",
        title: "Hostinger Private Proof Storage Durability Unverified",
        description: "Ephemeral local filesystem on Hostinger requires S3/R2 object storage.",
        status: "unverified",
      },
      {
        id: "blocker-backup-encryption",
        severity: "warning",
        title: "Backup Archive Encryption Not Implemented",
        description: "Unencrypted plaintext ZIP archives require AES-256-GCM encryption.",
        status: "not-configured",
      },
      {
        id: "blocker-unsupported-entities",
        severity: "warning",
        title: "5 Browser Collections Lack Database Tables",
        description: "Quotation Shares, Demos, Templates, and Rules will not be restored.",
        status: "unsupported",
      },
      {
        id: "blocker-restore-disabled",
        severity: "info",
        title: "Direct Restore Execution Disabled in UI",
        description: "Web UI is strictly preview-only. Restores are CLI-only with safeguards.",
        status: "enforced",
      },
    ],
    inventory: [
      {
        number: 1,
        name: "Leads",
        tableName: "crm_leads",
        status: "verified",
        count: 3,
        description: "Customer records",
      },
      {
        number: 6,
        name: "Deals",
        tableName: "crm_deals",
        status: "verified",
        count: 2,
        description: "Sales opportunities",
      },
      {
        number: 8,
        name: "Payments",
        tableName: "crm_payments",
        status: "verified",
        count: 2,
        description: "Cash ledger",
      },
      {
        number: 10,
        name: "Payment Proof Meta",
        tableName: "crm_payment_proofs",
        status: "verified",
        count: 2,
        description: "Receipt metadata",
      },
      {
        number: 11,
        name: "Payment Proof Binaries",
        tableName: "filesystem/proofs",
        status: "supported",
        count: 2,
        description: "Binary proof files",
      },
      {
        number: 13,
        name: "Quotations & Items",
        tableName: "crm_quotations",
        status: "verified",
        count: 1,
        description: "Quotations",
      },
      {
        number: 15,
        name: "Projects",
        tableName: "crm_projects",
        status: "verified",
        count: 1,
        description: "Delivery workspaces",
      },
      {
        number: 16,
        name: "Project Tasks",
        tableName: "crm_project_tasks",
        status: "verified",
        count: 2,
        description: "Checklists",
      },
      {
        number: 20,
        name: "Owner Settings",
        tableName: "crm_owner_settings",
        status: "verified",
        count: 1,
        description: "Business settings",
      },
      {
        number: 22,
        name: "Sales Goals",
        tableName: "crm_sales_goals",
        status: "verified",
        count: 1,
        description: "Revenue targets",
      },
      {
        number: 26,
        name: "Quotation Shares",
        tableName: null,
        status: "unsupported",
        description: "LocalStorage only",
      },
      {
        number: 27,
        name: "Sales Studio Demos",
        tableName: null,
        status: "unsupported",
        description: "LocalStorage only",
      },
      {
        number: 28,
        name: "WhatsApp Templates",
        tableName: null,
        status: "unsupported",
        description: "LocalStorage only",
      },
      {
        number: 29,
        name: "Automation Rules",
        tableName: null,
        status: "unsupported",
        description: "LocalStorage only",
      },
      {
        number: 30,
        name: "Smart Inbox & Lead Relations",
        tableName: null,
        status: "unsupported",
        description: "LocalStorage only",
      },
    ],
    restoreDisabled: true,
  },
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <AuthSsrProvider value={SSR_AUTH}>{ui}</AuthSsrProvider>
    </QueryClientProvider>
  );
}

describe("Checkpoint B7B: Data Vault Pilot Frontend UI Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClientAuthState();
    hydrateAuthFromSsr(SSR_AUTH);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/vault/coverage")) {
        return new Response(JSON.stringify(MOCK_COVERAGE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/v1/vault/restore")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "RESTORE_EXECUTION_DISABLED",
              message:
                "Direct database restore execution is disabled in the UI. Restore execution is CLI-only with manual safeguards.",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Data Vault pilot header, pilot notice, and hero KPI statistics", async () => {
    render(wrap(<PilotDataVaultPage search={{ pilot: 1 }} />));

    expect(screen.getByRole("heading", { name: /Data Vault \(Pilot\)/i })).toBeInTheDocument();
    expect(
      screen.getByText("DEVELOPMENT DATA VAULT PILOT — MARIADB 11.4 INTEGRATED"),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-Only Restore Simulation")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("30").length).toBeGreaterThan(0); // Inventoried Entities
      expect(screen.getAllByText("9").length).toBeGreaterThan(0); // MariaDB Verified
      expect(screen.getAllByText("16").length).toBeGreaterThan(0); // Supported in Manifest
      expect(screen.getAllByText("5").length).toBeGreaterThan(0); // Browser Only / Deferred
    });
  });

  it("switches to Synthetic Test Backup tab and allows selecting scopes", async () => {
    const downloadSpy = vi.spyOn(vaultApi, "downloadSyntheticBackup").mockResolvedValue({
      filename: "ScaleFlow_Synthetic_Test_Backup_full_2026.zip",
      bytes: 2048,
    });

    render(wrap(<PilotDataVaultPage search={{ pilot: 1 }} />));

    const synthTab = screen.getByRole("tab", { name: /Synthetic test backup/i });
    fireEvent.click(synthTab);

    expect(screen.getByText("Synthetic Test Backup Generator")).toBeInTheDocument();
    expect(screen.getByText("Full Pilot (9 Tables)")).toBeInTheDocument();
    expect(screen.getByText("Sales & Finance Only")).toBeInTheDocument();
    expect(screen.getByText("Projects & Quotations")).toBeInTheDocument();

    const generateBtn = screen.getByRole("button", { name: /Generate & Download Synthetic ZIP/i });
    expect(generateBtn).toBeInTheDocument();

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledWith("full");
    });
  });

  it("switches to Archive Inspector tab and displays dropzone", async () => {
    render(wrap(<PilotDataVaultPage search={{ pilot: 1 }} />));

    const inspectTab = screen.getByRole("tab", { name: /Archive inspector/i });
    fireEvent.click(inspectTab);

    expect(screen.getByText("Archive Inspector & Cryptographic Validator")).toBeInTheDocument();
    expect(screen.getByText("Select a backup ZIP archive to inspect")).toBeInTheDocument();
  });

  it("switches to Restore Dry-Run Preview tab and explains non-destructive safety", async () => {
    render(wrap(<PilotDataVaultPage search={{ pilot: 1 }} />));

    const dryRunTab = screen.getByRole("tab", { name: /Restore dry-run preview/i });
    fireEvent.click(dryRunTab);

    expect(
      screen.getByText("Safe Restore Dry-Run Preview (Read-Only Simulation)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/ZERO database writes or mutations occur/i)).toBeInTheDocument();
  });

  it("tests restore prevention button and asserts HTTP 403 Forbidden enforcement dialog", async () => {
    const forbiddenSpy = vi.spyOn(vaultApi, "verifyRestoreExecutionDisabled").mockResolvedValue({
      ok: false,
      error: {
        code: "RESTORE_EXECUTION_DISABLED",
        message:
          "Direct database restore execution is disabled in the UI. Restore execution is CLI-only with manual safeguards.",
      },
    });

    // Directly set mock dry-run result to display the test button
    render(wrap(<PilotDataVaultPage search={{ tab: "dryrun", pilot: 1 }} />));

    // Upload mock dry-run file to reveal the breakdown and prevention button
    const mockDryRunSpy = vi.spyOn(vaultApi, "runRestoreDryRun").mockResolvedValue({
      ok: true,
      dryRunReport: {
        ok: true,
        dryRun: true,
        mutationsPerformed: 0,
        databaseWritten: false,
        timestamp: new Date().toISOString(),
        sourceManifest: {
          formatVersion: 2,
          schemaVersion: 10,
          type: "full",
          createdAt: new Date().toISOString(),
        },
        actions: {
          leads: { entity: "leads", toCreate: 3, toUpdate: 0, toSkip: 0, conflicts: [] },
          deals: { entity: "deals", toCreate: 2, toUpdate: 0, toSkip: 0, conflicts: [] },
        },
        totalRecordsToCreate: 5,
        totalRecordsToUpdate: 0,
        totalRecordsToSkip: 0,
        unresolvedForeignKeys: [],
        financialReconciliation: {
          reconciled: true,
          sourceTotalPaise: 10000000,
          derivedTotalPaise: 10000000,
          sourceVoidedPaise: 0,
          notes: [],
        },
        attachments: { expected: 2, verified: 2, missing: [] },
        validationErrors: [],
        warnings: [],
      },
    });

    const file = new File(["mock zip bytes"], "backup.zip", { type: "application/zip" });
    const input = document.getElementById("dry-run-archive-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText("Zero Mutations Performed — Simulation Complete"),
      ).toBeInTheDocument();
    });

    const testBtn = screen.getByRole("button", { name: /Test Restore Prevention \(Verify 403\)/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(forbiddenSpy).toHaveBeenCalled();
      expect(screen.getByText("Direct Restore Execution Blocked (HTTP 403)")).toBeInTheDocument();
    });
  });

  it("switches to Readiness & Blockers tab and displays all 4 blocker cards", async () => {
    render(wrap(<PilotDataVaultPage search={{ pilot: 1 }} />));

    const blockersTab = screen.getByRole("tab", { name: /Readiness & blockers/i });
    fireEvent.click(blockersTab);

    expect(
      screen.getByText("Production Readiness & Architecture Blockers Matrix"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("Hostinger Private Proof Storage Durability Unverified"),
      ).toBeInTheDocument();
      expect(screen.getByText("Backup Archive Encryption Not Implemented")).toBeInTheDocument();
      expect(screen.getByText("5 Browser Collections Lack Database Tables")).toBeInTheDocument();
      expect(screen.getByText("Direct Restore Execution Disabled in UI")).toBeInTheDocument();
    });
  });
});
