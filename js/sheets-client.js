const SheetsBackend = (() => {
  let currentUser = null, initialized = false, pending;
  const listeners = new Set();
  async function call(action, data = {}) {
    if (location.protocol === 'file:') throw new Error('This page was opened as a file. Start the portal with START-PORTAL.cmd, then open http://localhost:3000/login.html. Complete START-HERE.txt first if this is your first use.');
    let response;
    try { response = await fetch(SHEETS_CONFIG.endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(60000) }); }
    catch { throw new Error('Cannot reach the portal server. For local use, keep START-PORTAL.cmd running and open http://localhost:3000/login.html. For a hosted app, the administrator must configure its server connection.'); }
    let result; try { result = await response.json(); } catch { throw new Error('The Google Sheets server is not running. Contact the portal administrator.'); }
    if (!response.ok || result.error) { const err = new Error(result.error || 'Request failed.'); err.status = response.status; throw err; }
    return result.data;
  }
  function switchAccount(user) {
    const uid = user?.uid || '';
    const previous = localStorage.getItem('cla_data_owner') || '';
    if (uid !== previous) {
      if (typeof CloudSync !== 'undefined') CloudSync.stop();
      // Preserve the old device data under its owner, including the pre-migration local account.
      for (const key of ['cla_assessments', 'cla_permits', 'cla_checklists', 'cla_permit_counter']) {
        const old = localStorage.getItem(key);
        if (old != null) localStorage.setItem(`cla_archive:${previous || 'local'}:${key}`, old);
        const saved = uid ? localStorage.getItem(`cla_archive:${uid}:${key}`) : null;
        if (saved != null) localStorage.setItem(key, saved); else localStorage.removeItem(key);
      }
      localStorage.setItem('cla_data_owner', uid);
      localStorage.removeItem('cla_access_cache');
    }
    currentUser = user;
    if (user) localStorage.setItem('cla_cloud_signed_in', '1');
    else localStorage.removeItem('cla_cloud_signed_in');
    listeners.forEach(cb => cb(user));
  }
  async function initialize() {
    if (initialized) return;
    if (pending) return pending;
    pending = call('me').then(({ user }) => switchAccount(user)).catch(err => { if (err.status === 401 || err.status === 404) switchAccount(null); else { listeners.forEach(cb => cb(null)); } }).finally(() => { initialized = true; });
    return pending;
  }
  const auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged(cb) { listeners.add(cb); if (initialized) cb(currentUser); else initialize(); return () => listeners.delete(cb); },
    async signInWithEmailAndPassword(email, password) { const result = await call('signin', { email, password }); initialized = true; switchAccount(result.user); return result; },
    async createUserWithEmailAndPassword(email, password) { const result = await call('signup', { email, password }); initialized = true; switchAccount(result.user); return result; },
    sendPasswordResetEmail(email) { return call('resetRequest', { email }); },
    async signOut() { await call('signout'); switchAccount(null); }
  };
  window.addEventListener('storage', event => {
    if (event.key === 'cla_data_owner' && (currentUser?.uid || '') !== event.newValue) location.replace('login.html');
  });
  return { call, auth: () => auth, functions: () => ({ httpsCallable: action => async data => ({ data: await call(action, data) }) }) };
})();
const sheetsReadyPromise = Promise.resolve(SheetsBackend);
