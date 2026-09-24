// audit-store.js — IndexedDB storage for audit packs and their evidence files.
//
// Evidence cannot live in localStorage (the rest of the app's store): a single
// scanned certificate is bigger than localStorage's whole quota. IndexedDB
// holds Blobs natively and is sized in hundreds of megabytes, so both the audit
// records and the files go here, in two object stores:
//
//   audits  { id, role, projectNo, …, sections:[{ items:[{ files:[meta], … }] }] }
//   files   { id, auditId, itemId, name, type, size, blob, addedAt }
//
// Item records carry only file METADATA, so listing and rendering an audit
// never loads a single file body; bytes are read only when a file is viewed or
// packed. Everything stays on the device until the user compiles a pack and
// uploads it — the Drive copy is the cloud copy.

(function (global) {
  'use strict';

  const DB_NAME = 'cla_audit_store_v1';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('This browser has no IndexedDB, so evidence cannot be stored.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audits')) db.createObjectStore('audits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'id' });
          s.createIndex('auditId', 'auditId', { unique: false });
          s.createIndex('itemId', 'itemId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open audit storage.'));
      req.onblocked = () => reject(new Error('Audit storage is locked by another tab of this app. Close the other tab and retry.'));
    });
    return dbPromise;
  }

  // On a device whose disk is completely full, a write transaction can stall
  // without ever firing complete, error or abort — the page just waits forever.
  // A watchdog turns that silence into an error the user can act on.
  const STALL_MS = { readonly: 20000, readwrite: 30000 };

  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let settled = false;
      const finish = (fnSettle, v) => { if (settled) return; settled = true; clearTimeout(timer); fnSettle(v); };
      const timer = setTimeout(() => {
        try { tx.abort(); } catch (e) { /* already finished */ }
        finish(reject, new Error('Device storage stopped responding. The device is probably out of free space — ' +
          'free some space, then try again. Nothing already saved has been lost.'));
      }, STALL_MS[mode] || 30000);
      let result;
      try { result = fn(tx.objectStore(store), tx); } catch (e) { finish(reject, e); return; }
      tx.oncomplete = () => finish(resolve, result && result.__req ? result.__req.result : result);
      tx.onerror = () => finish(reject, tx.error || new Error('Storage operation failed.'));
      tx.onabort = () => finish(reject, tx.error || new Error('Storage operation was aborted — the device may be out of space.'));
    }));
  }
  const wrap = (req) => ({ __req: req });

  // ---- audits --------------------------------------------------------------

  function listAudits() {
    return run('audits', 'readonly', (s) => wrap(s.getAll())).then((list) =>
      (list || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  }
  function getAudit(id) { return run('audits', 'readonly', (s) => wrap(s.get(id))).then((a) => a || null); }
  function saveAudit(audit) {
    audit.updatedAt = Date.now();
    return run('audits', 'readwrite', (s) => { s.put(audit); }).then(() => audit);
  }
  function deleteAudit(id) {
    return deleteFilesForAudit(id).then(() => run('audits', 'readwrite', (s) => { s.delete(id); }));
  }

  // ---- files ---------------------------------------------------------------

  function putFile(rec) { return run('files', 'readwrite', (s) => { s.put(rec); }).then(() => rec); }
  function getFile(id) { return run('files', 'readonly', (s) => wrap(s.get(id))).then((f) => f || null); }
  function deleteFile(id) { return run('files', 'readwrite', (s) => { s.delete(id); }); }

  function deleteFilesForAudit(auditId) {
    return run('files', 'readwrite', (s) => {
      const req = s.index('auditId').openCursor(IDBKeyRange.only(auditId));
      req.onsuccess = () => { const c = req.result; if (c) { c.delete(); c.continue(); } };
    });
  }

  // Metadata only — no blob — so callers can total up sizes cheaply.
  function fileMetaForAudit(auditId) {
    return run('files', 'readonly', (s) => {
      const out = [];
      const req = s.index('auditId').openCursor(IDBKeyRange.only(auditId));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const v = c.value;
        out.push({ id: v.id, itemId: v.itemId, name: v.name, type: v.type, size: v.size, addedAt: v.addedAt });
        c.continue();
      };
      return out;
    });
  }

  function clearAll() {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(['audits', 'files'], 'readwrite');
      tx.objectStore('audits').clear();
      tx.objectStore('files').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    })).catch(() => {});
  }

  // ---- quota ---------------------------------------------------------------

  async function usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { used: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (e) { /* not available */ }
    return { used: 0, quota: 0 };
  }

  // Ask the browser not to evict this site's data under storage pressure.
  // Evidence gathered over weeks should not vanish because the phone filled up.
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  global.AuditStore = {
    listAudits: listAudits, getAudit: getAudit, saveAudit: saveAudit, deleteAudit: deleteAudit,
    putFile: putFile, getFile: getFile, deleteFile: deleteFile,
    fileMetaForAudit: fileMetaForAudit, deleteFilesForAudit: deleteFilesForAudit,
    clearAll: clearAll, usage: usage, requestPersist: requestPersist
  };
})(window);
