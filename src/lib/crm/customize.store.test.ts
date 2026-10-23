import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { migrateCustomization, useCRM } from "./store";
import { startPreview, exitPreview } from "./preview";
import { emptyField, runView, type CustomFieldDef } from "./customize";
import { selectMatching, selectedIds } from "./bulk";
import { deriveNotifications, DEFAULT_NOTIFY_PREFS } from "./activity";
import { buildBackup, ALL_CATEGORY_IDS } from "./vault";
import { planRule, ruleFromTemplate, RULE_TEMPLATES } from "./automation";
import { automationCtxOf, viewCtxOf } from "./store";

const s = () => useCRM.getState();
const def = (p: Partial<CustomFieldDef>): CustomFieldDef => ({ ...emptyField(0), ...p } as CustomFieldDef);
const SERVICE = def({ id: "cf_service", label: "Service Interested In", type: "select", options: [{ id: "opt_web", label: "Business Website" }, { id: "opt_3d", label: "3D Website" }, { id: "opt_crm", label: "CRM" }] });
const SECRET = def({ id: "cf_margin", label: "Internal Margin", type: "number", visibility: "owner", editable: "owner" });

beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ employees: [], employeeAccess: {}, assignments: {}, customFields: [], fieldValues: {}, tagDefs: [], leadTags: {}, savedViews: [], viewPrefs: {}, teamEvents: [], automationRules: [], reminders: [], automationRuns: [] });
});
afterEach(() => exitPreview());

describe("custom fields in the store", () => {
  it("creates a field, stores validated values and keeps them through rename and archive", () => {
    expect(s().saveCustomField(SERVICE)).toBeNull();
    const id = s().leads[0]!.id;
    expect(s().setLeadFieldValues(id, { cf_service: "opt_bad" }).ok).toBe(false);
    expect(s().setLeadFieldValues(id, { cf_service: "opt_3d" }).ok).toBe(true);
    s().saveCustomField({ ...s().customFields[0]!, label: "Service" });
    expect(s().customFields[0]!.id).toBe("cf_service");
    expect(s().fieldValues[id]!["cf_service"]).toBe("opt_3d");
    s().setCustomFieldStatus("cf_service", "archived");
    expect(s().fieldValues[id]!["cf_service"]).toBe("opt_3d");
    expect(s().customFields[0]!.history.map((h) => h.change).join(" | ")).toMatch(/Renamed.*Archived/);
  });
  it("refuses to delete an option in use and blocks incompatible type changes", () => {
    s().saveCustomField(SERVICE); const id = s().leads[0]!.id;
    s().setLeadFieldValues(id, { cf_service: "opt_3d" });
    expect(s().saveCustomField({ ...s().customFields[0]!, options: SERVICE.options.filter((o) => o.id !== "opt_3d") })).toMatch(/in use/);
    expect(s().saveCustomField({ ...s().customFields[0]!, type: "number" })).toMatch(/can't become/);
    expect(s().fieldValues[id]!["cf_service"]).toBe("opt_3d");
  });
  it("migrates older saved data without touching leads", () => {
    const old = { leads: [{ id: "x" }], customFields: undefined };
    const m = migrateCustomization(old, 6);
    expect(m["leads"]).toEqual([{ id: "x" }]);
    expect(m["fieldValues"]).toEqual({});
    expect(Array.isArray(m["savedViews"])).toBe(true);
  });
});

describe("tags and bulk tag undo", () => {
  it("adds a tag to many leads, keeps other tags, and undo keeps newer changes", () => {
    s().saveTag({ id: "tag_hot", name: "Hot Lead", color: "rose", status: "active" });
    s().saveTag({ id: "tag_demo", name: "Needs Demo", color: "sky", status: "active" });
    const ids = s().leads.slice(0, 3).map((l) => l.id);
    s().setLeadTags(ids[0]!, ["tag_demo"]);
    const r = s().bulkTagLeads(ids, "tag_hot", "add");
    expect(r.changed).toBe(3);
    expect(s().leadTags[ids[0]!]).toEqual(["tag_demo", "tag_hot"]);
    s().setLeadTags(ids[1]!, []); // newer change
    const u = s().undoBulkTags(r.before, r.applied);
    expect(u).toEqual({ restored: 2, kept: 1 });
    expect(s().leadTags[ids[0]!]).toEqual(["tag_demo"]);
  });
  it("records tag events without notifying the bell", () => {
    s().saveTag({ id: "tag_hot", name: "Hot Lead", color: "rose", status: "active" });
    s().setLeadTags(s().leads[0]!.id, ["tag_hot"]);
    expect(s().teamEvents.some((e) => e.eventType === "lead.tag_added")).toBe(true);
    expect(deriveNotifications(s().teamEvents, [], s().leads, DEFAULT_NOTIFY_PREFS, new Date()).length).toBe(0);
  });
  it("never puts confidential values into activity summaries", () => {
    s().saveCustomField(SECRET);
    s().setLeadFieldValues(s().leads[0]!.id, { cf_margin: 98765 });
    const ev = s().teamEvents.find((e) => e.eventType === "lead.fields_changed")!;
    expect(ev.summary).toMatch(/Internal Margin/);
    expect(JSON.stringify(ev)).not.toContain("98765");
  });
});

describe("saved views with bulk assignment", () => {
  it("selects every matching lead across pages and distributes through the existing engine", () => {
    s().saveCustomField(SERVICE);
    const ids = s().leads.map((l) => l.id);
    ids.forEach((id, i) => s().setLeadFieldValues(id, { cf_service: i % 2 ? "opt_3d" : "opt_web" }));
    const r = s().saveView({ id: "", name: "3D prospects", visibility: "company", filter: { mode: "and", conditions: [{ id: "c", field: "cf:cf_service", op: "is", value: ["opt_3d"] }] }, sort: "recent", archived: false });
    if (!r.ok) throw new Error(r.error);
    const v = s().savedViews.find((x) => x.id === r.id)!;
    const match = runView(v, s().leads, viewCtxOf(s(), { owner: true })).map((l) => l.id);
    expect(match.length).toBe(ids.filter((_, i) => i % 2).length);
    const e = s().addEmployee({ name: "Asha", email: "asha@example.com", roleId: "salesperson", accountStatus: "active" }); if (!e.ok) throw new Error(e.error);
    const sel = selectedIds(selectMatching(match, "view"));
    const a = s().assignLeads(sel, e.id, "test");
    expect(a.ok && a.changed).toBe(match.length);
    expect(Object.keys(s().assignments).sort()).toEqual([...match].sort());
  });
});

describe("employee preview isolation", () => {
  it("hides sensitive fields, blocks editing them and leaves Owner data untouched", () => {
    s().saveCustomField(SERVICE); s().saveCustomField(SECRET);
    const e = s().addEmployee({ name: "Rahul", email: "rahul@example.com", roleId: "salesperson", accountStatus: "active" }); if (!e.ok) throw new Error(e.error);
    const mine = s().leads[0]!.id, other = s().leads[1]!.id;
    s().assignLeads([mine], e.id, "test");
    s().setLeadFieldValues(mine, { cf_margin: 40 }); s().setLeadFieldValues(other, { cf_service: "opt_web" });
    s().saveView({ id: "", name: "Owner private", visibility: "personal", filter: { mode: "and", conditions: [] }, sort: "recent", archived: false });
    startPreview(s().employees[0]!);
    expect(s().customFields.map((f) => f.id)).toEqual(["cf_service"]);
    expect(s().fieldValues).toEqual({ [mine]: {} });
    expect(s().savedViews.some((v) => v.name === "Owner private")).toBe(false);
    expect(s().setLeadFieldValues(mine, { cf_margin: 1 }).ok).toBe(false);
    expect(s().setLeadFieldValues(mine, { cf_service: "opt_crm" }).ok).toBe(true);
    expect(s().saveCustomField({ ...SERVICE, label: "Hacked" })).not.toBeNull();
    exitPreview();
    expect(s().fieldValues[mine]).toEqual({ cf_margin: 40 });
    expect(s().customFields.find((f) => f.id === "cf_service")!.label).toBe("Service Interested In");
  });
});

describe("automation with custom fields", () => {
  it("matches custom field conditions and stops when the field is archived", () => {
    s().saveCustomField(SERVICE);
    const id = s().leads[0]!.id;
    s().setLeadFieldValues(id, { cf_service: "opt_3d" });
    const base = ruleFromTemplate(RULE_TEMPLATES[0]!.id, "r1", new Date().toISOString())!;
    const rule = { ...base, trigger: "lead_created" as const, status: "enabled" as const, conditions: { custom: [{ id: "c", field: "cf:cf_service", op: "is", value: ["opt_3d"] }] } };
    // Dry run: only the lead with 3D Website matches, and nothing is written.
    const before = s().reminders.length;
    expect(planRule(rule, automationCtxOf(s()), s().reminders).matched).toBe(1);
    expect(s().reminders.length).toBe(before);
    useCRM.setState({ automationRules: [rule] });
    s().setCustomFieldStatus("cf_service", "archived");
    const r = s().runAutomations({ manual: true });
    expect(r.created).toBe(0);
    expect(s().automationRuns[0]!.outcome).toBe("failed");
    expect(s().automationRuns[0]!.error).toMatch(/Not run/);
  });
});

describe("data vault", () => {
  it("full backup includes field definitions, values, tags, relations and views", async () => {
    s().saveCustomField({ ...SERVICE, id: "cf_session_date", label: "Session Date", type: "date", options: [] });
    s().saveTag({ id: "tag_hot", name: "Hot Lead", color: "rose", status: "active" });
    const id = s().leads[0]!.id;
    s().setLeadFieldValues(id, { cf_session_date: "2026-11-05" }); s().setLeadTags(id, ["tag_hot"]);
    const st = Object.fromEntries(Object.entries(s()).filter(([, v]) => typeof v !== "function"));
    const res = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, st, []);
    const files = unzipSync(res.bytes);
    const data = JSON.parse(strFromU8(files["data/crm-customization.json"]!));
    expect(data.customFields[0].id).toBe("cf_session_date");
    expect(data.fieldValues[id]).toEqual({ cf_session_date: "2026-11-05" });
    expect(data.leadTags[id]).toEqual(["tag_hot"]);
    expect(data.tagDefs).toHaveLength(1);
    expect(Array.isArray(data.savedViews)).toBe(true);
  });
});
