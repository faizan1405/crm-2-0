import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOMES_API,
  CLIENT_TYPES_API,
  LEAD_LIFECYCLE_API,
  LEAD_PRIORITIES_API,
  LEAD_SOURCES_API,
  PAYMENT_METHODS_API,
  PAYMENT_TYPES_API,
  PROJECT_STAGES_API,
} from "../lib/api/schemas";
import { isValidProofStorageKey } from "./storage/proofStorage.server";
import { analyzeMigrationSource, buildSyntheticMigrationZip } from "./migration/index.server";

describe("Checkpoint B13C: Canonical Enum Regression, Proof Storage Key & Offline Preview Parity", () => {
  it("normalizes all legacy enums to strict CRM V2 Zod API contracts and produces valid prf_ proof storage keys", () => {
    const { zipBytes, filename } = buildSyntheticMigrationZip();
    const { report, mapped } = analyzeMigrationSource({
      source: zipBytes,
      sourceFilename: filename,
      ownerUserId: "usr_owner_b13c",
    });

    expect(report.ok).toBe(true);

    // 1. Lead source, priority, lifecycleStatus
    for (const lead of [...mapped.leads, ...mapped.archivedLeads]) {
      expect(LEAD_SOURCES_API).toContain(lead["source"]);
      expect(LEAD_PRIORITIES_API).toContain(lead["priority"]);
      expect(LEAD_LIFECYCLE_API).toContain(lead["lifecycleStatus"]);
    }
    expect(mapped.archivedLeads[0]?.["lifecycleStatus"]).toBe("waste");

    // 2. Call Log outcome & required MariaDB columns
    for (const call of mapped.callLogs) {
      expect(CALL_OUTCOMES_API).toContain(call["outcome"]);
      expect(typeof call["connected"]).toBe("boolean");
      expect(call["recordingSource"]).toBe("user_recorded");
      expect(typeof call["leadActivityId"]).toBe("string");
      expect(typeof call["occurredIstDate"]).toBe("string");
      expect(typeof call["occurredIstTime"]).toBe("string");
    }

    // 3. Follow-up required MariaDB columns
    for (const fu of mapped.followUps) {
      expect(typeof fu["dueIstTime"]).toBe("string");
      expect(fu["createdByUserId"]).toBe("usr_owner_b13c");
    }

    // 4. Deal clientType & canonical storage status
    const validDealStorageStatuses = ["active", "completed", "on_hold", "cancelled"];
    for (const deal of mapped.deals) {
      expect(CLIENT_TYPES_API).toContain(deal["clientType"]);
      expect(validDealStorageStatuses).toContain(deal["status"]);
    }

    // 5. Payment method & paymentType
    for (const pay of mapped.payments) {
      expect(PAYMENT_METHODS_API).toContain(pay["method"]);
      expect(PAYMENT_TYPES_API).toContain(pay["paymentType"]);
    }

    // 6. Project stage ("dev" -> "development")
    for (const proj of mapped.projects) {
      expect(PROJECT_STAGES_API).toContain(proj["stage"]);
    }

    // 7. Payment proof storageKey satisfies strict SAFE_STORAGE_KEY_RE (no "/" slashes!)
    expect(mapped.paymentProofs.length).toBeGreaterThan(0);
    for (const proof of mapped.paymentProofs) {
      expect(proof.storageKey).toMatch(/^prf_/);
      expect(proof.storageKey).not.toContain("/");
      expect(isValidProofStorageKey(proof.storageKey)).toBe(true);
      expect(proof["activePaymentLock"]).toBe(proof.paymentId);
      expect(proof["storageStatus"]).toBe("verified");
      expect(mapped.proofBinaries.has(proof.storageKey)).toBe(true);
    }
  });

  it("detects duplicate normalized 10-digit phone numbers across imported leads", () => {
    const snapshot = {
      leads: [
        {
          id: "l1",
          name: "Lead One",
          phone: "+91 98201 55555",
          status: "new",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "l2",
          name: "Lead Two",
          phone: "9820155555",
          status: "contacted",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    };
    const { report } = analyzeMigrationSource({
      source: snapshot,
      ownerUserId: "usr_owner_b13c",
    });

    expect(report.duplicatePhones).toHaveLength(1);
    expect(report.duplicatePhones?.[0]?.phoneKey).toBe("9820155555");
    expect(report.duplicatePhones?.[0]?.leadIds).toEqual(["l1", "l2"]);
  });

  it("runs scripts/b13c-offline-migration-preview.mjs completely offline on a synthetic ZIP", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "b13c-offline-"));
    const zipPath = path.join(tmpDir, "synthetic-preview.zip");
    try {
      const { zipBytes } = buildSyntheticMigrationZip();
      fs.writeFileSync(zipPath, zipBytes);

      const scriptPath = path.resolve(process.cwd(), "scripts/b13c-offline-migration-preview.mjs");
      const out = execFileSync(process.execPath, [scriptPath, "--file", zipPath], {
        encoding: "utf8",
      });
      const parsed = JSON.parse(out) as Record<string, unknown>;

      expect(parsed["ok"]).toBe(true);
      expect(parsed["offlineLocalPreview"]).toBe(true);
      expect(parsed["networkCallsMade"]).toBe(0);
      expect(parsed["databaseWritten"]).toBe(false);
      expect(parsed["cloudflareR2Required"]).toBe(false);
      expect((parsed["paymentProofs"] as Record<string, number>)["verified"]).toBe(2);
      expect((parsed["deferredCollections"] as unknown[]).length).toBe(5);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
