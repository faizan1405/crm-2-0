// Pure, permission-aware context builder. During an Employee Preview the store already holds only
// that employee's scoped copy; this re-checks scope and strips money for viewers without amounts.
import type { Lead, LeadActivity, FollowUp, Deal, Payment } from "@/lib/crm/types";
import { STATUS_LABEL } from "@/lib/crm/types";
import type { PreviewSession } from "@/lib/crm/session";
import { dealCollected, dealOutstanding } from "@/lib/crm/finance";
import type { ContextResult, LeadContext } from "./types";

export interface ContextSource {
  leads: Lead[];
  activities: LeadActivity[];
  followUps: FollowUp[];
  deals: Deal[];
  payments: Payment[];
  assignments: Record<string, { employeeId: string | null } | undefined>;
}

export const canSeeMoney = (p: PreviewSession | null) => !p || p.finance === "amounts" || p.finance === "manage";

const SECRETISH = /\b(password|passwd|api[_ -]?key|secret|token|otp|pin)\b\s*[:=]?\s*\S+/gi;
/** Masks anything that looks like a credential before it can enter AI context. */
export const scrubSecrets = (s: string) => s.replace(SECRETISH, "[hidden]");

export function buildLeadContext(src: ContextSource, leadId: string, preview: PreviewSession | null, now = new Date()): ContextResult {
  const l = src.leads.find((x) => x.id === leadId);
  if (!l) return { ok: false, reason: preview ? "not_permitted" : "not_found" };
  if (preview && preview.leadScope === "assigned" && src.assignments[leadId]?.employeeId !== preview.employeeId) return { ok: false, reason: "not_permitted" };
  const money = canSeeMoney(preview);
  const excluded = ["Payment proof files", "Personal notes", "Other leads", "Login and key details"];
  if (!money) excluded.unshift("Amounts, deals and payments");
  const acts = src.activities
    .filter((a) => a.leadId === leadId && (money || a.type !== "payment"))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
    .map((a) => scrubSecrets(a.text + (a.outcome ? ` · ${a.outcome}` : "")));
  const pending = src.followUps.filter((f) => f.leadId === leadId && !f.completedAt && !f.cancelledAt);
  const ctx: LeadContext = {
    leadId: l.id, name: l.name, stage: STATUS_LABEL[l.status], priority: l.priority, source: l.source,
    recentActivity: acts, pendingFollowUps: pending.length, excluded,
    ...(l.company ? { company: l.company } : {}),
    ...(l.requirement ? { requirement: scrubSecrets(l.requirement) } : {}),
    ...(l.lastContact ? { lastContact: l.lastContact } : {}),
    ...(l.nextFollowUp ? { nextFollowUp: l.nextFollowUp } : {}),
    ...(l.notes ? { clientNotes: scrubSecrets(l.notes).slice(0, 600) } : {}),
  };
  if (money) {
    const ds = src.deals.filter((d) => d.leadId === leadId && d.status !== "cancelled");
    const qb = l.quotedAmount ?? l.budget;
    ctx.money = {
      ...(qb !== undefined ? { quotedOrBudget: qb } : {}),
      dealsAgreed: ds.reduce((s, d) => s + d.finalAmount, 0),
      received: ds.reduce((s, d) => s + dealCollected(d.id, src.payments), 0),
      outstanding: ds.reduce((s, d) => s + dealOutstanding(d, src.payments), 0),
    };
  }
  void now;
  return { ok: true, lead: ctx };
}
