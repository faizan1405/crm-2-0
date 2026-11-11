# Checkpoint B11A — Durable Private Payment-Proof Storage Backend

> **Branch:** `feat/b11a-durable-private-proof-storage` (branched from `feat/b10c-qa-execution-safety` / `8430a80`)  
> **Hostinger Production Storage Verdict:** **BLOCKED (FAIL CLOSED)** on current `hostinger_business_v3` shared Node.js hosting until Owner approves durable infrastructure.  
> **Non-Scope Enforced:** Zero changes to CRM frontend UI (`src/routes/deals.tsx`, `PilotProofViewer.tsx`), `src/lib/crm/store.ts`, `src/lib/crm/proofRepo.ts`, `src/lib/crm/attachments.ts`, browser `localStorage` (`scale-flow-crm-2-demo`), IndexedDB (`scale-flow-payment-proofs`), `.env`, CRM V1, Team CRM, or OpenRouter. Zero external S3/R2/Supabase vendors introduced.

---

## 1. Storage Code Audit Findings (Resolved in B11A)

Inspection of the B3B payment-proof stack prior to B11A identified six production safety and integrity gaps:

1. **Silent Ephemeral Local Fallback (`ObjectStorageProofStorage`):** Previously, `PROOF_STORAGE_DRIVER=object-storage` delegated silently to `LocalFsProofStorage` (`.data/private-proofs`) when no object store was configured, masking missing durable storage in production.
2. **Un-gated Production Writes to Ephemeral Paths:** `LocalFsProofStorage` allowed `NODE_ENV=production` uploads to default `.data/private-proofs` or even `hbuilds/` deployment paths without durability confirmation.
3. **Missing Bit-Rot & Size Verification on Read/Verify:** Downloads trusted stored files without re-verifying SHA-256 and byte length during retrieval or providing a server-side verification endpoint.
4. **MIME / Structural Truncation Gaps:** Minimal magic-byte sniffing accepted truncated/corrupted containers (e.g., JPEG missing `FF D9` EOI, PNG missing `IEND` / malformed `IHDR`, WebP RIFF size mismatch, PDF objects missing `%%EOF`) and did not cross-check `declaredMimeType` against sniffed content or sanitize the persisted `originalFileName`.
5. **Replayed Upload Temp Cleanup & Error Hygiene:** Idempotent replay (`replayed === true`) could leave staged temp files uncleaned until expiry, and missing-file read errors included `storageKey` details.
6. **Health & Data Vault Alignment:** `/api/v1/health` and Data Vault blockers needed secret-free durability diagnostics aligned to Hostinger Business limits.

All six findings are resolved in B11A without breaking existing B3B/B7A test suites.

---

## 2. Read-Only Hostinger MCP Infrastructure Audit

Verified directly via Hostinger MCP read-only inspection during B11A:

- **Hosting Plan:** `hostinger_business_v3` (Order ID `1010060772`)
- **VPS Instances:** `0` provisioned
- **Active Sites Account:** `u256504187` (5 Node.js web apps, including `khaki-butterfly-345144.hostingersite.com` with empty runtime env vars)
- **Deploy Lifecycle:** Hostinger Node.js deploys unpack each build into versioned `versions/{build-id}/` folders and swap the `hbuilds/current` symlink. Any file inside `hbuilds/`, `public_html/`, or `.output/` is overwritten on redeploy.
- **Native Object Storage:** Hostinger Business does **not** include a managed S3-compatible object storage service.
- **Shared FS Durability Status:** Even a sibling folder outside `hbuilds/` on shared business hosting lacks verified backup/restore isolation and multi-instance guarantees without Owner-verified infrastructure provisioning and restore drills.
- **Official Production Status:** **UNVERIFIED / BLOCKED**. Production uploads fail closed with HTTP `503`.

---

## 3. Fail-Closed Production Gating & Provider-Neutral Engine

### Environment Controls (`src/server/config/env.server.ts`)
- `PROOF_STORAGE_DRIVER`: `"local-fs" | "object-storage" | "hostinger-private-fs" | "disposable-test" | "disabled"` (default `"local-fs"`).
- `PROOF_PRODUCTION_DURABLE_CONFIRMED`: Optional boolean flag (treated as `false` when unset).
- `PROOF_TEST_STORAGE_ALLOWLIST`: Optional allowlist root required when instantiating `disposable-test` fault-injection storage via `verifyDisposableProofTestStorageConfig`.
- `assessProofStorageEnv(env)` computes deterministic fail-closed posture:
  - `NODE_ENV=production` + `PROOF_STORAGE_DRIVER=local-fs` with default `.data/...` or `hbuilds`/`public_html`/`.output` paths -> `failClosed: true` (`blocked_ephemeral_path` / HTTP `503 storage_not_configured`).
  - `NODE_ENV=production` + `PROOF_STORAGE_DRIVER=object-storage` -> `failClosed: true` (`blocked_object_storage_unconfigured` / HTTP `503 storage_not_configured`, **zero** local fallback).
  - `NODE_ENV=production` + `PROOF_STORAGE_DRIVER=disabled` -> `failClosed: true` (`disabled` / HTTP `503 storage_not_configured`).
  - `NODE_ENV=production` + unconfirmed non-ephemeral directory (`PROOF_PRODUCTION_DURABLE_CONFIRMED !== true`) -> `failClosed: true` (`blocked_durability_unconfirmed` / HTTP `503 storage_durability_blocked`).
  - `NODE_ENV=production` + `PROOF_STORAGE_DRIVER=disposable-test` -> blocked (`failClosed: true`).
  - `NODE_ENV=production` succeeds **only** when a non-ephemeral private directory outside web/deploy roots is explicitly configured with `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` (and for `disposable-test`, non-prod + allowlist check passes).

### `ProofStorageBackend` Adapter & Test Fault Injection (`src/server/storage/proofStorage.server.ts`)
- Unified private object operations implemented across `LocalFsProofStorage`, `ObjectStorageProofStorage` (fail-closed stub), `DisabledProofStorage`, and `DisposableTestProofStorage`:
  - `putPrivateObject`
  - `getPrivateObject`
  - `headPrivateObject`
  - `verifyPrivateObject`
  - `deletePrivateObject`
  - `listOrphanedObjects`
- `LocalFsProofStorage` stages writes to `staging/`, calls `fsync`, validates post-persist SHA-256 and byte length, refuses key collisions, and skips creating `.data/` directories when fail-closed.
- `DisposableTestProofStorage` enforces `PROOF_TEST_STORAGE_ALLOWLIST` and supports deterministic fault injection (`failOnStageWrite`, `failOnPersist`, `failOnPostPersistVerify`, `failOnRead`, `corruptHashOnVerify`, `simulateMissingOnVerify`, `failOnDelete`).

---

## 4. Schema Hardening (`0014_b11a_proof_storage_hardening.sql`)

Additive forward migration `0014_b11a_proof_storage_hardening.sql` extends `crm_payment_proofs` (total MariaDB schema: `47` CRM tables across `15` migrations `0000`..`0014`):

- `storage_status varchar(24) DEFAULT 'verified' NOT NULL`
- `storage_provider_id varchar(64)`
- `verified_at datetime(3)`
- `verification_error varchar(255)`
- Index `idx_crm_payment_proofs_storage_status` on `(owner_user_id, storage_status)`

Pre-existing B3B proof rows upgrade safely with `storage_status = 'verified'`. `ON DELETE RESTRICT` foreign keys on `crm_payments` and `crm_deals` remain enforced.

---

## 5. Security & Integrity Controls

| Control | Implementation Details |
| --- | --- |
| **Supported Formats & Size Limit** | `JPEG`, `PNG`, `WebP`, `PDF`; hard limit `MAX_PROOF_BYTES = 10 * 1024 * 1024` (10 MiB); 0-byte empty uploads rejected (`400 empty_file`). |
| **Magic-Byte + Container Validation** | `sniffProofKind` + `validateProofContainerStructure` validate magic headers, declared MIME type, file extension match, JPEG `FF D9` EOI, PNG `IHDR` dimensions & `IEND`, WebP RIFF byte length, and PDF `%PDF-1.x` + `%%EOF` trailer (`400 invalid_file_type` / `400 file_corrupted`). |
| **Filename Sanitization & Opaque Keys** | `sanitizeProofFileName` strips paths (`..`, `/`, `\`), control characters, and OS reserved names; truncates long filenames cleanly within DB column limits preserving extension. Storage keys are strictly randomized opaque IDs (`prf_<uuid>.<ext>`) containing zero customer names, phones, or PII. |
| **Bit-Rot & Missing-File Detection** | `getPrivateObject` and `verifyPrivateObject` recompute SHA-256 and byte length. Downloads block corrupted (`500 file_corrupted`) or missing (`500 storage_error`) objects without leaking disk paths or `storageKey`. `GET /api/v1/payments/:id/proof/verify` supports `?proofId=...` and `?persist=1`. |
| **Download Security Headers** | Private streaming responses set `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store, must-revalidate`, `Pragma: no-cache`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, safe `Content-Disposition`, and strict `Content-Security-Policy` sandbox headers for both PDFs (`default-src 'none'; style-src 'unsafe-inline'; sandbox`) and non-PDF images (`default-src 'none'; sandbox`). |
| **Diagnostics & Coverage Truth** | `/api/v1/health` (`subsystems.storage`: `productionReady`, `failClosed`, `durabilityStatus`), Pilot-only `GET /api/v1/vault/storage-diagnostics`, and Data Vault `blocker-storage-durability` (`status: "unverified"`, `severity: "critical"`) report secret-free readiness without exposing filesystem paths. |
| **Orphan & Failure Atomicity** | Replayed uploads unlink unused temp files immediately. Simulated storage outages leave MariaDB unchanged; post-persist DB failures roll back the SQL transaction and delete the orphaned binary. `reconcileOrphanProofFiles` purges aged unreferenced files/temps while sparing active, replaced, and removed audit binaries. |
| **Malware Scanning** | **NOT IMPLEMENTED.** ClamAV/AV binary scanning is unavailable on Hostinger Business shared Node.js hosting. Compensated by strict format/container validation, opaque non-executable private storage, and sandboxed download headers until VPS/dedicated scanning or pre-upload scanning is approved. |
| **Encryption at Rest** | Application-level file encryption is **not** enabled on local filesystem proof objects in B11A; volume/platform disk encryption depends on Owner-selected Hostinger VPS or storage target provisioning. |

---

## 6. Browser IndexedDB (`scale-flow-payment-proofs`) & Future Migration Readiness

- Browser-local payment proofs remain untouched in IndexedDB (`scale-flow-payment-proofs`) via `src/lib/crm/proofRepo.ts` and Data Vault ZIP export (`files/payment-proofs/`).
- `MigrationMapper` in `src/server/backup/migrationMapping.server.ts` preserves deterministic `legacyAttachmentId` translation (`Payment` -> `PaymentProof`) for future server cutover.
- Live client-to-server proof migration and full encrypted server backup archival (`crm_payment_proofs` binaries included) remain deferred to Data Vault production cutover (**B12+**) after durable Hostinger storage is provisioned and restore-tested.

---

## 7. Owner Infrastructure Decision Options (Hostinger Policy)

External AWS S3, Cloudflare R2, or Supabase Storage must **never** be introduced without explicit Owner approval. Before unblocking production payment-proof uploads:

1. **Option 1 — Hostinger VPS + Persistent Private Volume (Recommended on Hostinger):** Provision a Hostinger VPS instance, attach/mount a private storage volume outside web/deploy roots with strict OS permissions, enable scheduled off-host snapshots/backups with restore verification, and configure `hostinger-private-fs` (or self-hosted S3-compatible object storage inside Hostinger VPS).
2. **Option 2 — Verified Persistent Hostinger Storage + Live Redeploy/Restore Drill:** Provision a persistent non-`hbuilds` storage path guaranteed to survive Git redeploys and included in verified Hostinger backups + restore drills; set `PROOF_STORAGE_DRIVER=hostinger-private-fs` and `PROOF_PRODUCTION_DURABLE_CONFIRMED=true`.
3. **Option 3 — Explicit Owner Exception for External Private Object Storage:** Approve a dedicated private object storage adapter outside Hostinger via a separate Owner-signed ADR before implementation.

---

## 8. Verification Results (`feat/b11a-durable-private-proof-storage`)

- **Vitest Automated Suite:** `135` test files passed, `1,379` tests passed (`0` failed, `0` skipped), including `15` new tests in `src/server/b11a-durable-proof-storage.test.ts` and `34` tests in `src/server/b3b-proofs.test.ts`.
- **Live MariaDB 11.4.13 + Compiled Nitro (`.output/server/index.mjs`) Suite:** `54 / 54` live verification scenarios passed (clean `0000..0014` migration, incremental `0013 -> 0014` upgrade, `ON DELETE RESTRICT`, production fail-closed gates, zero `.data/` fallback, all 4 file formats, container truncation/MIME rejection, bit-rot detection, concurrency/idempotency, DB/storage failure rollback, orphan reconciliation, exact paise ledger reconciliation, zero browser/UI contamination).
- **Drizzle Schema Check:** `npm run db:check` passed (`Everything's fine`).
- **TypeScript & Production Build:** `npm run typecheck` (`0` errors) and `npm run build` passed.
