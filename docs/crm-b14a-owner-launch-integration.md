# Scale Flow Sales OS 3.0 — Checkpoint B14A: Default MariaDB Integration & Owner Launch Readiness

**Status:** Local B14A Implementation & Regression Verification **COMPLETE** — Staging Deployment & Real Customer Data Migration **PENDING EXPLICIT OWNER APPROVAL**  
**Branch:** `feat/b14a-owner-launch-integration` (from `be96ba1`)  
**Hosting:** Hostinger Business exclusively (MariaDB 11.4 + `mariadb-blob`; Cloudflare R2 not required; no VPS)  
**CRM V1 (`crm.joinscaleflow.in`), GitHub `main`, DNS, Real Customer Data, Production Flags:** **UNTOUCHED**

---

## 1. Explicit Default MariaDB Feature Flag (`CRM_V2_DEFAULT_BACKEND`)

- Added explicit deployment env flag `CRM_V2_DEFAULT_BACKEND` (default `false`) in `src/server/config/env.server.ts`.
- **Never activated by `NODE_ENV=production` alone** — requires explicit `CRM_V2_DEFAULT_BACKEND=true`.
- Propagated via SSR (`RequestAuthContextState`), `/api/v1/auth/session`, `/api/v1/auth/login`, `useAuthStore`, and `useLeadPilotState()`.
- When `CRM_V2_DEFAULT_BACKEND=true`:
  - All **18 integrated Owner CRM routes** load persistent MariaDB records automatically **without requiring `?pilot=1`**.
  - Zero silent fallback to browser demo data; empty MariaDB databases render genuine empty states.
  - `POST /api/v1/vault/migration/execute` (`403 MIGRATION_EXECUTION_LOCKED`) and `POST /api/v1/vault/restore` (`403 RESTORE_EXECUTION_DISABLED`) remain permanently locked.

---

## 2. 18 Fully Integrated Default MariaDB Owner Pages

1. Dashboard (`/`)
2. Daily Briefing (`/daily-briefing`) — **NEW in B14A** (`PilotDailyBriefingPage.tsx`)
3. Smart Inbox (`/inbox`)
4. Leads (`/leads`)
5. Lead Detail (`/leads/$id`)
6. Leads Waste & Deleted Bin (`/leads/bin`)
7. Pipeline (`/pipeline`) — **NEW in B14A** (`PilotPipelinePage.tsx`, drag-and-drop + touch `<select>` + optimistic visual rollback on API error, backed directly by `crm_leads` + `crm_deals`)
8. Deals & Payments / Finance Studio (`/deals`)
9. Sales Studio / Quotations & Templates (`/sales-studio`)
10. Follow-ups (`/follow-ups`)
11. Projects (`/projects`)
12. Project Detail & Tasks (`/projects/$id`)
13. Analytics (`/analytics`)
14. My Performance & Goals (`/my-performance`)
15. Settings (`/settings`)
16. CRM Configuration (`/crm-config`)
17. Automation Studio (`/automation`, outbound execution disabled)
18. Data Vault & Migration Wizard (`/data-vault`)

### Intentionally Deferred Modules (Explicitly Separated)
- **Personal Notes (`/notes`)**: Preserved in Data Vault ZIP (`data/personal-notes.json`); no MariaDB table yet.
- **AI Copilot (`/ai-copilot`)**: Demo mode only (`AI_PROVIDER=demo`); never writes CRM data.
- **Team / Team Activity / Team Performance (`/team*`)**: Intentionally deferred in Owner-only launch.

---

## 3. Original-Origin Browser Export Accessibility (Phase 6)

Because `localStorage` and `IndexedDB` are strictly origin-bound, staging (`khaki-butterfly-345144.hostingersite.com`) cannot read browser data stored under `https://crm.joinscaleflow.in`.
- **Primary path:** If the original CRM V1 origin includes **Data Vault → Backup everything**, use it directly to download a read-only `.zip` backup.
- **Fallback Owner-initiated read-only helper:** Provided [scripts/b14a-origin-export-snippet.js](../scripts/b14a-origin-export-snippet.js) — strictly read-only (zero `localStorage` writes, zero network calls), exports `scale-flow-crm-2-demo`, IndexedDB `scale-flow-payment-proofs` (base64 + SHA-256), and sidebar preferences to a local `.json` file verifiable offline via:
  ```bash
  node scripts/b13c-offline-migration-preview.mjs --file <exported-file>
  ```

---

## 4. Approved Staging Deployment Plan & Rollback Instructions (NOT YET EXECUTED)

### Pre-Deploy Checklist (Requires Explicit Owner Approval)
1. Save fresh staging rollback metadata (current build UUID + `.env` SHA-256 + 23 receipt hashes in `u256504187_crm_b11c_stg`).
2. Deploy `feat/b14a-owner-launch-integration` build archive to `khaki-butterfly-345144.hostingersite.com` ONLY (keep `u256504187_crm_b11c_stg` or approved disposable DB; never touch CRM V1).
3. Enable `CRM_V2_DEFAULT_BACKEND=true` in staging env vars (keep `PROOF_PRODUCTION_DURABLE_CONFIRMED` unset and automations disabled).
4. Verify end-to-end Owner workflow without `?pilot=1`: Login → Leads → Pipeline drag-and-drop → Daily Briefing → Deals/Payments/Proofs → Quotations → Projects → Dashboard → Refresh → Logout/Re-login.

### Instant Rollback Procedure
1. Set `CRM_V2_DEFAULT_BACKEND=false` (or restore saved pre-B14A 16 env vars) via `hosting_nodejs_replace-environment-variables`.
2. Re-deploy prior verified build archive (`01a1d9ca-a139-71d3-b95c-c858c150569e`) if needed and confirm `GET /api/v1/health` → `200 OK` and all 23 staging receipt SHA-256 hashes match `docs/crm-b13b-staging-rollback.json`.
