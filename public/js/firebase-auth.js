// firebase-auth.js — real email/password accounts via Firebase Authentication.
//
// Sign-up, sign-in, password reset and sign-out, plus watchAndSync(), which
// starts/stops Firestore sync (js/cloud-sync.js) as the user signs in/out.
// Access decisions live in js/access.js; data protection lives in
// firestore.rules. If Firebase isn't configured, every method here throws a
// clear error.
//
// DeviceData (below CloudAuth) keeps one account's records apart from the
// next on a shared device.

const CloudAuth = {
  CLOUD_SESSION_FLAG: 'cla_cloud_signed_in',   // localStorage: "was the last sign-in a real cloud account?"

  async _auth() {
    if (!FIREBASE_READY) throw new Error('Cloud sign-in is not set up yet — see README "Cloud sync & accounts".');
    await firebaseReadyPromise;
    return firebase.auth();
  },

  // Puts the previous account's records on this device aside before this
  // account's pages load. If that cannot be done, the sign-in is undone
  // rather than showing one person's records to another.
  async _claimDevice(auth, user) {
    const result = await DeviceData.claim(user.uid);
    if (result !== 'failed') return;
    try { await auth.signOut(); } catch (e) { /* already signed out */ }
    localStorage.removeItem(this.CLOUD_SESSION_FLAG);
    throw new Error('The records of the last person who used this device could not be set aside, so you have not been signed in. Nothing has been deleted. Close any other tabs of the app and try again.');
  },

  async signUp(email, password) {
    const auth = await this._auth();
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await this._claimDevice(auth, cred.user);
    // A verified address is required before project invites can land on this
    // account (functions/projects.js), so ask for it straight away.
    try { await cred.user.sendEmailVerification(); } catch (e) { console.warn('Verification email not sent', e); }
    // NOTE: do NOT write the user's Firestore doc here. The onUserCreate Cloud
    // Function (functions/index.js) creates it with the email, role, and the
    // server-set trial window — and the Firestore rules now forbid a client from
    // writing any entitlement field (subscriptionStatus, trialEndsAt, …), so a
    // client-side write of those would be rejected. Trying to set them here is
    // both unnecessary and would make signup fail.
    return cred.user;
  },

  async signIn(email, password) {
    const auth = await this._auth();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    await this._claimDevice(auth, cred.user);
    return cred.user;
  },

  async resetPassword(email) {
    const auth = await this._auth();
    await auth.sendPasswordResetEmail(email);
  },

  async signOutCloud() {
    if (!FIREBASE_READY) return;
    const auth = await this._auth();
    await auth.signOut();
    localStorage.removeItem(this.CLOUD_SESSION_FLAG);
  },

  // Call once per protected page load. Starts/stops Firestore sync as the
  // user signs in/out, and sends a signed-out user back to login.
  watchAndSync() {
    if (!FIREBASE_READY) return;
    this._auth().then(auth => {
      auth.onAuthStateChanged(user => {
        if (user) {
          localStorage.setItem(this.CLOUD_SESSION_FLAG, '1');
          if (typeof CloudSync !== 'undefined') CloudSync.start(user.uid);
        } else {
          localStorage.removeItem(this.CLOUD_SESSION_FLAG);
          if (typeof CloudSync !== 'undefined') CloudSync.stop();
          if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
        }
      });
    }).catch(err => console.error('Firebase auth watch failed to start', err));
  }
};

// ---- Whose records are on this device ---------------------------------------
// Permits, assessments and checklists live in localStorage under fixed keys
// (js/storage.js), and audit evidence and certificate photos in IndexedDB. One
// account's records are "active" on the device at a time, and 'cla_data_uid'
// names that account. When a different account signs in, claim():
//   1. parks the active lists, permit counters and unsent deletes in a stash
//      for the previous account (in IndexedDB, so a nearly full localStorage
//      never has to hold two copies),
//   2. puts the new account's own stash back, if it has one (otherwise its
//      lists start empty), and makes it the owner.
// Nothing is ever deleted: each person gets their records back when they sign
// in here again. The evidence and photo databases are not moved; each account
// opens its own database name instead (idbName), except the account that first
// adopted the databases made before this existed. The first sign-in on a
// device with no recorded owner adopts whatever is already here.
//
// While a swap is under way 'cla_data_swap' is set. js/storage.js then reads
// the lists as empty and refuses to write, so a page that loads mid-swap never
// shows or overwrites the previous account's records. If the tab closes mid-
// swap, the next claim() finishes the job from the stash.
const DeviceData = (function () {
  'use strict';

  const OWNER_KEY = 'cla_data_uid';
  const LEGACY_IDB_KEY = 'cla_data_legacy_uid';
  const SWAP_KEY = 'cla_data_swap';
  // The keys that belong to one account. The first three must match DB.KEYS in
  // js/storage.js; the last is js/cloud-sync.js's queue of unsent deletes.
  const LIST_KEYS = ['cla_assessments', 'cla_permits', 'cla_checklists', 'cla_sync_deletes'];
  const COUNTER_PREFIX = 'cla_permit_counter';
  const STASH_DB = 'cla_device_stash_v1';
  const STASH_STORE = 'stash';

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function readJson(key) { try { return JSON.parse(get(key) || 'null'); } catch (e) { return null; } }

  function owner() { return get(OWNER_KEY); }
  function pendingSwap() { const j = readJson(SWAP_KEY); return j && j.to ? j : null; }

  // The IndexedDB database name for this account's copy of a store. Mid-swap
  // it already names the incoming account.
  function idbName(base) {
    const swap = pendingSwap();
    const uid = swap ? swap.to : owner();
    const legacy = get(LEGACY_IDB_KEY);
    return (!uid || !legacy || uid === legacy) ? base : `${base}:${uid}`;
  }

  function counterKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(COUNTER_PREFIX) === 0) out.push(k);
    }
    return out;
  }

  // What is active on the device now, as raw strings (nothing is re-encoded).
  function readActive(uid) {
    const lists = {};
    LIST_KEYS.forEach((k) => { const v = get(k); if (v != null) lists[k] = v; });
    const counters = {};
    counterKeys().forEach((k) => { counters[k] = get(k); });
    return { uid, lists, counters, parkedAt: Date.now() };
  }

  // Makes `rec` (a stash, or null for "nothing") the active records. On a
  // storage error the previous state is put back and the error rethrown.
  function applyActive(rec) {
    const before = readActive(null);
    const write = (r) => {
      LIST_KEYS.forEach((k) => localStorage.removeItem(k));
      counterKeys().forEach((k) => localStorage.removeItem(k));
      const lists = (r && r.lists) || {};
      const counters = (r && r.counters) || {};
      LIST_KEYS.forEach((k) => { if (typeof lists[k] === 'string') localStorage.setItem(k, lists[k]); });
      Object.keys(counters).forEach((k) => {
        if (k.indexOf(COUNTER_PREFIX) === 0 && counters[k] != null) localStorage.setItem(k, String(counters[k]));
      });
    };
    try { write(rec); } catch (e) { write(before); throw e; }
  }

  // Record-by-record union of a stash into the active lists (newest copy of
  // each record wins, counters take the higher value). Only used when a
  // device has no recorded owner but still holds a stash for the account.
  // Returns false if a list could not be read, so the stash is kept.
  function mergeIntoActive(rec) {
    const lists = (rec && rec.lists) || {};
    let complete = true;
    LIST_KEYS.forEach((k) => {
      if (typeof lists[k] !== 'string') return;
      let mine = null, theirs = null;
      try { mine = JSON.parse(get(k) || '[]'); theirs = JSON.parse(lists[k]); } catch (e) { /* checked below */ }
      if (!Array.isArray(mine) || !Array.isArray(theirs)) { complete = false; return; }
      const at = (r) => Number(r && (r.updatedAt || r.at)) || 0;
      const idOf = (r) => (r && r.id ? `${r.c || ''}:${r.id}` : null);
      const index = new Map();
      mine.forEach((r, i) => { const id = idOf(r); if (id) index.set(id, i); });
      theirs.forEach((r) => {
        const id = idOf(r);
        if (id && index.has(id)) { if (at(r) > at(mine[index.get(id)])) mine[index.get(id)] = r; }
        else mine.push(r);
      });
      localStorage.setItem(k, JSON.stringify(mine));
    });
    const counters = (rec && rec.counters) || {};
    Object.keys(counters).forEach((k) => {
      if (k.indexOf(COUNTER_PREFIX) !== 0) return;
      const n = Math.max(parseInt(get(k) || '0', 10) || 0, parseInt(counters[k] || '0', 10) || 0);
      localStorage.setItem(k, String(n));
    });
    return complete;
  }

  // ---- The stash (IndexedDB) ----
  let stashDb = null;
  function openStash() {
    if (stashDb) return stashDb;
    stashDb = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('This browser has no IndexedDB.')); return; }
      const req = indexedDB.open(STASH_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STASH_STORE)) req.result.createObjectStore(STASH_STORE, { keyPath: 'uid' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open the device stash.'));
      req.onblocked = () => reject(new Error('The device stash is locked by another tab.'));
    });
    stashDb.catch(() => { stashDb = null; });
    return stashDb;
  }
  function stashTx(mode, fn) {
    return openStash().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STASH_STORE, mode);
      const req = fn(tx.objectStore(STASH_STORE));
      tx.oncomplete = () => resolve(req && mode === 'readonly' ? (req.result || null) : undefined);
      tx.onerror = () => reject(tx.error || new Error('Device stash operation failed.'));
      tx.onabort = () => reject(tx.error || new Error('Device stash operation was aborted.'));
    }));
  }
  const getStash = (uid) => stashTx('readonly', (s) => s.get(uid));
  const putStash = (rec) => stashTx('readwrite', (s) => { s.put(rec); });
  const deleteStash = (uid) => stashTx('readwrite', (s) => { s.delete(uid); });

  function setSwap(from, to, parked) { localStorage.setItem(SWAP_KEY, JSON.stringify({ from, to, parked })); }

  // Puts `to`'s records in place once `from`'s are safely parked. `parked` is
  // the stash just written, or null when finishing a swap a closed tab left.
  async function finishSwap(swap, parked) {
    if (owner() !== swap.to) {
      let incoming;
      try { incoming = await getStash(swap.to); }
      catch (e) {
        // On a first attempt nothing has been moved yet, so drop the marker.
        if (parked) localStorage.removeItem(SWAP_KEY);
        throw e;
      }
      try {
        applyActive(incoming);
        localStorage.setItem(OWNER_KEY, swap.to);
      } catch (e) {
        // No room for the incoming records: put the parked ones back.
        applyActive(parked || await getStash(swap.from));
        localStorage.setItem(OWNER_KEY, swap.from);
        localStorage.removeItem(SWAP_KEY);
        throw e;
      }
    }
    localStorage.removeItem(SWAP_KEY);
    await deleteStash(swap.to).catch(() => { /* a stale copy is replaced on the next park */ });
  }

  async function claimLocked(uid) {
    const swap = pendingSwap();
    if (swap && swap.parked) await finishSwap(swap, null);   // a tab closed part way through

    const current = owner();
    if (current === uid || !current) {
      // No move needed: drop a marker left by claim() or by a closed tab.
      localStorage.removeItem(SWAP_KEY);
      if (current === uid) return 'same';
      const left = await getStash(uid).catch(() => null);
      const merged = left ? mergeIntoActive(left) : false;
      localStorage.setItem(OWNER_KEY, uid);
      if (!get(LEGACY_IDB_KEY)) localStorage.setItem(LEGACY_IDB_KEY, uid);
      if (merged) await deleteStash(uid).catch(() => {});
      return 'adopted';
    }
    setSwap(current, uid, false);
    const parked = readActive(current);
    try { await putStash(parked); }
    catch (e) { localStorage.removeItem(SWAP_KEY); throw e; }
    setSwap(current, uid, true);
    await finishSwap({ from: current, to: uid }, parked);
    return 'switched';
  }

  // Returns 'same', 'adopted', 'switched' or 'failed' (nothing was moved and
  // the previous owner's records are still the active ones).
  async function claim(uid) {
    if (!uid) return 'same';
    try {
      // Hide the previous account's records at once: the sign-in page can
      // move on to the next page before the stash has been written.
      const current = owner();
      if (current && current !== uid && !pendingSwap()) setSwap(current, uid, false);
      const run = () => claimLocked(uid);
      // One tab at a time, so two tabs never move the same records.
      if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        return await navigator.locks.request('cla-device-data', run);
      }
      return await run();
    } catch (e) {
      const swap = pendingSwap();
      if (swap && !swap.parked) localStorage.removeItem(SWAP_KEY);
      console.error('Could not set aside the previous account\'s records on this device', e);
      return 'failed';
    }
  }

  return {
    OWNER_KEY, SWAP_KEY, LEGACY_IDB_KEY, LIST_KEYS, COUNTER_PREFIX, STASH_DB,
    owner, pendingSwap, idbName, claim
  };
})();
