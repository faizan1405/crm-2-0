import { describe, it, expect } from "vitest";
import { demoNote, structureNote, detectActions, sentences, NOT_DISCUSSED, NOTES_DEMO_LABEL } from "./notes";
import { protectedTokens } from "./rewrite";
import { offerNoteDraft, takeNoteDraft, useNoteDrafts } from "./noteDraft";
import type { LeadContext } from "./types";

const lead: LeadContext = { leadId: "l1", name: "Asha", stage: "New", priority: "medium", source: "Website", recentActivity: [], pendingFollowUps: 0, excluded: [],
  facts: { statusKey: "new", hasEmail: true, callAttempts: 0, connectedCalls: 0, unsuccessfulStreak: 0, overdueFollowUp: false } };
const ROUGH = "needs 5 page website with booking form. old site is slow, no enquiries. budget ₹40,000. said its too expensive vs other agency. will send logo by 12/11. see https://ex.test/a?b=1 #web";

describe("AI-3C note preservation", () => {
  it("structure keeps every sentence, amount, date and link", () => {
    const r = demoNote({ mode: "structure", text: ROUGH, lead });
    for (const t of protectedTokens(ROUGH)) expect(r.text).toContain(t);
    expect(r.violations).toEqual([]);
    expect(r.label).toBe(NOTES_DEMO_LABEL);
  });
  it("improve keeps all tokens and doesn't add facts", () => {
    const t = "client Zoë ne bola kal call karo, ₹1.5L budget, नमस्ते!";
    const r = demoNote({ mode: "improve", text: t });
    expect(r.violations).toEqual([]); expect(r.text).toContain("Zoë"); expect(r.text).toContain("नमस्ते");
  });
  it("unknown sections say Not discussed; missing budget flagged", () => {
    const s = structureNote("Needs an ecommerce website.", lead).summary;
    expect(s.sections.find((x) => x.id === "budget")!.lines).toEqual([]);
    expect(s.missing).toContain(`Budget: ${NOT_DISCUSSED}`);
    expect(structureNote("Needs an ecommerce website.", lead).text).toContain(`- ${NOT_DISCUSSED}`);
  });
  it("unsupported note is preserved and marked unsupported", () => {
    const r = demoNote({ mode: "structure", text: "blah xyz qwerty" });
    expect(r.supported).toBe(false); expect(r.text).toContain("Blah xyz qwerty");
  });
  it("sentences never drop text", () => expect(sentences("a. b!\nc").join(" ")).toBe("a. b! c"));
});

describe("AI-3C action items", () => {
  it("ambiguous date asks for confirmation", () => {
    const a = detectActions("Busy right now, call me back next week.");
    const f = a.find((x) => x.kind === "follow_up")!;
    expect(f.dateText).toBe("next week"); expect(f.confirmDate).toBe(true);
  });
  it("objection and quotation detected", () => {
    const k = detectActions("Too expensive. Wants a quotation.").map((x) => x.kind);
    expect(k).toContain("discuss_objection"); expect(k).toContain("prepare_quotation");
  });
});

describe("AI-3C draft hand-off", () => {
  it("is per lead, taken once, never leaks", () => {
    offerNoteDraft("a", "for A"); offerNoteDraft("b", "for B");
    expect(takeNoteDraft("a")).toBe("for A"); expect(takeNoteDraft("a")).toBeUndefined();
    expect(useNoteDrafts.getState().drafts).toEqual({ b: "for B" }); takeNoteDraft("b");
  });
  it("demo note does not mutate the lead context", () => {
    const snap = JSON.stringify(lead); demoNote({ mode: "structure", text: ROUGH, lead }); expect(JSON.stringify(lead)).toBe(snap);
  });
});
