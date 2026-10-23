import { beforeEach, describe, expect, it } from "vitest";
import { addPage, allocationError, balancedSplit, buildPlan, equalSplit, isSelected, planImpact, selectedIds, selectionCount, selectMatching, singlePlan, toggle, EMPTY_SELECTION } from "./bulk";
import { useCRM } from "./store";
import { scopeWorkspace } from "./preview";
import { resolve } from "./access";

const s = () => useCRM.getState();
const ids = (n: number) => Array.from({ length: n }, (_, i) => `L${i}`);

describe("selection model", () => {
  it("page selection differs from all-matching selection", () => {
    const page = addPage(EMPTY_SELECTION, ids(50));
    expect(selectionCount(page)).toBe(50);
    const all = selectMatching(ids(350), "Meta Ads");
    expect(selectionCount(all)).toBe(350);
  });
  it("excludes individual records from a broad selection", () => {
    let sel = selectMatching(ids(10), "x");
    sel = toggle(sel, "L3", false);
    expect(selectionCount(sel)).toBe(9);
    expect(isSelected(sel, "L3")).toBe(false);
    expect(selectedIds(sel)).not.toContain("L3");
    sel = toggle(sel, "L3", true);
    expect(selectionCount(sel)).toBe(10);
  });
});

describe("distribution", () => {
  it("90 leads split equally across three is 30 each", () => {
    expect(equalSplit(90, ["a", "b", "c"]).map((x) => x.count)).toEqual([30, 30, 30]);
  });
  it("uneven totals give the remainder to the first employees deterministically", () => {
    expect(equalSplit(10, ["a", "b", "c"]).map((x) => x.count)).toEqual([4, 3, 3]);
  });
  it("custom counts must add up to the selection", () => {
    expect(allocationError(10, [{ employeeId: "a", count: 6 }, { employeeId: "b", count: 3 }])).toMatch(/add up to 9/);
    expect(allocationError(10, [{ employeeId: "a", count: 6 }, { employeeId: "b", count: 4 }])).toBeNull();
  });
  it("balanced split fills the least loaded first", () => {
    expect(balancedSplit(6, ["a", "b"], { a: 4, b: 0 }).map((x) => x.count)).toEqual([1, 5]);
  });
  it("plan maps every lead exactly once", () => {
    const plan = buildPlan(ids(10), equalSplit(10, ["a", "b", "c"]), {});
    expect(new Set(plan.map((p) => p.leadId)).size).toBe(10);
    expect(planImpact(plan).perTarget).toEqual({ a: 4, b: 3, c: 3 });
  });
});

describe("applyAssignmentPlan", () => {
  beforeEach(() => {
    localStorage.clear(); s().reset();
    useCRM.setState({ assignments: {}, assignmentEvents: [], employees: [], employeeAccess: {} });
    for (const n of ["Rahul", "Aman", "Neha", "Gone"]) s().addEmployee({ name: n, email: `${n.toLowerCase()}@x.in`, phone: "", roleId: "sales", department: "", notes: "" } as never);
  });
  const emp = (n: string) => s().employees.find((e) => e.name === n)!.id;

  it("distributes 30 each across three without duplicating or touching unrelated leads", () => {
    const before = structuredClone(s().leads);
    const sel = before.slice(0, Math.min(9, before.length)).map((l) => l.id);
    const k = sel.length;
    const r = s().applyAssignmentPlan(buildPlan(sel, equalSplit(k, [emp("Rahul"), emp("Aman"), emp("Neha")]), s().assignments), "test");
    expect(r.ok).toBe(true);
    expect(s().leads).toEqual(before);
    const counts = Object.values(s().assignments).reduce<Record<string, number>>((m, a) => ((m[a.employeeId] = (m[a.employeeId] ?? 0) + 1), m), {});
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(k);
    expect(Object.keys(s().assignments).every((id) => sel.includes(id))).toBe(true);
  });

  it("assigned leads appear in that employee's preview scope", () => {
    const sel = s().leads.slice(0, 3).map((l) => l.id);
    s().applyAssignmentPlan(singlePlan(sel, emp("Rahul"), s().assignments), "test");
    const w = scopeWorkspace(s(), emp("Rahul"), resolve("sales"));
    expect(w.leads.map((l) => l.id).sort()).toEqual([...sel].sort());
  });

  it("skips inactive targets and stale items, and Undo restores exactly", () => {
    const [a, b, c] = s().leads.map((l) => l.id);
    s().setEmployeeStatus(emp("Gone"), "inactive");
    const planStale = singlePlan([a!, b!], emp("Rahul"), s().assignments);
    s().assignLeads([b!], emp("Aman"), "elsewhere"); // changed after preview
    const r = s().applyAssignmentPlan([...planStale, ...singlePlan([c!], emp("Gone"), s().assignments)], "test");
    if (!r.ok) throw new Error();
    expect(r.changed).toBe(1);
    expect(r.skipped.map((x) => x.reason).sort()).toEqual(["changed", "inactive"]);
    expect(s().assignments[b!]?.employeeId).toBe(emp("Aman"));
    s().restoreAssignments(r.snapshot);
    expect(s().assignments[a!]).toBeUndefined();
    expect(s().assignments[b!]?.employeeId).toBe(emp("Aman"));
  });
});

describe("rule editor", () => {
  it("editing a rule keeps saved conditions", () => {
    localStorage.clear(); s().reset();
    useCRM.setState({ employees: [], assignmentRules: [] });
    s().addEmployee({ name: "Rahul", email: "r@x.in", phone: "", roleId: "sales", department: "", notes: "" } as never);
    const t = s().employees[0]!.id;
    s().saveRule({ id: "r1", name: "Meta", trigger: "lead_created", conditions: { source: "Meta Ads" as never, priority: "hot" }, targetEmployeeId: t, enabled: true });
    s().saveRule({ ...s().assignmentRules[0]!, name: "Meta renamed" });
    expect(s().assignmentRules[0]!.conditions).toEqual({ source: "Meta Ads", priority: "hot" });
  });
});
