# Antigravity + Hostinger Backend Handover — CRM V2
Specification only. **No backend has been written or deployed.** Do not start without explicit Owner approval. Do not touch CRM V1 or its GitHub repository.

## A. Existing frontend architecture
- **Framework:** TanStack Start v1 (React 19, TanStack Router file routes), Vite 7, Tailwind CSS v4, TypeScript strict, vitest (701 tests).
- **Routes (`src/routes`):** `/` dashboard, `/inbox`, `/leads`, `/leads/$id`, `/leads/bin`, `/pipeline`, `/follow-ups`, `/ai-copilot`, `/deals`, `/projects`, `/projects/$id`, `/sales-studio`, `/notes`, `/my-performance`, `/analytics`, `/daily-briefing`, `/team-performance`, `/team-activity`, `/team`, `/team/preview/$id`, `/team/workspace/$id`, `/automation`, `/crm-config`, `/data-vault`, `/settings`, `/login`.
- **State:** one zustand store `src/lib/crm/store.ts` (with `projectStore.ts` slice) persisted via a guarded localStorage adapter; this store is the single swap point for a real API. Store actions already enforce validation, version checks and record synchronisation.
- **Browser storage:**
  - localStorage `scale-flow-crm-2-demo` (store, schema version 10, migrations v3–v10)
  - localStorage `scale-flow-call-pending` (call awaiting outcome)
  - localStorage `scale-flow-sidebar-collapsed`, `scale-flow-sidebar-groups` (UI preferences only)
  - IndexedDB `scale-flow-payment-proofs` (proof files, `proofRepo.ts`)
  - AI conversations: in memory only (`src/lib/ai/copilotStore.ts`)
- **Cross-tab safety:** `crossTab.ts` and `lastKnownRaw` refresh memory before commits; projects, tasks and support requests carry `version` and refuse stale saves.
- **Entities (`types.ts`, `projects.ts`, `studio.ts`):** Lead → LeadActivity, FollowUp, QuotationShare, WhatsApp sends; Lead → Deal (Milestones) → Payment (proof ref, void flag); Deal → Project → ProjectTask, ProjectMilestone, SupportRequest, history; Note; QuotationTemplate, WaTemplate, BusinessProfile; Employee, roles/permissions (`session.ts`, `access.ts`, `team.ts`); automation rules; activity events (`activity.ts`, `eventSource` incl. `demo`); BinEntry.
- **Financial functions (`finance.ts`):** `dealCollected`, `dealOutstanding`, `isDealOverdue`, `dealPaymentStatus`, `financeSummary`; plus `projects.ts` ProjectFinance and `ownerPerformance.ts`. Voided payments excluded everywhere; India time (`dates.ts`).
- **Import/export & Data Vault (`vault.ts`, `bulk.ts`, `bulkImport.ts`, `docExtract.ts`):** Owner-only full export, employee-scoped export (`employeeScope`, `scrub`), manifest checks (`manifestProblems`, `entryPathError`, `LIMITS`), backup verify. Full restore is **not** implemented.

## B. Required secure backend
| Need | Notes from current code |
|---|---|
| Owner authentication | Replace local session in `session.ts`; Owner = `OWNER_ACTOR_ID` today |
| Employee authentication | Employee Preview is simulated; real accounts later |
| Server-managed sessions | HTTP-only cookies; no tokens in localStorage |
| Server-side authorization | Mirror `ROUTE_PERM`, `routeAllowed`, `access.ts`; roles in a separate table, checked on every request |
| Central database (MySQL on Hostinger) | Tables per entity in §A; keep `version`, `createdAt`, `updatedAt`, `schema` columns |
| Lead & activity sync | Append-only activity table with actor id and `eventSource` |
| Deals & Payments | Payment insert + deal totals in one DB transaction; voids as status, never delete |
| Proof files | Private object storage, signed short-lived URLs, size/type checks |
| Projects & Support | Optimistic concurrency on `version` (409 on mismatch → existing "Reload latest / Apply my change" UI) |
| Multi-device concurrency | Same version contract for all editable records |
| Backup & restore | Server snapshots; restore into a staging copy first, then verified swap |
| Scheduling | Server cron for automations and follow-up reminders (today runs in the browser, `automationRunner.ts`) |

Suggested API shape: REST under `/api/v1/<entity>` with list/get/create/update(version)/void; all responses validated with the existing `validation.ts` rules re-implemented server-side.

## C. OpenRouter integration
Flow: **CRM frontend → authenticated backend → permission checks → OpenRouter → validated response → frontend review.**
- API key in server-side secrets only; never in the browser bundle or storage.
- Model name configurable server-side; per-user daily request and token limits.
- Log tokens, cost, model, latency per request (no prompt bodies with personal data in logs).
- Timeout ~30 s, at most 2 retries with backoff; clear user-facing errors; fall back to Demo provider text labelled as such.
- Minimise context: reuse permission-aware `buildLeadContext` / per-feature context builders; never send payment proofs, passwords, credentials or unrelated customers.
- Responses validated (length, schema, money/date guards already in `financeAssist.ts`, `quoteWriter.ts`, `rewrite.ts`).
- AI never writes CRM data; every result is a draft the Owner explicitly applies. Swap is one place: `getProvider()` in `src/lib/ai/demoProvider.ts` behind `types.ts` contracts.

## D. Real AI capabilities
Need a real provider: Sales Copilot, Lead Intelligence explanations, Call Prep/Objection Coach, Notes Assistant, WhatsApp Improve, Quotation Writer, Follow-up Writer, Smart Follow-up explanations, Bulk Import extraction (text and OCR), Project AI, Support AI, Finance AI wording, Daily Briefing/Coach wording.
Must stay deterministic (never replaced by a model): financial totals and statuses, payment validation, dates/time zones, duplicate detection, KPI and rate formulas, stage age/stall flags, permission checks, overdue rules, money/date guards on drafts.

## E. Migration & deployment safety
- CRM V1 and its repository stay untouched; CRM V2 deploys separately (own domain/subdomain, own database).
- Migration: Owner exports from Data Vault → server imports into a **staging** database → counts and finance totals reconciled against `recordCount` and `financeSummary` → Owner signs off → switch.
- Rollback: keep the browser export and the pre-import DB snapshot; switching back = re-point to the previous build; never delete source data.
- Proof files must be exported separately from IndexedDB (not in localStorage).
- No overwriting live data; imports are idempotent by record id.
- No production changes have been made by this checkpoint.
