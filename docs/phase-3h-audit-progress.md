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

## Checkpoint B1.3 — Team Management & Project Desk (browser)
All runs used a separate test browser with its own storage: 3 test employees (Test Emp A/B/C), demo leads, one test deal "B13 Test Website" (₹40,000) and its project. No real records touched.

**Team Management (Tests 1–6): all passed**
- 1 Create/edit: 3 employees created through the form; edited name persisted after refresh; the test password never appears in browser storage; the UI says production login is "Not configured yet".
- 2 Permissions: B had Edit leads, Follow-up create/edit, Calls and Pipeline edit turned off; A had Create leads turned on; C had Project view/tasks turned on. All persisted and reopened correctly. Effect checked in Employee Preview: B's stage change was refused (select reverted) and saving a call showed "Not allowed by this employee's permissions."
- 3 Assignment: 5 leads to A (count 5), 2 reassigned to C → A 3 / C 2; each panel's lead names matched the assignment records exactly.
- 4 Inactive: deactivated B lost "Assign more", was disabled in the assign dialog, kept its 1 existing lead; reactivating restored the controls.
- 5 Workspace/Activity: A's workspace showed only A's 3 leads; Team Activity opened with A selected; B's preview Prospects list showed only B's 1 lead. Preview banner says changes are not saved.
- 6 Goals: monthly goal for A (target 40) edited to 55 → v2 current, history keeps v1 target 40; progress shows "Not measurable yet".

**Project Desk (Tests 7–15): all passed**
- 7 Create project from the deal: client, phone, email, source and ₹40,000 prefilled; one project linked to the right lead and deal; deal then shows "Open project", no Create button.
- 8 Tasks: milestone + 3 tasks added (8 total); complete → 1 of 8, reopen → 0 of 8; persisted after refresh.
- 9 Board: drag Discovery→Design and stage select →Development both worked; priority set to High; detail header matches; history records both stage moves.
- 10 Fields/tags: Hosting Provider = Hostinger, Estimated Launch Date set, project tag "Awaiting Client Content" added; tag filter showed the project; persisted; linked lead's custom values unchanged. (Only one other project existed at that time, so "hides others" was weak.)
- 11 Requirements: item added and ticked, dependency pending → received, note saved; "password: …" and "cpanel login: …" rejected; secret text not stored.
- 12 Finance: one ₹4,000 advance recorded in Deals; Deals and Project Finance both show ₹40,000 / ₹4,000 / ₹36,000; no duplicate payment.
- 13 WhatsApp: kickoff draft has client name, no raw placeholders, editable, says nothing is sent automatically; opening/closing added no history.
- 14 Delivery: blocked with incomplete checklist; delivered after an override reason; delivery date and history recorded; deal still Active with one payment.
- 15 Support: support dates saved; request assigned to C, started, resolved with notes; persisted and in history.

**Employee C preview (Part 3): passed** — sees "My projects" with only the assigned project (second test project hidden); Internal Delivery Cost, Internal notes and the Finance tab hidden; C's own task could be reopened; an unassigned task was locked; Owner storage byte-identical during preview and after exit.

**Cross-module (Part 4):** C passed (workload counts update; goal progress not credited by assignments). D passed (Deal ↔ Project Finance figures match). A (custom field → saved view) and B (automation → Team Activity) were **not re-run** here; they were browser-verified in Phase 3G.1.1 (Test C and the Part 7 walkthrough).

**Responsive (Part 5):** 1440/1024/768/390/360 with real interactions (profile, permission editor, assign dialog, goal dialog, board stage select, project overview/tasks/finance/delivery, support form). Final run: no overflow, no page errors.

**Defects fixed (CSS only)**
- Employee details panel (below 1280px): the Assigned leads section ran off the right edge, hiding "Assign more" and clipping lead rows.
- Permission editor on phones (390/360): module cards ran off the right edge and hid every on/off switch.

**Minor findings, not changed**
- A preview stage change that isn't allowed reverts silently, with no message.
- Permission editor intro uses the first word of the name ("apply to Test only").
- The Prospects assignee filter lists all employees inside an employee preview.

## Tests
- 373 automated tests (no new ones needed — fixes were CSS). Typecheck clean. Full production build successful (re-run after B1.3 fixes).

## Still open
- Owner Leads/Calling/WhatsApp/Follow-ups walkthrough
- Owner Pipeline walkthrough
- Full Finance walkthrough with real payment-proof attachments
- Employee A/B/C full acceptance
- Historical won date for legacy deals
- Full Data Vault attachment verification
- Performance and reliability audit
- Security, accessibility and architecture audit

## Next checkpoint
- B1 §3–8: Owner workspace audit; Employee A/B/C acceptance tests; admin/security; preview isolation; shared components; responsive/accessibility.

## Checkpoint B1.4 — Part 1 (UX fixes, code + automated tests only)
- **Stage denial feedback:** every stage picker (Pipeline drag, card select, Pipeline inspector, Prospects row, Prospects inspector, client page) now shows "You don't have permission to change this lead's stage." and does not write, log activity or offer Undo. Pickers are disabled with that text as a tooltip before the user tries.
- **Full employee name** in the Permissions editor heading and description (wraps on small screens).
- **Assignee filter in preview:** assigned-only employees see "Any assignee" + "My leads" only (no Unassigned, no company roster); all-scope roles see active employees with "(me)". Filters only narrow the already-scoped working copy.
- 3 new tests (`session.b14.test.ts`) → 376 pass. Typecheck clean.
- **Not yet run:** Parts 2–8 browser walkthroughs (Leads, Calling, WhatsApp, Follow-ups, Pipeline, bulk regression, 5-width pass).
