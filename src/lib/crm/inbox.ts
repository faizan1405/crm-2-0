// Phase 3E — Smart Lead Inbox (pure). Works on the SAME lead records as Leads/Pipeline/Follow-ups.
// Inbox review state, duplicate decisions and relations live in separate maps keyed by lead id,
// so the pipeline stage, quick status and priority are never touched by inbox work.
import type { FollowUp, Lead, LeadActivity, LeadPriority, LeadStatus } from "./types";
import type { Assignment } from "./access";

const DAY = 86_400_000;

/* ---------- normalization ---------- */

/** Canonical phone digits incl. country code. Indian numbers (+91, 0-prefixed, bare 10-digit 6-9xxx) collapse to "91XXXXXXXXXX".
 *  Other international numbers keep their full country code, so +1 9876543210 never equals +91 98765 43210. */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  const intl = t.startsWith("+") || t.startsWith("00");
  let d = t.replace(/\D/g, "");
  if (t.startsWith("00")) d = d.slice(2);
  if (!d) return undefined;
  if (intl) return d.length >= 8 ? d : undefined;
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return d;
  return d.length >= 8 ? d : undefined;
}

/** Trimmed, case-insensitive. No provider-specific tricks (dots/plus tags are kept). */
export function normalizeEmail(raw: string | undefined): string | undefined {
  const e = raw?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined;
}
const normName = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/* ---------- inbox state ---------- */

export interface InboxMeta { reviewedAt?: string; flaggedAt?: string; flagNote?: string }
export type RelationKind = "separate" | "related";
export interface LeadRelation { key: string; a: string; b: string; kind: RelationKind; at: string; note?: string }
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ---------- duplicates ---------- */

export type DupReason = "phone" | "email" | "possible";
export const DUP_LABEL: Record<DupReason, string> = { phone: "Exact phone match", email: "Exact email match", possible: "Possible related record" };
export interface DupPair { key: string; a: string; b: string; reasons: DupReason[]; strength: "confirmed" | "suggested" }

/** Find duplicate pairs. Phone/email equality is "confirmed match"; name+company (or name + same email domain) is only a suggestion.
 *  A name-only similarity never counts. Pairs the Owner resolved (Keep Separate / Related) are excluded. */
export function findDuplicates(leads: Lead[], relations: Record<string, LeadRelation> = {}): DupPair[] {
  const pairs = new Map<string, DupPair>();
  const add = (x: Lead, y: Lead, r: DupReason) => {
    if (x.id === y.id) return;
    const key = pairKey(x.id, y.id);
    if (relations[key]) return;
    const p = pairs.get(key) ?? { key, a: x.id < y.id ? x.id : y.id, b: x.id < y.id ? y.id : x.id, reasons: [], strength: "suggested" as const };
    if (!p.reasons.includes(r)) p.reasons.push(r);
    if (r !== "possible") p.strength = "confirmed";
    pairs.set(key, p);
  };
  const group = (keyOf: (l: Lead) => string | undefined, r: DupReason) => {
    const m = new Map<string, Lead[]>();
    for (const l of leads) { const k = keyOf(l); if (k) m.set(k, [...(m.get(k) ?? []), l]); }
    for (const g of m.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) add(g[i]!, g[j]!, r);
  };
  group((l) => normalizePhone(l.phone), "phone");
  group((l) => normalizeEmail(l.email), "email");
  group((l) => { const n = normName(l.name), c = normName(l.company); return n && c ? `${n}@@${c}` : undefined; }, "possible");
  return [...pairs.values()].sort((p, q) => (p.strength === q.strength ? p.key.localeCompare(q.key) : p.strength === "confirmed" ? -1 : 1));
}
export function duplicateIds(pairs: DupPair[]): Set<string> { const s = new Set<string>(); for (const p of pairs) { s.add(p.a); s.add(p.b); } return s; }

/* ---------- first contact ---------- */

export type FirstContact = "not_contacted" | "call_logged" | "attempt" | "followup";
export const FIRST_CONTACT_LABEL: Record<FirstContact, string> = { not_contacted: "Not contacted", call_logged: "First call logged", attempt: "Contact attempt recorded", followup: "Follow-up scheduled" };
/** Only saved records count: a logged call, a confirmed WhatsApp/email/meeting entry, or a pending follow-up. Clicking Call alone never counts. */
export function firstContact(leadId: string, activities: LeadActivity[], followUps: FollowUp[]): FirstContact {
  const acts = activities.filter((a) => a.leadId === leadId);
  if (acts.some((a) => a.type === "call")) return "call_logged";
  if (acts.some((a) => a.type === "whatsapp" || a.type === "email" || a.type === "meeting")) return "attempt";
  if (followUps.some((f) => f.leadId === leadId && !f.completedAt && !f.cancelledAt)) return "followup";
  return "not_contacted";
}

/* ---------- categories & filters ---------- */

export type InboxStatus = "needs_review" | "reviewed";
export type InboxCategory = "all" | "needs_review" | "unassigned" | "newly_assigned" | "duplicates" | "recently_reviewed";
export const CATEGORY_LABEL: Record<InboxCategory, string> = { all: "All intake", needs_review: "Needs review", unassigned: "Unassigned", newly_assigned: "Newly assigned", duplicates: "Possible duplicates", recently_reviewed: "Recently reviewed" };
export const NEW_ASSIGN_DAYS = 3;
export const RECENT_REVIEW_DAYS = 7;
export const RECENT_DAYS = 7;

export interface InboxRow { lead: Lead; status: InboxStatus; reviewedAt?: string | undefined; flagged: boolean; duplicate: boolean; assignee: string | null; assignedAt?: string | undefined; contact: FirstContact; ageDays: number }
export interface InboxCtx { leads: Lead[]; meta: Record<string, InboxMeta>; assignments: Record<string, Assignment>; activities: LeadActivity[]; followUps: FollowUp[]; dupIds: Set<string>; now: Date }

export function buildRows(c: InboxCtx): InboxRow[] {
  return c.leads.map((lead) => {
    const m = c.meta[lead.id]; const a = c.assignments[lead.id];
    return { lead, status: m?.reviewedAt ? "reviewed" : "needs_review", reviewedAt: m?.reviewedAt, flagged: !!m?.flaggedAt, duplicate: c.dupIds.has(lead.id) || !!m?.flaggedAt, assignee: a?.employeeId ?? null, assignedAt: a?.employeeId ? a.assignedAt : undefined, contact: firstContact(lead.id, c.activities, c.followUps), ageDays: Math.max(0, Math.floor((c.now.getTime() - new Date(lead.createdAt).getTime()) / DAY)) };
  });
}
const within = (iso: string | undefined, days: number, now: Date) => !!iso && now.getTime() - new Date(iso).getTime() <= days * DAY;
/** Intake = still being processed: not reviewed yet, or reviewed in the last RECENT_REVIEW_DAYS. Won/Lost leads are never intake. */
export function inCategory(r: InboxRow, cat: InboxCategory, now: Date): boolean {
  const open = r.lead.status !== "won" && r.lead.status !== "lost";
  const intake = open && (r.status === "needs_review" || within(r.reviewedAt, RECENT_REVIEW_DAYS, now));
  switch (cat) {
    case "all": return intake;
    case "needs_review": return open && r.status === "needs_review";
    case "unassigned": return intake && !r.assignee;
    case "newly_assigned": return open && !!r.assignee && within(r.assignedAt, NEW_ASSIGN_DAYS, now);
    case "duplicates": return r.duplicate;
    case "recently_reviewed": return r.status === "reviewed" && within(r.reviewedAt, RECENT_REVIEW_DAYS, now);
  }
}

export interface InboxFilters {
  q?: string | undefined; source?: string | undefined; assignee?: "all" | "unassigned" | string | undefined; priority?: LeadPriority | "all" | undefined; stage?: LeadStatus | "all" | undefined;
  status?: InboxStatus | "all" | undefined; createdDays?: number | undefined; contactedDays?: number | undefined; firstContactPending?: boolean | undefined; duplicate?: boolean | undefined;
}
export function filterRows(rows: InboxRow[], cat: InboxCategory, f: InboxFilters, now: Date): InboxRow[] {
  const q = f.q?.trim().toLowerCase(); const qd = q?.replace(/\D/g, "");
  return rows.filter((r) => {
    const l = r.lead;
    if (!inCategory(r, cat, now)) return false;
    if (q && ![l.name, l.email, l.company].some((v) => v?.toLowerCase().includes(q)) && !(qd && qd.length >= 3 && l.phone.replace(/\D/g, "").includes(qd))) return false;
    if (f.source && f.source !== "all" && l.source !== f.source) return false;
    if (f.assignee && f.assignee !== "all" && (f.assignee === "unassigned" ? r.assignee !== null : r.assignee !== f.assignee)) return false;
    if (f.priority && f.priority !== "all" && l.priority !== f.priority) return false;
    if (f.stage && f.stage !== "all" && l.status !== f.stage) return false;
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.createdDays && !within(l.createdAt, f.createdDays, now)) return false;
    if (f.contactedDays && !within(l.lastContact, f.contactedDays, now)) return false;
    if (f.firstContactPending && r.contact !== "not_contacted") return false;
    if (f.duplicate && !r.duplicate) return false;
    return true;
  }).sort((a, b) => b.lead.createdAt.localeCompare(a.lead.createdAt));
}

export interface InboxOverview { awaitingReview: number; unassigned: number; duplicates: number; needFirstContact: number; recent: number }
export function overview(rows: InboxRow[], now: Date): InboxOverview {
  const open = rows.filter((r) => r.lead.status !== "won" && r.lead.status !== "lost");
  return {
    awaitingReview: open.filter((r) => r.status === "needs_review").length,
    unassigned: rows.filter((r) => inCategory(r, "unassigned", now)).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    needFirstContact: open.filter((r) => r.contact === "not_contacted").length,
    recent: rows.filter((r) => within(r.lead.createdAt, RECENT_DAYS, now)).length,
  };
}

/* ---------- merge safety ---------- */

export interface MergeImpact { activities: number; followUps: number; deals: number; payments: number; proofs: number; assigned: boolean }
/** Merging is NOT activated in this browser-local build: payment proofs live in a separate file store and
 *  assignment/activity history is keyed by lead id, so moving everything atomically cannot be guaranteed yet.
 *  This returns why, so the UI can show a read-only merge preview and offer Mark as Related instead. */
export function mergeBlockers(impact: MergeImpact): string[] {
  const b = ["Safe merging needs the secure backend so every linked record moves in one step. Use Mark as Related for now — nothing is lost."];
  if (impact.payments || impact.proofs) b.push("Payments or payment proof files are linked to these records.");
  if (impact.deals) b.push("Deals are linked to these records.");
  return b;
}

/* ---------- future intake contract ---------- */

export type IntakeChannel = "manual" | "meta_lead_form" | "website_form" | "whatsapp" | "csv_import" | "api";
/** Shape the future backend will send for incoming enquiries. Nothing is connected yet. */
export interface IntakeEvent { channel: IntakeChannel; externalId?: string; receivedAt: string; name: string; phone: string; email?: string; company?: string; requirement?: string; source: string; campaign?: string }
export type IntakeDecision = { action: "create" } | { action: "skip_duplicate_event"; externalId: string } | { action: "review_duplicate"; matchId: string; reason: DupReason };
/** Idempotent intake: the same external event is never created twice; a matching phone/email goes to Duplicate Review instead of auto-merging. */
export function intakeDecision(e: IntakeEvent, leads: Lead[], seenExternal: Set<string>): IntakeDecision {
  if (e.externalId && seenExternal.has(`${e.channel}:${e.externalId}`)) return { action: "skip_duplicate_event", externalId: e.externalId };
  const p = normalizePhone(e.phone), m = normalizeEmail(e.email);
  const byPhone = p && leads.find((l) => normalizePhone(l.phone) === p);
  if (byPhone) return { action: "review_duplicate", matchId: byPhone.id, reason: "phone" };
  const byMail = m && leads.find((l) => normalizeEmail(l.email) === m);
  if (byMail) return { action: "review_duplicate", matchId: byMail.id, reason: "email" };
  return { action: "create" };
}
