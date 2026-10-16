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
- **Built (10/2026):** the **2027 awards** screen (editors) does all of the above: 308 moves ready, 19 to check, 38 needing no move, against the records of 10/16/2026. A move changes the seat a person owns; covers they have elsewhere keep running until ended. It moves to Shipped once applied on the shared page.

## With the server launch

### Hosting on Firebase
Hosting, Google sign-in, Firestore and Storage in place of `server.py`; see **`FIREBASE_PLAN.md`** for the data model, security rules, functions, migration, tests and launch steps. First confirm with the department or city IT where employee data may be hosted.

### Installable app (PWA)
Only on the self-hosted server (`server.py`); the claude.ai links run inside claude.ai's viewer and can't install as an app.

- **Manifest** (`manifest.webmanifest`): name "SFFD Tour Schedule", short name "Tours", start page `/`, standalone display, theme color from the app's red.
- **Icons:** 192 px and 512 px (plus a maskable version) and an Apple touch icon. Use a department-approved icon if one is provided, else a simple placeholder mark.
- **Service worker:** caches the app's own files and the roster so it opens fast and still shows the schedule on a weak signal. Sign-in, records (leave, covers, tour changes) and contact info always come live from the server, never from the cache. A new version takes over on the next open.
- **Server:** serve the manifest, icons and service worker to everyone (signed in or not) so phones can install it; HTTPS is already required.
- **Check before launch:** "Add to Home Screen" on iPhone (Safari) and Android (Chrome) opens full-screen with the bottom tab bar clear of the home indicator; sign-in still works from the installed app.

### Shift-trade alerts (app, text and email)
The Trades tab already stores each member's opt-in: three switches, "Notify me by text / in the app / by email", shown as "available at launch". With the server:

- **App (push):** Firebase Cloud Messaging, free. The installed app (PWA) asks for notification permission and saves its FCM token on the member's account; a Cloud Function sends the push. On iPhone, notifications only work after the app is added to the Home Screen (Apple's rule for web apps).
- **Text (SMS):** the department's **Twilio** account, sent from a Cloud Function (or `server.py`). Google has no SMS-sending API (Google Voice has none, Firebase only texts sign-in codes), and carrier email-to-text gateways are unreliable (AT&T's is shut down), so texts need Twilio.
  - **Start early:** US texts from an app need **A2P 10DLC** registration in Twilio (brand plus campaign). It takes days to a couple of weeks, with a small monthly fee plus a fraction of a cent per text.
  - Phone numbers come from My page. The opt-in switch is the consent; texts honor STOP replies.
  - Twilio keys stay in function secrets, never in the repo.
- **Email:** sent from a department Gmail / Workspace account (Gmail API from a Cloud Function, or SMTP from `server.py`), to the contact email on My page, else the sign-in email. Free at this size; the fallback for anyone without the app.
- **The details are in the alert,** so nobody has to open the page just to decide:
  - **A trade sent to you:** "Lester,D (Lt · E10) wants a 24-hr trade for Sat Oct 17, Watch 26, at E10. 'Daughter's recital.' You're off that day; you work the day after."
  - **A response to your trade:** "Schnelker,R (Capt · E01) can take Sat Oct 17. Swap: you work their Mon Oct 19."
  - **Your response was picked, or a set trade was cancelled:** the date, the other person and the terms.
  - Names and dates show on lock screens; that's the point.
- **Answer from the alert, without signing in:**
  - **Text:** "Reply 1 = interested, pay back later · 2 and a date = swap (e.g. 2 10/23)", or "PICK" on a response to your own trade. Twilio forwards replies to the server, which matches the phone number to a member and runs the same checks as the page.
  - **Email:** buttons with signed, single-use links that expire after 7 days (I'm interested · pay back later; or open to pick a swap day).
  - **App:** the same actions on the notification.
- **What alerts you:** trades sent to you and responses to your trades, always (on whichever channels you turned on). **Board posts** are a separate setting, saved now: **Off** (the default; people browse the board when they want), **Daily summary** (one message listing new posts you could take), or **Each new post**.
- **Opt-out:** the switches stay on the Trades tab; texts also honor STOP replies.

### Calendar sync (iCal / Google Calendar)
- **Subscribe link:** each signed-in person gets a private calendar feed (`…/cal/<secret>.ics`) of their own schedule, built from the same logic as their person page (`TourMath.dayFor`). Add it in Google Calendar (Other calendars → From URL), Apple Calendar / iPhone (Add subscription) or Outlook.
- **On the feed:** one event per work day titled with the company and tour (e.g. "E21 · Tour 15"), acting or covering noted in the description, leave days (VA / S / D) marked, holidays named on the day; about 12 months ahead and 1 month back. All-day events by default, or a set shift start (e.g. 08:00 for 24 hours) once confirmed.
- **Stays current:** tour changes, covers and leave appear after the calendar app refreshes (Google refreshes subscriptions every several hours; not in our control).
- **Privacy:** the secret in the URL is the only key, so My page gets **Reset link** to revoke it. The feed holds only that person's own schedule, with no contact info and no other people.
- **Where it runs:** a small route in `server.py`, or an HTTPS Cloud Function on Firebase (see `FIREBASE_PLAN.md`).
- **Optional:** a **Download .ics** button on a person's page for a one-time import (no auto-updates); this could also work on the claude.ai page.
- **Not planned:** two-way Google Calendar sync. It would need people to grant Calendar access, and a subscription covers the need.

## Later
- **By rank on phones:** pick a rank and company and show one or two weeks at a time (swipe or ‹ › to move) instead of the full 31-day month grid; keep the month grid on desktop.
- Daily overtime entry (voluntary, mandatory, advance hire) and upload of each day's Balance report to reconcile automatically.
- Additional status codes (light duty, injury) if needed.

## Shipped
- Google sign-in, My page, Admin; claim-and-approve, and requests from people not on the vacancy list.
- Tour changes, VA/S/D leave, cover assignments, added people.
- Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
- Dashboard grouping by division and battalion, from the Daily Balance Report (`organization.js`).
- Required staffing from the Balance report (313), Regular / Covering / Open split, "working but not in the tool" check, Open seats worklist for long-term covers.
- Employee IDs: searchable, shown on person pages, duplicate names flagged.
- Phone layout: bottom tabs (Find, Today, Staffing, More), menu sheet, Today grouped by rank, Staffing drill-down by battalion, on/off status in search.
- View-only snapshot link with records baked in (no sign-in needed).
- Holidays on the calendars (12 city holidays plus Halloween and Mother's Day as observances), worked out for any year.
- Shift trades: "this is me" claim, Trade wizard (payback, recipients by division and battalion, board), Trades tab (board, sent to me, my trades, owed shifts), TR (traded off) on the schedule. App, text and email alerts come with the server launch.
