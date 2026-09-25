// cloud-sync.js — keeps localStorage (which every page already reads
// synchronously) in sync with the account's copies in Firestore, so no other
// file needs to become async. Two directions:
//   - Firestore -> localStorage: real-time onSnapshot listeners on
//     users/{uid}/assessments, /permits and /checklists merge the cloud
//     documents into the same localStorage keys js/storage.js uses. The newer
//     `updatedAt` wins. A cloud document { deleted: true, updatedAt } is a
//     tombstone: the record was deleted on some device, so it is dropped here
//     too (unless it was changed here after that). Tombstones are never shown.
//     Each merge that changes anything fires a 'cloudsync:changed' event on
//     document, and the list pages re-render on it.
//   - localStorage -> Firestore: js/storage.js stamps every saved record with
//     `updatedAt` and `_pending: true`, then calls push(). The flag is cleared
//     once the server has the write, so a save made offline, or cut off by
//     leaving the page, is sent again: after the first snapshot that comes
//     from the server, every record that is pending, missing from the account
//     or newer here is pushed again (except records from before this device
//     had an owner, see needsPush). Deletes are written as tombstones and
//     queued the same way (DELETES_KEY) until the server has them.
// A slow or offline connection never blocks or breaks the local save.
//
// Only the account whose records are on this device (DeviceData in
// js/firebase-auth.js) is ever synced: start() first puts another account's
// records aside, and nothing is merged or pushed while a different account
// owns the device's records.
//
// No-ops entirely when Firebase isn't configured (FIREBASE_READY is false).

const CloudSync = (function () {
  'use strict';

  const COLLECTIONS = ['assessments', 'permits', 'checklists'];
  // Deletes not yet confirmed by the server: [{ c: collection, id, at }].
  // Kept with the account's records when the device changes hands.
  const DELETES_KEY = 'cla_sync_deletes';
  // Checklists deleted on another device whose certificate photos are still
  // to be deleted here: [id]. js/certificate-storage.js empties it.
  const CERT_PURGE_KEY = 'cla_cert_purge';

  let listeners = {};         // collection -> unsubscribe
  let lastDocs = {};          // collection -> { docs, pendingIds } from the latest snapshot
  let serverSeen = {};        // collection -> true once a snapshot came from the server
  let currentUid = null;
  let startingUid = null;
  let generation = 0;
  let denied = false;         // the rules refused a record write (lapsed account)
  const inflight = new Map(); // `${collection}:${id}` -> promise of the write

  function firebaseOn() { return typeof FIREBASE_READY !== 'undefined' && FIREBASE_READY; }
  function keyFor(name) { return DB.KEYS[name]; }
  function userCollection(uid, name) {
    return firebase.firestore().collection('users').doc(uid).collection(name);
  }
  function stampOf(r) { return Number(r && r.updatedAt) || 0; }

  // True while `uid` still owns the records on this device.
  function owns(uid) {
    if (!uid) return false;
    if (typeof DeviceData === 'undefined') return true;
    return DeviceData.owner() === uid && !DeviceData.pendingSwap();
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error('Could not store synced records', e); return false; }
  }

  function announce(detail) {
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('cloudsync:changed', { detail }));
      }
    } catch (e) { /* a page without listeners */ }
  }

  // Flags that only mean something on this device: `_pending` (not yet in
  // the account), `_restored` (brought back from a backup, see
  // DB.importAll) and `_legacy` (here from before the device had an owner,
  // see DeviceData in js/firebase-auth.js).
  const LOCAL_FLAGS = ['_pending', '_restored', '_legacy'];

  // The copy sent to Firestore: JSON-safe (no undefined values) and without
  // the local-only flags.
  function cloudCopy(record) {
    const out = JSON.parse(JSON.stringify(record));
    LOCAL_FLAGS.forEach((f) => { delete out[f]; });
    return out;
  }
  function strip(record) {
    const out = Object.assign({}, record);
    LOCAL_FLAGS.forEach((f) => { delete out[f]; });
    return out;
  }

  // ---- Pure merge logic (unit-tested in test/sync.test.mjs) -----------------

  // Merges the account's documents into the local list. `cloudDocs` leaves
  // out documents this device is still writing; `deletes` maps id -> time of
  // a delete made here that the server has not confirmed yet.
  function mergeDocs(local, cloudDocs, deletes) {
    const out = Array.isArray(local) ? local.slice() : [];
    const index = new Map();
    out.forEach((r, i) => { if (r && r.id) index.set(r.id, i); });
    const gone = new Set();
    (cloudDocs || []).forEach((doc) => {
      if (!doc || !doc.id) return;
      const i = index.get(doc.id);
      const mine = i === undefined ? null : out[i];
      const cloudAt = stampOf(doc);
      if (doc.deleted === true) {
        if (!mine) return;
        // Restored from a backup on purpose: it comes back in the account too.
        if (mine._restored) {
          if (stampOf(mine) <= cloudAt) out[i] = Object.assign({}, mine, { updatedAt: cloudAt + 1, _pending: true });
          return;
        }
        // Deleted on another device, unless it was changed here since.
        if (!(mine._pending && stampOf(mine) > cloudAt)) gone.add(doc.id);
        return;
      }
      if (deletes && deletes[doc.id] != null && deletes[doc.id] >= cloudAt) return;   // deleted here, on its way
      if (!mine) { index.set(doc.id, out.length); out.push(doc); return; }
      const mineAt = stampOf(mine);
      if (cloudAt > mineAt) out[i] = doc;
      else if (cloudAt === mineAt && mine._pending) out[i] = strip(mine);   // the account has this very version
    });
    return gone.size ? out.filter((r) => !(r && gone.has(r.id))) : out;
  }

  // Local records the account is missing or has an older copy of. Documents
  // this device is still writing count as up to date. A record from before
  // the device had an owner that the account does not have may have been
  // deleted elsewhere, or be someone else's: it stays here until edited.
  function needsPush(local, cloudDocs, pendingIds) {
    const cloud = new Map();
    (cloudDocs || []).forEach((d) => { if (d && d.id) cloud.set(d.id, d); });
    return (Array.isArray(local) ? local : []).filter((r) => {
      if (!r || !r.id || r.deleted === true) return false;
      if (pendingIds && pendingIds.has(r.id)) return false;
      const c = cloud.get(r.id);
      if (!c && r._legacy && !r._pending) return false;
      return !c || !!r._pending || stampOf(r) > stampOf(c);
    });
  }

  // Splits queued deletes into those to send and those already settled (the
  // account has the tombstone, the record was changed again later, or it is
  // back on this device, for example restored from a backup).
  function sortDeletes(entries, cloudDocs, pendingIds, localIds) {
    const cloud = new Map();
    (cloudDocs || []).forEach((d) => { if (d && d.id) cloud.set(d.id, d); });
    const send = [], settled = [];
    (entries || []).forEach((e) => {
      if (pendingIds && pendingIds.has(e.id)) return;   // being written right now
      const c = cloud.get(e.id);
      if (localIds && localIds.has(e.id)) settled.push(e);
      else if (c && c.deleted === true && stampOf(c) >= e.at) settled.push(e);
      else if (c && c.deleted !== true && stampOf(c) > e.at) settled.push(e);
      else send.push(e);
    });
    return { send, settled };
  }

  // ---- Queued deletes -------------------------------------------------------

  function readDeletes() {
    const v = readJson(DELETES_KEY, []);
    return Array.isArray(v) ? v.filter((e) => e && e.c && e.id) : [];
  }
  function queueDelete(name, id, at) {
    const list = readDeletes().filter((e) => !(e.c === name && e.id === id));
    list.push({ c: name, id, at });
    writeJson(DELETES_KEY, list);
  }
  function dropDeletes(name, done) {
    if (!done.length) return;
    const list = readDeletes().filter((e) => !(e.c === name && done.some((d) => d.id === e.id && d.at >= e.at)));
    writeJson(DELETES_KEY, list);
  }
  function deletesFor(name) {
    const map = {};
    readDeletes().forEach((e) => { if (e.c === name) map[e.id] = Math.max(map[e.id] || 0, Number(e.at) || 0); });
    return map;
  }

  // ---- Writes ---------------------------------------------------------------

  function track(name, id, promise) {
    const k = `${name}:${id}`;
    inflight.set(k, promise);
    promise.finally(() => { if (inflight.get(k) === promise) inflight.delete(k); });
    return promise;
  }

  // Clears the pending flag once the server has this version of the record.
  function markSynced(uid, name, id, stamp) {
    if (!owns(uid)) return;
    const list = readJson(keyFor(name), []);
    if (!Array.isArray(list)) return;
    const i = list.findIndex((r) => r && r.id === id);
    if (i < 0 || !list[i]._pending || stampOf(list[i]) !== stamp) return;
    list[i] = strip(list[i]);
    writeJson(keyFor(name), list);
  }

  function sendRecord(uid, name, record) {
    const stamp = stampOf(record);
    let data, write;
    try { data = cloudCopy(record); } catch (e) { return Promise.resolve(false); }
    // An id Firestore cannot take (from a hand-edited backup) throws here. It
    // must not stop the rest of the list from being sent.
    try { write = userCollection(uid, name).doc(record.id).set(data); }
    catch (e) { console.error('Cloud push skipped for this record:', e); return Promise.resolve(false); }
    return track(name, record.id, write
      .then(() => { markSynced(uid, name, record.id, stamp); return true; })
      .catch((err) => {
        if (err && err.code === 'permission-denied') denied = true;
        console.error('Cloud push failed (saved on this device, will retry):', err);
        return false;
      }));
  }

  // A tombstone holds exactly { deleted, updatedAt } (see firestore.rules).
  function sendTombstone(uid, name, id, at) {
    let write;
    try { write = userCollection(uid, name).doc(id).set({ deleted: true, updatedAt: at }); }
    catch (e) {
      // Not an id the account can hold, so there is nothing there to delete.
      console.error('Cloud delete skipped for this record:', e);
      if (owns(uid)) dropDeletes(name, [{ id, at }]);
      return Promise.resolve(false);
    }
    return track(name, id, write
      .then(() => { if (owns(uid)) dropDeletes(name, [{ id, at }]); return true; })
      .catch((err) => {
        console.error('Cloud delete failed (removed on this device, will retry):', err);
        return false;
      }));
  }

  // Deletes the certificate photos of checklists that left this device with a
  // delete made on another one. Pages without js/certificate-storage.js
  // queue the ids, and it deletes them the next time it opens.
  function purgeCertificates(local, merged) {
    const kept = new Set(merged.filter((r) => r && r.id).map((r) => r.id));
    const gone = local.filter((r) => r && r.id && !kept.has(r.id)).map((r) => r.id);
    if (!gone.length) return;
    if (typeof CertificateStore !== 'undefined') {
      gone.forEach((id) => CertificateStore.deleteForChecklist(id).catch(() => {}));
      return;
    }
    const queue = readJson(CERT_PURGE_KEY, []);
    writeJson(CERT_PURGE_KEY, [...new Set((Array.isArray(queue) ? queue : []).concat(gone))]);
  }

  // Applies one snapshot of a collection: merge, then (once the server's view
  // is known) send whatever the account is missing.
  function applySnapshot(uid, name, snapState, reconcile) {
    if (!owns(uid)) return;
    const key = keyFor(name);
    const { docs, pendingIds } = snapState;
    const before = localStorage.getItem(key);
    let local = readJson(key, []);
    if (!Array.isArray(local)) local = [];
    const merged = mergeDocs(local, docs.filter((d) => !pendingIds.has(d.id)), deletesFor(name));
    const after = JSON.stringify(merged);
    if (after !== (before || '[]') && writeJson(key, merged)) {
      announce({ reason: 'merge', collection: name });
      if (name === 'checklists') purgeCertificates(local, merged);
    }
    if (!reconcile) return;
    if (!denied) {
      needsPush(merged, docs, pendingIds)
        .filter((r) => !inflight.has(`${name}:${r.id}`))
        .forEach((r) => sendRecord(uid, name, r));
    }
    const here = new Set(merged.filter((r) => r && r.id).map((r) => r.id));
    const { send, settled } = sortDeletes(readDeletes().filter((e) => e.c === name), docs, pendingIds, here);
    dropDeletes(name, settled);
    send.filter((e) => !inflight.has(`${name}:${e.id}`)).forEach((e) => sendTombstone(uid, name, e.id, e.at));
  }

  function listen(uid, name) {
    let reconciled = false;
    listeners[name] = userCollection(uid, name).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      const state = {
        docs: snap.docs.map((d) => Object.assign({ id: d.id }, d.data())),
        pendingIds: new Set(snap.docs.filter((d) => d.metadata && d.metadata.hasPendingWrites).map((d) => d.id))
      };
      lastDocs[name] = state;
      const fromServer = !(snap.metadata && snap.metadata.fromCache);
      if (fromServer) serverSeen[name] = true;
      applySnapshot(uid, name, state, fromServer && !reconciled);
      if (fromServer) reconciled = true;
    }, (err) => console.error(`Cloud sync error (${name})`, err));
  }

  // Other tabs change the same localStorage: let this tab's pages re-render.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
      const watched = COLLECTIONS.map(keyFor).concat([DB.DEVICE_KEYS.owner, DB.DEVICE_KEYS.swap]);
      if (e.key === null || watched.indexOf(e.key) !== -1) announce({ reason: 'storage' });
    });
  }

  return {
    async start(uid) {
      if (!firebaseOn() || !uid || currentUid === uid || startingUid === uid) return;
      this.stop();
      const gen = generation;
      startingUid = uid;
      await firebaseReadyPromise;
      // Put another account's records aside before merging this one's in.
      const claimed = typeof DeviceData !== 'undefined' ? await DeviceData.claim(uid) : 'same';
      if (gen !== generation) return;   // stopped or restarted meanwhile
      startingUid = null;
      if (claimed === 'failed') {
        // The other account's records stay hidden and saves are refused, so
        // sign out: the sign-in page (watchAndSync) lets the person try again.
        console.error('Cloud sync not started: another account\'s records are still on this device.');
        try { await CloudAuth.signOutCloud(); } catch (e) { /* already signed out */ }
        return;
      }
      currentUid = uid;
      denied = false;
      if (claimed === 'switched' || claimed === 'adopted') announce({ reason: 'account' });
      COLLECTIONS.forEach((name) => listen(uid, name));
    },

    stop() {
      generation++;
      Object.keys(listeners).forEach((name) => { try { listeners[name](); } catch (e) { /* already gone */ } });
      listeners = {};
      lastDocs = {};
      serverSeen = {};
      currentUid = null;
      startingUid = null;
    },

    // Sends one saved record. Resolves true once the server has it, false if
    // it could not be sent now (it stays pending and is sent later).
    push(collectionName, record) {
      if (!firebaseOn() || !currentUid || !record || !record.id || !owns(currentUid)) return Promise.resolve(false);
      return sendRecord(currentUid, collectionName, record);
    },

    // Deletes a record from the account by writing a tombstone. Queued first,
    // so it is sent later if the device is offline or the page closes.
    remove(collectionName, id, at) {
      if (!firebaseOn() || !id) return Promise.resolve(false);
      const stamp = Number(at) || Date.now();
      queueDelete(collectionName, id, stamp);
      if (!currentUid || !owns(currentUid)) return Promise.resolve(false);
      return sendTombstone(currentUid, collectionName, id, stamp);
    },

    // Sends the pending records of a collection (after an import). Before the
    // server's view is known, the first server snapshot does this instead.
    pushPending(collectionName) {
      if (!currentUid || !serverSeen[collectionName] || !lastDocs[collectionName]) return;
      applySnapshot(currentUid, collectionName, lastDocs[collectionName], true);
    },

    // Waits (at most `ms`) for the writes in flight, so a page can navigate
    // away after a save without cutting the write off. Resolves true if they
    // all finished. Offline the server cannot confirm them, so it resolves
    // false at once (the records stay pending and are sent later).
    flush(ms = 4000) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
      const all = Promise.all([...inflight.values()]).then(() => true);
      return Promise.race([all, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
    },

    // Pure helpers, exposed for the unit tests.
    _mergeDocs: mergeDocs,
    _needsPush: needsPush,
    _sortDeletes: sortDeletes
  };
})();
