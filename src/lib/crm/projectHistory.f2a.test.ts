import { describe, it, expect } from "vitest";
import { assigneeLabel } from "./projectStore";

const emps = [{ id: "emp_1", name: "F2A Builder" }];
describe("task reassignment history uses names, not IDs", () => {
  it("names an employee", () => expect(assigneeLabel("emp_1", emps)).toBe("F2A Builder"));
  it("names the Owner", () => expect(assigneeLabel("owner", emps)).toBe("Owner"));
  it("says nobody when unassigned", () => expect(assigneeLabel(null, emps)).toBe("nobody"));
  it("never shows an unknown raw ID", () => expect(assigneeLabel("emp_gone", emps)).not.toContain("emp_"));
});
