# Demo branch (`claude/demo-app`)

A slimmed-down, view-only demo of the tour schedule tool with **entirely fictional data**: one division, 2 battalions
(B01, B02), 10 engines, 2 trucks, a rescue squad, a medic unit and a rescue captain; 197 seats and about 190 made-up people
at the real tool's rank mix (FF 118, Lt 31, FF/PM 24, Capt 13, BC 6, ISS 3, RC 2; 21 swing seats). It works like the
view-only snapshot link: records baked in, no sign-in, a trade demo where nothing is saved, and a "Demo · fictional data"
banner. The Documents menu is hidden (`docs/index.json` is empty), and tour numbers are hidden everywhere
(`demo-hide-tours.js`, added by `--hide-tours`; it edits the rendered page, so the app's screens stay as on `main`).

**One officer or chief per post per day.** Each company's Captain and two Lieutenants are on three consecutive tours,
which never share a watch; the five Lieutenant swings cover, on each of their watches, a company whose officers are off
(`plan_officers`). Battalion chiefs, ISS and rescue captains are on consecutive tours too (`plan_chiefs`). A sixth Lt
swing wouldn't fit (13 companies leave 52 officer gaps a cycle; six swings need 54), hence 31 Lieutenants. The run
checks every day and fails if any post has two.

**Never merge this branch into `main`, and never merge `main` into it** (that brings the real roster back). Never publish
it to the real tool's claude.ai links; the demo has its own artifact.

## Rebuild

```sh
./tools/build_demo.sh     # needs python3 and node
```

1. `tools/make_demo_data.py` writes `data/*.json`, `data/organization.json` and `demo/records.json`. It's seeded and dated
   from a fixed day (2026-10-19), so every run writes the same bytes. Shapes follow the real files; values are invented.
   It also fits staffing: it spreads the tours of seats no record mentions so the head count is even from day to day,
   and picks each apparatus's Required, so Staffing shows the division **10–15% short** (Open ÷ Required, as the
   Staffing screen counts it) from 2026-10-19 to 2027-06-30; the run prints the range (currently 9.3%–14.8%, mean 12.1%;
   9 of 255 days at 5 of 54). `on_duty()` in the script counts staff by the same rules as the Staffing screen. The run
   takes about a minute and a half.
   Records cover VA / S / D / WE, a tour change, an acting, cover, shadow and extra cover, an added relief person, two moves
   with `assignments` rows (the Moves fold), two 2027 award moves, vacant seats and spots open for bid.
2. `tools/demo_trades.js demo/records.json` writes `demo/trades.json`, sample trades dated from the build day on
   (so rebuild before republishing, or the trades will have expired). Posters: `--posters LT_POS,FFPM_POS`, default the
   first Lieutenant and FF/Paramedic with no records.
3. `tools/build_artifact.py dist/demo.html --snapshot demo/records.json --demo demo/trades.json --banner "Demo · fictional data"`.
   `organization.js` takes the demo's divisions from `window.ORG_DIVISIONS` (from `data/organization.json`).

## Bringing app changes over from `main`

Cherry-pick the app commits (`git cherry-pick <sha>`, or `git checkout origin/main -- app.js style.css …` for code files
only). Never check out `data/`, `docs/`, `cleanup/` or `dist/` from `main`. Then rebuild and re-run the real-data check:
load `main`'s roster with `git show origin/main:data/positions.json` and `…:data/employee-ids.json` **in memory only**,
and confirm that no real `Last,F` name or Employee ID appears in `dist/demo.html` or in any tracked file (count must be 0).
A new fictional surname must not be a real roster surname either.

The earlier commits on this branch (inherited from `main`) still contain the real files; the demo's own commits and the
published page don't.
