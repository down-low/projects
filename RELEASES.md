# Release list

## Upcoming: December 2026 rollout

### Apply the 2027 vacancy awards (26 A-082)
The awards report (`docs/vacancy-awards-26A082.pdf`, dated 09/18/2026) moves about 400 people to new positions.

- **Effective date:** each person's **first day of their new tour on or after Jan 16, 2027**. Dates therefore differ by person; until then they stay on their current position and tour.
- **Source columns:** position number (the new tour is the two digits before the trailing `M`), EmplID, full name, current class and current assignment. Asterisks on position numbers carry over from the vacancy list.
- **Matching:** awardees are matched to roster people by last name plus first initial (`Pereira,Joshua M` → `Pereira,J`), with EmplID kept for future imports. Names that don't match are created as added people.
- **Review before applying:** an admin screen lists each move (from position, to position, computed effective date) with unmatched or ambiguous names flagged, then applies them as dated moves.
- **Seats left behind** become vacant from the same date unless another award fills them.

## Later
- Additional status codes (light duty, injury) if needed.

## Shipped
- Google sign-in, My page, Admin; claim-and-approve, and requests from people not on the vacancy list.
- Tour changes, VA/S/D leave, cover assignments, added people.
- Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
- Dashboard grouping by division and battalion, from the Daily Balance Report (`organization.js`).
