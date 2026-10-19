# Firebase setup, step by step

This puts the tour schedule at a web address (`https://<project-id>.web.app`), where people sign in with Google. It takes about 45 minutes. You do every step yourself in your own Google account: you keep ownership, and nobody else needs your password.

**What you need:**
- your Google account;
- a credit or debit card (see "Cost" below);
- access to the `down-low/projects` GitHub repository's **Settings**.

**Cost.** The plan has to be **Blaze** (pay as you go) because sign-up and approval use Cloud Functions. At this size it costs $0–5 a month (`FIREBASE_PLAN.md`, Cost). Step 2 sets a **$10 budget alert**, so you get an email if it ever goes higher.

**Decisions already made:**
- the project is in your own account;
- any Google account may sign in, but sees nothing until an admin approves it;
- the free `.web.app` address;
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
3. Optional check: on the **Settings** tab, **Authorized domains** should already list `<project-id>.web.app` and `<project-id>.firebaseapp.com`.

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

## 9. Publish

1. On GitHub, open the **Actions** tab, then **Firebase** on the left.
2. Click **Run workflow**, keep branch **main**, and click **Run workflow**.
3. Wait for both jobs to turn green (5–10 minutes the first time). After this, every merge to `main` publishes on its own.
   - If a step turns red, open it and copy the last 20 or so lines of the error into a chat. They don't contain secrets.

## 10. Sign in and import the records

1. Open `https://<project-id>.web.app` and click **Sign in with Google** with an `ADMIN_EMAILS` address. You land in the app as an admin.
2. **Save the backup from the claude.ai page.**
   - Open the claude.ai page: https://claude.ai/artifact/TS7W51mXHxgy7p2uvReSgC.
   - Open **Employee cards** (header link, or **More** on a phone).
   - Click **Download backup** and accept the save.
   - The file holds the cell numbers, so keep it on your own computer only.
3. **Load it into the new app.**
   - In the new app, open **Admin** (header link, or **More**) and scroll to **Import backup**.
   - Choose the file and click **Import**. It shows a count per collection when it's done.
4. **Check it against the claude.ai page.** Open **Staffing** on both, on the same date (for example **10/15/2026**). The totals should match (263 on duty and 54 open as of the last check).
5. **Delete the backup file**, and empty the trash.

Next: invite the testers with [`BETA.md`](BETA.md).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Sign-in popup closes and nothing happens | Allow pop-ups for the site, or try again; on some phones it switches to a full-page sign-in. |
| "Waiting for approval" after signing in as an admin | The address isn't in `ADMIN_EMAILS` exactly as Google spells it. Fix the variable, run the workflow again, sign out and in. |
| The schedule is empty after sign-in | The deploy's "Roster files and PDFs to Storage" step didn't run. Check the Actions run. |
| Charges | **https://console.cloud.google.com/billing** shows the spend; the budget alert emails you at $5, $9 and $10. |

To **turn the beta off** at any point, open Firebase console → **Hosting** → the `…` menu on the site → **Disable**. No data is deleted.
