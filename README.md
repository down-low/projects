# SFFD Tour Schedule

Look up who is working on any date, when a given person works, or a month roster for a rank.

- **Projection**: pick a date and see the watch number, the 9 tours working, and everyone on duty grouped by rank. Swing positions show the company they cover.
- **Schedule**: search by name, company or position number. Shows the person's tour, a month calendar of work days, and their next shifts.
- **By rank**: a month grid of every position in a rank, filterable by company and tour.

## How the schedule is computed

From the 2026 and 2027 Watch Calendars (25 A-098 Encl. B, 26 A-088 Att. B):

- Watch days run on one continuous 31-day cycle. 1 Jan 2026 is watch 16, and the cycle continues unbroken into 2027 (1 Jan 2027 is watch 9).
- Tour *k* works watch *w* when `(w − k) mod 31` is one of `0, 3, 6, 10, 13, 16, 20, 23, 26` (9 shifts per 31 days).

From the Vacancy List (26 A-071 Att. A):

- A position's tour is the two digits before the trailing `M` in its position number (`29EOC31M` → Tour 31).
- When a position lists a starred replacement name, only the starred name is shown.
- Swing and super-swing positions use the "Assigned Rotations" pages for the company covered on each watch.

The math lives in `schedule.js`; positions are in `data/positions.json`; storage adapters are in `store.js`.

## Tour changes and leave (VA / S / D / WE)

Editors can record, per person (on the **Schedule** tab):

- **Status**: VA vacation, S sick, D disabled or WE working elsewhere (TR, traded off, comes only from a set shift trade) (e.g. an admin assignment not on the vacancy list), for a date range. Leave the end date open for an open-ended status. The person still shows on their scheduled days, struck through and marked with the code, and is counted as off rather than on duty. If two ranges overlap, the newer entry wins.
- **Tour change**: a new tour from an effective date. Earlier dates keep the old tour. A swing position's company rotation only applies on its original tour; after a change it shows its home company.

- **Cover assignment**: on the covering person's page, **Cover another position**, pick the position, a type, a start date and optionally an end date. While it runs, that person works the covered position's tour and company; the coverer's own spot shows them away. Mark the holder's leave (for example D) separately. **End today** closes an open-ended cover. Types:
  - **Acting**: officially, temporarily promoted to the seat's rank until demoted.
  - **Covering**: in someone else's spot (voluntarily or mandatorily) while they are injured or working elsewhere.
  - **Shadowing**: day-to-day promotion (LWLP, like work like pay), usually VR20 / VR30 / VR40 relief. A shadow doesn't take the seat from a holder who is working (both show); it fills the seat when the holder is off or the seat is empty.
  - **Also in this seat**: a second person on the same seat and tour, working alongside the holder (e.g. two captains on one tour). No tag on Projection, counted as Regular on the dashboard, and it never takes the seat from the holder.
  - Left blank, the type is Acting when the person ranks below the seat and Covering otherwise.
- **Projection** shows a covered seat on one line: the person working it, with the holder beside them struck through (and their leave code, or where they are), and a tag for the type.
- **Add a person** not on the vacancy list (relief, detailed or new staff): **Not on the list? Add a person** under the person search, then give them a cover assignment.

## Staffing, 6 of 9, Documents

- **Staffing** (first tab on desktop): for any date, **Total Working Staff** and **Positions Needing Staff**, then a table per apparatus with Required, Working, Extra, Missing and Total (Total = Working − Required; Extra and Missing are its positive and negative parts). Click an apparatus to drill down to who is working and which seats are short and why (vacant seat, leave not covered, acting elsewhere). Sort by any column, search, or show only short apparatus. **Required** defaults to the usual number of positions scheduled at that apparatus across a 31-day cycle (E10 = 4, T01 = 5); admins can click the number to override it or reset it. **Group by** division (Division → battalion → apparatus, the default), battalion, or apparatus only. The structure comes from the Daily Balance Report and lives in `organization.js`; each division and battalion row shows subtotals and expands to its apparatus. Rescue captains appear as RC1–RC4 and the fireboat pilots and marine engineers under FB3, as in the report.
- **Required staffing (313 a day)** comes from the Daily Balance Report: for each apparatus, the report's headcount minus its over/under. `python3 tools/extract_balance.py <report.pdf>` regenerates `data/required-staffing.json` and checks the totals against the report. Admins can still override any apparatus. HQFD / AO is hidden for now (`hidden: true` in `organization.js`).
- **Regular, Covering, Open**: Working is split into Regular (people in their own seat or on a swing) and Covering (cover assignments and added people). Open is what's still short, which would need overtime.
- **Working but not in the tool**: on the Balance report's date, a card compares each apparatus's report headcount with the tool's and lists where the report has more people, with an overall estimate (report working minus overtime hires, minus the tool's working).
- **Open seats** (editors): every vacant position and every position whose holder is away long-term (open-ended D or acting elsewhere), grouped by division and battalion, with an **Assign** box to record who is covering it long-term. Filter by No cover / Covered / All.
- **Stats summary**: full duty, VA, S, D, WE, acting/covering, spots open for bid, vacant seats, and **average age** and **average years of service** from birth and hire dates. Dates are entered by the person on My page or by an admin on the Schedule page; they are private, and the dashboard only shows averages. Click any number to see who or which seats it counts (grouped by rank, or by battalion for seats), with dates and notes; tap a name to open their page.
- **6 of 9** (header link): tours whose start days are 3 or 10 days apart work 6 of the same 9 shifts. Pick a tour to see its four partners, the shared watches and the dates they fall on this month, plus a 31 × 31 table of shifts in common.
- **Documents** (header menu): the 2026 and 2027 Watch Calendars, the Vacancy List (26 A-071) and the 2027 Vacancy Awards (26 A-082). Files live in `docs/` and are listed in `docs/index.json`; the server only serves listed files, to signed-in, approved users.

## Employee cards (admins)

A back-office screen, separate from the member-facing person page: **Employee cards** (header link on desktop, More menu on phones, or **Employee card** on a person's Schedule page). Only admins (Editor access on the shared page; the admin role on the server) see it. Find anyone by name, Employee ID, company or position number, then edit their whole record in one place:

- **Identity:** name, rank and Employee ID. For a vacancy-list seat these override the files (`data/positions.json`, `data/employee-ids.json`) through one record per seat in `rosterOverrides` (everyone reads, admins write). Only what differs from the files is kept, tied to the holder it was made for (`forName`), so a new vacancy list with someone else in the seat drops it. Changing a seat's rank moves the seat to that rank on Projection and Staffing and changes who can trade with it. **Reset to vacancy list** removes the override. Added people are edited on their `people` record (name, rank, ID, apparatus, tour).
- **Own seat and moves** (covers with `move: true`), **current assignment** (a cover with its type: acting, cover, shadow or extra), **leave and statuses** (VA, S, D, WE), and **tour changes**: the same forms as the person page, plus a "Move" option on a cover.
- **Cell number:** the staff-list record (`contacts/staff-list`, admins only). Set or clear.
- **"This is me" claim:** the member's `members` record; **Remove claim** offers **Undo**. On the server, the linked account with Unlink and Undo.
- **Corrections** about them or sent by them: Apply, Dismiss, Reopen, Delete.
- **History:** every record touching the person, newest first, each with **Edit** and **Delete**. Records from a shift trade change only through the trade.

Changes write to the same records the schedule reads, so Projection, Schedule and Staffing update at once.

**Roster.** With nobody open, the screen shows one tile per rank with its headcount (tap one to filter, **All** to clear) over a table of everyone. The table has search (same rules as Schedule), sorting by any column, 25 / 50 / 100 / All per page, and a **Columns** chooser (division, battalion, station, name, position, rank, H-class, tour, Employee ID, status, assignment, cell, birth and hire dates, age, years of service, claimed, open corrections) remembered per browser. The **Status** dropdown is a quick edit: VA, S, D or WE starts that status today with no end date; **Full duty** ends whatever is running today (a status that started today is removed). Dates and notes are edited on the card. To add a column later, add one entry to `COLUMNS` in `card.js`; a new stored field (email, DSW No, seniority number) also needs an admin-only page collection (one rule in `CAPABILITIES`, read in `store.js`).

**Compare with fir-db1.** Under the roster, admins can check the tool against fir-db1 (the department's time system, city VPN only). **Copy pull script**, paste it into the browser console on a fir-db1 tab you're signed in to, and pick a date and companies. It opens each company's "Search Co Time" page in turn, reads the Time Entry table (Empl, Name, Co, TRC, Position, Role, Status and the times) and downloads `fir-<date>.csv`. Choose that file on the Employee cards screen to see, for that date: who is working vs off in one and not the other, different company or position, people on fir-db1 who aren't working there in the tool (or aren't in the tool at all), and people the tool has working at a pulled company who aren't on fir-db1's list. Rows match by Employee ID, then by name. The file is read in the browser and never saved; fixes are made on each person's card. The script (in `fir.js`) only reads pages your login can already see, one company at a time; check with IT before pulling every company routinely.

## 2027 vacancy awards

Editors apply the 2027 Vacancy Awards (26 A-082) from **2027 awards** (header link on desktop, More menu on phones).

- `python3 tools/extract_awards.py` reads `docs/vacancy-awards-26A082.pdf` into `data/vacancy-awards-2027.json` (364 rows, 346 positions; it checks the report's "Positions Awarded" totals). A position listed twice has an unstarred row (awarded on paper) and a starred row (the person who works it); the starred row is the one applied.
- **Matching:** by Employee ID first, then last name + first initial at the person's current company (the report's last column), then a unique name anywhere. Anyone not found is added as a new person with the rank of their current class.
- **Date:** each move starts on the first day of the awarded seat's tour on or after **Jan 16, 2027**. Dates can be changed per row.
- **Owned seat vs cover:** an award (or a 2027 transfer-list assignment) changes the seat a person **owns**. A cover is a separate assignment, willing or mandated, and keeps running until someone ends it. While it runs they work the cover and their new seat shows them away ("Acting at …", tagged "2027 seat"); once it's ended they work their new seat. Their old seat is vacant from the move date unless someone else moves in. A person's page shows **Own seat from …** next to **Covering**.
- **Statuses:** **Ready**; **Check** (pick between people with the same name, an open-ended D or WE that stays on, or another person covering the seat); **Recorded** (already on the page); **No move** (already in the seat, or awarded on paper while the starred replacement works it). A move from the 2027 transfer list (newer than the awards) wins over the award and is shown under Check without an Apply option.
- **Apply N ready moves** writes one move per award (stored with the covers, marked `move: true` and noted "2027 award (26 A-082)"), plus any added people; nothing else is changed, and re-running skips what's recorded. **Apply anyway** on a Check row includes it. **Remove award moves** deletes everything the import wrote.

## Shift trades

Members trade full 24-hour shifts. Approval, if any, happens outside the tool; once both people agree, the trade is set and the schedule shows it.

- **This is me.** Trading needs to know who you are. On the shared page, the **Trades** tab asks you to find yourself by name or Employee ID and confirm your station and tour (or tap **This is me** on your own person page). Admins see every claim on the Trades tab, with mismatches flagged and **Undo**. On the server, your account's approved roster link is used.
- **Who can take a shift:** someone off that day (`TourMath.dayFor`), with no VA / S / D / WE / TR status, in the same rank group. The groups live in one table, `RANK_GROUPS` in `schedule.js` (mirrored in `server.py`):

  | Group | Ranks |
  |---|---|
  | Firefighter | Firefighter (H2) |
  | FF/Paramedic | FF/Paramedic (H3) |
  | Officer | Lieutenant (H20) and Captain (H30) trade freely |
  | Battalion Chief | Battalion Chief (H40) |
  | Its own rank | Rescue Captain, ISS, Pilot, Marine Engineer |

- **A day's options.** On a person's page, tap a calendar day or a row in **Next shifts**: **Trade this shift** (your own page) and **Mark this day** VA or S (editors, one day; D and WE stay in the Edit forms). On your own page, **Trade** also sits under each date in Next shifts.
- **Posting.** Two steps:
  1. **Who:** everyone eligible, grouped by division and battalion, tagged when they work the day before or after. Check everyone, a division, a battalion or individuals.
  2. **Post:** to the selected people, the board (everyone eligible), or both, with an optional note. **Send to more people** widens it later.
  The poster doesn't offer a payback day, since they don't know yet who will take it.
- **Responding.** **I'm interested**, then suggest a payback day (one of your shifts they'd work) or pay back later.
- **Picking.** The poster sees each response's terms and picks one. The trade is set: a one-day cover puts the taker on the poster's seat ("Trade for …") and the poster is marked **TR** (traded off). A swap also does the reverse on the swap day. **Cancel trade** reverts it.
- **Owed shifts.** A "pay back later" trade shows "owes a shift" on both people's pages until a later trade between them, the other way round, is set.
- **Trades tab:** **Sent to me**, the **Board** (open posts you could take, filtered by date range and battalion) and **My trades**. Open trades expire when their day passes.
- **Alerts:** "Notify me by text / in the app / by email" switches, and **Board posts** (Off, Daily summary, Each new post; Off by default), are saved now. App pushes (Firebase Cloud Messaging), texts (Twilio) and email (Gmail / Workspace) start with the server launch. Trades sent to you and responses to yours always alert, with the details and a one-tap reply; see `RELEASES.md`.
- **On the shared claude.ai page,** members need **Contributor** access to trade (Viewers can look). The page database can't hide one record from some viewers, so "only the people you send it to see it" is a filter in the page; anyone with page access could read the data. The server enforces it. A set trade's cover and TR records are kept on the trade there, so schedule records stay editor-only (`python3 tools/build_artifact.py --capabilities` prints the access rules to publish with).
- The view-only snapshot shows set trades on the schedule but has no Trades tab.
- **Invites** (with the server launch): a poster can text a trade link, from their own phone, to roster people who haven't signed in; Google sign-in and a matching Employee ID get them straight in. People not in the tool at all get a general join link (**Invite someone**) and use "I'm not on the list", approved by an admin. Typed numbers are never saved. People without an account can still answer: the poster records an answer they got by text (**Add their answer**), or the person taps their answer on the invite link and verifies with Google and their Employee ID before the trade is set. See `RELEASES.md`.

## Holidays

A green dot marks holidays on a person's calendar (with that month's holidays listed underneath), the rank grid header, the header date, Projection and the Staffing date: New Year's Day, Martin Luther King, Jr.'s Birthday, Presidents' Day, Memorial Day, Juneteenth, Independence Day, Labor Day, Indigenous Peoples Day and Italian American Heritage Day, Veterans Day, Thanksgiving Day, the Day After Thanksgiving and Christmas Day. Halloween and Mother's Day are shown as observances (hollow dot). Dates are worked out for any year (`TourMath.holidayFor`). A fixed-date holiday on a weekend shows on the day it's observed, marked "(observed)": Saturday moves to the Friday before, Sunday to the Monday after (July 4, 2027 → Mon July 5; Christmas 2027 → Fri Dec 24; New Year's Day 2028 → Fri Dec 31, 2027). Halloween and Mother's Day don't move.

## On phones

Screens 640px wide or narrower get a phone layout: a slim header (date and watch, ☰ menu) and a bottom tab bar with **Schedule**, **Projection**, **Trades** (when you can trade), **Staffing** and **More**. Schedule opens first. The tabs have the same names on desktop.

- **Schedule**: search by name, ID or company. Each result says whether the person is on today ("On · E09") or off, with their next shift. A person's page shows Tour, Next shift and Employee ID up top; next shifts, history and the editing forms fold away.
- **Projection**: everyone working that day, grouped by rank as on desktop, one row per person (company, name, position, tour, leave and cover tags). The filter narrows it by name, ID, company or tour.
- **Staffing**: Required / On duty / Open tiles, then division → battalion → apparatus → people with on duty / needed (tap to drill down), and the stats and Balance-report cards below.
- **More** (or ☰): 6 of 9, the rank month grid, Open seats (editors), the documents, My page, Admin and Sign out. Menu items carry `data-need` (member, editor, admin, signed-in) and are hidden from people who can't use them.

On wider screens the layout is unchanged; the editing forms on a person's page sit behind one **Edit** row everywhere.

## Signing up when you're not on the vacancy list

After signing in with Google, someone who can't find their name picks **I'm not on the list** and enters their name, rank, apparatus and tour. An admin sees the request on the Admin page; **Approve and add to roster** adds them with that apparatus and tour (tagged "Added") and gives them access.

Search: a company code (`E10`, `e 10`, `RS1`) matches that company only (where people work that day, including swings and covers); `tour 10` matches a tour; a full position number (`10EOC03M`) matches that position; an employee ID (`AS9242`) matches that person; anything else matches names, titles and IDs.

## Employee IDs

Each person can carry an **employee ID** (two letters and four digits). IDs are unique, so they tell apart people with the same name: a person's page shows their ID, and a **Check** line lists anyone else with the same name (with their ID) or, if it ever happens, the same ID.

- Roster IDs live in `data/employee-ids.json` (position number → ID). They come from the 2027 transfer list, the 2027 Vacancy Awards (26 A-082), assignment change notices and the internal staff list (`Employee_List.xlsx`), matched by name plus current assignment or rank; the Vacancy List itself has no IDs. Matches that were uncertain were left out.
- **Corrections.** Anyone who can use the shared page (Contributor access) sees **Something wrong?** on person pages, and **Verify my info** on their own page after **This is me**. They send what's wrong (seat, leave or working elsewhere, covering / acting / shadowing, tour, Employee ID, their own cell number, or anything else); nothing changes until an admin applies it. A **This is me** station or tour that differs from the roster sends a correction automatically. Admins open **Corrections** (header link or menu, with the open count): **Apply** opens the person's page with the matching edit form filled in, and saving marks it applied; **Dismiss** closes it. Each member's corrections sit in their own record (`corrections/<user id>`), which only they and admins can read (page rules `corrections: read/write admin` and `corrections/{self}: read/write interact`; server: `POST /api/corrections`, `GET /api/admin/corrections`, `PATCH /api/admin/corrections/<id>`).
- **Cell numbers** from the internal staff list sit in one admin-only record on the shared page (`contacts/staff-list`, rule `read: admin`). Admins see a person's cell on their page ("Cell · staff list, admins only") with tap-to-call; Viewers and members never receive it, and it is never in the view-only link or this repository. At the server launch the same list seeds numbers for trade texts.
- People added outside the vacancy list store the ID on their record (`emplId`). The add-person form and the "I'm not on the list" request take an optional ID; the server rejects a badly formed ID or one already in use.

Vacancy-list rows showing a starred name with "Vacant" (e.g. `* Lt. SSwing E10 10ENL31M Lester,D Vacant`) are treated as the person still working the position while the spot is up for bid ("Spot open for bid"). Rows with a starred replacement name show only the replacement.

Records are keyed by position number. There are two places they can be stored:

1. **The schedule server (`server.py`)**: SQLite in `data/schedule.db`, with Google sign-in and user accounts (below).
2. **The shared claude.ai page**: `dist/tour-schedule.html` published as an artifact with its page database. Only people given Editor access on the page can make changes; Viewers see the schedule read-only. Google sign-in, My page and Admin are not available there.

The two stores are separate. Opening the page any other way (for example `python3 -m http.server`) is view-only.

## Accounts (server)

People sign in with Google. Viewing the schedule requires an approved account.

1. A new person signs in and picks themselves from the roster (**Claim your record**).
2. An admin approves the claim on the **Admin** tab, which links the Google account to that position. Admins can also link, unlink or change the link later, approve staff without a roster position, and disable accounts (which signs them out).
3. Access levels: **Member** (schedule and My page), **Editor** (also records tour changes and leave), **Admin** (also manages users). There is always at least one admin.

**My page** shows the person's current tour, any upcoming tour change, their next shifts and leave on record, and lets them set a contact email (separate from their Google sign-in), a mobile and another phone number. A **Share my contact info for shift swaps** switch decides who sees it: when on, anyone signed in sees it on that person's schedule page; when off, only admins do.

## Running the server

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. Add the authorized redirect URI `https://YOUR-HOST/auth/callback`. (Configure the OAuth consent screen first if asked; the app only requests your name and email.)
2. Start the server:

```sh
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=xxxx \
BASE_URL=https://YOUR-HOST \
ADMIN_EMAILS=chief@example.org \
ALLOWED_DOMAINS=example.org \
python3 server.py --port 8000
```

| Setting | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth client from step 1. Keep the secret out of the repo. |
| `BASE_URL` | The public address people use. Must match the redirect URI you registered. |
| `ADMIN_EMAILS` | Comma-separated Google emails that become admins when they sign in. Needed for the first admin. |
| `ALLOWED_DOMAINS` | Optional. Only Google accounts from these email domains may sign in. |

- Serve it over **HTTPS** (for example behind a reverse proxy such as Caddy or nginx); session cookies are marked Secure when `BASE_URL` is https. The server listens on 127.0.0.1 by default; use `--host 0.0.0.0` only behind a proxy.
- `data/schedule.db` now holds contact details. Keep it private and back it up.
- For local testing without Google, `DEV_LOGIN=1 ADMIN_EMAILS=you@example.org python3 server.py` adds a "Developer sign-in" box that signs in as any email. It only works on 127.0.0.1. Never use it in production.

Tests: `python3 -m unittest discover -s tests` (uses a stub in place of Google).

API (JSON, session cookie; writes need the header `X-Requested-With: tour-schedule`):

| Route | Who |
|---|---|
| `GET /api/me`, `POST /auth/logout` | anyone |
| `POST /api/me/claim` `{pos, note}` | pending accounts |
| `GET /api/records`, `GET /api/contacts`, `GET /data/positions.json`, `PUT /api/me/contact` `{contactEmail, phoneMobile, phoneOther, shareContact}` | approved accounts |
| `POST /api/statuses` `{pos, code, start, end?, note?}`, `POST /api/tour-changes` `{pos, tour, effective, note?}`, `POST /api/covers` `{coverKey, targetPos, start, end?, kind?, note?}` (kind: acting, cover, shadow or extra), `PATCH /api/covers/<id>` `{end}`, `POST /api/people` `{name, rank, company?, tour?, emplId?, note?}`, `DELETE /api/{statuses,tour-changes,covers,people}/<id>` | editors, admins |
| `GET /api/admin/users`, `POST /api/admin/users/<id>` `{action: approve, reject, role, link, unlink, disable, enable}` | admins |
| `POST /api/me/claim` `{request: {name, rank, company, tour, note?}}` (not on the list) | pending accounts |
| `GET /api/stats?date=` (averages only), `GET /docs/<file>.pdf`, `PUT /api/profiles/<own key>` `{birthDate, hireDate}` | approved accounts |
| `PUT /api/staffing/<company>` `{required: n or null}`, `PUT /api/profiles/<key>`, `GET /api/admin/profiles` | admins |
| Employee cards: `PUT /api/admin/overrides/<pos>` `{name?, rank?, emplId?}` (all empty or equal to the files removes it), `PATCH /api/admin/records/{statuses,tour-changes,covers,people}/<id>` (same checks as adding; trade records refused), `PUT /api/admin/cells/<key>` `{cell or null}` (staff-list cell; only admins get it back in `/api/contacts`), `DELETE /api/admin/corrections/<id>`, `PATCH /api/admin/corrections/<id>` `{state: open}` (reopen) | admins |
| `GET /api/trades` (only trades you may see), `PUT /api/me/alerts` `{text, app, email, board: off/daily/each}` | approved accounts |
| `POST /api/trades` `{date, note?, audience: {board, to: [keys]}}`, `PATCH /api/trades/<id>` `{audience}` (widen only), `POST /api/trades/<id>/replies` `{proposal: {swapDate} or {later: true}, note?}`, `POST /api/trades/<id>/pick` `{replyId}`, `POST /api/trades/<id>/cancel` | approved accounts linked to a roster position (pick and cancel: the poster; admins may cancel) |

`dist/tour-schedule.html` is a single self-contained file (data inlined) that can be opened directly or shared.

**View-only snapshot.** `python3 tools/build_artifact.py out.html --snapshot records.json` builds the same page with the records (statuses, tour changes, covers, added people, staffing) baked in from `{"asOf": "YYYY-MM-DD", "records": {...}}`. It needs no sign-in and no page database, so it can be shared with people who don't have claude.ai accounts; the records are frozen at build time, so rebuild and republish it to bring it up to date. Personal dates (profiles) are never included.

## Updating the data

When a new vacancy list is issued:

```sh
python3 tools/extract_vacancy.py path/to/Vacancy_List.pdf   # needs pdftotext (poppler-utils)
python3 tools/build_artifact.py
```

The extractor checks the number of positions it parsed for each rank class against the "Total H… Positions" lines in the PDF and exits non-zero on a mismatch.
