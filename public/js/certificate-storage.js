// certificate-storage.js — IndexedDB storage for certificate photos.
// Metadata stays with the checklist record; image bytes stay out of localStorage.
const CertificateStore = (function () {
  'use strict';
  const DB_BASE = 'cla_certificate_store_v1';
  const DB_VERSION = 1;
  const STORE = 'photos';
  // Checklists deleted on another device while no page with this store was
  // open (queued by js/cloud-sync.js): their photos go once it opens.
  const PURGE_KEY = 'cla_cert_purge';
  let dbPromise = null;
  let dbName = null;

  // Each account on a shared device has its own database (see DeviceData in
  // js/firebase-auth.js). If the account changes while a page is open, the
  // next call opens the new one.
  function currentName() {
    return (typeof DeviceData !== 'undefined') ? DeviceData.idbName(DB_BASE) : DB_BASE;
  }

  function open() {
    const name = currentName();
    if (dbPromise && dbName === name) return dbPromise;
    if (dbPromise) dbPromise.then(db => db.close(), () => {});
    dbName = name;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported on this device.'));
        return;
      }
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('checklistId', 'checklistId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open certificate storage.'));
    });
    dbPromise.then(() => drainPurge(name), () => {});
    return dbPromise;
  }

  // Deletes the photos of the checklists in the queue, except any that are
  // back on this device (restored from a backup). Mid-swap the queue still
  // belongs to the account leaving, so it waits for the next open. An id
  // that fails stays queued for the next open.
  function drainPurge(name) {
    if (typeof DeviceData !== 'undefined' && DeviceData.pendingSwap()) return;
    let ids;
    try { ids = JSON.parse(localStorage.getItem(PURGE_KEY) || '[]'); } catch (e) { return; }
    if (!Array.isArray(ids) || !ids.length) return;
    const here = new Set(typeof DB !== 'undefined' ? DB.getChecklists().map(c => c.id) : []);
    const done = [];
    Promise.all(ids.map(id => (here.has(id) ? Promise.resolve() : deleteForChecklist(id))
      .then(() => { done.push(id); }, e => console.warn('Could not remove certificate photos', e)))).then(() => {
      if (currentName() !== name) return;   // another account's queue by now
      let left = [];
      try { left = JSON.parse(localStorage.getItem(PURGE_KEY) || '[]'); } catch (e) { /* rewritten below */ }
      left = (Array.isArray(left) ? left : []).filter(id => done.indexOf(id) === -1);
      try {
        if (left.length) localStorage.setItem(PURGE_KEY, JSON.stringify(left));
        else localStorage.removeItem(PURGE_KEY);
      } catch (e) { /* tried again on the next open */ }
    });
  }

  function putPhoto(item) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save certificate photo.'));
    }));
  }

  function getPhoto(id) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Could not read certificate photo.'));
    }));
  }

  function deletePhoto(id) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not delete certificate photo.'));
    }));
  }

  function deleteForChecklist(checklistId) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const index = store.index('checklistId');
      const req = index.openCursor(IDBKeyRange.only(checklistId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clean certificate photos.'));
    }));
  }

  function deleteMany(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return Promise.all(ids.map(deletePhoto));
  }

  // Empties the whole photo store. Used by the "erase all data" and account-
  // deletion flows so certificate images don't survive a full local wipe —
  // clearing the store (rather than deleteDatabase) works even while a
  // connection is open, so it won't hang on "blocked".
  function clearAll() {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clear certificate storage.'));
    })).catch(() => { /* store may not exist yet — nothing to clear */ });
  }

  function fileToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not create report image.'));
      reader.readAsDataURL(blob);
    });
  }

  return { putPhoto, getPhoto, deletePhoto, deleteForChecklist, deleteMany, clearAll, fileToDataUrl };
})();
