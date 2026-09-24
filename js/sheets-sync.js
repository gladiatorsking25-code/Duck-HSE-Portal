// Durable per-account queue. Failed requests remain queued until a later successful sync.
const CloudSync = (() => {
  let uid = null, timer = null, generation = 0, busy = false;
  const collections = ['assessments', 'permits', 'checklists'];
  const queueKey = user => `cla_sheets_queue:${user}`;
  function queue(user) { try { return JSON.parse(localStorage.getItem(queueKey(user)) || '[]'); } catch { return []; } }
  function status(message) {
    let el = document.getElementById('sheetsSyncStatus');
    if (!el) { el = document.createElement('div'); el.id = 'sheetsSyncStatus'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;bottom:8px;right:8px;max-width:340px;padding:8px 12px;background:#16283a;color:white;border-radius:6px;z-index:9999;font-size:13px'; document.body.appendChild(el); }
    el.textContent = message; el.hidden = !message;
  }
  async function sync() {
    if (!uid || busy || typeof DB === 'undefined') return;
    if (localStorage.getItem('cla_data_owner') !== uid) { status('Account changed in another tab. Reload this page.'); return; }
    busy = true;
    const owner = uid, version = generation;
    try {
      for (const item of queue(owner)) {
        if (version !== generation) return;
        await SheetsBackend.call(item.action, { expectedUid: owner, collection: item.collection, id: item.id, record: item.record });
        // An edit made during the request is a separate queued operation and is retained.
        localStorage.setItem(queueKey(owner), JSON.stringify(queue(owner).filter(v => v.op !== item.op)));
      }
      for (const collection of collections) {
        const { records } = await SheetsBackend.call('records', { collection, expectedUid: owner });
        if (version !== generation) return;
        const pendingIds = new Set(queue(owner).filter(v => v.collection === collection).map(v => v.id));
        const local = DB._get(DB.KEYS[collection]);
        const map = new Map(local.map(r => [r.id, r]));
        for (const record of records) {
          if (pendingIds.has(record.id)) continue;
          if (record.deleted) map.delete(record.id); else map.set(record.id, record);
        }
        DB._set(DB.KEYS[collection], [...map.values()]);
      }
      status(queue(owner).length ? 'Changes waiting to sync.' : '');
      window.dispatchEvent(new Event('portal-records-updated'));
    } catch (err) { if (version === generation) status(`Saved on this device. Sync paused: ${err.message}`); }
    finally { busy = false; }
  }
  function enqueue(action, collection, id, record) {
    if (!uid || !id || !collections.includes(collection)) return;
    const items = queue(uid).filter(v => !(v.collection === collection && v.id === id));
    items.push({ op: crypto.randomUUID(), action, collection, id, record });
    localStorage.setItem(queueKey(uid), JSON.stringify(items));
    sync();
  }
  window.addEventListener('online', sync);
  return {
    start(user) { if (uid === user) return; this.stop(); uid = user; sync(); timer = setInterval(sync, SHEETS_CONFIG.pollMillis); },
    stop() { generation++; uid = null; clearInterval(timer); timer = null; },
    push(collection, record) { enqueue('saveRecord', collection, record?.id, record); },
    remove(collection, id) { enqueue('deleteRecord', collection, id); }
  };
})();
