# Release list

## Upcoming: December 2026 rollout

### Apply the 2027 vacancy awards (26 A-082)
The awards report (`docs/vacancy-awards-26A082.pdf`, dated 09/18/2026) moves about 400 people to new positions.

- **Effective date:** each person's **First Reg** date from the transfer list (their first shift in the new position), with their **Last Reg** as the final shift in the old one. These are usually the first day of the new tour on or after Jan 16, 2027, but not always: on the list sent 10/15/2026, Alvarenga, Bisig, Breen and Guillen start a few days later and Skifter starts on Jan 15. Until then they stay on their current position and tour.
- **Already loaded (10/15/2026):** the 31 moves on that list are in the shared page as cover assignments (current spot from 1/1/2026 to Last Reg, new spot from First Reg), with 9 people added. Scafani's positions 31EOA08T / 40EOA12T were matched to 31EOL08M / 40EOL12M and are marked to confirm.
- **Source columns:** position number (the new tour is the two digits before the trailing `M`), EmplID, full name, current class and current assignment. Asterisks on position numbers carry over from the vacancy list.
- **Matching:** awardees are matched to roster people by last name plus first initial (`Pereira,Joshua M` → `Pereira,J`), with EmplID kept for future imports. Names that don't match are created as added people.
- **Review before applying:** an admin screen lists each move (from position, to position, computed effective date) with unmatched or ambiguous names flagged, then applies them as dated moves.
- **Seats left behind** become vacant from the same date unless another award fills them.

## Later
- Daily overtime entry (voluntary, mandatory, advance hire) and upload of each day's Balance report to reconcile automatically.
- Additional status codes (light duty, injury) if needed.

## Shipped
- Google sign-in, My page, Admin; claim-and-approve, and requests from people not on the vacancy list.
- Tour changes, VA/S/D leave, cover assignments, added people.
- Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
- Dashboard grouping by division and battalion, from the Daily Balance Report (`organization.js`).
- Required staffing from the Balance report (313), Regular / Covering / Open split, "working but not in the tool" check, Open seats worklist for long-term covers.
