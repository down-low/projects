# Plan: hosting on Firebase

Status: **planned, not started.** This plan is for the release after MVP. Until then the app runs from the claude.ai links, with `server.py` kept as the self-hosted option.

## Why Firebase

- No server to patch, back up or keep running.
- Google sign-in is built in.
- HTTPS and a stable address come with Hosting, which is also what an installable app (PWA, see `RELEASES.md`) needs.
- The page already reads and writes records through a storage adapter (`store.js`) that is shaped like Firestore. A Firebase adapter is mostly a translation of that adapter, and the schedule logic and screens don't change.

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
- **`audit/{id}`** `{at, actor, action, target, detail}`.

## Security rules (outline)

- **Roles come from custom claims:** `request.auth.token.active == true` and `request.auth.token.role in [...]`. This costs no extra document reads per check.
- **Records** (`statuses`, `tourChanges`, `covers`, `people`, `staffing`): read if active; write if editor or admin.
  - Field checks mirror `server.py`: VA/S/D codes, ISO dates, end ≥ start, tour 1–31, known rank, ID format `AA9999`.
- **`users`:** each person reads their own doc. Only admins list users, and that goes through a function.
- **`contacts`:** the owner reads and writes their own. Admins read all. Active users read a doc where `share == true`.
- **`profiles`:** admins read and write. A person reads and writes the doc whose key matches their linked position, using `pos` on the token.
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
- **Nightly backup:** scheduled export of Firestore to a Cloud Storage bucket.

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

1. Create the Firebase project (on the account decided above), enable Google sign-in, Firestore (production mode) and Storage, and choose the Blaze plan with a **budget alert** (e.g. $10/month).
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
