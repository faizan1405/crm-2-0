import { beforeEach, describe, expect, it } from "vitest";
import { migrateQuotations, useCRM } from "./store";
import { builtInTemplates, emptyQuotationTemplate, pickTemplate, type QuotationTemplate } from "./studio";

const pkg = (name: string, price?: number): QuotationTemplate => ({ ...emptyQuotationTemplate(), name, ...(price ? { priceType: "fixed", priceAmount: price } : { priceType: "custom", priceLabel: "On request" }), messageBody: "Hi {clientName}, {packageName} is {packagePrice}." });
const s = () => useCRM.getState();

beforeEach(() => { localStorage.clear(); s().reset(); useCRM.setState({ quotationTemplates: [], quotationShares: [], legacyQuotations: [], waTemplates: builtInTemplates(), demos: [] }); });

describe("Quotation templates store", () => {
  it("creates, edits, duplicates and deletes a package", () => {
    const id = s().saveQuotationTemplate(pkg("Starter", 15000))!;
    expect(s().quotationTemplates).toHaveLength(1);
    s().saveQuotationTemplate({ ...s().quotationTemplates[0]!, priceAmount: 18000 });
    expect(s().quotationTemplates[0]!.priceAmount).toBe(18000);
    const copy = s().duplicateQuotationTemplate(id)!;
    expect(s().quotationTemplates.find((x) => x.id === copy)!.name).toBe("Starter (copy)");
    s().deleteQuotationTemplate(id);
    expect(s().quotationTemplates.map((x) => x.id)).toEqual([copy]);
  });
  it("rejects a fixed package without a price but accepts a custom price", () => {
    expect(s().saveQuotationTemplate({ ...pkg("X", 1), priceAmount: undefined })).toBeNull();
    expect(s().saveQuotationTemplate(pkg("Custom"))).not.toBeNull();
  });
  it("activates, deactivates and reorders", () => {
    const a = s().saveQuotationTemplate(pkg("A", 1000))!, b = s().saveQuotationTemplate(pkg("B", 2000))!;
    s().setQuotationTemplateActive(a, false);
    expect(s().quotationTemplates.find((x) => x.id === a)!.isActive).toBe(false);
    s().moveQuotationTemplate(b, -1);
    expect([...s().quotationTemplates].sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.id)).toEqual([b, a]);
  });
  it("never changes deals, payments or follow-ups", () => {
    const before = JSON.stringify([s().deals, s().payments, s().followUps]);
    const id = s().saveQuotationTemplate(pkg("Site", 99999))!;
    s().logQuotationShare({ leadId: s().leads[0]!.id, templateId: id, packageNameSnapshot: "Site", priceSnapshot: "₹99,999", messageSnapshot: "x", userConfirmedSent: true });
    expect(JSON.stringify([s().deals, s().payments, s().followUps])).toBe(before);
  });
  it("keeps share snapshots unchanged when the package is edited later", () => {
    const id = s().saveQuotationTemplate(pkg("Premium", 45000))!;
    s().logQuotationShare({ leadId: s().leads[0]!.id, templateId: id, packageNameSnapshot: "Premium", priceSnapshot: "₹45,000", messageSnapshot: "Premium is ₹45,000.", userConfirmedSent: true });
    s().saveQuotationTemplate({ ...s().quotationTemplates[0]!, priceAmount: 50000 });
    expect(s().quotationShares[0]!.priceSnapshot).toBe("₹45,000");
    expect(s().quotationShares[0]!.messageSnapshot).toBe("Premium is ₹45,000.");
  });
  it("moves old billing quotations into a backup without converting them", () => {
    const old = [{ id: "q1", title: "Old site", items: [{ id: "i", description: "Design", qty: 1, unitPrice: 5000 }] }];
    const out = migrateQuotations({ quotations: old, deals: ["d"] }, 2);
    expect(out["legacyQuotations"]).toEqual(old);
    expect(out["quotationTemplates"]).toEqual([]);
    expect(out["quotations"]).toBeUndefined();
    expect(out["deals"]).toEqual(["d"]);
  });
  it("rejects demos with unsafe links", () => {
    expect(s().saveDemo({ id: "d", title: "Bad", url: "javascript:alert(1)", category: "Other", tags: [], active: true, order: 0, includeByDefault: true })).toBe(false);
  });
  it("makes a saved WhatsApp template the one the composer picks", () => {
    const t = pickTemplate(s().waTemplates, "followup")!;
    s().saveTemplate({ ...t, body: "Changed {firstName}" });
    expect(pickTemplate(s().waTemplates, "followup")!.body).toBe("Changed {firstName}");
  });
  it("survives a page refresh", async () => {
    s().saveQuotationTemplate(pkg("Persisted", 5000));
    s().saveDemo({ id: "d1", title: "Shop", url: "https://shop.example.com", category: "E-commerce", tags: [], active: true, order: 0, includeByDefault: true });
    const saved = localStorage.getItem("scale-flow-crm-2-demo")!;
    useCRM.setState({ quotationTemplates: [], demos: [] });
    localStorage.setItem("scale-flow-crm-2-demo", saved);
    await useCRM.persist.rehydrate();
    expect(s().quotationTemplates.map((x) => x.name)).toEqual(["Persisted"]);
    expect(s().demos.map((x) => x.title)).toEqual(["Shop"]);
  });
});
