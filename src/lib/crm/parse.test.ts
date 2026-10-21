import { describe, it, expect } from "vitest";
import { structureLead } from "./parse";

describe("Quick AI demo parser", () => {
  const r = structureLead("Rahul Sharma, 9876543210, owns an event company, wants a website, budget 40000, follow up next Monday.");
  it("extracts name and phone", () => {
    expect(r.name).toBe("Rahul Sharma");
    expect(r.phone).toBe("9876543210");
  });
  it("extracts explicit budget", () => expect(r.budget).toBe(40000));
  it("keeps follow-up as an unconfirmed hint, never a date", () => expect(r.followUpHint).toBe("next Monday"));
  it("does not invent a quoted amount or email", () => {
    expect(r.quotedAmount).toBeUndefined();
    expect(r.email).toBeUndefined();
  });
  it("understands 1.5 lakh", () => expect(structureLead("Amit, budget 1.5 lakh").budget).toBe(150000));
  it("keeps budget and quote distinct when several amounts appear", () => {
    const result = structureLead("Rahul, 9876543210, budget 40000, quoted 55000, advance 10000");
    expect(result.budget).toBe(40000);
    expect(result.quotedAmount).toBe(55000);
  });
  it("leaves absent phone and optional fields unset", () => {
    const result = structureLead("Rahul Sharma, wants a website");
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.budget).toBeUndefined();
  });
});
