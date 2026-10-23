import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { demoAuth, employeeError, filterEmployees, teamSummary, type EmployeeInput } from "./team";

const s = () => useCRM.getState();
const rahul: EmployeeInput = { name: "Rahul Sharma", email: "Rahul@Example.com", roleId: "salesperson", accountStatus: "pending" };
beforeEach(() => { localStorage.clear(); s().reset(); useCRM.setState({ employees: [], email: "owner@scaleflow.in" }); });

describe("Team Management", () => {
  it("creates an employee with normalized email and pending status", () => {
    const r = s().addEmployee(rahul);
    expect(r.ok).toBe(true);
    expect(s().employees[0]).toMatchObject({ name: "Rahul Sharma", email: "rahul@example.com", accountStatus: "pending", lastLoginAt: null });
  });
  it("rejects invalid emails and duplicate emails (case-insensitive)", () => {
    expect(employeeError({ ...rahul, email: "rahul@" }, [], "")).toBe("Enter a valid email address.");
    s().addEmployee(rahul);
    expect(s().addEmployee({ ...rahul, email: " rahul@example.COM " })).toEqual({ ok: false, error: "An employee with this email already exists." });
    expect(s().employees).toHaveLength(1);
  });
  it("never lets an employee reuse the Owner email", () => {
    expect(s().addEmployee({ ...rahul, email: "OWNER@scaleflow.in" })).toEqual({ ok: false, error: "That email belongs to the Owner." });
  });
  it("edits an employee and keeps creation date", () => {
    const r = s().addEmployee(rahul); if (!r.ok) throw 0;
    const created = s().employees[0]!.createdAt;
    expect(s().updateEmployee(r.id, { ...rahul, name: "Rahul S.", roleId: "sales_manager" })).toBeNull();
    expect(s().employees[0]).toMatchObject({ name: "Rahul S.", roleId: "sales_manager", createdAt: created });
  });
  it("deactivates, reactivates and archives instead of deleting", () => {
    const r = s().addEmployee(rahul); if (!r.ok) throw 0;
    s().setEmployeeStatus(r.id, "inactive");
    expect(s().employees[0]!.accountStatus).toBe("inactive");
    expect(s().employees[0]!.deactivatedAt).not.toBeNull();
    s().setEmployeeStatus(r.id, "active");
    expect(s().employees[0]).toMatchObject({ accountStatus: "active", deactivatedAt: null });
    s().setEmployeeStatus(r.id, "archived");
    expect(s().employees).toHaveLength(1);
    expect(teamSummary(s().employees).total).toBe(0);
  });
  it("searches and filters by status", () => {
    s().addEmployee(rahul); s().addEmployee({ name: "Priya Nair", email: "priya@x.in", roleId: "sales_manager", accountStatus: "inactive" });
    expect(filterEmployees(s().employees, "priya", "all", "name").map((e) => e.name)).toEqual(["Priya Nair"]);
    expect(filterEmployees(s().employees, "", "inactive", "name").map((e) => e.name)).toEqual(["Priya Nair"]);
    expect(filterEmployees(s().employees, "manager", "all", "name")).toHaveLength(1);
  });
  it("persists profiles with no password, hash, token or session fields", () => {
    s().addEmployee(rahul);
    const raw = localStorage.getItem("scale-flow-crm-2-demo") ?? "";
    expect(raw).toContain("rahul@example.com");
    expect(raw).not.toMatch(/password|hash|token|session/i);
  });
  it("does not change leads, deals, payments or notes", () => {
    const before = JSON.stringify([s().leads, s().deals, s().payments, s().notes]);
    const r = s().addEmployee(rahul); if (r.ok) s().setEmployeeStatus(r.id, "inactive");
    expect(JSON.stringify([s().leads, s().deals, s().payments, s().notes])).toBe(before);
  });
  it("demo login never authenticates", async () => {
    expect((await demoAuth.signIn("owner@scaleflow.in", "anything")).ok).toBe(false);
    expect((await demoAuth.requestPasswordReset("a@b.co")).ok).toBe(false);
  });
});
