# Scale Flow CRM V2 — B11C-BUSINESS-QA Final Live Verification & Audit Report

**Date:** 2026-11-12 IST (`2026-11-11 UTC`)  
**Branch:** `feat/b11c-business-final-qa` (starting commit `532174d`)  
**Staging Website:** `https://khaki-butterfly-345144.hostingersite.com` (`build 01a1cbff-bb2f-7061-872b-b1509802c4ce`)  
**CRM V1 Production (`crm.joinscaleflow.in`):** Completely untouched  
**Production Flags:** `PROOF_PRODUCTION_DURABLE_CONFIRMED=false` (staging Pilot mode preserved; real customer data untouched; unattended production automations disabled)

---

## Executive Verdict: PASS ON STAGING VERIFICATION — LAUNCH BLOCKED PENDING HARD-STOP & CRON/BACKUP GATES

All **three approved remote staging verification tracks** on Hostinger Business Web Hosting (`u256504187` / `khaki-butterfly-345144.hostingersite.com`) have now completed cleanly and **PASSED** with real HTTP, MariaDB 11.4 LONGBLOB, clean-target restore, and live Hostinger cron scheduler evidence:

| Verification Track / Gate | Outcome | Summary Evidence |
| :--- | :--- | :--- |
| **1. Staging Deployment & Rollback Snapshot** | **PASS** | Pre-QA build `01a1cbde-67a4-7053-9a02-06e80d62c061` saved in [crm-b11c-business-qa-rollback.json](./crm-b11c-business-qa-rollback.json). Reproducible secret-free archive built & deployed cleanly as `01a1cbff-bb2f-7061-872b-b1509802c4ce` (`state: completed`, Node 22 Nitro, `2m 11s`). Archive removed from `public_html` (`public_html` contains `.htaccess` only). |
| **2. Live Exact `10 MiB` Multipart Upload & Security Matrix** | **PASS** | Exact `10,485,760` B PDF (`PUT`) & JPEG (`POST /replace`) with `Content-Length > 10 MiB` uploaded (`200`), chunked into `10` MariaDB BLOB rows each, downloaded byte-for-byte with SHA-256 identity, and verified via `/proof/verify?persist=1`. `10 MiB + 1 byte` (`400 file_too_large`), oversized `> 10.25 MiB` (`413`), missing/mismatched multipart boundary (`400 validation_error`), raw non-multipart garbage (`403` Hostinger `hcdn` edge WAF), truncated multipart (`400 validation_error`), unauthenticated (`401`), and cross-owner (`404`) all verified. Pre-existing `4` Deals, `14` Payments & seeded proofs intact. |
| **3. Binary-Safe MariaDB Backup & Clean-Target Restore** | **PASS** | Logical snapshot export (`178,511,466` B SQL dump, SHA-256 `eecc292ca5c38cd405da613198f77322ebef8fd5f1e9adaa7ac080e3d9e62490`) of `u256504187_crm_b11c_stg` (`49` tables, `311` rows, `23` proofs, `97` LONGBLOB chunks, `80.83 MiB`) restored cleanly into verified empty `u256504187_crm_b11c_rst` (`0 -> 49` tables). `0` missing/extra tables, `0` row mismatches, `0` BLOB chunk SHA-256 mismatches, **`23/23` reassembled proofs** (including `7` exact `10,485,760`-byte proofs) matched SHA-256 100%. |
| **4. Live Hostinger Cron `--dry-run` Scheduler Verification** | **PASS (after diagnosing helper path/operator issue)** | Early attempts `URsmnYePHz` and `MmGubFYpaR` returned empty `{"output":""}` and were **not** counted as passing. Diagnosed two real Hostinger Business constraints (`/opt/alt/alt-nodejs22/root/bin/node` does not exist; actual Node 22 binary is `/opt/alt/alt-nodejs22/root/usr/bin/node`, and compound `cd ... && ...` / redirection fails silently or loses stderr). Temporary cron `0GHQtfcShv` using the direct `255`-char `/opt/alt/alt-nodejs22/root/usr/bin/node` command executed on schedule (`19:45:04.208Z` UTC / `01:15:04+05:30` IST) in **`69 ms`** with `lockAcquired: true`, `mode: "dry_run"`, `outboundDeliveryGuaranteedDisabled: true`, and **0 CRM writes**. **All temporary cron jobs deleted; `hosting_cron-jobs_list` verified `[]`.** |
| **5. Server-Side 70% Database Quota Hard-Stop (`2,150 MiB`)** | **BLOCKED (Launch Blocker)** | Audited `crmRoutes.server.ts`, `proofService.server.ts`, and `mariadbBlobProofStorage.server.ts`: `evaluateMariadbStorageCapacity()` exists only in `scripts/b11c-mariadb-backup.mjs`. The live proof-upload HTTP/service path does **not** enforce the `70%` (`2,150 MiB` of `3,072 MiB`) quota ceiling yet. |
| **6. Cron Command Helper & Longer Domain `255`-Char Headroom** | **BLOCKED (Pre-Launch Fix Needed)** | `scripts/run-automation-cron.mjs` (`buildHostingerCliCommand`) & `src/server/crm/automationCron.server.ts` (`buildHostingerCronCommand`) currently emit `/opt/alt/alt-nodejs22/root/bin/node` + `cd ... && ...`, while direct `--env-file=` absolute paths hit `255/255` chars for `khaki-butterfly-345144.hostingersite.com` (leaving `0` chars for longer custom domains or `--owner=`). |
| **7. Hostinger Business Automated Backup / Telemetry APIs** | **NOT VERIFIED** | Zero automated Business-tier backup/restore API or container CPU/RAM metrics APIs exist on `hostinger_business_v3` via Hostinger MCP. Off-site encrypted MariaDB backups remain mandatory before production launch. |

---

## 1. Phase 6 — Live Deployment & 10 MiB Multipart Verification Details

- **Pre-QA Deployment Saved:** `build.uuid = "01a1cbde-67a4-7053-9a02-06e80d62c061"` (`b11c-staging-src-v1-rb.zip`, updated `2026-11-11T18:32:45Z`).
- **QA Deployment:** Uploaded deterministic secret-free source archive from commit `532174d` via Hostinger TUS, built with Node 22 + Nitro (`npm run build`), completed as **`build.uuid = "01a1cbff-bb2f-7061-872b-b1509802c4ce"`** in `2m 11s` (`2026-11-11T19:08:07Z`).
- **Health Endpoint (`GET /api/v1/health`):** `200 OK`, `storage.driver = "mariadb-blob"`, `storage.durabilityStatus = "dev_local_only"`, `storage.productionReady = false`, `runtime.timezone = "Asia/Kolkata"`.
- **Live HTTP Matrix Against `https://khaki-butterfly-345144.hostingersite.com`:**
  1. **Small JPEG (`2,048` B) `POST`:** `201 Created`, `GET /download` `200 OK`, SHA-256 `1d5872ab952741c01b95a8c06ff22036cc30012c2a2dd5e75b90376105ed3baa` matched.
  2. **Small PDF (`4,096` B) `POST`:** `201 Created`, `GET /download` `200 OK`, SHA-256 `9951303f7af6a0d1851151b35e873ab55acbe6b26ecdac2b661d74494278219e` matched.
  3. **Exact `10 MiB` (`10,485,760` B) PDF (`PUT`, `Content-Length: 10,486,139`):** `200 OK`, `GET /download` `200 OK` (`10,485,760` B), SHA-256 `8cac33d02c631d433a6e463ad6dea67d3f817563ec6fd56e01a5d2ee8991c5c6` matched, `GET /verify?persist=1` returned `persistedStorageStatus: "verified"`, and `crm_payment_proof_blobs` verified `10` chunk rows totaling `10,485,760` B.
  4. **`10 MiB + 1 byte` (`10,485,761` B) PDF (`PUT`, `Content-Length: 10,486,132`):** Rejected cleanly with **`400 file_too_large`**.
  5. **Exact `10 MiB` (`10,485,760` B) JPEG + Extra Multipart Fields (`POST /proof/replace`, `Content-Length: 10,486,372`):** `200 OK` with `mimeType`, `reason`, `idempotencyKey`, and `expectedProofVersion` fields, `GET /download` `200 OK` (`10,485,760` B), SHA-256 `af10963404c7944241be2425e587395c4764aa37ab93811d9be9ce1e83ad3aec` matched, `10` chunk rows in `crm_payment_proof_blobs`.
  6. **Oversized Request (`10,752,000` B > `MAX_PROOF_MULTIPART_BODY_BYTES = 10,747,904` B):** Rejected cleanly with **`413 file_too_large`**.
  7. **Invalid / Missing / Malformed Multipart Boundaries:**
     - Missing `boundary` parameter: **`400 validation_error`** (`Missing or invalid multipart boundary`).
     - Mismatched multipart boundary: **`400 validation_error`** (`Multipart opening boundary not found`).
     - Raw non-multipart text with `multipart/form-data` header: **`403 Forbidden`** intercepted at Hostinger `hcdn` edge WAF before reaching Nitro.
  8. **Truncated Multipart Upload (missing closing boundary):** **`400 validation_error`** (`Truncated multipart payload: closing boundary missing`).
  9. **Unauthenticated Access:** Both `PUT` upload and `GET /download` returned **`401`**.
  10. **Cross-Owner Isolation (Owner B vs Owner A Payment):** Both `PUT` upload and `GET /download` returned **`404`**; all `4` pre-existing Deals, `14` pre-existing Payments (including prior `10,485,760`-B seeded proof), and active QA Deal paid/remaining paise balances remained invariant.

---

## 2. Phase 4 — Binary-Safe Backup & Clean-Target Restore Details

- **Source DB:** `u256504187_crm_b11c_stg` (`srv469.hstgr.io:3306`, TLS required) — `49` base tables (`48` Drizzle tables + `__drizzle_migrations`), `311` total rows, `80.83 MiB` `DATA_LENGTH + INDEX_LENGTH` (`2.63%` of `3,072 MiB` quota; `100 MB` Hostinger panel allocation).
- **Target Restore DB:** Newly provisioned empty disposable database `u256504187_crm_b11c_rst` (`0` pre-existing tables confirmed fail-closed before restore).
- **Restore & Integrity Parity:**
  - `211` batched SQL statements (`<= 1.5 MiB`, `0x<hex>` BLOB serialization) executed without errors.
  - Restored table count: **`49 / 49`** (`missingTables: []`, `extraTables: []`).
  - Per-table row mismatches: **`0`** (`rowMismatches: []`).
  - Per-chunk LONGBLOB `SHA2(blob_data, 256)` mismatches across `97` chunks: **`0`** (`blobMismatches: []`).
  - Reassembled full-file proof integrity checks: **`23 / 23` matched** (covering proofs from `2,048` B up to `7` distinct `10,485,760`-B files, totaling `89,122,406` proof payload bytes in both databases).
  - Remaining proof capacity before `70%` (`2,150 MiB`) hard stop from `80.83 MiB`: `2,069.17 MiB` (~`1,995` × 1 MiB receipts or ~`9,979` × 200 KiB receipts at `~1.0367x` overhead).

---

## 3. Phase 5 — Hostinger Cron Scheduler Diagnosis & Dry-Run Verification

| Attempt UID | Command Pattern | Hostinger Output | Diagnosis / Disposition |
| :--- | :--- | :--- | :--- |
| `URsmnYePHz` | `cd .../hbuilds && /opt/alt/alt-nodejs22/root/bin/node --env-file=config/.env ... --dry-run` | `{"output":""}` | **Failed/Empty (NOT treated as success).** Root cause: wrong Node binary sub-path (`/root/bin/node` instead of `/root/usr/bin/node`) + shell `&&` compound chaining. Deleted. |
| `MmGubFYpaR` | `cd .../hbuilds && /opt/alt/alt-nodejs22/root/usr/bin/node --env-file=config/.env ... --dry-run 2>&1` | `{"output":""}` | **Failed/Empty (NOT treated as success).** Compound `cd ... && ...` / redirection failed before execution or was suppressed by Hostinger's cron runner. Deleted. |
| `0GHQtfcShv` | `/opt/alt/alt-nodejs22/root/usr/bin/node --env-file=/home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/config/.env /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs/server/run-cron.mjs --dry-run` | Real JSON stdout captured! | **PASSED.** Ran under real Hostinger cron at `2026-11-11T19:45:04.208Z` (`2026-11-12T01:15:04+05:30` IST), acquired MariaDB `GET_LOCK` (`true`), completed in **`69 ms`**, `overdueFollowUpsFound: 0`, `enabledCronRulesFound: 0`, `outboundDeliveryGuaranteedDisabled: true`. Post-cron DB check verified `crm_automation_runs: 0`, `crm_follow_ups: 0`, `crm_internal_reminders: 0`. Deleted & confirmed `hosting_cron-jobs_list === []`. |

---

## 4. Remaining Launch Blockers Before Production Cutover

1. **Enforce 70% (`2,150 MiB`) Database Quota Hard-Stop in Proof Upload API:** Implement real-time `INFORMATION_SCHEMA.TABLES` capacity guard inside [`proofService.server.ts`](../src/server/crm/proofService.server.ts) / [`mariadbBlobProofStorage.server.ts`](../src/server/storage/mariadbBlobProofStorage.server.ts) so new proof writes fail closed cleanly once DB storage reaches `>= 2,150 MiB` (`70%` of `3,072 MiB`), reserving ~`922 MiB` operational headroom for CRM writes & dumps.
2. **Fix Hostinger Cron Command Builder & Auto-Env Resolution:** Update [`scripts/run-automation-cron.mjs`](../scripts/run-automation-cron.mjs) and [`src/server/crm/automationCron.server.ts`](../src/server/crm/automationCron.server.ts) to:
   - Use `/opt/alt/alt-nodejs22/root/usr/bin/node` (without `cd ... && ...`).
   - Auto-discover `../../../config/.env` relative to `import.meta.url` inside `run-cron.mjs` so `--env-file=` isn't needed on cron CLI — shrinking the production cron command from `255` chars down to ~`168` chars so custom domains and `--owner=` fit safely under Hostinger's `255`-char limit.
3. **Production Backup & Pilot Cutover Gate (`B11C-LAUNCH-HARDENING`):** Establish encrypted off-site MariaDB backup automation & alert threshold at `50%` (`1,536 MiB`), add Hostinger WAF `403` awareness/client guidance if malformed payloads hit edge WAF, keep CRM V1 untouched, and gate `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` strictly on a dedicated production database after hardening passes.

---

## 5. Final Regression Gates & Hygiene (`feat/b11c-business-final-qa`)

- **`npm run typecheck` (`tsc --noEmit`):** **PASS** (`exit 0`).
- **`npm run db:check` (`drizzle-kit check`):** **PASS** (`exit 0`, schema & migrations consistent).
- **`npm run test` (`vitest run`):** **PASS** (`exit 0`, `138` test files, `1,411` tests passed, `0` failed, `0` skipped).
- **`npx eslint scripts/b11c-mariadb-backup.mjs src/server/b11c-business-qa.test.ts`:** **PASS** (`exit 0`, `0` errors, `0` warnings). *(Targeted check including `src/server/http/crmRoutes.server.ts` exited `1` on `13` pre-existing errors at lines `1359`, `4584–5115` outside the B11C-QA lines; full repo `npm run lint` exits `1` on `10,449` pre-existing lint/formatting issues unrelated to B11C-QA).*
- **`npm run build` (`node scripts/build-prod.mjs`):** **PASS** (`exit 0`; produced `.output/server/index.mjs` at `42,480` B and `.output/server/run-cron.mjs` at `1,095,222` B).
- **Remote Hygiene & Scope Verification:**
  - `hosting_cron-jobs_list`: `[]` (`0` remaining cron jobs on `u256504187`).
  - `hosting_databases_list-remote-connections`: temporary workstation IP `202.173.125.178` revoked from `u256504187_crm_b11c_rst` (`202.173.125.178` remains only on staging `u256504187_crm_b11c_stg`).
  - `GET https://khaki-butterfly-345144.hostingersite.com/api/v1/health`: `200`, `driver: "mariadb-blob"`, `productionReady: false`.
  - CRM V1 (`crm.joinscaleflow.in`), unrelated domains (`minddesk.joinscaleflow.in`, `darkgray-louse-574826.hostingersite.com`), and unrelated databases (`mhtest`, `minddesk*`) verified untouched.

## 6. Recommended Next Checkpoint

- **Exact Next Checkpoint:** **`B11C-LAUNCH-HARDENING`** — implement the server-side `70%` (`2,150 MiB`) MariaDB quota hard-stop in proof upload service/routes, fix `buildHostingerCronCommand` / `buildHostingerCliCommand` to `/opt/alt/alt-nodejs22/root/usr/bin/node` with relative `../../../config/.env` auto-loading inside `run-cron.mjs`, and establish encrypted off-site MariaDB backups before any production database cutover.
