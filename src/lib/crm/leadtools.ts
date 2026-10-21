// Pure rules for Advanced Lead Management (bulk entry, merge, stale, quick status, bin).
import type { Lead } from "./types";
import { structureLead, type ParsedLead } from "./parse";
import { validPhone } from "./validation";

export type QuickStatus = "interested" | "callback" | "not_picked" | "busy" | "not_interested" | "switched_off";
export const QUICK_STATUSES: QuickStatus[] = ["interested", "callback", "not_picked", "busy", "not_interested", "switched_off"];
export const QUICK_LABEL: Record<QuickStatus, string> = {
  interested: "Interested",
  callback: "Call back",
  not_picked: "Not picked",
  busy: "Busy",
  not_interested: "Not interested",
  switched_off: "Switched off",
};

export const STALE_DAYS = 7;
const DAY = 86_400_000;
const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

/** Open lead with no contact/update for STALE_DAYS and no pending follow-up. Won/lost are never stale. */
export function staleDays(lead: Lead, now: Date): number | undefined {
  if (lead.status === "won" || lead.status === "lost") return undefined;
  if (lead.nextFollowUp && new Date(lead.nextFollowUp).getTime() >= now.getTime()) return undefined;
  const ref = [lead.lastContact, lead.updatedAt, lead.createdAt].filter(Boolean).map((d) => new Date(d!).getTime()).reduce((a, b) => Math.max(a, b), 0);
  const days = Math.floor((now.getTime() - ref) / DAY);
  return days >= STALE_DAYS ? days : undefined;
}

/** Merge incoming details into an existing lead: fills empty fields, never blanks data; "overwrite" replaces differing values. Notes are appended. */
export function mergePatch(existing: Lead, incoming: ParsedLead, mode: "fill" | "overwrite"): Partial<Lead> {
  const patch: Partial<Lead> = {};
  const keys = ["name", "email", "company", "requirement", "budget", "quotedAmount", "source"] as const;
  for (const k of keys) {
    const v = incoming[k];
    if (v === undefined || v === "") continue;
    const cur = existing[k];
    if (cur === undefined || cur === "" || cur === 0 || (mode === "overwrite" && cur !== v)) (patch as Record<string, unknown>)[k] = v;
  }
  const extra = incoming.notes?.trim();
  if (extra && !(existing.notes ?? "").includes(extra)) patch.notes = existing.notes ? `${existing.notes}\n${extra}` : extra;
  return patch;
}

export type BulkRowState = "new" | "duplicate" | "batch_duplicate" | "invalid";
export interface BulkRow { key: string; raw: string; parsed: ParsedLead; state: BulkRowState; existingId?: string; problem?: string }

/** One lead per non-empty line (or per blank-line separated block). */
export function splitBulk(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const chunks = blocks.length > 1 ? blocks : text.split("\n").map((l) => l.trim()).filter(Boolean);
  return chunks.map((c) => c.replace(/\s*\n\s*/g, ", "));
}

export function reviewBulk(text: string, leads: Lead[]): BulkRow[] {
  const seen = new Set<string>();
  return splitBulk(text).map((raw, i) => {
    const parsed = structureLead(raw);
    const base = { key: `row-${i}`, raw, parsed };
    if (!parsed.name || !parsed.phone || !validPhone(parsed.phone)) return { ...base, state: "invalid", problem: !parsed.phone ? "No valid phone found" : !validPhone(parsed.phone) ? "Invalid phone" : "No name found" };
    const p = last10(parsed.phone);
    const existing = leads.find((l) => last10(l.phone) === p);
    if (seen.has(p)) return { ...base, state: "batch_duplicate", problem: "Same phone appears earlier in this batch" };
    seen.add(p);
    if (existing) return { ...base, state: "duplicate", existingId: existing.id };
    return { ...base, state: "new" };
  });
}
