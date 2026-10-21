import { describe, expect, it } from "vitest";
import { businessDateTime, inDateRange, rangeBounds, shiftDay } from "./dates";
describe("business calendar dates", () => {
  it("uses Kolkata today at the UTC day boundary", () => {
    expect(rangeBounds("today", "", "", new Date("2026-10-21T20:00:00Z"))).toEqual(["2026-10-22", "2026-10-22"]);
  });
  it("keeps seven calendar days across a year boundary", () => {
    expect(rangeBounds("7d", "", "", new Date("2026-01-03T10:00:00Z"))).toEqual(["2025-12-28", "2026-01-03"]);
  });
  it("keeps thirty calendar days and month start at rollover", () => {
    const now = new Date("2026-03-02T10:00:00Z");
    expect(rangeBounds("30d", "", "", now)).toEqual(["2026-02-01", "2026-03-02"]);
    expect(rangeBounds("month", "", "", now)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("includes endpoints and rejects reversed ranges", () => {
    expect(inDateRange("2026-10-21", "2026-10-21", "2026-10-21")).toBe(true);
    expect(inDateRange("2026-10-20", "2026-10-21", "2026-10-22")).toBe(false);
    expect(inDateRange("2026-10-21", "2026-10-22", "2026-10-21")).toBe(false);
  });
  it("interprets entered follow-up time as Kolkata on any device", () => {
    expect(businessDateTime("2026-10-21T15:30")).toBe("2026-10-21T10:00:00.000Z");
  });
});