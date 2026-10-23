# Scripts: what's here and how to reuse it

Two kinds:

- **Browser scripts** (`cleanup/*.js`): paste into the console (F12 → Console) of a signed-in fir-db1 or fir-sap2 tab. They download a CSV, which you attach in the chat.
- **Local tools** (`tools/`): Claude runs these on the files you attach.

The status log is `STATUS.md` and the routine is `README.md`.

## Reusable as is (they ask for dates or people when run)

| Script | Run on | Reads | Gives |
|---|---|---|---|
| `fir-pull-battalions.js` | any fir-db1 page | Roster by Station (1021:11), all 10 battalions, every day in the range asked | everyone working each day: company, role, TRC, trade partner (`with`). One day is enough for crews; a 31-day range for trades. |
| `fir-pull-balance.js` | Daily Balance Report on fir-sap2 | the report as Excel, per day, for the ranges asked | `balance_bottom.csv`: status counts (OFF/PM/FF) and overtime hired by rank. Falls back to one download per day. |
| `fir-sap2-station-rosters.js` | any station roster report on fir-sap2 | all stations, ST01–ST51 | station, ID, name, reason (OWN/VR/OSE), rank, company |

## Built for one list (the people are inside; rebuild for a new list)

| Script | What | Rebuild with |
|---|---|---|
| `fir-pull-H30.js`, `-H20.js`, `-H3.js`, `-H40.js`, `-H40-dec-jan.js`, `-H3-dec-jan.js`, `-seats.js`, `-owners.js`, `-noid.js` | employee time pages (or company pages) for the people in question, over the dates asked | Employee cards → **Check with fir-db1** → Copy pull script (`FirCompare.script` in `fir.js`) |
| `fir-pull-phones-00…09-*.js` | Phone numbers pop-up per Employee ID, one rank per file (CELL, else HOME) | `node tools/make_phone_pull.js <missing.json>` (from `tools/reconcile/missing_cells.js --json`) |
| `fir-pull-time-balances-test.js` | Time Balance pop-up per Employee ID (type, hours, as-of, scheduled hours); test with Lester and Goforth | `node tools/make_balance_pull.js <people.json> <out.js> [label]` (people = [{key, id, name}]) |
| `fir-pull-licenses-st01-07-36.js` | Licenses and Certs pop-up (name and expiration, never the number) | `licenseScript` in `fir.js` with a new people list |

## Probes (read-only, used once to learn a page's layout)

`fir-phone-probe.js`, `fir-licenses-probe.js`, `fir-balance-probe.js`. They mask numbers, and serve as templates for probing a new report.

## Local tools

| Tool | Input | Output |
|---|---|---|
| `tools/reconcile/reconcile.js` | page dump plus station-roster / time-pull CSVs | numbered proposed fixes (with `pick.js`: write batches) |
| `tools/reconcile/xlsx2csv.py` | station roster Excel files (folder or zip) | one station-roster CSV |
| `tools/reconcile/balance_xlsx.py` | balance report Excel files (folder or zip) | `balance_bottom.csv` |
| `tools/reconcile/balance_summary.py` | `balance_bottom.csv` | one row per day: sick, vacation, disability (OFF/PM/FF), hired, the same weekday last year |
| `tools/reconcile/trades.py` | battalion or time-pull CSVs | per person: TRW, TRO, net and partners; top-10 lists |
| `tools/reconcile/missing_cells.js` | page dump with contacts | `missing-cells.md` (who has no cell, by rank) |
| `tools/make_sweep.js` | page dump | `fir-sweep.js`, a 14-day time pull for everyone |
| `tools/extract_vacancy.py`, `extract_awards.py`, `extract_balance.py` | the Vacancy List, Vacancy Awards and Balance Report PDFs | `data/*.json` the tool is built from |

Phone numbers and license numbers never go in this folder, the repo or chat output.
