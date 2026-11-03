// In-memory conversation state (never persisted — no AI content in localStorage/backups).
import { create } from "zustand";
import type { AIResponse, AIError } from "./types";

export type ChatMsg = { id: string; role: "user"; text: string; leadId?: string } | { id: string; role: "assistant"; res: AIResponse; leadId?: string };

interface CopilotState {
  leadId: string | null;
  messages: ChatMsg[];
  pending: boolean;
  error: (AIError & { question: string }) | null;
}
export const useCopilot = create<CopilotState>(() => ({ leadId: null, messages: [], pending: false, error: null }));
/** Switching lead clears the conversation so no stale lead context remains on screen. */
export function selectLead(id: string | null) {
  const s = useCopilot.getState();
  if (s.leadId === id) return;
  useCopilot.setState({ leadId: id, messages: [], error: null, pending: false });
}
export const clearConversation = () => useCopilot.setState({ messages: [], error: null, pending: false });
