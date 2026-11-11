import "@tanstack/react-start/server-only";

const DAY_MS = 86_400_000;

export type DupReason = "phone" | "email" | "possible";
export type DupStrength = "confirmed" | "suggested";
export type RelationKind = "separate" | "related";
export type FirstContact = "not_contacted" | "followup_only" | "outbound" | "attempted" | "established";
export type InboxStatus = "needs_review" | "reviewed";
export type InboxCategory =
  | "all"
  | "needs_review"
  | "unassigned"
  | "newly_assigned"
  | "duplicates"
  | "recently_reviewed";

export const DUP_LABEL: Record<DupReason, string> = {
  phone: "Exact phone match",
  email: "Exact email match",
  possible: "Possible related record",
};

export const FIRST_CONTACT_LABEL: Record<FirstContact, string> = {
  not_contacted: "Not contacted",
  followup_only: "Follow-up scheduled · no contact yet",
  outbound: "Message sent · reply not confirmed",
  attempted: "Contact attempted · not reached",
  established: "Contact established",
};

export const CATEGORY_LABEL: Record<InboxCategory, string> = {
  all: "All intake",
  needs_review: "Needs review",
  unassigned: "Unassigned",
  newly_assigned: "Newly assigned",
  duplicates: "Possible duplicates",
  recently_reviewed: "Recently reviewed",
};

export const NEW_ASSIGN_DAYS = 3;
export const RECENT_REVIEW_DAYS = 7;
export const RECENT_DAYS = 7;

/**
 * Canonical phone digits incl. country code.
 * Indian numbers (+91, 0-prefixed, bare 10-digit 6-9xxx) collapse to "91XXXXXXXXXX".
 * Other international numbers keep their full country code, so +1 9876543210 never equals +91 98765 43210.
 */
export function normalizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  const intl = t.startsWith("+") || t.startsWith("00");
  let d = t.replace(/\D/g, "");
  if (t.startsWith("00")) d = d.slice(2);
  if (!d) return undefined;

  // Handle Indian trunk prefix 0 in international format, e.g. +91 (0) 98765 43210
  if (d.startsWith("910") && d.length === 13 && /^[6-9]/.test(d.slice(3))) {
    d = `91${d.slice(3)}`;
  }

  if (intl) {
    if (d.startsWith("91") && d.length === 12 && /^[6-9]/.test(d.slice(2))) {
      return d;
    }
    return d.length >= 8 ? d : undefined;
  }
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return d;
  return d.length >= 8 ? d : undefined;
}

/**
 * Trimmed, case-insensitive email normalization.
 * No provider-specific tricks (dots/plus tags are kept).
 */
export function normalizeEmail(raw: string | null | undefined): string | undefined {
  const e = raw?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined;
}

export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical pair key ordering: always smaller ID first.
 */
export function pairKey(a: string, b: string): string {
  if (a === b) {
    throw new Error(`Self-referencing lead pair is invalid: ${a}`);
  }
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Signature of the identifiers a decision was based on (normalized phone + email of both leads).
 * If either lead changes phone or email later, the signature mismatches and the candidate is reopened.
 */
export function pairSignature(
  x: { phone?: string | null; email?: string | null },
  y: { phone?: string | null; email?: string | null },
): string {
  const one = (l: { phone?: string | null; email?: string | null }) =>
    `${normalizePhone(l.phone) ?? ""}/${normalizeEmail(l.email) ?? ""}`;
  return [one(x), one(y)].sort().join("|");
}

export interface MatchEvaluation {
  isMatch: boolean;
  reasons: DupReason[];
  strength: DupStrength;
}

/**
 * Evaluate duplicate matching between two distinct leads.
 * Phone/email equality is "confirmed match"; name+company is only a suggestion.
 * A name-only similarity never counts.
 */
export function evaluateDuplicateMatch(
  x: { id: string; name: string; phone: string; email?: string | null; company?: string | null },
  y: { id: string; name: string; phone: string; email?: string | null; company?: string | null },
): MatchEvaluation {
  if (x.id === y.id) {
    return { isMatch: false, reasons: [], strength: "suggested" };
  }

  const reasons: DupReason[] = [];

  const px = normalizePhone(x.phone);
  const py = normalizePhone(y.phone);
  if (px && py && px === py) {
    reasons.push("phone");
  }

  const ex = normalizeEmail(x.email);
  const ey = normalizeEmail(y.email);
  if (ex && ey && ex === ey) {
    reasons.push("email");
  }

  const nx = normName(x.name);
  const ny = normName(y.name);
  const cx = normName(x.company);
  const cy = normName(y.company);

  // Both contact name and business name must exist and match for a "possible" suggestion
  if (nx && ny && cx && cy && nx === ny && cx === cy) {
    reasons.push("possible");
  }

  const isMatch = reasons.length > 0;
  const strength: DupStrength = reasons.some((r) => r === "phone" || r === "email")
    ? "confirmed"
    : "suggested";

  return { isMatch, reasons, strength };
}

/**
 * Contact comes only from saved call outcomes / confirmed sends. A follow-up alone is never contact.
 */
export function firstContactState(
  activities: Array<{ type: string; outcome?: string | null }>,
  followUps: Array<{ completedAt?: string | null; cancelledAt?: string | null }>,
): FirstContact {
  const calls = activities.filter((a) => a.type === "call");
  if (calls.some((c) => c.outcome === "Connected")) return "established";
  if (calls.some((c) => c.outcome && c.outcome !== "Connected")) return "attempted";

  if (activities.some((a) => a.type === "whatsapp")) return "outbound";

  const hasPendingFollowup = followUps.some((f) => !f.completedAt && !f.cancelledAt);
  if (hasPendingFollowup) return "followup_only";

  return "not_contacted";
}

export function isContactPending(c: FirstContact): boolean {
  return c === "not_contacted" || c === "followup_only";
}

export function computeAgeDays(isoString: string | Date, now = new Date()): number {
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export function isWithinDays(isoString: string | null | undefined, days: number, now = new Date()): boolean {
  if (!isoString) return false;
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= days * DAY_MS;
}
