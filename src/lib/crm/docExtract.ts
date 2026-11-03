// AI-5B Document & unstructured-text lead extraction — pure, local, deterministic pattern parsing (NOT a live AI model).
// Turns free text (pasted, or text pulled from a text-based PDF) into AI-5A PreviewRows. It never invents values:
// budget/priority/source/company only when explicitly labelled, dates stay as note text, and anything it can't
// associate safely is flagged "Needs Review" (which blocks import until the Owner edits that field).
import type { PreviewRow } from "./bulkImport";
import { MAX_IMPORT_ROWS, parseBudget } from "./bulkImport";
import { LEAD_SOURCES } from "./types";

export const DEMO_EXTRACTION_LABEL = "Demo Extraction — pattern-based parsing, not a live AI model.";
export const SCANNED_PDF_MESSAGE = "This PDF appears to be scanned or image-based. Text extraction is unavailable in Demo Mode.";
export const MAX_PDF_BYTES = 5_000_000;
export const MAX_PDF_PAGES = 20;
export const MAX_TEXT_CHARS = 200_000;
/** Below this many non-space characters across the whole PDF we treat it as image-only. */
export const MIN_PDF_TEXT_CHARS = 20;

export type ReviewField = "name" | "phone" | "requirement" | "notes";

// Indian mobile: optional +91 / 91 / 0 prefix, first digit 6-9, 10 digits with optional spaces/dashes.
const PHONE_RE = /(?<![\d+])(?:\+?91[\s-]*|0)?[6-9](?:[\s-]?\d){9}(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SEP = /^[\s\-–—:|,;•*·]+|[\s\-–—:|,;•*·]+$/g;
const LABEL_RE = /^\s*(name|naam|नाम|phone|mobile|whatsapp|contact|email|e-mail|company|business|firm|source|lead source|requirement|requirements|need|needs|service|budget|बजट|priority|notes?|remarks?)\s*[:\-–]\s*(.*)$/i;
const HEADER_WORDS = new Set(["name", "phone", "mobile", "email", "company", "business", "requirement", "requirements", "source", "budget", "priority", "notes", "note", "client", "number", "contact", "s.no", "sno", "sr", "no", "#", "lead", "leads", "list"]);
const DATE_HINT = /\b(call|follow[\s-]?up|meet|meeting|visit|remind|tomorrow|today|tonight|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\b/i;
const PRI_WORDS: Record<string, string> = { hot: "Hot", warm: "Warm", cold: "Cold", high: "Hot", medium: "Warm", low: "Cold" };

export interface ExtractedRow extends PreviewRow { sourceText: string; review: ReviewField[]; reviewNotes: string[] }
export interface ExtractionResult { rows: ExtractedRow[]; warnings: string[]; truncated: number; understood: boolean }

/** Future secure-backend (OpenRouter) contract — the Demo extractor returns the same shape so the UI needn't change. */
export interface LeadExtractionRequest { text: string; origin: "paste" | "pdf"; maxLeads: number }
export interface LeadExtractionResponse extends ExtractionResult { provider: "demo-pattern" | "server-ai" }
export interface LeadExtractionProvider { extract(req: LeadExtractionRequest): Promise<LeadExtractionResponse> }

export const tenDigits = (p: string) => p.replace(/\D/g, "").slice(-10);
const phonesIn = (s: string) => Array.from(new Set((s.match(PHONE_RE) ?? []).map(tenDigits)));
const looksLikeName = (s: string) => {
  const t = s.replace(SEP, "").trim();
  return !!t && t.length <= 60 && !/\d|@/.test(t) && t.split(/\s+/).length <= 5 && /^[\p{L}\p{M}][\p{L}\p{M}.'\s]*$/u.test(t);
};
const isHeaderLine = (s: string) => {
  const w = s.toLowerCase().split(/[\s|,;\t]+/).filter(Boolean);
  return w.length >= 2 && w.every((x) => HEADER_WORDS.has(x));
};

/** Split text into candidate lead blocks. Blank lines separate blocks; a block whose every line is "name + one phone"
 *  (table/list style) is split one lead per line. */
function blocksOf(text: string): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const l = raw.replace(/\s+$/, "");
    if (!l.trim()) { if (cur.length) blocks.push(cur); cur = []; continue; }
    cur.push(l.trim());
  }
  if (cur.length) blocks.push(cur);
  const out: string[][] = [];
  for (const b of blocks) {
    const phoneLines = b.filter((l) => phonesIn(l).length > 0);
    const tableLike = b.length > 1 && phoneLines.length > 1 && b.every((l) => isHeaderLine(l) || (phonesIn(l).length === 1 && /\p{L}/u.test(l.replace(PHONE_RE, ""))));
    if (tableLike) { for (const l of b) out.push([l]); continue; }
    // Lines "Name\nPhone\n...\nName\nPhone" with no blank line between: start a new block at a name line directly followed by a phone line,
    // when the current block already has a phone.
    let part: string[] = [];
    for (let i = 0; i < b.length; i++) {
      const l = b[i]!, next = b[i + 1];
      const startsLead = looksLikeName(l) && next !== undefined && phonesIn(next).length > 0 && next.replace(PHONE_RE, "").replace(SEP, "").trim() === "";
      if (startsLead && part.some((p) => phonesIn(p).length > 0)) { out.push(part); part = []; }
      part.push(l);
    }
    if (part.length) out.push(part);
  }
  return out;
}

function emptyRow(i: number, sourceText: string): ExtractedRow {
  return { key: `x${i}`, line: i, name: "", phone: "", email: "", company: "", source: "", requirement: "", notes: "", budget: "", priority: "", extra: {}, selected: false, sourceText, review: [], reviewNotes: [] };
}

function parseBlock(lines: string[], i: number): ExtractedRow | null {
  const src = lines.join("\n");
  if (lines.every(isHeaderLine)) return null;
  const r = emptyRow(i, src);
  const req: string[] = [], notes: string[] = [];
  const allPhones = phonesIn(src);
  for (const line of lines) {
    if (isHeaderLine(line)) continue;
    const lab = LABEL_RE.exec(line);
    if (lab) {
      const k = lab[1]!.toLowerCase(), v = lab[2]!.trim();
      if (!v) continue;
      if (/^(name|naam|नाम)$/.test(k)) { if (!r.name) r.name = v; continue; }
      if (/^(phone|mobile|whatsapp|contact)$/.test(k)) continue; // collected from allPhones
      if (/^(email|e-mail)$/.test(k)) { r.email = v.match(EMAIL_RE)?.[0] ?? v; continue; }
      if (/^(company|business|firm)$/.test(k)) { r.company = v; continue; }
      if (/source/.test(k)) { r.source = LEAD_SOURCES.find((s) => s.toLowerCase() === v.toLowerCase()) ?? v; continue; }
      if (/^(budget|बजट)$/.test(k)) { setBudget(r, v); continue; }
      if (k === "priority") { const p = PRI_WORDS[v.toLowerCase().split(/\s/)[0] ?? ""]; if (p) r.priority = p; else notes.push(line); continue; }
      if (/^notes?|remarks?$/.test(k)) { notes.push(v); continue; }
      req.push(v); continue;
    }
    // Explicit budget phrases without a colon ("Budget discussed ₹40,000", "budget around 50k").
    const bm = /\b(?:budget|बजट)\b[^\d₹]{0,25}((?:₹|rs\.?|inr)?\s*[\d.,]+\s*(?:k|l|lakh|lac|cr)?)/i.exec(line);
    if (bm) { setBudget(r, bm[1]!); continue; }
    const pm = /^(hot|warm|cold)(?:\s+lead)?$/i.exec(line.trim()) ?? /\b(?:priority|temperature)\s+(hot|warm|cold|high|medium|low)\b/i.exec(line);
    if (pm) { r.priority = PRI_WORDS[pm[1]!.toLowerCase()]!; continue; }
    const emails = line.match(EMAIL_RE);
    let rest = line;
    if (emails) { if (!r.email) r.email = emails[0]!; rest = rest.replace(EMAIL_RE, " "); }
    const ph = phonesIn(rest);
    if (ph.length) {
      const [before, ...afterParts] = rest.split(PHONE_RE);
      const b = (before ?? "").replace(SEP, "").trim();
      const a = afterParts.join(" ").replace(SEP, "").trim();
      if (b && !r.name && looksLikeName(b)) r.name = b; else if (b) req.push(b);
      if (a) (DATE_HINT.test(a) ? notes : req).push(a);
      continue;
    }
    rest = rest.replace(SEP, "").trim();
    if (!rest) continue;
    if (!r.name && looksLikeName(rest) && req.length === 0) { r.name = rest; continue; }
    (DATE_HINT.test(rest) ? notes : req).push(rest);
  }
  r.requirement = req.join(" · ");
  r.notes = notes.join(" · ");
  if (allPhones.length === 0) { r.review.push("phone"); r.reviewNotes.push("No phone number found in this text — add it or leave this row out."); }
  else {
    r.phone = allPhones[0]!;
    if (allPhones.length > 1) {
      r.review.push("phone");
      r.extra["Other phone numbers found (not saved)"] = allPhones.slice(1).join(", ");
      const multiOnLine = lines.some((l) => phonesIn(l).length > 1);
      r.reviewNotes.push(multiOnLine
        ? "Several phone numbers on one line — this may be a multi-column layout. Confirm which number belongs to this client."
        : "Two or more phone numbers found — confirm which one belongs to this client.");
      if (multiOnLine) { r.review.push("name"); }
    }
  }
  if (!r.name) { r.review.push("name"); r.reviewNotes.push("Client name couldn't be identified — type it in."); }
  if (!r.name && !r.phone && !r.email) return { ...r, reviewNotes: [...r.reviewNotes] };
  return r;
}

function setBudget(r: ExtractedRow, v: string) {
  const t = v.trim();
  const n = parseBudget(t);
  if (n !== undefined && !Number.isNaN(n)) r.budget = t; else r.notes = [r.notes, `Budget: ${t}`].filter(Boolean).join(" · ");
}

/** Deterministic extraction from free text. Never creates records. */
export function extractLeadsFromText(input: string): ExtractionResult {
  const warnings: string[] = [];
  let text = input.replace(/^\uFEFF/, "");
  if (text.length > MAX_TEXT_CHARS) { text = text.slice(0, MAX_TEXT_CHARS); warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString("en-IN")} characters were read.`); }
  if (/<\s*\/?\s*(script|iframe|img|a|div|style|object|embed)\b/i.test(text)) warnings.push("The text contains HTML tags. They are kept as plain text only and are never run.");
  const blocks = blocksOf(text);
  const rows: ExtractedRow[] = [];
  let n = 0;
  for (const b of blocks) { const r = parseBlock(b, n + 1); if (r) { rows.push(r); n++; } }
  const truncated = Math.max(0, rows.length - MAX_IMPORT_ROWS);
  if (truncated) warnings.push(`${truncated} more possible leads beyond the ${MAX_IMPORT_ROWS}-lead limit were left out. Import them in another batch.`);
  const kept = rows.slice(0, MAX_IMPORT_ROWS);
  const understood = kept.some((r) => r.phone && r.name);
  if (!kept.length) warnings.push("No lead details could be recognised in this text. Nothing was interpreted.");
  else if (!understood) warnings.push("No lead had both a recognisable name and phone number. Check every row before importing.");
  const review = kept.filter((r) => r.review.length).length;
  if (review) warnings.push(`${review} row${review === 1 ? "" : "s"} need review — the pattern parser couldn't safely decide some fields.`);
  return { rows: kept, warnings, truncated, understood };
}

export const demoExtractionProvider: LeadExtractionProvider = {
  async extract(req) { return { ...extractLeadsFromText(req.text), provider: "demo-pattern" }; },
};

/** Remove a field from Needs Review once the Owner edits it. */
export function clearReview(row: ExtractedRow, field: string): ExtractedRow {
  if (!row.review.includes(field as ReviewField)) return row;
  const review = row.review.filter((f) => f !== field);
  return { ...row, review, reviewNotes: review.length ? row.reviewNotes : [] };
}

// ---------- PDF text assembly (items from pdf.js getTextContent) ----------
export interface PdfTextItem { str: string; x: number; y: number; w: number; h: number }
export interface PdfPageText { width: number; items: PdfTextItem[] }

/** Rebuild reading-order lines per page: group items by baseline, order by x, insert blank lines at large vertical gaps.
 *  Flags pages whose lines have a wide horizontal gutter (possible multi-column layout). */
export function assemblePdfText(pages: PdfPageText[]): { text: string; chars: number; multiColumnPages: number[] } {
  const out: string[] = [];
  const multi: number[] = [];
  let chars = 0;
  pages.forEach((p, pi) => {
    const items = p.items.filter((it) => it.str.trim());
    chars += items.reduce((s, it) => s + it.str.replace(/\s/g, "").length, 0);
    const lines: { y: number; h: number; items: PdfTextItem[] }[] = [];
    for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const tol = Math.max(2, (it.h || 10) * 0.4);
      const ln = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (ln) ln.items.push(it); else lines.push({ y: it.y, h: it.h || 10, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    let gutterLines = 0;
    let prevY: number | null = null;
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let s = "";
      let end: number | null = null;
      for (const it of l.items) {
        const gap = end === null ? 0 : it.x - end;
        if (end !== null && gap > p.width * 0.15) gutterLines++;
        s += end === null ? it.str : gap > (it.h || 10) * 0.25 ? ` ${it.str}` : it.str;
        end = it.x + it.w;
      }
      if (prevY !== null && prevY - l.y > l.h * 1.8) out.push("");
      out.push(s.replace(/\s+/g, " ").trim());
      prevY = l.y;
    }
    if (lines.length && gutterLines >= Math.max(2, lines.length * 0.3)) multi.push(pi + 1);
    out.push("");
  });
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), chars, multiColumnPages: multi };
}

export function pdfFileProblem(name: string, size: number, head?: Uint8Array): string | undefined {
  if (!name.toLowerCase().endsWith(".pdf")) return `“${name}” isn't a PDF.`;
  if (size === 0) return "This PDF is empty.";
  if (size > MAX_PDF_BYTES) return `This PDF is ${(size / 1_000_000).toFixed(1)} MB — the limit is ${MAX_PDF_BYTES / 1_000_000} MB.`;
  if (head && String.fromCharCode(...head.slice(0, 5)) !== "%PDF-") return "This file isn't a valid PDF (it doesn't start with a PDF header).";
  return undefined;
}
