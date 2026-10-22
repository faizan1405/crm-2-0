import { describe, expect, it } from "vitest";
import { composeDraft, syncDraft, quoteTotals, quotesForLead, renderTemplate, safeUrl, selectedDemos, shareBlocker, nextQuoteNumber, quoteError, pickTemplate, builtInTemplates, templateVars, type Quotation, type Demo } from "./studio";

const q = (p: Partial<Quotation> = {}): Quotation => ({ id: "q1", number: "SF-Q-2026-001", leadId: "l1", clientName: "Rohan Kapoor", title: "Basic Website", issueDate: "2026-10-21", validUntil: "2026-11-20", items: [{ id: "i", description: "Site", qty: 1, unitPrice: 15000 }], discountType: "flat", discount: 0, gstEnabled: false, gstRate: 18, status: "ready", revision: 1, history: [], createdAt: "", updatedAt: "", ...p });
const demo = (p: Partial<Demo>): Demo => ({ id: "d", title: "Demo", url: "https://a.com", category: "Other", tags: [], active: true, order: 0, includeByDefault: false, ...p });

describe("quotation totals", () => {
  it("sums line items, applies percent discount then GST", () => {
    const t = quoteTotals({ items: [{ id: "a", description: "x", qty: 2, unitPrice: 10000 }, { id: "b", description: "y", qty: 1, unitPrice: 5000 }], discountType: "percent", discount: 10, gstEnabled: true, gstRate: 18 });
    expect(t).toMatchObject({ subtotal: 25000, discount: 2500, taxable: 22500, gst: 4050, total: 26550 });
  });
  it("caps a flat discount at the subtotal and ignores GST when disabled", () => {
    expect(quoteTotals({ items: [{ id: "a", description: "x", qty: 1, unitPrice: 1000 }], discountType: "flat", discount: 5000, gstEnabled: false, gstRate: 18 }).total).toBe(0);
  });
  it("rounds to paise", () => {
    expect(quoteTotals({ items: [{ id: "a", description: "x", qty: 3, unitPrice: 333.333 }], discountType: "flat", discount: 0, gstEnabled: true, gstRate: 18 }).total).toBe(1180);
  });
});

describe("quotations per client", () => {
  const all = [q(), q({ id: "q2", title: "Business Website" }), q({ id: "q3", title: "Premium 3D" }), q({ id: "q4", leadId: "l2" })];
  it("keeps multiple quotations for the same client", () => expect(quotesForLead(all, "l1")).toHaveLength(3));
  it("never returns another client's quotation", () => {
    expect(quotesForLead(all, "l2").map((x) => x.id)).toEqual(["q4"]);
    expect(quotesForLead(all, null)).toEqual([]);
  });
  it("numbers sequentially per year", () => expect(nextQuoteNumber(all.concat(q({ number: "SF-Q-2026-007" })), 2026)).toBe("SF-Q-2026-008"));
  it("blocks sharing drafts and expired quotations", () => {
    expect(shareBlocker(q({ status: "draft" }), "2026-10-21")).toMatch(/Ready/);
    expect(shareBlocker(q({ validUntil: "2026-10-01" }), "2026-10-21")).toMatch(/expired/);
    expect(shareBlocker(q(), "2026-10-21")).toBeNull();
  });
  it("rejects validity before the quotation date", () => expect(quoteError(q({ validUntil: "2026-10-01" }))).toMatch(/Validity/));
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
  it("uses the selected quotation's real total", () => {
    const out = composeDraft({ ...base, purpose: "quotation", templates: builtInTemplates(), quote: q({ items: [{ id: "i", description: "Site", qty: 1, unitPrice: 30000 }] }) });
    expect(out).toContain("₹30,000");
    expect(out).toContain("SF-Q-2026-001");
  });
  it("never mentions a PDF when the client has no quotation", () => {
    expect(composeDraft({ ...base, purpose: "quotation", templates: builtInTemplates() })).not.toMatch(/PDF|\{/);
  });
});

describe("unsaved composer edits", () => {
  it("follows the latest template when untouched", () => expect(syncDraft({ text: "old", base: "old", edited: false }, "new")).toEqual({ text: "new", base: "new", notice: false }));
  it("keeps a manually edited draft and raises a notice instead", () => expect(syncDraft({ text: "my words", base: "old", edited: true }, "new")).toEqual({ text: "my words", base: "old", notice: true }));
});
