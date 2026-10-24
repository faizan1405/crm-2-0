import { describe, expect, it } from "vitest";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { ALL_CATEGORY_IDS, LIMITS, VAULT_DENIED, buildBackup, entryPathError, validateBackup, type Snapshot } from "./vault";

const png = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);
const meta = (paymentId: string) => ({ attachmentId: "att_" + paymentId, paymentId, originalFileName: "proof.png", mimeType: "image/png" as const, fileSize: png.length, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
const leads = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "U1", "U2"].map((id) => ({ id, name: id, notes: "lead note " + id }));
const asg = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([l, e]) => [l, { employeeId: e }]));
const base: Snapshot = {
  leads, bin: [], activities: leads.map((l) => ({ id: "act_" + l.id, leadId: l.id, type: "call" })), callOps: [],
  followUps: leads.map((l) => ({ id: "fu_" + l.id, leadId: l.id })),
  deals: [{ id: "D_A1", leadId: "A1", name: "Site", clientName: "A1" }, { id: "D_B1", leadId: "B1", name: "App", clientName: "B1" }],
  payments: [{ id: "P_A1", dealId: "D_A1" }, { id: "P_B1", dealId: "D_B1" }],
  notes: [{ id: "n1", title: "OWNER PRIVATE" }], quotationTemplates: [], quotationShares: [], legacyQuotations: [], waTemplates: [], demos: [], demoCategories: [],
  employees: [{ id: "EA", name: "Emp A", password: "pw-leak" }, { id: "EB", name: "Emp B" }],
  employeeAccess: { EA: { scope: "assigned" }, EB: { scope: "assigned" } },
  assignments: asg({ A1: "EA", A2: "EA", A3: "EA", A4: "EA", A5: "EA", B1: "EB", B2: "EB", B3: "EB", B4: "EB" }),
  assignmentEvents: [], assignmentRules: [], ruleSettings: {}, firedRules: [], teamEvents: [{ id: "te1" }],
  tagDefs: [{ id: "t1", name: "VIP" }], leadTags: { A1: ["t1"], B1: ["t1"] }, customFields: [], fieldValues: {},
  projects: [{ id: "PR1", leadId: "A1", dealId: "D_A1", ownerId: "EA", memberIds: [], notes: "owner-only" }],
  projectTasks: [{ id: "T1", projectId: "PR1" }, { id: "T2", projectId: "PR1" }], projectMilestones: [], projectTemplates: [], supportRequests: [],
  owner: "F", businessProfile: { name: "" },
};
const proofs = [{ meta: meta("P_A1"), bytes: png }, { meta: meta("P_B1"), bytes: png }];
const read = (z: Uint8Array, p: string) => JSON.parse(strFromU8(unzipSync(z)[p]!));
const files = async (plan: Parameters<typeof buildBackup>[0], s = base) => unzipSync((await buildBackup(plan, s, proofs)).bytes);
const rezip = async (fn: (f: Record<string, Uint8Array>) => void) => { const f = await files({ type: "full", categories: ALL_CATEGORY_IDS }); fn(f); return validateBackup(zipSync(f)); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editJson = (f: Record<string, Uint8Array>, p: string, fn: (j: any) => void) => { const j = JSON.parse(strFromU8(f[p]!)); fn(j); f[p] = strToU8(JSON.stringify(j)); };
const unlist = (f: Record<string, Uint8Array>, p: string) => editJson(f, "manifest.json", (m) => { m.files = m.files.filter((x: { path: string }) => x.path !== p); });

describe("B1.5B.2 selective backups", () => {
  it("includes only the chosen categories with preserved IDs, and no finance, proofs or private notes", async () => {
    const r = await buildBackup({ type: "custom", categories: ["leads", "activities", "followups"] }, base, proofs);
    const f = unzipSync(r.bytes);
    expect(Object.keys(f).sort()).toEqual(["backup-summary.html", "data/followups.json", "data/lead-activities.json", "data/leads.json", "manifest.json"]);
    expect(read(r.bytes, "data/leads.json").leads.map((l: { id: string }) => l.id)).toEqual(leads.map((l) => l.id));
    expect(read(r.bytes, "data/leads.json").leads[0].notes).toBe("lead note A1");
    expect(r.manifest.counts).toEqual({ leads: 11, activities: 11, followups: 11 });
    expect(r.manifest.classification).toBe("selective");
    expect(r.name).toMatch(/_Selective_/);
  });
  it("deals + payments + proofs keep exact bytes and need no lead records", async () => {
    const r = await buildBackup({ type: "custom", categories: ["deals", "payments", "proofs"] }, base, proofs);
    const f = unzipSync(r.bytes);
    expect(f["data/leads.json"]).toBeUndefined();
    expect(Array.from(f["files/payment-proofs/P_A1__proof.png"]!)).toEqual(Array.from(png));
    expect(r.manifest.relationships.join(" ")).toMatch(/Deals reference lead IDs/);
    expect((await validateBackup(r.bytes)).classification).toBe("selective");
  });
  it("classifies complete, selective, incomplete-full and damaged archives distinctly", async () => {
    expect((await validateBackup((await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, base, proofs)).bytes)).classification).toBe("complete");
    expect((await validateBackup((await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, base, [proofs[0]!, { meta: meta("P_B1"), bytes: null }])).bytes)).classification).toBe("incomplete-full");
    const sel = await validateBackup((await buildBackup({ type: "custom", categories: ["leads"] }, base, [])).bytes);
    expect(sel.ok).toBe(true); expect(sel.classification).toBe("selective");
    expect((await rezip((f) => { delete f["data/leads.json"]; })).classification).toBe("damaged");
  });
});

describe("B1.5B.2 employee-assigned backups", () => {
  it("Employee A gets exactly A's five leads and their linked records only", async () => {
    const r = await buildBackup({ type: "employee", categories: ["leads", "activities", "followups", "deals", "payments", "proofs", "employees", "customization", "projects"], employeeId: "EA" }, base, proofs);
    expect(read(r.bytes, "data/leads.json").leads.map((l: { id: string }) => l.id)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(r.manifest.employee?.leadIds).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(read(r.bytes, "data/payments.json").payments.map((p: { id: string }) => p.id)).toEqual(["P_A1"]);
    expect(Object.keys(unzipSync(r.bytes)).filter((k) => k.startsWith("files/"))).toEqual(["files/payment-proofs/P_A1__proof.png"]);
    expect(Object.keys(read(r.bytes, "data/crm-customization.json").leadTags)).toEqual(["A1"]);
  });
  it("excludes owner notes, other employees, credentials, team events and settings", async () => {
    const f = await files({ type: "employee", categories: ALL_CATEGORY_IDS, employeeId: "EA" });
    expect(f["data/personal-notes.json"] ? read(zipSync(f), "data/personal-notes.json").notes ?? [] : []).toEqual([]);
    const all = Object.entries(f).filter(([k]) => k.endsWith(".json")).map(([, v]) => strFromU8(v)).join("");
    expect(all).not.toMatch(/OWNER PRIVATE|pw-leak|Emp B|owner-only|"te1"/);
    expect(f["data/settings.json"]).toBeUndefined();
  });
  it("reassignment moves the lead to B's next backup without duplicates", async () => {
    const s = { ...base, assignments: { ...(base["assignments"] as object), A5: { employeeId: "EB" } } };
    const a = await buildBackup({ type: "employee", categories: ["leads"], employeeId: "EA" }, s, []);
    const b = await buildBackup({ type: "employee", categories: ["leads"], employeeId: "EB" }, s, []);
    const ids = (r: typeof a) => read(r.bytes, "data/leads.json").leads.map((l: { id: string }) => l.id);
    expect(ids(a)).toEqual(["A1", "A2", "A3", "A4"]);
    expect(ids(b)).toEqual(["A5", "B1", "B2", "B3", "B4"]);
  });
  it("a lead outside the declared employee scope fails verification", async () => {
    const f = await files({ type: "employee", categories: ["leads"], employeeId: "EA" });
    editJson(f, "data/leads.json", (j) => j.leads.push({ id: "U1" })); unlist(f, "data/leads.json");
    editJson(f, "manifest.json", (m) => { m.counts.leads = 6; });
    expect((await validateBackup(zipSync(f))).errors.join(" ")).toMatch(/U1 is outside/);
  });
});

describe("B1.5B.2 relationships", () => {
  it("full backup keeps Lead → Deal → Project → Task and Payment → Proof links", async () => {
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, base, proofs);
    const pj = read(r.bytes, "data/projects.json");
    expect(pj.projects[0]).toMatchObject({ id: "PR1", leadId: "A1", dealId: "D_A1" });
    expect(pj.projectTasks.map((t: { projectId: string }) => t.projectId)).toEqual(["PR1", "PR1"]);
    expect(read(r.bytes, "data/payments.json").payments).toHaveLength(2);
    expect((await validateBackup(r.bytes)).ok).toBe(true);
  });
  it("flags a payment whose deal is missing and a task whose project is missing", async () => {
    const v = await rezip((f) => {
      editJson(f, "data/payments.json", (j) => { j.payments[0].dealId = "D_GONE"; }); unlist(f, "data/payments.json");
      editJson(f, "data/projects.json", (j) => { j.projectTasks[0].projectId = "PR_GONE"; }); unlist(f, "data/projects.json");
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/P_A1 references deal D_GONE/);
    expect(v.errors.join(" ")).toMatch(/T1 references project PR_GONE/);
  });
});

describe("B1.5B.2 damaged and unsafe archives", () => {
  it("rejects a truncated ZIP", async () => {
    const z = (await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, base, proofs)).bytes;
    const v = await validateBackup(z.slice(0, Math.floor(z.length / 2)));
    expect(v.ok).toBe(false); expect(v.classification).toBe("damaged"); expect(v.errors[0]).toMatch(/truncated/);
  });
  it("rejects inconsistent counts and missing manifest metadata", async () => {
    expect((await rezip((f) => editJson(f, "manifest.json", (m) => { m.counts.leads = 99; }))).errors.join(" ")).toMatch(/Leads count \(99\)/);
    expect((await rezip((f) => editJson(f, "manifest.json", (m) => { delete m.files; delete m.type; }))).errors[0]).toMatch(/required metadata: type, files/);
  });
  it("detects proof bytes changed without a checksum update", async () => {
    const v = await rezip((f) => { f["files/payment-proofs/P_A1__proof.png"] = new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]); });
    expect(v.errors.join(" ")).toMatch(/P_A1__proof.png/);
  });
  it("detects duplicate attachment IDs and shared paths", async () => {
    const v = await rezip((f) => { editJson(f, "data/attachment-metadata.json", (j) => { j.attachments[1].attachmentId = j.attachments[0].attachmentId; j.attachments[1].path = j.attachments[0].path; }); unlist(f, "data/attachment-metadata.json"); });
    expect(v.errors.join(" ")).toMatch(/Duplicate attachment ID/);
    expect(v.errors.join(" ")).toMatch(/share the archive path/);
  });
  it("rejects duplicate ZIP entry paths instead of letting one overwrite another", async () => {
    const z = zipSync({ "manifest.json": strToU8("{}"), "data/aaaa.json": strToU8("[1]"), "data/bbbb.json": strToU8("[2]") }, { level: 0 });
    const from = strToU8("data/bbbb.json"), to = strToU8("data/aaaa.json");
    for (let i = 0; i <= z.length - from.length; i++) if (from.every((c, j) => z[i + j] === c)) z.set(to, i);
    const v = await validateBackup(z);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Duplicate archive entry: data\/aaaa.json/);
  });
  it("blocks traversal, absolute and unexpected paths", async () => {
    expect(entryPathError("../evil.json")).toMatch(/traversal/);
    expect(entryPathError("data/../../x.json")).toMatch(/traversal/);
    expect(entryPathError("/etc/passwd")).toMatch(/absolute/);
    expect(entryPathError("C:/x.json")).toMatch(/absolute/);
    expect(entryPathError("data\\x.json")).toMatch(/absolute/);
    expect(entryPathError("scripts/run.sh")).toMatch(/Unexpected/);
    const v = await validateBackup(zipSync({ "manifest.json": strToU8("{}"), "../evil.json": strToU8("x") }));
    expect(v.ok).toBe(false); expect(v.errors[0]).toMatch(/traversal/);
  });
  it("refuses oversized entries and suspicious compression ratios before extracting", async () => {
    const big = new Uint8Array(LIMITS.maxEntryBytes + 1);
    expect((await validateBackup(zipSync({ "data/leads.json": big }, { level: 9 }))).errors[0]).toMatch(/25 MB per-file limit/);
    const bomb = new Uint8Array(5 * 1024 * 1024);
    expect((await validateBackup(zipSync({ "data/leads.json": bomb }, { level: 9 }))).errors[0]).toMatch(/compression ratio/);
  });
  it("verification never mutates the archive bytes or the source snapshot", async () => {
    const before = JSON.stringify(base);
    const z = (await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, base, proofs)).bytes;
    const copy = Array.from(z);
    const v = await validateBackup(z);
    expect(v.restoreAvailable).toBe(false);
    expect(Array.from(z)).toEqual(copy);
    expect(JSON.stringify(base)).toBe(before);
  });
  it("only the Owner can build backups", async () => {
    await expect(buildBackup({ type: "full", categories: ALL_CATEGORY_IDS, actor: { roleId: "sales_manager" } }, base, proofs)).rejects.toThrow(VAULT_DENIED);
    await expect(buildBackup({ type: "custom", categories: ["leads"], actor: "owner" }, base, [])).resolves.toBeTruthy();
  });
});
