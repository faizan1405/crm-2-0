# Scale Flow Sales OS 3.0 — Checkpoint B9B: Server-Backed Smart Inbox, Duplicate Review & Lead Relationships UI Pilot

**Document:** `docs/crm-b9b-smart-inbox-ui.md`  
**Checkpoint:** B9B (Server-Backed Smart Inbox, Duplicate Review & Lead Relationships UI)  
**Repository:** `https://github.com/faizan1405/crm-2-0.git`  
**Branch:** `feat/b9b-smart-inbox-ui-pilot`  
**Base Commit:** `6ccbf03` (B9A Smart Inbox Backend)  
**Date:** 11 November 2026  

---

## 1. Executive Summary

Checkpoint B9B connects the existing Smart Lead Inbox and Duplicate Review frontend to the isolated MariaDB 11.4 backend inside the development Pilot mode (`/inbox?pilot=1` and `/leads/:id?pilot=1`).

This implementation strictly adheres to the core architecture principles of Scale Flow Sales OS 3.0:
1. **Zero Automatic Merging / Zero Automatic Deletion:** The system never deletes or collapses leads automatically. All matches are presented for explicit Owner review.
2. **Explicit Matching vs Decision Semantics:** Algorithmic phone/email matches are surfaced as "Strong Match — Phone/Email". Name and company matches are surfaced as "Possible Match — Name + Company". Relationships are only marked as "Owner Decision" once an authenticated Owner explicitly reviews and decides.
3. **Merge Blockers Disclosure:** Leads possessing active deals, recorded payments, quotation shares, or project records clearly display unmergeable blockers, safeguarding the financial and project ledgers from corruption.
4. **Optimistic Concurrency & Auditability:** All review decisions enforce version concurrency checking (`409 stale_conflict`) and append immutable audit history events (`crm_lead_relationship_history`).
5. **Absolute Boundary Preservation:** Browser-local demo storage (`scale-flow-crm-2-demo`), IndexedDB payment proofs (`scale-flow-payment-proofs`), non-pilot routes (`/inbox`), production configurations, and git remotes remain completely untouched.

---

## 2. Architecture & File Structure

### 2.1 Backend Contract & API Client
- **`src/lib/api/inboxApi.ts`**: Complete typed client with Zod runtime validation schemas for all B9A endpoints:
  - `GET /api/v1/inbox`: Filtered lead inbox queue with pagination, counts, and category tabs (`all`, `today`, `needs_review`, `unreviewed_only`, `duplicates`, `contact_pending`).
  - `GET /api/v1/inbox/candidates`: Duplicate candidate pairs with status, strength, and match reasons.
  - `GET /api/v1/inbox/candidates/:id`: Detailed pair comparison with lead details, activities, and merge blockers.
  - `POST /api/v1/inbox/scan`: Trigger algorithmic background duplicate scan.
  - `POST /api/v1/inbox/candidates/:id/decision`: Submit Owner decision (`related`, `separate`, `dismiss`) with optimistic version check.
  - `POST /api/v1/inbox/review`: Single or bulk review status mutation (`needs_review`, `reviewed`).
  - `POST /api/v1/inbox/flag`: Manual duplicate flagging or unflagging with custom note.
  - `GET /api/v1/leads/:id/relationships`: Active relationships (`related`, `separate`) for a specific lead.
  - `DELETE /api/v1/leads/:id/relationships/:pairKey`: Explicit relationship unlinking with audit record.
  - `GET /api/v1/inbox/review-history`: Append-only audit history of all inbox actions and decisions.

### 2.2 Pilot UI Components
- **`src/components/pilot/PilotInboxPage.tsx`**: Main Smart Inbox dashboard in PilotShell:
  - KPI overview cards: Total Intake, Needs Review, Duplicates Detected, Contact Pending.
  - Category tabs and filter bar (search, source, priority, stage, review status, contact status, duplicate flag).
  - Bulk lead selection toolbar with "Mark Reviewed", "Mark Needs Review", and "Trigger Scan" actions.
  - Dual view toggle: "Inbox Queue" (lead rows with contact pills, call/WhatsApp launchers) and "Duplicate Desk" (candidate review cards).
- **`src/components/pilot/PilotDuplicateReviewDialog.tsx`**: High-fidelity side-by-side comparison modal:
  - Responsive: Side-by-side grid on desktop (≥1024px), stacked cards on mobile.
  - Match evidence banner with exact reason badges (Phone, Normalized Phone, Email, Name + Company).
  - Prominent "Zero Merge Guarantee" notice reminding the seller that neither record will be deleted.
  - Merge blockers disclosure (deals, payments, projects).
  - Decision buttons: "Mark as Related", "Keep Separate", "Dismiss Suggestion".
  - Conflict resolution dialog on HTTP 409 stale conflict with "Reload Latest" action.
- **`src/components/pilot/PilotInboxScanModal.tsx`**: Algorithmic scan modal with summary counts of evaluated leads, detected pairs, and newly opened candidates.
- **`src/components/pilot/PilotInboxHistoryDrawer.tsx`**: Slide-out timeline displaying immutable audit history with IST timestamps and actor tags.
- **`src/components/pilot/PilotLeadRelationshipsCard.tsx`**: Component embedded in `PilotLeadDetailPage.tsx` showing active relationships with safe unlinking dialog.

---

## 3. Database Schema Overview (B9A Baseline)

The 4 dedicated Smart Inbox tables verified in MariaDB 11.4:
1. **`crm_lead_inbox_items`**: Tracks review state per lead (`needs_review`, `reviewed`), reviewed timestamp, and manual duplicate flag.
2. **`crm_duplicate_candidates`**: Stores detected candidate pairs (`pair_key`, `lead_a_id`, `lead_b_id`, `reasons_json`, `strength`, `status`, `pair_signature`, `version`).
3. **`crm_lead_relationships`**: Stores confirmed relationships (`related`, `separate`, `note`, `version`).
4. **`crm_lead_relationship_history`**: Append-only audit trail logging all actions (`decide_related`, `decide_separate`, `dismiss`, `unlink`, `review`, `unreview`, `flag`, `unflag`).

---

## 4. Quality Gates & Verification Matrix

- **Unit & Integration Tests:** 128 test files passed, 1,273 tests passing (0 failures).
- **Drizzle Database Check:** Migration check cleanly passed (42 tables verified).
- **TypeScript Typecheck:** 0 type errors with strict `exactOptionalPropertyTypes`.
- **Vite/Nitro Build:** Compiled successfully in production mode.
- **Real Chrome CDP E2E Verification:** Automated real-browser scenarios covering all 46 acceptance checkpoints.
