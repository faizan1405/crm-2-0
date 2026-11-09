import { describe, expect, it } from "vitest";
import * as T from "./focusTimer";

const MIN = 60_000;
const t0 = 1_700_000_000_000;

describe("focus timer rules", () => {
  it("offers the 5, 10, 15, 25, 30, 45 and 60 minute presets", () => {
    expect([...T.PRESETS]).toEqual([5, 10, 15, 25, 30, 45, 60]);
  });

  it("counts down from a real end time, not from ticks", () => {
    const s = T.start(T.initialTimer(), 25 * MIN, t0, "a");
    expect(s.endsAt).toBe(t0 + 25 * MIN);
    // A throttled tab that wakes up 10 minutes later still shows the right time.
    expect(T.formatMMSS(T.remaining(s, t0 + 10 * MIN))).toBe("15:00");
  });

  it("shows MM:SS and reaches 00:00 exactly at the end", () => {
    expect(T.formatMMSS(25 * MIN)).toBe("25:00");
    expect(T.formatMMSS(61_000)).toBe("01:01");
    expect(T.formatMMSS(500)).toBe("00:01");
    expect(T.formatMMSS(0)).toBe("00:00");
    expect(T.formatMMSS(120 * MIN)).toBe("120:00");
  });

  it("pause keeps the remaining time and resume continues from it", () => {
    let s = T.start(T.initialTimer(), 10 * MIN, t0, "a");
    s = T.pause(s, t0 + 4 * MIN);
    expect(s.status).toBe("paused");
    expect(T.remaining(s, t0 + 60 * MIN)).toBe(6 * MIN); // time away while paused doesn't count
    s = T.resume(s, t0 + 60 * MIN);
    expect(s.endsAt).toBe(t0 + 66 * MIN);
  });

  it("reset returns to the full duration without counting; stop returns to the picker", () => {
    const s = T.start(T.initialTimer(), 30 * MIN, t0, "a");
    const r = T.reset(T.pause(s, t0 + MIN));
    expect(r.status).toBe("ready");
    expect(T.remaining(r, t0 + 5 * MIN)).toBe(30 * MIN);
    expect(T.stop(s).status).toBe("idle");
  });

  it("finishes once the end time passes", () => {
    const s = T.start(T.initialTimer(), 5 * MIN, t0, "a");
    expect(T.tick(s, t0 + 5 * MIN - 1)).toBe(s);
    const d = T.tick(s, t0 + 5 * MIN);
    expect(d.status).toBe("done");
    expect(d.finishedAt).toBe(t0 + 5 * MIN);
  });

  it("announces a finished session once, with sound unless muted", () => {
    const d = T.tick(T.start(T.initialTimer(), 5 * MIN, t0, "a"), t0 + 5 * MIN);
    expect(T.finishNotice(d, t0 + 5 * MIN, null)).toEqual({ sound: true, alert: true });
    expect(T.finishNotice(d, t0 + 5 * MIN, "a")).toBeNull(); // already announced (any tab)
    expect(T.finishNotice({ ...d, muted: true }, t0 + 5 * MIN, null)).toEqual({ sound: false, alert: true });
  });

  it("does not play a late sound for a timer that ended over a minute ago", () => {
    const d = T.tick(T.start(T.initialTimer(), 5 * MIN, t0, "a"), t0 + 5 * MIN);
    expect(T.finishNotice(d, t0 + 5 * MIN + 61_000, null)).toEqual({ sound: false, alert: false });
  });

  it("restores an active timer after refresh and recalculates remaining time", () => {
    const s = T.start(T.initialTimer(), 25 * MIN, t0, "a");
    const back = T.restore(JSON.stringify(s));
    expect(T.remaining(back, t0 + 20 * MIN)).toBe(5 * MIN);
    expect(T.tick(back, t0 + 26 * MIN).status).toBe("done");
  });

  it("ignores damaged saved timer data", () => {
    expect(T.restore("{not json").status).toBe("idle");
    expect(T.restore(JSON.stringify({ status: "running", id: "a" })).status).toBe("idle"); // no end time
    expect(T.restore(JSON.stringify({ status: "paused", id: "a", remainingMs: -5 })).status).toBe("idle");
  });

  it("accepts custom durations from 1 to 600 minutes", () => {
    expect(T.parseMinutes("20")).toEqual({ ok: true, ms: 20 * MIN });
    expect(T.parseMinutes("1.5")).toEqual({ ok: true, ms: 90_000 });
    expect(T.parseMinutes("0").ok).toBe(false);
    expect(T.parseMinutes("601").ok).toBe(false);
    expect(T.parseMinutes("abc").ok).toBe(false);
    expect(T.parseMinutes("").ok).toBe(false);
  });

  it("keeps the floating widget inside the window", () => {
    expect(T.clampPos({ x: 2000, y: -50 }, 280, 300, 1280, 800)).toEqual({ x: 992, y: 8 });
  });
});
