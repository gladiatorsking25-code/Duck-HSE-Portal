# Card payments with Stripe

Customers on the website pay by card through **Stripe Checkout**. Inside the
Android app, Google Play Billing is used instead, because Play's policy requires
it for subscriptions sold in a Play app. Both kinds of subscription unlock the
same account.

## How it works

1. On `subscribe.html` the customer picks a plan. The app calls the
   `stripeCreateCheckout` Cloud Function, which creates a Stripe customer
   (once per account) and a Checkout Session, and returns its link.
   If that customer already has a subscription in Stripe (for example they
   paid in another tab, or the webhook in step 3 has not arrived), the
   function writes it to the account and opens the billing portal instead,
   so nobody is charged twice. An account revoked on `admin.html` cannot
   start a checkout.
2. The customer pays on Stripe's own page. **Card details never reach your
   website or Firebase.**
3. Stripe calls the `stripeWebhook` Cloud Function. It checks Stripe's
   signature, reads the subscription back from Stripe, and writes the result
   to `users/{uid}`. `firestore.rules` stop the browser from writing any of
   those fields, so nobody can unlock the app without paying.
4. Stripe sends the customer back to `subscribe.html?checkout=success`, which
   waits a moment for step 3 and then opens the app.
5. **Manage plan** on the dashboard opens Stripe's billing portal
   (`stripePortal`), where customers change their card, cancel, or download
   invoices.

| Stripe subscription status | In the app | Access |
|---|---|---|
| `active`, `trialing` | active | yes |
| `past_due` (card failed, Stripe is retrying) | in_grace | yes, with a "payment failed" note |
| `incomplete` | pending_payment | no (the free trial still counts) |
| `canceled`, `unpaid`, `paused`, `incomplete_expired` | expired | no |

**Free trial.** Everyone gets 14 days free. Someone who subscribes during the
trial keeps the rest of it: Stripe charges the first payment when the trial
ends. Stripe needs at least 2 days left for that; with less, the first payment
is taken at once. A second card subscription never gets a trial.

**Cancelling.** A customer who cancels keeps access until the end of the period
they paid for. The dashboard shows the date.

## What you need

- A Stripe account (<https://dashboard.stripe.com>). Stripe supports businesses
  in the UAE. You can do everything below in **test mode** before activating
  live payments.
- Firebase on the **Blaze** (pay as you go) plan. Cloud Functions and the
  secret storage they use need it; a small customer base normally stays within
  the free allowance.
- The Firebase CLI, signed in to your project (`npm install -g firebase-tools`,
  then `firebase login`).

**Never paste the Stripe secret key or webhook secret into a chat, an email,
or any file in this repository.** They go only into Firebase's secret storage
with the commands below, which prompt for them.

## Setup (test mode first)

### 1. Create the product and price in Stripe

1. Stripe Dashboard → turn on **Test mode**.
2. **Product catalog → Add product.** Name it (for example *Duck HSE Portal
   Pro*). Add a **recurring** price of **5.00 USD per month**.
   The paywall says "Price includes VAT where applicable", so under the price's
   tax behaviour choose **inclusive**.
3. Copy the price ID (it starts with `price_`).
4. Optional yearly plan: add a second recurring price to the same product, copy
   its ID, and un-comment the `yearly` line in `WEB_PAYMENTS.PLANS` in
   `public/js/subscription-config.js` (set the display price there too).

### 2. Set the function settings

```
cd functions
cp .env.example .env
```

Edit `functions/.env`:

- `APP_ORIGIN`: your site's main address, written exactly like the example in
  `.env.example`: `https://your-domain.com` (https, no `www.`, no trailing
  slash). The site sends visitors who type `www.` to this address (see
  `docs/DEPLOY.md`), and Stripe sends customers back here after they pay. Any
  other form brings customers back from Stripe signed out.
- `STRIPE_PRICE_MONTHLY`: the price ID from step 1 (and `STRIPE_PRICE_YEARLY` if
  you made one).
- `STRIPE_AUTOMATIC_TAX`: leave `false` unless you set up Stripe Tax (see
  below).

`functions/.env` holds settings, not secrets, and git ignores it.

### 3. Store the Stripe secret key

Stripe Dashboard → **Developers → API keys** → reveal the **Secret key**
(`sk_test_…` in test mode). Then run this and paste the key when it asks:

```
firebase functions:secrets:set STRIPE_SECRET_KEY
```

Safer option: create a **restricted key** instead, with write access to
*Customers*, *Checkout Sessions* and *Customer portal*, and read access to
*Subscriptions* (checkout reads them too, to avoid a second subscription).
That is all the functions use. If a checkout ever fails with a
permission error, add the permission Stripe names in the function log.

The webhook secret comes from step 5, but the deploy needs it to exist, so set
a placeholder now (type anything, for example `later`):

```
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

### 4. Deploy

```
firebase deploy --only firestore:rules,functions
```

The first deploy prints the functions' addresses. Note the one ending in
`/stripeWebhook`, which looks like
`https://us-central1-YOUR-PROJECT.cloudfunctions.net/stripeWebhook`.

### 5. Connect the webhook

1. Stripe Dashboard → **Developers → Webhooks** (also called *Event
   destinations*) → **Add endpoint**.
2. Endpoint URL: the `stripeWebhook` address from step 4.
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Save, then reveal the endpoint's **Signing secret** (`whsec_…`) and store it:

   ```
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase deploy --only functions
   ```

   Functions read secrets when they are deployed, so the redeploy is needed.

### 6. Turn on the billing portal

Stripe Dashboard → **Settings → Billing → Customer portal**. Allow customers to
update their payment method, cancel subscriptions and view invoices. If you
made a yearly price, you can also allow switching plans. Save.

### 7. Test it

1. Open your site, sign up with a new account, open **Subscribe**.
2. Pay with the test card `4242 4242 4242 4242`, any future expiry date, any
   CVC.
3. You land back on the app. The dashboard shows **Monthly subscription** with
   a **Manage plan** button.
4. **Manage plan** opens the portal. Cancel there, go back, and the dashboard
   says until when access continues.
5. Stripe Dashboard → **Developers → Webhooks → your endpoint** lists every
   delivery. Each should show `200`.

### 8. Go live

Keep the time the public site runs in test mode short: until you go live,
anyone can unlock the app with the public test card.

Stripe keeps test and live data apart, so repeat in **live mode**:

1. Create the product and price again and put the live `price_…` ID in
   `functions/.env`.
2. Set the live secret key: `firebase functions:secrets:set STRIPE_SECRET_KEY`.
3. Add the webhook endpoint again in live mode and set its new signing secret:
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`.
4. Configure the customer portal in live mode.
5. `firebase deploy --only functions`.
6. Clear the test-mode Stripe references. Every account that opened Checkout
   in test mode (your own test accounts, and anyone who pressed Subscribe
   while the site was in test mode) still has a test-mode `stripeCustomerId`,
   and perhaps a `stripeSubscriptionId`, on its `users/{uid}` document. Live
   mode cannot see them. Checkout replaces a missing customer by itself, but
   **Manage plan** says "There is no card subscription on this account." until
   the account subscribes again. For each of those accounts, open Firebase
   console → **Firestore Database** → `users` → the account, and delete both
   fields. If the account paid with the test card and still shows a plan, also
   set `subscriptionStatus` to `expired`.
7. Test one live payment with a **fresh account** that never used test mode,
   then cancel it in the billing portal and refund it in Stripe.

## VAT and tax

With `STRIPE_AUTOMATIC_TAX=false`, customers pay exactly the price you set.
If you register for VAT and set up **Stripe Tax** (Dashboard → Tax), set
`STRIPE_AUTOMATIC_TAX=true` and redeploy. Checkout then collects the address
it needs and adds tax. Check your obligations with an accountant.

## Other ways to pay

The **Request access / invoice** option on the subscribe page stays available
for companies that want an invoice or bank transfer. You activate those
accounts by hand from `admin.html`. Set `OFFLINE_PAYMENT.enabled` to `false` in
`subscription-config.js` to hide it. To hide card payments, set
`WEB_PAYMENTS.enabled` to `false`.

## Troubleshooting

| What you see | Cause |
|---|---|
| "Payments are not set up yet (APP_ORIGIN)." | `APP_ORIGIN` in `functions/.env` is missing, not https, or has a path. Fix and redeploy. |
| "Card payments are not set up yet." | `STRIPE_SECRET_KEY` is not set. Step 3, then redeploy. |
| "That plan is not available." | The plan's `STRIPE_PRICE_…` setting is empty. |
| Paid, but the app still asks to subscribe | Check the webhook deliveries in Stripe. A `400` means the signing secret is wrong (step 5). A `500` shows the reason in `firebase functions:log --only stripeWebhook`; Stripe retries on its own for up to three days. Meanwhile the customer can press **Subscribe** again: they are not charged twice, the app finds the subscription in Stripe, unlocks the account and opens the billing portal. |
| "There is no card subscription on this account." on **Manage plan** for an account that shows a card plan | Its Stripe customer is not in this Stripe mode, usually a test-mode leftover after going live. Clear it as in **Go live**, item 6. |
| "This account is suspended. Please contact support." | The account is `revoked` on `admin.html`, so checkout is refused. If they may subscribe again, lift the revoke there with a grant button (**+30d**, **+1y**, **Forever**) or **+14d trial**. |
| The admin page shows a user as `revoked` who is paying | A revoke is not lifted by a payment. Use **Grant** on `admin.html` to restore them, and cancel their subscription in Stripe if they should not be charged. The billing portal stays open to them for that. |

## Testing locally

`cd test && npm run test:e2e:payments` runs the whole flow (checkout, signed
webhook, unlock, portal, cancel, lock-out) in a browser against the Firebase
emulators and a small fake Stripe server. It needs no Stripe account or
network. It works through the emulator-only `STRIPE_API_BASE` setting, which
deployed functions ignore.
