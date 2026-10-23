import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { startPreview, exitPreview } from "./preview";
import { useSession, routeAllowed } from "./session";
import { businessDateTime } from "./dates";

const s = () => useCRM.getState();
const KEY = "scale-flow-crm-2-demo";
let empId = "";
let mine: string[] = [];

beforeEach(() => {
  exitPreview();
  localStorage.clear();
  s().reset();
  useCRM.setState({ employees: [], employeeAccess: {}, assignments: {}, notes: [{ id: "owner-note", title: "Owner secret", body: "private", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }] });
  const r = s().addEmployee({ name: "Rahul Sales", email: "rahul@example.com", roleId: "salesperson", accountStatus: "active" });
  if (!r.ok) throw new Error(r.error);
  empId = r.id;
  mine = s().leads.slice(0, 2).map((l) => l.id);
  s().assignLeads(mine, empId, "test");
});
afterEach(() => exitPreview());
const emp = () => s().employees.find((e) => e.id === empId)!;

describe("Employee Workspace Preview", () => {
  it("shows only assigned leads and never the Owner's notes", () => {
    startPreview(emp());
    expect(s().leads.map((l) => l.id).sort()).toEqual([...mine].sort());
    expect(s().notes).toEqual([]);
    expect(s().deals).toEqual([]); // salesperson preset: no finance access
  });

  it("performs real authorised actions on the working copy", () => {
    startPreview(emp());
    const id = mine[0]!;
    expect(s().updateLead(id, { status: "qualified" })).toBe(true);
    expect(s().leads.find((l) => l.id === id)?.status).toBe("qualified");
    const fu = s().addFollowUp({ leadId: mine[1]!, type: "call", dueAt: businessDateTime("2026-12-01T10:00"), note: "Preview" }, { replaceId: s().followUps.find((f) => f.leadId === mine[1] && !f.completedAt)?.id ?? "" });
    expect(fu.ok).toBe(true);
    s().addActivity(id, "Client asked for samples");
    expect(s().activities.some((a) => a.text === "Client asked for samples")).toBe(true);
    s().saveNote({ id: "emp-note", title: "My list", body: "call back", pinned: true, createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z" });
    expect(s().notes.map((n) => n.id)).toEqual(["emp-note"]);
    expect(useSession.getState().events.map((e) => e.type)).toContain("pipeline.stage_changed");
    expect(useSession.getState().events.every((e) => e.actorId === empId)).toBe(true);
  });

  it("assigns a lead the employee creates to them only when creation is allowed", () => {
    startPreview(emp());
    expect(s().addLead({ name: "Blocked", phone: "9000000001", source: "Other", status: "new", priority: "warm", pinned: false })).toBe("");
    exitPreview();
    s().saveEmployeeAccess(empId, { overrides: { "leads.create": true } });
    startPreview(emp());
    const id = s().addLead({ name: "Employee lead", phone: "9000000002", source: "Other", status: "new", priority: "warm", pinned: false });
    expect(s().assignments[id]?.employeeId).toBe(empId);
    expect(s().leads.some((l) => l.id === id)).toBe(true);
  });

  it("blocks restricted actions and owner-only pages", () => {
    startPreview(emp());
    const before = s().leads.length;
    s().deleteLead(mine[0]!);
    expect(s().leads.length).toBe(before);
    expect(s().assignLeads([mine[0]!], null, "x").ok).toBe(false);
    const p = useSession.getState().preview;
    expect(routeAllowed(p, "/team")).toBe(false);
    expect(routeAllowed(p, "/data-vault")).toBe(false);
    expect(routeAllowed(p, "/deals")).toBe(false);
    expect(routeAllowed(p, "/leads")).toBe(true);
  });

  it("reflects permission changes when the preview restarts", () => {
    s().saveEmployeeAccess(empId, { overrides: { "pipeline.edit": false, "leads.edit": false } });
    startPreview(emp());
    expect(s().updateLead(mine[0]!, { status: "proposal" })).toBe(false);
  });

  it("never writes to saved data and restores the Owner's records exactly on exit", () => {
    const saved = localStorage.getItem(KEY);
    const ownerLeads = structuredClone(s().leads);
    startPreview(emp());
    s().updateLead(mine[0]!, { status: "proposal" });
    s().saveNote({ id: "emp-note", title: "x", body: "", pinned: false, createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z" });
    expect(localStorage.getItem(KEY)).toBe(saved);
    exitPreview();
    expect(s().leads).toEqual(ownerLeads);
    expect(s().notes.map((n) => n.id)).toEqual(["owner-note"]);
    expect(useSession.getState().preview).toBeNull();
  });
});

describe("permission matrix in preview", () => {
  const withAccess = (overrides: Record<string, boolean>) => { s().saveEmployeeAccess(empId, { overrides }); startPreview(emp()); };
  it("view-only employee cannot edit, move stage, log calls or create follow-ups", () => {
    withAccess({ "leads.edit": false, "pipeline.edit": false, "clients.calls": false, "followups.create": false });
    const id = mine[0]!;
    expect(s().updateLead(id, { priority: "cold" })).toBe(false);
    expect(s().updateLead(id, { status: "qualified" })).toBe(false);
    expect(s().addFollowUp({ leadId: id, type: "call", dueAt: businessDateTime("2026-12-01T10:00"), note: "" }).ok).toBe(false);
    expect(s().leads.find((l) => l.id === id)?.status).not.toBe("qualified");
  });
  it("create permission lets the employee add a lead, which is assigned to them", () => {
    withAccess({ "leads.create": true });
    const newId = s().addLead({ name: "Preview New", phone: "9876501234", source: "Website", status: "new", priority: "warm", pinned: false });
    expect(newId).toBeTruthy();
    expect(s().assignments[newId]?.employeeId).toBe(empId);
  });
  it("owner-only pages stay closed even if granted", () => {
    withAccess({ "team.manage": true, "vault.backup": true });
    const pv = useSession.getState().preview;
    expect(routeAllowed(pv, "/team")).toBe(false);
    expect(routeAllowed(pv, "/data-vault")).toBe(false);
  });
});
