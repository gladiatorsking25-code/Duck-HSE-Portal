# Duck HSE Portal

A subscription web app for HSE teams: crane lift assessments, permits to work,
equipment checklists and certificates, HSE audit evidence packs, and HSE
statistics analysis. It runs in any modern browser on phone, tablet or desktop,
and installs as an app (PWA / Android TWA).

## Layout

| Path | What it is | Where it runs |
|---|---|---|
| `public/` | The website: HTML, CSS, JS, icons, `.htaccess` | Your web host (Hostinger) |
| `functions/` | Cloud Functions: trial on signup, purchase verification, admin actions | Firebase |
| `firestore.rules` | The server-side security boundary for all data | Firebase |
| `firebase.json` | Firebase deploy config | – |
| `twa-manifest.json` | Android (Trusted Web Activity) build config | Bubblewrap |
| `docs/` | Security model, Firebase setup, Play Store notes, changelog | – |

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

## Deploy

1. **Firebase** (once, then whenever rules or functions change):
   `firebase deploy --only firestore:rules,functions`
   Setup steps: [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md).
2. **Website:** upload the *contents* of `public/` (including the hidden
   `.htaccess`) into `public_html/` on Hostinger. Any Hostinger plan works; no
   Node.js is needed on the host. Turn on the free SSL certificate first.
3. Add your site's domain under Firebase Console → Authentication → Settings →
   Authorized domains.

## Changelog

See [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
