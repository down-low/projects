# Release list

## Next release (specced, not built; build one at a time: Invite first, then Overtime)

### App notifications test and announcements
**Built on branch `claude/notifications` (Oct 2026).** Live once merged and `FIREBASE_VAPID_KEY` is set (FIREBASE_SETUP.md, step 12).
- **Getting app notifications working on real phones:** the Web Push key as the GitHub variable `FIREBASE_VAPID_KEY`, then a deploy. Tested with two people (Lester and Goforth) on iPhone and Android: turn on "Notify me in the app", **Send me a test notification**, then a trade sent from one to the other.
- **iPhone:** notifications only work from the Home Screen app. On an iPhone in Safari, Trades → Alerts says so (Share → Add to Home Screen, open it from there, then turn them on) instead of asking for a permission Safari can't give. The app has a Home Screen icon and opens full screen.
- **Small fixes:** a device's token is saved again on each visit (tokens change); alerts that arrive while the app is open show as a card at the top.
- **Admin → Send announcement** (back office): title (80 characters), short message (300), optional `https://` link; to everyone with an account or to picked people; a preview and a confirm step.
  - Everyone it goes to sees it as a card at the top of the app until they dismiss it; people with app notifications on also get it on their phone.
  - Function `announce` (admins only) checks it, refuses anything that looks like a phone number (cells never go out), keeps it in `announcements/{id}` (admins read; only the function writes) and each person's copy in `notices/{uid}` (the owner reads it and may only mark it dismissed). Audited (`announce`).
  - Sent announcements are listed under the form with how many people got them and how many by app notification.
- **First use:** announcing sick and vacation accrual tracking. Accrual itself is a separate feature: it needs its own spec and a consent record first.

### Invite a coworker (built Oct 22, 2026; on the Firebase sites; the claude.ai page shows it once it knows the app address)
- **Where:** More menu → **Invite a coworker**, for every signed-in member (employee app, back office and the claude.ai page).
- **Sheet:** a large QR code of the employee app address, **Share** (the phone's share sheet: Messages and the like), **Copy link**, and a line saying they sign in with the cell number on the staff list.
- **No server work:** signing up already works from the plain app address. The QR is drawn in the page from `vendor/qrcode.js` (Kazuhiko Arase's MIT QR encoder, bundled in the repo); `invite.js` holds the sheet.
- On the claude.ai page the link is the Firebase app address once set; until then the item is hidden.

### Overtime days on my calendar (built Oct 23, 2026; `overtime.js`)
- **Where:** on your own Schedule calendar, tap a day you aren't scheduled to work.
- **Marks:** **Want OT** (future days) and **Worked OT** (hired; past or upcoming days) with hours (default 24) and an optional note. Tap again to change or remove.
- **Calendar:** its own day style (outline for Want OT, fill for Worked OT), a legend entry, and the month's totals under the calendar ("OT: 2 days, 48 hrs this month · 3 wanted").
- **Who sees what (the user's call, 10/23):** everyone signed in sees a person's Want OT / Worked OT marks on their calendar; the note only that member and admins. Marks in `overtime/<doc>` (page rule read `view`), notes in `overtimeNotes/<doc>` (owner and admins).
- **As built:** marked from the day drawer (the same one as Trade and VA / S). Want OT for today on, Worked OT for any day (hours 1 to 48). Members mark their own seat; admins mark anyone's from that person's page (stored as `seat-<pos>`, which the member sees but can't change). Not part of the page backup import, so marks made on Firebase are never replaced at cut-over.
- **Later:** admins use Want OT days to fill shortages.

### Personal invite links (admin)
- **Where:** Admin → Invite people, and each person in Admin → Users and on the Employee card, get **Personal link** next to Text.
- **Link:** `<app>/?join=<code>`: one use, expires after 14 days, made by a function. Reuses the trade-invite code paths (`createInvite`, `redeemInvite`) but in its own `joinInvites` collection, so trade invites stay untouched.
- **First Google sign-in through the link:** a confirm card, "You're joining as David Lester · Captain E10: Yes, that's me / Not me". Yes links the account to that seat at once (no claim screen) and marks the invite Joined; for members the staff-list cell is then attached automatically (`planStaffCell`), so cell sign-in works right away. Not me goes to the normal claim screen and flags the invite for the admin.
- **Tracking:** Invite people shows Sent → Opened → Joined per person, with Resend and Revoke.
- **Safety:** one use, expiry and the confirm step; admin Undo (unlink) on the Users row; a link never gives more than member access.
- **Later, separately:** the claim screen one step at a time (cell → code → done; name search behind a link). Users find it confusing; left as is for now.

### Divisions with their own real data (Airport, EMS, HQ)
- **Real data, one Firebase project per division:** clone the Suppression project's setup into a new project (Airport, then EMS, then HQ). Same repo and code; GitHub deploys to each project as its own target.
- **Each division's own files:** roster, Employee IDs and staffing are loaded and cleaned on their own; the Suppression database is never touched.
- **Every record carries a `division` tag,** so merging into one database later is an import, not a cleanup.
- **In code:** a `division` setting picks the data files, screens and terminology (the seam in `HANDOFF.md`, Design principles).
- **Cleanup:** one division at a time, in its own records chat, with the same routine (`cleanup/README.md`).

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

### Sign-in without a Google account
**Built on Firebase (Oct 2026): cell number + texted code.** The cell is matched to the staff list (`staffCells`); exactly one free seat with that cell links and approves the account at once (`approvedBy: "cell"`, audited) and saves the number for trade texts. Otherwise the person picks their name and an admin approves. A personal trade invite link opened with the invited person's cell needs no Employee ID. **Launch invites:** Admin → Invite people texts the app link from the admin's phone (groups of 10 with cells filled in, or one by one), downloads contact cards (.vcf, logged), or sends from the department number once Twilio is set up (`launchInvites` function).

Offer these alongside Google sign-in (all built into Firebase Auth), so members without a Google account can still sign in:

- **Email link (no password):** enter any email address and tap the sign-in link sent to it. Free; nothing to forget. This is the main backup.
- **Phone number (text code):** enter a cell number and type the 6-digit code texted to it. Good for people who don't check email, and it supplies the number for trade text alerts. Each text costs a few cents (check current Firebase pricing; set a budget alert).
- **Maybe later:**
  - **Microsoft sign-in** with city work accounts, if the city uses Microsoft 365 and IT allows it;
  - **Apple sign-in**, which needs a $99/year Apple developer account;
  - **email and password**, only if members ask for it.
- **Same claim flow for everyone:** after any sign-in, find yourself by name or Empl ID and confirm your station and tour; an admin approves or undoes the claim. One person can link more than one sign-in method to the same account.
- **Built on Firebase (Oct 2026, first user feedback):** on the claim screen, names match in any order ("dave lester"), one match is picked for you, and the Employee ID on file for that position approves the account at once (`approvedBy: "emplId"`, audited); without it an admin approves. The app opens on your own schedule once you're linked, shows "Loading the schedule…" while it starts, and downloads the roster files together (during sign-in for returning users). Staff-list cells are standardized to +1XXXXXXXXXX (`normCell`) on save and import and when read.

### Installable app (PWA)
Only on the self-hosted server (`server.py`); the claude.ai links run inside claude.ai's viewer and can't install as an app.

- **Manifest** (`manifest.webmanifest`): name "SFFD Tour Schedule", short name "Tours", start page `/`, standalone display, theme color from the app's red.
- **Icons:** 192 px and 512 px (plus a maskable version) and an Apple touch icon. Use a department-approved icon if one is provided, else a simple placeholder mark.
- **Service worker:** caches the app's own files and the roster so it opens fast and still shows the schedule on a weak signal. Sign-in, records (leave, covers, tour changes) and contact info always come live from the server, never from the cache. A new version takes over on the next open.
- **Server:** serve the manifest, icons and service worker to everyone (signed in or not) so phones can install it; HTTPS is already required.
- **Check before launch:** "Add to Home Screen" on iPhone (Safari) and Android (Chrome) opens full-screen with the bottom tab bar clear of the home indicator; sign-in still works from the installed app.

### Shift-trade alerts (app, text and email)
**Built on Firebase (Oct 2026):** functions `notify` (the page asks after each post, widen, answer, pick or cancel; nothing is sent twice), `alertAction` (one-tap links: a confirm button, then it acts once), `smsReply` (Twilio webhook, signature checked) and `dailySummary` (run each morning by `.github/workflows/daily-alerts.yml`). App push (FCM, `firebase-messaging-sw.js`), email (Gmail app password over SMTP) and texts (Twilio REST) each switch on when their settings are added (FIREBASE_SETUP.md, step 12). Picks from an alert or a text use the same pick logic as the page (`TourMath.pickLegs`). Texts wait on Twilio's A2P 10DLC approval. App notifications open the app on the Trades tab; they don't carry answer buttons.

The Trades tab already stores each member's opt-in: three switches, "Notify me by text / in the app / by email", shown as "available at launch". With the server:

- **App (push):** Firebase Cloud Messaging, free. The installed app (PWA) asks for notification permission and saves its FCM token on the member's account; a Cloud Function sends the push. On iPhone, notifications only work after the app is added to the Home Screen (Apple's rule for web apps).
- **Text (SMS):** the department's **Twilio** account, sent from a Cloud Function (or `server.py`). Google has no SMS-sending API (Google Voice has none, Firebase only texts sign-in codes), and carrier email-to-text gateways are unreliable (AT&T's is shut down), so texts need Twilio.
  - **Start early:** US texts from an app need **A2P 10DLC** registration in Twilio (brand plus campaign). It takes days to a couple of weeks, with a small monthly fee plus a fraction of a cent per text.
  - **Not in the first launch.** Launch goes out with app notifications, email and texts sent from the poster's own phone. The "Notify me by text" switch stays "coming soon" until the Twilio campaign is approved.
  - **Text opt-in page (needed before the Twilio registration is submitted):**
    - A phone number field.
    - An **unchecked** checkbox, separate from signing up and from accepting any terms, with this text exactly:
      > ☐ I agree to receive text messages from SFFD Tour Calendar (Sequent Systems LLC) about shift trade offers sent to me and responses to my trade posts. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. See our [Terms of Service] and [Privacy Policy].
    - A clear submit button.
    - The consent is saved on the account with the time, the number and the wording version; turning it off clears it.
    - Public **Terms of Service** and **Privacy Policy** pages, open without signing in (Twilio's reviewers visit them): Sequent Systems LLC, what is sent and why, numbers never shared or sold, HELP and STOP.
    - `smsReply` answers HELP with a help line and STOP with an opt-out confirmation, and turns the member's text switch off.
    - The page's URL and a screenshot go into the Twilio campaign form.
  - **Sender name:** the brand registered with Twilio is Sequent Systems LLC. Using "SFFD" in the sender name may need the department's written OK; carriers can reject a campaign that uses another organization's name.
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

### Invites from trades
**Built now** (shared page and server): Invite, Invite all, Copy the text and Add their answer, with the page link in the text.
**Built on Firebase (Oct 2026):** a personal link per person (`<app>/?t=<code>`, functions `createInvite`, `inviteInfo`, `answerFromInvite`, `redeemInvite`), Messages addressed to their staff-list cell when one is on file (audited), **Group text** (all their cells, the general link), answering from the link before signing up, and Employee ID confirmation that links and approves the account. A pick on an unconfirmed link answer waits as **Picked** until they confirm. Still to come: the 48-hour lapse of an unconfirmed pick (needs a scheduled function), and the trade-less **Invite someone** join link.

A trade can go to someone who isn't on the tool yet. That's the best way for it to spread: the invite brings something they want, from someone they know. There are two kinds of "not on yet":

- **On the roster but not signed in:** on the vacancy list (or already added), so the tool knows their seat, tour and Employee ID. The trade invite below is for them.
- **Not in the tool at all:** new hires, detailed or relief staff, anyone never added. The tool has no seat or tour for them, so it can't offer them a trade yet; **Invite someone** (further down) gets them in first.

#### People on the roster who haven't signed in
- **Not on yet:** in the Trade wizard's Who list and in My trades, recipients without a linked account are marked "not on yet", with a count ("4 of 9 aren't on yet").
- **Invite them:** a button next to each name opens the poster's Messages app (an `sms:` link, or the share sheet) with the text filled in by the tool, e.g. "Goforth (FF/PM, E05) wants to trade Christmas, Fri Dec 25, 24 hrs at E05. You're off that day. Interested? Tap to see it and answer: <host>/t/<code>".
  - **Filled in:** who's asking (rank, station), the day, date and where, "you're off that day" (plus "you work the day before/after" when true), the poster's note, and the person's own link. The recipient's number is filled in when it's in the poster's Contacts. The poster can edit the text, then taps Send.
  - **One text per person:** each link is made for one person, so it proves who's answering.
  - **Invite all** ("Invite 4 not on yet") steps through them: Messages opens for the first with everything filled in; tap Send, come back, and the next one opens, with a count (2 of 4) and Skip. Phones don't let a web app send texts on its own, so each still needs one tap on Send.
  - **The link** shows the trade and lets them answer straight away (see Answering without an account), then sign up with Google and their Employee ID when the trade is picked.
  - **The text comes from the poster's phone, not the department's Twilio number.** We have no numbers for people who haven't signed up, US texting rules (TCPA, 10DLC) require prior consent, and a colleague's text gets opened. No texting cost either.
- **The link (`/t/<code>`):** a random code for one recipient, tied to the trade, the recipient and the inviter. It expires when the trade's day passes or after 14 days, and works once.
  - **Before sign-in it shows only** "A Lieutenant wants to trade a 24-hr shift on Sat Oct 17", with no names, and **Sign in with Google to see it**.
  - **After Google sign-in**, the claim screen is filled in for the person it was meant for ("Are you Alvarenga,G, Capt E32?") and asks for their Employee ID.
  - **ID matches the roster:** the account is linked and approved at once, and they land on the trade ready to respond. The Admin page shows "Joined by invite from Lester · date" with Undo (unlink and disable).
  - **No match:** the normal claim, waiting for an admin.
- **Limits:** only people the poster actually sent the trade to can be invited; up to 20 invites per poster a day; nothing about other people shows before sign-in.

#### Answering without an account
People who haven't signed up can still answer, two ways. The department number never texts them (no numbers, consent rules, and a "yes" from an unknown number can't be tied to a person).

- **Add their answer (the poster records it).** The invite text went from the poster's phone, so replies come back to the poster ("I'm in, pay me back later"). On their open trade the poster taps **Add their answer**:
  - picks the person from those who could take that day (same rank group, off, no status), members or not;
  - enters the terms: a swap day (checked as usual) or pay back later, plus a note such as "replied by text";
  - the answer shows as "Hardy · told you by text".
  - **Pick** sets the trade as usual (cover and TR), so the schedule shows it. A member who's named gets the usual "your response was picked" alert with **Not me** to dispute it. The trade's record shows who entered the answer, and admins can see and cancel it, as with any trade agreed by text today.
- **Answer from the link (no account yet).** The trade invite page (`/t/<code>`, tied to one person) has **I'm interested · pay back later** and **Suggest a swap day** (only their own work days that the poster is off) before any sign-in.
  - The answer is saved as **not verified**, and the poster can pick it. The trade then waits as **Picked · waiting for them to sign in**.
  - When they sign in with Google and their Employee ID matches, the trade is set and both are told.
  - If they haven't verified by 48 hours before the shift, or 24 hours after the pick (whichever comes first), the pick lapses and the poster is told.
  - Verifying only at the pick keeps answering easy while stopping a forwarded link from committing someone else to a shift.

#### People not in the tool yet
- **Invite someone to the schedule:** a button on the Trades tab (and in the More menu) opens the phone's share sheet, so the member picks from their own Contacts, with a ready text: "I'm using the SFFD tour schedule to trade shifts. Join here: <host>/join/<code>".
- **Typing a number** instead only opens the member's Messages app with that number and the text filled in (an `sms:` link). **The number is never saved:** the tool doesn't keep coworkers' phone numbers they didn't give it, and the text still comes from a colleague.
- **The join link** is a general invite (no trade), tied to the inviter, single use, expires in 14 days; up to 10 a day per member.
- **Signing up:** Google sign-in, then the existing **I'm not on the list** form (name, rank, apparatus, tour, Employee ID). The request shows on the Admin page as "Invited by Lester"; an admin approves it with **Approve and add to roster**, which adds them with their apparatus and tour. No automatic approval here, since there's no roster entry to check the ID against.
- **Then they're in like anyone else:** eligible for trades by rank group and tour, on boards and in the Trade wizard's Who list. The Who list ends with "Can't find them? **Invite someone**", which opens the same share.
- **Without an invite** (word of mouth, the QR poster), the claim screen tries the roster first (Employee ID match) and falls back to "I'm not on the list".

#### Also
- **Also spreads it:** every alert, email and daily board summary links back; a QR-code poster for station kitchens opens the same sign-up and claim (Employee ID step, no trade); station champions; a "who's on" count per battalion for admins.

### Calendar sync (iCal / Google Calendar)
- **Subscribe link:** each signed-in person gets a private calendar feed (`…/cal/<secret>.ics`) of their own schedule, built from the same logic as their person page (`TourMath.dayFor`). Add it in Google Calendar (Other calendars → From URL), Apple Calendar / iPhone (Add subscription) or Outlook.
- **On the feed:** one event per work day titled with the company and tour (e.g. "E21 · Tour 15"), acting or covering noted in the description, leave days (VA / S / D) marked, holidays named on the day; about 12 months ahead and 1 month back. All-day events by default, or a set shift start (e.g. 08:00 for 24 hours) once confirmed.
- **Stays current:** tour changes, covers and leave appear after the calendar app refreshes (Google refreshes subscriptions every several hours; not in our control).
- **Privacy:** the secret in the URL is the only key, so My page gets **Reset link** to revoke it. The feed holds only that person's own schedule, with no contact info and no other people.
- **Where it runs:** a small route in `server.py`, or an HTTPS Cloud Function on Firebase (see `FIREBASE_PLAN.md`).
- **Optional:** a **Download .ics** button on a person's page for a one-time import (no auto-updates); this could also work on the claude.ai page.
- **Not planned:** two-way Google Calendar sync. It would need people to grant Calendar access, and a subscription covers the need.

### Invite texts from admins: sign up, claim, verify
Builds on the invites above; this one comes from an admin, not a trade.
- **Who:** an admin picks everyone, a battalion, or only people not yet verified, and sends a text to the staff-list cell number on file (admin-only contacts).
- **Text:** "SFFD Tour Schedule: confirm your info and get trade alerts → <link>". The link carries a one-time code tied to the person's seat (expires after 14 days; one active invite per person).
- **Opening it:** sign in (Google, email link or phone code), then the claim is filled in with their seat; they confirm station and tour and land on **Verify my info**.
- **Safety:** only admins send; STOP is honoured (Twilio opt-out list); a seat already claimed and verified by someone else goes to an admin instead.

### Contact list download (opt-in)
A member can download an address book of coworkers who agreed to share their number.
- **Who's in it:** only members who turned on **Share my cell number with other members** on My page (off by default). Each person sets their own; an admin can turn it off for someone. Cell numbers from the staff list stay admin-only until that person opts in.
- **What's in it:** name, Employee ID, rank, station and tour, and cell number. Choose my battalion, my rank group, or everyone.
- **Who can download:** approved members who share their own number ("share to see"); admins can download everyone who opted in.
- **Formats:** a contacts file (`.vcf`) that imports into iPhone or Android contacts in one tap, and a CSV for spreadsheets.
- **Safety:** each download is dated and logged (who, when, which group); turning sharing off drops a person from the next download; the file is built on request and never stored; the page says the list is for department use only.
- **Not on the shared claude.ai page**, where cell numbers stay admin-only.

### Choose my tabs (simpler phone view)
Most people use the tool on a phone, where a full tab bar is a lot. Each person picks what they see.
- **My page → Tabs and links:** switches for Schedule, Projection, Staffing, Trades, By rank and 6 of 9. Members start with **Schedule** and **Trades** on and the rest off, and can turn any back on. The bottom bar shows only what's on; **More** keeps the rest one tap away, so nothing is lost.
- **Home tab:** the one they pick opens first (default Schedule, on their own card).
- **By role, whatever the settings:** members never see editing links: "Not on the list? Add a person", the edit forms, Corrections, the admin employee card, Open seats, 2027 awards or Admin. Editors and admins see them and can hide them too.
- **Follows the account:** settings sync across devices once signed in; before sign-in the choice is remembered on that device.
- **Admin default:** an admin sets the starting tab set for new members (e.g. a "simple" preset of Schedule and Trades).

## Later
- **Paste import for assignment-change notices:** paste the notice table, review each row (matched person, seat, dates), then apply; writes the move log and the cover or move together.
- **Group text option for trade invites,** if one text per person proves too slow: the poster chooses **Individual texts** (default, a personal link each) or **One group text** with one shared trade link. Whoever opens it picks their own name from the people it was sent to and answers; the answer stays unverified until they sign in with Google and a matching Employee ID, which must happen before a pick sets the trade. Easier to send, but the link is easier to forward and everyone in the group sees the other names.
- **By rank on phones:** pick a rank and company and show one or two weeks at a time (swipe or ‹ › to move) instead of the full 31-day month grid; keep the month grid on desktop.
- Daily overtime entry (voluntary, mandatory, advance hire) and upload of each day's Balance report to reconcile automatically.
- Additional status codes (light duty, injury) if needed.
- **Overtime hours and WDO lists (requested by members, low priority):**
  - **OT hours:** shown only on the member's own page ("OT hours: 120 · as of <date>"); private to the member and admins (`otHours/{key}`: owner or admin). Source: fir-db1 page 1021:29 (Employee ID, name, OT hours). An admin refreshes it every two weeks: paste a pull script in a signed-in fir-db1 tab (like `cleanup/fir-pull-*.js`), it downloads a CSV, upload it in the back office (Admin → Imports).
  - **WDO lists:** an admin saves the day's "WDO Hit List" and "Mandatory WDO List" PDFs from the FIR-FireBulletin SharePoint and uploads them; the back office reads them in the browser (pdf.js) into `wdoLists/{date}` (order, name, Employee ID). Each member sees "WDO list: #14 of 80 · Mandatory list: #6" on their page, and gets an app notification when their place changes or they reach a top-N they choose (the existing `notify` function and app-alert opt-in). The lists are already posted to the whole department, so members can see them.
  - **Why not a scheduled job pulling with the admin's account:** fir-db1 is on the city's internal network (`.ad.sfgov.org`, VPN only), which Firebase can't reach. SharePoint needs a city Microsoft login; storing a personal password or session on a server breaks city IT policy and stops working at the next password or MFA change. Never store one.
  - **Automating, in order:**
    1. **Stale reminder (now):** when an admin opens the back office and the lists are older than today, it shows "WDO lists last updated 2 days ago: Update" with a one-tap upload.
    2. **Power Automate (needs IT's OK):** a cloud flow on the admin's city account, "When a file is created or modified" in that library, filtered to the two PDFs. It either posts the file to a Firebase function URL with a shared secret (HTTP is a Premium connector: paid license), or emails it to an inbox the app reads (Outlook is standard; a scheduled function reads the inbox). It runs in Microsoft's cloud without the admin signed in; signing in every few days keeps the connection alive (it lapses after about 90 days unused). City data-loss-prevention policies may block HTTP or outside email, and it moves department documents to an outside service.
    3. **Microsoft Graph app (needs IT admin consent):** an app registered in the city tenant with read-only access to that one library (Sites.Selected), read by a daily scheduled function. Never store a member's or admin's own refresh token on the server instead: that is a stored credential.
    4. **fir-db1 OT hours:** cloud flows can't reach it. Only Power Automate Desktop on a city PC, signed in on the network, could read the page and send the numbers, with IT's approval. Otherwise the two-weekly paste script stays.
    5. **Reading the PDFs:** a PDF text reader is enough if they are text (order, name, Employee ID). Use the Claude API only if they are scans, and only with approval, since that sends city data to another outside service.

- **Competitive analysis (own non-code chat, low priority):** a claude.ai project with web search on the main competitor and others (features, pricing, who buys); then a separate chat builds the product website (what it is and does) from the findings.

## Shipped
- Add to Home Screen banner (Oct 2026): first-time visitors to the employee app on a phone see how to add it (iPhone Safari: Share → Add to Home Screen; other iPhone browsers: open in Safari first; Android: Install, or ⋮ → Add to Home screen). Got it hides it for good on that phone; it never shows once opened from the home screen.
- Google first, then the cell (Oct 2026): the first sign-in is Google; Add my cell on My page or Verify with your cell on the claim screen; then either opens the same account.
- Feedback button (Oct 2026): members send problems, ideas and questions about the app; admins answer, close and copy them from the Feedback view.
- **Academy class** on the Employee card (identity section) and under **Personal details** on a person's page (admins). Kept in the private profile with the birth and hire dates; filled from the PX narrative rating report of 09/02/2026 (classes 129th–137th).
- Move log: every assignment-change notice row is kept per person (from/to seat, Last Reg, First Reg, ranks, source) and shown in a closed **Moves** fold on their page.
- **Employee cards** (admins only; header link or More menu, and **Employee card** on a person's page): find anyone and edit their whole record in one place: name, rank and Employee ID (roster seats through `rosterOverrides`, added people on their record), own seat and moves, current cover and its type, leave, tour changes, the staff-list cell number, the "This is me" claim (remove, with Undo), their corrections (apply, dismiss, reopen, delete), and a history of every record touching them with Edit and Delete. Members and viewers never see it. The screen opens on a roster: rank tiles with headcounts that filter a sortable, paged table with a column chooser and a status quick edit. **Check with fir-db1**: by rank level, the people the tool has position questions about, a console script that pulls their fir-db1 employee time pages, and a day-by-day comparison with the tool, for one date or a From–To range (for example 12/26 to 1/27, which spans the January moves).
- Corrections: **Something wrong?** on every person page and **Verify my info** after "This is me" (also on your own page). Members send fixes (seat, leave / WE, covering / acting / shadowing, tour, Employee ID, own cell number, other); a "This is me" station or tour that differs from the roster sends one automatically. Admins see them under **Corrections** (count on the header link and menu); **Apply** opens the person's page with the edit form filled in and marks it applied on save; a cell number goes straight into the admin-only contacts.
- Google sign-in, My page, Admin; claim-and-approve, and requests from people not on the vacancy list.
- Tour changes, VA/S/D leave, cover assignments, added people.
- Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
- Dashboard grouping by division and battalion, from the Daily Balance Report (`organization.js`).
- Required staffing from the Balance report (313), Regular / Covering / Open split, "working but not in the tool" check, Open seats worklist for long-term covers.
- Employee IDs: searchable, shown on person pages, duplicate names flagged.
- Phone layout: bottom tabs (Find, Today, Staffing, More), menu sheet, Today grouped by rank, Staffing drill-down by battalion, on/off status in search.
- Tabs named **Schedule** (one person), **Projection** (everyone on a date) and **Staffing** on phone and desktop alike.
- View-only snapshot link with records baked in (no sign-in needed).
- Holidays on the calendars (12 city holidays plus Halloween and Mother's Day as observances), worked out for any year.
- Shift trades: "this is me" claim, Trade wizard (payback, recipients by division and battalion, board), Trades tab (board, sent to me, my trades, owed shifts), TR (traded off) on the schedule. App, text and email alerts come with the server launch.
