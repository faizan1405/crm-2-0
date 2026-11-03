import { describe, it, expect, vi } from "vitest";
import { demoRewrite, rewriteViolations, detectScenario, protectedTokens, getRewriteProvider, demoRewriteProvider, tidy } from "./rewrite";

const req = (draft: string, o: Partial<Parameters<typeof demoRewrite>[0]> = {}) => ({ draft, tone: "professional" as const, lang: "en" as const, variant: 0, firstName: "Asha", ...o });

describe("AI-3A demo rewrite", () => {
  it("keeps every figure, link and tag and adds none", () => {
    const d = "hi, quotation for website is ₹40,000 & delivery 12/11 ? see https://x.test/a #web — नमस्ते";
    const r = demoRewrite(req(d));
    expect(rewriteViolations(d, r.text)).toEqual([]);
    for (const t of ["₹40,000", "12/11", "https://x.test/a", "#web", "नमस्ते", "&", "?"]) expect(r.text).toContain(t);
  });
  it("never invents prices or dates for any tone/language/variant", () => {
    const d = "please share the logo and content for the homepage";
    for (const tone of ["professional", "friendly", "short", "persuasive"] as const) for (const lang of ["keep", "en", "hi", "hinglish"] as const) for (const variant of [0, 1]) {
      const r = demoRewrite(req(d, { tone, lang, variant }));
      expect(protectedTokens(r.text)).toEqual([]);
    }
  });
  it("detects representative scenarios", () => {
    expect(detectScenario("following up on the quotation")).toBe("quotation_followup");
    expect(detectScenario("haven't heard back from you")).toBe("not_responding");
    expect(detectScenario("please send pending content and logo")).toBe("requirements");
    expect(detectScenario("reminder: balance payment due")).toBe("payment_reminder");
    expect(detectScenario("this is Ravi from Scale Flow")).toBe("introduction");
    expect(detectScenario("ok see you")).toBe("generic");
  });
  it("generic text is labelled as a light tidy-up, not a real rewrite", () => {
    expect(demoRewrite(req("ok see you")).notice).toMatch(/can't genuinely rewrite/);
  });
  it("Try again gives a different deterministic variant", () => {
    const a = demoRewrite(req("following up on the quotation", { variant: 0 })), b = demoRewrite(req("following up on the quotation", { variant: 1 }));
    expect(a.text).not.toBe(b.text);
    expect(demoRewrite(req("following up on the quotation", { variant: 2 })).text).toBe(a.text);
  });
  it("Hindi and Hinglish frames; user words kept", () => {
    expect(demoRewrite(req("kal call karte hain", { lang: "keep" })).text).toMatch(/Namaste Asha ji|Hi Asha/);
    const h = demoRewrite(req("payment pending hai", { lang: "hi" }));
    expect(h.text).toContain("नमस्ते Asha");
    expect(h.text).toContain("Payment pending hai");
  });
  it("flags a suggestion that drops or adds a figure", () => {
    expect(rewriteViolations("price ₹5,000", "price is fine")).toEqual(["Missing “₹5,000”"]);
    expect(rewriteViolations("price ok", "price ₹9,999")).toEqual(["Added “₹9,999”"]);
  });
  it("tidy only adjusts spacing/case/punctuation", () => {
    expect(tidy("hello   sir,  i will send  it")).toBe("I will send it.");
  });
  it("provider is the demo one, makes no network request, rejects empty drafts", async () => {
    vi.useFakeTimers();
    const f = vi.spyOn(globalThis, "fetch");
    expect(getRewriteProvider()).toBe(demoRewriteProvider);
    await expect(demoRewriteProvider.rewrite(req("  "))).rejects.toMatchObject({ code: "invalid" });
    const p = demoRewriteProvider.rewrite(req("simulate error"));
    const caught = p.catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toMatchObject({ retryable: true });
    expect(f).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
