// Unit tests for the device data layer and cloud sync: public/js/storage.js
// (DB), public/js/firebase-auth.js (DeviceData) and public/js/cloud-sync.js.
// The browser scripts run in a vm context with an in-memory localStorage,
// a small IndexedDB stand-in and a scripted Firestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = (f) => readFileSync(new URL('../public/js/' + f, import.meta.url), 'utf8');
const SCRIPTS = ['storage.js', 'permit-types.js', 'firebase-auth.js', 'cloud-sync.js'].map((f) => [f, source(f)]);
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// Values from the vm context have that context's prototypes, so compare
// them as plain JSON.
const same = (actual, expected, msg) => assert.deepEqual(clone(actual ?? null), clone(expected ?? null), msg);

// ---- Browser stand-ins ------------------------------------------------------

function makeStorage() {
  const m = new Map();
  let quota = Infinity;
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      v = String(v);
      const old = m.has(k) ? k.length + m.get(k).length : 0;
      if (used() - old + k.length + v.length > quota) {
        const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
      }
      m.set(k, v);
    },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    setQuota(q) { quota = q; },
    used
  };
}

// Just enough IndexedDB for DeviceData's stash: one store, get/put/delete,
// completion events on a later tick. `failWrites` makes writes abort, and
// `stallWrites` makes them never finish (a completely full disk).
function makeIndexedDB() {
  const dbs = new Map();
  const idb = {
    failWrites: false,
    stallWrites: false,
    open(name) {
      const req = {};
      setTimeout(() => {
        let stores = dbs.get(name);
        const fresh = !stores;
        if (fresh) { stores = new Map(); dbs.set(name, stores); }
        req.result = {
          objectStoreNames: { contains: (s) => stores.has(s) },
          createObjectStore: (s, o) => { stores.set(s, { keyPath: o.keyPath, data: new Map() }); },
          close() {},
          transaction(s, mode) {
            const store = stores.get(s);
            const tx = {};
            const ops = [];
            tx.objectStore = () => ({
              get(key) { const r = { result: clone(store.data.get(key)) }; return r; },
              put(v) { ops.push(() => store.data.set(v[store.keyPath], clone(v))); },
              delete(key) { ops.push(() => store.data.delete(key)); }
            });
            setTimeout(() => {
              if (mode === 'readwrite' && idb.stallWrites) return;
              if (mode === 'readwrite' && idb.failWrites) { tx.error = new Error('disk full'); if (tx.onabort) tx.onabort(); return; }
              ops.forEach((op) => op());
              if (tx.oncomplete) tx.oncomplete();
            }, 0);
            return tx;
          }
        };
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
    stash(uid) {
      const s = dbs.get('cla_device_stash_v1');
      return s && s.get('stash') ? clone(s.get('stash').data.get(uid)) : undefined;
    }
  };
  return idb;
}

// A scripted Firestore: the test decides when snapshots arrive and when the
// server confirms writes.
function makeFirestore() {
  const docs = new Map();     // 'users/u/permits' -> Map(id -> data)
  const listeners = [];
  const writes = [];
  const coll = (path) => {
    if (!docs.has(path)) docs.set(path, new Map());
    return docs.get(path);
  };
  const api = {
    collection: (c) => ({ doc: (d) => ({ collection: (sub) => collectionRef(`${c}/${d}/${sub}`) }) })
  };
  function collectionRef(path) {
    return {
      onSnapshot(opts, next) {
        const l = { path, next, live: true };
        listeners.push(l);
        return () => { l.live = false; };
      },
      doc(id) {
        // Like the SDK: an id that cannot name a document throws at once.
        if (typeof id !== 'string' || id.includes('/')) throw new Error(`Invalid document reference: ${id}`);
        return {
          set(data, options) {
            return new Promise((resolve, reject) => writes.push({ path, id, data: clone(data), options, resolve, reject }));
          }
        };
      }
    };
  }
  return {
    firestore: () => api,
    docs, writes, listeners,
    put(path, id, data) { coll(path).set(id, clone(data)); },
    // Delivers the current documents to every live listener on `path`.
    emit(path, { fromCache = false, pendingIds = [] } = {}) {
      const snap = {
        metadata: { fromCache },
        docs: [...coll(path)].map(([id, data]) => ({ id, data: () => clone(data), metadata: { hasPendingWrites: pendingIds.includes(id) } }))
      };
      listeners.filter((l) => l.live && l.path === path).forEach((l) => l.next(snap));
    },
    // The server accepts (or refuses) every write so far.
    async ack(code) {
      const batch = writes.splice(0);
      batch.forEach((w) => {
        if (code) { const e = new Error(code); e.code = code; w.reject(e); return; }
        coll(w.path).set(w.id, clone(w.data));
        w.resolve();
      });
      await settle();
      return batch;
    }
  };
}

function browser({ firestore, uid = null } = {}) {
  const events = [];
  const fb = firestore ? {
    firestore: firestore.firestore, apps: [1],
    auth: () => ({ currentUser: uid ? { uid } : null, signOut: async () => { events.push({ signOut: true }); } })
  } : undefined;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: makeStorage(),
    indexedDB: makeIndexedDB(),
    navigator: {},
    alert: (m) => events.push({ alert: m }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    FIREBASE_READY: !!firestore,
    firebaseReadyPromise: Promise.resolve(fb || null),
    firebase: fb
  };
  ctx.document = { dispatchEvent: (e) => events.push({ event: e.type, detail: e.detail }) };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  SCRIPTS.forEach(([f, code]) => vm.runInContext(code, ctx, { filename: f }));
  const get = (name) => vm.runInContext(name, ctx);
  return { ctx, events, ls: ctx.localStorage, idb: ctx.indexedDB, DB: get('DB'), DeviceData: get('DeviceData'), CloudSync: get('CloudSync'), PermitTypes: ctx.PermitTypes };
}
const list = (b, key) => JSON.parse(b.ls.getItem(key) || '[]');

// ---- Keys shared between files ----------------------------------------------

test('DeviceData, DB and CloudSync agree on the storage keys', () => {
  const b = browser();
  same(b.DeviceData.LIST_KEYS.slice(0, 3), [b.DB.KEYS.assessments, b.DB.KEYS.permits, b.DB.KEYS.checklists]);
  assert.equal(b.DeviceData.LIST_KEYS[3], 'cla_sync_deletes');
  assert.equal(b.DeviceData.LIST_KEYS[4], 'cla_cert_purge', 'photos to delete move with the account too');
  assert.equal(b.DeviceData.OWNER_KEY, b.DB.DEVICE_KEYS.owner);
  assert.equal(b.DeviceData.SWAP_KEY, b.DB.DEVICE_KEYS.swap);
  assert.equal(b.DeviceData.COUNTER_PREFIX, b.DB.KEYS.counter);
});

// ---- storage.js ---------------------------------------------------------------

test('saves stamp a time that never goes backwards and stay pending until synced', () => {
  const b = browser();
  const p = b.DB.savePermit({ id: 'P-1', location: 'Berth 4' });
  assert.equal(p._pending, true);
  assert.ok(p.updatedAt >= Date.now() - 1000);
  // Another device's clock was ahead: the next save here is still newer.
  const stored = list(b, 'cla_permits');
  stored[0].updatedAt = Date.now() + 3600e3;
  b.ls.setItem('cla_permits', JSON.stringify(stored));
  const again = b.DB.savePermit({ id: 'P-1', location: 'Berth 5' });
  assert.equal(again.updatedAt, stored[0].updatedAt + 1);
  assert.equal(b.DB.getPermits().length, 1);
  assert.equal(b.DB.getPermits()[0].permitType, 'lifting');
  assert.equal(b.DB.exportAll().permits[0]._pending, undefined, 'backups leave out the sync flag');
});

test('tombstones and junk entries never show in the lists', () => {
  const b = browser();
  b.ls.setItem('cla_checklists', JSON.stringify([{ id: 'C-1' }, { id: 'C-2', deleted: true, updatedAt: 5 }, null, 'x']));
  same(b.DB.getChecklists().map((c) => c.id), ['C-1']);
  b.ls.setItem('cla_assessments', '{"not":"a list"}');
  same(b.DB.getAssessments(), []);
});

test('while another account\'s records are moved out, lists read empty and saves are refused', () => {
  const b = browser();
  b.DB.saveChecklist({ id: 'C-1', assetNo: 'FL-07' });
  b.ls.setItem('cla_data_swap', JSON.stringify({ from: 'a', to: 'b', parked: false }));
  same(b.DB.getChecklists(), []);
  assert.equal(b.DB.saveChecklist({ id: 'C-2' }), null);
  assert.equal(b.DB.nextPermitNumber('hot_work'), '');
  assert.match(b.events.find((e) => e.alert).alert, /still being set up/);
  b.DB.deleteChecklist('C-1');
  b.ls.removeItem('cla_data_swap');
  same(b.DB.getChecklists().map((c) => c.id), ['C-1'], 'nothing was written over');
});

test('permit numbers carry the issuer code and carry on from older numbers', () => {
  const b = browser();
  const year = new Date().getFullYear();
  assert.equal(b.DB.nextPermitNumber('hot_work'), `HW-${year}-0001`, 'no account known: old style');
  b.ls.setItem('cla_data_uid', 'kq8Hn2LzP0dQ4mVr7sT9wX1yZa3B');
  const code = b.PermitTypes.issuerCode('kq8Hn2LzP0dQ4mVr7sT9wX1yZa3B');
  assert.match(code, /^[A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]{3}$/);
  assert.equal(b.DB.nextPermitNumber('hot_work'), `HW-${year}-${code}-0002`, 'the per-device counter keeps going');
  b.DB.savePermit({ id: 'P-9', permitType: 'hot_work', permitNumber: `HW-${year}-0007` });
  b.DB.savePermit({ id: 'P-10', permitType: 'hot_work', permitNumber: `HW-${year}-ZZZZ-0050` });
  assert.equal(b.DB.nextPermitNumber('hot_work'), `HW-${year}-${code}-0008`, 'old numbers count, other issuers do not');
  assert.equal(b.DB.nextPermitNumber('lifting'), `LP-${year}-${code}-0001`);
  assert.notEqual(b.PermitTypes.issuerCode('another-account-uid'), code);
  assert.equal(b.PermitTypes.issuerCode(''), '');
  // "Other permits for this job" still recognises numbers with a code.
  const needsCse = (other) => b.PermitTypes.validate({ permitType: 'hot_work', details: { area: 'Inside a confined space' }, otherPermits: other }, {})
    .some((e) => /confined space entry permit/.test(e));
  assert.equal(needsCse(''), true);
  assert.equal(needsCse(`CSE-${year}-${code}-0004`), false);
  assert.equal(needsCse(`CSE-${year}-0004`), false);
});

test('importAll merges or replaces, skips junk, and returns the counts', () => {
  const b = browser();
  b.DB.savePermit({ id: 'P-1', location: 'Mine' });
  const file = {
    assessments: [{ id: 'A-1', craneModel: 'X', updatedAt: 10 }, null, 'junk', [1]],
    permits: [{ id: 'P-1', location: 'From file' }, { id: 'P-2', updatedAt: 20 }, { id: 'P-3', deleted: true }],
    checklists: [{ assetNo: 'no id yet' }]
  };
  const counts = b.DB.importAll(file, 'merge');
  same(counts, { assessments: 1, permits: 1, checklists: 1 });
  assert.equal(b.DB.getPermits().find((p) => p.id === 'P-1').location, 'Mine', 'merge keeps the record already here');
  const p2 = b.DB.getPermits().find((p) => p.id === 'P-2');
  assert.equal(p2.updatedAt, 20, 'merge keeps the file\'s save time, so a newer account copy wins');
  assert.equal(p2._pending, true);
  assert.match(b.DB.getChecklists()[0].id, /^C-/);

  const replaced = b.DB.importAll({ permits: [{ id: 'P-7', updatedAt: 1 }] }, 'replace');
  same(replaced, { assessments: 0, permits: 1, checklists: 0 });
  same(b.DB.getPermits().map((p) => p.id), ['P-7']);
  assert.ok(b.DB.getPermits()[0].updatedAt > 1, 'replace makes the backup\'s copy the newest');
  same(b.DB.getAssessments(), []);
  same(b.DB.importAll(null, 'merge'), { assessments: 0, permits: 0, checklists: 0 });
});

// ---- DeviceData ---------------------------------------------------------------

function seed(b, who) {
  b.ls.setItem('cla_permits', JSON.stringify([{ id: `P-${who}`, location: who }]));
  b.ls.setItem('cla_checklists', JSON.stringify([{ id: `C-${who}` }]));
  b.ls.setItem('cla_permit_counter_hot_work', '4');
}

test('the first account to sign in adopts the records already on the device', async () => {
  const b = browser();
  seed(b, 'old');
  assert.equal(await b.DeviceData.claim('alice'), 'adopted');
  assert.equal(b.ls.getItem('cla_data_uid'), 'alice');
  assert.equal(b.ls.getItem('cla_data_legacy_uid'), 'alice');
  same(list(b, 'cla_permits'), [{ id: 'P-old', location: 'old', _legacy: true }], 'marked as kept from before (see cloud-sync)');
  assert.equal(b.DeviceData.idbName('cla_audit_store_v1'), 'cla_audit_store_v1');
  assert.equal(await b.DeviceData.claim('alice'), 'same');
});

test('on a nearly full device the marks never stop the first account adopting it', async () => {
  const b = browser();
  seed(b, 'old');
  // Room for the owner keys, but not for them and the marks as well.
  b.ls.setQuota(b.ls.used() + 'cla_data_uidalice'.length + 'cla_data_legacy_uidalice'.length + 10);
  assert.equal(await b.DeviceData.claim('alice'), 'adopted');
  assert.equal(b.ls.getItem('cla_data_uid'), 'alice');
  assert.equal(b.ls.getItem('cla_data_legacy_uid'), 'alice');
  same(b.DB.getPermits().map((p) => p.id), ['P-old'], 'the records are all still here');
  assert.equal(await b.DeviceData.claim('alice'), 'same');
});

test('another account signing in parks the records and gets them back later, untouched', async () => {
  const b = browser();
  seed(b, 'alice');
  await b.DeviceData.claim('alice');
  const before = JSON.stringify([...Array(b.ls.length).keys()].map((i) => b.ls.key(i)).sort().map((k) => [k, b.ls.getItem(k)]));

  const claiming = b.DeviceData.claim('bob');
  // Hidden from the pages at once, before anything is written.
  same(b.DB.getPermits(), []);
  assert.equal(b.DeviceData.idbName('cla_audit_store_v1'), 'cla_audit_store_v1:bob');
  assert.equal(await claiming, 'switched');
  assert.equal(b.ls.getItem('cla_data_uid'), 'bob');
  assert.equal(b.ls.getItem('cla_data_swap'), null);
  same(b.DB.getPermits(), [], 'Bob sees none of Alice\'s permits');
  assert.equal(b.ls.getItem('cla_permit_counter_hot_work'), null, 'nor her counters');
  assert.equal(b.DeviceData.idbName('cla_certificate_store_v1'), 'cla_certificate_store_v1:bob');
  b.DB.saveChecklist({ id: 'C-bob' });

  assert.equal(await b.DeviceData.claim('alice'), 'switched');
  const after = JSON.stringify([...Array(b.ls.length).keys()].map((i) => b.ls.key(i)).sort().map((k) => [k, b.ls.getItem(k)]));
  assert.equal(after, before, 'Alice\'s records, counters and marks are exactly as she left them');
  assert.equal(b.idb.stash('alice'), undefined, 'her stash is gone once restored');
  same(b.idb.stash('bob').lists.cla_checklists && JSON.parse(b.idb.stash('bob').lists.cla_checklists).map((c) => c.id), ['C-bob']);

  assert.equal(await b.DeviceData.claim('bob'), 'switched');
  same(b.DB.getChecklists().map((c) => c.id), ['C-bob'], 'and Bob gets his back');
});

test('if the records cannot be parked, nothing moves and they stay hidden', async () => {
  const b = browser();
  seed(b, 'alice');
  await b.DeviceData.claim('alice');
  b.idb.failWrites = true;
  assert.equal(await b.DeviceData.claim('bob'), 'failed');
  assert.equal(b.ls.getItem('cla_data_uid'), 'alice');
  same(JSON.parse(b.ls.getItem('cla_data_swap')), { from: 'alice', to: 'bob', parked: false });
  same(b.DB.getPermits(), [], 'Bob does not see Alice\'s permits');
  assert.equal(b.DB.savePermit({ id: 'P-bob' }), null, 'nor write into her lists');
  assert.equal(b.DB.nextPermitNumber('hot_work'), '', 'nor take her issuer code');
  same(list(b, 'cla_permits').map((p) => p.id), ['P-alice'], 'nothing moved');
  // Alice signing in again gets them back as they were.
  assert.equal(await b.DeviceData.claim('alice'), 'same');
  assert.equal(b.ls.getItem('cla_data_swap'), null);
  same(b.DB.getPermits().map((p) => p.id), ['P-alice']);
  // Another account's sign-in starts again from the marker once it can, and
  // from the start its pages open its own databases, not Bob's.
  assert.equal(await b.DeviceData.claim('bob'), 'failed');
  assert.equal(b.DeviceData.idbName('cla_audit_store_v1'), 'cla_audit_store_v1:bob');
  b.idb.failWrites = false;
  b.ctx.navigator.locks = { request: (name, fn) => tick().then(fn) };   // the lock comes a moment later
  const carol = b.DeviceData.claim('carol');
  assert.equal(b.DeviceData.idbName('cla_audit_store_v1'), 'cla_audit_store_v1:carol');
  assert.equal(await carol, 'switched');
  assert.equal(b.ls.getItem('cla_data_uid'), 'carol');
  same(b.DB.getPermits(), []);
  assert.equal(await b.DeviceData.claim('alice'), 'switched');
  same(b.DB.getPermits().map((p) => p.id), ['P-alice']);
});

test('a stash that stops responding fails the claim instead of hiding the records for good', async () => {
  const b = browser();
  seed(b, 'alice');
  await b.DeviceData.claim('alice');
  b.ctx.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 20));   // the watchdog's wait, shortened
  b.idb.stallWrites = true;
  assert.equal(await b.DeviceData.claim('bob'), 'failed');
  same(b.DB.getPermits(), [], 'still hidden from Bob');
  b.idb.stallWrites = false;
  assert.equal(await b.DeviceData.claim('alice'), 'same');
  same(b.DB.getPermits().map((p) => p.id), ['P-alice']);
});

test('if the incoming records do not fit, the parked ones are put back', async () => {
  const b = browser();
  await b.DeviceData.claim('bob');
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-bob', notes: 'x'.repeat(5000) }]));
  await b.DeviceData.claim('alice');   // Bob's big list is parked
  seed(b, 'alice');
  b.ls.setQuota(b.ls.used() + 1000);
  assert.equal(await b.DeviceData.claim('bob'), 'failed');
  assert.equal(b.ls.getItem('cla_data_uid'), 'alice');
  same(JSON.parse(b.ls.getItem('cla_data_swap')), { from: 'alice', to: 'bob', parked: false });
  same(b.DB.getPermits(), [], 'hidden from Bob');
  same(list(b, 'cla_permits').map((p) => p.id), ['P-alice']);
  assert.equal(b.ls.getItem('cla_permit_counter_hot_work'), '4');
  assert.ok(b.idb.stash('bob'), 'Bob\'s records are still parked');
  assert.equal(await b.DeviceData.claim('alice'), 'same');
  same(b.DB.getPermits().map((p) => p.id), ['P-alice']);
});

test('a swap cut short by a closed tab is finished on the next claim', async () => {
  const b = browser();
  seed(b, 'alice');
  await b.DeviceData.claim('alice');
  await b.DeviceData.claim('bob');
  b.DB.saveChecklist({ id: 'C-bob' });
  await b.DeviceData.claim('alice');
  // Simulate: Bob's sign-in parked Alice's records, then the tab closed.
  const parked = { uid: 'alice', lists: { cla_permits: b.ls.getItem('cla_permits') }, counters: {}, parkedAt: 1 };
  const db = await new Promise((r) => { const q = b.idb.open('cla_device_stash_v1'); q.onsuccess = () => r(q.result); });
  await new Promise((r) => { const tx = db.transaction('stash', 'readwrite'); tx.objectStore('stash').put(parked); tx.oncomplete = r; });
  b.ls.setItem('cla_data_swap', JSON.stringify({ from: 'alice', to: 'bob', parked: true }));
  same(b.DB.getPermits(), [], 'hidden until finished');
  assert.equal(await b.DeviceData.claim('bob'), 'same');
  assert.equal(b.ls.getItem('cla_data_uid'), 'bob');
  same(b.DB.getChecklists().map((c) => c.id), ['C-bob']);
  assert.equal(await b.DeviceData.claim('alice'), 'switched');
  same(b.DB.getPermits().map((p) => p.id), ['P-alice']);
});

test('a device with no recorded owner but a leftover stash merges it back', async () => {
  const b = browser();
  seed(b, 'alice');
  await b.DeviceData.claim('alice');
  await b.DeviceData.claim('bob');
  b.ls.removeItem('cla_data_uid');                 // for example an erase that missed the stash
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-new', updatedAt: 5 }]));
  assert.equal(await b.DeviceData.claim('alice'), 'adopted');
  same(b.DB.getPermits().map((p) => p.id).sort(), ['P-alice', 'P-new']);
  assert.equal(b.idb.stash('alice'), undefined);
});

// ---- cloud-sync.js: pure merge logic ------------------------------------------

test('merge: newer copy wins, tombstones remove, local deletes are not undone', () => {
  const { CloudSync } = browser();
  const local = [
    { id: 'a', v: 'local', updatedAt: 5 },
    { id: 'b', v: 'local', updatedAt: 9 },
    { id: 'c', v: 'local', updatedAt: 3, _pending: true },
    { id: 'd', v: 'local', updatedAt: 4 },
    { id: 'e', v: 'local edit after the delete', updatedAt: 8, _pending: true },
    { v: 'no id is kept' }
  ];
  const cloud = [
    { id: 'a', v: 'cloud', updatedAt: 6 },
    { id: 'b', v: 'cloud', updatedAt: 7 },
    { id: 'c', v: 'cloud', updatedAt: 3 },
    { id: 'd', deleted: true, updatedAt: 4 },
    { id: 'e', deleted: true, updatedAt: 6 },
    { id: 'f', v: 'new', updatedAt: 1 },
    { id: 'g', v: 'deleted here', updatedAt: 2 },
    { id: 'h', v: 'edited elsewhere after the delete here', updatedAt: 9 },
    { id: 'z', deleted: true, updatedAt: 1 }
  ];
  const out = CloudSync._mergeDocs(local, cloud, { g: 2, h: 5 });
  const byId = Object.fromEntries(out.filter((r) => r.id).map((r) => [r.id, r]));
  assert.equal(byId.a.v, 'cloud');
  assert.equal(byId.b.v, 'local');
  same(byId.c, { id: 'c', v: 'local', updatedAt: 3 }, 'same version: no longer pending');
  assert.equal(byId.d, undefined, 'deleted on another device');
  assert.equal(byId.e.v, 'local edit after the delete');
  assert.equal(byId.f.v, 'new');
  assert.equal(byId.g, undefined);
  assert.equal(byId.h.v, 'edited elsewhere after the delete here');
  assert.equal(byId.z, undefined, 'tombstones are never listed');
  assert.ok(out.some((r) => !r.id));
});

test('needsPush and sortDeletes pick what the account is missing', () => {
  const { CloudSync } = browser();
  const local = [
    { id: 'a', updatedAt: 5 }, { id: 'b', updatedAt: 5 }, { id: 'c', updatedAt: 9 },
    { id: 'd', updatedAt: 1, _pending: true }, { id: 'e', updatedAt: 1, _pending: true }
  ];
  const cloud = [{ id: 'b', updatedAt: 5 }, { id: 'c', updatedAt: 3 }, { id: 'd', updatedAt: 1 }, { id: 'e', updatedAt: 1 }];
  same(CloudSync._needsPush(local, cloud, new Set(['e'])).map((r) => r.id), ['a', 'c', 'd']);
  const { send, settled } = CloudSync._sortDeletes(
    [{ id: 'x', at: 5 }, { id: 'y', at: 5 }, { id: 'z', at: 5 }, { id: 'w', at: 5 }, { id: 'v', at: 5 }],
    [{ id: 'x', deleted: true, updatedAt: 5 }, { id: 'y', updatedAt: 9 }, { id: 'z', updatedAt: 2 }, { id: 'v', deleted: true, updatedAt: 5 }],
    new Set(['v']));
  same(send.map((e) => e.id), ['z', 'w']);
  same(settled.map((e) => e.id), ['x', 'y']);
  const back = CloudSync._sortDeletes([{ id: 'z', at: 5 }], [{ id: 'z', updatedAt: 2 }], new Set(), new Set(['z']));
  same([back.send.length, back.settled.length], [0, 1], 'a record that is back on the device is not deleted again');
});

// ---- cloud-sync.js with a scripted Firestore ----------------------------------

async function signedIn(uid = 'alice') {
  const fs = makeFirestore();
  const b = browser({ firestore: fs, uid });
  b.fs = fs;
  b.path = (name) => `users/${uid}/${name}`;
  return b;
}

test('sync pulls checklists too, and re-sends what never reached the account', async () => {
  const b = await signedIn();
  b.DB.saveChecklist({ id: 'C-offline', assetNo: 'saved offline' });   // before sync started: stays pending
  b.ls.setItem('cla_assessments', JSON.stringify([{ id: 'A-old', updatedAt: 1 }]));   // from before the device had an owner
  b.fs.put(b.path('checklists'), 'C-cloud', { assetNo: 'from another device', updatedAt: 50 });
  await b.CloudSync.start('alice');
  await settle();
  same(b.fs.listeners.map((l) => l.path).sort(), ['users/alice/assessments', 'users/alice/checklists', 'users/alice/permits']);

  b.fs.emit(b.path('checklists'), { fromCache: true });
  same(b.DB.getChecklists().map((c) => c.id).sort(), ['C-cloud', 'C-offline']);
  assert.ok(b.events.some((e) => e.event === 'cloudsync:changed'), 'pages are told to re-render');
  assert.equal(b.fs.writes.length, 0, 'nothing is re-sent from a cached snapshot');

  b.fs.emit(b.path('checklists'));
  b.fs.emit(b.path('assessments'));
  b.fs.emit(b.path('permits'));
  same(b.fs.writes.map((w) => w.id), ['C-offline'], 'A-old stays on this device until edited');
  assert.equal(b.fs.writes.find((w) => w.id === 'C-offline').data._pending, undefined, 'the flag stays on the device');
  assert.equal(b.fs.writes[0].options, undefined, 'records are written whole');
  await b.fs.ack();
  assert.equal(b.DB.getChecklists().find((c) => c.id === 'C-offline')._pending, undefined, 'no longer pending');
  b.fs.emit(b.path('checklists'));
  assert.equal(b.fs.writes.length, 0, 're-sent once only');
});

test('records from before the device had an owner stay on it until edited', async () => {
  const b = await signedIn();
  // P-old was deleted on another device before deletes reached other
  // devices (or is the last person's); P-both is in the account too.
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-old', location: 'Berth 1', updatedAt: 1 }, { id: 'P-both', updatedAt: 2 }]));
  b.fs.put(b.path('permits'), 'P-both', { id: 'P-both', updatedAt: 1 });
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  same(b.fs.writes.map((w) => w.id), ['P-both'], 'a newer copy of a record the account has is still sent');
  assert.equal(b.fs.writes[0].data._legacy, undefined, 'the mark stays on the device');
  await b.fs.ack();
  same(b.DB.getPermits().map((p) => p.id).sort(), ['P-both', 'P-old'], 'still listed here');
  assert.ok(b.DB.exportAll().permits.every((p) => !('_legacy' in p)), 'backups leave the mark out');
  b.CloudSync.stop();
  await b.CloudSync.start('alice');   // the next page
  await settle();
  b.fs.emit(b.path('permits'));
  assert.equal(b.fs.writes.length, 0, 'P-old is not copied into the account');
  // Edited here: now it is the account's.
  b.DB.savePermit(Object.assign(b.DB.getPermits().find((p) => p.id === 'P-old'), { location: 'Berth 2' }));
  same(b.fs.writes.map((w) => w.id), ['P-old']);
  assert.equal(b.fs.writes[0].data.location, 'Berth 2');
  assert.equal(b.fs.writes[0].data._legacy, undefined);
  await b.fs.ack();
  const stored = list(b, 'cla_permits').find((p) => p.id === 'P-old');
  assert.equal(stored._legacy, undefined);
  assert.equal(stored._pending, undefined);
});

test('a save is pending until the server confirms it, and flush waits for it', async () => {
  const b = await signedIn();
  await b.CloudSync.start('alice');
  await settle();
  b.DB.savePermit({ id: 'P-1', location: 'Tank 4', maybe: undefined });
  assert.equal(b.fs.writes.length, 1);
  assert.ok(!('maybe' in b.fs.writes[0].data), 'no undefined values reach Firestore');
  // The listener echoes the write before the server has it: still pending.
  b.fs.put(b.path('permits'), 'P-1', b.fs.writes[0].data);
  b.fs.emit(b.path('permits'), { pendingIds: ['P-1'] });
  assert.equal(b.DB.getPermits()[0]._pending, true);
  let flushed = false;
  b.CloudSync.flush(1000).then((v) => { flushed = v; });
  await settle();
  assert.equal(flushed, false);
  await b.fs.ack();
  assert.equal(flushed, true);
  assert.equal(b.DB.getPermits()[0]._pending, undefined);
  // A later edit is not cleared by the confirmation of an older one.
  b.DB.savePermit(Object.assign(b.DB.getPermits()[0], { location: 'Tank 5' }));
  const older = b.fs.writes.splice(0);
  b.DB.savePermit(Object.assign(b.DB.getPermits()[0], { location: 'Tank 6' }));
  older.forEach((w) => w.resolve());
  await settle();
  assert.equal(b.DB.getPermits()[0]._pending, true);
  // Offline the server cannot confirm anything: flush does not wait.
  b.ctx.navigator.onLine = false;
  const t0 = Date.now();
  assert.equal(await b.CloudSync.flush(1000), false);
  assert.ok(Date.now() - t0 < 500);
});

test('deletes are tombstones, queued until the server has them', async () => {
  const b = await signedIn();
  b.DB.savePermit({ id: 'P-1' });
  b.DB.savePermit({ id: 'P-2' });
  b.DB.deletePermit('P-1');                     // before sync started
  assert.equal(JSON.parse(b.ls.getItem('cla_sync_deletes')).length, 1);
  b.fs.put(b.path('permits'), 'P-1', { id: 'P-1', updatedAt: 1 });
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  assert.equal(b.DB.getPermits().some((p) => p.id === 'P-1'), false, 'the account copy does not bring it back');
  const tomb = b.fs.writes.find((w) => w.id === 'P-1');
  same(Object.keys(tomb.data).sort(), ['deleted', 'updatedAt']);
  assert.equal(tomb.data.deleted, true);
  assert.equal(typeof tomb.data.updatedAt, 'number');
  assert.equal(tomb.options, undefined, 'written whole, not merged');
  await b.fs.ack();
  same(JSON.parse(b.ls.getItem('cla_sync_deletes')), []);

  // A delete made on another device reaches this one.
  b.fs.put(b.path('permits'), 'P-2', { deleted: true, updatedAt: Date.now() + 1000 });
  b.fs.emit(b.path('permits'));
  same(b.DB.getPermits(), []);
  const changed = b.events.filter((e) => e.event === 'cloudsync:changed').length;
  b.fs.emit(b.path('permits'));
  assert.equal(b.events.filter((e) => e.event === 'cloudsync:changed').length, changed, 'no event when nothing changed');
});

test('sync never mixes accounts: another account\'s snapshots and pushes are ignored', async () => {
  const b = await signedIn('alice');
  await b.CloudSync.start('alice');
  await settle();
  assert.equal(b.ls.getItem('cla_data_uid'), 'alice');
  // Bob signs in from another tab and takes over the device's records.
  assert.equal(await b.DeviceData.claim('bob'), 'switched');
  b.fs.put(b.path('permits'), 'P-alice', { id: 'P-alice', updatedAt: 3 });
  b.fs.emit(b.path('permits'));
  same(b.DB.getPermits(), [], 'Alice\'s cloud records do not land in Bob\'s lists');
  b.DB.savePermit({ id: 'P-bob' });
  assert.equal(b.fs.writes.length, 0, 'Bob\'s record is not sent to Alice\'s account');
});

test('start signs out when another account\'s records cannot be put aside', async () => {
  const b = await signedIn('bob');
  b.ls.setItem('cla_data_uid', 'alice');
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-alice' }]));
  b.ls.setItem('cla_sync_deletes', JSON.stringify([{ c: 'permits', id: 'P-x', at: 1 }]));
  b.idb.failWrites = true;
  await b.CloudSync.start('bob');
  await settle();
  assert.ok(b.events.some((e) => e.signOut), 'signed out, so the sign-in page takes over');
  assert.equal(b.fs.listeners.length, 0, 'nothing is synced');
  same(b.DB.getPermits(), [], 'Alice\'s permit stays hidden');
  b.DB.deletePermit('P-alice');
  same(list(b, 'cla_permits').map((p) => p.id), ['P-alice'], 'and cannot be deleted');
  same(list(b, 'cla_sync_deletes').map((e) => e.id), ['P-x'], 'nor queued for deletion from her account');
});

test('start puts another account\'s records aside before merging', async () => {
  const b = await signedIn('bob');
  b.ls.setItem('cla_data_uid', 'alice');
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-alice' }]));
  await b.CloudSync.start('bob');
  await settle();
  assert.equal(b.ls.getItem('cla_data_uid'), 'bob');
  assert.ok(b.events.some((e) => e.event === 'cloudsync:changed' && e.detail.reason === 'account'));
  b.fs.put(b.path('permits'), 'P-bob', { id: 'P-bob', updatedAt: 2 });
  b.fs.emit(b.path('permits'));
  same(b.DB.getPermits().map((p) => p.id), ['P-bob']);
  assert.equal(b.fs.writes.length, 0, 'Alice\'s permit is not copied into Bob\'s account');
});

test('an import is sent to the account, but a newer account copy wins', async () => {
  const b = await signedIn();
  b.fs.put(b.path('permits'), 'P-1', { id: 'P-1', location: 'newer in the account', updatedAt: 100 });
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  b.ls.setItem('cla_permits', '[]');   // for example a new device before the merge
  const counts = b.DB.importAll({ permits: [{ id: 'P-1', location: 'old backup', updatedAt: 50 }, { id: 'P-2', updatedAt: 60 }] }, 'merge');
  assert.equal(counts.permits, 2);
  same(b.fs.writes.map((w) => w.id), ['P-2']);
  assert.equal(b.DB.getPermits().find((p) => p.id === 'P-1').location, 'newer in the account');
});

test('a record restored from a backup comes back even though it was deleted', async () => {
  const b = await signedIn();
  b.DB.savePermit({ id: 'P-1', location: 'Berth 4' });
  b.DB.savePermit({ id: 'P-2', location: 'Berth 5' });
  const backup = JSON.parse(JSON.stringify(b.DB.exportAll()));
  assert.equal(backup.permits[0]._restored, undefined);
  b.DB.deletePermit('P-1');                                    // deleted before sync started: still queued
  b.fs.put(b.path('permits'), 'P-2', { deleted: true, updatedAt: Date.now() + 1000 });   // deleted on another device
  const counts = b.DB.importAll(backup, 'merge');
  assert.equal(counts.permits, 1, 'P-2 is still here until the account says otherwise');
  b.ls.setItem('cla_permits', JSON.stringify(list(b, 'cla_permits').filter((p) => p.id !== 'P-2')));
  assert.equal(b.DB.importAll(backup, 'merge').permits, 1);
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  same(b.DB.getPermits().map((p) => p.id).sort(), ['P-1', 'P-2']);
  same(b.fs.writes.map((w) => w.id).sort(), ['P-1', 'P-2'], 'sent again, and no tombstone for P-1');
  assert.ok(b.fs.writes.every((w) => !w.data.deleted && w.data._restored === undefined && w.data._pending === undefined));
  const p2 = b.fs.writes.find((w) => w.id === 'P-2').data;
  assert.ok(p2.updatedAt > b.fs.docs.get(b.path('permits')).get('P-2').updatedAt, 'newer than the delete');
  await b.fs.ack();
  same(JSON.parse(b.ls.getItem('cla_sync_deletes')), []);
  assert.ok(b.DB.getPermits().every((p) => !p._pending && !p._restored));
  // A later delete on another device is not overruled any more.
  b.fs.put(b.path('permits'), 'P-2', { deleted: true, updatedAt: Date.now() + 5000 });
  b.fs.emit(b.path('permits'));
  same(b.DB.getPermits().map((p) => p.id), ['P-1']);
});

test('a lapsed account stops re-sending after the rules refuse a write', async () => {
  const b = await signedIn();
  b.ls.setItem('cla_permits', JSON.stringify([{ id: 'P-1', updatedAt: 1, _pending: true }, { id: 'P-2', updatedAt: 1, _pending: true }]));
  b.ls.setItem('cla_data_uid', 'alice');
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  assert.equal(b.fs.writes.length, 2);
  await b.fs.ack('permission-denied');
  assert.equal(b.DB.getPermits().every((p) => p._pending), true, 'kept pending for later');
  b.CloudSync.pushPending('permits');
  assert.equal(b.fs.writes.length, 0);
  b.DB.deletePermit('P-1');
  assert.equal(b.fs.writes.length, 1, 'deletes are still sent');
});

test('a record whose id Firestore cannot take does not hold up the rest', async () => {
  const b = await signedIn();
  b.ls.setItem('cla_data_uid', 'alice');
  b.ls.setItem('cla_permits', JSON.stringify([
    { id: 'P-1/2', updatedAt: 1, _pending: true }, { id: 7, updatedAt: 1, _pending: true }, { id: 'P-3', updatedAt: 1, _pending: true }
  ]));
  b.ls.setItem('cla_sync_deletes', JSON.stringify([{ c: 'permits', id: 'P-4/5', at: 2 }, { c: 'permits', id: 'P-6', at: 2 }]));
  await b.CloudSync.start('alice');
  await settle();
  b.fs.emit(b.path('permits'));
  same(b.fs.writes.map((w) => w.id), ['P-3', 'P-6'], 'the good record and the good delete are still sent');
  same(list(b, 'cla_sync_deletes').map((e) => e.id), ['P-6'], 'the bad delete is dropped from the queue');
  same(b.DB.getPermits().map((p) => p.id), ['P-1/2', 7, 'P-3'], 'and nothing is lost on the device');
});

test('a checklist deleted on another device takes its certificate photos with it', async () => {
  const b = await signedIn();
  b.ls.setItem('cla_data_uid', 'alice');
  b.ls.setItem('cla_checklists', JSON.stringify([{ id: 'C-1', updatedAt: 1 }, { id: 'C-2', updatedAt: 1 }, { id: 'C-3', updatedAt: 1 }]));
  await b.CloudSync.start('alice');
  await settle();
  b.fs.put(b.path('checklists'), 'C-1', { deleted: true, updatedAt: 5 });
  b.fs.put(b.path('checklists'), 'C-2', { id: 'C-2', updatedAt: 1 });
  b.fs.put(b.path('checklists'), 'C-3', { id: 'C-3', updatedAt: 1 });
  b.fs.emit(b.path('checklists'));
  same(b.DB.getChecklists().map((c) => c.id), ['C-2', 'C-3']);
  same(list(b, 'cla_cert_purge'), ['C-1'], 'no photo store on this page: queued for it');
  const purged = [];
  b.ctx.CertificateStore = { deleteForChecklist: (id) => { purged.push(id); return Promise.reject(new Error('busy')); } };
  b.fs.put(b.path('checklists'), 'C-2', { deleted: true, updatedAt: 5 });
  b.fs.emit(b.path('checklists'));
  await settle();
  same(purged, ['C-2'], 'with the photo store here, deleted at once');
  same(list(b, 'cla_cert_purge'), ['C-1']);
  b.DB.deleteChecklist('C-3');   // deleted here: checklists.html deletes the photos itself
  b.fs.put(b.path('checklists'), 'C-3', { deleted: true, updatedAt: Date.now() + 1000 });
  b.fs.emit(b.path('checklists'));
  same(purged, ['C-2']);
});

// ---- certificate-storage.js: photos of checklists deleted elsewhere ------------

// Just enough IndexedDB for CertificateStore: one photo store with a
// checklistId index.
function photoIndexedDB(photos) {
  const data = new Map(photos.map((p) => [p.id, p]));
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const tx = {};
      tx.objectStore = () => ({
        get(id) { const req = {}; setTimeout(() => { req.result = data.get(id); req.onsuccess(); }, 0); return req; },
        index: () => ({
          openCursor(range) {
            const req = {};
            const hits = [...data.values()].filter((p) => p.checklistId === range.only);
            const next = () => setTimeout(() => {
              const p = hits.shift();
              req.result = p ? { delete: () => data.delete(p.id), continue: next } : null;
              req.onsuccess();
              if (!p && tx.oncomplete) tx.oncomplete();
            }, 0);
            next();
            return req;
          }
        })
      });
      return tx;
    }
  };
  return { data, open() { const req = {}; setTimeout(() => { req.result = db; req.onsuccess(); }, 0); return req; } };
}

test('the photo store deletes the queued photos when it opens, unless the checklist is back', async () => {
  const idb = photoIndexedDB([{ id: 'ph1', checklistId: 'C-gone' }, { id: 'ph2', checklistId: 'C-back' }, { id: 'ph3', checklistId: 'C-kept' }]);
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    localStorage: makeStorage(), indexedDB: idb, IDBKeyRange: { only: (v) => ({ only: v }) }, navigator: {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['storage.js', 'firebase-auth.js', 'certificate-storage.js'].forEach((f) => vm.runInContext(source(f), ctx, { filename: f }));
  const store = vm.runInContext('CertificateStore', ctx);
  const ls = ctx.localStorage;
  ls.setItem('cla_data_uid', 'alice');
  ls.setItem('cla_data_legacy_uid', 'alice');
  ls.setItem('cla_checklists', JSON.stringify([{ id: 'C-back' }, { id: 'C-kept' }]));
  ls.setItem('cla_cert_purge', JSON.stringify(['C-gone', 'C-back']));
  // Mid-swap the queue belongs to the account leaving: left alone.
  ls.setItem('cla_data_swap', JSON.stringify({ from: 'alice', to: 'bob', parked: false }));
  await store.getPhoto('ph3');
  await settle();
  same([...idb.data.keys()], ['ph1', 'ph2', 'ph3']);
  ls.removeItem('cla_data_swap');
  assert.equal((await store.getPhoto('ph3')).id, 'ph3');
  await settle();
  same([...idb.data.keys()], ['ph2', 'ph3'], 'only the deleted checklist\'s photos go');
  assert.equal(ls.getItem('cla_cert_purge'), null, 'and the queue is empty');
});

// ---- project-link.js: linked project items are never created from the offline copy ----

// Projects and ProjectLink with a scripted Firestore holding one project's
// items. `getError` makes the item lookup fail as the SDK does offline.
function projectLinkBrowser({ online = true, existing = null, getError = null } = {}) {
  const calls = [];
  const items = {
    where() { return items; },
    limit() { return items; },
    async get(options) {
      calls.push({ get: clone(options) });
      if (getError) throw getError;
      return existing ? { empty: false, docs: [{ id: existing.id, data: () => clone(existing) }] } : { empty: true, docs: [] };
    },
    async add(data) { calls.push({ add: clone(data) }); return { id: 'I-new' }; },
    doc(id) {
      return {
        get: async () => ({ data: () => clone(existing) }),
        update: async (data) => { calls.push({ update: id, data: clone(data) }); }
      };
    }
  };
  const activity = { add: async () => ({ id: 'act' }) };
  const firestore = () => ({ collection: () => ({ doc: () => ({ collection: (n) => (n === 'items' ? items : activity) }) }) });
  firestore.FieldValue = { serverTimestamp: () => 'now' };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, clearTimeout,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; },   // ProjectLink's 10 s limit
    navigator: { onLine: online },
    FIREBASE_READY: true, firebaseReadyPromise: Promise.resolve(),
    firebase: { firestore, auth: () => ({ currentUser: { uid: 'u1', email: 'u1@example.com' } }) }
  };
  vm.createContext(ctx);
  ['projects.js', 'project-link.js'].forEach((f) => vm.runInContext(source(f), ctx, { filename: f }));
  return { ctx, calls, ProjectLink: vm.runInContext('ProjectLink', ctx) };
}

test('a linked record looks its project item up on the server, and offline adds nothing', async () => {
  const ref = { kind: 'permit', id: 'P-1', label: 'Hot work permit HW-1' };
  const input = { title: 'Hot work permit HW-1: welding', status: 'in_progress' };

  let b = projectLinkBrowser();
  same(await b.ProjectLink.sync('proj', ref, input), { ok: true });
  same(b.calls[0], { get: { source: 'server' } }, 'never decided from the offline copy');
  assert.equal(b.calls[1].add.title, input.title);

  b = projectLinkBrowser({ existing: { id: 'I-1', ref, title: 'old', status: 'open' } });
  same(await b.ProjectLink.sync('proj', ref, input), { ok: true });
  assert.equal(b.calls[1].update, 'I-1', 'the item already there is updated');
  assert.ok(!b.calls.some((c) => c.add));

  // Offline: nothing is looked up or queued, and the page is told why.
  b = projectLinkBrowser({ online: false });
  same(await b.ProjectLink.sync('proj', ref, input), { ok: false, offline: true, error: 'you are offline' });
  same(b.calls, []);

  // The connection drops without the browser noticing: the server lookup
  // fails, and still nothing is added.
  const err = Object.assign(new Error('Failed to get documents from server.'), { code: 'unavailable' });
  b = projectLinkBrowser({ getError: err });
  same(await b.ProjectLink.sync('proj', ref, input), { ok: false, offline: true, error: 'you are offline' });
  assert.ok(!b.calls.some((c) => c.add || c.update));

  // Other errors are passed on as they are.
  b = projectLinkBrowser({ getError: Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }) });
  same(await b.ProjectLink.sync('proj', ref, input), { ok: false, error: 'Missing or insufficient permissions.' });
});
