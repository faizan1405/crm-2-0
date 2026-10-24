import { describe, expect, it } from "vitest";
import { cardSignals, isStalled, stageSince, stageSummary } from "./pipeline";
import type { FollowUp, Lead, LeadActivity } from "./types";

const now = new Date("2026-10-23T08:00:00Z");
const lead = (p: Partial<Lead> = {}): Lead => ({ id: "l1", name: "A", phone: "9876543210", source: "Website", status: "contacted", priority: "warm", pinned: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", ...p });
const act = (at: string, type: LeadActivity["type"] = "status"): LeadActivity => ({ id: at, leadId: "l1", type, text: "", at });

describe("pipeline signals", () => {
  it("uses the latest recorded stage change as stage entry", () => expect(stageSince(lead(), [act("2026-10-10T00:00:00Z"), act("2026-10-15T00:00:00Z"), act("2026-10-20T00:00:00Z", "note")])).toBe("2026-10-15T00:00:00Z"));
  it("uses creation time only for a lead still in New", () => {
    expect(stageSince(lead({ status: "new" }), [])).toBe("2026-10-01T00:00:00Z");
    expect(stageSince(lead(), [])).toBeNull();
  });
  it("never reports an age or stall when stage entry is unknown", () => {
    const s = cardSignals(lead(), [], [], now);
    expect(s.days).toBeNull();
    expect(s.stalled).toBe(false);
  });
  it("flags contacted leads stalled after 7 days, never Won/Lost", () => {
    expect(isStalled("contacted", 7)).toBe(true);
    expect(isStalled("contacted", 6)).toBe(false);
    expect(isStalled("won", 99)).toBe(false);
  });
  it("marks overdue from the scheduled time", () => {
    const f: FollowUp = { id: "f", leadId: "l1", type: "call", dueAt: "2026-10-23T07:00:00Z" };
    expect(cardSignals(lead(), [], [f], now).overdue).toBe(true);
    expect(cardSignals(lead(), [], [{ ...f, completedAt: "x" }], now).overdue).toBe(false);
  });
  it("sums stage count and known value", () => {
    const s = stageSummary([lead({ quotedAmount: 30000 }), lead({ id: "l2", quotedAmount: 15000 }), lead({ id: "l3", status: "won", quotedAmount: 9 })], "contacted", [], [], now);
    expect(s).toMatchObject({ count: 2, value: 45000 });
  });
});

import { canUndoStage } from "./pipeline";
describe("stage undo conflict", () => {
  const applied = { status: "qualified" as const, updatedAt: "2026-10-24T09:00:00.000Z" };
  it("allows undo when nothing changed since the move", () => expect(canUndoStage({ ...applied }, applied)).toBe(true));
  it("blocks an older undo after a newer stage change", () => expect(canUndoStage({ status: "proposal", updatedAt: "2026-10-24T09:01:00.000Z" }, applied)).toBe(false));
  it("blocks an older undo after a newer edit in the same stage", () => expect(canUndoStage({ status: "qualified", updatedAt: "2026-10-24T09:02:00.000Z" }, applied)).toBe(false));
});
