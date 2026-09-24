// subscription-config.js — one place to configure the trial + subscription model.
//
// This file is safe to ship publicly: none of it is a secret. The real
// enforcement happens server-side (Firestore rules + Cloud Functions with the
// Admin SDK); these values only describe the product, drive the UI, and tell the
// billing code which Play products to buy.
//
// Everything here is dormant until Firebase is configured (js/firebase-config.js)
// — see SECURITY.md and FIREBASE_SETUP.md for the activation walkthrough.

const SUBSCRIPTION_CONFIG = {

  // ---- Trial ----
  // How long a brand-new account gets full access before a subscription is
  // required. The trial window is set SERVER-SIDE by the onUserCreate Cloud
  // Function (functions/index.js) so a user can't extend their own trial by
  // editing the client. This number must match TRIAL_DAYS there.
  TRIAL_DAYS: 14,

  // ---- Play Billing products ----
  // The subscription product IDs you create in Play Console → Monetize →
  // Subscriptions. The billing code (js/billing.js) offers these; the Cloud
  // Function verifies whichever one was purchased.
  PLAY_PACKAGE_NAME: 'Duck.HSE.Portal', // must match twa-manifest.json packageId
  // `displayPrice` is what shows on the paywall in a normal browser (where the
  // live Play price isn't available). Set it to your real price; inside the
  // Android app the actual Play Store price replaces it automatically.
  PRODUCTS: [
    { id: 'pro_monthly', label: 'Monthly', period: 'P1M', per: 'per month', displayPrice: '$5' }
  ],

  // Shown on the paywall — says what the subscription funds. Keeps it honest and
  // attractive: people subscribe to a maintained, improving tool.
  PLAN_NOTE: 'Your subscription keeps Duck HSE Portal maintained and updated — new crane data, monthly checklists, safety features, and support.',
  // A UAE-consumer-law-friendly one-liner (auto-renewal + VAT + cancellation are
  // also spelled out in the Terms). Google Play handles VAT and billing.
  PLAN_TERMS: 'Includes a 14-day free trial, then $5 / month. Auto-renews monthly — cancel anytime in Google Play. Price includes VAT where applicable.',

  // ---- Direct / offline payment (invoice, bank transfer, PayPal) ----
  // IMPORTANT: Google Play requires Play Billing for digital subscriptions sold
  // inside a Play-distributed app. This offline option is for DIRECT / B2B sales
  // and app builds distributed OUTSIDE Google Play. Payment is confirmed by you
  // and access is granted manually from the admin dashboard. Set enabled:false
  // to hide it (e.g. in the Play Store build) so you stay policy-compliant.
  // DO NOT put bank account numbers / IBAN / SWIFT here — this file ships inside
  // the app and is publicly readable. The web/B2B flow instead lets a customer
  // REQUEST access by email; you then send a payment link or invoice privately
  // and activate them from the admin dashboard. Set enabled:false to hide it
  // entirely (e.g. a pure Play-Store build).
  OFFLINE_PAYMENT: {
    enabled: true
  },

  // ---- Grace / account states ----
  // Statuses that still count as paid access. 'in_grace' is Play's billing grace
  // period (payment failed but access continues briefly); 'on_hold' does NOT
  // grant access.
  PAID_STATUSES: ['active', 'in_grace'],

  // ---- Support contact shown on the paywall ----
  SUPPORT_EMAIL: 'sabiriis143@gmail.com',

  // ---- Where a user is sent when their trial ends and they aren't subscribed.
  PAYWALL_PAGE: 'subscribe.html',
  LOGIN_PAGE: 'login.html',
  ADMIN_PAGE: 'admin.html'
};
