import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const PREVIEW_SCRIPT = path.resolve(process.cwd(), "scripts/b13c-offline-migration-preview.mjs");

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

describe("Checkpoint B14B: B14A Origin Export <-> B13C Offline Preview Round-Trip Compatibility", () => {
  it("parses scale-flow-b14a-origin-readonly-v1 JSON including inline base64 PNG & PDF proofs and exact finances", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-b14b-export-"));
    const exportPath = path.join(tmpDir, "ScaleFlow_Origin_ReadOnly_Export_synth.json");

    // Valid PNG (magic bytes 89 50 4E 47) and PDF (magic bytes 25 50 44 46) >= 12 bytes
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");

    const exportPayload = {
      exportFormat: "scale-flow-b14a-origin-readonly-v1",
      exportedAt: "2026-11-22T12:00:00.000Z",
      origin: "https://preview.synthetic.example.invalid",
      browserStorageModified: false,
      crmStoreFound: true,
      version: 10,
      state: {
        leads: [
          {
            id: "lead_synth_1",
            name: "Synthetic Roundtrip Lead",
            phone: "+91 98201 99999",
            status: "Won",
            source: "Website",
            priority: "Hot",
          },
        ],
        bin: [],
        activities: [{ id: "act_1", leadId: "lead_synth_1", type: "note", text: "Synth" }],
        followUps: [{ id: "fu_1", leadId: "lead_synth_1", dueDate: "2026-11-25" }],
        callLogs: [{ id: "call_1", leadId: "lead_synth_1" }],
        whatsAppLogs: [],
        deals: [
          {
            id: "deal_synth_1",
            leadId: "lead_synth_1",
            name: "Synth Website Build",
            value: 50000,
            status: "active",
          },
        ],
        payments: [
          { id: "pay_synth_1", dealId: "deal_synth_1", amount: 20000, voided: false },
          { id: "pay_synth_2", dealId: "deal_synth_1", amount: 10000, voided: false },
        ],
        quotations: [{ id: "qt_1" }],
        projects: [{ id: "proj_1" }],
        projectTasks: [{ id: "task_1" }],
        goals: [{ id: "goal_1" }],
        notes: [{ id: "note_1", title: "Owner Note" }],
        demos: [{ id: "demo_1" }],
        employees: [],
        teamEvents: [],
        savedReports: [{ id: "rep_1" }],
      },
      attachments: [
        {
          attachmentId: "proof_synth_1",
          paymentId: "pay_synth_1",
          originalFileName: "receipt-1.png",
          mimeType: "image/png",
          fileSize: pngBytes.byteLength,
          sha256: sha256Hex(pngBytes),
          contentBase64: pngBytes.toString("base64"),
        },
        {
          attachmentId: "proof_synth_2",
          paymentId: "pay_synth_2",
          originalFileName: "receipt-2.pdf",
          mimeType: "application/pdf",
          fileSize: pdfBytes.byteLength,
          sha256: sha256Hex(pdfBytes),
          contentBase64: pdfBytes.toString("base64"),
        },
      ],
      uiPreferences: {
        "scale-flow-sidebar-groups": { sales: true },
        "scale-flow-sidebar-collapsed": "false",
      },
    };

    fs.writeFileSync(exportPath, JSON.stringify(exportPayload, null, 2), "utf8");

    try {
      const stdout = execFileSync(process.execPath, [PREVIEW_SCRIPT, "--file", exportPath], {
        encoding: "utf8",
      });
      const report = JSON.parse(stdout) as {
        ok: boolean;
        sourceFormat: string;
        entityCounts: Record<string, number>;
        financialSummary: {
          wonActiveDealsInr: string;
          activePaymentsInr: string;
          outstandingInr: string;
          financialErrors: string[];
        };
        paymentProofs: { expected: number; verified: number; failed: number };
        deferredCollections: Array<{ collection: string; count: number }>;
      };

      expect(report.ok).toBe(true);
      expect(report.sourceFormat).toBe("b14a-origin-readonly-json");
      expect(report.entityCounts["leads"]).toBe(1);
      expect(report.entityCounts["deals"]).toBe(1);
      expect(report.entityCounts["payments"]).toBe(2);
      expect(report.entityCounts["paymentProofs"]).toBe(2);
      expect(report.financialSummary.wonActiveDealsInr).toBe("₹50,000.00");
      expect(report.financialSummary.activePaymentsInr).toBe("₹30,000.00");
      expect(report.financialSummary.outstandingInr).toBe("₹20,000.00");
      expect(report.financialSummary.financialErrors).toEqual([]);
      expect(report.paymentProofs).toEqual({ expected: 2, verified: 2, failed: 0 });
      expect(report.deferredCollections.find((d) => d.collection === "notes")?.count).toBe(1);
      expect(report.deferredCollections.find((d) => d.collection === "savedReports")?.count).toBe(
        1,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects corrupted inline base64 payment-proof SHA-256 checksums and fails closed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-b14b-corrupt-"));
    const exportPath = path.join(tmpDir, "corrupt.json");
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);

    fs.writeFileSync(
      exportPath,
      JSON.stringify({
        exportFormat: "scale-flow-b14a-origin-readonly-v1",
        state: { leads: [], deals: [], payments: [] },
        attachments: [
          {
            attachmentId: "proof_bad",
            paymentId: "pay_bad",
            sha256: "0".repeat(64),
            contentBase64: pngBytes.toString("base64"),
          },
        ],
      }),
      "utf8",
    );

    let failedExit = false;
    let parsedOutput: { ok?: boolean; paymentProofs?: { failed: number } } = {};
    try {
      execFileSync(process.execPath, [PREVIEW_SCRIPT, "--file", exportPath], { encoding: "utf8" });
    } catch (err) {
      failedExit = true;
      const e = err as { stdout?: string };
      parsedOutput = JSON.parse(e.stdout ?? "{}") as {
        ok?: boolean;
        paymentProofs?: { failed: number };
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    expect(failedExit).toBe(true);
    expect(parsedOutput.ok).toBe(false);
    expect(parsedOutput.paymentProofs?.failed).toBe(1);
  });
});
