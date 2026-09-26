// End-to-end check of accounts, projects and team invites against the local
// Firebase emulators. Run from this folder with:
//   npm run test:e2e
// Needs Chromium for Playwright (CHROMIUM_PATH, or Playwright's default).
import path from 'node:path';
import assert from 'node:assert/strict';
import { BASE, newUser, signUp, verifyEmail, resetEmulators, step, report, close } from './e2e-lib.mjs';

await resetEmulators();

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
  await report(err);
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
