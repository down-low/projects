# Hand-off: start here

The SFFD tour schedule tool: who works which seat on which day, covers / acting / shadowing, leave statuses, trades, and an admin back office. Read this first in any new chat, then `README.md` (features), `RELEASES.md` (roadmap) and `FIREBASE_PLAN.md` (hosting).

## Priorities, in order

1. **Firebase launch.** Built (both sites). Next:
   - the user's setup, in their own Google account (`FIREBASE_SETUP.md`);
   - an optional test beta on test data (`BETA.md`);
   - cut-over (`CUTOVER.md`).

   Scope: `FIREBASE_PLAN.md`. Branch `claude/firebase-beta`.
2. **UI simplification.** The pages are too much for a typical employee. Mock-ups first, nothing changes in the app until a direction is picked. Branch `claude/ui-mockups`.
3. **Data cleanup.** The open questions below.

## Shape of the hosted tool

Two front ends on one Firebase backend: a light **employee app** (schedule, trades, documents; phone first, no admin code) and a separate **admin back office** (Employee cards, Corrections, Staffing, imports, editing). Same Firestore underneath; the security rules are the API. Firestore is the only live database from launch day: admins move to the `admin` site at the same cut-over, and the claude.ai main page is frozen, copied once, then retired. Details: `FIREBASE_PLAN.md`, "Two apps, one backend".

## How we work

- **Git is the only source of truth.** Every chat works on its own `claude/…` branch and merges to **`main`** with a pull request. Nobody edits code on the host.
- **Firebase deploys from `main`** (`.github/workflows/firebase.yml`): every pull request runs the tests, including the security rules tests in the emulator; a merge to `main` publishes Hosting, rules and functions, and copies `data/` and `docs/` to Cloud Storage. Both Hosting sites come from one build (`tools/build_firebase.py`): `public-app/` (no admin screens) and `public-admin/` (the full page). The deploy is skipped until the GitHub variable `FIREBASE_PROJECT_ID` is set. Claude sessions have no live access to the project (no key, no Google APIs from the container): changes go through `main`, and problems come back as tester reports, screenshots and Actions logs.
- **Until cut-over** the claude.ai main page is the official copy, and anything on Firebase is a test copy with a banner. Records don't sync between the two.
- **Cut-over day** (`CUTOVER.md`): Claude republishes the page with `--frozen` (and the `--capabilities --frozen` rules); the admin replaces the Firestore records from the page's backup and sets the copy live.
- **After cut-over**, the claude.ai main page is frozen. Don't republish it with the normal build, and don't record anything there.
- Never delete the claude.ai page without the user's word.
- **Before publishing the claude.ai links, merge `main` into your branch.** Several chats publish to the same links; publishing from a stale branch drops other chats' work. If a publish is refused, merge the newer live version, don't overwrite it.
- Run `python3 -m unittest discover -s tests` before pushing.

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
| Self-hosted server (SQLite, Google sign-in); kept as the fallback | `server.py`, `tests/test_server.py` |
| Builds the claude.ai page; `--capabilities` prints the access rules | `tools/build_artifact.py` |
| Roster, required staffing, employee IDs (no phones), 2027 awards | `data/` |
| Watch calendars, vacancy list, awards PDFs | `docs/` |

Build: `python3 tools/build_artifact.py dist/tour-schedule.html` (main page); view-only: add `--snapshot snapshot.json --demo demo.json`.

## Live links

- **Main page** (page database, sign-in by claude.ai access): https://claude.ai/artifact/TS7W51mXHxgy7p2uvReSgC. Records live in its database: `statuses`, `tourChanges`, `covers`, `people`, `staffing`, `assignments` (move log), `rosterOverrides`, `members`, `trades`, `tradeReplies`, `corrections`, `contacts`, `profiles`.
- **View-only snapshot** (records baked in, trade demo): https://claude.ai/artifact/37DsLLYz74Kjysbd84cTXV.
- **Officer roster check** (private): https://claude.ai/artifact/LfUeKBV5UUh2TXNaiwJgLn.

## Security rules (never break these)

- **Cell numbers are admin-only.** They live only in the page database's `contacts/staff-list` (and `staffCells` on Firebase, rule `read, write: if isAdmin()`). Never put them in this repo, the view-only link, a member-readable collection, logs, or chat output. They move to Firebase only through the backup file the admin downloads and imports themselves; don't read `contacts` with ArtifactData.
- Birth / hire dates (`profiles`) are owner and admin only.
- Corrections are per member (`corrections/<uid>`), readable only by that member and admins.

## Record conventions

- Covers: `{coverKey, coverName, targetPos, start, end, kind, move, note}`. Kinds: **acting** (officially promoted), **cover** (same rank in someone's spot), **shadow** (LWLP, mostly VR, doesn't take the seat), **extra** (also in the seat, no tag). `move: true` changes the owned seat.
- Statuses: VA, S, D, WE, TR.
- Every position move also gets an `assignments` row, linked to its record; it shows in the closed **Moves** section on the person's page. A paste-in notice import is on the roadmap; until then notices are pasted into chat and confirmed by hand.

## Open questions for the user

- Johnston and Capurro: Employee ID mismatches.
- January double covers.
- Ambiguous names in the staff list (93 unique matches applied; the rest wait on the user's name cleanup).
- Items from the officer roster check.
