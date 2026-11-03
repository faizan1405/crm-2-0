// AI-3C Owner Notes Assistant — contracts + conservative deterministic Demo formatting.
// Never invents: every sentence the Owner wrote is kept (tidied) and only *sorted* into sections
// by simple keyword rules. Unknown sections say "Not discussed"; Lead gaps say "Not recorded".
// No network, no CRM writes. `getNotesProvider()` is the swap point for a future secure endpoint.
import type { LeadContext } from "./types";
import { tidy, rewriteViolations } from "./rewrite";

export type NoteMode = "improve" | "structure";
export const NOTES_DEMO_LABEL = "Demo Mode — not live AI";
export const NOT_DISCUSSED = "Not discussed";
export const NOT_RECORDED = "Not recorded";

export type SectionId = "requirements" | "problem" | "outcome" | "budget" | "objections" | "commitments";
export const SECTION_LABEL: Record<SectionId, string> = {
  requirements: "Customer requirements", problem: "Current problem or pain point", outcome: "Desired outcome",
  budget: "Budget discussion", objections: "Objections or concerns", commitments: "Commitments actually made",
};
const SECTION_RULES: [SectionId, RegExp][] = [
  ["budget", /₹|\b(budget|price|pricing|cost|rs\.?|inr|lakh|\d+\s?k\b|paisa|kitna|rate)\b|बजट|कीमत/i],
  ["objections", /\b(expensive|too high|costly|cheaper|not sure|worried|concern|hesitant|partner|think about it|mehenga|mahanga|doubt|trust)\b|महंगा/i],
  ["commitments", /\b(will send|will share|will call|promised|agreed|confirmed|i'?ll|we'?ll|bhej(e|ega|enge|unga)|kar denge|send karenge)\b|भेज/i],
  ["problem", /\b(problem|issue|no enquir|not getting|losing|old site|outdated|slow|nahi aa rahe|dikkat|pareshani)\b|समस्या/i],
  ["outcome", /\b(want(s)? (more|to get|to increase)|goal|so that|increase|more (leads|customers|enquiries|sales)|grow|chahte|chahiye)\b|चाहिए/i],
  ["requirements", /\b(website|site|landing|page|pages|e-?commerce|shop|app|seo|logo|domain|hosting|whatsapp button|form|gallery|booking|payment gateway|requirement|need(s)?)\b|वेबसाइट/i],
];

export type ActionKind = "follow_up" | "request_info" | "prepare_quotation" | "discuss_objection" | "call_again";
export const ACTION_LABEL: Record<ActionKind, string> = {
  follow_up: "Follow up with client", request_info: "Request missing information", prepare_quotation: "Prepare quotation",
  discuss_objection: "Discuss an objection", call_again: "Call again",
};
export interface ActionItem { kind: ActionKind; label: string; evidence: string; dateText?: string; confirmDate: boolean }

const DATE_WORDS = /\b(today|tomorrow|kal|parso|next (week|month)|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|after diwali|end of (the )?month|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}(st|nd|rd|th)?\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/i;
const ACTION_RULES: [ActionKind, RegExp][] = [
  ["call_again", /\b(not picked|didn'?t pick|no answer|busy|switched off|call again|phone nahi uthaya)\b/i],
  ["follow_up", /\b(follow ?up|call (me |him |her )?(back|later)|next (week|month)|later|baad mein|remind)\b/i],
  ["prepare_quotation", /\b(quote|quotation|proposal|estimate|pricing)\b|कोटेशन/i],
  ["request_info", /\b(will send|will share|send (the )?(content|logo|images|photos|details)|pending|not decided|unclear|confirm (the )?(pages|requirement))\b/i],
  ["discuss_objection", /\b(expensive|too high|costly|cheaper|not sure|partner|think about it|mehenga|hesitant|doubt)\b|महंगा/i],
];

export interface NoteRequest { mode: NoteMode; text: string; lead?: LeadContext; variant?: number }
export interface StructuredSummary {
  sections: { id: SectionId; label: string; lines: string[] }[];
  other: string[];
  missing: string[];
  nextAction: string;
}
export interface NoteResult {
  mode: NoteMode; text: string; label: string; simulated: true;
  /** False when nothing could be recognised — text is preserved and a limitation shown. */
  supported: boolean;
  summary?: StructuredSummary;
  actions: ActionItem[];
  notice?: string;
  /** Facts (₹ amounts, numbers, dates, links) dropped or added — must be empty to accept. */
  violations: string[];
}
export interface NotesProvider { run(req: NoteRequest): Promise<NoteResult> }

/** Split into sentences while keeping the user's punctuation; never drops text. */
export function sentences(text: string): string[] {
  return text.split(/\n+|(?<=[.!?।])\s+|;\s*/).map((s) => s.trim()).filter(Boolean);
}

export function detectActions(text: string): ActionItem[] {
  const out: ActionItem[] = [];
  for (const s of sentences(text)) for (const [kind, re] of ACTION_RULES) {
    if (!re.test(s) || out.some((a) => a.kind === kind)) continue;
    const d = s.match(DATE_WORDS)?.[0];
    out.push({ kind, label: ACTION_LABEL[kind], evidence: s, ...(d ? { dateText: d } : {}), confirmDate: !!d || kind === "follow_up" || kind === "call_again" });
  }
  return out;
}

export function structureNote(text: string, lead?: LeadContext): { text: string; summary: StructuredSummary; recognised: number } {
  const buckets = new Map<SectionId, string[]>(); const other: string[] = []; let recognised = 0;
  for (const raw of sentences(text)) {
    const s = tidy(raw);
    const hit = SECTION_RULES.find(([, re]) => re.test(raw));
    if (hit) { recognised++; buckets.set(hit[0], [...(buckets.get(hit[0]) ?? []), s]); } else other.push(s);
  }
  const sections = (Object.keys(SECTION_LABEL) as SectionId[]).map((id) => ({ id, label: SECTION_LABEL[id], lines: buckets.get(id) ?? [] }));
  const missing: string[] = [];
  if (!buckets.get("requirements")?.length && !lead?.requirement) missing.push(`Requirement: ${NOT_RECORDED}`);
  if (!buckets.get("budget")?.length) missing.push(`Budget: ${NOT_DISCUSSED}`);
  if (lead && !lead.company) missing.push(`Company: ${NOT_RECORDED}`);
  const acts = detectActions(text);
  const nextAction = acts[0] ? `${acts[0].label}${acts[0].dateText ? ` (“${acts[0].dateText}” — confirm the exact date)` : ""}` : NOT_DISCUSSED;
  const body = [
    ...sections.map((x) => `${x.label}:\n${x.lines.length ? x.lines.map((l) => `- ${l}`).join("\n") : `- ${NOT_DISCUSSED}`}`),
    ...(other.length ? [`Other notes (as written):\n${other.map((l) => `- ${l}`).join("\n")}`] : []),
    `Missing information:\n${missing.length ? missing.map((l) => `- ${l}`).join("\n") : "- Nothing obvious"}`,
    `Suggested next action:\n- ${nextAction}`,
  ].join("\n\n");
  return { text: body, summary: { sections, other, missing, nextAction }, recognised };
}

export function demoNote(req: NoteRequest): NoteResult {
  const actions = detectActions(req.text);
  if (req.mode === "improve") {
    const text = sentences(req.text).map(tidy).join("\n");
    return { mode: "improve", text, label: NOTES_DEMO_LABEL, simulated: true, supported: true, actions, violations: rewriteViolations(req.text, text),
      notice: "Demo Mode only tidies spacing, capitals and full stops, one point per line. Your words are kept as written; it doesn't translate or rewrite meaning." };
  }
  const { text, summary, recognised } = structureNote(req.text, req.lead);
  const supported = recognised > 0;
  return { mode: "structure", text, summary, label: NOTES_DEMO_LABEL, simulated: true, supported, actions, violations: rewriteViolations(req.text, text).filter((v) => v.startsWith("Missing")),
    notice: supported
      ? "Sentences were sorted by simple keyword rules. Anything not recognised is kept under “Other notes (as written)”. Check every section before saving."
      : "Demo Mode couldn't recognise anything in this note, so it's kept exactly as written under “Other notes”. It can't genuinely understand or summarise arbitrary text." };
}

export const demoNotesProvider: NotesProvider = {
  async run(req) {
    if (!req.text.trim()) throw { code: "invalid", message: "Type a note first.", retryable: false };
    await new Promise((r) => setTimeout(r, 300));
    return demoNote(req);
  },
};
export const getNotesProvider = (): NotesProvider => demoNotesProvider;
