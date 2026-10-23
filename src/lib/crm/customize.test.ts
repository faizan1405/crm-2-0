import { describe, expect, it } from "vitest";
import {
  bulkTag, convertValue, emptyField, fieldDefError, fieldIdFor, filterFields, matchCondition, parseValue, parseView, removedUsedOptions, runView, scopeCustomization,
  serializeView, typeChangeImpact, undoTags, validateLeadValues, viewAllowed, viewError, viewIssues, OWNER_VIEWER,
  type CustomFieldDef, type SavedView, type ViewCtx, type Viewer,
} from "./customize";
import type { Lead } from "./types";

const field = (p: Partial<CustomFieldDef>): CustomFieldDef => ({ ...emptyField(0), id: "cf_x", label: "X", ...p });
const service = field({ id: "cf_service", label: "Service Interested In", type: "select", options: [{ id: "opt_web", label: "Business Website" }, { id: "opt_3d", label: "3D Website" }, { id: "opt_crm", label: "CRM" }] });
const budget = field({ id: "cf_budget", label: "Client Budget", type: "currency" });
const margin = field({ id: "cf_margin", label: "Internal Margin", type: "number", visibility: "owner", editable: "owner" });
const lead = (id: string, p: Partial<Lead> = {}): Lead => ({ id, name: `Lead ${id}`, phone: "9876543210", source: "Website", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-01T05:00:00.000Z", updatedAt: "2026-10-01T05:00:00.000Z", ...p });
const ctx = (p: Partial<ViewCtx> = {}): ViewCtx => ({ assignments: {}, followUps: [], activities: [], inboxMeta: {}, fieldValues: {}, leadTags: {}, customFields: [service, budget, margin], tags: [{ id: "tag_hot", name: "Hot Lead", color: "rose", status: "active", createdAt: "", updatedAt: "" }, { id: "tag_demo", name: "Needs Demo", color: "sky", status: "active", createdAt: "", updatedAt: "" }], employees: [], now: new Date("2026-10-23T10:00:00Z"), viewer: OWNER_VIEWER, ...p });
const view = (conditions: SavedView["filter"]["conditions"], mode: "and" | "or" = "and"): SavedView => ({ id: "v1", name: "V", visibility: "personal", ownerId: "owner", filter: { mode, conditions }, sort: "name", archived: false, schema: 1, createdAt: "", updatedAt: "", version: 1 });
const emp: Viewer = { owner: false, employeeId: "e1", canEdit: true };

describe("custom field definitions", () => {
  it("creates stable ids from labels and never reuses one", () => {
    expect(fieldIdFor("Service Interested In", [])).toBe("cf_service_interested_in");
    expect(fieldIdFor("Service Interested In", ["cf_service_interested_in"])).toBe("cf_service_interested_in_2");
  });
  it("rejects blank names, reserved ids, duplicate active labels and empty choice lists", () => {
    expect(fieldDefError(field({ label: " " }), [])).toMatch(/name/);
    expect(fieldDefError(field({ id: "cf_x", label: "Source" }), [])).toMatch(/built-in/);
    expect(fieldDefError(field({ id: "cf_b", label: "client budget" }), [budget])).toMatch(/already/);
    expect(fieldDefError(field({ type: "select", options: [] }), [])).toMatch(/option/);
    expect(fieldDefError(service, [service])).toBeNull();
  });
  it("blocks removing an option that leads still use, but allows archiving it", () => {
    const values = { l1: { cf_service: "opt_3d" } };
    expect(removedUsedOptions(service, { ...service, options: service.options.filter((o) => o.id !== "opt_3d") }, values)).toHaveLength(1);
    expect(removedUsedOptions(service, { ...service, options: service.options.map((o) => (o.id === "opt_3d" ? { ...o, archived: true } : o)) }, values)).toHaveLength(1);
    expect(removedUsedOptions(service, { ...service, options: service.options.map((o) => (o.id === "opt_3d" ? { ...o, label: "3D site" } : o)) }, values)).toHaveLength(0);
  });
});

describe("field values", () => {
  it("validates each type instead of storing raw strings", () => {
    expect(parseValue(field({ type: "number" }), "12,500")).toEqual({ ok: true, value: 12500 });
    expect(parseValue(field({ type: "number" }), "abc").ok).toBe(false);
    expect(parseValue(budget, "₹45,000")).toEqual({ ok: true, value: { amount: 45000, currency: "INR" } });
    expect(parseValue(field({ type: "date" }), "2026-02-30").ok).toBe(false);
    expect(parseValue(field({ type: "date" }), "2026-11-05")).toEqual({ ok: true, value: "2026-11-05" });
    expect(parseValue(field({ type: "email" }), "a@b").ok).toBe(false);
    expect(parseValue(field({ type: "url" }), "example.com")).toEqual({ ok: true, value: "https://example.com/" });
    expect(parseValue(field({ type: "phone" }), "+91 98765 43210")).toEqual({ ok: true, value: "+919876543210" });
    expect(parseValue(service, "opt_missing").ok).toBe(false);
    expect(parseValue(field({ type: "multiselect", options: service.options }), ["opt_web", "opt_web", "opt_crm"])).toEqual({ ok: true, value: ["opt_web", "opt_crm"] });
    expect(parseValue(field({ type: "checkbox" }), false)).toEqual({ ok: true, value: false });
  });
  it("requires values on new leads but only flags missing values on existing leads", () => {
    const req = { ...service, required: true };
    expect(validateLeadValues([req], {}, { isNew: true }).errors["cf_service"]).toBe("Required.");
    const edit = validateLeadValues([req], {}, { isNew: false, previous: {} });
    expect(edit.errors).toEqual({});
    expect(edit.needs).toEqual(["cf_service"]);
    expect(validateLeadValues([req], { cf_service: "" }, { isNew: false, previous: { cf_service: "opt_web" } }).errors["cf_service"]).toBe("Required.");
  });
  it("previews type changes and never converts incompatible values silently", () => {
    const text = field({ id: "cf_t", type: "text" });
    const values = { a: { cf_t: "1200" }, b: { cf_t: "soon" } };
    expect(typeChangeImpact(text, { ...text, type: "number" }, values)).toEqual({ convertible: 1, incompatible: ["b"] });
    expect(convertValue("1200", text, { ...text, type: "currency" })).toEqual({ amount: 1200, currency: "INR" });
    expect(convertValue("soon", text, { ...text, type: "number" })).toBeUndefined();
  });
});

describe("tags", () => {
  it("bulk add keeps other tags and undo respects newer changes", () => {
    const cur = { a: ["tag_demo"], b: [] as string[] };
    const r = bulkTag(cur, ["a", "b", "c"], "tag_hot", "add");
    expect(r.next).toEqual({ a: ["tag_demo", "tag_hot"], b: ["tag_hot"], c: ["tag_hot"] });
    const later = { ...r.next, b: ["tag_hot", "tag_demo"] }; // someone changed b afterwards
    const u = undoTags(later, r.before, r.applied);
    expect(u.restored).toBe(2);
    expect(u.kept).toBe(1);
    expect(u.next).toEqual({ a: ["tag_demo"], b: ["tag_hot", "tag_demo"] });
  });
  it("bulk remove only touches leads that have the tag", () => {
    expect(bulkTag({ a: ["tag_hot", "tag_demo"], b: ["tag_demo"] }, ["a", "b"], "tag_hot", "remove").changed).toBe(1);
  });
});

describe("saved views", () => {
  const leads = [lead("1"), lead("2", { source: "Meta Ads" }), lead("3", { source: "Meta Ads", priority: "hot" })];
  const values = { "1": { cf_service: "opt_3d", cf_budget: { amount: 150000, currency: "INR" } }, "2": { cf_service: "opt_3d", cf_budget: { amount: 30000, currency: "INR" } }, "3": { cf_service: "opt_web" } };
  const tags = { "1": ["tag_hot", "tag_demo"], "2": ["tag_hot"] };
  it("filters by custom select, currency and tags with AND", () => {
    const v = view([{ id: "a", field: "cf:cf_service", op: "is", value: ["opt_3d"] }, { id: "b", field: "cf:cf_budget", op: "gt", value: 100000 }, { id: "c", field: "tags", op: "contains_all", value: ["tag_hot", "tag_demo"] }]);
    expect(runView(v, leads, ctx({ fieldValues: values, leadTags: tags })).map((l) => l.id)).toEqual(["1"]);
  });
  it("supports OR logic", () => {
    const v = view([{ id: "a", field: "priority", op: "is", value: ["hot"] }, { id: "b", field: "tags", op: "contains_any", value: ["tag_demo"] }], "or");
    expect(runView(v, leads, ctx({ fieldValues: values, leadTags: tags })).map((l) => l.id)).toEqual(["1", "3"]);
  });
  it("a lead enters and leaves a view when its values change", () => {
    const v = view([{ id: "a", field: "cf:cf_service", op: "is", value: ["opt_web"] }]);
    expect(runView(v, leads, ctx({ fieldValues: values })).map((l) => l.id)).toEqual(["3"]);
    expect(runView(v, leads, ctx({ fieldValues: { ...values, "3": {}, "2": { cf_service: "opt_web" } } })).map((l) => l.id)).toEqual(["2"]);
  });
  it("serializes and parses views with a schema version", () => {
    const v = view([{ id: "a", field: "source", op: "is", value: ["Meta Ads"] }]);
    expect(parseView(serializeView(v))).toEqual({ ...v, schema: 1 });
    expect(parseView("{bad")).toBeNull();
    expect(parseView(JSON.stringify({ id: "x", name: "y", filter: { mode: "xor", conditions: [] } }))).toBeNull();
  });
  it("warns about archived fields instead of changing a view's meaning", () => {
    const v = view([{ id: "a", field: "cf:cf_service", op: "is", value: ["opt_3d"] }]);
    const archived = ctx({ customFields: [{ ...service, status: "archived" }] });
    expect(viewIssues(v, archived)[0]!.text).toMatch(/archived/);
    expect(viewIssues(v, ctx({ customFields: [] }))[0]!.text).toMatch(/matches no leads/);
    expect(runView(v, leads, { ...ctx({ customFields: [] }), fieldValues: values })).toEqual([]);
  });
  it("employees never filter on Owner-only fields and never see personal views of others", () => {
    expect(filterFields(ctx({ viewer: emp })).some((f) => f.key === "cf:cf_margin")).toBe(false);
    const v = view([{ id: "a", field: "cf:cf_margin", op: "gt", value: 0 }]);
    expect(runView(v, leads, ctx({ viewer: emp, fieldValues: { "1": { cf_margin: 30 } } }))).toEqual([]);
    expect(viewAllowed({ ...v, ownerId: "e2" }, emp)).toBe(false);
    expect(viewAllowed({ ...v, ownerId: "e2", visibility: "shared" }, emp)).toBe(true);
    expect(viewError({ ...v, visibility: "company", ownerId: "e1" }, emp, [])).toMatch(/Owner/);
  });
  it("matches follow-up and assignment conditions from real records", () => {
    const c = ctx({ assignments: { "2": { employeeId: "e1", assignedAt: "", source: "", manual: true } }, followUps: [{ id: "f", leadId: "3", type: "call", dueAt: "2026-10-23T12:00:00.000Z" }] });
    const fields = new Map(filterFields(c).map((f) => [f.key, f]));
    expect(leads.filter((l) => matchCondition(l, { id: "x", field: "assignee", op: "is", value: ["__none"] }, c, fields)).map((l) => l.id)).toEqual(["1", "3"]);
    expect(leads.filter((l) => matchCondition(l, { id: "x", field: "followupDue", op: "today" }, c, fields)).map((l) => l.id)).toEqual(["3"]);
  });
});

describe("sensitive field isolation", () => {
  it("removes Owner-only definitions and values from an employee copy", () => {
    const r = scopeCustomization([service, margin], { "1": { cf_service: "opt_3d", cf_margin: 40 }, "9": { cf_service: "opt_web" } }, new Set(["1"]), emp);
    expect(r.customFields.map((f) => f.id)).toEqual(["cf_service"]);
    expect(r.fieldValues).toEqual({ "1": { cf_service: "opt_3d" } });
  });
});
