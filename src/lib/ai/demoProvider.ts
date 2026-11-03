// Demo Mode provider: deterministic, offline, clearly labelled. No network requests, no CRM writes.
import type { AIProvider, AIRequest, AIResponse, SuggestedAction, AIModuleInfo } from "./types";

export const DEMO_LABEL = "Demo Mode · simulated example, not a live AI model";

export const AI_MODULES: AIModuleInfo[] = [
  { id: "lead_intelligence", label: "Lead intelligence", needsLead: true, available: true },
  { id: "next_best_action", label: "Next best action", needsLead: true, available: true },
  { id: "call_preparation", label: "Call preparation", needsLead: true, available: true },
  { id: "objection_handling", label: "Objection handling", needsLead: false, available: false },
  { id: "whatsapp_drafting", label: "WhatsApp drafting", needsLead: true, available: false },
  { id: "followup_recommendations", label: "Follow-up advice", needsLead: true, available: false },
  { id: "performance_insights", label: "Performance insights", needsLead: false, available: false },
];

export const SUGGESTED_QUESTIONS = [
  { module: "lead_intelligence", text: "Summarise this lead for me" },
  { module: "next_best_action", text: "What should I do next with this lead?" },
  { module: "call_preparation", text: "Help me prepare for my next call" },
  { module: "general", text: "How should I prioritise my day?" },
] as const;

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function demoAnswer(req: AIRequest): { text: string; suggestions: SuggestedAction[] } {
  const l = req.context.lead;
  const q = req.question.toLowerCase();
  if (!l) {
    return {
      text: "Example answer (Demo Mode): start with overdue follow-ups, then leads in Proposal Sent, then new leads not yet contacted. Pick a lead with \"Ask AI\" to get advice based on that lead's saved details.",
      suggestions: [],
    };
  }
  const lines: string[] = [`Example answer (Demo Mode) for ${l.name}, based only on what is saved in the CRM:`];
  lines.push(`• Stage: ${l.stage}, ${l.priority} priority, from ${l.source}.`);
  if (l.requirement) lines.push(`• Saved requirement: ${l.requirement}.`);
  lines.push(l.lastContact ? `• Last contact is recorded.` : `• No contact recorded yet.`);
  lines.push(l.pendingFollowUps ? `• ${l.pendingFollowUps} follow-up(s) still open.` : `• No follow-up booked.`);
  if (l.money) lines.push(`• Agreed ${fmt(l.money.dealsAgreed)}, received ${fmt(l.money.received)}, outstanding ${fmt(l.money.outstanding)}.`);
  const s: SuggestedAction[] = [];
  if (q.includes("call") || req.module === "call_preparation") {
    lines.push("Suggested call outline: confirm the requirement, ask about timeline and decision maker, agree a next step before hanging up.");
    s.push({ id: "log", label: "Log a call", kind: "log_call", leadId: l.leadId });
  } else {
    lines.push(!l.lastContact ? "Suggestion: make a first call today." : l.pendingFollowUps ? "Suggestion: complete the open follow-up before adding a new one." : "Suggestion: book a follow-up so this lead doesn't go quiet.");
    if (!l.pendingFollowUps) s.push({ id: "fu", label: "Schedule a follow-up", kind: "schedule_followup", leadId: l.leadId });
    s.push({ id: "wa", label: "Draft a WhatsApp message", kind: "draft_whatsapp", leadId: l.leadId });
  }
  s.push({ id: "open", label: "Open lead", kind: "open_lead", leadId: l.leadId });
  lines.push("These are suggestions only — nothing has been changed or sent.");
  return { text: lines.join("\n"), suggestions: s };
}

export const demoProvider: AIProvider = {
  id: "demo",
  status: () => ({ state: "demo", label: DEMO_LABEL }),
  async ask(req) {
    if (!req.question.trim()) throw { code: "invalid", message: "Type a question first.", retryable: false };
    await new Promise((r) => setTimeout(r, 600));
    if (/\bsimulate error\b/i.test(req.question)) throw { code: "unavailable", message: "The assistant couldn't answer right now.", retryable: true };
    const a = demoAnswer(req);
    const res: AIResponse = { requestId: req.id, text: a.text, suggestions: a.suggestions, simulated: true, providerLabel: DEMO_LABEL, at: new Date().toISOString() };
    return res;
  },
};

/** Single swap point: replace with a client for the future authenticated server endpoint. */
export const getProvider = (): AIProvider => demoProvider;
