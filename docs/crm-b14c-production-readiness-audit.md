# Scale Flow CRM V2 — Checkpoint B14C: Owner Data Discovery & Production Readiness Audit

**Branch:** `feat/b14c-owner-data-discovery-readiness`  
**Hosting Strategy:** Hostinger Business Web Hosting (`u256504187`) exclusively — **no VPS purchase, no Cloudflare R2**.  
**Isolation Guarantee:** CRM V1 (`crm.joinscaleflow.in`), GitHub `main`, production DNS, and real browser storage remain completely untouched.

---

## 1. Phase 2 — Candidate Browser Origins & Safe Presence Check

Browser `localStorage` (`scale-flow-crm-2-demo`, Zustand schema v10) and IndexedDB (`scale-flow-payment-proofs`, stores `meta` & `files`) are strictly **origin-partitioned** (`scheme + host + port`).

### Candidate Origins (Do NOT Assume CRM V1 Holds CRM V2 Data)
1. **Lovable Preview / Published CRM V2 URL** (`*.lovable.app` or `*.lovableproject.com`) — most likely if CRM V2 was used via Lovable (`@lovable.dev/vite-tanstack-config`).
2. **Local Development Origin** (`http://localhost:3000` or `http://localhost:5173`) — if CRM V2 was used locally during development.
3. **Hostinger Staging Origin** (`https://khaki-butterfly-345144.hostingersite.com`) — only if the Owner manually entered records there before MariaDB mode.
4. **CRM V1 Domain** (`https://crm.joinscaleflow.in`) — hosts CRM V1 (`faizan1405/CRM`); **do not assume** it contains `scale-flow-crm-2-demo` unless explicitly verified.

### Step A — Owner Read-Only Presence Check (Zero PII)
Open each candidate origin in the exact browser profile where you worked on CRM V2, open DevTools Console, and paste `scripts/b14c-origin-presence-check.js`. It prints **only booleans and numeric counts** (zero customer names, phones, emails, or amounts) and performs **zero writes**.

### Step B — Two Possible Launch Paths
- **Path 1 (Real Browser Data Found):** Proceed to Section 2 (Owner-Controlled Export + Offline Pre-Flight).
- **Path 2 (No Real CRM V2 Browser Data Exists / Starting Fresh):** Skip legacy browser import and execute the **Empty-Database Launch Path**:
  1. Provision dedicated production database `u256504187_crm_v2_prod` on Hostinger (`srv469.hstgr.io`).
  2. Apply the 16 verified Drizzle migrations (`npm run db:migrate`).
  3. Bootstrap the Owner account (`scripts/bootstrap-owner.mjs`).
  4. Deploy with `CRM_V2_DEFAULT_BACKEND=true`, `NODE_ENV=production`, `PROOF_STORAGE_DRIVER=mariadb-blob`, and automation delivery disabled.
  5. Verify genuine empty states across all 18 Owner modules.

---

## 2. Phase 3 & 4 — Owner-Controlled Export & Offline Pre-Flight

Once you confirm the origin containing real CRM V2 data:

1. **Export locally (read-only, zero network calls):** Paste `scripts/b14a-origin-export-snippet.js` in DevTools Console on that verified origin. It downloads `ScaleFlow_Origin_ReadOnly_Export_<timestamp>.json` containing all 27 entity groups, deferred collections (`notes`, `demos`, `employees`, `teamEvents`, `savedReports`), UI preferences, and inline base64 IndexedDB payment proofs with SHA-256 checksums.
2. **Run offline pre-flight validation (zero uploads, zero DB writes):**
   ```bash
   node scripts/b13c-offline-migration-preview.mjs --file "<path-to-downloaded-export.json>"
   ```
3. **Review reconciliation output:** Confirm `ok: true`, `missingRelationships: []`, `financialErrors: []`, `paymentProofs.failed === 0`, and `hostingerStorageEstimate.fitsWithinBudget === true` (well within Hostinger's 3,072 MiB MariaDB quota).

---

## 3. Phase 5 — Production Readiness Audit

| Audit Area | Current Status | Evidence / Plan |
|---|---|---|
| **All 18 Owner Modules** | **READY** | All 18 routes verified live on staging build `01a20331-d8a5-71ed-9e07-786a009156a9` without `?pilot=1`; B14C cleaned up remaining sidebar `?pilot=1` links and dev banner when `CRM_V2_DEFAULT_BACKEND=true`. |
| **Migration & Export Compatibility** | **READY** | B13C enum parity + B14B `b14a-origin-readonly-json` inline base64 proof parsing + SHA-256 verification all committed and covered by automated tests. |
| **Hostinger Production DB Plan** | **READY (Pending Approval)** | Account `u256504187` (`srv469.hstgr.io`, 3,072 MiB quota per DB) has 8 existing DBs (`u256504187_crm_b11c_stg` 100 MB, `u256504187_crm_b13b_disp` 8 MB, etc.). Provision ONE new dedicated DB `u256504187_crm_v2_prod` with dedicated user `u256504187_crm_v2_usr` upon Owner approval. |
| **Hostinger Backup & Tested Recovery** | **READY** | Hostinger Business includes daily automated hPanel backups (files + MySQL), PLUS tested `mysqldump --single-transaction` + `age`-encrypted off-host backup & clean-target restore verified end-to-end on `u256504187_crm_b11c_rst2` (100% SHA-256 receipt recovery). |
| **Owner Auth & Authorization** | **READY** | `scrypt` (`N=32768,r=8,p=1`), HttpOnly `SameSite=Lax` cookies, fail-closed SSR & API (`401` unauthenticated), CSRF origin enforcement, rate limiting, and `POST /api/v1/vault/migration/execute` locked (`403`). |
| **Payment-Proof Durability** | **READY (Flag Gated)** | `PROOF_STORAGE_DRIVER=mariadb-blob` with SHA-256 integrity verified across 23/23 staging receipts + B14B live upload/download. `PROOF_PRODUCTION_DURABLE_CONFIRMED` remains `false` until Owner approves production backup cadence and cutover. |
| **CRM V1 Isolation & Rollback** | **READY** | CRM V1 (`crm.joinscaleflow.in`) runs as a separate Node.js app (`main` vhost, untouched since `2026-10-15`). Zero shared files or DB tables. Rollback = keep `crm.joinscaleflow.in` live and switch traffic/subdomain back instantaneously. |
| **Domain & Deployment Strategy (No VPS)** | **READY** | Deploy CRM V2 to a dedicated subdomain (e.g. `v2.crm.joinscaleflow.in` or Owner-chosen subdomain) on existing Hostinger Business (`u256504187`, ₹0 extra hosting cost). Keep `crm.joinscaleflow.in` untouched until Owner explicitly retires V1. |
| **Automation Delivery** | **DISABLED (Safe)** | Automatic execution & outbound customer messaging remain disabled (`0` active cron jobs on Hostinger). |
