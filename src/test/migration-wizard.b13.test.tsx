import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PilotMigrationWizard } from "@/components/pilot/PilotMigrationWizard";

vi.mock("@/lib/auth/authClient", () => ({
  useResolvedAuthState: () => ({
    status: "authenticated",
    user: { id: "usr_owner_1", email: "owner@example.test", name: "Owner", roleId: "owner" },
  }),
}));

describe("Checkpoint B13: PilotMigrationWizard UI & Browser Storage Isolation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem("scale-flow-crm-v2", JSON.stringify({ sentinel: "untouched" }));
  });

  it("renders Hostinger-exclusive pre-flight, runs synthetic shadow test, shows locked cutover gate, and never modifies localStorage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/vault/migration/readiness")) {
        return new Response(
          JSON.stringify({
            ok: true,
            wizardVersion: "b13.1",
            hostingProvider: "hostinger_exclusive",
            cloudflareR2Required: false,
            proofStorageDriver: "mariadb-blob",
            liveExecutionLocked: true,
            liveExecutionLockReason: "Locked pending Owner approval.",
            supportedSourceFormats: ["data-vault-zip", "legacy-json-snapshot"],
            mappedEntityCount: 27,
            deferredCollectionCount: 5,
            hostingerQuotaPolicy: {
              quotaMiB: 3072,
              warningThresholdMiB: 1536,
              hardStopThresholdMiB: 2150,
              safetyMarginMiB: 16,
            },
            guardrails: [
              {
                id: "hostinger_only",
                label: "Hostinger-exclusive target (Cloudflare R2 not required)",
                enforced: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/vault/migration/synthetic-shadow-test")) {
        return new Response(
          JSON.stringify({
            ok: true,
            shadowReport: {
              ok: true,
              executedAt: "2026-11-22T09:00:00.000Z",
              durationMs: 14,
              mode: "synthetic_in_memory_shadow",
              syntheticDataOnly: true,
              realDatabaseTouched: false,
              crmV1Touched: false,
              browserStorageTouched: false,
              hostingPolicy: {
                provider: "hostinger_exclusive",
                cloudflareR2Required: false,
                proofStorageDriver: "mariadb-blob",
              },
              analysisSummary: {
                totalSourceRecords: 34,
                totalValidRecords: 34,
                financialParityPassed: true,
                activePaymentsInr: "₹61,728.40",
                voidedPaymentsInr: "₹10,000.00",
                dealsBookedInr: "₹1,43,456.77",
                outstandingInr: "₹81,728.37",
                proofsVerified: 2,
                projectedHostingerQuotaPercent: 0.54,
              },
              pass1InsertedCounts: { crm_leads: 4 },
              pass2SkippedCounts: { crm_leads: 4 },
              pass2InsertedTotal: 0,
              rollbackVerified: true,
              rollbackResidualRows: 0,
              assertions: [
                {
                  id: "financial_parity",
                  name: "Exact Integer-Paise Financial Parity (0 Paise Delta)",
                  passed: true,
                  detail: "0 paise delta verified.",
                },
              ],
              errors: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PilotMigrationWizard />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Hostinger-Exclusive Migration Architecture")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare R2 Not Required")).toBeInTheDocument();

    // Trigger Synthetic Shadow Test
    fireEvent.click(screen.getByRole("button", { name: /Run Synthetic Shadow Test/i }));

    await waitFor(() => {
      expect(
        screen.getByText("All Synthetic Shadow Migration Assertions Passed"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Exact Integer-Paise Financial Parity (0 Paise Delta)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Live Production / Remote Data Migration Is Locked"),
    ).toBeInTheDocument();

    // Verify existing browser storage was NEVER modified
    expect(window.localStorage.getItem("scale-flow-crm-v2")).toBe(
      JSON.stringify({ sentinel: "untouched" }),
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});
