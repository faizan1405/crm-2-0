import { describe, it, expect } from "vitest";
import { buildFollowUpFacts, demoFollowUpDraft, draftViolations, suggestPurpose, FU_DEMO_LABEL, type FollowUpFacts } from "./followupWriter";
import { buildLeadContext } from "./context";
import type { Lead, LeadActivity } from "@/lib/crm/types";

const base: FollowUpFacts = { leadId: "l1", firstName: "Asha", stage: "Contacted", statusKey: "contacted", requirement: "Bakery website", quotationSent: false, unsuccessfulCalls: 0 };
const D = (p: Partial<FollowUpFacts>, purpose: Parameters<typeof demoFollowUpDraft>[0]["purpose"], lang: "en" | "hi" | "hinglish" = "en") => demoFollowUpDraft({ facts: { ...base, ...p }, purpose, tone: "professional", lang, variant: 0 });

describe("AI-4B follow-up writer", () => {
  it("uses the lead's own name and requirement and is labelled Demo Mode", () => {
    const r = D({}, "first_enquiry");
    expect(r.text).toContain("Asha");
    expect(r.text).toContain("Bakery website");
    expect(r.label).toBe(FU_DEMO_LABEL);
  });
  it("never claims a quotation was sent when none is recorded", () => {
    const r = D({}, "after_quotation");
    expect(r.text).not.toMatch(/quotation I shared/);
    expect(r.notices.join(" ")).toMatch(/No quotation is recorded/);
    expect(D({ quotationSent: true, quotationPackage: "Starter" }, "after_quotation").text).toContain("Starter quotation I shared");
  });
  it("adds no numbers, prices or dates of its own", () => {
    for (const p of ["first_enquiry", "unanswered_call", "no_response", "pending_requirements", "confirm_followup", "reconnect"] as const)
      for (const l of ["en", "hi", "hinglish"] as const) expect(draftViolations(base, "", D({}, p, l).text)).toEqual([]);
  });
  it("blocks a suggestion edited to include a new price or a dropped name", () => {
    expect(draftViolations(base, "", "Hello Asha, special offer ₹9,999 today")).toContain("Added “₹9,999”");
    expect(draftViolations(base, "", "Hello there")).toContain("Missing name “Asha”");
    expect(draftViolations(base, "Price ₹5,000 visit https://x.in", "Hello Asha, ₹5,000 https://x.in")).toEqual([]);
  });
  it("uses neutral wording when the requirement is missing", () => {
    const { requirement: _r, ...thin } = base;
    const r = demoFollowUpDraft({ facts: thin, purpose: "no_response", tone: "short", lang: "en", variant: 0 });
    expect(r.text).toContain("your requirement");
    expect(r.contextUsed).toContain("Requirement: not recorded");
  });
  it("won leads get an after-sales check-in, not a pitch", () => {
    expect(D({ statusKey: "won", stage: "Won" }, "no_response").text).toMatch(/Thank you for working with us/);
  });
  it("suggests purposes from recorded facts", () => {
    expect(suggestPurpose({ ...base, unsuccessfulCalls: 2 })).toBe("unanswered_call");
    expect(suggestPurpose({ ...base, statusKey: "proposal", quotationSent: true })).toBe("after_quotation");
    expect(suggestPurpose({ ...base, statusKey: "new" })).toBe("first_enquiry");
  });
  it("facts belong to the chosen lead only; another lead's quotation share is ignored", () => {
    const L = (id: string, name: string): Lead => ({ id, name, phone: "9000000000", source: "Website", status: "proposal", priority: "warm", pinned: false, createdAt: "x", updatedAt: "x" } as Lead);
    const src = { leads: [L("a", "Asha Rao"), L("b", "Bilal Khan")], activities: [] as LeadActivity[], followUps: [], deals: [], payments: [], assignments: {} };
    const ctx = buildLeadContext(src, "a", null);
    if (!ctx.ok) throw new Error("ctx");
    const f = buildFollowUpFacts(ctx.lead, [{ leadId: "b", packageNameSnapshot: "Pro" }]);
    expect(f.leadId).toBe("a");
    expect(f.firstName).toBe("Asha");
    expect(f.quotationSent).toBe(false);
  });
});
