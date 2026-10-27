import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { idbProofRepo as repo, friendlyStorageError } from "./proofRepo";
import { useCRM } from "./store";
import { financeSummary } from "./finance";
import { readBytes } from "./attachments";

const png = (tag: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag])], { type: "image/png" });
const bytes = async (b: Blob) => Array.from(new Uint8Array(await readBytes(b)));

describe("payment proof repository", () => {
  beforeEach(async () => { for (const m of await repo.list()) await repo.remove(m.paymentId); useCRM.getState().reset(); });

  it("stores a proof for one payment and never returns it for another", async () => {
    await repo.put("p1", png(1), "a.png", "image/png");
    await repo.put("p2", png(2), "b.png", "image/png");
    expect((await bytes((await repo.get("p1"))!.blob)).at(-1)).toBe(1);
    expect((await bytes((await repo.get("p2"))!.blob)).at(-1)).toBe(2);
    expect(await repo.get("p3")).toBeNull();
  });

  it("replacing keeps one proof per payment with the new file", async () => {
    const first = await repo.put("p1", png(1), "a.png", "image/png");
    const second = await repo.put("p1", png(9), "new.png", "image/png");
    expect((await repo.list()).filter((m) => m.paymentId === "p1")).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect((await repo.get("p1"))!.meta.originalFileName).toBe("new.png");
  });

  it("removing deletes only that payment's proof", async () => {
    await repo.put("p1", png(1), "a.png", "image/png");
    await repo.put("p2", png(2), "b.png", "image/png");
    await repo.remove("p1");
    expect(await repo.get("p1")).toBeNull();
    expect(await repo.get("p2")).not.toBeNull();
  });

  it("adding, replacing and removing proof leaves payments and totals untouched", async () => {
    const before = useCRM.getState().payments.map((p) => ({ ...p }));
    const fin = financeSummary(useCRM.getState().deals, useCRM.getState().payments);
    const id = before[0]!.id;
    await repo.put(id, png(1), "a.png", "image/png");
    await repo.put(id, png(2), "b.png", "image/png");
    await repo.remove(id);
    expect(useCRM.getState().payments).toEqual(before);
    expect(financeSummary(useCRM.getState().deals, useCRM.getState().payments)).toEqual(fin);
  });

  it("voiding a payment keeps its proof", async () => {
    const id = useCRM.getState().payments[0]!.id;
    await repo.put(id, png(1), "a.png", "image/png");
    useCRM.getState().voidPayment(id);
    expect(await repo.get(id)).not.toBeNull();
  });

  it("a new payment can take a pre-assigned id, which can't be reused", () => {
    const s = useCRM.getState();
    const deal = s.deals.find((d) => d.status !== "cancelled" && d.finalAmount > 100000) ?? s.deals[0]!;
    const pay = { dealId: deal.id, amount: 1, date: "2026-10-21", method: "UPI" as const, type: "advance" as const };
    const ok = s.addPayment(pay, "payment_fixed");
    if (ok) expect(useCRM.getState().addPayment(pay, "payment_fixed")).toBe(false);
    expect(useCRM.getState().payments.filter((p) => p.id === "payment_fixed").length).toBe(ok ? 1 : 0);
  });

  it("explains a full-storage error plainly", () => {
    expect(friendlyStorageError({ name: "QuotaExceededError" })).toMatch(/storage is full/);
  });
});

describe("E1.1B proofs during an employee preview", () => {
  it("never writes or removes files and hides proofs of payments outside the employee copy", async () => {
    const { useSession } = await import("./session");
    for (const m of await repo.list()) await repo.remove(m.paymentId);
    await repo.put("mine", png(1), "a.png", "image/png");
    await repo.put("other", png(2), "b.png", "image/png");
    useCRM.setState({ payments: [{ id: "mine", dealId: "d", amount: 1, date: "2026-10-01", method: "UPI", type: "advance" }] });
    useSession.setState({ preview: { employeeId: "e", name: "E", roleLabel: "S", allowed: [], leadScope: "assigned", finance: "amounts", startedAt: "" } });
    try {
      await expect(repo.put("mine", png(9), "x.png", "image/png")).rejects.toThrow(/employee preview/);
      await expect(repo.remove("mine")).rejects.toThrow(/employee preview/);
      expect((await repo.list()).map((m) => m.paymentId)).toEqual(["mine"]);
      expect(await repo.get("other")).toBeNull();
    } finally { useSession.setState({ preview: null }); }
    expect((await bytes((await repo.get("mine"))!.blob)).at(-1)).toBe(1);
    expect((await bytes((await repo.get("other"))!.blob)).at(-1)).toBe(2);
  });
});
