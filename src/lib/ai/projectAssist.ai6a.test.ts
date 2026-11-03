import { describe, expect, it } from "vitest";
import type { Project, ProjectMilestone, ProjectTask } from "@/lib/crm/projects";
import { buildProjectContext, demoClientUpdate, findDuplicate, nextAction, structureRequirements, suggestTasks, updateViolations, PROJECT_DEMO_LABEL } from "./projectAssist";
import { useProjectTaskDraft } from "./projectTaskDraft";

const base = (o: Partial<Project> = {}): Project => ({
  id: "p1", name: "Website for Asha", clientName: "Asha Verma", type: "Website", status: "in_progress", stage: "development", priority: "normal",
  ownerId: "owner", memberIds: [], dependencies: [], requirements: [], qa: [], handover: [], links: [], support: { included: null }, carried: {},
  archived: false, history: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1, schema: 1, phone: "9999999999", email: "a@x.in", notes: "SECRET internal", ...o,
});
const task = (id: string, title: string, done: boolean, o: Partial<ProjectTask> = {}): ProjectTask => ({ id, projectId: "p1", title, assigneeId: null, priority: "normal", status: done ? "done" : "open", order: Number(id.slice(1)), history: [], createdAt: "", updatedAt: "", version: 1, ...o });
const four = [task("t1", "Home page design", true), task("t2", "Contact form", true), task("t3", "Gallery page", false), task("t4", "SEO setup", false)];
const ctxOf = (p: Project, t: ProjectTask[] = [], m: ProjectMilestone[] = [], sr = 0) => buildProjectContext(p, t, m, sr);

describe("AI-6A project context isolation", () => {
  it("excludes phone, email, internal notes and other projects' tasks", () => {
    const c = ctxOf(base(), [...four, task("t9", "Other client task", false, { projectId: "p2" })]);
    const json = JSON.stringify(c);
    expect(json).not.toContain("9999999999");
    expect(json).not.toContain("a@x.in");
    expect(json).not.toContain("SECRET");
    expect(c.tasks).toHaveLength(4);
  });
  it("task drafts are keyed by project and can't be taken by another project", () => {
    useProjectTaskDraft.getState().set({ projectId: "p1", title: "X", reason: "r" });
    expect(useProjectTaskDraft.getState().take("p2")).toBeNull();
    expect(useProjectTaskDraft.getState().take("p1")?.title).toBe("X");
    expect(useProjectTaskDraft.getState().take("p1")).toBeNull();
  });
});

describe("AI-6A accurate status", () => {
  it("delivered project never gets a development recommendation or progress update", () => {
    const c = ctxOf(base({ stage: "delivered", delivery: { date: "2026-03-10", deliveredBy: "owner", approval: "approved", incomplete: [] } }), four);
    expect(nextAction(c).kind).toBe("none");
    expect(demoClientUpdate({ ctx: c, purpose: "progress", tone: "professional", lang: "en", variant: 0 }).blocked).toBe(true);
    expect(suggestTasks(c).suggestions).toHaveLength(0);
  });
  it("delivery-ready message is refused while tasks are open", () => {
    const r = demoClientUpdate({ ctx: ctxOf(base(), four), purpose: "delivery_ready", tone: "professional", lang: "en", variant: 0 });
    expect(r.blocked).toBe(true);
    expect(r.notices[0]).toContain("2 task(s) open");
  });
  it("progress update states exact counts and carries the demo label", () => {
    const r = demoClientUpdate({ ctx: ctxOf(base(), four), purpose: "progress", tone: "professional", lang: "en", variant: 0 });
    expect(r.text).toContain("2 of 4");
    expect(r.text).toContain("Asha");
    expect(r.label).toBe(PROJECT_DEMO_LABEL);
  });
  it("missing client content is recommended first, from recorded items only", () => {
    const c = ctxOf(base({ dependencies: [{ id: "d", label: "Product photos", done: false }] }), four);
    expect(nextAction(c).kind).toBe("request_content");
    expect(demoClientUpdate({ ctx: c, purpose: "pending_content", tone: "short", lang: "hinglish", variant: 0 }).text).toContain("Product photos");
  });
  it("delay with no recorded reason does not blame the client", () => {
    const r = demoClientUpdate({ ctx: ctxOf(base(), four), purpose: "delay", tone: "professional", lang: "en", variant: 0 });
    expect(r.text).toContain("[reason]");
    expect(r.text.toLowerCase()).not.toContain("waiting");
  });
  it("milestone with no due date asks to confirm it", () => {
    const ms: ProjectMilestone[] = [{ id: "m1", projectId: "p1", title: "Design", order: 0 }, { id: "m2", projectId: "p1", title: "Build", order: 1 }];
    const t = [task("t1", "A", true, { milestoneId: "m1" }), task("t2", "B", true, { milestoneId: "m2" }), task("t3", "C", false, { milestoneId: "m2" })];
    expect(nextAction(ctxOf(base(), t, ms)).kind).toBe("confirm_milestone");
  });
  it("all tasks done with open handover → complete handover", () => {
    const c = ctxOf(base({ handover: [{ id: "h", label: "Share admin guide", done: false }] }), [task("t1", "A", true)]);
    expect(nextAction(c).kind).toBe("complete_handover");
  });
});

describe("AI-6A violation guard", () => {
  const c = ctxOf(base(), four);
  it.each([
    ["Hi Asha, your website is complete.", "complete"],
    ["Hi Asha, all tasks are completed.", "all tasks"],
    ["Hi Asha, payment received, thanks.", "payment"],
    ["Hi Asha, delivery is tomorrow.", "tomorrow"],
    ["Hi Asha, we'll give a 10% discount.", "discount"],
  ])("blocks %s", (text) => { expect(updateViolations(c, "", text).length).toBeGreaterThan(0); });
  it("accepts an honest generated draft and preserves ₹/URL/Hindi already in the Owner's draft", () => {
    const own = "Asha जी, ₹25,000 वाला पैकेज https://ex.in/a देखें";
    expect(updateViolations(c, own, own)).toEqual([]);
    const gen = demoClientUpdate({ ctx: c, purpose: "status", tone: "friendly", lang: "hi", variant: 1 }).text;
    expect(updateViolations(c, "", gen)).toEqual([]);
  });
});

describe("AI-6A requirements and task suggestions", () => {
  it("keeps recorded items separate and never adds deliverables", () => {
    const c = ctxOf(base({ scope: "5 page website" }));
    const s = structureRequirements("Goal: get more bookings\nContact form should send to WhatsApp\nClient will provide photos\nBlog maybe later?", c);
    expect(s.recorded).toEqual(["Agreed scope: 5 page website"]);
    expect(s.sections.objectives).toHaveLength(1);
    expect(s.sections.client).toHaveLength(1);
    expect(s.questions.some((q) => q.includes("Blog"))).toBe(true);
    expect(s.missing).toContain("No target delivery date is recorded.");
    const all = Object.values(s.sections).flat();
    expect(all).toHaveLength(4);
  });
  it("very long briefs are preserved and flagged as limited", () => {
    const s = structureRequirements("x ".repeat(3000), ctxOf(base()));
    expect(s.limited).toBe(true);
    expect(s.original.length).toBe(6000);
  });
  it("marks suggestions that duplicate existing tasks", () => {
    const c = ctxOf(base({ requirements: [{ id: "r", label: "Gallery page", done: false }, { id: "r2", label: "Payment gateway integration", done: false }] }), four);
    const s = suggestTasks(c).suggestions;
    expect(s.find((x) => x.title === "Gallery page")?.duplicateOf).toBe("Gallery page");
    expect(s.find((x) => x.title === "Payment gateway integration")?.duplicateOf).toBeUndefined();
    expect(findDuplicate("SEO setup for site", four)).toBe("SEO setup");
    expect(findDuplicate("5 page website with contact form", four)).toBeUndefined();
  });
  it("generation never mutates the input project or tasks", () => {
    const p = base({ requirements: [{ id: "r", label: "Logo", done: false }] });
    const snap = JSON.stringify([p, four]);
    const c = ctxOf(p, four);
    suggestTasks(c); nextAction(c); structureRequirements("a\nb", c); demoClientUpdate({ ctx: c, purpose: "status", tone: "short", lang: "en", variant: 0 });
    expect(JSON.stringify([p, four])).toBe(snap);
  });
});
