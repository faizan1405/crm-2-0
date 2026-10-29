import type { Lead } from "./types";
export const validPhone = (phone: string) => /^(?:91)?[6-9]\d{9}$/.test(phone.replace(/\D/g, ""));
/** Plain mailbox address only — no spaces, angle brackets, quotes or URL characters (?, &, #, /, %, comma) that could change a mailto: link. */
const EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
export const validEmail = (email: string) => EMAIL_RE.test(email.trim());
/** Stored text used as a link target: only http(s) web addresses pass; anything else (javascript:, data:, junk) gives null. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
}
export const mailtoHref = (email: string | undefined) => (email && validEmail(email) ? `mailto:${email.trim()}` : null);
/** Dialer link with digits and a leading + only; null when there is nothing dialable. */
export function telHref(phone: string | undefined) {
  const p = (phone ?? "").trim(), d = p.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 15 ? `tel:${p.startsWith("+") ? "+" : ""}${d}` : null;
}
/** Optional money field typed in a form: blank is fine; otherwise must be a finite number >= 0. */
export function amountFieldError(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return "Enter a valid number";
  if (n < 0) return "Amount can't be negative";
  return undefined;
}
/** Store-level guard for new leads (forms validate first; this stops imports or scripts from saving broken records). */
export function leadCreateError(lead: Pick<Lead, "name" | "phone"> & Partial<Pick<Lead, "email" | "budget" | "quotedAmount">>) {
  if (!lead.name?.trim() || !validPhone(lead.phone ?? "")) return "Name and a valid 10-digit phone are required";
  if (lead.email && !validEmail(lead.email)) return "Invalid email";
  if ([lead.budget, lead.quotedAmount].some((a) => a !== undefined && (!Number.isFinite(a) || a < 0))) return "Amounts must be zero or greater";
  return undefined;
}
export function leadEditError(leads: Lead[], id: string, patch: Partial<Lead>) {
  const current = leads.find((lead) => lead.id === id);
  if (!current) return "Lead not found";
  const next = { ...current, ...patch };
  if (!next.name.trim() || !validPhone(next.phone)) return "Name and a valid 10-digit phone are required";
  if (patch.phone !== undefined && patch.phone !== current.phone && leads.some((lead) => lead.id !== id && lead.phone.replace(/\D/g, "").slice(-10) === next.phone.replace(/\D/g, "").slice(-10))) return "This phone already belongs to another lead";
  if (next.status === "lost" && !next.lostReason?.trim()) return "Add a lost reason";
  if (next.email && !validEmail(next.email)) return "Invalid email";
  if ([next.budget, next.quotedAmount].some((amount) => amount !== undefined && (!Number.isFinite(amount) || amount < 0))) return "Amounts must be zero or greater";
  return undefined;
}
export type LeadFieldErrors = Partial<Record<"name" | "phone" | "email" | "budget" | "quotedAmount", string>>;
/** Per-field errors for the inline Edit Lead form, so each message can sit next to (and be linked to) its own field. */
export function leadEditFieldErrors(leads: Lead[], id: string, f: Record<string, string>): LeadFieldErrors {
  const e: LeadFieldErrors = {};
  if (!(f["name"] ?? "").trim()) e.name = "Name is required";
  const phone = f["phone"] ?? "";
  if (!validPhone(phone)) e.phone = "Enter a valid 10-digit mobile number";
  else if (leads.some((l) => l.id !== id && l.phone.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10))) {
    const cur = leads.find((l) => l.id === id);
    if (!cur || cur.phone.replace(/\D/g, "").slice(-10) !== phone.replace(/\D/g, "").slice(-10)) e.phone = "This phone already belongs to another lead";
  }
  if ((f["email"] ?? "").trim() && !validEmail((f["email"] ?? "").trim())) e.email = "Enter a valid email address";
  for (const k of ["budget", "quotedAmount"] as const) { const m = amountFieldError(f[k] ?? ""); if (m) e[k] = m; }
  return e;
}
