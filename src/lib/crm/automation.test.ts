import { describe, it, expect, beforeEach } from "vitest";
import { contactState, evaluateRule, planRule, reconcileReminders, ruleError, ruleConflicts, ruleFromTemplate, runnable, RULE_TEMPLATES, type AutomationRule, type EvalCtx, type Reminder } from "./automation";
import { findDuplicates, pairKey, pairSignature } from "./inbox";
import { CATEGORIES } from "./vault";
import { ROUTE_PERM, allows } from "./session";
import { deriveEvents, type EventSnap } from "./activity";
import { useCRM } from "./store";
import type { Lead, LeadActivity } from "./types";

const now = new Date("2026-10-20T10:00:00Z");
const L = (id: string, p: Partial<Lead> = {}): Lead => ({ id, name: `Lead ${id}`, phone: `98765000${id.padStart(2, "0")}`, source: "Website", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z", ...p });
const asg = (emp: string, at = "2026-10-20T08:00:00Z") => ({ employeeId: emp, assignedAt: at, source: "x", manual: true });
const rule = (tpl: string, status: AutomationRule["status"] = "enabled") => ({ ...ruleFromTemplate(tpl, `r_${tpl}`, "2026-10-01T00:00:00Z")!, status });
const ctx = (p: Partial<EvalCtx> = {}): EvalCtx => ({ leads: [L("1"), L("2")], activities: [], followUps: [], assignments: { "1": asg("e1") }, inboxMeta: {}, now, ...p });
const call = (leadId: string, outcome: string, at = "2026-10-20T09:00:00Z"): LeadActivity => ({ id: `c${leadId}${outcome}`, leadId, type: "call", outcome, text: "", at });

describe("first-contact distinctions", () => {
  it("separates attempt, established, outbound and nothing", () => {
    expect(contactState("1", [])).toBe("none");
    expect(contactState("1", [call("1", "Not picked")])).toBe("attempted");
    expect(contactState("1", [call("1", "Connected")])).toBe("established");
    expect(contactState("1", [{ id: "w", leadId: "1", type: "whatsapp", text: "", at: "" }])).toBe("outbound");
    expect(contactState("1", [{ id: "f", leadId: "1", type: "followup", text: "", at: "" }])).toBe("none");
  });
});

describe("templates, triggers & conditions", () => {
  it("all six templates start disabled", () => {
    expect(RULE_TEMPLATES).toHaveLength(6);
    expect(RULE_TEMPLATES.every((t) => ruleFromTemplate(t.templateId, "x", "")!.status === "draft")).toBe(true);
  });
  it("response reminder matches assigned leads with no attempt after 30 min", () => {
    const m = evaluateRule(rule("tpl_response"), ctx());
    expect(m.map((x) => x.leadId)).toEqual(["1"]);
    expect(evaluateRule(rule("tpl_response"), ctx({ activities: [call("1", "Not picked")] }))).toHaveLength(0);
    expect(evaluateRule(rule("tpl_response"), ctx({ now: new Date("2026-10-20T08:10:00Z") }))).toHaveLength(0);
  });
  it("overdue follow-up waits the configured minutes and ignores automation-created follow-ups", () => {
    const fu = { id: "f1", leadId: "1", type: "call" as const, dueAt: "2026-10-20T09:50:00Z" };
    expect(evaluateRule(rule("tpl_overdue"), ctx({ followUps: [fu] }))).toHaveLength(0); // 10 min < 15
    expect(evaluateRule(rule("tpl_overdue"), ctx({ followUps: [{ ...fu, dueAt: "2026-10-20T09:00:00Z" }] }))).toHaveLength(1);
    expect(evaluateRule(rule("tpl_overdue"), ctx({ followUps: [{ ...fu, dueAt: "2026-10-20T09:00:00Z", opId: "auto:x" }] }))).toHaveLength(0);
  });
  it("hot lead protection uses real activity times and never changes priority", () => {
    const hot = L("3", { priority: "hot", createdAt: "2026-10-10T00:00:00Z" });
    const m = evaluateRule(rule("tpl_hot"), ctx({ leads: [hot] }));
    expect(m).toHaveLength(1); expect(hot.priority).toBe("hot");
    expect(evaluateRule(rule("tpl_hot"), ctx({ leads: [hot], activities: [{ id: "n", leadId: "3", type: "note", text: "", at: "2026-10-20T09:00:00Z" }] }))).toHaveLength(0);
  });
  it("newly assigned creates one summary per employee", () => {
    const m = evaluateRule(rule("tpl_assigned"), ctx({ leads: [L("1"), L("2"), L("3")], assignments: { "1": asg("e1"), "2": asg("e1"), "3": asg("e2") } }));
    expect(m).toHaveLength(2);
  });
});

describe("safety: dedupe, cooldown, disable, conflicts, validation", () => {
  it("re-evaluation never duplicates reminders", () => {
    const r = rule("tpl_response"); const p1 = planRule(r, ctx(), []);
    expect(p1.create).toHaveLength(1);
    const existing = p1.create.map((x, i) => ({ ...x, id: `rem${i}` })) as Reminder[];
    const p2 = planRule(r, ctx(), existing);
    expect(p2.create).toHaveLength(0); expect(p2.skippedDuplicates).toBe(1);
  });
  it("cooldown blocks a new signature for the same target", () => {
    const r = rule("tpl_stale"); r.conditions.minStageDays = 0;
    const e: Reminder[] = [{ id: "x", key: `${r.id}|lead:1|old`, ruleId: r.id, ruleName: "", leadId: "1", employeeId: null, reason: "", dueAt: "", importance: "normal", status: "resolved", createdAt: "2026-10-19T10:00:00Z", flag: true, ownerReview: false, origin: "automation" }];
    const p = planRule({ ...r, conditions: { minStageDays: 0 } }, ctx({ leads: [L("1", { status: "contacted" })] }), e);
    expect(p.create).toHaveLength(0); expect(p.cooldown).toBe(1);
  });
  it("only enabled rules run", () => {
    expect(runnable([rule("tpl_hot", "paused"), rule("tpl_hot", "draft"), rule("tpl_won", "enabled")]).map((r) => r.templateId)).toEqual(["tpl_won"]);
  });
  it("validation and conflict detection", () => {
    expect(ruleError({ ...rule("tpl_hot"), actions: [] })).toMatch(/action/);
    expect(ruleError({ ...rule("tpl_hot"), settings: { cooldownHours: 0 } })).toMatch(/Cooldown/);
    expect(ruleError({ ...rule("tpl_hot"), actions: ["followup"] })).toMatch(/follow-up/);
    const a = rule("tpl_hot"); expect(ruleConflicts({ ...a, id: "other" }, [a])).toHaveLength(1);
  });
  it("contact resolves reminders; reassignment moves responsibility with history", () => {
    const r: Reminder = { id: "x", key: "r|lead:1|s", ruleId: "r", ruleName: "", leadId: "1", employeeId: "e1", reason: "", dueAt: "", importance: "normal", status: "open", createdAt: "2026-10-20T09:00:00Z", flag: false, ownerReview: false, origin: "automation", resolveWhen: "contact" };
    expect(reconcileReminders([r], ctx({ activities: [call("1", "Busy")] })).next[0]!.status).toBe("resolved");
    const moved = reconcileReminders([r], ctx({ assignments: { "1": asg("e2") } })).next[0]!;
    expect(moved.employeeId).toBe("e2"); expect(moved.history?.length).toBe(1);
    expect(reconcileReminders([r], ctx({ leads: [] })).next[0]!.status).toBe("resolved");
  });
});

describe("store integration", () => {
  beforeEach(() => { useCRM.getState().reset(); useCRM.setState({ automationRules: [], reminders: [], automationRuns: [], leads: [L("1", { createdAt: "2026-10-20T08:00:00Z" })], activities: [], followUps: [], assignments: { "1": asg("e1") } }); });
  it("dry run (planRule) does not modify state; run creates exactly one reminder, then none", () => {
    const id = useCRM.getState().addRuleFromTemplate("tpl_response")!;
    const r = useCRM.getState().automationRules.find((x) => x.id === id)!;
    planRule({ ...r, status: "enabled" }, { ...useCRM.getState(), now }, []);
    expect(useCRM.getState().reminders).toHaveLength(0);
    expect(useCRM.getState().runAutomations({ now: now.toISOString() }).created).toBe(0); // still draft
    expect(useCRM.getState().setAutomationStatus(id, "enabled")).toBeNull();
    expect(useCRM.getState().runAutomations({ now: now.toISOString() }).created).toBe(1);
    expect(useCRM.getState().runAutomations({ now: now.toISOString() }).created).toBe(0);
    expect(useCRM.getState().reminders).toHaveLength(1);
    const ev = useCRM.getState().teamEvents.filter((e) => e.eventType === "automation.reminder");
    expect(ev).toHaveLength(1); expect(ev[0]!.actorName).toBe("Automation");
    useCRM.getState().setAutomationStatus(id, "paused");
    useCRM.setState({ reminders: [] });
    expect(useCRM.getState().runAutomations({ now: now.toISOString() }).created).toBe(0);
  });
  it("configured follow-ups are created once with an automation-origin reference", () => {
    const id = useCRM.getState().addRuleFromTemplate("tpl_response")!;
    const r = useCRM.getState().automationRules.find((x) => x.id === id)!;
    useCRM.getState().saveAutomationRule({ ...r, actions: [...r.actions, "followup"], settings: { ...r.settings, followupInHours: 2 } });
    useCRM.getState().setAutomationStatus(id, "enabled");
    useCRM.getState().runAutomations({ now: now.toISOString() }); useCRM.getState().runAutomations({ now: now.toISOString() });
    const fus = useCRM.getState().followUps;
    expect(fus).toHaveLength(1); expect(fus[0]!.opId?.startsWith("auto:")).toBe(true);
  });
});

describe("duplicate decisions, permissions & vault", () => {
  it("a decision is kept until phone/email change, then the pair re-opens", () => {
    const a = L("1", { phone: "9876543210" }), b = L("2", { phone: "+91 98765 43210" });
    const rel = { [pairKey("1", "2")]: { key: pairKey("1", "2"), a: "1", b: "2", kind: "separate" as const, at: "", sig: pairSignature(a, b) } };
    expect(findDuplicates([a, b], rel)).toHaveLength(0);
    const p = findDuplicates([a, { ...b, email: "new@x.com" }], rel);
    expect(p).toHaveLength(1); expect(p[0]!.reopened).toBe(true);
  });
  it("Automation Studio is Owner-only even with a grant", () => {
    expect(ROUTE_PERM["/automation"]).toBe("__owner");
    expect(allows({ employeeId: "e", name: "E", role: "salesperson", grants: ["__owner"] } as never, "__owner")).toBe(false);
  });
  it("Full backup covers automation data", () => {
    const keys = CATEGORIES.flatMap((c) => c.keys);
    for (const k of ["automationRules", "automationSettings", "reminders", "automationRuns"]) expect(keys).toContain(k);
  });
  it("five or more reminders produce one grouped event", () => {
    const base: EventSnap = { leads: [], followUps: [], deals: [], payments: [], activities: [], assignments: {}, employees: [], employeeAccess: {}, reminders: [] };
    const next = { ...base, reminders: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, leadId: `l${i}`, ruleName: "R", reason: "x", employeeId: null })) };
    expect(deriveEvents(base, next, { action: "runAutomations", operationId: "o", at: "", actor: { id: "automation", role: "automation", name: "Automation" } })).toHaveLength(1);
  });
});
