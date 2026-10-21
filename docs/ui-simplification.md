# UI simplification

HANDOFF priority 2: the pages are too much for a typical employee. This is the audit, the three mock-up directions and the recommendation. **Nothing in the app changes until a direction is picked.**

## Mock-ups

Clickable, phone first then desktop, with a **Viewing as Member / Admin** switch on each. Every name, company (Station 61, E61, T61…) and number in them is made up; there are no real names, IDs or cell numbers.

| | Direction | Link |
|---|---|---|
| A | **My schedule** home, Crew, Projection, Trades; the rest under More | https://claude.ai/artifact/VDxFGVmC6Sb5cR4GTmSAkf |
| B | Each person chooses their tabs (the RELEASES "Choose my tabs" item) | https://claude.ai/artifact/HhqrLDmV2PcjTgUoCmQvif |
| C | Same member app as A; every admin tool behind one **Admin** entry | https://claude.ai/artifact/YBwCXAUEsPt4uKpU2CRQjS |

The links are private until shared from each page's Share menu. Each screen was clicked through in Chromium with the canvas runtime, at phone width and at desktop width (also squeezed to 390px).

## Audit: what each role sees today

Gating lives in `app.js` (`tabAllowed`, `applyAccountUi`, `isCardAdmin`, `backend.canEdit()` checks in `renderPerson` / `historyCard` / `openDay`), the `data-need` attributes on the More sheet in `index.html`, `dashboard.js` (Open seats, required-staffing overrides), `corrections.js` (`isAdmin`), `card.js` (`canAdmin`) and `trades.js` (`adminClaimsHtml`).

| Screen / element | Member sees | Admin also sees | Typical employee |
|---|---|---|---|
| **Schedule** tab: opens on an empty search, not on you | yes | Not on the list? Add a person | **Core**, but should open on *your own* schedule |
| Person page header: Rank, Employee ID, Position, Position no., Tour, Works watches, Check (same-name), Something wrong? | yes | Cell number (staff list), Employee card button, birth / hire dates | Keep name, rank, company, tour, next shift. The rest is advanced |
| Month calendar, holiday dots, legend | yes | — | **Core** (compact) |
| **Next shifts** fold with Trade links, day sheet | yes | Mark VA / S on the day sheet | **Core** |
| **Moves** fold, **Covers, leave & history** fold | yes | **Edit** fold (leave, cover, tour forms), End today / Delete on records | Advanced for members; edit is admin |
| **Projection**: the whole department by rank, vacancy toggle | yes | — | **Stays a main tab** (decided). It doesn't answer *who's working with me* directly; see Crew |
| **Staffing**: totals, apparatus table, drill-down, stats, Balance report check | yes (first tab on desktop) | Required overrides, Open seats | Admin / advanced |
| **By rank** month grid | yes | — | Advanced |
| **6 of 9** | yes (header link) | — | Advanced; handy before a trade |
| **Trades**: This is me, Sent to me, Board, My trades, Owed, Alerts | yes (Contributor) | Claimed accounts fold | **Core** |
| **Documents** menu | yes | — | Occasional, in More |
| **Corrections** | send only (Something wrong?, Verify my info) | the queue (header link with count) | Sending stays a small link; the queue is admin |
| **Employee cards**, **2027 awards**, **Open seats**, **Admin** (accounts) | no | yes | Admin only |
| Header subtitle, long footer explainer | yes | — | Drop for members |

What a typical employee actually needs, in order: **my next shift and my schedule**, **who's on with me**, **trades**, **the whole department on a date** (Projection), then occasionally documents, looking up someone else, and "something's wrong".

## The three directions

**A · My schedule home.** Five tabs: My schedule (today, next shift, Who's on with me, Trade, coming-up list, compact month), Crew (your station on each of your shifts, with cover / acting tags), Projection (with a **My station** filter), Trades, More. More holds Look up a person, Staffing, By rank, 6 of 9, Documents, My info, Something wrong?, and for admins an Admin group. Existing screens move, they don't change.

**B · Choose my tabs.** The same home, plus More › Tabs and links: a switch per tab, Simple / Everything presets, "Open the app on", and for admins switches for edit controls and admin links. Simple (the default) is My schedule, Crew, Projection and Trades. The bar shows what's on (up to 4 plus More on a phone, the rest at the top of More). Most flexible, but it's a settings screen most people never open, and it needs per-account storage and sync.

**C · One Admin entry.** Members get A. Admins get one **Admin** button with a count, in the phone header (so the bar stays at five tabs) and in the desktop top bar, that opens a back office: Corrections, Accounts, Open seats, Staffing, Employee cards, Add a person, 2027 awards, with "needs attention" counts. Person pages lose their inline Edit / History / Moves folds; admins get one **Open employee card** button instead.

## Recommendation: A for members, C for admins, B later

1. **Members get A**, with Projection kept as a main tab. It's the smallest change that solves the problem: defaults matter more than choice, and nothing is lost, since every other screen stays one tap away in More.
2. **Admin tools go behind one entry (C).** Admins already have a full back office in the Employee card; this makes it the only place to edit a person, removes edit controls from screens members also use, and gives admins a "needs attention" view.
3. **Tabs and links (B) comes later, as an opt-in.** Keep the RELEASES item but ship it after A + C, once we know which tabs people add back.

### Crew

**Crew** exists only in the mock-ups: the second tab, and the "Who's on with me" button on home. It lists everyone at your station (Engine 61 and Truck 61 in the mock-ups) on one of your shifts, with cover and acting tags. The app has nothing like it today; the closest is typing a company code (`E61`) into the Projection filter, which shows one company on the date picked. In code it would be the same rows Projection uses (`dayRows(d)` in `app.js`), filtered to the person's station.

**Decided:** Crew is the **whole station** (every company housed there) on that date, with cover and acting tags, as mocked. Also decided: keep Crew as its own tab for review. If it turns out to duplicate Projection, it folds into Projection's **My station** filter (also in the mock-ups) and the bar drops back to four tabs.

**Data needed: a station table.** The app has no stations today: `organization.js` goes division → battalion → apparatus, and the employee-card roster's "Station" column (`card.js`) actually shows the person's company. Crew needs an explicit station → companies list (for example `STATIONS` in `organization.js`). Same-numbered companies usually share a station (E10, T10), but not always, and rescue squads and other units sit at particular stations, so the list should be confirmed rather than guessed from numbers. Crew is then `dayRows(d)` filtered to the companies of the person's station that day (their own company from `home()`, or the company they're covering). Once the table exists, the roster column can show the real station.

### Roles: member and admin only

**Decided:** no separate editor role. Updating your own record (dates, contact, Verify my info) is a member action; everything else that changes the schedule is admin.

- On the shared claude.ai page this is already true: `canEdit()` and `canAdmin()` both mean Editor access (`store.js`).
- The self-hosted server (`ROLES = ("member", "editor", "admin")` in `server.py`) and `FIREBASE_PLAN.md` (`role: member|editor|admin`) still have `editor`. **Follow-up for the Firebase branch:** drop it, or map it to admin, and gate edits on admin.

### Rough rollout (when approved)

1. Open on your own page: if "This is me" (or the server's roster link) is set, the app opens on My schedule; otherwise on Find yourself.
2. Station table in `organization.js`, confirmed by you; then the Crew view.
3. Member tab bar: My schedule, Crew, Projection, Trades, More (phone and desktop). Staffing, By rank and 6 of 9 move to More. Projection gets a **My station** chip. `tabAllowed` and the More sheet's `data-need` already handle hiding.
4. Split `renderPerson`: a short member card (name, company, tour, next shifts, calendar, Something wrong?) and the advanced folds, which members reach from "More details".
5. Admin hub: one button gated by `canAdmin`, listing the existing views (`fixes`, `card`, `awards`, `admin`, `dash`, and Open seats via `state.seatsOpen`). Person pages show **Open employee card** instead of the Edit fold.
6. Later: Tabs and links (B).

## Still open

- After review: keep **Crew** as a tab, or fold it into Projection's My station filter?
- Who can supply the station list (which companies share each station)? The Balance report doesn't have it.
