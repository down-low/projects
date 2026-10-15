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

## With the server launch

### Installable app (PWA)
Only on the self-hosted server (`server.py`); the claude.ai links run inside claude.ai's viewer and can't install as an app.

- **Manifest** (`manifest.webmanifest`): name "SFFD Tour Schedule", short name "Tours", start page `/`, standalone display, theme color from the app's red.
- **Icons:** 192 px and 512 px (plus a maskable version) and an Apple touch icon. Use a department-approved icon if one is provided, else a simple placeholder mark.
- **Service worker:** caches the app's own files and the roster so it opens fast and still shows the schedule on a weak signal. Sign-in, records (leave, covers, tour changes) and contact info always come live from the server, never from the cache. A new version takes over on the next open.
- **Server:** serve the manifest, icons and service worker to everyone (signed in or not) so phones can install it; HTTPS is already required.
- **Check before launch:** "Add to Home Screen" on iPhone (Safari) and Android (Chrome) opens full-screen with the bottom tab bar clear of the home indicator; sign-in still works from the installed app.

## Later
- Daily overtime entry (voluntary, mandatory, advance hire) and upload of each day's Balance report to reconcile automatically.
- Additional status codes (light duty, injury) if needed.

## Shipped
- Google sign-in, My page, Admin; claim-and-approve, and requests from people not on the vacancy list.
- Tour changes, VA/S/D leave, cover assignments, added people.
- Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
- Dashboard grouping by division and battalion, from the Daily Balance Report (`organization.js`).
- Required staffing from the Balance report (313), Regular / Covering / Open split, "working but not in the tool" check, Open seats worklist for long-term covers.
- Employee IDs: searchable, shown on person pages, duplicate names flagged.
- Phone layout: bottom tabs (Find, Today, Staffing, More), menu sheet, battalion lists, on/off status in search.
- View-only snapshot link with records baked in (no sign-in needed).
