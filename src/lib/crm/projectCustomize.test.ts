import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { useCRM, automationCtxOf, projectCtxOf, viewCtxOf } from "./store";
import { startPreview, exitPreview } from "./preview";
import { migrateProjectCustom } from "./projectCustomStore";
import { emptyField, filterFields, type CustomFieldDef } from "./customize";
import { projectFilterFields, runProjectFilter } from "./projectCustomize";
import { draftFromDeal, projectFinance, starterTemplates } from "./projects";
import { planRule, type AutomationRule } from "./automation";
import { buildBackup, ALL_CATEGORY_IDS } from "./vault";
import type { Deal } from "./types";

const s = () => useCRM.getState();
const def = (p: Partial<CustomFieldDef>): CustomFieldDef => ({ ...emptyField(0, "project"), ...p } as CustomFieldDef);
const HOSTING = def({ id: "cf_hosting_provider", label: "Hosting Provider", type: "select", options: [{ id: "opt_hostinger", label: "Hostinger" }, { id: "opt_aws", label: "AWS" }] });
const LAUNCH = def({ id: "cf_expected_launch_date", label: "Expected Launch Date", type: "date" });
const COST = def({ id: "cf_internal_cost", label: "Internal Delivery Cost", type: "currency", visibility: "owner", editable: "owner" });
const DEAL = (id: string): Deal => ({ id, clientType: "crm", clientName: `Client ${id}`, name: `Website ${id}`, quotedAmount: 40000, finalAmount: 40000, status: "active", milestones: [], createdAt: "2026-10-01T00:00:00Z" });
const tpl = starterTemplates("2026-10-01T00:00:00Z")[0]!;
const mk = (dealId: string) => { const r = s().createProject(draftFromDeal({ deal: DEAL(dealId), template: tpl }), { milestones: tpl.milestones, tasks: tpl.tasks }); if (!r.ok) throw new Error(r.error); return r.id; };
const rule = (p: Partial<AutomationRule>): AutomationRule => ({ id: "pr1", name: "Hostinger reminder", description: "", status: "draft", subject: "project", trigger: "project_due_soon", conditions: { custom: [{ id: "c1", field: "cf:cf_hosting_provider", op: "is", value: ["opt_hostinger"] }] }, actions: ["reminder", "activity"], settings: { cooldownHours: 24, withinDays: 7 }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "", version: 1, ...p });

let A = "", B = "";
beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ deals: [DEAL("d1"), DEAL("d2")], payments: [], employees: [], employeeAccess: {}, assignments: {}, projects: [], projectTasks: [], projectMilestones: [], supportRequests: [], projectFields: [], projectFieldValues: {}, projectTags: {}, customFields: [], fieldValues: {}, tagDefs: [], leadTags: {}, automationRules: [], reminders: [], automationRuns: [], teamEvents: [] });
  A = mk("d1"); B = mk("d2");
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  s().updateProject(A, { targetDelivery: soon }); s().updateProject(B, { targetDelivery: soon });
});
afterEach(() => exitPreview());

describe("Lead / Project field scoping", () => {
  it("Project fields never appear among Lead fields, filters or values", () => {
    expect(s().saveProjectField(HOSTING)).toBeNull();
    expect(s().customFields).toHaveLength(0);
    expect(filterFields(viewCtxOf(s(), { owner: true })).some((f) => f.label === "Hosting Provider")).toBe(false);
    expect(projectFilterFields(projectCtxOf(s())).some((f) => f.key === "cf:cf_hosting_provider")).toBe(true);
    expect(s().setProjectFieldValues(A, { cf_hosting_provider: "opt_hostinger" }).ok).toBe(true);
    expect(s().fieldValues).toEqual({});
    expect(s().projectFieldValues[A]).toEqual({ cf_hosting_provider: "opt_hostinger" });
  });
  it("rejects credential-like field names", () => {
    expect(s().saveProjectField(def({ id: "cf_pw", label: "Hosting Password" }))).toMatch(/password/i);
  });
});

describe("Project custom values", () => {
  it("stores typed values and rejects invalid ones", () => {
    s().saveProjectField(HOSTING); s().saveProjectField(LAUNCH);
    expect(s().setProjectFieldValues(A, { cf_expected_launch_date: "2026-02-30" }).ok).toBe(false);
    expect(s().setProjectFieldValues(A, { cf_hosting_provider: "opt_missing" }).ok).toBe(false);
    expect(s().setProjectFieldValues(A, { cf_hosting_provider: "opt_aws", cf_expected_launch_date: "2026-12-01" }).ok).toBe(true);
    expect(s().projectFieldValues[A]).toEqual({ cf_hosting_provider: "opt_aws", cf_expected_launch_date: "2026-12-01" });
  });
  it("required fields block new projects but existing projects stay usable and are only flagged", () => {
    s().saveProjectField({ ...HOSTING, required: true });
    const r = s().setProjectFieldValues(A, { cf_expected_launch_date: undefined }, { isNew: true });
    expect(r.ok).toBe(false);
    const edit = s().setProjectFieldValues(B, {});
    expect(edit.ok && edit.needs).toEqual(["cf_hosting_provider"]);
    expect(s().projectFieldValues[B]).toEqual({}); // nothing fabricated
  });
  it("archiving keeps values and pauses enabled Project rules that use the field", () => {
    s().saveProjectField(HOSTING); s().setProjectFieldValues(A, { cf_hosting_provider: "opt_hostinger" });
    useCRM.setState({ automationRules: [rule({ status: "enabled" }), rule({ id: "lead_rule", subject: "lead", trigger: "inactivity", status: "enabled", conditions: { minInactiveHours: 24 }, settings: { cooldownHours: 24 } })] });
    const r = s().setProjectFieldStatus("cf_hosting_provider", "archived");
    expect(r.paused).toEqual(["Hostinger reminder"]);
    expect(s().projectFieldValues[A]).toEqual({ cf_hosting_provider: "opt_hostinger" });
    expect(s().automationRules.find((x) => x.id === "pr1")!.status).toBe("paused");
    expect(s().automationRules.find((x) => x.id === "lead_rule")!.status).toBe("enabled"); // unrelated rule untouched
  });
});

describe("Project tags", () => {
  beforeEach(() => {
    s().saveTag({ id: "tag_await", name: "Awaiting Client Content", color: "amber", status: "active", scope: "project" });
    s().saveTag({ id: "tag_hot", name: "Hot Lead", color: "rose", status: "active" });
    s().saveTag({ id: "tag_vip", name: "VIP Client", color: "violet", status: "active", scope: "both" });
  });
  it("project tags are separate relationships and respect tag scope", () => {
    expect(s().setProjectTags(A, ["tag_await", "tag_vip", "tag_hot"])).toBe(true);
    expect(s().projectTags[A]).toEqual(["tag_await", "tag_vip"]); // lead-only tag refused
    expect(s().leadTags).toEqual({});
    const lead = s().leads[0]!.id;
    s().setLeadTags(lead, ["tag_await", "tag_vip"]);
    expect(s().leadTags[lead]).toEqual(["tag_vip"]); // project-only tag refused on leads
    expect(s().projectTags[A]).toEqual(["tag_await", "tag_vip"]);
  });
  it("bulk tag + undo preserves newer edits", () => {
    const r = s().bulkTagProjects([A, B], "tag_await", "add");
    expect(r.changed).toBe(2);
    s().setProjectTags(B, ["tag_await", "tag_vip"]);
    const u = s().undoBulkProjectTags(r.before, r.applied);
    expect(u).toEqual({ restored: 1, kept: 1 });
    expect(s().projectTags[A]).toBeUndefined();
    expect(s().projectTags[B]).toEqual(["tag_await", "tag_vip"]);
  });
  it("filters Project Desk by tag and custom field with AND / OR", () => {
    s().saveProjectField(HOSTING);
    s().setProjectTags(A, ["tag_await"]); s().setProjectFieldValues(B, { cf_hosting_provider: "opt_hostinger" });
    const ctx = projectCtxOf(s());
    const tag = { id: "t", field: "tags", op: "contains_any" as const, value: ["tag_await"] };
    const host = { id: "h", field: "cf:cf_hosting_provider", op: "is" as const, value: ["opt_hostinger"] };
    expect(runProjectFilter({ mode: "and", conditions: [tag] }, s().projects, ctx).map((p) => p.id)).toEqual([A]);
    expect(runProjectFilter({ mode: "and", conditions: [tag, host] }, s().projects, ctx)).toEqual([]);
    expect(runProjectFilter({ mode: "or", conditions: [tag, host] }, s().projects, ctx).map((p) => p.id).sort()).toEqual([A, B].sort());
  });
});

describe("employee isolation", () => {
  const emp = () => { const r = s().addEmployee({ name: "Neha Dev", email: "neha@example.com", roleId: "salesperson", accountStatus: "active" }); if (!r.ok) throw new Error(r.error); return r.id; };
  it("Owner-only Project fields and values never reach the employee copy; edits need Project edit permission", () => {
    s().saveProjectField(HOSTING); s().saveProjectField(COST);
    s().setProjectFieldValues(A, { cf_hosting_provider: "opt_aws", cf_internal_cost: "9000" });
    const e = emp(); s().updateProject(A, { memberIds: [e] });
    useCRM.setState({ employeeAccess: { [e]: { overrides: { "projects.view": true }, updatedAt: "" } } });
    startPreview(s().employees.find((x) => x.id === e)!);
    expect(s().projectFields.map((f) => f.id)).toEqual(["cf_hosting_provider"]);
    expect(s().projectFieldValues[A]).toEqual({ cf_hosting_provider: "opt_aws" });
    expect(s().projectFieldValues[B]).toBeUndefined();
    expect(projectFilterFields(projectCtxOf(s(), { owner: false, employeeId: e, canEdit: false })).some((f) => f.key === "cf:cf_internal_cost")).toBe(false);
    expect(s().setProjectFieldValues(A, { cf_hosting_provider: "opt_hostinger" }).ok).toBe(false);
    expect(s().setProjectTags(A, [])).toBe(false);
    exitPreview();
    expect(s().projectFieldValues[A]).toEqual({ cf_hosting_provider: "opt_aws", cf_internal_cost: { amount: 9000, currency: "INR" } });
  });
});

describe("Project automation", () => {
  beforeEach(() => { s().saveProjectField(HOSTING); s().setProjectFieldValues(A, { cf_hosting_provider: "opt_hostinger" }); s().setProjectFieldValues(B, { cf_hosting_provider: "opt_aws" }); });
  it("dry run matches only the matching project and changes nothing", () => {
    const snap = JSON.stringify({ p: s().projects, r: s().reminders, t: s().projectTasks });
    const plan = planRule(rule({}), automationCtxOf(s()), s().reminders);
    expect(plan.create.map((x) => x.projectId)).toEqual([A]);
    expect(JSON.stringify({ p: s().projects, r: s().reminders, t: s().projectTasks })).toBe(snap);
  });
  it("enabled rule creates one reminder + activity, never duplicates, and stops when disabled", () => {
    useCRM.setState({ automationRules: [rule({ status: "enabled" })] });
    expect(s().runAutomations({ manual: true }).created).toBe(1);
    const rem = s().reminders[0]!;
    expect(rem.projectId).toBe(A);
    expect(s().projects.find((p) => p.id === A)!.history.at(-1)!).toMatchObject({ by: "automation" });
    expect(s().teamEvents.some((e) => e.eventType === "automation.reminder" && e.actorUserId === "automation" && e.entityId === A)).toBe(true);
    expect(s().runAutomations({ manual: true }).created).toBe(0);
    expect(s().reminders).toHaveLength(1);
    s().setAutomationStatus("pr1", "paused");
    s().setProjectFieldValues(B, { cf_hosting_provider: "opt_hostinger" });
    expect(s().runAutomations({ manual: true }).created).toBe(0);
  });
  it("overdue-task reminders resolve when the task is done; created tasks come from Automation; money never changes", () => {
    const t = s().projectTasks.find((x) => x.projectId === A)!;
    s().updateTask(t.id, { dueDate: "2026-01-01" });
    useCRM.setState({ automationRules: [rule({ status: "enabled", trigger: "task_overdue", actions: ["reminder", "task", "flag"], settings: { cooldownHours: 24, taskTitle: "Chase overdue work" } })] });
    s().runAutomations({ manual: true });
    expect(s().reminders.filter((r) => r.taskId === t.id)).toHaveLength(1);
    expect(s().projectTasks.some((x) => x.projectId === A && x.title === "Chase overdue work")).toBe(true);
    expect(s().projects.find((p) => p.id === A)!.attention?.ruleId).toBe("pr1");
    s().setTaskDone(t.id, true);
    s().runAutomations({ manual: true });
    expect(s().reminders.find((r) => r.taskId === t.id)!.status).toBe("resolved");
    expect(s().teamEvents.some((e) => e.eventType === "automation.reminder_resolved")).toBe(true);
    expect(s().payments).toHaveLength(0);
    expect(projectFinance(s().projects.find((p) => p.id === A)!, s().deals, s().payments).remaining).toBe(40000);
    expect(s().projects.find((p) => p.id === A)!.delivery).toBeUndefined();
  });
  it("Lead rules ignore projects and Project rules ignore leads", () => {
    const leadRule = rule({ subject: "lead", trigger: "inactivity", conditions: { minInactiveHours: 0 }, settings: { cooldownHours: 24 } });
    expect(planRule(leadRule, automationCtxOf(s()), []).create.every((x) => !x.projectId)).toBe(true);
    expect(planRule(rule({ subject: "project", trigger: "project_due_soon", conditions: {} }), automationCtxOf(s()), []).create.every((x) => !!x.projectId)).toBe(true);
  });
});

describe("Data Vault and migration", () => {
  it("full backup contains Project fields, values, tag links and Project rules", async () => {
    s().saveProjectField(HOSTING); s().setProjectFieldStatus("cf_hosting_provider", "archived"); s().saveProjectField(LAUNCH);
    s().setProjectFieldValues(A, { cf_expected_launch_date: "2026-12-01" });
    s().saveTag({ id: "tag_await", name: "Awaiting Client Content", color: "amber", status: "active", scope: "project" });
    s().setProjectTags(A, ["tag_await"]);
    useCRM.setState({ automationRules: [rule({})] });
    const st = Object.fromEntries(Object.entries(s()).filter(([, v]) => typeof v !== "function"));
    const files = unzipSync((await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, st, [])).bytes);
    const pj = JSON.parse(strFromU8(files["data/projects.json"]!));
    expect(pj.projectFields.map((f: CustomFieldDef) => [f.id, f.status])).toEqual([["cf_hosting_provider", "archived"], ["cf_expected_launch_date", "active"]]);
    expect(pj.projectFieldValues[A]).toEqual({ cf_expected_launch_date: "2026-12-01" });
    expect(pj.projectTags[A]).toEqual(["tag_await"]);
    const all = Object.entries(files).filter(([k]) => k.startsWith("data/")).map(([, v]) => strFromU8(v)).join("");
    expect(all).toContain('"subject": "project"');
    expect(all).toContain('"scope": "project"');
  });
  it("v9 migration adds empty Project customization and leaves everything else alone", () => {
    const m = migrateProjectCustom({ leads: [{ id: "l" }], projects: [{ id: "p" }] }, 8);
    expect(m).toMatchObject({ projectFields: [], projectFieldValues: {}, projectTags: {}, leads: [{ id: "l" }], projects: [{ id: "p" }] });
    const kept = { projectFields: [HOSTING] };
    expect(migrateProjectCustom(kept, 9)).toBe(kept);
  });
});
