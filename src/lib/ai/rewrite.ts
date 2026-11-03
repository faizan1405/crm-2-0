// AI-3A WhatsApp "AI Improve" — contracts + deterministic Demo rewriter.
// Demo Mode never invents facts: the user's own wording is kept verbatim (tidied) and wrapped
// in a fixed greeting/framing/closing for the chosen tone and language. No network, no CRM writes.

export type RewriteTone = "professional" | "friendly" | "short" | "persuasive";
export type RewriteLang = "keep" | "en" | "hi" | "hinglish";
export type RewriteScenario = "quotation_followup" | "not_responding" | "requirements" | "payment_reminder" | "introduction" | "generic";

export const TONE_LABEL: Record<RewriteTone, string> = { professional: "Professional", friendly: "Friendly", short: "Short & Direct", persuasive: "Persuasive but respectful" };
export const LANG_LABEL: Record<RewriteLang, string> = { keep: "Keep my language", en: "English", hi: "Hindi", hinglish: "Hinglish" };
export const SCENARIO_LABEL: Record<RewriteScenario, string> = { quotation_followup: "Quotation follow-up", not_responding: "Client not responding", requirements: "Pending requirements", payment_reminder: "Payment reminder", introduction: "Introduction", generic: "General message" };
export const DEMO_REWRITE_LABEL = "Demo Mode · fixed example wording, not a live AI rewrite";

/** Only the minimum the future provider needs: the draft and the client's first name. No history, no money. */
export interface RewriteRequest { draft: string; tone: RewriteTone; lang: RewriteLang; variant: number; firstName?: string }
export interface RewriteResult { text: string; scenario: RewriteScenario; simulated: true; label: string; notice?: string }
export interface RewriteProvider { rewrite(req: RewriteRequest): Promise<RewriteResult> }

const RULES: [RewriteScenario, RegExp][] = [
  ["payment_reminder", /\b(payment|pay|paid|due|balance|invoice|pending amount|bhugtan|bakaya)\b|भुगतान|बकाया/i],
  ["quotation_followup", /\b(quote|quotation|proposal|estimate|pricing)\b|कोटेशन/i],
  ["requirements", /\b(requirement|content|logo|images?|photos?|details|material|text)\b|जानकारी/i],
  ["not_responding", /\b(no reply|not respond|haven'?t heard|no response|reply nahi|jawab|busy)\b|जवाब/i],
  ["introduction", /\b(introduc|i am|i'm|this is|myself|mera naam|main .* (se|from))\b|मेरा नाम/i],
];
export function detectScenario(draft: string): RewriteScenario {
  for (const [s, re] of RULES) if (re.test(draft)) return s;
  return "generic";
}

/** Tokens that must survive any rewrite unchanged: amounts, numbers, dates, URLs, #tags, emails. */
export function protectedTokens(s: string): string[] {
  const re = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+|₹\s?[\d,]+(?:\.\d+)?(?:\s?(?:k|K|L|lakh|Cr))?|#\w+|\d[\d,./:-]*\d|\d/g;
  return [...new Set((s.match(re) ?? []).map((t) => t.trim()))];
}
/** Problems with a suggested rewrite: original facts dropped, or new figures/links added. */
export function rewriteViolations(original: string, improved: string): string[] {
  const o = protectedTokens(original), i = protectedTokens(improved);
  return [...o.filter((t) => !improved.includes(t)).map((t) => `Missing “${t}”`), ...i.filter((t) => !original.includes(t)).map((t) => `Added “${t}”`)];
}

/** Light, meaning-preserving tidy-up of the user's own words. */
export function tidy(draft: string): string {
  let s = draft.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  s = s.replace(/^(hi|hello|hey|namaste|dear)\b[^\n,.!]*[,.!]?\s*/i, ""); // greeting is re-added once
  s = s.replace(/(^|[.!?]\s+|\n)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  s = s.replace(/\bi\b/g, "I");
  if (s && !/[.!?।)\]]$/.test(s) && !/[\u{1F300}-\u{1FAFF}]$/u.test(s)) s += ".";
  return s;
}


const HINGLISH = /\b(hai|hain|kya|aap|ap|kar|karo|karna|nahi|bhi|ji|haan|kal|abhi|thoda|bata|batao|dijiye|kijiye)\b/i;
export function detectLang(s: string): Exclude<RewriteLang, "keep"> { const dev = (s.match(/[\u0900-\u097F]/g) ?? []).length, lat = (s.match(/[A-Za-z]/g) ?? []).length; return dev > lat ? "hi" : HINGLISH.test(s) ? "hinglish" : "en"; }

type Frame = { hi: string; open: string[]; close: string[] };
const FRAMES: Record<Exclude<RewriteLang, "keep">, Record<RewriteTone, Frame>> = {
  en: {
    professional: { hi: "Hello {name},", open: ["", "I hope you're doing well."], close: ["Please let me know if you have any questions.", "Looking forward to hearing from you."] },
    friendly: { hi: "Hi {name}!", open: ["Hope you're having a good day.", ""], close: ["Let me know what you think 😊", "Happy to help with anything!"] },
    short: { hi: "Hi {name},", open: ["", ""], close: ["Thanks.", "Thank you."] },
    persuasive: { hi: "Hello {name},", open: ["", "I wanted to check in personally."], close: ["Whenever you're ready, I'm happy to take the next step with you — no pressure.", "If it helps, I can walk you through it on a quick call at your convenience."] },
  },
  hinglish: {
    professional: { hi: "Namaste {name} ji,", open: ["", "Ummeed hai aap theek hain."], close: ["Koi bhi sawaal ho to zaroor batayein.", "Aapke reply ka intezaar rahega."] },
    friendly: { hi: "Hi {name}!", open: ["Kaise hain aap?", ""], close: ["Batayiye kya lagta hai 😊", "Kuch bhi chahiye to bata dijiye!"] },
    short: { hi: "Hi {name},", open: ["", ""], close: ["Dhanyavaad.", "Thanks."] },
    persuasive: { hi: "Namaste {name} ji,", open: ["", "Bas personally check karna chahta tha."], close: ["Jab aap ready hon, hum aage badh sakte hain — koi jaldi nahi.", "Chahein to ek chhoti call par samjha deta hoon, aapke time ke hisaab se."] },
  },
  hi: {
    professional: { hi: "नमस्ते {name} जी,", open: ["", "आशा है आप कुशल हैं।"], close: ["कोई भी प्रश्न हो तो ज़रूर बताइए।", "आपके उत्तर की प्रतीक्षा रहेगी।"] },
    friendly: { hi: "नमस्ते {name}!", open: ["कैसे हैं आप?", ""], close: ["बताइए आपको कैसा लगा 😊", "कुछ भी चाहिए तो बताइए!"] },
    short: { hi: "नमस्ते {name},", open: ["", ""], close: ["धन्यवाद।", "शुक्रिया।"] },
    persuasive: { hi: "नमस्ते {name} जी,", open: ["", "बस व्यक्तिगत रूप से जानना चाहता था।"], close: ["जब आप तैयार हों, हम आगे बढ़ सकते हैं — कोई जल्दी नहीं।", "चाहें तो आपकी सुविधा से एक छोटी कॉल पर समझा दूँ।"] },
  },
};

export function demoRewrite(req: RewriteRequest): RewriteResult {
  const core = tidy(req.draft);
  const scenario = detectScenario(req.draft);
  const src = detectLang(req.draft);
  const lang = req.lang === "keep" ? src : req.lang;
  const f = FRAMES[lang][req.tone];
  const v = Math.abs(req.variant) % 2;
  const name = req.firstName?.trim();
  const greet = name ? f.hi.replace("{name}", name) : f.hi.replace(/ \{name\}( ji| जी)?/, "");
  const text = [greet, [f.open[v], core].filter(Boolean).join(" "), f.close[v]].filter(Boolean).join("\n\n");
  const notes: string[] = [];
  if (lang !== src) notes.push(`Demo Mode can't translate your words — only the greeting and closing are in ${LANG_LABEL[lang]}; your own sentences are kept as you wrote them.`);
  if (scenario === "generic") notes.push("Demo Mode can't genuinely rewrite arbitrary messages — this is a light tidy-up with a fixed greeting and closing.");
  return { text, scenario, simulated: true, label: DEMO_REWRITE_LABEL, ...(notes.length ? { notice: notes.join(" ") } : {}) };
}

export const demoRewriteProvider: RewriteProvider = {
  async rewrite(req) {
    if (!req.draft.trim()) throw { code: "invalid", message: "Type a message first.", retryable: false };
    await new Promise((r) => setTimeout(r, 450));
    if (/\bsimulate error\b/i.test(req.draft)) throw { code: "unavailable", message: "Couldn't prepare a suggestion right now.", retryable: true };
    return demoRewrite(req);
  },
};
/** Swap point for the future secure server endpoint. */
export const getRewriteProvider = (): RewriteProvider => demoRewriteProvider;
