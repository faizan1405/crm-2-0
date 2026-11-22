# Scale Flow Sales OS 3.0 — Checkpoint B13C: Owner Data Export & Migration Pre-Flight

**Status:** Pre-Flight Tooling, Canonical Parity Fixes, Regression Tests & Launch Readiness Audit **COMPLETE** — Real Customer Data Export & Migration **PENDING EXPLICIT OWNER EXECUTION & APPROVAL**  
**Branch:** `feat/b13c-owner-export-preflight` (from `297e1e9`)  
**Hosting:** Hostinger Business exclusively (MariaDB 11.4 + `mariadb-blob`; Cloudflare R2 not required; no VPS)  
**CRM V1 (`crm.joinscaleflow.in`), Real Customer Data, Browser Storage, GitHub `main`, DNS, Production Flags:** **UNTOUCHED**

---

## 1. Phase 1 — Migration Code-Path Parity Audit & Closure

In B13B live Hostinger testing, the remote synthetic run used a standalone SQL runner (`b13b-live-mariadb-verify.mjs`) rather than executing `mariadbImporter.server.ts` directly. That live run uncovered 6 canonical enum & proof-key mismatches against the live frontend Zod contracts (`src/lib/api/schemas.ts`).

In **B13C**, every single gap between `migrationEngine.server.ts` / `mariadbImporter.server.ts` and real MariaDB + frontend Zod contracts has been closed and locked with regression tests (`src/server/b13c-enum-and-parity.test.ts`):
- **Payment-proof `storageKey`**: Normalized to `prf_<id>.<ext>` (no `/` slashes; passes `isValidProofStorageKey` + `SAFE_STORAGE_KEY_RE`), with `activePaymentLock` and `storageStatus = "verified"`.
- **Leads**: `source` normalized to Title Case `LEAD_SOURCES_API` (`Website`, `WhatsApp`, `Referral`, `Other`); `priority` normalized to `hot`/`warm`/`cold`; archived bin leads mapped to `lifecycleStatus = "waste"`.
- **Call Logs & Follow-ups**: `call.outcome` normalized to `CALL_OUTCOMES_API` (`Connected`, `Not picked`, etc.); populated `connected`, `recordingSource`, `dialSource`, `stageBefore`, `stageAfter`, `leadActivityId`, `occurredIstDate`, `occurredIstTime`, and `followUp.dueIstTime`.
- **Deals**: `clientType` normalized to `"crm"` / `"other"`; storage `status` normalized to `"active" | "completed" | "on_hold" | "cancelled"` while preserving Won/Active/Lost financial reconciliation.
- **Payments**: `method` normalized to `UPI`, `Bank Transfer`, `Cash`, `Card`, `Cheque`; `paymentType` normalized to `advance`, `milestone`, `final`, `other`.
- **Projects**: `stage` normalized (`dev` → `development`, `qa` → `testing`, `review` → `client_review`, `handover` → `ready_to_launch`).
- **Duplicate Phone Detection**: Added `duplicatePhones` reporting across normalized 10-digit `phoneKey` values.

All fixes live directly in `src/server/migration/migrationEngine.server.ts` and will automatically be included in the next approved staging deployment build.

---

## 2. Phase 2 — Real Browser Data Origin & Storage Audit

Browser storage is **strictly origin-isolated**:
- **Original Production CRM V1 Origin:** `https://crm.joinscaleflow.in` (UNTOUCHED — NOT accessed).
- **CRM V2 Staging Origin:** `https://khaki-butterfly-345144.hostingersite.com` (contains only synthetic staging data; does NOT contain the Owner's real browser records).
- **Exact Browser Storage Locations Inspected via Code:**
  1. `localStorage["scale-flow-crm-2-demo"]` — Persisted Zustand CRM state (`{ state, version }`) containing all 21 categories (leads, bin, activities, callOps, followUps, deals, payments, notes, quotationTemplates, quotationShares, legacyQuotations, waTemplates, demos, employees, employeeAccess, assignments, teamEvents, inboxMeta, leadRelations, automationRules, goals, projects, customFields, fieldValues, tagDefs, leadTags, savedViews, savedReports, settings).
  2. `IndexedDB["scale-flow-payment-proofs"]` (version 1) — Object stores `meta` (`keyPath: "paymentId"`) and `files` (binary `ArrayBuffer` receipts keyed by `paymentId`).
  3. `localStorage["scale-flow-sidebar-groups"]` & `localStorage["scale-flow-sidebar-collapsed"]` — UI sidebar layout preferences.
  4. `localStorage["scale-flow-call-pending"]` — Transient post-call dialog draft (optional).

---

## 3. Phase 3 & Phase 4 — Owner-Controlled Read-Only Export & Offline Pre-Flight Preview

### Owner Export Instructions (Zero Deletion / Zero Upload)
1. On the **original browser & profile** holding your CRM data (the origin where your real records live), open **Data Vault → Backup everything** (or the gated **Export Browser Storage (Read-Only)** control in `PilotMigrationWizard` once deployed) and download a full `.zip` backup.
   - Read-only: never deletes or overwrites `localStorage` or `IndexedDB`.
   - Preserves all 21 categories (including Notes, Demos, Saved Reports, and credential-scrubbed Team records), all binary payment proofs with SHA-256 hashes, and UI preferences.
2. Verify the downloaded ZIP **100% offline** on your own machine (zero server uploads, zero AI calls, zero DB writes):
   ```bash
   node scripts/b13c-offline-migration-preview.mjs --file "C:\path\to\ScaleFlow_Backup.zip"
   ```
3. Review the offline JSON report:
   - Confirm `ok: true`, `missingRelationships: []`, `financialErrors: []`, `paymentProofs.failed: 0`, and `hostingerStorageEstimate.fitsWithinBudget: true`.
   - Review any `duplicateIds`, `duplicatePhones`, or `unsupportedFields` before approving a real migration.
4. Keep an offline SHA-256 copy of the exported ZIP (`certutil -hashfile <backup.zip> SHA256`) before any future migration.

---

## 4. Phase 5 — Launch Readiness Audit (MariaDB vs Remaining Local-Only Features)

### MariaDB-Backed Owner Modules (16 Routes — Ready Behind Pilot Flag)
- Dashboard (`index.tsx` → `PilotDashboardPage`)
- Leads, Lead Detail & Bin (`leads.tsx`, `leads_.$id.tsx`, `leads_.bin.tsx`)
- Follow-ups (`follow-ups.tsx`), Calls & WhatsApp logging
- Deals, Payments & Payment Proofs (`deals.tsx` → `PilotDealsPage`)
- Sales Studio / Quotations & Templates (`sales-studio.tsx`)
- Projects & Project Detail / Tasks (`projects.tsx`, `projects_.$id.tsx`)
- Analytics (`analytics.tsx`), My Performance / Goals (`my-performance.tsx`)
- Owner Settings (`settings.tsx`), CRM Configuration (`crm-config.tsx`)
- Smart Inbox (`inbox.tsx`), Automation Studio (`automation.tsx`), Data Vault & Migration Wizard (`data-vault.tsx`)

### Remaining Local-Only / Deferred Features
1. **Pipeline (`src/routes/pipeline.tsx`)** — Still reads local Zustand `useCRM` (needs MariaDB-backed Pipeline view or explicit B14 decision).
2. **Daily Briefing (`src/routes/daily-briefing.tsx`)** — Still reads local Zustand `useCRM`.
3. **Personal Notes (`src/routes/notes.tsx`)** — Deferred (no MariaDB table; preserved intact in backup ZIP).
4. **AI Copilot (`src/routes/ai-copilot.tsx`)** — Demo provider (`AI_PROVIDER=demo`), reads local Zustand `useCRM`.
5. **Team / Team Activity / Team Performance (`team*.tsx`)** — Intentionally deferred for Owner-only launch.

### B14 Launch Blockers (Before Production Cutover)
1. **Promote MariaDB Pilot to Default Backend in Production:** Currently all 16 MariaDB-backed pages require `DEV_LEAD_PILOT=true` + `?pilot=1` and fall back to local Zustand demo state when `NODE_ENV=production`. B14 must make MariaDB the default production path for Owner routes.
2. **Wire Pipeline (`pipeline.tsx`) & Daily Briefing (`daily-briefing.tsx`) to MariaDB** (or explicitly defer them for v2.0 launch).
3. **Owner-Approved Real-Data Export & Offline Pre-Flight Preview** using `scripts/b13c-offline-migration-preview.mjs` on the Owner's real archive.
4. **Production Storage Durability Sign-Off (`PROOF_PRODUCTION_DURABLE_CONFIRMED`)** and automated encrypted Hostinger backup schedule verification.
5. **Owner Cutover Approval & Maintenance Window** for real-data import into the dedicated production Hostinger MariaDB database (never overwriting CRM V1).
