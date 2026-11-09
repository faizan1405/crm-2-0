# CRM V2 — Checkpoint B2B4: Server-Backed WhatsApp Composer & Confirmed Message Logging

> **Branch:** `feat/b2b4-whatsapp-logging` (branched from completed B2B3 commit `1a39b96`)
> **Scope:** Extend the development-only MariaDB Pilot (`NODE_ENV !== "production" && DEV_LEAD_PILOT === true`) with server-backed WhatsApp message preparation, `wa.me` external launch, explicit Owner send confirmation (`owner_confirmed_sent`), atomic Lead Activity synchronization, and optional two-step Follow-up scheduling.
> **Non-Goals:** No WhatsApp Business API integration, no automated message sending, no delivery/read-receipt claims, no automatic logging on click, and zero mutation or reading of browser-local `localStorage` (`scale-flow-crm-2-demo`, `scale-flow-call-pending`) or IndexedDB (`scale-flow-payment-proofs`).

---

## 1. End-to-End Honest Workflow

```text
Server-Backed Lead (MariaDB)
  → Open Pilot WhatsApp Composer (built-in purpose draft hydrated from server lead + auth Owner)
  → Owner edits message & clicks "Open in WhatsApp" (opens https://wa.me/91XXXXXXXXXX?text=... in external tab)
  → Composer enters explicit confirmation step (nothing is saved to MariaDB on click)
  → Owner chooses:
      • "Not sent / Keep editing" → returns to draft editor, 0 DB writes
      • "Close without logging" → closes composer, clears tab-scoped session draft, 0 DB writes
      • "I sent it — Log to MariaDB" → atomic InnoDB transaction writes:
          1. `crm_whatsapp_logs` row (`confirmation_status = 'owner_confirmed_sent'`)
          2. Paired `crm_lead_activities` row (`type = 'whatsapp'`)
          3. `crm_leads.version = version + 1` & `updated_at = NOW()` (leaving `last_contact_at` unchanged)
          4. Optional Step 2 `POST /api/v1/follow-ups` when "Schedule next follow-up (MariaDB IST)" is enabled
```

---

## 2. Database Schema (`0004_b2b4_whatsapp_logs.sql`)

Table `crm_whatsapp_logs` in [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts):

| Column | Type | Purpose & Constraints |
| :--- | :--- | :--- |
| `id` | `varchar(64) PK` | Server-generated ID (`wa_...`) |
| `owner_user_id` | `varchar(64) NOT NULL` | FK → `users.id` (`ON DELETE RESTRICT`) |
| `lead_id` | `varchar(64) NOT NULL` | FK → `crm_leads.id` (`ON DELETE CASCADE`) |
| `actor_user_id` | `varchar(64) NOT NULL` | Derived strictly from authenticated Owner session |
| `legacy_id` | `varchar(128) NULL` | Reserved for B4 Data Vault import (`uq_crm_wa_logs_owner_legacy`) |
| `purpose` | `varchar(32) NOT NULL` | Closed enum: `'followup' \| 'quotation' \| 'samples' \| 'custom'` |
| `template_id` | `varchar(128) NULL` | Optional built-in template identifier |
| `template_name` | `varchar(160) NULL` | Optional template title snapshot |
| `recipient_phone` | `varchar(24) NOT NULL` | Normalized 12-digit Indian WhatsApp number (`91[6-9]\d{9}`) verified against the locked server lead |
| `message_text` | `text NOT NULL` | Trimmed message body (`1..4096` chars) |
| `composer_source` | `varchar(64) NOT NULL` | UI surface (`Lead detail`, `Leads workspace`, `Leads cards`, `Follow-ups`, `Follow-ups inspector`) |
| `confirmation_status` | `varchar(32) NOT NULL` | Strictly `'owner_confirmed_sent'` (never `'delivered'`, `'verified_sent'`, or `'read'`) |
| `lead_activity_id` | `varchar(64) NOT NULL` | FK → `crm_lead_activities.id` (`ON DELETE RESTRICT`) |
| `op_id` | `varchar(128) NULL` | Optional client operation ID (`uq_crm_wa_logs_owner_op`) |
| `idempotency_key` | `varchar(128) NULL` | Request idempotency key (`uq_crm_wa_logs_owner_idem`) |
| `confirmed_at` | `datetime(3) NOT NULL` | Server UTC timestamp when Owner confirmed send |
| `confirmed_ist_date` | `char(10) NOT NULL` | `Asia/Kolkata` date (`YYYY-MM-DD`, indexed via `idx_crm_wa_logs_owner_ist_date`) |
| `confirmed_ist_time` | `char(5) NOT NULL` | `Asia/Kolkata` time (`HH:mm`) |
| `created_at` / `updated_at` | `datetime(3) NOT NULL` | Server UTC audit timestamps |

---

## 3. Honesty & Security Rules

1. **No Delivery or Two-Way Contact Fabrication:**
   - Opening `wa.me` or copying text never writes a database record.
   - Confirming an outgoing message sets `confirmationStatus: "owner_confirmed_sent"`. Any payload with `confirmedSent !== true` or `confirmationStatus !== "owner_confirmed_sent"` is rejected with `400 validation_error`.
   - Confirming an outgoing WhatsApp message **never updates `crm_leads.last_contact_at`**, `status`, or `quick_status` — only two-way connected calls update `last_contact_at`.
2. **Direct Activity Endpoint Protection Preserved:**
   - `POST /api/v1/leads/:id/activities` continues to allow only manual `"note" | "meeting" | "email"` entries and rejects `{ type: "whatsapp" }` with `400 activity_type_not_permitted`.
   - Paired `"whatsapp"` timeline entries can only be created transactionally through `POST /api/v1/whatsapp-messages`.
3. **Pure Template Hydration Without `localStorage`:**
   - Pilot composer hydrates built-in templates from [`src/lib/crm/salesStudio.ts`](../src/lib/crm/salesStudio.ts) (`builtInTemplates()`, `composeDraft`, `syncDraft`) and [`src/lib/crm/whatsapp.ts`](../src/lib/crm/whatsapp.ts) (`waNumber`, `waLink`) using the server `LeadDto` and authenticated Owner session (`authUser.name`).
   - Custom Sales Studio quotation packages and demo libraries remain browser-local until the Sales Studio backend checkpoint and are clearly disclosed in the composer when `Quotation` or `Samples / Demos` is selected.
4. **Two-Step Follow-up Recovery Without Duplicate Message Logs:**
   - When `Schedule next follow-up (MariaDB IST)` is toggled on in the confirmation panel, Step 1 (`POST /api/v1/whatsapp-messages`) commits first and stores `savedMessage`.
   - If Step 2 (`POST /api/v1/follow-ups`) encounters `409 followup_conflict` or `503 crm_unavailable`, the modal displays `savedMessage` as permanently committed and retries or resolves (`Keep existing` / `Replace with new`) **only Step 2**, never re-posting Step 1.
