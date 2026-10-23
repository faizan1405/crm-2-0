import { describe, it, expect, beforeEach } from "vitest";
import { normalizePhone, normalizeEmail, findDuplicates, buildRows, filterRows, overview, firstContact, intakeDecision, pairKey, mergeBlockers } from "./inbox";
import { placeholderIssues, renderTemplate, quotationTemplateError, renderQuotation, type QuotationTemplate } from "./studio";
import { deriveEvents, NOTIFY_OF, type EventSnap } from "./activity";
import { CATEGORIES } from "./vault";
import { allows } from "./session";
import type { Lead } from "./types";

const now = new Date("2026-10-20T10:00:00Z");
const L = (id: string, p: Partial<Lead> = {}): Lead => ({ id, name: `Lead ${id}`, phone: `98765000${id.padStart(2, "0")}`, source: "Website", status: "new", priority: "warm", pinned: false, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", ...p });

describe("phone & email normalization", () => {
  it("treats Indian formats as the same number", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizePhone("9876543210")).toBe("919876543210");
    expect(normalizePhone("+91-98765-43210")).toBe("919876543210");
    expect(normalizePhone("098765 43210")).toBe("919876543210");
  });
  it("never collides different countries sharing the last 10 digits", () => {
    expect(normalizePhone("+1 9876543210")).not.toBe(normalizePhone("+91 9876543210"));
  });
  it("email is trimmed and case-insensitive only", () => {
    expect(normalizeEmail("  Ravi@Mail.COM ")).toBe("ravi@mail.com");
    expect(normalizeEmail("ravi.k+x@gmail.com")).not.toBe(normalizeEmail("ravik@gmail.com"));
  });
});

describe("duplicate detection", () => {
  it("finds exact phone and email matches", () => {
    const leads = [L("1", { phone: "+91 98765 43210" }), L("2", { phone: "9876543210" }), L("3", { email: "a@x.com" }), L("4", { email: " A@X.com" })];
    const pairs = findDuplicates(leads);
    expect(pairs.find((p) => p.key === pairKey("1", "2"))?.reasons).toEqual(["phone"]);
    expect(pairs.find((p) => p.key === pairKey("3", "4"))?.reasons).toEqual(["email"]);
    expect(pairs.every((p) => p.strength === "confirmed")).toBe(true);
  });
  it("name-only similarity is never a duplicate; name+company is only a suggestion", () => {
    expect(findDuplicates([L("1", { name: "Ravi" }), L("2", { name: "Ravi" })])).toHaveLength(0);
    const p = findDuplicates([L("1", { name: "Ravi", company: "Acme" }), L("2", { name: "ravi", company: "ACME" })]);
    expect(p[0]?.strength).toBe("suggested");
  });
  it("Keep Separate and Related decisions remove the pair", () => {
    const leads = [L("1", { phone: "9876543210" }), L("2", { phone: "+919876543210" })];
    const rel = { [pairKey("1", "2")]: { key: pairKey("1", "2"), a: "1", b: "2", kind: "separate" as const, at: "" } };
    expect(findDuplicates(leads, rel)).toHaveLength(0);
    expect(findDuplicates(leads, { ...rel, [pairKey("1", "2")]: { ...rel[pairKey("1", "2")]!, kind: "related" } })).toHaveLength(0);
  });
});

describe("inbox rows, filters and counts", () => {
  const leads = [L("1", { source: "Meta Ads" }), L("2", { source: "Meta Ads", createdAt: "2026-09-01T00:00:00Z" }), L("3"), L("4", { status: "won" })];
  const rows = () => buildRows({ leads, meta: { "3": { reviewedAt: "2026-10-20T09:00:00Z" } }, assignments: { "1": { employeeId: "e1", assignedAt: "2026-10-20T08:00:00Z", source: "x", manual: true } }, activities: [{ id: "a", leadId: "3", type: "call", text: "", at: "" }], followUps: [], dupIds: new Set(), now });
  it("inbox status never changes pipeline stage or priority", () => {
    const r = rows().find((x) => x.lead.id === "3")!;
    expect(r.status).toBe("reviewed"); expect(r.lead.status).toBe("new"); expect(r.lead.priority).toBe("warm");
  });
  it("unassigned Meta Ads leads created in the last 7 days", () => {
    expect(filterRows(rows(), "all", { source: "Meta Ads", assignee: "unassigned", createdDays: 7 }, now).map((r) => r.lead.id)).toEqual([]);
    expect(filterRows(rows(), "all", { source: "Meta Ads", createdDays: 7 }, now).map((r) => r.lead.id)).toEqual(["1"]);
    expect(filterRows(rows(), "needs_review", { source: "Meta Ads" }, now).map((r) => r.lead.id).sort()).toEqual(["1", "2"]);
  });
  it("overview counts come from records", () => {
    const o = overview(rows(), now);
    expect(o.awaitingReview).toBe(2); // 1,2 (3 reviewed, 4 won)
    expect(o.unassigned).toBe(2); // 2,3
    expect(o.needFirstContact).toBe(2); // 3 has a logged call
    expect(o.recent).toBe(3);
  });
  it("clicking Call is not a contact — only saved records count", () => {
    expect(firstContact("x", [], [])).toBe("not_contacted");
    expect(firstContact("x", [{ id: "1", leadId: "x", type: "whatsapp", text: "", at: "" }], [])).toBe("attempt");
    expect(firstContact("x", [], [{ id: "f", leadId: "x", type: "call", dueAt: "" }])).toBe("followup");
  });
});

describe("merge safety & intake contract", () => {
  it("merge is not activated and explains why", () => {
    expect(mergeBlockers({ activities: 1, followUps: 0, deals: 1, payments: 1, proofs: 0, assigned: false }).length).toBeGreaterThan(1);
  });
  it("intake is idempotent and never auto-merges", () => {
    const leads = [L("1", { phone: "9876543210" })];
    const e = { channel: "meta_lead_form" as const, externalId: "m1", receivedAt: "", name: "X", phone: "+91 98765 43210", source: "Meta Ads" };
    expect(intakeDecision(e, leads, new Set(["meta_lead_form:m1"]))).toEqual({ action: "skip_duplicate_event", externalId: "m1" });
    expect(intakeDecision(e, leads, new Set())).toEqual({ action: "review_duplicate", matchId: "1", reason: "phone" });
    expect(intakeDecision({ ...e, phone: "+1 2025550100" }, leads, new Set())).toEqual({ action: "create" });
  });
});

describe("placeholders", () => {
  it("detects unsupported and malformed tokens", () => {
    expect(placeholderIssues("Hi {{client_name}}")).toEqual(["{{client_name}}"]);
    expect(placeholderIssues("Hi {foo}")).toEqual(["{foo}"]);
    expect(placeholderIssues("Hi {firstName")).toEqual(["an unmatched { or }"]);
    expect(placeholderIssues("Hi {firstName}, {packageName} at {packagePrice}.")).toEqual([]);
  });
  it("unknown tokens no longer delete the sentence", () => {
    expect(renderTemplate("Hi {{client_name}}. Thanks!", { firstName: "Ravi" })).toBe("Hi {{client_name}}. Thanks!");
  });
  it("quotation save is blocked with a clear message; valid templates still render", () => {
    const t = { name: "Basic", priceType: "fixed", priceAmount: 9999, messageBody: "Hi {{client_name}}" } as QuotationTemplate;
    expect(quotationTemplateError(t)).toMatch(/Unsupported placeholder/);
    const ok = { ...t, id: "q", messageBody: "Hi {firstName}, {packageName} is {packagePrice}.", isActive: true, sortOrder: 0, createdAt: "", updatedAt: "" } as QuotationTemplate;
    expect(quotationTemplateError(ok)).toBeNull();
    expect(renderQuotation(ok, { name: "Ravi Kumar" }, { owner: "F", business: "B" })).toContain("Hi Ravi, Basic is");
  });
});

describe("activity, permissions & vault", () => {
  const base: EventSnap = { leads: Array.from({ length: 6 }, (_, i) => L(String(i))), followUps: [], deals: [], payments: [], activities: [], assignments: {}, employees: [], employeeAccess: {}, inboxMeta: {}, leadRelations: {} };
  const ctx = { action: "markReviewed", operationId: "op1", at: "", actor: { id: "owner", role: "owner", name: "Owner" } };
  it("bulk review writes one summary event and never notifies", () => {
    const next = { ...base, inboxMeta: Object.fromEntries(base.leads.map((l) => [l.id, { reviewedAt: "t" }])) };
    const ev = deriveEvents(base, next, ctx);
    expect(ev.filter((e) => e.eventType === "lead.reviewed")).toHaveLength(1);
    expect(NOTIFY_OF["lead.reviewed"]).toBeUndefined();
  });
  it("relation decisions record lead.related / duplicate_resolved", () => {
    const next = { ...base, leadRelations: { k: { a: "1", b: "2", kind: "related" } } };
    expect(deriveEvents(base, next, { ...ctx, action: "resolveDuplicate" }).map((e) => e.eventType)).toEqual(["lead.related"]);
  });
  it("employees can never resolve duplicates (Owner-only)", () => {
    expect(allows({ employeeId: "e", name: "E", role: "salesperson", grants: ["__owner", "leads.edit"] } as never, "__owner")).toBe(false);
  });
  it("Full backup covers inbox data", () => {
    const keys = CATEGORIES.flatMap((c) => c.keys);
    expect(keys).toContain("inboxMeta"); expect(keys).toContain("leadRelations");
  });
});
