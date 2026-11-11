# Scale Flow Sales OS 3.0 — Comprehensive Remaining-Module Coverage Audit

**Document:** `docs/crm-remaining-modules-audit.md`  
**Checkpoint:** B4A (Quotation Backend & Remaining Module Coverage Audit)  
**Repository:** `https://github.com/faizan1405/crm-2-0.git`  
**Branch:** `feat/b4a-quotation-backend`  
**Date:** 10 November 2026  
**Purpose:** Exhaustive audit of all CRM 2.0 frontend data types, state slices, storage engines, server-backed capabilities, cross-module dependencies, and migration risks to ensure zero data loss during future backend cutovers.

---

## 1. Executive Summary

As of Checkpoint B3C-QA, the core transactional sales loop—**Authentication, Leads, Lead Activities, Follow-ups, Call Logging, WhatsApp Confirmed Logging, Deals, Payments, Payment Proofs, and Financial Audit History**—is fully implemented with MariaDB 11.4 schemas, Nitro REST APIs, and isolated development pilots (`/leads?pilot=1`, `/follow-ups?pilot=1`, `/deals?pilot=1`).

However, several CRM capabilities remain operating strictly out of browser-local storage. This audit inventories every module in the repository to establish an authoritative dependency-based roadmap for Phase B4 and B5.

### 1.1 Confirmed Source Files & Storage Persistence Architecture

To avoid any confusion with generic naming conventions, the actual codebase layout and storage keys are verified as:

- **Routing Engine:** TanStack Router via `src/routes/*` (e.g., `src/routes/sales-studio.tsx`, `src/routes/deals.tsx`, `src/routes/leads.tsx`, `src/routes/follow-ups.tsx`, `src/routes/projects.tsx`). There is **no** `src/pages/` directory.
- **Components:** Modular React presentation components in `src/components/crm/*` and `src/components/shell/*`.
- **Primary Client State Store:** Single Zustand store in `src/lib/crm/store.ts` persisted to `localStorage` under the exact key:
  `scale-flow-crm-2-demo` (there is **no** `crm_store_v2` key).
- **Navigation State:** Collapsible sidebar group state persisted under `scale-flow-sidebar-groups`.
- **Private Attachment Storage:** Browser IndexedDB database named `scale-flow-payment-proofs` via `src/lib/crm/proofRepo.ts`.
- **Server Pilot Architecture:** Pure server-backed pilots (`PilotShell`) running isolated from `scale-flow-crm-2-demo`, activated only in development with explicit `?pilot=1` query parameters.

---

## 2. Comprehensive Module Coverage Matrix

| #      | Module / Capability                      | Frontend Features                                                                                                                                                                | Data Model & Types                                                                                       | Current Storage                                                                                  | DB Table                                                                                                                                                                          | API Status                                                                                            | Pilot UI                                             | Module Dependencies                                                      | Migration Complexity | Risk of Loss / Broken References                                                      |             Phase             |
| :----- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------- | :------------------- | :------------------------------------------------------------------------------------ | :---------------------------: |
| **01** | **Quotations (Packages & Shares)**       | WhatsApp offer packages, pricing, variable substitution (`{firstName}`, `{packageName}`, `{packagePrice}`), confirmed share logging, legacy backup                               | `QuotationTemplate`, `QuotationShare`, `LegacyQuotation` (`studio.ts`)                                   | `localStorage` (`quotationTemplates`, `quotationShares`, `legacyQuotations`)                     | **Implementing in B4A** (`crm_quotation_templates`, `crm_quotations`, `crm_quotation_items`, `crm_quotation_milestones`, `crm_quotation_revisions`, `crm_quotation_audit_events`) | **Implementing in B4A** (`/api/v1/quotations*`)                                                       | Pending B4B                                          | Leads (`crm_leads`), WhatsApp (`crm_whatsapp_logs`), Deals (`crm_deals`) | Medium               | High (historical quotes must never change if package price changes)                   |          **B4A/B4B**          |
| **02** | **Sales Studio & Demos**                 | Reusable WhatsApp templates (follow-up, quote, sample, custom), interactive website demo catalog, categorized portfolios, Business Profile                                       | `WaTemplate`, `Demo`, `demoCategories`, `BusinessProfile` (`studio.ts`)                                  | `localStorage` (`waTemplates`, `demos`, `demoCategories`, `businessProfile`)                     | None                                                                                                                                                                              | None                                                                                                  | None                                                 | WhatsApp Composer, Settings, Studio                                      | Low                  | Low (mostly static templates & portfolio links)                                       |            **B4C**            |
| **03** | **Projects & Milestones (Project Desk)** | Deal-to-Project handoff, project stages (`discovery`→`design`→`dev`→`qa`→`handover`→`support`), checklists (reqs, qa, handover), dependencies, links, notes                      | `Project`, `ProjectMilestone`, `ProjectTemplate` (`projects.ts`, `projectStore.ts`)                      | MariaDB 11.4                                                                                     | `crm_projects`, `crm_project_milestones`, `crm_project_templates`, `crm_project_audit_events`                                                                                     | Implemented in B5A (`/api/v1/projects*`, `/api/v1/project-milestones*`, `/api/v1/project-templates*`) | Pending B5B                                          | Deals (`crm_deals`), Leads (`crm_leads`), Employees (`crm_users`/team)   | High                 | High (stage history, task references, delivery credentials)                           | **B5A (Backend) / B5B (UI)**  |
| **04** | **Tasks & Deliverables**                 | Milestone-linked tasks, priority (`low`→`high`), assignees, due dates, completion toggle, task history, deliverables & historical revisions                                      | `ProjectTask`, `ProjectDeliverable`, `DeliverableRevision` (`projects.ts`, `projectStore.ts`)            | MariaDB 11.4                                                                                     | `crm_project_tasks`, `crm_project_deliverables`, `crm_project_deliverable_revisions`                                                                                              | Implemented in B5A (`/api/v1/tasks*`, `/api/v1/deliverables*`)                                        | Pending B5B                                          | Projects (`projects`), Milestones (`projectMilestones`), Employees       | Medium               | Medium (broken milestone or project links if IDs shift)                               | **B5A (Backend) / B5B (UI)**  |
| **05** | **Support Requests**                     | Client support tickets, coverage type (`undecided`, `included`, `billable`), priorities, resolutions, resolution notes enforcement                                               | `SupportRequest` (`projects.ts`, `projectStore.ts`)                                                      | MariaDB 11.4                                                                                     | `crm_client_support_tickets`                                                                                                                                                      | Implemented in B5A (`/api/v1/support-tickets*`)                                                       | Pending B5B                                          | Projects (`projects`), Leads (`crm_leads`), Employees                    | Medium               | Low                                                                                   | **B5A (Backend) / B5B (UI)**  |
| **06** | **Personal Notes**                       | Scratchpad, pinned notes, color labeling, optional lead tagging                                                                                                                  | `Note` (`notes.ts`, `types.ts`)                                                                          | `localStorage` (`notes`)                                                                         | None                                                                                                                                                                              | None                                                                                                  | None                                                 | Leads (`crm_leads`)                                                      | Low                  | Low (unstructured markdown text)                                                      |            **B4E**            |
| **07** | **Dashboard & Sales KPIs**               | Aggregated pipeline cards, conversion funnel, revenue forecast, source ROI, cycle times, lost deal reasons                                                                       | Pure calculation over Leads, Deals, Payments (`analytics.ts`)                                            | In-memory computed                                                                               | N/A (Derived)                                                                                                                                                                     | Exists (`/finance/summary`)                                                                           | Partial (Pilot header)                               | Leads, Deals, Payments, Activities                                       | Low                  | Low (pure derived views; server APIs already calculate integer paise)                 |            **B4E**            |
| **08** | **Sales Goals & My Performance**         | Target setting (revenue, deals, calls, leads), timeframes, goal revisions, automated goal alerts, coaching insights                                                              | `GoalDef`, `GoalRevision`, `GoalAlert`, `PerfPrefs` (`performance.ts`, `ownerPerformance.ts`)            | `localStorage` (non-Pilot) / MariaDB (Pilot)                                                     | `crm_sales_goals`, `crm_sales_goal_revisions`                                                                                                                                     | **B6A** (`/api/v1/goals*`)                                                                            | **B6B** (`/my-performance?pilot=1`)                  | Employees, Calls, Deals, Payments                                        | Medium               | Low (independent target metrics)                                                      |   **B6A/B6B (Pilot Done)**    |
| **09** | **Smart Inbox & Lead Deduplication**     | Lead intake review queue, duplicate detection flags, manual resolution pairs (`same_person`, `same_company`, `different_lead`), immutable audit trail | `InboxMeta`, `LeadRelation` (`inbox.ts`, `store.ts`)                                                     | `localStorage` (non-Pilot) / MariaDB (Pilot)                                                     | `crm_lead_inbox_items`, `crm_duplicate_candidates`, `crm_lead_relationships`, `crm_lead_relationship_history`                                     | **B9A** (`/api/v1/inbox*`, `/api/v1/inbox/candidates*`, `/api/v1/inbox/scan`, `/api/v1/inbox/review`, `/api/v1/inbox/flag`, `/api/v1/inbox/review-history`, `/api/v1/leads/:id/relationships*`) | **B9B** (`/inbox?pilot=1`, `/leads/:id?pilot=1`)   | Leads (`crm_leads`), Activities (`crm_lead_activities`), Follow-ups (`crm_follow_ups`) | Low                  | Low (server prevents automatic merge; Owner reviews relationships explicitly)         | **B9A / B9B (Pilot Done)** |
| **10** | **Sales Automation Studio**              | Event triggers (`lead.created`, `stage.changed`, `no_contact_days`), condition matching, deterministic simulation, immutable revision history, automated internal reminder tasks | `AutomationRule`, `Reminder`, `AutomationRun`, `AutomationSettings` (`automation.ts`)                    | `localStorage` (non-Pilot) / MariaDB (Pilot)                                                     | `crm_automation_rules`, `crm_automation_rule_revisions`, `crm_automation_runs`, `crm_internal_reminders`                                                                         | **B10A** (`/api/v1/automations*`, `/api/v1/automations/definitions`, `/api/v1/automations/:id`, `/api/v1/automations/:id/revisions`, `/api/v1/automations/:id/simulate`, `/api/v1/automations/:id/duplicate`) | **B10B** (`/automation?pilot=1`)                     | Leads, Projects, Follow-ups, Employees                                   | High                 | High (unintended execution or duplicate reminder generation; safe simulation foundation in B10A) | **B10A / B10B (Pilot Done)** |
| **11** | **Custom Fields, Tags & Saved Views**    | Dynamic schema extensions (11 types: `text`, `number`, `currency`, `select`, `multiselect`, `date`, `boolean`, `longtext`, `email`, `url`, `phone`), entity tags with color taxonomy, custom filter presets (20 operators), pinned views | `CustomFieldDef`, `FieldValues`, `TagDef`, `LeadTags`, `SavedView`, `ViewPrefs` (`customize.ts`)         | `localStorage` (non-Pilot) / MariaDB (Pilot)                                                     | `crm_custom_fields`, `crm_custom_field_values`, `crm_tags`, `crm_lead_tags`, `crm_saved_views`                                                     | **B8A** (`/api/v1/custom-fields*`, `/api/v1/tags*`, `/api/v1/saved-views*`, `/api/v1/leads/:id/custom-fields`, `/api/v1/leads/:id/tags`, `/api/v1/leads/bulk-tag`) | **B8B** (`/crm-config?pilot=1`, `/leads?pilot=1`, `/leads/:id?pilot=1`)            | Leads (`crm_leads`), Projects (`projects`)                               | High                 | Critical (custom field values belong to leads; server validates & persists atomically) | **B8A / B8A-QA / B8B (Pilot Done)** |
| **12** | **Settings & Owner Preferences**         | Company branding, owner contact details, GSTIN, currency, India timezone configuration, daily briefing checklist                                                                 | `Prefs`, `BusinessProfile` (`types.ts`, `studio.ts`)                                                     | `localStorage` (prefs/device UI) / MariaDB (Pilot business config)                               | `crm_owner_settings`, `crm_settings_audit_events`                                                                                                                                 | **B6A** (`/api/v1/settings*`)                                                                         | **B6B** (`/settings?pilot=1`, `/crm-config?pilot=1`) | System-wide presentation                                                 | Low                  | Low                                                                                   |   **B6A/B6B (Pilot Done)**    |
| **13** | **Team CRM & Permissions**               | Employee accounts, simulated role previews (Executive, Closer, Support), scoped access rules, lead assignment                                                                    | `Employee`, `EmployeeAccess`, `Assignment`, `AssignmentEvent`, `AssignmentRule` (`team.ts`, `access.ts`) | `localStorage` (`employees`, `employeeAccess`, `assignments`, `assignmentRules`)                 | Table exists (`crm_users`), relations pending                                                                                                                                     | None                                                                                                  | None                                                 | Leads, Deals, Projects, Tasks                                            | High                 | High (security gate: employee credentials and data filtering must be server-enforced) |            **B5C**            |
| **14** | **Data Vault & Backups**                 | Comprehensive 30-entity inventory, 3-tier classification, synthetic ZIP backup generation, cryptographic inspection, dry-run zero-mutation preview, architecture blockers matrix | `BackupRecord` (`vault.ts`), IndexedDB (`proofRepo.ts`), `ValidationReport`, `DryRunReport`              | `localStorage` (`backupHistory`) + IndexedDB / MariaDB (Backup Engine)                           | Schema exists (`crm_payment_proofs`, 38 tables)                                                                                                                                   | Foundation Done (B7A/B7A-QA)                                                                          | **B7B/B7B-QA (Pilot Done)** (`/data-vault?pilot=1`)  | All modules                                                              | High                 | High (large binary payloads and database dump generation)                             | **B7A / B7B / B7B-QA (Done)** |

---

## 3. Deep-Dive Audit of the Quotation System

### 3.1 Existing Quotation Capabilities in CRM 2.0

1. **Sales Studio Quotation Packages (`QuotationTemplate`):**
   - Global, reusable packages created once by the Owner.
   - Attributes: `id`, `name`, `priceType` (`fixed` vs `custom`), `priceAmount` (in Rupees), `priceLabel` (e.g. "On request"), `currency` (`"INR"`), `messageBody` (WhatsApp template), `isActive`, `sortOrder`, `createdAt`, `updatedAt`.
   - Placeholder interpolation: `{clientName}`, `{firstName}`, `{companyName}`, `{projectType}`, `{packageName}`, `{packagePrice}`, `{ownerName}`, `{businessName}`.
   - Commercial safeguards: Rupee amounts written in the body that mismatch the saved package price are flagged with warnings (`priceMismatch`).
   - Optimistic concurrency: Stale package edits in multiple browser tabs throw `StaleRecordError`.

2. **Client Quotation Shares (`QuotationShare`):**
   - Generated exclusively through the WhatsApp Composer when the Owner picks a quotation package and confirms `"I sent it — log to history"`.
   - Attributes: `id`, `leadId`, `templateId`, `packageNameSnapshot`, `priceSnapshot`, `messageSnapshot`, `userConfirmedSent`, `createdAt`.
   - **Crucial Immutability Invariant:** Once a quotation is shared with a client, editing the original package template later **must never change** the client's historical quotation snapshot.

3. **Legacy Invoicing Quotations (`LegacyQuotation`):**
   - Pre-v3 structured quotation records preserved read-only in `store.ts` (`legacyQuotations`).
   - Attributes: `id`, `number`, `leadId`, `clientName`, `company`, `title`, `issueDate`, `validUntil`, `items` (`{ id, description, qty, unitPrice }[]`), `discountType` (`flat` vs `percent`), `discount`, `gstEnabled`, `gstRate`, `paymentTerms`, `notes`, `status`, `createdAt`, `updatedAt`.
   - Users can view these old quotations or click `"Use as package"` to convert them into a modern package template.

4. **The "Three-Package Quotation" Status:**
   - Referenced in `docs/owner-frontend-readiness-ai-9b.md`: During earlier manual testing, the Owner created three real packages in their local browser storage (e.g., ₹25,000 / ₹45,000 / ₹95,000).
   - These packages exist only in the Owner's browser `localStorage`.
   - **Safety Rule:** Synthetic tests must never overwrite or delete the Owner's local packages. In B4A, backend tables and APIs will support both reusable packages and issued client quotations without altering browser state.

---

## 4. Frontend vs. Backend Quotation Contract Mapping

To guarantee **zero dropped fields**, the proposed database schema maps every property from `QuotationTemplate`, `QuotationShare`, and `LegacyQuotation`:

| Frontend Property (CRM Store)     | Source Entity | MariaDB Column (`crm_*`)               | Data Type         | Precision & Constraints                                                              | Notes                                  |
| :-------------------------------- | :------------ | :------------------------------------- | :---------------- | :----------------------------------------------------------------------------------- | :------------------------------------- |
| `id`                              | All           | `id`                                   | `VARCHAR(64)`     | Primary Key (`qtpl_...`, `quot_...`)                                                 | Stable server-generated UUID/ULID      |
| `ownerUserId`                     | Context       | `owner_user_id`                        | `VARCHAR(64)`     | FK `crm_users(id)` ON DELETE RESTRICT                                                | Enforces strict multi-tenant isolation |
| `leadId`                          | Quote/Share   | `lead_id`                              | `VARCHAR(64)`     | FK `crm_leads(id)` ON DELETE SET NULL                                                | Optional client association            |
| `dealId`                          | Deal link     | `deal_id`                              | `VARCHAR(64)`     | FK `crm_deals(id)` ON DELETE SET NULL                                                | Optional deal association              |
| `templateId`                      | Share         | `template_id`                          | `VARCHAR(64)`     | FK `crm_quotation_templates(id)` ON DELETE SET NULL                                  | Reusable package origin                |
| `legacyId`                        | Legacy        | `legacy_id`                            | `VARCHAR(64)`     | Unique Index                                                                         | Preserves pre-v3 quote identifier      |
| `number`                          | Legacy        | `quotation_number`                     | `VARCHAR(64)`     | Unique per Owner                                                                     | e.g., `QT-2026-0001` or legacy number  |
| `title` / `name`                  | All           | `title`                                | `VARCHAR(255)`    | Not Null                                                                             | Package or quotation title             |
| `clientName`                      | Legacy        | `client_name`                          | `VARCHAR(128)`    | Not Null                                                                             | Cached from Lead or entered            |
| `company`                         | Legacy        | `client_company`                       | `VARCHAR(128)`    | Nullable                                                                             | Client company name                    |
| `priceType`                       | Package       | `price_type`                           | `VARCHAR(32)`     | `"fixed"` \| `"custom"`                                                              | Package pricing mode                   |
| `priceAmount`                     | Package       | `price_amount_paise`                   | `BIGINT UNSIGNED` | Paired with `price_type='fixed'`                                                     | Exact integer paise                    |
| `priceLabel`                      | Package       | `price_label`                          | `VARCHAR(128)`    | Nullable                                                                             | e.g., "On request"                     |
| `currency`                        | All           | `currency`                             | `VARCHAR(8)`      | Default `'INR'`                                                                      | ISO currency code                      |
| `messageBody` / `messageSnapshot` | Package/Share | `message_body`                         | `TEXT`            | Not Null                                                                             | Markdown body with tokens              |
| `items[].description`             | Line Item     | `crm_quotation_items.description`      | `VARCHAR(500)`    | Not Null                                                                             | Deliverable description                |
| `items[].qty`                     | Line Item     | `crm_quotation_items.quantity`         | `DECIMAL(10,2)`   | Default `1.00`                                                                       | Support fractional units               |
| `items[].unitPrice`               | Line Item     | `crm_quotation_items.unit_price_paise` | `BIGINT UNSIGNED` | Exact integer paise                                                                  | Unit rate in paise                     |
| `subtotal`                        | Calc          | `subtotal_paise`                       | `BIGINT UNSIGNED` | Exact integer paise                                                                  | Sum of item totals                     |
| `discountType`                    | Legacy        | `discount_type`                        | `VARCHAR(16)`     | `"none"` \| `"flat"` \| `"percent"`                                                  | Discount calculation rule              |
| `discount`                        | Legacy        | `discount_value`                       | `DECIMAL(15,2)`   | Default `0.00`                                                                       | Percentage or Rupee amount             |
| `discountPaise`                   | Calc          | `discount_paise`                       | `BIGINT UNSIGNED` | Exact integer paise                                                                  | Computed discount in paise             |
| `taxableAmount`                   | Calc          | `taxable_amount_paise`                 | `BIGINT UNSIGNED` | Exact integer paise                                                                  | `subtotal_paise - discount_paise`      |
| `gstEnabled`                      | Legacy        | `gst_enabled`                          | `BOOLEAN`         | Default `false`                                                                      | Explicit opt-in only                   |
| `gstRate`                         | Legacy        | `gst_rate`                             | `DECIMAL(5,2)`    | Default `0.00`                                                                       | User-entered GST % (e.g. 18.00)        |
| `gstAmount`                       | Calc          | `gst_amount_paise`                     | `BIGINT UNSIGNED` | Exact integer paise                                                                  | Computed GST in paise                  |
| `total`                           | Calc          | `total_amount_paise`                   | `BIGINT UNSIGNED` | Exact integer paise                                                                  | Authoritative quotation total          |
| `milestones`                      | Schedule      | `crm_quotation_milestones`             | Relational rows   | Percentage + paise                                                                   | Sum must equal 100% / total            |
| `paymentTerms`                    | Legacy        | `payment_terms`                        | `TEXT`            | Nullable                                                                             | e.g. "50% advance, 50% delivery"       |
| `notes`                           | Legacy        | `notes`                                | `TEXT`            | Nullable                                                                             | Internal notes or terms                |
| `status`                          | All           | `status`                               | `VARCHAR(32)`     | `"draft"` \| `"sent"` \| `"accepted"` \| `"rejected"` \| `"expired"` \| `"archived"` | Lifecycle state                        |
| `issueDate`                       | Legacy        | `issue_ist_date`                       | `CHAR(10)`        | YYYY-MM-DD                                                                           | Business date in IST                   |
| `validUntil`                      | Legacy        | `valid_until_ist_date`                 | `CHAR(10)`        | YYYY-MM-DD                                                                           | Business expiration date               |
| `userConfirmedSent`               | Share         | `user_confirmed_sent`                  | `BOOLEAN`         | Default `false`                                                                      | Manual confirmation gate               |
| `version`                         | Concurrency   | `version`                              | `INT`             | Default `1`                                                                          | Optimistic locking token               |
| `archivedAt`                      | Archival      | `archived_at`                          | `DATETIME(3)`     | Nullable                                                                             | Non-destructive soft delete            |
| `createdAt` / `updatedAt`         | Timestamps    | `created_at` / `updated_at`            | `DATETIME(3)`     | UTC UTCDateTime                                                                      | ISO audit timestamps                   |

---

## 5. Strategic Phase Roadmap

Following B4A Quotation Backend completion:

1. **Checkpoint B4B:** Server-Backed Quotations Pilot UI (`/sales-studio?pilot=1` or `/quotations?pilot=1`), allowing live creation and package editing in development mode with zero localStorage touch.
2. **Checkpoint B4C:** Sales Studio WhatsApp Templates (`crm_wa_templates`), Interactive Demos (`crm_demos`), and Business Profile (`crm_business_profiles`).
3. **Checkpoint B4D:** Projects Desk (`crm_projects`, `crm_project_milestones`, `crm_project_tasks`, `crm_support_requests`).
4. **Checkpoint B4E:** Personal Notes (`crm_notes`) and pure server-side Analytics engine.
5. **Checkpoint B4F:** Sales Goals (`crm_goals`), Coaching Insights, and Smart Inbox Deduplication (`crm_inbox_meta`, `crm_lead_relations`).
6. **Phase B5:** Automations (`crm_automation_rules`), Custom Fields & Tags cutover, Team CRM server authentication, Data Vault server backup and final local storage cutover.

---

## 6. Checkpoint B6A / B6B Addendum (10 Nov 2026)

- **B6A Backend (`a84dfd0`):** Implemented MariaDB tables (`crm_owner_settings`, `crm_settings_audit_events`, `crm_sales_goals`, `crm_sales_goal_revisions`) and authenticated Owner Settings & Goals APIs (`/api/v1/settings*`, `/api/v1/goals*`).
- **B6B Pilot UI:** Connected `/settings?pilot=1`, `/crm-config?pilot=1`, and `/my-performance?pilot=1` Sales Goals to B6A APIs inside the development Pilot while keeping browser-local preferences (`scale-flow-crm-2-demo`, sidebar keys) and custom fields/tags/saved views cleanly separated or deferred. See [docs/crm-b6b-settings-goals-ui-pilot.md](./crm-b6b-settings-goals-ui-pilot.md) for the complete Field-by-Field Compatibility Matrix.

---

## 7. Checkpoint B7A Addendum (10 Nov 2026) — Data Vault, Backup Integrity & Safe Migration Foundation

- **B7A Foundation Implemented (`src/server/backup/`):**
  - **Complete 11-Column Data Inventory:** Documented all 30 persisted CRM entities across MariaDB (38 tables) and browser-local storage (`scale-flow-crm-2-demo`).
  - **Deterministic Backup v2 Specification:** Canonical JSON stringification, SHA-256 content hashes, recursive credential/secret scrubbing, and exact integer paise financial summaries.
  - **Comprehensive Validation Engine:** Defends against zip slips, path traversal, bomb limits (512MB, 5000 entries, 200:1 ratio), file tampering, duplicate IDs, broken foreign keys, and binary attachment checksum mismatches.
  - **Non-Destructive Dry-Run Engine:** Verifies candidate backups without writing a single row (`mutationsPerformed: 0`, `databaseWritten: false`).
  - **Migration Mapping & Disposable Restore:** Deterministic legacy ID translation and transactional disposable DB restore with full rollback.
  - **Storage Durability Audit:** Flagged `ObjectStorageProofStorage` local-fs fallback as a production blocker requiring genuine S3/R2 provisioning prior to production cutover.
  - **Test Suite:** 113 test files passing, 1,085 automated tests passing (45 new B7A tests across 5 test suites covering 30 mandatory foundation scenarios).
- **Scope Deferred to B7B:** Production-facing Data Vault UI, live backup download endpoint, interactive restore wizard, and live migration execution. See [docs/crm-b7a-data-vault-backup-foundation.md](./crm-b7a-data-vault-backup-foundation.md).

---

## 8. Checkpoint B10C Addendum (11 Nov 2026) — Safe Internal Automation Execution Engine & Reliability Verification

- **Branch:** `feat/b10c-safe-internal-automation-execution`
- **Database Migrations:** Forward migration `0013_b10c_automation_execution.sql` applied additively to `crm_automation_runs`:
  - `execution_key VARCHAR(128)`: SHA-256 deterministic hash of `(ownerUserId:sourceEventId:ruleId:ruleVersion:actionIndex:targetId:customTagId)`.
  - `rule_version INT`: Snapshot of the rule version at time of execution authorization.
  - `causation_id VARCHAR(128)`: Traceability identifier for event lineage.
  - `depth INT NOT NULL DEFAULT 0`: Depth tracker enforcing `MAX_EXECUTION_DEPTH = 3`.
  - Unique Constraint: `uq_crm_auto_runs_owner_exec_key` on `(owner_user_id, execution_key)` guaranteeing O(1) deduplication and zero duplicate executions.
  - Total MariaDB Tables: **48 tables** (cleanly verified via Drizzle kit check).
- **Approved Internal Actions Supported:**
  1. `followup`: Creates pending synthetic follow-up in `crm_follow_ups` (`op_id = executionKey`, `active_lead_lock = leadId`, IST date/time calculated, `nextFollowUpAt` updated on `crm_leads`, `crm_lead_activities` logged). Preserves zero lead stage change, zero deal creation, and zero fabricated call log.
  2. `reminder`: Creates pending CRM reminder in `crm_internal_reminders` (`reminder_key = rem_<hash>`, `origin = 'automation'`, `status = 'open'`). Explicit invariant: non-delivery strictly verified (no SMS, WhatsApp, push, or email sent).
  3. `tag`: Links active tag in `crm_lead_tags` (`uq_crm_lead_tags_lead_tag` prevents duplicates). Rejects non-existent or archived tags with HTTP 400 `validation_error`.
- **Simulation vs. Execution Write Boundaries:**
  - `simulateAutomationRuleRecord` writes ONLY audit records to `crm_automation_runs` (`is_simulation: 1`, `outcome: "simulated"`, `executed_actions_json: "[]"`) and updates `last_evaluated_at` on `crm_automation_rules`. Zero writes to `crm_leads`, `crm_follow_ups`, `crm_internal_reminders`, `crm_deals`, `crm_payments`, `crm_call_logs`, or `crm_whatsapp_logs`.
  - `executeAutomationRuleRecord` writes business records atomically alongside `crm_automation_runs` (`is_simulation: 0`, `outcome: "succeeded"`), populating `execution_key` and created record IDs.
- **Reliability & Idempotency Guarantees:**
  - Idempotent Replay: Identical events or reused HTTP idempotency keys return `{ outcome: "skipped", replayed: true }` without duplicate business mutations.
  - Atomic Rollback: Injected failures trigger clean rollback across all business tables. Failed runs log to `crm_automation_runs` with `outcome = "failed"` and `execution_key = null` to permit subsequent corrected retries.
  - Deadlock Recovery: MariaDB InnoDB `ER_LOCK_DEADLOCK` (errno 1213) handled with automatic exponential jitter retries (up to 3 retries).
  - Recursion Guard: Executions exceeding depth 3 are rejected with HTTP 400 `automation_validation_error`.
- **Environment & Runtime Feasibility:**
  - Development Test Harness Only: Execution is gated behind `POST /api/v1/automations/:id/execute-test`, requiring Owner authentication, CSRF/Origin validation, and `isLeadPilotAvailable(env) === true`.
  - Unattended Background Engine Deferred: No cron, polling daemon, or background scheduler activated in B10C. Hostinger shared runtime feasibility remains unverified for durable long-running daemons.
  - Isolation: Browser-local storage (`scale-flow-crm-2-demo`), IndexedDB proofs (`scale-flow-payment-proofs`), Hostinger production, and CRM V1 remain 100% untouched.
- **Verification Evidence:**
  - 1,347 Vitest unit & integration tests passing across 133 test files.
  - 60/60 real MariaDB 11.4 + compiled Nitro HTTP verification scenarios passing (`scratch/b10c-execution-results.json`).
  - Stress, concurrency, server restart recovery, and MariaDB index explain plan tests passing (`scratch/run-b10c-stress-restart.mjs`).

