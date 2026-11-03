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

## AI-4A — Smart Follow-up Priorities (Demo Analysis)
- `src/lib/ai/smartFollowups.ts`: `SmartFollowUpRequest`/`SmartFollowUpResult`/`SmartFollowUpProvider`, `getSmartFollowUpProvider()` swap point. Reuses `activeFollowUp`/`followUpBucket` (IST) from `crm/followups.ts` — one recommendation per lead, chosen by its earliest pending follow-up.
- Rules: pending past due → Overdue (High; Low for after-sales); pending later today → Due Today (Medium); pending within 7 days → Upcoming (Low); no pending + Proposal and no activity for ≥ `THRESHOLDS.proposalStallDays` (7, same as AI-2) → Proposals Needing Review (High); no pending + active lead → Missing Next Follow-up (Qualified High, others Medium; thin leads Low + "insufficient" limitation). Completed/cancelled follow-ups are never actionable; Won/Lost leads only appear for genuine pending after-sales follow-ups. Quoted value is never used.
- Summary counts follow-up records (overdue, due today, completed today in IST) and unique non-closed leads needing attention.
- `SmartFollowUps` panel on Follow-ups; buttons open existing Call, Schedule/Reschedule form, WhatsApp composer, Lead Intelligence and lead page only.

## AI-4B — Owner Smart Follow-up Message Writer (Demo Mode)

- Files: `src/lib/ai/followupWriter.ts` (contracts `FollowUpDraftRequest/Result`, `FollowUpDraftProvider`, facts builder, demo drafter, protected-detail check; swap point `getFollowUpDraftProvider()`), `src/components/ai/FollowUpWriterPanel.tsx`.
- Entry points: "AI Draft Message" on Smart Follow-up Priority cards, on the lead page Follow-ups section, and inside the WhatsApp Composer when Follow-up is selected. All reuse the existing composer; nothing new sends messages.
- 7 purposes, 4 styles, English/Hindi/Hinglish/Preserve original. Facts come from permission-filtered `buildLeadContext` plus this lead's recorded quotation shares and next follow-up note only. "Context used" is shown.
- Never claims a quotation was sent without a recorded share; missing requirement → neutral wording; Won leads → after-sales check-in. No amounts, dates, discounts or commitments are generated.
- Suggestion is editable and separate from the draft. Use suggestion / Keep original / Try again; Undo restores the prior draft. Use is blocked if the (edited) suggestion drops the client's name or adds numbers, prices, dates or links not in the recorded facts or current draft (Owner can still type them into the final message manually).
- Opening WhatsApp and "Log to history" are unchanged; no automatic sends, logs, follow-ups, stage, deal or payment changes.
- Follow-up form opened for a specific lead now shows "For <lead name>".
- Tests: `followupWriter.ai4b.test.ts` (8). 595 tests total.

## AI-5A — Owner Bulk Lead Import (CSV / XLSX / pasted tables)

- Third Add Lead method "Bulk AI Import" (`BulkImportPanel.tsx`); Quick AI Entry and Manual Entry unchanged. Labelled as deterministic file reading, not live AI.
- Pure rules in `src/lib/crm/bulkImport.ts`: RFC-style CSV/TSV/semicolon parser (quotes, embedded commas/newlines, BOM, Unicode), 1 MB / 50-row limits, exact-alias header pre-mapping (unknown columns → "Don't import", shown for review, never saved), budget parsing (₹, commas, k/L/Cr; never inferred from unmapped numbers), validation via existing `validPhone`/`validEmail`/`leadCreateError`, duplicates by Smart Inbox `normalizePhone` (+91 / 0-prefixed / bare).
- XLSX is read in the browser via `read-excel-file` (dynamic import); legacy .xls, PDF and other types are rejected. Files are never uploaded.
- Only rows marked Ready can be ticked; duplicates (in-batch or already in CRM) are never merged or overwritten.
- Store `importLeads` creates each lead through `addLead` inside one outer `atomic` action and re-checks phones against the latest saved leads — a storage failure rolls the whole batch back (this tab) and throws `PersistError`; retry cannot duplicate. This is browser-local all-or-nothing, not a server transaction.
- Results show processed / created / duplicates / invalid / excluded / failed counts and created IDs. No follow-ups, calls, deals or payments are created. Outside clicks don't close the window while in Bulk mode.
- Tests: `bulkImport.ai5a.test.ts` (14). 609 tests total.

## AI-5B — PDF & unstructured-text Bulk Lead Import (Demo Extraction)

- Same Bulk AI Import tab: new "Upload PDF" button and a paste switch "A table" / "Free text". Labelled "Demo Extraction — pattern-based parsing, not a live AI model."
- Pure `src/lib/crm/docExtract.ts`: `extractLeadsFromText` splits leads by blank lines, by table-style lines (one name + one phone per line) or by a name line followed by a phone line; extracts name, Indian mobile, email, and only *labelled* company/source/priority/budget ("Budget: …", "Budget discussed ₹40,000"). Unlabelled numbers are never budgets; date-like phrases ("Call next Friday") stay as note text — no follow-ups are created.
- Needs Review (blocks import until the field is edited or "I've checked these fields" is clicked): no phone found, 2+ phones (extras shown, never saved), several phones on one line (possible multi-column), no name, undecodable PDF characters (shown as �). Each row has "Original extracted text".
- Rows feed the AI-5A preview: same validation, duplicate detection (in batch + CRM), selection, storage estimate, confirmation and store `importLeads` (atomic, retry-safe). 50-lead limit.
- `LeadExtractionRequest/Response/Provider` + `demoExtractionProvider` are the swap point for a future secure server-side AI extractor.
- PDFs: read in-browser with pdf.js (`pdfjs-dist`, dynamic import, eval disabled), max 5 MB / first 20 pages, header must start with `%PDF-`. Extracted text is shown and editable before "Continue to Lead Review"; multi-column pages trigger a warning.

### Supported PDFs
- Supported: text-selectable PDFs (exported from Word/Docs/Sheets/browsers), multiple pages, simple text tables and name/phone/requirement lists, Hindi/Unicode **only when the PDF's fonts carry correct Unicode maps**.
- Not supported: scanned or image-only PDFs (no OCR — shows the scanned-PDF message), password-protected or damaged PDFs (clear error), complex multi-column layouts (warned + Needs Review, never auto-associated), form fields/annotations. Some PDF generators drop Devanagari conjunct mappings — those characters appear as � and must be retyped.
- Tests: `docExtract.ai5b.test.ts` (15). 624 tests total.
- Browser acceptance (synthetic data): 5-lead table PDF → 5 created; 10-lead multi-page PDF → 10 Ready with labelled budgets; image-only PDF → scanned message; malformed PDF → readable error; Hindi PDF → undecodable glyphs flagged Needs Review, English lead Ready; 9-block pasted text → 3 Ready, two-phone/no-phone/multi-column/HTML rows Needs Review, batch + CRM duplicates blocked; manual edits made rows Ready; exclusion respected; simulated storage-full → "Created 0 · Failed 2", Retry (double-click) created exactly 2; after refresh all IDs present, follow-ups/calls/deals/payments unchanged; repeat import blocked as duplicates; Cancel created nothing; CSV regression 2 created; 390px no overflow; only Google Fonts requests.

## AI-6A — Owner Project AI Assistant (Demo Mode)
- Pure module `src/lib/ai/projectAssist.ts`: `buildProjectContext` (project name, client, stage/status, scope, requirements, tasks, milestones, waiting-on-client, QA/handover, delivery; never phone/email/internal notes/payments/proofs/other projects), `structureRequirements`, `suggestTasks` (+ `matchTask` duplicate/similar detection), `nextAction`, `demoClientUpdate`, `updateViolations`. Request/response contracts `ClientUpdateRequest` / `ClientUpdateResult` / `ProjectAssistProvider`; `getProjectAssistProvider()` is the swap point for the future secure server endpoint.
- UI `src/components/ai/ProjectAssistPanel.tsx`, opened by the Owner-only **AI Assist** button on a project page; mounted with `key={projectId}` and closed on project change so drafts never leak.
- Suggested tasks hand off through in-memory `projectTaskDraft.ts` (keyed by project) to the existing Add task form; nothing is created until the Owner clicks Add. No assignee, due date, stage or milestone is set.
- Client updates: 6 purposes, 3 styles, English/Hindi/Hinglish. Delivered projects refuse development-progress drafts; delivery-ready drafts are refused while tasks or QA/handover items are open; delay drafts without a recorded reason use a `[reason]` placeholder and never blame the client. "Use Suggestion" is blocked when the edited text claims completion/delivery, all tasks done, received payment, discounts, relative deadlines, new numbers/links/amounts, or drops the client's name.
- Browser acceptance (synthetic, 6 projects): next actions correct for all six; structuring kept brief lines separate from recorded items; duplicate "Gallery page" blocked; "Payment gateway integration" opened prefilled in Add task with 0 tasks created until Add (then created unassigned, no due date); delivery-ready refused (3 open); false "complete … tomorrow" blocked; Keep/Try/Use/Undo work; switching project cleared the draft; Hindi/₹/URL preserved; WhatsApp composer opened with the draft, nothing sent; projects/other tasks/milestones/deals/payments unchanged; 390 px no overflow; no external requests besides fonts.

## AI-6B — Owner Support AI Assistant (Demo Mode)
- Pure module `src/lib/ai/supportAssist.ts`; panel `src/components/ai/SupportAssistPanel.tsx`, opened by an Owner-only "AI Assist" button on each Support Request row (Project → Delivery & support). One panel open at a time, mounted with `key={requestId}` so drafts never cross requests or projects.
- Context (`buildSupportContext`): this request, its project name/client, support terms, assignee name and only the project-history lines quoting this request's title. No payments, proofs, phone/email, credentials, other requests or projects.
- Summarize Request separates client-reported text from verified findings (only recorded resolution notes on a Resolved/Closed request count as verified). Complex/unrecognised issues show a Demo limitation notice.
- Troubleshooting: static checklists for 6 recognised examples (contact form, page not loading, content not updating, mobile layout, payment gateway, login); unknown issues return client questions only. Never claims inspection; never asks for passwords/OTPs/keys/card details.
- Next best support action from recorded status only; buttons focus the existing request actions or switch to "Request additional information" — nothing is started, reassigned, resolved or reopened automatically.
- Reply writer: 6 purposes, 3 styles, EN/HI/Hinglish; Resolution and post-resolution replies are blocked unless verified; Progress requires In Progress. `replyViolations` blocks Use Suggestion on false fixes, refunds, payment status, free/covered or billable claims not recorded, invented causes, credential requests, relative timeframes, new numbers/links/amounts, or a dropped client name.
- Swap point: `getSupportAssistProvider()` (typed `SupportReplyRequest`/`SupportReplyResult`).
- Browser evidence (synthetic): 8 requests across 2 projects; open/in-progress/missing-details/history/resolved/reopened/unsupported scenarios correct; WhatsApp sent-history count 0→0 after opening the composer with a draft and closing; projects, support requests, deals, payments and tasks byte-identical before/after; no new support history; 390px no overflow; no external requests.
