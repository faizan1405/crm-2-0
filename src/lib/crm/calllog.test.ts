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

import { isConnectedOutcome, needsStageConfirm, callLogError } from "./calllog";
describe("call log safeguards", () => {
  it("Not picked is not a successful contact", () => expect(isConnectedOutcome("Not picked")).toBe(false));
  it("Busy is not a successful contact", () => expect(isConnectedOutcome("Busy")).toBe(false));
  it("Not picked keeps a new lead as new", () => expect(outcomeStage("Not picked", "new")).toBe("new"));
  it("Won needs confirmation", () => expect(needsStageConfirm("won", "proposal")).toBe(true));
  it("Lost needs confirmation", () => expect(needsStageConfirm("lost", "contacted")).toBe(true));
  it("Unconfirmed won is blocked", () => expect(callLogError({ outcome: "Won", stage: "won", current: "proposal", confirmed: false, lostReason: "" })).toBe("Confirm the stage change"));
  it("Lost without a reason is blocked", () => expect(callLogError({ outcome: "Lost", stage: "lost", current: "proposal", confirmed: true, lostReason: "  " })).toBe("Add a lost reason"));
  it("Confirmed lost with reason saves", () => expect(callLogError({ outcome: "Lost", stage: "lost", current: "proposal", confirmed: true, lostReason: "Budget" })).toBeNull());
  it("Missing outcome is blocked", () => expect(callLogError({ outcome: null, stage: "new", current: "new", confirmed: false, lostReason: "" })).toBe("Pick a call outcome"));
});
