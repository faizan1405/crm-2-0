# Scale Flow CRM V2 — Checkpoint B16A: Production Hardening, System Audit & B16B–B16F Roadmap

**Date:** 2026-11-22 IST  
**Branch:** `feat/b16a-production-hardening-roadmap` (branched from `d0c4cb4`)  
**Production:** `https://crm2.joinscaleflow.in` (`build 01a2036a-025d-72bf-91b5-29bd57d77cc4`, deployed `2026-11-22T13:22:17Z`, DB `u256504187_crm_v2_prod`)  
**Staging:** `https://khaki-butterfly-345144.hostingersite.com` (`build 01a20364-822a-71bc-bd57-f80f3ce74f38`, DB `u256504187_crm_b11c_stg`)  
**CRM V1 Isolation:** `https://crm.joinscaleflow.in` (`build 01a13e04-5a82-7016-8f49-27fb9dc40a72`, untouched since `2026-10-15T05:23:55Z`)  
**Hosting Infrastructure:** Hostinger Business (`u256504187`, Order `1010060772`, Node.js `v22.23.5`, MariaDB on `srv469.hstgr.io`, 3,072 MiB quota per DB) — **No VPS, no CRM V1 changes, no production data altered.**

---

## 1. Step 1 — Complete System Audit & Feature-Completion Matrix

Every route (`src/routes/*`), UI component, server service (`src/server/*`), API endpoint (`/api/v1/*`), MariaDB table (`48` Drizzle tables + `__drizzle_migrations` = `49` physical tables across `16` migrations `0000`–`0015`), permission layer, background job, and integration was audited directly against source code and live health/deployment metadata.

### 1.1 Feature-Completion Matrix

| Module / Capability | Route(s) | Backend API & MariaDB Tables | Frontend Persistence | Status | Factual Gaps / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Owner Auth & Fail-Closed Sessions** | `/login`, all SSR & `/api/v1/*` | `/api/v1/auth/{login,logout,logout-all,session}`; `crm_users`, `crm_sessions`, `crm_auth_audit`, `crm_auth_rate_limits` | HttpOnly `sf_session` cookie | **Fully production-ready** | `scrypt` (`N=32768`), CSRF Origin checks, DB rate-limiting, fail-closed SSR & API (`401`/`302`). Single Owner role only (`non_owner` rejected until B16D). |
| **Dashboard & Daily Briefing** | `/`, `/daily-briefing` | `/api/v1/analytics/*`, `/api/v1/leads`, `/api/v1/follow-ups`, `/api/v1/finance/summary` | MariaDB via `PilotDashboardPage`, `PilotDailyBriefingPage` | **Fully production-ready** | Default MariaDB backend (`CRM_V2_DEFAULT_BACKEND=true`). Pure server-derived KPIs in exact integer paise. |
| **Leads, Lead Detail & Waste Bin** | `/leads`, `/leads/$id`, `/leads/bin` | `/api/v1/leads*`, `/api/v1/leads/:id/{archive,restore,activities,calls,follow-ups,whatsapp-messages,deals,quotations,custom-fields,tags,relationships}`; `crm_leads`, `crm_lead_activities` | MariaDB via `PilotLeadsPage`, `PilotLeadDetailPage`, `PilotLeadsBinPage` | **Fully production-ready** | Optimistic locking (`version`), soft archive/restore, custom fields, tags, relationships, and idempotency keys. |
| **Pipeline Board** | `/pipeline` | `/api/v1/leads*` | MariaDB via `PilotPipelinePage` | **Fully production-ready** | Native drag-and-drop + mobile stage select, `?lead=` inspector, stage age from real stage-change activity. |
| **Follow-Ups & Call Logging** | `/follow-ups`, Lead Detail | `/api/v1/follow-ups*`, `/api/v1/calls*`; `crm_follow_ups`, `crm_call_logs` | MariaDB via `PilotFollowUpsPage`, `PilotCallDialog` | **Fully production-ready** | IST timezone handling, active follow-up lock per lead, atomic lead `nextFollowUpAt` recompute. |
| **Deals, Payments & Financial Ledger** | `/deals` | `/api/v1/deals*`, `/api/v1/payments*`, `/api/v1/finance/summary`; `crm_deals`, `crm_deal_milestones`, `crm_payments`, `crm_finance_events` | MariaDB via `PilotDealsPage` | **Fully production-ready** | Exact integer paise, server-computed totals/balances, void/cancel audit trail, immutable financial events. |
| **Payment Proofs (Private Receipts)** | `/deals` (`PilotProofViewer`) | `/api/v1/payments/:id/proof*`; `crm_payment_proofs`, `crm_payment_proof_blobs` | MariaDB LONGBLOB (`1 MiB` chunks) | **Fully production-ready** | `PROOF_STORAGE_DRIVER=mariadb-blob`, `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` live on prod. SHA-256 integrity, magic-byte sniffing, 50% warning / 70% (`2,150 MiB`) hard-stop. |
| **Quotations & Quotation Packages** | `/sales-studio` | `/api/v1/quotation-templates*`, `/api/v1/quotations*`; `crm_quotation_templates`, `crm_quotations`, `crm_quotation_items`, `crm_quotation_milestones`, `crm_quotation_revisions`, `crm_quotation_audit_events` | MariaDB via `PilotSalesStudioPage` | **Partially implemented** | Quotations & packages are **production-ready** on MariaDB (`status='all'` fixed in `f3aafd0`). However, **Sales Studio WhatsApp Templates (`waTemplates`) and Website Demos (`demos`, `demoCategories`)** remain `localStorage`-only in non-Pilot mode and are not yet exposed on MariaDB in `PilotSalesStudioPage`. |
| **Projects, Milestones, Tasks, Deliverables & Support Tickets** | `/projects`, `/projects/$id` | `/api/v1/projects*`, `/api/v1/project-milestones*`, `/api/v1/tasks*`, `/api/v1/deliverables*`, `/api/v1/support-tickets*`, `/api/v1/project-templates*`; 7 `crm_project*` & `crm_client_support_tickets` tables | MariaDB via `PilotProjectsPage`, `PilotProjectDetailPage` | **Fully production-ready** | Full delivery lifecycle, checklists, dependencies, stage undo, deliverables/revisions, support tickets. |
| **Analytics & My Performance / Sales Goals** | `/analytics`, `/my-performance` | `/api/v1/analytics/*`, `/api/v1/goals*`; `crm_sales_goals`, `crm_sales_goal_revisions` | MariaDB via `PilotAnalyticsPage`, `PilotMyPerformancePage` | **Fully production-ready** | Server-computed KPIs, revenue forecasts, goal tracking & revision history. |
| **Owner Settings & CRM Config (Custom Fields, Tags, Saved Views)** | `/settings`, `/crm-config` | `/api/v1/settings*`, `/api/v1/custom-fields*`, `/api/v1/tags*`, `/api/v1/saved-views*`; `crm_owner_settings`, `crm_settings_audit_events`, `crm_custom_fields`, `crm_lead_field_values`, `crm_tag_defs`, `crm_lead_tags`, `crm_saved_views` | MariaDB via `PilotSettingsPage`, `PilotCrmConfigPage` | **Fully production-ready** | Server-validated 11 custom field types, tag taxonomy, saved filter views, settings audit log. |
| **Smart Inbox & Lead Deduplication** | `/inbox` | `/api/v1/inbox*`; `crm_lead_inbox_items`, `crm_duplicate_candidates`, `crm_lead_relationships`, `crm_lead_relationship_history` | MariaDB via `PilotInboxPage` | **Fully production-ready** | Duplicate scan, manual Owner review (`same_person`, `same_company`, `different_lead`), zero auto-merge. |
| **Automation Studio** | `/automation` | `/api/v1/automations*`; `crm_automation_rules`, `crm_automation_rule_revisions`, `crm_automation_runs`, `crm_internal_reminders` | MariaDB via `PilotAutomationPage` | **Partially implemented / Disabled** | Rule CRUD, revision history, and deterministic simulation are **production-ready**. Unattended cron execution (`run-cron.mjs`) is **intentionally disabled** (`0` Hostinger cron jobs); `execute-test` is dev/allowlist-only (`404`/`403` in prod). Zero outbound customer messaging. |
| **Data Vault, Backup Validation & Migration Wizard** | `/data-vault` | `/api/v1/vault/*`; `src/server/backup/*`, `src/server/migration/*` | MariaDB via `PilotDataVaultPage` | **Production-ready (Read/Dry-Run) / Locked (Restore/Migrate)** | Coverage audit, storage diagnostics, synthetic backup, archive inspection, and zero-mutation dry-run are live. `POST /api/v1/vault/restore` and `/vault/migration/execute` are **intentionally locked (`403`)** for safety. |
| **Personal Notes** | `/notes` | **None** (no DB table, no API) | `localStorage` (`scale-flow-crm-2-demo`) via `useCRM()` | **Using localStorage/demo data** | Rich Tiptap editor UI exists with checklists & autosave, but stores only in browser `localStorage`; not linked to MariaDB leads/projects and not in `PilotShell` sidebar. **Planned for B16B.** |
| **AI Sales Copilot & AI Panels** | `/ai-copilot`, embedded AI panels (`AIImprovePanel`, `SalesCoachPanel`, `FinanceAssistPanel`, etc.) | **None** (`AI_PROVIDER=demo`, no server AI route) | `localStorage` (`useCRM()`) + in-memory `demoProvider.ts` | **UI-only / Demo provider** | Fixed rule-based simulated responses only; reads browser `useCRM()` rather than MariaDB. No OpenRouter backend, no token/cost controls. **Planned for B16C.** |
| **Team Management, RBAC & Assignments** | `/team`, `/team-activity`, `/team-performance`, `/team/preview/$id`, `/team/workspace/$id` | **None** (`crm_users` exists for Owner only; no employee APIs or assignment tables) | `localStorage` (`useCRM()`) | **Using localStorage/demo data** | Explicit "Local demo" banner; passwords never saved; no server employee login, no server-enforced RBAC/financial isolation, no MariaDB lead assignments. **Planned for B16D.** |
| **WhatsApp Composer, Templates & Messaging** | `PilotWhatsAppDialog`, `WhatsAppComposer` | `/api/v1/whatsapp-messages*`; `crm_whatsapp_logs` | MariaDB confirmed-send logging + hardcoded `builtInTemplates` | **Partially implemented** | Manual `wa.me` deep-link + Owner-confirmed send logging to `crm_whatsapp_logs` is **production-ready**. Missing: MariaDB-persisted custom WhatsApp templates, AI Improve integration, scheduled follow-up queue, delivery logs/retry controls, and Meta Cloud API adapter preparation. **Planned for B16E.** |
| **Production Monitoring & Operational Telemetry** | `GET /api/v1/health`, `GET /api/v1/monitoring/summary` | `src/server/health/health.server.ts`, `src/server/monitoring/*` | Server-only JSON endpoints | **Hardened in B16A (Local)** | Added structured Hostinger-compatible JSON logging, secret redaction, live `SELECT 1` DB probe, quota/proof/auth-failure/backup-freshness rollup endpoint `GET /api/v1/monitoring/summary`. Pending staging verification before prod deploy. |

---

## 2. Step 2 — Production Safety, Verification & Rollback Plan

### 2.1 Verified Live Infrastructure Snapshot (`2026-11-22`)

| Environment | Domain | Active Build UUID | Build Completed | Database | DB Size / Quota | Node.js | Storage Durability |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Production** | `crm2.joinscaleflow.in` | `01a2036a-025d-72bf-91b5-29bd57d77cc4` | `2026-11-22T13:20:08Z` | `u256504187_crm_v2_prod` (`u256504187_crm_v2_usr`) | `8 MB` / `3,072 MB` (`0.26%`) | `v22.23.5` | `production_verified_mariadb_blob` (`PROOF_PRODUCTION_DURABLE_CONFIRMED=true`) |
| **Staging** | `khaki-butterfly-345144.hostingersite.com` | `01a20364-822a-71bc-bd57-f80f3ce74f38` | `2026-11-22T13:14:08Z` | `u256504187_crm_b11c_stg` (`u256504187_b11c_stg`) | `100 MB` / `3,072 MB` (`3.26%`) | `v22.23.5` | `dev_local_only` (`NODE_ENV=development`) |
| **CRM V1 (Isolated)** | `crm.joinscaleflow.in` | `01a13e04-5a82-7016-8f49-27fb9dc40a72` | `2026-10-15T05:23:55Z` | Separate V1 DB (untouched) | Untouched | `v22` (Next.js) | Untouched |

- **Git State:** Clean base commit `d0c4cb4`; new local branch `feat/b16a-production-hardening-roadmap` created. `main` untouched; zero pushes to GitHub.
- **Hostinger Cron Jobs (`hosting_cron-jobs_list`):** `[]` (`0` active cron jobs — zero unattended automation or outbound messaging).
- **Remote MySQL Connections (`hosting_databases_list-remote-connections`):** `0` remote IP rules open on `u256504187_crm_v2_prod` or `u256504187_crm_b11c_stg` (only 2 legacy IPs on unrelated `u256504187_minddesk_test`).
- **Production Runtime Logs (`hosting_nodejs_runtime-logs`, 1d):** `33` lines — only clean LiteSpeed UNIX socket start/graceful stop events; `0` unhandled runtime crashes.
- **Dependency Security Finding:** Hostinger vulnerability scan on `crm2.joinscaleflow.in` reports `11` npm advisories (`4` high, `6` moderate, `1` low). Tracked as a non-urgent hardening item for B16F QA (must be patched via staging build, never directly on production).

### 2.2 Backups & Recovery Evidence Assessment

- **Hostinger Business Daily Automated Backups:** Included at hPanel level for files & MySQL databases under `u256504187`. Note: Hostinger Business MCP does **not** expose a programmatic backup-list or trigger API — backups must be verified in hPanel UI or complemented by off-host `mysqldump --single-transaction` + `age` encryption (`scripts/b11c-mariadb-backup.mjs`).
- **Verified Clean-Target Restore Evidence:** Staging DB `u256504187_crm_b11c_stg` (`49` tables, `23` proofs, `97` LONGBLOB chunks, `80.83 MiB`) was dumped and restored cleanly to empty `u256504187_crm_b11c_rst` and `u256504187_crm_b11c_rst2` with `0` row mismatches and `23/23` (`100%`) SHA-256 receipt recovery.
- **Production Backup Action Item:** Because `u256504187_crm_v2_prod` was provisioned today (`2026-11-22T13:19:16Z`), confirm its first automated hPanel daily MySQL backup appears in hPanel within 24 hours, and run an off-host `mysqldump` snapshot before any future schema migration (`B16B`+) is applied to production.

### 2.3 Production Rollback Runbook (`crm2.joinscaleflow.in`)

1. **Preserve Known-Good Baseline:**
   - Known-good production Git commit: `d0c4cb4`
   - Known-good production Hostinger build UUID: `01a2036a-025d-72bf-91b5-29bd57d77cc4`
   - Known-good production DB: `u256504187_crm_v2_prod` (schema migrations `0000`–`0015`)
   - All future migrations (`B16B`–`B16E`) MUST be **strictly additive** (`CREATE TABLE`, nullable `ADD COLUMN`) so rolling back application code to `d0c4cb4` never breaks against a forward-migrated database.
2. **Application Rollback Procedure (< 5 minutes):**
   - Package commit `d0c4cb4` (or previous verified release archive) without `.env` or `.data/`.
   - Deploy to `crm2.joinscaleflow.in` via Hostinger archive deploy (`hosting_nodejs_start-build`) or re-activate previous build in hPanel.
   - Verify `GET https://crm2.joinscaleflow.in/api/v1/health` returns `200 OK` with `env: "production"` and `storage.productionReady: true`.
3. **Database Rollback Procedure (Only If Data Corruption Occurs):**
   - Never run destructive `DROP`/`TRUNCATE` on `u256504187_crm_v2_prod` without first exporting a forensic dump.
   - Restore the latest verified hPanel daily MySQL backup or `age`-decrypted `mysqldump` archive into a clean target DB first, verify row counts + `crm_payment_proof_blobs` SHA-256 checksums, then point `DB_NAME` / restore cleanly.
4. **Business Continuity Fallback:** `https://crm.joinscaleflow.in` (CRM V1) remains 100% isolated and operational at all times.

---

## 3. Step 3 — Payment-Proof & Backup Verification Result

- **Live Production Configuration Parity:** Verified via `GET https://crm2.joinscaleflow.in/api/v1/health`:
  - `storage.driver`: `"mariadb-blob"`
  - `storage.isolationSafe`: `true`
  - `storage.productionReady`: `true`
  - `storage.failClosed`: `false`
  - `storage.durabilityStatus`: `"production_verified_mariadb_blob"`
  - Same tested `MariadbBlobProofStorage` (`1 MiB` LONGBLOB chunking + SHA-256 verification + 50%/70% MariaDB quota guard) deployed on staging and production.
- **Zero Production Mutation Guarantee:** No synthetic data was inserted into `owner@crm.in` or `u256504187_crm_v2_prod`. Receipt uploads remain enabled and operational on production.
- **Isolated Automated Verification Passed (`154` test files / `1,500` tests):**
  - Receipt upload/replace/download & magic-byte validation (`b3b-proofs.test.ts`, `b11a-durable-proof-storage.test.ts`, `b11c-business-hosting.test.ts`, `b11c-business-qa.test.ts`, `b16a-monitoring-and-proof-verification.test.ts`).
  - SHA-256 integrity & 1-bit corruption fail-closed detection (`b16a-monitoring-and-proof-verification.test.ts`, `b11c-business-hosting.test.ts`).
  - Permission isolation: unauthenticated `401`, cross-Owner `404` (`b3b-proofs.test.ts`, `b11c-business-qa.test.ts`).
  - Quota hard-stop `507` at 70% (`2,150 MiB`) while preserving existing downloads & financial records (`b11c-launch-hardening.test.ts`).
  - Clean-target backup manifest, zero-mutation dry-run, and disposable restore rollback (`b7a-dry-run-restore.test.ts`, `b7a-qa-restore-rollback.test.ts`, `b12-backup-production-readiness.test.ts`, `b16a-monitoring-and-proof-verification.test.ts`).

---

## 4. Step 4 — Production Monitoring Readiness (Implemented in B16A)

Lightweight, zero-dependency monitoring added for Hostinger Business Node.js 22 compatibility:

1. **Structured JSON Operational Logger (`src/server/monitoring/logger.server.ts`):**
   - Emits single-line JSON (`{ timestamp, level, message, event, service, meta }`) directly parseable and level-filterable by Hostinger `hosting_nodejs_runtime-logs`.
   - Automatic recursive redaction of secrets, passwords, cookies, bearer tokens, and `mysql://` DSNs.
   - Bounded in-process counters + 20-entry sanitized ring buffer for unhandled API errors, proof upload failures, auth failures, and DB connectivity failures.
2. **Owner Operational Monitoring Endpoint (`GET /api/v1/monitoring/summary` via `src/server/monitoring/monitoringService.server.ts`):**
   - Strictly Owner-authenticated (`401` unauthenticated, `405` non-GET, `Cache-Control: no-store`, zero secrets).
   - Live `SELECT 1` MariaDB connectivity probe + latency (`ms`).
   - Live MariaDB storage quota telemetry (`usedMiB`, `quotaMiB: 3072`, `percentOfQuota`, 50% warning / 70% hard-stop status).
   - Payment-proof health breakdown (`verified`, `pendingVerify`, `corrupted`, `missing`, `failed`) + in-process upload failure count.
   - Last-24h authentication failure & rate-limit summary from `crm_auth_audit` + active session count from `crm_sessions`.
   - Backup freshness evaluation (`evaluateBackupHealth`, 26h stale threshold, verified-restore flag) + Hostinger hPanel daily backup note.
   - Rolled-up `status` (`healthy` | `degraded` | `critical`) and actionable `alerts[]`.
3. **Hooked Into Live Request & Error Paths:**
   - `src/server/http/apiRouter.server.ts`: Logs structured auth failures (`login_failed`, `rate_limited`, `session_rejected`) and unhandled 500 API errors.
   - `src/server/http/crmRoutes.server.ts`: Records every `/proof` `CrmServiceError` (e.g. `400`, `507`, `500`, `503`) and any `>= 500` CRM API error.

---

## 5. Step 5 — Prioritized Implementation Plans for B16B–B16F

All checkpoints below MUST be developed on dedicated feature branches, verified on **staging (`khaki-butterfly-345144.hostingersite.com`)** first, and deployed to production ONLY after explicit Owner review and approval.

### B16B — Personal Notes (MariaDB Persistence)
- **Goal:** Migrate `/notes` from browser `localStorage` (`scale-flow-crm-2-demo`) to MariaDB while preserving the existing Tiptap rich-text & checklist UX.
- **Additive Schema (`0016_b16b_personal_notes.sql`):**
  - `crm_personal_notes` (`id`, `owner_user_id`, `title`, `body_text`, `doc_json`, `color`, `is_pinned`, `linked_lead_id` nullable FK `crm_leads`, `linked_project_id` nullable FK `crm_projects`, `tags_json`, `version`, `archived_at`, `created_at`, `updated_at`) + indexes on `(owner_user_id, is_pinned, updated_at)` and `(owner_user_id, linked_lead_id)`.
- **Server Service & APIs:**
  - `src/server/crm/notesService.server.ts` with Owner-scoped CRUD, full-text `LIKE` search across title/body/tags, tag filtering, lead/project link validation, optimistic locking (`version`), and soft-archive.
  - Endpoints: `GET|POST /api/v1/notes`, `GET|PATCH|DELETE /api/v1/notes/:id`, `POST /api/v1/notes/:id/pin`.
- **Frontend:**
  - `src/lib/api/notesApi.ts` + `src/components/pilot/PilotNotesPage.tsx` (reusing existing Tiptap StarterKit + TaskList editor, debounced autosave with conflict banner, search, tag pills, and linked Lead/Project pickers).
  - Wire `/notes` route to `PilotNotesPage` in MariaDB mode and add `Notes` to `PilotShell` sidebar.
- **Verification:** Vitest service/HTTP/UI tests, staging CRUD + reload persistence + cross-Owner isolation (`404`).

### B16C — AI Copilot (Secure OpenRouter Backend)
- **Goal:** Replace `demoProvider.ts` with a real, permission-aware, server-side OpenRouter backend without fabricating CRM numbers or writing CRM records.
- **Pre-Requisite Gate:** Owner approval & provisioning of `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and daily/monthly token budget env vars on Hostinger.
- **Additive Schema (`0017_b16c_ai_usage_logs.sql`):**
  - `crm_ai_usage_logs` (`id`, `owner_user_id`, `actor_user_id`, `module`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `estimated_cost_microusd`, `status`, `created_at`) for per-day token & cost caps.
- **Server Service & APIs:**
  - `src/server/ai/openRouterProvider.server.ts` (strict server-only key handling, timeout, retry-safe error mapping, fallback to disabled/unavailable state when key is absent).
  - `src/server/ai/crmContextBuilder.server.ts` (fetches real MariaDB lead/deal/payment/project context scoped strictly to the authenticated user's permissions; all financial totals pre-calculated in integer paise on the server and passed as read-only authoritative facts — LLM never invents amounts).
  - `POST /api/v1/ai/ask`, `POST /api/v1/ai/improve-text`, `GET /api/v1/ai/status` (with DB-backed rate limits + daily token/cost cap enforcement).
- **Frontend:**
  - Server-backed `PilotAiCopilotPage` on `/ai-copilot` + wire `AIImprovePanel` / `SalesCoachPanel` to `/api/v1/ai/*` (read-only drafts only; AI never mutates CRM tables).
- **Verification:** Mocked OpenRouter unit/HTTP tests (token cap, cost cap, permission redaction, zero DB mutation) + live staging verification once key is approved.

### B16D — Team Management & Server-Enforced RBAC
- **Goal:** Enable real Owner-created employee accounts, server-enforced role/module permissions, lead assignments, and team activity/performance tracking with strict financial isolation.
- **Additive Schema (`0018_b16d_team_rbac.sql`):**
  - Extend `crm_users` (`owner_user_id` nullable FK for tenant scoping, `role_id` supporting `owner` | `executive` | `closer` | `support`, `permissions_json`, `created_by_user_id`).
  - `crm_lead_assignments` (`id`, `owner_user_id`, `lead_id`, `assignee_user_id`, `assigned_by_user_id`, `assigned_at`, `unassigned_at`) + `crm_assignment_rules` + `crm_team_activity_events`.
- **Auth & Authorization Hardening:**
  - Update `authService.server.ts` (`evaluateStoredSessionValidity`) to allow active `employee` sessions scoped to their `owner_user_id` and `permissions`.
  - Introduce central `requirePermission(auth, permissionKey)` middleware in `crmRoutes.server.ts`:
    - **Hard Financial Isolation:** Employees without explicit `finance.view` permission receive `403 forbidden` on `/api/v1/deals*`, `/api/v1/payments*`, `/api/v1/finance/*`, `/api/v1/payments/:id/proof*`, and `/api/v1/vault/*`.
    - **Lead Scope Isolation:** Employees with `assigned_only` scope only see leads assigned to them in `crm_lead_assignments`.
- **APIs & UI:**
  - Owner-only endpoints: `GET|POST /api/v1/team/employees`, `PATCH /api/v1/team/employees/:id`, `POST /api/v1/team/employees/:id/{status,reset-password}`, `POST /api/v1/leads/:id/assign`, `GET /api/v1/team/{activity,performance}`.
  - Wire `/team`, `/team-activity`, `/team-performance` to MariaDB Pilot pages; keep Owner-only routes hidden/blocked for employees.
- **Verification:** Strict RBAC security matrix tests (employee cannot access unauthorized deals, payments, proofs, settings, vault, or unassigned leads; deactivated employee sessions revoked immediately).

### B16E — WhatsApp Composer, Templates, Scheduled Follow-Ups & Meta API Readiness
- **Goal:** Persist WhatsApp templates and scheduled follow-up drafts in MariaDB, connect AI Improve (from B16C), track delivery logs/retries, and prepare a clean Meta Cloud API adapter **strictly disabled by default**.
- **Additive Schema (`0019_b16e_whatsapp_studio.sql`):**
  - `crm_wa_templates` (`id`, `owner_user_id`, `name`, `purpose`, `body`, `variables_json`, `is_active`, `sort_order`, `version`, `created_at`, `updated_at`).
  - `crm_wa_scheduled_messages` (`id`, `owner_user_id`, `lead_id`, `template_id`, `rendered_body`, `scheduled_for_utc`, `status` [`draft` | `scheduled` | `manual_sent` | `failed` | `cancelled`], `retry_count`, `last_error`, `created_at`, `updated_at`).
  - `crm_wa_delivery_logs` (immutable audit trail of manual `wa.me` confirmations and future Meta API webhook/send attempts).
- **Safety Gate:** `WHATSAPP_AUTO_SEND_ENABLED=false` hardcoded/fail-closed unless explicitly approved and enabled by Owner; Meta Cloud API adapter (`src/server/integrations/metaWhatsApp.server.ts`) ships in `dry_run` / `disabled` mode only.
- **Frontend:** Upgrade `PilotWhatsAppDialog` & `PilotSalesStudioPage` to manage MariaDB templates, AI Improve button, scheduled follow-ups list, and delivery/retry history.

### B16F — Final Complete CRM QA & Production Readiness Sign-Off
- **Desktop (1440px) & Mobile (390px) Browser QA** on staging across all 22+ modules.
- **End-to-End Workflow:** Lead intake → Smart Inbox dedupe → Personal Note → AI Copilot draft → WhatsApp Composer → Call Log → Follow-up → Quotation → Deal → Payment + Receipt SHA-256 → Project Delivery → Support Ticket → Analytics & Goals.
- **Security & Role Isolation Audit:** Owner vs Employee RBAC penetration check, CSRF/rate-limit check, dependency vulnerability patching (`npm audit` / Hostinger vulnerability re-scan).
- **Backup, Recovery & Monitoring Verification:** Clean-target MariaDB backup + restore drill on staging including all new B16B–B16E tables, plus live `GET /api/v1/monitoring/summary` verification.

---

## 6. B16A Remaining Blockers & Owner Decisions Needed Before B16B

1. **Production Backup Verification (Non-Blocking for B16B Dev, Required Before Prod Cutover):** Confirm in Hostinger hPanel that daily automated MySQL backups are active for `u256504187_crm_v2_prod` (created `2026-11-22T13:19:16Z`) and decide whether to also run periodic off-host `mysqldump` snapshots.
2. **OpenRouter API Credentials (Needed Before B16C Staging):** Owner authorization + `OPENROUTER_API_KEY` + preferred model + monthly spend cap.
3. **Meta WhatsApp Cloud API (Needed Only If/When Automated Sending Is Desired After B16E):** Remains strictly disabled until separately approved.
4. **Staging Deploy of B16A Monitoring:** Ready to deploy to `khaki-butterfly-345144.hostingersite.com` (and later production) upon Owner approval.
