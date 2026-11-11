# CHECKPOINT B11C-BUSINESS — Hostinger Business Web Hosting Feasibility & Architecture Evaluation

**Date:** 2026-11-11  
**Branch:** `feat/b11c-business-hosting-feasibility` (branched from local commit `8318071`)  
**Scope:** Local architecture evaluation, storage/cron prototyping, and verification only. Zero remote Hostinger mutations, zero VPS purchases, zero GitHub pushes, and zero changes to CRM V1 (`crm.joinscaleflow.in`).

---

## Executive Verdict

**Can Scale Flow CRM V2 run on your existing ₹699/month Hostinger Business Web Hosting plan (`hostinger_business_v3`) without buying a VPS right now?**

**Yes — tentatively YES under OPTION A (All-in-One Business Launch), provided it passes a synthetic live staging verification on `khaki-butterfly-345144.hostingersite.com` before any production data or `PROOF_PRODUCTION_DURABLE_CONFIRMED` flag is enabled.**

- Why it fits today's Owner-only CRM workflow:
  1. You already have **2 free Node.js app slots** (`3/5` used) and **~3 GB (`3072 MB`) per MySQL/MariaDB database** on `srv469.hstgr.io:3306`.
  2. Storing chunked (`<= 1 MiB`) payment proofs in MariaDB (`PROOF_STORAGE_DRIVER="mariadb-blob"` -> [`crm_payment_proof_blobs`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/db/migrations/0015_b11c_business_mariadb_blob.sql)) avoids shared-hosting sibling-directory backup blind spots and keeps every receipt aligned inside Hostinger's built-in **Daily (7-day) + Weekly (6-week)** MySQL backup points.
  3. Bundling a standalone cron CLI ([`run-cron.mjs`](file:///C:/Users/Faizan/Downloads/CRM%202.0/scripts/build-prod.mjs) via `rolldown`) solves Nitro stripping `mysql2` from `.output/server/node_modules`, fits Hostinger's **255-character cron command limit** (`183` chars with `cd`), converts UTC cron invocations cleanly into `Asia/Kolkata` (`+05:30`), and handles Follow-ups & Internal Reminders via short-lived runs rather than a disallowed background daemon.
  4. Measured build footprint is **16.08 MB across 303 files**, consuming negligible disk/inode headroom under Hostinger's **50 GB NVMe / 600,000 inode** caps.
- When you should choose **OPTION C (VPS)** instead:
  - If your receipt volume exceeds **~2.5 GB** within your retention window (e.g., thousands of multi-megabyte uncompressed PDFs), if live staging on `khaki-butterfly-345144.hostingersite.com` hits 3 GB container memory/process/cron limits, or as soon as you expand beyond single-Owner usage into high-concurrency team workflows or unattended outbound automation.

---

## 1. Hostinger Account & Plan Audit (Read-Only Verified Facts vs Official Docs)

### 1.1 Read-Only Account & Deployment Inspection (`u256504187`)

| Item | Verified State | Source |
| :--- | :--- | :--- |
| Hosting Plan & Order | `hostinger_business_v3`, Order `1010060772` (active) | Hostinger MCP (read-only) |
| Node.js App Slots | `4` websites on `u256504187`; **`3/5` Node.js slots used (`2` free)** | Hostinger MCP (read-only) |
| CRM V2 Staging Site | `khaki-butterfly-345144.hostingersite.com` (`node_version: 22`, `app_type: "nitro"`, `output_directory: ".output"`, `entry_file: "server/index.mjs"`) | Hostinger MCP (read-only) |
| CRM V2 Staging Runtime Log | `last_deployed_at: 2026-11-09T10:47:19Z`, `started_at: 2026-11-09T10:47:21Z`, `total_lines: 2`, `logs: []` | `hosting_nodejs_runtime-logs` (`period: "1d"`) |
| CRM V2 Staging Env Vars | `0` environment variables configured | Hostinger MCP (read-only) |
| Existing MySQL Databases | `4` databases on `srv469.hstgr.io:3306`, currently **`1–6 MB` each**, `max_size_mb: 3072` (3 GB/DB) | Hostinger MCP (read-only) |
| Existing Cron Jobs | `0` cron jobs configured | Hostinger MCP (read-only) |
| CRM V1 Production | `crm.joinscaleflow.in` — **untouched** | Constraint verified |
| Hostinger Shared Telemetry Gap | `agency-hosting_metrics_*` and `vps_virtual-machines_metrics` do not apply to Business Web Hosting; live container CPU/RAM/disk metrics are not exposed via MCP | Hostinger MCP catalog inspection |

### 1.2 Hostinger Business Web Hosting Limits (Official Documentation)

| Resource / Feature | Documented Business Limit / Behavior | Implication for CRM V2 |
| :--- | :--- | :--- |
| RAM & CPU | **3 GB RAM**, **2 CPU cores** | Comfortable for single-Owner SSR + API traffic; requires bounding ZIP export / PDF buffers |
| Disk & Inodes | **50 GB NVMe**, **600,000 inodes** | `.output/` is only 303 files / 16.08 MB; `hbuilds` old versions must stay pruned |
| MySQL / MariaDB Limits | Up to **150 databases × 3 GB max/DB**, **75 concurrent connections/user** (500 global), **`max_allowed_packet`: 16 MB**, phpMyAdmin **max import: 200 MB** | Must chunk any binary DB inserts well under 16 MB; avoid huge single-file phpMyAdmin SQL imports |
| SSH Access | Supported (`hPanel -> Advanced -> SSH Access`), sandboxed to `/home/u256504187/...` | Enables SSH `mysqldump`/restore and inspecting `hbuilds/config/.env` without root |
| Node.js Layout | `/home/{user}/domains/{domain}/hbuilds/{source,last-source,config/.env,versions/{id}/{nodejs,public_html},current}` + `public_html` synced on deploy | Redeploys rotate `versions/{id}`; arbitrary local app folders risk drift or loss |
| Automated Backups | Daily (**~7 days** retention) + Weekly (**~6 weeks** retention), covering **`public_html` files + MySQL/MariaDB databases** | Files saved cleanly outside `public_html` for web privacy are **not guaranteed** in standard restore points |
| Cron Jobs | Executed in **UTC**, **30-minute** max execution timeout, strict **255-character command limit** | No persistent background daemons; CLI must convert UTC->IST and stay under 255 chars |

---

## 2. Step 2 — Payment-Receipt Storage Comparison (Option A vs Option B)

### 2.1 Option A (Private Sibling Filesystem) vs Option B (MariaDB Chunked `LONGBLOB`)

| Evaluation Axis | Option A (`local-fs` outside `public_html`/`hbuilds`) | Option B (`mariadb-blob` in `crm_payment_proof_blobs`) |
| :--- | :--- | :--- |
| Web Privacy | Safe if pointed outside `public_html` and `hbuilds` | **100% web-private by design** (no filesystem path inside web/build tree; zero static exposure risk) |
| Hostinger Redeploy Safety | Requires verified symlink/path outside versioned `hbuilds/versions/*` | **Immune to Nitro `hbuilds` deploy rotation & rollbacks** |
| Automated Hostinger Backup Alignment | **Risky mismatch:** Hostinger docs scope automated website restore points to `public_html` + MySQL DBs; sibling proof folders can fall out of sync with DB rows on restore | **100% transactionally aligned:** `crm_payment_proofs` metadata + `crm_payment_proof_blobs` live in the exact same MySQL/MariaDB backup snapshot |
| Packet Size (`16 MB` ceiling) | Not subject to MySQL packet cap | [`MariadbBlobProofStorage`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/mariadbBlobProofStorage.server.ts) chunks uploads into **`<= 1 MiB`** (`MARIADB_PROOF_CHUNK_BYTES = 1_048_576`) rows via [`splitBufferIntoProofChunks`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/mariadbBlobProofStorage.server.ts#L66-L76) (~15x below Hostinger's 16 MB `max_allowed_packet`) |
| Integrity & Tenant Isolation | SHA-256 + magic-byte checks + Owner path checks | Transactional chunk writes with rollback cleanup, full SHA-256 + byte-size + [`sniffProofKind`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/proofValidation.server.ts) verification, `ON DELETE restrict` Owner FK, cross-owner 403 block |
| Single-DB Growth Ceiling | Uses 50 GB disk / 600k inode pool | Shares single **3 GB (`3072 MB`) DB limit**; large backups exceed phpMyAdmin's 200 MB UI import cap (require compressed SSH `mysqldump` or hPanel restore) |
| Production Fail-Closed Guard | Blocked without `PROOF_STORAGE_ROOT` + confirmation | Remains **fail-closed** (`blocked_durability_unverified` / `storage_not_configured`) in [`env.server.ts`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/config/env.server.ts) until both DB config and `PROOF_PRODUCTION_DURABLE_CONFIRMED="true"` are explicitly set |

### 2.2 Local `mariadb-blob` Prototype Files Implemented

- [conventions.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/db/conventions.server.ts): Added `longBlob(name)` custom Drizzle column type mapping to MySQL `longblob`.
- [schema.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/db/schema.server.ts) & [0015_b11c_business_mariadb_blob.sql](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/db/migrations/0015_b11c_business_mariadb_blob.sql): Added table `crm_payment_proof_blobs` (bringing total CRM schema to **48 Drizzle tables**) with `uq_crm_proof_blobs_key_chunk` (`(storage_key, chunk_index)`) and `idx_crm_proof_blobs_owner_key`.
- [mariadbBlobProofStorage.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/mariadbBlobProofStorage.server.ts): Full [`ProofStorageBackend`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/proofStorage.server.ts) implementation (`stagePrivateUpload`, `promoteStagedProof`, `verifyPrivateObject`, `headPrivateObject`, `getPrivateObject`, `deletePrivateObject`, `listOrphanKeys`, `getHealthSummary`).
- [env.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/config/env.server.ts): Added `"mariadb-blob"` to `PROOF_STORAGE_DRIVER` plus optional `PROOF_DB_MAX_BLOB_BYTES` (`1024`–`10485760`), skipping filesystem path checks while still requiring `PROOF_PRODUCTION_DURABLE_CONFIRMED="true"` in `NODE_ENV=production`.
- [health.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/health/health.server.ts) & [proofStorage.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/proofStorage.server.ts) & [crmRoutes.server.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/http/crmRoutes.server.ts): Wired `db: auth.db` across all 6 proof storage factory calls and reported `isolationSafe: true` for `mariadb-blob` without requiring a local folder.

### 2.3 `3 GB` (`3072 MB`) Receipt Storage Capacity Math

Assuming ~200 MB headroom reserved for the 47 structured CRM tables and InnoDB indexes (~2,872 MB practical storage before InnoDB page slack):

| Typical Uploaded Receipt Size | Chunks (`<= 1 MiB`) / Receipt | Approx. Receipt Capacity Before 3 GB Cap | Practical Runway (Owner Solo Usage) |
| :--- | :--- | :--- | :--- |
| **200 KB** compressed UPI / bank screenshot | 1 | **~11,000–14,000** receipts | **~5–10+ years** at 100–200 deals/month |
| **1 MB** scanned PDF / high-res photo | 1–2 | **~2,400–2,800** receipts | **~1–2 years** at 100–200 deals/month |
| **5 MB** heavy multi-page PDF | 5 | **~500–570** receipts | Months only — compress PDFs or archive older proofs |

---

## 3. Step 3 — Short Node.js Cron Evaluation & Build Discovery

### 3.1 Key Build Discovery: Nitro Strips `mysql2` from `.output/server/node_modules`

Running `npm run build` (`vite` 8.1.5 + Nitro `node-server` preset) bundles app dependencies into `.output/server/_libs/drizzle-orm+[...].mjs` and leaves only `tslib` inside `.output/server/node_modules`. A standalone plain `.mjs` cron script copied into `.output/server/` importing `mysql2/promise` would crash on Hostinger with `ERR_MODULE_NOT_FOUND`.

**Implemented Fix:** Updated [`scripts/build-prod.mjs`](file:///C:/Users/Faizan/Downloads/CRM%202.0/scripts/build-prod.mjs) to compile [`scripts/run-automation-cron.mjs`](file:///C:/Users/Faizan/Downloads/CRM%202.0/scripts/run-automation-cron.mjs) with `rolldown` (`platform: "node"`, `external: /^node:/`, `format: "esm"`) into self-contained **`.output/server/run-cron.mjs` (`1,069.55 KB`)**, verified directly after build with `--help` and `--print-command`.

### 3.2 Hostinger 255-Character Cron Command Constraint

Hostinger enforces a strict **255-character command limit** (`HOSTINGER_CRON_MAX_COMMAND_CHARS = 255`):

- **Naive absolute path (251 chars — breaks immediately when adding any flag like `--owner=...`):**
  ```text
  /opt/alt/alt-nodejs22/root/bin/node --env-file=/home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/config/.env /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs/server/run-cron.mjs --dry-run
  ```
- **Compact `cd` form (183 chars — fits cleanly under 255 with 72 chars remaining):**
  ```sh
  cd /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds && /opt/alt/alt-nodejs22/root/bin/node --env-file=config/.env current/nodejs/server/run-cron.mjs --dry-run
  ```

### 3.3 Implemented Cron Engine & Safety Guardrails

[`src/server/crm/automationCron.server.ts`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/crm/automationCron.server.ts) + [`scripts/run-automation-cron.mjs`](file:///C:/Users/Faizan/Downloads/CRM%202.0/scripts/run-automation-cron.mjs) implement:

1. **Short-Lived Execution (Zero Daemon):** Exits cleanly in milliseconds/seconds with explicit `pool.end()` teardown; bounded internal budget `HOSTINGER_CRON_DEFAULT_BUDGET_MS = 240_000` (4 min, safely under Hostinger's `HOSTINGER_CRON_MAX_TIMEOUT_MINUTES = 30` limit).
2. **UTC -> IST Translation:** Hostinger cron fires in UTC; [`computeCronWindowContext`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/crm/automationCron.server.ts#L50-L75) computes exact UTC and `Asia/Kolkata` (`+05:30`) date/time strings and deterministic schedule buckets across UTC midnight boundaries.
3. **Overlap Lock:** Acquires non-blocking MySQL `SELECT GET_LOCK(..., 0)` before work and releases cleanly in `finally`. Overlapping ticks skip safely instead of piling up connections.
4. **Zero Duplicate Follow-ups / Reminders Across Crash & Restart:** Deterministic [`buildDeterministicCronEventId`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/crm/automationCron.server.ts#L224-L234) keys (`cron_<trigger>_<ruleId>_v<version>_<targetId>_<istBucket>`) combine with B10C-QA's `executionKey` replay cache, `crm_follow_ups` lock & `opId` dedupe, and `crm_internal_reminders` `reminderKey` dedupe.
5. **Fail-Closed Outbound & Production Lockout:**
   - Only `CRON_SCHEDULED_TRIGGERS = ["followup_overdue", "inactivity"]` and `CRON_INTERNAL_SAFE_ACTIONS = ["followup", "reminder", "flag", "owner_review", "activity"]` are allowed (`"notify"` and external WhatsApp/email/SMS/calls are hard-blocked).
   - Standalone CLI defaults strictly to `--dry-run` (read-only) and exits `1` (`disposable_only_block`) on any attempt to pass `--execute-disposable`.
   - `runAutomationCronTick` rejects non-dry-run execution whenever `allowExecution` is false, `NODE_ENV === "production"`, or [`verifyDisposableAutomationTestDatabaseConfig`](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/config/env.server.ts) rejects the DB target.

---

## 4. Step 4 — Module-by-Module Capacity & Footprint Analysis (Hostinger Business)

Measured local production build (`npm run build`): **303 files**, **16.08 MB** total (`.output/public`: **135 files / 5.18 MB**; `.output/server`: **167 files / 10.9 MB**, including bundled **1,069.55 KB** `run-cron.mjs`).

| CRM V2 Module / Subsystem | Expected Fit on Business Plan (3 GB RAM / 2 CPU / 3 GB DB) | Main Constraint / Watchpoint |
| :--- | :--- | :--- |
| **Auth, RBAC & Sessions** | High headroom | Keep MariaDB pool modest (`<= 10` connections/process) inside 75-connection user limit |
| **Leads, Pipeline, Calls & Manual WhatsApp Logs** | High headroom (~50k+ rows well under 150 MB) | Manual click-to-chat WhatsApp has zero server queue cost |
| **Follow-ups & Internal Reminders** | High headroom with short cron | No persistent worker; relies on 15-min hPanel UTC cron |
| **Finance, Deals, Payments & `mariadb-blob` Proofs** | Good for Owner solo volume (see capacity table above) | 3 GB DB cap + ~1 MiB chunking keeps memory flat vs `16 MB` packet cap |
| **Quotations & PDF Preview** | Good | Browser-heavy PDF preview (`pdfjs-dist` on client); low server RAM |
| **Projects, Tasks & Overview Drafts** | High headroom | Standard indexed InnoDB CRUD |
| **Analytics, Goals & Owner Performance** | Good | Server aggregations use bounded SQL queries over indexed tables |
| **Smart Inbox, Duplicate Review & Relationships** | Good | Pairwise/phone indexing stays lightweight for tens of thousands of leads |
| **Data Vault (JSON/ZIP Export & Restore)** | Moderate — watch RAM during large proof ZIP exports | Streaming/bounded chunk reads needed so 100s of MB of BLOBs don't spike 3 GB RAM |
| **Custom Fields, Tags & Saved Views** | High headroom | Compact JSON/normalized tables |
| **AI Sales Copilot & Project Assist** | Good (no heavy local inference) | Uses external API calls or Demo provider; zero local ML RAM overhead |
| **Automation Studio & Internal Rules** | Good in Pilot/Internal scope | Unattended external messaging stays disabled; high-volume event bursts not targeted |

---

## 5. Step 5 & 6 — Verified Local Evidence vs Hostinger Facts vs Untested Assumptions

### 5.1 Local Verification Run Summary (All Checks Run After Final Code Edit)

| Check / Command | Exact Scope & Result | Notes |
| :--- | :--- | :--- |
| `npm run typecheck` (`tsc --noEmit`) | **Passed** (`exit 0`) | Covers entire TypeScript codebase |
| `npm run db:check` (`drizzle-kit check`) | **Passed** (`exit 0`, `"Everything's fine"`) | Verifies all 48 tables through migration `0015_b11c_business_mariadb_blob.sql` |
| Targeted `npx eslint` | **Passed** (`exit 0`, 0 errors, 0 warnings) on 9 B11C-BUSINESS files (`conventions.server.ts`, `env.server.ts`, `health.server.ts`, `mariadbBlobProofStorage.server.ts`, `proofStorage.server.ts`, `automationCron.server.ts`, `scripts/run-automation-cron.mjs`, `scripts/build-prod.mjs`, `b11c-business-hosting.test.ts`) | `schema.server.ts` and `crmRoutes.server.ts` were modified only locally around new symbols and contain pre-existing repo lint/formatting issues outside this check |
| `npm run build` (`vite` 8.1.5 + Nitro + `rolldown`) | **Passed** (`exit 0`) | Produced **303 files / 16.08 MB**, including bundled `.output/server/run-cron.mjs` (**1,069.55 KB**) |
| Built cron CLI verification | **Passed** (`exit 0`) for `node .output/server/run-cron.mjs --help` and `--print-command` | Confirmed self-contained ESM execution without `node_modules/mysql2` and exact **183-char** command string |
| Full `npm test` (`vitest run`) | **137 test files passed (137), 1,397 tests passed (1,397)** in `49.23s` (0 failed, 0 skipped) | Includes 12 new unit/contract tests in [b11c-business-hosting.test.ts](file:///C:/Users/Faizan/Downloads/CRM%202.0/src/server/b11c-business-hosting.test.ts) using mocked DB/storage harnesses; **did NOT connect to live MariaDB or Hostinger `srv469.hstgr.io`** |

### 5.2 Explicit Untested Hostinger Business Staging Assumptions

Do **not** treat local Vitest passes as live shared-hosting proof until verified with synthetic data on `khaki-butterfly-345144.hostingersite.com`:

1. Live Nitro SSR + Drizzle ORM RSS memory usage, cold-start time, and worker recycle stability inside Hostinger's 3 GB RAM / 2 CPU container.
2. Live shared MySQL (`srv469.hstgr.io:3306`) latency, actual `max_allowed_packet` (`SHOW VARIABLES LIKE 'max_allowed_packet'`), connection-limit tolerance across Nitro + cron, and support for session-level `GET_LOCK()`.
3. Actual Hostinger `hbuilds` deployment symlink/env-file persistence (`config/.env`) and Node.js 22 runtime environment variable propagation on `khaki-butterfly-345144.hostingersite.com`.
4. Live Hostinger Automated Backup & Restore verification: proving uploaded `crm_payment_proof_blobs` survive redeploy **and** survive a MySQL database restore test intact (checksum-verified).
5. Live Hostinger hPanel Cron Jobs execution of `.output/server/run-cron.mjs --dry-run` using `cd ... && /opt/alt/alt-nodejs22/root/bin/node --env-file=config/.env ...`.

---

## 6. Step 7 — Options & Recommended Decision Path

### Option A — Launch CRM V2 on Existing Business Plan (`hostinger_business_v3`) *(Recommended — Conditional on Live Staging Gate)*
- **What changes in prod config (only after synthetic staging passes):** Dedicated new staging/prod database (separate from CRM V1), `PROOF_STORAGE_DRIVER="mariadb-blob"`, `PROOF_PRODUCTION_DURABLE_CONFIRMED="true"` (only post-verification), short read-only/internal-safe Node.js cron, manual WhatsApp click-to-chat only.
- **Extra Hosting Cost:** **₹0/month** (uses one of your `2` remaining Node.js slots on existing ₹699/mo plan).
- **Tradeoff:** Capped at ~3 GB per DB (~2,800 × 1 MB receipts or ~11k+ × 200 KB compressed screenshots), requiring occasional compression or cold archiving as years pass.

### Option B — Hybrid (Business Web Hosting App + External Cron/Worker)
- Use only if `khaki-butterfly-345144.hostingersite.com` runs web/DB cleanly but Hostinger shared cron throttles `run-cron.mjs` execution or Nitro hits RAM pressure alongside cron bursts.

### Option C — Move Directly to Dedicated Hostinger VPS (`B11C-PRE` scripts already prepared)
- Choose now **only if** you prefer local encrypted SSD filesystem receipts (`>3 GB/year` PDF volume), need persistent background daemons/queues, plan multi-member team concurrency right away, or hit failures during the live Business staging gate.

### Approved Next Step (When You Are Ready)
Say the word if you want to run the **read-safe synthetic staging test on `khaki-butterfly-345144.hostingersite.com`**:
1. Create a fresh synthetic staging MySQL DB on Hostinger (zero CRM V1 data), push migrations `0001`–`0015`, configure staging `.env` on `khaki-butterfly-345144.hostingersite.com` (`PROOF_STORAGE_DRIVER="mariadb-blob"`).
2. Test `mariadb-blob` upload/download/SHA-256 verification across a full **Hostinger redeploy + DB restore drill**.
3. Register one non-mutating `--dry-run` hPanel cron job and verify UTC->IST output + `GET_LOCK` + exit code `0`.
