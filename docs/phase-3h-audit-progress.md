# Phase 3H — Audit Progress

## Completed
- **3H part 2 (won date):** new Deals save `wonAt`; Analytics groups won deals by it. Older deals have no recorded won date and fall back to their created date. That fallback is **not** a verified won date and is tracked as open.
- **3H parts 3–4:** the forecast is labelled "Weighted Pipeline Opportunity Forecast", with a note saying it is not cash, revenue, a guaranteed sale or a payment schedule. The New leads KPI opens Prospects via the URL (`from`, `to`, `src`), with a strip showing the filter and a Clear button.
- **Checkpoint B1 §2 (Analytics browser checks):** done, see below.

## Verified in browser (B1 §2)
- The forecast note shows the expected text.
- Source "Website" + New leads → `/leads?from=…&to=…&src=Website` → 3 of 12 leads, and the strip shows the range and source.
- The docked Client Inspector opens from the filtered list.
- "Select page" selected exactly the 3 filtered leads. "Select all matching" was not exercised: it only appears when there is more than one page (50+ rows).
- Clear date filter → `/leads`, 12 of 12. Saved views and view preferences are byte-identical before and after.

## Defects fixed
- The forecast explanation was hidden until probabilities were configured. It now always shows.

## Known limitations
- If Analytics has a stage, priority, assignee, tag or saved-view filter, New leads keeps its own record-list sheet, because Prospects can't express those filters from the URL.
- The stage tab counts on Prospects ("Everyone 12") ignore the date range, as with other filters.
- All data lives in this browser only (localStorage/IndexedDB). There is no multi-device sync and no real authentication.

## Tests
- 366 automated tests, including `leadsSearch.test.ts` for the drill-down URL rules. Typecheck clean.

## Next checkpoint
- B1 §3–8: Owner workspace audit; Employee A/B/C acceptance tests; admin/security; preview isolation; shared components; responsive/accessibility.
