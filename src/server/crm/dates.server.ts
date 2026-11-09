import "@tanstack/react-start/server-only";
import { parseUtcDateTime, toMysqlUtcDateTime } from "../db/utc.server";

export const IST_OFFSET_MS = 330 * 60_000;
export const DAY_MS = 86_400_000;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_BUSINESS_DT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ZONED_ISO_DT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/;

export interface ParsedBusinessDateTime {
  date: Date;
  utcIso: string;
  mysqlUtc: string;
  istDate: string;
  istTime: string;
  istDateTime: string;
  sourceHadTimezone: boolean;
}

function isValidCalendarDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

export function isValidCalendarDay(raw: string): boolean {
  const m = DATE_ONLY_RE.exec(raw.trim());
  if (!m) return false;
  return isValidCalendarDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface IstParts {
  istDate: string;
  istTime: string;
  istDateTime: string;
}

/**
 * Computes Asia/Kolkata calendar date and time deterministically regardless of server OS timezone.
 */
export function toIstParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = pad2(shifted.getUTCMonth() + 1);
  const d = pad2(shifted.getUTCDate());
  const h = pad2(shifted.getUTCHours());
  const mi = pad2(shifted.getUTCMinutes());
  const s = pad2(shifted.getUTCSeconds());
  return {
    istDate: `${y}-${mo}-${d}`,
    istTime: `${h}:${mi}`,
    istDateTime: `${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`,
  };
}

/**
 * Parses either an Asia/Kolkata wall-clock datetime (`YYYY-MM-DDTHH:mm[:ss]`) or an explicit
 * timezone-qualified ISO string (`...Z` / `...+05:30`) while strictly rejecting calendar rollover.
 */
export function parseBusinessDateTimeToUtc(
  raw: string,
): { ok: true; value: ParsedBusinessDateTime } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Choose a valid date and time" };
  }

  const zonedMatch = ZONED_ISO_DT_RE.exec(trimmed);
  if (zonedMatch) {
    const year = Number(zonedMatch[1]);
    const month = Number(zonedMatch[2]);
    const day = Number(zonedMatch[3]);
    const hour = Number(zonedMatch[4]);
    const minute = Number(zonedMatch[5]);
    const second = Number(zonedMatch[6] ?? "0");
    const ms = Number((zonedMatch[7] ?? "0").padEnd(3, "0"));
    const tz = zonedMatch[8]!;

    if (!isValidCalendarDateParts(year, month, day) || !isValidTimeParts(hour, minute, second)) {
      return { ok: false, error: "Choose a valid date and time" };
    }

    let offsetMinutes = 0;
    if (tz !== "Z") {
      const sign = tz.startsWith("-") ? -1 : 1;
      const digits = tz.slice(1).replace(":", "");
      const tzHour = Number(digits.slice(0, 2));
      const tzMin = Number(digits.slice(2, 4));
      if (tzHour > 14 || tzMin >= 60 || (tzHour === 14 && tzMin > 0)) {
        return { ok: false, error: "Invalid timezone offset" };
      }
      offsetMinutes = sign * (tzHour * 60 + tzMin);
    }

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60_000;
    const date = new Date(utcMs);
    if (!Number.isFinite(date.getTime())) {
      return { ok: false, error: "Choose a valid date and time" };
    }
    const ist = toIstParts(date);
    return {
      ok: true,
      value: {
        date,
        utcIso: date.toISOString(),
        mysqlUtc: toMysqlUtcDateTime(date),
        istDate: ist.istDate,
        istTime: ist.istTime,
        istDateTime: ist.istDateTime,
        sourceHadTimezone: true,
      },
    };
  }

  const naiveMatch = NAIVE_BUSINESS_DT_RE.exec(trimmed);
  if (naiveMatch) {
    const year = Number(naiveMatch[1]);
    const month = Number(naiveMatch[2]);
    const day = Number(naiveMatch[3]);
    const hour = Number(naiveMatch[4]);
    const minute = Number(naiveMatch[5]);
    const second = Number(naiveMatch[6] ?? "0");
    const ms = Number((naiveMatch[7] ?? "0").padEnd(3, "0"));

    if (!isValidCalendarDateParts(year, month, day) || !isValidTimeParts(hour, minute, second)) {
      return { ok: false, error: "Choose a valid date and time" };
    }

    // Naive datetime-local inputs represent Asia/Kolkata business time, matching dates.ts.
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - IST_OFFSET_MS;
    const date = new Date(utcMs);
    const ist = toIstParts(date);
    return {
      ok: true,
      value: {
        date,
        utcIso: date.toISOString(),
        mysqlUtc: toMysqlUtcDateTime(date),
        istDate: ist.istDate,
        istTime: ist.istTime,
        istDateTime: ist.istDateTime,
        sourceHadTimezone: false,
      },
    };
  }

  return { ok: false, error: "Choose a valid date and time" };
}

/**
 * Returns exact UTC [start, endExclusive) bounds matching one Asia/Kolkata business day.
 */
export function istDayBoundsUtc(day: string): {
  start: Date;
  endExclusive: Date;
  startMysqlUtc: string;
  endExclusiveMysqlUtc: string;
} {
  const m = DATE_ONLY_RE.exec(day.trim());
  if (!m) {
    throw new RangeError("Expected YYYY-MM-DD business day");
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayNum = Number(m[3]);
  if (!isValidCalendarDateParts(year, month, dayNum)) {
    throw new RangeError(`Invalid calendar date: ${day}`);
  }
  const startMs = Date.UTC(year, month - 1, dayNum, 0, 0, 0, 0) - IST_OFFSET_MS;
  const endMs = startMs + DAY_MS;
  const start = new Date(startMs);
  const endExclusive = new Date(endMs);
  return {
    start,
    endExclusive,
    startMysqlUtc: toMysqlUtcDateTime(start),
    endExclusiveMysqlUtc: toMysqlUtcDateTime(endExclusive),
  };
}

/**
 * Mirrors src/lib/crm/followups.ts `followUpBucket` using Asia/Kolkata boundaries.
 */
export function followUpBucketServer(
  record: {
    dueAtMysqlUtc: string;
    dueIstDate?: string;
    completedAt: string | null;
    cancelledAt: string | null;
  },
  now: Date,
): "done" | "overdue" | "today" | "upcoming" {
  if (record.completedAt !== null || record.cancelledAt !== null) {
    return "done";
  }
  const dueDate = parseUtcDateTime(record.dueAtMysqlUtc);
  if (Number.isNaN(dueDate.getTime())) {
    return "overdue";
  }
  if (dueDate.getTime() < now.getTime()) {
    return "overdue";
  }
  const dueDay = record.dueIstDate ?? toIstParts(dueDate).istDate;
  const todayIst = toIstParts(now).istDate;
  return dueDay === todayIst ? "today" : "upcoming";
}

export function mysqlUtcToIso(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const d = parseUtcDateTime(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
