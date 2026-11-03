// AI-5A Bulk Lead Import — pure, local, deterministic. Parses CSV/TSV/pasted tables (XLSX cells arrive as a
// string table from the UI), lets the Owner map columns, validates with the existing lead rules and flags
// duplicates by normalized phone. Nothing here saves; `importLeads` in the store is the only write.
import type { Lead, LeadPriority, LeadSource } from "./types";
import { LEAD_SOURCES } from "./types";
import { validEmail, validPhone, leadCreateError } from "./validation";
import { normalizePhone } from "./inbox";

export const MAX_IMPORT_ROWS = 50;
export const MAX_FILE_BYTES = 1_000_000;
export const ACCEPTED_EXT = [".csv", ".tsv", ".txt", ".xlsx"];

export type ImportField = "name" | "phone" | "email" | "company" | "source" | "requirement" | "notes" | "budget" | "priority" | "ignore";
export const FIELD_LABEL: Record<ImportField, string> = { name: "Name", phone: "Phone", email: "Email", company: "Company", source: "Source", requirement: "Requirement", notes: "Notes", budget: "Budget", priority: "Priority", ignore: "Don't import (keep for review)" };
export const IMPORT_FIELDS: ImportField[] = ["name", "phone", "email", "company", "source", "requirement", "notes", "budget", "priority", "ignore"];

const HEADER_ALIASES: Record<Exclude<ImportField, "ignore">, string[]> = {
  name: ["name", "full name", "fullname", "client", "client name", "customer", "customer name", "lead", "lead name", "contact", "contact name", "naam", "नाम"],
  phone: ["phone", "phone number", "mobile", "mobile number", "mobile no", "contact number", "whatsapp", "whatsapp number", "number", "ph", "tel", "telephone", "फ़ोन", "फोन", "मोबाइल"],
  email: ["email", "e-mail", "email address", "mail", "email id"],
  company: ["company", "business", "business name", "company name", "organisation", "organization", "firm", "brand"],
  source: ["source", "lead source", "channel", "from"],
  requirement: ["requirement", "requirements", "service", "need", "needs", "interest", "project", "requirement / notes"],
  notes: ["notes", "note", "comments", "comment", "remarks", "description"],
  budget: ["budget", "budget (₹)", "budget (inr)", "budget inr", "budget rs", "expected budget"],
  priority: ["priority", "temperature", "lead priority"],
};

/** Header text → field, only on an exact (normalized) alias match. Unknown headers stay "ignore"; never guesses from values. */
export function guessField(header: string): ImportField {
  const h = header.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  for (const [f, al] of Object.entries(HEADER_ALIASES)) if (al.includes(h)) return f as ImportField;
  return "ignore";
}
export function guessMapping(headers: string[]): ImportField[] {
  const used = new Set<ImportField>();
  return headers.map((h) => { const f = guessField(h); if (f === "ignore" || used.has(f)) return "ignore"; used.add(f); return f; });
}

export function detectDelimiter(text: string): "," | "\t" | ";" {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const count = (c: string) => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === c) n++; } return n; };
  const t = count("\t"), c = count(","), s = count(";");
  return t > 0 && t >= c ? "\t" : s > c ? ";" : ",";
}

/** RFC 4180-style parser: quoted fields, "" escapes, delimiters and newlines inside quotes, CRLF, BOM. */
export function parseDelimited(input: string, delim = detectDelimiter(input)): { rows: string[][]; error?: string } {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false; let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === "") { cell = ""; q = true; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  return q ? { rows: clean, error: "A quoted value was never closed — check for a missing \" in the data." } : { rows: clean };
}

export interface ParsedTable { headers: string[]; rows: string[][]; truncated: number; error?: string }
/** First non-empty row is the header row. Rows beyond MAX_IMPORT_ROWS are dropped and counted. */
export function toTable(cells: string[][], error?: string): ParsedTable {
  const [head, ...body] = cells;
  if (!head) return { headers: [], rows: [], truncated: 0, error: error ?? "No data found." };
  const width = Math.max(head.length, ...body.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Column ${i + 1}`);
  const rows = body.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  if (!rows.length) return { headers, rows, truncated: 0, error: error ?? "Only a header row was found — add at least one lead row." };
  return { headers, rows: rows.slice(0, MAX_IMPORT_ROWS), truncated: Math.max(0, rows.length - MAX_IMPORT_ROWS), ...(error ? { error } : {}) };
}

export function fileProblem(name: string, size: number): string | undefined {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  if (!ACCEPTED_EXT.includes(ext)) return `“${name}” isn't supported. Use a .csv or .xlsx file (old .xls isn't supported).`;
  if (size > MAX_FILE_BYTES) return `This file is ${(size / 1_000_000).toFixed(1)} MB — the limit is 1 MB per import.`;
  if (size === 0) return "This file is empty.";
  return undefined;
}

/** Editable preview row. Values are plain strings exactly as shown to the Owner. */
export interface PreviewRow { key: string; line: number; name: string; phone: string; email: string; company: string; source: string; requirement: string; notes: string; budget: string; priority: string; extra: Record<string, string>; selected: boolean }
export function buildRows(t: ParsedTable, mapping: ImportField[]): PreviewRow[] {
  return t.rows.map((r, i) => {
    const row: PreviewRow = { key: `r${i + 2}`, line: i + 2, name: "", phone: "", email: "", company: "", source: "", requirement: "", notes: "", budget: "", priority: "", extra: {}, selected: true };
    r.forEach((v, c) => {
      const f = mapping[c] ?? "ignore";
      if (f === "ignore") { if (v) row.extra[t.headers[c] ?? `Column ${c + 1}`] = v; return; }
      row[f] = row[f] ? `${row[f]} · ${v}` : v;
    });
    return row;
  });
}

/** Same country-aware normalization as Smart Inbox: +91 / 0-prefixed / bare Indian mobiles collapse to one key. */
export const phoneKey = (p: string) => normalizePhone(p) ?? "";

/** Budget text → number. Accepts "₹40,000", "40000", "40k", "1.5L"; "" → undefined; anything else → NaN (invalid). */
export function parseBudget(s: string): number | undefined {
  const t = s.trim().replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/,/g, "").replace(/\s+/g, "");
  if (!t) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)(k|l|lakh|lac|cr)?$/i.exec(t);
  if (!m) return NaN;
  const mult = { k: 1e3, l: 1e5, lakh: 1e5, lac: 1e5, cr: 1e7 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}
const PRI: Record<string, LeadPriority> = { hot: "hot", warm: "warm", cold: "cold", high: "hot", medium: "warm", low: "cold" };
export const parsePriority = (s: string): LeadPriority | null | undefined => (s.trim() ? PRI[s.trim().toLowerCase()] ?? null : undefined);
export const parseSource = (s: string): LeadSource => LEAD_SOURCES.find((x) => x.toLowerCase() === s.trim().toLowerCase()) ?? "Other";

export type RowStatus = "ready" | "invalid" | "duplicate_crm" | "duplicate_batch";
export interface RowCheck { status: RowStatus; problems: string[]; existing?: { id: string; name: string }; firstLine?: number }

export function checkRows(rows: PreviewRow[], leads: Pick<Lead, "id" | "name" | "phone">[]): Record<string, RowCheck> {
  const crm = new Map<string, { id: string; name: string }>();
  for (const l of leads) { const k = phoneKey(l.phone); if (k && !crm.has(k)) crm.set(k, { id: l.id, name: l.name }); }
  const seen = new Map<string, number>();
  const out: Record<string, RowCheck> = {};
  for (const r of rows) {
    const k = phoneKey(r.phone);
    // An existing CRM lead is reported even if this row's phone is written in a form the lead rules reject (e.g. 0-prefixed).
    const hit = k ? crm.get(k) : undefined;
    if (hit) { out[r.key] = { status: "duplicate_crm", problems: [`Same phone as existing lead ${hit.name}`], existing: hit }; continue; }
    const p: string[] = [];
    if (!r.name.trim()) p.push("Name is missing");
    if (!r.phone.trim()) p.push("Phone is missing");
    else if (!validPhone(r.phone)) p.push("Phone isn't a valid 10-digit Indian mobile");
    if (r.email.trim() && !validEmail(r.email)) p.push("Email isn't valid");
    const b = parseBudget(r.budget);
    if (b !== undefined && Number.isNaN(b)) p.push("Budget isn't a number");
    else if (b !== undefined && b < 0) p.push("Budget can't be negative");
    if (parsePriority(r.priority) === null) p.push("Priority must be Hot, Warm or Cold");
    if (p.length) { out[r.key] = { status: "invalid", problems: p }; continue; }
    // First row with a phone keeps it; later rows with the same normalized phone are batch duplicates (selection doesn't change this).
    if (seen.has(k)) { out[r.key] = { status: "duplicate_batch", problems: [`Same phone as row ${seen.get(k)} in this import`], firstLine: seen.get(k)! }; continue; }
    seen.set(k, r.line);
    out[r.key] = { status: "ready", problems: [] };
  }
  return out;
}

export type NewLead = Omit<Lead, "id" | "createdAt" | "updatedAt">;
/** Exact lead payload for a ready row — only mapped fields, nothing invented. */
export function toNewLead(r: PreviewRow): NewLead {
  const b = parseBudget(r.budget), pr = parsePriority(r.priority);
  const lead: NewLead = {
    name: r.name.trim(), phone: r.phone.trim(), source: parseSource(r.source), status: "new", priority: pr ?? "warm", pinned: false,
    ...(r.email.trim() ? { email: r.email.trim() } : {}), ...(r.company.trim() ? { company: r.company.trim() } : {}),
    ...(r.requirement.trim() ? { requirement: r.requirement.trim() } : {}), ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
    ...(b !== undefined && b > 0 ? { budget: b } : {}),
  };
  if (leadCreateError(lead)) throw new Error("Row is not valid");
  return lead;
}

export interface ImportSummary { processed: number; created: string[]; duplicates: number; invalid: number; excluded: number; failed: number; truncated: number }

export const SAMPLE_CSV = 'Name,Phone,Email,Company,Source,Requirement,Budget,Priority\n"Ravi Kumar",9123456780,ravi@example.com,"Ravi Bakes, Pune",Instagram,"Website with online orders",40000,Hot\nमीना अय्यर,+91 99887 76655,,,Referral,"Logo + brand ""starter"" kit",₹25000,Warm\n';

/** Approximate UTF-16 bytes this batch will add to browser storage (leads + one history entry each). */
export const estimateBytes = (leads: NewLead[]) => leads.reduce((s, l) => s + (JSON.stringify(l).length + 260) * 2, 0);
