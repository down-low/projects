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

Records are keyed by position number. There are two places they can be stored:

1. **The schedule server (`server.py`)**: SQLite in `data/schedule.db`. Anyone who can reach the server can view; editing needs a token.
2. **The shared claude.ai page**: `dist/tour-schedule.html` published as an artifact with its page database. Only people given Editor access on the page can make changes; Viewers see the schedule read-only.

The two stores are separate. Opening the page any other way (for example `python3 -m http.server`) is view-only.

## Running the server

```sh
EDIT_TOKENS="chief:$(openssl rand -hex 16),clerk:$(openssl rand -hex 16)" python3 server.py --port 8000
# open http://localhost:8000 and use "Sign in to edit" with one of the tokens
```

- `EDIT_TOKENS` is a comma-separated list of `name:token`. The name is recorded on each change as `createdBy`.
- The server listens on 127.0.0.1 by default. Use `--host 0.0.0.0` to accept other machines, and put it behind HTTPS (for example a reverse proxy) before sending tokens over a network.
- Back up `data/schedule.db` to keep the records.

API (JSON): `GET /api/records`, `POST /api/statuses` `{pos, code, start, end?, note?}`, `POST /api/tour-changes` `{pos, tour, effective, note?}`, `DELETE /api/statuses/<id>`, `DELETE /api/tour-changes/<id>`. Writes need `Authorization: Bearer <token>`.

`dist/tour-schedule.html` is a single self-contained file (data inlined) that can be opened directly or shared.

## Updating the data

When a new vacancy list is issued:

```sh
python3 tools/extract_vacancy.py path/to/Vacancy_List.pdf   # needs pdftotext (poppler-utils)
python3 tools/build_artifact.py
```

The extractor checks the number of positions it parsed for each rank class against the "Total H… Positions" lines in the PDF and exits non-zero on a mismatch.
