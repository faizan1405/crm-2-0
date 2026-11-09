# Checkpoint B3C — Server-Backed Deals, Payments & Payment-Proof UI

> **Branch:** `feat/b3c-finance-ui-pilot` (branched from `ab340f5` on `feat/b3b-qa-proof-integration`)  
> **Scope:** Full frontend integration for Deals, Payments, Payment Proofs, and Financial Audit History inside the isolated development Pilot (`/deals?pilot=1`), backed 100% by MariaDB server APIs.  
> **Non-Scope Enforced:** Production CRM (`/deals` without pilot query, `scale-flow-crm-2-demo` Zustand store, `scale-flow-payment-proofs` IndexedDB) remains completely untouched and isolated. Dual-writing is prohibited.

---

## 1. Canonical Endpoints & Backend Preflight Alignment

All frontend API client methods (`src/lib/api/financeApi.ts`) and Pilot components communicate exclusively with canonical server routes:

| Resource / Action | Canonical Route | Method | Description |
| --- | --- | --- | --- |
| **List Deals** | `/api/v1/deals` | `GET` | Paginated, filterable deal ledger list with financial summaries |
| **Create Deal** | `/api/v1/deals` | `POST` | Create deal linked to lead (`clientType: "crm"`) or standalone (`"other"`) |
| **Get Deal Detail** | `/api/v1/deals/:id` | `GET` | Single deal record with milestones and financial summary |
| **Update Deal** | `/api/v1/deals/:id` | `PATCH` | Edit deal name, amounts, due date with optimistic locking (`version`) |
| **Cancel Deal** | `/api/v1/deals/:id/cancel` | `POST` | Cancel deal with mandatory audit reason (`version` required) |
| **Deal Summary** | `/api/v1/deals/:id/summary` | `GET` | Real-time financial calculations (collected, outstanding, overdue, status) |
| **Deal Audit History**| `/api/v1/deals/:id/audit-history`| `GET` | Immutable chronological financial events for a deal |
| **Record Payment** | `/api/v1/payments` | `POST` | Record payment transactionally with balance validation & idempotency |
| **List Payments** | `/api/v1/payments` | `GET` | Filterable payment ledger |
| **Void Payment** | `/api/v1/payments/:id/void` | `POST` | Void payment with mandatory reason and ledger disclaimer |
| **Attach Proof** | `/api/v1/payments/:id/proof` | `POST` | Multipart or binary upload of valid proof (JPG, PNG, WebP, PDF) |
| **Get Proof Meta** | `/api/v1/payments/:id/proof` | `GET` | Active proof metadata (filename, SHA-256, mimeType, driver) |
| **Replace Proof** | `/api/v1/payments/:id/proof/replace`| `POST` | Atomic replacement preserving old binary in storage |
| **Remove Proof** | `/api/v1/payments/:id/proof` | `DELETE`| Audit-retained proof removal |
| **Download Proof** | `/api/v1/payments/:id/proof/download`| `GET` | Streaming download with CSP sandbox and security headers |
| **Proof History** | `/api/v1/payments/:id/proof/history`| `GET` | List all historical versions of proofs for a payment |
| **Owner Summary** | `/api/v1/finance/summary` | `GET` | Owner-wide financial totals, exclusions, and period metrics |

---

## 2. Storage Driver Reality & Durability Status

- **`local-fs` Driver:** Verified operational and tested with real disk uploads/downloads in `.data/private-proofs` (or custom `PROOF_STORAGE_DIR`).
- **`object-storage` Driver:** Explicitly reported as **NOT IMPLEMENTED** (forward-compatibility stub for S3/R2 private buckets).
- **Hostinger Private Storage Durability:** Evaluated as **UNVERIFIED (Staging Acceptance Gate Required)**. Because Hostinger managed Git deployments recreate build containers and switch symlinks, persistent proof storage outside deployment roots must be verified on a live staging environment prior to production cutover.
- **Orphan Cleanup Race Hardening:** Added a 15-minute grace period (`minAgeMs`) to `reconcileStorage` and `reconcileOrphanProofFiles` based on file `mtimeMs`, preventing in-flight uploads or uncommitted transactions from accidental pruning during cleanup jobs.

---

## 3. Financial Logic Parity & Safety Guarantees

1. **Integer Paise Precision:** Both frontend (`financeApi.ts`) and backend (`financeCalc.server.ts`, `money.server.ts`) compute balances in integer paise to eliminate floating-point drift.
2. **Transactional Concurrency:** Database `SELECT ... FOR UPDATE` locks on `crm_deals` and sibling `crm_payments` prevent double-collection races.
3. **Overpayment Rejection:** Payments exceeding remaining balance fail deterministically with `409 overpayment`.
4. **Ledger Void vs Bank Refund:** The UI explicitly warns owners that voiding a payment is an internal accounting adjustment and does not initiate a bank refund.
5. **Deal Cancellation Cash Preservation:** Cancelling a deal zeroes active revenue and outstanding balances while preserving historical collected cash in historical gross totals.
6. **Immutable Audit Trail:** All financial actions write to `crm_finance_events` and paired Lead activity entries.

---

## 4. Test & Verification Summary

- **TypeScript Typecheck:** `npm run typecheck` passed (0 errors).
- **Drizzle Schema Check:** `npm run db:check` passed (`Everything's fine 🐶🔥`).
- **Automated Unit & Integration Tests:** `npm test` passed (**93 test files, 845 tests passed**).
  - 5 tests in `src/lib/api/financeApi.b3c.test.ts`
  - 5 tests in `src/test/finance-pilot.b3c.test.tsx`
  - All existing core CRM, auth, lead, call, and WhatsApp tests passing.
- **Production Build:** `npm run build` succeeded; 0 `jsxDEV` occurrences in `.output/server/`.
- **Live MariaDB + Built Server Verification:** Standalone harness `verify-b3c.mjs` passed **36 of 36 scenarios (100%)** against real MariaDB 11.4 and built Nitro production server.
- **Browser Data Safety:** Verified byte-for-byte preservation of existing `scale-flow-crm-2-demo` browser-local storage and IndexedDB proofs.
