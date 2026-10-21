import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { reviewBulk, mergePatch, staleDays } from "./leadtools";
import type { Lead } from "./types";

beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); });
const lead = (o: Partial<Lead> = {}): Lead => ({ id: "x", name: "A", phone: "9876543210", source: "Other", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...o });
const now = new Date("2026-10-21T10:00:00Z");

describe("Advanced lead management rules", () => {
  it("bulk review flags new, existing duplicate, in-batch duplicate and invalid rows", () => {
    const existing = useCRM.getState().leads[0]!;
    const rows = reviewBulk(`Ravi Kumar, 9123456780\nOld Client, ${existing.phone}\nRavi Again, 9123456780\nNo Phone Person`, useCRM.getState().leads);
    expect(rows.map((r) => r.state)).toEqual(["new", "duplicate", "batch_duplicate", "invalid"]);
    expect(rows[1]!.existingId).toBe(existing.id);
  });
  it("merge fills only empty fields and never overwrites in fill mode", () => {
    const p = mergePatch(lead({ company: "Keep Co" }), { company: "New Co", email: "a@b.co", notes: "extra" }, "fill");
    expect(p).toEqual({ email: "a@b.co", notes: "extra" });
    expect(mergePatch(lead({ company: "Keep Co" }), { company: "New Co", notes: "" }, "overwrite").company).toBe("New Co");
  });
  it("a lead is stale after 7 quiet days unless it has an upcoming follow-up or is closed", () => {
    expect(staleDays(lead({ updatedAt: "2026-10-14T09:00:00Z", createdAt: "2026-10-14T09:00:00Z" }), now)).toBe(7);
    expect(staleDays(lead({ updatedAt: "2026-10-15T11:00:00Z", createdAt: "2026-10-15T11:00:00Z" }), now)).toBeUndefined();
    expect(staleDays(lead({ nextFollowUp: "2026-10-25T10:00:00Z" }), now)).toBeUndefined();
    expect(staleDays(lead({ status: "won" }), now)).toBeUndefined();
  });
  it("waste and delete remove the lead with its follow-ups, and restore brings both back", () => {
    const l = useCRM.getState().leads.find((x) => useCRM.getState().followUps.some((f) => f.leadId === x.id))!;
    const fuCount = useCRM.getState().followUps.filter((f) => f.leadId === l.id).length;
    useCRM.getState().wasteLead(l.id, "Spam");
    expect(useCRM.getState().leads.some((x) => x.id === l.id)).toBe(false);
    expect(useCRM.getState().followUps.some((f) => f.leadId === l.id)).toBe(false);
    const entry = useCRM.getState().bin[0]!;
    expect(entry.kind).toBe("waste");
    expect(useCRM.getState().restoreLead(entry.id)).toBeUndefined();
    expect(useCRM.getState().followUps.filter((f) => f.leadId === l.id).length).toBe(fuCount);
    expect(useCRM.getState().bin).toEqual([]);
  });
  it("restore is refused when an active lead now has the same phone", () => {
    const l = useCRM.getState().leads[0]!;
    useCRM.getState().deleteLead(l.id);
    useCRM.getState().addLead({ name: "Taker", phone: l.phone, source: "Other", status: "new", priority: "warm", pinned: false });
    expect(useCRM.getState().restoreLead(useCRM.getState().bin[0]!.id)).toMatch(/already uses/);
    expect(useCRM.getState().bin.length).toBe(1);
  });
  it("quick status changes do not move the pipeline stage and are logged", () => {
    const l = useCRM.getState().leads[0]!;
    useCRM.getState().setQuickStatus(l.id, "callback");
    const after = useCRM.getState().leads[0]!;
    expect(after.quickStatus).toBe("callback");
    expect(after.status).toBe(l.status);
    expect(useCRM.getState().activities[0]!.text).toBe("Quick status: Call back");
  });
});
