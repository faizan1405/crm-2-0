# Scale Flow Sales OS 3.0 — Checkpoint B13: Existing Data Migration & Staging Shadow Testing

**Status:** Local B13 Development & Synthetic Shadow Verification **COMPLETE** — Real Data Migration & Remote Database Execution **LOCKED / PENDING EXPLICIT OWNER APPROVAL**  
**Branch:** `feat/b13-data-migration` (created from verified HEAD `7539015` preserving all B12D changes)  
**Hosting Posture:** **Hostinger-Exclusive** (MariaDB 11.4 + `mariadb-blob` payment proof storage; **Cloudflare R2 is NOT a launch requirement**)  
**CRM V1 / Real Customer Data / Existing Browser Storage / GitHub `main` / Production Settings:** **UNTOUCHED**

---

## 1. Executive Summary

Checkpoint **B13** delivers the end-to-end **Existing Data Migration Wizard**, **Full CRM Entity Validation & Exact-Paise Financial Reconciliation Engine**, and **Isolated Synthetic Staging Shadow Testing** harness:

1. **Hostinger-Exclusive Target Policy:** Targets Hostinger MariaDB 11.4 (`mariadb-blob` for payment proof binaries) within the verified `3,072 MiB` quota policy (`50%` warning at `1,536 MiB`, `70%` hard stop at `2,150 MiB`, `16 MiB` safety margin). Cloudflare R2 is explicitly marked `cloudflareR2Required: false`.
2. **27 Mapped CRM Entity Groups + 5 Non-Silent Deferred Collections:** Parses both Data Vault `.zip` archives and legacy CRM V1 / Zustand `.json` snapshots, validates foreign keys across Leads (active + archived bin), Activities, Follow-ups (`activeLeadLock` conflict normalization), Call Logs, WhatsApp Logs, Deals, Deal Milestones, Payments, Finance Events, Payment Proofs (magic bytes + SHA-256 + `<= 10 MiB`), Quotation Templates, Quotations, Projects, Project Milestones, Project Tasks, Support Tickets, Custom Fields, Lead Field Values, Tags, Lead-Tag Links, Saved Views, Smart Inbox Items, Lead Relationships, Automation Rules (forced `paused`), Owner Settings, and Sales Goals. Browser-local deferred collections (`notes`, `demos`, `employees`, `teamEvents`, `savedReports`) are reported explicitly as `deferred_not_dropped`.
3. **Exact Integer-Paise Financial Reconciliation:** Uses `parseStrictInrInputToPaise` (zero IEEE-754 float drift), rejects fractional paise (`> 2` decimal places), verifies exact `0`-paise deltas across Deals, Active Payments, Voided Payments, Per-Deal Outstanding Balances, Deal Milestones, Quotations, and Monetary Sales Goals, and enforces mandatory `voidReason` on voided payments.
4. **Migration Wizard UI & Read-Only API:** Added a 4-step `Migration wizard` tab inside `PilotDataVaultPage` (`PilotMigrationWizard.tsx`) backed by Owner-authenticated, CSRF-verified endpoints under `/api/v1/vault/migration/*`. Live execution (`POST /api/v1/vault/migration/execute`) is permanently locked with HTTP `403 MIGRATION_EXECUTION_LOCKED`.
5. **Synthetic Shadow Testing & Fail-Closed CLI:** Built `runSyntheticShadowMigrationTest()` and `scripts/b13-shadow-migration-test.mjs` verifying all 8 shadow assertions (entity validation, 0-paise financial parity, Hostinger storage fit, automation pause safety, follow-up single active lock, credential scrubbing, 2-pass idempotency with 0 duplicate rows, and mid-transaction atomic rollback with 0 residual rows).

---

## 2. Module Architecture

| Layer | File | Purpose |
|---|---|---|
| Migration Types | `src/server/migration/types.server.ts` | Canonical contracts for readiness, analysis, financial reconciliation, Hostinger quota, and shadow tests |
| Safety Guardrails | `src/server/migration/guards.server.ts` | Fail-closed target DB/host guard (`assertSafeShadowTarget`), recursive credential scrubber (`scrubLegacyCredentials`), proof magic-byte sniffing |
| Financial Engine | `src/server/migration/financialReconciliation.server.ts` | Exact integer-paise reconciliation, Indian numbering INR formatter, Hostinger `3,072 MiB` quota projection |
| Migration Engine | `src/server/migration/migrationEngine.server.ts` | Read-only `.zip` / `.json` parser, 27-entity validator/mapper, FK checker, `activeLeadLock` normalizer, forced-`paused` automations |
| Synthetic Dataset | `src/server/migration/syntheticDataset.server.ts` | 100% synthetic CRM V1 / Data Vault ZIP generator with valid PNG/PDF binaries, tricky paise decimals, and fault-injection flags |
| Shadow Test Engine | `src/server/migration/shadowTest.server.ts` | In-memory transactional shadow store verifying Pass-1 insert, Pass-2 idempotency (0 duplicates), and mid-tx atomic rollback (0 residual rows) |
| API Routes | `src/server/http/crmRoutes.server.ts` | `GET /readiness`, `POST /analyze`, `POST /synthetic-shadow-test`, `POST /execute` (`403 MIGRATION_EXECUTION_LOCKED`) |
| Frontend API & Wizard | `src/lib/api/migrationApi.ts`, `src/components/pilot/PilotMigrationWizard.tsx`, `src/components/pilot/PilotDataVaultPage.tsx` | 4-step Migration Wizard UI with Hostinger-exclusive banner, upload/analysis, reconciliation table, quota bar, shadow test runner, and locked cutover gate |
| CLI Runner | `scripts/b13-shadow-migration-test.mjs` | Standalone Node CLI for synthetic shadow verification (exit `2` on `--execute-live`, exit `3` on protected CRM V1 / prod DB names) |

---

## 3. Safety Guardrails & Owner Approval Gate

Before executing any **real staging shadow import** or **production cutover** on Hostinger:

1. **Pre-Cutover Owner Sign-Off Required:** Explicit Owner approval is required to unlock CLI staging execution against a disposable Hostinger MariaDB database (e.g. `u256504187_crm_b13_shadow`).
2. **Untouched Guarantees Maintained in B13:**
   - CRM V1 (`crm.joinscaleflow.in`) — **UNTOUCHED**
   - Real customer data — **UNTOUCHED**
   - Existing browser `localStorage` / `IndexedDB` — **UNTOUCHED**
   - GitHub `main` & production settings — **UNTOUCHED**
   - Remote Hostinger databases — **UNTOUCHED**
   - Cloudflare R2 — **NOT REQUIRED**
