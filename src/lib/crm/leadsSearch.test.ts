import { describe, expect, it } from "vitest";
import { parseLeadsSearch, matchesCreatedRange, countByStage } from "./leadsSearch";

describe("Analytics → Prospects drill-down", () => {
  it("keeps valid date range and source, drops malformed dates", () => {
    expect(parseLeadsSearch({ from: "2026-10-01", to: "2026-10-31", src: "Meta Ads" })).toEqual({ from: "2026-10-01", to: "2026-10-31", src: "Meta Ads" });
    expect(parseLeadsSearch({ from: "1 Oct", to: 5 })).toEqual({});
  });
  it("range is inclusive on both ends and source must match", () => {
    const q = { from: "2026-10-01", to: "2026-10-31", src: "Meta Ads" };
    expect(matchesCreatedRange("2026-10-01", "Meta Ads", q)).toBe(true);
    expect(matchesCreatedRange("2026-10-31", "Meta Ads", q)).toBe(true);
    expect(matchesCreatedRange("2026-11-01", "Meta Ads", q)).toBe(false);
    expect(matchesCreatedRange("2026-10-10", "Referral", q)).toBe(false);
  });
});

describe("Prospects stage counts", () => {
  it("count only the filtered set, per stage", () => {
    const set = [{ status: "new" }, { status: "new" }, { status: "won" }];
    expect(countByStage(set)).toEqual({ all: 3, new: 2, won: 1 });
    expect(countByStage([])).toEqual({ all: 0 });
  });
});
