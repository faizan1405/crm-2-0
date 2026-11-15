# Scale Flow CRM — Android App + Website as One System

**Status: proposal only (16 Nov 2026 IST).** No code, server, database, login or Android build has been created. Nothing starts without the Owner's approval. CRM V1 (crm.joinscaleflow.in) and its GitHub repository are not touched by anything in this plan.

---

## 1. Where the CRM stands today (checked in the code, not the screens)

| Area | Today | What this means for an Android app |
|---|---|---|
| Where data lives | Only inside one web browser (localStorage + IndexedDB for payment proofs) | There is nothing for a phone to connect to yet |
| Login | Demo login; the password is never checked | No shared accounts exist yet |
| Server / central database | None | Must be built first |
| Real-time updates | Only between tabs in the **same** browser (`crossTab.ts`) | Good model to copy, but not across devices |
| Business rules | Pure TypeScript modules with 718 passing tests (`finance.ts`, `validation.ts`, `dates.ts`, `access.ts`, `pipeline.ts`, `projects.ts` …) | Can be reused as-is by the Android app and the server |
| Safe-edit checks | Projects, tasks and Support requests carry a `version` and refuse stale saves; every store change gets an `operationId` | Ready-made basis for conflict handling and duplicate protection |
| Conflict screen | "Reload latest / Apply my change" already exists for Support | Same screen can handle phone-vs-website conflicts |
| One data swap point | All pages read from one store (`store.ts`) | Pages do not need rewriting when the data moves to a server |

**Most important point:** an Android app built today would become a *third* separate copy of the data, not a connected app. The shared backend is the first step, and it is the same backend already planned in `antigravity-hostinger-backend-handover.md`. The Android app is added on top of it, not instead of it.

---

## 2. Target architecture

```text
   Website (browser)                     Android app
   same React screens                    same React screens inside a native shell
   + browser cache                       + encrypted on-phone database + offline queue
            \                                   /
             \  HTTPS (REST)  +  live channel  /
              v                               v
          ┌──────────────────────────────────────────┐
          │  One backend API  (/api/v1/...)           │
          │  login · permissions · validation ·       │
          │  sync feed · live updates · AI gateway    │
          └──────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              v                               v
     Central database                Private file storage
     (all CRM records,               (payment proofs, photos;
      change feed, devices)           short-lived signed links)
```

Both apps talk only to the backend. Neither keeps its own "real" copy; the on-phone and in-browser copies are caches that the backend keeps up to date.

---

## 3. Android approach — options compared

| Option | How much existing work is reused | Offline | Native feel (calls, camera, notifications) | Play Store | Rough extra effort |
|---|---|---|---|---|---|
| **A. Installable web app (PWA)** | 100% | Limited, browser-controlled | Basic; weak background reminders | Optional (TWA wrapper) | Small |
| **B. Capacitor app (recommended)** | ~100% of screens + all rules + tests | Full (on-phone SQLite + queue) | Good: native dialer/WhatsApp, camera for proofs, push notifications, fingerprint unlock | Yes | Medium |
| C. React Native | Rules only (~40%); screens rebuilt | Full | Very good | Yes | Large |
| D. Native Kotlin | None; everything rebuilt and re-tested | Full | Best | Yes | Largest; two codebases forever |

**Recommendation: B — Capacitor.** The same React screens and the same tested business rules run inside a real Android app, with native features added through plugins. One set of rules means the website and the app can never disagree about money, dates, permissions or duplicates. Screens get Android-specific touches (bottom bar, back button, swipe, haptics, larger tap targets); the CRM already has a phone layout (drawer, bottom bar, More sheet) to build on.

Option A can ship first as a quick step while B is being built.

**Honest limit:** Lovable builds the website. The Android package itself (APK / Play Store bundle) is built and signed in Android Studio by the developer (Antigravity), from this same code.

---

## 4. Synchronisation design

### 4.1 Every record gets sync fields
`id` (created on the device as a UUID, so offline records never clash), `version` (goes up by 1 on every save), `updatedAt`, `updatedBy`, `deletedAt` (deletes are marked, not erased, so the other device learns about them). Projects, tasks and Support already have `version`; leads, deals, follow-ups, notes, templates and settings need it added.

### 4.2 One ordered change feed
Every successful save on the server writes a row to a `changes` table: `seq` (ever-increasing number), entity, record id, new version, action, who, when. Any device can ask "give me everything after `seq` 5120" and catch up exactly — after being offline for a minute or a week.

### 4.3 Live updates
- Each signed-in device keeps one live connection (WebSocket; Server-Sent Events as fallback).
- The server sends a short message: "change 5121 happened". The device then pulls the change through the normal API, **filtered by that user's permissions** — the live channel never carries private data itself.
- When online, a change on one device shows on the other in about 1–2 seconds.
- If the live connection drops, the device keeps pulling every 30–60 seconds and on app open, so nothing is missed.

### 4.4 Your example, step by step
1. You create a task on the website → server saves it (version 1, change 5121) → Android app gets "change 5121" → task appears.
2. You tick it complete on Android → server saves version 2 (change 5122) → website gets "change 5122" → task shows completed. No refresh needed.

### 4.5 Offline on Android
- The app keeps an encrypted on-phone copy of the records this user is allowed to see.
- Changes made offline go into an **outbox** in order, each with its `operationId` (already generated by the CRM today).
- When the internet returns, the outbox is sent in order. The server remembers each `operationId`, so a change sent twice (weak network, retry) is applied only once — no duplicate leads, calls or tasks.
- A small banner shows "3 changes waiting to sync" and then "All changes synced".

**Allowed offline:** viewing leads, deals, projects and notes; adding/editing leads, call outcomes, follow-ups, notes; ticking tasks; drafting WhatsApp messages (sending opens WhatsApp as today).
**Online only (to keep money and access safe):** recording or voiding payments, changing permissions or team members, Data Vault, deleting records, AI tools. These buttons show "Needs internet" instead of failing.

### 4.6 Conflicts (same record changed on two devices)
| Case | Rule |
|---|---|
| New records, call logs, activity, notes added | Never conflict (each has its own id) — both kept |
| Different fields of the same record changed | Merged automatically |
| Same field changed on both | Server refuses the older one (version mismatch) → the existing "Reload latest / Apply my change" screen shows both values; the user decides |
| Edited on one device, deleted on the other | Not lost silently: the user is asked to restore or confirm the delete |
| Payments | Online only, saved in one server transaction, so totals can never split |

Business numbers (collected, outstanding, overdue, KPIs, stage age) are always recalculated from records by the shared rules — never synced as separate numbers that could drift.

---

## 5. Shared business logic

Move the pure rule modules (finance, validation, dates/India time, access/permissions, pipeline, projects, duplicates) into one shared package used by **three** places: website, Android app, and the server. The server re-runs every rule on every save, so a modified or outdated app can never bypass them. This is a strong reason to write the backend in TypeScript/Node (a Hostinger **VPS** or cloud plan that runs Node and keeps live connections open — basic shared hosting usually cannot hold WebSockets; confirm with the Hostinger plan).

The single store (`store.ts`) becomes a cache in front of a sync engine. Pages keep calling the same store actions, so screens and their tests stay as they are.

---

## 6. Security and reliability

- One account per person, same email and password on website and app; Owner sets up employees as in the existing Team screens.
- HTTPS everywhere. Website: secure HTTP-only cookies. Android: short-lived access token + refresh token stored in the Android Keystore; optional fingerprint unlock.
- Every request checked on the server against the same permission rules as `access.ts`. This makes the open item "employees seeing quoted amounts" a must-fix: hidden fields are removed on the server before they reach any device.
- On-phone database encrypted; wiped on sign-out. Owner can see signed-in devices and sign out a lost phone remotely.
- Payment proofs stay in private storage, opened with short-lived links, not stored openly on the phone.
- Rate limits, audit log (who changed what, from which device), daily server backups with a tested restore.
- Android app checks it is a supported version; very old versions are asked to update so old rules never write data.

---

## 7. Recommended build order

| Step | What | Rough effort (estimate) |
|---|---|---|
| 0 | Owner approves backend handover + this plan; confirms decisions in §9 | — |
| 1 | Backend, Owner/employee login, central database, API (already planned) | Part of the 38–65 developer-day Owner launch estimate |
| 2 | Data migration from this browser incl. payment proofs, with restore drill (already planned) | Included above |
| 3 | Sync fields, change feed, live channel; website switched to live sync | 8–12 days |
| 4 | Installable web app (quick win) | 2–3 days |
| 5 | Capacitor Android app: login, screens, dialer/WhatsApp, camera proofs, push reminders | 10–18 days |
| 6 | Offline copy + outbox + conflict screens | 8–14 days |
| 7 | Testing on real phones (cheap and mid-range Android, poor network), Play Store listing, release | 5–8 days |

**Android-specific total on top of the backend: about 33–55 developer-days (estimate, ±25%).** Each step ends with tests and an Owner check; nothing is released to employees until the Owner signs off.

---

## 8. Not breaking what works

- All 718 existing tests keep running; new sync tests are added (offline replay, duplicate retry, conflict, delete-vs-edit, permission filtering).
- The browser-only version stays available as a fallback until the server version is approved.
- Data is imported into a staging copy first; nothing overwrites live data.
- CRM V1 and its repository are never touched.

---

## 9. Decisions needed from the Owner

1. Approve the backend handover and this plan together?
2. Server: Hostinger VPS with Node (recommended for live updates), or a managed backend with built-in live updates and login (faster to build, but different from the Hostinger plan)?
3. Android approach: Capacitor (recommended), or quick installable web app first?
4. Who uses the Android app first: Owner only, or Owner + employees?
5. Is offline needed for all listed actions, or only viewing + call outcomes + notes?
6. Play Store public listing, or private install for the team only?
