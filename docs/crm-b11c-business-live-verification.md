# CRM V2 — Checkpoint B11C-BUSINESS-LIVE Staging Verification Report

**Timestamp (IST / UTC):** `2026-11-12T00:06+05:30` (`2026-11-11T18:36Z`)  
**Branch:** `feat/b11c-business-live-verification`  
**Base Verified Local Commit:** `07e457f` (branched from `04bad2d`)  
**Target Staging Site:** `https://khaki-butterfly-345144.hostingersite.com` (`u256504187`)  
**Staging Database:** `u256504187_crm_b11c_stg` (`srv469.hstgr.io:3306`, internal `127.0.0.1:3306`)

---

## 1. Decision Summary

- **Infrastructure Verdict: Decision A — Existing ₹699/month Hostinger Business Web Hosting (`hostinger_business_v3`) is SUFFICIENT for CRM V2 staging and small-team launch without purchasing a VPS**, **conditional on completing the two Owner-deferred operational gates (Phase 5 clean-target backup/restore and Phase 7 live Hostinger cron dry-run check) before enabling production storage (`PROOF_PRODUCTION_DURABLE_CONFIRMED=true`).**
- **Safety Gate Preserved Throughout:**
  - `crm.joinscaleflow.in` remained completely untouched (latest build unchanged at `01a13e04-5a82-7016-8f49-27fb9dc40a72`, `2026-10-15T05:23:55Z`, commit `b01c05c05e4f3b9b85f0704495e351dfe6f308ad`).
  - Existing websites (`minddesk.joinscaleflow.in`, `darkgray-louse-574826.hostingersite.com`) and existing databases (`u256504187_mhtest`, `u256504187_minddesk`, `u256504187_minddesk_test`, `u256504187_minddesk_v2`) remained untouched.
  - `PROOF_PRODUCTION_DURABLE_CONFIRMED` remained unset/disabled (`NODE_ENV=development`, `DEV_LEAD_PILOT=true`, `PROOF_STORAGE_DRIVER=mariadb-blob`).
  - Zero Hostinger cron jobs were created (`hosting_cron-jobs_list` returned `[]`).
  - No GitHub `main` pushes, DNS edits, database restores, or VPS purchases occurred.

---

## 2. Environment & Schema Reconciliation Telemetry

| Component / Variable | Measured Live Value on `srv469.hstgr.io` / Hostinger |
|---|---|
| Hostinger Plan / Order | `hostinger_business_v3`, Order `1010060772` (`active`), `3/5` Node.js slots used (`4` total sites) |
| Node.js Runtime on Staging | `v22.23.4`, Nitro `node-server`, `timezone: Asia/Kolkata`, LiteSpeed UNIX socket listener |
| Live MariaDB Version | `11.8.9-MariaDB-log` |
| `max_user_connections` / `max_connections` | `75` / `2000` (staging app configured with `DB_POOL_LIMIT=8`) |
| `max_allowed_packet` | `1073741824` bytes (`1 GiB` runtime cap; app uses `1 MiB` chunks for headroom) |
| `wait_timeout` / `interactive_timeout` | `20` seconds / `20` seconds (tested explicitly with a `25s` idle pause) |
| `innodb_buffer_pool_size` | `80530636800` bytes |
| `GET_LOCK` / `RELEASE_LOCK` | Supported (`acq: 1`, `rel: 1`) |
| Staging Database Quota (`u256504187_crm_b11c_stg`) | `3072` MiB max (`disk_usage_mb: 33` reported at end of staging tests) |
| Drizzle Migrations & Table Count | `0000`–`0014` (`48` physical tables) + incremental `0015` (`crm_payment_proof_blobs`) = `49` physical tables (`48` Drizzle schema tables + `__drizzle_migrations`, `16` recorded migrations) |
| Container CPU / RAM Live Telemetry | **UNVERIFIED** (Hostinger Business MCP exposes no container CPU/RAM utilization endpoint) |

### Code Hardening Added During Staging Setup (`07e457f`)

- Saved pre-staging rollback baseline (`buildUuid: 01a1bfe8-38d6-700c-8823-b662c3a4f2ed`, Git `04ad8f4` on `main`, empty env array) to [`docs/crm-b11c-business-staging-rollback.json`](crm-b11c-business-staging-rollback.json).
- Added fallback resolution (`createRequire(vitePkgPath)("rolldown")`) in [`scripts/build-prod.mjs`](../scripts/build-prod.mjs) for `npm install` hoisting on Hostinger.

---

## 3. Verification Results by Phase

### Passed Live Scenarios (Synthetic Data Only)

1. **Auth, CSRF, RBAC & Tenant Isolation:**
   - Unauthenticated `/api/v1/auth/session` and `/api/v1/payments/:id/proof/download` returned `401`.
   - Cross-origin `POST /api/v1/leads` (`Origin: https://evil.example.invalid`) returned `403`.
   - Synthetic Owner A (`usr_stg_owner_a_b11c`) and Owner B (`usr_stg_owner_b_b11c`) logins set `HttpOnly` + `Secure` cookies and reported `leadPilotAvailable: true`.
   - Cross-tenant Owner B attempts on Owner A proof metadata, download, verify, and upload returned `[404, 404, 404, 404]` with zero leaked bytes.

2. **MariaDB BLOB Payment-Proof Lifecycle (`MariadbBlobProofStorage`, `1 MiB` Chunks):**
   - Synthetic Lead A, Deal A (`quotedAmount: 55000.00`, `finalAmount: 50000.00`), and 8 posted payments totaling `45000.00` (exact `5000.00` remaining, `collectionRate: 0.9`) stayed consistent in both `/api/v1/deals/:id/summary` and SQL after proof uploads/replacements.
   - Uploaded and verified byte-for-byte + SHA-256 + `nosniff` / `DENY` / `no-store` headers for:
     - `200 KB` JPEG (`204,800` B, `1` chunk): upload `744 ms`, download `362 ms`.
     - `1 MiB` PNG (`1,048,576` B, `1` chunk): upload `522 ms`, download `353 ms`.
     - `2.4 MiB` PDF (`2,516,582` B, `3` chunks): upload `643 ms`, download `411 ms`.
     - Near-`10 MiB` PDF (`10,483,712` B, `10` chunks): upload `3,586 ms`, download `772 ms`.
   - Proof replacement (`payAIds[3]`), `Idempotency-Key` replay (`x-idempotency-replayed: true`), and concurrent upload handling (`2` distinct + `2` racing same idempotency key -> `[201, 201]` & `[201/409]` with zero byte corruption) passed.
   - Invalid/spoofed script (`400`), corrupt PDF header (`400`), empty `0 B` payload (`400`), and oversized `>10 MiB` payload (`400`) all rejected fail-closed.
   - Storage diagnostics returned `driver: "mariadb-blob"`, `writable: true`, `status: "dev_local_only"`, `totalProofRecords: 8` (`7` active, `1` historical), `verifiedCount: 8`, `missingCount: 0`, `corruptedCount: 0`, `orphanFileCount: 0`.

3. **Live Fault Injection & Transactional Rollback (Scenario 19 & Scenario 20):**
   - **1-bit BLOB corruption in SQL:** `/verify` detected `verificationStatus: "checksum_mismatch"` (`persistedStorageStatus: "corrupted"`); `/download` failed closed with HTTP `500`.
   - **Deleted chunk row (`chunk_index = 1`):** `/verify` detected `verificationStatus: "size_mismatch"`; `/download` failed closed with HTTP `500`.
   - **Transactional rollback (`attachPaymentProofRecord` with `hooks.afterPrimaryWrite` throwing `SIMULATED_DB_FAILURE_AFTER_BLOB_AND_PROOF_WRITE` against live `u256504187_crm_b11c_stg`):** Before/after SQL counts were identical (`proofsForPay: 0 -> 0`, `totalProofs: 8 -> 8`, `totalBlobs: 19 -> 19`, `totalBlobPayloadBytes: 15,697,510 -> 15,697,510`), confirming zero orphan proof metadata or chunk rows.

4. **Hostinger Restart, Redeployment & Rollback Durability (Phase 4):**

| Stage | Build UUID / Action | Health `checkpoint` | Receipts Verified (Byte-for-Byte + SHA-256) | Diagnostics |
|---|---|---|---|---|
| Release 1 Deploy | `01a1cbc1-53e3-717f-9591-413be4b4e5b2` (`b11c-staging-src-v1.zip`, `2m 18s`) | `b1a` | Baseline uploaded (`19` chunks / `15,697,510` B payload) | `8/8` verified (`0` missing/corrupt) |
| App Restart | `hosting_nodejs_restart-application` | `b1a` (`1,055 ms` cold health) | All `4` receipts (`200KB`, `1MB`, `2.4MB`, `9.998MB`) matched | `8/8` verified, Owner B `404` |
| Release 2 Redeploy | `01a1cbd9-cde4-7277-8b40-f561e05e860d` (`b11c-staging-src-v2.zip`, `2m 17s`) | `b1a-rel2` (`501 ms`) | All `4` receipts matched (`19` chunks / `15,697,510` B) | `8/8` verified, Owner B `404` |
| Rollback to Release 1 | `01a1cbde-67a4-7053-9a02-06e80d62c061` (`b11c-staging-src-v1-rb.zip`, `2m 49s`) | `b1a` (`388 ms`) | All `4` receipts matched (`19` chunks / `15,697,510` B) | `8/8` verified, Owner B `404` |

- Note on intermediate Release 2 build `01a1cbd4-610f-72a0-bec7-2b589c1a9f17`: our first zip modifier replaced only the TypeScript interface line in `health.server.ts`, so runtime HTTP still reported `"b1a"`; we rebuilt with `"checkpoint": "b1a-rel2"` in both locations (`01a1cbd9-cde4-7277-8b40-f561e05e860d`) so HTTP `/api/v1/health` directly verified both the forward upgrade (`b1a` -> `b1a-rel2`) and the rollback (`b1a-rel2` -> `b1a`).
- Hostinger runtime logs after all restarts, redeployments, rollback, and Phase 8 tests contained only clean LiteSpeed UNIX socket start/graceful stop lines (`4` log lines total), with zero unhandled errors.

5. **Live MariaDB Storage Capacity Measurements (Phase 6):**
   - Clean baseline (`2` Owners, `49` tables, `0` blobs): `4,423,680` bytes (`4.22 MiB`: `802,816` data + `3,620,864` index).
   - After seeded CRM records + `8` proofs totaling `15,697,510` bytes (`14.97 MiB`) across `19` chunks + `ANALYZE TABLE`:
     - `crm_payment_proof_blobs` `DATA_LENGTH`: `16,269,312` bytes (`15.52 MiB`, `~1.036x` raw payload size -> `~3.6%` InnoDB row overhead, no base64 `33%` bloat).
     - `crm_payment_proof_blobs` `INDEX_LENGTH`: `32,768` bytes.
     - Total schema `DATA_LENGTH + INDEX_LENGTH`: `20,709,376` bytes (`19.75 MiB`); Hostinger `hosting_databases_list` reported `disk_usage_mb: 33` out of `3072` MiB max (`~1.07%` of DB quota).
   - Extrapolated ceiling within the `3,072 MiB` DB quota (reserving space for CRM operational tables/indexes): ~`2,900` single-chunk `1 MiB` proofs or ~`14,500` `200 KB` proofs before archival/S3 offloading is needed.

6. **Bounded Live Latency & `wait_timeout=20s` Recovery (Phase 8):**
   - `GET /api/v1/health` (warm x5): `min 270`, `median 302`, `p95/max 544 ms`
   - `POST /api/v1/auth/login` (x3): `min 460`, `median 509`, `p95/max 541 ms`
   - `GET /api/v1/leads` (x5): `min 269`, `median 299`, `p95/max 357 ms`
   - `GET /api/v1/analytics/dashboard` (x5): `min 299`, `median 301`, `p95/max 319 ms`
   - `GET /api/v1/payments/:id/proof/verify` (2.4 MiB PDF, x5): `min 300`, `median 350`, `p95/max 370 ms`
   - `GET /api/v1/payments/:id/proof/download` (`200 KB` JPEG, x3): `min 309`, `median 370`, `p95/max 410 ms`
   - `GET /api/v1/payments/:id/proof/download` (`2.4 MiB` PDF, x3): `min 398`, `median 421`, `p95/max 701 ms`
   - **25-Second Idle Pause Recovery (`> 20s` MariaDB `wait_timeout`):** Pre-idle `/api/v1/leads` `200` (`279 ms`) -> `25,000 ms` silence -> post-idle `/api/v1/leads` `200` (`356 ms`) and `/proof/verify` `200` (`361 ms`) with zero pool errors leaked to HTTP callers.

7. **Automation Cron CLI Dry-Run Safety Check (Local Read-Only Against `srv469.hstgr.io`):**
   - `.output/server/run-cron.mjs --print-command` produced compact command length `183` chars (`fitsHostinger255Limit: true`).
   - `.output/server/run-cron.mjs --dry-run` acquired MariaDB `GET_LOCK`, queried zero mutations (`durationMs: 1671`, `lockAcquired: true`, `outboundDeliveryGuaranteedDisabled: true`), exited `0`.
   - `.output/server/run-cron.mjs --execute-disposable` failed closed with exit code `2` and `code: "automation_cron_mutations_disabled"`.

---

## 4. Exact Edge-Case Findings & Deferred Items

1. **Minor Finding — Exact `10.00 MiB` (`10,485,760` B) Multipart Overhead:**  
   In [`src/server/http/crmRoutes.server.ts`](../src/server/http/crmRoutes.server.ts#L495), the early `Content-Length > MAX_PROOF_BYTES` (`10 * 1024 * 1024`) guard counts ~`350–500` bytes of `multipart/form-data` headers against the `10 MiB` limit, causing an exact `10,485,760`-byte multipart PDF upload to fail with `HTTP 400 file_too_large`, while a `10,483,712`-byte (`9.998 MiB`, 10 chunks) multipart PDF succeeds. (Fixable later in one small route tweak; left untouched in staging code verification.)
2. **Unverified Telemetry:** Live Hostinger Business container RAM/CPU usage during 10-chunk streaming remains **UNVERIFIED** (no telemetry API available on this hosting plan).
3. **Remote MySQL Access Note:** Temporary remote IP allowlist `202.173.125.178` remains open for `u256504187_crm_b11c_stg` if Phase 5 testing follows immediately; remove if closing remote access.
4. **Local Regression Gates Run After All Staging Tests (`07e457f`):**
   - `npm run typecheck`: exit `0`
   - `npm run db:check`: exit `0` (`Everything's fine`)
   - `npm run build`: exit `0`
   - Targeted `npx eslint` on all 9 B11C-BUSINESS code modules (`scripts/build-prod.mjs`, `scripts/run-automation-cron.mjs`, `src/server/b11c-business-hosting.test.ts`, `src/server/config/env.server.ts`, `src/server/crm/automationCron.server.ts`, `src/server/db/conventions.server.ts`, `src/server/health/health.server.ts`, `src/server/storage/mariadbBlobProofStorage.server.ts`, `src/server/storage/proofStorage.server.ts`): exit `0` (`0` errors/warnings; pre-existing formatting/`no-explicit-any` errors exist in unrelated legacy lines of `schema.server.ts` and `crmRoutes.server.ts`).
   - Full `npm test` (`vitest run`): **`137` test files passed, `1,397` tests passed, `0` failed, `0` skipped** (`55.39s`).

---

## 5. Deferred Operations Awaiting Separate Owner Approval

Before treating Hostinger Business hosting as fully cleared for real customer production traffic, separate explicit Owner approval is requested for:

1. **Phase 5 — Clean-Target Backup & Restore Drill:** Export `u256504187_crm_b11c_stg` (including binary BLOB chunks via `--hex-blob`), restore into a fresh disposable target database, verify all 49 tables and SHA-256 checksums match byte-for-byte, and document RPO/RTO.
2. **Phase 7 — Hostinger Cron Job Dry-Run Activation (Staging Only):** Create one staging cron job on `khaki-butterfly-345144.hostingersite.com` running `run-cron.mjs --dry-run` (zero mutations) to confirm scheduled execution, `GET_LOCK` concurrency guard, and Hostinger cron execution behavior under the 255-char command limit.
3. **Future Flag Flip (Only After Phase 5 + Phase 7 Pass):** Explicit approval to update the exact multipart `Content-Length` allowance (if desired), configure production `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` on a production site/DB, and plan future migration from `main`.
