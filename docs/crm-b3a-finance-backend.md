# Checkpoint B3A — Secure Deals, Payments & Financial Ledger Backend

> **Branch:** `feat/b3a-finance-backend` (branched from `ab81a1d` on `feat/b2b4-whatsapp-logging`)  
> **Scope:** Server-side database schema, forward migration (`0005_b3a_finance_ledger.sql`), exact-paise financial engine, transactional Deal/Payment/Void/Summary `/api/v1/*` APIs, and immutable financial audit ledger.  
> **Non-Scope Enforced:** `src/routes/deals.tsx`, `src/lib/crm/store.ts` (`scale-flow-crm-2-demo`), and IndexedDB payment proofs (`scale-flow-payment-proofs`) remain 100% untouched. Payment-proof binary storage is deferred to **B3B**, and Deals UI integration is deferred to **B3C**.

---

## 1. Existing Frontend Finance Compatibility Matrix

Audited against `src/lib/crm/types.ts`, `src/lib/crm/finance.ts`, `src/lib/crm/validation.ts`, `src/lib/crm/store.ts`, `src/lib/crm/proofRepo.ts`, `src/components/crm/PaymentProof.tsx`, and `src/routes/deals.tsx`:

| Concept / Rule | Existing Frontend (`finance.ts` / `store.ts`) | B3A Backend (`financeCalc.server.ts` / `dealsService.server.ts` / `paymentsService.server.ts`) | Compatibility & Precision Notes |
| --- | --- | --- | --- |
| **Won Lead vs Booked Deal** | Marking a Lead `status = "won"` never auto-creates a `Deal` (`store.ts:732-743`). | Identical: `PATCH /api/v1/leads/:id` to `"won"` never auto-creates a `crm_deals` row; Deals are explicitly booked via `POST /api/v1/deals`. | Preserves strict distinction between pipeline stage, booked deal value, and collected cash. |
| **Client Type & Linked Lead** | `clientType: "crm"` requires `leadId` and derives `clientName`/`company` from the Lead; `"other"` requires explicit `clientName`. Editing a Lead's `name`/`company` updates linked `Deal`s (`store.ts:738`). | Identical: `crm_deals.lead_id` references `crm_leads.id` (`ON DELETE RESTRICT`); `updateLeadRecord` atomically syncs `crm_deals.client_name` and `company` inside the same InnoDB transaction. | Archived leads (`waste`/`deleted`) cannot be linked to new CRM deals (`409 lead_archived`). |
| **Quoted vs Agreed Deal Value** | `quotedAmount >= 0` (reference quote; defaults to `finalAmount` when omitted/0) vs `finalAmount > 0` (agreed contract value). | Stored in `DECIMAL(15,2)` (`quoted_amount`, `final_amount`); `quotedAmount` defaults to `finalAmount` when `0` or omitted; `finalAmount` must be strictly `> 0.00`. | `finalAmount` cannot be edited below already-collected non-voided payments (`409 deal_amount_below_collected`). |
| **Booked Value vs Collected vs Realized Revenue** | Active + completed deals count toward `totalValue`; only non-voided payments on non-cancelled deals count toward `collected`. | Per-deal & Owner summaries explicitly report `quotedAmount`, `finalAmount` (booked value), `collected` / `realizedRevenue` (non-voided cash on non-cancelled deals), `outstanding`, `overdue`, and `exclusions` (`voidedAmount`, `cancelledDealValue`, `cancelledDealPaymentsExcluded`). | Cancelled deals report `outstanding = 0.00` and `realizedRevenue = 0.00` while retaining historical payment rows in `collectedGross` / `cancelledDealPaymentsExcluded`. |
| **Remaining Balance & Overpayment Prevention** | `remaining = max(0, finalAmount - collected)`; `validatePayment` blocks `amount > remaining + 1e-6`. | Computed in exact integer paise (`remainingPaise = finalPaise - collectedPaise`) after `SELECT ... FOR UPDATE` on BOTH `crm_deals` and sibling `crm_payments`. `amountPaise > remainingPaise` fails with `409 overpayment`. | Eliminates floating-point `1e-6` epsilon drift and prevents concurrent double-collection races. |
| **Payment Status Derivation** | `cancelled` if `deal.status === "cancelled"`; `paid` if `remaining <= 0`; `overdue` if past due; `partial` if `collected > 0`; else `unpaid`. | Identical precedence in exact paise (`cancelled` -> `paid` (`remainingPaise === 0`) -> `overdue` -> `partial` (`collectedPaise > 0`) -> `unpaid`). | Derived strictly server-side; clients cannot write `paymentStatus`, `collected`, or `outstanding`. |
| **Due Date & Overdue Boundary** | `finance.ts:17` used `new Date(deal.dueDate).getTime() < now.getTime()`, which parsed `YYYY-MM-DD` as `00:00Z` (`05:30 AM IST`), marking deals overdue prematurely on their own due date! | **Deliberate IST Precision Hardening:** `isDealOverdueInIst` compares `dueDate < todayIstDate` (`Asia/Kolkata`). A deal due on `YYYY-MM-DD` stays current all day on `YYYY-MM-DD` IST and becomes overdue at `00:00+05:30` the next day. `dueDate === null` is never overdue. | Matches `dates.ts` business-timezone philosophy (`Asia/Kolkata`) without device-clock drift. |
| **Legacy Unverified `wonAt` (`won_at = NULL`)** | Deals with `wonAt === undefined` are excluded from period `wonValue` and tracked in `unknownWonValue`, with a one-time `verifyDealWonDate` action (`store.ts:793`). | `crm_deals.won_at` (`DATETIME(3)`) + `won_ist_date` (`CHAR(10)`) are nullable for B4 legacy imports; new deals stamp server `won_at` automatically; `POST /api/v1/deals/:id/verify-won-date` sets `won_at`/`won_ist_date` once (`409 deal_won_date_already_set` if already set). | Full parity for B4 browser-to-MariaDB migration. |
| **Payment Proof Optionality** | `PaymentProof.tsx` & `proofRepo.ts`: proofs are optional evidence and never alter financial balances. | Payments record cleanly without any proof upload in B3A (`hasProof: false` placeholder in DTO for B3B). | Clean seam for B3B private proof storage keyed by `crm_payments.id` + `owner_user_id`. |
| **Voiding Payments** | `voidPayment(id, reason?)` sets `voided = true`, keeps original `amount` & row in history, excludes from `collected`, appends Lead `"payment"` activity. | `POST /api/v1/payments/:id/void` **requires** a non-empty `reason` (`1..500` chars), locks Deal + Payment `FOR UPDATE`, rejects double-void (`409 payment_already_voided`), preserves original `amount`, stamps `voided_at` + `voided_by_user_id`, writes `crm_finance_events` + Lead `"payment"` activity. | Stronger server auditability (`reason` is mandatory; `actor_user_id` is session-derived). |

---

## 2. Database Schema, Exact Money & Foreign-Key Deletion Safety

### Tables Added in [`0005_b3a_finance_ledger.sql`](../src/server/db/migrations/0005_b3a_finance_ledger.sql)

1. **`crm_deals`** — Owner-scoped Deals (`id`, `owner_user_id`, `legacy_id`, `lead_id`, `client_type`, `client_name`, `company`, `name`, `quoted_amount DECIMAL(15,2)`, `final_amount DECIMAL(15,2)`, `currency CHAR(3)`, `status`, `won_at`, `won_ist_date`, `due_date`, `cancelled_at`, `cancel_reason`, `notes`, `created_by_user_id`, `updated_by_user_id`, `op_id`, `version`, `created_at`, `updated_at`).
2. **`crm_deal_milestones`** — Ordered payment schedule items per Deal (`id`, `owner_user_id`, `deal_id`, `legacy_id`, `sort_order`, `label`, `amount DECIMAL(15,2)`, `due_date`, `paid`, `paid_at`, `created_at`, `updated_at`).
3. **`crm_payments`** — Financial ledger entries (`id`, `owner_user_id`, `deal_id`, `lead_id`, `legacy_id`, `amount DECIMAL(15,2)`, `currency`, `paid_on_ist_date CHAR(10)`, `method`, `payment_type`, `reference`, `notes`, `status ('posted'|'voided')`, `voided`, `void_reason`, `voided_at`, `voided_by_user_id`, `recorded_by_user_id`, `lead_activity_id`, `op_id`, `idempotency_key`, `version`, `created_at`, `updated_at`).
4. **`crm_finance_events`** — Append-only immutable financial audit log (`id`, `owner_user_id`, `deal_id`, `payment_id`, `lead_id`, `actor_user_id`, `event_type`, `amount DECIMAL(15,2)`, `reason`, `note`, `metadata_json`, `lead_activity_id`, `occurred_at`, `created_at`).

### Foreign-Key Cascade Audit (`ON DELETE RESTRICT` Everywhere)

Migration `0005_b3a_finance_ledger.sql` enforces **`ON DELETE RESTRICT`** on every foreign key across:
- `crm_deals` (`owner_user_id`, `lead_id`, `created_by_user_id`, `updated_by_user_id`)
- `crm_deal_milestones` (`owner_user_id`, `deal_id`)
- `crm_payments` (`owner_user_id`, `deal_id`, `lead_id`, `voided_by_user_id`, `recorded_by_user_id`, `lead_activity_id`)
- `crm_finance_events` (`owner_user_id`, `deal_id`, `payment_id`, `lead_id`, `actor_user_id`, `lead_activity_id`)
- Existing `crm_leads`, `crm_lead_activities`, `crm_follow_ups`, `crm_call_logs`, `crm_whatsapp_logs`, `crm_tag_defs`, `crm_lead_tags`, `crm_custom_fields`, `crm_lead_field_values`, and `crm_idempotency_keys` (hardened from `ON DELETE CASCADE` to `ON DELETE RESTRICT`).

Leads continue to use soft lifecycle archival (`active` / `waste` / `deleted`), Deals use explicit `status = 'cancelled'`, and Payments use explicit `status = 'voided'`. Physical SQL `DELETE` against any referenced Lead or Deal is rejected by MariaDB/MySQL InnoDB (`ER_ROW_IS_REFERENCED_2`, errno `1451`).

### Exact-Money Representation (`src/server/db/money.server.ts`)

- MySQL/MariaDB stores all monetary columns as `DECIMAL(15, 2)` and returns strings (`decimalNumbers: false`).
- Inputs accept numbers or canonical decimal strings with at most 2 decimal places (`parseStrictInrInputToPaise`), bounded to `MAX_DECIMAL_15_2_PAISE = 999_999_999_999_999` (`₹9,999,999,999,999.99`). Scientific notation, `NaN`, `Infinity`, negative values, and `> 2` decimal places fail validation with `400 validation_error`.
- Every per-deal and Owner-wide sum/subtraction executes in exact integer paise (`sumPaise`, `subtractPaise`) and serializes back via `paiseToDecimalString` (`"50000.00"`), `paiseToRupees` (`50000`), and `paise` integers.

---

## 3. Authenticated `/api/v1` Financial Endpoints

All endpoints enforce active Owner cookie authentication (`401`/`403`/`503`), `owner_user_id` isolation (`404` on foreign/missing IDs), same-origin CSRF + `application/json` checks on mutations (`403`), `Idempotency-Key` replay/conflict safety (`409 idempotency_key_mismatch`), and `Cache-Control: no-store`.

| Method & Path | Purpose | Key Guards & Response |
| --- | --- | --- |
| `GET /api/v1/deals` | Paginated Deal list + filterable by `q`, `status`, `paymentStatus`, `clientType`, `leadId`, `dueBefore`, `dueAfter`, `wonFrom`, `wonTo`, `sort`. | Returns `{ ok: true, items, page, limit, total }`, each Deal hydrated with `milestones` and `financialSummary`. |
| `POST /api/v1/deals` | Books a new Deal (+ optional ordered `milestones`) transactionally. | Validates linked `leadId` ownership & active lifecycle; blocks accidental active duplicate deal name (`409 duplicate_deal` unless `allowDuplicate: true`); writes `deal.created` audit event + paired Lead `"payment"` activity (`201`). |
| `GET /api/v1/deals/:id` | Single Deal detail with `milestones` and `financialSummary`. | `404 deal_not_found` if missing or cross-owner. |
| `PATCH /api/v1/deals/:id` | Updates Deal fields and/or replaces `milestones` (`version` required). | Blocks edits on cancelled deals (`409 deal_cancelled`), stale versions (`409 stale_conflict`), and `finalAmount < collected` (`409 deal_amount_below_collected`). |
| `POST /api/v1/deals/:id/status` | Transitions non-cancelled Deal status (`active` <-> `completed`; or delegates `cancelled` with reason). | Requires `version`; writes `deal.status_changed` audit event + paired Lead activity. |
| `POST /api/v1/deals/:id/cancel` | Cancels a Deal while preserving all historical payment rows. | Requires `version` (`reason` optional); rejects double-cancel (`409 deal_already_cancelled`); zeroes `outstanding` & `realizedRevenue`. |
| `POST /api/v1/deals/:id/verify-won-date` | One-time verification of `wonDate` (`YYYY-MM-DD`) when `won_at` is `NULL`. | Rejects overwrite with `409 deal_won_date_already_set`. |
| `GET /api/v1/deals/:id/summary` | Exact financial breakdown for one Deal. | Returns `quotedAmount`, `finalAmount`, `collected`, `realizedRevenue`, `voided`, `outstanding`, `overdue`, `paymentStatus`, `isOverdue`, `nextMilestone` (in decimal, rupees, and paise). |
| `GET /api/v1/deals/:id/audit-history` | Chronological `crm_finance_events` for a Deal. | Paginated (`page`, `limit`). |
| `GET /api/v1/leads/:id/deals` | All Deals linked to a specific Lead. | Verifies Lead ownership first (`404 lead_not_found`). |
| `GET /api/v1/deals/:id/payments` | Chronological payments for one Deal (`includeVoided` default `true`). | Returns `{ items, dealSummary }`. |
| `POST /api/v1/deals/:id/payments` & `POST /api/v1/payments` | Records a partial or full Payment inside an InnoDB transaction. | Locks `crm_deals` AND sibling `crm_payments` with `SELECT ... FOR UPDATE`; rejects cancelled deals (`409 deal_cancelled`), stale `expectedDealVersion` (`409 stale_conflict`), and `amountPaise > remainingPaise` (`409 overpayment`); writes `payment.recorded` event + paired Lead `"payment"` activity (`201`). |
| `GET /api/v1/payments` & `GET /api/v1/payments/:id` | Owner-wide payment ledger list (`dealId`, `leadId`, `method`, `type`, `status`, `includeVoided`, `dateFrom`, `dateTo`) and single Payment detail. | `404 payment_not_found` on foreign/missing ID. |
| `POST /api/v1/payments/:id/void` | Voids a posted Payment without deleting its row or mutating its original `amount`. | Requires explicit non-empty `reason` (`400` if blank); locks Deal + Payment `FOR UPDATE`; rejects second void (`409 payment_already_voided`); recalculates `dealSummary` immediately. |
| `GET /api/v1/finance/summary` | Owner-wide financial totals & exclusions (`from`/`to` IST `wonIstDate` filter). | Returns `totals` (`quotedValue`, `totalValue`, `collected`, `realizedRevenue`, `outstanding`, `overdue`), `period` (`wonCount`, `wonValue`, `unknownWonCount`, `unknownWonValue`), `exclusions`, and `counts`. |

---

## 4. Hostinger Read-Only Inspection & B3B / B3C Handover Plan

### Read-Only Hostinger Environment Findings (`khaki-butterfly-345144.hostingersite.com`)
- **Runtime:** Managed Hostinger Node.js 22.x web app (`app_type: "nitro"`, `output_directory: ".output"`, `entry_file: "server/index.mjs"`, `root_directory: "/home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/public_html"`), auto-deploying from GitHub `main` (`8f022ed` untouched).
- **Database:** Hostinger MySQL (`srv469.hstgr.io:3306`, 3 GB database quota available; `0` databases currently bound to `khaki-butterfly-345144.hostingersite.com`). Supports InnoDB transactions, `SELECT ... FOR UPDATE` row locks, `DECIMAL(15,2)`, and `ON DELETE RESTRICT`. No VPS is required for B3A.
- **B3B Private Payment-Proof Storage Design Implication:** Because Git deployments rebuild `.output` / `public_html`, B3B MUST NEVER store proof binaries inside `public_html` or `.output`. In B3B, either verify whether a sibling directory outside `public_html` (e.g. `/home/u256504187/domains/<domain>/private-proofs`) persists across a staging Node redeploy, or select `PROOF_STORAGE_DRIVER=object-storage` (S3-compatible private bucket with server-streamed reads) if managed Node rebuilds reset container paths.

### Next Checkpoints
- **B3B (Next — Private Payment-Proof Attachments):** Add `crm_payment_proofs` metadata table keyed to `crm_payments.id` (`ON DELETE RESTRICT`) + `owner_user_id`, strict MIME/magic-byte/size validation (`PNG`/`JPEG`/`WEBP`/`PDF`, `<= 10 MB`), private storage adapter (`PROOF_STORAGE_DRIVER`), and authenticated download/replace/remove endpoints with `Cache-Control: private, no-store` and `Content-Disposition` sanitization.
- **B3C (Deals & Payments Frontend Pilot / Integration):** Connect `src/routes/deals.tsx` and `ProofRepo` behind a controlled adapter once B3A + B3B are approved.

---

## 5. Live MariaDB 11.4.13 Security & Concurrency Verification (25/25 Passed)

Verified against a disposable local MariaDB 11.4.13 InnoDB instance (`utf8mb4_unicode_ci`, `timezone=Z`), production Node build (`.output/server/index.mjs`), two concurrent Owner A sessions, one separate Owner B session, and Headless Chrome storage inspection:

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Create synthetic Lead (`status="won"` does not auto-create Deal) + Deal + Lead->Deal name sync | **PASS** |
| 2 | Full Node server restart persistence check (`GET /api/v1/deals/:id` via Session 2) | **PASS** |
| 3 | Record partial Payment #1 (`₹15,000.00` UPI) | **PASS** |
| 4 | Record partial Payment #2 (`₹10,000.00` Bank Transfer via Session 2) | **PASS** |
| 5 | Verify exact collected (`₹25,000.00`), outstanding (`₹25,000.00`), `paymentStatus="partial"`, `nextMilestone` | **PASS** |
| 6 | Reject single-request overpayment (`₹25,000.01` against `₹25,000.00` -> `409 overpayment`) | **PASS** |
| 7 | Submit two simultaneous `₹20,000.00` payments across Session 1 & Session 2 against `₹25,000.00` remaining | **PASS** |
| 8 | Confirm `SELECT ... FOR UPDATE` row locking serializes race -> `[201, 409 overpayment]`, SQL sum `₹45,000.00 <= ₹50,000.00` | **PASS** |
| 9 | Repeat identical `Idempotency-Key` -> `201` with `X-Idempotency-Replayed: true` and zero duplicate SQL rows | **PASS** |
| 10 | Reuse `Idempotency-Key` with altered payload -> `409 idempotency_key_mismatch` | **PASS** |
| 11 | Void a Payment (`blank reason` -> `400`; valid reason -> `status="voided"`, row & original `₹20,000.00` preserved in SQL) | **PASS** |
| 12 | Totals recalculate immediately (`collected=₹30,000.00`, `outstanding=₹20,000.00`, `voided=₹20,000.00`); `finalAmount < collected` blocked (`409`) | **PASS** |
| 13 | Second void attempt rejected (`409 payment_already_voided`) while original idempotency key replays cleanly | **PASS** |
| 14 | Deal cancellation preserves `₹12,000.00` payment history, zeroes `outstanding`/`realizedRevenue`, excludes from summary, blocks new payments & double-cancel (`409`) | **PASS** |
| 15 | Negative, zero, `>2` decimals, scientific notation, invalid enums, malformed JSON, and spoofed balance keys rejected (`400`) | **PASS** |
| 16 | Exact rupee/paise arithmetic (`₹10,000.10 + ₹20,000.20 + ₹0.70 = ₹30,001.00`, `0` drift) | **PASS** |
| 17 | IST overdue boundaries (`dueDate=today` not overdue; `dueDate=yesterday` overdue; `dueDate=null` never overdue; legacy `wonAt=NULL` + one-time `verify-won-date`) | **PASS** |
| 18 | Stale `version` on Deal `PATCH` and stale `expectedDealVersion` on Payment `POST` -> `409 stale_conflict` | **PASS** |
| 19 | Unauthenticated requests across all 10 Deal/Payment/Void/Audit/Summary routes -> `401` | **PASS** |
| 20 | Cross-owner access (Owner B -> Owner A Deal/Payment/Void IDs) -> `404` & `0` rows in `/api/v1/finance/summary` | **PASS** |
| 21 | Cross-origin `Origin` and `text/plain` CSRF mutation attempts -> `403` | **PASS** |
| 22 | Forced mid-transaction crashes after Deal `INSERT`, Payment `INSERT`, and Void `UPDATE` -> 100% InnoDB rollback (0 orphan rows/keys) | **PASS** |
| 23 | Complete `crm_finance_events` + paired Lead `"payment"` timeline verified; physical SQL `DELETE` on `crm_leads` & `crm_deals` blocked by `ON DELETE RESTRICT` (`errno 1451`) | **PASS** |
| 24 | Headless Chrome `/deals` SHA-256 of `scale-flow-crm-2-demo` (`deals`+`payments`) and IndexedDB `scale-flow-payment-proofs` (`meta`+`files`) identical before & after; `0` browser finance API calls | **PASS** |
| 25 | Zero external payment-gateway/OpenRouter calls + Auth/Follow-up/Call/WhatsApp/Production-Pilot (`leadPilotAvailable=false`) regressions | **PASS** |
