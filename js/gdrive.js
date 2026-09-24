// gdrive.js — uploads audit packs to Google Drive, straight from the browser.
//
// Sign-in uses Google Identity Services (the OAuth token flow for browser
// apps): the access token lives in memory only, is never written to storage,
// and expires within the hour. There is no server in this path and no
// service-account key — a key shipped in a web page is a key anyone can read.
//
// SCOPE. The default is `drive.file`, the least-privileged Drive scope: the
// app can only see and write files and folders it created itself, or that the
// user explicitly picks in the Google Picker. The consequence is the honest one
// the UI spells out — a "Project Number" folder someone created by hand in
// Drive is INVISIBLE to a search under this scope, which is why the upload
// flow offers "pick the existing folder" alongside "create it". The alternative
// is the full `drive` scope, which can find any folder but is a restricted
// scope Google makes you verify before release; it is available as an opt-in
// for an owner using the app for themselves.
//
// Uploads are RESUMABLE (Drive's protocol for large files): packs routinely
// run to hundreds of megabytes, and a site connection that drops at 80% should
// resume, not start again.
//
// Shared drives are supported throughout (supportsAllDrives), since contract
// document folders very often live in one.

(function (global) {
  'use strict';

  const CFG_KEY = 'cla_gdrive_cfg';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const CHUNK = 8 * 1024 * 1024; // resumable chunks must be multiples of 256 KiB
  const SCOPES = {
    file: 'https://www.googleapis.com/auth/drive.file',
    full: 'https://www.googleapis.com/auth/drive'
  };

  // ------------------------------------------------------------------ config -

  function defaults() {
    // The Firebase messagingSenderId IS the Google Cloud project number, which
    // is what the Picker needs as its App ID for drive.file access to apply.
    const projectNumber = (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.messagingSenderId) || '';
    return {
      clientId: '',
      apiKey: '',
      appId: projectNumber,
      scope: 'file',
      rootFolderId: 'root',
      rootFolderName: 'My Drive',
      pathTemplate: '{project}/HSE Audit',
      projectFolders: {}
    };
  }
  function loadConfig() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      return Object.assign(defaults(), raw ? JSON.parse(raw) : {});
    } catch (e) { return defaults(); }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; }
  }
  function isConfigured(cfg) { return !!((cfg || loadConfig()).clientId || '').trim(); }

  // The folder path for one project, from the template. "{project}" is the
  // project number; anything else is literal text, so "{project}/HSE Audit"
  // and "HSE/{project}/Audits" both work.
  function pathFor(cfg, projectNo) {
    return String(cfg.pathTemplate || '{project}/HSE Audit')
      .split('/')
      .map((s) => s.replace(/\{project\}/gi, projectNo || 'Project').trim())
      .filter(Boolean);
  }

  // ------------------------------------------------------------ script load -

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src + ' — check the internet connection.')); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  // ------------------------------------------------------------------- auth --

  let token = null, tokenExpiry = 0, tokenClient = null, tokenScope = '';

  async function signIn(opts) {
    const cfg = loadConfig();
    if (!isConfigured(cfg)) throw new Error('Google Drive is not set up yet. Add the OAuth Client ID under "Drive settings".');
    if (!navigator.onLine) throw new Error('You are offline. The pack is saved on this device — upload it once you have a connection.');
    const scope = SCOPES[cfg.scope] || SCOPES.file;
    if (token && Date.now() < tokenExpiry - 60000 && tokenScope === scope && !(opts && opts.force)) return token;

    await loadScript('https://accounts.google.com/gsi/client');
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId.trim(),
        scope: scope,
        callback: (resp) => {
          if (resp.error) { reject(new Error('Google sign-in failed: ' + (resp.error_description || resp.error))); return; }
          token = resp.access_token;
          tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          tokenScope = scope;
          resolve(token);
        },
        error_callback: (err) => reject(new Error(err && err.type === 'popup_closed'
          ? 'The Google sign-in window was closed before finishing.'
          : 'Google sign-in could not start: ' + ((err && (err.message || err.type)) || 'unknown error') +
            '. If this is a new setup, check the OAuth client\'s Authorized JavaScript origins include ' + location.origin + '.'))
      });
      tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
    });
  }

  function signOut() {
    if (token && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ignore */ }
    }
    token = null; tokenExpiry = 0;
  }
  function isSignedIn() { return !!token && Date.now() < tokenExpiry - 60000; }

  // --------------------------------------------------------------- requests --

  async function call(path, opts, retried) {
    const o = opts || {};
    const qs = new URLSearchParams(Object.assign({ supportsAllDrives: 'true' }, o.query || {}));
    const res = await fetch(API + path + '?' + qs.toString(), {
      method: o.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, o.body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    if (res.status === 401 && !retried) { await signIn({ force: true }); return call(path, opts, true); }
    if (!res.ok) throw await driveError(res);
    return res.status === 204 ? null : res.json();
  }

  async function driveError(res) {
    let msg = 'Google Drive returned HTTP ' + res.status + '.';
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error.message || msg;
    } catch (e) { /* not JSON */ }
    if (res.status === 404) msg += ' (Under the "files the app created" scope, folders made by hand in Drive are invisible to this app — pick the folder instead.)';
    if (res.status === 403 && /insufficient|scope/i.test(msg)) msg += ' Sign in again and allow Drive access.';
    const e = new Error(msg); e.status = res.status;
    return e;
  }

  // Drive query literals escape backslash and single quote.
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function getFolder(id) {
    if (id === 'root') return { id: 'root', name: 'My Drive' };
    const f = await call('files/' + encodeURIComponent(id), { query: { fields: 'id,name,mimeType,trashed,webViewLink' } });
    if (!f || f.mimeType !== FOLDER_MIME) throw new Error('That Drive item is not a folder.');
    if (f.trashed) throw new Error('That folder is in the Drive trash.');
    return f;
  }

  async function findFolder(name, parentId) {
    const res = await call('files', {
      query: {
        q: "mimeType='" + FOLDER_MIME + "' and name='" + q(name) + "' and '" + q(parentId) + "' in parents and trashed=false",
        fields: 'files(id,name,webViewLink)',
        includeItemsFromAllDrives: 'true',
        pageSize: '10'
      }
    });
    return (res.files && res.files[0]) || null;
  }

  function createFolder(name, parentId) {
    return call('files', {
      method: 'POST',
      query: { fields: 'id,name,webViewLink' },
      body: { name: name, mimeType: FOLDER_MIME, parents: [parentId] }
    });
  }

  // Walks the folder path from `rootId`. Missing folders are created only when
  // `create` says so for that depth; otherwise the walk stops and reports which
  // segment is missing, so the UI can ask before creating anything.
  async function resolvePath(rootId, segments, create) {
    let parent = rootId;
    const trail = [];
    for (let i = 0; i < segments.length; i++) {
      let f = await findFolder(segments[i], parent);
      if (!f) {
        const allowed = typeof create === 'function' ? create(i, segments[i]) : !!create;
        if (!allowed) return { ok: false, missingIndex: i, missingName: segments[i], parentId: parent, trail: trail };
        f = await createFolder(segments[i], parent);
        f.created = true;
      }
      trail.push(f);
      parent = f.id;
    }
    return { ok: true, folder: trail[trail.length - 1] || { id: rootId }, trail: trail };
  }

  // ------------------------------------------------------------------ upload -

  async function upload(blob, name, parentId, onProgress) {
    const size = blob.size;
    const start = await fetch(UPLOAD + '?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'application/zip',
        'X-Upload-Content-Length': String(size)
      },
      body: JSON.stringify({ name: name, parents: [parentId], mimeType: blob.type || 'application/zip' })
    });
    if (!start.ok) throw await driveError(start);
    const session = start.headers.get('Location');
    if (!session) throw new Error('Drive did not return an upload session. Try again, or check a browser extension is not stripping response headers.');

    let offset = 0, failures = 0;
    while (offset < size) {
      const end = Math.min(offset + CHUNK, size);
      let res;
      try {
        res = await fetch(session, {
          method: 'PUT',
          headers: { 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + size },
          body: blob.slice(offset, end)
        });
      } catch (netErr) {
        res = null;
      }

      if (res && (res.status === 200 || res.status === 201)) {
        if (onProgress) onProgress(size, size);
        return res.json();
      }
      if (res && res.status === 308) {
        // Drive reports how much it holds; trust that over our own count.
        const range = res.headers.get('Range');
        offset = range ? Number(range.split('-')[1]) + 1 : end;
        failures = 0;
        if (onProgress) onProgress(offset, size);
        continue;
      }
      if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw await driveError(res);

      // Network drop or a 5xx: ask Drive where it got to, back off, resume.
      if (++failures > 5) throw new Error('The upload kept failing. The pack is still saved on this device — try again on a steadier connection.');
      await new Promise((r) => setTimeout(r, Math.min(16000, 1000 * Math.pow(2, failures))));
      try {
        const probe = await fetch(session, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + size } });
        if (probe.status === 200 || probe.status === 201) return probe.json();
        if (probe.status === 308) {
          const r = probe.headers.get('Range');
          offset = r ? Number(r.split('-')[1]) + 1 : 0;
        }
      } catch (e) { /* still offline — loop and try again */ }
    }
    throw new Error('Upload ended without Drive confirming the file.');
  }

  // ------------------------------------------------------------------ picker -

  async function pickFolder(title) {
    const cfg = loadConfig();
    if (!cfg.apiKey) throw new Error('Choosing a folder needs the Google Picker API key — add it under "Drive settings". Or paste the folder\'s link instead.');
    await signIn();
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker failed to load.')) }));

    return new Promise((resolve) => {
      const mine = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setParent('root');
      const shared = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setEnableDrives(true);
      const builder = new google.picker.PickerBuilder()
        .setTitle(title || 'Choose a folder')
        .addView(mine).addView(shared)
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(token)
        .setDeveloperKey(cfg.apiKey.trim())
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const d = data.docs && data.docs[0];
            resolve(d ? { id: d.id, name: d.name, url: d.url } : null);
          } else if (data.action === google.picker.Action.CANCEL) resolve(null);
        });
      if (cfg.appId) builder.setAppId(String(cfg.appId).trim());
      builder.build().setVisible(true);
    });
  }

  // Accepts a Drive folder link or a bare folder id.
  function parseFolderRef(s) {
    const t = String(s || '').trim();
    if (!t) return null;
    const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
  }

  function folderUrl(id) {
    return id === 'root' ? 'https://drive.google.com/drive/my-drive' : 'https://drive.google.com/drive/folders/' + encodeURIComponent(id);
  }

  global.GDrive = {
    SCOPES: SCOPES,
    loadConfig: loadConfig, saveConfig: saveConfig, isConfigured: isConfigured, pathFor: pathFor,
    signIn: signIn, signOut: signOut, isSignedIn: isSignedIn,
    getFolder: getFolder, findFolder: findFolder, createFolder: createFolder, resolvePath: resolvePath,
    upload: upload, pickFolder: pickFolder, parseFolderRef: parseFolderRef, folderUrl: folderUrl,
    // exposed for tests
    _setToken: (t) => { token = t; tokenExpiry = Date.now() + 3600000; tokenScope = SCOPES[loadConfig().scope] || SCOPES.file; }
  };
})(window);
