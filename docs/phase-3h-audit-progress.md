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
- All data lives in this browser only (localStorage/IndexedDB). There is no multi-device sync and no real authentication.

## Checkpoint B1.2 — Part 1 (done)
- **Fixed:** the Prospects stage-tab counts used every lead. Now one filtered set (view, search, source, priority, assignee, tag, quick status, created and the Analytics date/source) feeds both the tab counts and the rows. Counting is pure `countByStage` and tested.
- Browser test, run in a separate test browser with 60 synthetic `QA Sel` Instagram leads, not real data. With source = Instagram the tabs showed Everyone 62 / New 61 / Qualified 1. Select page = 50, Select all matching = 62, excluding one = 61. No page errors.
- ~~Selection survives filter changes~~ — superseded, see Continuation A.
- **Not yet run (B1.2 Parts 2–7):** Owner lead create/call/WhatsApp/follow-up, Pipeline, Finance, Team Management, Project Desk and cross-module walkthroughs, plus the 5-width responsive pass.

## Checkpoint B1.2 — Continuation A
- **Fixed (selection safety):** any change to search, stage, source, priority, assignee, tag, created date, Analytics date/source, quick status, follow-up filter or saved view now clears the selection, with a "Selection cleared because the filters changed" notice. Changing page does not clear it. Scope key is pure `selectionScopeKey` (tested).
- Browser (test browser, 62 synthetic Instagram leads + 2 test employees, no real data): Select all 62 matching, exclude 1 → bar 61; assignment dialog shows "Confirm · 61 leads" (it receives the same id list as the bar); typing a search cleared the selection with the notice. No page errors.
- **Not yet run:** Parts 2 (Owner Leads walkthrough), 3 (Pipeline), 4 (Finance with real proof files) and the 5-width pass.

## Checkpoint B1.2 — Continuation B (Parts 5–7)
- **Automated only (new `crossmodule.test.ts`, real store, isolated fixtures):** Lead→Pipeline (one record, one status event), Lead→Follow-up (next follow-up set and cleared on completion), Lead→Call Log (one call in the right client history only), Lead→Employee (workload count; inactive employee refused), Deal→Finance (`wonAt` set; void lowers received, raises outstanding, no duplicate rows). Deal→Project duplicate prevention, project progress and goal revisions were already covered by existing tests.
- **Not manually executed in a browser:** Part 5 Team Management walkthrough, Part 6 Project Desk walkthrough, the rest of Part 7, and the 5-width pass. No defects found by the new tests.

## Tests
- 373 automated tests, including `leadsSearch.test.ts` for the drill-down URL rules. Typecheck clean. Production build successful.

## Next checkpoint
- B1 §3–8: Owner workspace audit; Employee A/B/C acceptance tests; admin/security; preview isolation; shared components; responsive/accessibility.
