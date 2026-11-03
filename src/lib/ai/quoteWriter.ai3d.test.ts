import { describe, it, expect } from "vitest";
import { demoQuote, commercialViolations, improveQuote, detectProject, draftScope, NOT_SPECIFIED } from "./quoteWriter";

const BODY = "Hi {clientName},\n\nour *{packageName}* — {packagePrice}.\n\nwhat we provide:\n•  5 pages ,responsive\n- hosting & domain: client side\n- 50% advance, 50% on delivery\n- delivery in 3 weeks, GST 18% extra\n- 6 months support\nशुक्रिया 🙏";

describe("AI-3D commercial value preservation", () => {
  it("improve keeps every amount, %, duration and placeholder", () => {
    const r = demoQuote({ mode: "improve", body: BODY, lang: "en", variant: 0 });
    expect(commercialViolations([BODY], r.text, BODY)).toEqual([]);
    for (const t of ["{clientName}", "{packagePrice}", "50%", "18%", "3 weeks", "6 months", "शुक्रिया 🙏", "Hosting & domain"]) expect(r.text).toContain(t);
  });
  it("draft scope keeps the Owner's terms and placeholders", () => {
    const r = demoQuote({ mode: "draft_scope", body: BODY, requirements: "Business website with contact form and WhatsApp button", lang: "en", variant: 0 });
    expect(commercialViolations([BODY, "Business website with contact form and WhatsApp button"], r.text, BODY)).toEqual([]);
  });
  it("blocks a changed price, percentage or support period", () => {
    expect(commercialViolations([BODY], BODY.replace("50% advance", "40% advance"), BODY).length).toBeGreaterThan(0);
    expect(commercialViolations([BODY], BODY.replace("6 months", "12 months"), BODY).length).toBeGreaterThan(0);
    expect(commercialViolations(["Price ₹45,000"], "Price ₹40,000", "Price ₹45,000").length).toBeGreaterThan(0);
    expect(commercialViolations([BODY], BODY.replace("{packagePrice}", ""), BODY).length).toBeGreaterThan(0);
  });
});

describe("AI-3D draft scope never invents", () => {
  it("deliverables come only from typed requirements; missing terms say Not specified", () => {
    const d = draftScope("", "Portfolio website with gallery", "en", 0);
    expect(d.type).toBe("portfolio");
    expect(d.text).toContain("- Image gallery");
    expect(d.text).not.toMatch(/hosting|payment gateway|\d+ (days|weeks|months)/i);
    expect(d.text).toContain(NOT_SPECIFIED);
    expect(d.text).toMatch(/Optional recommendations \(not included in the price\)/);
  });
  it("detects the 5 supported project types", () => {
    expect(["business website", "ecommerce store with cart", "photographer portfolio", "redesign old website", "3D interactive site"].map(detectProject)).toEqual(["business", "ecommerce", "portfolio", "redesign", "3d"]);
  });
  it("unsupported brief is flagged honestly", () => {
    const r = demoQuote({ mode: "draft_scope", body: "", requirements: "Build a logistics ERP with fleet tracking and AI routing", lang: "en", variant: 0 });
    expect(r.supported).toBe(false); expect(r.notice).toMatch(/live AI/);
  });
  it("Hindi headings without translating the Owner's lines", () => {
    const r = demoQuote({ mode: "draft_scope", body: "", requirements: "Business website, 5 pages", lang: "hi", variant: 0 });
    expect(r.text).toContain("शामिल कार्य"); expect(r.text).toContain("5 pages"); expect(r.notice).toMatch(/aren't translated/);
  });
});

describe("AI-3D improve is gentle", () => {
  it("tidies bullets and spacing only", () => expect(improveQuote("•  5 pages ,responsive")).toBe("- 5 pages,responsive"));
  it("doesn't touch the input", () => { const b = BODY; demoQuote({ mode: "improve", body: b, lang: "en", variant: 0 }); expect(b).toBe(BODY); });
});
