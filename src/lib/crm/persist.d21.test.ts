import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCRM } from "./store";
import { financeSummary } from "./finance";
import { getPersistStatus, isPersistError, categorySizes, measureStorage, resetPersistStatus } from "./persistStatus";
import { createAutosaver } from "./autosave";
import { draftFromDeal, starterTemplates } from "./projects";

const KEY = "scale-flow-crm-2-demo";
const quota = () => { const e = new Error("full"); e.name = "QuotaExceededError"; return e; };
let failing = false;
const orig = Storage.prototype.setItem;
beforeEach(() => {
  failing = false; localStorage.clear(); useCRM.getState().reset(); resetPersistStatus();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) { if (failing) throw quota(); return orig.call(this, k, v); });
});
afterEach(() => vi.restoreAllMocks());
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "{}").state;
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };
const lead = { name: "D21 Lead", phone: "9000021021", source: "Other" as const, status: "new" as const, priority: "warm" as const, pinned: false };

describe("D2.1 storage-failure safety", () => {
  it("failed Lead save throws PersistError, keeps memory and storage unchanged, and retry adds exactly one lead", () => {
    const n = useCRM.getState().leads.length, acts = useCRM.getState().activities.length, events = useCRM.getState().teamEvents.length;
    failing = true;
    const e = tryRun(() => useCRM.getState().addLead(lead));
    expect(isPersistError(e)).toBe(true);
    expect((e as { quota: boolean }).quota).toBe(true);
    expect(useCRM.getState().leads.length).toBe(n);
    expect(useCRM.getState().activities.length).toBe(acts);
    expect(useCRM.getState().teamEvents.length).toBe(events);
    expect(saved().leads.some((l: { name: string }) => l.name === "D21 Lead")).toBe(false);
    expect(getPersistStatus().lastOk).toBe(false);
    failing = false;
    useCRM.getState().addLead(lead);
    expect(useCRM.getState().leads.filter((l) => l.name === "D21 Lead")).toHaveLength(1);
    expect(saved().leads.filter((l: { name: string }) => l.name === "D21 Lead")).toHaveLength(1);
    expect(getPersistStatus().lastOk).toBe(true);
  });
  it("failed Payment save does not change totals, payments or events", () => {
    useCRM.setState({ deals: [], payments: [] });
    useCRM.getState().addDeal({ clientType: "other", clientName: "D21", name: "D21 deal", quotedAmount: 1000, finalAmount: 1000, status: "active", milestones: [] });
    const deal = useCRM.getState().deals[0]!;
    const ev = useCRM.getState().teamEvents.length;
    failing = true;
    expect(isPersistError(tryRun(() => useCRM.getState().addPayment({ dealId: deal.id, amount: 400, date: "2026-10-21", method: "UPI", type: "advance" })))).toBe(true);
    expect(useCRM.getState().payments).toHaveLength(0);
    expect(financeSummary(useCRM.getState().deals, useCRM.getState().payments).collected).toBe(0);
    expect(useCRM.getState().teamEvents.length).toBe(ev);
    failing = false;
    expect(useCRM.getState().addPayment({ dealId: deal.id, amount: 400, date: "2026-10-21", method: "UPI", type: "advance" })).toBe(true);
    expect(useCRM.getState().payments).toHaveLength(1);
    expect(saved().payments).toHaveLength(1);
  });
  it("failed Project task update leaves the saved project task unchanged", () => {
    const deal = useCRM.getState().deals[0]!;
    const p = useCRM.getState().createProject(draftFromDeal({ deal, template: starterTemplates("2026-10-01T00:00:00Z")[0]! }));
    if (!p.ok) throw new Error(p.error);
    const r = useCRM.getState().addTask(p.id, { title: "D21 task" } as never);
    if (!r.ok) throw new Error("task not created");
    failing = true;
    expect(isPersistError(tryRun(() => useCRM.getState().setTaskDone(r.id, true)))).toBe(true);
    expect(useCRM.getState().projectTasks.find((x) => x.id === r.id)?.status).toBe("open");
    expect(saved().projectTasks.find((x: { id: string }) => x.id === r.id)?.status).toBe("open");
    failing = false;
    expect(useCRM.getState().setTaskDone(r.id, true)).toBe(true);
    expect(saved().projectTasks.find((x: { id: string }) => x.id === r.id)?.status).not.toBe("open");
  });
  it("failed Note autosave reports error, keeps the pending content and keeps the old saved note", () => {
    const note = useCRM.getState().notes[0]!;
    const statuses: string[] = [];
    const saver = createAutosaver((v: string) => useCRM.getState().saveNote({ ...note, body: v }), (s) => statuses.push(s), 10);
    failing = true; saver.schedule("D21 unsaved text");
    expect(saver.flush()).toBe(false);
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasPending()).toBe(true);
    expect(useCRM.getState().notes.find((x) => x.id === note.id)?.body).toBe(note.body);
    failing = false; expect(saver.flush()).toBe(true);
    expect(saved().notes.find((x: { id: string }) => x.id === note.id)?.body).toBe("D21 unsaved text");
  });
  it("background automation runs roll back silently instead of throwing", () => {
    failing = true;
    expect(() => useCRM.getState().runAutomations({ manual: true })).not.toThrow();
    expect(getPersistStatus().lastOk === false || getPersistStatus().lastOk === null).toBe(true);
  });
  it("measures sizes by category without returning record values", () => {
    const json = JSON.stringify({ state: { leads: [{ name: "Secret" }], notes: [], theme: "dark" } });
    const cats = categorySizes(json);
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(["Leads", "Notes", "Settings & other"]));
    expect(JSON.stringify(cats)).not.toContain("Secret");
    expect(measureStorage({ length: 1, key: () => "ab", getItem: () => "cd" })).toEqual({ total: 8, keys: [{ key: "ab", bytes: 8 }] });
  });
});

import { recoveredFromFailure } from "./persistStatus";
describe("D2.1.1 stale failure notice", () => {
  it("clears the not-saved notice only when a save succeeds right after a failure", () => {
    expect(recoveredFromFailure(false, true)).toBe(true);
    expect(recoveredFromFailure(true, true)).toBe(false);
    expect(recoveredFromFailure(null, true)).toBe(false);
    expect(recoveredFromFailure(false, false)).toBe(false);
  });
});
