# Watch balance: officer seats per watch and tour moves

Saved 2026-10-23. A snapshot, not a decision: re-run the scripts after roster changes.

## What was measured
- **Seats on duty per watch:** Lieutenant, Captain, Rescue Captain and Battalion Chief seats on duty on each of the 31 watches.
  - Covers one full cycle, Nov 1–Dec 1, 2026.
  - Uses the tour schedule app's own logic (`schedule.js`, as in `app.js` `dayRows`) on `data/positions.json` plus its live records as of 10/23: covers, acting, added people and leave.
- **Acting officers** count in the rank of the seat they fill.
- **Check:** watch 4 (10/26) gives 21 Captain seats, all filled, with 22 Captains on duty (one seat has an extra). This matches the app.
- **Even spread** = positions × 9 ÷ 31, since every tour works 9 of the 31 watches.

| Rank | Positions | Seats per watch now | Even spread |
|---|---|---|---|
| Captain | 67 | 16–23 | 19.5 |
| Lieutenant | 167 | 45–52 | 48.5 |
| Battalion Chief | 34 | 9–10 | 9.9 (10 a day, one per battalion, needs 35) |
| Rescue Captain | 12 | 2–4 | 3.5 |

- **Captains, fattest watches:** 1 and 15 (23 seats).
- **Captains, leanest watches:** 3, 6, 24 and 27 (16 seats).
- **The 22-Captains-a-day goal** would need about 76 positions. With 67, the best possible is 19–20 every day.

## Recommended moves
Each step moves one position from one tour to another. They were found by a greedy search on counts.

**Captains: 4 moves take every watch to 19–20**

| Step | Move | Range after |
|---|---|---|
| 0 | as scheduled | 16–23 |
| 1 | Tour 12 → Tour 14 | 17–22 |
| 2 | Tour 26 → Tour 21 | 18–21 |
| 3 | Tour 30 → Tour 24 | 18–21 (SD 0.66) |
| 4 | Tour 1 → Tour 4 | 19–20 |

**Lieutenants: 4 moves take every watch to 48–49**

| Step | Move | Range after |
|---|---|---|
| 0 | as scheduled | 45–52 |
| 1 | Tour 14 → Tour 12 | 46–52 |
| 2 | Tour 21 → Tour 26 | 47–51 |
| 3 | Tour 4 → Tour 22 | 47–50 |
| 4 | Tour 28 → Tour 20 | 48–49 |

- **Rescue Captains:** Tour 1 → Tour 4 gives 3–4 on every watch.
- **Battalion Chiefs:** already as even as 34 positions allow.
- **Captain and Lieutenant moves mirror each other** (12↔14, 21↔26). A Captain and a Lieutenant on the same apparatus could trade tours, which balances both ranks without changing any company's officer count.

## Why it matters
On a lean watch, more of the day's openings at that rank have to be filled by overtime. When too few volunteer, people are mandated or bumped up from the rank below against their will. Evening out the watches cuts that pressure on the lean days.

## Limits
- **Counts only.** The search doesn't weigh which apparatus, swing seats, seniority or bids, or the 2027 awards that start in January.
- **Re-run before acting on it**, since covers and the roster change.

## Files and re-running
- `watch_staffing.csv`: per watch × rank, with seats, filled, vacant, on duty after leave, and on leave. No names.
- `watch_moves.csv`: the move steps above.
- `scripts/roster_day.js`:
  - command: `node scripts/roster_day.js <repo> <db-dump-dir> 2026-11-01 2026-12-01 > watch_staffing.json`
  - The db dump is the shared page's `statuses`, `covers`, `tourChanges` and `people` collections; don't commit it.
- `scripts/watch_moves.js`:
  - command: `node scripts/watch_moves.js <repo> watch_staffing.json 6`
- **Dashboard:** "Watches" tab of SFFD Leave and Overtime (https://claude.ai/artifact/X6Sqz6SkHTimZ29xKhj9mj).
