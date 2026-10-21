# Scale Flow CRM 2.0 — architecture

## Actual stack
TanStack Start v1 / TanStack Router, React 19, TypeScript, Vite 8 (installed project dependency), Tailwind CSS v4, Zustand 5, Recharts 2, Radix/shadcn controls, Sonner, Vitest 4 and JSDOM. This is **not Next.js**; integrating the original Next.js CRM requires an explicit adapter or migration, not copying its route conventions.

## Boundaries
- `src/routes/`: content pages and per-page head metadata; `__root.tsx` hosts Outlet and Toaster. Generated routeTree is not edited manually.
- `src/components/crm/`: Shell, add-lead and shared dialogs. `src/components/ui/`: reusable design-system controls.
- `src/lib/crm/types.ts`: entity contracts and enum labels.
- `demo.ts`: literal demo fixtures; dates pinned to October 2026, not a rolling dataset.
- `store.ts`: sole data/actions/preference source, Zustand persistence under `scale-flow-crm-2-demo`, version 2. No API calls. Shell hydrates it after mount and applies theme/date preferences.
- `finance.ts`: collected, outstanding, payment status, overdue, summary; `insights.ts`: deterministic priorities/chase; `parse.ts`: demo text extraction; `dates.ts`: business calendar/range/input conversion; `validation.ts`: edit rules.
- Vitest tests live beside the pure modules and store, with a route-match test in `src/test`.

Browser storage is device-local, not secure, shared, transactional or backed up. All validation must be repeated server-side when the real data layer arrives. It is not production authentication or database persistence.

## Business semantics currently implemented
Valid non-voided payments are received money; outstanding is max(final amount minus valid payments, zero). Cancelled deals are excluded from summaries and chase. Completed/on-hold contracts remain collectible if unpaid: completion means delivery state, not automatically settlement. Due dates are date-only; follow-ups are instants. All calendar display/range rules use Asia/Kolkata. Local datetime inputs convert explicitly from IST, independent of device timezone.

The existing finance overdue rule compares the due date's midnight instant against now. End-of-business-day grace periods are not implemented; agree this policy before backend migration.

Store edit actions synchronize linked deal client names/companies, require a Lost Reason, reject duplicate phone changes, and clear old Lost Reasons on reopening. Duplicate **creation** remains permitted only through the UI's explicit confirmation. Follow-up mutations recalculate the earliest pending date on the lead. Payment actions reject invalid/cumulative overpayments. Briefing checkmarks are date-scoped and separate from actual follow-up completion.

No original CRM repository, Neon database or Hostinger deployment was modified. No separate user-facing GitHub repository was created/connected, and the project remains unpublished.