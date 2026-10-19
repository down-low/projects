# Records in question

`records-in-question.csv`: one row per person whose position, status or Employee ID is in question. For the Employee cards (admin records editor) chat to work through and script.

**As of 10/17/2026.** Check each row against the live records before writing anything; some are already fixed (for example Choy, back in 01BT204M from 10/15).

## Priority and categories

| Priority | Category | Meaning |
|---|---|---|
| 1 | `id-mismatch` | The tool's Employee ID differs from the staff list by one digit (Johnston, Capurro). |
| 1 | `january-holder` | Someone moves into this person's seat in January; where the holder goes is unknown (Faenzi, Jensen, Capurro). |
| 2 | `vacant` | The officer list has this person in the seat; the tool shows it empty. |
| 2 | `held` | The officer list has this person; the tool has someone else in that seat. |
| 3 | `differs` | Company, tour or rank differ. Often an acting or detail assignment the tool doesn't record yet. |
| 4 | `nonfield` | On the officer list but not in the tool (likely a non-field assignment: AP, DT, CD, VR...). |
| 4 | `noid` | In the tool without an Employee ID. |
| 4 | `staff-name-no-match`, `staff-name-ambiguous` | The internal staff list had no match, or more than one, for this name. The user is cleaning these by hand. |

Sources: the officer roster check (H40 / H30 / H20, https://claude.ai/artifact/LfUeKBV5UUh2TXNaiwJgLn), the January holder review, and the staff-list ID match.

## Rules for fixes

- Seat changes go through covers (`kind`: acting / cover / shadow / extra; `move: true` changes the owned seat), statuses (VA, S, D, WE, TR) or `rosterOverrides`. Every move also gets an `assignments` row so it shows in the person's Moves log.
- Cell numbers never go in this folder, the repo, or chat output.
