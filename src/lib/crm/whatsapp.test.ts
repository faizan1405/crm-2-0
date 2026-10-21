import { describe, expect, it } from "vitest";
import { draftMessage, waLink, waNumber } from "./whatsapp";

const ctx = { owner: "Faizan", business: "Scale Flow" };
const lead = { name: "Aarav Sharma", company: "Bloom Interiors", requirement: "an e-commerce website" };

describe("whatsapp composer rules", () => {
  it("normalises Indian mobiles and rejects invalid numbers", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    expect(waNumber("098765 43210")).toBe("919876543210");
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("1234567890")).toBeNull();
  });
  it("url-encodes the message", () => {
    expect(waLink("919876543210", "Hi & bye?\nok")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye%3F%0Aok");
  });
  it("switching purpose changes the draft and custom starts empty", () => {
    const f = draftMessage("followup", lead, ctx), q = draftMessage("quotation", lead, ctx), s = draftMessage("samples", lead, ctx);
    expect(new Set([f, q, s]).size).toBe(3);
    expect(f).toContain("Hi Aarav");
    expect(draftMessage("custom", lead, ctx)).toBe("");
  });
  it("never invents a price, link or placeholder", () => {
    const q = draftMessage("quotation", lead, ctx), s = draftMessage("samples", lead, ctx);
    expect(q).not.toMatch(/₹|http|\{|\[/);
    expect(s).not.toMatch(/http|\{|\[/);
    expect(draftMessage("quotation", { ...lead, quotedAmount: 45000 }, ctx)).toContain("₹45,000");
  });
  it("omits missing project details instead of guessing", () => {
    expect(draftMessage("followup", { name: "Mira" }, ctx)).toBe("Hi Mira, this is Faizan from Scale Flow. Just following up on our conversation. Would you have a few minutes today or tomorrow to discuss the next steps?");
  });
});
