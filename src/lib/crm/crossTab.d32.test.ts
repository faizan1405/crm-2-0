import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { exitPreview } from "./preview";
import { isStaleError } from "./crossTab";
import { taskAssigneeError } from "./projectStore";
import { draftFromDeal, starterTemplates } from "./projects";
import type { Deal } from "./types";

const KEY = "scale-flow-crm-2-demo";
const s = () => useCRM.getState();
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
function otherTab(mut: (st: any) => void) { const b = saved(); mut(b.state); localStorage.setItem(KEY, JSON.stringify(b)); }
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };
const DEAL: Deal = { id: "deal_32", clientType: "crm", clientName: "D32 Client", name: "D32 Site", quotedAmount: 40000, finalAmount: 40000, status: "active", milestones: [], createdAt: "2026-10-01T00:00:00Z" };
const emp = (id: string, accountStatus: string) => ({ id, name: id, email: `${id}@t.test`, roleId: "sales", accountStatus, createdAt: "", updatedAt: "" });
let pid = "";
const tasks = () => saved().state.projectTasks.filter((t: { projectId: string }) => t.projectId === pid).sort((a: any, b: any) => a.order - b.order);
const bump = (id: string, patch: object) => otherTab((st) => { const t = st.projectTasks.find((x: any) => x.id === id); Object.assign(t, patch, { version: t.version + 1, updatedAt: "2026-10-27T06:00:00Z" }); });

beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ deals: [DEAL], payments: [], projects: [], projectTasks: [], projectMilestones: [], employees: [emp("emp_a", "active"), emp("emp_b", "active"), emp("emp_x", "inactive")] as never });
  const r = s().createProject(draftFromDeal({ deal: DEAL, template: starterTemplates("2026-10-01T00:00:00Z")[0]! }), { milestones: ["M1"], tasks: [{ title: "T1" }, { title: "T2" }] });
  if (!r.ok) throw new Error(r.error);
  pid = r.id;
  expect(s().updateTask(tasks()[0].id, { assigneeId: "emp_a" })).toBeNull();
});

describe("D3.2 task assignee / due-date conflicts", () => {
  it("stale assignee change is refused; newer assignee kept, no extra history", () => {
    const t = tasks()[0]; const h = t.history.length;
    bump(t.id, { assigneeId: "emp_b" });
    expect(isStaleError(tryRun(() => s().updateTask(t.id, { assigneeId: null }, t.version)))).toBe(true);
    expect(tasks()[0].assigneeId).toBe("emp_b"); expect(tasks()[0].history).toHaveLength(h);
  });
  it("stale due date is refused; newer date kept", () => {
    const t = tasks()[0];
    bump(t.id, { dueDate: "2026-11-10" });
    expect(isStaleError(tryRun(() => s().updateTask(t.id, { dueDate: "2026-12-01" }, t.version)))).toBe(true);
    expect(tasks()[0].dueDate).toBe("2026-11-10");
  });
  it("re-applying the due date on the latest version keeps the other tab's assignee", () => {
    const t = tasks()[0];
    bump(t.id, { assigneeId: "emp_b" });
    const latest = tasks()[0];
    expect(s().updateTask(t.id, { dueDate: "2026-12-01" }, latest.version)).toBeNull();
    expect(tasks()[0]).toMatchObject({ assigneeId: "emp_b", dueDate: "2026-12-01" });
    expect(tasks()[1].dueDate).toBeUndefined();
  });
  it("inactive or unknown people can't be newly assigned", () => {
    const t = tasks()[1];
    expect(s().updateTask(t.id, { assigneeId: "emp_x" }, t.version)).toMatch(/only active/);
    expect(s().updateTask(t.id, { assigneeId: "ghost" }, t.version)).toMatch(/only active/);
    expect(tasks()[1].assigneeId).toBeNull();
    expect(taskAssigneeError("owner", [])).toBeNull(); expect(taskAssigneeError(null, [])).toBeNull();
  });
});
