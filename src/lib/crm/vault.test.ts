import { describe, expect, it } from "vitest";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { ALL_CATEGORY_IDS, buildBackup, canUseVault, employeeScope, estimate, validateBackup, type Snapshot } from "./vault";

const meta = (paymentId: string, size: number) => ({ attachmentId: "a_" + paymentId, paymentId, originalFileName: "proof.png", mimeType: "image/png" as const, fileSize: size, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const state: Snapshot = {
  leads: [{ id: "L1", name: "A" }, { id: "L2", name: "B" }], bin: [],
  activities: [{ id: "a1", leadId: "L1" }, { id: "a2", leadId: "L2" }], callOps: [],
  followUps: [{ id: "f1", leadId: "L1" }, { id: "f2", leadId: "L2" }],
  deals: [{ id: "D1", leadId: "L1", name: "Site", clientName: "A" }, { id: "D2", leadId: "L2", name: "App", clientName: "B" }],
  payments: [{ id: "P1", dealId: "D1" }, { id: "P2", dealId: "D2" }],
  notes: [{ id: "n1", title: "secret plan" }], quotationTemplates: [], quotationShares: [], legacyQuotations: [], waTemplates: [], demos: [], demoCategories: [],
  employees: [{ id: "E1", name: "Rahul", email: "r@x.in", password: "leak", passwordHash: "h", sessionToken: "t" }, { id: "E2", name: "Sana" }],
  employeeAccess: { E1: { scope: "assigned" }, E2: { scope: "all" } },
  assignments: { L1: { employeeId: "E1" }, L2: { employeeId: "E2" } },
  assignmentEvents: [{ id: "ev1", leadId: "L1", previousAssigneeId: null, newAssigneeId: "E1" }, { id: "ev2", leadId: "L2", previousAssigneeId: null, newAssigneeId: "E2" }],
  assignmentRules: [], ruleSettings: {}, firedRules: [], owner: "F", email: "f@x.in", businessProfile: { name: "" }, briefingDone: [], briefingDate: "",
};
const proofs = [{ meta: meta("P1", png.length), bytes: png }, { meta: meta("P2", png.length), bytes: png }];
const read = (zip: Uint8Array, p: string) => JSON.parse(strFromU8(unzipSync(zip)[p]!));

describe("Data Vault backups", () => {
  it("full backup includes every module, proofs, and is complete", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, state, proofs);
    expect(r.manifest.complete).toBe(true);
    expect(r.manifest.omitted).toEqual([]);
    expect(r.manifest.counts.leads).toBe(2);
    expect(r.manifest.attachments).toEqual({ expected: 2, included: 2, missing: [] });
    const files = unzipSync(r.bytes);
    expect(Object.keys(files).filter((k) => k.startsWith("files/payment-proofs/"))).toHaveLength(2);
    expect(read(r.bytes, "data/attachment-metadata.json").attachments[0].paymentId).toBe("P1");
    expect(read(r.bytes, "data/payments.json").payments[0].dealId).toBe("D1");
    expect(files["backup-summary.html"]).toBeTruthy();
  });
  it("never exports passwords, hashes or tokens", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, state, proofs);
    const all = Object.entries(unzipSync(r.bytes)).filter(([k]) => k.endsWith(".json")).map(([, v]) => strFromU8(v)).join("");
    expect(all).not.toMatch(/leak|passwordHash|sessionToken/);
  });
  it("missing proof file makes a full backup incomplete, not successful", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, state, [proofs[0]!, { meta: meta("P2", 7), bytes: null }]);
    expect(r.manifest.complete).toBe(false);
    expect(r.manifest.attachments.missing).toEqual(["P2"]);
  });
  it("custom backup excludes unselected private notes and is labelled partial", async () => {
    const r = await buildBackup({ type: "custom", categories: ["leads", "payments"] }, state, []);
    const files = unzipSync(r.bytes);
    expect(files["data/personal-notes.json"]).toBeUndefined();
    expect(r.manifest.complete).toBe(false);
    expect(read(r.bytes, "data/relationships.json").deals.map((d: { id: string }) => d.id)).toEqual(["D1", "D2"]);
  });
  it("empty selection is rejected", async () => {
    await expect(buildBackup({ type: "custom", categories: [] }, state, [])).rejects.toThrow();
  });
  it("employee backup holds only currently assigned leads and linked records", async () => {
    const s = employeeScope(state, "E1");
    expect((s["leads"] as { id: string }[]).map((l) => l.id)).toEqual(["L1"]);
    expect((s["payments"] as { id: string }[]).map((p) => p.id)).toEqual(["P1"]);
    expect(Object.keys(s["employeeAccess"] as object)).toEqual(["E1"]);
    expect((s["assignmentEvents"] as unknown[]).length).toBe(1);
    const r = await buildBackup({ type: "employee", categories: ["leads", "payments", "proofs", "employees"], employeeId: "E1" }, state, proofs);
    expect(r.manifest.employee?.name).toBe("Rahul");
    expect(r.manifest.attachments.included).toBe(1);
    expect(estimate(state, proofs.map((p) => p.meta), { type: "employee", categories: ["leads"], employeeId: "E2" }).counts.leads).toBe(1);
  });
  it("only the Owner can use the vault, regardless of role or overrides", () => {
    expect(canUseVault("owner")).toBe(true);
    expect(canUseVault({ roleId: "sales_manager" }, { "vault:manage": true })).toBe(false);
  });
});

describe("Backup validation", () => {
  it("recognises a valid archive and offers no restore", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, state, proofs);
    const v = await validateBackup(r.bytes);
    expect(v.ok).toBe(true);
    expect(v.restoreAvailable).toBe(false);
  });
  it("rejects corrupt archives", async () => {
    expect((await validateBackup(new Uint8Array([1, 2, 3]))).ok).toBe(false);
  });
  it("reports missing and tampered files", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, state, proofs);
    const f = unzipSync(r.bytes);
    delete f["data/leads.json"]; f["data/deals.json"] = strToU8("{}");
    const v = await validateBackup(zipSync(f));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Missing file: data\/leads.json/);
    expect(v.errors.join(" ")).toMatch(/integrity/);
  });
  it("explains unsupported versions", async () => {
    const v = await validateBackup(zipSync({ "manifest.json": strToU8(JSON.stringify({ app: "Scale Flow Sales OS", formatVersion: 9 })) }));
    expect(v.errors[0]).toMatch(/version 9 isn't supported/);
  });
});

describe("B1.5B.1 attachment-byte integrity", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 TEST PAYMENT PROOF — NOT A REAL TRANSACTION");
  const voided: Snapshot = { ...state, payments: [{ id: "P1", dealId: "D1" }, { id: "P2", dealId: "D2" }, { id: "P3", dealId: "D1", voided: true } as never] };
  const inputs = [{ meta: meta("P1", png.length), bytes: png }, { meta: { ...meta("P2", pdf.length), originalFileName: "proof.pdf", mimeType: "application/pdf" as const }, bytes: pdf }];
  const edit = async (fn: (f: Record<string, Uint8Array>) => void) => { const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, inputs); const f = unzipSync(r.bytes); fn(f); return validateBackup(zipSync(f)); };
  const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");

  it("stores exact proof bytes resolvable from each payment", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, inputs);
    const f = unzipSync(r.bytes);
    for (const a of read(r.bytes, "data/attachment-metadata.json").attachments) {
      const src = inputs.find((i) => i.meta.paymentId === a.paymentId)!.bytes;
      expect(Array.from(f[a.path]!)).toEqual(Array.from(src));
      expect(a.sha256).toBe(await sha(src));
    }
  });
  it("keeps voided payments and adds no duplicates", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, inputs);
    const p = read(r.bytes, "data/payments.json").payments as { id: string; voided?: boolean }[];
    expect(p.map((x) => x.id)).toEqual(["P1", "P2", "P3"]);
    expect(p[2]!.voided).toBe(true);
    expect(r.manifest.counts.payments).toBe(3);
  });
  it("detects a proof whose bytes were swapped even if the manifest was rewritten", async () => {
    const v = await edit((f) => {
      const k = Object.keys(f).find((x) => x.endsWith("proof.pdf"))!; f[k] = new TextEncoder().encode("%PDF-1.4 TAMPERED PAYMENT PROOF — NOT REAL!!");
      const m = JSON.parse(strFromU8(f["manifest.json"]!)); m.files = m.files.filter((x: { path: string }) => x.path !== k); f["manifest.json"] = strToU8(JSON.stringify(m));
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/checksum|not listed/);
  });
  it("detects a proof file removed from the archive", async () => {
    const v = await edit((f) => { delete f[Object.keys(f).find((x) => x.endsWith("proof.png"))!]; });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/proof\.png/);
  });
  it("detects invalid payment references and a false complete claim", async () => {
    const v = await edit((f) => {
      const a = JSON.parse(strFromU8(f["data/attachment-metadata.json"]!)); a.attachments[0].paymentId = "P404"; f["data/attachment-metadata.json"] = strToU8(JSON.stringify(a));
      const m = JSON.parse(strFromU8(f["manifest.json"]!)); m.files = m.files.filter((x: { path: string }) => x.path !== "data/attachment-metadata.json"); m.attachments.missing = ["P2"]; f["manifest.json"] = strToU8(JSON.stringify(m));
    });
    expect(v.errors.join(" ")).toMatch(/P404/);
    expect(v.errors.join(" ")).toMatch(/claims a complete backup/);
  });
  it("missing binary: archive is partial, names the payment, keeps the record and still validates honestly", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, [inputs[0]!, { meta: inputs[1]!.meta, bytes: null }]);
    expect(r.manifest.complete).toBe(false);
    expect(r.manifest.attachments.missing).toEqual(["P2"]);
    expect(read(r.bytes, "data/payments.json").payments).toHaveLength(3);
    const v = await validateBackup(r.bytes);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/missing when this backup was made/);
    expect(v.warnings.join(" ")).toMatch(/Marked incomplete/);
  });
  it("repeat backups have identical record content and validation never mutates input", async () => {
    const before = JSON.stringify(voided);
    const a = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, inputs, new Date("2026-10-24T00:00:00Z"));
    const b = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, voided, inputs, new Date("2026-10-25T00:00:00Z"));
    const strip = (x: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(x)).filter(([k]) => k.startsWith("data/") || k.startsWith("files/")).map(([k, v]) => [k, strFromU8(v)]));
    expect(strip(a.bytes)).toEqual(strip(b.bytes));
    await validateBackup(a.bytes);
    expect(JSON.stringify(voided)).toBe(before);
  });
});
