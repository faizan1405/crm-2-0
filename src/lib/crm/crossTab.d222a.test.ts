import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCRM } from "./store";
import { financeSummary, dealOutstanding } from "./finance";
import { isStaleError } from "./crossTab";
import { isPersistError } from "./persistStatus";
import { startPreview, exitPreview } from "./preview";

const KEY = "scale-flow-crm-2-demo";
const s = () => useCRM.getState();
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
/** Another tab's save: change the shared saved blob directly. */
function otherTab(mut: (st: any) => void) { const b = saved(); mut(b.state); localStorage.setItem(KEY, JSON.stringify(b)); }
const tryRun = (f: () => unknown) => { try { f(); return null; } catch (e) { return e; } };
const mkDeal = (name: string, amt: number) => { s().addDeal({ clientType: "other", clientName: name, name, quotedAmount: amt, finalAmount: amt, status: "active", milestones: [], leadId: s().leads[0]!.id } as never); return s().deals.find((d) => d.name === name)!; };
const pay = (dealId: string, amount: number, id: string) => ({ id, dealId, amount, date: "2026-10-27", method: "UPI", type: "advance" });

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); s().reset();
  useCRM.setState({ deals: [], payments: [], followUps: [] });
  s().addActivity(s().leads[0]!.id, "seed", "note"); // shared saved blob exists
});
afterEach(() => vi.restoreAllMocks());

describe("D2.2.2A finance across tabs", () => {
  it("two different payments from two tabs both survive: ₹4,000 + ₹16,000 on a ₹40,000 deal", () => {
    const d = mkDeal("D222 Deal A", 40000);
    otherTab((st) => { st.payments.unshift(pay(d.id, 4000, "pay_tabA")); });
    expect(s().addPayment({ dealId: d.id, amount: 16000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_tabB")).toBe(true);
    const st = saved().state;
    expect(st.payments.map((p: { id: string }) => p.id).sort()).toEqual(["pay_tabA", "pay_tabB"]);
    const f = financeSummary(st.deals, st.payments);
    expect(f.collected).toBe(20000);
    expect(dealOutstanding(st.deals[0], st.payments)).toBe(20000);
  });
  it("voiding the same payment twice voids once, with one history entry and one total change", () => {
    const d = mkDeal("D222 Void", 40000);
    s().addPayment({ dealId: d.id, amount: 4000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_v");
    const acts = () => saved().state.activities.filter((a: { text: string }) => a.text.includes("voided")).length;
    otherTab((st) => { st.payments.find((p: { id: string }) => p.id === "pay_v").voided = true; st.activities.unshift({ id: "a_tabA", leadId: d.leadId, type: "payment", text: "Payment of ₹4,000 voided", at: "2026-10-27T06:00:00Z" }); });
    expect(s().voidPayment("pay_v")).toBe("already");
    expect(acts()).toBe(1);
    expect(saved().state.payments.find((p: { id: string }) => p.id === "pay_v").voided).toBe(true);
    expect(financeSummary(saved().state.deals, saved().state.payments).collected).toBe(0);
  });
  it("a stale payment that would exceed the newer balance is rejected with no history", () => {
    const d = mkDeal("D222 Stale", 40000);
    otherTab((st) => { st.payments.unshift(pay(d.id, 30000, "pay_big")); });
    const acts = saved().state.activities.length;
    expect(s().addPayment({ dealId: d.id, amount: 16000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_stale")).toBe(false);
    expect(saved().state.payments.map((p: { id: string }) => p.id)).toEqual(["pay_big"]);
    expect(saved().state.activities.length).toBe(acts);
  });
  it("payments on two separate deals from two tabs keep both deals and payments", () => {
    const a = mkDeal("D222 A", 10000), b = mkDeal("D222 B", 20000);
    otherTab((st) => { st.payments.unshift(pay(a.id, 1000, "pay_a")); });
    s().addPayment({ dealId: b.id, amount: 2000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_b");
    const st = saved().state;
    expect(st.deals).toHaveLength(2);
    expect(st.payments.map((p: { id: string; dealId: string }) => `${p.id}>${p.dealId}`).sort()).toEqual([`pay_a>${a.id}`, `pay_b>${b.id}`]);
    expect(financeSummary(st.deals, st.payments).collected).toBe(3000);
  });
  it("void still respects storage failures: nothing voided, error thrown", () => {
    const d = mkDeal("D222 Q", 5000);
    s().addPayment({ dealId: d.id, amount: 1000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_q");
    const orig = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) { if (k === KEY) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; } return orig.call(this, k, v); });
    expect(isPersistError(tryRun(() => s().voidPayment("pay_q")))).toBe(true);
    expect(s().payments.find((p) => p.id === "pay_q")!.voided).toBeFalsy();
  });
  it("an employee without Finance access cannot void a payment from a preview tab", () => {
    const d = mkDeal("D222 Perm", 5000);
    s().addPayment({ dealId: d.id, amount: 1000, date: "2026-10-27", method: "UPI", type: "advance" }, "pay_p");
    const r = s().addEmployee({ name: "D222 Emp", email: "d222@example.com", roleId: "salesperson", accountStatus: "active" } as never);
    if (!r.ok) throw new Error(r.error);
    const raw = localStorage.getItem(KEY);
    startPreview(s().employees.find((e) => e.id === r.id)!);
    expect(s().voidPayment("pay_p")).toBeUndefined();
    exitPreview();
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(s().payments.find((p) => p.id === "pay_p")!.voided).toBeFalsy();
  });
});

describe("D2.2.2A follow-ups across tabs", () => {
  const lead = () => s().leads[0]!;
  const mkFu = (leadId = lead().id) => { const r = s().addFollowUp({ leadId, type: "call", dueAt: "2026-10-28T05:30:00.000Z" }); if (!r.ok) throw new Error("no fu"); return r.id!; };
  it("completing a stale follow-up after another tab rescheduled it is rejected and keeps the new time", () => {
    const id = mkFu();
    otherTab((st) => { st.followUps.find((f: { id: string }) => f.id === id).dueAt = "2026-10-29T08:30:00.000Z"; });
    const acts = saved().state.activities.length;
    const e = tryRun(() => s().completeFollowUp(id, "2026-10-28T05:30:00.000Z"));
    expect(isStaleError(e)).toBe(true);
    const f = saved().state.followUps.find((x: { id: string }) => x.id === id);
    expect(f.dueAt).toBe("2026-10-29T08:30:00.000Z"); expect(f.completedAt).toBeUndefined();
    expect(saved().state.activities.length).toBe(acts);
  });
  it("a second reschedule from the old version is rejected (no lost update)", () => {
    const id = mkFu();
    otherTab((st) => { st.followUps.find((f: { id: string }) => f.id === id).dueAt = "2026-10-29T08:30:00.000Z"; });
    expect(isStaleError(tryRun(() => s().rescheduleFollowUp(id, "2026-10-30T04:30:00.000Z", "2026-10-28T05:30:00.000Z")))).toBe(true);
    expect(saved().state.followUps.find((x: { id: string }) => x.id === id).dueAt).toBe("2026-10-29T08:30:00.000Z");
    // deliberate replacement from the latest version is allowed
    expect(s().rescheduleFollowUp(id, "2026-10-30T04:30:00.000Z", "2026-10-29T08:30:00.000Z")).toBe("rescheduled");
  });
  it("double completion completes once with one history entry and one Team Activity event", () => {
    const id = mkFu();
    const ev0 = s().teamEvents.filter((e) => e.type === "followup.completed").length;
    expect(s().completeFollowUp(id, "2026-10-28T05:30:00.000Z")).toBe("completed");
    expect(s().completeFollowUp(id, "2026-10-28T05:30:00.000Z")).toBe("already");
    expect(saved().state.activities.filter((a: { text: string }) => a.text.startsWith("Follow-up completed")).length).toBe(1);
    expect(s().teamEvents.filter((e) => e.type === "followup.completed").length - ev0).toBe(1);
  });
  it("two different follow-ups edited from two tabs both persist and the lead summary follows", () => {
    const a = mkFu(s().leads[0]!.id), b = mkFu(s().leads[1]!.id);
    otherTab((st) => { st.followUps.find((f: { id: string }) => f.id === a).dueAt = "2026-11-01T05:30:00.000Z"; });
    expect(s().rescheduleFollowUp(b, "2026-11-02T05:30:00.000Z", "2026-10-28T05:30:00.000Z")).toBe("rescheduled");
    const st = saved().state;
    expect(st.followUps.find((f: { id: string }) => f.id === a).dueAt).toBe("2026-11-01T05:30:00.000Z");
    expect(st.followUps.find((f: { id: string }) => f.id === b).dueAt).toBe("2026-11-02T05:30:00.000Z");
    expect(st.leads.find((l: { id: string }) => l.id === s().leads[1]!.id).nextFollowUp).toBe("2026-11-02T05:30:00.000Z");
  });
});
