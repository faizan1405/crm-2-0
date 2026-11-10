# Checkpoint B6B — Server-Backed Owner Settings, Sales Goals & Performance Targets UI

> **Repository:** `https://github.com/faizan1405/crm-2-0.git`  
> **Branch:** `feat/b6b-owner-settings-goals-ui-pilot` (branched from B6A commit `a84dfd0`)  
> **Scope:** Server-backed UI integration for Owner Settings (`/settings?pilot=1`), CRM Configuration Boundary Directory (`/crm-config?pilot=1`), and My Performance Sales Goals (`/my-performance?pilot=1`) inside the isolated development Pilot, backed exclusively by B6A MariaDB APIs.  
> **Non-Scope Enforced:** Non-Pilot browser-local screens, `scale-flow-crm-2-demo` Zustand storage, `scale-flow-payment-proofs` IndexedDB proofs, and production deployments (`NODE_ENV=production`) remain untouched and strictly isolated. Dual-writing and silent local fallback are prohibited.

---

## 1. End-to-End Architecture & Isolation Guarantees

The B6B Pilot delivers the full workflow:

**Owner Settings → Configure Sales Goals → Save to MariaDB → Measure Actual Performance → Track Goal Progress → Review Historical Changes**

### Key Architectural Guarantees

1. **Server-Enforced Feature Gate (`useLeadPilotState` / `resolveLeadPilotActive`):**
   - Route entry wrappers (`SettingsEntry` in `src/routes/settings.tsx`, `CrmConfigEntry` in `src/routes/crm-config.tsx`, `MyPerformanceEntry` in `src/routes/my-performance.tsx`) check `useLeadPilotState(search.pilot)` before mounting either `<AppShellSkeleton />`, Pilot components, or local CRM `<Shell />`.
   - When `NODE_ENV=production` or `DEV_LEAD_PILOT !== true`, `serverAvailable` is `false`; neither `?pilot=1` nor `sessionStorage` can activate Pilot screens or APIs.
   - Zero automatic migration/import from `scale-flow-crm-2-demo`, zero dual-writing to Zustand, and zero silent fallback to browser-local state on API failures.

2. **Typed API Clients & Surgical React Query Caching:**
   - [`src/lib/api/settingsApi.ts`](../src/lib/api/settingsApi.ts): Zod-validated client & React Query hooks (`settingsKeys`) scoped per authenticated Owner (`authUser?.id`) for `GET/PUT/PATCH /api/v1/settings`, `GET /api/v1/settings/definitions`, and `GET /api/v1/settings/audit`.
   - [`src/lib/api/goalsApi.ts`](../src/lib/api/goalsApi.ts): Zod-validated client & React Query hooks (`goalsKeys`) scoped per Owner for `GET/POST /api/v1/goals`, `GET /api/v1/goals/progress`, `GET/PATCH /api/v1/goals/:id`, `POST /api/v1/goals/:id/status`, `POST /api/v1/goals/:id/archive`, `GET /api/v1/goals/:id/revisions`, and `GET /api/v1/goals/:id/progress`.
   - Updating settings invalidates only `settingsKeys.current(ownerId)` and `settingsKeys.auditRoot(ownerId)`. Mutating goals invalidates only `goalsKeys.allForOwner(ownerId)` (list, detail, revisions, progress). Unrelated CRM/Lead/Finance/Project queries are never invalidated.
   - All mutations pass CSRF-safe `origin` / cookie credentials (`same-origin` via `apiRequest`), explicit `expectedVersion` concurrency tokens, and stable per-save `idempotencyKey` strings regenerated only on edit/discard/reload/save completion.

3. **Explicit Validation, Unconfigured Honesty & Exact INR Paise Arithmetic:**
   - `PilotSettingsPage` represents unset MariaDB columns as explicitly `"Not configured"` with dedicated `Clear` buttons that serialize cleared optional strings to `null` (distinct from `""` or server defaults), preserves unsaved drafts across internal tab switches (`profile` ↔ `crm` ↔ `notifications`), and blocks accidental navigation/unload via `useBlocker({ withResolver: true, enableBeforeUnload: () => isDirty })` with a save/discard prompt.
   - `PilotGoalDialog` validates monetary INR targets strictly to integer paise via string parsing (`parseGoalTargetInput` in `goalsApi.ts`, zero IEEE-754 float drift) and supports explicit `"Leave target unset (not configured)"` (`target: null`). No default `₹1,00,000` goal target is ever synthesized.
   - `PilotGoalsSection` renders native `<progress className="pf-progress">` strictly when `progress.measurable && progress.pct !== null`, omitting progress bars and rendering `"N/A"` / `"Target not configured"` whenever targets are unset, paused, archived, future-effective, or have zero/null denominators.
   - Stale version conflicts (`409 stale_conflict`) present explicit `"Reload server ..."` (discard local) and `"Keep my edits & rebase"` (rebase draft onto latest server `version`) recovery actions without overwriting newer server edits.
   - Security errors (`forbidden_setting_key`, secret-pattern rejection `400`, or immutable archived goal errors `409`) map cleanly to inline field/form alerts.

4. **Business Configuration vs. Device-Local Display Boundary:**
   - [`PilotShell.tsx`](../src/components/pilot/PilotShell.tsx) adds `(Pilot)` navigation links to `/settings?pilot=1` and `/crm-config?pilot=1`.
   - `PilotSettingsPage` exposes a dedicated `Device preferences` section cleanly separated from the `Save settings` form: dark/light display toggle lives on the browser (`scale-flow-crm-2-demo` / `scale-flow-sidebar-*`), never persisted to MariaDB or written to Zustand from business form saves.
   - `PilotCrmConfigPage` exposes read-only protected pipeline invariants (`Asia/Kolkata`, `INR`, `leadStatuses`, `leadSources`, `defaultLeadSortOptions`) from `/api/v1/settings/definitions`, links to existing MariaDB quotation/project template endpoints, and honestly discloses deferred modules (`customFields`, `tags`, `savedViews`, WhatsApp/demo libraries) without reading `localStorage`.

---

## 2. Phase 3 Field-by-Field Compatibility Matrix

Every existing CRM settings, preference, configuration, and goal field audited across `src/routes/settings.tsx`, `src/routes/crm-config.tsx`, `src/routes/my-performance.tsx`, `src/lib/crm/store.ts`, `src/lib/crm/performance.ts`, and `src/lib/crm/customize.ts` is classified into one of the five mandatory categories:

| Field / Capability | Source (Local CRM / UI) | Classification | B6A / Pilot Backing & UI Handling |
| :--- | :--- | :--- | :--- |
| `owner` (`ownerDisplayName`) | `store.ts` (`s.owner`) | **1. Server-backed business setting** | `crm_owner_settings.owner_display_name`; editable in `PilotSettingsPage` (`profile`); unset stays `null`. |
| `business` (`businessName`) | `store.ts` (`s.business`) | **1. Server-backed business setting** | `crm_owner_settings.business_name`; editable in `PilotSettingsPage` (`profile`). |
| `email` (`profileEmail`) | `store.ts` (`s.email`) | **1. Server-backed business setting** | `crm_owner_settings.profile_email` (server-normalized lowercase); editable in `PilotSettingsPage`. |
| `businessProfile.phone` | `studio.ts` (`BusinessProfile`) | **1. Server-backed business setting** | `crm_owner_settings.business_phone` (7–15 digits regex validated). |
| `businessProfile.website` | `studio.ts` (`BusinessProfile`) | **1. Server-backed business setting** | `crm_owner_settings.business_website` (`http://`/`https://` URL validated). |
| `businessProfile.address` | `studio.ts` (`BusinessProfile`) | **1. Server-backed business setting** | `crm_owner_settings.business_address` (max 1,000 chars). |
| `gstin` | `settings.tsx` / `BusinessProfile` | **1. Server-backed business setting** | `crm_owner_settings.gstin` (15-char Indian GSTIN regex validated, uppercased). |
| `paymentInstructions` | `studio.ts` (`BusinessProfile`) | **1. Server-backed business setting** | `crm_owner_settings.payment_instructions`; server rejects secret/token-looking payloads (`400`). |
| `prefs.defaultSort` (`defaultLeadSort`) | `store.ts` (`prefs`) | **1. Server-backed business setting** | `crm_owner_settings.default_lead_sort` (`recent` \| `score` \| `value`); editable in `PilotSettingsPage` (`crm`). |
| Goal & reminder notification toggles (`notifyFollowUps`, `notifyPayments`, `notifyDigest`, `notifyGoalAchieved`, `notifyTeamGoal`, `notifyMilestone`, `notifyOverdue`, `overdueThreshold`) | `store.ts` (`notifyPrefs` / `perfPrefs`) | **1. Server-backed business setting** | Persisted in `crm_owner_settings`; editable in `PilotSettingsPage` (`notifications`). Outbound push/email delivery remains inactive. |
| `businessTimezone`, `currencyCode`, pipeline `leadStatuses`, `leadSources` | `crm/format.ts`, `crm/types.ts` | **1. Server-backed business setting (Read-Only Invariant)** | Served read-only by `GET /api/v1/settings/definitions` (`Asia/Kolkata`, `INR`, 6 stages, 13 sources); non-editable via Settings. |
| Goal `name`, `scope`, `period` (`daily`, `weekly` Mon–Sun IST, `monthly`, `custom`), `customFromIst`/`customToIst`, `effectiveFromIst`, `status` (`active`, `paused`, `archived`) | `performance.ts` (`GoalDef`) | **2. Server-backed measurable goal** | `crm_sales_goals` + immutable `crm_sales_goal_revisions`; full create/edit/pause/resume/archive/revision-history workflow in `PilotGoalsSection`, `PilotGoalDialog`, `PilotGoalHistoryDrawer`. |
| Goal target (`target` exact INR decimal string or whole integer count or `null`) | `performance.ts` (`GoalDef.target`) | **2. Server-backed measurable goal** | Saved to `target_amount_paise` (`BIGINT UNSIGNED`) or `target_count`; explicitly supports `null` (not configured) with no hidden ₹1,00,000 default. |
| Goal metrics (`calls_logged`, `calls_connected`, `followups_completed`, `leads_created`, `leads_contacted`, `leads_qualified`, `deals_booked`, `deals_booked_value`, `cash_collected`, `quotations_created`, `quotations_sent`, `projects_completed`) | `ownerPerformance.ts` / `performance.ts` | **2. Server-backed measurable goal** | Calculated server-side by `goalsCalc.server.ts` from authoritative MariaDB records in `Asia/Kolkata` (`GET /api/v1/goals/progress`). |
| `theme`, `accent`, `density`, `timeFormat`, `dateStyle` | `store.ts` (`prefs`) | **3. Device-local UI preference** | Kept strictly local on device; never sent to MariaDB or overwritten by `PilotSettingsPage`. |
| Sidebar collapsed / open nav groups (`scale-flow-sidebar-collapsed`, `scale-flow-sidebar-groups`) | `Shell.tsx` / `navGroups.ts` | **3. Device-local UI preference** | Device-local UI state preserved across sessions on each browser independently. |
| Daily briefing checked state (`briefingDone`, `briefingDate`), table/saved filter UI prefs (`viewPrefs`), `team` preview UI state | `store.ts` | **3. Device-local UI preference** | Local browser session/display preferences outside B6A schema. |
| Custom Lead & Project Fields (`customFields`, `fieldValues`) | `crm-config.tsx` / `customize.ts` | **4. Not supported by B6A; deferred** | Disclosed as deferred boundary in `PilotCrmConfigPage`; never fabricated or imported from `localStorage`. |
| Tags & Tag Assignments (`tagDefs`, `leadTags`) | `crm-config.tsx` / `customize.ts` | **4. Not supported by B6A; deferred** | Disclosed as deferred boundary in `PilotCrmConfigPage`. |
| Saved Pipeline Views (`savedViews`) | `crm-config.tsx` / `customize.ts` | **4. Not supported by B6A; deferred** | Disclosed as deferred boundary in `PilotCrmConfigPage`. |
| WhatsApp Templates (`waTemplates`) & Demo Catalog (`demos`) | `studio.ts` | **4. Not supported by B6A; deferred** | Outside B6A; quotation & project templates point to existing server endpoints (`/api/v1/quotation-templates`, `/api/v1/project-templates`). |
| Employee-scoped goals (`scope: "employee"`) | `performance.ts` | **4. Not supported by B6A; deferred** | B6A goals only allow `owner` or org `team`; employee target attribution deferred. |
| Owner authentication credentials, active sessions, idle expiry, `Sign out all devices` | `authClient.ts`, `settings.tsx?section=security` | **5. Security-sensitive (separate subsystem)** | Handled exclusively via `crm_users`/`crm_sessions` & `/api/v1/auth/*` (`Security & sessions` view in `PilotSettingsPage`). |
| Server secrets (`AUTH_SECRET`, `DATABASE_URL`, `OPENROUTER_API_KEY`, private paths, `DEV_LEAD_PILOT`) & validation/authz rules | Server env & validation modules | **5. Security-sensitive (separate subsystem)** | Never exposed to Settings UI; blocked by `FORBIDDEN_SETTING_KEYS` + secret pattern detector. |
| IndexedDB Payment Proofs (`scale-flow-payment-proofs`) & JSON Data Vault (`vault.ts`) | `proofRepo.ts`, `data-vault.tsx` | **5. Security-sensitive (separate subsystem)** | Payment proofs use `crm_payment_proofs` + private FS; local Data Vault export stays isolated outside Pilot Settings. |

---

## 3. Files Added & Updated

### Client API & Validation Contracts
- [`src/lib/api/schemas.ts`](../src/lib/api/schemas.ts) — Added Zod response schemas & TypeScript types for Owner Settings, Settings Definitions, Settings Audit Events, Sales Goals, Goal Revisions, and Goal Progress (`staleConflictSchema` extended cleanly).
- [`src/lib/api/errors.ts`](../src/lib/api/errors.ts) — Added `extractSettingsOrGoalFieldErrors`, `extractForbiddenSettingKey`, and `isArchivedGoalError`.
- [`src/lib/api/settingsApi.ts`](../src/lib/api/settingsApi.ts) — Typed settings client, diff builder (`buildSettingsDiffPayload` with explicit `null` clear support), field validator, and Owner-scoped React Query hooks.
- [`src/lib/api/goalsApi.ts`](../src/lib/api/goalsApi.ts) — Typed goals client, exact-paise decimal parsing/Indian formatting helpers, IST calendar helpers, safe zero-denominator percentage formatting, and Owner-scoped React Query hooks.

### Pilot UI & Routing
- [`src/components/pilot/PilotShell.tsx`](../src/components/pilot/PilotShell.tsx) — Added `Settings (Pilot)` (`/settings`) and `CRM Config (Pilot)` (`/crm-config`) navigation items, active route matching, and updated banner/breadcrumbs.
- [`src/components/pilot/PilotSettingsPage.tsx`](../src/components/pilot/PilotSettingsPage.tsx) — Full server-backed Business Settings, GSTIN, Lead Sort, Notification Preferences, `useBlocker` dirty-draft guard, `409 stale_conflict` reload/rebase, immutable Settings Audit History viewer, Device Preferences boundary, and Auth session security controls.
- [`src/components/pilot/PilotCrmConfigPage.tsx`](../src/components/pilot/PilotCrmConfigPage.tsx) — Read-only server invariants, template endpoint links, and deferred customization disclosure.
- [`src/components/pilot/PilotGoalsSection.tsx`](../src/components/pilot/PilotGoalsSection.tsx) — Live MariaDB Goal tracking section with `asOf` IST date picker, Status/Metric/Period filters, `Show archived` toggle, exact INR/count target vs actual/remaining displays, `<progress>` bars (only when measurable), Pause/Resume, Edit, History, and Archive workflow.
- [`src/components/pilot/PilotGoalDialog.tsx`](../src/components/pilot/PilotGoalDialog.tsx) — Create/Edit goal dialog with paise preview, `"Leave target unset"` support, IST custom range validation, optimistic locking rebase, and idempotent submit.
- [`src/components/pilot/PilotGoalHistoryDrawer.tsx`](../src/components/pilot/PilotGoalHistoryDrawer.tsx) — Slide-over revision timeline (`crm_sales_goal_revisions`) plus read-only archive summary.
- [`src/components/pilot/PilotMyPerformancePage.tsx`](../src/components/pilot/PilotMyPerformancePage.tsx) — Replaced B5D static deferred notice with `<PilotGoalsSection unknownWonDatesCount={...} />` and wired header Refresh to invalidate goals progress alongside B5D performance queries.
- [`src/routes/settings.tsx`](../src/routes/settings.tsx) & [`src/routes/crm-config.tsx`](../src/routes/crm-config.tsx) — Added `parsePilotSearch` and gate-safe `SettingsEntry` / `CrmConfigEntry` switchers plus optional dev-only entry buttons.
- [`src/styles.css`](../src/styles.css) — Added native `.pf-progress` bar styling rules (`lines 1009-1013`).

### Tests
- [`src/lib/api/settingsGoalsApi.b6b.test.ts`](../src/lib/api/settingsGoalsApi.b6b.test.ts) — Unit & React Query hook tests (5 tests).
- [`src/test/settings-goals-pilot.b6b.test.tsx`](../src/test/settings-goals-pilot.b6b.test.tsx) — Component & route isolation tests (5 tests).
- [`src/test/analytics-pilot.b5d.test.tsx`](../src/test/analytics-pilot.b5d.test.tsx) — Updated B5D performance Pilot test mocks to serve `/api/v1/settings/definitions` and `/api/v1/goals/progress` cleanly alongside existing B5D assertions (4 tests).

---

## 4. Verification Summary

1. **Live B6A MariaDB 11.4.13 Preflight (Disposable Instance `127.0.0.1:13307`):**
   - Verified all B6A Settings & Goals canonical endpoints (`GET/PUT/PATCH /api/v1/settings`, `/definitions`, `/audit`, `GET/POST /api/v1/goals`, `/goals/progress`, `/goals/:id`, `/status`, `/archive`, `/revisions`), optimistic locking `409`, unknown/secret key rejection (`400`), exact paise calculation, Mon–Sun IST weekly bounds, B5D unchanged reporting, Owner A/B multi-tenant isolation, and `NODE_ENV=production` Pilot gate disablement.
2. **TypeScript, Drizzle Schema & ESLint:**
   - `npm run db:check` → passed (`Everything's fine`).
   - `npm run typecheck` (`tsc --noEmit`) → passed with **0 errors** (strict `exactOptionalPropertyTypes` enforced).
   - `npx eslint` across all B6B `.ts`/`.tsx` files → **0 errors**.
3. **Full Automated Test Suite (`npm test` / `vitest run`):**
   - **108 test files passed (108/108), 1,040 tests passed (1,040/1,040)** — including all new B6B tests (`settingsGoalsApi.b6b.test.ts`, `settings-goals-pilot.b6b.test.tsx`), updated B5D tests, and all B6A server HTTP/calc tests.
4. **Production Build (`npm run build`):**
   - Clean client + Nitro SSR bundle built via `scripts/build-prod.mjs`.
5. **Real Headless Chrome CDP End-to-End Verification (`b6b-browser-e2e.mjs` against disposable MariaDB 11.4.13 & compiled Nitro server):**
   - Verified real Owner sign-in, `/settings?pilot=1` unset → configured → reload persistence → change history audit, `/crm-config?pilot=1` boundary view, `/my-performance?pilot=1` creating exact-paise INR goal (`₹20,000.30` target / `₹10,000.50` actual / `50%` progress), weekly booked value goal with unknown-won-date exclusion disclosure, explicitly unconfigured goal (`Target not configured`, zero default ₹1,00,000), tomorrow-effective goal revision & History drawer timeline, Pause/Resume toggle, Owner B isolated HTTP check, byte-for-byte preservation of seeded `scale-flow-crm-2-demo` localStorage & `scale-flow-payment-proofs` IndexedDB, zero browser console/runtime exceptions, zero HTTP 5xx, zero horizontal overflow at desktop (`1440×900`) and mobile (`390×844`) viewports, and verified `NODE_ENV=production DEV_LEAD_PILOT=true` disables `?pilot=1` and serves only local screens.
