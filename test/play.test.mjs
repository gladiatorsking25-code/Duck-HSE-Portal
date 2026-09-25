// Unit tests for functions/play.js with a fake Google Play API and an
// in-memory Firestore stand-in (transactions included). No network.
//   node --test play.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const play = require('../functions/play.js');

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const PKG = 'Duck.HSE.Portal';
const env = {};
const ts = () => 'SERVER_TS';

// ---- Fakes -------------------------------------------------------------------
// Collections of plain objects. Transactions read first, then apply their
// writes only when the callback succeeds, like Firestore.
function fakeDb(initial = {}) {
  const data = {};
  for (const [col, docs] of Object.entries(initial)) {
    data[col] = new Map(Object.entries(docs).map(([k, v]) => [k, { ...v }]));
  }
  const store = (col) => (data[col] = data[col] || new Map());
  const snap = (col, id) => {
    const d = store(col).get(id);
    return { id, exists: !!d, data: () => (d ? { ...d } : undefined) };
  };
  const write = (col, id, patch, opts) => {
    store(col).set(id, opts && opts.merge ? { ...(store(col).get(id) || {}), ...patch } : { ...patch });
  };
  const ref = (col, id) => ({ col, id, async get() { return snap(col, id); } });
  return {
    data,
    doc: (col, id) => (store(col).get(id) ? { ...store(col).get(id) } : undefined),
    collection(col) { return { doc: (id) => ref(col, id) }; },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        async get(r) {
          assert.equal(writes.length, 0, 'all transaction reads come before its writes');
          return snap(r.col, r.id);
        },
        set(r, patch, opts) { writes.push([r.col, r.id, patch, opts]); }
      };
      const out = await fn(tx);
      for (const w of writes) write(...w);
      return out;
    }
  };
}

// purchases: token → Play's subscription resource. Unknown tokens throw, as
// the Play API does (404).
function fakePlay(purchases = {}) {
  const calls = [];
  return {
    calls,
    async verify(packageName, subscriptionId, token) {
      calls.push(['get', packageName, subscriptionId, token]);
      const p = purchases[token];
      if (!p || (p.productId && p.productId !== subscriptionId)) throw Object.assign(new Error('Not found'), { code: 404 });
      return { ...p };
    },
    async acknowledge(packageName, subscriptionId, token) { calls.push(['ack', packageName, subscriptionId, token]); }
  };
}

const live = (over = {}) => ({ expiryTimeMillis: String(NOW + 20 * DAY), paymentState: 1, acknowledgementState: 1, ...over });
const trialUser = { subscriptionStatus: 'trial', trialEndsAt: NOW - DAY, email: 'x@example.com' };

function apply(db, p, over) {
  return play.applyPurchase({
    db, verify: p.verify, acknowledge: p.acknowledge, env, serverTimestamp: ts, now: NOW,
    subscriptionId: 'pro_monthly', source: 'client', ...over
  });
}

// ---- Pure helpers ------------------------------------------------------------
test('config: the package and products come from the server, with safe defaults', () => {
  assert.deepEqual(play.config({}), { packageName: PKG, productIds: ['pro_monthly'] });
  assert.deepEqual(play.config({ PLAY_PACKAGE_NAME: ' com.example.app ', PLAY_PRODUCT_IDS: 'pro_monthly, pro_yearly,' }),
    { packageName: 'com.example.app', productIds: ['pro_monthly', 'pro_yearly'] });
});

test('purchaseStatus maps expiry and payment state', () => {
  assert.deepEqual(play.purchaseStatus(live(), NOW), { status: 'active', expiry: NOW + 20 * DAY, active: true });
  assert.equal(play.purchaseStatus(live({ paymentState: 0 }), NOW).status, 'in_grace');
  assert.equal(play.purchaseStatus(live({ paymentState: 2 }), NOW).status, 'active');
  assert.equal(play.purchaseStatus(live({ expiryTimeMillis: String(NOW - 1) }), NOW).status, 'expired');
  assert.equal(play.purchaseStatus({}, NOW).status, 'expired');
});

test('userPatch keeps an admin revoke and a live card subscription', () => {
  assert.deepEqual(play.userPatch(live(), 'pro_monthly', {}, NOW), {
    subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionId: 'pro_monthly', subscriptionExpiryMillis: NOW + 20 * DAY
  });
  const revoked = play.userPatch(live(), 'pro_monthly', { subscriptionStatus: 'revoked' }, NOW);
  assert.equal('subscriptionStatus' in revoked, false);
  const stripe = { subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW + DAY };
  assert.equal(play.userPatch(live({ expiryTimeMillis: String(NOW - 1) }), 'pro_monthly', stripe, NOW), null);
  assert.equal(play.userPatch(live(), 'pro_monthly', stripe, NOW).subscriptionStatus, 'active');
});

test('validToken refuses what cannot be a Firestore document id', () => {
  assert.equal(play.validToken('abc.DEF-123_x'), true);
  for (const t of ['', 'a/b', '.', '..', '__x__', 'x'.repeat(1001), null, 42]) assert.equal(play.validToken(t), false, String(t));
});

// ---- Verifying from the app --------------------------------------------------
test('a first verification unlocks the account and records who owns the token', async () => {
  const db = fakeDb({ users: { alice: trialUser } });
  const p = fakePlay({ tokA: live({ acknowledgementState: 0 }) });
  const r = await apply(db, p, { uid: 'alice', purchaseToken: 'tokA' });
  assert.deepEqual(r, { status: 'active', expiryTimeMillis: NOW + 20 * DAY });
  const u = db.doc('users', 'alice');
  assert.equal(u.subscriptionProvider, 'play');
  assert.equal(u.subscriptionStatus, 'active');
  assert.equal(u.subscriptionExpiryMillis, NOW + 20 * DAY);
  assert.equal(u.subscriptionUpdatedAt, 'SERVER_TS');
  assert.equal(u.email, 'x@example.com', 'merged, not replaced');
  assert.deepEqual(db.doc('purchaseTokens', 'tokA'), {
    uid: 'alice', packageName: PKG, subscriptionId: 'pro_monthly', linkedPurchaseToken: null, createdAt: NOW, updatedAt: NOW
  });
  assert.deepEqual(p.calls, [['get', PKG, 'pro_monthly', 'tokA'], ['ack', PKG, 'pro_monthly', 'tokA']]);
});

test('the owner can verify the same token again (renewal, restore)', async () => {
  const db = fakeDb({ users: { alice: trialUser } });
  const p = fakePlay({ tokA: live() });
  await apply(db, p, { uid: 'alice', purchaseToken: 'tokA' });
  p.calls.length = 0;
  const renewed = NOW + 50 * DAY;
  const p2 = fakePlay({ tokA: live({ expiryTimeMillis: String(renewed) }) });
  const r = await apply(db, p2, { uid: 'alice', purchaseToken: 'tokA', now: NOW + DAY });
  assert.equal(r.expiryTimeMillis, renewed);
  assert.equal(db.doc('users', 'alice').subscriptionExpiryMillis, renewed);
  assert.equal(db.doc('purchaseTokens', 'tokA').uid, 'alice');
  assert.equal(db.doc('purchaseTokens', 'tokA').createdAt, NOW);
  assert.equal(db.doc('purchaseTokens', 'tokA').updatedAt, NOW + DAY);
  assert.equal(p2.calls.some((c) => c[0] === 'ack'), false, 'already acknowledged');
});

test('a second account cannot use the same token, and nothing changes', async () => {
  const db = fakeDb({ users: { alice: trialUser, bob: trialUser } });
  const p = fakePlay({ tokA: live() });
  await apply(db, p, { uid: 'alice', purchaseToken: 'tokA' });
  await assert.rejects(apply(db, p, { uid: 'bob', purchaseToken: 'tokA' }),
    (e) => e instanceof play.PlayError && e.code === 'failed-precondition' && /another Duck HSE account/.test(e.message));
  assert.deepEqual(db.doc('users', 'bob'), trialUser);
  assert.equal(db.doc('purchaseTokens', 'tokA').uid, 'alice');
});

test('a token that replaced one owned by another account is refused and not acknowledged', async () => {
  const db = fakeDb({ users: { alice: trialUser, bob: trialUser }, purchaseTokens: { tokOld: { uid: 'alice', subscriptionId: 'pro_monthly' } } });
  const p = fakePlay({ tokNew: live({ linkedPurchaseToken: 'tokOld', acknowledgementState: 0 }) });
  await assert.rejects(apply(db, p, { uid: 'bob', purchaseToken: 'tokNew' }), { code: 'failed-precondition' });
  assert.equal(db.doc('purchaseTokens', 'tokNew'), undefined);
  assert.deepEqual(db.doc('users', 'bob'), trialUser);
  assert.equal(p.calls.some((c) => c[0] === 'ack'), false, 'Google refunds a purchase nobody acknowledges');
});

test('a token that replaced one of the same account is accepted and remembers the link', async () => {
  const db = fakeDb({ users: { alice: trialUser }, purchaseTokens: { tokOld: { uid: 'alice', subscriptionId: 'pro_monthly' } } });
  const p = fakePlay({ tokNew: live({ linkedPurchaseToken: 'tokOld' }) });
  await apply(db, p, { uid: 'alice', purchaseToken: 'tokNew' });
  assert.equal(db.doc('purchaseTokens', 'tokNew').uid, 'alice');
  assert.equal(db.doc('purchaseTokens', 'tokNew').linkedPurchaseToken, 'tokOld');
  assert.equal(db.doc('users', 'alice').subscriptionStatus, 'active');
});

test('the link is followed through tokens nobody verified, and across products', async () => {
  const db = fakeDb({ users: { bob: trialUser }, purchaseTokens: { tok1: { uid: 'alice' } } });
  const p = fakePlay({
    tok3: live({ linkedPurchaseToken: 'tok2' }),
    tok2: { productId: 'pro_yearly', linkedPurchaseToken: 'tok1', expiryTimeMillis: String(NOW - DAY) }
  });
  const e2 = { PLAY_PRODUCT_IDS: 'pro_monthly,pro_yearly' };
  await assert.rejects(apply(db, p, { uid: 'bob', purchaseToken: 'tok3', env: e2 }), { code: 'failed-precondition' });
  assert.deepEqual(p.calls.map((c) => c.slice(2)), [['pro_monthly', 'tok3'], ['pro_monthly', 'tok2'], ['pro_yearly', 'tok2']]);
});

test('a link loop or a long chain stops', async () => {
  const db = fakeDb({ users: { alice: trialUser } });
  const loop = fakePlay({ a: live({ linkedPurchaseToken: 'b' }), b: live({ linkedPurchaseToken: 'a' }) });
  await apply(db, loop, { uid: 'alice', purchaseToken: 'a' });
  assert.ok(loop.calls.length < 5);
  const long = {};
  for (let i = 0; i < 20; i++) long['t' + i] = live({ linkedPurchaseToken: 't' + (i + 1) });
  const chain = fakePlay(long);
  await apply(db, chain, { uid: 'alice', purchaseToken: 't0' });
  assert.ok(chain.calls.filter((c) => c[0] === 'get').length <= 6);
});

test('a revoked account stays revoked, but the token is still recorded for it', async () => {
  const revoked = { subscriptionStatus: 'revoked', trialEndsAt: NOW - DAY };
  const db = fakeDb({ users: { eve: revoked } });
  await apply(db, fakePlay({ tokE: live() }), { uid: 'eve', purchaseToken: 'tokE' });
  assert.equal(db.doc('users', 'eve').subscriptionStatus, 'revoked');
  assert.equal(db.doc('users', 'eve').subscriptionProvider, 'play');
  assert.equal(db.doc('purchaseTokens', 'tokE').uid, 'eve');
});

test('a lapsed Play purchase does not end a live card subscription', async () => {
  const card = { subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW + 5 * DAY };
  const db = fakeDb({ users: { carol: card } });
  const r = await apply(db, fakePlay({ tokC: live({ expiryTimeMillis: String(NOW - DAY) }) }), { uid: 'carol', purchaseToken: 'tokC' });
  assert.equal(r.status, 'expired');
  assert.deepEqual(db.doc('users', 'carol'), card);
  assert.equal(db.doc('purchaseTokens', 'tokC').uid, 'carol');
});

test('products that are not offered and unreadable tokens are refused before calling Play', async () => {
  const db = fakeDb();
  const p = fakePlay({ tokA: live() });
  await assert.rejects(apply(db, p, { uid: 'alice', purchaseToken: 'tokA', subscriptionId: 'free_forever' }), { code: 'invalid-argument' });
  await assert.rejects(apply(db, p, { uid: 'alice', purchaseToken: 'a/b' }), { code: 'invalid-argument' });
  await assert.rejects(apply(db, p, { uid: 'alice', purchaseToken: { $gt: '' } }), { code: 'invalid-argument' });
  await assert.rejects(apply(db, p, { uid: '', purchaseToken: 'tokA' }), { code: 'unauthenticated' });
  assert.deepEqual(p.calls, []);
});

test('the server checks its own package, whatever the app sends', async () => {
  const db = fakeDb();
  const p = fakePlay({ tokA: live() });
  await apply(db, p, { uid: 'alice', purchaseToken: 'tokA', packageName: 'com.attacker.app' });
  assert.equal(p.calls[0][1], PKG);
});

test('a failed acknowledge does not fail the verification', async () => {
  const db = fakeDb();
  const p = fakePlay({ tokA: live({ acknowledgementState: 0 }) });
  p.acknowledge = async () => { throw new Error('permission denied'); };
  const r = await apply(db, p, { uid: 'alice', purchaseToken: 'tokA' });
  assert.equal(r.status, 'active');
});

test('a Play API error is passed on, and nothing is written', async () => {
  const db = fakeDb({ users: { alice: trialUser } });
  await assert.rejects(apply(db, fakePlay({}), { uid: 'alice', purchaseToken: 'nope' }), { code: 404 });
  assert.deepEqual(db.doc('users', 'alice'), trialUser);
  assert.equal(db.doc('purchaseTokens', 'nope'), undefined);
});

// ---- Real-time Developer Notifications ---------------------------------------
const rtdn = (token, over = {}) => ({ packageName: PKG, subscriptionNotification: { notificationType: 2, purchaseToken: token, subscriptionId: 'pro_monthly' }, ...over });
function notify(db, p, payload, now = NOW) {
  return play.handleNotification({ db, verify: p.verify, acknowledge: p.acknowledge, payload, env, serverTimestamp: ts, now });
}

test('a renewal notification updates the account that owns the token', async () => {
  const db = fakeDb({
    users: { alice: { subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW - 1 } },
    purchaseTokens: { tokA: { uid: 'alice', subscriptionId: 'pro_monthly' } }
  });
  assert.equal(await notify(db, fakePlay({ tokA: live() }), rtdn('tokA')), 'applied:active');
  assert.equal(db.doc('users', 'alice').subscriptionExpiryMillis, NOW + 20 * DAY);
});

test('a notification for a new token that replaced a known one goes to that owner', async () => {
  const db = fakeDb({ users: { alice: trialUser }, purchaseTokens: { tokOld: { uid: 'alice', subscriptionId: 'pro_monthly' } } });
  const p = fakePlay({ tokNew: live({ linkedPurchaseToken: 'tokOld' }) });
  assert.equal(await notify(db, p, rtdn('tokNew')), 'applied:active');
  assert.equal(db.doc('purchaseTokens', 'tokNew').uid, 'alice');
  assert.equal(db.doc('users', 'alice').subscriptionStatus, 'active');
  assert.equal(p.calls.filter((c) => c[0] === 'get').length, 1, 'the purchase is read from Play once');
});

test('a notification about a cancellation or refund ends access', async () => {
  const db = fakeDb({ users: { alice: { subscriptionProvider: 'play', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW + DAY } }, purchaseTokens: { tokA: { uid: 'alice', subscriptionId: 'pro_monthly' } } });
  assert.equal(await notify(db, fakePlay({ tokA: live({ expiryTimeMillis: String(NOW - 1) }) }), rtdn('tokA')), 'applied:expired');
  assert.equal(db.doc('users', 'alice').subscriptionStatus, 'expired');
});

test('a revoked owner stays revoked when a renewal arrives', async () => {
  const db = fakeDb({ users: { eve: { subscriptionStatus: 'revoked' } }, purchaseTokens: { tokE: { uid: 'eve', subscriptionId: 'pro_monthly' } } });
  await notify(db, fakePlay({ tokE: live() }), rtdn('tokE'));
  assert.equal(db.doc('users', 'eve').subscriptionStatus, 'revoked');
});

test('unknown tokens, test notifications and other apps are ignored', async () => {
  const db = fakeDb();
  const p = fakePlay({ tokX: live() });
  assert.equal(await notify(db, p, rtdn('tokX')), 'unknown-token');
  assert.equal(db.doc('purchaseTokens', 'tokX'), undefined);
  assert.equal(await notify(db, p, { packageName: PKG, testNotification: { version: '1.0' } }), 'ignored');
  assert.equal(await notify(db, p, rtdn('tokX', { packageName: 'com.other.app' })), 'other-package');
  assert.equal(await notify(db, p, rtdn('a/b')), 'bad-token');
});
