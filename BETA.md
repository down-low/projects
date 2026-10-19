# Beta test checklist

About 5 testers use the Firebase app (`https://<project-id>.web.app`) for one or two weeks, while the claude.ai page stays the official copy. Set up first with [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

## Pick the testers

Aim for a mix:
- at least one officer and one firefighter;
- one person who mostly uses a phone;
- one person you'll make an **Editor** (records leave and covers);
- you, as **Admin**.

## Invite them

1. Text or email each tester:

   > You're invited to test the new tour schedule: https://&lt;project-id&gt;.web.app
   > Sign in with any Google account, find your name on the roster and tap Send request. I'll approve you, usually the same day.
   > It's a test copy: the official schedule is still the claude.ai page. If something looks wrong or confusing, tell me (see below).

2. When they've signed in, open **Admin** in the app. Under **Waiting for approval**, check the name and position they picked, then click **Approve**. For "I'm not on the list" requests, use **Approve and add to roster**.
3. In the **Users** table, set the editor tester's **Access** to **Editor**.
4. Testers who already had the page open get access as soon as they're approved; the page reloads by itself.

## What testers should try

Ask each tester to do these on their phone and, if they can, on a computer:

- [ ] **Sign in** with Google, and sign out and back in.
- [ ] **Schedule**: find yourself by name, Employee ID and company (e.g. `E10`). Check your tour and your next shifts.
- [ ] **Projection**: pick a date and check the people on duty at your station.
- [ ] **Staffing**: open your battalion. Do the numbers look right for today?
- [ ] **My page**: add a contact email and phone, switch **Share my contact info** on, then off.
- [ ] **Trades** (two testers together):
  - one posts a shift; the other answers it;
  - the poster picks the answer, and both check the schedule shows the trade;
  - then cancel it.
- [ ] **Something wrong?** on your own page: send one correction (real or a test, marked "test").
- [ ] **Documents** menu: open a watch calendar PDF.
- [ ] **Editor tester only**: mark a test VA day on your own page, check Projection, then delete it.

And you, as admin:

- [ ] Compare **Staffing** totals with the claude.ai page for the same date.
- [ ] Check an approved tester **can't** see cell numbers (they see only shared contacts).
- [ ] **Employee cards**: open a tester, check their cell shows for you.
- [ ] **Corrections**: apply or dismiss the testers' corrections.

## How testers report problems

Ask them to send you a text or email with:

1. **Where:** which tab or screen, and phone or computer.
2. **What they did:** the taps, in order.
3. **What happened, and what they expected.**
4. **A screenshot** if they can.

Wrong *data* (a seat, tour, leave or ID) goes through **Something wrong?** in the app instead, so it lands in Corrections.

Collect the reports and paste them into a Claude session on this repository, with screenshots attached. Each fix goes through a pull request to `main`, which republishes the app on its own.

## Ending the beta

- **Go:** share the address with everyone, and keep the claude.ai links read-only for a short overlap (`FIREBASE_PLAN.md`, Launch steps).
- **Not yet:** Firebase console → Hosting → **Disable**. Nothing is deleted.
- Records changed during the beta stay in Firebase. They don't flow back to the claude.ai page, so record official changes on the claude.ai page until the switch.
