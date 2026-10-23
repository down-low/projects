# Scripts: what's here and how to reuse it

Two kinds:

- **Browser scripts** (`cleanup/*.js`): paste into the console (F12 → Console) of a signed-in fir-db1 or fir-sap2 tab. They download a CSV, which you attach in the chat.
- **Local tools** (`tools/`): Claude runs these on the files you attach.

The status log is `STATUS.md` and the routine is `README.md`.

## Reusable as is (they ask for dates or people when run)

| Script | Run on | Reads | Gives |
|---|---|---|---|
| `fir-pull-battalions.js` (asks for dates), `fir-pull-battalions-0922-1022.js` (9/22–10/22/2026 preset) | any fir-db1 page | Roster by Station (1021:11), all 10 battalions, every day in the range asked | everyone working each day: company, role, TRC, trade partner (`with`). One day is enough for crews; a 31-day range for trades. Status box, 30 s timeouts, resumes after a sign-out. |
| `fir-pull-balance.js` | Daily Balance Report on fir-sap2 | the report as Excel, per day, for the ranges asked | `balance_bottom.csv`: status counts (OFF/PM/FF) and overtime hired by rank. Falls back to one download per day. |
| `fir-sap2-station-rosters.js` | any station roster report on fir-sap2 | all stations, ST01–ST51 | station, ID, name, reason (OWN/VR/OSE), rank, company |

## Built for one list (the people are inside; rebuild for a new list)

| Script | What | Rebuild with |
|---|---|---|
| `fir-pull-H30.js`, `-H20.js`, `-H3.js`, `-H40.js`, `-H40-dec-jan.js`, `-H3-dec-jan.js`, `-seats.js`, `-owners.js`, `-noid.js` | employee time pages (or company pages) for the people in question, over the dates asked | Employee cards → **Check with fir-db1** → Copy pull script (`FirCompare.script` in `fir.js`) |
| `fir-pull-phones-00…09-*.js` | Phone numbers pop-up per Employee ID, one rank per file (CELL, else HOME) | `node tools/make_phone_pull.js <missing.json>` (from `tools/reconcile/missing_cells.js --json`) |
| `fir-pull-time-balances-test.js` | Time Balance pop-up per Employee ID (type, hours, as-of, scheduled hours); test with Lester and Goforth | `node tools/make_balance_pull.js <people.json> <out.js> [label]` (people = [{key, id, name}]) |
| `fir-pull-pqf-all.js` (1,223 people), `fir-pull-pqf-test3.js` | PQF page left column per Employee ID: appointment type, official rank, appointment date, job code, job entry date, SFFD hire date, seniority; status box, timeouts, resumes | `pqfScript` in `fir.js` with a new people list |
| `fir-pull-licenses-st01-07-36.js`, `fir-pull-licenses-e16-e35.js` | Licenses and Certs pop-up (name and expiration, never the number); status box, timeouts, resumes | `licenseScript` in `fir.js` with a new people list |

## Probes (read-only, used once to learn a page's layout)

`fir-phone-probe.js`, `fir-licenses-probe.js`, `fir-licenses-paging-probe.js`, `fir-balance-probe.js`, `fir-pqf-test.js` (PQF page 1021:19: hire date, seniority, appointment type; Lester and Goforth). They mask numbers, and serve as templates for probing a new report.

## Local tools

| Tool | Input | Output |
|---|---|---|
| `tools/reconcile/reconcile.js` | page dump plus station-roster / time-pull CSVs | numbered proposed fixes (with `pick.js`: write batches) |
| `tools/reconcile/xlsx2csv.py` | station roster Excel files (folder or zip) | one station-roster CSV |
| `tools/reconcile/balance_xlsx.py` | balance report Excel files (folder or zip) | `balance_bottom.csv`; one report per date (repeated files skipped, conflicts listed) |
| `tools/reconcile/balance_summary.py` | `balance_bottom.csv` | one row per day: sick, vacation, disability (OFF/PM/FF), hired, the same weekday last year |
| `tools/reconcile/forecast.py` | history `balance_bottom.csv` plus a future-dated pull (what's booked) | `project`: expected sick, vacation (booked or last year's level), OS and hires per day with a ± band and a holiday allowance; `check`: the same days against the real reports |
| `tools/reconcile/trades.py` | battalion or time-pull CSVs | per person: TRW, TRO, net and partners; top-10 lists |
| `tools/reconcile/load_phones.py` | current staff-list doc plus phone pull CSVs | the new staff-list doc (CELL, else HOME marked `home`; never replaces a number); counts only |
| `tools/reconcile/missing_cells.js` | page dump with contacts | `missing-cells.md` (who has no cell, by rank) |
| `tools/make_sweep.js` | page dump | `fir-sweep.js`, a 14-day time pull for everyone |
| `tools/extract_vacancy.py`, `extract_awards.py`, `extract_balance.py` | the Vacancy List, Vacancy Awards and Balance Report PDFs | `data/*.json` the tool is built from |

Phone numbers and license numbers never go in this folder, the repo or chat output.
