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

## AI-3A — WhatsApp AI Improve (Demo Mode)
- `src/lib/ai/rewrite.ts`: `RewriteRequest` (draft, tone, language, variant, client first name only — no history, money or notes), `RewriteResult`, `RewriteProvider`, `getRewriteProvider()` swap point. Tones: Professional, Friendly, Short & Direct, Persuasive but respectful. Languages: Keep my language, English, Hindi, Hinglish.
- Demo rewriter keeps the user's own sentences (only spacing/capitals/full stop tidied) and wraps them in a fixed greeting, opener and closing per tone/language; Try again switches between 2 fixed variants. It can't translate, and says so; generic text is labelled a light tidy-up. Scenarios detected for the label: quotation follow-up, not responding, pending requirements, payment reminder, introduction, general.
- `rewriteViolations` guard: any amount, number, date, link, email or #tag dropped from or added to the suggestion blocks "Use improved".
- `src/components/ai/AIImprovePanel.tsx` inside the WhatsApp composer for Custom messages: AI Improve → tone + language → suggestion shown separately with the original → Use improved / Keep original / Try again; loading, error + Retry. Accepting replaces the draft (still editable) and shows Undo improvement. The draft is never replaced automatically; unsaved-draft protection unchanged; nothing opens WhatsApp, logs, schedules or saves.
- Future live model must: preserve intent, never add prices/discounts/dates/commitments/payment or delivery claims, keep names/figures/terms; the server re-runs the same violation check.

Planned (not built): AI-3B call prep, coaching, objections · AI-3C writing help in Notes and Quotations · AI-4 follow-up intelligence and analytics · AI-5 Projects/Support/Finance assistance · AI-6 My/Owner Performance (daily/weekly/monthly) · AI-7 collapsible sidebar + final AI QA. Real OpenRouter only via a secure backend proxy (server-side key, permissions, data minimisation, usage limits).

## AI-3B — Owner Sales Coach (Demo Mode)
- `src/lib/ai/coach.ts`: pure contracts + demo rules — `CallPrepRequest`, `ObjectionRequest`, `ResponseReviewRequest`, `AfterCallRequest`; `prepareCall`, `OBJECTIONS` (8 categories), `reviewResponse` (honest limitation, simple checks only, no score), `suggestAfterCall`. Each item carries `ContentSource` (`crm` / `demo_rules` / `static_example`). `getCoachProvider()` is the swap point for a server-side OpenRouter coach; the key never reaches the browser.
- UI: `SalesCoachPanel` at `/ai-copilot?lead=<id>&tab=coach`; entry "Prepare Call with AI" on the Pipeline inspector and lead page. Keyed by lead so switching clears drafts. Buttons only open existing Follow-up / WhatsApp / lead / Sales Studio screens; nothing is logged, sent or saved.
- Context gained `facts.callOutcomes` (last 5 call outcomes of the selected lead only).

## AI-3C — Owner Notes Assistant (Demo Mode)
- `src/lib/ai/notes.ts`: `NoteRequest`/`NoteResult`/`NotesProvider`, `getNotesProvider()` swap point. Improve = tidy, one point per line. Structure = sentences sorted into 6 sections by keyword rules; unknown → "Not discussed", lead gaps → "Not recorded"; unrecognised sentences kept under "Other notes (as written)"; `supported:false` + honest limitation when nothing matched. `violations` (dropped ₹/numbers/dates/links) block "Use suggestion". `detectActions` → follow-up / request info / quotation / objection / call again, with date confirmation for vague dates.
- `LeadNoteEditor` replaces the lead page's one-line "Log" box (same `addActivity` note save, now multi-line). Use suggestion / Keep original / Undo improvement; unsaved-note blocker.
- `noteDraft.ts`: in-memory per-lead hand-off. Sales Coach → After Call → "Prepare Lead Note" opens `/leads/<id>#lead-note` with the summary as an unsaved draft. Nothing is saved, logged, scheduled or sent automatically.

## AI-3D — Owner Quotation Writing Assistant (Demo Mode)
- `src/lib/ai/quoteWriter.ts`: `QuoteRequest`/`QuoteResult`/`QuoteWriter`, `getQuoteWriter()` swap point. AI Improve = line-by-line tidy (bullets, spacing, capitals), WhatsApp formatting kept. AI Draft Scope = fixed sample structure for business / e-commerce / portfolio / redesign / 3D; deliverables only from features the Owner typed; the Owner's terms, support, hosting/domain and other figures copied as written; missing sections say "Not specified — please add"; optional ideas listed separately as "not included in the price"; Hindi/Hinglish headings only. Unrecognised or long briefs → honest "needs live AI" notice.
- `commercialViolations` protects placeholders, ₹, %, numbers, durations and links: anything dropped or not present in the package/requirements blocks "Use suggestion" with the reason.
- `QuotationAIPanel` lives inside the existing package editor (Sales Studio and WhatsApp "new package"). The suggestion is editable; Use suggestion only changes the unsaved draft; Undo improvement restores it; the existing Save template and discard-confirmation are unchanged. A Lead's requirement is added only when the Owner clicks "Add <name>'s recorded requirement".
