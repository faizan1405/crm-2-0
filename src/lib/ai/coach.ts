// AI-3B Owner Sales Coach — deterministic Demo rules over the permission-filtered LeadContext.
// Pure: no network, no CRM writes. Every output item says where it came from (`ContentSource`)
// so screens can separate verified CRM facts from simulated advice. `getCoachProvider()` is the
// swap point for a future secure server-side OpenRouter endpoint (key never in the browser).
import type { LeadContext } from "./types";

export type ContentSource = "crm" | "demo_rules" | "static_example";
export const SOURCE_LABEL: Record<ContentSource, string> = {
  crm: "From your CRM records",
  demo_rules: "Demo rules · not a live AI model",
  static_example: "Static example · not personalised",
};
export const NOT_RECORDED = "Not recorded";

// ---------- Request / response contracts (future live provider uses the same shapes) ----------
export interface CallPrepRequest { kind: "call_prep"; lead: LeadContext }
export interface ObjectionRequest { kind: "objection"; lead: LeadContext; objection: ObjectionId }
export interface ResponseReviewRequest { kind: "response_review"; lead: LeadContext; objection: ObjectionId; draft: string }
export interface AfterCallRequest { kind: "after_call"; lead: LeadContext; summary: string }
export type CoachRequest = CallPrepRequest | ObjectionRequest | ResponseReviewRequest | AfterCallRequest;

export interface CoachFact { label: string; value: string; source: "crm" }
export type DiscoveryTheme = "situation" | "problem" | "impact" | "outcome" | "urgency" | "budget_decision";
export const THEME_LABEL: Record<DiscoveryTheme, string> = {
  situation: "Current situation", problem: "Business problem", impact: "Impact of the problem",
  outcome: "Desired business outcome", urgency: "Urgency", budget_decision: "Budget & decision process",
};
export interface DiscoveryQuestion { id: string; theme: DiscoveryTheme; text: string; source: ContentSource }
export interface CallPrep {
  facts: CoachFact[];
  missing: string[];
  objective: { text: string; source: ContentSource };
  questions: DiscoveryQuestion[];
  /** Won/Lost leads: no new pitch. */
  noPitch: boolean;
}

export type ObjectionId = "price" | "trust" | "timing" | "comparison" | "no_urgency" | "authority" | "brush_off" | "hidden";
export interface ObjectionCoaching {
  id: ObjectionId; category: string; quote: string;
  concern: string; avoid: string; response: string; why: string; nextQuestion: string;
  source: ContentSource;
}
export interface ResponseReview {
  supported: boolean;
  /** Shown verbatim when Demo Mode can't meaningfully evaluate free text. */
  limitation: string;
  checks: { label: string; ok: boolean }[];
  strengths: string[]; weaknesses: string[]; prospectMayThink: string;
  improved: string; nextQuestion: string; source: ContentSource;
}
export type AfterCallKind = "schedule_followup" | "ask_requirements" | "prepare_quotation" | "send_whatsapp" | "review_objection" | "none";
export interface AfterCallSuggestion { kind: AfterCallKind; label: string; why: string; source: ContentSource; matched?: string }

// ---------- Call preparation ----------
const firstQ = (t: string) => t;
export function prepareCall(l: LeadContext): CallPrep {
  const f = l.facts;
  const noPitch = f.statusKey === "won" || f.statusKey === "lost";
  const facts: CoachFact[] = [
    { label: "Customer", value: l.name, source: "crm" },
    { label: "Company", value: l.company ?? NOT_RECORDED, source: "crm" },
    { label: "Stage", value: l.stage, source: "crm" },
    { label: "Latest interaction", value: f.lastInteraction?.text ?? NOT_RECORDED, source: "crm" },
    { label: "Previous call outcomes", value: f.callOutcomes?.length ? f.callOutcomes.join(", ") : NOT_RECORDED, source: "crm" },
    { label: "Follow-up", value: f.nextFollowUpDue ? (f.overdueFollowUp ? "Overdue" : "Booked") : "None booked", source: "crm" },
    { label: "Requirements", value: l.requirement ?? NOT_RECORDED, source: "crm" },
  ];
  const missing: string[] = [];
  if (!noPitch) {
    if (!l.requirement) missing.push("What they need (requirement)");
    if (!l.company) missing.push("Company / business name");
    if (!f.hasEmail) missing.push("Email address");
    if (f.connectedCalls === 0) missing.push("A first real conversation");
    if (l.money && l.money.quotedOrBudget === undefined && ["qualified", "proposal"].includes(f.statusKey)) missing.push("Budget range");
  }

  let objective: string;
  if (f.statusKey === "won") objective = "Already Won — no sales pitch. If you call, check they're happy and ask if anything is needed for delivery.";
  else if (f.statusKey === "lost") objective = "Marked Lost — only call if there's a real reason to reopen. Listen first; don't pitch.";
  else if (f.unsuccessfulStreak >= 2) objective = `Previous ${f.unsuccessfulStreak} calls weren't answered — keep it short: introduce yourself and agree a better time.`;
  else if (f.connectedCalls === 0) objective = "First conversation — understand their business and what made them enquire. No pricing yet.";
  else if (f.statusKey === "proposal") objective = "Proposal is with them — find out what they think and what's stopping a decision.";
  else if (!l.requirement) objective = "Fill the gaps — get a clear requirement before discussing packages.";
  else if (f.statusKey === "qualified") objective = "Confirm scope, timeline and who decides, so a quotation can be prepared.";
  else objective = "Understand the need and agree a clear next step.";

  const site = /web|site|landing|e-?commerce|shop|seo/i.test(`${l.requirement ?? ""} ${l.source}`);
  const qs: Omit<DiscoveryQuestion, "id">[] = [];
  const add = (theme: DiscoveryTheme, text: string, source: ContentSource = "static_example") => qs.push({ theme, text: firstQ(text), source });
  if (!noPitch) {
    add("situation", site ? "What is your current process for getting customer enquiries?" : "How are you handling this today?");
    if (l.requirement) add("situation", `You mentioned “${l.requirement.slice(0, 60)}” — can you tell me a bit more about what you have in mind?`, "demo_rules");
    add("problem", site ? "What problem are you trying to solve with the new website?" : "What's not working well with the current setup?");
    add("impact", site ? "What happens when potential customers can't find the right information about you?" : "What does this problem cost you — time, customers, or something else?");
    add("outcome", "What would make this project successful for your business?");
    add("urgency", "Is there a particular deadline or event behind this requirement?");
    if (["qualified", "proposal"].includes(f.statusKey)) {
      add("budget_decision", "Who else is involved in approving the project?");
      add("budget_decision", "Have you set aside a rough budget range, so I can suggest the right option?");
    }
  } else if (f.statusKey === "won") {
    add("outcome", "Is everything going as you expected so far?");
  }
  return { facts, missing, objective: { text: objective, source: "demo_rules" }, questions: qs.map((q, i) => ({ ...q, id: `q${i}` })), noPitch };
}

// ---------- Objection coach (static, hand-written examples; each one different) ----------
export const OBJECTIONS: ObjectionCoaching[] = [
  { id: "price", category: "Price", quote: "Your price is too high.",
    concern: "They may be comparing a different scope, or aren't sure the website will bring enough business to justify it.",
    avoid: "Don't jump straight to a discount — it suggests the price was never real.",
    response: "I understand, sir. Before we talk numbers, can I understand what you're comparing it with? Then I can show you exactly what's included and you can decide.",
    why: "It treats the concern as reasonable and moves the talk from cost to what they actually get.",
    nextQuestion: "Just so I understand properly — are you comparing the total investment, or is there something specific you're unsure you'll get from the website?", source: "static_example" },
  { id: "trust", category: "Trust", quote: "How do I know you'll deliver?",
    concern: "They may have been let down by an agency before, or don't know you yet.",
    avoid: "Don't promise \"100% guaranteed results\" or make claims you can't show.",
    response: "That's a fair question. I can share a couple of recent websites we've done and walk you through how we work — milestones, previews and when payments happen.",
    why: "Specific, checkable proof and a clear process build more trust than promises.",
    nextQuestion: "Has something gone wrong with a vendor before? I'd like to make sure we avoid that.", source: "static_example" },
  { id: "timing", category: "Timing", quote: "Call me next month.",
    concern: "It may genuinely be a busy time — or a polite way of saying it's not a priority.",
    avoid: "Don't argue or say \"the offer ends today\".",
    response: "No problem at all. So I call at a good time, is there something happening this month, or is it more about budget timing?",
    why: "It respects their timing while finding out if there's a real reason behind it.",
    nextQuestion: "Which date next month works best for a 10-minute call?", source: "static_example" },
  { id: "comparison", category: "Comparison", quote: "Another agency is cheaper.",
    concern: "They want to be sure they aren't overpaying, and may not see the difference between offers.",
    avoid: "Don't criticise the other agency.",
    response: "That's good that you're comparing. If you share what they're offering, I'll honestly tell you where we're different — and if theirs suits you better, I'll say so.",
    why: "Honest comparison shows confidence and helps them compare like for like.",
    nextQuestion: "Does their quote include hosting, content and changes after launch?", source: "static_example" },
  { id: "no_urgency", category: "Lack of urgency", quote: "We don't need it right now.",
    concern: "They don't yet see what waiting costs them.",
    avoid: "Don't invent urgency or fake deadlines.",
    response: "Understood. Out of curiosity, what made you enquire in the first place? I just want to make sure we're not missing something that matters to you.",
    why: "It brings them back to their own reason for enquiring, without pressure.",
    nextQuestion: "If nothing changes for the next six months, how would that affect enquiries?", source: "static_example" },
  { id: "authority", category: "Authority", quote: "I need to discuss this with my partner.",
    concern: "Someone else shares the decision, and they may not feel ready to explain it to them.",
    avoid: "Don't push them to decide alone.",
    response: "Of course, it's an important decision. Would it help if I joined a short call with both of you, so your partner can ask questions directly?",
    why: "It respects the decision process and makes it easier for them to share accurately.",
    nextQuestion: "What do you think will matter most to your partner?", source: "static_example" },
  { id: "brush_off", category: "Brush-off", quote: "Send details on WhatsApp.",
    concern: "They may be busy, or trying to end the call politely.",
    avoid: "Don't send a long generic brochure and wait.",
    response: "Sure, I'll send it. So I send the right details and not a generic brochure — is it mainly for a new website or improving the current one?",
    why: "One quick question makes the message relevant and keeps the conversation open.",
    nextQuestion: "Once you've seen it, can I call you on Thursday to answer any questions?", source: "static_example" },
  { id: "hidden", category: "Hidden objection", quote: "Customer seems hesitant but hasn't said why.",
    concern: "There's a concern they haven't said out loud — price, trust, timing or someone else.",
    avoid: "Don't keep talking or repeat the features.",
    response: "I sense you're not fully sure yet, and that's completely okay. What's the one thing that's making you hesitate?",
    why: "Naming the hesitation gently invites them to share it.",
    nextQuestion: "If that one thing were sorted, would you be comfortable moving ahead?", source: "static_example" },
];
export const objectionById = (id: ObjectionId) => OBJECTIONS.find((o) => o.id === id)!;

// ---------- Response review (honest Demo Mode) ----------
export const REVIEW_LIMITATION = "Demo Mode can't genuinely understand what you wrote. It only runs a few simple checks (length, whether you ask a question, whether you mention a discount or pressure words). This is not a personalised evaluation or score.";
const PRESSURE = /\b(today only|last chance|limited time|offer ends|hurry|only \d+ (slots|left)|guarantee(d)?|100%)\b/i;
const DISCOUNT = /\b(discount|% off|reduce (the )?price|cheaper|kam kar|less price)\b/i;
export function reviewResponse(objection: ObjectionId, draft: string): ResponseReview {
  const o = objectionById(objection);
  const t = draft.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const checks = [
    { label: "Asks the customer a question", ok: /\?/.test(t) },
    { label: "Avoids an instant discount", ok: !DISCOUNT.test(t) },
    { label: "Avoids pressure or guarantee words", ok: !PRESSURE.test(t) },
    { label: "Short enough to say naturally (under 60 words)", ok: words > 0 && words <= 60 },
  ];
  return {
    supported: false, limitation: REVIEW_LIMITATION, checks,
    strengths: [], weaknesses: [], prospectMayThink: "Demo Mode can't predict this from your words.",
    improved: o.response, nextQuestion: o.nextQuestion, source: "static_example",
  };
}

// ---------- After call ----------
const R = {
  later: /\b(next (week|month)|later|call (me )?back|busy|after diwali|not now)\b/i,
  quote: /\b(quote|quotation|proposal|price|pricing|cost|estimate)\b/i,
  whatsapp: /\b(whats ?app|send (me )?(the )?details|send info|brochure)\b/i,
  objection: /\b(expensive|too high|costly|cheaper|partner|think about it|not sure|hesitant|trust)\b/i,
  req: /\b(requirement|pages|features|not decided|unclear|will share|send (the )?content)\b/i,
};
export function suggestAfterCall(l: LeadContext, summary: string): AfterCallSuggestion {
  const s = summary.trim();
  if (l.facts.statusKey === "won") return { kind: "none", label: "No immediate sales action", why: "This lead is already Won — delivery and payments continue in Deals and Project Desk.", source: "crm" };
  if (!s) return { kind: "none", label: "Write a short summary first", why: "Nothing to base a suggestion on yet.", source: "demo_rules" };
  const m = (re: RegExp) => s.match(re)?.[0];
  let hit: string | undefined;
  if ((hit = m(R.objection))) return { kind: "review_objection", label: "Review an unresolved objection", why: "Your summary mentions a concern that may still be open.", source: "demo_rules", matched: hit };
  if ((hit = m(R.later))) return { kind: "schedule_followup", label: "Schedule a follow-up", why: "Your summary says they asked to talk later.", source: "demo_rules", matched: hit };
  if ((hit = m(R.whatsapp))) return { kind: "send_whatsapp", label: "Send a WhatsApp message", why: "Your summary mentions sending details.", source: "demo_rules", matched: hit };
  if ((hit = m(R.quote))) return l.requirement
    ? { kind: "prepare_quotation", label: "Prepare a quotation", why: "They asked about pricing and the requirement is recorded.", source: "demo_rules", matched: hit }
    : { kind: "ask_requirements", label: "Ask for missing requirements", why: "They asked about pricing but the requirement isn't recorded yet.", source: "demo_rules", matched: hit };
  if ((hit = m(R.req)) || !l.requirement) return { kind: "ask_requirements", label: "Ask for missing requirements", why: hit ? "Your summary mentions requirements still to come." : "The requirement isn't recorded on this lead.", source: hit ? "demo_rules" : "crm", ...(hit ? { matched: hit } : {}) };
  if (!l.facts.nextFollowUpDue) return { kind: "schedule_followup", label: "Schedule a follow-up", why: "No next step is booked on this lead.", source: "crm" };
  return { kind: "none", label: "No immediate action", why: "A follow-up is already booked and nothing in your summary needs action now.", source: "crm" };
}

// ---------- Provider swap point ----------
export type CoachResult = CallPrep | ObjectionCoaching | ResponseReview | AfterCallSuggestion;
export interface CoachProvider { id: string; live: boolean; run(req: CoachRequest): CoachResult }
export const demoCoachProvider: CoachProvider = {
  id: "demo-coach", live: false,
  run(req) {
    if (req.kind === "call_prep") return prepareCall(req.lead);
    if (req.kind === "objection") return objectionById(req.objection);
    if (req.kind === "response_review") return reviewResponse(req.objection, req.draft);
    return suggestAfterCall(req.lead, req.summary);
  },
};
export const getCoachProvider = (): CoachProvider => demoCoachProvider;
