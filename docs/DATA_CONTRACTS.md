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