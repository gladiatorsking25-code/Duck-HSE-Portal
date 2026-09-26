// certificate-storage.js — IndexedDB storage for certificate photos.
// Metadata stays with the checklist record; image bytes stay out of localStorage.
const CertificateStore = (function () {
  'use strict';
  const DB_NAME = 'cla_certificate_store_v1';
  const DB_VERSION = 1;
  const STORE = 'photos';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported on this device.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
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
    return dbPromise;
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
