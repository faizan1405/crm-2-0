import { describe, expect, it } from "vitest";
import { assigneeChoices, canChangeStage, STAGE_DENIED, type PreviewSession } from "./session";

const pv = (allowed: string[], leadScope: "assigned" | "all" = "assigned"): PreviewSession => ({ employeeId: "e1", name: "Test Emp A", roleLabel: "Sales", allowed, leadScope, finance: "none", startedAt: "" });
const emps = [{ id: "e1", name: "Test Emp A" }, { id: "e2", name: "Test Emp B" }, { id: "e3", name: "Old", accountStatus: "archived" }];

describe("B1.4 permission feedback and assignee scoping", () => {
  it("stage change refused without pipeline.edit and leads.edit", () => {
    expect(canChangeStage(pv(["leads.view"]))).toBe(false);
    expect(canChangeStage(pv(["pipeline.edit"]))).toBe(true);
    expect(canChangeStage(null)).toBe(true);
    expect(STAGE_DENIED).toBe("You don't have permission to change this lead's stage.");
  });
  it("assigned-only employee sees only My leads", () => {
    expect(assigneeChoices(pv([]), emps)).toEqual([{ id: "e1", name: "My leads" }]);
  });
  it("all-scope employee and Owner see active employees only", () => {
    expect(assigneeChoices(pv([], "all"), emps).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(assigneeChoices(null, emps).map((e) => e.name)).toEqual(["Test Emp A", "Test Emp B"]);
  });
});
