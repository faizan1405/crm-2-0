# B2B3 Server-Backed Call Logging & Lead Activity Integration

> **Status:** Checkpoint B2B3 on local branch `feat/b2b3-call-logging` (branched from committed B2B2 `aedf7ff`).
> **Scope:** Manual dialer launch (`tel:`), explicit user-recorded call outcome logging (`crm_call_logs`), atomic MariaDB lead/activity updates, and optional two-step follow-up scheduling via B2B2 APIs inside the dev-only Lead Pilot.
> **Out of Scope / Protected:** Real telephony APIs, automatic call recording or audio durations, WhatsApp logging, Deals/Payments, Team/Employee auth, OpenRouter AI live integration, bulk browser-local migration, CRM V1 (`faizan1405/CRM`), CRM V2 `main`, and Hostinger production settings.

---

## 1. Database Schema & Forward Migration

Migration [`src/server/db/migrations/0003_b2b3_call_logs.sql`](../src/server/db/migrations/0003_b2b3_call_logs.sql) adds `crm_call_logs` in [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts) (InnoDB, `utf8mb4_unicode_ci`, UTC `DATETIME(3)` timestamps + explicit `Asia/Kolkata` calendar date/time strings):

| Column / Index | Purpose |
| :--- | :--- |
| `id`, `legacy_id`, `owner_user_id`, `lead_id`, `actor_user_id` | Owner-isolated server ID (`call_...`) + FK to `crm_leads` + FK to `crm_users` |
| `outcome`, `connected` (`TINYINT(1)`), `recording_source` | Closed 10-outcome enum; server-derived `connected` (`0` for `Not picked`/`Busy`, `1` otherwise); `recording_source` strictly `'user_recorded'` |
| `notes`, `dial_source` | Optional trimmed call summary (`<= 5000` chars) and UI trigger source (`Lead detail`, `Leads workspace`, `Leads cards`, `Leads`, `Follow-ups`, etc.) |
| `stage_before`, `stage_after`, `quick_status_before`, `quick_status_after` | Exact transition audit captured inside the call transaction |
| `lead_activity_id` | Foreign key to the paired `"call"` entry in `crm_lead_activities` (`ON DELETE RESTRICT`) |
| `op_id`, `idempotency_key` | Unique per `(owner_user_id, op_id)` and `(owner_user_id, idempotency_key)` for safe client retries |
| `occurred_at`, `occurred_ist_date`, `occurred_ist_time` | Server-derived UTC timestamp and `Asia/Kolkata` date/time |

---

## 2. Authenticated Owner REST Endpoints (`/api/v1`)

Implemented in [`src/server/crm/callsService.server.ts`](../src/server/crm/callsService.server.ts) and [`src/server/http/crmRoutes.server.ts`](../src/server/http/crmRoutes.server.ts). All routes enforce active Owner session auth (`401`/`403`/`503`), `owner_user_id` scoping (`404` on foreign/missing records), same-origin CSRF checks (`403`), `Allow` headers on wrong methods (`405`), and `Cache-Control: no-store`.

- `GET /api/v1/calls` — Paginated owner call log across leads with `lead` summary snapshot. Query params: `leadId`, `outcome`, `connected` (`all | true | false`), `dateIst` (`YYYY-MM-DD`), `leadLifecycle`, `limit` (`1..200`), `offset`. Returns `{ ok: true, items, total, limit, offset, summary: { total, connected, attempts } }`.
- `POST /api/v1/calls` — Records one explicit user-confirmed call outcome atomically inside an InnoDB transaction with `Idempotency-Key` support (`scope = "call:create:<leadId>"`):
  - Acquires `FOR UPDATE` lock on `crm_leads`; rejects archived leads (`409 lead_archived`) and `expectedLeadVersion` mismatches (`409 stale_conflict` with `currentVersion`).
  - Mirrors frontend rules from [`src/lib/crm/calllog.ts`](../src/lib/crm/calllog.ts):
    - `"Not picked"` & `"Busy"` set `connected = false` and **leave `crm_leads.last_contact_at` untouched**.
    - Connected outcomes update `last_contact_at = occurred_at` and clear stale `"not_picked"` / `"busy"` `quickStatus` unless the outcome sets its own `quickStatus`.
    - Moving into `"won"` or `"lost"` requires `confirmed: true`; moving into `"lost"` also requires non-empty `lostReason` (`400 validation_error`).
  - Writes `crm_leads` (`version + 1`), inserts `"call"` activity (`"Call ..."` vs `"Call attempt ..."`) plus `"status"` activity when `stageAfter !== stageBefore`, and inserts `crm_call_logs`.
- `GET /api/v1/leads/:id/calls` — Per-lead call logs + `{ total, connected, attempts }` summary (`404` if lead belongs to another user or does not exist).
- `GET /api/v1/calls/:id` — Single `CallLogDto`.
- **Honesty Safeguard Retained:** `POST /api/v1/leads/:id/activities` continues to reject `{ type: "call" }` with `400 activity_type_not_permitted`.

---

## 3. Frontend Contracts & Pilot Workflow Isolation

- **Contracts & API Client:** [`src/lib/api/schemas.ts`](../src/lib/api/schemas.ts) (`callLogDtoSchema` enforces `recordingSource: z.literal("user_recorded")`) and [`src/lib/api/callsApi.ts`](../src/lib/api/callsApi.ts) (`useCallsQuery`, `useLeadCallsQuery`, `useCreateCallMutation`). `useCreateCallMutation` updates lead/call caches and invalidates call, lead, activity, and follow-up queries.
- **Dialer Launcher Isolation (`usePilotCallLauncher` in [`PilotCallDialog.tsx`](../src/components/pilot/PilotCallDialog.tsx)):**
  - Uses `<a href={telHref(lead.phone)}>` (`PilotCallLink`) for manual native dialer launch, storing pending recovery in **tab-scoped `sessionStorage["sf-b2b3-pilot-call-pending"]`** only (cleared on Exit Pilot / Sign Out / Close).
  - Never reads or writes `localStorage["scale-flow-crm-2-demo"]`, `localStorage["scale-flow-call-pending"]`, or IndexedDB `scale-flow-payment-proofs`.
  - Opening the dialer or `"Skip for now"` writes zero rows to MariaDB.
- **Two-Step Call + Optional Follow-up Save:**
  1. Step 1 posts `POST /api/v1/calls`. On `409 stale_conflict`, displays latest server values and offers rebase (`Keep my call log & rebase onto vN`) or reload.
  2. When `"Schedule next follow-up"` Switch (default `false`) is toggled ON, Step 2 posts `POST /api/v1/follow-ups` via B2B2 APIs. Once Step 1 commits, any Step 2 `409 followup_conflict` (Keep existing vs Replace with new) or transient `503` (`Retry follow-up only`) **never** re-submits `POST /api/v1/calls`.
- **Wired Pilot Surfaces:** [`PilotLeadsPage.tsx`](../src/components/pilot/PilotLeadsPage.tsx) (Workspace Inspector, Cards, Ledger `tel:` links), [`PilotLeadDetailPage.tsx`](../src/components/pilot/PilotLeadDetailPage.tsx) (header `Call` / `Log call` + `Calls (MariaDB)` history panel), [`PilotFollowUpsPage.tsx`](../src/components/pilot/PilotFollowUpsPage.tsx) (pending card actions + Inspector sheet), and [`PilotShell.tsx`](../src/components/pilot/PilotShell.tsx).

---

## 4. Production & Hostinger Deployment Safety

- All B2B3 endpoints are standard request-scoped HTTP handlers using bounded pooled InnoDB queries (`<= 20` connections) compatible with Hostinger managed Node.js hosting (no WebSockets, daemons, or Bun APIs).
- `NODE_ENV=production` unconditionally sets `leadPilotAvailable = false` in [`src/server/config/env.server.ts`](../src/server/config/env.server.ts), hiding Pilot UI routes while keeping B2A/B2B3 server endpoints authenticated and fail-closed.
