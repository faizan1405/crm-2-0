import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { startPreview, exitPreview } from "./preview";
import { migrateProjects } from "./projectStore";
import {
  addMonths, canSeeProject, deliveryError, draftFromDeal, looksLikeSecret, projectAttention, projectFinance, projectMessage, projectProgress,
  reversalFlag, starterTemplates, supportStatus, type Project,
} from "./projects";
import { deriveNotifications, DEFAULT_NOTIFY_PREFS } from "./activity";
import { buildBackup, ALL_CATEGORY_IDS, CATEGORIES } from "./vault";
import { unzipSync, strFromU8 } from "fflate";
import type { Deal } from "./types";

const s = () => useCRM.getState();
const DEAL: Deal = { id: "deal_web", clientType: "crm", leadId: undefined, clientName: "Asha Mehta", company: "Mehta Interiors", phone: "9876500000", name: "Business website", quotedAmount: 40000, finalAmount: 40000, status: "active", milestones: [], createdAt: "2026-10-01T00:00:00Z" };
const tpl = starterTemplates("2026-10-01T00:00:00Z")[0]!;
const make = (extra: Partial<Project> = {}) => {
  const r = s().createProject({ ...draftFromDeal({ deal: DEAL, template: tpl }), ...extra }, { milestones: tpl.milestones, tasks: tpl.tasks });
  if (!r.ok) throw new Error(r.error);
  return r.id;
};
const P = (id: string) => s().projects.find((p) => p.id === id)!;

beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ deals: [DEAL], payments: [], employees: [], employeeAccess: {}, assignments: {}, projects: [], projectTasks: [], projectMilestones: [], supportRequests: [], teamEvents: [] });
});
afterEach(() => exitPreview());

describe("deal → project handoff", () => {
  it("prefills client and deal details without marking anything paid or started", () => {
    const id = make();
    const p = P(id);
    expect(p.clientName).toBe("Asha Mehta");
    expect(p.dealId).toBe("deal_web");
    expect(p.carried.dealValue).toBe(40000);
    expect(p.status).toBe("accepted");
    expect(p.actualStart).toBeUndefined();
    expect(s().payments).toHaveLength(0);
    expect(s().deals).toHaveLength(1);
  });
  it("refuses an accidental second active project for the same deal, but allows an explicit one", () => {
    const id = make();
    const again = s().createProject(draftFromDeal({ deal: DEAL }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.existingId).toBe(id);
    expect(s().createProject(draftFromDeal({ deal: DEAL }), { allowAnother: true }).ok).toBe(true);
    expect(s().projects).toHaveLength(2);
  });
  it("creates template tasks grouped into milestones", () => {
    const id = make();
    expect(s().projectTasks.filter((t) => t.projectId === id)).toHaveLength(tpl.tasks.length);
    expect(s().projectMilestones.filter((m) => m.projectId === id).map((m) => m.title)).toEqual(tpl.milestones);
  });
});

describe("booking and status", () => {
  it("booking without start: awaiting client is not in progress and has no actual start", () => {
    const id = make();
    s().setProjectStatus(id, "booked");
    s().setProjectStatus(id, "awaiting_client");
    expect(P(id).status).toBe("awaiting_client");
    expect(P(id).actualStart).toBeUndefined();
    expect(P(id).bookingDate).toBeTruthy();
    s().setProjectStatus(id, "in_progress");
    expect(P(id).actualStart).toBeTruthy();
  });
  it("rejects a target delivery before the planned start", () => {
    const id = make();
    expect(s().updateProject(id, { plannedStart: "2026-11-10", targetDelivery: "2026-11-01" })).toMatch(/before/);
  });
});

describe("board stage changes and safe undo", () => {
  it("moves stage, records history, and undo never overwrites a newer change", () => {
    const id = make();
    const r = s().moveProjectStage(id, "development")!;
    expect(P(id).stage).toBe("development");
    expect(P(id).history.at(-1)!.change).toMatch(/Development/);
    expect(s().undoProjectStage(id, r.from, r.version)).toBe(true);
    expect(P(id).stage).toBe("discovery");
    const r2 = s().moveProjectStage(id, "design")!;
    s().moveProjectStage(id, "testing");
    expect(s().undoProjectStage(id, r2.from, r2.version)).toBe(false);
    expect(P(id).stage).toBe("testing");
  });
  it("cannot drag a project to Delivered without a delivery record", () => {
    const id = make();
    expect(s().moveProjectStage(id, "delivered")).toBeNull();
  });
});

describe("tasks and progress", () => {
  it("progress is only from completed tasks, not the stage", () => {
    const id = make();
    s().moveProjectStage(id, "development");
    const tasks = s().projectTasks.filter((t) => t.projectId === id);
    expect(projectProgress(tasks).pct).toBe(0);
    s().setTaskDone(tasks[0]!.id, true);
    s().setTaskDone(tasks[1]!.id, true);
    expect(projectProgress(s().projectTasks.filter((t) => t.projectId === id))).toMatchObject({ done: 2, total: 5, pct: 40 });
    s().setTaskDone(tasks[0]!.id, false);
    expect(projectProgress(s().projectTasks.filter((t) => t.projectId === id)).done).toBe(1);
    expect(projectProgress([]).pct).toBeNull();
  });
  it("reassignment keeps the previous assignee in task history", () => {
    const id = make();
    const t = s().projectTasks.find((x) => x.projectId === id)!;
    s().updateTask(t.id, { assigneeId: "emp_a" });
    s().updateTask(t.id, { assigneeId: "emp_b" });
    const h = s().projectTasks.find((x) => x.id === t.id)!.history.map((x) => x.change);
    expect(h.some((c) => c.includes("emp_a"))).toBe(true);
  });
});

describe("finance comes only from Finance Studio", () => {
  it("40,000 deal with 4,000 advance shows 36,000 remaining; voided payments don't count; further payments reflect", () => {
    const id = make();
    s().addPayment({ dealId: DEAL.id, amount: 4000, date: "2026-10-20", method: "UPI", type: "advance" });
    let f = projectFinance(P(id), s().deals, s().payments);
    expect([f.agreed, f.received, f.remaining, f.advanceReceived]).toEqual([40000, 4000, 36000, true]);
    s().addPayment({ dealId: DEAL.id, amount: 20000, date: "2026-10-22", method: "UPI", type: "milestone" });
    const bad = s().payments.find((p) => p.amount === 20000)!;
    s().voidPayment(bad.id);
    f = projectFinance(P(id), s().deals, s().payments);
    expect(f.received).toBe(4000);
    expect(f.voided).toBe(1);
    s().addPayment({ dealId: DEAL.id, amount: 20000, date: "2026-10-23", method: "UPI", type: "milestone" });
    expect(projectFinance(P(id), s().deals, s().payments).remaining).toBe(16000);
    expect(s().payments.filter((p) => p.dealId === DEAL.id)).toHaveLength(3); // the project never adds payments
  });
  it("delivery does not mark the balance paid", () => {
    const id = make();
    for (const c of [...P(id).qa, ...P(id).handover]) s().toggleCheck(id, P(id).qa.some((x) => x.id === c.id) ? "qa" : "handover", c.id);
    expect(s().deliverProject(id, { date: "2026-11-01", approval: "approved" })).toBeNull();
    expect(projectFinance(P(id), s().deals, s().payments).remaining).toBe(40000);
  });
});

describe("delivery checklist", () => {
  it("requires all items or a recorded override reason, and keeps the gaps", () => {
    const id = make();
    expect(s().deliverProject(id, { date: "2026-11-01", approval: "pending" })).toMatch(/not complete/);
    expect(s().deliverProject(id, { date: "2026-11-01", approval: "pending", override: "Client launching today; QA continues" })).toBeNull();
    expect(P(id).delivery!.incomplete.length).toBeGreaterThan(0);
    expect(P(id).stage).toBe("delivered");
    expect(s().deliverProject(id, { date: "2026-11-02", approval: "pending", override: "x" })).toMatch(/already/);
  });
  it("rejects fake or malformed delivery links", () => {
    expect(deliveryError({ qa: [], handover: [], status: "in_progress" }, { date: "2026-11-01", approval: "approved", url: "not a link" })).toMatch(/https/);
  });
});

describe("support", () => {
  it("calculates support periods explicitly and never assumes a start", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-01-31");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-27");
    expect(supportStatus({ included: true }, "2026-11-01")).toBe("not_set");
    expect(supportStatus({ included: true, start: "2026-11-01", end: "2027-01-31" }, "2026-12-01")).toBe("active");
    expect(supportStatus({ included: true, start: "2026-11-01", end: "2027-01-31" }, "2027-02-01")).toBe("ended");
    expect(supportStatus({ included: false }, "2026-12-01")).toBe("not_included");
    const id = make();
    expect(s().saveSupport(id, { included: true })).toMatch(/starts/);
  });
  it("support requests need resolution notes and coverage is never assumed", () => {
    const id = make();
    const r = s().addSupportRequest({ projectId: id, kind: "bug", title: "Form not sending", priority: "high", assigneeId: null });
    expect(r.ok).toBe(true);
    const sr = s().supportRequests[0]!;
    expect(sr.coverage).toBe("undecided");
    expect(s().updateSupportRequest(sr.id, { status: "resolved" })).toMatch(/resolution/);
    expect(s().updateSupportRequest(sr.id, { status: "resolved", resolution: "Fixed SMTP" })).toBeNull();
    expect(s().supportRequests[0]!.resolvedAt).toBeTruthy();
  });
});

describe("safety", () => {
  it("blocks credentials in notes and requirements", () => {
    expect(looksLikeSecret("hosting password: hunter22")).toBe(true);
    expect(looksLikeSecret("Hosting login shared by client over call")).toBe(false);
    const id = make();
    expect(s().addProjectNote(id, "cpanel login: admin pwd=abc123")).toMatch(/password/i);
    expect(s().addCheck(id, "requirements", "Password: abc")).toMatch(/password/i);
  });
  it("flags (never deletes) a project when its deal is cancelled", () => {
    const id = make();
    useCRM.setState({ deals: [{ ...DEAL, status: "cancelled" }] });
    expect(reversalFlag(P(id), s().deals, s().leads)).toMatch(/cancelled/);
    expect(s().projects).toHaveLength(1);
    expect(projectAttention([{ ...P(id), reviewFlag: "x" }], [], [], "2026-10-23")[0]!.kind).toBe("review");
  });
  it("WhatsApp drafts are fully resolved", () => {
    const id = make();
    const t = projectMessage("content", P(id), { owner: "Faizan", business: "Scale Flow", pending: ["Logo"] });
    expect(t).toMatch(/Hi Asha/);
    expect(t).not.toMatch(/[{}]/);
  });
});

describe("activity attribution and notifications", () => {
  it("records project events as the Owner with project/deal links and dedupes", () => {
    const id = make();
    s().setProjectStatus(id, "in_progress");
    const t = s().projectTasks.find((x) => x.projectId === id)!;
    s().setTaskDone(t.id, true);
    const ev = s().teamEvents;
    const created = ev.find((e) => e.eventType === "project.created")!;
    expect(created.actorUserId).toBe("owner");
    expect(created.newValues).toMatchObject({ projectId: id, dealId: DEAL.id });
    expect(ev.some((e) => e.eventType === "project.started")).toBe(true);
    expect(ev.some((e) => e.eventType === "project.task_completed")).toBe(true);
    expect(ev.filter((e) => e.eventType === "project.task_created")).toHaveLength(0); // template tasks at creation aren't noise
    expect(new Set(ev.map((e) => e.eventId)).size).toBe(ev.length);
    const n = deriveNotifications(ev, [], [], DEFAULT_NOTIFY_PREFS, new Date());
    expect(n.some((x) => x.category === "projects")).toBe(true);
    s().addProjectNote(id, "Decided on a darker palette");
    expect(s().teamEvents.length).toBe(ev.length); // notes don't spam events
  });
});

describe("permissions and employee preview", () => {
  const emp = () => {
    const r = s().addEmployee({ name: "Neha Dev", email: "neha@example.com", roleId: "salesperson", accountStatus: "active" });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  it("seeing the lead is not enough: employees only see assigned projects, finance needs explicit permission", () => {
    const e = emp();
    const mine = make(), other = make({ name: "Other" });
    s().createProject(draftFromDeal({ deal: DEAL }), { allowAnother: true });
    s().updateProject(mine, { memberIds: [e] });
    expect(canSeeProject(P(other), { owner: false, employeeId: e, can: () => true, financeAmounts: false })).toBe(false);
    // Without projects.view the employee sees nothing.
    startPreview(s().employees.find((x) => x.id === e)!);
    expect(s().projects).toHaveLength(0);
    exitPreview();
    useCRM.setState({ employeeAccess: { [e]: { overrides: { "projects.view": true, "projects.tasks_complete": true }, updatedAt: "" } } });
    startPreview(s().employees.find((x) => x.id === e)!);
    expect(s().projects.map((p) => p.id)).toEqual([mine]);
    expect(s().projects[0]!.notes).toBeUndefined();
    // No edit permission → cannot edit the project; can't complete an unassigned task.
    expect(s().updateProject(mine, { name: "Hacked" })).toBeTruthy();
    const t = s().projectTasks.find((x) => x.projectId === mine)!;
    expect(s().setTaskDone(t.id, true)).toBe(false);
    exitPreview();
    expect(P(mine).name).toBe("Business website");
  });
  it("preview changes never reach the Owner's records", () => {
    const e = emp();
    const id = make();
    s().updateProject(id, { memberIds: [e] });
    useCRM.setState({ employeeAccess: { [e]: { overrides: { "projects.view": true, "projects.stage": true, "projects.tasks_add": true }, updatedAt: "" } } });
    startPreview(s().employees.find((x) => x.id === e)!);
    s().moveProjectStage(id, "design");
    s().addTask(id, { title: "Preview task" });
    exitPreview();
    expect(P(id).stage).toBe("discovery");
    expect(s().projectTasks.some((t) => t.title === "Preview task")).toBe(false);
  });
});

describe("data vault and migration", () => {
  it("full backup includes projects and their links, without duplicating payments", async () => {
    const id = make();
    s().addPayment({ dealId: DEAL.id, amount: 4000, date: "2026-10-20", method: "UPI", type: "advance" });
    s().addSupportRequest({ projectId: id, kind: "general", title: "Help", priority: "normal", assigneeId: null });
    expect(CATEGORIES.find((c) => c.id === "projects")!.keys).toEqual(["projects", "projectTasks", "projectMilestones", "projectTemplates", "supportRequests"]);
    const r = await buildBackup({ type: "full", categories: ALL_CATEGORY_IDS }, s() as never, []);
    const files = unzipSync(r.zip);
    const data = JSON.parse(strFromU8(files["data/projects.json"]!));
    expect(data.projects[0].dealId).toBe(DEAL.id);
    expect(data.projectTasks.length).toBe(tpl.tasks.length);
    expect(data.supportRequests[0].projectId).toBe(id);
    expect(JSON.stringify(data)).not.toContain('"amount":4000');
  });
  it("v8 migration adds empty project state and starter templates without touching leads", () => {
    const m = migrateProjects({ leads: [{ id: "l1" }] }, 7);
    expect(m["projects"]).toEqual([]);
    expect((m["projectTemplates"] as unknown[]).length).toBe(6);
    expect(m["leads"]).toEqual([{ id: "l1" }]);
    const kept = { projects: [{ id: "p" }] };
    expect(migrateProjects(kept, 8)).toBe(kept);
  });
});
