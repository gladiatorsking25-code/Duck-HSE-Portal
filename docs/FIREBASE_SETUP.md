# Cloud sync, accounts & subscriptions — setup guide (Firebase)

> **Going live? Follow [DEPLOY.md](DEPLOY.md) instead.** It is the current,
> step-by-step guide. This page is background from when Firebase was first
> added; parts of it (the local-only mode and the old login gate) no longer
> apply.

This walks through turning on the cloud backend that was scaffolded into the app.
**Until you complete step 1–2, the app runs exactly as before** — local-only,
username/password gate, no network calls. Nothing here is destructive; it's all
additive, and reverting is as simple as putting the placeholder back in
`js/firebase-config.js`.

I've written all the client code and the Cloud Function, but a few steps can only
be done by you in the Firebase/Google consoles (they need your Google account,
billing, and Play Console access). Those are called out as **[you do this]**.

---

## What's already wired up (no action needed)

- `js/firebase-config.js` — placeholder config (you fill in real values).
- `js/firebase-init.js` — loads Firebase SDKs from Google's CDN *only* if a real
  config is present.
- `js/firebase-auth.js` — real email/password accounts, layered on top of the
  existing login gate (`js/auth.js` untouched).
- `js/cloud-sync.js` — two-way sync between Firestore and the localStorage that
  every page already reads, so no page had to become async.
- `js/storage.js` — now calls `CloudSync.push()/remove()` after each local
  save/delete (fire-and-forget; local save never blocked or broken by the network).
- `login.html` — shows a "cloud account" sign-in/sign-up/reset block *only* when
  Firebase is configured.
- `firestore.rules` — the real server-side security boundary.
- `functions/` — Cloud Function scaffold that verifies Play subscriptions.

---

## Step 1 — Create the Firebase project **[you do this]**

1. Go to <https://console.firebase.google.com> → **Add project**. The free
   **Spark** plan is enough to start; you only need the pay-as-you-go **Blaze**
   plan once you deploy the Cloud Function in step 5 (and even then a small user
   base typically stays within Blaze's included free tier).
2. **Build → Authentication → Get started → Sign-in method →** enable
   **Email/Password**.
3. **Build → Firestore Database → Create database →** start in **production
   mode**, pick a location near your users (e.g. `eur3` or an Asia region for the
   UAE). *(Firestore has no UAE region today; pick the closest acceptable one and
   note it in your privacy documentation, since data location matters under PDPL.)*

## Step 2 — Add your web app config **[you do this]**

1. Firebase Console → **Project settings** (gear) → **General** → **Your apps** →
   **Add app → Web** (`</>`).
2. Copy the values from the `firebaseConfig` object it shows you into
   `js/firebase-config.js`, replacing every `YOUR_...` placeholder.
3. Reload the app. The cloud sign-in block now appears on `login.html`. Create an
   account, sign in, save an assessment — you should see it appear under
   **Firestore Database → Data → users/{uid}/assessments**.

## Step 3 — Apply the security rules **[you do this]**

The default rules are too open. Either:
- paste the contents of `firestore.rules` into **Firestore Database → Rules →
  Publish**, or
- if using the Firebase CLI: `firebase deploy --only firestore:rules`.

Verify: signed out, a read of another user's data should be denied. These rules —
not the client-side login — are what actually protect data.

## Step 4 — Test cross-device sync

Sign in with the same account in two browsers. Save a permit in one; it should
appear in the other within a second or two (real-time Firestore listener). If it
doesn't, check the browser console for a rules/permission error.

## Step 5 — Subscriptions via Google Play Billing **[you do this]**

Only needed for the Android app. The purchase flow is already built
(`public/js/billing.js`, `functions/play.js`). Follow `SECURITY.md` §6 steps
5–10 (Play Developer API, Play Console API access with **View financial data**
and **Manage orders and subscriptions**, and the Play notifications topic, which
is required) and `PLAY_STORE_LAUNCH.md` §3a (the subscription product and a test
purchase before release).

## Step 6 — Account deletion

Deletion requests are handled with the admin-only `adminDeleteAccount` function
(Admin page → **Delete account**). The steps, including what to do with project
backups, are in `DEPLOY.md` → **Account deletion requests**. Register the public
`account-deletion.html` page under **Play Console → App content → Data
deletion**; see `PLAY_DATA_SAFETY.md`.

---

## Cost expectations (small scale)

- Firebase **Spark** (free): Auth + Firestore with generous daily limits — fine
  for development and a handful of early users.
- Firebase **Blaze**: required only for Cloud Functions. Includes the same free
  tiers; you pay only for usage above them. A small subscriber base verifying
  purchases occasionally should cost near zero — but **set a budget alert** in
  Google Cloud Console so there are no surprises.
- Google Play: one-time **US$25** developer registration; Google's standard
  revenue share applies to subscriptions.

## Reverting

Put `apiKey: "YOUR_API_KEY"` back in `js/firebase-config.js` (or restore the
original file). `FIREBASE_READY` becomes false, the SDK never loads, the cloud
sign-in block disappears, and the app is byte-for-byte the local-only tool again.
