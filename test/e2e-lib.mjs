// Shared wiring for the browser end-to-end tests: a static server for public/,
// Chromium with the Firebase SDK served locally and pointed at the emulators,
// and sign-up helpers. Used by e2e.mjs and e2e-payments.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const sdk = path.join(here, 'node_modules', 'firebase');
export const PROJECT = 'demo-duck-hse';
const PORT = 8765;
export const BASE = `http://localhost:${PORT}/`;

// ---- Static server for public/ ---------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
export const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, BASE).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(pub, p);
  if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(PORT, r));

// ---- Browser wiring: local SDK + emulators ------------------------------------
const testConfig = `const FIREBASE_CONFIG = { apiKey: 'demo-key', authDomain: 'localhost', projectId: '${PROJECT}', appId: 'demo-app', messagingSenderId: '0' };`;
const emulatorPatch = `
;(function () {
  const init = firebase.initializeApp.bind(firebase);
  firebase.initializeApp = function (cfg) {
    const app = init(cfg);
    firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    firebase.firestore().useEmulator('127.0.0.1', 8080);
    firebase.functions().useEmulator('127.0.0.1', 5001);
    return app;
  };
})();`;

export const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
export async function newUser() {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('cla_tos_privacy_accepted_v1', JSON.stringify({ version: '2026-09-24', acceptedAt: new Date().toISOString() })));
  await ctx.route(/gstatic\.com\/firebasejs\/.*\/(firebase-[a-z-]+-compat\.js)$/, async (route) => {
    const name = route.request().url().split('/').pop();
    let body = await readFile(path.join(sdk, name), 'utf8');
    if (name === 'firebase-functions-compat.js') body += emulatorPatch;   // last SDK loaded
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${BASE}js/firebase-config.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: testConfig }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.navs = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.navs.push(f.url().replace(BASE, '')); });
  page.logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.logs.push(m.text().slice(0, 200)); });
  return page;
}

// Admin reads/writes on the Firestore emulator (bypass the rules).
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const plain = (v) => ('integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? v.timestampValue : null);
export async function userDoc(uid) {
  const r = await fetch(`${DOCS}/users/${uid}`, { headers: OWNER });
  if (r.status === 404) return null;
  const d = await r.json();
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, plain(v)]));
}
export async function setUserNumber(uid, field, value) {
  const r = await fetch(`${DOCS}/users/${uid}?updateMask.fieldPaths=${field}`, {
    method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: { [field]: { integerValue: String(value) } } })
  });
  assert.ok(r.ok, 'admin write');
}

// Signs up through the login page and waits for the free trial. Returns the uid.
export async function signUp(page, email) {
  await page.goto(BASE + 'login.html');
  await page.waitForSelector('#cloudSection:not([hidden])');
  await page.click('#toggleModeLink');
  await page.fill('#cloudEmail', email);
  await page.fill('#cloudPassword', 'correct-horse-battery');
  await page.click('#cloudSubmitBtn');
  await page.waitForFunction(() => location.pathname.endsWith('index.html'), null, { timeout: 20000 });
  const uid = await (await page.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps.length
    && firebase.auth().currentUser && firebase.auth().currentUser.uid, null, { timeout: 20000 })).jsonValue();
  // The trial is stamped by onUserCreate in production. The emulator's auth
  // trigger can't reach the functions emulator through this sandbox's proxy,
  // so this exercises the app's own fallback (Entitlements.ensureTrial).
  for (let i = 0; ; i++) {
    const u = await userDoc(uid);
    if (u && u.trialEndsAt) return uid;
    if (i > 80) throw new Error(`No trial was stamped for ${email}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function verifyEmail(email) {
  const base = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
  const list = await (await fetch(`${base}/accounts:query`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}' })).json();
  const u = list.userInfo.find((x) => x.email === email);
  const r = await fetch(`${base}/accounts:update`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: u.localId, emailVerified: true }) });
  assert.ok(r.ok, 'verify email via emulator');
}

// Start from empty emulators (they may be reused between runs).
export async function resetEmulators() {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

export const step = (s) => console.log('✓', s);

// On failure: what each open page was showing.
export async function report(err) {
  console.error('✗', err.message);
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const banners = await p.$$eval('.banner', (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent.trim())).catch(() => []);
      console.error('  page', p.url(), 'banners:', JSON.stringify(banners), 'errors:', JSON.stringify(p.errors), 'navs:', JSON.stringify(p.navs));
      if (process.env.E2E_DEBUG) console.error('  console:', JSON.stringify(p.logs));
    }
  }
}

export async function close() {
  await browser.close();
  server.close();
}

