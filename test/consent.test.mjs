// Unit tests for the Terms / Privacy acceptance record (public/js/consent.js)
// and the legal pages that describe it. consent.js is a plain browser script,
// so it runs here in a VM context with a fake localStorage, DOM and Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const SRC = read('../public/js/consent.js');
const KEY = 'cla_tos_privacy_accepted_v1';
const SERVER_TIME = { serverTimestamp: true };

// A fake Firebase: `user` is the signed-in account (or null), `account` the
// users/{uid} document it reads, `failures` the error codes the next update()
// calls fail with, in order.
function fakeFirebase({ user = null, account = null, failures = [] } = {}) {
  const writes = [];
  const firestore = () => ({
    collection: (c) => ({
      doc: (id) => ({
        async update(data) {
          writes.push({ op: 'update', path: `${c}/${id}`, data });
          const code = failures.shift();
          if (code) { const e = new Error(code); e.code = code; throw e; }
        },
        async set(data) { writes.push({ op: 'set', path: `${c}/${id}`, data }); },
        async get() { return { exists: !!account, data: () => account }; }
      })
    })
  });
  firestore.FieldValue = { serverTimestamp: () => SERVER_TIME };
  const fb = {
    auth: () => ({ onAuthStateChanged(cb) { setImmediate(() => cb(user)); return () => {}; } }),
    firestore
  };
  return { fb, writes };
}

// Just enough DOM for the acceptance screen.
function fakeDocument() {
  const byId = {};
  const listeners = {};
  function el(id) {
    const handlers = {};
    return {
      id, style: {}, checked: false, disabled: false, handlers,
      addEventListener(type, fn) { handlers[type] = fn; },
      remove() { if (byId[this.id] === this) delete byId[this.id]; delete byId.consentCheckbox; delete byId.consentAcceptBtn; }
    };
  }
  return {
    byId,
    body: {
      appendChild(node) {
        byId[node.id] = node;
        // The screen's controls are written as HTML; register them by id.
        for (const m of String(node.innerHTML).matchAll(/id="([\w-]+)"/g)) byId[m[1]] = el(m[1]);
      }
    },
    createElement: () => el(''),
    getElementById: (id) => byId[id] || null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).splice(0).forEach((fn) => fn()); }
  };
}

function load({ firebase = fakeFirebase(), stored } = {}) {
  const store = new Map();
  if (stored !== undefined) store.set(KEY, JSON.stringify(stored));
  const delays = [];
  const document = fakeDocument();
  const ctx = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document,
    setTimeout: (fn, ms) => { delays.push(ms); setImmediate(fn); },
    firebaseReadyPromise: Promise.resolve(firebase.fb),
    firebase: firebase.fb
  });
  vm.runInContext(SRC, ctx, { filename: 'consent.js' });
  const run = (code) => vm.runInContext(code, ctx);
  return {
    run, document, delays, writes: firebase.writes,
    record: () => JSON.parse(store.get(KEY) || 'null'),
    version: run('CONSENT_VERSION')
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('the browser tests pre-accept the current version', () => {
  const { version } = load();
  assert.equal(version, '2026-09-25');
  assert.ok(read('./e2e-lib.mjs').includes(`version: '${version}'`), 'test/e2e-lib.mjs must use CONSENT_VERSION');
});

test('only the current version counts as accepted', () => {
  assert.equal(load().run('hasAcceptedConsent()'), false);
  assert.equal(load({ stored: { version: '2026-09-24.3', acceptedAt: 'x' } }).run('hasAcceptedConsent()'), false);
  assert.equal(load({ stored: 'nonsense' }).run('hasAcceptedConsent()'), false);
  assert.equal(load({ stored: { version: '2026-09-25', acceptedAt: 'x' } }).run('hasAcceptedConsent()'), true);
});

test('sign-up records the acceptance on the device and with the account', async () => {
  const c = load();
  const ok = await c.run("recordConsentAcceptance('u1')");
  assert.equal(ok, true);
  assert.equal(c.writes.length, 1);
  const [w] = c.writes;
  assert.equal(w.op, 'update', 'update(), never set(): the server creates the account document');
  assert.equal(w.path, 'users/u1');
  assert.deepEqual(Object.keys(w.data).sort(), ['consentAcceptedAt', 'consentVersion'], 'only the two consent fields');
  assert.equal(w.data.consentVersion, c.version);
  assert.equal(w.data.consentAcceptedAt, SERVER_TIME, 'time set by the server');
  const rec = c.record();
  assert.equal(rec.version, c.version);
  assert.equal(rec.uid, 'u1');
  assert.equal(rec.onServer, true);
  assert.ok(!Number.isNaN(Date.parse(rec.acceptedAt)));
});

test('a missing account document is retried briefly, then left for the next page', async () => {
  const late = load({ firebase: fakeFirebase({ failures: ['not-found', 'not-found', 'permission-denied'] }) });
  assert.equal(await late.run("recordConsentAcceptance('u1')"), true);
  assert.equal(late.writes.length, 4);
  assert.deepEqual(late.delays, [1000, 2000, 3000]);
  assert.equal(late.record().onServer, true);

  const never = load({ firebase: fakeFirebase({ failures: Array(10).fill('not-found') }) });
  assert.equal(await never.run("recordConsentAcceptance('u1')"), false);
  assert.equal(never.writes.length, 6, 'five retries after the first try');
  assert.equal(never.record().onServer, false, 'still marked as not sent');
  assert.equal(never.run('hasAcceptedConsent()'), true, 'the user is never blocked');

  const other = load({ firebase: fakeFirebase({ failures: ['invalid-argument'] }) });
  assert.equal(await other.run("recordConsentAcceptance('u1')"), false);
  assert.equal(other.writes.length, 1, 'other errors are not retried');
});

test('two calls for the same account share one write', async () => {
  const c = load();
  const [a, b] = await c.run("Promise.all([recordConsentOnServer('u1'), recordConsentOnServer('u1')])");
  assert.equal(a && b, true);
  assert.equal(c.writes.length, 1);
});

test('the acceptance screen records for the signed-in account', async () => {
  const c = load({ firebase: fakeFirebase({ user: { uid: 'u2' } }) });
  c.run('requireConsent()');
  c.document.fire('DOMContentLoaded');
  const { consentOverlay, consentCheckbox, consentAcceptBtn } = c.document.byId;
  assert.ok(consentOverlay, 'screen shown');
  assert.match(consentOverlay.innerHTML, /terms\.html/);
  assert.match(consentOverlay.innerHTML, /privacy\.html/);
  assert.match(consentOverlay.innerHTML, /outside the UAE/);

  consentAcceptBtn.handlers.click();
  assert.equal(c.record(), null, 'nothing recorded before the box is ticked');

  consentCheckbox.checked = true;
  consentCheckbox.handlers.change();
  assert.equal(consentAcceptBtn.disabled, false);
  consentAcceptBtn.handlers.click();
  assert.equal(c.document.byId.consentOverlay, undefined, 'screen closed at once');
  assert.equal(c.record().version, c.version);
  for (let i = 0; i < 10 && !(c.record() || {}).onServer; i++) await tick();
  assert.deepEqual(c.writes.map((w) => w.path), ['users/u2']);
  assert.equal(c.record().uid, 'u2');
  assert.equal(c.record().onServer, true);
});

test('accepting while signed out stays on the device', async () => {
  const c = load();
  assert.equal(await c.run('recordConsentAcceptance()'), false);
  assert.equal(c.writes.length, 0);
  assert.equal(c.record().uid, null);
  assert.equal(c.run('hasAcceptedConsent()'), true);
});

test('an app page finishes sending an acceptance the account has not got yet', async () => {
  const stored = { version: '2026-09-25', acceptedAt: '2026-09-25T08:00:00.000Z', uid: 'u1', onServer: false };
  const c = load({ firebase: fakeFirebase({ user: { uid: 'u1' } }), stored });
  assert.equal(await c.run('checkConsentForAccount()'), 'sent');
  assert.deepEqual(c.writes.map((w) => w.path), ['users/u1']);
  assert.equal(c.record().onServer, true);

  const done = load({ firebase: fakeFirebase({ user: { uid: 'u1' } }), stored: Object.assign({}, stored, { onServer: true }) });
  assert.equal(await done.run('checkConsentForAccount()'), 'ok');
  assert.equal(done.writes.length, 0);
});

test('an acceptance is never attributed to an account that did not give it', async () => {
  // Accepted before the account could be checked: this device only.
  const noUid = load({ firebase: fakeFirebase({ user: { uid: 'u1' } }), stored: { version: '2026-09-25', acceptedAt: 'x' } });
  assert.equal(await noUid.run('checkConsentForAccount()'), 'device');
  assert.equal(noUid.writes.length, 0);

  // Accepted by someone else on a shared device, and this account has not
  // accepted this version: ask again, write nothing.
  const other = { version: '2026-09-25', acceptedAt: 'x', uid: 'someone-else', onServer: true };
  const ask = load({ firebase: fakeFirebase({ user: { uid: 'u1' }, account: { consentVersion: '2026-09-24.3' } }), stored: other });
  assert.equal(await ask.run('checkConsentForAccount()'), 'asked');
  assert.ok(ask.document.byId.consentOverlay, 'screen shown');
  assert.equal(ask.writes.length, 0);
  assert.equal(ask.record().uid, 'someone-else');

  // ...unless this account already accepted this version elsewhere.
  const at = { toDate: () => new Date('2026-09-25T09:30:00.000Z') };
  const known = load({ firebase: fakeFirebase({ user: { uid: 'u1' }, account: { consentVersion: '2026-09-25', consentAcceptedAt: at } }), stored: other });
  assert.equal(await known.run('checkConsentForAccount()'), 'account');
  assert.equal(known.document.byId.consentOverlay, undefined);
  assert.deepEqual(known.record(), { version: '2026-09-25', acceptedAt: '2026-09-25T09:30:00.000Z', uid: 'u1', onServer: true });
});

test('sign-up asks for acceptance, with Terms and Privacy links, before the account is created', () => {
  const html = read('../public/login.html');
  assert.match(html, /<script src="js\/consent\.js"><\/script>/);
  const row = html.match(/<label id="termsRow"[\s\S]*?<\/label>/);
  assert.ok(row, 'acceptance row');
  assert.match(row[0], /type="checkbox" id="termsAccept"/);
  assert.match(row[0], /href="terms\.html"/);
  assert.match(row[0], /href="privacy\.html"/);
  assert.match(html, /\$\('termsAccept'\)\.required = m === 'signup'/);
  const submit = html.slice(html.indexOf("addEventListener('submit'"));
  const check = submit.indexOf("!$('termsAccept').checked");
  const pending = submit.indexOf('signupConsentPending = true');
  const signUp = submit.indexOf('CloudAuth.signUp(');
  assert.ok(check !== -1 && check < pending && pending < signUp, 'checked before the account is created');
  // Recorded from the auth listener, which runs before the page can move on.
  assert.match(html, /onAuthStateChanged\(recordSignupConsent\)/);
  assert.match(html, /function recordSignupConsent\(user\) \{[\s\S]*?recordConsentAcceptance\(user\.uid\)/);
});

test('the legal pages describe the Drive upload, the consent record and backup retention', () => {
  const privacy = read('../public/privacy.html');
  assert.doesNotMatch(privacy, /are not uploaded, unless/);
  assert.match(privacy, /Upload to Drive/);
  assert.match(privacy, /drive\.file/);
  assert.match(privacy, /Full Drive/);
  assert.match(privacy, /never receives the pack or the access token/);
  assert.match(privacy, /recorded with your account/);
  assert.match(privacy, /kept by number, not by date/);

  const deletion = read('../public/account-deletion.html');
  assert.doesNotMatch(deletion, /about a month/);
  assert.doesNotMatch(deletion, /acceptance record<\/td><td>This device only/);
  assert.match(deletion, /Upload to Drive/);
  assert.match(deletion, /admin tool/);
  assert.match(deletion, /kept by number, not by date/);
});
