// Unit tests for the page gate's read-only mode (public/js/access.js) and the
// backup-file checks on the Settings page (public/js/backup-import.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const BackupImport = require('../public/js/backup-import.js');

const ACCESS_JS = readFileSync(new URL('../public/js/access.js', import.meta.url), 'utf8');
const LOCKED = { state: 'locked', hasAccess: false, until: null };
const TRIAL = { state: 'trial', hasAccess: true, until: Date.now() + 86400000 };

// Loads access.js into a fresh browser-like context. `cached` is what the
// entitlement cache says before the live check; the test then plays the live
// auth and entitlement events through `signIn` and `entitlement`.
function load({ page = 'project.html', search = '?id=p1', signedIn = true, cached = null } = {}) {
  const redirects = [];
  let authCb = null;
  let entCb = null;
  const store = new Map(signedIn ? [['cla_cloud_signed_in', '1']] : []);
  const ctx = {
    console,
    URLSearchParams,
    location: { pathname: '/' + page, search, replace: (u) => redirects.push(u) },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    FIREBASE_READY: true,
    firebaseReadyPromise: Promise.resolve({ auth: () => ({ onAuthStateChanged: (cb) => { authCb = cb; } }) }),
    Entitlements: {
      cachedAccess: () => cached,
      clearCache() {}, stop() {},
      watch: (uid, cb) => { entCb = cb; return () => {}; }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ACCESS_JS, ctx);
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    Access: ctx.Access,
    redirects,
    async signIn(user = { uid: 'u1' }) { await tick(); authCb(user); },
    entitlement(access) { entCb(access, {}); }
  };
}

test('a lapsed account stays on an allowLapsed page, read-only', async () => {
  const t = load({ cached: LOCKED });
  t.Access.requireAccess({ allowLapsed: true });
  assert.equal(t.Access.readOnly, true, 'read-only from the cached state at once');
  await t.signIn();
  t.entitlement(LOCKED);
  assert.deepEqual(t.redirects, [], 'never sent to the paywall');
  assert.equal(t.Access.readOnly, true);
});

test('other pages still send a lapsed account to the paywall', async () => {
  const t = load({ cached: LOCKED });
  t.Access.requireAccess();
  assert.deepEqual(t.redirects, ['subscribe.html?next=project.html%3Fid%3Dp1']);
  const live = load({ page: 'index.html', search: '', cached: TRIAL });
  live.Access.requireAccess();
  await live.signIn();
  live.entitlement(LOCKED);
  assert.deepEqual(live.redirects, ['subscribe.html?next=index.html']);
  assert.equal(live.Access.readOnly, false);
});

test('access ending while the page is open turns it read-only; access starting turns it back', async () => {
  const t = load({ cached: TRIAL });
  t.Access.requireAccess({ allowLapsed: true });
  const seen = [];
  t.Access.onReadOnlyChange((ro) => seen.push(ro));
  const banner = { hidden: true, innerHTML: '' };
  t.Access.readOnlyBanner(banner);
  await t.signIn();
  t.entitlement(TRIAL);
  assert.equal(t.Access.readOnly, false);
  t.entitlement(LOCKED);
  assert.equal(t.Access.readOnly, true);
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /trial or subscription has ended[\s\S]*href="subscribe\.html"/);
  t.entitlement(LOCKED);   // no repeat notification for the same state
  t.entitlement({ state: 'active', hasAccess: true, until: null });
  assert.equal(t.Access.readOnly, false);
  assert.equal(banner.hidden, true);
  assert.equal(banner.innerHTML, '');
  assert.deepEqual(seen, [false, true, false], 'called at once, then on each change');
  assert.deepEqual(t.redirects, []);
});

test('sign-in is still required on an allowLapsed page', async () => {
  const out = load({ signedIn: false, cached: LOCKED });
  out.Access.requireAccess({ allowLapsed: true });
  assert.deepEqual(out.redirects, ['login.html?next=project.html%3Fid%3Dp1']);

  const t = load({ page: 'settings.html', search: '', cached: LOCKED });
  t.Access.requireAccess({ allowLapsed: true });
  await t.signIn(null);
  assert.deepEqual(t.redirects, ['login.html?next=settings.html']);
});

test('Access.readOnly cannot be set from outside', () => {
  const t = load({ cached: LOCKED });
  t.Access.requireAccess({ allowLapsed: true });
  assert.throws(() => { 'use strict'; t.Access.readOnly = false; }, TypeError);
  assert.equal(t.Access.readOnly, true);
});

test('after signing in, a lapsed account goes on to a read-only page it asked for', async () => {
  const go = async (next) => {
    const t = load({ page: 'login.html', search: next == null ? '' : '?next=' + encodeURIComponent(next) });
    t.Access.handleLoginPage(() => {});
    await t.signIn();
    t.entitlement(LOCKED);
    return t.redirects;
  };
  assert.deepEqual(await go('project.html?id=abc'), ['project.html?id=abc']);
  assert.deepEqual(await go('projects.html'), ['projects.html']);
  assert.deepEqual(await go('settings.html'), ['settings.html']);
  assert.deepEqual(await go('account-deletion.html'), ['account-deletion.html']);
  assert.deepEqual(await go('index.html'), ['subscribe.html']);
  assert.deepEqual(await go('permit.html?id=x'), ['subscribe.html']);
  assert.deepEqual(await go('https://evil.example/project.html'), ['subscribe.html']);
  assert.deepEqual(await go(null), ['subscribe.html']);
});

// ---- Backup files on the Settings page -------------------------------------------

test('a personal backup is accepted, with its counts', () => {
  const r = BackupImport.check({ exportedAt: 'x', assessments: [{ id: 'a' }], permits: [{ id: 'p' }, { id: 'q' }], checklists: [] });
  assert.deepEqual(r, { ok: true, counts: { assessments: 1, permits: 2, checklists: 0 } });
  // Backups made before checklists existed have no checklists list.
  assert.equal(BackupImport.check({ assessments: [], permits: [{ id: 'p' }] }).ok, true);
});

test('a project backup is refused, pointing to the project page', () => {
  const r = BackupImport.check({ format: 'duck-hse-project-backup', projectId: 'p1', items: [], files: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /project backup[\s\S]*project's page/);
});

test('other files are refused before anything is changed', () => {
  for (const data of [null, 42, 'text', [], [{ id: 'a' }], {}, { foo: 1 }, { items: [] }]) {
    const r = BackupImport.check(data);
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.match(r.error, /not a Duck HSE Portal backup/);
  }
  for (const data of [{ permits: 'x', assessments: [] }, { permits: [1, 2] }, { checklists: [null] }, { assessments: [[]] }]) {
    const r = BackupImport.check(data);
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.match(r.error, /damaged/);
  }
});

test('the result uses the counts importAll returns, else the file counts', () => {
  const data = { assessments: [{}, {}], permits: [{}], checklists: [{}, {}, {}] };
  assert.deepEqual(BackupImport.resultCounts({ assessments: 0, permits: 1, checklists: 2 }, data), { assessments: 0, permits: 1, checklists: 2 });
  assert.deepEqual(BackupImport.resultCounts(undefined, data), { assessments: 2, permits: 1, checklists: 3 });
  assert.deepEqual(BackupImport.resultCounts({ permits: 5 }, data), { assessments: 2, permits: 5, checklists: 3 });
});

test('counts are described in plain words', () => {
  assert.equal(BackupImport.describe({ assessments: 0, permits: 1, checklists: 3 }),
    '3 inspection checklists, 1 permit and 0 lift assessments');
  assert.equal(BackupImport.describe({ assessments: 1, permits: 2, checklists: 1 }),
    '1 inspection checklist, 2 permits and 1 lift assessment');
});
