<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All CRM data and preferences live in one zustand store (`src/lib/crm/store.ts`, persisted to localStorage); pages derive everything from it — it is the single swap point for a real backend.
- Business rules live in pure modules (`finance.ts`, `insights.ts`, `parse.ts`, `dates.ts`, `validation.ts`) with vitest tests — keeps logic testable and backend-agnostic.
- Store actions enforce edit/stage and payment validation and synchronize related records; datetime-local inputs use explicit business-zone conversion — keeps pages consistent regardless of device timezone.
- CRM pages render after mount inside `Shell` — data is browser-local, so this avoids server/browser render mismatches.
- `formatINRCompact` is hand-rolled (K/L/Cr) — Intl compact differs server vs browser.
- Navigation is a collapsible graphite left sidebar in Shell (grouped Workspace/Business/Personal/System; collapse state in its own localStorage key) plus a minimal top utility bar for global actions; mobile uses a slide-out drawer, floating bottom bar and More sheet — primary nav and global actions stay separate.
- Shared CRM presentation belongs in Shell and semantic global CSS; page components preserve store actions and pure calculations so visual redesigns cannot change business behavior.
- The pipeline uses native drag-and-drop with named stage targets plus per-card stage selects for touch; clicking a card opens an inspector selected via the `?lead=` search param (docked at ≥1280px, portaled overlay/bottom sheet below); stage age and stall flags come only from recorded stage-change activity via pure `pipeline.ts` — no invented ages.
- Every WhatsApp action uses the shared `WhatsAppComposer` (`openWhatsApp`/`WhatsAppButton`) with drafts from pure `whatsapp.ts` — one modal, no direct wa.me links, nothing marked sent automatically.
- Sales Studio data (quotation packages, WhatsApp templates, demos, business profile) lives in the same CRM store; the WhatsApp composer builds drafts only via pure `composeDraft`/`syncDraft` in `studio.ts` — one source of truth, edited drafts are never overwritten silently.
- Quotations are global reusable package templates (`quotationTemplates`) plus user-confirmed share snapshots (`quotationShares`); they never touch deals, payments or follow-ups, and old billing quotations live only in a read-only `legacyQuotations` backup (persist v3 migration) — keeps sales messages separate from money.
- Payment proof files live in IndexedDB behind the `ProofRepo` interface (`proofRepo.ts`), keyed one-per-payment and never in localStorage or the zustand store; validation is pure in `attachments.ts` — proofs are evidence only and never affect finance, and the repo is the swap point for private Hostinger storage.
- Personal Notes use one long-lived Tiptap editor (StarterKit trimmed to paragraphs/bold/italic/lists + TaskList) storing sanitized JSON in `Note.doc` with `body` regenerated as plain text; legacy notes convert on read via pure `notes.ts` and autosave goes through `autosave.ts` — no store migration needed, nothing lost, and the editor never remounts while typing.
- Team Management keeps employee profiles in the CRM store (`employees`) with pure rules/contracts in `team.ts`; `demoAuth` never authenticates and no password/hash/token/session field may be stored — real auth, permissions and session revocation belong to the future Hostinger backend.
- Permissions, lead assignment and assignment rules are pure in `access.ts` (resolve: Owner → owner-only lock → employee override → role preset → deny); assignments live in a separate `assignments` map keyed by lead id so assigning never edits Lead business data; real enforcement belongs to the Hostinger backend.
- Employee Workspace Preview (`preview.ts` + `session.ts`) runs the real CRM pages on a scoped in-memory working copy: persistence and Shell rehydration pause while it runs, store actions are permission-guarded via the `GUARDS` map in `store.ts`, Shell filters nav/pages via `routeAllowed`, and exit restores the Owner snapshot — keeps one CRM codebase and guarantees Owner data is never written during a preview; it is never a login.
- Data Vault backups are built by pure `vault.ts` (fflate ZIP + SHA-256 manifest, credential keys scrubbed, employee scope = currently assigned leads) and only reported successful after self-validation; restore is read-only until the backend exists — never a false "complete" backup.
- Bulk selection/distribution is pure in `bulk.ts` (ids or matching-snapshot minus exclusions; equal/balanced/custom) and applied only via store `applyAssignmentPlan`, which re-checks each item and reports skips; Undo via snapshot.
- Team Activity events come only from `activity.ts` `deriveEvents` in the store wrapper (outer Owner action, never preview), deduped by eventId; demo events stay in component memory.
- Goals/metrics are pure in `performance.ts`: contribution = events by that actor only (else "Not measurable yet"), assignment = workload; goal edits add revisions — honest metrics, stable history.
- Smart Inbox rules are pure in `inbox.ts` (country-aware phone match; name+company = suggestion only); review/duplicate state lives in `inboxMeta`/`leadRelations`, never on Lead; merge stays disabled until the backend can move linked records atomically.
- Automation rules are pure in `automation.ts` (idempotency key rule|target|signature + cooldown), applied by store `runAutomations` and run only by `automationRunner.ts` while the app is open (never in preview); contact = saved call outcomes/confirmed sends only; `opId` "auto:" rows never re-trigger.
- Custom fields, tags and Saved Views are pure in `customize.ts` (values keyed by stable field ids, never on Lead; views are versioned JSON filters run by `runView`); archived fields keep values and dependent views/automations warn instead of changing meaning.
