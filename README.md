# SFFD Tour Schedule

Look up who is working on any date, when a given person works, or a month roster for a rank.

- **Who's working**: pick a date and see the watch number, the 9 tours working, and everyone on duty grouped by rank. Swing positions show the company they cover.
- **By person**: search by name, company or position number. Shows the person's tour, a month calendar of work days, and their next shifts.
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

## Tour changes and leave (VA / S / D)

Editors can record, per person (on the **By person** tab):

- **Status**: VA vacation, S sick or D disabled, for a date range. Leave the end date open for an open-ended status. The person still shows on their scheduled days, struck through and marked with the code, and is counted as off rather than on duty. If two ranges overlap, the newer entry wins.
- **Tour change**: a new tour from an effective date. Earlier dates keep the old tour. A swing position's company rotation only applies on its original tour; after a change it shows its home company.

- **Cover assignment** (temporary acting, e.g. covering an injured captain): on the covering person's page, **Cover another position**, pick the position, a start date and optionally an end date. While it runs, that person works the covered position's tour and company and shows as "Acting for" the holder; the holder shows "Covered by"; the coverer's own spot shows them away. Mark the holder's leave (for example D) separately. **End today** closes an open-ended cover.
- **Add a person** not on the vacancy list (relief, detailed or new staff): **Not on the list? Add a person** under the person search, then give them a cover assignment.

## Dashboard, 6 of 9, Documents

- **Dashboard** (first tab): for any date, **Total Working Staff** and **Positions Needing Staff**, then a table per apparatus with Required, Working, Extra, Missing and Total (Total = Working − Required; Extra and Missing are its positive and negative parts). Click an apparatus to drill down to who is working and which seats are short and why (vacant seat, leave not covered, acting elsewhere). Sort by any column, search, or show only short apparatus. **Required** defaults to the usual number of positions scheduled at that apparatus across a 31-day cycle (E10 = 4, T01 = 5); admins can click the number to override it or reset it. Grouping by battalion and division is planned (see `RELEASES.md`).
- **Stats summary**: full duty, VA, S, D, acting/covering, spots open for bid, vacant seats, and **average age** and **average years of service** from birth and hire dates. Dates are entered by the person on My page or by an admin on the By person page; they are private, and the dashboard only shows averages.
- **6 of 9** (header link): tours whose start days are 3 or 10 days apart work 6 of the same 9 shifts. Pick a tour to see its four partners, the shared watches and the dates they fall on this month, plus a 31 × 31 table of shifts in common.
- **Documents** (header menu): the 2026 and 2027 Watch Calendars, the Vacancy List (26 A-071) and the 2027 Vacancy Awards (26 A-082). Files live in `docs/` and are listed in `docs/index.json`; the server only serves listed files, to signed-in, approved users.

## Signing up when you're not on the vacancy list

After signing in with Google, someone who can't find their name picks **I'm not on the list** and enters their name, rank, apparatus and tour. An admin sees the request on the Admin page; **Approve and add to roster** adds them with that apparatus and tour (tagged "Added") and gives them access.

Search: a company code (`E10`, `e 10`, `RS1`) matches that company only (where people work that day, including swings and covers); `tour 10` matches a tour; a full position number (`10EOC03M`) matches that position; anything else matches names and titles.

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
| `POST /api/statuses` `{pos, code, start, end?, note?}`, `POST /api/tour-changes` `{pos, tour, effective, note?}`, `POST /api/covers` `{coverKey, targetPos, start, end?, note?}`, `PATCH /api/covers/<id>` `{end}`, `POST /api/people` `{name, rank, note?}`, `DELETE /api/{statuses,tour-changes,covers,people}/<id>` | editors, admins |
| `GET /api/admin/users`, `POST /api/admin/users/<id>` `{action: approve, reject, role, link, unlink, disable, enable}` | admins |
| `POST /api/me/claim` `{request: {name, rank, company, tour, note?}}` (not on the list) | pending accounts |
| `GET /api/stats?date=` (averages only), `GET /docs/<file>.pdf`, `PUT /api/profiles/<own key>` `{birthDate, hireDate}` | approved accounts |
| `PUT /api/staffing/<company>` `{required: n or null}`, `PUT /api/profiles/<key>`, `GET /api/admin/profiles` | admins |

`dist/tour-schedule.html` is a single self-contained file (data inlined) that can be opened directly or shared.

## Updating the data

When a new vacancy list is issued:

```sh
python3 tools/extract_vacancy.py path/to/Vacancy_List.pdf   # needs pdftotext (poppler-utils)
python3 tools/build_artifact.py
```

The extractor checks the number of positions it parsed for each rank class against the "Total H… Positions" lines in the PDF and exits non-zero on a mismatch.
