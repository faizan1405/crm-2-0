// Data Vault (Phase 3B.5) — pure backup building and validation. Owner-only by design.
// Browser prototype: archives are built locally from the CRM store + IndexedDB proofs.
// Real Owner-only enforcement belongs to the Hostinger backend; hiding UI is not security.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { ProofMeta } from "./attachments";

export const APP_NAME = "Scale Flow Sales OS";
export const FORMAT_VERSION = 1;
export const SCHEMA_VERSION = 7;
export const BUSINESS_TZ = "Asia/Kolkata";

export type CategoryId = "leads" | "activities" | "followups" | "deals" | "payments" | "proofs" | "notes" | "quotations" | "waTemplates" | "demos" | "employees" | "permissions" | "assignments" | "teamActivity" | "inbox" | "automation" | "performance" | "customization" | "projects" | "analytics" | "settings";
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
  { id: "teamActivity", label: "Team activity & notifications", group: "Team", desc: "Owner activity timeline events, notification preferences and read status. Demo simulation events are never included.", keys: ["teamEvents", "notifyPrefs", "notifyReads"], file: "data/team-activity.json" },
  { id: "inbox", label: "Smart Inbox & duplicates", group: "Lead management", desc: "Inbox review status, duplicate flags, Keep Separate / Related decisions. Source and first-contact data are in Leads and Activity history.", keys: ["inboxMeta", "leadRelations"], file: "data/lead-inbox.json" },
  { id: "automation", label: "Automation Studio", group: "Team", desc: "Automation rules and status, settings, reminders and the full execution history (automation-origin markers included).", keys: ["automationRules", "automationSettings", "reminders", "automationRuns"], file: "data/automation.json" },
  { id: "performance", label: "Sales goals & scorecards", group: "Team", desc: "Goal definitions, individual and team goal assignments, full revision history, goal alerts and scorecard settings. Demo performance data is never included.", keys: ["goals", "goalRevisions", "goalAlerts", "perfPrefs"], file: "data/sales-goals.json" },
  { id: "projects", label: "Project Desk", group: "Delivery", desc: "Projects with their Lead and Deal links, templates, tasks, milestones, assignments, requirements, dependencies, reference links, delivery records, support periods and support requests, Project custom field definitions (archived ones included) and typed values, Project tag links, plus full project history. Tag definitions are in Custom fields, tags & views; Project automation rules and history are in Automation Studio. Money stays in Deals and Payments — never duplicated. No project file uploads exist yet.", keys: ["projects", "projectTasks", "projectMilestones", "projectTemplates", "supportRequests", "projectFields", "projectFieldValues", "projectTags"], file: "data/projects.json" },
  { id: "customization", label: "Custom fields, tags & views", group: "Lead management", desc: "Custom field definitions with options, visibility and history, every stored field value, tags, lead–tag links, saved views with their filters and visibility, and pin/default preferences.", keys: ["customFields", "fieldValues", "tagDefs", "leadTags", "savedViews", "viewPrefs"], file: "data/crm-customization.json" },
  { id: "analytics", label: "Analytics Studio", group: "System", desc: "Saved report definitions with their filters, pins and favourites, forecast stage probabilities with their full change history, and expected close dates. Report results and chart data are not stored — they are rebuilt from your records.", keys: ["savedReports", "forecastConfig", "forecastHistory", "expectedClose"], file: "data/analytics-settings.json" },
  { id: "settings", label: "Settings", group: "System", desc: "Workspace preferences, business profile and Daily Briefing state.", keys: ["owner", "email", "business", "theme", "accent", "density", "timeFormat", "dateStyle", "defaultLeadSort", "notifyFollowUps", "notifyPayments", "notifyDigest", "businessProfile", "briefingDone", "briefingDate"], file: "data/settings.json" },
];
export const ALL_CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const EMPLOYEE_CATEGORY_IDS: CategoryId[] = ["projects", "customization", "leads", "activities", "followups", "deals", "payments", "proofs", "assignments", "employees", "permissions"];

export type BackupType = "full" | "custom" | "employee";
export interface BackupPlan { type: BackupType; categories: CategoryId[]; employeeId?: string; /** Who asked. Anyone but the Owner is refused (frontend service check; backend must re-enforce). */ actor?: "owner" | { roleId: string } }
export const VAULT_DENIED = "Only the Owner can create or verify backups.";
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
  const asg = (s["assignments"] ?? {}) as Record<string, { employeeId: string }>;
  const leadIds = new Set(Object.entries(asg).filter(([, a]) => a.employeeId === employeeId).map(([id]) => id));
  const deals = arr(s, "deals").filter((d) => d.leadId && leadIds.has(d.leadId));
  const dealIds = new Set(deals.map((d) => d.id));
  const byLead = (k: string) => arr(s, k).filter((x) => x.leadId && leadIds.has(x.leadId));
  return {
    leads: arr(s, "leads").filter((l) => leadIds.has(l.id)), bin: [],
    activities: byLead("activities"), callOps: byLead("callOps"), followUps: byLead("followUps"),
    deals, payments: arr(s, "payments").filter((p) => p.dealId && dealIds.has(p.dealId)),
    employees: arr(s, "employees").filter((e) => e.id === employeeId),
    employeeAccess: Object.fromEntries(Object.entries((s["employeeAccess"] ?? {}) as Record<string, unknown>).filter(([k]) => k === employeeId)),
    assignments: Object.fromEntries(Object.entries(asg).filter(([id]) => leadIds.has(id))),
    assignmentEvents: (arr(s, "assignmentEvents") as unknown as { previousAssigneeId: string | null; newAssigneeId: string | null }[]).filter((e) => e.previousAssigneeId === employeeId || e.newAssigneeId === employeeId),
    assignmentRules: [], ruleSettings: undefined, firedRules: [],
    customFields: s["customFields"] ?? [],
    fieldValues: Object.fromEntries(Object.entries((s["fieldValues"] ?? {}) as Record<string, unknown>).filter(([id]) => leadIds.has(id))),
    tagDefs: s["tagDefs"] ?? [],
    leadTags: Object.fromEntries(Object.entries((s["leadTags"] ?? {}) as Record<string, unknown>).filter(([id]) => leadIds.has(id))),
    savedViews: (arr(s, "savedViews") as unknown as { ownerId: string; visibility: string }[]).filter((v) => v.ownerId === employeeId || v.visibility !== "personal"), viewPrefs: {},
    ...(() => {
      const projects = (arr(s, "projects") as unknown as { id: string; ownerId: string | null; memberIds: string[] }[]).filter((p) => p.ownerId === employeeId || p.memberIds?.includes(employeeId)).map((p) => ({ ...p, notes: undefined }));
      const pids = new Set(projects.map((p) => p.id));
      const byP = (k: string) => (arr(s, k) as unknown as { projectId: string }[]).filter((x) => pids.has(x.projectId));
      const pf = (arr(s, "projectFields") as unknown as { id: string; visibility: string }[]).filter((f) => f.visibility === "team"); const pfIds = new Set(pf.map((f) => f.id));
      const pfv = Object.fromEntries(Object.entries((s["projectFieldValues"] ?? {}) as Record<string, Record<string, unknown>>).filter(([id]) => pids.has(id)).map(([id, row]) => [id, Object.fromEntries(Object.entries(row).filter(([k]) => pfIds.has(k)))]));
      const ptg = Object.fromEntries(Object.entries((s["projectTags"] ?? {}) as Record<string, unknown>).filter(([id]) => pids.has(id)));
      return { projects, projectTasks: byP("projectTasks"), projectMilestones: byP("projectMilestones"), supportRequests: byP("supportRequests"), projectTemplates: s["projectTemplates"] ?? [], projectFields: pf, projectFieldValues: pfv, projectTags: ptg };
    })(),
  };
}

function countOf(v: unknown): number { return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v === undefined ? 0 : 1; }

/** Record counts per category for a (possibly scoped) snapshot. */
export function estimate(s: Snapshot, proofs: ProofMeta[], plan: BackupPlan) {
  const src = plan.type === "employee" && plan.employeeId ? employeeScope(s, plan.employeeId) : s;
  const payIds = new Set(arr(src, "payments").map((p) => p.id));
  const scopedProofs = proofs.filter((p) => payIds.has(p.paymentId));
  const counts: Partial<Record<CategoryId, number>> = {};
  for (const c of CATEGORIES) counts[c.id] = c.id === "proofs" ? scopedProofs.length : c.id === "settings" ? (plan.type === "employee" ? 0 : 1) : c.id === "analytics" ? (plan.type === "employee" ? 0 : countOf(src["savedReports"])) : countOf(src[c.keys[0]!]);
  return { counts, proofs: scopedProofs, proofBytes: scopedProofs.reduce((n, p) => n + p.fileSize, 0) };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ManifestFile { path: string; sha256: string; bytes: number }
export interface Manifest {
  app: string; formatVersion: number; schemaVersion: number; createdAt: string; timezone: string;
  type: BackupType; complete: boolean; classification?: Classification; employee?: { id: string; name: string; scope: "currently-assigned"; leadIds?: string[] };
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
  if (plan.actor !== undefined && !canUseVault(plan.actor)) throw new Error(VAULT_DENIED);
  const cats = CATEGORIES.filter((c) => plan.categories.includes(c.id) && !(plan.type === "employee" && (c.id === "settings" || c.id === "analytics")));
  if (!cats.length) throw new Error("Choose at least one category to back up.");
  const emp = plan.type === "employee" ? arr(state, "employees").find((e) => e.id === plan.employeeId) as (Rec & { name: string }) | undefined : undefined;
  if (plan.type === "employee" && !emp) throw new Error("That employee no longer exists.");
  const raw = emp ? employeeScope(state, emp.id) : state;
  // Custom field values are keyed by Owner-chosen field ids (e.g. "cf_session_date"); they are business data, not credentials, so they bypass the key scrubber.
  const src: Snapshot = { ...scrub(raw), ...(raw["fieldValues"] !== undefined ? { fieldValues: raw["fieldValues"] } : {}), ...(raw["projectFieldValues"] !== undefined ? { projectFieldValues: raw["projectFieldValues"] } : {}) };
  const files: Record<string, Uint8Array> = {};
  const counts: Manifest["counts"] = {};
  const warnings: string[] = [], relationships: string[] = [];
  const put = (path: string, data: unknown) => { files[path] = strToU8(JSON.stringify(data, null, 2)); };

  for (const c of cats) {
    if (c.id === "proofs") continue;
    const data = Object.fromEntries(c.keys.map((k) => [k, src[k] ?? null]));
    put(c.file, data);
    counts[c.id] = c.id === "settings" ? 1 : countOf(src[c.keys[0]!]);
  }
  const ids = (k: string) => new Set(arr(src, k).map((x) => x.id));
  if (plan.categories.includes("payments") && !plan.categories.includes("deals")) {
    const need = new Set(arr(src, "payments").map((p) => p.dealId));
    put("data/relationships.json", { deals: arr(src, "deals").filter((d) => need.has(d.id)).map((d) => { const x = d as Rec & { name?: string; clientName?: string }; return { id: x.id, name: x.name, clientName: x.clientName, leadId: x.leadId }; }) });
    relationships.push("Minimal deal references (id, name, client) were added so payments stay understandable.");
  }
  if (plan.type === "custom") relationships.push("Selective Backup: only the chosen categories are included. Unselected categories are intentionally omitted — this is not a full-account recovery backup.");
  if (plan.categories.includes("proofs") && !plan.categories.includes("payments")) relationships.push("Payment proofs reference payment IDs; payment records were not selected.");
  if (plan.categories.includes("deals") && !plan.categories.includes("leads") && arr(src, "deals").some((d) => d.leadId)) relationships.push("Deals reference lead IDs; lead records were not selected.");
  if (plan.categories.includes("followups") && !plan.categories.includes("leads")) relationships.push("Follow-ups reference lead IDs; lead records were not selected.");

  const missing: string[] = []; let included = 0, expected = 0;
  if (plan.categories.includes("proofs")) {
    const scoped = ids("payments");
    const inScope = emp ? proofInputs.filter((p) => scoped.has(p.meta.paymentId)) : proofInputs;
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
  const omitted = ALL_CATEGORY_IDS.filter((id) => !cats.some((c) => c.id === id));
  const complete = plan.type === "full" && omitted.length === 0 && missing.length === 0;
  if (plan.type === "full" && !complete) warnings.push("This archive is NOT a complete backup.");
  if (plan.type === "employee") relationships.push("Employee scope: leads currently assigned to this employee and records linked to them. Previously reassigned leads are only listed in assignment history.");

  const fileList: ManifestFile[] = [];
  for (const [path, b] of Object.entries(files)) fileList.push({ path, sha256: await sha256(b), bytes: b.byteLength });
  const manifest: Manifest = {
    app: APP_NAME, formatVersion: FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: now.toISOString(), timezone: BUSINESS_TZ,
    type: plan.type, complete, classification: plan.type === "employee" ? "employee" : plan.type === "custom" ? "selective" : complete ? "complete" : "incomplete-full",
    ...(emp ? { employee: { id: emp.id, name: emp.name, scope: "currently-assigned" as const, leadIds: arr(src, "leads").map((l) => l.id) } } : {}),
    included: cats.map((c) => c.id), omitted, counts, attachments: { expected, included, missing }, relationships, warnings, files: fileList,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["backup-summary.html"] = strToU8(summaryHtml(manifest));
  const label = emp ? `Employee_${safeName(emp.name)}` : plan.type === "full" ? "Full" : "Selective";
  return { name: `ScaleFlow_Backup_${label}_${stamp(now)}.zip`, bytes: zipSync(files, { level: 6 }), manifest };
}

export function summaryHtml(m: Manifest): string {
  const rows = m.included.map((id) => `<tr><td>${esc(CATEGORIES.find((c) => c.id === id)!.label)}</td><td>${m.counts[id] ?? 0}</td></tr>`).join("");
  const status = m.complete ? "Complete backup" : m.type === "full" ? "Incomplete — see warnings" : m.type === "employee" ? "Employee-assigned backup (partial by design)" : "Selective backup (partial by design)";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(APP_NAME)} backup</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1c2421}h1{font-size:24px}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #e3e6e2}td:last-child{text-align:right}.s{display:inline-block;padding:4px 10px;border-radius:99px;background:${m.complete ? "#e2f2e8" : "#fbefd9"}}</style>
<h1>${esc(APP_NAME)} — backup summary</h1><p>Created ${esc(new Date(m.createdAt).toLocaleString("en-IN", { timeZone: m.timezone }))} (${esc(m.timezone)}) · type: ${esc(m.type)}${m.employee ? ` · employee: ${esc(m.employee.name)}` : ""}</p><p class="s">${status}</p>
<table>${rows}</table><p>Attachments: ${m.attachments.included} of ${m.attachments.expected} included.</p>
${m.warnings.length ? `<h2>Warnings</h2><ul>${m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${m.relationships.length ? `<h2>Notes</h2><ul>${m.relationships.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
<p><small>This page is for reading only. The JSON files in /data are the recovery source of truth.</small></p></html>`;
}

/** How a verified archive should be described. "damaged" covers any failed check. */
export type Classification = "complete" | "selective" | "employee" | "incomplete-full" | "damaged";
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  complete: "Valid complete backup",
  selective: "Valid Selective Backup — partial by design, not a full-account recovery backup",
  employee: "Valid Employee-assigned backup — partial by design, not a full-account recovery backup",
  "incomplete-full": "Intact, but an INCOMPLETE full backup (marked incomplete when created)",
  damaged: "Failed verification — damaged, unsafe or inconsistent archive",
};

export interface ValidationReport { ok: boolean; errors: string[]; warnings: string[]; manifest?: Manifest; restoreAvailable: false; classification: Classification }

/** Limits applied from ZIP headers before anything is decompressed. */
export const LIMITS = { maxArchiveBytes: 512 * 1024 * 1024, maxEntries: 5000, maxEntryBytes: 25 * 1024 * 1024, maxTotalBytes: 600 * 1024 * 1024, maxRatio: 200, ratioFloorBytes: 1024 * 1024 };
const SAFE_PATH = /^(manifest\.json|backup-summary\.html|data\/[a-z0-9-]+\.json|files\/payment-proofs\/[A-Za-z0-9._-]+)$/;

/** Why an archive entry name is unsafe, or null when it is an expected Scale Flow path. */
export function entryPathError(name: string): string | null {
  if (name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.includes("\0")) return `Unsafe absolute or platform path in archive: ${name}`;
  if (name.split("/").some((x) => x === ".." || x === ".")) return `Unsafe path traversal in archive: ${name}`;
  if (!SAFE_PATH.test(name)) return `Unexpected file in archive: ${name}`;
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** Lists missing or malformed required manifest fields. */
export function manifestProblems(m: unknown): string[] {
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["The manifest is not an object."];
  const x = m as Record<string, unknown>, out: string[] = [];
  const need = (ok: boolean, f: string) => { if (!ok) out.push(f); };
  need(typeof x["createdAt"] === "string" && !Number.isNaN(Date.parse(x["createdAt"] as string)), "createdAt");
  need(isNum(x["schemaVersion"]), "schemaVersion");
  need(x["type"] === "full" || x["type"] === "custom" || x["type"] === "employee", "type");
  need(typeof x["complete"] === "boolean", "complete");
  need(Array.isArray(x["included"]) && (x["included"] as unknown[]).every((i) => ALL_CATEGORY_IDS.includes(i as CategoryId)), "included");
  need(Array.isArray(x["omitted"]), "omitted");
  need(!!x["counts"] && typeof x["counts"] === "object" && Object.values(x["counts"] as object).every(isNum), "counts");
  const a = x["attachments"] as Record<string, unknown> | undefined;
  need(!!a && isNum(a["expected"]) && isNum(a["included"]) && Array.isArray(a["missing"]), "attachments");
  need(Array.isArray(x["files"]) && (x["files"] as Record<string, unknown>[]).every((f) => f && typeof f["path"] === "string" && typeof f["sha256"] === "string" && HEX64.test(f["sha256"] as string) && isNum(f["bytes"])), "files");
  return out.length ? [`The manifest is missing or has invalid required metadata: ${out.join(", ")}.`] : [];
}

/** Read-only inspection. Never modifies CRM data, browser files or the input bytes. */
export async function validateBackup(bytes: Uint8Array): Promise<ValidationReport> {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (e: string | string[], manifest?: Manifest): ValidationReport => ({ ok: false, errors: Array.isArray(e) ? e : [e], warnings, ...(manifest ? { manifest } : {}), restoreAvailable: false, classification: "damaged" });
  if (bytes.byteLength > LIMITS.maxArchiveBytes) return fail("This archive is larger than the 512 MB this browser can safely check.");
  const seen = new Set<string>(), unsafe: string[] = [];
  let entries = 0, total = 0, abort: string | null = null;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => {
      entries++;
      if (entries > LIMITS.maxEntries) { abort = `This archive has more than ${LIMITS.maxEntries} entries.`; throw new Error(abort); }
      if (seen.has(f.name)) { unsafe.push(`Duplicate archive entry: ${f.name} — one file would overwrite another.`); return false; }
      seen.add(f.name);
      const pe = entryPathError(f.name);
      if (pe) { unsafe.push(pe); return false; }
      if (f.originalSize > LIMITS.maxEntryBytes) { abort = `Archive entry ${f.name} declares ${f.originalSize} bytes — over the 25 MB per-file limit.`; throw new Error(abort); }
      total += f.originalSize;
      if (total > LIMITS.maxTotalBytes) { abort = "The archive's total uncompressed size is over the 600 MB limit."; throw new Error(abort); }
      if (f.originalSize > LIMITS.ratioFloorBytes && f.originalSize > f.size * LIMITS.maxRatio) { abort = `Archive entry ${f.name} has a suspicious compression ratio (possible ZIP bomb).`; throw new Error(abort); }
      return true;
    } });
  } catch { return fail(abort ?? "This file isn't a readable ZIP archive. It may be truncated, damaged or not a Scale Flow backup."); }
  if (unsafe.length) return fail(unsafe);
  if (!files["manifest.json"]) return fail("No manifest.json found — this isn't a Scale Flow backup.");
  let m: Manifest;
  try { m = JSON.parse(strFromU8(files["manifest.json"])); } catch { return fail("The manifest is damaged and can't be read."); }
  if (!m || typeof m !== "object" || m.app !== APP_NAME) return fail("This archive was made by a different application.");
  if (m.formatVersion !== FORMAT_VERSION) return fail(`Backup format version ${m.formatVersion} isn't supported by this app (supports version ${FORMAT_VERSION}).`, m);
  const mp = manifestProblems(m);
  if (mp.length) return fail(mp, m);
  if (m.schemaVersion > SCHEMA_VERSION) warnings.push(`Made by a newer CRM schema (v${m.schemaVersion}).`);

  const listed = new Set<string>();
  for (const f of m.files) {
    if (listed.has(f.path)) { errors.push(`The manifest lists ${f.path} twice.`); continue; }
    listed.add(f.path);
    const pe = entryPathError(f.path); if (pe) { errors.push(pe); continue; }
    const b = files[f.path];
    if (!b) { errors.push(`Missing file: ${f.path}`); continue; }
    if (b.byteLength !== f.bytes || (await sha256(b)) !== f.sha256) errors.push(`File failed its integrity check: ${f.path}`);
  }
  for (const p of Object.keys(files)) if (p !== "manifest.json" && p !== "backup-summary.html" && !listed.has(p)) errors.push(`File isn't listed in the manifest: ${p}`);

  const cache = new Map<string, unknown>();
  const read = (p: string): Record<string, unknown> | null => {
    if (cache.has(p)) return cache.get(p) as Record<string, unknown> | null;
    let v: Record<string, unknown> | null = null;
    try { v = files[p] ? JSON.parse(strFromU8(files[p])) : null; } catch { errors.push(`Unreadable data: ${p}`); }
    cache.set(p, v); return v;
  };
  // Every included category must have its data file, and the manifest counts must match the data.
  for (const id of m.included) {
    const c = CATEGORIES.find((x) => x.id === id)!;
    if (c.id === "proofs") continue;
    const d = read(c.file);
    if (!d) { if (files[c.file] === undefined) errors.push(`Missing file: ${c.file}`); continue; }
    if (c.id === "settings") continue;
    const v = d[c.keys[0]!];
    const n = v == null ? 0 : countOf(v);
    if (m.counts[c.id] !== undefined && m.counts[c.id] !== n) errors.push(`Manifest ${c.label} count (${m.counts[c.id]}) doesn't match ${c.file} (${n}).`);
  }
  // Duplicate record IDs.
  const list = (p: string, k: string) => { const v = read(p)?.[k]; return Array.isArray(v) ? (v as Rec[]) : null; };
  for (const [p, k] of [["data/leads.json", "leads"], ["data/deals.json", "deals"], ["data/payments.json", "payments"], ["data/followups.json", "followUps"], ["data/projects.json", "projects"], ["data/projects.json", "projectTasks"]] as const) {
    const ids = new Set<string>();
    for (const r of list(p, k) ?? []) { if (ids.has(r.id)) errors.push(`Duplicate ${k} ID ${r.id} in ${p}`); ids.add(r.id); }
  }

  const leads = list("data/leads.json", "leads");
  const binLeads = (list("data/leads.json", "bin") as unknown as { lead?: Rec }[] | null)?.map((b) => b.lead?.id).filter(Boolean) ?? [];
  const leadIds = leads ? new Set([...leads.map((l) => l.id), ...binLeads as string[]]) : null;
  const deals = list("data/deals.json", "deals") ?? list("data/relationships.json", "deals");
  const dealIds = deals ? new Set(deals.map((d) => d.id)) : null;
  const pays = list("data/payments.json", "payments");
  // Payment → Deal is required: a payment without its deal is a broken money record.
  if (pays) {
    if (dealIds) for (const p of pays) { if (!p.dealId || !dealIds.has(p.dealId)) errors.push(`Payment ${p.id} references deal ${p.dealId ?? "(none)"}, which isn't in this archive.`); }
    else warnings.push(`Unresolved dependency: ${pays.length} payment(s) reference deals that weren't selected.`);
  }
  if (deals && leadIds) { const o = deals.filter((d) => d.leadId && !leadIds.has(d.leadId)); if (o.length) warnings.push(`${o.length} deal(s) reference leads not in this archive: ${o.map((d) => d.id).join(", ")}.`); }
  const projects = list("data/projects.json", "projects") as (Rec & { dealId?: string | null })[] | null;
  if (projects) {
    const pids = new Set(projects.map((p) => p.id));
    for (const t of (list("data/projects.json", "projectTasks") ?? []) as unknown as { id: string; projectId: string }[]) if (!pids.has(t.projectId)) errors.push(`Task ${t.id} references project ${t.projectId}, which isn't in this archive.`);
    if (dealIds) for (const p of projects) if (p.dealId && !dealIds.has(p.dealId)) warnings.push(`Project ${p.id} references deal ${p.dealId}, which isn't in this archive.`);
    if (leadIds) for (const p of projects) if (p.leadId && !leadIds.has(p.leadId)) warnings.push(`Project ${p.id} references lead ${p.leadId}, which isn't in this archive.`);
  }
  if (m.type === "employee" && m.employee?.leadIds && leads) {
    const allowed = new Set(m.employee.leadIds);
    for (const l of leads) if (!allowed.has(l.id)) errors.push(`Lead ${l.id} is outside this employee backup's declared scope.`);
  }

  // Attachment references: every included proof must resolve to its own binary entry with matching bytes and checksum.
  const att = read("data/attachment-metadata.json")?.["attachments"] as (ProofMeta & { path: string | null; sha256: string | null })[] | undefined;
  if (m.included.includes("proofs") && !att) errors.push("Missing file: data/attachment-metadata.json");
  if (att) {
    const payIds = pays ? new Set(pays.map((p) => p.id)) : null;
    if (!payIds) warnings.push("Unresolved dependency: payment proofs reference payments that weren't selected.");
    const seenAtt = new Set<string>(), seenPath = new Set<string>(), seenPay = new Set<string>();
    let withFile = 0;
    for (const a of att) {
      if (seenAtt.has(a.attachmentId)) errors.push(`Duplicate attachment ID: ${a.attachmentId}`); seenAtt.add(a.attachmentId);
      if (seenPay.has(a.paymentId)) errors.push(`More than one proof for payment ${a.paymentId}`); seenPay.add(a.paymentId);
      if (payIds && !payIds.has(a.paymentId)) errors.push(`Proof ${a.attachmentId} points to payment ${a.paymentId}, which isn't in this archive.`);
      if (!a.path) { if (!m.attachments.missing.includes(a.paymentId)) errors.push(`Proof for payment ${a.paymentId} has no file and isn't listed as missing.`); continue; }
      withFile++;
      if (seenPath.has(a.path)) errors.push(`Two proofs share the archive path ${a.path}`); seenPath.add(a.path);
      if (!a.path.startsWith("files/payment-proofs/") || entryPathError(a.path)) { errors.push(`Invalid attachment path: ${a.path}`); continue; }
      const b = files[a.path];
      if (!b) { if (listed.has(a.path)) continue; errors.push(`Missing proof file: ${a.path}`); continue; }
      if (!listed.has(a.path)) errors.push(`Proof file isn't listed in the manifest: ${a.path}`);
      if (b.byteLength !== a.fileSize || (await sha256(b)) !== a.sha256) errors.push(`Proof file failed its checksum: ${a.path}`);
    }
    if (m.attachments.included !== withFile || m.attachments.expected !== att.length) errors.push("Manifest attachment counts don't match the attachment list.");
  }
  if (m.complete && (m.omitted.length > 0 || m.attachments.missing.length > 0 || m.type !== "full")) errors.push("Manifest claims a complete backup but lists omitted categories or missing proofs.");
  if (m.attachments.missing.length) warnings.push(`${m.attachments.missing.length} proof file(s) were already missing when this backup was made.`);
  if (!m.complete) warnings.push(m.type === "full" ? "Marked incomplete when created." : m.type === "employee" ? "Employee-assigned backup — partial by design, not a complete CRM backup." : "Selective Backup — partial by design, not a complete CRM backup.");
  const ok = errors.length === 0;
  const classification: Classification = !ok ? "damaged" : m.type === "employee" ? "employee" : m.type === "custom" ? "selective" : m.complete ? "complete" : "incomplete-full";
  return { ok, errors, warnings, manifest: m, restoreAvailable: false, classification };
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
