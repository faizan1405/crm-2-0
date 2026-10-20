export const TIMEZONE = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatINR = (n: number | undefined | null) => (n == null ? "—" : inr.format(n));
export const formatINRCompact = (n: number) => inrCompact.format(n);
export const formatPct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

/** yyyy-mm-dd in the business timezone */
export function dayKey(d: Date | string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(d));
}

export function isToday(d: string) {
  return dayKey(d) === dayKey(new Date());
}

export function formatDate(d?: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, ...opts }).format(new Date(d));
}

export function formatDateTime(d?: string) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

export function formatTime(d: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(
    new Date(d),
  );
}

export function relative(d?: string) {
  if (!d) return "—";
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const m = 60_000,
    h = 60 * m,
    day = 24 * h;
  if (abs < h) return rtf.format(Math.round(diff / m), "minute");
  if (abs < day) return rtf.format(Math.round(diff / h), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), "day");
  return rtf.format(Math.round(diff / (30 * day)), "month");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const digits = (s: string) => s.replace(/\D/g, "").slice(-10);

export function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, hour: "numeric", hour12: false }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
