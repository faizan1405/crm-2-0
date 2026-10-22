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
- `formatINRCompact` is hand-rolled (K/L/Cr) — Intl compact output differs between server and browser.
- Navigation is a collapsible graphite left sidebar in Shell (grouped Workspace/Business/Personal/System; collapse state in its own localStorage key) plus a minimal top utility bar for global actions; mobile uses a slide-out drawer, floating bottom bar and More sheet — primary nav and global actions stay separate.
- Shared CRM presentation belongs in Shell and semantic global CSS; page components preserve store actions and pure calculations so visual redesigns cannot change business behavior.
- The pipeline uses native drag-and-drop with named stage targets and horizontally scrollable columns; mobile stage selectors provide an equivalent touch interaction.
- Every WhatsApp action uses the shared `WhatsAppComposer` (`openWhatsApp`/`WhatsAppButton`) with drafts from pure `whatsapp.ts` — one modal, no direct wa.me links, nothing marked sent automatically.
- Sales Studio data (quotations, WhatsApp templates, demos, business profile) lives in the same CRM store; the WhatsApp composer builds drafts only via pure `composeDraft`/`syncDraft` in `studio.ts` — one source of truth, edited drafts are never overwritten silently.
- Quotations are independent of deals/payments; no code path converts or syncs them automatically — keeps quoted, confirmed and received money separate.
