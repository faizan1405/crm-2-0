// Sales Studio rules: quotation (package) templates, WhatsApp templates and the demo library.
// Pure and backend-agnostic — the store persists these shapes; a Hostinger API can return the same shapes later.
import type { Lead } from "./types";
import { formatINR, uid } from "./format";
import { draftMessage } from "./whatsapp";

/* ---------- quotation templates (reusable WhatsApp packages, global — not per client) ---------- */
export interface QuotationTemplate {
  id: string;
  name: string;
  priceType: "fixed" | "custom";
  /** Rupees; only meaningful when priceType is "fixed". */
  priceAmount?: number | undefined;
  /** Shown when priceType is "custom", e.g. "On request". */
  priceLabel?: string | undefined;
  currency: "INR";
  messageBody: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
/** A user-confirmed record of a quotation sent to one client. Snapshots never change when the template is edited later. */
export interface QuotationShare {
  id: string;
  leadId: string;
  templateId: string;
  packageNameSnapshot: string;
  priceSnapshot: string;
  messageSnapshot: string;
  userConfirmedSent: boolean;
  createdAt: string;
}

export const formatPackagePrice = (t: Pick<QuotationTemplate, "priceType" | "priceAmount" | "priceLabel">) =>
  t.priceType === "fixed" && t.priceAmount !== undefined && Number.isFinite(t.priceAmount) ? formatINR(t.priceAmount) : t.priceLabel?.trim() || "Custom price";

export const emptyQuotationTemplate = (sortOrder = 0): QuotationTemplate => ({
  id: uid("qt"), name: "", priceType: "fixed", priceAmount: undefined, currency: "INR",
  messageBody: "Hi {clientName},\n\nHere are the details of our *{packageName}* package — {packagePrice}.\n\nWhat we provide:\n- \n\nLet me know if you have any questions.",
  isActive: true, sortOrder, createdAt: "", updatedAt: "",
});

export function quotationTemplateError(t: Pick<QuotationTemplate, "name" | "priceType" | "priceAmount" | "messageBody">): string | null {
  if (!t.name.trim()) return "Add a package name.";
  if (t.priceType === "fixed" && !(typeof t.priceAmount === "number" && Number.isFinite(t.priceAmount) && t.priceAmount > 0)) return "Enter a price above zero, or choose Custom price.";
  if (!t.messageBody.trim()) return "Write the quotation message.";
  const bad = placeholderIssues(t.messageBody, QUOTATION_PLACEHOLDERS);
  if (bad.length) return `Unsupported placeholder ${bad.join(", ")}. Use the Insert buttons — e.g. {firstName}, {packageName}, {packagePrice}.`;
  return null;
}

/** Rupee amounts written by hand in the body that differ from the saved price. Never rewrites the text — only warns. */
export function priceMismatch(t: Pick<QuotationTemplate, "priceType" | "priceAmount" | "messageBody">): string[] {
  if (t.priceType !== "fixed" || !t.priceAmount) return [];
  const found = [...t.messageBody.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/gi)].map((m) => ({ raw: m[0], n: Number(m[1]!.replace(/,/g, "")) }));
  return [...new Set(found.filter((f) => f.n > 0 && f.n !== t.priceAmount).map((f) => f.raw.trim()))];
}

export const activeQuotationTemplates = (list: QuotationTemplate[]) => list.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

/** Render a package for one client from saved data only. */
export function renderQuotation(t: QuotationTemplate, lead: Pick<Lead, "name" | "company" | "requirement" | "quotedAmount">, ctx: { owner: string; business: string; dealName?: string | undefined }) {
  return renderTemplate(t.messageBody, { ...templateVars(lead, ctx), packageName: t.name.trim(), packagePrice: formatPackagePrice(t) });
}

/* ---------- legacy billing quotations (read-only backup; no longer editable) ---------- */
export interface LegacyQuoteItem { id: string; description: string; qty: number; unitPrice: number }
export interface LegacyQuotation {
  id: string; number: string; leadId: string; clientName: string; company?: string | undefined; title: string;
  issueDate: string; validUntil: string; items: LegacyQuoteItem[]; discountType: "flat" | "percent"; discount: number;
  gstEnabled: boolean; gstRate: number; paymentTerms?: string | undefined; notes?: string | undefined; status: string; createdAt: string; updatedAt: string;
  [k: string]: unknown;
}
const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
/** Total of a legacy record, used only to label the backup. */
export function legacyTotal(q: Pick<LegacyQuotation, "items" | "discountType" | "discount" | "gstEnabled" | "gstRate">) {
  const sub = money((q.items ?? []).reduce((s, i) => s + Math.max(0, i.qty) * Math.max(0, i.unitPrice), 0));
  const disc = Math.min(sub, q.discountType === "percent" ? (sub * Math.min(100, Math.max(0, q.discount))) / 100 : Math.max(0, q.discount));
  const taxable = money(sub - disc);
  return money(taxable + (q.gstEnabled ? (taxable * Math.min(100, Math.max(0, q.gstRate))) / 100 : 0));
}
/** A starting point the user reviews in the editor — never saved automatically. */
export function templateFromLegacy(q: LegacyQuotation, sortOrder: number): QuotationTemplate {
  const lines = (q.items ?? []).filter((i) => i.description?.trim()).map((i) => `- ${i.description.trim()}`);
  const body = ["Hi {clientName},", "", "Here are the details of our *{packageName}* package — {packagePrice}.", ...(lines.length ? ["", "What we provide:", ...lines] : []), ...(q.paymentTerms?.trim() ? ["", `Payment terms: ${q.paymentTerms.trim()}`] : []), ...(q.notes?.trim() ? ["", q.notes.trim()] : [])].join("\n");
  const total = legacyTotal(q);
  return { ...emptyQuotationTemplate(sortOrder), name: q.title || "Imported package", priceType: total > 0 ? "fixed" : "custom", priceAmount: total > 0 ? total : undefined, messageBody: body };
}

export interface BusinessProfile { name: string; address?: string; gstin?: string; email?: string; phone?: string; website?: string; paymentInstructions?: string }

export type TemplatePurpose = "followup" | "quotation" | "samples" | "custom";
export interface WaTemplate { id: string; purpose: TemplatePurpose; name: string; body: string; isDefault: boolean; enabled: boolean; builtIn?: boolean; updatedAt: string }

export interface Demo { id: string; title: string; url: string; description?: string | undefined; category: string; tags: string[]; thumbnail?: string | undefined; active: boolean; order: number; includeByDefault: boolean }
export const DEFAULT_DEMO_CATEGORIES = ["E-commerce", "Scroll-Based Website", "3D Website", "Business Website", "Portfolio", "Other"];

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
export const PLACEHOLDERS = ["clientName", "firstName", "companyName", "projectType", "quotedAmount", "ownerName", "businessName", "packageName", "packagePrice", "demoLinks"] as const;
export const QUOTATION_PLACEHOLDERS = ["clientName", "firstName", "companyName", "projectType", "packageName", "packagePrice", "ownerName", "businessName"] as const;
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
      // Only known placeholders with a missing value drop their sentence; unknown tokens stay as literal text.
      const known = (k: string) => (PLACEHOLDERS as readonly string[]).includes(k);
      const kept = parts.filter((p) => [...p.matchAll(TOKEN)].every((m) => !known(m[1]!) || val(m[1]!)));
      if (!kept.length) return null;
      return kept.join(" ").replace(TOKEN, (raw, k: string) => (known(k) ? val(k)! : raw));
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function templateVars(lead: Pick<Lead, "name" | "company" | "requirement" | "quotedAmount">, ctx: { owner: string; business: string; dealName?: string | undefined; pkg?: QuotationTemplate | undefined; demos?: Demo[] }): TemplateVars {
  const v: TemplateVars = { clientName: lead.name, firstName: lead.name.trim().split(/\s+/)[0] ?? lead.name, ownerName: ctx.owner, businessName: ctx.business };
  if (lead.company) v.companyName = lead.company;
  const project = ctx.dealName || lead.requirement?.trim();
  if (project) v.projectType = project;
  if (lead.quotedAmount) v.quotedAmount = formatINR(lead.quotedAmount);
  if (ctx.pkg) { v.packageName = ctx.pkg.name.trim(); v.packagePrice = formatPackagePrice(ctx.pkg); }
  const links = demoLines(ctx.demos ?? []);
  if (links) v.demoLinks = links;
  return v;
}
/** Malformed ({{x}}, unmatched braces) or unsupported placeholders, as written by the user. Empty = valid. */
export function placeholderIssues(body: string, allowed: readonly string[] = PLACEHOLDERS): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{[^{}]*\}\}/g)) out.add(m[0]);
  const stripped = body.replace(/\{\{[^{}]*\}\}/g, "");
  for (const m of stripped.matchAll(/\{([^{}]*)\}/g)) if (!allowed.includes(m[1]!)) out.add(m[0]);
  const rest = stripped.replace(/\{[^{}]*\}/g, "");
  if (/[{}]/.test(rest)) out.add("an unmatched { or }");
  return [...out];
}
export const unknownPlaceholders = (body: string) => [...body.matchAll(TOKEN)].map((m) => m[1]!).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
export const pickTemplate = (templates: WaTemplate[], purpose: TemplatePurpose) => {
  const list = templates.filter((t) => t.purpose === purpose && t.enabled);
  return list.find((t) => t.isDefault) ?? list[0];
};

/* ---------- composer ---------- */
export interface ComposeInput {
  purpose: TemplatePurpose;
  templateId?: string | null | undefined;
  lead: Pick<Lead, "name" | "company" | "requirement" | "quotedAmount">;
  owner: string;
  business: string;
  dealName?: string | undefined;
  templates: WaTemplate[];
  /** For the Quotation purpose: the chosen package template. Its message is the draft. */
  pkg?: QuotationTemplate | undefined;
  demos?: Demo[];
}
/** The composer's draft, always built from the one shared package / template / demo source. */
export function composeDraft(i: ComposeInput): string {
  const ctx = { owner: i.owner, business: i.business, dealName: i.dealName };
  if (i.purpose === "quotation" && i.pkg) return renderQuotation(i.pkg, i.lead, ctx);
  const chosen = i.templateId ? i.templates.find((t) => t.id === i.templateId && t.enabled && t.purpose === i.purpose) : undefined;
  const t = chosen ?? (i.purpose === "custom" ? undefined : pickTemplate(i.templates, i.purpose));
  if (!t || i.purpose === "quotation") {
    return i.purpose === "custom" ? "" : draftMessage(i.purpose, i.lead, { ...ctx, assets: (i.demos ?? []).map((d) => ({ label: d.title, url: safeUrl(d.url)! })) });
  }
  return renderTemplate(t.body, templateVars(i.lead, { ...ctx, demos: i.demos ?? [] }));
}
/**
 * Keep the composer in step with shared data without destroying the user's work:
 * an untouched draft follows the latest template/selection; an edited draft is kept and a notice is raised.
 */
export function syncDraft(s: { text: string; base: string; edited: boolean }, fresh: string): { text: string; base: string; notice: boolean } {
  if (fresh === s.base) return { text: s.text, base: s.base, notice: false };
  if (!s.edited || !s.text.trim()) return { text: fresh, base: fresh, notice: false };
  return { text: s.text, base: s.base, notice: true };
}
export function builtInTemplates(at = new Date().toISOString()): WaTemplate[] {
  const t = (id: string, purpose: TemplatePurpose, name: string, body: string): WaTemplate => ({ id, purpose, name, body, isDefault: true, enabled: true, builtIn: true, updatedAt: at });
  return [
    t("tpl_followup", "followup", "Friendly follow-up", "Hi {firstName}, this is {ownerName} from {businessName}. Just following up on our conversation about {projectType}. Would you have a few minutes today or tomorrow to discuss the next steps?"),
    t("tpl_quotation", "quotation", "Quotation intro", "Hi {firstName}, this is {ownerName} from {businessName}. Happy to share our website packages for {projectType}. Let me know which one suits you and I'll send the full details."),
    t("tpl_samples", "samples", "Website samples", "Hi {firstName}, this is {ownerName} from {businessName}. Sharing some website samples relevant to {projectType}.\n\n{demoLinks}\n\nLet me know which style you like and we can take it from there."),
  ];
}
