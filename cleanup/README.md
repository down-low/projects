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

On the Employee cards screen, **Check with fir-db1 → Who: People on a list (CSV)**, choose this file and a rank group (H 40 first), then **Copy pull script** and paste it in the console of a signed-in fir-db1 tab. `fir-pull-H40.js` is that script for the 52 H 40 rows on 10/19/2026, and `fir-pull-H40-dec-jan.js` covers every day from 12/26/2026 through 1/27/2027 (the old seats before the January moves and the new seats after), both ready to paste. Choose the CSV it downloads in the same panel to see, person by person, where fir-db1 and the tool disagree; people fir-db1 knows but the tool doesn't are listed with their fir-db1 company and position.
