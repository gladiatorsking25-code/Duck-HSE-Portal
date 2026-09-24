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

---

## 4. How access is decided (the entitlement model)

Every account has a document at `users/{uid}` in Firestore. The only fields that
decide access are written **exclusively by Cloud Functions** (Admin SDK):

| Field | Set by | Meaning |
|---|---|---|
| `role` | admin bootstrap / `adminSetRole` | `admin` = full access always |
| `trialStartedAt` / `trialEndsAt` | `onUserCreate` | the free-trial window |
| `subscriptionStatus` | `verifyPlayPurchase` / RTDN | `active`, `in_grace`, `expired`, … |
| `subscriptionExpiryMillis` | `verifyPlayPurchase` / RTDN | when paid access ends |
| `adminGrantUntil` / `compForever` | `adminSetSubscription` | a manual owner grant |

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
| Purchase → verify → entitlement | `verifyPlayPurchase` | server |
| Real-time renew/cancel | `playRTDN` | server |
| Owner admin dashboard | `admin.html` + `js/admin.js` | client |
| Admin grant/revoke/extend/role | `adminSetSubscription`, `adminSetRole`, `adminListUsers` | server |
| The real boundary | `firestore.rules` | server |

**Important:** all of this is dormant until Firebase is configured. While
`js/firebase-config.js` still has the `YOUR_API_KEY` placeholder, `requireAccess()`
falls back to the old local sign-in gate and the app behaves exactly as it did
before — so the app is never bricked waiting for setup. The moment you paste a
real config in, it switches to **real-accounts-only + trial-then-paid**.

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
   (`pro_monthly`, `pro_yearly` by default).
6. **Google Cloud Console** (same project): enable the *Google Play Android
   Developer API*.
7. **Play Console → Setup → API access**: link the Cloud project and give the
   Functions runtime service account the *View financial data* permission.
8. **Deploy functions**: `firebase deploy --only functions`.
9. **Make yourself the first admin** — this is the one manual step, done with
   console rights so it can't be self-served: Firebase Console → Firestore →
   `users/<your uid>` → add field **`role` = `admin`** (String). Now `admin.html`
   works for you and you can grant admin to others from the dashboard.
10. **Real-time notifications (recommended):** Play Console → Monetization setup →
    create a Pub/Sub topic named `play-rtdn` (matches `RTDN_TOPIC`), so cancels
    and renewals reflect immediately.
11. **App Check (recommended hardening):** enable App Check (Play Integrity) in
    Firebase and enforce it on Firestore + Functions, so only your genuine app —
    not a scripted client with your public config — can call the backend.

Keep the four version numbers in step on every release (`js/app-version.js`,
`sw.js` `CACHE_VERSION`, and `twa-manifest.json` — currently **1.4.0 / build 6**).

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
- [ ] Cancel in Play → the RTDN function flips status without you reopening.
- [ ] `admin.html` loads only for a `role: admin` account; a normal account sees
      "Not authorized"; the callables reject a non-admin even if they call them
      directly.
- [ ] Admin "Grant +30d" / "Revoke" / "+14d trial" change the target account and
      appear in `adminLog`.

---

## 8. The legacy local gate

`js/auth.js` (`Sabir` / `admin`) still exists **only** as the pre-activation
fallback. It was never real security and is documented as such. Once Firebase is
configured, `requireAccess()` no longer uses it for app pages — real accounts
take over. If you want to remove it entirely after go-live, delete the
`localSection` block in `login.html` and the `firebaseOn()` fallback branch in
`js/access.js`; nothing else depends on it.
