import { describe, expect, it } from "vitest";
import { quickAfterCall } from "./calllog";

describe("quick status after a call (F1)", () => {
  it("Connected after Not picked clears the stale Not picked mark", () => expect(quickAfterCall("Connected", "not_picked")).toEqual({ set: true, value: undefined }));
  it("Connected after Busy clears the Busy mark", () => expect(quickAfterCall("Connected", "busy")).toEqual({ set: true, value: undefined }));
  it("Connected keeps a deliberate Interested mark", () => expect(quickAfterCall("Connected", "interested")).toEqual({ set: false, value: "interested" }));
  it("Not picked sets Not picked", () => expect(quickAfterCall("Not picked", undefined)).toEqual({ set: true, value: "not_picked" }));
});
