# Google Sheets connection

This update uses the local **crane-lifting-assessment-app** you selected. It replaces Firebase sign-in, subscription checks and assessment/permit sync with a Node.js server connected to your Google Sheet. Checklists also sync. The lifting calculations, detailed assessment views, payment screens, and existing assets are preserved.

The code is prepared and tested locally. It has **not** connected to or changed your live sheet, deployed a server, sent email, or verified a real Google Play purchase.

## 1. Protect the sheet

Open [Duck HSE Portal Users](https://docs.google.com/spreadsheets/d/1_cxtIQV17Enp1z7vJhBBkVYyJwvwdxjcAJiN9kYBpAw/edit).

- Change **Share → General access → Restricted**. The screenshot currently shows Anyone with the link.
- Keep your own access and the intended service account as Editor. The screenshot shows `hpedaccount@sabirrealestate.iam.gserviceaccount.com`; use credentials for that account, or share the sheet with the service account you actually configure.
- Back up the sheet before running setup. The existing plaintext password must be replaced. Setup disables plaintext passwords and creates a new, hashed administrator password that you choose. Other existing accounts must reset their passwords.
- Do not put the service-account JSON key in the sheet, browser JavaScript, or the public application folder. Store it in a private server directory. Do not send it in chat.

## 2. Configure the server

Use Node.js 22 or newer. Enable the Google Sheets API in the service account's Google Cloud project. Download or provision that service account's credentials privately on the server.

Copy `.env.example` to `.env`, then set:

| Setting | Value |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute path to the private service-account JSON file |
| `SHEET_ID` | Already set to the sheet you provided |
| `APP_ORIGIN` | `http://localhost:3000` for local use; your exact HTTPS origin for production |
| `SHEET_PRIVATE_CONFIRMED` | `yes`, after restricting sharing |
| `INITIAL_ADMIN_EMAIL` | Your administrator email |
| `INITIAL_ADMIN_PASSWORD` | A new password of 12–128 characters |

From the application folder:

```text
npm install --ignore-scripts
npm run setup
npm test
npm start
```

After setup, remove `INITIAL_ADMIN_PASSWORD` from `.env`. The server never needs it again. Keep `.env` private. Open `http://localhost:3000/login.html` and sign in with the new password.

Setup uses the tab with ID 0, matching the supplied sheet link. It keeps the email and subscription columns, replaces Password with PasswordHash, adds account/expiry columns, and adds PortalSessions, PortalRecords, and PortalPurchases tabs. Setup refuses the initial migration if columns D onward already contain header data. Never rename the server tabs or edit their JSON rows manually. Avoid editing/sorting user rows while server writes are running.

## 3. Manage subscriptions

The Users tab is editable by the owner:

| Column | How to use it |
| --- | --- |
| Email | Account email; keep unique |
| PasswordHash | Server-managed; never type a password here |
| Subscription (Trial/Monthly/Yearly) | `Trial`, `Monthly`, or `Yearly`; blank grants no subscription |
| UID | Permanent server-managed account ID |
| Role | `user` or `admin` |
| TrialEndsAt | Required trial end, e.g. `2026-09-25T23:59:59Z` |
| ExpiresAt | Required end date for Monthly/Yearly; no automatic unlimited access |
| GrantUntil | Optional manually granted access expiry |
| CompForever | `TRUE` for permanent complimentary access |
| CreatedAt | Server-managed creation time |
| Revoked | `TRUE` blocks ordinary user access even during an unexpired trial |

New accounts receive a server-set 14-day trial. Existing blank subscription cells stay locked. You can also use the app's Admin page to grant access, revoke it, extend a trial, or manage administrator roles. For accounts with Google Play purchases, use the Admin grant controls for manual access because scheduled Play verification updates the paid plan columns.

## 4. Password reset email

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` for your authorized mail provider. Port 465 uses TLS; port 587 requires STARTTLS. The reset link expires after 30 minutes. Resetting the password invalidates old sessions. Without SMTP configuration, the app clearly asks users to contact support; it does not claim to have sent an email.

## 5. Google Play and existing payments

Existing PayPal/bank-transfer screens and the Android purchase/restore interface are retained. Manual payments still require an administrator to confirm receipt and grant access; the sheet does not process a card or confirm payment automatically.

For Play Billing, enable the Android Publisher API and give the server service account access to the matching Play Console app. Confirm `PLAY_PACKAGE_NAME` and the `pro_monthly` / `pro_yearly` products match the installed app. The server verifies subscription state and expiry, acknowledges purchases, prevents a previously claimed token being assigned to another user, and refreshes saved purchases every 15 minutes while the server is running. This is scheduled reconciliation rather than Firebase's Pub/Sub handler. Real payment flows still need testing with your Play test account.

## 6. Hosting and data migration

Run exactly **one Node.js process/replica** for this sheet. It serializes writes because Sheets is not a transactional database. Use an HTTPS reverse proxy in production and serve the application and `/api/portal` from the same origin. Keep `HOST=127.0.0.1` behind a local reverse proxy; use the host required by your deployment platform otherwise. Do not expose server files or credentials using a separate static-file server.

This package is no longer a GitHub-Pages-only application: login requires the Node.js server. An Apps Script deployment is not required.

No Firebase cloud records were migrated because none were supplied or accessed. Export existing Firebase data separately before retiring that service. Browser records from the legacy local account are preserved in an owner-specific local archive when first signing into Sheets. Before switching builds, use the old app's Backup export. Import the backup under the intended account; imported records are queued for sync. Replace mode also queues deletions for records it removes. Existing certificates and fleet preferences remain device-local. Maintain regular exports.

Records sync on save and approximately every minute; another device may need a page refresh to display incoming records. Failed saves remain queued per account. Deletions sync as tombstones. An individual synced JSON record is limited to 2 MB and is split across cells; larger records remain local with a visible sync error. Sheets quotas and serialized writes make this appropriate for a small portal, not a high-concurrency service. Increase sheet row capacity before its tabs fill. Expired session rows and tombstones should be maintained during a planned offline maintenance window.

## Validation performed

Automated tests cover salted password verification, duplicate accounts, trial defaults, invalid sessions, user isolation, expiry/revocation, administrator-only actions, reset-token invalidation, large-record chunking, Google Play token ownership, and stale-tab account switching. Browser checks cover login rendering and visible server-connection errors. JavaScript syntax and local page asset references are checked before packaging.

Live Sheets permissions, SMTP delivery, production HTTPS cookies, multi-device syncing against Google, and Play purchases remain deployment checks.

Implementation references: [Sheets values API](https://developers.google.com/workspace/sheets/api/guides/values), [RAW writes](https://developers.google.com/workspace/sheets/api/samples/writing), [Google Play subscription verification](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get).
