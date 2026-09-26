// End-to-end check of card subscriptions: subscribe page → Stripe Checkout →
// signed webhook → access unlocked → billing portal → cancel → locked.
//
// Stripe itself is replaced by a small fake API server, so no Stripe account
// or network access is needed. Run from this folder with:
//   npm run test:e2e:payments
//
// Run that way, this script writes throwaway test settings to
// functions/.env.local and functions/.secret.local (both git-ignored), starts
// the emulators with them, runs itself inside, and deletes the files again.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_STRIPE_PORT = 12111;
const PRICE = 'price_e2e_monthly';
const SECRET_KEY = 'sk_test_e2e';
const WEBHOOK_SECRET = 'whsec_e2e';

// ---- Launcher --------------------------------------------------------------------
if (!process.argv.includes('--inner')) {
  const MARK = '# Written by test/e2e-payments.mjs for the emulator run. Safe to delete.\n';
  const fnDir = path.join(here, '..', 'functions');
  const files = {
    [path.join(fnDir, '.env.local')]: MARK +
      `APP_ORIGIN=http://localhost:8765\nSTRIPE_PRICE_MONTHLY=${PRICE}\nSTRIPE_API_BASE=http://127.0.0.1:${FAKE_STRIPE_PORT}\n`,
    [path.join(fnDir, '.secret.local')]: MARK +
      `STRIPE_SECRET_KEY=${SECRET_KEY}\nSTRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}\n`
  };
  for (const f of Object.keys(files)) {
    if (existsSync(f) && !readFileSync(f, 'utf8').startsWith(MARK)) {
      console.error(`Refusing to overwrite ${f}; move it aside to run this test.`);
      process.exit(1);
    }
  }
  const cleanup = () => { for (const f of Object.keys(files)) { try { unlinkSync(f); } catch { /* gone */ } } };
  for (const [f, body] of Object.entries(files)) writeFileSync(f, body);
  const child = spawn(path.join(here, 'node_modules', '.bin', 'firebase'),
    ['emulators:exec', '--only', 'auth,firestore,functions', '--project', 'demo-duck-hse', 'node test/e2e-payments.mjs --inner'],
    { cwd: path.join(here, '..'), stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('exit', (code) => { cleanup(); process.exit(code == null ? 1 : code); });
} else {
  await run();
}

async function run() {
  const require = createRequire(import.meta.url);
  const Stripe = require('../functions/node_modules/stripe');
  const signer = Stripe('sk_test_signing_only');
  const { BASE, PROJECT, newUser, signUp, userDoc, setUserNumber, resetEmulators, step, report, close } = await import('./e2e-lib.mjs');

  // ---- Fake Stripe API -------------------------------------------------------------
  const calls = [];
  let subscription = null;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      calls.push({ method: req.method, path: req.url.split('?')[0], params, auth: req.headers.authorization });
      const send = (status, obj) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
      const route = `${req.method} ${req.url.split('?')[0]}`;
      if (route === 'POST /v1/customers') return send(200, { id: 'cus_e2e', object: 'customer' });
      if (route === 'POST /v1/checkout/sessions') return send(200, { id: 'cs_e2e', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_e2e' });
      if (route === 'POST /v1/billing_portal/sessions') return send(200, { id: 'bps_e2e', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/e2e' });
      if (route === 'GET /v1/subscriptions/sub_e2e' && subscription) return send(200, subscription);
      send(404, { error: { type: 'invalid_request_error', message: 'No such resource: ' + route } });
    });
  });
  await new Promise((r) => fake.listen(FAKE_STRIPE_PORT, '127.0.0.1', r));
  const lastCall = (p) => [...calls].reverse().find((c) => c.path === p);

  // ---- Signed webhooks ----------------------------------------------------
  const WEBHOOK = `http://127.0.0.1:5001/${PROJECT}/us-central1/stripeWebhook`;
  let n = 0;
  async function sendEvent(type, object, secret = WEBHOOK_SECRET) {
    const payload = JSON.stringify({ id: `evt_e2e_${++n}`, object: 'event', type, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload });
  }

  await resetEmulators();
  let failed = false;
  try {
    // 1. Carol signs up and opens the plans during her trial.
    const carol = await newUser();
    await carol.context().route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Stripe Checkout (test)</h1>' }));
    await carol.context().route('https://billing.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Stripe billing portal (test)</h1>' }));
    const uid = await signUp(carol, 'carol@example.com');
    const trialEndsAt = (await userDoc(uid)).trialEndsAt;
    await carol.goto(BASE + 'subscribe.html');
    await carol.waitForSelector('.buy-btn');
    assert.equal(await carol.textContent('#payTitle'), 'You’re on the free trial');
    assert.match(await carol.textContent('#payStatus'), /not be charged until then/);
    assert.match(await carol.textContent('#payPlans'), /Monthly[\s\S]*\$5[\s\S]*processed securely by Stripe/);
    assert.equal(await carol.isVisible('#payNotInApp'), false);
    assert.equal(await carol.isVisible('#payRestore'), false);
    step('Subscribe page offers card checkout during the trial');
    if (process.env.E2E_SHOTS) {
      await carol.setViewportSize({ width: 390, height: 844 });
      await carol.screenshot({ path: path.join(process.env.E2E_SHOTS, 'subscribe-mobile.png'), fullPage: true });
      await carol.setViewportSize({ width: 1280, height: 800 });
    }

    // 2. Subscribe → the server creates a customer and a Checkout Session.
    await carol.click('.buy-btn[data-product="monthly"]');
    await carol.waitForURL('https://checkout.stripe.com/c/pay/cs_e2e', { timeout: 20000 });
    const cust = lastCall('/v1/customers');
    assert.equal(cust.auth, `Bearer ${SECRET_KEY}`);
    assert.equal(cust.params['metadata[uid]'], uid);
    assert.equal(cust.params.email, 'carol@example.com');
    const sess = lastCall('/v1/checkout/sessions').params;
    assert.equal(sess.mode, 'subscription');
    assert.equal(sess.customer, 'cus_e2e');
    assert.equal(sess.client_reference_id, uid);
    assert.equal(sess['line_items[0][price]'], PRICE);
    assert.equal(sess['subscription_data[metadata][uid]'], uid);
    assert.equal(Number(sess['subscription_data[trial_end]']), Math.floor(trialEndsAt / 1000));
    assert.equal(sess.success_url, BASE + 'subscribe.html?checkout=success');
    assert.equal(sess.cancel_url, BASE + 'subscribe.html?checkout=cancelled');
    assert.equal((await userDoc(uid)).stripeCustomerId, 'cus_e2e');
    step('Subscribe opens Stripe Checkout with the right price, user and trial end');

    // 3. A forged webhook is refused and changes nothing.
    subscription = {
      id: 'sub_e2e', object: 'subscription', status: 'trialing', customer: 'cus_e2e',
      cancel_at_period_end: false, metadata: { uid },
      items: { object: 'list', data: [{ id: 'si_e2e', price: { id: PRICE }, current_period_end: Math.floor(trialEndsAt / 1000) }] }
    };
    const forged = await sendEvent('checkout.session.completed', { mode: 'subscription', subscription: 'sub_e2e', client_reference_id: uid }, 'whsec_wrong');
    assert.equal(forged.status, 400);
    assert.equal((await userDoc(uid)).subscriptionProvider, undefined);
    step('A webhook with a bad signature is rejected');

    // 4. Back from Checkout: the page waits, the webhook lands, the app opens.
    await carol.goto(BASE + 'subscribe.html?checkout=success');
    await carol.waitForFunction(() => /Payment received/.test(document.getElementById('payTitle').textContent));
    const ok = await sendEvent('checkout.session.completed', { mode: 'subscription', subscription: 'sub_e2e', client_reference_id: uid });
    assert.equal(ok.status, 200);
    await carol.waitForURL(/index\.html$/, { timeout: 20000 });
    let u = await userDoc(uid);
    assert.equal(u.subscriptionProvider, 'stripe');
    assert.equal(u.subscriptionStatus, 'active');
    assert.equal(u.subscriptionId, 'monthly');
    assert.equal(u.stripeSubscriptionId, 'sub_e2e');
    await carol.waitForSelector('#managePlanBtn');
    assert.match(await carol.textContent('.sub-panel-title'), /Monthly subscription/);
    step('Paying unlocks the app and the dashboard shows the monthly plan');
    if (process.env.E2E_SHOTS) await (await carol.$('#subscription-panel')).screenshot({ path: path.join(process.env.E2E_SHOTS, 'plan-panel.png') });

    // 5. Manage plan → Stripe billing portal for this customer.
    await carol.click('#managePlanBtn');
    await carol.waitForURL('https://billing.stripe.com/p/session/e2e', { timeout: 20000 });
    const portal = lastCall('/v1/billing_portal/sessions').params;
    assert.equal(portal.customer, 'cus_e2e');
    assert.equal(portal.return_url, BASE + 'index.html');
    step('Manage plan opens the Stripe billing portal');

    // 6. Cancelled in the portal: access continues to the period end.
    subscription = { ...subscription, status: 'active', cancel_at_period_end: true };
    assert.equal((await sendEvent('customer.subscription.updated', { id: 'sub_e2e' })).status, 200);
    await carol.goto(BASE + 'index.html');
    await carol.waitForFunction(() => /Cancelled\. Your access continues until/.test(document.querySelector('.sub-panel-detail')?.textContent || ''), null, { timeout: 15000 });
    step('A cancellation shows until when access continues');

    // 7. Subscription ends after the trial is over → locked out, offered plans again.
    await setUserNumber(uid, 'trialEndsAt', Date.now() - 1000);
    subscription = { ...subscription, status: 'canceled' };
    assert.equal((await sendEvent('customer.subscription.deleted', { id: 'sub_e2e' })).status, 200);
    u = await userDoc(uid);
    assert.equal(u.subscriptionStatus, 'expired');
    // The open dashboard notices on its own and moves to the plans.
    await carol.waitForURL(/subscribe\.html/, { timeout: 20000 });
    await carol.waitForFunction(() => document.getElementById('payTitle').textContent === 'Your subscription has ended', null, { timeout: 15000 });
    step('When the subscription ends the open app locks and shows the plans');

    // 8. Subscribing again: no second free trial.
    await carol.click('.buy-btn[data-product="monthly"]');
    await carol.waitForURL('https://checkout.stripe.com/c/pay/cs_e2e', { timeout: 20000 });
    assert.equal('subscription_data[trial_end]' in lastCall('/v1/checkout/sessions').params, false);
    assert.equal(calls.filter((c) => c.path === '/v1/customers').length, 1, 'customer reused');
    step('Re-subscribing reuses the customer and gives no second trial');

    // 9. Checkout cancelled message.
    await carol.goto(BASE + 'subscribe.html?checkout=cancelled');
    await carol.waitForFunction(() => /not been charged/.test(document.getElementById('payResult').textContent));
    step('Cancelling checkout says nothing was charged');

    assert.deepEqual(carol.errors, [], 'page errors');
    step('No JavaScript errors');
  } catch (err) {
    failed = true;
    await report(err);
    console.error('  fake Stripe calls:', JSON.stringify(calls.map((c) => `${c.method} ${c.path}`)));
  } finally {
    fake.close();
    await close();
  }
  process.exit(failed ? 1 : 0);
}
