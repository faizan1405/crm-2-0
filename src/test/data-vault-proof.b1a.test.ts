import "fake-indexeddb/auto";
import { unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { readBytes } from "@/lib/crm/attachments";
import { idbProofRepo } from "@/lib/crm/proofRepo";
import { useCRM } from "@/lib/crm/store";
import {
  ALL_CATEGORY_IDS,
  buildBackup,
  validateBackup,
  type ProofInput,
  type Snapshot,
} from "@/lib/crm/vault";

function snapshotFromStore(): Snapshot {
  return Object.fromEntries(
    Object.entries(useCRM.getState()).filter(([, value]) => typeof value !== "function"),
  );
}

describe("B1A Data Vault discrepancy verification — IndexedDB proofs in ZIP export", () => {
  beforeEach(async () => {
    for (const meta of await idbProofRepo.list()) {
      await idbProofRepo.remove(meta.paymentId);
    }
    useCRM.getState().reset();
  });

  it("packages synthetic IndexedDB payment-proof binaries into ZIP and passes SHA-256 verification", async () => {
    const store = useCRM.getState();
    const targetPayment = store.payments.find((p) => !p.voided) ?? store.payments[0];
    expect(targetPayment).toBeDefined();

    const syntheticPdfBytes = new TextEncoder().encode(
      "%PDF-1.4 SYNTHETIC B1A PAYMENT PROOF — NOT REAL OWNER DATA",
    );
    const savedMeta = await idbProofRepo.put(
      targetPayment!.id,
      new Blob([syntheticPdfBytes], { type: "application/pdf" }),
      "synthetic-receipt-b1a.pdf",
      "application/pdf",
    );

    const metas = await idbProofRepo.list();
    const proofInputs: ProofInput[] = await Promise.all(
      metas.map(async (meta) => {
        const record = await idbProofRepo.get(meta.paymentId);
        return {
          meta,
          bytes: record ? new Uint8Array(await readBytes(record.blob)) : null,
        };
      }),
    );

    const backup = await buildBackup(
      { type: "full", categories: ALL_CATEGORY_IDS, actor: "owner" },
      snapshotFromStore(),
      proofInputs,
      new Date("2026-11-09T10:30:00Z"),
    );

    expect(backup.manifest.complete).toBe(true);
    expect(backup.manifest.attachments).toEqual({
      expected: 1,
      included: 1,
      missing: [],
    });

    const entries = unzipSync(backup.bytes);
    const expectedPath = `files/payment-proofs/${targetPayment!.id}__synthetic-receipt-b1a.pdf`;
    expect(entries[expectedPath]).toBeDefined();
    expect(Array.from(entries[expectedPath]!)).toEqual(Array.from(syntheticPdfBytes));

    const attachmentMetaJson = JSON.parse(strFromU8(entries["data/attachment-metadata.json"]!)) as {
      attachments: Array<{
        attachmentId: string;
        paymentId: string;
        path: string;
        sha256: string;
      }>;
    };
    expect(attachmentMetaJson.attachments).toHaveLength(1);
    expect(attachmentMetaJson.attachments[0]).toMatchObject({
      attachmentId: savedMeta.attachmentId,
      paymentId: targetPayment!.id,
      path: expectedPath,
    });

    const validation = await validateBackup(backup.bytes);
    expect(validation.ok).toBe(true);
    expect(validation.classification).toBe("complete");
    expect(validation.errors).toEqual([]);
  });
});
