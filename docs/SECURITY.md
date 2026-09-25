# Security & subscriptions

This document is the honest description of how access, credentials, and paid
subscriptions work in this app — what is real security, what is not, and exactly
what you must do to turn the paid model on. It is written to be handed to a
developer or a security reviewer.

> Nothing here is legal advice. The billing, tax, and consumer-law obligations
> around selling subscriptions in the UAE are covered in `PLAY_STORE_LAUNCH.md`
> and still need a UAE-licensed lawyer.

---

## 1. The one rule everything follows

**Security lives on the server, not in the browser.** Anything the browser can
read, a determined user can read; anything the browser decides, a user can fake
in devtools. So the app is built so that:

- The **login screen** and the client-side entitlement checks are a *UX layer* —
  they route people to the right screen. They are **not** the thing that protects
  data or unlocks paid features.
- The **Firestore security rules** (`firestore.rules`) and the **Cloud Functions**
  (`functions/index.js`) are the real boundary. They run on Google's servers and
  cannot be bypassed from the client.

If you remember one thing: *a user can flip any localStorage flag they like and
it changes nothing on the server.*

---

## 2. What is NOT a secret (don't waste effort hiding these)

- **The Firebase web config** in `js/firebase-config.js` (`apiKey`, `projectId`,
  …). This is a public identifier, not a credential. It is *designed* to ship in
  client code. Security comes from Auth + Firestore rules, not from hiding it.
  Do not put it in an "env var" and think that helps — it ends up in the browser
  either way.
- Product IDs, package name, trial length in `js/subscription-config.js`.

## 3. What IS a secret (keep these server-side only)

- **The Google Play Developer API access** used to verify purchases. The scaffold
  uses the Cloud Functions runtime service account (no key file downloaded), so
  the secret never leaves Google's infrastructure. **Never** put a Play service
  account JSON key in the web app or the repo.
- Any admin credentials. The first admin is set by hand in the Firebase Console
  (§6), never in client code.
- **The Stripe secret key and webhook signing secret.** They live only in
  Firebase's secret storage (`firebase functions:secrets:set`), never in
  `functions/.env`, the web app or the repo. See `docs/PAYMENTS.md`.

---

## 4. How access is decided (the entitlement model)

Every account has a document at `users/{uid}` in Firestore. The only fields that
decide access are written **exclusively by Cloud Functions** (Admin SDK):

| Field | Set by | Meaning |
|---|---|---|
| `role` | admin bootstrap / `adminSetRole` | `admin` = full access always |
| `trialStartedAt` / `trialEndsAt` | `onUserCreate` | the free-trial window |
| `subscriptionStatus` | `verifyPlayPurchase` / RTDN / `stripeWebhook` | `active`, `in_grace`, `expired`, … |
| `subscriptionExpiryMillis` | `verifyPlayPurchase` / RTDN / `stripeWebhook` | when paid access ends |
| `subscriptionProvider`, `stripeCustomerId`, `stripeSubscriptionId`, `cancelAtPeriodEnd` | `verifyPlayPurchase` / `stripeCreateCheckout` / `stripeWebhook` | which store the plan is with, and the Stripe references |
| `adminGrantUntil` / `compForever` | `adminSetSubscription` | a manual owner grant |

**One Google Play subscription unlocks one account.** A Play purchase belongs
to the Google account that paid, and "Restore purchases" sends every purchase
on the phone to whichever account is signed in. So `verifyPlayPurchase`
records the first account that verifies a purchase token in
`purchaseTokens/{token}` and refuses that token, or a newer token that replaced
it (`linkedPurchaseToken`), for any other account (`functions/play.js`). An
admin **revoke** stands whatever Google Play or Stripe report later.

`js/entitlements.js` (`computeAccess`) reads that doc and returns the state, in
priority order: **admin → manual grant → active subscription → free trial →
locked**. The client only *reads*; `firestore.rules` forbids the client from
writing any of those fields, so a user cannot self-grant. (A brand-new account
whose trial hasn't been stamped yet reads as `pending` = access, so signup never
bounces to the paywall during the one-second window before the trigger runs.)

The model chosen here is **free trial → all paid**: a new account gets
`TRIAL_DAYS` of full access, after which the whole app is gated behind the
paywall (`subscribe.html`) until there is an active subscription or an admin
grant.

---

## 5. The pieces, and where they run

| Piece | File | Runs |
|---|---|---|
| Real accounts (email/password) | `js/firebase-auth.js` + Firebase Auth | client + Google |
| Trial started on signup | `onUserCreate` in `functions/index.js` | server |
| Access decision | `js/entitlements.js` | client (reads server truth) |
| Page gate + routing to login/paywall | `js/access.js` (`requireAccess`) | client |
| Paywall | `subscribe.html` + `js/billing.js` | client |
| Purchase → verify → entitlement (Android) | `verifyPlayPurchase` | server |
| Card checkout and billing portal (web) | `stripeCreateCheckout`, `stripePortal` | server |
| Stripe → entitlement (signature-checked) | `stripeWebhook` | server |
| Real-time renew/cancel | `playRTDN` | server |
| Owner admin dashboard | `admin.html` + `js/admin.js` | client |
| Admin grant/revoke/extend/role | `adminSetSubscription`, `adminSetRole`, `adminListUsers` | server |
| The real boundary | `firestore.rules` | server |

If `js/firebase-config.js` has no real config, `requireAccess()` fails closed:
every protected page routes to the login screen, which says sign-in is not
available. There is no offline or local fallback login.

---

## 6. Activation checklist (what you must do — I can't from here)

I cannot create your Firebase project, your Play Developer account, or enter your
credentials. Here is the exact sequence:

1. **Firebase project** on the **Blaze** plan (Cloud Functions need it; the free
   tier inside Blaze keeps a small subscriber base near $0/month).
2. **Enable Email/Password** auth (Firebase Console → Authentication → Sign-in).
3. **Create Firestore** (production mode) and deploy the rules:
   `firebase deploy --only firestore:rules`
4. **Paste your web config** into `js/firebase-config.js`. (This flips the app to
   real-accounts-only.)
5. **Google Play**: register the developer account, create the subscription
   products with IDs matching `PRODUCTS` in `js/subscription-config.js`
   (`pro_monthly` by default). The server accepts only the IDs listed in
   `PLAY_PRODUCT_IDS` in `functions/.env` (default `pro_monthly`), and checks
   purchases against its own `PLAY_PACKAGE_NAME` (default `Duck.HSE.Portal`,
   the `packageId` in `twa-manifest.json`).
6. **Google Cloud Console** (same project): enable the *Google Play Android
   Developer API*.
7. **Play Console → Setup → API access**: link the Cloud project and give the
   Functions runtime service account (`<project-id>@appspot.gserviceaccount.com`)
   the *View financial data* and *Manage orders and subscriptions*
   permissions. The second lets the server acknowledge each purchase; Google
   refunds a purchase nobody acknowledges within 3 days.
8. **Deploy functions**: `firebase deploy --only functions`.
9. **Make yourself the first admin** — this is the one manual step, done with
   console rights so it can't be self-served: Firebase Console → Firestore →
   `users/<your uid>` → add field **`role` = `admin`** (String). Now `admin.html`
   works for you and you can grant admin to others from the dashboard.
10. **Real-time developer notifications (required for Google Play):** a
    renewal keeps the same purchase token, so this is how renewals,
    cancellations and refunds reach the account. Without it a paying Play
    customer is locked out at each renewal until the app next checks Google
    Play.
    1. Step 8 created the Pub/Sub topic `play-rtdn` (it matches `RTDN_TOPIC`
       in `functions/index.js`).
    2. Let Google Play publish to it: Google Cloud Console → **Pub/Sub →
       Topics → play-rtdn → Permissions → Add principal**:
       `google-play-developer-notifications@system.gserviceaccount.com`, role
       **Pub/Sub Publisher**. Or, with the gcloud tool:
       ```
       gcloud pubsub topics add-iam-policy-binding play-rtdn --project=<project-id> \
         --member=serviceAccount:google-play-developer-notifications@system.gserviceaccount.com \
         --role=roles/pubsub.publisher
       ```
    3. Play Console → **Monetization setup** (under Monetize) → **Real-time
       developer notifications**: turn them on, enter the topic name
       `projects/<project-id>/topics/play-rtdn`, and **Save**.
    4. Press **Send test notification**, then check
       `firebase functions:log --only playRTDN` shows `Play notification ignored`
       (the test message carries no purchase, so it is logged and ignored).
11. **App Check: not set up. Do not enforce it.** The app has no App Check code,
    so enforcing App Check on Firestore or Functions in the Firebase console
    would reject every request from the website and the Android app and lock
    every customer out. (Play Integrity does not cover the Android app either:
    it is web content.) Adding it later means, in this order: add the App Check
    web SDK with a reCAPTCHA Enterprise provider to `js/firebase-init.js` and
    allow its addresses in the Content-Security-Policy in `.htaccess`, deploy,
    watch the App Check metrics until almost all requests are verified, and
    only then enforce.

Keep the version numbers in step on every release (`js/app-version.js`,
`sw.js` `CACHE_VERSION`, and `twa-manifest.json`); `node tools/check-deploy.mjs`
catches a mismatch.

---

## 7. Test checklist after activation (do this — it can't be tested pre-Firebase)

Because the live Firebase/Play paths need your project, verify these once it's on:

- [ ] Sign up a new account → lands in the app on a trial; `users/{uid}` shows
      `trialEndsAt` ≈ now + `TRIAL_DAYS`.
- [ ] In devtools, try to set your own `subscriptionStatus`/`trialEndsAt` → the
      write is **rejected** by the rules.
- [ ] Manually set `trialEndsAt` to the past via an admin action (or wait) →
      reopening the app routes to `subscribe.html`.
- [ ] Buy a subscription in the Android app → `verifyPlayPurchase` sets
      `subscriptionStatus: active` and access returns.
- [ ] Sign in to the Android app as a second account on the same phone and tap
      **Restore purchases** → refused ("linked to another Duck HSE account");
      the second account stays locked.
- [ ] Let a tester subscription renew (every 5 minutes for license testers) →
      `subscriptionExpiryMillis` moves forward without opening the app (RTDN).
- [ ] Cancel in Play → the RTDN function flips status without you reopening.
- [ ] Revoke a Play subscriber from `admin.html`, then renew or restore → the
      account stays revoked.
- [ ] `admin.html` loads only for a `role: admin` account; a normal account sees
      "Not authorized"; the callables reject a non-admin even if they call them
      directly.
- [ ] Admin "Grant +30d" / "Revoke" / "+14d trial" change the target account and
      appear in `adminLog`.

---

## 8. Removed: the legacy local gate and the Google Sheets server

The old hard-coded local login (`js/auth.js`) and the separate Node server that
kept accounts in a Google Sheet (`server/`) have been removed. Firebase is the
only account system. Hosting is static: upload the contents of `public/` to the
web host (see `README.md`).
