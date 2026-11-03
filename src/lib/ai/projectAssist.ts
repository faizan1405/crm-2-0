// AI-6A Owner Project AI Assistant — contracts + deterministic Demo rules over recorded Project data.
// Pure: no network, no store writes. Context excludes payments, proofs, phone/email, internal notes,
// employee data and other clients. Every output is a suggestion the Owner must explicitly accept.
import { STAGE_TEXT, STATUS_TEXT, type Project, type ProjectMilestone, type ProjectStage, type ProjectStatus, type ProjectTask } from "@/lib/crm/projects";
import type { RewriteTone } from "./rewrite";

export const PROJECT_DEMO_LABEL = "Demo Analysis — based on recorded Project data, not a live AI model.";
export const NOT_RECORDED = "Not recorded";

// ---------- Context ----------
export interface ProjectAIContext {
  projectId: string;
  name: string;
  clientName: string;
  firstName: string;
  company?: string;
  type: string;
  stage: ProjectStage;
  stageText: string;
  status: ProjectStatus;
  statusText: string;
  scope?: string;
  targetDelivery?: string;
  requirements: { label: string; done: boolean }[];
  tasks: { id: string; title: string; done: boolean; dueDate?: string; milestoneId?: string }[];
  milestones: { id: string; title: string; dueDate?: string; done: number; total: number; complete: boolean }[];
  waitingOnClient: string[];
  clientItemsReceived: string[];
  qa: { label: string; done: boolean }[];
  handover: { label: string; done: boolean }[];
  delivery?: { date: string; url?: string; approval: "pending" | "approved" | "not_required" };
  openSupportRequests: number;
  archived: boolean;
}

export function buildProjectContext(p: Project, allTasks: ProjectTask[], allMilestones: ProjectMilestone[], openSupportRequests = 0): ProjectAIContext {
  const tasks = allTasks.filter((t) => t.projectId === p.id).sort((a, b) => a.order - b.order);
  const ms = allMilestones.filter((m) => m.projectId === p.id).sort((a, b) => a.order - b.order);
  const opt = <T,>(v: T | undefined) => (v === undefined || v === "" ? undefined : v);
  const ctx: ProjectAIContext = {
    projectId: p.id, name: p.name, clientName: p.clientName, firstName: p.clientName.trim().split(/\s+/)[0] || p.clientName,
    type: p.type, stage: p.stage, stageText: STAGE_TEXT[p.stage], status: p.status, statusText: STATUS_TEXT[p.status],
    requirements: p.requirements.map((r) => ({ label: r.label, done: r.done })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done", ...(t.dueDate ? { dueDate: t.dueDate } : {}), ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}) })),
    milestones: ms.map((m) => { const t = tasks.filter((x) => x.milestoneId === m.id); const done = t.filter((x) => x.status === "done").length; return { id: m.id, title: m.title, ...(m.dueDate ? { dueDate: m.dueDate } : {}), done, total: t.length, complete: t.length > 0 && done === t.length }; }),
    waitingOnClient: p.dependencies.filter((d) => !d.done).map((d) => d.label),
    clientItemsReceived: p.dependencies.filter((d) => d.done).map((d) => d.label),
    qa: p.qa.map((c) => ({ label: c.label, done: c.done })), handover: p.handover.map((c) => ({ label: c.label, done: c.done })),
    openSupportRequests, archived: p.archived,
  };
  if (opt(p.company)) ctx.company = p.company!;
  if (opt(p.scope?.trim())) ctx.scope = p.scope!.trim();
  if (opt(p.targetDelivery)) ctx.targetDelivery = p.targetDelivery!;
  if (p.delivery) ctx.delivery = { date: p.delivery.date, approval: p.delivery.approval, ...(p.delivery.url ? { url: p.delivery.url } : {}) };
  return ctx;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Deterministic, timezone-free date label for an ISO day (YYYY-MM-DD…). */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

export const taskStats = (c: ProjectAIContext) => { const done = c.tasks.filter((t) => t.done).length; return { done, total: c.tasks.length, open: c.tasks.length - done }; };
export const deliveryOpen = (c: ProjectAIContext) => [...c.qa, ...c.handover].filter((x) => !x.done).map((x) => x.label);
export const isDelivered = (c: ProjectAIContext) => !!c.delivery || c.stage === "delivered" || c.stage === "support";

// ---------- Structure requirements ----------
export type ReqSection = "objectives" | "deliverables" | "functional" | "client" | "other";
export const REQ_SECTION_LABEL: Record<ReqSection, string> = { objectives: "Project objectives", deliverables: "Stated deliverables (from the brief — not a contract)", functional: "Functional requirements", client: "Client responsibilities", other: "Other notes (kept as written)" };
export interface StructuredBrief {
  sections: Record<ReqSection, string[]>;
  /** Items already recorded on the Project (scope / requirements checklist). Kept separate from brief lines. */
  recorded: string[];
  missing: string[];
  questions: string[];
  limited: boolean;
  notices: string[];
  original: string;
}
const MAX_BRIEF = 4000;
const RX = {
  objective: /\b(goal|objective|aim|purpose|so that|in order to|increase|grow|generate|get more|want (?:people|customers|users) to)\b|उद्देश्य|लक्ष्य/i,
  client: /\b(client|customer|you|they)\s+(?:will|to|should|must|shall)\s+(?:provide|send|share|supply|give|arrange)\b|\b(?:will be )?provided by (?:the )?client\b|\bclient (?:provides|sends|shares)\b|क्लाइंट (?:देंगे|भेजेंगे)|client (?:dega|bhejega|denge|bhejenge)/i,
  functional: /\b(should|must|needs? to|able to|allow|enable|support|integrat\w*|login|sign ?up|search|filter|cart|checkout|booking|form|payment gateway|whatsapp button|chat|dashboard|admin panel|notification|upload|download)\b/i,
  deliverable: /\b(page|pages|website|site|landing|logo|brand(?:ing)?|app|section|banner|brochure|catalog(?:ue)?|video|post|creatives?|design|e-?commerce|blog|portfolio)\b|वेबसाइट|पेज/i,
  unclear: /\?|\b(tbd|to be decided|maybe|not sure|later|probably|etc)\b|शायद/i,
};
export function splitBrief(text: string): string[] {
  return text.split(/\r?\n|;|•|(?<=\.)\s+(?=[A-Z\u0900-\u097F])/).map((l) => l.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 1);
}
export function structureRequirements(brief: string, ctx: ProjectAIContext): StructuredBrief {
  const original = brief;
  const sections: Record<ReqSection, string[]> = { objectives: [], deliverables: [], functional: [], client: [], other: [] };
  const notices: string[] = [];
  const recorded = [...(ctx.scope ? [`Agreed scope: ${ctx.scope}`] : []), ...ctx.requirements.map((r) => `${r.done ? "✓" : "○"} ${r.label}`)];
  const questions: string[] = [];
  let limited = false;
  if (brief.length > MAX_BRIEF) {
    limited = true;
    notices.push(`This brief is longer than ${MAX_BRIEF} characters. Demo rules can't reliably interpret it, so the original is kept unchanged below.`);
  }
  const lines = limited ? [] : splitBrief(brief);
  for (const l of lines) {
    const key: ReqSection = RX.client.test(l) ? "client" : RX.objective.test(l) ? "objectives" : RX.functional.test(l) ? "functional" : RX.deliverable.test(l) ? "deliverables" : "other";
    sections[key].push(l);
    if (RX.unclear.test(l)) questions.push(`Please confirm: “${l}”`);
  }
  const classified = lines.length - sections.other.length;
  if (!limited && lines.length >= 4 && classified / lines.length < 0.3) {
    limited = true;
    notices.push("Most of this brief doesn't match the simple Demo rules. Lines are kept as written under “Other notes” — review them yourself.");
  }
  if (!brief.trim()) notices.push("No brief entered — showing only what is recorded on the Project.");
  const missing: string[] = [];
  if (!ctx.scope) missing.push("Agreed scope is not recorded.");
  if (!ctx.requirements.length) missing.push("No requirements checklist items are recorded.");
  if (!ctx.targetDelivery) missing.push("No target delivery date is recorded.");
  if (brief.trim() && !sections.objectives.length) missing.push("The brief doesn't state a business objective.");
  if (brief.trim() && !sections.client.length && !ctx.waitingOnClient.length && !ctx.clientItemsReceived.length) missing.push("It isn't recorded what the client must provide (content, photos, logins location, etc.).");
  for (const w of ctx.waitingOnClient) missing.push(`Still waiting on client: ${w}`);
  if (!sections.objectives.length && brief.trim()) questions.push("What is the main goal of this project for the client's business?");
  if (!ctx.targetDelivery) questions.push("Is there an agreed delivery date? (Don't promise one until it is agreed.)");
  if (brief.trim() && !sections.client.length && !ctx.waitingOnClient.length) questions.push("Which content and materials will the client provide, and when?");
  return { sections, recorded, missing, questions, limited, notices, original };
}

// ---------- Task suggestions ----------
export interface TaskSuggestion { id: string; title: string; description: string; reason: string; duplicateOf?: string }
const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "on", "in", "with", "add", "set", "up", "setup", "create", "make", "build", "do", "page", "task", "client", "follow", "qa", "handover", "check", "review", "implement"]);
const words = (s: string) => new Set(s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
export function findDuplicate(title: string, existing: { title: string }[]): string | undefined {
  const a = words(title);
  for (const t of existing) {
    const b = words(t.title);
    if (!a.size || !b.size) { if (t.title.trim().toLowerCase() === title.trim().toLowerCase()) return t.title; continue; }
    let inter = 0; for (const w of a) if (b.has(w)) inter++;
    if (inter / Math.min(a.size, b.size) >= 0.6) return t.title;
  }
  return undefined;
}
export function suggestTasks(ctx: ProjectAIContext): { suggestions: TaskSuggestion[]; notices: string[] } {
  const notices: string[] = [];
  if (isDelivered(ctx)) return { suggestions: [], notices: ["This project is delivered. Development tasks aren't suggested — use support requests for new work."] };
  if (ctx.status === "cancelled") return { suggestions: [], notices: ["This project is cancelled. No tasks are suggested."] };
  const out: TaskSuggestion[] = [];
  const seen = new Set<string>();
  const push = (title: string, description: string, reason: string) => {
    const t = title.replace(/\s+/g, " ").trim().slice(0, 120);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return; seen.add(k);
    const dup = findDuplicate(t, ctx.tasks);
    out.push({ id: `sg_${out.length}`, title: t, description, reason, ...(dup ? { duplicateOf: dup } : {}) });
  };
  for (const r of ctx.requirements.filter((x) => !x.done)) push(r.label, "Work on this recorded requirement.", "Open item in the Requirements checklist.");
  if (ctx.scope) for (const l of splitBrief(ctx.scope)) if (RX.deliverable.test(l) || RX.functional.test(l)) push(l, "Taken word-for-word from the agreed scope.", "Stated in the recorded agreed scope.");
  for (const d of ctx.waitingOnClient) push(`Request from client: ${d}`, "Ask the client for this item. It is recorded as not yet received.", "Listed under “Waiting on client”.");
  for (const q of ctx.qa.filter((x) => !x.done)) push(`QA: ${q.label}`, "Complete this quality check before delivery.", "Open item in the QA checklist.");
  for (const h of ctx.handover.filter((x) => !x.done)) push(`Handover: ${h.label}`, "Complete this handover item before delivery.", "Open item in the Handover checklist.");
  if (!out.length) notices.push("No clear recorded requirement, scope line or checklist item to base a task on. Add requirements first.");
  return { suggestions: out.slice(0, 15), notices };
}

// ---------- Next action ----------
export interface NextAction { kind: "request_content" | "add_tasks" | "review_task" | "confirm_milestone" | "complete_handover" | "review_delivery" | "confirm_approval" | "review_support" | "none"; title: string; evidence: string[] }
export function nextAction(ctx: ProjectAIContext): NextAction {
  const s = taskStats(ctx);
  if (isDelivered(ctx)) {
    if (ctx.openSupportRequests > 0) return { kind: "review_support", title: "Review open support requests", evidence: [`Delivered${ctx.delivery ? ` on ${dayLabel(ctx.delivery.date)}` : ""}.`, `${ctx.openSupportRequests} support request(s) still open.`] };
    if (ctx.delivery?.approval === "pending") return { kind: "confirm_approval", title: "Confirm the client's approval of the delivery", evidence: [`Delivered on ${dayLabel(ctx.delivery.date)}.`, "Client approval is recorded as pending."] };
    return { kind: "none", title: "No action currently needed", evidence: [`Delivered${ctx.delivery ? ` on ${dayLabel(ctx.delivery.date)}` : ""}.`, "No open support requests or pending approval recorded."] };
  }
  if (ctx.status === "cancelled" || ctx.status === "on_hold") return { kind: "none", title: "No action currently needed", evidence: [`Project status is ${ctx.statusText}.`] };
  if (ctx.waitingOnClient.length) return { kind: "request_content", title: "Request missing client content", evidence: [`Recorded as waiting on client: ${ctx.waitingOnClient.join(", ")}.`, "Based on the checklist — not on how much time has passed."] };
  if (!s.total) return { kind: "add_tasks", title: "Add the first tasks for this project", evidence: ["No tasks are recorded, so progress can't be measured."] };
  const open = ctx.tasks.filter((t) => !t.done);
  const next = ctx.milestones.find((m) => !m.complete);
  if (next && !next.dueDate && next.total > 0) return { kind: "confirm_milestone", title: `Confirm a date for the next milestone “${next.title}”`, evidence: [`${next.done} of ${next.total} tasks in this milestone are done.`, "No due date is recorded for it."] };
  if (open.length) {
    const t = [...open].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0]!;
    return { kind: "review_task", title: `Review the incomplete task “${t.title}”`, evidence: [`${s.done} of ${s.total} tasks complete.`, t.dueDate ? `Its recorded due date is ${dayLabel(t.dueDate)}.` : "It has no due date recorded."] };
  }
  const gaps = deliveryOpen(ctx);
  if (gaps.length) return { kind: "complete_handover", title: "Complete pending QA and handover items", evidence: ["All tasks are complete.", `Open checklist items: ${gaps.join(", ")}.`] };
  return { kind: "review_delivery", title: "Review delivery readiness and record the delivery", evidence: ["All tasks are complete.", "QA and handover checklists have no open items."] };
}

// ---------- Client update writer ----------
export type UpdatePurpose = "progress" | "pending_content" | "delay" | "milestone" | "delivery_ready" | "status";
export const UPDATE_PURPOSES: UpdatePurpose[] = ["progress", "pending_content", "delay", "milestone", "delivery_ready", "status"];
export const UPDATE_PURPOSE_LABEL: Record<UpdatePurpose, string> = { progress: "Development progress", pending_content: "Request pending content or requirements", delay: "Explain a recorded delay", milestone: "Share a milestone update", delivery_ready: "Delivery-ready message", status: "General project status update" };
export type UpdateLang = "en" | "hi" | "hinglish";
export const UPDATE_LANG_LABEL: Record<UpdateLang, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
export const UPDATE_TONES: RewriteTone[] = ["professional", "friendly", "short"];
export interface ClientUpdateRequest { ctx: ProjectAIContext; purpose: UpdatePurpose; tone: RewriteTone; lang: UpdateLang; variant: number }
export interface ClientUpdateResult { text: string; blocked: boolean; simulated: true; label: string; contextUsed: string[]; notices: string[] }
export interface ProjectAssistProvider { clientUpdate(req: ClientUpdateRequest): Promise<ClientUpdateResult> }

type L = Record<UpdateLang, string>;
const P = {
  hi: { en: ["Hi", "Hello"], hi: ["नमस्ते", "नमस्कार"], hinglish: ["Hi", "Namaste"] } as Record<UpdateLang, string[]>,
  thanks: { en: "Thank you.", hi: "धन्यवाद।", hinglish: "Thank you." } as L,
  friendlyEnd: { en: ["Happy to answer any questions!", "Let me know if anything is unclear!"], hi: ["कोई सवाल हो तो बताइए!", "कुछ भी पूछना हो तो बताइए!"], hinglish: ["Koi bhi sawaal ho toh batayein!", "Kuch bhi poochna ho toh batayein!"] } as Record<UpdateLang, string[]>,
};
function progressLine(c: ProjectAIContext, lang: UpdateLang): string {
  const s = taskStats(c);
  if (!s.total) return { en: `“${c.name}” is currently at the ${c.stageText} stage.`, hi: `“${c.name}” अभी ${c.stageText} चरण में है।`, hinglish: `“${c.name}” abhi ${c.stageText} stage par hai.` }[lang];
  return { en: `On “${c.name}”, ${s.done} of ${s.total} planned tasks are complete and we are at the ${c.stageText} stage.`, hi: `“${c.name}” में ${s.total} में से ${s.done} काम पूरे हो चुके हैं और अभी ${c.stageText} चरण चल रहा है।`, hinglish: `“${c.name}” mein ${s.total} mein se ${s.done} tasks complete ho chuke hain aur abhi ${c.stageText} stage chal raha hai.` }[lang];
}
function pendingLine(c: ProjectAIContext, lang: UpdateLang): string {
  const list = c.waitingOnClient.join(", ");
  return { en: `To keep things moving, we still need from you: ${list}.`, hi: `काम आगे बढ़ाने के लिए हमें आपसे अभी ये चाहिए: ${list}।`, hinglish: `Kaam aage badhane ke liye humein aapse abhi ye chahiye: ${list}.` }[lang];
}
function targetLine(c: ProjectAIContext, lang: UpdateLang): string {
  if (!c.targetDelivery) return "";
  const d = dayLabel(c.targetDelivery);
  return { en: `Our current planned target date is ${d}.`, hi: `हमारी अभी की योजना के अनुसार लक्ष्य तिथि ${d} है।`, hinglish: `Abhi ki planning ke hisaab se target date ${d} hai.` }[lang];
}

export function demoClientUpdate(req: ClientUpdateRequest): ClientUpdateResult {
  const { ctx: c, purpose, tone, lang, variant } = req;
  const notices: string[] = [];
  const used = contextUsed(c);
  const s = taskStats(c);
  const gaps = deliveryOpen(c);
  const done = isDelivered(c);
  const blocked = (msg: string): ClientUpdateResult => ({ text: "", blocked: true, simulated: true, label: PROJECT_DEMO_LABEL, contextUsed: used, notices: [msg] });
  const body: string[] = [];
  switch (purpose) {
    case "progress":
      if (done) return blocked("This project is already delivered — a development-progress update would be inaccurate. Use “General project status update” instead.");
      body.push(progressLine(c, lang));
      if (s.open) body.push({ en: `${s.open} task(s) are still in progress.`, hi: `${s.open} काम अभी चल रहे हैं।`, hinglish: `${s.open} task(s) abhi chal rahe hain.` }[lang]);
      break;
    case "pending_content":
      if (!c.waitingOnClient.length) return blocked("Nothing is recorded under “Waiting on client”, so there is no pending content to request. Add the items first.");
      body.push(pendingLine(c, lang));
      body.push({ en: "Please share these when convenient.", hi: "कृपया सुविधा अनुसार ये भेज दें।", hinglish: "Please convenient ho toh ye share kar dijiye." }[lang]);
      break;
    case "delay":
      if (done) return blocked("This project is delivered — there is no delay to explain.");
      if (c.waitingOnClient.length) {
        body.push({ en: `A quick update on “${c.name}”: some work is on hold until we receive the pending items.`, hi: `“${c.name}” पर एक अपडेट: बाकी सामग्री मिलने तक कुछ काम रुका हुआ है।`, hinglish: `“${c.name}” par ek update: pending items milne tak kuch kaam ruka hua hai.` }[lang]);
        body.push(pendingLine(c, lang));
      } else {
        notices.push("No delay reason is recorded. Replace [reason] with the real reason before sending — the client is not blamed by default.");
        body.push({ en: `A quick update on “${c.name}”: the work is taking a little longer than planned because of [reason].`, hi: `“${c.name}” पर एक अपडेट: [reason] की वजह से काम में योजना से थोड़ा ज़्यादा समय लग रहा है।`, hinglish: `“${c.name}” par ek update: [reason] ki wajah se kaam mein thoda zyada time lag raha hai.` }[lang]);
      }
      body.push({ en: "We'll confirm a revised date once it is agreed.", hi: "नई तिथि तय होते ही हम आपको बताएंगे।", hinglish: "Nayi date fix hote hi hum aapko batayenge." }[lang]);
      break;
    case "milestone": {
      if (!c.milestones.length) return blocked("No milestones are recorded for this project.");
      const comp = c.milestones.filter((m) => m.complete);
      const next = c.milestones.find((m) => !m.complete);
      if (comp.length) body.push({ en: `Completed: ${comp.map((m) => m.title).join(", ")}.`, hi: `पूरे हुए चरण: ${comp.map((m) => m.title).join(", ")}।`, hinglish: `Complete ho gaye: ${comp.map((m) => m.title).join(", ")}.` }[lang]);
      if (next) body.push({ en: `Next up: ${next.title} (${next.done} of ${next.total} tasks done${next.dueDate ? `, planned for ${dayLabel(next.dueDate)}` : ""}).`, hi: `अगला चरण: ${next.title} (${next.total} में से ${next.done} काम पूरे${next.dueDate ? `, योजना ${dayLabel(next.dueDate)}` : ""})।`, hinglish: `Next: ${next.title} (${next.total} mein se ${next.done} tasks done${next.dueDate ? `, planned ${dayLabel(next.dueDate)}` : ""}).` }[lang]);
      break;
    }
    case "delivery_ready":
      if (c.delivery) {
        body.push({ en: `“${c.name}” was delivered on ${dayLabel(c.delivery.date)}.${c.delivery.url ? ` You can view it here: ${c.delivery.url}` : ""}`, hi: `“${c.name}” ${dayLabel(c.delivery.date)} को डिलीवर किया गया।${c.delivery.url ? ` आप इसे यहाँ देख सकते हैं: ${c.delivery.url}` : ""}`, hinglish: `“${c.name}” ${dayLabel(c.delivery.date)} ko deliver kiya gaya.${c.delivery.url ? ` Aap ise yahan dekh sakte hain: ${c.delivery.url}` : ""}` }[lang]);
        break;
      }
      if (s.open || gaps.length || !s.total) return blocked(`Not delivery-ready: ${!s.total ? "no tasks recorded" : `${s.open} task(s) open`}${gaps.length ? `, ${gaps.length} QA/handover item(s) open` : ""}. A delivery message would be inaccurate.`);
      body.push({ en: `All recorded tasks and checks for “${c.name}” are complete and it is ready for your review.`, hi: `“${c.name}” के सभी दर्ज काम और जाँच पूरी हो गई हैं, और यह आपकी समीक्षा के लिए तैयार है।`, hinglish: `“${c.name}” ke saare recorded tasks aur checks complete hain, aur ye aapke review ke liye ready hai.` }[lang]);
      break;
    case "status":
      if (done) body.push(c.delivery ? { en: `“${c.name}” was delivered on ${dayLabel(c.delivery.date)} and is now in ${c.stageText}.`, hi: `“${c.name}” ${dayLabel(c.delivery.date)} को डिलीवर हुआ और अभी ${c.stageText} में है।`, hinglish: `“${c.name}” ${dayLabel(c.delivery.date)} ko deliver hua aur abhi ${c.stageText} mein hai.` }[lang] : progressLine(c, lang));
      else { body.push(progressLine(c, lang)); if (c.waitingOnClient.length) body.push(pendingLine(c, lang)); }
      break;
  }
  if (!done && purpose !== "delay" && purpose !== "delivery_ready" && tone !== "short") { const t = targetLine(c, lang); if (t) body.push(t); }
  const greet = `${P.hi[lang][variant % 2]} ${c.firstName}${lang === "hi" ? " जी" : ""},`;
  const end = tone === "friendly" ? P.friendlyEnd[lang][variant % 2]! : P.thanks[lang];
  const parts = tone === "short" ? [greet, body.slice(0, 2).join(" ")] : [greet, body.join(" "), end];
  return { text: parts.join(tone === "short" ? " " : "\n\n"), blocked: false, simulated: true, label: PROJECT_DEMO_LABEL, contextUsed: used, notices };
}

export function contextUsed(c: ProjectAIContext): string[] {
  const s = taskStats(c);
  return [
    `Project: ${c.name}`, `Client: ${c.clientName}`, `Stage: ${c.stageText}`, `Status: ${c.statusText}`,
    `Tasks: ${s.total ? `${s.done} of ${s.total} complete` : NOT_RECORDED}`,
    `Milestones: ${c.milestones.length ? c.milestones.map((m) => `${m.title} ${m.done}/${m.total}`).join(", ") : NOT_RECORDED}`,
    `Waiting on client: ${c.waitingOnClient.length ? c.waitingOnClient.join(", ") : "Nothing recorded"}`,
    `Target delivery: ${c.targetDelivery ? dayLabel(c.targetDelivery) : NOT_RECORDED}`,
    `Delivery: ${c.delivery ? `Delivered ${dayLabel(c.delivery.date)}` : "Not delivered"}`,
  ];
}

/** Claims the Owner's final text must not make unless the recorded facts support them. Blocks "Use suggestion". */
export function updateViolations(c: ProjectAIContext, original: string, text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  const s = taskStats(c);
  const allDone = s.total > 0 && s.open === 0;
  if (!isDelivered(c) && /\b(is|are|has been|have been|was|got)\s+(now\s+)?(complete|completed|finished|live|launched|delivered)\b|\bwent live\b|डिलीवर (हो गया|कर दिया)|\b(ho gaya|deliver ho)\b/i.test(text) && !/\btasks?\b[^.]*\b(complete|completed)\b/i.test(text)) out.push("Says the project is complete, live or delivered — that isn't recorded.");
  if (!allDone && /\ball (the )?(recorded )?tasks( and checks)?( for [^.]*)? (are|is|have been) (now )?(complete|completed|done|finished)\b|सभी (दर्ज )?काम[^।]*पूरी? हो/i.test(text)) out.push("Says all tasks are complete — some are still open.");
  if (/\bpayment[s]?\b[^.]*\b(received|cleared|credited)\b|\breceived your payment\b|\bpaid in full\b|भुगतान (मिल|प्राप्त)/i.test(text)) out.push("Mentions a received payment — payments aren't part of this assistant's facts.");
  if (/\bdiscount\b|\bfree of cost\b|\bcomplimentary\b|\bextra (feature|page)s? (at no|for free)\b|छूट/i.test(text) && !/discount|complimentary|free of cost|छूट/i.test(original)) out.push("Offers a discount or free extra — not approved in the records.");
  if (/\b(tomorrow|tonight|today|next week|this week|by monday|by friday)\b|\b(kal|aaj)\b|(^|\s)(कल|आज)(\s|$)/i.test(text) && !/\b(tomorrow|tonight|today|next week|this week|kal|aaj)\b|कल|आज/i.test(original)) out.push("Uses a relative deadline (e.g. “tomorrow”) that isn't an agreed date.");
  const allowed = new Set([...contextUsed(c).join(" ").matchAll(/\d+/g)].map((m) => m[0]).concat([...original.matchAll(/\d+/g)].map((m) => m[0])));
  for (const tk of [...c.tasks.map((x) => x.title), ...c.waitingOnClient, ...c.milestones.map((m) => m.title), c.name, c.delivery?.url ?? "", ...c.milestones.map((m) => (m.dueDate ? dayLabel(m.dueDate) : ""))].join(" ").matchAll(/\d+/g)) allowed.add(tk[0]);
  const extra = [...text.matchAll(/\d+/g)].map((m) => m[0]).filter((n) => !allowed.has(n));
  if (extra.length) out.push(`Adds numbers or dates not in the records: ${[...new Set(extra)].slice(0, 5).join(", ")}.`);
  const urls = [...text.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0].replace(/[.,)]+$/, ""));
  if (urls.some((u) => u !== c.delivery?.url && !original.includes(u))) out.push("Adds a link that isn't recorded.");
  if (/₹\s?\d/.test(text) && !/₹\s?\d/.test(original)) out.push("Adds an amount — amounts aren't part of this assistant's facts.");
  if (!t.includes(c.firstName.toLowerCase())) out.push(`Drops the client's name (${c.firstName}).`);
  return out;
}

export const demoProjectAssistProvider: ProjectAssistProvider = { clientUpdate: async (req) => { await new Promise((r) => setTimeout(r, 120)); return demoClientUpdate(req); } };
/** Swap point for the future secure server endpoint. */
export const getProjectAssistProvider = (): ProjectAssistProvider => demoProjectAssistProvider;
void (0 as unknown as typeof _t); declare const _t: unknown;
