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
