import { beforeEach, describe, expect, it } from "vitest";
import { useCRM, syncFromStorage } from "./store";
import { revisionOf, isStaleError, changedKeys, externalKeys, rebaseDraft } from "./crossTab";
import { startPreview, exitPreview } from "./preview";

const KEY = "scale-flow-crm-2-demo";
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
/** Simulates Tab A: changes the shared saved blob directly, the way another tab's save would. */
function otherTabSaves(mut: (s: Record<string, any>) => void) {
  const blob = saved(); mut(blob.state); localStorage.setItem(KEY, JSON.stringify(blob));
}
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };

beforeEach(() => {
  localStorage.clear(); useCRM.getState().reset();
  // make sure something is saved so both "tabs" share one blob
  useCRM.getState().addActivity(useCRM.getState().leads[0]!.id, "seed", "note");
  useCRM.getState().addEmployee({ name: "D221 Emp", email: "d221@example.com", roleId: "sales", accountStatus: "active" } as never);
});

describe("D2.2.1 multi-tab safety", () => {
  it("a stale editor's save is rejected, writes nothing and keeps the other tab's phone", () => {
    const l = useCRM.getState().leads[0]!; const base = revisionOf(l);
    otherTabSaves((s) => { const x = s.leads.find((y: { id: string }) => y.id === l.id); x.phone = "9111122222"; x.updatedAt = "2099-01-01T00:00:00.000Z"; });
    const acts = saved().state.activities.length;
    const e = tryRun(() => useCRM.getState().updateLead(l.id, { priority: "cold" }, base));
    expect(isStaleError(e)).toBe(true);
    const after = saved().state.leads.find((y: { id: string }) => y.id === l.id);
    expect(after.phone).toBe("9111122222");
    expect(after.priority).toBe(l.priority);
    expect(saved().state.activities.length).toBe(acts); // no fake activity
  });
  it("independent edits to two different leads both persist (no stale whole-collection overwrite)", () => {
    const [a, b] = useCRM.getState().leads;
    otherTabSaves((s) => { s.leads.find((y: { id: string }) => y.id === a!.id).company = "Tab A Co"; });
    useCRM.getState().updateLead(b!.id, { company: "Tab B Co" });
    const st = saved().state;
    expect(st.leads.find((y: { id: string }) => y.id === a!.id).company).toBe("Tab A Co");
    expect(st.leads.find((y: { id: string }) => y.id === b!.id).company).toBe("Tab B Co");
  });
  it("a lead created in another tab survives a new lead created here", () => {
    otherTabSaves((s) => { s.leads.unshift({ ...s.leads[0], id: "lead_tabA", phone: "9000000001", name: "From Tab A" }); });
    const id = useCRM.getState().addLead({ name: "From Tab B", phone: "9000000002", source: "Other", status: "new", priority: "warm", pinned: false });
    const ids = saved().state.leads.map((y: { id: string }) => y.id);
    expect(ids).toContain("lead_tabA"); expect(ids).toContain(id);
    expect(ids.filter((x: string) => x === "lead_tabA")).toHaveLength(1);
  });
  it("an assignment from a stale tab keeps the other tab's assignment of a different lead", () => {
    const [a, b] = useCRM.getState().leads; const emp = useCRM.getState().employees[0]!;
    otherTabSaves((s) => { s.assignments[a!.id] = { employeeId: emp.id, assignedAt: "2026-10-27T00:00:00Z", source: "Tab A", manual: true }; });
    useCRM.getState().assignLeads([b!.id], emp.id, "Tab B");
    const asg = saved().state.assignments;
    expect(asg[a!.id]?.source).toBe("Tab A"); expect(asg[b!.id]?.employeeId).toBe(emp.id);
  });
  it("syncing another tab's save creates no Team Activity events here", () => {
    const ev = useCRM.getState().teamEvents.length;
    otherTabSaves((s) => { s.leads[0].company = "Synced"; });
    expect(syncFromStorage()).toBe(true);
    expect(useCRM.getState().leads[0]!.company).toBe("Synced");
    expect(useCRM.getState().teamEvents.length).toBe(ev);
    expect(syncFromStorage()).toBe(false); // nothing new
  });
  it("preview never loads or writes Owner storage, and exit shows the other tab's newer save", () => {
    const emp = useCRM.getState().employees[0]!;
    startPreview(emp);
    otherTabSaves((s) => { s.leads[0].company = "Owner Tab"; });
    const raw = localStorage.getItem(KEY);
    expect(syncFromStorage()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(raw);
    exitPreview();
    expect(useCRM.getState().leads[0]!.company).toBe("Owner Tab");
  });
  it("draft helpers: only typed fields are sent; keep-my-draft takes newer untouched values", () => {
    const start = { phone: "1", priority: "warm", notes: "" }, latest = { phone: "2", priority: "warm", notes: "" }, draft = { phone: "1", priority: "hot", notes: "" };
    expect(changedKeys(start, draft)).toEqual(["priority"]);
    expect(externalKeys(start, latest)).toEqual(["phone"]);
    expect(rebaseDraft(start, draft, latest)).toEqual({ phone: "2", priority: "hot", notes: "" });
  });
});
