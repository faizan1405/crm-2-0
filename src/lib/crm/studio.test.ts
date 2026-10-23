import { describe, expect, it } from "vitest";
import { activeQuotationTemplates, composeDraft, emptyQuotationTemplate, formatPackagePrice, priceMismatch, quotationTemplateError, renderQuotation, syncDraft, renderTemplate, safeUrl, selectedDemos, templateFromLegacy, pickTemplate, builtInTemplates, templateVars, type QuotationTemplate, type Demo } from "./studio";

const pkg = (p: Partial<QuotationTemplate> = {}): QuotationTemplate => ({ ...emptyQuotationTemplate(), id: "p1", name: "Premium 3D Website", priceType: "fixed", priceAmount: 45000, messageBody: "Hi {clientName}, our {packageName} is {packagePrice}.\nFor {companyName} we include a dashboard.", ...p });
const demo = (p: Partial<Demo>): Demo => ({ id: "d", title: "Demo", url: "https://a.com", category: "Other", tags: [], active: true, order: 0, includeByDefault: false, ...p });

describe("quotation packages", () => {
  it("formats fixed and custom prices", () => {
    expect(formatPackagePrice(pkg())).toBe("₹45,000");
    expect(formatPackagePrice(pkg({ priceType: "custom", priceLabel: "On request" }))).toBe("On request");
    expect(formatPackagePrice(pkg({ priceType: "custom", priceLabel: "" }))).toBe("Custom price");
  });
  it("personalises for each client and omits details a client doesn't have", () => {
    const ctx = { owner: "Faizan", business: "Scale Flow" };
    expect(renderQuotation(pkg(), { name: "Rohan", company: "Kapoor Foods" }, ctx)).toBe("Hi Rohan, our Premium 3D Website is ₹45,000.\nFor Kapoor Foods we include a dashboard.");
    const out = renderQuotation(pkg(), { name: "Asha" }, ctx);
    expect(out).toBe("Hi Asha, our Premium 3D Website is ₹45,000.");
  });
  it("requires a name, a price above zero for fixed packages, and a message", () => {
    expect(quotationTemplateError(pkg({ name: " " }))).toMatch(/name/);
    expect(quotationTemplateError(pkg({ priceAmount: 0 }))).toMatch(/price/);
    expect(quotationTemplateError(pkg({ priceType: "custom", priceAmount: undefined }))).toBeNull();
    expect(quotationTemplateError(pkg({ messageBody: "" }))).toMatch(/message/);
  });
  it("warns when a hand-typed price differs from the saved price", () => {
    expect(priceMismatch(pkg({ priceAmount: 50000, messageBody: "Only ₹45,000 today" }))).toEqual(["₹45,000"]);
    expect(priceMismatch(pkg({ messageBody: "Only ₹45,000 today" }))).toEqual([]);
  });
  it("lists only active packages in saved order", () => {
    expect(activeQuotationTemplates([pkg({ id: "b", sortOrder: 2 }), pkg({ id: "a", sortOrder: 1 }), pkg({ id: "off", isActive: false })]).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("turns an old quotation into an unsaved package draft using its real total", () => {
    const t = templateFromLegacy({ id: "q", number: "SF-Q-1", leadId: "l", clientName: "C", title: "Old site", issueDate: "", validUntil: "", items: [{ id: "i", description: "Design", qty: 2, unitPrice: 5000 }], discountType: "flat", discount: 0, gstEnabled: true, gstRate: 18, status: "ready", createdAt: "", updatedAt: "" }, 0);
    expect(t.priceAmount).toBe(11800);
    expect(t.messageBody).toContain("- Design");
  });
});

describe("templates", () => {
  it("fills placeholders from saved data", () => expect(renderTemplate("Hi {clientName}.", { clientName: "Rohan" })).toBe("Hi Rohan."));
  it("drops sentences with missing values instead of showing tokens", () => {
    const out = renderTemplate("Hi {firstName}. About {companyName} project. Thanks!", { firstName: "Rohan" });
    expect(out).toBe("Hi Rohan. Thanks!");
    expect(out).not.toContain("{");
  });
  it("uses the enabled default template, so edits flow to the composer", () => {
    const list = builtInTemplates().map((t) => (t.purpose === "followup" ? { ...t, body: "Updated {firstName}" } : t));
    expect(renderTemplate(pickTemplate(list, "followup")!.body, { firstName: "Asha" })).toBe("Updated Asha");
    expect(pickTemplate(list.map((t) => ({ ...t, enabled: false })), "followup")).toBeUndefined();
  });
});

describe("demo library", () => {
  const demos = [demo({ id: "e", title: "Shop", category: "E-commerce", includeByDefault: true, order: 2 }), demo({ id: "s", title: "Scroll", includeByDefault: true, order: 1 }), demo({ id: "x", title: "3D", includeByDefault: false }), demo({ id: "bad", url: "javascript:alert(1)", includeByDefault: true }), demo({ id: "off", active: false, includeByDefault: true })];
  it("includes only selected, active, valid demos in order", () => expect(selectedDemos(demos).map((d) => d.id)).toEqual(["s", "e"]));
  it("applies a per-message override without touching defaults", () => {
    expect(selectedDemos(demos, ["x"]).map((d) => d.id)).toEqual(["x"]);
    expect(demos.find((d) => d.id === "x")!.includeByDefault).toBe(false);
  });
  it("puts the exact links into the sample message", () => {
    const body = builtInTemplates().find((t) => t.purpose === "samples")!.body;
    const out = renderTemplate(body, templateVars({ name: "Rohan Kapoor" }, { owner: "Faizan", business: "Scale Flow", demos: selectedDemos(demos) }));
    expect(out).toContain("• Scroll: https://a.com/");
    expect(out).not.toContain("javascript");
  });
  it("rejects unsafe or malformed URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("example.com/demo")).toBe("https://example.com/demo");
  });
});

describe("composer drafts from the shared source", () => {
  const lead = { name: "Rohan Kapoor", company: "Kapoor Foods", requirement: "Business Website" };
  const base = { lead, owner: "Faizan", business: "Scale Flow" };
  it("reflects an edited template immediately", () => {
    const templates = builtInTemplates().map((t) => (t.purpose === "followup" ? { ...t, body: "Namaste {firstName} from {companyName}!" } : t));
    expect(composeDraft({ ...base, purpose: "followup", templates })).toBe("Namaste Rohan from Kapoor Foods!");
  });
  it("shows only the selected demo links in a samples message", () => {
    const demos = [demo({ id: "e", title: "Shop", url: "https://shop.example.com", category: "E-commerce", includeByDefault: true }), demo({ id: "x", title: "3D", url: "https://3d.example.com", includeByDefault: false })];
    const out = composeDraft({ ...base, purpose: "samples", templates: builtInTemplates(), demos: selectedDemos(demos) });
    expect(out).toContain("• Shop: https://shop.example.com/");
    expect(out).not.toContain("3d.example.com");
  });
  it("uses the chosen package's latest saved price", () => {
    expect(composeDraft({ ...base, purpose: "quotation", templates: builtInTemplates(), pkg: pkg({ priceAmount: 50000 }) })).toContain("₹50,000");
  });
  it("never mentions a PDF when the client has no quotation", () => {
    expect(composeDraft({ ...base, purpose: "quotation", templates: builtInTemplates() })).not.toMatch(/PDF|\{/);
  });
});

describe("unsaved composer edits", () => {
  it("follows the latest template when untouched", () => expect(syncDraft({ text: "old", base: "old", edited: false }, "new")).toEqual({ text: "new", base: "new", notice: false }));
  it("keeps a manually edited draft and raises a notice instead", () => expect(syncDraft({ text: "my words", base: "old", edited: true }, "new")).toEqual({ text: "my words", base: "old", notice: true }));
});
