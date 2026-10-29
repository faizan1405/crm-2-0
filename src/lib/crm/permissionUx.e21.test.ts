import { describe, expect, it } from "vitest";
import { allows, followUpPermission, type PreviewSession } from "./session";

const viewOnly = { employeeId: "emp_b", name: "B", roleLabel: "View-only", allowed: ["leads.view", "clients.view"], leadScope: "assigned", finance: "none", startedAt: "2026-10-29T00:00:00.000Z" } as unknown as PreviewSession;

describe("E2.1 Employee B Log call / Follow-up permission UX", () => {
  it("view-only employee may not open Log call or schedule/reschedule follow-ups", () => {
    expect(allows(viewOnly, "clients.calls")).toBe(false);
    expect(allows(viewOnly, followUpPermission(false))).toBe(false);
    expect(allows(viewOnly, followUpPermission(true))).toBe(false);
  });
  it("new follow-ups need create, rescheduling needs edit", () => {
    expect(followUpPermission(false)).toBe("followups.create");
    expect(followUpPermission(true)).toBe("followups.edit");
  });
  it("the Owner (no preview) keeps every action", () => {
    expect(allows(null, "clients.calls")).toBe(true);
    expect(allows(null, "followups.create")).toBe(true);
  });
});
