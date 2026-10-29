import { describe, expect, it } from "vitest";
import { nextIndex } from "./tabKeys";

describe("segmented control arrow keys", () => {
  const all = [true, true, true];
  it("ArrowRight wraps from last to first", () => expect(nextIndex(3, 2, "ArrowRight", all)).toBe(0));
  it("ArrowLeft wraps from first to last", () => expect(nextIndex(3, 0, "ArrowLeft", all)).toBe(2));
  it("skips a disabled option (Distribute disabled with one lead)", () => expect(nextIndex(2, 0, "ArrowRight", [true, false])).toBe(0));
  it("Home/End jump to first/last enabled", () => {
    expect(nextIndex(3, 1, "Home", all)).toBe(0);
    expect(nextIndex(3, 0, "End", [true, true, false])).toBe(1);
  });
  it("ignores other keys", () => expect(nextIndex(3, 1, "a", all)).toBe(1));
});
