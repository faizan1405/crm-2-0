import "@tanstack/react-start/server-only";

export type AnalyticsPeriod =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear"
  | "custom";

export const ANALYTICS_PERIODS: readonly AnalyticsPeriod[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "custom",
] as const;

export interface DateWindow {
  start: string; // YYYY-MM-DD (IST business day)
  end: string;   // YYYY-MM-DD (IST business day)
}

export type Granularity = "day" | "week" | "month";

const ASIA_KOLKATA = "Asia/Kolkata";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: ASIA_KOLKATA });

/** Formats any Date or ISO string to YYYY-MM-DD in Asia/Kolkata. */
export function getIstDay(d: Date | string = new Date()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return DAY_FMT.format(date);
}

/** Shifts an IST day YYYY-MM-DD by count days. */
export function shiftDay(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + count));
  return date.toISOString().slice(0, 10);
}

/** Monday of the business week containing `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0 = Sun, 1 = Mon ...
  const diff = (dow + 6) % 7;
  return shiftDay(day, -diff);
}

/** First day of the calendar month YYYY-MM-01. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Last day of the calendar month, correctly handling leap years. */
export function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** First day of the calendar quarter containing `day`. */
export function quarterStart(day: string): string {
  const m = Number(day.slice(5, 7));
  const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0");
  return `${day.slice(0, 4)}-${qm}-01`;
}

/** Number of days between inclusive start and end. */
export function windowDays(w: DateWindow): number {
  const startMs = Date.parse(`${w.start}T00:00:00Z`);
  const endMs = Date.parse(`${w.end}T00:00:00Z`);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Resolves an AnalyticsPeriod into an inclusive [start, end] window of IST business days.
 */
export function resolveAnalyticsWindow(
  p: AnalyticsPeriod = "thisMonth",
  now: Date | string = new Date(),
  from?: string | null,
  to?: string | null,
): DateWindow {
  const today = getIstDay(now);

  switch (p) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = shiftDay(today, -1);
      return { start: y, end: y };
    }
    case "7d":
      return { start: shiftDay(today, -6), end: today };
    case "30d":
      return { start: shiftDay(today, -29), end: today };
    case "thisWeek": {
      const s = weekStart(today);
      return { start: s, end: shiftDay(s, 6) };
    }
    case "lastWeek": {
      const s = shiftDay(weekStart(today), -7);
      return { start: s, end: shiftDay(s, 6) };
    }
    case "thisMonth":
      return { start: monthStart(today), end: today };
    case "lastMonth": {
      const prevMonthDay = shiftDay(monthStart(today), -1);
      return { start: monthStart(prevMonthDay), end: prevMonthDay };
    }
    case "thisQuarter":
      return { start: quarterStart(today), end: today };
    case "thisYear":
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "custom": {
      const s = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : shiftDay(today, -29);
      const e = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    default:
      return { start: monthStart(today), end: today };
  }
}

/**
 * Converts an IST date window into exact UTC Date boundaries.
 * Start: YYYY-MM-DDT00:00:00.000+05:30
 * End:   YYYY-MM-DDT23:59:59.999+05:30
 */
export function getIstUtcRange(w: DateWindow): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${w.start}T00:00:00.000+05:30`);
  const endUtc = new Date(`${w.end}T23:59:59.999+05:30`);
  return { startUtc, endUtc };
}

/** Safe rate (n / d). Returns null if denominator is null, undefined, or <= 0. */
export function rate(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d <= 0) return null;
  return Math.round((n / d) * 10000) / 10000;
}

/** Median of an array of numbers; returns null if empty. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Automatically picks granularity if unspecified based on window length. */
export function defaultGranularity(w: DateWindow): Granularity {
  const days = windowDays(w);
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

/** Maps an IST day to its granularity bucket key. */
export function bucketOf(day: string, g: Granularity): string {
  if (g === "day") return day;
  if (g === "week") return weekStart(day);
  return day.slice(0, 7); // YYYY-MM
}

/** Generates all contiguous bucket keys in order for a given window and granularity. */
export function buckets(w: DateWindow, g: Granularity): string[] {
  const result: string[] = [];
  let d = w.start;
  while (d <= w.end && result.length < 800) {
    const b = bucketOf(d, g);
    if (result[result.length - 1] !== b) {
      result.push(b);
    }
    d = shiftDay(d, 1);
  }
  return result;
}

/** Checks whether an IST day is within the window [start, end]. */
export function isDayInWindow(day: string | null | undefined, w: DateWindow): boolean {
  if (!day) return false;
  return day >= w.start && day <= w.end;
}
