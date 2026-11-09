/**
 * Pure UTC timestamp helpers matching MySQL `DATETIME(3)` with `timezone: "Z"` and `dateStrings: true`.
 */

/** Formats a Date as `YYYY-MM-DD HH:mm:ss.SSS` in UTC so strict MySQL/MariaDB accepts it unambiguously. */
export function toMysqlUtcDateTime(date: Date = new Date()): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

/** Parses either MySQL `YYYY-MM-DD HH:mm:ss(.SSS)` (assumed UTC) or ISO-8601 into a UTC Date. */
export function parseUtcDateTime(raw: string): Date {
  const trimmed = raw.trim();
  if (!trimmed) return new Date(Number.NaN);
  const normalized = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  return new Date(normalized);
}

/** Returns a new Date offset by `seconds` seconds. */
export function addSeconds(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}
