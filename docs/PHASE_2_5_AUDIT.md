# Phase 2.5 audit — 21 October 2026

## Result
Frontend audit completed with focused corrections; original production CRM untouched. Latest automated run: **30 tests passed across 5 test files**, not a percentage-based coverage claim. Preview build reports build OK; the supplied `src/lib/utils.ts(8,7) TS2322` could not be reproduced: the current helper is seven lines and returns the normal `twMerge(clsx(inputs))` string. It was not changed without evidence.

## Browser scenarios executed (Chromium)
All activity used fresh isolated local browser demo state at localhost, not production.

| Scenario | Result |
| --- | --- |
| Actual mouse drag new → qualified → proposal; Lost cancellation and Lost Reason save; Leads stage readback | Passed |
| Edit name/phone/company, duplicate phone rejection, stage update, reload, Pipeline/Details/Leads visibility | Passed |
| Notes create/edit/search/pin/unpin/reload; cancel delete and confirmed delete | Passed |
| Follow-up select lead/type/date/time, schedule, +1-day reschedule, complete, reload | Passed; IST instant checked from an America/New_York browser |
| Other-client deal with no lead, partial/multiple/full payments, attempted overpay, reload, void | Passed |
| Collected totals across Dashboard/Deals/Analytics after void | Passed: ₹320,000 collected in all three; ₹265,000 outstanding in derived fixture state |
| Payment chase in Daily Briefing after void | Passed |
| Valid/missing/duplicate phone parser cases, separate budget/quote, ambiguous date hint, edited preview save | Passed |
| Missing optional fields save, cancellation without save, explicit duplicate checkbox creation | Passed in follow-up runner |
| Reversed custom date range | Passed: visible validation error |
| 9 pages × 360/390/768/1024/1440 widths using baseline demo | 45 checks; Settings 768 overflow found and corrected |
| Same widths/routes with 300 leads, long unbroken name and 15,000-character note; themes, mobile menu, add-lead dialog bounds | Final 45-check rerun passed with zero document overflow and zero runtime errors |

Initial runner failures were selector/navigation issues (ambiguous Done button, sidebar New lead unavailable after navigation, target selector, absent localStorage before first mutation), not product failures. Corrected runners re-exercised those paths. No page runtime errors in the completed interaction/stress runs. This is Chromium testing, not cross-browser certification.

## Corrections
- Edit duplicate validation, valid Indian phone handling, Lost Reason protection and clearing on reopened leads.
- Synchronization of linked deal client names/companies and earliest pending follow-up after schedule/reschedule/completion.
- Atomic-at-local-action-boundary cumulative overpayment rejection and payment date checks; void accounting unchanged and verified.
- Device-independent IST follow-up input conversion; date-only analytics range/buckets, reversed range feedback, completed series uses completion timestamp.
- Cancelled/orphan deal payments excluded from range revenue to match existing summary eligibility.
- Briefing checkmarks scoped to business day; future planned follow-ups no longer falsely described as no plan.
- Notes confirmation deletion, correct edit clearing, distinct pin/unpin labels; connected labels for tested forms.
- Settings tablet overflow and long-text overflow corrected without changing the design system; analytics filter controls wrap.
- Leaf-route social metadata and safe optional field typing; no TypeScript non-null assertions introduced.

## Automated scope
7 finance tests, 7 parser tests, 5 calendar tests, 10 store/consistency/persistence tests, 1 route-match test. Concrete tests cover multiple deals, independent clients, voided payments, no-due-date/fully-paid/overdue balances, duplicate edits, Lost Reason, linked edits, schedule/reschedule/completion, cumulative overpayments, rehydration, next-day checks, calendar rollover and IST conversion.

## Remaining gaps / limits
- No real auth, AI, database, reminders, notifications or production deployment. See INTEGRATION_TODO.
- Multi-deal same-client synchronization is tested at store level; browser finance flow creates one independent deal. Real multi-user/concurrent payment races await backend tests.
- Manual keyboard/screen-reader/contrast certification, Safari/Firefox, exhaustive every-form-at-every-width checks and performance profiling are not complete. Large lists render without virtualization; no rerender-count benchmark was taken.
- Existing persisted malformed/imported records are not repaired by this audit; new action validation is not a full import validator.
- Completed/on-hold balances remain collectible under existing semantics; due-date grace period and refund rules await agreement.
- Separate user-facing GitHub repository: not created or connected. No source export or production sync performed.

Architecture, inventory, entity/action contracts and independent integration checklist are in the adjacent documents. This is ready for Antigravity backend development with the listed requirements, not ready to claim production service functionality.