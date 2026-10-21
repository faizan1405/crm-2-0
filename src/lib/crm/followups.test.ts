import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useCRM } from "./store";
import { suggestFollowUp, suggestAll, activeFollowUp, nextSlot, isPending } from "./followups";
import { buildPriorities } from "./insights";
import type { Lead } from "./types";

const now = new Date("2026-10-21T06:30:00Z"); // 12:00 IST
const L = (o: Partial<Lead> = {}): Lead => ({ id: "l1", name: "Rahul Verma", phone: "9876500000", source: "Other", status: "contacted", priority: "warm", pinned: false, createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-19T06:00:00Z", lastContact: "2026-10-19T06:00:00Z", ...o });
const S = () => useCRM.getState();
const lead0 = () => S().leads[0]!;
const call = (o: Partial<Parameters<ReturnType<typeof S>["logCall"]>[0]> = {}) => S().logCall({ opId: o.opId ?? "op-1", leadId: lead0().id, outcome: "Connected", notes: "Discussed pricing", stage: lead0().status, source: "Test", ...o });

beforeEach(() => { localStorage.clear(); S().reset(); useCRM.setState({ followUps: [] }); });
afterEach(() => vi.useRealTimers());

describe("smart follow-up suggestions", () => {
  it("contacted two days ago with no plan → WhatsApp tomorrow 11:00 with reason", () => {
    const s = suggestFollowUp(L(), [], [], now)!;
    expect(s.at).toBe("2026-10-22T11:00");
    expect(s.reason).toBe("Rahul was contacted 2 days ago and has no upcoming follow-up.");
  });
  it("by stage: new → call today next hour, qualified → meeting, proposal → quotation check", () => {
    expect(suggestFollowUp(L({ status: "new" }), [], [], now)).toMatchObject({ type: "call", at: "2026-10-21T13:00", action: "First contact" });
    expect(suggestFollowUp(L({ status: "qualified" }), [], [], now)).toMatchObject({ type: "meeting", action: "Proposal discussion" });
    expect(suggestFollowUp(L({ status: "proposal" }), [], [], now)?.action).toBe("Check quotation");
  });
  it("won and lost leads get no suggestion; a future follow-up means no suggestion", () => {
    expect(suggestFollowUp(L({ status: "won" }), [], [], now)).toBeNull();
    expect(suggestFollowUp(L({ status: "lost" }), [], [], now)).toBeNull();
    expect(suggestFollowUp(L(), [{ id: "f", leadId: "l1", type: "call", dueAt: "2026-10-22T05:30:00Z" }], [], now)).toBeNull();
  });
  it("overdue follow-up → urgent reschedule of that same follow-up", () => {
    const s = suggestFollowUp(L(), [{ id: "f", leadId: "l1", type: "call", dueAt: "2026-10-20T05:30:00Z" }], [], now)!;
    expect(s).toMatchObject({ urgent: true, rescheduleId: "f" });
  });
  it("last outcome drives retry timing: not picked, busy, call back later", () => {
    const act = (outcome: string) => [{ id: "a", leadId: "l1", type: "call" as const, text: "", outcome, at: "2026-10-21T06:00:00Z" }];
    expect(suggestFollowUp(L(), [], act("Not picked"), now)?.at).toBe("2026-10-21T14:00");
    expect(suggestFollowUp(L(), [], act("Busy"), now)?.at).toBe("2026-10-21T18:00");
    expect(suggestFollowUp(L(), [], act("Call back later"), now)?.at).toBe("2026-10-22T11:00");
  });
  it("IST boundaries: 23:00 IST on the 21st rolls to the 22nd at 11:00, and 05:00 IST stays on the same day", () => {
    expect(nextSlot(new Date("2026-10-21T17:30:00Z"))).toBe("2026-10-22T11:00");
    expect(nextSlot(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21T10:00");
  });
  it("wasted and deleted leads are excluded from suggestions", () => {
    const id = lead0().id; S().wasteLead(id);
    expect(suggestAll(S().leads, S().followUps, S().activities, now).some((s) => s.leadId === id)).toBe(false);
  });
});

describe("one active follow-up per lead", () => {
  it("detects an existing pending follow-up and returns it as a conflict", () => {
    const id = lead0().id;
    expect(S().addFollowUp({ leadId: id, type: "call", dueAt: "2026-10-22T05:30:00Z" }).ok).toBe(true);
    const r = S().addFollowUp({ leadId: id, type: "email", dueAt: "2026-10-23T05:30:00Z" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.conflict?.type).toBe("call");
    expect(S().followUps.length).toBe(1);
  });
  it("replace cancels the old one (kept in history) and keeps exactly one active", () => {
    const id = lead0().id;
    const a = S().addFollowUp({ leadId: id, type: "call", dueAt: "2026-10-22T05:30:00Z" }); if (!a.ok) throw 0;
    expect(S().addFollowUp({ leadId: id, type: "email", dueAt: "2026-10-23T05:30:00Z" }, { replaceId: a.id }).ok).toBe(true);
    expect(S().followUps.length).toBe(2);
    expect(S().followUps.filter(isPending).length).toBe(1);
    expect(activeFollowUp(S().followUps, id)?.type).toBe("email");
    expect(S().followUps.find((f) => f.id === a.id)?.cancelledAt).toBeDefined();
    expect(lead0().nextFollowUp).toBe("2026-10-23T05:30:00Z");
  });
  it("two different leads at the same time are not a conflict", () => {
    const [a, b] = S().leads;
    expect(S().addFollowUp({ leadId: a!.id, type: "call", dueAt: "2026-10-22T05:30:00Z" }).ok).toBe(true);
    expect(S().addFollowUp({ leadId: b!.id, type: "call", dueAt: "2026-10-22T05:30:00Z" }).ok).toBe(true);
  });
  it("double-clicking save with the same operation id creates one follow-up", () => {
    const id = lead0().id;
    const f = { leadId: id, type: "call" as const, dueAt: "2026-10-22T05:30:00Z", opId: "dbl" };
    S().addFollowUp(f); S().addFollowUp(f);
    expect(S().followUps.length).toBe(1);
  });
});

describe("call log save and undo", () => {
  it("saves outcome with notes on the timeline; Not picked does not count as contact", () => {
    const before = lead0().lastContact;
    expect(call({ outcome: "Not picked", notes: "No answer" }).ok).toBe(true);
    expect(S().activities[0]).toMatchObject({ type: "call", outcome: "Not picked", text: "Call attempt (Test): Not picked — No answer" });
    expect(lead0().lastContact).toBe(before);
    expect(lead0().quickStatus).toBe("not_picked");
  });
  it("saves with a follow-up that appears in the follow-ups workspace and repeated submit is ignored", () => {
    const fu = { dueAt: "2026-10-22T05:30:00Z", type: "call" as const };
    call({ followUp: fu }); call({ followUp: fu });
    expect(S().followUps.filter((f) => f.leadId === lead0().id && isPending(f)).length).toBe(1);
    expect(S().callOps.length).toBe(1);
    expect(lead0().nextFollowUp).toBe("2026-10-22T05:30:00Z");
  });
  it("asks about conflicts, and 'keep' leaves the existing follow-up untouched", () => {
    S().addFollowUp({ leadId: lead0().id, type: "meeting", dueAt: "2026-10-24T05:30:00Z" });
    const fu = { dueAt: "2026-10-22T05:30:00Z", type: "call" as const };
    expect(call({ followUp: fu }).ok).toBe(false);
    expect(call({ followUp: fu, onConflict: "keep" }).ok).toBe(true);
    expect(activeFollowUp(S().followUps, lead0().id)?.type).toBe("meeting");
  });
  it("undo reverses stage, quick status, follow-up, replaced follow-up and the call note only", () => {
    const l = lead0();
    S().addActivity(l.id, "Older unrelated note");
    const old = S().addFollowUp({ leadId: l.id, type: "meeting", dueAt: "2026-10-24T05:30:00Z" }); if (!old.ok) throw 0;
    call({ outcome: "Qualified", stage: "qualified", followUp: { dueAt: "2026-10-22T05:30:00Z", type: "call" }, onConflict: "replace" });
    expect(lead0().status).toBe("qualified");
    expect(S().undoCall("op-1")).toBeUndefined();
    expect(lead0().status).toBe(l.status);
    expect(lead0().quickStatus).toBe(l.quickStatus);
    expect(activeFollowUp(S().followUps, l.id)?.id).toBe(old.id);
    expect(S().activities.some((a) => a.opId === "op-1")).toBe(false);
    expect(S().activities.some((a) => a.text === "Older unrelated note")).toBe(true);
    expect(S().undoCall("op-1")).toBeUndefined(); // double undo is a no-op
    expect(lead0().status).toBe(l.status);
  });
  it("undo is refused with an explanation when the lead changed afterwards", () => {
    call({ outcome: "Qualified", stage: "qualified" });
    S().updateLead(lead0().id, { status: "proposal" });
    expect(S().undoCall("op-1")).toMatch(/changed after this call/);
    expect(lead0().status).toBe("proposal");
  });
  it("undo is refused when the call's follow-up was completed later", () => {
    call({ followUp: { dueAt: "2026-10-22T05:30:00Z", type: "call" } });
    const f = activeFollowUp(S().followUps, lead0().id)!; S().completeFollowUp(f.id);
    expect(S().undoCall("op-1")).toMatch(/changed after|already completed/);
  });
  it("lost requires a reason; won saves after confirmation", () => {
    expect(call({ outcome: "Lost", stage: "lost" }).ok).toBe(false);
    expect(lead0().status).not.toBe("lost");
    expect(call({ opId: "op-2", outcome: "Won", stage: "won" }).ok).toBe(true);
    expect(lead0().status).toBe("won");
  });
  it("call ops and follow-ups survive a refresh (rehydration)", async () => {
    call({ followUp: { dueAt: "2026-10-22T05:30:00Z", type: "call" } });
    const saved = localStorage.getItem("scale-flow-crm-2-demo")!;
    useCRM.setState({ callOps: [], followUps: [] });
    localStorage.setItem("scale-flow-crm-2-demo", saved);
    await useCRM.persist.rehydrate();
    expect(S().callOps[0]?.id).toBe("op-1");
    expect(activeFollowUp(S().followUps, lead0().id)).toBeDefined();
  });
  it("dashboard/briefing priorities ignore replaced follow-ups", () => {
    const id = lead0().id;
    const a = S().addFollowUp({ leadId: id, type: "call", dueAt: "2026-10-20T05:30:00Z" }); if (!a.ok) throw 0;
    S().addFollowUp({ leadId: id, type: "call", dueAt: "2026-10-25T05:30:00Z" }, { replaceId: a.id });
    expect(buildPriorities(S().leads, S().followUps, now).some((p) => p.key?.includes(a.id))).toBe(false);
  });
});
