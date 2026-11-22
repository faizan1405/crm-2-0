# Scale Flow Sales OS 3.0 — Checkpoint B13B: Real Database Migration Testing & Complete Data Preservation

**Status:** Local B13B Implementation, Browser Export, Coverage Audit & Transactional Importer **COMPLETE** — Remote Disposable Hostinger MariaDB Creation, Staging Deployment & Live UI Persistence Testing **PENDING EXPLICIT OWNER APPROVAL**  
**Branch:** `feat/b13b-migration-acceptance` (from `ad9bfd3`)  
**Hosting:** Hostinger Business exclusively (MariaDB 11.4 + `mariadb-blob`; Cloudflare R2 not required)  
**Production / CRM V1 / Real Customer Data / Existing Browser Storage / GitHub `main`:** **UNTOUCHED**

---

## 1. Entity Coverage Audit (Phase 2)

### A. 27 Fully Supported & Mapped CRM Entity Groups (MariaDB 11.4)
All 27 entity groups map deterministically with exact `legacyId` preservation, FK topological ordering (`ON DELETE RESTRICT` safe), and integer-paise financial precision:
1. Active Leads (`crm_leads`)
2. Archived / Bin Leads (`crm_leads`, `lifecycleStatus = "archived"`)
3. Lead Activities (`crm_lead_activities`)
4. Follow-ups (`crm_follow_ups`, enforcing single `activeLeadLock` per lead)
5. Call Logs (`crm_call_logs`)
6. WhatsApp Logs (`crm_whats_app_logs`)
7. Deals (`crm_deals`, exact `DECIMAL(15,2)` / integer paise)
8. Deal Milestones (`crm_deal_milestones`)
9. Payments (`crm_payments`, active + voided with mandatory `voidReason`)
10. Finance Audit Events (`crm_finance_events`)
11. Payment Proofs + Chunked BLOBs (`crm_payment_proofs` + `crm_payment_proof_blobs`, `<= 256 KiB` chunks, magic-byte + SHA-256 verified)
12. Quotation Templates (`crm_quotation_templates`)
13. Quotations (`crm_quotations`)
14. Projects (`crm_projects`)
15. Project Milestones (`crm_project_milestones`)
16. Project Tasks (`crm_project_tasks`)
17. Client Support Tickets (`crm_client_support_tickets`)
18. Custom Fields (`crm_custom_fields`)
19. Lead Field Values (`crm_lead_field_values`)
20. Tag Definitions (`crm_tag_defs`)
21. Lead-Tag Links (`crm_lead_tags`)
22. Saved Views (`crm_saved_views`)
23. Smart Inbox Items (`crm_lead_inbox_items`)
24. Lead Relationships (`crm_lead_relationships`)
25. Automation Rules (`crm_automation_rules`, forced `status = "paused"`)
26. Owner Settings (`crm_owner_settings`)
27. Sales Goals (`crm_sales_goals`, exact paise for monetary targets)

### B. Explicit Disposition of the 5 Deferred Browser-Local Collections (Zero Silent Drops)

| Collection | Client Storage Source | Disposition | Destination Mapping & Preservation Status |
|---|---|---|---|
| **Notes** (`notes`) | `localStorage["scale-flow-crm-2-demo"]` | `preserve_legacy_archive` | Preserved intact in Data Vault ZIP (`data/personal-notes.json`) with SHA-256 manifest. Lead-level notes are migrated into `crm_leads.notes` & `crm_lead_activities`. |
| **Demos** (`demos`, `demoCategories`) | `localStorage["scale-flow-crm-2-demo"]` | `preserve_legacy_archive` | Preserved intact in Data Vault ZIP (`data/demo-library.json`) with SHA-256 manifest until a dedicated `crm_demos` table is added. |
| **Employees** (`employees`, `employeeAccess`, `assignments`) | `localStorage["scale-flow-crm-2-demo"]` | `defer_unsupported_feature` | Intentionally deferred (Owner-only launch; `crm_users` is Owner-only). Preserved credential-scrubbed in Data Vault ZIP (`data/employees.json`, `data/roles-permissions.json`, `data/lead-assignments.json`). |
| **Team Events** (`teamEvents`, `notifyPrefs`, `notifyReads`) | `localStorage["scale-flow-crm-2-demo"]` | `defer_unsupported_feature` | Intentionally deferred until multi-user Team rollout. Preserved in Data Vault ZIP (`data/team-activity.json`). Single-owner audit trails live in MariaDB module audit tables. |
| **Saved Reports** (`savedReports`, `forecastConfig`, `forecastHistory`) | `localStorage["scale-flow-crm-2-demo"]` | `preserve_legacy_archive` | Preserved intact in Data Vault ZIP (`data/analytics-settings.json`). Live analytics compute directly from migrated MariaDB records. |

---

## 2. Browser Storage Inspection & Owner-Controlled Read-Only Export (Phase 3)

Inspected actual browser storage schemas in code:
- `localStorage["scale-flow-crm-2-demo"]` — Persisted Zustand CRM state (`{ state, version }`).
- `IndexedDB["scale-flow-payment-proofs"]` (v1) — Object stores `meta` (`keyPath: "paymentId"`) and `files` (keyed by `paymentId`, raw `ArrayBuffer` receipt binaries).
- `localStorage["scale-flow-sidebar-groups"]` & `localStorage["scale-flow-sidebar-collapsed"]` — UI navigation layout preferences.

Implemented `src/lib/crm/browserExport.ts` (`exportBrowserCrmSnapshot`) + gated UI control in `PilotMigrationWizard.tsx`:
- Requires explicit `ownerConfirmed: true` (and UI checkbox) before reading any browser storage.
- Strictly read-only (`browserStorageModified: false`; never calls `setItem`, `removeItem`, `clear`, `put`, or `remove`).
- Preserves all 21 categories, binary payment proof receipts with SHA-256 checksums, payment relationships, and UI preferences in `data/ui-preferences.json`.
- Verified end-to-end with synthetic browser storage round-tripping cleanly through `analyzeMigrationSource()`.

---

## 3. Real MariaDB Synthetic Import & Persistence Acceptance Gate (Phases 4 & 5)

Implemented:
- `src/server/migration/mariadbImporter.server.ts` (`executeMariaDbSyntheticImport`, `chunkProofBinaryForMariaDb`): atomic Drizzle `db.transaction(...)` importer across all 27 entity groups + `crm_payment_proof_blobs` (256 KiB chunks) with post-commit BLOB readback SHA-256 verification, Pass-2 idempotency (0 duplicate inserts/payments), mid-transaction rollback verification (0 orphan rows), and fail-closed guards.
- `scripts/b13b-mariadb-synthetic-import.mjs`: CLI runner strictly restricted to `--synthetic-only` and disposable/shadow/staging DB names (exits `2` without `--synthetic-only`, `3` on CRM V1 / production targets, `4` without `--confirm-disposable-target`).
- `POST /api/v1/vault/migration/execute` remains permanently locked (`403 MIGRATION_EXECUTION_LOCKED`).

### Pending Explicit Owner Approval (NOT YET EXECUTED)
1. **Create ONE new isolated disposable Hostinger MariaDB database** (e.g. `u256504187_crm_b13b_disposable`) and apply Drizzle migrations (`0000..latest`).
2. **Execute live synthetic-only Pass 1 + Pass 2 + rollback drill** via `scripts/b13b-mariadb-synthetic-import.mjs --target-db u256504187_crm_b13b_disposable --synthetic-only --confirm-disposable-target`.
3. **Run the 10-step Live UI Persistence Acceptance Check** against staging connected to that disposable DB:
   1. Owner login
   2. View imported leads
   3. Open Deal and verify payments & balances
   4. Download payment proof receipt and verify SHA-256
   5. View quotations & templates
   6. Open Projects and tasks
   7. Hard refresh browser
   8. Log out and log back in
   9. Verify in a second browser session
   10. Confirm MariaDB rows and financial totals remain unchanged.
