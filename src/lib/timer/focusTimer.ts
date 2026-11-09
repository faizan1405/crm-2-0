// Focus / sales-call countdown timer — pure rules, no browser APIs.
// Remaining time is always derived from a real end timestamp, so throttled
// background tabs, page changes and refreshes never drift the countdown.

export const TIMER_KEY = "scale-flow-focus-timer";
export const CHIME_KEY = "scale-flow-focus-timer-chimed";
export const PRESETS = [5, 10, 15, 25, 30, 45, 60] as const;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 600;
/** A timer that finished longer ago than this (e.g. tab was closed) is shown as finished without a late sound. */
export const LATE_CHIME_MS = 60_000;
const MINUTE = 60_000;

export type TimerStatus = "idle" | "ready" | "running" | "paused" | "done";
export type TimerView = "expanded" | "mini" | "hidden";
export interface Position { x: number; y: number }

export interface TimerState {
  status: TimerStatus;
  /** Session id — one per started countdown; used to play the finish sound exactly once. */
  id: string | null;
  durationMs: number;
  /** Set while running. */
  endsAt: number | null;
  /** Set while paused. */
  remainingMs: number | null;
  /** Set when done. */
  finishedAt: number | null;
  muted: boolean;
  view: TimerView;
  /** Desktop floating position (top-left, px). null = default corner. */
  pos: Position | null;
}

export const initialTimer = (): TimerState => ({
  status: "idle", id: null, durationMs: 25 * MINUTE, endsAt: null, remainingMs: null, finishedAt: null,
  muted: false, view: "hidden", pos: null,
});

export function parseMinutes(input: string): { ok: true; ms: number } | { ok: false; error: string } {
  const t = input.trim().replace(",", ".");
  if (!t) return { ok: false, error: "Enter the number of minutes." };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Use numbers only, e.g. 20." };
  const n = Number(t);
  if (n < MIN_MINUTES) return { ok: false, error: `Minimum is ${MIN_MINUTES} minute.` };
  if (n > MAX_MINUTES) return { ok: false, error: `Maximum is ${MAX_MINUTES} minutes.` };
  return { ok: true, ms: Math.round(n * 60) * 1000 };
}

export function start(s: TimerState, durationMs: number, now: number, id: string): TimerState {
  return { ...s, status: "running", id, durationMs, endsAt: now + durationMs, remainingMs: null, finishedAt: null, view: s.view === "hidden" ? "expanded" : s.view };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.status !== "running" || s.endsAt === null) return s;
  const left = s.endsAt - now;
  if (left <= 0) return tick(s, now);
  return { ...s, status: "paused", endsAt: null, remainingMs: left };
}

export function resume(s: TimerState, now: number): TimerState {
  if (s.status !== "paused" || s.remainingMs === null) return s;
  return { ...s, status: "running", endsAt: now + s.remainingMs, remainingMs: null };
}

/** Back to the full duration of the current timer, not counting. */
export function reset(s: TimerState): TimerState {
  if (s.status === "idle") return s;
  return { ...s, status: "ready", id: null, endsAt: null, remainingMs: null, finishedAt: null };
}

/** End the session and return to the preset picker. */
export function stop(s: TimerState): TimerState {
  return { ...s, status: "idle", id: null, endsAt: null, remainingMs: null, finishedAt: null };
}

/** Moves a running timer whose end time has passed to "done". Returns the same object when nothing changed. */
export function tick(s: TimerState, now: number): TimerState {
  if (s.status === "running" && s.endsAt !== null && now >= s.endsAt) {
    return { ...s, status: "done", finishedAt: s.endsAt, endsAt: null, remainingMs: 0 };
  }
  return s;
}

export function remaining(s: TimerState, now: number): number {
  switch (s.status) {
    case "running": return Math.max(0, (s.endsAt ?? now) - now);
    case "paused": return Math.max(0, s.remainingMs ?? 0);
    case "done": return 0;
    default: return s.durationMs;
  }
}

/** Fraction of time remaining, 0–1. */
export function progress(s: TimerState, now: number): number {
  if (s.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, remaining(s, now) / s.durationMs));
}

/** MM:SS, rounding up so the display reaches 00:00 exactly when time is up. Minutes may exceed 59 (e.g. 120:00). */
export function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function isActive(s: TimerState): boolean {
  return s.status === "running" || s.status === "paused";
}

/**
 * What to announce when a session finishes. null = nothing (not finished, or already announced
 * by this or another tab — `claimedId` is the last announced session). A long-overdue finish
 * (tab was closed) is claimed silently; otherwise one alert, with sound unless muted.
 */
export function finishNotice(s: TimerState, now: number, claimedId: string | null): { sound: boolean; alert: boolean } | null {
  if (s.status !== "done" || !s.id || s.id === claimedId || s.finishedAt === null) return null;
  if (now - s.finishedAt > LATE_CHIME_MS) return { sound: false, alert: false };
  return { sound: !s.muted, alert: true };
}

/** Keeps a floating widget of the given size fully on screen. */
export function clampPos(p: Position, w: number, h: number, vw: number, vh: number, margin = 8): Position {
  return {
    x: Math.round(Math.min(Math.max(margin, p.x), Math.max(margin, vw - w - margin))),
    y: Math.round(Math.min(Math.max(margin, p.y), Math.max(margin, vh - h - margin))),
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Defensive restore from localStorage — anything malformed falls back to safe defaults. */
export function restore(raw: string | null): TimerState {
  const base = initialTimer();
  if (!raw) return base;
  let o: Partial<Record<keyof TimerState, unknown>>;
  try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== "object") return base; o = parsed as Partial<Record<keyof TimerState, unknown>>; } catch { return base; }
  const statuses: TimerStatus[] = ["idle", "ready", "running", "paused", "done"];
  const views: TimerView[] = ["expanded", "mini", "hidden"];
  const durationMs = num(o.durationMs);
  const pos = o.pos && typeof o.pos === "object" ? { x: num((o.pos as Position).x), y: num((o.pos as Position).y) } : null;
  const s: TimerState = {
    ...base,
    durationMs: durationMs !== null && durationMs > 0 && durationMs <= MAX_MINUTES * MINUTE ? durationMs : base.durationMs,
    muted: o.muted === true,
    view: views.includes(o.view as TimerView) ? (o.view as TimerView) : base.view,
    pos: pos && pos.x !== null && pos.y !== null ? { x: pos.x, y: pos.y } : null,
  };
  const status = statuses.includes(o.status as TimerStatus) ? (o.status as TimerStatus) : "idle";
  const id = typeof o.id === "string" && o.id ? o.id : null;
  const endsAt = num(o.endsAt), remainingMs = num(o.remainingMs), finishedAt = num(o.finishedAt);
  if (status === "running" && id && endsAt !== null) return { ...s, status, id, endsAt };
  if (status === "paused" && id && remainingMs !== null && remainingMs > 0) return { ...s, status, id, remainingMs: Math.min(remainingMs, s.durationMs) };
  if (status === "done" && id && finishedAt !== null) return { ...s, status, id, finishedAt, remainingMs: 0 };
  if (status === "ready") return { ...s, status };
  return s;
}
