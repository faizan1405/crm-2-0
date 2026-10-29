import { describe, it, expect } from "vitest";
import { supportChangeLog } from "./projectStore";

const emps = [{ id: "emp_1", name: "F2B Support" }];
const base = { title: "Form bug", status: "open" as const, assigneeId: null, priority: "normal" as const, coverage: "undecided" as const, dueDate: undefined };

describe("support request history (F2B)", () => {
  it("logs a start", () => expect(supportChangeLog(base, { status: "in_progress" }, emps)).toEqual(["Support “Form bug” started"]));
  it("logs a resolution", () => expect(supportChangeLog({ ...base, status: "in_progress" }, { status: "resolved", resolution: "fixed" }, emps)).toEqual(["Support “Form bug” resolved"]));
  it("logs a reopen", () => expect(supportChangeLog({ ...base, status: "resolved" }, { status: "open" }, emps)).toEqual(["Support “Form bug” reopened"]));
  it("names the new assignee, never a raw ID", () => {
    const [line] = supportChangeLog(base, { assigneeId: "emp_1" }, emps);
    expect(line).toBe("Support “Form bug” reassigned from nobody to F2B Support");
  });
  it("records nothing when nothing changed (no duplicate events)", () => expect(supportChangeLog(base, { status: "open", assigneeId: null, priority: "normal" }, emps)).toEqual([]));
});
