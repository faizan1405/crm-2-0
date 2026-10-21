import type { Lead } from "./types";
export const validPhone = (phone: string) => /^(?:91)?[6-9]\d{9}$/.test(phone.replace(/\D/g, ""));
export function leadEditError(leads: Lead[], id: string, patch: Partial<Lead>) {
  const current = leads.find((lead) => lead.id === id);
  if (!current) return "Lead not found";
  const next = { ...current, ...patch };
  if (!next.name.trim() || !validPhone(next.phone)) return "Name and a valid 10-digit phone are required";
  if (patch.phone !== undefined && patch.phone !== current.phone && leads.some((lead) => lead.id !== id && lead.phone.replace(/\D/g, "").slice(-10) === next.phone.replace(/\D/g, "").slice(-10))) return "This phone already belongs to another lead";
  if (next.status === "lost" && !next.lostReason?.trim()) return "Add a lost reason";
  if (next.email && !/^\S+@\S+\.\S+$/.test(next.email)) return "Invalid email";
  if ([next.budget, next.quotedAmount].some((amount) => amount !== undefined && (!Number.isFinite(amount) || amount < 0))) return "Amounts must be zero or greater";
  return undefined;
}