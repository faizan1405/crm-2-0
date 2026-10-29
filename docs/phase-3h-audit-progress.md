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

## Checkpoint B1.5A.2 — Legacy won-date UI & Finance browser QA

**UI added:** Finance studio deal panel shows "Record verified won date" only to the Owner (hidden in employee preview), only for non-cancelled deals with no won date. Dialog explains the date is unknown and the creation date is not used, date input capped at today (India time), rejects future/invalid dates, previews impact ("₹X will count as won value in <Month>"), requires a "can be recorded only once" confirmation, saves through `setDealWonAt` (stored at midday IST so the day never shifts). The button disappears afterwards. Deals without a won date show a note: "counted in all-time totals only".

**Browser walkthrough (executed, `/tmp/browser/b15/fin.py`, isolated test browser):**
- Deal A ₹40,000 created once via UI, `wonAt` recorded; Received ₹0 / Outstanding ₹40,000, same after refresh.
- Payments ₹4,000 + ₹16,000 → Received ₹20,000 / Outstanding ₹20,000. +₹5,000 → ₹25,000/₹15,000; voided via UI → back to ₹20,000/₹20,000; voided row kept in storage (3 records: 4k, 16k, 5k voided).
- Deal B ₹30,000 paid ₹30,000 → Outstanding ₹0.
- Combined Finance header incl. one synthetic legacy deal (₹25,000, ₹5,000 paid, no won date): ₹95,000 booked / ₹55K received / ₹40K outstanding = A+B (₹70,000/₹50,000/₹20,000) + legacy. Analytics period Won value ₹70,000 with "1 with unknown won date excluded"; Reconciliation lists 1 unknown-date deal.
- Legacy correction: future date rejected with message and Save disabled; 30 Sep 2026 showed impact "September 2026"; Save disabled until confirmation; saved `2026-09-30T06:30Z` (30 Sep IST); amount and payment (₹5,000 on 6 Oct) unchanged; button gone, still gone after refresh; Analytics unknown count → 0.

**Not run in browser:** Project Finance linkage (Part 4), activity-history checks (Part 5; the correction's history entry is covered by an automated test only, synthetic legacy deal had no linked lead). Observation: booking a deal and voiding a payment don't add a client-history entry today (only payments do) — not changed.

**Status:** 390 automated tests pass; typecheck clean; full production build succeeded.

**Still open:** B1.5A.3 payment-proof upload/persistence/failure/privacy + 5-width responsive; B1.5B Data Vault ZIP and attachment bytes; Employee A/B/C acceptance; Owner quotation-package verification; large-dataset performance; reliability/storage failures; security & accessibility; final end-to-end audit.

## Checkpoint B1.5A.3 — Payment proofs, financial history, privacy, responsive

**Code changes**
- Client history now records "Deal booked: "<name>"" (CRM-lead deals) and "Payment of ₹X voided on "<deal>" (kept in history, excluded from totals)". Voiding an already-voided payment does nothing and adds no second entry. Other-client deals (no lead) add no client history.
- Privacy defect found and fixed: employee previews without an amounts finance level could read payment amounts in client history. The scoped employee copy (`scopeWorkspace`) now replaces money entries with "Finance update (details hidden — no finance access)".
- New `financeHistory.test.ts` (5 tests). 395 tests pass; typecheck clean; full production build succeeded.

**Browser (executed: `/tmp/browser/b153/proof.py`, `priv.py`; isolated test browser, synthetic files saying "TEST PAYMENT PROOF - NOT A REAL TRANSACTION")**
- Deal A ₹40,000 on a CRM lead: exactly 1 "Deal booked" entry.
- PNG proof (3,126 B, sha256 0fa3ce3f…) attached in the Record payment dialog to the ₹4,000 payment; PDF proof (7,867 B, sha256 2d94c440…) attached via "Add proof" on the ₹16,000 row. Bytes read back from the preview matched size and SHA-256 before and after refresh, each on its own payment.
- Proofs live only in IndexedDB (`scale-flow-payment-proofs`); no proof fields in payment records.
- Rejected with messages and nothing staged: empty file, spoofed PNG (PDF bytes), 11 MB PNG. SVG was rejected (nothing staged) but its message was hidden behind an older notification — message not confirmed.
- Failed replacement (spoofed file) kept the existing proof (same hash); payments unchanged.
- ₹5,000 voided: 1 "voided" entry; payments 4k, 16k valid + 5k voided.
- Project created from Deal A: Agreed ₹40,000 / Received ₹20,000 / Remaining ₹20,000, same after refresh; still 3 payments, 1 project, no payment created.
- Employee preview (salesperson, no finance, assigned to Deal A's lead): /deals and the project pages show "Not in this workspace"; client page shows no proofs, no deal amounts, no payment history text after the fix.
- Widths 1440/1024/768/390/360: no page overflow in the deal panel, payment dialog or proof preview; Save/Replace/Void reachable (buttons 32–40 px tall); project finance correct at all widths (section tabs scroll inside their own strip at ≤768 as designed).

**Not tested:** storage-full/IndexedDB write failure in the browser (automated test only), interrupted uploads, delivery-doesn't-mark-paid in the browser, historical won-date event re-check after refresh (automated only), notification previews for money events. Void reason isn't captured (no reason field exists). Small touch targets: Void button is 32 px tall — below the 44 px guideline, not changed (no redesign).

**Still open:** B1.5B Data Vault ZIP binary verification; Employee A/B/C acceptance; Owner quotation-package verification; real pointer drag and tag-filter regression; large-dataset performance; storage and recovery audit; security and accessibility; final end-to-end acceptance.

## Checkpoint B1.5B.1 — Data Vault full backup & attachment-byte verification (2026-10-24)

**Inspection.** Records come from the CRM store snapshot; proof bytes from IndexedDB `scale-flow-payment-proofs` (`meta` + `files`, keyed by paymentId) via `idbProofRepo`. `vault.ts buildBackup` writes one JSON per category plus raw bytes at `files/payment-proofs/<paymentId>__<name>` (fflate `zipSync`), `data/attachment-metadata.json` (attachmentId, paymentId, path, size, SHA-256) and `manifest.json` (format/schema version, createdAt, type, complete, included/omitted, counts, attachment inventory, per-file SHA-256). The UI self-validates every archive before download.

**Fixtures (separate test browser, test-only).** Lead `lead_1`, deal `deal_z1howuc` "B15B1 Deal" ₹40,000; payments ₹4,000 (`payment_mvmbqblxqywkv`, PNG proof `proof_mvmbqbq8dtyx9`, 3,338 B, sha256 f6c4a648…12de), ₹16,000 (`payment_mvmbqd1ain0ac`, PDF proof `proof_mvmbqd61isorg`, 580 B, sha256 a6b4fbbd…e4c2), ₹5,000 voided. Both files read "TEST PAYMENT PROOF - NOT A REAL TRANSACTION", uploaded through Finance studio, both "View proof" present after refresh.

**Browser export (real UI click, real download).** "Complete backup verified and downloaded." ZIP: 25 entries (manifest, summary HTML, 21 data JSON files, 2 proof binaries). Manifest: format v1, schema v7, type full, complete true, omitted [], attachments 2/2, 23 file checksums all re-verified offline.
- PNG and PDF extracted: byte-for-byte equal to originals, SHA-256 equal, metadata SHA equal. PNG opens (640×240); PDF opens and pdftotext prints the test text.
- Relationships: attachment → payment → deal "B15B1 Deal" → lead present in archive; IDs and paths unique; payments 7 = counts.payments 7; voided ₹5,000 kept with `voided: true`.
- Two consecutive backups: all `data/` and `files/` entries identical; leads/deals/payments/activities/follow-ups/projects unchanged.
- Restore & Verify on the real ZIP: "Backup validated — complete". Tampered PDF bytes: failed with "Proof file failed its checksum".
- Missing binary (test PDF bytes removed from IndexedDB, metadata kept): "Archive downloaded, but it is NOT complete."; warning names 1 missing file; manifest complete false, missing [payment_mvmbqd1ain0ac]; all 3 test payments still present; Restore & Verify now says "Archive intact, but NOT a complete backup".
- Employee preview (salesperson, no finance): `/data-vault` → "Not in this workspace", no backup buttons, no Data Vault nav link. Preview notifications list follow-ups only, no ₹. Owner notification text for deal/payment events carries no amounts (deal names only); proof changes create no notifications.

**Defects fixed.** (1) Restore & Verify did not cross-check attachment metadata against binaries — now checks per-proof path/bytes/SHA-256, unlisted proof files, invalid payment references, duplicate attachment IDs/paths/one-proof-per-payment, attachment/payment/deal count consistency and false "complete" claims. (2) A partial archive was shown as "Backup validated" — now "Archive intact, but NOT a complete backup".

**Results.** 402 automated tests pass (7 new in `vault.test.ts`), typecheck clean. Full build: automatic harness build only.

**Not verified here.** Lead → Deal → Project (test deal had no project; covered by earlier Project Desk checkpoint only). Plain Owner-side notification redaction is moot (Owner sees all). Browser storage is not permanent; ZIPs are not encrypted and must be treated as sensitive files. Carried forward: selective/employee backup audit, hostile-archive tests, destructive restore (disabled), Employee A/B/C, quotation packages, large datasets, storage/multi-tab, security & accessibility, final end-to-end, Void reason and mobile Void button.

## Checkpoint B1.5B.2 — Selective & employee backups, archive safety (2026-10-24)

Code changes were lost once during a platform incident and re-applied on 2026-10-24; the browser walkthrough was re-run afterwards.

**Changes.** `vault.ts`: manifest `classification` (complete / selective / employee / incomplete-full) and `employee.leadIds`; Selective archives named `_Selective_` with "partial by design" and unresolved-dependency notes. `validateBackup` checks ZIP headers via the fflate `filter` before decompressing (≤ 512 MB archive, ≤ 5000 entries, ≤ 25 MB per entry, ≤ 600 MB total, ratio > 200:1 on entries > 1 MB refused). It rejects duplicate entry names, `../`, absolute/drive/backslash paths and any name outside `manifest.json | backup-summary.html | data/*.json | files/payment-proofs/*`. It also validates required manifest metadata and flags unlisted files, duplicate manifest paths, missing category files, count mismatches, duplicate record IDs, broken Payment→Deal and Task→Project links (errors), Deal→Lead and Project links (warnings), and employee leads outside the declared scope. `buildBackup` refuses non-Owner actors, and the page refuses generate/verify while preview is active. The notice says backups are not encrypted.

**Browser (isolated, "B152 …" records).** Full backup: Lead→Deal→Project→2 tasks resolve, 1 payment, proof bytes and SHA-256 exact. Selective (Leads/Activity/Follow-ups): only those files, IDs and lead notes kept. Selective (Deals/Payments/Proofs): proof exact. Employee A/B: exact assigned lead IDs only. Restore & Verify labels each type correctly. Truncated, wrong-count, changed-proof, missing-deal, `../` and no-`files` copies are rejected. Verification changed only `backupHistory`. On the re-run, the in-page reassignment step didn't take effect because of the test harness (it called a second copy of the store), so reassignment is backed by the first run plus an automated test.

## Checkpoint B1.6 — Employee workflows, permissions & preview isolation (2026-10-24)

**Setup (isolated test browser, "B16 …" records).** A = Salesperson (A1–A3). B = custom "Viewer" with view-only overrides (B1–B2). C = Salesperson + projects.view/notes/tasks_edit (C1–C2, member of project with 2 tasks assigned to C; linked deal ₹47,321 and payment ₹12,345). Another project for an unassigned lead.

**Defects fixed.**
- View-only employees could add client notes (`addActivity` was guarded by `leads.view`). Notes now need `leads.edit` and WhatsApp history needs `clients.whatsapp`. Note boxes show "You don't have permission to add client notes." instead of a false "Note added".
- Preview over-counted activity: internal history writes (logCall → addActivity) emitted extra "client.note_added" events. Only the outermost action is now attributed.
- A deactivated employee could still be previewed. The preview page now shows "<name> is deactivated" and does not start.

**Employee A — pass.** Sees exactly A1–A3, no deals or Owner notes. Lead-page note saved. Priority edit, Not picked + Connected calls logged (2 call entries, outcomes kept), follow-up created → rescheduled → completed, stage → Qualified, private note saved. Payment refused. Call link `tel:+919000020001`. My Performance shows no ₹ amounts. One event per action, all attributed to A. Not browser-tested this round: WhatsApp composer drafts and sent-confirmation (covered in B1.4.2) and tag picker UI.

**Employee B — pass.** Sees exactly B1–B2. Edit, priority, stage, call, follow-up, note, assignment and tag were all refused at the store guard. The data snapshot was byte-identical before and after, and no events were added. The lead-page note shows the denial message. /deals, /data-vault, /settings, /team and /projects show "Not in this workspace". B cannot see A's private note.

**Employee C — pass.** Only the assigned project is visible. The other project's page doesn't show it. No ₹47,321 / ₹12,345 / ₹34,976 anywhere on the project page. Complete and reopen of an assigned task work. Stage move and archive are refused (no `projects.stage`). Adding tasks is refused (no `tasks_add`).

**Isolation — pass.** After previews of A, B and C with real actions, every Owner store key and the saved localStorage state were identical to the baseline.

**Owner control — pass.** Revoking A's `leads.edit`/`pipeline.edit` took effect on the next preview (edit and stage refused). Deactivating B blocked the preview.

**Responsive — pass.** At 1440/1024/768/390/360 in C's preview, /leads, /pipeline, /follow-ups, /my-performance, /notes, the project page and /deals have no sideways scroll, and the Log call dialog fits.

**Automated.** 424 tests pass (`preview.b16.test.ts` covers B denials and no-mutation, A scope, attribution, exit restore, notes privacy, C permission changes, automation off, backup denial). Typecheck clean.

**Limitations.** No real authentication; browser-local data and preview only; no cross-device sync; no server-side authorization; no production performance attribution.

**Still open:** original Owner quotation packages; pointer-driven Pipeline drag; tag-filter clearing; 1k/5k/10k lead performance; storage quota & multi-tab; security & accessibility audit; full end-to-end; real restore and backend features.

---

## Checkpoint D1 — Large-data performance & project persistence (2026-10-25)

### Part 1 — Persistence
- Source re-read: `vault.ts` has classification (complete/selective/employee/incomplete-full/damaged), attachment/manifest checks; `store.ts` keeps `addActivity` note → `leads.edit`, WhatsApp → `clients.whatsapp`, and the depth-guarded single-event preview wrapper.
- Git history visible (latest commit "Fixed backup data corruption"). Commits are made by Lovable automatically; no manual tag/checkpoint was created by the agent, so no separately named recoverable checkpoint is claimed. Restore points are available through Lovable's version history.
- Uncertainty: the earlier platform incident showed edits can be lost before they are committed; verify the next session sees D1 changes (`pipeline.perf.test.ts` exists).

### Method
- Synthetic generator `/tmp/browser/d1/gen.py` (seeded, stable ids `perf_lead_00000…`, 5 PERF employees, 4 tags, 1 select custom field, ~1/2 leads with follow-ups, ~1/4 with call history, 9 sources, 6 stages, 3 priorities, 180-day spread).
- Loaded only into fresh, throwaway headless Chromium profiles (no Owner browser data exists there; nothing written to a real device).
- Timing = action → DOM condition met → 2 animation frames, via Playwright; "longtask" = summed main-thread tasks >50 ms. Median of 3 runs. **Vite dev server (development React)** — production builds are typically faster; absolute numbers are upper bounds.
- Heap: `performance.memory` ≈ 115–134 MB in all runs (coarse Chromium value).

### Bottlenecks found (CPU profile, 5,000 leads, 4 Source-filter changes)
1. `formatDateTime` 6.7 s self time: Shell built the closed Notifications list on every render — new `Intl.DateTimeFormat` per overdue follow-up plus `leads.find` per row (O(follow-ups × leads)).
2. Shell subscribed to the whole store, re-rendering on every change; closed Schedule-follow-up dialog built an `<option>` for every lead; AssignDialog counted workload per employee by full scans.
3. Pipeline: `cardSignals`/`stageSince` scanned all activities and follow-ups per card (O(leads × records)); `relative()` created a formatter per call.
4. Prospects Follow-up-due filter scanned all follow-ups per lead.

### Optimizations (business meaning unchanged)
- `format.ts`: cached Intl formatters (same options → same output).
- `Shell.tsx`: shallow store selector; attention list memoized; notification rows, global-search and call-picker results only built while open; name lookup via Map.
- `Dialogs.tsx`: lead options only rendered while the dialog is open. `AssignDialog.tsx`: memoized `workload`.
- `pipeline.ts`: per-array WeakMap indexes (last stage change, earliest pending follow-up) — identical results; covered by `pipeline.perf.test.ts` (3 tests: equality with full scan, pending/earliest rule, no stale cache).
- `leads.tsx`: pending follow-ups grouped per lead once.

### Measurements (median ms, 1440px, dev build)
| Operation | 1k before | 1k after | 5k after | 10k |
|---|---|---|---|---|
| Open Prospects | 1040 | 1223 | 940 | not run* |
| Search | 607 | 95 | 113 | * |
| Source filter | 876 | 530 | 499 | * |
| Assignee filter | 442 | 227 | 192 | * |
| Tag filter | 746 | 390 | 280 | * |
| Follow-up due filter | 454 | 158 | 172 | * |
| Created filter | 492 | 110 | 253 | * |
| Next page | 330 | 204 | 395 | * |
| Open inspector | 583 | 163 | 212 | * |
| Select page | 328 | 322 | 169 | * |
| Select all matching | 526 | 227 | 148 | * |
| Open bulk assign | 291 | 229 | 292 | * |
| Equal / balanced preview | 94 / 110 | 110 / 112 | 96 / 95 | * |
| Open Pipeline | 2855 | 2176 | 6801 (12804 before Pipeline fix) | * |
| Open Smart Inbox | 2277 | 1454 | 2534 | * |
| Open Analytics | 1233 | 850 | 1130 | * |
| Open Automation | 968 | 587 | 592 | * |
| Open Project Desk | 709 | 567 | 493 | * |

\* **10,000 leads could not be loaded**: the dataset is ≈7.7 MB and the browser refused it (`QuotaExceededError` on localStorage, ~5 MB limit). 5,000 leads used 3.9 MB. This is a real product limit of browser-local storage, not a test failure — it must be solved by the backend (or IndexedDB). What the app does when a save exceeds quota during normal use is still untested (storage-quota item stays open).
5k "before" was measured for Pipeline only (12.8 s); other 5k before-values were not captured.

### Remaining bottlenecks
- Pipeline at 5k still ≈6.8 s to open (≈3.8 s main-thread): it renders every card (~5,000 DOM tickets). Fix needs a design decision (e.g. "show more" per column / virtualization) — not done to avoid changing approved UI.
- Smart Inbox open ≈2.5 s at 5k; Source filter ≈0.5 s.

### Data integrity under load (browser, 5,000 leads, `integ.py`)
- Source = Referral → 591 matching; Select all matching then 1 exclusion → bar "590 selected · 1 excluded".
- Equal distribution to 2 employees → 295 / 295, 0 leads outside the filter changed, 5,000 leads / 5,000 unique ids (no duplicates). Toast "493 leads distributed" (rest already with those employees).
- Undo restored the assignment map exactly (deep-equal).
- Select all matching count equalled dataset size at 1k and 5k. Inbox/analytics/workload consistency rely on existing automated tests; not re-counted in the browser.

### Responsive (5,000 leads)
| Width | Prospects open | Pipeline open | Analytics open | Overflow |
|---|---|---|---|---|
| 1440 | 1679 | 4288 | 1832 | 0 |
| 768 | 1881 | 4405 | 1639 | 0 |
| 390 | 1772 | 4387 | 1688 | 0 |
| 360 | 1885 | 5267 | 1601 | 0 |
Scrolling stayed responsive (wheel step ≈110–500 ms incl. 100 ms wait); Pipeline is the visible freeze on phones.

### Results
- Automated tests: **427 passed** (424 + 3 new). Typecheck clean. `vite build` exit 0.
- Benchmarks: 1k ✅, 5k ✅, 10k ❌ blocked by browser storage quota.

### Still open
Storage quota & multi-tab reliability · Owner quotation package content · physical Pipeline drag · tag-filter selection clearing browser test · extended security/privacy audit · keyboard accessibility · final end-to-end acceptance · real restore with the secure backend · Pipeline large-column rendering.

## Checkpoint D2.1 — Browser storage safety (2026-10-25)

**Persistence architecture.** All CRM records (Leads, Deals, Payments, Follow-ups, Projects/Tasks, Notes, saved quotation packages and WhatsApp templates, activity, Team Activity events, automation rules/history, assignments, settings) live in one localStorage key `scale-flow-crm-2-demo`, written as a whole on every change. Payment-proof binaries live only in IndexedDB `scale-flow-payment-proofs` (one metadata row + one file per payment, written in one transaction). The sidebar-collapse flag uses its own small key. Data Vault reads the store state plus the IndexedDB proofs. Preview never writes storage.

**Measured.** Fresh demo store ≈ 42 KB (measured in the test browser). D1 showed 10,000 Leads need ≈ 7.7 MB vs a ≈ 5 MB localStorage limit in Chromium. Chrome's `navigator.storage.estimate()` does not count localStorage, so remaining localStorage space is not measurable; the diagnostic says so.

**Defect found.** Before D2.1 a quota failure was thrown from inside zustand's persist after memory was already updated: the UI could crash or show success, memory and storage disagreed, and a retry could duplicate a Lead/Payment that existed only in memory.

**Correction.** `atomic` wrapper around every store action: snapshot → run → if any write failed, restore memory (and rewrite the last durable state) and throw `PersistError`. No success toast runs, forms/dialogs stay open with their content, no Team Activity event survives, finance totals are unchanged. Background actions (automations, goal alerts, view prefs, backup log) roll back silently; the automation runner pauses while saves are failing. Shell shows one message ("Your browser storage is full. Your latest changes could not be saved. Existing saved data has not been deleted.") with a Storage info link. New Owner-only Storage panel in Settings → Data & backup: last save result, failure count, measured CRM/local storage size, per-category sizes (no values), proof file count/size, browser estimate (labelled approximate). Nothing is ever deleted to free space.

**Limitations.** Atomicity is per action. Bulk add (many Leads in one dialog) saves Lead by Lead, so a failure mid-way keeps the earlier ones (duplicate detection flags them on retry). An unsaved draft lives only in the open tab; closing the tab loses it. Data Vault backups contain only previously saved records. Proof saves are a separate IndexedDB transaction from the payment record.

**Tests.** 6 new automated tests (`persist.d21.test.ts`): Lead, Payment, Project task, Note autosave failure + retry, background rollback, size measurement. **433 tests pass**, typecheck clean.

**Browser (isolated context, simulated QuotaExceededError on the CRM key only — no natural quota failure was produced):**
- A normal save + refresh: passed.
- B failed Lead save: clear message, dialog kept the draft, nothing stored or shown; G retry saved exactly one, survived refresh.
- C failed Payment: dialog stayed open, no stored payment or event; retry stored exactly one.
- D failed Note: "Not saved — storage error · Retry" badge, editor kept the text, stored note unchanged; Retry saved it, survived refresh.
- Storage panel showed the failure and sizes.
- Not browser-run this round: E (project task — automated only), F (proof IndexedDB failure — covered by B1.5A.3 browser run and `proofRepo` tests), H (Data Vault — existing vault tests still pass). No 10,000-Lead claim.

Open: D2.2 multi-tab conflicts, Pipeline progressive rendering, Owner quotation packages, real pointer drag, tag-filter clearing, security/privacy, accessibility/keyboard, final end-to-end, secure backend storage and restore.

## Checkpoint D2.2.1 — Multi-tab Lead editing (2026-10-27)

**Before.** One localStorage key holds the whole CRM and is rewritten in full on every change. Other tabs were refreshed only by the async `storage` event in Shell (notification, not protection). Risks: (1) the Lead edit form sent *every* field on save, so a tab opened earlier wrote its old phone/email back over a newer save; (2) a tab whose memory hadn't been refreshed yet could write its whole older collection over newer records; (3) after Employee Preview exit, memory held the pre-preview Owner snapshot even if another tab had saved meanwhile. No record revisions were checked.

**Approach.** (a) `atomic` re-reads the saved blob before every outermost Owner action (`syncFromStorage`); if it differs from what this tab last read/wrote, memory is loaded from storage first (without writing back or creating events), so actions apply onto the latest records. (b) Record revision = `updatedAt`; `updateLead(id, patch, base)` throws `StaleRecordError` and writes nothing when the saved Lead changed since `base`. (c) The Lead edit form sends only the fields the user changed; while open it compares its starting revision to the live record and shows "This lead was updated in another tab. Review the latest changes before saving." with Review latest / Keep my draft (bring in newer untouched fields, keep typed ones) / Reload record. Save is blocked until one is chosen. (d) Preview exit re-syncs. Pure helpers in `crossTab.ts`.

**Browser (one test browser, two real tabs, same origin, fresh synthetic dataset):**
- A same Lead: Tab A saved phone 9876501234; stale Tab B changed priority → conflict notice, nothing saved (stored priority stayed hot), B's draft kept (cold). Review listed "Phone: +91 98765 43010 → 9876501234". Keep my draft → phone 9876501234 + priority cold; save stored both.
- C unsaved draft: A typed company "Draft Co (unsaved)"; B saved email tabb@example.com → A showed the warning, draft kept, nothing saved by A; Reload record loaded company Bloom Interiors + new email.
- B different Leads: lead_1 "Lead1 Co" and lead_2 "Lead2 Co" both stored.
- Rapid alternating (3 rounds × 2 tabs): final values "rapid 2 …" on both Leads.
- Refresh both tabs: correct values shown; 12 Leads, 12 unique ids; no page errors.
- Automated only (not browser-run): new Lead while another tab saved, stale-tab assignment, preview isolation across tabs, no events from sync.

**Tests.** 7 new (`crossTab.d221.test.ts`). **440 pass**, typecheck clean, production build OK.

**Limitations.** localStorage has no cross-tab lock and actions are synchronous, so Web Locks can't wrap them; two saves landing in the same instant can still race (last write wins for that instant). Quick single-field controls (priority/stage selects, pin) apply onto the latest record without a conflict prompt — they don't send stale fields. Only the Lead edit form has the draft-conflict UI; tags, custom fields, notes and assignment rely on re-read-before-write. Not real multi-user sync.

Open: D2.2.2 (finance, projects, follow-ups and other workflows across tabs), D2.1.1 browser scenarios (project task failed save, proof replacement failure, Data Vault after failed saves), Pipeline progressive rendering, Owner quotation packages, physical Pipeline drag, tag-filter clearing, security/accessibility, final end-to-end, real backend storage and restore.

## Checkpoint D2.2.2A — Finance & Follow-up multi-tab reliability (2026-10-27)

**Risks found (before).** Since D2.2.1 every action already re-reads the latest saved state, so stale whole-collection overwrites of Deals/Payments/Follow-ups were already prevented and `addPayment` re-checked the latest outstanding balance. Remaining defects: (1) `voidPayment` silently did nothing on an already-voided payment but the screen still said "Payment voided" (false success); (2) `completeFollowUp` likewise showed "Follow-up completed" for an already-completed/replaced follow-up; (3) a reschedule window opened before another tab's reschedule overwrote the newer time (lost update); (4) a stale Complete would complete a follow-up whose schedule had changed meanwhile without telling the user. Reminders/notifications are derived from saved records, so no separate reminder rows existed to duplicate.

**Changes.** `voidPayment` returns voided/already/missing; `completeFollowUp(id, baseDue)` and `rescheduleFollowUp(id, at, baseDue)` return completed/rescheduled/already/closed/missing and throw `StaleRecordError` (nothing saved, no history) when the due time differs from the one the user saw. Shared `runFollowUp`/`runVoid` show exactly one honest message. The reschedule window remembers the time it opened with; on conflict it keeps the new time and shows "This follow-up was updated in another tab. Review the latest schedule before saving." with Replace with my new time / Keep latest. A rejected payment whose amount exceeds the latest balance explains it was changed in another tab. No new storage, no second finance or follow-up system.

**Browser (one test browser, two real same-origin tabs, synthetic T222 deals; fresh storage):**
- 1 Two payments on T222 Deal A (₹40,000), Tab B's window opened before Tab A saved: ₹4,000 + ₹16,000 → two separate ids, received ₹20,000, outstanding ₹20,000, exactly two "Payment of … recorded" history entries.
- 2 Void ₹16,000 from both tabs at nearly the same moment: Tab B's screen had already refreshed, so its Void button was gone; payment voided once and kept in the ledger, 1 void history entry, received ₹4,000. The "already voided" message itself was exercised only in automated tests (a truly stale click couldn't be produced — a held confirm box freezes both tabs).
- 3 Stale action: Tab B's window open, Tab A recorded ₹15,000; Tab B's ₹30,000 refused ("Amount exceeds the ₹21,000 outstanding"), nothing saved; received ₹19,000.
- 4 Two deals, near-simultaneous saves: Deal A ₹1,000 and Deal B ₹2,500 both stored, both deals present (A received ₹20,000, B ₹2,500).
- 6 Two reschedules: Tab A moved fu_T1 to 28 Oct 10:00 IST; Tab B's older window → conflict notice, nothing saved, fu_T1 kept 28 Oct 10:00.
- 7 Double completion, near-simultaneous: fu_T2 completed once, 1 completion history entry (second tab's button had already disappeared).
- 9 Refresh: lead_1 next follow-up = 28 Oct 10:00 IST, lead_2 none; no page errors.
- Not browser-tested (automated only): 5 reschedule-vs-stale-complete, 8 two different follow-ups, 10 employee Finance permission; Finance Studio/Analytics screen totals not compared on screen (saved-record totals verified).

**Tests.** 10 new (`crossTab.d222a.test.ts`). **450 pass**, typecheck clean, production build OK.

**Limitations.** No cross-tab lock: two saves in the same instant can still race; these are sequential-stale guarantees, not transactions. Real financial transaction safety needs the future backend.

Open: D2.2.2B (Projects, Tasks, Notes, rest), D2.1.1 three storage-failure browser scenarios, Pipeline long columns, Owner quotation packages, physical Pipeline drag, tag-filter clearing, security/privacy/accessibility, final end-to-end, backend transactions and real restore.

## Checkpoint D2.2.2B.1 — Project & Task multi-tab browser QA (2026-10-27)

**Setup.** One test browser profile, two real same-origin tabs, fresh isolated storage (no Owner records touched). Project "QA D222B1 Project" created through the real *Create project from deal* dialog with extra tasks QA Task 1–3 (8 tasks total incl. template). Test fixture in that isolated storage only: linked deal set to ₹40,000 with two valid payments (₹12,000 + ₹8,000 = ₹20,000). To produce a genuinely outdated tab, Tab B's cross-tab refresh listener was paused (simulates a background tab that hasn't caught up); every action was still a real UI click.

**Fixes (both reproduced first, then re-run).**
1. Task notes lost update — Tab B's unsaved notes draft overwrote Tab A's newer saved notes ("Task notes saved" shown in B). Cause: the save passed the task version current at click time, not the one the draft started from. Now the notes draft remembers its starting version; an outdated save is refused, the draft stays, and a notice shows the latest saved notes with *Load latest (discard draft)* / *Keep my draft*. If nothing was typed, the notes simply refresh.
2. Board stage select silently overwrote a newer stage (Testing & QA → Awaiting content from an outdated tab). The per-card select now passes the stage the card showed, so the outdated move is refused.

**Browser results.**
- Task 1 different tasks from two tabs — **Passed**: Task 1 "A note on task 1", Task 2 "B note on task 2" both stored.
- Task 2 same task, stale save — **Failed → fixed → Passed**: stored notes "A saved task 3"; B got "This task was updated in another tab…", its draft "B unsaved draft for task 3" kept, conflict notice shown.
- Task 3 complete same task from both tabs — **Passed**: B still showed "Complete"; status done, exactly 1 "Completed" history entry; B: "This task was already completed in another tab — nothing changed."
- Task 4 reopen + outdated action — **Passed**: history Created → Edited → Completed → Reopened (no extra entries); B: "already reopened in another tab — nothing changed."
- Task 5 refresh both tabs — **Passed**: 8 tasks, 8 unique ids, QA Task 2 done, others open; both tabs "1 of 8 tasks complete".
- Project stage, detail page — **Passed**: stored Design; outdated B refused ("This project was changed in another tab…").
- Project stage, board — **Failed → fixed → Passed**: stored Testing & QA; B refused; history only Discovery→Design, Design→Testing & QA.
- Archive from both tabs — **Passed**: archived once, 1 "Archived (records kept)" entry; B: "already archived in another tab — nothing changed" (no false success); after refresh both tabs show Restore project.
- Project notes from two tabs — **Passed**: "Note: QA note from tab A" and "…tab B" on this project only, no duplicates.
- Client notes from two tabs — **Passed**: both stored once as note activities on the linked lead.
- Client requirements conflicting edit — **Not tested**: requirements support add/tick only, no text editing.
- Delivery & finance — **Passed**: Mark delivered (with override reason for open checklist items) → stage delivered; deal ₹40,000 (status active, unchanged), received ₹20,000, outstanding ₹20,000; payments 5 before/after, same two payments, none voided; Finance tab identical in both tabs after refresh.
- Employee C authorized task action — **Passed**: completed own assigned QA Task 1; unassigned task disabled; no Finance tab, no amounts.
- Unauthorized Employee D — **Passed**: no Save changes, stage select disabled, no archive, no project-note box; client note refused ("You don't have permission to add client notes."), nothing stored; no amounts shown.
- Revoked permission on reopening preview — **Passed**: Employee C's task button disabled.
- Preview isolation — **Passed**: Owner projects, tasks, deals, payments, activities and leads byte-identical after each preview exit; task completed in preview not in Owner data.
- No page errors in any run.

**Gates.** 458 tests pass (baseline kept; fixes are screen wiring onto already-tested store guards), typecheck clean, full production build OK.

**Limitations.** No cross-tab lock: two saves landing in the same instant can still race. Reassign/due-date task selects apply onto the latest record without a conflict prompt. Not real multi-user sync; data lives in this browser only.

Open: D2.1.1 storage-failure browser tests, Pipeline long-column performance, actual Owner quotation-package verification, physical pointer-driven Pipeline dragging, tag-filter clearing browser test, security/privacy/accessibility audit, final end-to-end acceptance, secure backend transactions and actual restoration.

## Checkpoint D2.1.1 — Final storage-failure browser acceptance

Environment: one headless Chromium test browser on the dev server, fresh synthetic demo data (no Owner records). Isolated records: "T211 Proof Deal" (Other client, ₹50,000), one ₹10,000 payment, project "T211 Storage Project" with tasks "T211 Task A" / "T211 Task B", synthetic PNGs (proof_a 140 B, proof_b 156 B). Everything created through the real UI.

Failure injection:
- localStorage: `Storage.prototype.setItem` wrapped in the page to throw a real `DOMException("QuotaExceededError")` only for the CRM key. The app's own persist path (`atomic` → zustand persist → setItem) runs unchanged and hits the error exactly as a full browser would. Browser storage was never cleared.
- IndexedDB: `IDBObjectStore.prototype.put` wrapped so the real readwrite transaction is aborted after the file and metadata writes are queued. This exercises the real `idbProofRepo.put` transaction and its rollback; it does not reproduce the exact `QuotaExceededError` name a real full disk produces (so the generic, not the "storage is full", message is shown).

| Scenario | Result |
|---|---|
| 1. Project Task save failure | **Passed** |
| 2. Payment-proof replacement failure | **Passed** |
| 3. Data Vault after failed saves | **Passed** |
| 4. Storage-failure UX | **Passed** after 1 fix |

1. Tasks — notes saved normally, survived refresh (v2). Under failure: notes edit → Save showed only "Browser storage is full … Nothing was recorded", no "Task notes saved"; typed draft stayed in the box; stored notes, version and history unchanged. Complete Task B under failure: button stayed "Complete", stored status open, no history entry. 5 writes blocked. Retry: "Task notes saved", refresh shows new notes, exactly 1 history entry added; completion retry persisted once.
2. Proofs — original PNG readable after refresh, 140 B, SHA-256 3ac066a0…8eaa. Under failure: "Proof not saved: Couldn't save the file in this browser — The previous proof is unchanged", no "Proof replaced"; original bytes/checksum and attachment id unchanged, viewer still shows it; payment ₹10,000 unchanged. Retry: "Proof replaced"; after refresh bytes = replacement (156 B, checksum match). Exactly one metadata and one file entry — no orphans or duplicates.
3. Vault — real Full Backup downloaded ("Complete backup verified and downloaded."); ZIP inspected: 24 entries, manifest complete, 1 of 1 proof files, only the replacement PNG (old checksum absent), deal/payment/project/tasks present with the retried notes. Restore & Verify: "Valid complete backup". Only `backupHistory` changed — no business records modified. Restore not enabled.
4. Defect fixed (reproduced in the browser first): after a successful retry the old "Browser storage is full" / "Proof not saved" message stayed on screen next to the success message. Now cleared on the next successful save (`recoveredFromFailure`, proof toast id per payment). Regression test added.

Quality gates: 459 tests pass (1 new), typecheck clean, production build OK.

Still open: Task assignee and due-date cross-tab conflict protection; Pipeline long-column rendering; real Owner quotation package verification; real mouse Pipeline drag; tag-filter clearing browser regression; security and privacy audit; accessibility and keyboard testing; final end-to-end acceptance; future secure Hostinger persistence, atomic transactions and real restoration.

## Checkpoint D3.1 — Pipeline performance & real drag (done)
- Bottlenecks found: every lead's card mounted at once (≈5,000 at 5k leads); each stage re-filtered and re-sorted all leads several times per render; every card re-rendered on any click (inspector, move, show more). Remaining cost on a stage change is the full browser-storage save/re-read of the CRM (persistence architecture unchanged by design).
- Changes: `groupByStage` (one pass), `visibleCards` + `PIPE_BATCH = 40` in `pipeline.ts`; per-stage "Showing X of Y leads · Show N more" at the column bottom; the dragged card and the selected (`?lead=`) card stay mounted even beyond the batch; memoized `Ticket` with stable handlers. Stage counts, values, flags and KPIs still use all leads.
- Filters/search: the Pipeline page has no filter or search controls today, so Part 3 had nothing to test there; deep-link `?lead=` to card #4995 opened and mounted it correctly.
- Measured (test browser, dev server, isolated synthetic leads, median of 3): 1,000 leads load 2.2 s → 1.76 s; 5,000 leads 6.8 s → 2.36 s; 240 cards mounted at both sizes. 5k: Show more 0.74 s, inspector 0.62 s, stage change 0.99 s, scroll 0.04 s. 1k: 0.50 / 0.39 / 0.30 / 0.07 s.
- Integrity at 5,000: stored 5,000 unique ids; on-screen stage counts equal stored totals; Show more ×3 → 160 unique cards, no duplicates; no page errors.
- Real mouse drag (page.mouse down/move/up, no dispatched events): card moved New → Qualified once, one status history entry, Undo returned it to New.
- Responsive 1440/1024/768/390/360: no page-level horizontal overflow, Show more visible and usable.
- Not browser-tested this round: employee without stage permission dragging (covered by existing guard + `canMove`), cross-tab stale stage (existing tests).
- Tests 463 pass (4 new), typecheck clean, production build OK.
- Still open: task assignee/due-date multi-tab conflicts; Owner quotation packages; tag-filter clearing; security/privacy; accessibility/keyboard; final Lead→Deal→Payment→Project→Delivery→Support acceptance; future secure Hostinger backend and restore.

## Checkpoint D3.2 — Task conflict safety & Leads tag-filter selection (done)
- Before: task assignee/due-date edits already sent the row's task version, so a stale save was refused, but the person's choice vanished behind a generic toast; any employee id (inactive/unknown) could be assigned.
- Fixed: stale assignee/due-date edits now show an inline notice in the task ("Nothing was saved. Latest: … Your change: …") with Apply my change (re-sends only that one field on the latest version — the other tab's other field is kept) / Keep latest. `updateTask` refuses newly assigning anyone but nobody, the Owner or an active employee (`taskAssigneeError`).
- Two real tabs (Tab B with incoming storage updates suppressed; real clicks, production save path): A) stale assignee refused, emp_b kept, notice shown, Keep latest kept emp_b. C) stale due date refused, 2026-11-10 kept. D) A reassigned, B's stale due date blocked, Apply my change → assignee emp_a AND due 2026-12-05 (both kept). B) inactive employee assignment refused with message, assignee unchanged. E) task notes conflict still keeps B's draft, A's notes saved. 2 tasks / 2 unique ids, other task untouched, history one entry per successful change; both tabs after refresh: "QA Employee A · due 5 Dec".
- Leads tag filter (real UI, 60 Tag A + 30 Tag B synthetic leads): F) Tag A, select page + all 60 matching − 1 = 59 → switching to Tag B cleared selection with "Selection cleared because the filters changed", nothing checked, 30 rows all Tag B. I) selecting Tag B page → 30 selected, none from Tag A; assign dialog showed 30, not 59/60 (closed without assigning). G) clearing the tag filter cleared selection. H) Saved View A (60, ids 0–59) select 50 → switching to View B cleared selection ("view changed"), rows exactly ids 60–89. Leads, assignments and tags byte-identical afterwards; no page errors.
- Not browser-tested: unauthorized employee reassigning and preview isolation for tasks (existing `canEditTask` guard + D2.2.2B.1 browser run); due dates are plain calendar dates (no time-zone shift possible).
- Tests 471 pass (8 new; one older test given active employees), typecheck clean, production build OK.
- Still open: Owner quotation packages; security/privacy; keyboard/accessibility; final end-to-end workflow; backend atomic transactions, central storage and real restore.

## Checkpoint D3.3 — Sales Studio, quotation packages & WhatsApp (done)
- **Actual Owner quotation packages — NOT VERIFIED (Owner-browser data unavailable).** They live only in the Owner's own browser storage; the test browser can't see it, and no synthetic data was put there. Owner checklist (read-only): open Sales Studio → Quotations; confirm all 3 package names, prices and messages; refresh and confirm unchanged; open a lead's WhatsApp → Quotation, click each package and check the name, price and wording for that lead with no `{...}` left; close without logging.
- Defect fixed: saving a package from an outdated tab silently overwrote the newer package. `saveQuotationTemplate(t, baseUpdatedAt)` now throws `StaleRecordError` ("quotation") and writes nothing; the editor keeps the edits with Load latest / Keep my edits (confirmed), no success toast.
- Synthetic browser run (real UI, 3 packages created via Add quotation, 2 test clients): persisted after refresh; Lead A: each package gave the right first name, package name, price and its own description, no placeholders, no mixed descriptions; edited draft + package switch → Cancel kept the draft, OK loaded the chosen package, text stayed editable; Open in WhatsApp (link blocked in test) logged nothing (0 → 0); "I sent it — log to history" → exactly 1 WhatsApp history entry + 1 share snapshot, 0 payments/deals; Lead B: own name/phone, no Lead A details; packages byte-identical after use. Two tabs: Tab A saved ₹16,500, stale Tab B's ₹99,999 refused with warning, draft kept, no false success; other packages unchanged; Load latest showed ₹16,500. Composer at 1440/768/390/360: dialog and log button fit, no overflow.
- Not browser-tested: employee package permissions and preview (existing `quotations.manage`/`quotations.use`/`clients.whatsapp` guards and earlier tests); real storage-full during package save (shared `atomic` protection).
- Tests 473 pass (2 new), typecheck clean, production build OK.
- Still open: security/privacy; keyboard/accessibility; final end-to-end acceptance; cross-tab atomicity + server-enforced access in the backend; real full-data restore.

## Checkpoint E1.1 — Security, permissions & sensitive-data privacy (partial)

**Method:** compared every store action against the preview `GUARDS` table and every CRM state key against what `scopeWorkspace` replaces in the employee copy.

**Actions:** all business mutations are guarded. Unguarded: `setNotifyPrefs`, `markNotificationRead`, `markAllNotificationsRead`, `ingestEvents`, `toggleBriefing`, `resetBriefing`, `preferences`. These are preference or read-state changes only, and preview writes never reach storage.

**Defect found and fixed (Medium/High — exposure through secondary data):** the employee preview copy still held the Owner's full data for these: `teamEvents` (including payment amounts in `newValues` for every lead), `reminders`, `assignments`, `assignmentEvents`, `goals`/`goalRevisions`/`goalAlerts`, `inboxMeta`, `leadRelations`, `employeeAccess`, `savedReports`, `forecastHistory` and `expectedClose`. The screens didn't show them, but any page or selector reading them could. The new pure `scopeSecondary` in `preview.ts` filters these to the employee's in-scope leads and projects. It strips old/new values from deal and payment events when the employee lacks finance-amount access, keeps only the employee's own visible goals, and empties the Owner-only analytics data.

**Browser (test browser, synthetic data, Employee A Salesperson, finance none):** Owner payment events with ₹73,331 (assigned lead) and ₹91,919 (unassigned lead), plus saved report "QA Secret Report 55511". In preview memory: only the assigned lead's event remained, with no amount; the other event and the report were absent. My Performance showed neither amount. Analytics didn't show the report. The unassigned lead didn't open through `?lead=`. Owner storage was byte-identical afterwards and the Owner's 2 events and 1 report were back. No page errors.

**Automated:** `preview.e11.test.ts` (5 tests).

**Not done in E1.1 yet:** Parts 2, 5, 6 and 7 rerun individually for Employees B and C, deactivated-employee and revoked-permission reruns, proof-preview and Data Vault direct-action reruns in the browser. Earlier B1.6 results cover these, but they were not repeated here.

**Open risks (frontend-only architecture):** Owner data and the employee preview share one browser origin and localStorage. Anyone using this browser can read everything with developer tools. Permissions are UI and store checks, not real authorization. Backups aren't encrypted. Real enforcement requires the future secure backend.

**Results:** 478 tests pass (473 + 5), typecheck clean, production build OK.

Outstanding: Owner quotation-package manual check; E1.2 input/injection checks; E2 accessibility; F final end-to-end; secure backend authorization, atomic transactions, central data, real restore.

## Checkpoint E1.1B — Remaining real-browser security checks (done)
Real test browser, isolated synthetic data (E11B employees A–D, deals ₹73,331 / ₹91,919 / ₹55,555, two PNG proofs, two projects, one Owner note). Previews started through the real `/team/preview/:id` route; pages opened through the app router.
- **Employee B view-only — Passed.** Exactly 2 assigned leads; 0 deals/payments/notes/projects in the copy; no amounts in team events; lead edit, client note and tag writes refused; another employee's lead link showed not found; /deals blocked; Owner note absent.
- **Employee C projects/finance — Passed.** Only "E11B Project C"; 0 deals/payments; other project link and amount hidden; /deals blocked.
- **Deactivated employee — Passed after fix.** Preview of an inactive employee is blocked ("is deactivated", no session). Defect: a preview opened before the Owner deactivated the employee in another tab still accepted actions in the working copy. Fixed: the store guard re-reads the Owner's saved employee status before every outermost preview action and refuses all actions once inactive/archived. Saved Owner data unchanged.
- **Revoked permissions — Passed.** After removing C's project permissions and A's deals.view, reopened previews: C saw 0 projects, project note refused, project page blocked; A saw 0 deals/payments and /deals blocked.
- **Payment-proof access — Passed after fix.** Defect (High): in a preview, Replace/Remove/Add proof wrote straight to the Owner's real proof storage — even for a payment outside the employee's scope — and Download ignored `proofs.download`. Fixed in `idbProofRepo`: writes/removals throw `PROOF_PREVIEW_DENIED` during a preview, and list/get return only proofs of payments in the scoped copy; the UI hides Replace/Remove/Add proof in a preview and shows Download only with `proofs.download`. Rerun: proof dialog showed only zoom + Close, both direct saves refused, proof files byte-identical.
- **Data Vault — Passed.** /data-vault blocked in preview; direct `buildBackup` as salesperson/custom denied; Owner data unchanged.
- **Cross-preview isolation — Passed.** A (3 leads, edited one) → switched straight to B: 2 leads, 0 deals; after exit Owner storage and proof files identical.
- Harness notes: an earlier run read a stale code copy after a live reload and one step ran as Owner without a preview; those results were discarded and the steps rerun correctly.
- Tests 480 pass (2 new), typecheck clean, production build OK. No page errors.
- Limits: all checks are in-browser rules, not real security; the backend must enforce the same.
- Still open: Owner quotation packages; E1.2 input/injection; E2 accessibility; F end-to-end; secure backend.

## Checkpoint E1.2A — Input safety, content injection & link validation (2026-10-29)

**Inputs reviewed:** lead name/company/phone/email, client notes, call logs, custom fields (incl. URL type), tags, quotation/WhatsApp text, Sales Studio demo links, project links and delivery link, payment amounts, payment-proof file names.

**Rendering:** no `dangerouslySetInnerHTML` on user data (only shadcn chart CSS). All user text renders as React text. Personal Notes use Tiptap's schema-based parsing (no raw HTML insertion).

**Defects fixed (shared helpers in `validation.ts`):**
- Stored links (custom URL fields, demos, project links, delivery URL) were used as `href` as-is; tampered/imported data could hold `javascript:`. Now `safeHref` allows only http(s); anything else shows as plain text.
- Email check `\S+@\S+\.\S+` let `?cc=`/`&body=`/`#` change the mailto link. New `validEmail` (form + edit + store); `mailtoHref` hides the Email button for an unsafe value; emails are trimmed.
- Call links: `telHref` keeps digits and a leading + only; an undialable number gives no link and opens no call log.
- `addLead` had no store-level validation; now `leadCreateError` refuses empty name, invalid phone/email, negative amounts.

**Browser Passed (test browser, synthetic data):** HTML/script-like lead name saved exactly and shown as text on lead page, Leads list, Pipeline (no injected elements, no dialogs, no page errors); script-like client note shown as text after refresh; invalid phone/email refused with messages and nothing saved; email trimmed; WhatsApp custom message with & ? # ₹ Hindi, HTML and 900+ chars → `wa.me/<number>`, single `text` param decoding to the exact message, no fragment, opening added 0 history entries (request intercepted, nothing sent); payment amounts 0, −500, empty, 1e15 → "Enter a valid amount", huge value → "exceeds outstanding", 0 payments created; .exe proof not attached; proof named `<img src=x onerror=alert(1)> proof ✓ & "q" #1.png` displayed as text and stored with exact name linked to its payment; tampered `javascript:` custom field and demo links rendered with no javascript href, tag with HTML-like name shown as text.
**Browser note:** a negative budget on Add lead is dropped (field left empty), existing behaviour.
**Automated-only:** `inputSafety.e12.test.ts` (6 tests).
**Not tested in browser this round:** project task title and quotation description special characters (fresh test browser has no projects), Employee Preview proof-modification regression (covered by E1.1B tests), employee permission vs. untrusted text.

**Status:** 486 tests pass, typecheck clean, production build OK.
**Server-side needed later:** validation and URL/permission checks must be repeated on the future backend; browser storage stays readable by anyone with local access.
**Open:** E1.2B (browser reruns above), E2 accessibility, F end-to-end, Owner quotation-package manual check, future secure backend.

## E1.2B — partial (this round)
- Fixed: Add Lead silently dropped a negative Budget / Quoted amount. New `amountFieldError` shows "Amount can't be negative"; nothing saves; other fields stay filled. Edit Lead already refused negatives via `leadEditError`; bulk/AI paths never produce negatives.
- Browser Passed: Add Lead with -500 budget → message shown, 0 leads saved, name/company kept; corrected to 0 → saved once (zero stored as empty per existing rule), no page errors.
- Automated: 487 tests pass (1 new), typecheck clean.
- Not Tested this round: project task/notes special characters, quotation descriptions + WhatsApp, Employee B/C preview regression, preview proof-modification refusal, link regression.
- Still open: Owner's three real quotation packages (manual), E2, F, secure backend.

## E1.2B.1 — remaining security browser tests (isolated test browser, synthetic data only)
Setup: test records created with the app's own store actions on the app's live store instance (resolved by resource URL), then exercised with real UI clicks. No code changes needed; no defects found.

Browser Passed
- Project text: project created via "Create project" handoff; task title `<img src=x onerror=alert(1)> Task "A" & <b>B</b> — हिंदी ✓`, requirement `<svg onload=…> Req & "photos" — लोगो`, project note `<script>…</script> Note & ‘quote’ < > नमस्ते` added via the UI; after reload each appears exactly once as text, no injected img/svg/script elements, board loads, no dialogs/page errors.
- Quotation & WhatsApp: 3 synthetic packages (HTML-like, quotes, Hindi, ₹, #, ?) saved through the editor; after reload all 3 cards present, description reopens byte-exact, nothing injected. Composer on a synthetic lead → wa.me/919822233344, single `text` param = exact message with description, name and ₹30,000, no fragment; quotation shares 0→0 and activity count unchanged after closing without "I sent it".
- Employee B (view-only, assigned lead with HTML-like name/notes/tag, javascript: custom field): sees only own lead; unassigned lead hidden in list and by direct URL; name/notes/tag rendered as text, 0 javascript links; Stage select disabled; Log note refused ("You don't have permission to add client notes."); quick status, update and tag writes refused; working-copy lead unchanged. Follow-up and Log call dialogs still open (not submitted — UX note, not tested further).
- Employee C (Delivery, projects.view + tasks_complete, no finance): sees only the assigned project (special-character title); unassigned project hidden and "Project not available" by URL; no Finance tab, no amounts on project or Deals; Complete works on own task; Add task hidden.
- Proof isolation: Owner added a PNG proof via UI. Employee B/C: no Add proof, no View proof. Employee D (proofs.view, amounts, no download/replace/remove): image shown, no Replace/Remove/Download. Direct repo put/remove in preview → PROOF_PREVIEW_DENIED. After exiting, proof bytes (102 B, checksum) and metadata identical; Owner leads, deals, payments, projects, tasks, tags, field values, employees, notes identical.
- Links: https custom field and http demo clickable; javascript: custom field, demo (shown as text) and tampered project link (shown as text) → 0 javascript hrefs; adding a javascript: project link refused ("Enter a full link starting with https://"); Add Lead with `a@b.co?cc=evil@x.com` + 5-digit phone → both errors, 0 saved.

Automated-only: tel links for stored undialable phone numbers (the UI can't save one).
Not Tested: PDF proofs in preview; Employee B submitting the Follow-up / Log call dialogs.
Harness note: an early run read a second store module copy; those readings were discarded and rerun against the live instance.
Quality: 487 tests pass, typecheck clean, full production build OK.
Still open: Owner's three real quotation packages (manual), E2, F, backend-only security/central storage/real restoration.

## E2.1 — keyboard navigation, form accessibility, permission UX (isolated test browser, synthetic data)
Fixes made
- Permission UX: Log call and Follow-up are hidden for employees without `clients.calls` / `followups.create` (lead page, Leads and Pipeline side panels, Follow-ups page). `openCallLog`/`startCall` refuse centrally ("You don't have permission to log calls."), and `FollowUpDialog` shows no form without `followups.create` (new) / `followups.edit` (reschedule). Store guards are unchanged and still refuse writes.
- Focus return: dialogs opened from state (most CRM dialogs) sent focus to the page body on close. `DialogContent` now remembers the opener and restores focus, including for keyed remounts and autofocus fields.
- Pipeline: closing the inspector (Escape) returns focus to the card it came from.
- Add Lead: on a failed save, focus moves to the first invalid field; each error is linked to its field via `aria-describedby` (plus the existing `aria-invalid`).

Browser Passed (real keyboard input)
- Sidebar: Tab reaches every nav link in order with a visible outline; Enter navigates.
- Pages /, Leads, Pipeline, Follow-ups, Sales Studio, Deals, Projects, Team, Data Vault: no unnamed focusable controls, no positive tabindex, one main, no horizontal overflow at 1440. Personal Notes loads slowly (editor); not swept.
- Dialogs Add Lead, Schedule follow-up, Log call, WhatsApp composer, Record payment, Add employee: focus moves inside, has accessible name, 30 Tabs stay inside, Escape closes, focus returns to opener.
- Add Lead by keyboard only: invalid phone + −50 budget → both errors next to fields, aria-invalid on both, focus on phone.
- Pipeline: card reachable by Tab with visible ring; Enter opens inspector; ArrowDown on Stage select changed New → Contacted, history "Status changed to contacted", Undo by keyboard restored New; Escape closes and focus returns to card.
- Project tasks: task form fields in logical order; Space opens task editor (Reassign, due date, notes); Space on the check completes the task.
- Mobile 768/390/360: Add Lead opened by keyboard, failed save focuses the first field in view, next field stays in view, dialog scrolls, no horizontal overflow, focus returns.
- Employee B: Log call / Follow-up / Review & schedule not shown on lead page or Pipeline panel; direct store logCall/addFollowUp refused; no activity, follow-up or call log saved.
- PDF proof: Owner attached a synthetic PDF through the UI. Employee C (no finance): no View/Add proof. Employee D (proofs.view, no download): sees "PDF document", no Replace/Remove/Download/Open and no download link. Direct repo put/remove refused in preview. PDF bytes and metadata identical after exiting.

Automated-only: dialog focus return (new jsdom test); permission helpers (new test).
Not Tested: Edit Lead form, Bulk Assignment, Payment Proof Preview by keyboard, Permission Editor toggles, quotation package fields, task notes/due-date error messages; Personal Notes keyboard sweep. Escape-safety of unsaved drafts was not checked beyond existing unsaved-change prompts. No screen reader was used.
Existing semantic decision kept: a zero Budget is stored as blank.
Still open: E2.2 (screen-reader semantics, contrast, touch targets), F end-to-end, Owner's real quotation packages (manual), server-side security/central storage/atomic transactions/real restoration.

## E2.2A — keyboard gaps, unsaved drafts, Personal Notes (isolated test browser, synthetic data)
**Defect fixed — drafts silently lost on Escape.** Add Lead, Schedule Follow-up, WhatsApp composer (hand-edited message) and Record Payment closed on Escape / outside click / X and threw away typed text. `DialogContent` now takes `dirty`; when set, those three close paths show an inline "Discard unsaved changes?" with Keep editing (focused) / Discard changes. Escape again = keep editing. Explicit Cancel buttons still close immediately (deliberate choice). Untouched forms close at once, with no prompt. Quotation Package Editor already used its own confirm (`window.confirm`), left unchanged.
Browser (keyboard): all 4 dialogs → Escape kept dialog open and asked; Keep editing kept the text; Discard closed; focus returned to opener; nothing saved (no lead, no payment, WhatsApp draft not logged as sent). Prompt fully visible at 1440/768/390/360, no sideways overflow.
**Personal Notes:** not reproducibly "too slow". Open→editor usable (3 cold runs): 4.9 / 3.8 / 3.4 s before vs a 3.3 / 2.2 / 2.3 s baseline page (Follow-ups), i.e. ≈1.2 s extra for loading the editor's code in dev mode; editor ready ≈70 ms after the page appears. Targeted fix: page subscribed to the whole CRM store (re-rendered on every unrelated change) → now subscribes to notes only. After: 2.7 / 2.2 / 2.7 s (dev-server timings are noisy). Keyboard: New note via Enter, title → Tab → toolbar, typing 45 chars ≈0.2–0.3 s, autosave "Saved", switch notes ≈0.25 s, refresh kept both notes and content. Conflict logic untouched; two-tab stale-note scenario NOT re-run in browser this round (automated tests pass).
**Not tested this round:** Edit Lead (inline form on lead page, not a dialog — no Escape guard), bulk assignment, proof viewer, permission switches, quotation fields by keyboard, Project Task editor Escape, task notes/due-date error messages. No screen-reader claims.
Tests 493 (2 new: `dialog-dirty.e22a.test.tsx`), typecheck clean, production build OK.
Open: E2.2A leftovers above; E2.2B; F; Owner's 3 real quotation packages (manual); future server-side security/storage.
