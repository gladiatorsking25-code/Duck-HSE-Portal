// Unit tests for the paywall page (public/subscribe.html). Its script is an
// inline block, so it runs here in a VM context with a fake DOM, Google Play,
// Stripe and Firebase.
//   node --test paywall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../public/subscribe.html', import.meta.url), 'utf8');
const SCRIPT_AT = HTML.indexOf('<script>\n(async function');
const MARKUP = HTML.slice(0, SCRIPT_AT);
const SCRIPT = HTML.slice(SCRIPT_AT + '<script>'.length, HTML.indexOf('</script>', SCRIPT_AT));

const LOCKED = { state: 'locked', hasAccess: false, until: null };
const TRIAL = { state: 'trial', hasAccess: true, until: Date.now() + 3 * 86400000 };

// A small stand-in for the page's elements. The ids in the page's markup are
// there from the start; an id drawn later into another element's innerHTML is
// found there, and is a new element each time that innerHTML is replaced.
function fakeDocument() {
  const els = new Map();
  const drawn = new Map();
  function make(id) {
    let html = '';
    return {
      id, hidden: false, textContent: '', href: '', disabled: false, gen: 0, listeners: {}, attrs: {},
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v); this.gen++; },
      insertAdjacentHTML(where, h) { html += h; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      getAttribute(name) { return this.attrs[name]; },
      async click() { for (const fn of this.listeners.click || []) await fn({ preventDefault() {} }); }
    };
  }
  for (const m of MARKUP.matchAll(/<[a-z0-9]+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = make(m[1]);
    el.hidden = /\shidden(?=[\s>])/.test(m[0]);
    els.set(m[1], el);
  }
  function drawnIn(key, parent, attrs) {
    const k = `${key}@${parent.id}#${parent.gen}`;
    if (!drawn.has(k)) { const el = make(key); Object.assign(el.attrs, attrs); drawn.set(k, el); }
    return drawn.get(k);
  }
  return {
    els,
    getElementById(id) {
      if (els.has(id)) return els.get(id);
      for (const parent of els.values()) {
        if (parent.innerHTML.includes(`id="${id}"`)) return drawnIn(id, parent, {});
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel !== '.buy-btn') return [];
      const plans = els.get('payPlans');
      return [...plans.innerHTML.matchAll(/buy-btn" data-product="([^"]+)"/g)]
        .map((m) => drawnIn('buy:' + m[1], plans, { 'data-product': m[1] }));
    },
    querySelector() { return null; }
  };
}

// Runs the page. `play` is what Google Play does; `cached` is the entitlement
// cache from the last visit; `serverDoc` is what users/{uid} holds on the
// server when the page reads it again.
function loadPaywall({
  cached = null, online = true, inTwa = false, play = {}, portal = async () => {}, serverDoc = {}, search = ''
} = {}) {
  const document = fakeDocument();
  const redirects = [];
  const calls = { restore: 0, restoreOnce: 0, portal: 0 };
  const waits = [];
  // The automatic Play check already ran on this launch (js/billing.js).
  const session = new Map([['duck_play_restored', '1']]);
  let paywallCb = null;
  const restore = play.restore || (async () => ({ restored: 0, otherAccount: 0, failed: 0 }));
  const Billing = {
    playReady: play.ready || (async () => false),
    inTwa: () => inTwa,
    getProducts: play.products || (async () => null),
    subscribe: play.subscribe || (async () => ({})),
    restore: async () => restore(++calls.restore),   // told which try this is
    restoreOnce: async () => { calls.restoreOnce++; return null; }
  };
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    URLSearchParams, Promise,
    document,
    navigator: { onLine: online },
    location: { search, replace: (u) => redirects.push(u) },
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    setTimeout: (fn, ms) => { waits.push(ms); setImmediate(fn); return 0; },
    SUBSCRIPTION_CONFIG: {
      SUPPORT_EMAIL: 'support@example.com',
      PRODUCTS: [{ id: 'pro_monthly', label: 'Monthly' }],
      WEB_PAYMENTS: { enabled: true, PLANS: [{ id: 'monthly', label: 'Monthly' }] },
      OFFLINE_PAYMENT: { enabled: false }
    },
    Access: {
      firebaseOn: () => true,
      signOut() {},
      handlePaywallPage: (cb) => { paywallCb = cb; }
    },
    Entitlements: {
      cachedAccess: () => cached,
      computeAccess: (doc) => (doc.subscriptionStatus === 'active' ? { state: 'active', hasAccess: true } : LOCKED),
      daysLeft: () => 3,
      writeCache() {}
    },
    Billing,
    WebBilling: {
      plans: () => [{ id: 'monthly', label: 'Monthly' }],
      portal: async () => { calls.portal++; return portal(); },
      checkout: async () => {}
    },
    firebaseReadyPromise: Promise.resolve({
      firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => serverDoc }) }) }) })
    })
  };
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  const $ = (id) => document.getElementById(id);
  return {
    $, redirects, calls, waits, session,
    buyButtons: () => document.querySelectorAll('.buy-btn'),
    // The live entitlement answer, as js/access.js passes it on.
    async live(access, doc = {}) {
      await settle();
      assert.ok(paywallCb, 'the page asked for the live answer');
      await paywallCb({ configured: true, user: { uid: 'u1' }, access, doc });
      await settle();
    }
  };
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

test('offline, a locked account is shown its read-only records before Google Play or the server answer', async () => {
  const never = () => new Promise(() => {});
  const p = loadPaywall({ cached: LOCKED, online: false, play: { ready: never } });
  await settle();
  assert.equal(p.$('payLapsed').hidden, false);
  assert.equal(p.$('payStatus').textContent, 'You are offline. Subscribing needs a connection; your records are below.');

  const online = loadPaywall({ cached: LOCKED, play: { ready: never } });
  await settle();
  assert.equal(online.$('payLapsed').hidden, false);
  assert.equal(online.$('payStatus').textContent, '', 'online, the live answer writes the status');

  const trial = loadPaywall({ cached: TRIAL, online: false, play: { ready: never } });
  await settle();
  assert.equal(trial.$('payLapsed').hidden, true);
  assert.equal(trial.$('payStatus').textContent, '');
});

test('back from a card payment, the read-only links are not offered while it lands', async () => {
  const p = loadPaywall({ cached: LOCKED, search: '?checkout=success', play: { ready: () => new Promise(() => {}) } });
  await settle();
  assert.equal(p.$('payLapsed').hidden, true);
  const live = loadPaywall({ cached: LOCKED, search: '?checkout=success' });
  await live.live(LOCKED);
  assert.equal(live.$('payTitle').textContent, 'Payment received');
  assert.equal(live.$('payLapsed').hidden, true);
});

test('the live answer still decides once it arrives', async () => {
  const p = loadPaywall({ cached: LOCKED, online: false });
  await p.live(TRIAL);
  assert.equal(p.$('payLapsed').hidden, true);
  assert.match(p.$('payStatus').textContent, /3 days left/);
});

const REVOKED_CARD = { subscriptionStatus: 'revoked', subscriptionProvider: 'stripe', stripeCustomerId: 'cus_1' };

test("a suspended card customer can open Stripe's billing portal", async () => {
  const p = loadPaywall();
  await p.live(LOCKED, REVOKED_CARD);
  assert.equal(p.$('payTitle').textContent, 'This account is suspended');
  assert.match(p.$('payNotice').innerHTML, /contact support[\s\S]*Manage card billing/);
  await p.$('payPortal').click();
  assert.equal(p.calls.portal, 1);
  assert.equal(p.$('payResult').innerHTML, '');
});

test('a billing portal error is shown, and the button can be pressed again', async () => {
  const p = loadPaywall({ portal: async () => { throw new Error('There is no card subscription on this account.'); } });
  await p.live(LOCKED, REVOKED_CARD);
  const btn = p.$('payPortal');
  await btn.click();
  assert.match(p.$('payResult').innerHTML, /banner-danger[\s\S]*There is no card subscription on this account\./);
  assert.equal(btn.disabled, false);
});

test('no billing portal button without a card customer, or inside the Android app', async () => {
  const play = loadPaywall();
  await play.live(LOCKED, { subscriptionStatus: 'revoked', subscriptionProvider: 'play' });
  assert.equal(play.$('payPortal'), null);
  const noCustomer = loadPaywall();
  await noCustomer.live(LOCKED, { subscriptionStatus: 'revoked', subscriptionProvider: 'stripe' });
  assert.equal(noCustomer.$('payPortal'), null);
  const app = loadPaywall({ inTwa: true });
  await app.live(LOCKED, REVOKED_CARD);
  assert.equal(app.$('payPortal'), null);
  assert.match(app.$('payNotice').innerHTML, /contact support/);
});

// Google Play takes the payment, but the server cannot confirm it at first.
function verifyFails() {
  return async () => { const e = new Error('Could not verify the purchase.'); e.code = 'verify'; throw e; };
}

test('a Play purchase the server could not confirm is checked again, and unlocks the account', async () => {
  const p = loadPaywall({
    play: {
      ready: async () => true,
      products: async () => [],
      subscribe: verifyFails(),
      restore: async (n) => (n === 1 ? { restored: 0, otherAccount: 0, failed: 1 } : { restored: 1, otherAccount: 0, failed: 0 })
    },
    serverDoc: { subscriptionStatus: 'active' }
  });
  await p.live(TRIAL);
  await clickBuy(p);
  assert.equal(p.calls.restore, 2);
  assert.ok(p.waits.includes(2000) && p.waits.includes(5000), 'waits before each check');
  assert.match(p.$('payResult').innerHTML, /Your Google Play subscription is active/);
  assert.deepEqual(p.redirects, ['index.html']);
});

test('if it still cannot be confirmed, the page says how to finish, and the automatic check may run again', async () => {
  const p = loadPaywall({
    play: {
      ready: async () => true,
      products: async () => [],
      subscribe: verifyFails(),
      restore: async (n) => { if (n === 1) throw new Error('offline'); return { restored: 0, otherAccount: 0, failed: 1 }; }
    }
  });
  await p.live(TRIAL);
  await clickBuy(p);
  assert.equal(p.calls.restore, 2);
  assert.match(p.$('payResult').innerHTML, /banner-danger[\s\S]*Tap Restore purchases below to finish, or contact support\./);
  assert.equal(p.session.has('duck_play_restored'), false);
  assert.deepEqual(p.redirects, []);
});

test('a purchase confirmed for another account says so, without asking again', async () => {
  const p = loadPaywall({
    play: {
      ready: async () => true,
      products: async () => [],
      subscribe: verifyFails(),
      restore: async () => ({ restored: 0, otherAccount: 1, failed: 0 })
    }
  });
  await p.live(TRIAL);
  await clickBuy(p);
  assert.equal(p.calls.restore, 1);
  assert.match(p.$('payResult').innerHTML, /linked to another Duck HSE account/);
});

// Presses the first plan's Subscribe button and waits for the page.
async function clickBuy(p) {
  const [btn] = p.buyButtons();
  assert.ok(btn, 'a plan is offered');
  await btn.click();
  await settle();
}

test('the automatic Play check runs when Google Play answers after the short wait', async () => {
  const late = loadPaywall({
    inTwa: true,
    play: { ready: async () => false, products: async () => [{ itemId: 'pro_monthly', price: { value: '5', currency: 'USD' } }] }
  });
  await late.live(LOCKED);
  assert.match(late.$('payPlans').innerHTML, /5 USD/);
  assert.equal(late.calls.restoreOnce, 1);

  const none = loadPaywall({ inTwa: true, play: { ready: async () => false, products: async () => null } });
  await none.live(LOCKED);
  assert.equal(none.calls.restoreOnce, 0, 'no Play at all: nothing to check');
});
