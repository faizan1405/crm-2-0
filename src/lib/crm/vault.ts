// Data Vault (Phase 3B.5) — pure backup building and validation. Owner-only by design.
// Browser prototype: archives are built locally from the CRM store + IndexedDB proofs.
// Real Owner-only enforcement belongs to the Hostinger backend; hiding UI is not security.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { ProofMeta } from "./attachments";

export const APP_NAME = "Scale Flow Sales OS";
export const FORMAT_VERSION = 1;
export const SCHEMA_VERSION = 3;
export const BUSINESS_TZ = "Asia/Kolkata";

export type CategoryId = "leads" | "activities" | "followups" | "deals" | "payments" | "proofs" | "notes" | "quotations" | "waTemplates" | "demos" | "employees" | "permissions" | "assignments" | "settings";
export interface Category { id: CategoryId; label: string; group: string; desc: string; keys: string[]; file: string; isPrivate?: boolean }

export const CATEGORIES: Category[] = [
  { id: "leads", label: "Leads", group: "Lead management", desc: "Leads, stages, quick statuses, priorities, pins and the Waste / Recently deleted bin.", keys: ["leads", "bin"], file: "data/leads.json" },
  { id: "activities", label: "Activity history", group: "Lead management", desc: "Calls, WhatsApp, stage changes and other logged lead activity.", keys: ["activities", "callOps"], file: "data/lead-activities.json" },
  { id: "followups", label: "Follow-ups", group: "Lead management", desc: "Pending, completed, overdue and cancelled follow-ups with notes.", keys: ["followUps"], file: "data/followups.json" },
  { id: "deals", label: "Deals", group: "Finance", desc: "Deals, quoted/final amounts, milestones and statuses.", keys: ["deals"], file: "data/deals.json" },
  { id: "payments", label: "Payments", group: "Finance", desc: "Every payment incl. voided, methods, dates and references.", keys: ["payments"], file: "data/payments.json" },
  { id: "proofs", label: "Payment proofs", group: "Finance", desc: "Screenshot and PDF proof files with their payment links.", keys: [], file: "data/attachment-metadata.json" },
  { id: "notes", label: "Personal notes", group: "Personal", desc: "All notes with formatting, checklists and pins.", keys: ["notes"], file: "data/personal-notes.json", isPrivate: true },
  { id: "quotations", label: "Quotation templates", group: "Sales Studio", desc: "Package templates, share history and the legacy quotation backup.", keys: ["quotationTemplates", "quotationShares", "legacyQuotations"], file: "data/quotation-templates.json" },
  { id: "waTemplates", label: "WhatsApp templates", group: "Sales Studio", desc: "Message templates and defaults.", keys: ["waTemplates"], file: "data/whatsapp-templates.json" },
  { id: "demos", label: "Demo library", group: "Sales Studio", desc: "Demo links and categories.", keys: ["demos", "demoCategories"], file: "data/demo-library.json" },
  { id: "employees", label: "Employee profiles", group: "Team", desc: "Profiles, roles and account statuses. Never passwords.", keys: ["employees"], file: "data/employees.json" },
  { id: "permissions", label: "Employee permissions", group: "Team", desc: "Permission overrides, lead scope and finance level.", keys: ["employeeAccess"], file: "data/roles-permissions.json" },
  { id: "assignments", label: "Lead assignments", group: "Team", desc: "Current assignments, assignment history and rules.", keys: ["assignments", "assignmentEvents", "assignmentRules", "ruleSettings", "firedRules"], file: "data/lead-assignments.json" },
  { id: "settings", label: "Settings", group: "System", desc: "Workspace preferences, business profile and Daily Briefing state.", keys: ["owner", "email", "business", "theme", "accent", "density", "timeFormat", "dateStyle", "defaultLeadSort", "notifyFollowUps", "notifyPayments", "notifyDigest", "businessProfile", "briefingDone", "briefingDate"], file: "data/settings.json" },
];
export const ALL_CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const EMPLOYEE_CATEGORY_IDS: CategoryId[] = ["leads", "activities", "followups", "deals", "payments", "proofs", "assignments", "employees", "permissions"];

export type BackupType = "full" | "custom" | "employee";
export interface BackupPlan { type: BackupType; categories: CategoryId[]; employeeId?: string }
export type Snapshot = Record<string, unknown>;
export interface ProofInput { meta: ProofMeta; bytes: Uint8Array | null }

/** Only the Owner may use the Data Vault — no role, preset or override can grant it. */
export function canUseVault(actor: "owner" | { roleId: string }, _overrides?: Record<string, boolean>): boolean {
  return actor === "owner";
}

const FORBIDDEN = /pass(word)?|hash|token|secret|session|cookie|api.?key/i;
/** Deep copy without any credential-like keys. */
export function scrub<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !FORBIDDEN.test(k)).map(([k, x]) => [k, scrub(x)])) as T;
  return v;
}

type Rec = { id: string; leadId?: string; dealId?: string };
const arr = (s: Snapshot, k: string) => (Array.isArray(s[k]) ? (s[k] as Rec[]) : []);

/** Restricts a snapshot to one employee's currently assigned leads and records connected to them. */
export function employeeScope(s: Snapshot, employeeId: string): Snapshot {
  const asg = (s.assignments ?? {}) as Record<string, { employeeId: string }>;
  const leadIds = new Set(Object.entries(asg).filter(([, a]) => a.employeeId === employeeId).map(([id]) => id));
  const deals = arr(s, "deals").filter((d) => d.leadId && leadIds.has(d.leadId));
  const dealIds = new Set(deals.map((d) => d.id));
  const byLead = (k: string) => arr(s, k).filter((x) => x.leadId && leadIds.has(x.leadId));
  return {
    leads: arr(s, "leads").filter((l) => leadIds.has(l.id)), bin: [],
    activities: byLead("activities"), callOps: byLead("callOps"), followUps: byLead("followUps"),
    deals, payments: arr(s, "payments").filter((p) => p.dealId && dealIds.has(p.dealId)),
    employees: arr(s, "employees").filter((e) => e.id === employeeId),
    employeeAccess: Object.fromEntries(Object.entries((s.employeeAccess ?? {}) as Record<string, unknown>).filter(([k]) => k === employeeId)),
    assignments: Object.fromEntries(Object.entries(asg).filter(([id]) => leadIds.has(id))),
    assignmentEvents: (arr(s, "assignmentEvents") as unknown as { previousAssigneeId: string | null; newAssigneeId: string | null }[]).filter((e) => e.previousAssigneeId === employeeId || e.newAssigneeId === employeeId),
    assignmentRules: [], ruleSettings: undefined, firedRules: [],
  };
}

function countOf(v: unknown): number { return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v === undefined ? 0 : 1; }

/** Record counts per category for a (possibly scoped) snapshot. */
export function estimate(s: Snapshot, proofs: ProofMeta[], plan: BackupPlan) {
  const src = plan.type === "employee" && plan.employeeId ? employeeScope(s, plan.employeeId) : s;
  const payIds = new Set(arr(src, "payments").map((p) => p.id));
  const scopedProofs = proofs.filter((p) => payIds.has(p.paymentId));
  const counts: Partial<Record<CategoryId, number>> = {};
  for (const c of CATEGORIES) counts[c.id] = c.id === "proofs" ? scopedProofs.length : c.id === "settings" ? (plan.type === "employee" ? 0 : 1) : countOf(src[c.keys[0]]);
  return { counts, proofs: scopedProofs, proofBytes: scopedProofs.reduce((n, p) => n + p.fileSize, 0) };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ManifestFile { path: string; sha256: string; bytes: number }
export interface Manifest {
  app: string; formatVersion: number; schemaVersion: number; createdAt: string; timezone: string;
  type: BackupType; complete: boolean; employee?: { id: string; name: string; scope: "currently-assigned" };
  included: CategoryId[]; omitted: CategoryId[]; counts: Partial<Record<CategoryId, number>>;
  attachments: { expected: number; included: number; missing: string[] };
  relationships: string[]; warnings: string[]; files: ManifestFile[];
}
export interface BuildResult { name: string; bytes: Uint8Array; manifest: Manifest }

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const stamp = (d: Date) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d); const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00"; return `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}`; };
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

/** Builds a ZIP archive. Throws on failure — callers must never report success unless this resolves. */
export async function buildBackup(plan: BackupPlan, state: Snapshot, proofInputs: ProofInput[], now = new Date()): Promise<BuildResult> {
  const cats = CATEGORIES.filter((c) => plan.categories.includes(c.id) && !(plan.type === "employee" && c.id === "settings"));
  if (!cats.length) throw new Error("Choose at least one category to back up.");
  const emp = plan.type === "employee" ? arr(state, "employees").find((e) => e.id === plan.employeeId) as (Rec & { name: string }) | undefined : undefined;
  if (plan.type === "employee" && !emp) throw new Error("That employee no longer exists.");
  const src = scrub(emp ? employeeScope(state, emp.id) : state);
  const files: Record<string, Uint8Array> = {};
  const counts: Manifest["counts"] = {};
  const warnings: string[] = [], relationships: string[] = [];
  const put = (path: string, data: unknown) => { files[path] = strToU8(JSON.stringify(data, null, 2)); };

  for (const c of cats) {
    if (c.id === "proofs") continue;
    const data = Object.fromEntries(c.keys.map((k) => [k, src[k] ?? null]));
    put(c.file, data);
    counts[c.id] = c.id === "settings" ? 1 : countOf(src[c.keys[0]]);
  }
  const ids = (k: string) => new Set(arr(src, k).map((x) => x.id));
  if (plan.categories.includes("payments") && !plan.categories.includes("deals")) {
    const need = new Set(arr(src, "payments").map((p) => p.dealId));
    put("data/relationships.json", { deals: arr(src, "deals").filter((d) => need.has(d.id)).map((d) => { const x = d as Rec & { name?: string; clientName?: string }; return { id: x.id, name: x.name, clientName: x.clientName, leadId: x.leadId }; }) });
    relationships.push("Minimal deal references (id, name, client) were added so payments stay understandable.");
  }
  if (plan.categories.includes("followups") && !plan.categories.includes("leads")) relationships.push("Follow-ups reference lead IDs; lead records were not selected.");

  let missing: string[] = [], included = 0, expected = 0;
  if (plan.categories.includes("proofs")) {
    const payIds = ids("payments").size ? ids("payments") : new Set(arr(state, "payments").map((p) => p.id));
    const inScope = proofInputs.filter((p) => (emp ? ids("payments").has(p.meta.paymentId) : payIds.has(p.meta.paymentId) || true));
    expected = inScope.length;
    const meta: (ProofMeta & { path: string | null; sha256: string | null })[] = [];
    for (const p of inScope) {
      if (!p.bytes || p.bytes.byteLength === 0 || p.bytes.byteLength !== p.meta.fileSize) { missing.push(p.meta.paymentId); meta.push({ ...p.meta, path: null, sha256: null }); continue; }
      const path = `files/payment-proofs/${safeName(p.meta.paymentId)}__${safeName(p.meta.originalFileName)}`;
      files[path] = p.bytes; included++;
      meta.push({ ...p.meta, path, sha256: await sha256(p.bytes) });
    }
    put("data/attachment-metadata.json", { attachments: meta });
    counts.proofs = included;
    if (missing.length) warnings.push(`${missing.length} payment proof file${missing.length === 1 ? " is" : "s are"} missing or unreadable and could not be included.`);
  }
  missing = [...new Set(missing)];
  const omitted = ALL_CATEGORY_IDS.filter((id) => !cats.some((c) => c.id === id));
  const complete = plan.type === "full" && omitted.length === 0 && missing.length === 0;
  if (plan.type === "full" && !complete) warnings.push("This archive is NOT a complete backup.");
  if (plan.type === "employee") relationships.push("Employee scope: leads currently assigned to this employee and records linked to them. Previously reassigned leads are only listed in assignment history.");

  const fileList: ManifestFile[] = [];
  for (const [path, b] of Object.entries(files)) fileList.push({ path, sha256: await sha256(b), bytes: b.byteLength });
  const manifest: Manifest = {
    app: APP_NAME, formatVersion: FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: now.toISOString(), timezone: BUSINESS_TZ,
    type: plan.type, complete, ...(emp ? { employee: { id: emp.id, name: emp.name, scope: "currently-assigned" as const } } : {}),
    included: cats.map((c) => c.id), omitted, counts, attachments: { expected, included, missing }, relationships, warnings, files: fileList,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["backup-summary.html"] = strToU8(summaryHtml(manifest));
  const label = emp ? `Employee_${safeName(emp.name)}` : plan.type === "full" ? "Full" : "Custom";
  return { name: `ScaleFlow_Backup_${label}_${stamp(now)}.zip`, bytes: zipSync(files, { level: 6 }), manifest };
}

export function summaryHtml(m: Manifest): string {
  const rows = m.included.map((id) => `<tr><td>${esc(CATEGORIES.find((c) => c.id === id)!.label)}</td><td>${m.counts[id] ?? 0}</td></tr>`).join("");
  const status = m.complete ? "Complete backup" : m.type === "full" ? "Incomplete — see warnings" : "Partial export";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(APP_NAME)} backup</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1c2421}h1{font-size:24px}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #e3e6e2}td:last-child{text-align:right}.s{display:inline-block;padding:4px 10px;border-radius:99px;background:${m.complete ? "#e2f2e8" : "#fbefd9"}}</style>
<h1>${esc(APP_NAME)} — backup summary</h1><p>Created ${esc(new Date(m.createdAt).toLocaleString("en-IN", { timeZone: m.timezone }))} (${esc(m.timezone)}) · type: ${esc(m.type)}${m.employee ? ` · employee: ${esc(m.employee.name)}` : ""}</p><p class="s">${status}</p>
<table>${rows}</table><p>Attachments: ${m.attachments.included} of ${m.attachments.expected} included.</p>
${m.warnings.length ? `<h2>Warnings</h2><ul>${m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${m.relationships.length ? `<h2>Notes</h2><ul>${m.relationships.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
<p><small>This page is for reading only. The JSON files in /data are the recovery source of truth.</small></p></html>`;
}

export interface ValidationReport { ok: boolean; errors: string[]; warnings: string[]; manifest?: Manifest; restoreAvailable: false }

/** Read-only inspection. Never modifies CRM data. */
export async function validateBackup(bytes: Uint8Array): Promise<ValidationReport> {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (e: string): ValidationReport => ({ ok: false, errors: [e], warnings, restoreAvailable: false });
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { return fail("This file isn't a readable ZIP archive. It may be damaged or not a Scale Flow backup."); }
  if (!files["manifest.json"]) return fail("No manifest.json found — this isn't a Scale Flow backup.");
  let m: Manifest;
  try { m = JSON.parse(strFromU8(files["manifest.json"])); } catch { return fail("The manifest is damaged and can't be read."); }
  if (m.app !== APP_NAME) return fail("This archive was made by a different application.");
  if (m.formatVersion !== FORMAT_VERSION) return { ok: false, errors: [`Backup format version ${m.formatVersion} isn't supported by this app (supports version ${FORMAT_VERSION}).`], warnings, manifest: m, restoreAvailable: false };
  if (m.schemaVersion > SCHEMA_VERSION) warnings.push(`Made by a newer CRM schema (v${m.schemaVersion}).`);
  for (const f of m.files ?? []) {
    const b = files[f.path];
    if (!b) { errors.push(`Missing file: ${f.path}`); continue; }
    if (b.byteLength !== f.bytes || (await sha256(b)) !== f.sha256) errors.push(`File failed its integrity check: ${f.path}`);
  }
  const read = (p: string) => { try { return files[p] ? JSON.parse(strFromU8(files[p])) : null; } catch { errors.push(`Unreadable data: ${p}`); return null; } };
  const deals = read("data/deals.json")?.deals ?? read("data/relationships.json")?.deals ?? null;
  const pays = read("data/payments.json")?.payments as Rec[] | undefined;
  if (pays && deals) { const d = new Set((deals as Rec[]).map((x) => x.id)); const orphan = pays.filter((p) => !d.has(p.dealId!)).length; if (orphan) warnings.push(`${orphan} payment${orphan === 1 ? "" : "s"} reference deals not in this archive.`); }
  if (m.attachments?.missing?.length) warnings.push(`${m.attachments.missing.length} proof file(s) were already missing when this backup was made.`);
  if (!m.complete) warnings.push(m.type === "full" ? "Marked incomplete when created." : "Partial export — not a complete CRM backup.");
  return { ok: errors.length === 0, errors, warnings, manifest: m, restoreAvailable: false };
}

export interface BackupRecord {
  id: string; name: string; type: BackupType; createdAt: string; categories: CategoryId[];
  records: number; attachments: number; sizeBytes: number; employeeName?: string;
  /** Only substantiated states: generated + downloaded on this device, self-verified, or failed. */
  status: "downloaded" | "partial" | "failed"; verified: boolean; error?: string;
}
export const recordCount = (m: Manifest) => Object.entries(m.counts).filter(([k]) => k !== "proofs" && k !== "settings").reduce((n, [, v]) => n + (v ?? 0), 0);

// ---------- Future Hostinger contracts (not implemented in the browser) ----------
export interface BackupService {
  listCategories(): Promise<Category[]>;
  createBackup(plan: BackupPlan): Promise<{ ok: true; jobId: string } | { ok: false; reason: "backend_required" | "forbidden"; message: string }>;
  getStatus(jobId: string): Promise<{ state: "queued" | "running" | "ready" | "failed"; manifest?: Manifest }>;
  download(jobId: string): Promise<Blob>;
  validate(file: Blob): Promise<ValidationReport>;
  previewRestore(file: Blob): Promise<{ creates: number; updates: number; conflicts: number }>;
  executeRestore(file: Blob, confirmToken: string): Promise<{ ok: boolean; safetySnapshotId?: string }>;
}
