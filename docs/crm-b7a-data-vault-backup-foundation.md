# Checkpoint B7A — Data Vault, Backup Integrity & Safe Migration Foundation

**Target Application:** Scale Flow Sales OS 3.0 (CRM V2)  
**Branch:** `feat/b7a-data-vault-backup-foundation`  
**Base Commit:** [`2311217`](file:///c:/Users/Faizan/Downloads/CRM%202.0) (`feat(pilot-b6b): implement server-backed owner settings and sales goals pilot ui`)  
**Safety Status:** Isolated development foundation. Zero remote pushes, zero merges into `main`, zero Hostinger production mutations. Browser storage (`scale-flow-crm-2-demo`) and IndexedDB payment proofs (`scale-flow-payment-proofs`) remain byte-for-byte identical.

---

## 1. B6B Browser Acceptance Evidence & Verification Audit

The B6B Chrome CDP E2E verification suite (`b6b-browser-e2e.mjs`) was executed against a live compiled Nitro server (`.output/server/index.mjs`) and an isolated disposable MariaDB 11.4 database (`127.0.0.1:13307/crm_b6b_preflight`).

### Evidence Observed:
- **15 Real Browser Scenarios Executed via CDP:**
  1. Automated database seeding for Owner A and Owner B.
  2. Real CDP form submission on `/login` to establish authenticated Owner A session cookies.
  3. Pre-seeding of protected client storage (`localStorage` key `scale-flow-crm-2-demo` and IndexedDB `scale-flow-payment-proofs`).
  4. Desktop 1440×900 navigation to `/settings?pilot=1` with live MariaDB status banner confirmation.
  5. Real DOM multi-tab dirty-draft edit & save of business name and regional time format.
  6. Direct MariaDB SQL assertion verifying Owner A version incremented to `v2` while Owner B records remained strictly isolated at `v1`.
  7. Mobile 390×844 and desktop 1440×900 responsive layout verification with zero horizontal overflow (`scrollWidth <= clientWidth`).
  8. Navigation to `/my-performance?pilot=1`, verifying honest "Target not configured" empty state with zero default ₹1,00,000 quota and 0 initial progress meters.
  9. Real DOM goal creation modal interaction with exact paise INR currency input (`₹20,000.30`).
  10. Server-derived metric aggregation verification displaying `₹10,000.50` actual collected against `₹20,000.30` target with semantic `<progress className="pf-progress">` meter.
  11. Real DOM goal revision with future IST effective date and mandatory change rationale.
  12. Slide-over `<Sheet>` history drawer interaction rendering full audit timeline.
  13. CDP evaluated browser storage check confirming `scale-flow-crm-2-demo` and IndexedDB proofs remained byte-for-byte untouched.
  14. Production Pilot gate test with `NODE_ENV=production DEV_LEAD_PILOT=true`, confirming `?pilot=1` is fail-closed and renders standard local device preferences without server Pilot components.
  15. Real-time network and runtime inspection confirming 0 uncaught exceptions and 0 HTTP 5xx responses.
- **Untested Boundary Gap Identified:** Concurrent two-browser simultaneous write collision in real Chrome (though verified in Vitest component integration tests).

---

## 2. Complete Persisted Data Source Inventory

| # | Entity / Data Source | Owner | Current Storage Location | Schema / Version | Primary Identifier | Foreign Key Relationships | Financial / Audit Significance | Associated Binary Files | Export Format | Migration Readiness | Risk of Data Loss | Recovery Method |
|---|----------------------|-------|--------------------------|------------------|--------------------|---------------------------|--------------------------------|-------------------------|---------------|---------------------|-------------------|-----------------|
| 1 | **Leads** | Owner | `crm_leads` / `scale-flow-crm-2-demo` | MariaDB / v10 | `id` (`lead_*`) | None | High (customer CRM history) | None | JSON (`data/leads.json`) | Ready | Low | Restore from manifest-validated backup |
| 2 | **Activities** | Owner | `crm_lead_activities` / Zustand | MariaDB / v10 | `id` (`act_*`) | `leadId` -> `crm_leads.id` | High (interaction history) | None | JSON (`data/lead-activities.json`) | Ready | Low | Re-insert with FK check |
| 3 | **Follow-ups** | Owner | `crm_follow_ups` / Zustand | MariaDB / v10 | `id` (`flw_*`) | `leadId` -> `crm_leads.id` | High (sales pipeline) | None | JSON (`data/followups.json`) | Ready | Low | Restore with active conflict resolution |
| 4 | **Call Logs** | Owner | `crm_call_logs` / Zustand | MariaDB / v10 | `id` (`call_*`) | `leadId` -> `crm_leads.id` | High (communication audit) | None | JSON (`data/lead-activities.json`) | Ready | Low | Append-only restore |
| 5 | **WhatsApp Logs** | Owner | `crm_whats_app_logs` / Zustand | MariaDB / v10 | `id` (`wa_*`) | `leadId` -> `crm_leads.id` | High (communication audit) | None | JSON (`data/lead-activities.json`) | Ready | Low | Append-only restore |
| 6 | **Deals** | Owner | `crm_deals` / Zustand | MariaDB / v10 | `id` (`deal_*`) | `leadId` -> `crm_leads.id` | Critical (financial ledger) | None | JSON (`data/deals.json`) | Ready | High | Exact paise reconciliation |
| 7 | **Deal Milestones** | Owner | `crm_deal_milestones` / Zustand | MariaDB / v10 | `id` (`dml_*`) | `dealId` -> `crm_deals.id` | Critical (milestone billing) | None | JSON (`data/deals.json`) | Ready | High | Transactional restore with deal |
| 8 | **Payments** | Owner | `crm_payments` / Zustand | MariaDB / v10 | `id` (`pay_*`) | `dealId` -> `crm_deals.id` | Critical (immutable ledger) | Payment proofs | JSON (`data/payments.json`) | Ready | High | Strict void & paise reconciliation |
| 9 | **Finance Events** | Owner | `crm_finance_events` | MariaDB | `id` (`fevt_*`) | `dealId`, `paymentId` | Critical (audit trail) | None | JSON (`data/finance-events.json`) | Server-only | Low | Append-only replay |
| 10 | **Payment Proof Meta** | Owner | `crm_payment_proofs` / IndexedDB | MariaDB / IDB | `id` (`prf_*`) | `paymentId` -> `crm_payments.id` | Critical (compliance proof) | Proof file (`files/payment-proofs/*`) | JSON (`data/attachment-metadata.json`) | Ready | High | Checksum-validated binary restore |
| 11 | **Payment Proof Binaries** | Owner | Local FS (`.data/private-proofs`) / IDB | Binary blob | File key / hash | Referenced by `crm_payment_proofs` | Critical (compliance proof) | PNG, JPEG, WebP, PDF | Binary archive entries | Ready | High | SHA-256 integrity verification |
| 12 | **Quotation Templates** | Owner | `crm_quotation_templates` / Zustand | MariaDB / v10 | `id` (`qt_*`) | None | Medium (sales enablement) | None | JSON (`data/quotation-templates.json`) | Ready | Low | Template restore |
| 13 | **Quotations & Items** | Owner | `crm_quotations`, `crm_quotation_items` | MariaDB | `id` (`quot_*`) | `dealId`, `leadId` | High (contractual record) | None | JSON (`data/quotations.json`) | Ready | Medium | Revision-aware restore |
| 14 | **Quotation Revisions** | Owner | `crm_quotation_revisions` | MariaDB | `id` (`qrev_*`) | `quotationId` | High (contract audit) | None | JSON (`data/quotations.json`) | Ready | Low | Revision history replay |
| 15 | **Projects** | Owner | `crm_projects` / Zustand | MariaDB / v10 | `id` (`proj_*`) | `leadId`, `dealId` | High (fulfillment ledger) | None | JSON (`data/projects.json`) | Ready | Medium | Linked lead/deal verification |
| 16 | **Project Tasks & Milestones** | Owner | `crm_project_tasks`, `crm_project_milestones` | MariaDB / v10 | `id` (`ptsk_*`) | `projectId` -> `crm_projects.id` | Medium (operational) | None | JSON (`data/projects.json`) | Ready | Low | Cascade restore under project |
| 17 | **Project Deliverables** | Owner | `crm_project_deliverables` | MariaDB | `id` (`pdel_*`) | `projectId` | Medium (fulfillment) | None | JSON (`data/projects.json`) | Ready | Low | Versioned restore |
| 18 | **Support Tickets** | Owner | `crm_client_support_tickets` | MariaDB | `id` (`cst_*`) | `projectId`, `leadId` | Medium (client support) | None | JSON (`data/projects.json`) | Ready | Low | Ticket restore |
| 19 | **Owner Settings** | Owner | `crm_owner_settings` / Zustand | MariaDB / v10 | `id` (`set_*`) | `ownerUserId` -> `crm_users.id` | High (business profile) | None | JSON (`data/settings.json`) | Ready | Low | Versioned rebase |
| 20 | **Settings Audit Events** | Owner | `crm_settings_audit_events` | MariaDB | `id` (`sae_*`) | `settingsId`, `ownerUserId` | High (compliance audit) | None | JSON (`data/settings.json`) | Server-only | Low | Append-only replay |
| 21 | **Sales Goals & Revisions** | Owner | `crm_sales_goals`, `crm_sales_goal_revisions` | MariaDB / v10 | `id` (`goal_*`) | `ownerUserId` | High (performance tracking) | None | JSON (`data/sales-goals.json`) | Ready | Low | Revisions and effective dates preserved |
| 22 | **Custom Fields & Values** | Owner | `crm_custom_fields`, `crm_lead_field_values` | MariaDB / v10 | `id` (`cf_*`) | `leadId`, `fieldId` | Medium (lead structure) | None | JSON (`data/crm-customization.json`) | Ready | Low | Field definition re-mapping |
| 23 | **Tags & Lead Tags** | Owner | `crm_tag_defs`, `crm_lead_tags` | MariaDB / v10 | `id` (`tag_*`) | `leadId`, `tagId` | Medium (categorization) | None | JSON (`data/crm-customization.json`) | Ready | Low | Tag re-link |
| 24 | **Personal Notes** | Owner | `scale-flow-crm-2-demo` (`notes`) | LocalStorage / v10 | `id` (`note_*`) | None | Low (personal scratchpad) | None | JSON (`data/personal-notes.json`) | Deferred | Low | Kept in browser storage |
| 25 | **Deleted Leads (Bin)** | Owner | `scale-flow-crm-2-demo` (`bin`) | LocalStorage / v10 | `id` (`bin_*`) | `leadId` | Low (soft-delete trash) | None | JSON (`data/leads.json`) | Deferred | Low | Purge or manual restore |
| 26 | **Saved Views & Prefs** | Owner | `scale-flow-crm-2-demo` (`savedViews`) | LocalStorage / v10 | `id` (`view_*`) | None | Low (UI convenience) | None | JSON (`data/crm-customization.json`) | Deferred | Low | Kept in browser storage |
| 27 | **Automation Studio** | Owner | `scale-flow-crm-2-demo` (`automationRules`) | LocalStorage / v10 | `id` (`arule_*`) | None | Medium (workflow rules) | None | JSON (`data/automation.json`) | Deferred | Medium | Kept in browser storage |
| 28 | **Smart Inbox & Relations**| Owner | `scale-flow-crm-2-demo` (`inboxMeta`) | LocalStorage / v10 | Composite | `leadId` pairs | Low (duplicate deduplication) | None | JSON (`data/lead-inbox.json`) | Deferred | Low | Kept in browser storage |
| 29 | **Team / Employees** | Owner | `scale-flow-crm-2-demo` (`employees`) | LocalStorage / v10 | `id` (`emp_*`) | None | High (team organization) | None | JSON (`data/employees.json`) | Deferred (B8) | Medium | Kept in browser storage |
| 30 | **UI Display Preferences** | Device | `scale-flow-sidebar-*`, prefs | LocalStorage | N/A | None | None (display layout) | None | N/A | Device-only | None | Browser defaults |

---

## 3. Legacy Browser-to-MariaDB Field Mapping Matrix

Implemented via [`MigrationMapper`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/migrationMapping.server.ts):

| Legacy Browser Field (`scale-flow-crm-2-demo`) | Target MariaDB Column | Conversion / Normalization Rule |
| :--- | :--- | :--- |
| `lead.id` (`lead_*`) | `crm_leads.id` | Sanitized deterministic ID, preserved across runs |
| `lead.status` (`new`, `contacted`, etc.) | `crm_leads.status` | Validated against enum stages (`new`, `contacted`, `qualified`, `proposal`, `won`, `lost`) |
| `lead.createdAt`, `updatedAt` | `crm_leads.created_at`, `updated_at` | Converted from ISO 8601 to MySQL UTC `YYYY-MM-DD HH:MM:SS.SSS` |
| `deal.id` (`deal_*`) | `crm_deals.id` | Sanitized deterministic ID |
| `deal.leadId` | `crm_deals.lead_id` | Foreign key resolved to mapped lead ID |
| `deal.value` (floating INR or string) | `crm_deals.value` (`DECIMAL(15,2)`) | Converted to exact integer paise `(value * 100)` with 2 decimal places |
| `deal.status` (`active`, `won`, `lost`) | `crm_deals.status` | Mapped directly; won deals require `won_at` UTC timestamp |
| `payment.id` (`pay_*`) | `crm_payments.id` | Sanitized deterministic ID |
| `payment.amount` (floating INR) | `crm_payments.amount` (`DECIMAL(15,2)`) | Converted to exact integer paise without floating point drift |
| `payment.date` / `recordedAt` | `crm_payments.payment_ist_date` | Extracted IST Date `YYYY-MM-DD` (`Asia/Kolkata`) |
| `payment.voided` (boolean) | `crm_payments.voided` | Boolean preserved; status set to `"voided"` with mandatory `void_reason` |
| `project.stage` | `crm_projects.stage` | Normalized to (`intake`, `planning`, `in_progress`, `review`, `delivered`, `blocked`) |
| `goal.target` | `crm_sales_goals.target_count` / `target_amount` | Count metrics store integer in `target_count`; money metrics convert paise to `target_amount` |
| `goal.effectiveFrom` | `crm_sales_goals.effective_from_ist` | Normalized to IST calendar date `YYYY-MM-DD` |

---

## 4. Backup Format & Manifest Specification

Scale Flow Backup Archives are deterministically structured ZIP packages containing structured data, binary attachments, and a root `manifest.json`.

```
ScaleFlow_Backup_Full_2026-11-10_18-30.zip
├── manifest.json
├── backup-summary.html
├── data/
│   ├── leads.json
│   ├── lead-activities.json
│   ├── followups.json
│   ├── deals.json
│   ├── payments.json
│   ├── attachment-metadata.json
│   ├── quotation-templates.json
│   ├── quotations.json
│   ├── projects.json
│   ├── sales-goals.json
│   ├── crm-customization.json
│   └── settings.json
└── files/
    └── payment-proofs/
        ├── pay_1__receipt.pdf
        └── pay_2__voucher.png
```

### Manifest Schema (`v2` Specification)
Defined in [`types.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/types.server.ts):
- `app`: `"Scale Flow Sales OS"`
- `formatVersion`: `2` (supporting MariaDB + browser schemas)
- `schemaVersion`: `10`
- `createdAt`: ISO 8601 UTC timestamp
- `timezone`: `"Asia/Kolkata"`
- `type`: `"full"` | `"custom"` | `"employee"` | `"mariadb-snapshot"`
- `complete`: boolean (must be true for full un-omitted backups)
- `classification`: `"complete"` | `"selective"` | `"employee"` | `"incomplete-full"` | `"damaged"`
- `financialSummary`:
  - `activePaymentsPaise`, `activePaymentsCount`, `totalPaymentsFormattedInr`
  - `voidedPaymentsPaise`, `voidedPaymentsCount`
  - `totalBookedDealsPaise`, `dealsWonCount`, `dealsLostCount`, `dealsActiveCount`
- `attachments`: `expected`, `included`, `missingCount`, `missingPaymentIds`
- `files`: Array of `{ path, sha256, bytes }`
- `checksumSha256`: Self-calculating cryptographic SHA-256 hash of canonical manifest JSON.

### Security & Exclusions
The manifest builder enforces recursive scrubbing ([`scrubSensitiveFields`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/manifest.server.ts)):
- `password_hash`, `token`, `token_hash`, `session`, `cookie`, `api_key`, `auth_secret` are unconditionally removed.
- Backup archives are created outside public web directories (`public/`, `.output/public/`, `public_html/`).

---

## 5. Validation & Safe Restore Dry-Run Engine

The validation engine ([`validation.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/validation.server.ts)) and dry-run engine ([`dryRun.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/dryRun.server.ts)) enforce:
1. **Archive Safety Limits:** 512 MB max archive size, 5,000 max entries, 25 MB max per entry, 200:1 max compression ratio (ZIP bomb defense).
2. **Path Traversal Defense:** Rejects `..`, `/`, `\`, null bytes, and undeclared file extensions.
3. **Cryptographic Checksum Verification:** Recalculates SHA-256 for every entry in the archive; mismatches flag classification as `"damaged"`.
4. **Duplicate Primary ID Detection:** Inspects all records in `leads`, `deals`, `payments`, `projects` to prevent ID collisions.
5. **Foreign Key Integrity:** Enforces mandatory `Payment -> Deal`, `ProjectTask -> Project`, and `Proof -> Payment` referential integrity.
6. **Zero Database Mutation Dry-Run:** [`executeRestoreDryRun`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/dryRun.server.ts) simulates restoration, generates create/update/skip previews, validates balances, and guarantees `mutationsPerformed: 0` and `databaseWritten: false`.

---

## 6. Hostinger Private Storage Durability Audit

Audit of [`src/server/storage/proofStorage.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/proofStorage.server.ts):
- **Finding:** The `ObjectStorageProofStorage` class is currently a stub that falls back to `LocalFsProofStorage(".data/private-proofs")` with `healthSummary().configured = false` and `persistentWarning: true`.
- **Hostinger Production Durability Options:**
  1. **Option A (Persistent Private Filesystem):**
     - Using `.data/private-proofs/` outside `public_html/`.
     - *Risk:* On shared or Git-deployment web hosting, application rebuilds or re-deployments may clear untracked `.data/` folders unless explicit persistent symlinks or volumes are configured.
  2. **Option B (Genuine S3/R2 Object Storage):**
     - Implementing genuine AWS S3 SDK (`@aws-sdk/client-s3`) pointing to Cloudflare R2 or Hostinger Object Storage.
     - *Advantage:* Complete decouple of attachment durability from application rebuilds.
- **Production Status:** Hostinger private-file durability is **NOT yet verified for production**. A genuine S3/R2 driver or verified persistent Hostinger volume is a **mandatory production blocker** before real customer proofs can be migrated.

---

## 7. Recovery & Rollback Strategy

1. **Pre-Migration Safety Snapshot:** Before executing any migration or restore, a full cryptographic backup of the existing state must be created and verified.
2. **Preflight Dry-Run Requirement:** No restore may proceed without an automated dry-run report confirming `ok: true`, `unresolvedForeignKeys: 0`, and `reconciled: true`.
3. **Transactional Isolation:** [`executeDisposableRestore`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/disposableRestore.server.ts) wraps all inserts inside a single MariaDB transaction (`tx`). Any database exception triggers an immediate `ROLLBACK`, leaving zero orphan rows.
4. **Idempotency Guarantee:** Rerunning the restore with the same dataset detects existing rows by ID and skips them cleanly (`recordsSkipped`), preventing duplicated Deals, Payments, or Leads.
5. **Read-Only Fallback:** In the event of a damaged restore, the application falls back immediately to read-only mode, preserving existing records from modification until resolved.

---

## 8. Verification Matrix & Quality Gates

All checks were executed directly and verified cleanly:

| Check / Suite | Tests Passed | Files | Result |
| :--- | :--- | :--- | :--- |
| **B7A Backup Manifest Tests** ([`b7a-backup-manifest.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-backup-manifest.test.ts)) | **4** | 1 | Passed |
| **B7A Migration Mapping Tests** ([`b7a-migration-mapping.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-migration-mapping.test.ts)) | **6** | 1 | Passed |
| **B7A Backup Validation Tests** ([`b7a-backup-validation.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-backup-validation.test.ts)) | **11** | 1 | Passed |
| **B7A Dry-Run Restore Tests** ([`b7a-dry-run-restore.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-dry-run-restore.test.ts)) | **3** | 1 | Passed |
| **B7A 30-Scenario Integration Suite** ([`b7a-foundation-scenarios.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-foundation-scenarios.test.ts)) | **21** | 1 | Passed |
| **Full Vitest Test Suite** (`npm test`) | **1,085** | **113** | **100% Passed (0 Failures)** |
| **Drizzle Schema Check** (`npm run db:check`) | 0 drift | 1 | Passed |
| **TypeScript Typecheck** (`npm run typecheck`) | 0 errors | All | Passed |
| **Production SSR Build** (`npm run build`) | Built in 858ms | All | Passed |
| **Targeted ESLint** (`npx eslint src/server/backup/*.ts src/server/b7a-*.ts`) | 0 errors / 0 warnings | 12 | Passed |

---

## 9. Recommended Scope for Checkpoint B7B (Data Vault UI)

In the subsequent checkpoint (B7B), the frontend Data Vault interface can connect to this foundation:
1. **Interactive Backup Builder:** Owner selects scope (Full, Selective, Employee), builds zip, and downloads with verified SHA-256 manifest.
2. **Archive Inspector & Validator:** Drag-and-drop backup verification in browser and server-side validation reporting classification, integrity, and warnings.
3. **Restore Dry-Run Preview Modal:** Displays record breakdown (creates, updates, skips), financial reconciliation badge, and foreign-key dependency warnings.
4. **Safety Confirmation Gate:** Explicit typed confirmation phrase required before executing restore to an authorized destination.
5. **Strict Guardrails:** No one-click destructive actions; no unencrypted backups stored on public web endpoints.
