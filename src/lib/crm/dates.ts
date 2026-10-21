import { dayKey } from "./format";

export type AnalyticsRange = "today" | "7d" | "30d" | "month" | "custom";
export const shiftDay = (day: string, count: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
export function rangeBounds(range: AnalyticsRange, from: string, to: string, now = new Date()): [string, string] {
  const today = dayKey(now);
  if (range === "today") return [today, today];
  if (range === "7d") return [shiftDay(today, -6), today];
  if (range === "30d") return [shiftDay(today, -29), today];
  if (range === "month") return [today.slice(0, 8) + "01", today];
  return [from || shiftDay(today, -29), to || today];
}
export const inDateRange = (date: string, start: string, end: string) => {
  const key = dayKey(date);
  return start <= end && key >= start && key <= end;
};
/** datetime-local controls represent business time, not the device's timezone. */
export const businessDateTime = (value: string) => new Date(`${value}:00+05:30`).toISOString();