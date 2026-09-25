// billing.js — Google Play Billing purchase flow for the TWA, via the Digital
// Goods API + Payment Request API.
//
// This only works inside the installed Android app (the TWA) built with Play
// Billing. Careful: Chrome on Android and on Chromebooks has
// `getDigitalGoodsService` on EVERY website, so its presence proves nothing;
// outside the app the call just fails. So the paywall asks playReady() (does
// Google Play actually answer?) and inTwa() (did the Android app open this
// launch?) instead. On the plain website neither is true, and the paywall
// offers card checkout (WebBilling below).
//
// The security-critical part is that a purchase is NOT trusted on the client.
// The purchase token returned by Play is sent to the verifyPlayPurchase Cloud
// Function, which checks it against the Google Play Developer API, ties it to
// one account, and writes the entitlement server-side. The client never
// decides its own subscription state.

const Billing = (function () {
  'use strict';

  const PLAY_METHOD = 'https://play.google.com/billing';
  const TWA_KEY = 'duck_twa';             // sessionStorage: this launch is the Android app
  const RESTORE_KEY = 'duck_play_restored'; // sessionStorage: checked Play this launch
  const READY_WAIT_MS = 5000;

  // ---- Is this the Android app? --------------------------------------------
  // The app opens its pages with ?src=twa (startUrl and shortcuts in
  // twa-manifest.json), and Android gives the first page an
  // android-app://<package> referrer. The sign-in and paywall redirects keep
  // the first address in ?next=. The mark lasts for this launch only
  // (sessionStorage); js/pwa.js records it the same way on the other pages.
  function launchedByApp() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('src') === 'twa' || /[?&]src=twa(&|$)/.test(q.get('next') || '')) return true;
      const pkg = String((typeof SUBSCRIPTION_CONFIG !== 'undefined' && SUBSCRIPTION_CONFIG.PLAY_PACKAGE_NAME) || 'Duck.HSE.Portal');
      return String(document.referrer || '').toLowerCase().indexOf('android-app://' + pkg.toLowerCase()) === 0;
    } catch (e) { return false; }
  }
  if (launchedByApp()) { try { sessionStorage.setItem(TWA_KEY, '1'); } catch (e) { /* storage blocked */ } }

  function inTwa() {
    try { if (sessionStorage.getItem(TWA_KEY) === '1') return true; } catch (e) { /* storage blocked */ }
    return launchedByApp();
  }

  // The API is there (not proof of the app: see above).
  function available() {
    return typeof window !== 'undefined' && 'getDigitalGoodsService' in window && typeof PaymentRequest !== 'undefined';
  }

  // Google Play's Digital Goods service, or null. Asked once per page.
  let dg = null;
  function service(waitMs) {
    if (!available()) return Promise.resolve(null);
    if (!dg) {
      dg = Promise.resolve()
        .then(() => window.getDigitalGoodsService(PLAY_METHOD))
        .then((svc) => svc || null, (e) => { console.info('Google Play billing is not available here:', (e && e.message) || e); return null; });
    }
    if (!waitMs) return dg;
    return Promise.race([dg, new Promise((resolve) => setTimeout(() => resolve(null), waitMs))]);
  }

  // True only where Google Play can take the payment: inside the Android app.
  async function playReady() { return !!(await service(READY_WAIT_MS)); }

  // The server refused the purchase because it belongs to another account.
  function isOtherAccount(e) { return /failed-precondition$/.test(String((e && e.code) || '')); }

  // Returns Play's store details (localized price, title) for the configured
  // products, or null when not running inside the TWA.
  async function getProducts() {
    const svc = await service();
    if (!svc) return null;
    const ids = SUBSCRIPTION_CONFIG.PRODUCTS.map(p => p.id);
    try { return await svc.getDetails(ids); }
    catch (e) { console.warn('getDetails failed', e); return []; }
  }

  // Runs the full buy → verify flow for one product id. Throws with a `.code`
  // the UI can branch on: 'unavailable' (not in the app), 'cancelled',
  // 'other-account' (this Google Play subscription belongs to another account;
  // `.message` says so), 'verify' (the server could not confirm the purchase),
  // or 'error'.
  async function subscribe(productId) {
    if (!(await playReady())) { const e = new Error('Play Billing is only available in the Android app.'); e.code = 'unavailable'; throw e; }
    if (typeof FIREBASE_READY === 'undefined' || !FIREBASE_READY) { const e = new Error('Backend not configured.'); e.code = 'unavailable'; throw e; }

    let response;
    try {
      const request = new PaymentRequest(
        [{ supportedMethods: PLAY_METHOD, data: { sku: productId } }],
        // Play ignores this amount and charges the store price; it just has to be present.
        { total: { label: 'Subscription', amount: { currency: 'USD', value: '0' } } }
      );
      response = await request.show();
    } catch (e) {
      const err = new Error('Purchase cancelled.'); err.code = (e && e.name === 'AbortError') ? 'cancelled' : 'error'; throw err;
    }

    const purchaseToken = response.details && (response.details.purchaseToken || (response.details.token));
    try {
      await firebaseReadyPromise;
      const verify = firebase.functions().httpsCallable('verifyPlayPurchase');
      const result = await verify({
        packageName: SUBSCRIPTION_CONFIG.PLAY_PACKAGE_NAME,
        subscriptionId: productId,
        purchaseToken: purchaseToken
      });
      await response.complete('success');
      // The server acknowledges the purchase to Play (otherwise Play refunds it
      // after 3 days); older Chrome versions can do it here too.
      try { const svc = await service(); if (svc && svc.acknowledge) await svc.acknowledge(purchaseToken, 'onetime'); } catch (e) { /* done server-side */ }
      return result.data;
    } catch (e) {
      try { await response.complete('fail'); } catch (_) {}
      const other = isOtherAccount(e);
      const err = new Error(other ? e.message : 'Could not verify the purchase.');
      err.code = other ? 'other-account' : 'verify'; err.cause = e; throw err;
    }
  }

  // Sends every Play purchase of the phone's Google account to the server, so
  // a renewal or a purchase made on another device reaches this account.
  // Returns counts: { restored, otherAccount, failed }.
  async function restore() {
    const out = { restored: 0, otherAccount: 0, failed: 0 };
    const svc = await service();
    if (!svc || !svc.listPurchases) return out;
    let purchases = [];
    try { purchases = await svc.listPurchases(); } catch (e) { return out; }
    if (!purchases || !purchases.length || !(await firebaseReadyPromise)) return out;
    const verify = firebase.functions().httpsCallable('verifyPlayPurchase');
    for (const p of purchases) {
      try {
        await verify({ packageName: SUBSCRIPTION_CONFIG.PLAY_PACKAGE_NAME, subscriptionId: p.itemId, purchaseToken: p.purchaseToken });
        out.restored++;
      } catch (e) {
        if (isOtherAccount(e)) out.otherAccount++; else out.failed++;
        console.warn('restore verify failed', e);
      }
    }
    return out;
  }

  // restore(), once per app launch (the paywall runs it by itself in the app).
  // Returns null when it already ran.
  async function restoreOnce() {
    try {
      if (sessionStorage.getItem(RESTORE_KEY) === '1') return null;
      sessionStorage.setItem(RESTORE_KEY, '1');
    } catch (e) { /* storage blocked: the page runs it once per visit */ }
    return restore();
  }

  return { available, inTwa, playReady, getProducts, subscribe, restore, restoreOnce };
})();

// WebBilling — card subscriptions on the website through Stripe Checkout.
//
// The browser only asks the server for a Stripe-hosted page and goes there;
// card details never touch this site. The subscription is written to the
// account by the stripeWebhook Cloud Function after Stripe confirms payment
// (functions/stripe.js), never by this code.
const WebBilling = (function () {
  'use strict';

  // Offered on the web only (see subscribe.html): inside the Android app
  // Google Play's policy requires Play Billing, which Billing handles.
  function plans() {
    const web = (typeof SUBSCRIPTION_CONFIG !== 'undefined' && SUBSCRIPTION_CONFIG.WEB_PAYMENTS) || {};
    return (web.PLANS || []).slice();
  }

  async function call(name, data) {
    await firebaseReadyPromise;
    try {
      const res = await firebase.functions().httpsCallable(name)(data || {});
      return res.data || {};
    } catch (e) {
      const err = new Error((e && e.message) || 'The payment service could not be reached.');
      err.code = (e && e.code) || 'error';
      throw err;
    }
  }

  // Only ever leave the site for an https page the server handed back.
  function go(url) {
    let u;
    try { u = new URL(url); } catch (e) { u = null; }
    if (!u || u.protocol !== 'https:') throw new Error('The payment service returned an invalid link.');
    location.assign(u.href);
  }

  // Start Checkout for a plan id from WEB_PAYMENTS.PLANS. Someone who already
  // has a live card subscription is sent to the billing portal instead.
  async function checkout(plan) {
    const data = await call('stripeCreateCheckout', { plan });
    if (data.alreadySubscribed) return portal();
    go(data.url);
  }

  // Stripe's billing portal: change card, switch plan, cancel, download invoices.
  async function portal() {
    const data = await call('stripePortal');
    go(data.url);
  }

  return { plans, checkout, portal };
})();
