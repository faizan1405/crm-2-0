# AI Sales Copilot — Architecture (checkpoint AI-1)

## What exists now (frontend only, Demo Mode)
- Page `/ai-copilot` ("AI Sales Copilot", Workspace menu). Needs `leads.view`.
- "Ask AI" on the Pipeline inspector and the full lead page → `/ai-copilot?lead=<id>`.
- `src/lib/ai/types.ts` — contracts: `AIRequest`, `AIContext`/`LeadContext`, `AIResponse`, `SuggestedAction`, `AIError`, `ProviderStatus`, `AIProvider`, seven `AIModuleId`s.
- `src/lib/ai/context.ts` — pure `buildLeadContext`: one lead only; assigned-only employees refused for leads not assigned to them; money (deal agreed/received/outstanding via `finance.ts`, voided ignored) only for Owner or finance level `amounts`/`manage`; payment activity removed otherwise; credential-like text masked; never includes payment-proof files, personal notes, other leads or login details. In Employee Preview the store is already the scoped copy, so AI cannot widen scope.
- `src/lib/ai/demoProvider.ts` — deterministic offline answers, labelled "Demo Mode · simulated example, not a live AI model"; no fetch; typing "simulate error" exercises the retry state. `getProvider()` is the single swap point.
- `src/lib/ai/copilotStore.ts` — in-memory conversation (never persisted/backed up). Changing lead clears the conversation; an answer for a lead that was switched away is dropped.
- Suggested actions only open existing dialogs (follow-up, WhatsApp composer, call log, lead page); nothing is changed until the user saves there.
- Modules built in demo: Lead intelligence, Next best action, Call preparation. Later: Objection handling, WhatsApp drafting, Follow-up advice, Performance insights.

## Future OpenRouter integration (not connected)
Replace `getProvider()` with a client that calls an authenticated server function. The backend must own:
- API key: server-side secret only. Never in frontend source, localStorage, IndexedDB, `VITE_*` env, GitHub or CRM backups.
- Authentication and authorization: rebuild the context server-side from the caller's real permissions (same rules as `buildLeadContext`); never trust context sent by the browser.
- Data minimisation: send only the fields in `LeadContext`; no proofs, notes, other leads, secrets.
- Per-user usage limits and rate limiting (`rate_limited` error).
- Cost monitoring per user/model.
- Model configuration held server-side.
- Request timeout + bounded retry (`timeout`/`unavailable`, `retryable`).
- Privacy-safe logging: no prompt/response bodies or customer data in logs.
- AI never writes Leads, Deals or Payments; suggested actions require explicit user confirmation.

## AI-2 — Lead Intelligence & Next Best Action (Demo Analysis)
- `LeadContext.facts` (built in `buildLeadContext`, same permission filtering): stage key, email present, call attempts / connected / unsuccessful streak, latest interaction, next follow-up + overdue, last activity, lost reason. Payment activity still removed for no-finance viewers.
- `src/lib/ai/intelligence.ts` pure `analyzeLead(ctx, now)` → summary, recorded facts, suggested attention (High / Medium / Low / Insufficient information — separate from manual priority, never written), signals, buying-intent signals, missing information, one primary next action + up to 2 alternatives, each with a reason. Missing data shows "Not enough information". Quoted/budget value is never used as intent.
- Rules: Won/Lost → Low, no action. Overdue follow-up, Qualified without a booked follow-up, or Proposal with 7+ quiet days → High. No contact, unanswered calls, or interest in notes → Medium. Too little recorded → Insufficient information. 2+ unanswered calls in a row → suggest a follow-up at another time instead of calling again.
- `src/components/ai/LeadIntelligencePanel.tsx` (labelled "Demo Analysis · fixed rules, not a live AI model") shown in the Copilot whenever a lead is selected (Ask AI from Pipeline inspector / lead page). Buttons only open existing forms (call button, follow-up form, message composer, lead page).

## Upcoming (not implemented)
- AI-3 Sales Coaching and WhatsApp assistance.
- AI-4 Smart Follow-ups and AI Analytics.
- AI-5 My Performance / Owner Performance dashboard (daily, weekly, monthly).
- AI-6 Collapsible sidebar groups: Workspace, Business, Personal, Owner, Owner Admin; whole-sidebar collapse; role-aware visibility.
- AI-7 Final AI frontend testing.
- Owner's manual check of the 3 real quotation packages.
- Secure OpenRouter backend integration (Antigravity + Hostinger) only after explicit approval.
