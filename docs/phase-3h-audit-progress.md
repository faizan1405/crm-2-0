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

## Checkpoint B1.4.2 — Owner browser walkthroughs (Leads, Calling, WhatsApp, Follow-ups)
Separate test browser, isolated dataset (`B14 …` records only; three `B14` quotation packages and two `B14` employees created there). Real Owner records untouched. Scripts: `/tmp/browser/b14/`.

**Leads & Prospects — Passed**
- Required custom field "B14 Service Needed" blocked Save until filled; lead saved with value + tag "B14 Test Tag".
- Edited phone, email, source (Referral), priority (Hot) and the custom field; all persisted after refresh.
- Client note logged; shows on the client page and in the inspector history.
- Prospects inspector shows the lead, custom value, tag and note.
- Saved View "B14 Tag View" (tag filter) persisted after refresh and returned only the tagged lead.
- Observation: editing contact details does not add a history entry (only notes, calls, follow-ups, stage changes do).

**Calling — Passed**
- Call link `tel:9000014015` (matches edited number). Call opens the log; Skip creates nothing (0 call logs).
- Not picked → 1 call log + 1 history row "Call attempt … Not picked"; contact time not set.
- Connected → exactly 1 more of each, "Call … Connected"; contact time set (contact established). Both persist after refresh.

**WhatsApp & Quotations — Passed**
- Follow-up draft personalised ("Hi B14…"), no raw placeholders.
- All three packages listed (₹25,000 / ₹45,000 / ₹95,000); each draft shows the right name, price and description, no `{…}` left.
- Edited text kept: switching package after editing asks for confirmation; declining keeps the edits and package.
- Open in WhatsApp produced one wa.me link to the test number with the edited text; nothing logged, no share recorded.
- "I sent it — log to history" recorded exactly one WhatsApp row and one quotation share; persisted.

**Follow-ups — Passed**
- Created 27 Oct 11:00 IST (stored 05:30Z); lead's next follow-up set; shown in Upcoming.
- Rescheduled to 28 Oct 3:00 pm: still one pending, lead and agenda updated.
- Completed: none pending, lead's next follow-up cleared, removed from agenda; history shows scheduled → rescheduled → completed; persisted after refresh.

**Recent UX fixes — Passed**
- Permissions editor: "Permissions · B14 Viewer Kumar Rao" and "apply to B14 Viewer Kumar Rao only".
- Assigned-only preview: assignee filter offers only "Any assignee" / "My leads"; only the assigned lead visible.
- Blocked stage change: Prospects stage picker and Pipeline panel pickers disabled with "You don't have permission to change this lead's stage."; the Pipeline card is not draggable, so the drag toast can't be reached by a user (covered by automated test). Owner data identical after exiting preview.

**Defects found:** none. No code changed.
**Tests:** 376 pass, typecheck clean, full production build successful.
**Not started (per stop point):** Pipeline, bulk selection, Finance, backend.

## Checkpoint B1.4.3 — Pipeline, bulk assignment, contact-edit history, responsive
Separate test browser, isolated data: 62 leads "Tst B143 00–61" (company B143Co), employees B143 A/B/C (active) + B143 Gone (inactive). Scripts: `/tmp/browser/b143/` (bulk.py, assign.py, fp.py, vo.py, resp.py). Real Owner data untouched.

**Pipeline — Passed (after 1 fix)**
- Drag New → Contacted via real DOM drag events on the card/column handlers: moved; exactly 1 stage event ("Status changed to contacted"). Note: Playwright's mouse-simulated drag did not fire HTML5 drag events; per-card stage select also verified.
- Undo restored New (2nd stage event recorded, no extra).
- **Defect fixed:** an older Pipeline Undo could overwrite a newer stage change. Now Undo runs only if the lead is unchanged since that move (pure `canUndoStage`); otherwise "Undo skipped, newer change kept". Browser: Qualified → Proposal, old Undo clicked → stayed Proposal.
- Lost requires a reason; "Budget too low" persisted after refresh. Stages persisted after refresh.
- Inspector shows the same stage; changing it in the inspector (→ Won) is reflected in Prospects.
- View-only employee preview (pipeline.edit + leads.edit denied): 21 cards, 0 draggable, all 21 stage selects disabled.

**Bulk selection — Passed (after 1 fix)**
- Select page = 50; Select all matching = 62; exclude 1 = 61 ("1 excluded"); page 2 shows all 12 checked; excluded lead stays unchecked after paging.
- Assignment preview says "Assign 61 leads … minus 1 excluded"; after confirm, the assignment map contains exactly the 61 ids, excluded and unrelated leads absent.
- **Defect fixed:** the floating bulk bar covered the pager (Next page unclickable) at all widths, and was off-centre on desktop and squeezed beside the sidebar at 768px. Added a bottom spacer + scroll padding, centred it with `translate`, and widened it on tablets.
- Filter-change safety: Search, Stage tab, Source, Priority, Quick status, Assignee, Created date, Follow-up due each cleared the selection with "Selection cleared because the filters changed"; Saved View change shows "…because the view changed". Leads and assignments identical afterwards. Tag filter not browser-tested: no tags existed in the isolated dataset (covered by automated scope-key test).

**Distribution — Passed**
- One employee: 61 → A, exact ids. Undo → no assignments.
- Equal A/B/C over 61: 21/20/20, exact ids.
- Balanced A+B over 62 (with reassignment confirmation): 31/31, all 62 once.
- Custom 30/20/11 blocked ("Counts add up to 61, but 62 leads are selected"); 30/20/12 applied.
- Reassign 61 → C (49 changed; 12 already C); excluded lead kept its assignee.
- Inactive "B143 Gone" disabled in both one-employee and distribute lists.
- Undo conflict: after reassigning lead 10 to B, the older Undo restored the other 60 and kept lead 10 with B ("Undo restored 60; 1 kept because they changed again since"). Lead records unchanged, no duplicates.

**Contact-detail history — Implemented**
- Saving a lead with a changed phone, email, company or lead source adds exactly one history entry, e.g. "Contact details updated: phone, email changed". Values are not copied into history (privacy). No entry for unchanged values, unsaved typing, stage-only changes or merges (merges keep their own single entry). Uses the existing lead history + Team Activity `lead.updated` event (no new system); preview edits stay in the preview copy.

**Responsive — Passed at 1440 / 1024 / 768 / 390 / 360** (35/35 checks): bulk bar visible, Next page clickable with the bar open, no horizontal overflow on Leads or Pipeline, assignment dialog custom inputs and Confirm reachable, Pipeline stage select and inspector stage/close reachable. Dialog grid items made shrinkable to avoid clipping on phones.

**Tests:** 383 automated tests pass (+7: 4 contact-history, 3 stage-undo conflict). Typecheck clean. Full production build successful. Browser: 73 checks passed.

**Still open:** actual Owner quotation packages not verified in the isolated browser; legacy Won deals without a verified won date; Finance with real payment-proof files; full Data Vault attachment check; Employee A/B/C full acceptance; tag-filter selection clearing in browser; performance, reliability, security and accessibility audits.

## Checkpoint B1.5A — Finance & historical won dates (partial)

**Done (code + automated tests):**
- Historical won-date fix: deals without a recorded `wonAt` now have an *unknown* won date. They stay in all-time totals but are never placed in a month (KPIs, monthly breakdown, saved reports — month grouping shows "Unknown won date" bucket, windowed reports warn). Analytics shows the count/value of unknown-date deals in KPI hints and Reconciliation. Definitions updated.
- Owner-only `setDealWonAt` store action: records a verified won date once (never overwrites, rejects future/invalid dates), writes a lead history entry. No UI entry point yet.
- New `wonDate.test.ts` (5 tests): unknown date, all-time vs period, ₹40k/₹30k deals with ₹4k+₹16k+₹30k valid and ₹5k voided → ₹70,000 / ₹50,000 / ₹20,000, verified correction, invalid dates. Old fallback test rewritten to the new rule.
- 388 automated tests pass; typecheck clean.

**Not yet run (browser):** Parts 1, 2, 4, 5, 6 walkthroughs (Finance UI amounts, real proof upload/refresh/failure, proof privacy in preview, Project Finance, financial history, 5-width responsive). Production build not re-run separately.

**Upcoming (retained):** Data Vault ZIP + binary attachment verification; Employee A/B/C acceptance; Owner quotation package verification; real pointer drag; tag-filter clearing regression; large-dataset performance; reliability/storage failure; security, privacy, accessibility audits; final end-to-end acceptance.
