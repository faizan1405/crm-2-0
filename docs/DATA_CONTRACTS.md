# Demonstration data and action contracts

Authoritative TypeScript shapes: `src/lib/crm/types.ts`; preferences/action signatures: `src/lib/crm/store.ts`.

| Entity | Important fields / relationship |
| --- | --- |
| Lead | id, name, phone, optional email/company/requirement/budget/quotedAmount; source/status/priority; simulated aiScore; pinned; lastContact/nextFollowUp; Lost Reason; createdAt/updatedAt |
| LeadActivity | id, leadId, type, text, at |
| FollowUp | id, leadId, type, dueAt, optional note/completedAt |
| Deal | id, optional leadId, crm/other clientType, clientName/company/phone, name, quotedAmount/finalAmount, status, optional dueDate, milestones, notes, createdAt |
| Milestone | id, label, amount, dueDate |
| Payment | id, dealId, amount, date, method, type, optional reference/notes/voided |
| Note | id, title, body, pinned, optional tag, createdAt/updatedAt |
| Preferences | owner/email/business, theme/accent/density/time/date/sort and notification choices |

Timestamps use ISO instants; payment and deal due dates are `YYYY-MM-DD`. Amounts are numeric INR values, not formatted strings. Client type `other` must not require a CRM lead. A single client may have multiple deals, each with independent payments. No owner/workspace ID exists in the demo shapes yet.

## Current action boundary (backend swap point)
- `addLead` returns a local id. UI validates required name/phone/email and explicit duplicate creation consent.
- `updateLead` returns boolean; invalid edits return false without mutations. Related client display fields are synchronized.
- `deleteLead` removes the lead, its follow-ups and activities. Existing linked deals retain their snapshot and leadId; backend deletion/archive semantics need defining.
- `addActivity`, `addDeal`, `saveNote`, `deleteNote` mutate local arrays.
- `addPayment` returns boolean, rejects missing/cancelled/settled deal balance, non-positive/nonfinite/excess amounts and invalid date shape. `voidPayment` retains the row but removes it from collected calculations.
- `addFollowUp`, `rescheduleFollowUp`, `completeFollowUp` synchronize pending-date fields; invalid schedules are ignored. UI selects existing leads.
- `toggleBriefing`/`resetBriefing` track day-scoped checklist state.
- `preferences` merges local preferences; `reset` restores literal demo records without resetting preferences.

These synchronous signatures are **not an existing network API**. The backend adapter must define asynchronous result/error types, authenticated read/write contracts, pagination, concurrency, and transactional cross-entity updates. Validate enums, actual calendar dates, financial precision and all required fields server-side; the current demo does not provide full import corruption validation.

Export JSON contains leads/deals/payments/followUps/notes/activities, not preferences or briefing checks. No import UI exists. Existing stored data is not normalized retroactively by this audit; synchronized follow-up dates update on subsequent mutations.
## Sales Studio (Phase 2A.5)
Shapes in `src/lib/crm/studio.ts`: Quotation (id, number SF-Q-YYYY-NNN, leadId, client snapshot, title, issueDate/validUntil YYYY-MM-DD, items qty/unitPrice, flat|percent discount, optional GST rate, terms, notes, status, revision + history, sharedAt), WaTemplate (purpose, body with `{placeholders}`, isDefault, enabled, builtIn), Demo (title, url http(s) only, category, tags, thumbnail, active, order, includeByDefault), BusinessProfile.
Actions: `saveQuotation` (validates, numbers, revisions; never touches deals/payments), `duplicateQuotation`, `deleteQuotation`, `setQuoteStatus` (Shared only after explicit user confirmation), template and demo CRUD, `saveBusinessProfile`. Hostinger APIs should return the same shapes; totals must be recalculated server-side. Data is browser-local; other tabs in the same browser sync via the storage event — no cross-device sync yet.
## Payment proofs (Phase 2C)
ProofMeta (attachmentId, paymentId, originalFileName, mimeType jpeg|png|webp|pdf, fileSize ≤10 MB, createdAt, updatedAt) + file bytes, stored in IndexedDB `scale-flow-payment-proofs`, one per payment. `addPayment(payment, id?)` accepts a pre-assigned id so staged proof is saved after the payment exists. Not included in JSON export. Production: authenticated upload/download endpoints, private storage, server-side signature/size checks, finance-permission checks.
