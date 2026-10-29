import { describe, expect, it } from "vitest";
import { leadEditFieldErrors } from "./validation";
import type { Lead } from "./types";

const lead = (id: string, phone: string) => ({ id, name: id, phone } as unknown as Lead);
const leads = [lead("a", "9876543210"), lead("b", "9123456780")];
const ok = { name: "A", phone: "9876543210", email: "", budget: "", quotedAmount: "" };

describe("E2.2A.2 Edit Lead per-field errors", () => {
  it("valid form has no errors", () => expect(leadEditFieldErrors(leads, "a", ok)).toEqual({}));
  it("short phone is flagged on the phone field only", () => expect(leadEditFieldErrors(leads, "a", { ...ok, phone: "12345" })).toEqual({ phone: "Enter a valid 10-digit mobile number" }));
  it("negative budget is flagged on budget", () => expect(leadEditFieldErrors(leads, "a", { ...ok, budget: "-500" }).budget).toBe("Amount can't be negative"));
  it("another lead's phone is refused", () => expect(leadEditFieldErrors(leads, "a", { ...ok, phone: "9123456780" }).phone).toBe("This phone already belongs to another lead"));
  it("empty name and bad email both reported", () => expect(Object.keys(leadEditFieldErrors(leads, "a", { ...ok, name: " ", email: "a@b" })).sort()).toEqual(["email", "name"]));
});
