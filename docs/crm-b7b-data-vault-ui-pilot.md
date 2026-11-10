# Checkpoint B7B — Safe Data Vault UI, Backup Inspection & Restore Preview

**Target Application:** Scale Flow Sales OS 3.0 (CRM V2)  
**Branch:** `feat/b7b-data-vault-ui-pilot`  
**Base Commit:** [`6d8fa70`](file:///c:/Users/Faizan/Downloads/CRM%202.0) (`feat(crm-b7a-qa): verify real zip archive bytes, live mariadb restoration and strict money conversion`)  
**Safety Status:** Isolated development Pilot (`/data-vault?pilot=1`). Zero remote pushes, zero merges into `main`, zero Hostinger production mutations. Real browser storage (`scale-flow-crm-2-demo`) and IndexedDB payment proofs (`scale-flow-payment-proofs`) remain byte-for-byte untouched.  
**Critical Safety Constraint:** Direct database restore execution is **permanently disabled in the UI**; any restore attempt is rejected both client-side and server-side with `HTTP 403 Forbidden` (`RESTORE_EXECUTION_DISABLED`).

---

## 1. Executive Summary & Objective

Checkpoint B7B delivers a secure, accessible, mobile-responsive **Data Vault development Pilot** for Scale Flow Sales OS 3.0. The Data Vault allows authenticated Owners to:

1. **Inspect Backup Coverage & Inventory Readiness:** Gain complete visibility into all 30 persisted CRM entities, distinguishing between the 9 verified MariaDB 11.4 tables, 16 schema/manifest-supported entities, and 5 unsupported browser-local collections.
2. **Build & Download Synthetic Backups:** Generate scope-filtered (Full, Sales-only, Projects-only) genuine compressed ZIP archives containing canonical sorted JSON files, SHA-256 manifests, binary proof attachments (PDF, PNG), and offline HTML summaries.
3. **Inspect Uploaded Backup Archives:** Cryptographically validate archive structure, detect directory traversal (`../`) vulnerabilities, verify manifest and attachment SHA-256 hashes against actual uncompressed bytes, and reconcile financial ledgers.
4. **Preview Non-Destructive Restore Dry-Runs:** Simulate a full restoration against live MariaDB with **zero database writes**, accurately calculating records to create, idempotent skips for existing IDs, foreign key dependencies, and ledger balances.
5. **Review Production Blockers & Architecture Warnings:** Transparently display critical readiness blockers—including unverified Hostinger private file durability, lack of backup archive encryption, and unmigrated browser collections—preventing false confidence before production readiness.

---

## 2. Persisted Data Source Inventory (30 Entities Across 3 Tiers)

The Data Vault inventory strictly catalogues all 30 persisted data entities across CRM V2:

| #   | Entity / Data Source        | Category       | Table Name                                    | Status in B7B | Live MariaDB Verification | Primary ID |
| --- | --------------------------- | -------------- | --------------------------------------------- | ------------- | ------------------------- | ---------- |
| 1   | **Leads**                   | Sales          | `crm_leads`                                   | Verified      | MariaDB 11.4 Live         | `lead_*`   |
| 2   | **Activities**              | Sales          | `crm_lead_activities`                         | Supported     | Schema & Manifest         | `act_*`    |
| 3   | **Follow-ups**              | Sales          | `crm_follow_ups`                              | Supported     | Schema & Manifest         | `flw_*`    |
| 4   | **Call Logs**               | Sales          | `crm_call_logs`                               | Supported     | Schema & Manifest         | `call_*`   |
| 5   | **WhatsApp Logs**           | Sales          | `crm_whats_app_logs`                          | Supported     | Schema & Manifest         | `wa_*`     |
| 6   | **Deals**                   | Sales          | `crm_deals`                                   | Verified      | MariaDB 11.4 Live         | `deal_*`   |
| 7   | **Deal Milestones**         | Sales          | `crm_deal_milestones`                         | Supported     | Schema & Manifest         | `dml_*`    |
| 8   | **Payments**                | Finance        | `crm_payments`                                | Verified      | MariaDB 11.4 Live         | `pay_*`    |
| 9   | **Finance Events**          | Finance        | `crm_finance_events`                          | Supported     | Schema & Manifest         | `fevt_*`   |
| 10  | **Payment Proof Meta**      | Finance        | `crm_payment_proofs`                          | Verified      | MariaDB 11.4 Live         | `prf_*`    |
| 11  | **Payment Proof Binaries**  | Finance        | Local Filesystem / IDB                        | Supported     | Binary Archive & SHA-256  | `proof_*`  |
| 12  | **Quotation Templates**     | Quotations     | `crm_quotation_templates`                     | Supported     | Schema & Manifest         | `qt_*`     |
| 13  | **Quotations & Items**      | Quotations     | `crm_quotations` / `crm_quotation_items`      | Verified      | MariaDB 11.4 Live         | `quot_*`   |
| 14  | **Quotation Revisions**     | Quotations     | `crm_quotation_revisions`                     | Supported     | Schema & Manifest         | `qrev_*`   |
| 15  | **Projects**                | Projects       | `crm_projects`                                | Verified      | MariaDB 11.4 Live         | `proj_*`   |
| 16  | **Project Tasks**           | Projects       | `crm_project_tasks`                           | Verified      | MariaDB 11.4 Live         | `ptsk_*`   |
| 17  | **Project Milestones**      | Projects       | `crm_project_milestones`                      | Supported     | Schema & Manifest         | `pmil_*`   |
| 18  | **Project Deliverables**    | Projects       | `crm_project_deliverables`                    | Supported     | Schema & Manifest         | `pdel_*`   |
| 19  | **Support Tickets**         | Projects       | `crm_client_support_tickets`                  | Supported     | Schema & Manifest         | `cst_*`    |
| 20  | **Owner Settings**          | Configuration  | `crm_owner_settings`                          | Verified      | MariaDB 11.4 Live         | `set_*`    |
| 21  | **Settings Audit Events**   | Configuration  | `crm_settings_audit_events`                   | Supported     | Schema & Manifest         | `sae_*`    |
| 22  | **Sales Goals**             | Configuration  | `crm_sales_goals`                             | Verified      | MariaDB 11.4 Live         | `goal_*`   |
| 23  | **Sales Goal Revisions**    | Configuration  | `crm_sales_goal_revisions`                    | Supported     | Schema & Manifest         | `grev_*`   |
| 24  | **Custom Fields & Values**  | Customization  | `crm_custom_fields` / `crm_lead_field_values` | Supported     | Schema & Manifest         | `cf_*`     |
| 25  | **Tags & Lead Links**       | Customization  | `crm_tag_defs` / `crm_lead_tags`              | Supported     | Schema & Manifest         | `tag_*`    |
| 26  | **Quotation Shares**        | Quotations     | _(None — LocalStorage only)_                  | Unsupported   | Deferred                  | Client ID  |
| 27  | **Sales Studio Demos**      | Collateral     | _(None — LocalStorage only)_                  | Unsupported   | Deferred                  | Client ID  |
| 28  | **WhatsApp Templates**      | Messaging      | _(None — LocalStorage only)_                  | Unsupported   | Deferred                  | Client ID  |
| 29  | **Automation Rules**        | Automation     | _(None — LocalStorage only)_                  | Unsupported   | Deferred                  | Client ID  |
| 30  | **Smart Inbox & Relations** | Communications | _(None — LocalStorage only)_                  | Unsupported   | Deferred                  | Composite  |

---

## 3. Architecture & Security Implementation

### A. Server-Side Data Vault Service ([`src/server/vault/vaultService.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/vault/vaultService.server.ts))

- **`getVaultCoverage(db, userId)`:** Executes live SQL queries against all 9 verified MariaDB tables for the authenticated Owner, returning real row counts alongside the complete 30-item inventory and 4 architecture blockers.
- **`generateSyntheticBackupArchive({ scope })`:** Generates genuine compressed ZIP bytes via `fflate.zipSync`. Builds canonical JSON data files (`data/leads.json`, `data/deals.json`, `data/payments.json`, etc.), binary proof files (`files/payment-proofs/receipt_synth_1.pdf`, `advice_synth_2.png`), an offline `backup-summary.html`, and a cryptographic `manifest.json` with SHA-256 hashes for all packaged files.
- **`inspectUploadedArchive(zipBytes)`:** Invokes the B7A-QA validation engine (`validateBackupArchive`), verifying file paths (rejecting path traversal `../`), matching file hashes against manifest declarations, verifying binary attachment integrity, and performing exact-paise financial reconciliation between deals and payments.
- **`runUploadedArchiveDryRun(db, userId, zipBytes)`:** Simulates restoration without writing a single byte to the database (`databaseWritten: false`, `mutationsPerformed: 0`). Queries existing record IDs for the Owner to partition entities into `toCreate` and `toSkip`, detects conflicts, and validates foreign key linkages.
- **`parseArchiveUpload(request)`:** Robust parser supporting `multipart/form-data` file uploads, JSON base64 payloads, and raw binary streams.

### B. Route Enforcement & Safety Gates ([`src/server/http/crmRoutes.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/http/crmRoutes.server.ts))

- `GET /api/v1/vault/coverage` — Returns coverage summary, 30 inventoried items with live counts, and blockers.
- `POST /api/v1/vault/synthetic-backup` — Generates and streams genuine ZIP archive bytes (`application/zip`) with scope filtering.
- `POST /api/v1/vault/inspect` — Accepts uploaded ZIP bytes and returns cryptographic validation, integrity checks, and ledger balances.
- `POST /api/v1/vault/dry-run` — Accepts uploaded ZIP bytes and executes a zero-mutation restore simulation.
- `POST /api/v1/vault/restore` — **Strictly Blocked:** Returns `HTTP 403 Forbidden` with payload:
  ```json
  {
    "ok": false,
    "error": {
      "code": "RESTORE_EXECUTION_DISABLED",
      "message": "Direct database restore execution is disabled in the UI. Production migrations and disaster recoveries must be performed via authenticated server CLI utilities with pre-restore snapshots."
    }
  }
  ```

### C. Client API & React Query Hooks ([`src/lib/api/vaultApi.b7b.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/lib/api/vaultApi.b7b.ts))

- `fetchVaultCoverage()`, `downloadSyntheticBackup()`, `inspectBackupArchive()`, `runRestoreDryRun()`, `verifyRestoreExecutionDisabled()`.
- Built-in React Query hooks: `useVaultCoverageQuery`, `useInspectArchiveMutation`, `useDryRunMutation`.
- Automated browser blob download handling for generated ZIP files.

### D. Data Vault Pilot UI ([`src/components/pilot/PilotDataVaultPage.tsx`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/components/pilot/PilotDataVaultPage.tsx))

- Built within `PilotShell` with prominent development pilot warnings and zero interference with standard browser routes.
- **5 Accessible Tabs (`#dv-tab-overview`, `#dv-tab-synthetic`, `#dv-tab-inspect`, `#dv-tab-dryrun`, `#dv-tab-blockers`):**
  1. **Overview & Inventory:** 4 top KPI cards (30 Total Inventoried, 9 Verified MariaDB, 16 Supported Schema, 5 Unsupported LocalStorage) plus full 30-item table with status badges and live MariaDB row counts.
  2. **Synthetic Backup Builder:** Scope selector (`full`, `sales`, `projects`), archive contents breakdown, and "Generate & Download Synthetic ZIP" action.
  3. **Archive Inspector & Integrity:** Drag-and-drop file upload (`#inspect-archive-file-input`), cryptographic classification badge (`COMPLETE`, `VALID`, `DAMAGED`), manifest metadata, SHA-256 attachment checks, and financial reconciliation breakdown.
  4. **Restore Dry-Run Preview:** Drag-and-drop file upload (`#dry-run-archive-file-input`), prominent "Zero Mutations Performed" badge, creates/skips/conflicts count breakdown, and "Test Restore Prevention (Verify 403)" button triggering confirmation dialog and demonstrating server 403 enforcement.
  5. **Blockers & Production Readiness:** 4 detailed cards detailing Hostinger private proof durability, backup encryption, 5 unmigrated collections, and UI restore prevention.

---

## 4. Production Readiness & Architecture Blockers Matrix

The Data Vault UI explicitly displays 4 critical blockers before CRM V2 can be considered production-ready for customer data:

1. **Hostinger Private Proof Storage Durability (CRITICAL — UNVERIFIED):**
   - Proof files are stored in `.data/private-proofs/` on the local Node.js server.
   - Hostinger shared/containerized hosting environments may reset ephemeral local storage on container redeploys or restarts.
   - _Requirement:_ S3-compatible private object storage or verified persistent volume mounts must be configured and tested before real customer payment receipts are stored.
2. **Backup Archive Encryption (WARNING — NOT CONFIGURED):**
   - Current generated archives are standard unencrypted ZIP files (`fflate`).
   - Customer financial records, lead contacts, and bank proofs must be protected with authenticated envelope encryption (AES-256-GCM) with owner-managed passphrase or KMS before offsite export.
3. **5 Unsupported Collections Lacking MariaDB Tables (WARNING — INCOMPLETE):**
   - Quotation Shares, Sales Studio Demos, WhatsApp Templates, Automation Rules, and Smart Inbox Relations still live solely in browser `localStorage`.
   - Restoring a backup into MariaDB will not recover these entities until dedicated backend schemas and endpoints are provisioned.
4. **UI Restore Execution Disabled by Design (INFO — ENFORCED):**
   - Web UI cannot execute destructive or mutating database restores.
   - Restores must be executed via authenticated CLI commands with automated pre-restore snapshots and rollback capability.

---

## 5. Chrome DevTools Protocol (CDP) Real Browser E2E Verification

Verification was executed against live MariaDB 11.4 (port `13306`) and the compiled Nitro server (port `3002`) using an external Chrome process over DevTools Protocol (`scratch/run-b7b-real-chrome-e2e.mjs`).

### Real Browser Scenarios Executed & Passed:

1. **Pilot Authentication & Session Cookie Acceptance:** Owner logged in at `http://127.0.0.1:3002/login` and navigated to `/data-vault?pilot=1`.
2. **Overview & Inventory Verification:** Asserted KPI cards rendered `30` total entities, `9` verified, `16` supported, and `5` unsupported; confirmed 30-item table rendered with live MariaDB counts.
3. **Synthetic ZIP Backup Generation & Download:** Triggered synthetic backup generation, verified server response status 200, validated downloaded ZIP bytes (`pk` magic header), and inspected uncompressed contents.
4. **Archive Inspection & Valid Manifest Assertion:** Uploaded synthetic ZIP via Chrome CDP `DOM.setFileInputFiles`; verified UI updated with `COMPLETE` badge, `2` valid binary attachments, and matched financial ledger.
5. **Damaged Archive & Tampering Rejection:** Created corrupted ZIP with checksum mismatch; verified UI displayed `DAMAGED` badge with explicit error message (`Checksum mismatch for data/leads.json`).
6. **Non-Destructive Dry-Run Simulation:** Uploaded valid ZIP to dry-run tab; verified UI displayed "Zero Mutations Performed — Simulation Complete" badge with 7 records to create.
7. **Direct SQL Database Zero-Mutations Assertion:** Queried MariaDB directly via `mysql2/promise` before and after dry-run; asserted row counts remained completely unchanged (`leads=1`, `deals=0`, `payments=0`).
8. **UI Restore Prevention (HTTP 403 Enforcement):** Clicked "Test Restore Prevention (Verify 403)" button, confirmed modal warning dialog, clicked "Attempt Restore", and asserted UI caught and displayed the `HTTP 403 Forbidden` (`RESTORE_EXECUTION_DISABLED`) error banner.
9. **Blockers & Production Matrix Audit:** Switched to Blockers tab; verified all 4 architecture blockers rendered with exact titles and severity badges.
10. **Browser LocalStorage & IndexedDB Isolation:** Asserted that `window.localStorage.getItem("scale-flow-crm-2-demo")` retained its pre-existing records (`local_lead_b7b_1`) without any pilot data leakage.
11. **Owner Isolation:** Logged in as Owner Beta; asserted zero row counts for Owner Beta in MariaDB, confirming strict multi-tenant isolation.
12. **Mobile Viewport 390px Responsive Layout:** Set viewport to 390x844 (iPhone 14); confirmed zero horizontal overflow (`scrollWidth === 390`), fully readable inventory cards, and responsive tab layout.

### Captured Screenshot Inventory:

All 8 full-page screenshots were verified and saved to `C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/`:

- [`b7b_01_vault_overview_desktop.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_01_vault_overview_desktop.png) (224.3 KB) — Overview KPI cards and 30-item inventory table at 1440px desktop.
- [`b7b_02_synthetic_builder.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_02_synthetic_builder.png) (267.2 KB) — Synthetic Backup builder with scope selector and archive manifest preview.
- [`b7b_03_archive_inspected.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_03_archive_inspected.png) (201.8 KB) — Cryptographic validator showing COMPLETE classification, manifest details, and attachments.
- [`b7b_04_damaged_archive_rejected.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_04_damaged_archive_rejected.png) (196.0 KB) — DAMAGED classification badge and error banner on corrupted archive upload.
- [`b7b_05_dry_run_preview.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_05_dry_run_preview.png) (209.7 KB) — Dry-run simulation results showing "Zero Mutations Performed" badge and creates/skips breakdown.
- [`b7b_06_restore_prevention_modal.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_06_restore_prevention_modal.png) (215.8 KB) — Security dialog and HTTP 403 Forbidden enforcement verification.
- [`b7b_07_blockers_matrix.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_07_blockers_matrix.png) (223.8 KB) — Production readiness and architecture blockers matrix.
- [`b7b_08_mobile_390px.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b/b7b_08_mobile_390px.png) (201.5 KB) — Responsive 390px mobile view with zero overflow and readable cards.

---

## 6. Automated Vitest Test Suite Results

- **Total Test Files Passing:** 121 / 121 (100%)
- **Total Individual Tests Passing:** 1,139 / 1,139 (100%)
- **New Tests Added in B7B & B7B-QA:** 32 tests across 4 test files:
  - [`src/server/b7b-vault-api.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7b-vault-api.test.ts) (14 tests):
    1. Reports exactly 30 inventoried entities with 9 verified in MariaDB and 5 unsupported.
    2. Reports all 4 critical architecture blockers.
    3. Generates valid ZIP archive bytes for full backup scope.
    4. Generates scope-filtered archive omitting non-sales entities.
    5. Validates uploaded archive structure and checks cryptographic hashes.
    6. Rejects corrupted archive with checksum mismatch.
    7. Rejects zip-slip attempt with directory traversal `../`.
    8. Simulates full restore with zero database writes and reports creates & skips.
    9. Detects existing IDs and marks them to skip without conflicting.
    10. Rejects direct restore endpoint with HTTP 403 Forbidden.
    11. Rejects unauthenticated requests with HTTP 401 Unauthorized.
    12. Accurately reports omitted entities in synthetic manifest.
    13. Validates financial summary exact-paise reconciliation.
    14. Handles scope-based filtering without leaking omitted records.
  - [`src/test/data-vault-pilot.b7b.test.tsx`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/test/data-vault-pilot.b7b.test.tsx) (6 tests):
    1. Renders Data Vault pilot layout, dev banner, and 4 KPI summary cards.
    2. Displays full 30-item inventory data table with status badges and live counts.
    3. Switches to Synthetic Test Backup tab and allows selecting scopes with truthful labels.
    4. Switches to Archive Inspector tab and validates dropped archive files.
    5. Displays dry-run simulation with Zero Mutations Performed badge.
    6. Displays permanent safety card stating restore execution is disabled in the pilot.
  - [`src/server/b7b-qa-zip-security.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7b-qa-zip-security.test.ts) (11 tests):
    1. Validates clean synthetic archive with 3-tier classification.
    2. Detects tampered data JSON and classifies as file_mismatch.
    3. Detects tampered binary attachment and reports hash discrepancy.
    4. Rejects archive missing manifest.json with damaged status.
    5. Rejects archive containing duplicate zip entries with damaged status.
    6. Rejects unsupported schema/format version with unsupported_format status.
    7. Rejects directory traversal paths (`../`) with damaged status.
    8. Enforces archive file limits and size restrictions.
    9. Reports missing attachments when metadata references unbundled files.
    10. Detects financial discrepancy between booked deals and ledger payments.
    11. Confirms unencrypted ZIP status and warns about encryption requirement.
  - [`src/server/b7b-qa-security-zero-writes.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7b-qa-security-zero-writes.test.ts) (4 tests):
    1. Enforces multi-tenant isolation: Owner A queries do not expose Owner B rows.
    2. Proves inspection and dry-run perform zero database mutations across all tables.
    3. Enforces server pilot gate: rejects `/api/v1/vault/*` when `DEV_LEAD_PILOT` is false or `NODE_ENV` is production.
    4. Enforces HTTP 403 Forbidden on direct database restore endpoint in all environments.

---

## 7. Quality Gates Summary

| Quality Gate              | Command                                       | Result                          | Notes                                 |
| ------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------- |
| Database Schema Drift     | `npm run db:check`                            | PASSED (0 drift)                | `Everything's fine 🐶🔥`              |
| TypeScript Compiler       | `npm run typecheck`                           | PASSED (0 errors)               | `tsc --noEmit` clean                  |
| ESLint (B7B/B7B-QA Files) | `npx eslint ...`                              | PASSED (0 errors, 0 warnings)   | All new & modified files lint-clean   |
| Prettier Formatting       | `npx prettier --check ...`                    | PASSED (0 issues)               | Strict standard code style enforced   |
| Vitest Test Suite         | `npm test`                                    | PASSED (121 files, 1,139 tests) | 100% pass across all test suites      |
| Production Build          | `npm run build`                               | PASSED (793ms)                  | Client & Nitro server compile cleanly |
| Chrome CDP E2E (B6B)      | `node scratch/run-b6b-real-chrome-e2e.mjs`    | PASSED (11/11 scenarios)        | 7 screenshots captured                |
| Chrome CDP E2E (B7B-QA)   | `node scratch/run-b7b-qa-real-chrome-e2e.mjs` | PASSED (14/14 scenarios)        | 8 screenshots captured                |

---

## 8. Checkpoint B7B-QA Verification & Hardening Results

### A. Four Specific Gaps Closed

1. **Archive Completeness Classification:**
   - Replaced single, misleading `COMPLETE` badge with separated 3-dimensional classifications:
     - **Archive Integrity:** `verified`, `damaged`, `unsupported_format`, `file_mismatch`.
     - **CRM Data Coverage:** `synthetic_test_data`, `partial_coverage`, `missing_entities`, `complete_coverage`.
     - **Restore Readiness:** `preview_available`, `partially_verified`, `not_production_ready`, `fully_verified`.
   - Displays truthful composite label: `"Integrity Verified — Synthetic Backup, Partial CRM Coverage"`. Valid synthetic archives can never be marked `complete_coverage` or `fully_verified`.
2. **Truthful Backup Scope Language:**
   - Renamed scopes to:
     - `full`: **"All Supported Synthetic Test Data"**
     - `sales`: **"Sales Synthetic Test Data"**
     - `projects`: **"Projects Synthetic Test Data"**
   - Displays explicit 2-column breakdown of Included Fixtures vs 21 Excluded Datasets.
3. **Comprehensive Inventory & Live Coverage Matrix:**
   - Audited all 30 entities with 5 boolean attributes: `hasSchema`, `includedInExporter`, `hasBinaryCoverage`, `hasRestoreMapping`, `verifiedByLiveRestore`.
   - Live MariaDB row counts executed per authenticated Owner (`crm_leads` verified with live count `1`).
4. **UI Restore Safety Hardening:**
   - Completely removed misleading "Test Restore Prevention (Verify 403)" button and confirmation dialog.
   - Replaced with permanent Safety Enforcement Card: `"Restore execution is disabled in this development Pilot."`
   - Server endpoint `POST /api/v1/vault/restore` continues returning HTTP 403 Forbidden (`RESTORE_EXECUTION_DISABLED`).

### B. Certified Screenshot Inventory

#### B6B Acceptance Suite Screenshots (`scratch/screenshots/b6b/`):

1. [`b6b_01_login_success.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_01_login_success.png) (189.2 KB) — Real login form submission and session establishment.
2. [`b6b_02_settings_pilot_desktop.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_02_settings_pilot_desktop.png) (198.1 KB) — Settings pilot desktop view with Business Profile.
3. [`b6b_03_settings_saved.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_03_settings_saved.png) (196.3 KB) — Business name saved to MariaDB with live confirmation.
4. [`b6b_04_settings_reloaded.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_04_settings_reloaded.png) (195.7 KB) — Persistence verified after page reload from database.
5. [`b6b_05_goal_created.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_05_goal_created.png) (183.2 KB) — New sales goal created and persisted in MariaDB.
6. [`b6b_06_goal_history_drawer.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_06_goal_history_drawer.png) (180.5 KB) — Goal revision history drawer showing immutable audit log.
7. [`b6b_07_mobile_390px.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b6b/b6b_07_mobile_390px.png) (175.0 KB) — Mobile 390px responsive layout with zero overflow.

#### B7B-QA Acceptance Suite Screenshots (`scratch/screenshots/b7b_qa/`):

1. [`b7b_qa_01_vault_overview_desktop.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_01_vault_overview_desktop.png) (204.3 KB) — Overview KPI cards and 30-item inventory table with 5 audit columns and live DB count at 1440px desktop.
2. [`b7b_qa_02_synthetic_builder.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_02_synthetic_builder.png) (269.8 KB) — Synthetic Backup builder showing truthful scopes and 21 excluded datasets breakdown.
3. [`b7b_qa_03_archive_inspected.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_03_archive_inspected.png) (208.7 KB) — Cryptographic inspection showing truthful composite status label and 3 sub-badges (verified, synthetic test data, preview available); misleading COMPLETE absent.
4. [`b7b_qa_04_damaged_archive_rejected.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_04_damaged_archive_rejected.png) (199.1 KB) — DAMAGED classification badge and error banner rejecting corrupted archive.
5. [`b7b_qa_05_dry_run_preview.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_05_dry_run_preview.png) (210.4 KB) — Dry-run simulation results showing "Zero Mutations Performed" badge and permanent safety enforcement card.
6. [`b7b_qa_06_blockers_matrix.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_06_blockers_matrix.png) (227.7 KB) — Production readiness and architecture blockers matrix.
7. [`b7b_qa_07_mobile_390px.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_07_mobile_390px.png) (205.6 KB) — Responsive 390px mobile view with zero horizontal overflow.
8. [`b7b_qa_08_mobile_360px.png`](file:///C:/Users/Faizan/.gemini/antigravity/brain/36d9b8a9-80e0-40c3-b748-e219848179d9/scratch/screenshots/b7b_qa/b7b_qa_08_mobile_360px.png) (197.1 KB) — Responsive 360px small mobile view (Android) with zero horizontal overflow.
