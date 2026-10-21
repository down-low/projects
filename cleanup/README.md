# Records in question

`records-in-question.csv`: one row per person whose position, status or Employee ID is in question. For the Employee cards (admin records editor) chat to work through and script.

**As of 10/17/2026.** Check each row against the live records before writing anything; some are already fixed (for example Choy, back in 01BT204M from 10/15).

## Priority and categories

| Priority | Category | Meaning |
|---|---|---|
| 2 | `vacant` | The officer list has this person in the seat; the tool shows it empty. |
| 2 | `held` | The officer list has this person; the tool has someone else in that seat. |
| 3 | `differs` | Company, tour or rank differ. Often an acting or detail assignment the tool doesn't record yet. |
| 4 | `nonfield` | On the officer list but not in the tool (likely a non-field assignment: AP, DT, CD, VR...). |
| 4 | `noid` | In the tool without an Employee ID. |
| 4 | `staff-name-no-match`, `staff-name-ambiguous` | The internal staff list had no match, or more than one, for this name. The user is cleaning these by hand. |

Sources: the officer roster check (H40 / H30 / H20, https://claude.ai/artifact/LfUeKBV5UUh2TXNaiwJgLn), the January holder review, and the staff-list ID match.

## Resolved 10/19/2026 (removed from the list)

- Johnston,S: Employee ID is **JO2603** (people record `x-JO2630` updated; the record key stays).
- Capurro,V: Employee ID is **CA5068** (`rosterOverrides/05ETL01M` and `data/employee-ids.json`). Working in 05EOL07M since 10/11; still owns 05ETL01M and stays put until moved by hand when Gebler arrives on 1/16/2027.
- Faenzi,C: acting Captain in 48EOC05M (cover kind `acting`), Breen covering 48EOL07M.
- Jensen,M: WE (already recorded).

## Rules for fixes

- Seat changes go through covers (`kind`: acting / cover / shadow / extra; `move: true` changes the owned seat), statuses (VA, S, D, WE, TR) or `rosterOverrides`. Every move also gets an `assignments` row so it shows in the person's Moves log.
- Cell numbers never go in this folder, the repo, or chat output.

## Checking against fir-db1

On the Employee cards screen, **Check with fir-db1 → Who: People on a list (CSV)**, choose this file and a rank group (H 40 first), then **Copy pull script** and paste it in the console of a signed-in fir-db1 tab. `fir-pull-H40.js` is that script for the 52 H 40 rows on 10/19/2026, and `fir-pull-H40-dec-jan.js` covers every day from 12/26/2026 through 1/27/2027 (the old seats before the January moves and the new seats after), both ready to paste. For the paramedics, `fir-pull-H3-dec-jan.js` pulls the 49 H3 people the tool itself has questions about (12/26/2026 to 1/27/2027; the list and reasons are in `h3-questions.md`), since this file has only 3 paramedic rows. Choose the CSV it downloads in the same panel to see, person by person, where fir-db1 and the tool disagree; people fir-db1 knows but the tool doesn't are listed with their fir-db1 company and position.

## Station rosters (fir-sap2)

`fir-sap2-station-rosters.js` pulls every station's roster (ST01–ST51) in one go. Open any station roster report on fir-sap2 (the `open.jsp` link, signed in on the city VPN), paste the script in that tab's console, and it downloads `station-rosters-<date>.csv`: station, Employee ID, name, reason (OWN owns a seat here, VR vacancy relief, OSE owns a seat elsewhere, blank no seat), rank (H class) and company. It asks the report for Excel output and reads the files in the browser; nothing is sent anywhere else. Attach the CSV in the chat to compare it with the tool. If fir-sap2 won't hand the files to the script, it offers to download each station's Excel file instead (51 files, about 3 seconds apart; allow multiple downloads when Chrome asks). Attach those files, or a zip of them.

## The routine (when needed)

Two scripts on your side, one numbered list on mine.

1. **Station rosters.** On fir-sap2, open any station roster report (the `open.jsp` link), paste `fir-sap2-station-rosters.js` in the console, and click OK to download every station's Excel file (about 2½ minutes; allow multiple downloads). Zip them and attach the zip in the chat.
2. **Say "sweep".** Claude dumps the live records and regenerates `fir-sweep.js` from them and the new rosters (`node tools/make_sweep.js --db <dump> --rosters <csv>`).
3. **fir-db1 sweep.** On any signed-in fir-db1 page, paste `fir-sweep.js` in the console and press Enter. It asks for the date (today by default; the page shows 9 days before to 4 after), then reads about 1,200 employee time pages, three at a time (about 10 minutes). If fir-db1 signs you out, sign in, paste it again and give the same date: it carries on where it stopped. Attach the CSV it downloads.
4. **One list.** Claude runs `tools/reconcile/reconcile.js` and posts `sync-<date>.md`: numbered proposals (Employee IDs, people to add, D/WE statuses and their ends, covers, covers to end), each with its evidence, plus what's for information only. Reply once ("all", "all except 4, 9", "1-20", plus anything you know), and Claude applies it with `tools/reconcile/pick.js`.

Rules the list follows: the roster's H class includes acting; OWN owns a seat there, VR vacancy relief, OSE owns a seat elsewhere; DP shows only on the day itself, so a run of DP days is disability from at least the first one, and REG after it ends it; trades (TRO/TRW) and extra shifts (WDO) are ignored; a position that isn't on the vacancy list is working elsewhere; the seat someone works on 3+ of their REG days (or every REG day, if 2+) is a standing cover, and one day is a fill.
