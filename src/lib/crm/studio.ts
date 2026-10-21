// Sales Studio rules: quotations, WhatsApp templates and the demo library.
// Pure and backend-agnostic — the store persists these shapes; a Hostinger API can return the same shapes later.
import type { Lead } from "./types";
import { formatINR, formatDate, uid } from "./format";

export type QuoteStatus = "draft" | "ready" | "shared" | "accepted" | "rejected" | "expired";
export const QUOTE_STATUSES: QuoteStatus[] = ["draft", "ready", "shared", "accepted", "rejected", "expired"];
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", ready: "Ready", shared: "Shared", accepted: "Accepted", rejected: "Rejected", expired: "Expired" };

export interface QuoteItem { id: string; description: string; qty: number; unitPrice: number }
export interface QuoteRevision { revision: number; at: string; total: number; title: string }
export interface Quotation {
  id: string;
  number: string;
  leadId: string;
  clientName: string;
  company?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  title: string;
  /** YYYY-MM-DD */
  issueDate: string;
  /** YYYY-MM-DD */
  validUntil: string;
  items: QuoteItem[];
  discountType: "flat" | "percent";
  discount: number;
  gstEnabled: boolean;
  gstRate: number;
  paymentTerms?: string | undefined;
  notes?: string | undefined;
  status: QuoteStatus;
  revision: number;
  history: QuoteRevision[];
  sharedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfile { name: string; address?: string; gstin?: string; email?: string; phone?: string; website?: string; paymentInstructions?: string }

export type TemplatePurpose = "followup" | "quotation" | "samples" | "custom";
export interface WaTemplate { id: string; purpose: TemplatePurpose; name: string; body: string; isDefault: boolean; enabled: boolean; builtIn?: boolean; updatedAt: string }

export interface Demo { id: string; title: string; url: string; description?: string | undefined; category: string; tags: string[]; thumbnail?: string | undefined; active: boolean; order: number; includeByDefault: boolean }
export const DEFAULT_DEMO_CATEGORIES = ["E-commerce", "Scroll-Based Website", "3D Website", "Business Website", "Portfolio", "Other"];

/* ---------- money ---------- */
const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
export const lineTotal = (i: Pick<QuoteItem, "qty" | "unitPrice">) => money(Math.max(0, i.qty) * Math.max(0, i.unitPrice));
export function quoteTotals(q: Pick<Quotation, "items" | "discountType" | "discount" | "gstEnabled" | "gstRate">) {
  const subtotal = money(q.items.reduce((s, i) => s + lineTotal(i), 0));
  const rawDisc = q.discountType === "percent" ? (subtotal * Math.min(100, Math.max(0, q.discount))) / 100 : Math.max(0, q.discount);
  const discount = money(Math.min(subtotal, rawDisc));
  const taxable = money(subtotal - discount);
  const rate = q.gstEnabled ? Math.min(100, Math.max(0, q.gstRate)) : 0;
  const gst = money((taxable * rate) / 100);
  return { subtotal, discount, taxable, gstRate: rate, gst, total: money(taxable + gst) };
}

/* ---------- lifecycle ---------- */
export const quotesForLead = (quotes: Quotation[], leadId: string | null | undefined) => (leadId ? quotes.filter((q) => q.leadId === leadId) : []);
export const isExpired = (q: Pick<Quotation, "validUntil" | "status">, today: string) => q.status === "expired" || (!!q.validUntil && q.validUntil < today && q.status !== "accepted" && q.status !== "rejected");
export const effectiveStatus = (q: Quotation, today: string): QuoteStatus => (isExpired(q, today) ? "expired" : q.status);
/** Only ready (or already shared) quotations that are still valid and priced can be sent to a client. */
export function shareBlocker(q: Quotation, today: string): string | null {
  if (isExpired(q, today)) return "This quotation has expired — extend its validity first.";
  if (q.status === "draft") return "Mark this quotation Ready before sharing it.";
  if (q.status === "rejected" || q.status === "accepted") return `This quotation is ${QUOTE_STATUS_LABEL[q.status].toLowerCase()}.`;
  if (!q.items.some((i) => i.description.trim() && lineTotal(i) > 0)) return "Add at least one priced item.";
  return null;
}
export function quoteError(q: Pick<Quotation, "title" | "leadId" | "items" | "issueDate" | "validUntil">): string | null {
  if (!q.leadId) return "Choose a client.";
  if (!q.title.trim()) return "Add a quotation title.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(q.validUntil)) return "Enter valid dates.";
  if (q.validUntil < q.issueDate) return "Validity must be on or after the quotation date.";
  if (!q.items.length) return "Add at least one item.";
  if (q.items.some((i) => !i.description.trim())) return "Every item needs a description.";
  if (q.items.some((i) => !(i.qty > 0) || !(i.unitPrice >= 0) || !Number.isFinite(i.qty) || !Number.isFinite(i.unitPrice))) return "Quantities must be above zero and prices cannot be negative.";
  return null;
}
export function nextQuoteNumber(quotes: Pick<Quotation, "number">[], year: number) {
  const prefix = `SF-Q-${year}-`;
  const max = quotes.reduce((m, q) => (q.number.startsWith(prefix) ? Math.max(m, Number(q.number.slice(prefix.length)) || 0) : m), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
export const emptyItem = (): QuoteItem => ({ id: uid("qi"), description: "", qty: 1, unitPrice: 0 });

/* ---------- URLs ---------- */
/** Only absolute http(s) links are allowed into client messages. */
export function safeUrl(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString() : null; } catch { return null; }
}

/* ---------- demos ---------- */
/** Demos for a sample message: an explicit per-message selection wins, otherwise the saved defaults. Invalid links never appear. */
export function selectedDemos(demos: Demo[], override?: string[] | null) {
  return demos.filter((d) => d.active && safeUrl(d.url) && (override ? override.includes(d.id) : d.includeByDefault)).sort((a, b) => a.order - b.order);
}
export const demoLines = (demos: Demo[]) => demos.map((d) => `• ${d.title}: ${safeUrl(d.url)}`).join("\n");

/* ---------- templates ---------- */
export const PLACEHOLDERS = ["clientName", "firstName", "companyName", "projectType", "quotedAmount", "ownerName", "businessName", "quotationTitle", "quotationNumber", "quotationAmount", "validUntil", "demoLinks"] as const;
export type TemplateVars = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;
const TOKEN = /\{(\w+)\}/g;
/** Fill placeholders from saved data only. A sentence (or line) whose value is missing is dropped, so clients never see `{tokens}` or invented values. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const val = (k: string) => (vars as Record<string, string | undefined>)[k]?.trim();
  return body
    .split("\n")
    .map((line) => {
      if (!line.match(TOKEN)) return line;
      const parts = line.split(/(?<=[.!?])\s+/);
      const kept = parts.filter((p) => [...p.matchAll(TOKEN)].every((m) => val(m[1]!)));
      if (!kept.length) return null;
      return kept.join(" ").replace(TOKEN, (_, k: string) => val(k)!);
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function templateVars(lead: Pick<Lead, "name" | "company" | "requirement" | "quotedAmount">, ctx: { owner: string; business: string; dealName?: string | undefined; quote?: Quotation | undefined; demos?: Demo[] }): TemplateVars {
  const v: TemplateVars = { clientName: lead.name, firstName: lead.name.trim().split(/\s+/)[0] ?? lead.name, ownerName: ctx.owner, businessName: ctx.business };
  if (lead.company) v.companyName = lead.company;
  const project = ctx.dealName || lead.requirement?.trim();
  if (project) v.projectType = project;
  if (lead.quotedAmount) v.quotedAmount = formatINR(lead.quotedAmount);
  if (ctx.quote) { v.quotationTitle = ctx.quote.title; v.quotationNumber = ctx.quote.number; v.quotationAmount = formatINR(quoteTotals(ctx.quote).total); v.validUntil = formatDate(`${ctx.quote.validUntil}T12:00:00Z`, { day: "numeric", month: "short", year: "numeric" }); }
  const links = demoLines(ctx.demos ?? []);
  if (links) v.demoLinks = links;
  return v;
}
export const unknownPlaceholders = (body: string) => [...body.matchAll(TOKEN)].map((m) => m[1]!).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
export const pickTemplate = (templates: WaTemplate[], purpose: TemplatePurpose) => {
  const list = templates.filter((t) => t.purpose === purpose && t.enabled);
  return list.find((t) => t.isDefault) ?? list[0];
};
export function builtInTemplates(at = new Date().toISOString()): WaTemplate[] {
  const t = (id: string, purpose: TemplatePurpose, name: string, body: string): WaTemplate => ({ id, purpose, name, body, isDefault: true, enabled: true, builtIn: true, updatedAt: at });
  return [
    t("tpl_followup", "followup", "Friendly follow-up", "Hi {firstName}, this is {ownerName} from {businessName}. Just following up on our conversation about {projectType}. Would you have a few minutes today or tomorrow to discuss the next steps?"),
    t("tpl_quotation", "quotation", "Quotation share", "Hi {firstName}, this is {ownerName} from {businessName}. Sharing quotation {quotationNumber} for {quotationTitle}. The total is {quotationAmount}, valid until {validUntil}. I'll attach the PDF here. Happy to walk you through what's included."),
    t("tpl_samples", "samples", "Website samples", "Hi {firstName}, this is {ownerName} from {businessName}. Sharing some website samples relevant to {projectType}.\n\n{demoLinks}\n\nLet me know which style you like and we can take it from there."),
  ];
}
