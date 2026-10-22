import { beforeEach, describe, expect, it } from "vitest";
import { useCRM } from "./store";
import { builtInTemplates, pickTemplate, quotesForLead, type Quotation } from "./studio";

const draft = (leadId: string, title: string, price: number): Quotation => ({ id: `q_${title}`, number: "", leadId, clientName: "Client", title, issueDate: "2026-10-21", validUntil: "2026-11-20", items: [{ id: "i", description: title, qty: 1, unitPrice: price }], discountType: "flat", discount: 0, gstEnabled: false, gstRate: 18, status: "ready", revision: 1, history: [], createdAt: "", updatedAt: "" });

beforeEach(() => { localStorage.clear(); useCRM.getState().reset(); useCRM.setState({ quotations: [], waTemplates: builtInTemplates(), demos: [] }); });

describe("Sales Studio store", () => {
  it("keeps multiple numbered quotations for one client", () => {
    const lead = useCRM.getState().leads[0]!;
    ["Basic", "Business", "Premium"].forEach((t, i) => useCRM.getState().saveQuotation(draft(lead.id, t, 15000 * (i + 1))));
    const mine = quotesForLead(useCRM.getState().quotations, lead.id);
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((x) => x.number)).size).toBe(3);
  });
  it("never creates or changes deals or payments when a quotation is saved or shared", () => {
    const lead = useCRM.getState().leads[0]!;
    const before = JSON.stringify([useCRM.getState().deals, useCRM.getState().payments]);
    const id = useCRM.getState().saveQuotation(draft(lead.id, "Site", 99999))!;
    useCRM.getState().setQuoteStatus(id, "accepted");
    expect(JSON.stringify([useCRM.getState().deals, useCRM.getState().payments])).toBe(before);
  });
  it("records a revision when the total changes", () => {
    const lead = useCRM.getState().leads[0]!;
    const id = useCRM.getState().saveQuotation(draft(lead.id, "Site", 10000))!;
    const saved = useCRM.getState().quotations.find((x) => x.id === id)!;
    useCRM.getState().saveQuotation({ ...saved, items: [{ id: "i", description: "Site", qty: 1, unitPrice: 12000 }] });
    expect(useCRM.getState().quotations.find((x) => x.id === id)!.revision).toBe(2);
  });
  it("rejects demos with unsafe links", () => {
    expect(useCRM.getState().saveDemo({ id: "d", title: "Bad", url: "javascript:alert(1)", category: "Other", tags: [], active: true, order: 0, includeByDefault: true })).toBe(false);
    expect(useCRM.getState().demos).toHaveLength(0);
  });
  it("makes a saved template the one the composer picks", () => {
    const t = pickTemplate(useCRM.getState().waTemplates, "followup")!;
    useCRM.getState().saveTemplate({ ...t, body: "Changed {firstName}" });
    expect(pickTemplate(useCRM.getState().waTemplates, "followup")!.body).toBe("Changed {firstName}");
  });
  it("survives a page refresh", async () => {
    const lead = useCRM.getState().leads[0]!;
    useCRM.getState().saveQuotation(draft(lead.id, "Persisted", 5000));
    useCRM.getState().saveDemo({ id: "d1", title: "Shop", url: "https://shop.example.com", category: "E-commerce", tags: [], active: true, order: 0, includeByDefault: true });
    const saved = localStorage.getItem("scale-flow-crm-2-demo")!;
    useCRM.setState({ quotations: [], demos: [] }); // in-memory state lost, as on reload
    localStorage.setItem("scale-flow-crm-2-demo", saved);
    await useCRM.persist.rehydrate();
    expect(useCRM.getState().quotations.map((x) => x.title)).toEqual(["Persisted"]);
    expect(useCRM.getState().demos.map((x) => x.title)).toEqual(["Shop"]);
  });
});
