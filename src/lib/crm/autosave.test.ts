import { describe, it, expect, vi } from "vitest";
import { createAutosaver } from "./autosave";

describe("notes autosave", () => {
  it("debounces and saves only the latest value", () => {
    vi.useFakeTimers();
    const saved: string[] = []; const st: string[] = [];
    const a = createAutosaver<string>((v) => saved.push(v), (s) => st.push(s), 600);
    a.schedule("a"); a.schedule("ab"); a.schedule("abc");
    vi.advanceTimersByTime(599); expect(saved).toEqual([]);
    vi.advanceTimersByTime(1); expect(saved).toEqual(["abc"]); expect(st.at(-1)).toBe("saved");
    vi.useRealTimers();
  });
  it("flush saves immediately (e.g. when switching notes)", () => {
    const saved: string[] = [];
    const a = createAutosaver<string>((v) => saved.push(v), () => {}, 600);
    a.schedule("x"); expect(a.flush()).toBe(true); expect(saved).toEqual(["x"]); expect(a.hasPending()).toBe(false);
  });
  it("never reports saved when storage fails, and keeps the change to retry", () => {
    let fail = true; const saved: string[] = []; const st: string[] = [];
    const a = createAutosaver<string>((v) => { if (fail) throw new Error("QuotaExceededError"); saved.push(v); }, (s) => st.push(s), 600);
    a.schedule("draft"); expect(a.flush()).toBe(false);
    expect(st.at(-1)).toBe("error"); expect(st).not.toContain("saved"); expect(a.hasPending()).toBe(true);
    fail = false; expect(a.flush()).toBe(true); expect(saved).toEqual(["draft"]);
  });
});
