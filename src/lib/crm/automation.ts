// Phase 3E.1 — Sales Automation Studio (pure, backend-agnostic).
// Rules are evaluated against saved CRM records only. Browser-local: evaluation happens while the
// app is open (on open/resume, after data changes, and on "Evaluate now"). There is no background
// scheduler — a future Hostinger scheduler will call the same `planAutomation` contract server-side.
// Safety: stable idempotency keys (rule + target + signature), cooldowns, automation-origin markers
// (never re-trigger themselves), no deletion, no money edits, no customer messages.
import type { FollowUp, Lead, LeadActivity, LeadPriority, LeadSource, LeadStatus } from "./types";
import type { Assignment } from "./access";
import { stageSince, daysIn } from "./pipeline";
import { isConnectedOutcome, type CallOutcome } from "./calllog";

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/* ---------- contact tracking ---------- */

export type ContactState = "none" | "outbound" | "attempted" | "established";
export const CONTACT_LABEL: Record<ContactState, string> = { none: "No contact recorded", outbound: "Message sent · reply not confirmed", attempted: "Contact attempted · not reached", established: "Contact established" };
const isAutoActivity = (a: Pick<LeadActivity, "opId">) => !!a.opId?.startsWith("auto:");
/** Contact evidence comes only from saved call logs (outcome) and confirmed WhatsApp sends.
 *  Clicking Call, opening the composer, scheduling or completing a follow-up never counts. */
export function contactState(leadId: string, activities: LeadActivity[]): ContactState {
  let s: ContactState = "none";
  for (const a of activities) {
    if (a.leadId !== leadId || isAutoActivity(a)) continue;
    if (a.type === "call") {
      if (a.outcome && isConnectedOutcome(a.outcome as CallOutcome)) return "established";
      s = "attempted";
    } else if ((a.type === "whatsapp" || a.type === "email") && s === "none") s = "outbound";
    else if (a.type === "meeting") return "established";
  }
  return s;
}
/** Latest real (non-automation) contact attempt time. */
export function lastAttemptAt(leadId: string, activities: LeadActivity[]): string | undefined {
  let best: string | undefined;
  for (const a of activities) if (a.leadId === leadId && !isAutoActivity(a) && (a.type === "call" || a.type === "whatsapp" || a.type === "email" || a.type === "meeting") && (!best || a.at > best)) best = a.at;
  return best;
}
/** Latest real activity of any kind (stage changes, notes, calls…), excluding automation-origin rows. */
export function lastActivityAt(lead: Lead, activities: LeadActivity[]): string {
  let best = lead.createdAt;
  for (const a of activities) if (a.leadId === lead.id && !isAutoActivity(a) && a.type !== "created" && a.at > best) best = a.at;
  return best;
}

/* ---------- rule model ---------- */

export type TriggerType = "lead_created" | "lead_assigned" | "lead_updated" | "stage_changed" | "followup_created" | "followup_overdue" | "followup_completed" | "call_logged" | "deal_won" | "inactivity";
export const TRIGGER_LABEL: Record<TriggerType, string> = {
  lead_created: "Lead created", lead_assigned: "Lead assigned", lead_updated: "Lead updated", stage_changed: "Pipeline stage changed",
  followup_created: "Follow-up created", followup_overdue: "Follow-up overdue", followup_completed: "Follow-up completed", call_logged: "Call logged",
  deal_won: "Deal marked Won", inactivity: "Time since last recorded activity",
};
export type ActionType = "reminder" | "notify" | "flag" | "followup" | "activity" | "owner_review";
export const ACTION_LABEL: Record<ActionType, string> = { reminder: "Create internal reminder", notify: "Generate CRM notification", flag: "Flag lead for attention", followup: "Create a follow-up", activity: "Add activity entry", owner_review: "Request Owner review" };
export type RuleStatus = "draft" | "enabled" | "paused" | "archived";

export interface RuleConditions {
  sources?: LeadSource[]; stages?: LeadStatus[]; priorities?: LeadPriority[];
  employeeId?: string; assigned?: "any" | "assigned" | "unassigned";
  inboxStatus?: "any" | "needs_review" | "reviewed"; firstContactPending?: boolean;
  /** Minimum minutes since the lead was created / since the last contact attempt / in the current stage (days). */
  minCreatedMinutes?: number; minSinceAttemptMinutes?: number; minStageDays?: number; minInactiveHours?: number;
  followupStatus?: "any" | "pending" | "overdue" | "completed";
  /** Phase 3G: custom field / tag conditions (Saved View condition shape). All must match. */
  custom?: { id: string; field: string; op: string; value?: unknown }[];
}
export interface RuleSettings { overdueMinutes?: number; cooldownHours: number; escalateOwnerAfterMinutes?: number; followupInHours?: number; windowHours?: number }
export interface AutomationRule {
  id: string; name: string; description: string; templateId?: string;
  status: RuleStatus; trigger: TriggerType; conditions: RuleConditions; actions: ActionType[]; settings: RuleSettings;
  createdAt: string; updatedAt: string; version: number; lastEvaluatedAt?: string; lastTriggeredAt?: string;
}
export type ReminderStatus = "open" | "done" | "dismissed" | "resolved";
export interface Reminder {
  id: string; key: string; ruleId: string; ruleName: string; leadId: string; employeeId: string | null;
  reason: string; dueAt: string; importance: "normal" | "high"; status: ReminderStatus; createdAt: string; closedAt?: string;
  flag: boolean; ownerReview: boolean; escalated?: boolean; followUpId?: string; resolveWhen?: "contact" | "activity" | "followup_done" | "never";
  origin: "automation"; history?: { at: string; text: string }[];
}
export type RunOutcome = "evaluated" | "triggered" | "skipped" | "failed" | "disabled";
export interface AutomationRun { id: string; ruleId: string; ruleName: string; at: string; outcome: RunOutcome; leadId?: string; actions: string[]; skippedDuplicates: number; matched: number; error?: string; manual: boolean }
export interface AutomationSettings { autoEvaluate: boolean; maxActionsPerRun: number; bulkConfirmThreshold: number; notifyOwnerOnEscalation: boolean }
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = { autoEvaluate: true, maxActionsPerRun: 200, bulkConfirmThreshold: 20, notifyOwnerOnEscalation: true };

/* ---------- templates (all start disabled) ---------- */

type Tpl = Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "version" | "status">;
export const RULE_TEMPLATES: (Tpl & { templateId: string })[] = [
  { templateId: "tpl_response", name: "New lead response reminder", description: "Assigned lead with no recorded contact attempt after the set time.", trigger: "lead_assigned", conditions: { assigned: "assigned", firstContactPending: true, minCreatedMinutes: 30, stages: ["new"] }, actions: ["reminder", "flag", "notify"], settings: { cooldownHours: 24, escalateOwnerAfterMinutes: 120 } },
  { templateId: "tpl_overdue", name: "Overdue follow-up escalation", description: "A scheduled follow-up is overdue. Never marks it complete.", trigger: "followup_overdue", conditions: { followupStatus: "overdue" }, actions: ["reminder", "notify"], settings: { overdueMinutes: 15, cooldownHours: 24, escalateOwnerAfterMinutes: 240 } },
  { templateId: "tpl_hot", name: "Hot lead protection", description: "Hot lead with no recent recorded activity. Priority is never changed.", trigger: "inactivity", conditions: { priorities: ["hot"], minInactiveHours: 48 }, actions: ["reminder", "flag"], settings: { cooldownHours: 48 } },
  { templateId: "tpl_stale", name: "Stale pipeline warning", description: "Lead has stayed in one stage too long — added to the review queue.", trigger: "stage_changed", conditions: { stages: ["contacted", "qualified", "proposal"], minStageDays: 7 }, actions: ["reminder", "flag", "owner_review"], settings: { cooldownHours: 168 } },
  { templateId: "tpl_assigned", name: "Newly assigned leads", description: "One summary reminder per employee for leads assigned recently.", trigger: "lead_assigned", conditions: { assigned: "assigned" }, actions: ["reminder"], settings: { cooldownHours: 24, windowHours: 24 } },
  { templateId: "tpl_won", name: "Won deal handoff", description: "Offer a project handoff checklist when a deal is won. The sales record is unchanged.", trigger: "deal_won", conditions: { stages: ["won"] }, actions: ["reminder", "owner_review"], settings: { cooldownHours: 24 * 365 } },
];
export function ruleFromTemplate(tplId: string, id: string, at: string): AutomationRule | undefined {
  const t = RULE_TEMPLATES.find((x) => x.templateId === tplId);
  return t ? { ...structuredClone(t), id, status: "draft", createdAt: at, updatedAt: at, version: 1 } : undefined;
}

/* ---------- validation & conflicts ---------- */

export function ruleError(r: Pick<AutomationRule, "name" | "trigger" | "actions" | "conditions" | "settings">): string | null {
  if (!r.name.trim()) return "Give the rule a name.";
  if (!r.actions.length) return "Choose at least one action.";
  if (!(r.settings.cooldownHours >= 1)) return "Cooldown must be at least 1 hour so alerts can't repeat on every refresh.";
  const n = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);
  const c = r.conditions;
  if (![c.minCreatedMinutes, c.minSinceAttemptMinutes, c.minStageDays, c.minInactiveHours, r.settings.overdueMinutes, r.settings.escalateOwnerAfterMinutes, r.settings.followupInHours].every(n)) return "Times must be zero or more.";
  if (r.actions.includes("followup") && !(r.settings.followupInHours && r.settings.followupInHours > 0)) return "Set when the automatic follow-up should be due.";
  if (r.trigger === "deal_won" && c.stages && c.stages.some((s) => s !== "won")) return "A Won-deal rule can only match the Won stage.";
  return null;
}
/** Enabled rules that would act on the same leads in contradictory or repeated ways. */
export function ruleConflicts(rule: AutomationRule, rules: AutomationRule[]): string[] {
  const out: string[] = [];
  for (const o of rules) {
    if (o.id === rule.id || o.status !== "enabled") continue;
    if (o.trigger !== rule.trigger) continue;
    const same = JSON.stringify(o.conditions) === JSON.stringify(rule.conditions);
    if (same) out.push(`"${o.name}" already uses the same trigger and conditions — reminders would double up.`);
    else if (o.actions.includes("followup") && rule.actions.includes("followup")) out.push(`"${o.name}" also creates follow-ups for this trigger. Only one follow-up per lead can be active, so the second is skipped.`);
  }
  return out;
}

/* ---------- evaluation ---------- */

export interface EvalCtx {
  leads: Lead[]; activities: LeadActivity[]; followUps: FollowUp[]; assignments: Record<string, Assignment>;
  inboxMeta: Record<string, { reviewedAt?: string }>; now: Date;
  /** Evaluates `conditions.custom` (custom fields / tags). Without it, custom conditions match nothing. */
  customMatch?: (lead: Lead, conditions: NonNullable<RuleConditions["custom"]>) => boolean;
}
export interface Match { leadId: string; employeeId: string | null; target: string; signature: string; reason: string; dueAt: string; resolveWhen: Reminder["resolveWhen"]; escalate: boolean }

const ago = (iso: string | undefined, now: Date) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);
function leadPasses(l: Lead, c: RuleConditions, x: EvalCtx, contact: ContactState): boolean {
  const a = x.assignments[l.id]?.employeeId ?? null;
  if (c.sources?.length && !c.sources.includes(l.source)) return false;
  if (c.stages?.length && !c.stages.includes(l.status)) return false;
  if (c.priorities?.length && !c.priorities.includes(l.priority)) return false;
  if (c.employeeId && a !== c.employeeId) return false;
  if (c.assigned === "assigned" && !a) return false;
  if (c.assigned === "unassigned" && a) return false;
  const reviewed = !!x.inboxMeta[l.id]?.reviewedAt;
  if (c.inboxStatus === "needs_review" && reviewed) return false;
  if (c.inboxStatus === "reviewed" && !reviewed) return false;
  if (c.firstContactPending && contact !== "none") return false;
  if (c.minCreatedMinutes !== undefined && ago(l.createdAt, x.now) < c.minCreatedMinutes * MIN) return false;
  if (c.minSinceAttemptMinutes !== undefined && ago(lastAttemptAt(l.id, x.activities), x.now) < c.minSinceAttemptMinutes * MIN) return false;
  if (c.minStageDays !== undefined) { const d = daysIn(stageSince(l, x.activities) ?? l.createdAt, x.now); if (d === null || d < c.minStageDays) return false; }
  if (c.minInactiveHours !== undefined && ago(lastActivityAt(l, x.activities), x.now) < c.minInactiveHours * HOUR) return false;
  if (c.custom?.length && !(x.customMatch && x.customMatch(l, c.custom))) return false;
  return true;
}
const fmt = (ms: number) => (ms >= DAY ? `${Math.floor(ms / DAY)}d` : ms >= HOUR ? `${Math.floor(ms / HOUR)}h` : `${Math.max(1, Math.floor(ms / MIN))}m`);

/** Pure: which leads/records match this rule right now, with stable targets for idempotency. */
export function evaluateRule(rule: AutomationRule, x: EvalCtx): Match[] {
  const out: Match[] = [];
  const nowIso = x.now.toISOString();
  const esc = (sinceMs: number) => rule.settings.escalateOwnerAfterMinutes !== undefined && sinceMs >= rule.settings.escalateOwnerAfterMinutes * MIN;
  const open = (l: Lead) => l.status !== "won" && l.status !== "lost";
  if (rule.trigger === "followup_overdue" || rule.trigger === "followup_created" || rule.trigger === "followup_completed") {
    const byId = new Map(x.leads.map((l) => [l.id, l]));
    for (const f of x.followUps) {
      const l = byId.get(f.leadId); if (!l || f.cancelledAt || f.opId?.startsWith("auto:")) continue;
      const late = x.now.getTime() - new Date(f.dueAt).getTime();
      const st = f.completedAt ? "completed" : late > 0 ? "overdue" : "pending";
      const want = rule.trigger === "followup_overdue" ? "overdue" : rule.trigger === "followup_completed" ? "completed" : (rule.conditions.followupStatus ?? "any");
      if (want !== "any" && st !== want) continue;
      if (rule.trigger === "followup_overdue" && late < (rule.settings.overdueMinutes ?? 0) * MIN) continue;
      if (!leadPasses(l, rule.conditions, x, contactState(l.id, x.activities))) continue;
      const reason = st === "overdue" ? `Follow-up with ${l.name} is ${fmt(late)} overdue.` : st === "completed" ? `Follow-up with ${l.name} was completed — review next step.` : `Follow-up scheduled with ${l.name}.`;
      out.push({ leadId: l.id, employeeId: x.assignments[l.id]?.employeeId ?? null, target: `fu:${f.id}`, signature: st === "completed" ? f.completedAt! : f.dueAt, reason, dueAt: nowIso, resolveWhen: st === "overdue" ? "followup_done" : "never", escalate: st === "overdue" && esc(late) });
    }
    return out;
  }
  if (rule.templateId === "tpl_assigned") {
    // One summary per employee for leads assigned in the window.
    const win = (rule.settings.windowHours ?? 24) * HOUR; const per = new Map<string, Lead[]>();
    for (const l of x.leads) { const a = x.assignments[l.id]; if (!a?.employeeId || !open(l) || ago(a.assignedAt, x.now) > win) continue; if (!leadPasses(l, rule.conditions, x, contactState(l.id, x.activities))) continue; per.set(a.employeeId, [...(per.get(a.employeeId) ?? []), l]); }
    const day = nowIso.slice(0, 10);
    for (const [emp, ls] of per) out.push({ leadId: ls[0]!.id, employeeId: emp, target: `emp:${emp}:${day}`, signature: day, reason: `${ls.length} newly assigned lead${ls.length > 1 ? "s" : ""} to review${ls.length <= 3 ? `: ${ls.map((l) => l.name).join(", ")}` : ""}.`, dueAt: nowIso, resolveWhen: "never", escalate: false });
    return out;
  }
  for (const l of x.leads) {
    if (rule.trigger !== "deal_won" && !open(l)) continue;
    if (rule.trigger === "deal_won" && l.status !== "won") continue;
    const contact = contactState(l.id, x.activities);
    if (!leadPasses(l, rule.conditions, x, contact)) continue;
    const a = x.assignments[l.id];
    let reason = "", signature = "", resolveWhen: Reminder["resolveWhen"] = "never", since = 0;
    switch (rule.trigger) {
      case "lead_created": case "lead_assigned":
        if (rule.trigger === "lead_assigned" && !a?.employeeId && rule.conditions.assigned !== "unassigned") continue;
        since = ago(a?.assignedAt ?? l.createdAt, x.now);
        reason = rule.conditions.firstContactPending ? `${l.name} has no recorded contact attempt ${fmt(ago(l.createdAt, x.now))} after creation.` : `${l.name} matches "${rule.name}".`;
        signature = a?.employeeId ? `${a.employeeId}@${a.assignedAt}` : l.createdAt; resolveWhen = rule.conditions.firstContactPending ? "contact" : "never"; break;
      case "inactivity": {
        const last = lastActivityAt(l, x.activities); since = ago(last, x.now);
        reason = `${l.priority === "hot" ? "Hot lead " : ""}${l.name} has had no recorded activity for ${fmt(since)}.`; signature = last; resolveWhen = "activity"; break;
      }
      case "stage_changed": case "lead_updated": {
        const s = stageSince(l, x.activities); since = ago(s ?? l.createdAt, x.now);
        reason = `${l.name} has been in this stage for ${fmt(since)}.`; signature = `${l.status}@${s ?? l.createdAt}`; resolveWhen = "activity"; break;
      }
      case "call_logged": {
        const last = lastAttemptAt(l.id, x.activities); if (!last) continue;
        reason = `Call logged for ${l.name} — review next step.`; signature = last; break;
      }
      case "deal_won": reason = `${l.name} is Won — prepare the project handoff checklist.`; signature = "won"; break;
    }
    out.push({ leadId: l.id, employeeId: a?.employeeId ?? null, target: `lead:${l.id}`, signature, reason, dueAt: nowIso, resolveWhen, escalate: esc(since) });
  }
  return out;
}

export const reminderKey = (ruleId: string, m: Pick<Match, "target" | "signature">) => `${ruleId}|${m.target}|${m.signature}`;

export interface PlannedReminder extends Omit<Reminder, "id"> { followUpDueAt?: string }
export interface RulePlan { ruleId: string; ruleName: string; matched: number; create: PlannedReminder[]; skippedDuplicates: number; cooldown: number; escalations: string[]; affectedEmployees: string[] }

/** Pure dry run / plan: never mutates. Existing reminder keys (any status) and per-target cooldowns block repeats. */
export function planRule(rule: AutomationRule, x: EvalCtx, existing: Reminder[]): RulePlan {
  const matches = evaluateRule(rule, x);
  const keys = new Set(existing.map((r) => r.key));
  const lastByTarget = new Map<string, string>();
  for (const r of existing) if (r.ruleId === rule.id) { const t = r.key.split("|")[1]!; if (!lastByTarget.has(t) || r.createdAt > lastByTarget.get(t)!) lastByTarget.set(t, r.createdAt); }
  const plan: RulePlan = { ruleId: rule.id, ruleName: rule.name, matched: matches.length, create: [], skippedDuplicates: 0, cooldown: 0, escalations: [], affectedEmployees: [] };
  const at = x.now.toISOString();
  for (const m of matches) {
    const key = reminderKey(rule.id, m);
    if (keys.has(key)) { plan.skippedDuplicates++; continue; }
    const last = lastByTarget.get(m.target);
    if (last && ago(last, x.now) < rule.settings.cooldownHours * HOUR) { plan.cooldown++; continue; }
    keys.add(key);
    const wantsFu = rule.actions.includes("followup") && rule.settings.followupInHours;
    plan.create.push({ key, ruleId: rule.id, ruleName: rule.name, leadId: m.leadId, employeeId: m.employeeId, reason: m.reason, dueAt: m.dueAt, importance: m.escalate ? "high" : "normal", status: "open", createdAt: at, flag: rule.actions.includes("flag"), ownerReview: rule.actions.includes("owner_review") || m.escalate, escalated: m.escalate, resolveWhen: m.resolveWhen ?? "never", origin: "automation", ...(wantsFu ? { followUpDueAt: new Date(x.now.getTime() + rule.settings.followupInHours! * HOUR).toISOString() } : {}) });
    if (m.escalate) plan.escalations.push(m.leadId);
    if (m.employeeId && !plan.affectedEmployees.includes(m.employeeId)) plan.affectedEmployees.push(m.employeeId);
  }
  return plan;
}

/** Re-evaluate open reminders against changed records: resolve when the condition is gone, move responsibility on reassignment (history kept). */
export function reconcileReminders(reminders: Reminder[], x: EvalCtx): { next: Reminder[]; changed: number } {
  const leads = new Map(x.leads.map((l) => [l.id, l])); const fus = new Map(x.followUps.map((f) => [f.id, f]));
  const at = x.now.toISOString(); let changed = 0;
  const next = reminders.map((r) => {
    if (r.status !== "open") return r;
    const l = leads.get(r.leadId);
    const close = (text: string): Reminder => { changed++; return { ...r, status: "resolved", closedAt: at, history: [...(r.history ?? []), { at, text }] }; };
    if (!l) return close("Lead no longer active");
    if (r.resolveWhen === "contact" && contactState(l.id, x.activities) !== "none") return close("Contact attempt recorded");
    if (r.resolveWhen === "activity" && lastActivityAt(l, x.activities) > r.createdAt) return close("New activity recorded");
    if (r.resolveWhen === "followup_done") { const f = fus.get(r.key.split("|")[1]!.slice(3)); if (!f || f.completedAt || f.cancelledAt) return close("Follow-up completed or replaced"); }
    const emp = x.assignments[l.id]?.employeeId ?? null;
    if (!r.key.split("|")[1]!.startsWith("emp:") && emp !== r.employeeId) { changed++; return { ...r, employeeId: emp, history: [...(r.history ?? []), { at, text: emp ? "Responsibility moved after reassignment" : "Lead unassigned" }] }; }
    return r;
  });
  return { next, changed };
}

/** Rules that should run: enabled only. Paused, draft and archived rules never execute. */
export const runnable = (rules: AutomationRule[]) => rules.filter((r) => r.status === "enabled");

/* ---------- future backend contract ---------- */
/** Shape a server scheduler will POST back. Reminder keys are the idempotency keys. */
export interface AutomationJobResult { ruleId: string; evaluatedAt: string; created: string[]; skipped: string[]; failed: { key: string; error: string }[] }
