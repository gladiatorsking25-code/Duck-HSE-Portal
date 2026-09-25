// Unit tests for functions/stripe.js with a fake Stripe client and an
// in-memory Firestore stand-in. No network.
//   node --test stripe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const billing = require('../functions/stripe.js');
const Stripe = require('../functions/node_modules/stripe');
// Resolves packages the way functions/ code does.
const requireFunctions = createRequire(new URL('../functions/stripe.js', import.meta.url));

const DAY = 86400000;
const env = { APP_ORIGIN: 'https://portal.example.com/', STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_YEARLY: 'price_y' };
const ts = () => 'SERVER_TS';
const DELETE = Symbol('delete');
const del = () => DELETE;

// ---- Fakes -------------------------------------------------------------------
function fakeDb(initial = {}) {
  const users = new Map(Object.entries(initial).map(([k, v]) => [k, { ...v }]));
  const doc = (id) => ({
    id,
    async get() { const d = users.get(id); return { exists: !!d, data: () => (d ? { ...d } : undefined) }; },
    async set(patch, opts) {
      assert.deepEqual(opts, { merge: true }, 'always merge into users/{uid}');
      const next = { ...(users.get(id) || {}), ...patch };
      for (const [k, v] of Object.entries(next)) if (v === DELETE) delete next[k];
      users.set(id, next);
    }
  });
  return {
    users,
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc,
        where(field, op, value) {
          return { limit: () => ({ async get() {
            const hits = [...users.entries()].filter(([, u]) => u[field] === value);
            return { empty: !hits.length, docs: hits.map(([id]) => ({ id })) };
          } }) };
        }
      };
    }
  };
}

// subs: subscriptions by id. byCustomer: what subscriptions.list returns per
// customer. missing: customer ids Stripe does not know (e.g. test-mode ids
// after going live), answered with Stripe's real error.
function fakeStripe(subs = {}, { byCustomer = {}, missing = [] } = {}) {
  const calls = [];
  const noSuchCustomer = (id) => new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error', code: 'resource_missing', param: 'customer', statusCode: 400,
    message: `No such customer: '${id}'; a similar object exists in test mode, but a live mode key was used to make this request.`
  });
  return {
    calls,
    customers: { async create(params, opts) { calls.push(['customers.create', params, opts]); return { id: 'cus_new' }; } },
    checkout: { sessions: { async create(params) { calls.push(['checkout.create', params]); return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }; } } },
    billingPortal: { sessions: { async create(params) {
      calls.push(['portal.create', params]);
      if (missing.includes(params.customer)) throw noSuchCustomer(params.customer);
      return { url: 'https://billing.stripe.com/p/session/1' };
    } } },
    subscriptions: {
      async retrieve(id) { calls.push(['subscriptions.retrieve', id]); if (!subs[id]) throw new Error('No such subscription'); return subs[id]; },
      async list(params) {
        calls.push(['subscriptions.list', params]);
        if (missing.includes(params.customer)) throw noSuchCustomer(params.customer);
        return { object: 'list', data: byCustomer[params.customer] || [], has_more: false };
      }
    }
  };
}

function sub(over = {}) {
  return {
    id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, metadata: { uid: 'u1' },
    items: { data: [{ price: { id: 'price_m' }, current_period_end: 1_900_000_000 }] },
    ...over
  };
}

// ---- Pure helpers ------------------------------------------------------------
test('mapStatus', () => {
  assert.equal(billing.mapStatus('active'), 'active');
  assert.equal(billing.mapStatus('trialing'), 'active');
  assert.equal(billing.mapStatus('past_due'), 'in_grace');
  assert.equal(billing.mapStatus('incomplete'), 'pending_payment');
  for (const s of ['canceled', 'unpaid', 'incomplete_expired', 'paused', undefined]) assert.equal(billing.mapStatus(s), 'expired');
});

test('periodEndMillis reads item-level and older top-level period ends', () => {
  assert.equal(billing.periodEndMillis(sub()), 1_900_000_000_000);
  assert.equal(billing.periodEndMillis({ current_period_end: 1_800_000_000, items: { data: [] } }), 1_800_000_000_000);
  assert.equal(billing.periodEndMillis({ items: { data: [] } }), 0);
});

test('config trims the origin and reads prices and the tax flag', () => {
  const c = billing.config({ ...env, STRIPE_AUTOMATIC_TAX: 'TRUE' });
  assert.equal(c.origin, 'https://portal.example.com');
  assert.deepEqual(c.prices, { monthly: 'price_m', yearly: 'price_y' });
  assert.equal(c.automaticTax, true);
});

// ---- entitlementPatch --------------------------------------------------------
const prices = { monthly: 'price_m', yearly: 'price_y' };

test('entitlementPatch maps an active subscription', () => {
  assert.deepEqual(billing.entitlementPatch(sub({ cancel_at_period_end: true, customer: { id: 'cus_obj' } }), prices), {
    subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionId: 'monthly',
    subscriptionExpiryMillis: 1_900_000_000_000, stripeSubscriptionId: 'sub_1',
    stripeCustomerId: 'cus_obj', cancelAtPeriodEnd: true
  });
  const unknown = billing.entitlementPatch(sub({ items: { data: [{ price: { id: 'price_other' }, current_period_end: 1 }] } }), prices);
  assert.equal(unknown.subscriptionId, 'unknown');
});

test('a lapsed Stripe subscription does not end a live Play one', () => {
  const now = Date.now();
  const play = { subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionExpiryMillis: now + DAY };
  assert.equal(billing.entitlementPatch(sub({ status: 'canceled' }), prices, play, now), null);
  assert.equal(billing.entitlementPatch(sub(), prices, play, now).subscriptionStatus, 'active');
  const lapsedPlay = { ...play, subscriptionExpiryMillis: now - DAY };
  assert.equal(billing.entitlementPatch(sub({ status: 'canceled' }), prices, lapsedPlay, now).subscriptionStatus, 'expired');
});

test('an event about an old Stripe subscription does not end the newer one', () => {
  const now = Date.now();
  const cur = { subscriptionProvider: 'stripe', stripeSubscriptionId: 'sub_new', subscriptionStatus: 'active', subscriptionExpiryMillis: now + DAY };
  assert.equal(billing.entitlementPatch(sub({ id: 'sub_old', status: 'canceled' }), prices, cur, now), null);
  // The same subscription ending is applied.
  assert.equal(billing.entitlementPatch(sub({ id: 'sub_new', status: 'canceled' }), prices, cur, now).subscriptionStatus, 'expired');
});

test('a renewal does not lift an admin revoke', () => {
  const patch = billing.entitlementPatch(sub(), prices, { subscriptionStatus: 'revoked' });
  assert.equal('subscriptionStatus' in patch, false);
  assert.equal(patch.stripeSubscriptionId, 'sub_1');
});

// ---- createCheckout ----------------------------------------------------------
test('createCheckout refuses without a valid APP_ORIGIN', async () => {
  for (const origin of ['', 'portal.example.com', 'http://portal.example.com', 'https://portal.example.com/app', 'javascript:alert(1)']) {
    await assert.rejects(
      billing.createCheckout({ stripe: fakeStripe(), db: fakeDb(), uid: 'u1', plan: 'monthly', env: { ...env, APP_ORIGIN: origin }, serverTimestamp: ts }),
      (e) => e.code === 'failed-precondition', origin
    );
  }
  // Local testing origins are allowed.
  const r = await billing.createCheckout({ stripe: fakeStripe(), db: fakeDb(), uid: 'u1', plan: 'monthly', env: { ...env, APP_ORIGIN: 'http://localhost:8765' }, serverTimestamp: ts });
  assert.ok(r.url);
});

test('createCheckout rejects a plan with no price', async () => {
  await assert.rejects(
    billing.createCheckout({ stripe: fakeStripe(), db: fakeDb(), uid: 'u1', plan: 'weekly', env, serverTimestamp: ts }),
    (e) => e.code === 'invalid-argument'
  );
  await assert.rejects(
    billing.createCheckout({ stripe: fakeStripe(), db: fakeDb(), uid: 'u1', plan: 'yearly', env: { ...env, STRIPE_PRICE_YEARLY: '' }, serverTimestamp: ts }),
    (e) => e.code === 'invalid-argument'
  );
});

test('createCheckout creates the customer once and builds the session', async () => {
  const db = fakeDb({ u1: { trialEndsAt: Date.now() - DAY } });
  const stripe = fakeStripe();
  const r = await billing.createCheckout({ stripe, db, uid: 'u1', email: 'a@example.com', plan: 'monthly', env, serverTimestamp: ts });
  assert.deepEqual(r, { url: 'https://checkout.stripe.com/c/pay/cs_1' });

  const [, cParams, cOpts] = stripe.calls.find((c) => c[0] === 'customers.create');
  assert.deepEqual(cParams, { email: 'a@example.com', metadata: { uid: 'u1' } });
  assert.deepEqual(cOpts, { idempotencyKey: 'customer-u1' });
  assert.equal(db.users.get('u1').stripeCustomerId, 'cus_new');

  const [, s] = stripe.calls.find((c) => c[0] === 'checkout.create');
  assert.equal(s.mode, 'subscription');
  assert.equal(s.customer, 'cus_new');
  assert.equal(s.client_reference_id, 'u1');
  assert.deepEqual(s.line_items, [{ price: 'price_m', quantity: 1 }]);
  assert.deepEqual(s.subscription_data, { metadata: { uid: 'u1' } });
  assert.equal(s.success_url, 'https://portal.example.com/subscribe.html?checkout=success');
  assert.equal(s.cancel_url, 'https://portal.example.com/subscribe.html?checkout=cancelled');
  assert.equal('automatic_tax' in s, false);

  // A brand-new customer has nothing to look up in Stripe.
  assert.equal(stripe.calls.some((c) => c[0] === 'subscriptions.list'), false);

  // Second checkout reuses the saved customer, after checking it has no subscription yet.
  await billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.equal(stripe.calls.filter((c) => c[0] === 'customers.create').length, 1);
  assert.deepEqual(stripe.calls.find((c) => c[0] === 'subscriptions.list')[1], { customer: 'cus_new', limit: 20 });
  assert.equal(stripe.calls.at(-1)[1].customer, 'cus_new');
});

test('createCheckout keeps the rest of a free trial on the first subscription', async () => {
  const trialEndsAt = Date.now() + 10 * DAY;
  const stripe = fakeStripe();
  await billing.createCheckout({ stripe, db: fakeDb({ u1: { trialEndsAt } }), uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.equal(stripe.calls.at(-1)[1].subscription_data.trial_end, Math.floor(trialEndsAt / 1000));

  // Under 48 hours left: Stripe would refuse the trial, so charge now.
  const soon = fakeStripe();
  await billing.createCheckout({ stripe: soon, db: fakeDb({ u1: { trialEndsAt: Date.now() + 47 * 3600000 } }), uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.equal('trial_end' in soon.calls.at(-1)[1].subscription_data, false);

  // Had a card subscription before: no second trial.
  const again = fakeStripe();
  await billing.createCheckout({ stripe: again, db: fakeDb({ u1: { trialEndsAt, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old', subscriptionStatus: 'expired' } }), uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.equal('trial_end' in again.calls.at(-1)[1].subscription_data, false);
});

test('createCheckout turns on Stripe Tax when configured', async () => {
  const stripe = fakeStripe();
  await billing.createCheckout({ stripe, db: fakeDb(), uid: 'u1', plan: 'monthly', env: { ...env, STRIPE_AUTOMATIC_TAX: 'true' }, serverTimestamp: ts });
  const s = stripe.calls.at(-1)[1];
  assert.deepEqual(s.automatic_tax, { enabled: true });
  assert.deepEqual(s.customer_update, { address: 'auto' });
});

test('createCheckout sends a live card subscriber to the portal instead', async () => {
  const stripe = fakeStripe();
  const db = fakeDb({ u1: { subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + DAY, stripeCustomerId: 'cus_1' } });
  assert.deepEqual(await billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts }), { alreadySubscribed: true });
  assert.equal(stripe.calls.length, 0);
});

test('createCheckout refuses while a Google Play subscription is live', async () => {
  const stripe = fakeStripe();
  const db = fakeDb({ u1: { subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + DAY } });
  await assert.rejects(billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts }), (e) => e.code === 'failed-precondition');
  assert.equal(stripe.calls.length, 0);
  // Once it has lapsed, card checkout is open.
  const lapsed = fakeDb({ u1: { subscriptionProvider: 'play', subscriptionStatus: 'expired', subscriptionExpiryMillis: Date.now() - DAY } });
  assert.ok((await billing.createCheckout({ stripe, db: lapsed, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts })).url);
});

test('createCheckout refuses a revoked account', async () => {
  const stripe = fakeStripe();
  // Even a revoked account whose last plan looks live: the revoke comes first.
  for (const extra of [{}, { subscriptionProvider: 'stripe', subscriptionExpiryMillis: Date.now() + DAY, stripeCustomerId: 'cus_1' }]) {
    const db = fakeDb({ u1: { subscriptionStatus: 'revoked', trialEndsAt: Date.now() + 10 * DAY, ...extra } });
    await assert.rejects(
      billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts }),
      (e) => e.code === 'failed-precondition' && e.message === 'This account is suspended. Please contact support.'
    );
    assert.equal(db.users.get('u1').subscriptionStatus, 'revoked');
  }
  assert.equal(stripe.calls.length, 0, 'no customer, no checkout');
});

test('createCheckout finds a subscription the webhook has not written yet', async () => {
  // Paid in another tab (or the webhook is failing): Stripe has a trialing
  // subscription, the account still shows only the free trial.
  const trialEndsAt = Date.now() + 10 * DAY;
  const db = fakeDb({ u1: { subscriptionStatus: 'trial', trialEndsAt, stripeCustomerId: 'cus_1' } });
  const trialing = sub({ status: 'trialing', items: { data: [{ price: { id: 'price_m' }, current_period_end: Math.floor(trialEndsAt / 1000) }] } });
  const stripe = fakeStripe({}, { byCustomer: { cus_1: [trialing] } });
  const r = await billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.deepEqual(r, { alreadySubscribed: true });
  assert.deepEqual(stripe.calls.map((c) => c[0]), ['subscriptions.list'], 'no new customer or Checkout');
  // The account is repaired exactly as the webhook would have done it.
  assert.deepEqual(db.users.get('u1'), {
    ...billing.entitlementPatch(trialing, prices, {}), subscriptionUpdatedAt: 'SERVER_TS', trialEndsAt
  });
  assert.equal(db.users.get('u1').subscriptionStatus, 'active');
});

test('createCheckout counts active, trialing, past-due and incomplete subscriptions as existing', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'incomplete']) {
    const stripe = fakeStripe({}, { byCustomer: { cus_1: [sub({ status })] } });
    const db = fakeDb({ u1: { subscriptionStatus: 'expired', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' } });
    assert.deepEqual(await billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts }), { alreadySubscribed: true }, status);
    assert.equal(db.users.get('u1').subscriptionStatus, billing.mapStatus(status), status);
  }
  // Ended ones do not block a new subscription.
  for (const status of ['canceled', 'incomplete_expired', 'unpaid', 'paused']) {
    const stripe = fakeStripe({}, { byCustomer: { cus_1: [sub({ status })] } });
    const db = fakeDb({ u1: { subscriptionStatus: 'expired', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' } });
    const r = await billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
    assert.ok(r.url, status);
    assert.equal(db.users.get('u1').subscriptionStatus, 'expired', status);
  }
});

test('openSubscription prefers a subscription that gives access, then the latest', () => {
  const at = (id, status, end) => sub({ id, status, items: { data: [{ price: { id: 'price_m' }, current_period_end: end }] } });
  assert.equal(billing.openSubscription([]), null);
  assert.equal(billing.openSubscription(undefined), null);
  assert.equal(billing.openSubscription([at('a', 'canceled', 9)]), null);
  assert.equal(billing.openSubscription([at('a', 'incomplete', 9), at('b', 'past_due', 5), at('c', 'canceled', 9)]).id, 'b');
  assert.equal(billing.openSubscription([at('a', 'past_due', 9), at('b', 'trialing', 5)]).id, 'b');
  assert.equal(billing.openSubscription([at('a', 'active', 5), at('b', 'trialing', 7)]).id, 'b');
});

test('createCheckout replaces a customer Stripe does not know (test-mode id after going live)', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const trialEndsAt = Date.now() + 10 * DAY;
  const db = fakeDb({ u1: { subscriptionStatus: 'expired', trialEndsAt, stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_test' } });
  const stripe = fakeStripe({}, { missing: ['cus_test'] });
  const r = await billing.createCheckout({ stripe, db, uid: 'u1', email: 'a@example.com', plan: 'monthly', env, serverTimestamp: ts, deleteField: del });
  assert.deepEqual(r, { url: 'https://checkout.stripe.com/c/pay/cs_1' });

  const [, cParams, cOpts] = stripe.calls.find((c) => c[0] === 'customers.create');
  assert.deepEqual(cParams, { email: 'a@example.com', metadata: { uid: 'u1' } });
  // Not the first key: Stripe could hand back the customer it made with that one.
  assert.deepEqual(cOpts, { idempotencyKey: 'customer-u1-cus_test' });
  const u = db.users.get('u1');
  assert.equal(u.stripeCustomerId, 'cus_new');
  assert.equal('stripeSubscriptionId' in u, false, 'the stale subscription id is cleared');
  assert.equal(u.subscriptionUpdatedAt, 'SERVER_TS');

  const s = stripe.calls.at(-1)[1];
  assert.equal(s.customer, 'cus_new');
  // The test-mode subscription does not cost the customer the rest of the trial.
  assert.equal(s.subscription_data.trial_end, Math.floor(trialEndsAt / 1000));
  assert.equal(warn.mock.callCount(), 1);
});

test('createCheckout clears the stale subscription id with a Firestore delete by default', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { FieldValue } = requireFunctions('firebase-admin/firestore');
  const writes = [];
  const db = { collection: () => ({ doc: () => ({
    async get() { return { data: () => ({ stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_test' }) }; },
    async set(patch) { writes.push(patch); }
  }) }) };
  await billing.createCheckout({ stripe: fakeStripe({}, { missing: ['cus_test'] }), db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts });
  assert.equal(writes.length, 1);
  assert.ok(FieldValue.delete().isEqual(writes[0].stripeSubscriptionId));
});

test('createCheckout lets other Stripe errors surface', async () => {
  const stripe = fakeStripe();
  const down = new Stripe.errors.StripeConnectionError({ message: 'An error occurred with our connection to Stripe.' });
  stripe.subscriptions.list = async () => { throw down; };
  const db = fakeDb({ u1: { stripeCustomerId: 'cus_1' } });
  await assert.rejects(billing.createCheckout({ stripe, db, uid: 'u1', plan: 'monthly', env, serverTimestamp: ts }), (e) => e === down);
  assert.equal(stripe.calls.length, 0, 'no Checkout when Stripe cannot be asked');
  assert.equal(db.users.get('u1').stripeCustomerId, 'cus_1', 'the customer is kept');
});

test('isMissingCustomer is about the customer only', () => {
  const err = (raw) => new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', statusCode: 400, message: 'x', ...raw });
  assert.equal(billing.isMissingCustomer(err({ code: 'resource_missing', param: 'customer' })), true);
  assert.equal(billing.isMissingCustomer(err({ code: 'resource_missing' })), true);
  // A test-mode price after going live is a setup problem, not a customer one.
  assert.equal(billing.isMissingCustomer(err({ code: 'resource_missing', param: 'line_items[0][price]' })), false);
  assert.equal(billing.isMissingCustomer(err({ code: 'parameter_invalid_empty', param: 'customer' })), false);
  assert.equal(billing.isMissingCustomer(new Error('socket hang up')), false);
  assert.equal(billing.isMissingCustomer(undefined), false);
});

// ---- createPortal ------------------------------------------------------------
test('createPortal needs a Stripe customer', async () => {
  await assert.rejects(billing.createPortal({ stripe: fakeStripe(), db: fakeDb({ u1: {} }), uid: 'u1', env }), (e) => e.code === 'failed-precondition');
  const stripe = fakeStripe();
  const r = await billing.createPortal({ stripe, db: fakeDb({ u1: { stripeCustomerId: 'cus_1' } }), uid: 'u1', env });
  assert.equal(r.url, 'https://billing.stripe.com/p/session/1');
  assert.deepEqual(stripe.calls[0][1], { customer: 'cus_1', return_url: 'https://portal.example.com/index.html' });
});

test('createPortal says plainly when Stripe does not know the customer', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const db = fakeDb({ u1: { stripeCustomerId: 'cus_test' } });
  await assert.rejects(
    billing.createPortal({ stripe: fakeStripe({}, { missing: ['cus_test'] }), db, uid: 'u1', env }),
    (e) => e instanceof billing.BillingError && e.code === 'failed-precondition' && e.message === 'There is no card subscription on this account.'
  );
  assert.equal(warn.mock.callCount(), 1);
  // Other failures still surface as they are (shown as "could not be reached").
  const stripe = fakeStripe();
  stripe.billingPortal.sessions.create = async () => { throw new Error('socket hang up'); };
  await assert.rejects(billing.createPortal({ stripe, db, uid: 'u1', env }), (e) => !(e instanceof billing.BillingError));
});

test('createPortal stays open to a revoked account, so it can cancel its plan', async () => {
  const r = await billing.createPortal({ stripe: fakeStripe(), db: fakeDb({ u1: { subscriptionStatus: 'revoked', stripeCustomerId: 'cus_1' } }), uid: 'u1', env });
  assert.ok(r.url);
});

// ---- handleEvent -------------------------------------------------------------
const ev = (type, object) => ({ id: 'evt_1', type, data: { object } });

test('handleEvent ignores unrelated events and one-off payments', async () => {
  const args = { stripe: fakeStripe(), db: fakeDb(), env, serverTimestamp: ts };
  assert.equal(await billing.handleEvent({ ...args, event: ev('charge.refunded', {}) }), 'ignored');
  assert.equal(await billing.handleEvent({ ...args, event: ev('checkout.session.completed', { mode: 'payment' }) }), 'no-subscription');
});

test('handleEvent re-reads the subscription and writes the entitlement', async () => {
  const db = fakeDb({ u1: { trialEndsAt: 1 } });
  // The event body says "incomplete"; Stripe's current state says active.
  const stripe = fakeStripe({ sub_1: sub() });
  const out = await billing.handleEvent({ stripe, db, env, serverTimestamp: ts, event: ev('customer.subscription.updated', { id: 'sub_1', status: 'incomplete' }) });
  assert.equal(out, 'applied:active');
  const u = db.users.get('u1');
  assert.equal(u.subscriptionStatus, 'active');
  assert.equal(u.subscriptionId, 'monthly');
  assert.equal(u.subscriptionUpdatedAt, 'SERVER_TS');
  assert.equal(u.trialEndsAt, 1, 'other fields are kept');
});

test('handleEvent finds the user by metadata, customer id or checkout reference', async () => {
  // By customer id (no metadata on the subscription).
  const db = fakeDb({ u2: { stripeCustomerId: 'cus_2' } });
  const stripe = fakeStripe({ sub_2: sub({ id: 'sub_2', customer: 'cus_2', metadata: {} }) });
  assert.equal(await billing.handleEvent({ stripe, db, env, serverTimestamp: ts, event: ev('invoice.paid', { parent: { subscription_details: { subscription: 'sub_2' } } }) }), 'applied:active');
  assert.equal(db.users.get('u2').subscriptionStatus, 'active');

  // By client_reference_id on the checkout session.
  const db3 = fakeDb();
  const stripe3 = fakeStripe({ sub_3: sub({ id: 'sub_3', customer: 'cus_3', metadata: {} }) });
  assert.equal(await billing.handleEvent({ stripe: stripe3, db: db3, env, serverTimestamp: ts, event: ev('checkout.session.completed', { mode: 'subscription', subscription: 'sub_3', client_reference_id: 'u3' }) }), 'applied:active');
  assert.equal(db3.users.get('u3').stripeCustomerId, 'cus_3');

  // Nobody to credit.
  const stripe4 = fakeStripe({ sub_4: sub({ id: 'sub_4', customer: 'cus_4', metadata: {} }) });
  assert.equal(await billing.handleEvent({ stripe: stripe4, db: fakeDb(), env, serverTimestamp: ts, event: ev('customer.subscription.deleted', { id: 'sub_4' }) }), 'unknown-user');
});

test('handleEvent reads older invoice payloads', () => {
  assert.equal(billing.subscriptionIdOf(ev('invoice.payment_failed', { subscription: 'sub_9' })), 'sub_9');
  assert.equal(billing.subscriptionIdOf(ev('invoice.paid', {})), null);
});

test('handleEvent skips a lapsed subscription while another one is live', async () => {
  const db = fakeDb({ u1: { subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + DAY } });
  const stripe = fakeStripe({ sub_1: sub({ status: 'canceled' }) });
  assert.equal(await billing.handleEvent({ stripe, db, env, serverTimestamp: ts, event: ev('customer.subscription.deleted', { id: 'sub_1' }) }), 'skipped-other-live-subscription');
  assert.equal(db.users.get('u1').subscriptionProvider, 'play');
});

test('handleEvent lets a Stripe lookup failure surface so Stripe retries', async () => {
  await assert.rejects(billing.handleEvent({ stripe: fakeStripe(), db: fakeDb(), env, serverTimestamp: ts, event: ev('customer.subscription.updated', { id: 'sub_missing' }) }));
});

// ---- Webhook signatures (the real Stripe library) ------------------------------
test('only correctly signed webhook payloads are accepted', () => {
  const stripe = Stripe('sk_test_dummy');
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify(ev('customer.subscription.updated', { id: 'sub_1' }));
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(Buffer.from(payload), header, secret).type, 'customer.subscription.updated');
  assert.throws(() => stripe.webhooks.constructEvent(Buffer.from(payload.replace('sub_1', 'sub_2')), header, secret));
  assert.throws(() => stripe.webhooks.constructEvent(Buffer.from(payload), header, 'whsec_other'));
  assert.throws(() => stripe.webhooks.constructEvent(Buffer.from(payload), undefined, secret));
});
