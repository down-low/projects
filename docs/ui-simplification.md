# UI simplification

HANDOFF priority 2: the pages are too much for a typical employee. This is the audit, the three mock-up directions and the recommendation. **Nothing in the app changes until a direction is picked.**

## Mock-ups

Clickable, phone first then desktop, with a **Viewing as Member / Admin** switch on each. Every name, company (Station 61, E61, T61…) and number in them is made up; there are no real names, IDs or cell numbers.

| | Direction | Link |
|---|---|---|
| A | **My schedule** home, Crew, Trades; everything else under More | https://claude.ai/artifact/VDxFGVmC6Sb5cR4GTmSAkf |
| B | Each person chooses their tabs (the RELEASES "Choose my tabs" item) | https://claude.ai/artifact/HhqrLDmV2PcjTgUoCmQvif |
| C | Same member app as A; every admin tool behind one **Admin** entry | https://claude.ai/artifact/YBwCXAUEsPt4uKpU2CRQjS |

The links are private until shared from each page's Share menu.

## Audit: what each role sees today

Gating lives in `app.js` (`tabAllowed`, `applyAccountUi`, `isCardAdmin`, `backend.canEdit()` checks in `renderPerson` / `historyCard` / `openDay`), the `data-need` attributes on the More sheet in `index.html`, `dashboard.js` (Open seats, required-staffing overrides), `corrections.js` (`isAdmin`), `card.js` (`canAdmin`) and `trades.js` (`adminClaimsHtml`).

| Screen / element | Member sees | Editor / admin also sees | Typical employee |
|---|---|---|---|
| **Schedule** tab: opens on an empty search, not on you | yes | Not on the list? Add a person | **Core**, but should open on *your own* schedule |
| Person page header: Rank, Employee ID, Position, Position no., Tour, Works watches, Check (same-name), Something wrong? | yes | Cell number (staff list), Employee card button, birth / hire dates | Keep name, rank, company, tour, next shift. The rest is advanced |
| Month calendar, holiday dots, legend | yes | — | **Core** (compact) |
| **Next shifts** fold with Trade links, day sheet | yes | Mark VA / S on the day sheet | **Core** |
| **Moves** fold, **Covers, leave & history** fold | yes | **Edit** fold (leave, cover, tour forms), End today / Delete on records | Advanced for members; edit is admin |
| **Projection**: the whole department by rank, vacancy toggle | yes | — | Advanced. What people want is *who's working with me*, which no screen shows directly today |
| **Staffing**: totals, apparatus table, drill-down, stats, Balance report check | yes (first tab on desktop) | Required overrides, Open seats | Admin / advanced |
| **By rank** month grid | yes | — | Advanced |
| **6 of 9** | yes (header link) | — | Advanced; handy before a trade |
| **Trades**: This is me, Sent to me, Board, My trades, Owed, Alerts | yes (Contributor) | Claimed accounts fold | **Core** |
| **Documents** menu | yes | — | Occasional, in More |
| **Corrections** | send only (Something wrong?, Verify my info) | the queue (header link with count) | Sending stays a small link; the queue is admin |
| **Employee cards**, **2027 awards**, **Open seats**, **Admin** (accounts) | no | yes | Admin only |
| Header subtitle, long footer explainer | yes | — | Drop for members |

What a typical employee actually needs, in order: **my next shift and my schedule**, **who's on with me**, **trades**, then occasionally documents, looking up someone else, and "something's wrong".

## The three directions

**A · My schedule home.** Four tabs: My schedule (today, next shift, Who's on with me, Trade, coming-up list, compact month), Crew (your station on each of your shifts, with cover / acting tags), Trades, More. More holds Look up a person, Whole department (Projection), Staffing, By rank, 6 of 9, Documents, My info, Something wrong?, and for admins an Admin group. Existing screens move, they don't change.

**B · Choose my tabs.** The same home, plus More › Tabs and links: a switch per tab, Simple / Everything presets, "Open the app on", and for admins switches for edit controls and admin links. The bar shows what's on (up to 4 on a phone, the rest at the top of More). Most flexible, but it's a settings screen most people never open, and it needs per-account storage and sync.

**C · One Admin entry.** Members get A. Admins get one more tab (phone) or an **Admin** button (desktop) that opens a back office: Corrections, Accounts, Open seats, Staffing, Employee cards, Add a person, 2027 awards, with "needs attention" counts. Person pages lose their inline Edit / History / Moves folds; admins get one **Open employee card** button instead.

## Recommendation: A for members, C for admins, B later

1. **Members get A.** It's the smallest change that solves the problem: defaults matter more than choice, and nothing is lost, since every current screen stays one tap away in More.
2. **Admin tools go behind one entry (C).** Admins already have a full back office in the Employee card; this makes it the only place to edit a person, removes edit controls from screens members also use, and gives admins a "needs attention" view.
3. **Tabs and links (B) comes later, as an opt-in.** Keep the RELEASES item but ship it after A + C, once we know which tabs people add back.

New piece of work: the **Crew** view (who's on at my station on a date), built from the same rows Projection uses (`dayRows(d)` in `app.js`), filtered to the person's station on that date.

### Rough rollout (when approved)

1. Open on your own page: if "This is me" (or the server's roster link) is set, the app opens on My schedule; otherwise on Find yourself.
2. Member tab bar: My schedule, Crew, Trades, More (phone and desktop). Staffing, Projection, By rank and 6 of 9 move to More. `tabAllowed` and the More sheet's `data-need` already handle hiding.
3. Split `renderPerson`: a short member card (name, company, tour, next shifts, calendar, Something wrong?) and the advanced folds, which members reach from "More details".
4. Admin hub: one tab / button gated by `canEdit` or `canAdmin`, listing the existing views (`fixes`, `card`, `awards`, `admin`, `dash`, and Open seats via `state.seatsOpen`). Person pages show **Open employee card** instead of the Edit fold.
5. Later: Tabs and links (B).

## Questions for you

- Should **Projection** stay a main tab for members, or move to More as in the mock-ups?
- Is **Crew** your station (both companies), or just your company?
- Do **editors** who aren't admins get the Admin entry, or only the leave and cover forms they use today?
