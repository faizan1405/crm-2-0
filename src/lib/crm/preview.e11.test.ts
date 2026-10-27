import { describe, expect, it } from "vitest";
import { scopeSecondary } from "./preview";
import type { ActivityEvent } from "./activity";

const ev = (o: Partial<ActivityEvent>): ActivityEvent => ({ eventId: o.eventId ?? "e", eventType: "payment.recorded", actorUserId: "owner", actorRole: "owner", actorName: "Owner", entityType: "payment", entityId: "p1", occurredAt: "2026-10-01T00:00:00Z", summary: "s", module: "finance", importance: "normal", operationId: "o", eventSource: "ui", schemaVersion: 1, ...o } as ActivityEvent);
const d = {
  leads: [], followUps: [], activities: [], deals: [], payments: [], quotationShares: [],
  assignments: { L1: { employeeId: "A" }, L2: { employeeId: "B" } } as never,
  teamEvents: [ev({ eventId: "mine", relatedLeadId: "L1", newValues: { amount: 73_331 } }), ev({ eventId: "other", relatedLeadId: "L2", newValues: { amount: 91_919 } })],
  reminders: [{ id: "r1", leadId: "L1" }, { id: "r2", leadId: "L2" }] as never,
  assignmentEvents: [{ id: "a1", leadId: "L1", previousAssigneeId: null, newAssigneeId: "A" }, { id: "a2", leadId: "L2", previousAssigneeId: null, newAssigneeId: "B" }] as never,
  goals: [{ id: "g1", status: "active", scope: "employee", employeeIds: ["A"], metric: "revenue" }, { id: "g2", status: "active", scope: "employee", employeeIds: ["B"], metric: "calls" }] as never,
  employeeAccess: { A: {}, B: {} },
};
const ids = new Set(["L1"]);

describe("E1.1 preview secondary-data scoping", () => {
  it("drops other leads' team events and strips payment amounts without finance access", () => {
    const s = scopeSecondary(d, "A", ids, false);
    expect(s.teamEvents.map((e) => e.eventId)).toEqual(["mine"]);
    expect(JSON.stringify(s.teamEvents)).not.toContain("73331");
    expect(JSON.stringify(s.teamEvents)).not.toContain("91919");
  });
  it("keeps amounts for employees with amounts access", () => {
    expect(scopeSecondary(d, "A", ids, true).teamEvents[0]!.newValues).toEqual({ amount: 73_331 });
  });
  it("limits reminders, assignments, assignment history and access to the employee's scope", () => {
    const s = scopeSecondary(d, "A", ids, false);
    expect(s.reminders.map((r) => r.id)).toEqual(["r1"]);
    expect(Object.keys(s.assignments)).toEqual(["L1"]);
    expect(s.assignmentEvents.map((e) => e.id)).toEqual(["a1"]);
    expect(Object.keys(s.employeeAccess)).toEqual(["A"]);
  });
  it("hides other employees' goals and financial goals without finance access", () => {
    expect(scopeSecondary(d, "A", ids, false).goals).toEqual([]);
    expect(scopeSecondary(d, "A", ids, true).goals.map((g) => g.id)).toEqual(["g1"]);
  });
  it("never carries Owner-only analytics into the preview", () => {
    const s = scopeSecondary({ ...d, savedReports: [{}], expectedClose: { L1: "2026-11-01" } } as never, "A", ids, true);
    expect(s.savedReports).toEqual([]); expect(s.expectedClose).toEqual({}); expect(s.forecastHistory).toEqual([]);
  });
});
