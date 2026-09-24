// billing.js — Google Play Billing purchase flow for the TWA, via the Digital
// Goods API + Payment Request API.
//
// This only works inside the installed Android app (the TWA), where Chrome
// exposes `getDigitalGoodsService('https://play.google.com/billing')`. In a
// plain browser that API isn't present, so Billing.available() returns false and
// the paywall tells the user to subscribe from the Android app. That is the
// honest situation: you can only buy a Play subscription through Play.
//
// The security-critical part is that a purchase is NOT trusted on the client.
// The purchase token returned by Play is sent to the verifyPlayPurchase Cloud
// Function, which checks it against the Google Play Developer API and writes the
// entitlement server-side. The client never decides its own subscription state.

const Billing = (function () {
  'use strict';

  const PLAY_METHOD = 'https://play.google.com/billing';

  function available() {
    return typeof window !== 'undefined' && 'getDigitalGoodsService' in window && typeof PaymentRequest !== 'undefined';
  }

  async function service() {
    if (!available()) return null;
    try { return await window.getDigitalGoodsService(PLAY_METHOD); }
    catch (e) { console.warn('Digital Goods service unavailable', e); return null; }
  }

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
  // the UI can branch on: 'unavailable' (not in TWA), 'cancelled', 'verify' (the
  // server could not confirm the purchase), or 'error'.
  async function subscribe(productId) {
    if (!available()) { const e = new Error('Play Billing is only available in the Android app.'); e.code = 'unavailable'; throw e; }
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
      // Acknowledge to Play so the purchase isn't auto-refunded after 3 days.
      try { const svc = await service(); if (svc && svc.acknowledge) await svc.acknowledge(purchaseToken, 'onetime'); } catch (e) { /* subs may be acked server-side */ }
      return result.data;
    } catch (e) {
      try { await response.complete('fail'); } catch (_) {}
      const err = new Error('Could not verify the purchase.'); err.code = 'verify'; err.cause = e; throw err;
    }
  }

  // Reconcile on app open: if Play has active purchases we haven't verified this
  // session (e.g. bought on another device, or a renewal), push them to the
  // server so entitlement is current.
  async function restore() {
    const svc = await service();
    if (!svc || !svc.listPurchases) return { restored: 0 };
    let purchases = [];
    try { purchases = await svc.listPurchases(); } catch (e) { return { restored: 0 }; }
    let restored = 0;
    await firebaseReadyPromise;
    const verify = firebase.functions().httpsCallable('verifyPlayPurchase');
    for (const p of purchases) {
      try {
        await verify({ packageName: SUBSCRIPTION_CONFIG.PLAY_PACKAGE_NAME, subscriptionId: p.itemId, purchaseToken: p.purchaseToken });
        restored++;
      } catch (e) { console.warn('restore verify failed', e); }
    }
    return { restored };
  }

  return { available, getProducts, subscribe, restore };
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
