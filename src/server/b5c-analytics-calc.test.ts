import { describe, expect, it } from "vitest";
import {
  bucketOf,
  buckets,
  defaultGranularity,
  getIstDay,
  getIstUtcRange,
  isBusyCallOutcome,
  isCountedWonDealStatus,
  isDayInWindow,
  isNoAnswerCallOutcome,
  median,
  monthEnd,
  monthStart,
  quarterStart,
  rate,
  resolveAnalyticsWindow,
  shiftDay,
  weekStart,
  windowDays,
} from "./crm/analyticsCalc.server";

describe("B5C Analytics Calculations & IST Date Rules", () => {
  const referenceDate = new Date("2026-11-10T14:30:00.000+05:30"); // Tuesday Nov 10, 2026

  it("converts Date to IST day key YYYY-MM-DD", () => {
    expect(getIstDay(referenceDate)).toBe("2026-11-10");
    // UTC 2026-11-09T18:31:00Z is 2026-11-10T00:01:00+05:30 in India
    expect(getIstDay(new Date("2026-11-09T18:31:00.000Z"))).toBe("2026-11-10");
    // UTC 2026-11-09T18:29:00Z is 2026-11-09T23:59:00+05:30 in India
    expect(getIstDay(new Date("2026-11-09T18:29:00.000Z"))).toBe("2026-11-09");
  });

  it("shifts days across month and year boundaries", () => {
    expect(shiftDay("2026-11-10", 1)).toBe("2026-11-11");
    expect(shiftDay("2026-11-10", -1)).toBe("2026-11-09");
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("calculates Monday weekStart correctly", () => {
    // 2026-11-10 is Tuesday -> Monday is 2026-11-09
    expect(weekStart("2026-11-10")).toBe("2026-11-09");
    // 2026-11-09 is Monday -> Monday is 2026-11-09
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    // 2026-11-15 is Sunday -> Monday is 2026-11-09
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });

  it("handles monthStart and monthEnd with leap years", () => {
    expect(monthStart("2026-11-10")).toBe("2026-11-01");
    expect(monthEnd("2026-11-10")).toBe("2026-11-30");
    // Non-leap year Feb 2026 -> 28 days
    expect(monthEnd("2026-02-14")).toBe("2026-02-28");
    // Leap year Feb 2024 -> 29 days
    expect(monthEnd("2024-02-14")).toBe("2024-02-29");
  });

  it("calculates quarterStart correctly", () => {
    expect(quarterStart("2026-11-10")).toBe("2026-10-01"); // Q4
    expect(quarterStart("2026-01-15")).toBe("2026-01-01"); // Q1
    expect(quarterStart("2026-05-20")).toBe("2026-04-01"); // Q2
    expect(quarterStart("2026-08-05")).toBe("2026-07-01"); // Q3
  });

  it("resolves analytics windows correctly for all period presets", () => {
    expect(resolveAnalyticsWindow("today", referenceDate)).toEqual({
      start: "2026-11-10",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("yesterday", referenceDate)).toEqual({
      start: "2026-11-09",
      end: "2026-11-09",
    });
    expect(resolveAnalyticsWindow("7d", referenceDate)).toEqual({
      start: "2026-11-04",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("30d", referenceDate)).toEqual({
      start: "2026-10-12",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("thisWeek", referenceDate)).toEqual({
      start: "2026-11-09",
      end: "2026-11-15",
    });
    expect(resolveAnalyticsWindow("lastWeek", referenceDate)).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
    });
    expect(resolveAnalyticsWindow("thisMonth", referenceDate)).toEqual({
      start: "2026-11-01",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("lastMonth", referenceDate)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(resolveAnalyticsWindow("thisQuarter", referenceDate)).toEqual({
      start: "2026-10-01",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("thisYear", referenceDate)).toEqual({
      start: "2026-01-01",
      end: "2026-11-10",
    });
    expect(resolveAnalyticsWindow("custom", referenceDate, "2026-05-01", "2026-05-15")).toEqual({
      start: "2026-05-01",
      end: "2026-05-15",
    });
    // Inverted custom dates auto-corrected
    expect(resolveAnalyticsWindow("custom", referenceDate, "2026-05-15", "2026-05-01")).toEqual({
      start: "2026-05-01",
      end: "2026-05-15",
    });
  });

  it("converts IST window to exact UTC Date range", () => {
    const range = getIstUtcRange({ start: "2026-11-10", end: "2026-11-10" });
    // 2026-11-10T00:00:00+05:30 -> 2026-11-09T18:30:00.000Z
    expect(range.startUtc.toISOString()).toBe("2026-11-09T18:30:00.000Z");
    // 2026-11-10T23:59:59.999+05:30 -> 2026-11-10T18:29:59.999Z
    expect(range.endUtc.toISOString()).toBe("2026-11-10T18:29:59.999Z");
  });

  it("computes rate safely without division by zero or NaN", () => {
    expect(rate(5, 10)).toBe(0.5);
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(0, 10)).toBe(0);
    expect(rate(5, 0)).toBeNull();
    expect(rate(5, -1)).toBeNull();
    expect(rate(null, 10)).toBeNull();
    expect(rate(5, null)).toBeNull();
  });

  it("computes median safely", () => {
    expect(median([])).toBeNull();
    expect(median([10])).toBe(10);
    expect(median([1, 5, 10])).toBe(5);
    expect(median([10, 1, 5])).toBe(5); // sorts automatically
    expect(median([1, 2, 3, 4])).toBe(2.5); // even length mean
  });

  it("computes granularity, buckets and bucketOf correctly", () => {
    expect(defaultGranularity({ start: "2026-11-01", end: "2026-11-10" })).toBe("day");
    expect(defaultGranularity({ start: "2026-09-01", end: "2026-11-10" })).toBe("week");
    expect(defaultGranularity({ start: "2026-01-01", end: "2026-11-10" })).toBe("month");

    expect(bucketOf("2026-11-10", "day")).toBe("2026-11-10");
    expect(bucketOf("2026-11-10", "week")).toBe("2026-11-09");
    expect(bucketOf("2026-11-10", "month")).toBe("2026-11");

    const dayBuckets = buckets({ start: "2026-11-08", end: "2026-11-10" }, "day");
    expect(dayBuckets).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);

    const monthBuckets = buckets({ start: "2026-09-15", end: "2026-11-10" }, "month");
    expect(monthBuckets).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("checks whether an IST day is within the window", () => {
    const win = { start: "2026-11-01", end: "2026-11-10" };
    expect(isDayInWindow("2026-11-05", win)).toBe(true);
    expect(isDayInWindow("2026-11-01", win)).toBe(true);
    expect(isDayInWindow("2026-11-10", win)).toBe(true);
    expect(isDayInWindow("2026-10-31", win)).toBe(false);
    expect(isDayInWindow("2026-11-11", win)).toBe(false);
    expect(isDayInWindow(null, win)).toBe(false);
  });

  it("normalizes both Title-Case UI call outcomes and snake_case DB fixtures (B5D)", () => {
    expect(isNoAnswerCallOutcome("Not picked")).toBe(true);
    expect(isNoAnswerCallOutcome("not_picked")).toBe(true);
    expect(isNoAnswerCallOutcome("No answer")).toBe(true);
    expect(isNoAnswerCallOutcome("no_answer")).toBe(true);
    expect(isNoAnswerCallOutcome("Connected")).toBe(false);

    expect(isBusyCallOutcome("Busy")).toBe(true);
    expect(isBusyCallOutcome("busy")).toBe(true);
    expect(isBusyCallOutcome("Not picked")).toBe(false);
  });

  it("excludes cancelled deals from Owner Performance won deal counting (B5D)", () => {
    expect(isCountedWonDealStatus("active")).toBe(true);
    expect(isCountedWonDealStatus("completed")).toBe(true);
    expect(isCountedWonDealStatus("on_hold")).toBe(true);
    expect(isCountedWonDealStatus("cancelled")).toBe(false);
  });
});
