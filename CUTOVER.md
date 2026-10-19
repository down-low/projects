# Cut-over day: from the claude.ai page to Firebase

After this, **Firestore is the only live database**:
- admins and editors work on the **back office** (`https://<project-id>-admin.web.app`);
- everyone else uses the **employee app** (`https://<project-id>.web.app`);
- the claude.ai main page is frozen, read-only, and later retired.

The two can't be kept in sync, so the switch happens once, all together. Allow about 30 minutes.

**Before the day:**
- [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) is done, and the last deploy is green (GitHub → Actions).
- You can sign in to the back office as an admin.
- Optional: the test beta ([`BETA.md`](BETA.md)) is finished.

## Steps

1. **Announce a time.**
   - To admins and editors: "From <time> no changes on the claude.ai page; after <time> use <back office address>."
   - To everyone else: the employee app address. Send it after step 6.
2. **Freeze the claude.ai page.**
   - Tell Claude "cut-over: freeze the claude.ai page", in a session on this repository.
   - It republishes the page from `main` with `python3 tools/build_artifact.py --frozen https://<project-id>-admin.web.app` and the rules from `--capabilities --frozen`, where every write is owner-only.
   - Open the page: it shows **Moved … This copy is frozen**, and the edit and trade controls are gone.
3. **Download the backup.**
   - On the frozen page, click **Download backup** in the Moved banner and accept the save.
   - The file holds the cell numbers: keep it on your computer only.
4. **Replace everything.**
   - In the back office, open **Admin** → **Cut-over** and choose the file.
   - Click **Replace everything (cut-over)**, then **Confirm: replace everything**.
   - It removes the test records, loads the page's records with their ids, and keeps every account, approval and contact detail.
5. **Check.**
   - The counts table must show ✓ on every row ("Every count matches the file").
   - Then open **Staffing** on the frozen claude.ai page and on the back office for the same date: the totals must match.
   - If anything differs, stop here and send Claude the counts table (it shows numbers only).
6. **Go live.**
   - Under **Mode**, click **Set live**, then **Confirm: set live**.
   - The **Test copy** banner disappears on both sites.
7. **Share the addresses.**
   - Admins and editors: the back office.
   - Everyone else: the employee app (signing in with Google; you approve each new account under Admin).
8. **Delete the backup file**, and empty the trash.
9. **Retire the claude.ai page later.**
   - It stays up, frozen and read-only, as a reference for a few weeks.
   - When you're ready, delete it from claude.ai yourself, or ask Claude to. Claude never deletes it on its own.
   - The view-only snapshot (https://claude.ai/artifact/37DsLLYz74Kjysbd84cTXV) can stay as a demo.

## If something goes wrong

- **Before step 6, nothing is lost.** The claude.ai page still holds every record. Ask Claude to republish the normal (unfrozen) build, and editing resumes there. Fix the problem, then start again from step 2.
- **After step 6,** the back office is the schedule. Make any correction there, not on the claude.ai page.
