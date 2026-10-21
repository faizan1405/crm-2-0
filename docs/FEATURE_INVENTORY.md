# Frontend feature inventory

| Route | Working local features |
| --- | --- |
| `/` | Derived open leads, collected/outstanding/overdue, upcoming follow-ups, top leads, briefing navigation |
| `/leads` | Search/filter/sort, pin, stage select, Lost Reason, confirmation deletion, add lead |
| `/leads/$id` | Profile/edit, stage, activity notes, call/WhatsApp/email links, schedule/complete follow-up, linked deals |
| `/pipeline` | Mouse drag across six stages, stage menu alternative, Lost Reason with safe cancellation |
| `/follow-ups` | Overdue/today/upcoming/done lists, scheduling, +1-day reschedule, completion |
| `/deals` | CRM/independent clients, create multiple deals, final/quoted amounts, due/paid filters, payments, history, confirmation void |
| `/analytics` | Date ranges/custom validation, received-money trend, all-time finance, funnel/stages/sources, follow-up performance |
| `/daily-briefing` | Rule-based priorities, date-scoped checklist, filters, refresh, calls/proposals/payment chase, quick actions |
| `/notes` | Create/edit/search/pin/unpin, local persistence, confirmation delete |
| `/settings` | Local profile, theme/accent/density/date/time/sort preferences, stored notification choices, JSON export, confirmation demo reset |

Shared: desktop sidebar, mobile navigation/More menu, light/dark/system themes, responsive tables/charts/forms, toast feedback, per-route title/description/social metadata.

Quick AI is explicitly a **deterministic demo parser**, not a connected AI model. It extracts recognizable fields; missing fields stay blank, ambiguous follow-up expressions are raw hints requiring confirmation. Review fields are editable. Duplicate saves require explicit checkbox consent; cancellation discards the form.

## Not implemented
Actual accounts/security/session/logout, real AI extraction/scoring, delivery of reminders/emails/push/digests, external data persistence/sync, user/team roles, imports, backend errors/loading/conflict handling. Telephone/email/WhatsApp links launch external clients; delivery and call success are not verified.

Milestone arrays exist in the model but there is no milestone editor or allocation UI. Deal editing/cancellation is not a dedicated workflow. Rescheduling currently means +1 day, not an arbitrary reschedule dialog. The briefing checklist does not mark real follow-ups complete.