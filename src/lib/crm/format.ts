export const TIMEZONE = "Asia/Kolkata";

/** Display prefs, synced from the store by the app shell. */
export const displayPrefs = { hour12: true, longDate: false };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatINR = (n: number | undefined | null) => (n == null ? "—" : inr.format(n));
/** ₹ in Indian units (K, L, Cr) — locale-independent so server and browser match. */
export const formatINRCompact = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  const f = (v: number, u: string) => `${sign}₹${(Math.round(v * 10) / 10).toString()}${u}`;
  if (a >= 1e7) return f(a / 1e7, "Cr");
  if (a >= 1e5) return f(a / 1e5, "L");
  if (a >= 1e3) return f(a / 1e3, "K");
  return `${sign}₹${Math.round(a)}`;
};
void inrCompact;
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
  const o = displayPrefs.longDate && opts.month === "short" && !opts.weekday ? { ...opts, month: "long" as const } : opts;
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, ...o }).format(new Date(d));
}

export function formatDateTime(d?: string) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: displayPrefs.longDate ? "long" : "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: displayPrefs.hour12,
  }).format(new Date(d));
}

export function formatTime(d: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit", hour12: displayPrefs.hour12 }).format(
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
    .map((p) => p.charAt(0).toUpperCase())
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
