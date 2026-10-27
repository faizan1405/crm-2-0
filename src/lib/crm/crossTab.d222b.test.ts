import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { exitPreview } from "./preview";
import { isStaleError } from "./crossTab";
import { draftFromDeal, projectProgress, starterTemplates } from "./projects";
import type { Deal, Note } from "./types";

const KEY = "scale-flow-crm-2-demo";
const s = () => useCRM.getState();
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
/** Another tab's save: change the shared saved blob directly. */
function otherTab(mut: (st: any) => void) { const b = saved(); mut(b.state); localStorage.setItem(KEY, JSON.stringify(b)); }
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };
const DEAL: Deal = { id: "deal_b", clientType: "crm", clientName: "D222B Client", name: "D222B Site", quotedAmount: 40000, finalAmount: 40000, status: "active", milestones: [], createdAt: "2026-10-01T00:00:00Z" };
const tpl = starterTemplates("2026-10-01T00:00:00Z")[0]!;
let pid = "";
const tasks = () => saved().state.projectTasks.filter((t: { projectId: string }) => t.projectId === pid).sort((a: any, b: any) => a.order - b.order);

beforeEach(() => {
  exitPreview(); localStorage.clear(); s().reset();
  useCRM.setState({ deals: [DEAL], payments: [], projects: [], projectTasks: [], projectMilestones: [], notes: [] });
  const r = s().createProject(draftFromDeal({ deal: DEAL, template: tpl }), { milestones: ["M1", "M2"], tasks: [{ title: "T1" }, { title: "T2" }, { title: "T3" }] });
  if (!r.ok) throw new Error(r.error);
  pid = r.id;
});

describe("D2.2.2B projects, tasks and notes across tabs", () => {
  it("two tabs change two different tasks: both survive, the third is untouched, progress 1/3", () => {
    const [t1, t2, t3] = tasks();
    otherTab((st) => { const t = st.projectTasks.find((x: any) => x.id === t1.id); Object.assign(t, { status: "done", version: t.version + 1, updatedAt: "2026-10-27T06:00:00Z" }); });
    expect(s().updateTask(t2.id, { dueDate: "2026-11-15" }, t2.version)).toBeNull();
    const after = tasks();
    expect(after.map((t: any) => t.status)).toEqual(["done", "open", "open"]);
    expect(after[1].dueDate).toBe("2026-11-15");
    expect(after[2]).toEqual(t3);
    expect(projectProgress(after).done).toBe(1);
  });
  it("a stale edit of the same task is refused and the newer assignee stays", () => {
    const [t1] = tasks();
    otherTab((st) => { const t = st.projectTasks.find((x: any) => x.id === t1.id); Object.assign(t, { assigneeId: "emp_a", version: t.version + 1, updatedAt: "2026-10-27T06:00:00Z" }); });
    expect(isStaleError(tryRun(() => s().updateTask(t1.id, { notes: "stale" }, t1.version)))).toBe(true);
    const t = tasks()[0];
    expect(t.assigneeId).toBe("emp_a");
    expect(t.notes).toBeUndefined();
  });
  it("completing a task already completed in another tab changes nothing and adds no second Completed entry", () => {
    const [t1] = tasks();
    expect(s().setTaskDone(t1.id, true)).toBe(true);
    otherTab(() => {});
    expect(s().setTaskDone(t1.id, true)).toBe(false);
    expect(tasks()[0].history.filter((h: any) => h.change === "Completed").length).toBe(1);
  });
  it("a stale stage move is refused; the newer stage and history stay", () => {
    const from = s().projects[0]!.stage;
    otherTab((st) => { st.projects[0].stage = "testing"; st.projects[0].version += 1; });
    expect(isStaleError(tryRun(() => s().moveProjectStage(pid, "design", from)))).toBe(true);
    expect(saved().state.projects[0].stage).toBe("testing");
  });
  it("archiving twice from two tabs archives once, with one history line", () => {
    otherTab((st) => { st.projects[0].archived = true; });
    expect(s().archiveProject(pid, true)).toBe(false);
    expect(saved().state.projects[0].history.filter((h: any) => h.change.startsWith("Archived")).length).toBe(0);
  });
  it("two project notes from two tabs both exist", () => {
    expect(s().addProjectNote(pid, "Note A")).toBeNull();
    otherTab(() => {});
    expect(s().addProjectNote(pid, "Note B")).toBeNull();
    const notes = saved().state.projects[0].history.filter((h: any) => h.change.startsWith("Note:")).map((h: any) => h.change);
    expect(notes).toEqual(["Note: Note A", "Note: Note B"]);
  });
  it("a stale personal-note save is refused and the newer text stays; a different note saves normally", () => {
    const a: Note = { id: "n_a", title: "A", body: "v1", pinned: false, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" };
    const b: Note = { ...a, id: "n_b", title: "B" };
    s().saveNote(a); s().saveNote(b);
    otherTab((st) => { const n = st.notes.find((x: any) => x.id === "n_a"); Object.assign(n, { body: "tab A text", updatedAt: "2026-10-27T06:00:00Z" }); });
    expect(isStaleError(tryRun(() => s().saveNote({ ...a, body: "tab B draft", updatedAt: "2026-10-27T07:00:00Z" }, a.updatedAt)))).toBe(true);
    s().saveNote({ ...b, body: "B edited", updatedAt: "2026-10-27T07:00:00Z" }, b.updatedAt);
    const st = saved().state.notes;
    expect(st.find((n: any) => n.id === "n_a").body).toBe("tab A text");
    expect(st.find((n: any) => n.id === "n_b").body).toBe("B edited");
  });
  it("task and project changes never create payments or change the ₹40,000 deal", () => {
    const [t1] = tasks();
    s().setTaskDone(t1.id, true); s().moveProjectStage(pid, "testing"); s().archiveProject(pid, true);
    expect(saved().state.payments).toEqual([]);
    expect(saved().state.deals).toEqual([DEAL]);
  });
});
