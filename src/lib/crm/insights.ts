// Deterministic "intelligence" derived from the demo store (simulated, no AI service).
import type { Lead, FollowUp, Deal, Payment } from "./types";
import { dayKey } from "./format";
import { dealOutstanding, isDealOverdue } from "./finance";

export type Severity = "critical" | "important" | "normal";
export interface PriorityItem {
  key: string;
  lead: Lead;
  severity: Severity;
  reason: string;
  action: string;
  when?: string;
  value?: number;
}

const DAY = 86_400_000;
export const isOpen = (l: Lead) => l.status !== "won" && l.status !== "lost";
export const isStale = (l: Lead, now: Date) => isOpen(l) && now.getTime() - new Date(l.lastContact ?? l.updatedAt).getTime() > 7 * DAY;

export function buildPriorities(leads: Lead[], followUps: FollowUp[], now = new Date()): PriorityItem[] {
  const today = dayKey(now);
  const items: PriorityItem[] = [];
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (const f of followUps) {
    if (f.completedAt) continue;
    const lead = byId.get(f.leadId);
    if (!lead) continue;
    const k = dayKey(f.dueAt);
    if (k < today) items.push({ key: `fu:${f.id}`, lead, severity: "critical", reason: "Follow-up is overdue", action: `${cap(f.type)} now — ${f.note ?? ""}`, when: f.dueAt, ...val(lead) });
    else if (k === today) items.push({ key: `fu:${f.id}`, lead, severity: lead.priority === "hot" ? "critical" : "important", reason: "Follow-up due today", action: `${cap(f.type)}: ${f.note ?? ""}`, when: f.dueAt, ...val(lead) });
  }
  const covered = new Set(items.map((i) => i.lead.id));
  for (const lead of leads) {
    if (!isOpen(lead) || covered.has(lead.id)) continue;
    if (lead.status === "proposal") items.push({ key: `lead:${lead.id}:proposal`, lead, severity: "important", reason: "Proposal sent — no follow-up scheduled", action: "Check in and confirm next steps", ...val(lead) });
    else if (lead.priority === "hot") items.push({ key: `lead:${lead.id}:hot`, lead, severity: "important", reason: `Hot lead · score ${lead.aiScore ?? "—"}`, action: "Schedule a discovery call", ...val(lead) });
    else if (lead.status === "new") items.push({ key: `lead:${lead.id}:new`, lead, severity: "normal", reason: "New lead not yet contacted", action: "Make first contact", ...val(lead) });
  }
  const rank = { critical: 0, important: 1, normal: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.value ?? 0) - (a.value ?? 0));
}

export function paymentsToChase(deals: Deal[], payments: Payment[], now = new Date()) {
  return deals
    .map((d) => ({ deal: d, due: dealOutstanding(d, payments), overdue: isDealOverdue(d, payments, now) }))
    .filter((x) => x.due > 0)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.due - a.due);
}

const cap = (s: string) => (s === "whatsapp" ? "WhatsApp" : s[0]!.toUpperCase() + s.slice(1));
const val = (l: Lead) => (l.quotedAmount ? { value: l.quotedAmount } : {});
