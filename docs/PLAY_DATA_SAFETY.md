# Google Play — Data Safety form answers

This is a fill-in-the-blanks guide for the Data safety section in Play Console
(**App content → Data safety**). Google cross-checks these answers against what
your app actually does and rejects mismatches, so there are **two scenarios**
below. Use the one that matches the build you're actually shipping.

> Not legal advice. This reflects how the app is built; a lawyer/DPO should
> still sanity-check it, especially the deletion and encryption claims once a
> backend is live.

---

## Which scenario am I in?

- **Scenario A — Local-only build** (`js/firebase-config.js` still has the
  placeholder `YOUR_API_KEY`): the app sends nothing off the device. Everything
  is in the browser's localStorage.
- **Scenario B — Firebase enabled** (real config filled in, cloud accounts +
  sync live): names, notes, signatures and an account email are transmitted to
  and stored in Firebase (Google Cloud), and purchase data is handled for
  subscriptions.

Ship the answers for the scenario you actually launch with. If you launch local-
only and later switch on Firebase, **you must update this form the same day** —
this is one of the most common causes of enforcement action.

---

## Scenario A — Local-only build

**Top-level questions**
- Does your app collect or share any of the required user data types? → **No.**
  - Justification: Google's definition of "collected" is *data transmitted off
    the device*. In this build nothing is transmitted — there is no server and
    no analytics/ads SDK. On-device-only storage is explicitly excluded from
    "collected."
- (The rest of the form is skipped once you answer No, but keep the note below
  on file in case of review.)

**Review note to keep:** All user-entered data (names, notes, on-screen
signatures, the local login) is stored only in `localStorage` on the user's
device. No advertising SDK, no analytics SDK, no crash-reporting SDK, no network
calls. The Backup/Restore feature writes a file to the user's own device at their
request; it is not transmitted anywhere by the app.

---

## Scenario B — Firebase enabled (accounts + cloud sync + subscriptions)

**Top-level questions**
- Does your app collect or share any of the required user data types? → **Yes.**
- Is all of the user data collected by your app encrypted in transit? → **Yes.**
  (Firebase/Firestore and Google Play Billing all use HTTPS/TLS by default.)
- Do you provide a way for users to request that their data be deleted? → **Yes.**
  (In-app: users can delete individual assessments/permits and erase all data on
  the device; full account deletion is requested from the public
  `account-deletion.html` page and carried out by the operator — see the note at
  the bottom.)

**Data types to declare** — for each, Google asks: *Collected? Shared? Processed
ephemerally? Optional or required? Purposes?* Recommended answers:

| Data type | Collected | Shared | Purpose(s) | Notes |
|---|---|---|---|---|
| **Personal info → Name** | Yes | No | App functionality | Assessor / issuer / approver / verifier / person-in-charge / contractor names entered on assessments and permits, and the names on permits to work (permit holder, work party, fire watcher, confined space entrants and standby person, gas tester, isolating authority, rescuers, the person who closed the permit). |
| **Personal info → Email address** | Yes | No | App functionality; Account management | Used as the cloud account login identifier (Firebase Auth). |
| **Personal info → User IDs** | Yes | No | App functionality; Account management | Firebase Auth UID; ties records to the account. |
| **Personal info → Other info** | Yes | No | App functionality | Free-text notes and on-screen **signatures** captured for permit sign-off. Declare here (there is no dedicated "signature" type) and describe it in the field. |
| **Photos and videos → Photos** | Yes | No | App functionality | Site photos a user adds to a project's files (stored in the operator's Google Drive through Cloud Functions). Optional. Photos inside an audit pack a user uploads to their own Google Drive are covered too (see below). |
| **Files and docs** | Yes | No | App functionality | Documents a user adds to a project (method statements, drawings, certificates), and nightly project backups, stored in the operator's Google Drive. Optional. Also covers HSE audit packs a user chooses to upload to **their own** Google Drive (see "Audit packs and Google Drive" below). |
| **Financial info → Purchase history** | Yes | No | App functionality; Account management | Subscription purchase/entitlement state from Google Play Billing, used to unlock paid features. Payment *card* data is handled entirely by Google Play and is **not** collected by your app — do not tick "User payment info". |
| **App activity / App info & performance** | No* | — | — | Only tick these if you later add analytics or crash reporting. The base app doesn't. |

*Leave analytics/crash-reporting rows as "not collected" unless and until you
actually add Firebase Analytics or Crashlytics — if you add them, revisit this.

**Audit packs and Google Drive.** On an HSE audit, **Upload to Drive** (optional,
and off until Drive settings are filled in on the audit page) signs the user in
to Google in the browser (Google Identity Services) and sends the compiled audit
pack, which can hold certificates, ID cards and other evidence files, straight
from the device to the user's own Google Drive. The developer's servers are not
in this path and never receive the pack or the access token; the token is held in
the page's memory only. The default permission is `drive.file` (only files the
app created or the user picked); the user can opt in to the full `drive` scope in
Drive settings. This is a transfer the user starts, to a service they chose and
signed in to, so it is not "sharing" in Google's sense. It is disclosed in the
Privacy Notice, section 3c; keep this form and that section in step.

**"Shared" is No across the board** in this design: data goes to Firebase as your
*processor* (that's "collected/processed on your behalf," not "shared with a third
party" in Google's sense). Don't tick Shared just because Firebase is Google —
Google-as-your-backend is still processing on your behalf.

**Security practices section**
- Data is encrypted in transit → **Yes.**
- Users can request data deletion → **Yes** (see account-deletion note below).
- Committed to Play Families Policy? → only if you target children (you don't;
  this is a professional tool).

---

## Account deletion requirement (Scenario B)

Google requires apps with account creation to also offer **account deletion**,
and to give a way to request it *without reinstalling the app* — typically a web
URL. Practically, add either:
- an in-app "Delete my account & data" button that deletes the Firebase Auth user
  and their Firestore `users/{uid}` document (a small Cloud Function using the
  Admin SDK does this cleanly), and/or
- a public web page describing how to request deletion, whose URL you enter in
  Play Console's **App content → Data deletion** section.

**Built now:** `account-deletion.html` is the public deletion page. It is
deliberately *not* behind `requireAccess()`, because Google requires the URL to be
reachable without signing in or installing the app. It covers all three routes —
wiping everything on the device (including the offline cache and the registered
service worker), uninstalling, and emailing to request deletion of a cloud
account and its synced records — and states the 30-day completion commitment and
what may be retained for statutory accounting reasons.

The operator carries out an emailed request with the admin-only
`adminDeleteAccount` Cloud Function. It deletes the sign-in, the `users/{uid}`
document with its records, and takes the email off every project. The page is
honest about what is left: audit packs the user uploaded to their own Google
Drive (theirs to delete), and project backups, which are kept by number, not by
date — the last 30 nightly backups (taken only on days the project changed), up
to 20 manual backups and 10 made before a restore. In a quiet project that can be
many months, so the operator deletes that project's older backups on request.

Enter its hosted URL in **Play Console → App content → Data deletion**.

---

## Consent record

When someone creates an account, and on the in-app acceptance screen whenever
the Terms or Privacy Notice change, the app stores which version was accepted
and when (`consentVersion`, `consentAcceptedAt` in `users/{uid}`). This is
account-management data tied to the User ID row above; it needs no separate
data type.

---

## Privacy policy URL

Both scenarios: enter the hosted URL of `privacy.html` in Play Console. Google
requires a working, app-specific privacy policy link for any app that offers
accounts or in-app purchases.
