# Plan: hosting on Firebase

Status: **planned, not started.** This plan is for the release after MVP. Until then the app runs from the claude.ai links, with `server.py` kept as the self-hosted option.

## Why Firebase

- No server to patch, back up or keep running.
- Google sign-in is built in.
- HTTPS and a stable address come with Hosting, which is also what an installable app (PWA, see `RELEASES.md`) needs.
- The page already reads and writes records through a storage adapter (`store.js`) that is shaped like Firestore. A Firebase adapter is mostly a translation of that adapter, and the schedule logic and screens don't change.

## Two apps, one backend

Decided 2026-10-19. The hosted tool is two small front ends on one Firebase project, not one big page:

| | **Employee app** (`app` Hosting site) | **Admin back office** (`admin` Hosting site) |
|---|---|---|
| Who | Every active member | Admins (and editors) only |
| Screens | My schedule / next shifts, Schedule (find a person), Trades, Documents, Verify my info, Something wrong? | Employee cards, Corrections, Staffing dashboard, Projection with edit forms, imports (awards, notices), records editing, user approval |
| Device | Phone first, installable (PWA) | Desktop first |
| Ships | No admin code at all | Everything the admin needs |

- **Shared code**, one repo: `schedule.js` (watch math, cover kinds) and `store.js` (Firestore access) are used by both; a fix lands in both.
- **The security rules are the API.** Both apps talk to the same Firestore; the rules decide who reads or writes each record. There is no custom API server. Cloud Functions handle only the trusted actions (approve users, set roles, pick a trade, send invites).
- Hiding admin screens is not the security: a member can't read cell numbers or edit records even with a modified page, because the rules refuse it.
- **One live database, from launch day: Firestore.** A claude.ai page can only reach its own page database, so the claude.ai main page and Firestore can't be kept in sync; running both would split the records.
- **The admin back office moves at the same launch.** At first it is today's full page (every screen, edit form, Employee cards, Corrections) built with the Firestore adapter in `store.js` and hosted on the `admin` site with admin-only sign-in. The employee app is the new stripped-down build on the `app` site. A redesigned back office can come later.
- **Cut-over:** (1) freeze edits on the claude.ai main page; (2) copy all its records into Firestore once; (3) check record counts match; (4) admins switch to the `admin` site; (5) the claude.ai main page goes read-only, then is retired (the view-only snapshot can stay as a demo).
- **Optional test beta first:** testers can try the employee app on a test copy of the data (marked as not live) while admins keep editing on claude.ai; the copy is re-run on cut-over day.

## Before starting

These need answers before any build work:

1. **Account ownership.** The app holds employee names, IDs, phone numbers and birth/hire dates. Confirm with the department or city IT where it may be hosted. If they want it under a department-owned Google Cloud account, create the Firebase project there.
2. **Who may sign in.** Any Google account, or only certain email domains (e.g. the department's). This maps to `ALLOWED_DOMAINS` today.
3. **First admins.** Which email addresses start as admins (today's `ADMIN_EMAILS`).
4. **Address.** The free `*.web.app` address, or a custom domain.
5. **Icon.** A department-approved icon for the installed app, or a placeholder.

## What moves where

| Today (`server.py`) | Firebase |
|---|---|
| Static page, JS, CSS | **Hosting** (public files only; no names in them) |
| Roster (`positions.json`), required staffing, employee IDs (names and IDs) | **Cloud Storage** `data/…`, readable by active users only |
| PDFs in `docs/` | **Cloud Storage** `docs/…`, readable by active users only |
| Google OAuth, sessions, CSRF header | **Firebase Auth** (Google provider). The ID token replaces the cookie and CSRF header |
| `users` table, roles, claim / approve | `users/{uid}` docs plus **custom claims** (`role`, `active`) set only by Cloud Functions |
| `statuses`, `tour_changes`, `covers`, `people`, `staffing` tables | Firestore collections with the same names and fields as the current page database (`tourChanges` camel-cased) |
| Contact info with share toggle | `contacts/{uid}`; readable by its owner, admins, and everyone active when `share` is on |
| `profiles` (birth / hire dates) | `profiles/{key}`; owner and admins only |
| `/api/stats` (average age and years of service) | Callable function that returns only the averages |
| `trades`, `trade_replies` tables (claude.ai page: `trades`, `tradeReplies`, `members`) | `trades/{id}`, `tradeReplies/{id}`; the claim is `users/{uid}.pos` |
| Trade alerts opt-in (`alert_text`, `alert_app`, `alert_email`) | `users/{uid}.alerts` `{text, app, email, board}` plus `fcmTokens/{uid}/{token}` |
| `audit` table | `audit/…`, written by functions and Firestore triggers only |

## Firestore data model

- **`users/{uid}`** `{email, name, status: pending|active|disabled, role: member|editor|admin, pos|null, claim: {pos, note}|null, claimRequest: {name, rank, company, tour, emplId?, note?}|null, createdAt, lastLogin}`
  - The user creates their own doc as `pending` on first sign-in.
  - The user may change only `claim` and `claimRequest`, and only while pending.
  - Everything else is changed by functions.
- **`statuses/{id}`, `tourChanges/{id}`, `covers/{id}`, `people/{id}`, `staffing/{company}`**: the same fields as now.
  - Existing ids are kept (`c2027-…`, `x2027-…`), so added people stay keyed `person:<id>`.
  - `createdBy` becomes the editor's uid.
- **`contacts/{uid}`** `{pos, contactEmail, phoneMobile, phoneOther, share}`.
- **`profiles/{key}`** `{birthDate, hireDate, updatedAt, updatedBy}`; the key is a position number or `person:<id>`.
- **`trades/{id}`** `{posterKey, seatPos, date, note, audience: {board, to: [keys]}, status: open|set|cancelled|expired, takerKey, replyId, proposal, createdAt, setAt}`.
- **`tradeReplies/{id}`** `{tradeId, takerKey, proposal: {swapDate}|{later: true}, swapSeatPos, note, createdAt, verified, via: "app" | "link" | "poster", recordedBy}`. `via: "poster"` is an answer the poster entered (**Add their answer**); `via: "link"` came from a trade invite link before sign-in and stays `verified: false` until the taker signs in with a matching Employee ID. A trade picked on an unverified answer is `pending` until then.
  - Picking a response runs in the `pickTrade` function (below), which writes the one-day cover and TR status records with `tradeId`.
- **`audit/{id}`** `{at, actor, action, target, detail}`.
- **`tradeInvites/{code}`** `{kind: "trade" | "join", tradeId, recipientKey, inviterKey, createdAt, expiresAt, usedBy|null}`: invites (see `RELEASES.md`, Invites from trades). A `trade` invite is for a roster person who hasn't signed in; a `join` invite (no trade or recipient) is for someone not in the tool yet. Written and read only by functions.
- **`corrections/{id}`** `{aboutKey, kind, details, note, byUid, byKey, state: open|applied|dismissed, reason, handledBy, handledAt, createdAt}`: members create (rules: `create` if active, no read); admins read and update.
- **`invites/{code}`** `{key, sentBy, sentAt, usedAt, expiresAt}`: admin invite texts (see `RELEASES.md`, Invite texts from admins). Written and read only by functions.
- **Tab preferences** on `users/{uid}`: `prefs: {tabs: [...], home}`, written only by that user; `settings/defaults` `{tabs}` written by admins sets the starting set for new members.
- **Contact sharing** on `users/{uid}`: `shareContact` (bool, default false) and `shareChangedAt`; only the user (or an admin turning it off) changes it.
- **`rosterOverrides/{pos}`** `{emplId, name, rank, forName, updatedAt, updatedBy}`: Employee cards (see README). Read if active; write if admin. Applied over the roster files in the page; ignored once `forName` no longer matches the seat's holder.
- **`staffCells/{key}`** `{cell, updatedAt, updatedBy}`: staff-list cell numbers. Admins only (read and write); never in exports to members.
- **`calendarTokens/{secret}`** `{uid, pos, createdAt}`: for the calendar feed (see `RELEASES.md`, Calendar sync). Written only by functions; resetting the link deletes the old doc.

## Security rules (outline)

- **Roles come from custom claims:** `request.auth.token.active == true` and `request.auth.token.role in [...]`. This costs no extra document reads per check.
- **Records** (`statuses`, `tourChanges`, `covers`, `people`, `staffing`): read if active; write if editor or admin.
  - Field checks mirror `server.py`: VA/S/D codes, ISO dates, end ≥ start, tour 1–31, known rank, ID format `AA9999`.
- **`users`:** each person reads their own doc. Only admins list users, and that goes through a function.
- **`contacts`:** the owner reads and writes their own. Admins read all. Active users read a doc where `share == true`.
- **`profiles`:** admins read and write. A person reads and writes the doc whose key matches their linked position, using `pos` on the token.
- **`trades`:** create when active, linked (`pos` on the token) and `posterKey == pos`; read when you posted it, are in `audience.to`, took it, or it's on the board. Board eligibility (rank group, off that day) is checked in the function that lists the board, since rules can't run the tour math.
- **`tradeReplies`:** create your own (`takerKey == pos`); read your own, or replies to your trades. Picking and cancelling go through functions only.
- **`audit`:** admins read; no client writes.
- **Storage:**
  - `data/**` and `docs/**`: read if active, no client writes. Admins upload new vacancy lists through the console or a deploy script.

## Cloud Functions

- **`beforeUserCreated`** (blocking): reject emails outside the allowed domains, and mark `ADMIN_EMAILS` as admin + active.
- **`adminAction`** (callable, admin only), with the same actions as `POST /api/admin/users/<id>`:
  - approve (linking the claimed position in a transaction so a position can't be claimed twice, or creating the `people` doc for "not on the list" requests), reject, role, link, unlink, disable, enable.
  - It sets custom claims and keeps at least one admin.
- **`adminUsers`** (callable, admin only): the users table for the Admin page.
- **`rosterNames`** (callable, pending users): positions not yet linked to an account, for the claim screen.
- **`stats`** (callable, active users): average age and years of service for a date.
- **Audit triggers:** on writes to the record collections, append to `audit`.
- **`pickTrade`, `cancelTrade`** (callable, the poster): re-check eligibility with the same rules as `server.py` (rank group from `RANK_GROUPS`, off that day, no status; for a swap, the taker works the swap day and the poster is free), then write or remove the cover and TR records in one transaction.
- **`expireTrades`** (scheduled, nightly): marks open trades whose date has passed as expired.
- **Trade alerts:** a Firestore trigger on `trades` and `tradeReplies` sends, to each person by the channels they opted into:
  - **app** pushes through **Firebase Cloud Messaging**;
  - **texts** through **Twilio** (A2P 10DLC registered; Google has no SMS API);
  - **email** through the **Gmail API** from a department Workspace account.
  - Twilio keys and the Gmail sender's credentials live in **Secret Manager**.
  - Messages carry the details (who, date, watch, station, note, day-before / day-after for the reader) and one-tap actions; board posts follow `users/{uid}.alerts.board` (`off` | `daily` | `each`).
- **`boardDigest`** (scheduled, daily): one summary per person with `board: "daily"` of new board posts they could take.
- **`smsReply`** (HTTPS, Twilio webhook, signature checked): handles text replies (1, 2 + date, PICK) from a member's phone number with the same checks as `pickTrade`.
- **`tradeAction`** (HTTPS): signed, single-use email links (expire after 7 days, tied to the trade and the person).
- **Answers without an account** (see `RELEASES.md`, Answering without an account):
  - **`recordAnswer`** (callable, the poster): adds a `via: "poster"` reply for someone who could take that day, checked with the same rules as `pickTrade`.
  - **`answerFromInvite`** (public HTTPS): a trade invite code plus a proposal; one answer per code, rate-limited; saves a `via: "link"`, unverified reply.
  - **`pickTrade`** on an unverified reply sets the trade to `pending`; **`redeemInvite`** finishes it (writes the cover and TR) once the taker's Employee ID matches.
  - **`lapsePendingPicks`** (scheduled, hourly): a pending pick not verified by 48 hours before the shift, or 24 hours after the pick, lapses back to `open` and the poster is told.
- **Invites from trades:**
  - **`createInvite`** (callable): for `kind: "trade"`, checks the trade was sent to that recipient and that they have no linked account (20 a day per poster); for `kind: "join"`, no trade (10 a day per member). Takes a list of recipients (for **Invite all**) and returns one code and the filled-in invite text per person (who, rank and station, date and place, off that day / works the day before or after, note, link). Phone numbers typed by the member never reach the server.
  - **`inviteInfo`** (public HTTPS): for `/t/<code>`, returns only the rank group, the date and "24-hr shift", or "expired".
  - **`redeemInvite`** (callable, signed in): with the code and an Employee ID that matches the invited roster entry, links the account to that position, approves it (`approvedBy: "invite"`, `invitedBy`), sets the custom claims and marks the code used. A mismatch falls back to a normal pending claim. A `join` code stamps `invitedBy` on the user's "not on the list" `claimRequest`, which an admin approves as usual; the Admin users list shows "Invited by".
- **`sendInvites`** (callable, admins): for chosen people, creates an `invites` code and texts the staff-list cell number through Twilio; skips anyone opted out or with an active invite. **`redeemInvite`** above also accepts these codes and pre-fills the claim with the invited seat.
- **Nightly backup:** scheduled export of Firestore to a Cloud Storage bucket.
- **`exportContacts`** (callable, active users who share their own number; admins any): `{scope: "battalion" | "rank" | "all", format: "vcf" | "csv"}` builds the file from opted-in users only (name, Employee ID, rank, station, tour, cell), returns it for download, and writes an `audit` entry. Nothing is stored.
- **`calendarFeed`** (public HTTPS, `/cal/<secret>.ics`): looks up the secret in `calendarTokens` and returns that person's schedule as iCalendar, cached for an hour. `calendarLink` (callable, active users) creates or resets a person's secret.

## Changes in this repo

- **`store.js`:** add `firebaseAdapter(onChange)` with the same interface as `serverAdapter`:
  - `me`, `isActive`, `isAdmin`, `canEdit`, `canAdmin`;
  - `claim`, `claimRequest`, `rosterNames`, `saveContact`, `contacts`, `adminUsers`, `adminAction`;
  - `profiles`, `setProfile`, `stats`, `setStaffing`;
  - `addStatus`, `addTourChange`, `addCover`, `endCover`, `addPerson`, `remove`, `signOut`.
  - Records come from `onSnapshot`, as the claude.ai adapter does now.
  - `connect()` picks it when `window.FIREBASE_CONFIG` is present.
- **`app.js`:** load the roster, required staffing, employee IDs and the docs list from Storage when on Firebase. Everything else is unchanged.
- **`admin.js`:** the sign-in gate uses Firebase's Google sign-in popup or redirect in place of `/auth/login`. The claim screen and Admin page are unchanged.
- **New `firebase/` folder:**
  - `firebase.json`: hosting, rules, functions, emulators;
  - `firestore.rules`, `storage.rules`, `firestore.indexes.json`;
  - `functions/` (Node);
  - `public/` (built).
- **`tools/build_firebase.py`:** copies the app files into `firebase/public/`, writes `firebase-config.js`, and adds the PWA files (manifest, icons, service worker).
- **`tools/import_firestore.js`:** loads records from the current page database or `data/schedule.db` into Firestore with ids preserved, and uploads the roster JSON and PDFs to Storage.

## Testing

- **Firebase Local Emulator Suite** (Auth, Firestore, Storage, Functions): all development and tests run against it, never the live project.
- **Rules tests** with `@firebase/rules-unit-testing`, porting the cases in `tests/test_server.py`:
  - pending users see nothing;
  - members can't edit;
  - contact share on/off;
  - profiles are private;
  - bad codes and dates are rejected;
  - a position can't be claimed twice.
- **Function tests** for approve / link / role, and for keeping the last admin.
- **The existing Playwright phone and desktop checks**, run against the emulator. They must show the same totals as the claude.ai page for the same records (e.g. 263 on duty, 54 open on 10/15/2026).

## Launch steps

1. Create the Firebase project (on the account decided above), enable Google, email-link and phone sign-in (see "Sign-in without a Google account" in `RELEASES.md`), Firestore (production mode) and Storage, and choose the Blaze plan with a **budget alert** (e.g. $10/month).
2. Deploy rules and functions. Set `ADMIN_EMAILS` and the allowed domains as function config.
3. Run the import: records from the claude.ai page database; roster, IDs and PDFs to Storage.
4. Deploy Hosting. Sign in as the first admin, approve a test member and a test editor, and walk through every screen on a phone and a desktop.
5. Share the new address. Keep the claude.ai links read-only for a short overlap, then retire the view-only snapshot.

## Cost

- **Hosting, Auth and Storage at this size:** free tier.
- **Firestore:** a page open reads roughly 300 records (all live records). Several hundred opens a day is around 100k reads, about $0.06 a day on Blaze, and often inside the free 50k/day.
  - If that grows, bundle records into a few documents per collection.
- **Functions:** well inside the free invocations.
- **Expected total:** $0–5 a month. The budget alert catches surprises.

## Effort

Moderate:
- the adapter and sign-in changes;
- rules and four functions;
- the import script;
- tests.

The schedule logic, dashboard, phone layout and importers for new vacancy lists and Balance reports don't change.
