import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { startPreview, exitPreview } from "./preview";
import { routeAllowed, type PreviewSession } from "./session";
import { CATEGORIES } from "./vault";
import {
  canViewTeamActivity, deriveNotifications, filterEvents, isRead, markAllRead, markRead, mergeEvents, notificationLink, simulateDemoEvents, unreadCount,
  DEFAULT_NOTIFY_PREFS, EMPTY_READS, type ActivityEvent,
} from "./activity";

const s = () => useCRM.getState();
const NOW = new Date("2026-10-23T12:00:00Z");
let empA = "", empB = "", empC = "";

beforeEach(() => {
  exitPreview();
  localStorage.clear();
  s().reset();
  useCRM.setState({ employees: [], employeeAccess: {}, assignments: {}, assignmentEvents: [], teamEvents: [], notifyPrefs: DEFAULT_NOTIFY_PREFS, notifyReads: EMPTY_READS, owner: "Faizan" });
  const ids = ["A", "B", "C"].map((n) => { const r = s().addEmployee({ name: `Emp ${n}`, email: `${n.toLowerCase()}@ex.com`, roleId: "salesperson", accountStatus: "active" }); if (!r.ok) throw new Error(r.error); return r.id; });
  [empA, empB, empC] = ids as [string, string, string];
  useCRM.setState({ teamEvents: [] });
});
const ev = () => s().teamEvents;

describe("activity event creation and attribution", () => {
  it("records a stage change as an Owner action with before/after values", () => {
    const l = s().leads.find((x) => x.status === "contacted") ?? s().leads[0]!;
    const from = l.status;
    s().updateLead(l.id, { status: "qualified" });
    const e = ev().find((x) => x.eventType === "pipeline.stage_changed")!;
    expect(e.actorUserId).toBe("owner");
    expect(e.actorRole).toBe("owner");
    expect(e.actorName).toBe("Faizan");
    expect(e.relatedLeadId).toBe(l.id);
    expect(e.oldValues).toEqual({ status: from });
    expect(e.newValues).toMatchObject({ status: "qualified" });
    expect(e.schemaVersion).toBe(1);
  });
  it("marks Won as its own event", () => {
    const l = s().leads.find((x) => x.status !== "won")!;
    s().updateLead(l.id, { status: "won" });
    expect(ev().some((x) => x.eventType === "deal.won" && x.relatedLeadId === l.id)).toBe(true);
  });
  it("records lead creation once, not once per nested action", () => {
    s().addLead({ name: "Rohan Kapoor", phone: "9876543210", source: "Website", status: "new", priority: "warm", pinned: false });
    expect(ev().filter((x) => x.eventType === "lead.created")).toHaveLength(1);
  });
});

describe("bulk summaries and undo history", () => {
  it("90-style distribution writes one summary event, and undo writes a separate reversal", () => {
    const leads = s().leads.slice(0, 9);
    const plan = leads.map((l, i) => ({ leadId: l.id, previous: null, employeeId: [empA, empB, empC][i % 3]! }));
    const r = s().applyAssignmentPlan(plan, "bulk");
    if (!r.ok) throw new Error("plan failed");
    const bulk = ev().filter((x) => x.eventType === "bulk.completed");
    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.summary).toBe("9 Leads distributed across 3 employees.");
    expect(ev().filter((x) => x.eventType === "lead.assigned")).toHaveLength(0);
    s().restoreAssignments(r.snapshot);
    expect(ev().filter((x) => x.eventType === "bulk.completed")).toHaveLength(1); // original kept
    expect(ev().filter((x) => x.eventType === "bulk.reversed")).toHaveLength(1);
  });
  it("bulk notification is a single bell item", () => {
    const plan = s().leads.slice(0, 6).map((l) => ({ leadId: l.id, previous: null, employeeId: empA }));
    s().applyAssignmentPlan(plan, "bulk");
    const n = deriveNotifications(ev(), [], s().leads, { ...DEFAULT_NOTIFY_PREFS, overdue: false }, NOW);
    expect(n.filter((x) => x.category === "assignments")).toHaveLength(1);
  });
});

describe("duplicate prevention", () => {
  it("mergeEvents ignores repeated eventIds (reconnect replay)", () => {
    s().updateLead(s().leads[0]!.id, { status: "proposal" });
    const before = ev().length;
    s().ingestEvents(ev());
    expect(ev().length).toBe(before);
    expect(mergeEvents(ev(), [...ev(), ...ev()]).length).toBe(before);
  });
  it("demo events can never be ingested into genuine history", () => {
    s().ingestEvents(simulateDemoEvents(s().employees, s().leads, NOW));
    expect(ev()).toHaveLength(0);
  });
});

describe("Employee Preview isolation and Owner visibility", () => {
  it("preview actions never create Team Activity events", () => {
    const id = s().leads[0]!.id;
    s().assignLeads([id], empA, "t");
    const count = ev().length;
    startPreview(s().employees.find((e) => e.id === empA)!);
    s().updateLead(id, { status: "qualified" });
    expect(ev().length).toBe(count);
    exitPreview();
    expect(ev().length).toBe(count);
  });
  it("Team Activity is Owner-only and can't be granted", () => {
    expect(canViewTeamActivity("owner")).toBe(true);
    expect(canViewTeamActivity({ employeeId: empA })).toBe(false);
    const p: PreviewSession = { employeeId: empA, name: "A", roleLabel: "x", allowed: ["__owner", "dashboard.view", "leads.view"], leadScope: "assigned", finance: "none", startedAt: "" };
    expect(routeAllowed(p, "/team-activity")).toBe(false);
  });
});

describe("filtering", () => {
  const mk = (id: string, at: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ eventId: id, eventType: "call.logged", actorUserId: "owner", actorRole: "owner", actorName: "O", entityType: "lead", entityId: "l1", occurredAt: at, summary: "called Rohan", module: "calls", importance: "normal", operationId: id, eventSource: "local", schemaVersion: 1, ...extra });
  const list = [mk("a", "2026-10-23T06:00:00Z"), mk("b", "2026-10-20T06:00:00Z", { actorUserId: "e1", eventType: "lead.created", module: "leads" }), mk("c", "2026-08-01T06:00:00Z", { relatedLeadId: "L9" })];
  it("today / 7d / 90d windows", () => {
    expect(filterEvents(list, { range: "today" }, NOW).map((e) => e.eventId)).toEqual(["a"]);
    expect(filterEvents(list, { range: "7d" }, NOW).map((e) => e.eventId)).toEqual(["a", "b"]);
    expect(filterEvents(list, { range: "90d" }, NOW)).toHaveLength(3);
  });
  it("employee, type, lead, custom range and search", () => {
    expect(filterEvents(list, { range: "all", employee: "e1" }, NOW).map((e) => e.eventId)).toEqual(["b"]);
    expect(filterEvents(list, { range: "all", type: "lead.created" }, NOW).map((e) => e.eventId)).toEqual(["b"]);
    expect(filterEvents(list, { range: "all", lead: "L9" }, NOW).map((e) => e.eventId)).toEqual(["c"]);
    expect(filterEvents(list, { range: "custom", from: "2026-10-19", to: "2026-10-21" }, NOW).map((e) => e.eventId)).toEqual(["b"]);
    expect(filterEvents(list, { range: "all", q: "rohan" }, NOW)).toHaveLength(3);
  });
});

describe("notifications", () => {
  it("trivial edits don't notify; preferences switch categories off", () => {
    const l = s().leads[0]!;
    s().updateLead(l.id, { company: "New Co" });
    expect(deriveNotifications(ev(), [], s().leads, DEFAULT_NOTIFY_PREFS, NOW)).toHaveLength(0);
    s().updateLead(l.id, { status: l.status === "won" ? "lost" : "won", ...(l.status === "won" ? { lostReason: "x" } : {}) });
    expect(deriveNotifications(ev(), [], s().leads, DEFAULT_NOTIFY_PREFS, NOW)).toHaveLength(1);
    expect(deriveNotifications(ev(), [], s().leads, { ...DEFAULT_NOTIFY_PREFS, deals: false }, NOW)).toHaveLength(0);
  });
  it("overdue follow-ups notify with a stable id", () => {
    const l = s().leads[0]!;
    const fu = [{ id: "f1", leadId: l.id, type: "call" as const, dueAt: "2026-10-22T05:00:00Z" }];
    const n = deriveNotifications([], fu, s().leads, DEFAULT_NOTIFY_PREFS, NOW);
    expect(n.map((x) => x.id)).toEqual(["overdue:f1"]);
    expect(deriveNotifications([], fu, s().leads, { ...DEFAULT_NOTIFY_PREFS, overdue: false }, NOW)).toHaveLength(0);
  });
  it("read / unread / mark all", () => {
    const fu = ["f1", "f2"].map((id) => ({ id, leadId: s().leads[0]!.id, type: "call" as const, dueAt: "2026-10-22T05:00:00Z" }));
    const n = deriveNotifications([], fu, s().leads, DEFAULT_NOTIFY_PREFS, NOW);
    expect(unreadCount(n, EMPTY_READS)).toBe(2);
    const r = markRead(EMPTY_READS, n[0]!.id);
    expect(unreadCount(n, r)).toBe(1);
    expect(isRead(n[0]!, r)).toBe(true);
    expect(unreadCount(n, markAllRead(NOW.toISOString()))).toBe(0);
  });
  it("deep links open the lead inspector or employee", () => {
    expect(notificationLink({ id: "x", category: "deals", title: "", body: "", at: "", importance: "normal", leadId: "L1", source: "local" })).toEqual({ to: "/pipeline", search: { lead: "L1" } });
    expect(notificationLink({ id: "x", category: "team", title: "", body: "", at: "", importance: "normal", employeeId: "E1", source: "local" })).toEqual({ to: "/team", search: { employee: "E1" } });
  });
  it("payment notifications never include the amount", () => {
    const d = s().deals[0]!;
    s().addPayment({ dealId: d.id, amount: 12345, date: "2026-10-23", method: "UPI", type: "other" });
    const n = deriveNotifications(ev(), [], s().leads, DEFAULT_NOTIFY_PREFS, NOW).filter((x) => x.category === "payments");
    expect(n).toHaveLength(1);
    expect(n[0]!.body).not.toMatch(/12,?345/);
  });
});

describe("Data Vault coverage", () => {
  it("backs up activity events, notification preferences and read status", () => {
    const keys = CATEGORIES.flatMap((c) => c.keys);
    for (const k of ["teamEvents", "notifyPrefs", "notifyReads"]) expect(keys).toContain(k);
  });
});
