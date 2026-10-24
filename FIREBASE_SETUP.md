# Firebase setup, step by step

This puts the tour schedule on two web addresses in one Firebase project, where people sign in with Google:

- `https://<project-id>.web.app`: the **employee app**, for everyone;
- `https://<project-id>-admin.web.app`: the **back office**, for admins and editors.

Setup is safe to do any time: nothing replaces the claude.ai page until cut-over day (`CUTOVER.md`). It takes about 45 minutes. You do every step yourself in your own Google account: you keep ownership, and nobody else needs your password.

**What you need:**
- your Google account;
- a credit or debit card (see "Cost" below);
- access to the `down-low/projects` GitHub repository's **Settings**.

**Cost.** The plan has to be **Blaze** (pay as you go) because sign-up and approval use Cloud Functions. At this size it costs $0–5 a month (`FIREBASE_PLAN.md`, Cost). Step 2 sets a **$10 budget alert**, so you get an email if it ever goes higher.

**Decisions already made:**
- the project is in your own account;
- any Google account may sign in, but sees nothing until an admin approves it;
- the free `.web.app` addresses;
- a placeholder icon.

---

## 1. Create the project

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Get started by setting up a Firebase project**).
3. Name it, for example `SFFD Tours`.
   - Under the name, Firebase shows the **project ID** (for example `sffd-tours`). Click the pencil to change it if you like.
   - The project ID becomes the address, `https://sffd-tours.web.app`. **Write it down.**
4. Accept the terms. If asked about **Gemini in Firebase**, you can leave it off. Click **Continue**.
5. When asked about **Google Analytics**, turn it **off**. Click **Create project**, wait, then click **Continue**.

## 2. Switch to the Blaze plan and set a budget alert

1. Bottom left, next to **Spark**, click **Upgrade**.
2. Pick **Blaze**. Create a Cloud Billing account and enter your card (or choose an existing one).
3. When it offers a **budget**, enter **10** (US dollars) and continue.
   - If it didn't offer one: go to **https://console.cloud.google.com/billing**, pick your billing account, open **Budgets & alerts**, then **Create budget**.
   - Scope it to this project, set the amount to **$10** with alerts at 50%, 90% and 100%, and click **Finish**.

## 3. Add the web app (this creates the address)

1. On the **Project Overview** page, click the **`</>`** (Web) icon. It may sit under **+ Add app**.
2. Nickname: `Tour schedule`. **Check "Also set up Firebase Hosting for this app"**, then click **Register app**.
3. Skip the code it shows. Click **Next**, **Next**, then **Continue to console**. You don't need to copy anything.

## 4. Turn on Google sign-in

1. In the left menu, open **Build → Authentication**, then **Get started**.
2. On the **Sign-in method** tab, click **Google**, switch it to **Enable**, pick your email as the **support email**, and click **Save**.
3. On the **Settings** tab, open **Authorized domains**. `<project-id>.web.app` and `<project-id>.firebaseapp.com` are already there. Click **Add domain**, enter `<project-id>-admin.web.app` and click **Add**. Without it, Google sign-in on the back office is refused.

## 5. Turn on Firestore (the database)

1. Open **Build → Firestore Database**, then **Create database**.
2. If asked for an edition, pick **Standard**.
3. Location: **nam5 (United States)**. This can't be changed later.
4. Pick **Start in production mode** and click **Create**. The repository's rules replace the default ones on the first deploy.

## 6. Turn on Storage (for the roster files and PDFs)

1. Open **Build → Storage**, then **Get started**.
2. Pick **Start in production mode**.
3. For location, choose the same US location. Click **Done**.

## 7. Create the deploy key (a "service account")

GitHub uses this key to publish the app every time `main` changes. It can change everything in the project, so it goes only into GitHub's encrypted secrets, never into chat, email or the repository.

1. Go to **https://console.cloud.google.com/iam-admin/serviceaccounts**. At the top, make sure your Firebase project is selected.
2. Click **+ Create service account**. Name: `github-deploy`. Click **Create and continue**.
3. Under **Grant this service account access**, add these roles one at a time. Type each name in the **Role** box; use **+ Add another role** for the next.
   - Firebase Admin
   - Cloud Functions Admin
   - Cloud Run Admin
   - Service Account User
   - Service Usage Admin
   - Artifact Registry Administrator
   - Cloud Build Editor
   - Storage Admin
4. Click **Continue**, then **Done**.
5. Click the new `github-deploy` account. Open the **Keys** tab, then **Add key → Create new key → JSON → Create**. A `.json` file downloads.
   - If Google says key creation is disabled by an organization policy, the account belongs to an organization. Tell me and we'll use another route.

## 8. Give GitHub the key and the settings

On GitHub, open the repository **down-low/projects**, then **Settings → Secrets and variables → Actions**.

1. **Secrets** tab → **New repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT`.
   - Value: open the downloaded `.json` file in a text editor (Notepad or TextEdit). Select all, copy, and paste it here. Click **Add secret**.
   - **Then delete the downloaded file**, and empty the trash.
2. **Variables** tab → **New repository variable**, once for each:
   - `FIREBASE_PROJECT_ID`: your project ID from step 1 (for example `sffd-tours`).
   - `ADMIN_EMAILS`: the Google addresses of the first admins, separated by commas (for example `you@gmail.com`). These people are active admins the moment they sign in.
   - Leave `ALLOWED_DOMAINS` out. That means any Google account can sign in and wait for approval. To limit sign-in to one domain later, add it with a value such as `sfgov.org`.
   - Leave `ADMIN_SITE` out too. The first deploy creates the back office site as `<project-id>-admin`. Site names are shared across all of Firebase, so if that name is taken the deploy says so: add `ADMIN_SITE` with another name (for example `sffd-tours-office`), and add that address to Authorized domains as in step 4.

## 9. Publish

1. On GitHub, open the **Actions** tab, then **Firebase** on the left.
2. Click **Run workflow**, keep branch **main**, and click **Run workflow**.
3. Wait for both jobs to turn green (5–10 minutes the first time). After this, every merge to `main` publishes on its own.
   - If a step turns red, open it and copy the last 20 or so lines of the error into a chat. They don't contain secrets.

## 10. Sign in, and load a test copy

1. Open the back office at `https://<project-id>-admin.web.app` and click **Sign in with Google** with an `ADMIN_EMAILS` address. You're in as an admin.
   - The yellow **Test copy** banner is expected. It stays on until cut-over day.
2. Optional, for the test beta: load a test copy of today's records.
   - **Save the backup.** On the claude.ai page (https://claude.ai/artifact/TS7W51mXHxgy7p2uvReSgC), open **Employee cards** (header link, or **More** on a phone). Click **Download backup** and accept the save. The file holds the cell numbers, so keep it on your own computer.
   - **Load it.** In the back office, open **Admin** and scroll to **Cut-over**. Choose the file and click **Import as test copy**. The table shows each collection's count in the file and on the site; they should match.
   - **Delete the backup file**, and empty the trash.
3. Open the employee app at `https://<project-id>.web.app` on your phone and sign in. As an admin you get the member view, plus a **Back office** link.

Keep making official changes on the claude.ai page until cut-over: changes made here are replaced that day.

Next: test with a few people using [`BETA.md`](BETA.md) (optional), then switch over with [`CUTOVER.md`](CUTOVER.md).

## 11. Sign-in with a cell number

So people can also sign in with their cell and a texted code, after their first Google sign-in:

1. Firebase console → **Authentication** → **Sign-in method** → **Add new provider** → **Phone** → **Enable** → **Save**.
2. **Limit the codes to US numbers.** Authentication → **Settings** → **SMS region policy** → **Allow** → **United States** → **Save**. This blocks code texts to other countries, the usual source of SMS fraud charges.
3. **A free test number (optional).** Authentication → **Sign-in method** → **Phone** → **Phone numbers for testing**: add a made-up number such as `+1 650 555 0100` with code `123456`. Signing in with it sends no text and costs nothing; it isn't on the staff list, so it lands on the claim screen.
4. **Check the domains.** Authentication → **Settings** → **Authorized domains** must list `<project-id>.web.app` (there by default) and `<project-id>-admin.web.app` (step 4). Phone sign-in uses the same list.
5. **Google first.** People sign in with Google the first time. Then they add their cell (My page → Add my cell, or Verify with your cell on the claim screen; one texted code), and from then on either Google or the cell opens the same account. Members linked to a seat whose cell is on the staff list get it automatically at their next Google sign-in; editors and admins add theirs on My page. A cell that isn't on any account yet is refused with "Sign in with Google the first time."
6. Nothing else: the page's invisible "I'm not a robot" check is built in. Each real code text costs a few cents and counts toward the budget alert from step 2.
7. **To try it with your own cell:** the staff-list cells reach Firebase with the page backup, so first load it in the back office under **Admin → Cut-over** as a **Test copy** (adds, doesn't replace). Then, in a private window, open the employee app, enter your cell and type the code. If your cell is on the staff list, you land on your own schedule; if not, on the claim screen.

## 12. Trade alerts (app notifications, email, texts)

Each kind of alert stays off until its settings are added, so do these in any order. Add them on GitHub under **Settings → Secrets and variables → Actions**, then publish again (**Actions → Firebase → Run workflow**, or merge any change).

1. **The link key** (needed for the one-tap buttons in emails and for the daily summary). **Secrets** tab → **New repository secret**: name `ALERT_KEY`, value any long random text (for example, mash the keyboard for 40 characters). You never type it anywhere else.
2. **App notifications.** Firebase console → ⚙ **Project settings** → **Cloud Messaging** tab → **Web configuration** → **Web Push certificates** → **Generate key pair**. Copy the long key it shows. **Variables** tab → **New repository variable**: name `FIREBASE_VAPID_KEY`, value the key. (It's a public key, so a variable is fine.)
   - On iPhone, notifications only work after the app is added to the Home Screen (Safari → Share → **Add to Home Screen**) and opened from there. Android and computers work in the browser.
   - **The app's ID** (needed too): Firebase console → ⚙ **Project settings** → **General** → **Your apps**. If no web app is listed, click **Add app** → **`</>`**, name it `Tour schedule`, **Register app**. Copy its **App ID** (it looks like `1:1234567890:web:abc123…`). **Variables** tab → **New repository variable**: name `FIREBASE_APP_ID`, value the App ID (also public). Without it, turning on app notifications says "Missing App configuration value: appId".
   - To check it: in the app, **Trades → Alerts**, tick **Notify me in the app**, allow notifications, then tap **Send me a test notification**. It should arrive within a few seconds.
   - The same key also sends admin announcements (back office → **Admin** → **Send announcement**) to people who turned app notifications on; everyone else sees them at the top of the app.
3. **Email**, sent from a department Gmail account:
   - Sign in to that Gmail account, open **https://myaccount.google.com/security**, and turn on **2-Step Verification** if it's off.
   - Open **https://myaccount.google.com/apppasswords**, create an app password named `Tour schedule`, and copy the 16-letter password.
   - **Secrets** tab: `GMAIL_USER` = the Gmail address; `GMAIL_APP_PASSWORD` = the app password.
4. **Texts** (after Twilio approves the number for A2P 10DLC):
   - From the Twilio console: **Secrets** tab, `TWILIO_SID` = Account SID, `TWILIO_TOKEN` = Auth Token, `TWILIO_FROM` = the number, written like `+14155550123`.
   - Publish, then in Twilio open the number → **Messaging configuration** → **A message comes in** → **Webhook**, URL `https://us-central1-<project-id>.cloudfunctions.net/smsReply`, method **HTTP POST**. Save. That lets people answer by text ("1", "2 11/20", "PICK").
5. **The daily summary** (for people who choose "Daily summary" for board posts) runs every morning from **Actions → Daily trade alerts** once `ALERT_KEY` is set. To try it now: open that workflow and click **Run workflow**.

Texts go to the cell on each person's **My page**; email goes to their contact email there, or their sign-in address.

## 13. Keep Google sign-in on your own address (recommended for phones)
By default the Google sign-in window opens on `<project-id>.firebaseapp.com` and then returns to the site. Some phone browsers (Safari, and apps' built-in browsers) block that hand-off, and people get stuck on the firebaseapp.com page. To keep sign-in on each site's own address:
1. **Google Cloud console** (console.cloud.google.com, same project) → **APIs & Services** → **Credentials** → under OAuth 2.0 Client IDs, open **Web client (auto created by Google Service)**.
2. Under **Authorized redirect URIs**, add both, then **Save**:
   - `https://<project-id>.web.app/__/auth/handler`
   - `https://<project-id>-admin.web.app/__/auth/handler`
3. **GitHub** → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**: name `FIREBASE_OWN_AUTH_DOMAIN`, value `1`.
4. **Actions** → **Firebase** → **Run workflow** (or merge anything to `main`). Then sign out and back in on a phone: the Google window now shows the site's own address.

To undo it, delete the variable and run the workflow again. Don't set the variable before step 2, or Google sign-in shows "redirect_uri_mismatch".

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Sign-in popup closes and nothing happens | Allow pop-ups for the site, or try again; on some phones it switches to a full-page sign-in. |
| "This domain is not authorized" on the back office | Step 4: add `<project-id>-admin.web.app` to Authorized domains. |
| "Admins only" on the back office | That account isn't an admin or editor. Members use the employee app. |
| Deploy error "database '(default)' does not exist" | Step 5: create the Firestore database (Standard edition, ID `(default)`), then run the workflow again. |
| Deploy error "Cloud Billing API has not been used … or it is disabled" | Open the link in the error (or Google Cloud → APIs → **Cloud Billing API**), click **Enable**, wait 2 minutes, run the workflow again. |
| "Google sign-in could not be completed" right after signing in | The account step on the server failed. Firebase console → **Functions** → `syncMe` → **Logs**: send Claude the red lines. |
| "Waiting for approval" after signing in as an admin | The address isn't in `ADMIN_EMAILS` exactly as Google spells it. Fix the variable, run the workflow again, sign out and in. |
| The schedule is empty after sign-in | The deploy's "Roster files and PDFs to Storage" step didn't run. Check the Actions run. |
| "Cell-number sign-in isn't turned on yet" | Step 11.1: enable the Phone provider. |
| No code text arrives | Step 11.2: the region policy must allow United States. Check Authentication → **Usage** for the daily SMS limit. |
| "The page check failed" on Text me a code | The site isn't in Authorized domains (step 11.4), or a browser extension blocks reCAPTCHA. |
| An alert didn't arrive | Check the person's switches (Trades → Alerts) and My page (cell, email). Firebase console → **Functions** → `notify` → **Logs** shows "email:", "text:" or "push:" lines when sending failed. |
| Deploy error about Eventarc, Pub/Sub or Cloud Scheduler | Not expected (alerts don't use them); send Claude the red lines. |
| Charges | **https://console.cloud.google.com/billing** shows the spend; the budget alert emails you at $5, $9 and $10. |

Before cut-over you can **turn the sites off** at any point: Firebase console → **Hosting** → the `…` menu on a site → **Disable**. No data is deleted.
