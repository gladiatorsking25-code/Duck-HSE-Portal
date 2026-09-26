// Unit tests for the hosting side of the website: the audit viewer's file
// typing (public/js/audit-viewer.js), the service worker's routing
// (public/sw.js), the Hostinger settings (public/.htaccess), the touch-screen
// input rule (public/css/styles.css) and the functions runtime (firebase.json).
// Run with `npm run test:unit` in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// ---------------------------------------------------------------- viewer --

function loadViewer() {
  const window = {};
  vm.runInNewContext(read('public/js/audit-viewer.js'), { window });
  return window.AuditViewer;
}

test('the viewer types files from their name, never from the file record or a pack', () => {
  const V = loadViewer();
  assert.equal(V.safeType('Gas test cert.pdf'), 'application/pdf');
  assert.equal(V.safeType('SITE PHOTO.JPG'), 'image/jpeg');
  assert.equal(V.safeType('walkround.mp4'), 'video/mp4');
  assert.equal(V.safeType('briefing.m4a'), 'audio/mp4');
  for (const name of ['index.html', 'page.htm', 'logo.svg', 'data.xml', 'page.xhtml', 'notes.txt', 'report.docx', 'no-extension', '', 'x.pdf.html']) {
    assert.equal(V.safeType(name), 'application/octet-stream', name);
  }
});

test('a mislabelled file is previewed by its name, and web pages or SVG never go to the browser as such', () => {
  const V = loadViewer();
  // A ".pdf" that its pack calls a web page is still shown (and opened) as a PDF.
  assert.equal(V.kindOf('Gas test cert.pdf', 'text/html'), 'pdf');
  // A picture type on a file with no picture name gives no picture preview.
  assert.equal(V.kindOf('evidence', 'image/png'), 'other');
  assert.equal(V.kindOf('logo.svg', 'image/svg+xml'), 'other');
  // Web pages and text are read by the viewer itself (sandboxed / escaped).
  assert.equal(V.kindOf('00 Index.html', ''), 'html');
  assert.equal(V.kindOf('readme', 'text/plain'), 'text');
  assert.equal(V.kindOf('Toolbox talk.docx', ''), 'docx');
});

// -------------------------------------------------------- service worker --

const ORIGIN = 'https://hse.example.com';
const SDK = 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js';

// Runs public/sw.js against a fake browser: an in-memory cache and a fetch
// that does what `network` says.
function loadSw(network) {
  const listeners = {};
  const store = new Map();
  const key = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN + '/').href;
  const cache = {
    add: async (req) => { const res = await network(req, {}); store.set(key(req), res); },
    put: async (req, res) => { store.set(key(req), res); },
    match: async (req) => store.get(key(req))
  };
  const calls = [];
  const fetch = async (req, init) => { calls.push({ url: key(req), init: init || {} }); return network(req, init || {}); };
  const self = {
    location: new URL(ORIGIN + '/sw.js'),
    registration: {},
    clients: { claim: async () => {} },
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: (req) => cache.match(req) };
  vm.runInNewContext(read('public/sw.js'), {
    self, caches, fetch, Request, Response, URL, Promise,
    setTimeout: () => 0, // the network-timeout race never fires in these tests
    console: { warn() {}, log() {}, error() {} }
  });
  return { listeners, store, calls };
}

// Dispatches a GET the way a page would make it. Resolves to what the worker
// answered, or null when it left the request to the browser.
async function dispatch(sw, url, accept = '*/*') {
  let responded = null;
  const waits = [];
  sw.listeners.fetch({
    request: { method: 'GET', url, mode: 'no-cors', headers: new Headers({ accept }) },
    preloadResponse: Promise.resolve(undefined),
    respondWith: (p) => { responded = Promise.resolve(p); },
    waitUntil: (p) => { waits.push(p); }
  });
  const res = responded ? await responded : null;
  await Promise.all(waits);
  return res;
}

const offline = async () => { throw new TypeError('Failed to fetch'); };
const opaque = () => ({ ok: false, status: 0, type: 'opaque', clone() { return this; } });

test('Firebase and Google services on other sites go straight to the network', async () => {
  const sw = loadSw(async () => new Response('net'));
  for (const url of [
    'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?x=1',
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
    'https://securetoken.googleapis.com/v1/token',
    'https://us-central1-duck-hse-portal.cloudfunctions.net/createCheckout',
    'https://createcheckout-abc.a.run.app/',
    'https://duck-hse-portal.firebaseapp.com/__/auth/iframe',
    'https://accounts.google.com/gsi/client',
    'https://www.googleapis.com/drive/v3/files'
  ]) {
    assert.equal(await dispatch(sw, url), null, url);
  }
});

test("the site's own firebase-*.js files are served from the offline copy", async () => {
  const sw = loadSw(offline);
  for (const name of ['firebase-config.js', 'firebase-init.js', 'firebase-auth.js']) {
    const copy = new Response('cached ' + name);
    sw.store.set(`${ORIGIN}/js/${name}`, copy);
    assert.equal(await dispatch(sw, `${ORIGIN}/js/${name}`), copy, name);
  }
});

test('the Firebase SDK is kept at install and then served from the offline copy first', async () => {
  const sw = loadSw(async (req, init) => {
    const url = typeof req === 'string' ? req : req.url;
    if (url.startsWith('https://www.gstatic.com/') && init.mode === 'cors') return new Response('sdk ' + url);
    return new Response('page');
  });
  let installing = null;
  sw.listeners.install({ waitUntil: (p) => { installing = p; } });
  await installing;
  for (const name of ['app', 'auth', 'firestore', 'functions']) {
    assert.ok(sw.store.has(`https://www.gstatic.com/firebasejs/10.13.0/firebase-${name}-compat.js`), name);
  }
  const before = sw.calls.length;
  const res = await dispatch(sw, SDK);
  assert.equal(await res.text(), 'sdk ' + SDK);
  assert.equal(sw.calls.length, before, 'no network request for a cached SDK file');
});

test('an SDK file missing from the offline copy is fetched and then kept', async () => {
  const sw = loadSw(async (req, init) => (init.mode === 'cors' ? new Response('checked copy') : opaque()));
  const res = await dispatch(sw, SDK);
  assert.equal(res.type, 'opaque'); // what the page's <script> request got
  assert.equal(await sw.store.get(SDK).text(), 'checked copy');
});

test('without CORS the SDK is not kept, since an unchecked (opaque) copy may be an error page', async () => {
  // A block page or an edge error without CORS headers: the checked download
  // throws, and the no-cors copy the page's <script> tag gets cannot be read.
  const sw = loadSw(async (req, init) => {
    if (init.mode === 'cors') throw new TypeError('CORS refused');
    return opaque();
  });
  const res = await dispatch(sw, SDK);
  assert.equal(res.type, 'opaque', 'the page still gets its answer');
  assert.equal(sw.store.has(SDK), false);
  assert.ok(sw.calls.every((c) => c.init.mode !== 'no-cors'), 'no unchecked download for the offline copy');

  let installing = null;
  sw.listeners.install({ waitUntil: (p) => { installing = p; } });
  await installing;
  assert.equal(sw.store.has(SDK), false, 'nor at install');
});

test("a failed SDK download is not kept, so it cannot stand in for the real file", async () => {
  let status = 503;
  const sw = loadSw(async (req, init) => (init.mode === 'cors' && status === 200
    ? new Response('sdk') : new Response('unavailable', { status })));
  let installing = null;
  sw.listeners.install({ waitUntil: (p) => { installing = p; } });
  await installing;
  assert.equal(sw.store.has(SDK), false, 'not at install');
  await dispatch(sw, SDK);
  assert.equal(sw.store.has(SDK), false, 'not when the page asks for it');
  // The next request goes back to the network, and a good copy is kept then.
  status = 200;
  const before = sw.calls.length;
  await dispatch(sw, SDK);
  assert.ok(sw.calls.length > before);
  assert.equal(await sw.store.get(SDK).text(), 'sdk');
});

test('scripts and styles are checked with the server, not taken from the browser cache', async () => {
  const sw = loadSw(async () => new Response('fresh'));
  const res = await dispatch(sw, `${ORIGIN}/js/nav.js`);
  assert.equal(await res.text(), 'fresh');
  assert.equal(sw.calls.at(-1).init.cache, 'no-cache');
});

test('Google Fonts are still cached by the worker', async () => {
  const sw = loadSw(async () => new Response('css'));
  const url = 'https://fonts.googleapis.com/css2?family=Inter';
  assert.ok(await dispatch(sw, url));
  assert.ok(sw.store.has(url));
});

// --------------------------------------------------------------- .htaccess --

const htaccess = read('public/.htaccess');

function csp() {
  const value = /Content-Security-Policy "([^"]+)"/.exec(htaccess)[1];
  return Object.fromEntries(value.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
}

test('the CSP lets the audit viewer preview PDF, video and audio', () => {
  const p = csp();
  assert.ok(p['frame-src'].includes('blob:'));
  assert.deepEqual(p['media-src'], ["'self'", 'blob:']);
});

// The other sites the service worker downloads from itself, read from sw.js:
// full https:// addresses, the hostnames it routes on, and host patterns in
// its regular expressions such as fonts\.(googleapis|gstatic)\.com.
function swHosts() {
  const src = read('public/sw.js');
  const hosts = new Set();
  for (const m of src.matchAll(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) hosts.add(m[1]);
  for (const m of src.matchAll(/hostname === '([a-z0-9.-]+)'/g)) hosts.add(m[1]);
  for (const m of src.matchAll(/([a-z0-9-]+)\\\.\(([a-z0-9|-]+)\)\\\.([a-z]+)/g)) {
    for (const alt of m[2].split('|')) hosts.add(`${m[1]}.${alt}.${m[3]}`);
  }
  return [...hosts];
}

// Whether a CSP source list lets a page (or the worker) fetch from https://host.
function cspAllows(sources, host) {
  return sources.some((s) => {
    const m = /^https:\/\/(\*\.)?([a-z0-9.-]+)$/.exec(s);
    if (!m) return false;
    return m[1] ? host.endsWith('.' + m[2]) : host === m[2];
  });
}

test("the CSP's connect-src covers every other site the service worker downloads from", () => {
  const hosts = swHosts();
  for (const h of ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
    assert.ok(hosts.includes(h), `sw.js was read: ${h}`);
  }
  const connect = csp()['connect-src'];
  for (const h of hosts) assert.ok(cspAllows(connect, h), h);
});

// Apache applies every matching FilesMatch block in order, so the last match wins.
function cacheControlFor(file) {
  let value = null;
  for (const m of htaccess.matchAll(/<FilesMatch "([^"]+)">\s*Header set Cache-Control "([^"]+)"\s*<\/FilesMatch>/g)) {
    if (new RegExp(m[1]).test(file)) value = m[2];
  }
  return value;
}

test('pages, scripts, styles and the service worker are revalidated; only images and fonts are kept a week', () => {
  for (const f of ['sw.js', 'index.html', 'nav.js', 'styles.css', 'manifest.webmanifest']) {
    assert.equal(cacheControlFor(f), 'no-cache', f);
  }
  for (const f of ['icon-192.png', 'favicon.ico', 'font.woff2']) {
    assert.equal(cacheControlFor(f), 'public, max-age=604800', f);
  }
});

test('www. visitors are sent to the bare address before the HTTPS rule runs', () => {
  const rules = htaccess.split('\n').map((l) => l.trim()).filter((l) => /^Rewrite(Cond|Rule)\b/.test(l));
  assert.equal(rules[0], 'RewriteCond %{HTTP_HOST} ^www\\.(.+)$ [NC]');
  assert.equal(rules[1], 'RewriteRule ^ https://%1%{REQUEST_URI} [L,R=301]');
  assert.match(rules[2], /%\{HTTPS\} !=on/);
  assert.equal(/^www\.(.+)$/i.exec('WWW.hse.example.com')[1], 'hse.example.com');
});

// ------------------------------------------------------------- the rest --

test('email, web address and phone fields get the 16px touch size (no zoom on iPhone)', () => {
  const block = /@media \(pointer: coarse\) \{([\s\S]*?)\{ font-size: 16px;/.exec(read('public/css/styles.css'))[1];
  for (const t of ['text', 'email', 'url', 'tel', 'password', 'search', 'number']) {
    assert.ok(block.includes(`input[type=${t}]`), t);
  }
});

test('the functions runtime is a supported Node.js and matches functions/package.json', () => {
  const runtime = JSON.parse(read('firebase.json')).functions.runtime;
  const engines = JSON.parse(read('functions/package.json')).engines.node;
  const lock = JSON.parse(read('functions/package-lock.json')).packages[''].engines.node;
  assert.equal(runtime, 'nodejs22');
  assert.equal(runtime, 'nodejs' + engines);
  assert.equal(lock, engines);
});
