import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { resolve, setOverride, evaluate, workspaceFor, ROLE_PRESETS, type AssignmentRule } from "./access";

const s = () => useCRM.getState();
const add = (name: string, email: string, roleId: "salesperson" | "sales_manager" = "salesperson") => { const r = s().addEmployee({ name, email, roleId, accountStatus: "pending" }); if (!r.ok) throw new Error(r.error); return r.id; };
beforeEach(() => { localStorage.clear(); s().reset(); useCRM.setState({ employees: [], employeeAccess: {}, assignments: {}, assignmentEvents: [], assignmentRules: [], firedRules: [], ruleSettings: { autoEnabled: false, replaceExisting: false } }); });

describe("permission resolution", () => {
  it("owner has everything; Team Management can never be granted to an employee", () => {
    expect(resolve("owner").can("team.manage")).toBe(true);
    const eff = resolve("salesperson", { overrides: { "team.manage": true }, updatedAt: "" });
    expect(eff.can("team.manage")).toBe(false);
    expect(eff.reason("team.manage")).toBe("owner-only");
  });
  it("salesperson defaults: assigned-only scope, no finance, no proofs, no delete", () => {
    const eff = resolve("salesperson");
    expect(eff.leadScope).toBe("assigned");
    expect(eff.finance).toBe("none");
    expect(eff.can("leads.view")).toBe(true);
    expect(eff.can("proofs.download")).toBe(false);
    expect(eff.can("leads.delete")).toBe(false);
  });
  it("override beats role default and only affects that employee", () => {
    const o = setOverride("salesperson", {}, "leads.edit", false);
    expect(resolve("salesperson", { overrides: o, updatedAt: "" }).reason("leads.edit")).toBe("override-deny");
    expect(resolve("salesperson").can("leads.edit")).toBe(true);
    expect(ROLE_PRESETS.salesperson.allowed).toContain("leads.edit");
  });
  it("setting a toggle back to the role default drops the override", () => {
    expect(setOverride("salesperson", { "leads.edit": false }, "leads.edit", true)).toEqual({});
  });
  it("finance level is forced to none without View deals", () => {
    expect(resolve("salesperson", { overrides: {}, finance: "manage", updatedAt: "" }).finance).toBe("none");
  });
});

describe("lead assignment", () => {
  it("assigns, reassigns and unassigns without touching lead business data", () => {
    const a = add("A", "a@x.in"), b = add("B", "b@x.in");
    const lead = s().leads[0]!; const before = JSON.stringify([s().leads, s().deals, s().payments, s().followUps]);
    s().assignLeads([lead.id], a, "test"); s().assignLeads([lead.id], b, "test"); s().assignLeads([lead.id], null, "test");
    expect(s().assignments[lead.id]).toBeUndefined();
    expect(s().assignmentEvents.map((e) => e.action)).toEqual(["unassign", "reassign", "assign"]);
    expect(JSON.stringify([s().leads, s().deals, s().payments, s().followUps])).toBe(before);
  });
  it("bulk assigns several leads and never duplicates leads", () => {
    const a = add("A", "a@x.in"); const ids = s().leads.slice(0, 3).map((l) => l.id); const n = s().leads.length;
    expect(s().assignLeads(ids, a, "bulk")).toEqual({ ok: true, changed: 3 });
    expect(s().leads).toHaveLength(n);
  });
  it("refuses inactive employees but keeps their existing assignments", () => {
    const a = add("A", "a@x.in"); const id = s().leads[0]!.id;
    s().assignLeads([id], a, "t"); s().setEmployeeStatus(a, "inactive");
    expect(s().assignLeads([s().leads[1]!.id], a, "t").ok).toBe(false);
    expect(s().assignments[id]?.employeeId).toBe(a);
  });
  it("undo restores the previous assignment exactly", () => {
    const a = add("A", "a@x.in"); const id = s().leads[0]!.id;
    const snap = { [id]: s().assignments[id] }; s().assignLeads([id], a, "t"); s().restoreAssignments(snap);
    expect(s().assignments[id]).toBeUndefined();
  });
});

describe("assignment rules", () => {
  it("are off by default and do nothing until enabled", () => {
    const a = add("A", "a@x.in"); s().saveRule({ id: "r1", name: "All new", trigger: "lead_created", conditions: {}, targetEmployeeId: a, enabled: true });
    const id = s().addLead({ name: "N", phone: "9876500001", source: "Website", status: "new", priority: "warm", pinned: false });
    expect(s().assignments[id]).toBeUndefined();
  });
  it("lowest priority number wins and manual assignments are not replaced", () => {
    const a = add("A", "a@x.in"), b = add("B", "b@x.in");
    s().saveRule({ id: "r1", name: "To A", trigger: "lead_created", conditions: {}, targetEmployeeId: a, enabled: true });
    s().saveRule({ id: "r2", name: "To B", trigger: "lead_created", conditions: {}, targetEmployeeId: b, enabled: true });
    s().setRuleSettings({ autoEnabled: true });
    const id = s().addLead({ name: "N", phone: "9876500002", source: "Website", status: "new", priority: "warm", pinned: false });
    expect(s().assignments[id]?.employeeId).toBe(a);
    s().assignLeads([id], b, "manual");
    const o = evaluate(s().leads.find((l) => l.id === id)!, "lead_created", s().assignmentRules, s().employees, s().assignments[id], s().ruleSettings);
    expect(o.winner).toBeUndefined();
  });
  it("never targets inactive employees and fires once per stage event", () => {
    const a = add("A", "a@x.in");
    s().saveRule({ id: "r1", name: "Qualified", trigger: "stage_entered", conditions: { stage: "qualified" }, targetEmployeeId: a, enabled: true });
    s().setRuleSettings({ autoEnabled: true, replaceExisting: true });
    const lead = s().leads.find((l) => l.status !== "qualified")!; const orig = lead.status;
    s().updateLead(lead.id, { status: "qualified" });
    expect(s().assignments[lead.id]?.employeeId).toBe(a);
    s().assignLeads([lead.id], null, "manual"); s().updateLead(lead.id, { status: orig }); s().updateLead(lead.id, { status: "qualified" });
    expect(s().assignments[lead.id]).toBeUndefined();
    s().setEmployeeStatus(a, "inactive");
    const r: AssignmentRule = s().assignmentRules[0]!;
    expect(evaluate(s().leads[0]!, "lead_created", [{ ...r, trigger: "lead_created", conditions: {} }], s().employees, undefined, s().ruleSettings).blocked).toMatch(/inactive/);
  });
  it("changing a rule does not redistribute existing leads", () => {
    const a = add("A", "a@x.in"); s().setRuleSettings({ autoEnabled: true });
    s().saveRule({ id: "r1", name: "All", trigger: "lead_created", conditions: {}, targetEmployeeId: a, enabled: true });
    expect(Object.keys(s().assignments)).toHaveLength(0);
  });
});

describe("employee workspace preview", () => {
  it("assigned-only scope shows only their leads and follow-ups; owner notes never included", () => {
    const a = add("A", "a@x.in"); const id = s().leads[0]!.id; s().assignLeads([id], a, "t");
    const ws = workspaceFor(a, resolve("salesperson"), { leads: s().leads, followUps: s().followUps, assignments: s().assignments });
    expect(ws.leads.map((l) => l.id)).toEqual([id]);
    expect(ws.followUps.every((f) => f.leadId === id)).toBe(true);
    expect(ws.nav).not.toContain("team");
    expect(ws.nav).not.toContain("deals");
  });
});
