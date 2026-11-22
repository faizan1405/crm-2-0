import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  BROWSER_CRM_STORAGE_KEY,
  BROWSER_SIDEBAR_COLLAPSED_KEY,
  BROWSER_SIDEBAR_GROUPS_KEY,
  exportBrowserCrmSnapshot,
} from "@/lib/crm/browserExport";
import type { ProofMeta } from "@/lib/crm/attachments";
import { analyzeMigrationSource } from "@/server/migration/index.server";

function makeSyntheticPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
  ]);
}

describe("Checkpoint B13B: Read-Only Browser Storage Export & Round-Trip Validation", () => {
  it("refuses to read or export browser storage without explicit ownerConfirmed=true", async () => {
    const getItemSpy = vi.fn(() => null);
    await expect(
      exportBrowserCrmSnapshot({
        ownerConfirmed: false,
        storage: { getItem: getItemSpy },
      }),
    ).rejects.toThrow(/Explicit Owner confirmation/i);
    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it("exports synthetic scale-flow-crm-2-demo, scale-flow-payment-proofs, and sidebar prefs read-only and round-trips through B13 migration analysis", async () => {
    const pngBytes = makeSyntheticPng();
    const syntheticStoreBlob = JSON.stringify({
      version: 7,
      state: {
        leads: [
          {
            id: "br_lead_1",
            name: "Browser Export Client",
            phone: "+91 98111 22233",
            status: "won",
            createdAt: "2026-09-01T06:00:00.000Z",
          },
        ],
        deals: [
          {
            id: "br_deal_1",
            leadId: "br_lead_1",
            name: "Browser Export Website",
            value: "50000.75",
            status: "won",
            createdAt: "2026-09-02T06:00:00.000Z",
          },
        ],
        payments: [
          {
            id: "br_pay_1",
            dealId: "br_deal_1",
            amount: "25000.25",
            method: "upi",
            date: "2026-09-03",
            createdAt: "2026-09-03T06:00:00.000Z",
          },
        ],
        notes: [{ id: "n1", title: "Private owner note" }],
        demos: [{ id: "d1", title: "Demo site link" }],
        employees: [{ id: "emp1", name: "Team Member", passwordHash: "should_be_scrubbed" }],
        teamEvents: [{ id: "te1", type: "lead.created" }],
        savedReports: [{ id: "rep1", name: "Monthly Pipeline" }],
      },
    });

    const backingMap = new Map<string, string>([
      [BROWSER_CRM_STORAGE_KEY, syntheticStoreBlob],
      [BROWSER_SIDEBAR_GROUPS_KEY, JSON.stringify(["sales", "finance"])],
      [BROWSER_SIDEBAR_COLLAPSED_KEY, "0"],
    ]);

    const readOnlyStorage = {
      getItem: (key: string) => backingMap.get(key) ?? null,
    };

    const meta: ProofMeta = {
      attachmentId: "br_att_1",
      paymentId: "br_pay_1",
      originalFileName: "upi-receipt.png",
      mimeType: "image/png",
      fileSize: pngBytes.byteLength,
      createdAt: "2026-09-03T06:05:00.000Z",
      updatedAt: "2026-09-03T06:05:00.000Z",
    };

    const syntheticProofRepo = {
      list: async () => [meta],
      get: async (paymentId: string) =>
        paymentId === "br_pay_1"
          ? { meta, blob: new Blob([pngBytes as unknown as BlobPart], { type: "image/png" }) }
          : null,
    };

    const exported = await exportBrowserCrmSnapshot({
      ownerConfirmed: true,
      storage: readOnlyStorage,
      proofRepo: syntheticProofRepo,
    });

    expect(exported.summary.ok).toBe(true);
    expect(exported.summary.browserStorageModified).toBe(false);
    expect(exported.summary.crmStoreFound).toBe(true);
    expect(exported.summary.crmStoreVersion).toBe(7);
    expect(exported.summary.proofsExpected).toBe(1);
    expect(exported.summary.proofsIncluded).toBe(1);
    expect(exported.summary.uiPreferencesIncluded).toBe(true);
    expect(exported.summary.storageKeysInspected).toEqual([
      "scale-flow-crm-2-demo",
      "scale-flow-payment-proofs",
      "scale-flow-sidebar-groups",
      "scale-flow-sidebar-collapsed",
    ]);

    // Verify backing storage was completely unmodified
    expect(backingMap.get(BROWSER_CRM_STORAGE_KEY)).toBe(syntheticStoreBlob);

    // Verify UI preferences & credential scrubbing inside ZIP
    const unzipped = unzipSync(exported.zipBytes);
    expect(unzipped["data/ui-preferences.json"]).toBeDefined();
    const employeesJson = strFromU8(unzipped["data/employees.json"]!);
    expect(employeesJson).not.toContain("should_be_scrubbed");

    // Round-trip the exported ZIP directly into the B13 Migration Analysis Engine!
    const { report } = analyzeMigrationSource({
      source: exported.zipBytes,
      sourceFilename: exported.summary.filename,
      ownerUserId: "usr_owner_b13b",
    });

    expect(report.ok).toBe(true);
    expect(report.financialReconciliation.financialParityPassed).toBe(true);
    expect(report.financialReconciliation.mappedDealsTotalPaise).toBe(5000075);
    expect(report.financialReconciliation.mappedActivePaymentsPaise).toBe(2500025);
    expect(report.financialReconciliation.totalOutstandingPaise).toBe(2500050);
    expect(report.proofVerification.verified).toBe(1);
    expect(report.proofVerification.failed).toBe(0);

    // All 5 deferred collections explicitly reported with disposition & archivePath
    expect(report.deferredCollections).toHaveLength(5);
    const byKey = Object.fromEntries(report.deferredCollections.map((d) => [d.collection, d]));
    expect(byKey["notes"]?.disposition).toBe("preserve_legacy_archive");
    expect(byKey["demos"]?.disposition).toBe("preserve_legacy_archive");
    expect(byKey["savedReports"]?.disposition).toBe("preserve_legacy_archive");
    expect(byKey["employees"]?.disposition).toBe("defer_unsupported_feature");
    expect(byKey["teamEvents"]?.disposition).toBe("defer_unsupported_feature");
  });
});
