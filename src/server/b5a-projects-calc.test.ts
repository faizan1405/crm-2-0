import { describe, expect, it } from "vitest";
import {
  addMonths,
  applyStatusSideEffects,
  deliveryError,
  deliveryGaps,
  isProjectOverdue,
  looksLikeSecret,
  milestoneProgress,
  projectAttention,
  projectMetrics,
  projectProgress,
  SECRET_ERROR,
  supportError,
  supportStatus,
  taskOverdue,
  validateProjectFields,
} from "./crm/projectsCalc.server";

describe("b5a projects calculation and pure rules", () => {
  it("blocks secret credentials from notes, scope and description", () => {
    expect(looksLikeSecret("Regular notes without any credentials")).toBe(false);
    expect(looksLikeSecret("password: secret12345")).toBe(true);
    expect(looksLikeSecret("api_key: sk_live_99999999abcd1234")).toBe(true);
    expect(looksLikeSecret("token = abcdef123456")).toBe(true);
    expect(validateProjectFields({ name: "Proj", clientName: "Client", notes: "password: 123" })).toBe(SECRET_ERROR);
  });

  it("validates project dates correctly", () => {
    expect(validateProjectFields({ name: "Proj", clientName: "Client", plannedStart: "2026-11-20", targetDelivery: "2026-11-10" })).toBe(
      "Target delivery can't be before the planned start.",
    );
    expect(validateProjectFields({ name: "Proj", clientName: "Client", plannedStart: "invalid-date" })).toBe("Use a valid date.");
    expect(validateProjectFields({ name: "Proj", clientName: "Client", plannedStart: "2026-11-10", targetDelivery: "2026-11-20" })).toBeNull();
  });

  it("applies status change side-effects (in_progress sets actualStart; booked sets bookingDate)", () => {
    const today = "2026-11-10";
    expect(applyStatusSideEffects({}, "in_progress", today)).toEqual({ actualStart: today });
    expect(applyStatusSideEffects({ actualStart: "2026-11-01" }, "in_progress", today)).toEqual({});
    expect(applyStatusSideEffects({}, "booked", today)).toEqual({ bookingDate: today });
    expect(applyStatusSideEffects({ bookingDate: "2026-11-05" }, "booked", today)).toEqual({});
  });

  it("computes task and milestone progress accurately", () => {
    expect(projectProgress([])).toEqual({ total: 0, done: 0, pct: null, text: "No tasks yet — progress isn't measured" });
    const tasks = [
      { status: "done", milestoneId: "m1" },
      { status: "open", milestoneId: "m1" },
      { status: "done", milestoneId: "m2" },
      { status: "done", milestoneId: "m2" },
    ];
    expect(projectProgress(tasks)).toEqual({ total: 4, done: 3, pct: 75, text: "3 of 4 tasks complete" });
    expect(milestoneProgress("m1", tasks)).toEqual({ total: 2, done: 1, complete: false });
    expect(milestoneProgress("m2", tasks)).toEqual({ total: 2, done: 2, complete: true });
  });

  it("validates delivery rules and detects checklist gaps", () => {
    const project = {
      status: "in_progress",
      qa: [
        { id: "qa1", label: "Mobile QA", done: true },
        { id: "qa2", label: "Desktop QA", done: false },
      ],
      handover: [{ id: "ho1", label: "Credentials shared safely", done: true }],
    };
    expect(deliveryGaps(project)).toEqual(["Desktop QA"]);
    // Without override, delivery is blocked
    expect(deliveryError(project, { date: "2026-11-10", approval: "pending" })).toBe(
      "Some checklist items are not complete. Complete them or record why you are delivering anyway.",
    );
    // With override, delivery is permitted
    expect(deliveryError(project, { date: "2026-11-10", approval: "pending", override: "Client requested early preview" })).toBeNull();
  });

  it("calculates support dates and lifecycle statuses correctly", () => {
    expect(addMonths("2026-11-10", 3)).toBe("2027-02-09");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-27"); // 1 month minus 1 day inclusive
    expect(supportStatus({ included: false }, "2026-11-10")).toBe("not_included");
    expect(supportStatus({ included: true, start: "2026-11-15" }, "2026-11-10")).toBe("scheduled");
    expect(supportStatus({ included: true, start: "2026-11-01", end: "2026-11-30" }, "2026-11-10")).toBe("active");
    expect(supportStatus({ included: true, start: "2026-10-01", end: "2026-10-31" }, "2026-11-10")).toBe("ended");
    expect(supportError({ included: true, start: "invalid" })).toBe("Choose when support starts — it is never assumed.");
    expect(supportError({ included: true, start: "2026-11-10", end: "2026-11-05" })).toBe("Support end can't be before it starts.");
    expect(supportError({ included: true, start: "2026-11-10", months: 150 })).toBe("Support duration must be 1–120 months.");
  });

  it("calculates project attention and metrics cleanly", () => {
    const today = "2026-11-10";
    const projects = [
      {
        id: "p1",
        archived: false,
        status: "in_progress",
        stage: "development",
        targetDelivery: "2026-11-05", // overdue
        deliveryJson: null,
      },
      {
        id: "p2",
        archived: false,
        status: "ready",
        stage: "discovery",
        targetDelivery: "2026-11-15", // due in 5 days
        deliveryJson: null,
      },
    ];
    const tasks = [
      { projectId: "p1", status: "open", dueDate: "2026-11-01" }, // overdue
      { projectId: "p2", status: "open", dueDate: "2026-11-20" },
    ];
    const requests = [{ projectId: "p1", status: "open", priority: "high" }];

    const att = projectAttention(projects, tasks, requests, today);
    expect(att.some((a) => a.kind === "overdue")).toBe(true);
    expect(att.some((a) => a.kind === "ready")).toBe(true);
    expect(att.some((a) => a.kind === "tasks_overdue")).toBe(true);
    expect(att.some((a) => a.kind === "support_open")).toBe(true);

    const m = projectMetrics(projects, tasks, [], requests, today);
    expect(m.active).toBe(2);
    expect(m.overdue).toBe(1);
    expect(m.openTasks).toBe(2);
    expect(m.openRequests).toBe(1);
  });
});
