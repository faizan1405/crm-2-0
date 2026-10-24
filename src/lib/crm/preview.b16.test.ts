import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { startPreview, exitPreview } from "./preview";
import { useSession, routeAllowed, activePreview } from "./session";
import { buildBackup, ALL_CATEGORY_IDS } from "./vault";
import { businessDateTime } from "./dates";

const s = () => useCRM.getState();
const ids: Record<string, string> = {};
const leadsOf: Record<string, string[]> = {};
const data = () => JSON.stringify(Object.fromEntries(Object.entries(s()).filter(([, v]) => typeof v !== "function")));
const emp = (k: string) => s().employees.find((e) => e.id === ids[k])!;

beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ employees: [], employeeAccess: {}, assignments: {}, notes: [{ id: "owner-note", title: "Owner secret", body: "private", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }] });
  for (const [k, role] of [["A", "salesperson"], ["B", "custom"], ["C", "salesperson"]] as const) {
    const r = s().addEmployee({ name: `B16 Emp ${k}`, email: `b16${k.toLowerCase()}@example.com`, roleId: role, accountStatus: "active" });
    if (!r.ok) throw new Error(r.error); ids[k] = r.id;
  }
  const at = "2026-10-24T00:00:00Z";
  useCRM.setState({ employeeAccess: {
    [ids["B"]!]: { overrides: { "leads.view": true, "pipeline.view": true, "followups.view": true, "clients.view": true }, updatedAt: at },
    [ids["C"]!]: { overrides: { "projects.view": true, "projects.notes": true, "projects.tasks_edit": true }, updatedAt: at },
  } });
  const all = s().leads.map((l) => l.id);
  leadsOf["A"] = all.slice(0, 3); leadsOf["B"] = all.slice(3, 5); leadsOf["C"] = all.slice(5, 7);
  for (const k of ["A", "B", "C"]) s().assignLeads(leadsOf[k]!, ids[k]!, "b16");
});
afterEach(() => exitPreview());

describe("B1.6 Employee B view-only", () => {
  it("sees exactly its assigned leads and every write is refused without changing data or emitting events", () => {
    startPreview(emp("B"));
    expect(s().leads.map((l) => l.id).sort()).toEqual([...leadsOf["B"]!].sort());
    const before = data(); const id = leadsOf["B"]![0]!;
    expect(s().updateLead(id, { priority: "cold" })).toBe(false);
    expect(s().updateLead(id, { status: "won" })).toBe(false);
    expect(s().logCall({ opId: "x", leadId: id, outcome: "Connected", stage: "contacted", source: "t" })).toMatchObject({ ok: false });
    expect(s().addFollowUp({ leadId: id, type: "call", dueAt: businessDateTime("2026-12-01T10:00") })).toMatchObject({ ok: false });
    const fu = s().followUps.find((f) => f.leadId === id);
    if (fu) s().completeFollowUp(fu.id);
    expect(s().addActivity(id, "sneaky note")).toBe(false);
    expect(s().addActivity(id, "sneaky note", "note")).toBe(false);
    expect(s().assignLeads([id], ids["A"]!, "t")).toMatchObject({ ok: false });
    expect(s().setLeadTags(id, ["x"])).toBe(false);
    expect(data()).toBe(before);
    expect(useSession.getState().events).toEqual([]);
    expect(routeAllowed(activePreview(), "/deals")).toBe(false);
    expect(routeAllowed(activePreview(), "/settings")).toBe(false);
    expect(routeAllowed(activePreview(), "/data-vault")).toBe(false);
  });
});

describe("B1.6 Employee A salesperson", () => {
  it("can edit, note, call and follow up assigned leads; no finance or owner notes; owner data restored on exit", () => {
    const owner = data();
    startPreview(emp("A"));
    const id = leadsOf["A"]![0]!;
    expect(s().leads.map((l) => l.id).sort()).toEqual([...leadsOf["A"]!].sort());
    expect(s().deals).toEqual([]); expect(s().payments).toEqual([]); expect(s().notes).toEqual([]);
    expect(s().updateLead(id, { priority: "cold" })).toBe(true);
    expect(s().addActivity(id, "Client note")).toBeUndefined();
    expect(s().logCall({ opId: "a1", leadId: id, outcome: "Not picked", stage: "contacted", source: "t" })).toMatchObject({ ok: true });
    expect(s().activities.filter((a) => a.leadId === id && a.type === "call")).toHaveLength(1);
    s().saveNote({ id: "a-note", title: "A private", body: "x", pinned: false, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" });
    expect(useSession.getState().events.every((e) => e.actorId === ids["A"])).toBe(true);
    expect(s().teamEvents.some((e) => (e as { actor?: { id: string } }).actor?.id === ids["A"])).toBe(false);
    exitPreview();
    expect(data()).toBe(owner);
    startPreview(emp("B"));
    expect(s().notes).toEqual([]);
  });
});

describe("B1.6 Employee C projects", () => {
  it("project task permission follows the latest Owner settings", () => {
    startPreview(emp("C"));
    const can = routeAllowed(activePreview(), "/projects");
    expect(can).toBe(true);
    exitPreview();
    useCRM.setState({ employeeAccess: { ...s().employeeAccess, [ids["C"]!]: { overrides: {}, updatedAt: "2026-10-24T01:00:00Z" } } });
    startPreview(emp("C"));
    expect(routeAllowed(activePreview(), "/projects")).toBe(false);
  });
  it("employees cannot build backups and automation is off in preview", async () => {
    startPreview(emp("C"));
    expect(s().ruleSettings.autoEnabled).toBe(false);
    expect(s().automationRules).toEqual([]);
    expect(s().runAutomations()).toEqual({ created: 0, resolved: 0 });
    await expect(buildBackup({ type: "full", categories: ALL_CATEGORY_IDS, actor: { roleId: "salesperson" } }, {}, [])).rejects.toThrow();
  });
});
