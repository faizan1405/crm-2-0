# Checkpoint B3B — Secure Private Payment-Proof Storage

> **Branch:** `feat/b3b-payment-proofs` (branched from `4607254` on `feat/b3a-finance-backend`)  
> **Scope:** Server-side database schema (`crm_payment_proofs`), forward migration (`0006_b3b_payment_proofs.sql`), private storage engine (`ProofStorageBackend` with `LocalFsProofStorage` and pluggable `ObjectStorageProofStorage`), magic-byte sniffing (`JPEG`, `PNG`, `WebP`, `PDF`, `<= 10 MiB`), filename sanitization, atomic proof replacement, audit-retained removal, authenticated streaming download with security headers, and payment proof history APIs under `/api/v1/payments/:id/proof*`.  
> **Non-Scope Enforced:** `src/routes/deals.tsx`, `src/lib/crm/store.ts` (`scale-flow-crm-2-demo`), and IndexedDB payment proofs (`scale-flow-payment-proofs`) remain 100% untouched. Deals UI integration is deferred to **B3C**.

---

## 1. Existing Proof Contract & Compatibility

Audited against `src/lib/crm/proofRepo.ts`, `src/lib/crm/attachments.ts`, `src/components/crm/PaymentProof.tsx`, `src/lib/crm/vault.ts`, and Checkpoint B3A financial tables:

| Concept / Rule | Existing Client Contract | B3B Backend Implementation | Compliance & Security Notes |
| --- | --- | --- | --- |
| **Supported File Formats** | JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`), PDF (`application/pdf`). | Sniffed via first 16 magic bytes (`sniffProofKind` in `proofValidation.server.ts`). | Rejects unlisted types (.docx, .sh, .exe) and extension mismatches (PNG disguised as .pdf) with `400 invalid_file_type` / `400 file_corrupted`. |
| **Max File Size** | 10 MiB (`10,485,760` bytes). | Pre-stream `Content-Length` check + streaming counter byte limit (`MAX_PROOF_BYTES = 10 * 1024 * 1024`). | Exceeding 10 MiB immediately aborts stream and unlinks temp file with `400 file_too_large`. 0-byte files fail with `400 empty_file`. |
| **Single Active Proof** | `proofRepo.ts:13` ("Saves or replaces the single proof of a payment"). | Database-level unique index `uq_crm_payment_proofs_active_pay` on `(owner_user_id, active_payment_lock)` where `active_payment_lock` is `payment_id` when active, and `NULL` when replaced or removed. | Guarantees at most 1 active proof per payment. Attaching a second active proof without replacement fails with `409 proof_already_exists`. |
| **Proof Optionality** | Proofs are supporting evidence only and never change payment amounts or balances (`vault.ts:351`). | Financial calculations (`financeCalc.server.ts`, `paymentsService.server.ts`) remain strictly independent of proof presence. | A payment without a proof is completely valid. `PaymentDto` reflects `hasProof: boolean` and `proof?: PaymentProofDto`. |
| **Atomic Replacement** | Replaces active proof with new file. | In a single InnoDB transaction (`SELECT ... FOR UPDATE`): old proof `lifecycle_status` set to `'replaced'`, `active_payment_lock` set to `NULL`, `replaced_by_proof_id` updated; new proof inserted with `lifecycle_status = 'active'`, `active_payment_lock = payment_id`. | Atomically transfers active status. Old physical file is NEVER deleted from storage (financial evidence immutability). |
| **Audit-Retained Removal** | Deleting a proof. | `DELETE /api/v1/payments/:id/proof` sets `lifecycle_status = 'removed'`, `active_payment_lock = NULL`, stamps `removed_at`, records `removal_reason`, appends `proof.removed` finance event. | Physical file is preserved in private storage for compliance and audit retrieval. |
| **Voided Payment Freeze** | Payments marked `status = 'voided'` are immutable. | Attaching, replacing, or removing a proof on a voided payment is rejected with `409 payment_already_voided`. | Downloading/viewing proof of a voided payment remains permitted for Owner audit verification. |

---

## 2. Hostinger Storage Architecture & Durability Assessment

### Production Target Inspection (`khaki-butterfly-345144.hostingersite.com`)

- **Hostinger Passenger App Root:** `/home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs`
- **Hostinger Build Lifecycle:** Every Git redeploy generates a new immutable build folder under `versions/{build-id}/` and switches the `hbuilds/current` symlink.
- **Critical Risk:** Any file written inside `public_html/`, `.output/`, or `hbuilds/` is **destroyed on redeployment**.
- **Private Data Sibling Directory:** Files placed in `/home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/private-data/payment-proofs` are outside `hbuilds/` and not web-accessible. However, durability across Hostinger managed rebuilds or account migrations cannot be guaranteed without a deployment staging test.
- **Official Verdict:** **UNVERIFIED (Staging Acceptance Gate Required)**.
- **Dual-Driver Strategy Implemented:**
  1. `PROOF_STORAGE_DRIVER=local-fs`: Uses private local directory outside web root (default `.data/private-proofs`).
  2. `PROOF_STORAGE_DRIVER=object-storage`: Pluggable S3-compatible private object storage backend. Both share the exact same `ProofStorageBackend` interface, so switching requires only an environment variable change.

---

## 3. Database Schema & Migration (`0006_b3b_payment_proofs.sql`)

Forward migration [`0006_b3b_payment_proofs.sql`](../src/server/db/migrations/0006_b3b_payment_proofs.sql) adds:

```sql
CREATE TABLE `crm_payment_proofs` (
  `id` varchar(64) NOT NULL,
  `owner_user_id` varchar(64) NOT NULL,
  `payment_id` varchar(64) NOT NULL,
  `deal_id` varchar(64) NOT NULL,
  `legacy_attachment_id` varchar(128),
  `original_file_name` varchar(255) NOT NULL,
  `file_extension` varchar(16) NOT NULL,
  `mime_type` varchar(64) NOT NULL,
  `file_size` int NOT NULL,
  `sha256_hash` char(64) NOT NULL,
  `storage_driver` varchar(32) NOT NULL DEFAULT 'local-fs',
  `storage_key` varchar(512) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL DEFAULT 'active',
  `active_payment_lock` varchar(64),
  `replaced_by_proof_id` varchar(64),
  `replacement_reason` varchar(500),
  `removal_reason` varchar(500),
  `uploaded_by_user_id` varchar(64) NOT NULL,
  `removed_by_user_id` varchar(64),
  `version` int NOT NULL DEFAULT 1,
  `uploaded_at` datetime(3) NOT NULL,
  `removed_at` datetime(3),
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  CONSTRAINT `crm_payment_proofs_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_crm_payment_proofs_active_pay` UNIQUE(`owner_user_id`, `active_payment_lock`),
  CONSTRAINT `fk_crm_payment_proofs_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict,
  CONSTRAINT `fk_crm_payment_proofs_payment` FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON DELETE restrict,
  CONSTRAINT `fk_crm_payment_proofs_deal` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict,
  CONSTRAINT `fk_crm_payment_proofs_uploader` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict
);
```

---

## 4. Authenticated REST Proof Endpoints

All endpoints require authenticated Owner session (`sf_session`), same-origin CSRF verification, and owner scoping.

| Method & Route | Purpose | Key Behaviors & Responses |
| --- | --- | --- |
| `POST /api/v1/payments/:id/proof` | Attach active proof | Accepts `multipart/form-data`, JSON base64, or raw binary. Validates magic bytes, checks 10 MiB limit, stores staged file, inserts row with `active_payment_lock = payment_id`. Rejects if active proof exists (`409 proof_already_exists`). |
| `GET /api/v1/payments/:id/proof` | Get active proof metadata | Returns `{ ok: true, proof: PaymentProofDto }`. Returns `404 proof_not_found` if no active proof exists. |
| `PUT /api/v1/payments/:id/proof` or `POST /api/v1/payments/:id/proof/replace` | Replace active proof | Accepts new file + optional `reason`. Atomically marks current proof `'replaced'` and makes new proof `'active'`. Old file remains in storage. |
| `DELETE /api/v1/payments/:id/proof` | Remove active proof | Accepts optional `reason` (JSON body, query string, or header). Updates status to `'removed'`, releases `active_payment_lock`. Physical file is preserved. |
| `GET /api/v1/payments/:id/proof/download` | Authenticated streaming download | Streams file directly from private storage. Sets `Content-Type: <mime>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store, must-revalidate`, `Pragma: no-cache`. If PDF: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. Safe `Content-Disposition` (inline by default, attachment if `download=1`). Optional query `proofId` allows Owner to download historical replaced/removed proofs. |
| `GET /api/v1/payments/:id/proof/history` | List proof history | Paginated list of all proof versions for this payment (`active`, `replaced`, `removed`). Supports `limit` and `offset`. |

---

## 5. Security & Safety Controls

1. **Private Storage Isolation:** No proof file is ever placed in `public/`, `public_html/`, or `.output/`. Direct HTTP access without Owner authentication is impossible.
2. **Magic-Byte Sniffing:** Sniffs initial bytes (JPEG `0xFF 0xD8 0xFF`, PNG `\x89PNG`, WebP `RIFF....WEBP`, PDF `%PDF-`). File extension must match detected MIME signature.
3. **Traversal Prevention:** Strips `..`, `/`, `\`, control chars, and reserved OS device names (`CON`, `PRN`, `AUX`, `NUL`). Resolves all paths with `resolveSafeProofPath` ensuring candidate stays strictly within storage root.
4. **Staging & Rollback Safety:** Uploads write to `staging/` first with `.tmp` extension. If validation or DB transaction fails, temporary file is immediately unlinked. Stale temp files older than 1 hour are pruned by `cleanupAbandonedTemp`.
5. **Double Lock Concurrency:** `uq_crm_payment_proofs_active_pay` enforces that at most one active proof can exist per payment. Concurrent attempts to attach proofs to the same payment are rejected deterministically by MariaDB.

---

## 6. Test Suite & Verification Results

- **Automated Tests:** **834 passed across 91 test files** (27 new unit tests in `src/server/b3b-proofs.test.ts` + 6 new idempotency/retention tests).
- **TypeScript:** `npm run typecheck` passed (0 errors).
- **Drizzle Check:** `npm run db:check` passed (`Everything's fine 🐶🔥`).
- **ESLint:** `npx eslint` passed on all B3B server files (0 errors, 0 warnings).
- **Production Build:** `npm run build` succeeded; `.output/server/index.mjs` generated; 0 `jsxDEV` occurrences.
- **Frontend & Storage Isolation:** Verified that `src/routes/deals.tsx` and client IndexedDB proofs remain completely untouched.
