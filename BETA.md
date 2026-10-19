# Optional test beta (on test data)

Before cut-over, a few testers can try the **employee app** (`https://<project-id>.web.app`) on a **test copy** of the records.

- Every screen shows a yellow **Test copy** banner. The claude.ai page stays the official schedule, and admins keep editing there.
- On cut-over day (`CUTOVER.md`) every test record is replaced by the real copy. Testers' accounts and approvals stay, so they don't sign up again.

Set up first with [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md), including step 10 (load a test copy).

## Pick the testers

Aim for about 5, in a mix:
- at least one officer and one firefighter;
- one person who mostly uses a phone;
- one editor, who also tries the back office;
- you, as admin.

## Invite them

1. Text or email each tester:

   > You're invited to test the new tour schedule: https://&lt;project-id&gt;.web.app
   > Sign in with any Google account, find your name on the roster and tap Send request. I'll approve you, usually the same day.
   > It's a test copy: the official schedule is still the claude.ai page, and anything you change here is wiped when we switch over. If something looks wrong or confusing, tell me (see below).

2. When they've signed in, open the **back office** (`https://<project-id>-admin.web.app`) → **Admin**. Under **Waiting for approval**, check the name and position they picked, then click **Approve**. For "I'm not on the list" requests, use **Approve and add to roster**.
3. In the **Users** table, set the editor tester's **Access** to **Editor**.
4. Testers who already had the page open get access as soon as they're approved; the page reloads by itself.

## What testers should try (employee app)

On their phone and, if they can, on a computer:

- [ ] **Sign in** with Google, and sign out and back in.
- [ ] **Schedule**: find yourself by name, Employee ID and company (e.g. `E10`). Check your tour and your next shifts.
- [ ] **Projection**: pick a date and check the people on duty at your station.
- [ ] **Staffing**: open your battalion. Do the numbers look right for today?
- [ ] **My page**: add a contact email and phone, switch **Share my contact info** on, then off.
- [ ] **Trades** (two testers together):
  - one posts a shift; the other answers it;
  - the poster picks the answer, and both check the schedule shows the trade;
  - then cancel it.
- [ ] **Something wrong?** on your own page: send one correction, marked "test".
- [ ] **Documents** menu: open a watch calendar PDF.
- [ ] **Install** (phone): Share → **Add to Home Screen** (iPhone), or the browser menu → **Install app** (Android).

The editor tester, on the **back office**:

- [ ] Mark a test VA day on your own page, check Projection, then delete it.
- [ ] Open the employee app too: it shows the member view with a **Back office** link, and no edit forms.

And you, as admin, on the back office:

- [ ] Compare **Staffing** totals with the claude.ai page for the same date. They match if nothing changed since the test copy was loaded.
- [ ] Sign in to the back office with a member's account: it says **Admins only**.
- [ ] **Employee cards**: open a tester and check their cell shows for you. On the employee app it never shows, even for you.
- [ ] **Corrections**: apply or dismiss the testers' corrections.

## How testers report problems

Ask them to send you a text or email with:

1. **Where:** which screen, and phone or computer.
2. **What they did:** the taps, in order.
3. **What happened, and what they expected.**
4. **A screenshot** if they can.

Wrong *data* (a seat, tour, leave or ID) still goes to the claude.ai page, since that's the official copy until cut-over.

Collect the reports and paste them into a Claude session on this repository, with screenshots attached. Each fix goes through a pull request to `main`, which republishes both sites on its own.

## When the test is done

Go to [`CUTOVER.md`](CUTOVER.md). The test records are replaced there; nothing needs cleaning up first.
