// stripe.js — web subscriptions through Stripe Checkout.
//
// Flow: the app calls stripeCreateCheckout → the customer pays on Stripe's
// hosted page → Stripe calls stripeWebhook → we re-read the subscription from
// Stripe and write the entitlement onto users/{uid}. The browser never decides
// its own subscription state, and firestore.rules stop it writing any of the
// fields below.
//
// Every webhook re-fetches the subscription instead of trusting the event
// body, so duplicate or out-of-order events all converge on Stripe's current
// truth.
//
// The logic takes the Stripe client and Firestore as arguments so it can be
// tested without network access (see test/stripe.test.mjs).

const PLAN_ENV = { monthly: 'STRIPE_PRICE_MONTHLY', yearly: 'STRIPE_PRICE_YEARLY' };

class BillingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function config(env = process.env) {
  const origin = String(env.APP_ORIGIN || '').replace(/\/+$/, '');
  return {
    origin,
    prices: Object.fromEntries(Object.entries(PLAN_ENV).map(([plan, key]) => [plan, env[key] || ''])),
    automaticTax: String(env.STRIPE_AUTOMATIC_TAX || '').toLowerCase() === 'true'
  };
}

function assertOrigin(origin) {
  if (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new BillingError('failed-precondition', 'Payments are not set up yet (APP_ORIGIN).');
  }
}

// Stripe subscription status → the app's subscriptionStatus.
//   active / trialing      → active    (paid access)
//   past_due               → in_grace  (card failed, Stripe is retrying)
//   incomplete             → pending_payment (no access yet)
//   anything else          → expired
function mapStatus(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due') return 'in_grace';
  if (status === 'incomplete') return 'pending_payment';
  return 'expired';
}

// The end of the paid period. Newer Stripe API versions keep it on the
// subscription items; older ones on the subscription itself.
function periodEndMillis(sub) {
  const ends = [sub.current_period_end]
    .concat(((sub.items && sub.items.data) || []).map((i) => i.current_period_end))
    .filter((v) => typeof v === 'number');
  return ends.length ? Math.max(...ends) * 1000 : 0;
}

function planOf(sub, prices) {
  const priceIds = ((sub.items && sub.items.data) || []).map((i) => i.price && i.price.id);
  const match = Object.entries(prices).find(([, id]) => id && priceIds.includes(id));
  return match ? match[0] : 'unknown';
}

// Stripe needs a trial to end at least 48 hours out; keep a margin for the
// time between this call and Stripe creating the subscription.
const MIN_TRIAL_MS = 49 * 3600 * 1000;

// The users/{uid} fields to write for this subscription — or null when the
// update must not be applied (a live Google Play subscription must not be
// overwritten by a lapsed Stripe one).
function entitlementPatch(sub, prices, current = {}, now = Date.now()) {
  const status = mapStatus(sub.status);
  const playLive = current.subscriptionProvider === 'play'
    && ['active', 'in_grace'].includes(current.subscriptionStatus)
    && Number(current.subscriptionExpiryMillis || 0) > now;
  if (playLive && status !== 'active') return null;
  // An event about an older Stripe subscription must not end a newer, live one.
  const otherStripeLive = current.subscriptionProvider === 'stripe'
    && current.stripeSubscriptionId && current.stripeSubscriptionId !== sub.id
    && ['active', 'in_grace'].includes(current.subscriptionStatus)
    && Number(current.subscriptionExpiryMillis || 0) > now;
  if (otherStripeLive && status !== 'active') return null;
  const patch = {
    subscriptionProvider: 'stripe',
    subscriptionStatus: status,
    subscriptionId: planOf(sub, prices),
    subscriptionExpiryMillis: periodEndMillis(sub),
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || '',
    cancelAtPeriodEnd: !!sub.cancel_at_period_end
  };
  // An admin revoke stands until an admin lifts it; a renewal doesn't undo it.
  if (current.subscriptionStatus === 'revoked') delete patch.subscriptionStatus;
  return patch;
}

async function findUid(db, sub) {
  const fromMeta = sub.metadata && sub.metadata.uid;
  if (fromMeta) return fromMeta;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
  if (!customer) return null;
  const snap = await db.collection('users').where('stripeCustomerId', '==', customer).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/** Create a Checkout Session for `plan`. Returns { url } or { alreadySubscribed: true }. */
async function createCheckout({ stripe, db, uid, email, plan, env, serverTimestamp }) {
  const cfg = config(env);
  assertOrigin(cfg.origin);
  const price = cfg.prices[plan];
  if (!price) throw new BillingError('invalid-argument', 'That plan is not available.');

  const userRef = db.collection('users').doc(uid);
  const user = (await userRef.get()).data() || {};
  const live = ['active', 'in_grace'].includes(user.subscriptionStatus)
    && Number(user.subscriptionExpiryMillis || 0) > Date.now();
  if (live && user.subscriptionProvider === 'stripe') return { alreadySubscribed: true };
  if (live && user.subscriptionProvider === 'play') {
    throw new BillingError('failed-precondition', 'You already subscribe through Google Play. Manage it in the Play Store.');
  }

  let customer = user.stripeCustomerId;
  if (!customer) {
    const created = await stripe.customers.create(
      { email: email || undefined, metadata: { uid } },
      { idempotencyKey: `customer-${uid}` }
    );
    customer = created.id;
    await userRef.set({ stripeCustomerId: customer, subscriptionUpdatedAt: serverTimestamp() }, { merge: true });
  }

  // Subscribing during the free trial keeps the rest of the trial: the first
  // charge happens when it ends. Only for a first card subscription.
  const trialEnd = Number(user.trialEndsAt || 0);
  const keepTrial = !user.stripeSubscriptionId && trialEnd - Date.now() >= MIN_TRIAL_MS;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: uid,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { uid }, ...(keepTrial ? { trial_end: Math.floor(trialEnd / 1000) } : {}) },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    ...(cfg.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    success_url: `${cfg.origin}/subscribe.html?checkout=success`,
    cancel_url: `${cfg.origin}/subscribe.html?checkout=cancelled`
  });
  return { url: session.url };
}

/** Billing portal (update card, switch plan, cancel, invoices). Returns { url }. */
async function createPortal({ stripe, db, uid, env }) {
  const cfg = config(env);
  assertOrigin(cfg.origin);
  const user = (await db.collection('users').doc(uid).get()).data() || {};
  if (!user.stripeCustomerId) throw new BillingError('failed-precondition', 'There is no card subscription on this account.');
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${cfg.origin}/index.html`
  });
  return { url: session.url };
}

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed'
]);

function subscriptionIdOf(event) {
  const o = event.data && event.data.object;
  if (!o) return null;
  if (event.type === 'checkout.session.completed') return o.mode === 'subscription' ? o.subscription : null;
  if (event.type.startsWith('customer.subscription.')) return o.id;
  if (event.type.startsWith('invoice.')) {
    return o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription) || null;
  }
  return null;
}

/**
 * Apply one verified webhook event. Returns a short outcome string (for logs
 * and tests). Throws only on errors worth a Stripe retry.
 */
async function handleEvent({ stripe, db, event, env, serverTimestamp }) {
  if (!HANDLED.has(event.type)) return 'ignored';
  const subId = subscriptionIdOf(event);
  if (!subId) return 'no-subscription';

  const sub = await stripe.subscriptions.retrieve(subId);
  let uid = await findUid(db, sub);
  if (!uid && event.type === 'checkout.session.completed') uid = event.data.object.client_reference_id || null;
  if (!uid) return 'unknown-user';

  const ref = db.collection('users').doc(uid);
  const current = (await ref.get()).data() || {};
  const patch = entitlementPatch(sub, config(env).prices, current);
  if (!patch) return 'skipped-other-live-subscription';
  await ref.set(Object.assign(patch, { subscriptionUpdatedAt: serverTimestamp() }), { merge: true });
  return `applied:${patch.subscriptionStatus}`;
}

module.exports = {
  BillingError, config, mapStatus, periodEndMillis, entitlementPatch,
  createCheckout, createPortal, handleEvent, subscriptionIdOf
};
