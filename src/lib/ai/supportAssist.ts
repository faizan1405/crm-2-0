// AI-6B Owner Support AI Assistant — contracts + deterministic Demo rules over one recorded Support Request.
// Pure: no network, no store writes. Context = this request, its project's name/client/support terms and the
// project-history lines about THIS request only. Never: payments, proofs, phone/email, credentials, other
// projects or other requests. Every output is a suggestion the Owner must explicitly accept.
import { SUPPORT_KIND_TEXT, SUPPORT_TEXT, supportStatus, type Project, type RequestStatus, type SupportRequest } from "@/lib/crm/projects";
import type { RewriteTone } from "./rewrite";
import { dayLabel } from "./projectAssist";

export const SUPPORT_DEMO_LABEL = "Demo Analysis — based on recorded Support data, not a live AI model.";
export const NOT_RECORDED = "Not recorded";
export const STATUS_LABEL: Record<RequestStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
const COVERAGE_LABEL = { undecided: "Coverage not decided", included: "Included in agreement", billable: "Billable" } as const;

// ---------- Context ----------
export interface SupportAIContext {
  requestId: string; projectId: string;
  projectName: string; clientName: string; firstName: string;
  title: string; kindText: string; description?: string;
  status: RequestStatus; statusText: string; priority: string;
  assignee?: string;
  coverage: SupportRequest["coverage"]; coverageText: string;
  supportTerms: string;
  resolution?: string; resolvedAt?: string;
  createdAt: string; dueDate?: string;
  history: { at: string; change: string }[];
  reopened: boolean;
}

/** History lines that belong to this request only (matched by its quoted title). */
export function requestHistory(p: Pick<Project, "history">, r: Pick<SupportRequest, "title">): { at: string; change: string }[] {
  const keys = [`Support “${r.title}”`, `Support request opened: “${r.title}”`];
  return p.history.filter((h) => keys.some((k) => h.change.includes(k))).map((h) => ({ at: h.at, change: h.change }));
}

export function buildSupportContext(r: SupportRequest, p: Project, assigneeName: string | undefined, today: string): SupportAIContext {
  const history = requestHistory(p, r);
  const ctx: SupportAIContext = {
    requestId: r.id, projectId: p.id, projectName: p.name, clientName: p.clientName,
    firstName: p.clientName.trim().split(/\s+/)[0] || p.clientName,
    title: r.title, kindText: SUPPORT_KIND_TEXT[r.kind], status: r.status, statusText: STATUS_LABEL[r.status], priority: r.priority,
    coverage: r.coverage, coverageText: COVERAGE_LABEL[r.coverage],
    supportTerms: p.support.included == null ? NOT_RECORDED : `${SUPPORT_TEXT[supportStatus(p.support, today)]}${p.support.end ? ` (until ${dayLabel(p.support.end)})` : ""}`,
    createdAt: r.createdAt, history,
    reopened: history.some((h) => /reopened/.test(h.change)) && (r.status === "open" || r.status === "in_progress"),
  };
  if (r.description?.trim()) ctx.description = r.description.trim();
  if (r.assigneeId && assigneeName) ctx.assignee = assigneeName;
  if (r.resolution?.trim()) ctx.resolution = r.resolution.trim();
  if (r.resolvedAt) ctx.resolvedAt = r.resolvedAt;
  if (r.dueDate) ctx.dueDate = r.dueDate;
  return ctx;
}

const isDone = (c: SupportAIContext) => c.status === "resolved" || c.status === "closed";
/** Verified = the request is resolved/closed AND resolution notes are recorded. */
export const verifiedResolution = (c: SupportAIContext) => isDone(c) && !!c.resolution;

// ---------- Issue recognition ----------
export type IssueKind = "contact_form" | "page_not_loading" | "content_not_updating" | "mobile_layout" | "payment_gateway" | "login" | "unknown";
export const ISSUE_LABEL: Record<IssueKind, string> = {
  contact_form: "Contact form not working", page_not_loading: "Website page not loading", content_not_updating: "Image or content not updating",
  mobile_layout: "Mobile layout issue", payment_gateway: "Payment gateway issue", login: "Login issue", unknown: "Not a recognised example",
};
const ISSUE_RX: [IssueKind, RegExp][] = [
  ["payment_gateway", /\b(payment gateway|razorpay|paytm|stripe|checkout|payment (page|fail|failed|not working|error)|upi)\b/i],
  ["login", /\b(log ?in|sign ?in|password reset|can'?t access (the )?(admin|dashboard|account)|otp not)\b/i],
  ["contact_form", /\b(contact|enquiry|inquiry|lead) form\b|\bform (not|isn'?t|doesn'?t|is not) (work|submit|send)|\bform submissions?\b|\bnot receiving (form|enquir)/i],
  ["mobile_layout", /\b(mobile|phone|responsive|iphone|android)\b.*\b(layout|broken|overlap|cut|alignment|look|display|menu)|\b(layout|alignment|overlap)\b.*\b(mobile|phone)\b/i],
  ["content_not_updating", /\b(image|photo|picture|content|text|banner|price list)s?\b.*\b(not (updat|chang|show)|old|still showing|didn'?t (updat|chang))|\bnot updat(ing|ed)\b/i],
  ["page_not_loading", /\b(page|site|website)\b.*\b(not (load|open)|won'?t (load|open)|blank|down|404|500|error|crash)|\bnot loading\b/i],
];
export function classifyIssue(text: string): IssueKind {
  for (const [k, rx] of ISSUE_RX) if (rx.test(text)) return k;
  return "unknown";
}

// ---------- Troubleshooting ----------
export interface TroubleshootResult { kind: IssueKind; label: string; steps: string[]; questions: string[]; notices: string[]; staticExample: boolean }
const STEPS: Record<Exclude<IssueKind, "unknown">, { steps: string[]; questions: string[] }> = {
  contact_form: {
    steps: ["Submit a test enquiry yourself and note any on-screen error.", "Check whether test submissions reach the configured inbox, including spam/junk.", "Review the form's recipient email and email-sending settings in your hosting or form tool.", "Check whether a recent plugin, theme or code change affected the form."],
    questions: ["Which page's form is affected?", "Does the client see an error message, or does it seem to submit but nothing arrives?", "When did they last receive an enquiry successfully?"],
  },
  page_not_loading: {
    steps: ["Open the page yourself on another network and device and note the exact error or blank screen.", "Check whether the domain and hosting account are active.", "Check whether only one page or the whole website is affected.", "Review recent changes (deployments, plugin updates, DNS changes)."],
    questions: ["Which page link is affected?", "What exactly does the client see (blank page, error code, very slow)?", "Is it on every device and network, or only one?"],
  },
  content_not_updating: {
    steps: ["Ask the client to refresh with a hard reload or try a private window (browser cache).", "Check any caching or CDN layer and clear it if used.", "Confirm the change was actually saved and published in the editor.", "Check the uploaded image file name and size."],
    questions: ["Which page and which image or text is affected?", "What should it show, and what is it showing instead?", "Where was the change made (editor, admin panel, by our team)?"],
  },
  mobile_layout: {
    steps: ["Open the page at phone width and compare with the client's screenshot.", "Note the device and browser where it happens.", "Check the affected section's styles for fixed widths or overflow.", "Re-test on at least one Android and one iPhone browser after any change."],
    questions: ["Can the client share a screenshot?", "Which phone and browser are they using?", "Which page and section looks wrong?"],
  },
  payment_gateway: {
    steps: ["Ask for the time of the failed attempt and the on-screen message (no card details).", "Check the payment provider's dashboard for that attempt.", "Confirm whether the gateway is in live or test mode.", "Check whether the issue affects every payment method or only one."],
    questions: ["What message did the customer see?", "Roughly when did it happen and which payment method was used?", "Has any payment succeeded since?"],
  },
  login: {
    steps: ["Confirm which login is affected (website admin, customer account, hosting).", "Ask the client to try the password-reset option themselves.", "Check whether the account is locked or the email address is correct.", "Check whether any security plugin or recent change blocks logins."],
    questions: ["Which login page is affected?", "What message do they see when trying to sign in?", "Which email address or username are they using? (Never ask for the password.)"],
  },
};
const SAFETY = "Never ask the client for passwords, OTPs, secret keys or card details.";
export function troubleshoot(c: SupportAIContext): TroubleshootResult {
  const text = `${c.title}\n${c.description ?? ""}`;
  const kind = classifyIssue(text);
  const notices = ["These are general checks. The AI has not inspected the live website, server, logs or any account.", SAFETY];
  if (isDone(c)) notices.unshift(`This request is ${c.statusText.toLowerCase()} — reopen it first if the problem is back.`);
  if (kind === "unknown") return {
    kind, label: ISSUE_LABEL.unknown, steps: [], staticExample: false,
    questions: ["What exactly is not working, and on which page?", "Could you share a screenshot or the exact error message?", "When did it start, and did anything change around then?", "Does it happen on every device and browser?"],
    notices: ["Demo Mode recognises only a few common website issues and does not understand this one. Ask the client these questions instead of guessing.", ...notices],
  };
  return { kind, label: ISSUE_LABEL[kind], ...STEPS[kind], staticExample: true, notices: [`Recognised as “${ISSUE_LABEL[kind]}” from the request wording. Steps are a static checklist for this kind of issue, not a diagnosis.`, ...notices] };
}

// ---------- Next action ----------
export type SupportActionKind = "ask_details" | "start" | "investigate" | "review_progress" | "add_resolution" | "review_ready" | "none";
export interface SupportNextAction { kind: SupportActionKind; title: string; evidence: string[] }
const detailsMissing = (c: SupportAIContext) => !c.description || c.description.length < 25;
export function nextSupportAction(c: SupportAIContext): SupportNextAction {
  const ev: string[] = [`Status: ${c.statusText}.`];
  if (c.reopened) ev.push("This request was reopened.");
  if (isDone(c)) {
    if (!c.resolution) return { kind: "add_resolution", title: "Add resolution notes", evidence: [...ev, "No resolution notes are recorded."] };
    return { kind: "none", title: "No action needed currently", evidence: [...ev, "Resolution notes are recorded."] };
  }
  if (detailsMissing(c)) return { kind: "ask_details", title: "Ask the client for screenshots or error details", evidence: [...ev, c.description ? "The description is very short." : "No description is recorded."] };
  if (c.status === "open") return { kind: "start", title: "Start work on this open request", evidence: [...ev, `Opened ${dayLabel(c.createdAt)}${c.assignee ? `, assigned to ${c.assignee}` : ", nobody assigned"}.`] };
  if (c.resolution) return { kind: "review_ready", title: "Review whether the request is ready to resolve", evidence: [...ev, "Draft resolution notes are recorded on the request."] };
  const acts = c.history.filter((h) => !/opened/.test(h.change));
  if (acts.length > 1) return { kind: "review_progress", title: "Review recorded progress", evidence: [...ev, `${acts.length} updates recorded for this request.`] };
  return { kind: "investigate", title: "Investigate the reported issue", evidence: [...ev, "Work has started; no findings are recorded yet."] };
}

// ---------- Summary ----------
export interface SupportSummary { reported: string; facts: string[]; previous: string[]; status: string; needed: string[]; next: SupportNextAction; notices: string[] }
export function summarizeRequest(c: SupportAIContext): SupportSummary {
  const notices: string[] = [];
  const kind = classifyIssue(`${c.title}\n${c.description ?? ""}`);
  if ((c.description?.length ?? 0) > 600 || kind === "unknown") notices.push("Demo Mode only restates what is recorded. It can't interpret complex or unfamiliar technical problems — read the original description.");
  const facts = [`Type: ${c.kindText}`, `Priority: ${c.priority}`, `Opened: ${dayLabel(c.createdAt)}`, `Assigned: ${c.assignee ?? NOT_RECORDED}`, `Coverage: ${c.coverageText}`, `Support terms: ${c.supportTerms}`];
  if (c.dueDate) facts.push(`Due: ${dayLabel(c.dueDate)}`);
  const needed: string[] = [];
  if (detailsMissing(c)) needed.push("A clear description of the problem, with screenshots or the exact error message.");
  if (!c.assignee && !isDone(c)) needed.push("Who will handle this request.");
  if (c.coverage === "undecided") needed.push("Whether this is covered by the agreement or billable (Owner decision).");
  if (isDone(c) && !c.resolution) needed.push("Resolution notes describing what was done.");
  return {
    reported: c.description ? `Client-reported: “${c.title}” — ${c.description}` : `Client-reported: “${c.title}” (no details recorded)`,
    facts,
    previous: c.history.map((h) => `${dayLabel(h.at)} — ${h.change}`),
    status: verifiedResolution(c) ? `${c.statusText}. Verified resolution notes: ${c.resolution}` : isDone(c) ? `${c.statusText}, but no resolution notes are recorded.` : `${c.statusText}${c.reopened ? " (reopened)" : ""}. Not resolved — no fix is recorded.`,
    needed, next: nextSupportAction(c), notices,
  };
}

// ---------- Reply writer ----------
export type ReplyPurpose = "acknowledge" | "request_info" | "progress" | "next_steps" | "resolution" | "post_resolution";
export const REPLY_PURPOSES: ReplyPurpose[] = ["acknowledge", "request_info", "progress", "next_steps", "resolution", "post_resolution"];
export const REPLY_PURPOSE_LABEL: Record<ReplyPurpose, string> = { acknowledge: "Acknowledge issue", request_info: "Request additional information", progress: "Share recorded progress", next_steps: "Explain next steps", resolution: "Communicate verified resolution", post_resolution: "Follow up after resolution" };
export type ReplyLang = "en" | "hi" | "hinglish";
export const REPLY_LANG_LABEL: Record<ReplyLang, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
export interface SupportReplyRequest { ctx: SupportAIContext; purpose: ReplyPurpose; tone: RewriteTone; lang: ReplyLang; variant: number }
export interface SupportReplyResult { text: string; blocked: boolean; simulated: true; label: string; contextUsed: string[]; notices: string[] }
export interface SupportAssistProvider { reply(req: SupportReplyRequest): Promise<SupportReplyResult> }

export function supportContextUsed(c: SupportAIContext): string[] {
  return [`Project: ${c.projectName}`, `Client: ${c.clientName}`, `Request: ${c.title}`, `Status: ${c.statusText}${c.reopened ? " (reopened)" : ""}`, `Assigned: ${c.assignee ?? NOT_RECORDED}`, `Coverage: ${c.coverageText}`, `Resolution notes: ${c.resolution ?? NOT_RECORDED}`, `Recorded updates: ${c.history.length}`];
}

export function demoSupportReply({ ctx: c, purpose, tone, lang, variant }: SupportReplyRequest): SupportReplyResult {
  const used = supportContextUsed(c);
  const notices: string[] = [];
  const blocked = (m: string): SupportReplyResult => ({ text: "", blocked: true, simulated: true, label: SUPPORT_DEMO_LABEL, contextUsed: used, notices: [m] });
  const t = c.title;
  const body: string[] = [];
  switch (purpose) {
    case "acknowledge":
      if (isDone(c)) return blocked(`This request is already ${c.statusText.toLowerCase()} — an acknowledgement would be out of date.`);
      body.push({ en: `Thank you for reporting “${t}” on ${c.projectName}. We have noted it and our team will look into it.`, hi: `${c.projectName} पर “${t}” की जानकारी देने के लिए धन्यवाद। हमने इसे दर्ज कर लिया है और हमारी टीम इसे देखेगी।`, hinglish: `${c.projectName} par “${t}” batane ke liye thank you. Humne ise note kar liya hai aur hamari team ise dekhegi.` }[lang]);
      break;
    case "request_info": {
      if (isDone(c)) return blocked(`This request is ${c.statusText.toLowerCase()}. Reopen it before asking for more details.`);
      const qs = troubleshoot(c).questions.filter((q) => !/password/i.test(q)).slice(0, 3);
      body.push({ en: `To look into “${t}”, could you please share:`, hi: `“${t}” को देखने के लिए कृपया यह जानकारी भेजें:`, hinglish: `“${t}” check karne ke liye please ye share kijiye:` }[lang]);
      body.push(lang === "en" ? qs.map((q) => `• ${q}`).join("\n") : { hi: "• कहाँ और क्या दिक्कत आ रही है\n• स्क्रीनशॉट या एरर मैसेज\n• यह कब से हो रहा है", hinglish: "• Kahan aur kya problem aa rahi hai\n• Screenshot ya error message\n• Ye kab se ho raha hai" }[lang]);
      body.push({ en: "Please don't send any passwords or OTPs.", hi: "कृपया कोई पासवर्ड या OTP न भेजें।", hinglish: "Please koi password ya OTP mat bhejiye." }[lang]);
      break;
    }
    case "progress": {
      if (isDone(c)) return blocked("This request is closed — use “Communicate verified resolution” or “Follow up after resolution”.");
      if (c.status !== "in_progress") return blocked("No progress is recorded — the request is still Open. Start it first, or use “Acknowledge issue”.");
      body.push({ en: `A quick update on “${t}”: our team is working on it.`, hi: `“${t}” पर अपडेट: हमारी टीम इस पर काम कर रही है।`, hinglish: `“${t}” par update: hamari team is par kaam kar rahi hai.` }[lang]);
      body.push({ en: "It is not resolved yet; we'll update you once it is.", hi: "यह अभी हल नहीं हुआ है; हल होते ही हम आपको बताएंगे।", hinglish: "Ye abhi resolve nahi hua hai; resolve hote hi hum aapko batayenge." }[lang]);
      break;
    }
    case "next_steps":
      if (isDone(c)) return blocked(`This request is ${c.statusText.toLowerCase()} — there are no open next steps recorded.`);
      body.push({ en: `For “${t}”, our next step is to ${c.status === "open" ? "review the issue you reported" : "continue checking the issue"}.`, hi: `“${t}” के लिए हमारा अगला कदम ${c.status === "open" ? "आपकी बताई समस्या को देखना" : "समस्या की जाँच जारी रखना"} है।`, hinglish: `“${t}” ke liye hamara next step ${c.status === "open" ? "aapki batayi problem ko review karna" : "issue ko check karte rehna"} hai.` }[lang]);
      if (detailsMissing(c)) body.push({ en: "A screenshot or the exact error message would help us.", hi: "एक स्क्रीनशॉट या सटीक एरर मैसेज से हमें मदद मिलेगी।", hinglish: "Ek screenshot ya exact error message se help milegi." }[lang]);
      body.push({ en: "We'll share an update once there is progress.", hi: "प्रगति होते ही हम अपडेट देंगे।", hinglish: "Progress hote hi hum update denge." }[lang]);
      break;
    case "resolution":
      if (!verifiedResolution(c)) return blocked(isDone(c) ? "No resolution notes are recorded, so the fix can't be confirmed. Add resolution notes first." : `This request is ${c.statusText} — a resolution message would be false. Resolve it with notes first.`);
      body.push({ en: `Good news — “${t}” has been resolved. What we did: ${c.resolution}`, hi: `“${t}” हल कर दिया गया है। हमने यह किया: ${c.resolution}`, hinglish: `“${t}” resolve ho gaya hai. Humne ye kiya: ${c.resolution}` }[lang]);
      body.push({ en: "Please check and let us know if anything still looks wrong.", hi: "कृपया जाँच लें और कुछ भी गलत लगे तो बताएं।", hinglish: "Please check karke batayein agar kuch abhi bhi galat lage." }[lang]);
      break;
    case "post_resolution":
      if (!verifiedResolution(c)) return blocked("A follow-up after resolution needs a resolved request with resolution notes.");
      body.push({ en: `Just checking in on “${t}”, which we resolved earlier. Is everything working as expected?`, hi: `“${t}” जो हमने हल किया था — क्या अब सब ठीक चल रहा है?`, hinglish: `“${t}” jo humne resolve kiya tha — kya ab sab theek chal raha hai?` }[lang]);
      break;
  }
  if (c.coverage === "undecided" && purpose !== "post_resolution") notices.push("Coverage is not decided — the draft doesn't say whether this is free or billable.");
  const hi = { en: ["Hi", "Hello"], hi: ["नमस्ते", "नमस्कार"], hinglish: ["Hi", "Namaste"] }[lang];
  const greet = `${hi[variant % 2]} ${c.firstName}${lang === "hi" ? " जी" : ""},`;
  const end = tone === "friendly" ? { en: ["Happy to help!", "Thanks for your patience!"], hi: ["मदद के लिए हम हमेशा तैयार हैं!", "आपके धैर्य के लिए धन्यवाद!"], hinglish: ["Help ke liye hum hamesha ready hain!", "Aapke patience ke liye thank you!"] }[lang][variant % 2]! : { en: "Thank you.", hi: "धन्यवाद।", hinglish: "Thank you." }[lang];
  const text = tone === "short" ? `${greet} ${body.slice(0, 2).join(" ")}` : [greet, body.join("\n\n"), end].join("\n\n");
  return { text, blocked: false, simulated: true, label: SUPPORT_DEMO_LABEL, contextUsed: used, notices };
}

/** Claims the final text must not make unless recorded. Blocks "Use Suggestion". */
export function replyViolations(c: SupportAIContext, original: string, text: string): string[] {
  const out: string[] = [];
  const has = (rx: RegExp) => rx.test(text) && !rx.test(original);
  const resolvedRx = /\b(has been|have been|is|was|got|now)\s+(fixed|resolved|sorted)\b|\b(we|i) (have )?(fixed|resolved|sorted)\b|\bresolve ho gaya\b|\bfix ho gaya\b|हल (कर दिया|हो गया)/i;
  if (!verifiedResolution(c) && resolvedRx.test(text)) out.push(`Says the issue is fixed or resolved — the request is ${c.statusText} without verified resolution notes.`);
  if (has(/\brefund|money back|रिफंड|paisa wapas/i)) out.push("Promises a refund — not recorded.");
  if (/\bpayment[s]?\b[^.]*\b(received|cleared|pending|due)\b|\binvoice\b|भुगतान/i.test(text)) out.push("Mentions payment status — finance isn't part of this assistant's facts.");
  if (c.coverage !== "included" && has(/\bfree of (cost|charge)\b|\bno (extra )?charge\b|\bcovered (under|by)\b|\bincluded in (your|the) (support|plan|agreement)\b|\bfree\b|मुफ़्त|muft/i)) out.push("Says the work is free or covered — coverage isn't recorded as included.");
  if (c.coverage !== "billable" && has(/\b(billable|chargeable|extra cost|will be charged)\b/i)) out.push("Says the work is billable — coverage isn't recorded as billable.");
  const diag = /\b(caused by|due to (a|an|the)|the (root )?cause (is|was)|because (of )?(a|an|the) (bug|server|plugin|hosting|cache|dns|code))\b|की वजह से|ki wajah se/i;
  if (diag.test(text) && !diag.test(original) && !(c.resolution && diag.test(c.resolution))) out.push("States a technical cause — no diagnosis is recorded.");
  if (/\b(send|share|give|tell) (us |me )?(your |the )?(password|otp|pin|cvv|card (number|details)|secret key|api key)\b/i.test(text)) out.push("Asks for a password, OTP, secret key or card details.");
  if (has(/\b(tomorrow|tonight|today|next week|this week|within \d+|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b(kal|aaj)\b|(^|\s)(कल|आज)(\s|$)/i)) out.push("Gives a timeframe that isn't an agreed date.");
  if (has(/\b(you (must|need to|will)|aapko .* (karna hoga|dena hoga))\b.*\b(pay|approve|sign)\b/i)) out.push("Adds a client commitment that isn't recorded.");
  const allowed = new Set([...`${supportContextUsed(c).join(" ")} ${original} ${c.description ?? ""}`.matchAll(/\d+/g)].map((m) => m[0]));
  const extra = [...text.matchAll(/\d+/g)].map((m) => m[0]).filter((n) => !allowed.has(n));
  if (extra.length) out.push(`Adds numbers or dates not in the records: ${[...new Set(extra)].slice(0, 5).join(", ")}.`);
  if ([...text.matchAll(/https?:\/\/\S+/gi)].some((m) => !original.includes(m[0]) && !(c.description ?? "").includes(m[0]) && !(c.resolution ?? "").includes(m[0]))) out.push("Adds a link that isn't recorded.");
  if (/₹\s?\d/.test(text) && !/₹\s?\d/.test(original)) out.push("Adds an amount — amounts aren't part of this assistant's facts.");
  if (!text.toLowerCase().includes(c.firstName.toLowerCase())) out.push(`Drops the client's name (${c.firstName}).`);
  return out;
}

export const demoSupportAssistProvider: SupportAssistProvider = { reply: async (req) => { await new Promise((r) => setTimeout(r, 120)); return demoSupportReply(req); } };
/** Swap point for the future secure server endpoint. */
export const getSupportAssistProvider = (): SupportAssistProvider => demoSupportAssistProvider;
