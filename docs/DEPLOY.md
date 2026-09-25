# Going live: Firebase + Hostinger

The portal has two halves, and both have to be set up:

| Half | What it is | Where it runs |
|---|---|---|
| **Website** | The `public/` folder: HTML, CSS, JavaScript, icons, `.htaccess` | Your Hostinger site |
| **Back end** | Accounts, the database (`firestore.rules`), Cloud Functions (`functions/`) | Your Firebase project |

The website is plain files, so **any Hostinger plan works**: no Node.js, PHP or
database is needed on Hostinger. Everything that must be secure (who can see
what, who has paid, payments, file storage) runs on Firebase.

Follow the steps in order the first time. After that, see
[Updating the site](#updating-the-site-later).

---

## What you need

- The GitHub pull requests merged into `main`, in order (#1, #2, #3 …).
- **Hostinger** hosting with your domain connected and SSL available.
- The **Firebase project** the website is already set up for
  (`duck-hse-portal`, in `public/js/firebase-config.js` and `.firebaserc`), on
  the **Blaze** (pay as you go) plan. Cloud Functions need Blaze; a small
  customer base normally stays inside its free allowance.
- A **Stripe** account for card payments ([PAYMENTS.md](PAYMENTS.md)).
- **Google Workspace** with a shared drive, for project files and backups
  ([DRIVE_FILES.md](DRIVE_FILES.md)). Optional: without it, everything else
  works and the Files panel says storage is not set up.
- A computer with **Node.js 22 or newer** (<https://nodejs.org>, the LTS
  version). Windows, macOS and Linux all work. The Cloud Functions run on
  Node.js 22 too (`firebase.json`).

**Never paste a secret key into a chat, an email, or any file in the
repository.** Secrets go only into Firebase's secret storage, with the commands
below, which ask for them.

---

## 1. Get the code and the tools (once)

```
npm install -g firebase-tools
firebase login
git clone https://github.com/gladiatorsking25-code/Duck-HSE-Portal.git
cd Duck-HSE-Portal
cd functions
npm install
cd ..
```

No git? On GitHub, click **Code → Download ZIP**, unzip it, and open a terminal
in that folder.

All commands below run in the `Duck-HSE-Portal` folder.

## 2. Firebase console settings (once)

In <https://console.firebase.google.com>, open the project:

1. **Upgrade to Blaze** (bottom left, "Spark" → Upgrade). Then set a spending
   alert: Google Cloud Console → **Billing → Budgets & alerts → Create budget**,
   for example 10 USD a month, with email alerts.
2. **Authentication → Sign-in method:** turn on **Email/Password**.
3. **Authentication → Settings → Authorized domains:** add your site's
   domain without `www.`, for example `hse.example.com`. The website sends
   anyone who opens the `www.` address to this one (`public/.htaccess`), so
   everyone signs in on the same address.
4. **Firestore Database:** it must exist (production mode). Its location cannot
   be changed later; see the note on data location in `public/privacy.html`,
   section 3a.
5. Optional: **Authentication → Templates** lets you change the sender name on
   the verification and password emails.

## 3. Stripe (once)

Follow [PAYMENTS.md](PAYMENTS.md), steps 1, 3 and 6, in **test mode** first:
create the product and monthly price, store the secret key with
`firebase functions:secrets:set STRIPE_SECRET_KEY`, and turn on the billing
portal. Set a placeholder webhook secret for now
(`firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`, type `later`); the
real one comes in step 6.

## 4. Function settings (once)

```
cp functions/.env.example functions/.env
```

(On Windows: `copy functions\.env.example functions\.env`.) Then edit
`functions/.env`:

| Setting | Value |
|---|---|
| `APP_ORIGIN` | Your site address without `www.`, e.g. `https://hse.example.com` (https, no trailing slash). It must be exactly the address the website sends everyone to (`public/.htaccess` sends `www.` visitors to the address without it). Stripe sends customers back here. |
| `STRIPE_PRICE_MONTHLY` | The Stripe price ID (`price_…`). |
| `STRIPE_PRICE_YEARLY` | Optional second price. |
| `STRIPE_AUTOMATIC_TAX` | `false` unless Stripe Tax is set up. |
| `DRIVE_ROOT_FOLDER_ID` | The shared drive for project files (step 5). Empty switches files off. |
| `DRIVE_PROJECT_QUOTA_MB` | File space per project, default `2048`. |
| `DRIVE_USER_QUOTA_MB` | File space one person can add across all projects, default `10240`. |
| `DRIVE_TRIAL_QUOTA_MB` | The same while a person is only on the free trial, default `200`. |
| `DRIVE_TOTAL_QUOTA_MB` | File space all projects together may use, default `102400` (100 GB). Keep it below the free storage in your Google Workspace. |
| `PLAY_PACKAGE_NAME`, `PLAY_PRODUCT_IDS` | Only for the Android app. The defaults (`Duck.HSE.Portal`, `pro_monthly`) match the app as shipped. |

`functions/.env` holds settings, not secrets, and git ignores it.

The website sells by card through Stripe. The Android app (optional, later)
sells through Google Play and has its own steps: `PLAY_STORE_LAUNCH.md` §2 to
§3a, and `SECURITY.md` §6 step 10, which Play renewals need.

## 5. Google Drive for project files (once, optional)

Follow [DRIVE_FILES.md](DRIVE_FILES.md): turn on the Drive API, add the
functions' account (`duck-hse-portal@appspot.gserviceaccount.com`) to your
shared drive as **Content manager**, and put the shared drive's ID in
`DRIVE_ROOT_FOLDER_ID`. No key file is needed. Do not create one.

## 6. Check, then deploy the back end

```
node tools/check-deploy.mjs
```

It reads your settings and lists anything missing or unsafe (✗ must be fixed,
! is worth a look). It changes nothing. When it says **Ready to deploy**:

```
firebase deploy --only firestore:rules,functions
```

The first time, the CLI may ask to turn on some Google APIs (Cloud Functions,
Cloud Build, Artifact Registry, Cloud Scheduler for the nightly backup,
Secret Manager). Answer yes.

When it finishes, it lists the functions' addresses. Copy the one ending in
`/stripeWebhook` and finish Stripe: [PAYMENTS.md](PAYMENTS.md), step 5 (add the
webhook, store its real signing secret), then deploy the functions again:

```
firebase deploy --only functions
```

## 7. Put the website on Hostinger

1. **SSL first.** hPanel → **Websites → Manage** your site → **Security → SSL**.
   Install the free SSL certificate and wait until it shows as active. The site
   forces HTTPS, so it will not open until SSL works.
2. **Make the upload file:**

   ```
   node tools/package-site.mjs
   ```

   This checks the website folder again (no keys, real Firebase settings,
   versions match) and makes `dist/duck-hse-portal-site-v<version>.zip`.
3. hPanel → **Files → File Manager** → open **public_html**.
   - A brand-new site has Hostinger's placeholder files there (such as
     `default.php`). Delete them. Leave anything you know you need.
   - **Upload** the zip into `public_html`, then right-click it → **Extract**,
     and extract into `public_html` itself (not a new subfolder).
   - Delete the zip afterwards.
4. Check that `public_html` now contains `index.html`, the `js` and `css`
   folders, and **`.htaccess`**. If you cannot see `.htaccess`, turn on "Show
   hidden files" in File Manager's settings. It forces HTTPS, sends the
   `www.` address to the address without it, and sets the security headers,
   so it must be there.

FTP works too (hPanel → **Files → FTP Accounts**, then FileZilla): upload the
*contents* of `public/`, including `.htaccess`, into `public_html`.

If you turn on Hostinger's CDN or cache, purge it after every upload.

## 8. Make yourself the admin (once)

1. Open your site, **sign up** with your own email address, and verify it from
   the email you get.
2. Firebase Console → **Authentication → Users**: copy the **User UID** next to
   your email address.
3. Firebase Console → **Firestore Database → Data → users →** the document with
   that UID → **Add field**: `role`, type string, value `admin`.
4. Reload the site. An **Admin** link now appears under your email address in
   the side menu: subscriptions, manual grants and other admins are managed
   there. Nobody can make themselves admin
   from the app.

## 9. Try everything on the live site

With Stripe still in test mode:

- [ ] Sign up with a second email address, verify it, and check the 14-day trial
      starts.
- [ ] Create a project, add an item, invite the second account, and check it
      joins after verifying.
- [ ] Add a PDF and a photo to the project; check they appear in Google Drive.
      **Back up now**, and check a backup appears.
- [ ] Create and issue a permit, and link it to the project.
- [ ] **Subscribe** with the Stripe test card `4242 4242 4242 4242`; check the
      account shows as active, and **Manage plan** opens Stripe's portal.
- [ ] Sign out, and check pages need sign-in again.
- [ ] Open the site on a phone and install it (browser menu → **Install app** or
      **Add to Home screen**).

Then switch Stripe to live payments: [PAYMENTS.md](PAYMENTS.md), step 8.

## 10. Before you sell: checklist

- [ ] A competent person has checked the permit-to-work content against your
      procedures.
- [ ] A UAE-licensed lawyer has checked the Terms and Privacy notice, including
      where Firebase stores data.
- [ ] Your licensed business name and website address are filled in
      `public/js/app-version.js` (`APP_PUBLISHER`). `node tools/check-deploy.mjs`
      reminds you.
- [ ] Google Cloud Console → **IAM & Admin → Service accounts**: delete any
      downloaded key you do not use. This setup needs none, and any key that was
      ever in a public repository must be treated as known to others.
- [ ] The old public copy of the portal on GitHub Pages is turned off (that
      repository → **Settings → Pages → Unpublish**, or make it private), so
      nobody uses an out-of-date version.
- [ ] Consider making this repository private (**Settings → General → Change
      visibility**). It holds no secrets, but it is your product's code.
- [ ] Only you are an admin, and the spending alert from step 2 is on.

---

## Updating the site later

1. Get the new code (`git pull`, or download the ZIP again).
2. If the website changed, the version must go up in **three places** together:
   `APP_VERSION` and `APP_VERSION_CODE` in `public/js/app-version.js`,
   `CACHE_VERSION` in `public/sw.js`, and `appVersionName` / `appVersionCode` in
   `twa-manifest.json`. This is how installed apps know to update.
   `node tools/check-deploy.mjs` catches a mismatch.
3. If `functions/` changed: `cd functions && npm install && cd ..`, then
   `firebase deploy --only functions`. If `firestore.rules` changed:
   `firebase deploy --only firestore:rules`. Deploy the back end **before** the
   website, so new pages never call functions that are not there yet.
4. `node tools/package-site.mjs`, then upload and extract the zip in
   `public_html` as in step 7, replacing the old files.
5. Open the site. Installed copies pick up the new version the next time they
   are opened and show an update notice.

## Account deletion requests

People ask by email (the app's **Account deletion** page tells them how). The
page promises it is done within 30 days.

1. Check the email comes from the address the account uses.
2. If they pay, cancel the subscription first, or they keep being charged: by
   card in the Stripe Dashboard (**Customers** → their address → cancel the
   subscription), through Google Play in Play Console (**Order management** →
   their order → cancel). Keep the invoices the law requires you to keep.
3. Open the site's **Admin** page → **Users & access**, search for the address
   and click **Delete account**. It lists what will happen first: the projects
   they leave, the projects archived because nobody else belongs to them, and
   a warning if a subscription still renews.
4. If it says they own a project other people still use, it stops and names the
   project. Ask them who should take it over, and either let them hand it over
   (project page → **Team** → **Make owner**) or do it in Firebase Console →
   **Firestore** → `projects` → that project: set `ownerUid` to the new owner's
   uid, the new owner's entry in `members` to `owner`, and the leaving person's
   entry to `manager`. Then click **Delete account** again.
5. Type their email address to confirm. The portal deletes their sign-in, their
   `users` record with the assessments, permits and checklists saved to it,
   their file-space count and any Google Play purchase links; takes them out of
   every project and cancels invites to their address; replaces their address
   with "deleted user" in every project's activity log, file list and backup
   list; archives projects only they belonged to; and notes in `adminLog` that
   you did it, without the address.
6. Files they added stay with the project for its team. If they ask for those
   to go too, ask the project's owner or a manager to delete them on the
   project page. If they want an archived project of their own deleted rather
   than kept: delete its folder in the shared drive, run
   `firebase firestore:delete projects/<id> --recursive` and
   `firebase firestore:delete driveFolders/<id>`, and lower `usedBytes` and
   `fileCount` in `driveTotals/all` by what `driveFolders/<id>` held.
7. Project **backups** already in Google Drive still hold their address. Each
   project keeps its last 30 nightly backups (made only on nights the project
   changed), 20 manual ones and 10 restore points, so in a quiet project they
   can last many months. If they ask, delete the backups of the projects they
   belonged to: the `.json` files in each project's `Backups` folder, and the
   matching documents under `projects` → the project → `backups` in Firestore.
8. Reply to confirm it is done. Data kept only on their own devices is theirs
   to clear; the Account deletion page has a button for it.

If **Delete account** stops with an error, fix what it says and click it
again: it carries on where it stopped. If it keeps saying the sign-in could not
be deleted, delete it in Firebase Console → **Authentication** (find the
address → **Delete account**), then click **Delete account** once more.

## If something goes wrong

| What you see | What to check |
|---|---|
| The site does not open, or shows Hostinger's default page | SSL is active (step 7.1); the files are in `public_html` itself, not in a subfolder; the default placeholder file is deleted. |
| "This domain is not authorized" or sign-in fails at once | Step 2.3: add the exact domain, without `www.`, to Authorized domains. |
| Pages look unstyled, or the browser console mentions a Content Security Policy | `.htaccess` was changed or a new outside service is being called; compare with the one in `public/`. |
| "Card payments are not set up yet" | The Stripe secret key is not stored, or the functions were not redeployed after storing it. |
| Paid on Stripe, but the account still shows the paywall | The webhook: address, events and signing secret ([PAYMENTS.md](PAYMENTS.md), troubleshooting). |
| "File storage is not set up yet" or "Google Drive could not be reached" | [DRIVE_FILES.md](DRIVE_FILES.md), "If something goes wrong". |
| Deploy fails mentioning billing | The Firebase project is not on Blaze. |
| People still see the old version | The version was not raised in all three places, or a Hostinger cache needs purging. A normal reload after opening the site once more brings the update. |

For anything else, Firebase Console → **Functions → Logs** shows what the
server did, and the browser's developer console shows what the page did.
