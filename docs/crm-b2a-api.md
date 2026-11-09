# B2A Core CRM Schema & Lead/Follow-up APIs

> Scope: Checkpoint B2A on local branch `feat/b2a-core-crm-api` (branched from committed B1B `3dc10d4`). Existing browser-local CRM stores (`scale-flow-crm-2-demo`, `scale-flow-payment-proofs`) and frontend Lead/Follow-up routes remain completely untouched until Checkpoint B2B. CRM V1 (`faizan1405/CRM`) and CRM V2 `main` remain untouched.

## 1. Database Schema & Migrations

Migration [`src/server/db/migrations/0001_b2a_core_crm.sql`](../src/server/db/migrations/0001_b2a_core_crm.sql) extends [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts) (InnoDB, `utf8mb4_unicode_ci`, UTC `DATETIME(3)` timestamps, `DECIMAL(15,2)` money):

| Table                   | Purpose                                               | Key Constraints & Indexes                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm_leads`             | Core Lead records + `waste`/`deleted` lifecycle       | `uq_crm_leads_owner_legacy` (`legacy_id` for B4 migration), `idx_crm_leads_owner_lifecycle_phone`, `idx_crm_leads_owner_lifecycle_email`, `idx_crm_leads_owner_lifecycle_status`, `idx_crm_leads_owner_next_followup`, `idx_crm_leads_owner_created`, `idx_crm_leads_owner_updated`, `version`              |
| `crm_lead_activities`   | Append-only Lead timeline entries                     | `uq_crm_lead_activities_owner_legacy`, `uq_crm_lead_activities_owner_lead_idem`, `idx_crm_lead_activities_lead_occurred`, `idx_crm_lead_activities_owner_occurred`                                                                                                                                          |
| `crm_follow_ups`        | UTC + Asia/Kolkata business-time follow-ups           | `uq_crm_follow_ups_active_lead` on `active_lead_lock` (NULL when completed/cancelled, `lead_id` while pending -> DB-enforced single active follow-up per lead), `uq_crm_follow_ups_owner_op`, `idx_crm_follow_ups_lead_due`, `idx_crm_follow_ups_owner_due`, `idx_crm_follow_ups_owner_ist_date`, `version` |
| `crm_tag_defs`          | Supporting Lead tag catalog                           | `uq_crm_tag_defs_owner_legacy`, `idx_crm_tag_defs_owner_status`                                                                                                                                                                                                                                             |
| `crm_lead_tags`         | Lead <-> tag many-to-many join                        | `uq_crm_lead_tags_lead_tag`, `idx_crm_lead_tags_owner_tag`                                                                                                                                                                                                                                                  |
| `crm_custom_fields`     | Supporting custom field definitions (`entity='lead'`) | `uq_crm_custom_fields_owner_legacy`, `idx_crm_custom_fields_owner_entity`                                                                                                                                                                                                                                   |
| `crm_lead_field_values` | Typed custom field values per Lead                    | `uq_crm_lead_field_values_lead_field`, `idx_crm_lead_field_values_owner_field`                                                                                                                                                                                                                              |
| `crm_idempotency_keys`  | Retry-safe request de-duplication (24h TTL)           | `uq_crm_idempotency_owner_scope_key` (`request_hash` SHA-256 + stored status/response, `scope` widened to `varchar(128)` in `0002`)                                                                                                                                                                     |
| `crm_call_logs`         | User-recorded call outcomes + stage/activity audit (`0003`) | `uq_crm_call_logs_owner_legacy`, `uq_crm_call_logs_owner_op`, `uq_crm_call_logs_owner_idem`, `idx_crm_call_logs_lead_occurred`, `idx_crm_call_logs_owner_ist_date`, FK `lead_activity_id` -> `crm_lead_activities` |

## 2. Authenticated Owner REST Endpoints (`/api/v1`)

All endpoints require an authenticated active Owner cookie session (`401`/`403`/`503` fail closed), enforce `owner_user_id` record scoping (`404` on foreign or missing IDs), check same-origin CSRF headers (`Origin`/`Referer`/`Sec-Fetch-Site` + `application/json` on mutations -> `403`), and return `Cache-Control: no-store`.

### Leads

- `GET /api/v1/leads` — Paginated directory (`q` with safe SQL `LIKE` escaping, `lifecycle`, `status`, `source`, `priority`, `quickStatus`, `followUp`, `createdFrom`/`createdTo` IST calendar day bounds, `tagId`, `sort`, `pinnedFirst`) + pre-`status` `stageCounts`.
- `POST /api/v1/leads` — Creates Lead + initial `"created"` activity + optional `tagIds` & required/optional `fieldValues` transactionally. Rejects active phone/normalized-email collisions with `409 duplicate_lead` (`conflict.matches`) unless `allowDuplicate: true`.
- `GET /api/v1/leads/:id` — Single Lead hydrated with `tagIds` and `fieldValues`.
- `PATCH /api/v1/leads/:id` — Requires `version >= 1` (`409 stale_conflict` on mismatch), enforces `lostReason` when `status === "lost"`, clears `lostReason` when moving off `"lost"`, blocks edits to archived leads (`409 lead_archived`), appends privacy-safe `"edit"` / `"status"` / `"quick"` activities atomically.
- `DELETE /api/v1/leads/:id` — Soft-deletes (`lifecycleStatus = "deleted"`), preserves child activities & follow-ups, appends `"Lead deleted"` activity (`version` checked if supplied).
- `POST /api/v1/leads/:id/archive` — Moves Lead to `"waste"` or `"deleted"` (`version` required, `reason` optional), preserving history/follow-ups.
- `POST /api/v1/leads/:id/restore` — Restores archived Lead if active normalized phone does not collide with another active Lead (`409 duplicate_lead`), re-syncs `nextFollowUp`, appends `"restored"` activity.

### Lead Activities

- `GET /api/v1/leads/:id/activities` — Paginated chronological Lead timeline (`type` filter).
- `POST /api/v1/leads/:id/activities` — Allows ONLY manual interaction types `"note" | "meeting" | "email"`. Direct writes of `"call"`, `"whatsapp"`, `"payment"`, `"followup"`, `"status"`, `"created"`, `"edit"`, `"waste"`, `"restored"`, `"merged"` fail with `400 activity_type_not_permitted`. Derives `actorUserId` and timestamps strictly server-side.

### Follow-ups

- `GET /api/v1/follow-ups` — Enriched agenda list (`bucket`, `dateIst`, `leadId`, `type`, `leadLifecycle`) with IST-bucketed `summary` (`overdue`, `today`, `upcoming`, `done`, `pending`).
- `POST /api/v1/follow-ups` — Parses naive `YYYY-MM-DDTHH:mm` as `Asia/Kolkata` (`+05:30`) or zoned ISO strings while rejecting calendar rollovers (`2026-02-30` -> `400`). Enforces one active pending follow-up per Lead (`409 followup_conflict`) unless `replaceActiveFollowUpId` matches the active record (`409 stale_conflict` if stale). Syncs `crm_leads.next_follow_up_at` and appends `"followup"` activity without fabricating `lastContact`.
- `GET /api/v1/leads/:id/follow-ups` — History + active follow-up ID for a Lead.
- `GET /api/v1/follow-ups/:id` — Single follow-up record.
- `PATCH /api/v1/follow-ups/:id` — Reschedules `dueAt` and/or updates `note` (`version` required).
- `POST /api/v1/follow-ups/:id/complete` — Marks `completedAt`, releases `active_lead_lock`, clears `crm_leads.next_follow_up_at` while preserving `crm_leads.last_contact_at` honestly without fabricating a call/message/meeting contact activity, and appends `"followup"` activity (`409 followup_already_closed` if already closed).
- `POST /api/v1/follow-ups/:id/cancel` — Marks `cancelledAt` & optional `cancelReason`, releases `active_lead_lock`, clears `next_follow_up_at`, preserves `last_contact_at`, appends `"followup"` activity.

### Calls (Added in B2B3, Migration `0003`)

- `GET /api/v1/calls` — Paginated Owner call logs joined with lead summary (`leadId`, `outcome`, `connected`, `dateIst`, `leadLifecycle`) plus `{ total, connected, attempts }` summary.
- `POST /api/v1/calls` — Records one explicit user-confirmed call outcome (`recordingSource: "user_recorded"`) inside an InnoDB transaction with `expectedLeadVersion` optimistic locking (`409 stale_conflict`), stage confirmation/lost-reason checks, atomic `"call"` (+ `"status"`) activity creation, and honest contact tracking (`Not picked`/`Busy` never update `last_contact_at`).
- `GET /api/v1/leads/:id/calls` — Per-lead call history and summary.
- `GET /api/v1/calls/:id` — Single `CallLogDto` (`404` on foreign or missing ID).

## 3. Idempotency & Optimistic Concurrency

- All mutating `POST` / `PATCH` / `DELETE` routes accept the `Idempotency-Key` HTTP header (and body `idempotencyKey` / `opId` where supported).
- Equivalent payloads replay the original status + JSON response (`X-Idempotency-Replayed: true`); reusing the same key with a different canonical request hash returns `409 idempotency_key_mismatch`.
- Mutating Lead and Follow-up updates use row locks (`FOR UPDATE`) + `version` comparison + affected-row verification (`409 stale_conflict`).

## 4. Legacy Fields Intentionally Deferred Beyond B2A

- **B3 (Deals & Finance):** `Deal`, `Payment`, `Milestone`, and IndexedDB `scale-flow-payment-proofs` binaries (`crm_leads.budget` and `crm_leads.quoted_amount` are already present in `crm_leads`).
- **Team CRM (Deferred):** `employees`, `employeeAccess`, `assignments`, `assignmentRules`, `assignmentEvents`, `firedRules`.
- **Inbox / Views / Automations / Post-Call / Notes / Studio / Projects / Goals:** `inboxMeta`, `leadRelations`, `savedViews`, `viewPrefs`, `automationRules`, `reminders`, `automationRuns`, `callOps`, `notes`, `quotationTemplates`, `quotationShares`, `waTemplates`, `demos`, `businessProfile`, `projects`, `goals`, `analytics`.
- **B2B (Next Checkpoint):** Wire frontend Lead/Follow-up UI cleanly to B2A REST APIs behind a controlled adapter while preserving offline-safe UX and explicit Data Vault/localStorage migration rules (B4).
