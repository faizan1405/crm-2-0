# Checkpoint B7A-QA — Data Vault, Backup Integrity & Safe Migration Verification

**Target Application:** Scale Flow Sales OS 3.0 (CRM V2)  
**Branch:** `feat/b7a-qa-backup-restore-hardening`  
**Base Commit:** [`7c10754`](file:///c:/Users/Faizan/Downloads/CRM%202.0) (`feat(crm-b7a): implement data vault backup integrity and safe migration foundation`)  
**Safety Status:** Isolated development verification. Zero remote pushes, zero merges into `main`, zero Hostinger production mutations. Real browser storage (`scale-flow-crm-2-demo`) and IndexedDB payment proofs (`scale-flow-payment-proofs`) remain byte-for-byte untouched.

---

## 1. B6B Acceptance Evidence & Test Status Clarification

An audit of the Checkpoint B6B verification evidence reveals that the reported UI tests were conducted in Node.js JSDOM via Vitest and `@testing-library/react` ([`src/test/settings-goals-pilot.b6b.test.tsx`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/test/settings-goals-pilot.b6b.test.tsx)), rather than an external Chrome DevTools Protocol (CDP) browser process:

- **Vitest JSDOM Test Coverage (5 Scenarios):**
  1. Multi-tab dirty draft editing and saving on `/settings?pilot=1`.
  2. Stale-edit detection returning HTTP 409 conflict with client rebase recovery.
  3. Sales goal creation with exact INR paise monetary targets and zero default ₹1,00,000 quota.
  4. Real-time progress calculation and historical change drawer rendering.
  5. Complete isolation of browser `localStorage` and IndexedDB payment proofs.
- **Clarification:** No graphical `.png` screenshot assets were generated or saved in the repository for B6B. All assertions ran headlessly within Vitest.

---

## 2. Complete Persisted Data Source Inventory (30 Entity Types)

### Client Storage Architecture Correction
In the browser, individual CRM entities (leads, deals, payments, projects, etc.) are **not** persisted as separate `localStorage` keys. Rather, the entire client CRM dataset is persisted in a single composite JSON document under key `scale-flow-crm-2-demo` (`{ state: { leads, deals, payments, projects, ... }, version: 0 }`). Other `localStorage` keys are exclusively UI layout preferences (`scale-flow-sidebar-groups`, `scale-flow-sidebar-collapsed`, `scale-flow-auth-sync`).

### Entity Inventory Matrix
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
| 24 | **Quotation Shares** | Owner | `scale-flow-crm-2-demo` (`quotationShares`) | LocalStorage / v10 | `id` | `quotationId` | Medium (external quote links) | None | JSON | Incomplete / Deferred | Medium | Kept in browser storage |
| 25 | **Sales Studio Demos & Categories** | Owner | `scale-flow-crm-2-demo` (`demos`) | LocalStorage / v10 | `id` | None | Medium (sales collateral) | None | JSON | Incomplete / Deferred | Medium | Kept in browser storage |
| 26 | **WhatsApp Templates** | Owner | `scale-flow-crm-2-demo` (`waTemplates`) | LocalStorage / v10 | `id` | None | Low (predefined message drafts) | None | JSON | Incomplete / Deferred | Low | Kept in browser storage |
| 27 | **Automation Rules & Reminders** | Owner | `scale-flow-crm-2-demo` (`automationRules`) | LocalStorage / v10 | `id` | None | Medium (workflow automation) | None | JSON | Incomplete / Deferred | Medium | Kept in browser storage |
| 28 | **Smart Inbox & Lead Relations** | Owner | `scale-flow-crm-2-demo` (`inboxMeta`, `leadRelations`) | LocalStorage / v10 | Composite | `leadId` pairs | Low (duplicate deduplication) | None | JSON | Incomplete / Deferred | Low | Kept in browser storage |
| 29 | **Team / Employees** | Owner | `scale-flow-crm-2-demo` (`employees`) | LocalStorage / v10 | `id` (`emp_*`) | None | High (team organization) | None | JSON (`data/employees.json`) | Deferred (B8) | Medium | Kept in browser storage |
| 30 | **UI Display Preferences** | Device | `scale-flow-sidebar-*`, prefs | LocalStorage | N/A | None | None (display layout) | None | N/A | Device-only | None | Browser defaults |

---

## 3. Strict Exact Money Conversion Engine & Schema Alignment

### Elimination of Floating-Point Drift
In B7A, currency conversion relied on `Math.round(rupees * 100)`. In B7A-QA, this has been completely replaced by `parseLegacyRupeesToPaise` in [`src/server/backup/migrationMapping.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/migrationMapping.server.ts):
- Backed by the authoritative server parser `parseStrictInrInputToPaise` from [`src/server/db/money.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/db/money.server.ts).
- Handles Indian numbering formats with commas (e.g., `1,00,000.50` -> `10000050` paise).
- Preserves exactly two decimal places.
- Throws an explicit `FinancialValidationError` when amounts have fractional paise (e.g., `1.005`), are negative, contain `NaN`/`Infinity`, or overflow beyond `DECIMAL(15,2)`.
- Verified zero accumulation drift across 100 payments of `0.29` (exact 2900 paise = ₹29.00).

### Drizzle & MySQL Schema Alignment
The disposable restore mapper produces records fully conforming to the NOT NULL constraints and exact column definitions across all 9 MariaDB tables:
- `crm_leads`: `phone`, `phoneKey`, `createdByUserId`, `updatedByUserId`.
- `crm_deals`: `clientType`, `clientName`, `quotedAmount`, `finalAmount`, `createdByUserId`, `updatedByUserId`.
- `crm_payments`: `amount` (`DECIMAL(15,2)`), `paymentIstDate`, `method`, `recordedByUserId`, `updatedByUserId`.
- `crm_projects`: `name`, `clientName`, `type`, `stage`, `status`.
- `crm_project_tasks`: `projectId`, `title`, `priority`, `status`.
- `crm_payment_proofs`: `paymentId`, `dealId`, `originalFileName`, `fileExtension`, `mimeType`, `fileSize`, `sha256Hash`, `storageDriver`, `storageKey`, `uploadedByUserId`, `createdAt`, `updatedAt`.
- `crm_quotations`: `quotationNumber`, `title`, `clientName`, `currency`, `subtotal`, `totalAmount`, `status`, `issueIstDate`.
- `crm_sales_goals`: `metric`, `targetUnit`, `targetAmount`, `period`, `effectiveFromIst`, `createdByUserId`, `updatedByUserId`.
- `crm_owner_settings`: `businessTimezone`, `currencyCode`, `defaultLeadSort`.

---

## 4. Real ZIP Generation & Refined Credential Scrubbing

### Genuine Server-Side ZIP Generation
Implemented in [`src/server/backup/archive.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/archive.server.ts):
- Produces valid, compressed ZIP archives using `fflate` `zipSync`.
- Packages canonical sorted JSON data files, binary attachments, and the root `manifest.json`.
- Tested and verified with independent ZIP readers (`unzipSync`).

### Targeted Credential Scrubbing
Refined in [`src/server/backup/manifest.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/manifest.server.ts):
- **Preserved:** Legitimate integrity hashes (`sha256`, `sha256Hash`, `fileHash`, `txHash`), proof hashes, and reference IDs (`reference`, `id`, `opId`) remain intact.
- **Scrubbed:** Passwords, password hashes (`password_hash`), authentication tokens (`authToken`, `accessToken`), session cookies (`sessionCookie`), API keys (`apiKey`, `apiSecret`), and private keys are unconditionally removed.
- **Notes & Quotes:** Free-text customer notes, payment notes, and quotation terms are preserved exactly as entered by the owner.

---

## 5. Validation, Real ZIP Extraction & Non-Destructive Dry Run

The validation engine ([`src/server/backup/validation.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/validation.server.ts)) and dry-run engine ([`src/server/backup/dryRun.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/dryRun.server.ts)) enforce:
1. **Archive Safety Limits:** 512 MB max archive size, 5,000 max entries, 25 MB max per entry, 200:1 max compression ratio (ZIP bomb defense).
2. **Path Traversal Defense:** Rejects `..`, `/`, `\`, null bytes, and undeclared file extensions.
3. **Cryptographic Checksum Verification:** Recalculates SHA-256 for every entry; single-byte tampering flags classification as `"damaged"`.
4. **Duplicate Record Detection:** Detects duplicate primary IDs within entity collections and rejects conflicting records.
5. **Foreign Key Integrity:** Enforces mandatory `Payment -> Deal`, `ProjectTask -> Project`, and `Proof -> Payment` referential integrity.
6. **Zero Database Mutation Dry-Run:** [`executeRestoreDryRun`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/dryRun.server.ts) simulates restoration, generates create/update/skip previews, validates balances, and guarantees `mutationsPerformed: 0` and `databaseWritten: false`.

---

## 6. Hostinger Private Storage Durability & Backup Encryption Realities

### Object Storage Status
Inspection of [`src/server/storage/proofStorage.server.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/storage/proofStorage.server.ts) confirms:
- `ObjectStorageProofStorage` is currently an **unconfigured fallback stub** (`configured: false`, `persistentWarning: true`).
- Attachments default to local filesystem storage in `.data/private-proofs`.
- *Production Durability Warning:* On Hostinger git-deployment / web hosting environments, `.data/` is wiped during application redeployments unless an external persistent volume or symlink is configured.
- *Production Gate:* A genuine AWS S3/Cloudflare R2 driver or verified persistent Hostinger storage volume is a **mandatory prerequisite** before migrating real customer payment proofs.

### Backup Confidentiality & Encryption
- Scale Flow backup ZIP files are currently generated as **plaintext compressed archives**.
- WinZip AE-2 / AES-256-GCM ZIP encryption is **not implemented**.
- *Security Requirement:* Downloaded backup archives must be treated as sensitive plaintext business data and stored in encrypted local storage.

---

## 7. Recovery & Rollback Strategy (Production Runbook)

### Clarification on Rollback
Rolling back to CRM V1 is **not** a simple 2-minute git revert when schema and financial records have diverged. The true CRM V2 recovery and rollback runbook is structured as follows:

1. **Pre-Migration Snapshot:** Before executing any migration or restore, a full cryptographic backup of the existing MariaDB database and private proofs must be captured and verified.
2. **Preflight Dry-Run Requirement:** No restore may proceed without an automated dry-run report confirming `ok: true`, `unresolvedForeignKeys: 0`, and `reconciled: true`.
3. **Transactional Isolation:** [`executeDisposableRestore`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/backup/disposableRestore.server.ts) wraps all inserts inside a single MariaDB transaction (`tx`). Any database exception triggers an immediate `ROLLBACK`, leaving zero partial rows.
4. **Filesystem vs. Database Boundary:**
   > [!IMPORTANT]
   > MariaDB transaction rollback cleanly reverts all SQL database rows, but **cannot** roll back physical files already written to the local filesystem or S3 object storage. To achieve complete atomicity for attachments, the restore executor stages files in a temporary quarantine directory and promotes them only after the SQL transaction has committed.
5. **Idempotency Guarantee:** Rerunning the restore with the same dataset detects existing rows by ID and skips them cleanly (`recordsSkipped`), preventing duplicated Deals, Payments, or Leads.
6. **Read-Only Maintenance Fallback:** In the event of an unresolvable restore conflict, the application immediately switches to read-only mode, preserving existing records from modification.

---

## 8. Verification Matrix & Certified Evidence

### Automated Test Suites
| Check / Suite | Tests Passed | Files | Result |
| :--- | :--- | :--- | :--- |
| **B7A Backup Manifest Tests** ([`b7a-backup-manifest.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-backup-manifest.test.ts)) | **4** | 1 | Passed |
| **B7A Migration Mapping Tests** ([`b7a-migration-mapping.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-migration-mapping.test.ts)) | **6** | 1 | Passed |
| **B7A Backup Validation Tests** ([`b7a-backup-validation.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-backup-validation.test.ts)) | **11** | 1 | Passed |
| **B7A Dry-Run Restore Tests** ([`b7a-dry-run-restore.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-dry-run-restore.test.ts)) | **3** | 1 | Passed |
| **B7A-QA Money Conversion Tests** ([`b7a-qa-money-conversion.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-qa-money-conversion.test.ts)) | **6** | 1 | Passed |
| **B7A-QA Credential Scrubbing Tests** ([`b7a-qa-credential-scrubbing.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-qa-credential-scrubbing.test.ts)) | **3** | 1 | Passed |
| **B7A-QA Real ZIP Archive Tests** ([`b7a-qa-real-zip.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-qa-real-zip.test.ts)) | **6** | 1 | Passed |
| **B7A-QA Restore & Rollback Tests** ([`b7a-qa-restore-rollback.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-qa-restore-rollback.test.ts)) | **4** | 1 | Passed |
| **B7A Foundation Scenarios** ([`b7a-foundation-scenarios.test.ts`](file:///c:/Users/Faizan/Downloads/CRM%202.0/src/server/b7a-foundation-scenarios.test.ts)) | **21** | 1 | Passed |
| **Full Vitest Test Suite** (`npm test`) | **1,104** | **117** | **100% Passed (0 Failures)** |
| **Drizzle Schema Check** (`npm run db:check`) | 0 drift | 1 | Passed |
| **TypeScript Typecheck** (`npm run typecheck`) | 0 errors | All | Passed |
| **Production SSR Build** (`npm run build`) | Built in 923ms | All | Passed |
| **Targeted ESLint** (`npx eslint src/server/backup/*.ts src/server/b7a-*.ts`) | 0 errors / 0 warnings | 12 | Passed |

### Live MariaDB 11.4 Real-Bytes Restoration Run
Executed against isolated MariaDB 11.4 on `127.0.0.1:13306`:
1. Booted isolated MariaDB 11.4 instance.
2. Provisioned disposable database `crm_b7a_qa_disposable_restore_db` and applied forward Drizzle migrations.
3. Created genuine compressed ZIP archive (3,804 bytes) with synthetic leads, deals, payments, projects, quotations, goals, settings, and PDF deposit proof.
4. Validation engine verified genuine ZIP bytes, checksums, and financial summary: **PASSED**.
5. Non-destructive dry run verified exactly 0 SQL mutations and 0 database writes: **PASSED**.
6. Executed real disposable restore; transaction committed successfully: **PASSED**.
7. Direct SQL queries verified all 9 entity tables, foreign keys, and exact financial balance: **PASSED**.
8. Repeat restore verified idempotency (0 duplicates inserted, existing records skipped): **PASSED**.
9. Transaction rollback verified on constraint failure (rolled back cleanly with 0 partial rows): **PASSED**.
10. Database and process cleanly dropped and terminated.

---

## 9. Recommended Scope for Checkpoint B7B (Data Vault UI)

1. **Interactive Backup Builder:** Owner selects scope (Full, Selective, Employee), builds zip, and downloads with verified SHA-256 manifest.
2. **Archive Inspector & Validator:** Drag-and-drop backup verification in browser and server-side validation reporting classification, integrity, and warnings.
3. **Restore Dry-Run Preview Modal:** Displays record breakdown (creates, updates, skips), financial reconciliation badge, and foreign-key dependency warnings.
4. **Safety Confirmation Gate:** Explicit typed confirmation phrase required before executing restore to an authorized destination.
5. **Strict Guardrails:** No one-click destructive actions; no unencrypted backups stored on public web endpoints.
