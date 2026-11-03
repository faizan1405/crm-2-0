// AI Sales Copilot contracts (checkpoint AI-1). Screens depend only on these types and the
// `AIProvider` interface, so the Demo provider can be swapped for a secure server-side
// OpenRouter endpoint later without rebuilding the UI.

export type AIModuleId =
  | "lead_intelligence"
  | "next_best_action"
  | "call_preparation"
  | "objection_handling"
  | "whatsapp_drafting"
  | "followup_recommendations"
  | "performance_insights";

export interface AIModuleInfo { id: AIModuleId; label: string; needsLead: boolean; available: boolean }

/** Minimised, permission-filtered view of one Lead. Never contains payment proofs, secrets or personal notes. */
export interface LeadContext {
  leadId: string;
  name: string;
  company?: string;
  stage: string;
  priority: string;
  source: string;
  requirement?: string;
  lastContact?: string;
  nextFollowUp?: string;
  clientNotes?: string;
  recentActivity: string[];
  pendingFollowUps: number;
  /** Present only when the viewer may see amounts. */
  money?: { quotedOrBudget?: number; dealsAgreed: number; received: number; outstanding: number };
  /** Recorded facts used by the Lead Intelligence demo engine (AI-2). */
  facts: {
    statusKey: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
    hasEmail: boolean;
    callAttempts: number;
    connectedCalls: number;
    /** Unsuccessful call attempts since the last connected call. */
    unsuccessfulStreak: number;
    lastInteraction?: { at: string; type: string; text: string };
    nextFollowUpDue?: string;
    overdueFollowUp: boolean;
    lastActivityAt?: string;
    lostReason?: string;
  };
  /** Field groups deliberately withheld, shown to the user for transparency. */
  excluded: string[];
}

export interface AIContext { lead?: LeadContext; viewer: { role: "owner" | "employee"; name: string } }

export interface AIRequest { id: string; module: AIModuleId | "general"; question: string; context: AIContext; at: string }

export interface SuggestedAction { id: string; label: string; kind: "open_lead" | "schedule_followup" | "draft_whatsapp" | "log_call"; leadId?: string }

export interface AIResponse { requestId: string; text: string; suggestions: SuggestedAction[]; simulated: boolean; providerLabel: string; at: string }

export type AIErrorCode = "unavailable" | "timeout" | "rate_limited" | "denied" | "invalid" | "unknown";
export interface AIError { code: AIErrorCode; message: string; retryable: boolean }

export type ProviderStatus = { state: "demo"; label: string } | { state: "live"; label: string } | { state: "unavailable"; reason: string };

export interface AIProvider {
  id: string;
  status(): ProviderStatus;
  /** Must never mutate CRM data. Rejects with an `AIError`. */
  ask(req: AIRequest): Promise<AIResponse>;
}

export type ContextResult = { ok: true; lead: LeadContext } | { ok: false; reason: "not_found" | "not_permitted" };
