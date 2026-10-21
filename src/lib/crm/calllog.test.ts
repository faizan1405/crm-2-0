import { describe, it, expect } from "vitest";
import { outcomeStage, shortcutValue } from "./calllog";

const now = new Date("2026-10-21T10:52:00Z"); // 16:22 IST

describe("post-call quick log", () => {
  it("Won outcome moves lead to won", () => expect(outcomeStage("Won", "proposal")).toBe("won"));
  it("Not interested marks lead lost", () => expect(outcomeStage("Not interested", "contacted")).toBe("lost"));
  it("Connected moves a new lead to contacted", () => expect(outcomeStage("Connected", "new")).toBe("contacted"));
  it("Busy keeps the current stage", () => expect(outcomeStage("Busy", "qualified")).toBe("qualified"));
  it("Tonight is 7 PM today in IST", () => expect(shortcutValue("Tonight", now)).toBe("2026-10-21T19:00"));
  it("Tomorrow is 11 AM next day", () => expect(shortcutValue("Tomorrow", now)).toBe("2026-10-22T11:00"));
  it("Next week is 7 days later", () => expect(shortcutValue("Next week", now)).toBe("2026-10-28T11:00"));
});
