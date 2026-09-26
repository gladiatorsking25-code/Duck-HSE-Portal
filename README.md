# Duck HSE Portal

A subscription web app for HSE teams: crane lift assessments, permits to work,
equipment checklists and certificates, HSE audit evidence packs, and HSE
statistics analysis. It runs in any modern browser on phone, tablet or desktop,
and installs as an app (PWA / Android TWA).

## Layout

| Path | What it is | Where it runs |
|---|---|---|
| `public/` | The website: HTML, CSS, JS, icons, `.htaccess` | Your web host (Hostinger) |
| `functions/` | Cloud Functions: trial on signup, Stripe and Play payments, project teams, admin actions | Firebase |
| `firestore.rules` | The server-side security boundary for all data | Firebase |
| `firebase.json` | Firebase deploy config | – |
| `test/` | Rules, unit and end-to-end tests (Firebase emulators) | Your computer / CI |
| `twa-manifest.json` | Android (Trusted Web Activity) build config | Bubblewrap |
| `docs/` | Security model, Firebase and payments setup, Play Store notes, changelog | – |

## Security model (short version)

- Accounts are Firebase email/password accounts. There is no other login.
- The browser only *reads* whether an account has access. Subscription and
  admin fields can only be written by Cloud Functions; `firestore.rules`
  enforces that, and each user can only read and write their own records.
- The Firebase web config in `public/js/firebase-config.js` is public by design.
- **Never commit secrets.** Service-account keys, `.env` files and signing keys
  are blocked by `.gitignore`, and `public/.htaccess` refuses to serve them, but
  the rule is simply: they never go in this repo.

Full details: [`docs/SECURITY.md`](docs/SECURITY.md).

## Projects and teams

Each customer creates projects and invites their team by email as manager,
editor or viewer. Projects hold tracked items (actions, inspections, incidents,
linked permits, assessments and checklists) with status, priority, due date and
assignee, plus an activity log. See `docs/CHANGELOG.md` (v1.8.0) for details.

## Subscriptions and payments

New accounts get a 14-day free trial. After that, website customers pay by card
through Stripe Checkout, and Android app users through Google Play. Stripe's
webhook, not the browser, marks an account as paid, and customers manage or
cancel from **Manage plan** on the dashboard. Setup, testing and going live:
[`docs/PAYMENTS.md`](docs/PAYMENTS.md).

## Tests

```
cd test
npm install
npm test                   # unit tests (teams, Stripe) + Firestore rules tests (needs Java 11+)
npm run test:e2e           # projects and teams in a browser, against the emulators
npm run test:e2e:payments  # subscribe → pay → unlock → cancel, with a fake Stripe
```

`test:e2e` uses Playwright; set `CHROMIUM_PATH` if Chromium isn't installed
where Playwright expects it. `functions/` needs `npm install` first.

## Deploy

1. **Firebase** (once, then whenever rules or functions change):
   `firebase deploy --only firestore:rules,functions`
   Setup steps: [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md), then
   [`docs/PAYMENTS.md`](docs/PAYMENTS.md) for Stripe.
2. **Website:** upload the *contents* of `public/` (including the hidden
   `.htaccess`) into `public_html/` on Hostinger. Any Hostinger plan works; no
   Node.js is needed on the host. Turn on the free SSL certificate first.
3. Add your site's domain under Firebase Console → Authentication → Settings →
   Authorized domains.

## Changelog

See [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
