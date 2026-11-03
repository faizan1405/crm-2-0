// AI-3D Owner Quotation Writing Assistant — contracts + conservative deterministic Demo writer.
// Commercial safety first: amounts, %, durations, tax, hosting/domain lines and {placeholders} the
// Owner wrote are protected tokens; a suggestion that drops or adds one can't be applied.
// Deliverables come only from words the Owner typed. No network, no CRM writes.
// `getQuoteWriter()` is the swap point for a future secure server-side provider.
import { protectedTokens } from "./rewrite";

export type QuoteMode = "improve" | "draft_scope";
export type QuoteLang = "en" | "hinglish" | "hi";
export const QUOTE_LANG_LABEL: Record<QuoteLang, string> = { en: "English", hinglish: "Hinglish", hi: "Hindi" };
export type ProjectType = "business" | "ecommerce" | "portfolio" | "redesign" | "3d" | "unknown";
export const PROJECT_LABEL: Record<ProjectType, string> = { business: "Business website", ecommerce: "E-commerce website", portfolio: "Portfolio website", redesign: "Website redesign", "3d": "3D interactive website", unknown: "Not recognised" };
export const QUOTE_DEMO_LABEL = "Demo Mode · fixed sample structure, not a live AI model";
export const NOT_SPECIFIED = "Not specified — please add";

export interface QuoteRequest {
  mode: QuoteMode;
  /** Current editable package message (never modified by the provider). */
  body: string;
  /** Owner-typed requirements (may include a Lead's recorded requirement the Owner chose to add). */
  requirements?: string;
  lang: QuoteLang;
  variant: number;
}
export interface QuoteResult {
  mode: QuoteMode; text: string; label: string; simulated: true;
  projectType: ProjectType; supported: boolean; notice?: string;
}
export interface QuoteWriter { write(req: QuoteRequest): Promise<QuoteResult> }

const PLACEHOLDER = /\{[a-zA-Z]+\}/g;
const COMMERCIAL_LINE = /₹|%|\b(rs\.?|inr|gst|tax|payment|advance|milestone|installment|hosting|domain|support|maintenance|warranty|timeline|deliver(y|ed)? in|days?|weeks?|months?|year)\b/i;
const DURATION = /\b\d+\s?(days?|weeks?|months?|years?)\b/gi;

/** Values that must survive unchanged: placeholders, ₹, %, numbers, durations, links, dates. */
export function commercialTokens(s: string): string[] {
  const t = new Set<string>([...protectedTokens(s), ...(s.match(PLACEHOLDER) ?? []), ...(s.match(DURATION) ?? []).map((x) => x.toLowerCase())]);
  for (const m of s.match(/\d+(?:\.\d+)?\s?%/g) ?? []) t.add(m.replace(/\s/g, ""));
  return [...t];
}
const norm = (s: string) => s.toLowerCase().replace(/(\d)\s+%/g, "$1%");
/** Why a suggestion can't be applied: protected values dropped, or values not in any source added. */
export function commercialViolations(sources: string[], suggestion: string, mustKeep: string): string[] {
  const keep = commercialTokens(mustKeep), allowed = new Set(sources.flatMap(commercialTokens).map(norm)), sug = norm(suggestion);
  const dropped = keep.filter((t) => !sug.includes(norm(t))).map((t) => `“${t}” was removed or changed`);
  const added = commercialTokens(suggestion).filter((t) => !allowed.has(norm(t)) && ![...allowed].some((a) => a.includes(norm(t)))).map((t) => `“${t}” isn't in your package or requirements`);
  return [...dropped, ...added];
}

export function detectProject(s: string): ProjectType {
  if (/\b3d|three\.?js|webgl|interactive|animation\b/i.test(s)) return "3d";
  if (/\b(e-?commerce|online (store|shop)|shop|cart|products?|checkout)\b/i.test(s)) return "ecommerce";
  if (/\b(redesign|revamp|old (site|website)|existing (site|website)|update (my|our) (site|website))\b/i.test(s)) return "redesign";
  if (/\b(portfolio|showcase|photographer|artist|designer|resume)\b/i.test(s)) return "portfolio";
  if (/\b(business|company|corporate|clinic|restaurant|shop front|services?) (website|site)\b|\bwebsite\b/i.test(s)) return "business";
  return "unknown";
}

/** Only features the Owner actually mentioned. */
const FEATURES: [RegExp, string][] = [
  [/(\d+)\s?(pages?|screens?)/i, "$1 pages"],
  [/contact form|enquiry form|inquiry form/i, "Contact / enquiry form"],
  [/whats ?app/i, "WhatsApp chat button"],
  [/gallery|portfolio section/i, "Image gallery"],
  [/booking|appointment/i, "Booking / appointment form"],
  [/payment gateway|razorpay|online payment|upi/i, "Online payment integration"],
  [/\bblog\b/i, "Blog section"],
  [/\bseo\b/i, "Basic on-page SEO setup"],
  [/admin|dashboard|cms/i, "Admin panel to manage content"],
  [/product (listing|catalog|catalogue)|products?\b/i, "Product listing"],
  [/\bcart|checkout\b/i, "Cart and checkout"],
  [/google maps?|map/i, "Google Map location"],
  [/3d|three\.?js|webgl/i, "3D interactive section"],
  [/animation/i, "Animations"],
  [/responsive|mobile[- ]friendly/i, "Mobile-friendly layout"],
  [/hindi|bilingual|multi-?language/i, "Multi-language content"],
];
const OVERVIEW: Record<ProjectType, string> = {
  business: "A professional website to present your business, services and contact details.",
  ecommerce: "An online store where customers can browse products and place orders.",
  portfolio: "A portfolio website to showcase your work.",
  redesign: "A redesign of your existing website.",
  "3d": "An interactive website with 3D elements.",
  unknown: "",
};
const BENEFITS: Record<ProjectType, string[]> = {
  business: ["Easier for customers to find and contact you"],
  ecommerce: ["Customers can order online"],
  portfolio: ["Your work presented in one place"],
  redesign: ["A refreshed look for your existing visitors"],
  "3d": ["A memorable, interactive first impression"],
  unknown: [],
};
const OPTIONAL: Record<ProjectType, string[]> = {
  business: ["Google Business Profile link", "Testimonials section"],
  ecommerce: ["Discount-code support", "Order notification on WhatsApp"],
  portfolio: ["Client testimonials", "Downloadable resume / profile"],
  redesign: ["Speed review of the current site"],
  "3d": ["Fallback layout for older phones"],
  unknown: [],
};
type H = { overview: string; deliver: string; features: string; benefits: string; client: string; excl: string; support: string; terms: string; optional: string };
const HEAD: Record<QuoteLang, H[]> = {
  en: [
    { overview: "Project overview", deliver: "Deliverables (included)", features: "Functional features", benefits: "Business benefits", client: "Client responsibilities", excl: "Exclusions", support: "Technical support", terms: "Timeline & payment terms", optional: "Optional recommendations (not included in the price)" },
    { overview: "About the project", deliver: "What's included", features: "Features", benefits: "How it helps your business", client: "What we'll need from you", excl: "Not included", support: "Support", terms: "Timeline & payment", optional: "Optional add-ons (not included in the price)" },
  ],
  hinglish: [
    { overview: "Project ke baare mein", deliver: "Kya included hai", features: "Features", benefits: "Business ko fayda", client: "Aapki taraf se", excl: "Included nahi hai", support: "Support", terms: "Timeline aur payment", optional: "Optional suggestions (price mein included nahi)" },
    { overview: "Project overview", deliver: "Deliverables (included)", features: "Features", benefits: "Fayde", client: "Client se chahiye", excl: "Exclusions", support: "Technical support", terms: "Timeline aur payment terms", optional: "Optional add-ons (price mein included nahi)" },
  ],
  hi: [
    { overview: "परियोजना विवरण", deliver: "शामिल कार्य", features: "सुविधाएँ", benefits: "व्यवसाय के लाभ", client: "ग्राहक की ज़िम्मेदारियाँ", excl: "शामिल नहीं", support: "तकनीकी सहायता", terms: "समय-सीमा और भुगतान शर्तें", optional: "वैकल्पिक सुझाव (मूल्य में शामिल नहीं)" },
    { overview: "परियोजना के बारे में", deliver: "क्या शामिल है", features: "सुविधाएँ", benefits: "लाभ", client: "आपसे आवश्यक", excl: "शामिल नहीं", support: "सहायता", terms: "समय और भुगतान", optional: "वैकल्पिक (मूल्य में शामिल नहीं)" },
  ],
};

/** Gentle line-by-line tidy that keeps WhatsApp formatting, bullets and every value. */
export function improveQuote(body: string): string {
  return body.split("\n").map((raw) => {
    let l = raw.replace(/[ \t]+/g, " ").trimEnd().replace(/^\s+/, "");
    l = l.replace(/^[•●▪]\s*/, "- ").replace(/^-(?=\S)/, "- ");
    l = l.replace(/^(- )?([a-z])/, (_m, b: string | undefined, c: string) => (b ?? "") + c.toUpperCase());
    l = l.replace(/\bi\b/g, "I").replace(/\s+([,.!?])/g, "$1");
    return l;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function draftScope(body: string, requirements: string, lang: QuoteLang, variant: number): { text: string; type: ProjectType; features: number } {
  const src = `${requirements}\n${body}`;
  const type = detectProject(src);
  const h = HEAD[lang][Math.abs(variant) % 2]!;
  const feats: string[] = [];
  for (const [re, label] of FEATURES) { const m = requirements.match(re); if (m) { const f = label.replace("$1", m[1] ?? ""); if (!feats.includes(f)) feats.push(f); } }
  const reqLines = requirements.split(/\n|;|(?<=\.)\s/).map((x) => x.trim()).filter(Boolean);
  const termLines = [...new Set([...body.split("\n"), ...reqLines].map((x) => x.trim().replace(/^[-•*]\s*/, "")).filter((x) => x && (COMMERCIAL_LINE.test(x) || /\d|₹/.test(x)) && !/\{clientName\}/.test(x) && !/^investment:/i.test(x)))];
  const pick = (re: RegExp) => termLines.filter((x) => re.test(x));
  const support = pick(/support|maintenance|warranty/i);
  const terms = termLines.filter((x) => !support.includes(x));
  const clientNeeds = reqLines.filter((x) => /\b(client|you|they) (will )?(provide|send|share)|logo|content|photos|images\b/i.test(x));
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : `- ${NOT_SPECIFIED}`);
  const greet = body.split("\n").find((x) => /\{clientName\}/.test(x));
  const parts = [
    ...(greet ? [greet.trim()] : []),
    `*${h.overview}*\n${OVERVIEW[type] || NOT_SPECIFIED}${/\{packageName\}/.test(body) ? " Package: {packageName}." : ""}`,
    `*${h.deliver}*\n${list(feats)}`,
    `*${h.benefits}*\n${list(BENEFITS[type])}`,
    `*${h.client}*\n${list(clientNeeds)}`,
    `*${h.excl}*\n- ${NOT_SPECIFIED}`,
    `*${h.support}*\n${list(support)}`,
    `*${h.terms}*\n${list(terms)}`,
    ...(/\{packagePrice\}/.test(body) ? ["Investment: {packagePrice}"] : []),
    ...(OPTIONAL[type].length ? [`*${h.optional}*\n${OPTIONAL[type].map((x) => `- ${x}`).join("\n")}`] : []),
  ];
  // Any remaining placeholder the Owner used is kept at the end so nothing silently disappears.
  const text0 = parts.join("\n\n");
  const lost = [...new Set(body.match(PLACEHOLDER) ?? [])].filter((p) => !text0.includes(p));
  return { text: text0 + (lost.length ? `\n\n${lost.join(" ")}` : ""), type, features: feats.length };
}

export function demoQuote(req: QuoteRequest): QuoteResult {
  if (req.mode === "improve") {
    return { mode: "improve", text: improveQuote(req.body), label: QUOTE_DEMO_LABEL, simulated: true, projectType: detectProject(req.body), supported: true,
      notice: "Demo Mode only tidies spacing, capitals and bullet marks line by line. It doesn't rewrite meaning or translate." };
  }
  const reqs = req.requirements?.trim() ?? "";
  const d = draftScope(req.body, reqs, req.lang, req.variant);
  const tooComplex = reqs.length > 600 || reqs.split(/\n/).length > 15;
  const supported = d.type !== "unknown" && d.features > 0 && !tooComplex;
  const notes: string[] = [];
  if (!supported) notes.push("Demo Mode only handles short briefs for business, e-commerce, portfolio, redesign and 3D websites. Full intelligent drafting of this brief needs the live AI connection, which isn't switched on yet. Sections it couldn't fill say “Not specified”.");
  else notes.push(`Fixed sample structure for a ${PROJECT_LABEL[d.type].toLowerCase()}. Deliverables are only the features you typed; your terms, support and payment lines are copied as written.`);
  if (req.lang !== "en") notes.push("Only the section headings are in " + QUOTE_LANG_LABEL[req.lang] + " — your own lines aren't translated.");
  return { mode: "draft_scope", text: d.text, label: QUOTE_DEMO_LABEL, simulated: true, projectType: d.type, supported, notice: notes.join(" ") };
}

export const demoQuoteWriter: QuoteWriter = {
  async write(req) {
    if (req.mode === "improve" && !req.body.trim()) throw { code: "invalid", message: "Write the quotation message first.", retryable: false };
    if (req.mode === "draft_scope" && !req.requirements?.trim()) throw { code: "invalid", message: "Type the client's requirements first.", retryable: false };
    await new Promise((r) => setTimeout(r, 300));
    return demoQuote(req);
  },
};
export const getQuoteWriter = (): QuoteWriter => demoQuoteWriter;
