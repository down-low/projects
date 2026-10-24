# Hand-off: start here

The SFFD tour schedule tool: who works which seat on which day, covers / acting / shadowing, leave statuses, trades, and an admin back office. Read this first in any new chat, then `README.md` (features), `RELEASES.md` (roadmap) and `FIREBASE_PLAN.md` (hosting).

## Priorities, in order

1. **Firebase launch.** Live: the employee app at https://sffd-schedule.web.app and the back office at https://sffd-schedule-admin.web.app (project `sffd-schedule`); every merge to `main` deploys. Next: Launch is **without Twilio texts** (app notifications, email, texts from the poster's own phone); the text opt-in page is planned in `RELEASES.md`, Shift-trade alerts.
   - the user's setup, in their own Google account (`FIREBASE_SETUP.md`);
   - an optional test beta on test data (`BETA.md`);
   - cut-over (`CUTOVER.md`).

   Scope: `FIREBASE_PLAN.md`. Branch `claude/firebase-beta`.
2. **UI simplification.** The pages are too much for a typical employee. Direction picked (A for members; the admin site is the back office). First step shipped on branch `claude/ui-mockups`: member tabs Schedule, Crew (your apparatus), Projection, Trades, More. Status and next steps: `docs/ui-simplification.md`.
3. **Data cleanup.** Done in **one chat only** (the records chat, branch `claude/zen-wright-gqa6gq`). Its progress and next step live in `cleanup/STATUS.md`, its routine in `cleanup/README.md`; feature chats don't edit records.

## Who works on what (Oct 23, 2026)

Each chat has its own branch; check with the user before touching another chat's area.

| Chat | Branch | Owns |
|---|---|---|
| Tour schedule calendar tool (this hand-off's main chat) | `claude/gracious-franklin-z5zsyz` | Member features, sign-in, contact info, security rules fixes, docs |
| Records (cleanup) | `claude/zen-wright-gqa6gq` | All record edits and data cleanup (`cleanup/STATUS.md`) |
| Pay and overtime pay estimators | `claude/pay-estimator` | `pay.js` (More → Pay estimate), `hireDateGuess` |
| Admin back office | `claude/friendly-knuth-p8hhep` | Admin-site tools: filling open spots, OT lists, imports, audit view, **change history** (queued) |
| App notifications and announcements | `claude/notifications-diagnose` | Push, announcements, accrual-tracking consent |
| Shift trades | `claude/admin-trades-list` | `trades.js`, Admin: all trades |
| Staffing data analysis | `claude/admiring-edison-qyy8s1` | Staffing and overtime patterns |

## Shape of the hosted tool

Two front ends on one Firebase backend: a light **employee app** (schedule, trades, documents; phone first, no admin code) and a separate **admin back office** (Employee cards, Corrections, Staffing, imports, editing). Same Firestore underneath; the security rules are the API. Firestore is the only live database from launch day: admins move to the `admin` site at the same cut-over, and the claude.ai main page is frozen, copied once, then retired. Details: `FIREBASE_PLAN.md`, "Two apps, one backend".

## Demo branch

`claude/demo-app` is a separate, fictional demo (2 battalions, ~200 made-up people, view-only). It holds no real data and **never merges into `main`**; don't merge `main` into it either without re-deleting the real data files.

## Design principles (read before adding a feature)

- **Employees first, no overload.** Every feature is a module (its own file, like `trades.js`, `corrections.js`, `feedback.js`) with one menu entry, a rule for who sees it (member, editor, admin) and its settings. Members start with the basics (their schedule, crew, trades); everything else is opt-in ("Choose my tabs" in `RELEASES.md`) or turned on by an admin. Admin tools never ship in the employee app.
- **Built for SFFD now, other departments later.** Don't build multi-organization support yet, but keep three seams so a later version is configuration, not a rewrite:
  - **Terminology:** words like "Battalion Chief" / "Commander", "Engineer" / "Driver", "watch" / "shift" go through one word list, not hard-coded in screens.
  - **Rotation rules:** the 31-day, 9-watch pattern lives in settings, not only in `schedule.js`.
  - **Organization data:** roster, ranks, units and staffing rules stay in data files, separate from code.
  When SFFD is done, the general product starts as a new branch or project from this one, with an organization setup screen on top of these seams.
- **Spec each feature before building** (`RELEASES.md`, "Next release"), one at a time, since features share the person page, the More menu and `store.js`.
- **Back office later:** the "who covers which open spot" logic gets its own chat after the employee features.

## Prior app (to compare later)

The user built a similar, more complete but harder-to-use product earlier; its site still runs. When the user has its code (read-only export), start a new chat to write `FEATURES.md`: each old feature, who uses it, keep / simplify / drop, whether it exists here, and which module it belongs in. Business rules and edge cases come from the old code; screens are redesigned here. No comparison chat until the code is in hand.

## How we work

- **Git is the only source of truth.** Every chat works on its own `claude/…` branch and merges to **`main`** with a pull request. Nobody edits code on the host.
- **Firebase deploys from `main`** (`.github/workflows/firebase.yml`): every pull request runs the tests, including the security rules tests in the emulator; a merge to `main` publishes Hosting, rules and functions, and copies `data/` and `docs/` to Cloud Storage. Both Hosting sites come from one build (`tools/build_firebase.py`): `public-app/` (no admin screens) and `public-admin/` (the full page). The deploy is skipped until the GitHub variable `FIREBASE_PROJECT_ID` is set. Claude sessions have no live access to the project (no key, no Google APIs from the container): changes go through `main`, and problems come back as tester reports, screenshots and Actions logs.
- **Until cut-over** the claude.ai main page is the official copy, and anything on Firebase is a test copy with a banner. Records don't sync between the two.
- **Cut-over day** (`CUTOVER.md`): Claude republishes the page with `--frozen` (and the `--capabilities --frozen` rules); the admin replaces the Firestore records from the page's backup and sets the copy live.
- **After cut-over**, the claude.ai main page is frozen. Don't republish it with the normal build, and don't record anything there.
- Never delete the claude.ai page without the user's word.
- **Before publishing the claude.ai links, merge `main` into your branch.** Several chats publish to the same links; publishing from a stale branch drops other chats' work. If a publish is refused, merge the newer live version, don't overwrite it.
- Run `python3 -m unittest discover -s tests` before pushing.
- **Spec features in two phases.** With each request, propose a simple, fool-proof **Phase 1** to ship now and suggest **Phase 2** ideas for the user to think over (they decide; don't add them unasked, even small ones like a comparison line). Write Phase 2 down in `RELEASES.md` so it isn't lost. Build only Phase 1 unless the user says otherwise. Example: `SPEC-INVITES.md`.

## Where things live

| Piece | File |
|---|---|
| Watch / tour math, cover kinds (`isMove`, `coversOn`, `takesSeat`, `coverKind`, `RANK_LEVEL`) | `schedule.js` |
| Screens: Schedule (person), Projection (date), move log, corrections wiring | `app.js` |
| Staffing dashboard and stats lists | `dashboard.js` |
| Storage adapters (claude.ai page database, server, Firebase, view-only snapshot) | `store.js` |
| Firebase: rules, functions (accounts and approval), rules tests; both Hosting sites | `firebase/`, `tools/build_firebase.py` |
| Cut-over: page backup, Admin → Cut-over (replace and count check), frozen page build | `store.js`, `admin.js`, `tools/build_artifact.py --frozen`, `CUTOVER.md` |
| Trades, Corrections, Employee cards, awards, admin | `trades.js`, `corrections.js`, `card.js`, `awards.js`, `admin.js` |
| App notifications (push) and admin announcements (Admin → Send announcement; function `announce`, `notices/{uid}`) | `store.js`, `admin.js`, `app.js`, `firebase/functions/announce.js`, `deliver.js` |
| Self-hosted server (SQLite, Google sign-in); kept as the fallback | `server.py`, `tests/test_server.py` |
| Builds the claude.ai page; `--capabilities` prints the access rules | `tools/build_artifact.py` |
| Pay estimate and overtime pay (More → Pay estimate; function `hireDateGuess`) | `pay.js`, `firebase/functions/index.js` |
| Roster, required staffing, employee IDs (no phones), 2027 awards | `data/` |
| Watch calendars, vacancy list, awards PDFs | `docs/` |

Build: `python3 tools/build_artifact.py dist/tour-schedule.html` (main page); view-only: add `--snapshot snapshot.json --demo demo.json`.

## Live links

- **Main page** (page database, sign-in by claude.ai access): https://claude.ai/artifact/TS7W51mXHxgy7p2uvReSgC. Records live in its database: `statuses`, `tourChanges`, `covers`, `people`, `staffing`, `assignments` (move log), `rosterOverrides`, `members`, `trades`, `tradeReplies`, `corrections`, `contacts`, `profiles`.
- **View-only snapshot** (records baked in, trade demo): https://claude.ai/artifact/37DsLLYz74Kjysbd84cTXV.
- **Officer roster check** (private): https://claude.ai/artifact/LfUeKBV5UUh2TXNaiwJgLn.

## Security rules (never break these)

- **Cell numbers are admin-only.** They live only in the page database's `contacts/staff-list` (and `staffCells` on Firebase, rule `read, write: if isAdmin()`). Never put them in this repo, the view-only link, a member-readable collection, logs, or chat output. One exception (the user's call, Oct 2026): on Firebase, `createInvite` hands a trade's poster the cell of each person they sent the trade to who isn't on the tool yet, so Messages opens addressed to them; each one handed out is logged in `audit` (`inviteCell`). They move to Firebase only through the backup file the admin downloads and imports themselves; don't read `contacts` with ArtifactData.
- **Your own cell, shown back to you** (the user's call, Oct 23, 2026): the `myStaffCell` function returns the signed-in person's own staff-list cell (approved, on a seat, no sign-in cell yet) so My page → Add my cell for sign-in is filled in; the texted code still proves they hold that phone. Each one is audited (`ownCell`). Never anyone else's.
- **The staff-list cell is also an identity on Firebase** (the user's call, Oct 2026): signing in with a cell and its texted code links the account to the one seat with that staff-list cell, with no other check. Keep `staffCells` admin-only and accurate; a wrong cell there would let the wrong person in. Each link is audited (`cellLink`).
- **Shared contact info is the cell only** (the user's call, Oct 23, 2026): `contacts/<uid>` (everyone reads it when `share` is on) holds only `pos`, `phoneMobile` and `share`; the contact email and other phone live in `contactsPrivate/<uid>` (owner and admins). The rules refuse the email and other phone in `contacts`; `syncMe` moves older records across (`splitContact`).
- **Trade legs must match the trade** (security audit, Oct 23, 2026): a set trade's `legs` show on everyone's schedule as cover and TR records, so the rules accept only what `TourMath.pickLegs` makes (the answering taker covers the posted seat, the poster is TR on that day, and the reverse on a swap day).
- **Record edits aren't fully logged yet:** adds stamp `createdBy`, edits only the last `updatedBy`, deletes leave no trace. A change history (who, when, before and after, Restore) is queued in the back-office chat.
- **Leave balances** (`leaveBanks/<seat>`) are owner and admin only; a member's save must carry their consent (`consentAt`, `consentVersion`).
- Birth / hire dates (`profiles`) are owner and admin only.
- Corrections are per member (`corrections/<uid>`), readable only by that member and admins.

## Record conventions

- Covers: `{coverKey, coverName, targetPos, start, end, kind, move, note}`. Kinds: **acting** (officially promoted), **cover** (same rank in someone's spot), **shadow** (LWLP, mostly VR, doesn't take the seat), **extra** (also in the seat, no tag). `move: true` changes the owned seat.
- Statuses: VA, S, D, WE, TR.
- Every position move also gets an `assignments` row, linked to its record; it shows in the closed **Moves** section on the person's page. A paste-in notice import is on the roadmap; until then notices are pasted into chat and confirmed by hand.

## Open questions for the user

- January double covers.
- Ambiguous names in the staff list (93 unique matches applied; the rest wait on the user's name cleanup).
- Items from the officer roster check.
- **Decided (user, 10/23): overtime marks are visible to everyone** who opens that person's page (Want OT / Worked OT, `overtime.js`), not only the member and admins.
- **To enter (the user, as an admin, on Spencer's page; Overtime is live):** Spencer,Marcus D (`10EOE09M`, SP2764): Worked OT 2026-10-21 (24 hrs), Want OT 2026-10-27.
- **Sign-in on the sites' own address** is built but off: it waits on the user adding the two `/__/auth/handler` redirect URIs and the GitHub variable `FIREBASE_OWN_AUTH_DOMAIN=1` (`FIREBASE_SETUP.md`, step 13). Until then Google sign-in detours through `sffd-schedule.firebaseapp.com`, which some phone browsers block.

## Parked ideas (not now; ask before building)

- **Admin: manage documents** (upload and remove the More → Documents PDFs from the admin site): phase 2, see `RELEASES.md` → Later. For now: `docs/` and `docs/index.json` on GitHub.
- **Admin → Trades list** (built Oct 23, PR #33; Phase 2 still open). Phase 1: every trade, newest first, with a name search and a status filter, and Cancel and Delete per row (Delete removes its answers too); works on Firebase and the claude.ai page, and the rules already allow it. Phase 2: Edit (note, who it was sent to) and pick for the poster. For now the admin uses the Firebase console (Firestore → `trades`).
