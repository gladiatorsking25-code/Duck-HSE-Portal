// End-to-end check of accounts, projects and team invites against the local
// Firebase emulators. Run from this folder with:
//   npm run test:e2e
// Needs Chromium for Playwright (CHROMIUM_PATH, or Playwright's default).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const sdk = path.join(here, 'node_modules', 'firebase');
const PROJECT = 'demo-duck-hse';
const PORT = 8765;
const BASE = `http://localhost:${PORT}/`;

// ---- Static server for public/ ---------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function newUser() {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('cla_tos_privacy_accepted_v1', JSON.stringify({ version: '2026-09-11', acceptedAt: new Date().toISOString() })));
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

async function signUp(page, email) {
  await page.goto(BASE + 'login.html');
  await page.waitForSelector('#cloudSection:not([hidden])');
  await page.click('#toggleModeLink');
  await page.fill('#cloudEmail', email);
  await page.fill('#cloudPassword', 'correct-horse-battery');
  await page.click('#cloudSubmitBtn');
  await page.waitForFunction(() => location.pathname.endsWith('index.html'), null, { timeout: 20000 });
  // The trial is stamped by onUserCreate in production. The emulator's auth
  // trigger can't reach the functions emulator through this sandbox's proxy,
  // so this exercises the app's own fallback (Entitlements.ensureTrial).
  await page.waitForFunction(async () => {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return false;
    const u = firebase.auth().currentUser;
    if (!u) return false;
    const snap = await firebase.firestore().collection('users').doc(u.uid).get({ source: 'server' });
    return !!(snap.exists && snap.data().trialEndsAt);
  }, null, { timeout: 20000, polling: 500 });
}

async function verifyEmail(email) {
  const base = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
  const list = await (await fetch(`${base}/accounts:query`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}' })).json();
  const u = list.userInfo.find((x) => x.email === email);
  const r = await fetch(`${base}/accounts:update`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: u.localId, emailVerified: true }) });
  assert.ok(r.ok, 'verify email via emulator');
}

// Start from empty emulators (they may be reused between runs).
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

const step = (s) => console.log('✓', s);
let failed = false;
try {
  // 1. Alice signs up, gets a trial, creates a project.
  const alice = await newUser();
  await signUp(alice, 'alice@example.com');
  step('Alice signed up and landed on the dashboard');

  await alice.goto(BASE + 'projects.html');
  await alice.waitForFunction(() => /No projects yet/.test(document.getElementById('projectList').textContent), null, { timeout: 15000 });

  await alice.click('#newProjectBtn');
  await alice.fill('#pName', 'Tower Crane Works');
  await alice.fill('#pNumber', 'P-2041');
  await alice.fill('#pClient', 'ACME');
  await alice.click('#projectSaveBtn');
  await alice.waitForURL(/project\.html\?id=/, { timeout: 15000 });
  const projectUrl = alice.url();
  await alice.waitForSelector('#projectBody:not([hidden])');
  assert.equal(await alice.textContent('#pageTitle'), 'Tower Crane Works');
  step('Alice created a project');

  // 2. Alice adds an item (with a script-injection attempt in the title).
  const evil = '<img src=x onerror="window.__xss=1">Check outriggers';
  await alice.click('#addItemBtn');
  await alice.fill('#iTitle', evil);
  await alice.selectOption('#iPriority', 'high');
  await alice.fill('#iDue', '2020-01-01');
  await alice.click('#itemSaveBtn');
  await alice.waitForSelector('#itemsTable tr[data-id]');
  const stats = await alice.$$eval('#statCards .value', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['1', '0', '1', '0'], 'open / in progress / overdue / closed');
  step('Alice added an overdue item; stats show 1 open, 1 overdue');

  // 3. Bob signs up; Alice invites him before he has verified his email.
  const bob = await newUser();
  await signUp(bob, 'bob@example.com');
  await alice.fill('#inviteEmail', 'bob@example.com');
  await alice.selectOption('#inviteRole', 'editor');
  await alice.click('#inviteBtn');
  await alice.waitForFunction(() => /Invite saved/.test(document.getElementById('teamMsg').textContent), null, { timeout: 20000 });
  await alice.waitForSelector('#pendingList [data-cancel]');
  step('Invite to an unverified address is held as pending');

  // 4. Unverified Bob cannot join or see the project.
  await bob.goto(BASE + 'projects.html');
  await bob.waitForSelector('#verifyBtn', { timeout: 20000 });
  await bob.goto(projectUrl);
  await bob.waitForFunction(() => /does not exist|do not have access/.test(document.getElementById('notice').textContent), null, { timeout: 15000 });
  step('Unverified Bob is asked to verify and cannot open the project');

  // 5. Bob verifies, reloads, joins as editor.
  await verifyEmail('bob@example.com');
  await bob.goto(BASE + 'projects.html');
  await bob.waitForFunction(() => /You joined 1 project/.test(document.getElementById('notice').textContent), null, { timeout: 20000 });
  await bob.waitForSelector('.project-card');
  await bob.goto(projectUrl);
  await bob.waitForSelector('#itemsTable tr[data-id]');
  assert.equal(await bob.evaluate(() => window.__xss), undefined, 'item title must not execute as HTML');
  assert.ok((await bob.textContent('#itemsTable')).includes('<img src=x'), 'title shown as text');
  assert.equal(await bob.$('#editProjectBtn'), null, 'editor has no Edit details button');
  assert.equal(await bob.isVisible('#inviteForm'), false, 'editor cannot invite');
  assert.equal(await bob.isVisible('#addItemBtn'), true, 'editor can add items');
  assert.equal(await alice.isVisible('#leaveBtn'), false, 'owner has no Leave button');
  step('Verified Bob joined as editor; injected HTML rendered as text');

  // 6. Bob closes the item; Alice sees it live.
  await bob.click('#itemsTable tr[data-id]');
  await bob.selectOption('#iStatus', 'closed');
  await bob.click('#itemSaveBtn');
  await alice.waitForFunction(() => [...document.querySelectorAll('#statCards .value')].map((e) => e.textContent).join() === '0,0,0,1', null, { timeout: 15000 });
  step('Bob closed the item and Alice saw it update live');

  // 7. Bob (editor) tries to write membership directly: rules must refuse.
  const pid = new URL(projectUrl).searchParams.get('id');
  const direct = await bob.evaluate(async (id) => {
    try {
      await firebase.firestore().collection('projects').doc(id).update({ 'members.intruder': 'owner' });
      return 'allowed';
    } catch (e) { return e.code; }
  }, pid);
  assert.equal(direct, 'permission-denied');
  const viaFn = await bob.evaluate((id) => Projects.setMember(id, 'eve@example.com', 'viewer').then(() => 'allowed', (e) => e.message), pid);
  assert.match(viaFn, /owner or a manager/);
  step('Bob cannot change the team, directly or through the server');

  // 8. Linked records: syncing the same permit twice gives one item.
  const linked = await alice.evaluate(async (id) => {
    const ref = { kind: 'permit', id: 'P-123', label: 'Permit LP-0001' };
    await Projects.upsertLinkedItem(id, ref, { title: 'Permit LP-0001: tandem lift', status: 'in_progress', priority: 'critical' });
    await Projects.upsertLinkedItem(id, ref, { title: 'Permit LP-0001: tandem lift', status: 'closed', priority: 'critical' });
    const snap = await firebase.firestore().collection('projects').doc(id).collection('items').where('ref.id', '==', 'P-123').get();
    return snap.docs.map((d) => d.data().status);
  }, pid);
  assert.deepEqual(linked, ['closed']);
  step('Linking a permit twice updates one tracked item');

  // 8b. The permit, assessment and checklist forms offer the project.
  for (const [pageName, sel] of [['permit.html', '#projectLink'], ['assessment.html', '#projectLink'], ['checklist.html', '#projectId']]) {
    await alice.goto(BASE + pageName);
    await alice.waitForFunction((s) => [...document.querySelectorAll(s + ' option')].some((o) => /Tower Crane Works/.test(o.textContent)), sel, { timeout: 15000 });
  }
  await alice.goto(projectUrl);
  await alice.waitForSelector('#projectBody:not([hidden])');
  step('Permit, assessment and checklist forms list the project');

  // 9. Activity log recorded the story.
  await alice.waitForFunction(() => document.querySelectorAll('#activityFeed li').length >= 5, null, { timeout: 15000 });
  const feed = await alice.textContent('#activityFeed');
  assert.match(feed, /bob@example\.com joined as editor/);
  step('Activity feed shows the join and item changes');

  if (process.env.E2E_SHOTS) {
    await alice.setViewportSize({ width: 1366, height: 900 });
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'project-desktop.png'), fullPage: true });
    await alice.setViewportSize({ width: 390, height: 844 });
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'project-mobile.png'), fullPage: true });
    await alice.goto(BASE + 'projects.html');
    await alice.waitForSelector('.project-card');
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'projects-mobile.png'), fullPage: true });
    await alice.setViewportSize({ width: 1366, height: 900 });
  }

  for (const [name, p] of [['alice', alice], ['bob', bob]]) {
    assert.deepEqual(p.errors, [], `${name} page errors`);
  }
  step('No JavaScript errors');
} catch (err) {
  failed = true;
  console.error('✗', err.message);
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const banners = await p.$$eval('.banner', (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent.trim())).catch(() => []);
      console.error('  page', p.url(), 'banners:', JSON.stringify(banners), 'errors:', JSON.stringify(p.errors), 'navs:', JSON.stringify(p.navs));
      if (process.env.E2E_DEBUG) console.error('  console:', JSON.stringify(p.logs));
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
