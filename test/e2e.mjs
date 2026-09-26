// End-to-end check of accounts, projects and team invites against the local
// Firebase emulators. Run from this folder with:
//   npm run test:e2e
// Needs Chromium for Playwright (CHROMIUM_PATH, or Playwright's default).
import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { BASE, newUser, signUp, verifyEmail, resetEmulators, step, report, close } from './e2e-lib.mjs';

await resetEmulators();
// Files the functions keep in a local stand-in for Google Drive (see
// functions/drive.js); npm run test:e2e points them here.
const driveDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.drive-fake');
await rm(driveDir, { recursive: true, force: true });

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

  // 9b. Files and photos, kept in the project's Drive folder. Uploading needs
  // a verified email address.
  await verifyEmail('alice@example.com');
  await alice.evaluate(() => firebase.auth().currentUser.getIdToken(true));
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n% Duck HSE test\n'), Buffer.alloc(4096, 65), Buffer.from('\n%%EOF\n')]);
  await alice.click('#addFileBtn');
  await alice.setInputFiles('#fFiles', { name: 'Lift plan rev B.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
  await alice.fill('#fNote', 'Signed copy');
  await alice.click('#fileSaveBtn');
  await alice.waitForFunction(() => /File added/.test(document.getElementById('filesMsg').textContent), null, { timeout: 20000 });
  await alice.waitForFunction(() => /Lift plan rev B\.pdf[\s\S]*Signed copy/.test(document.getElementById('filesTable').textContent));

  // A large phone photo is made smaller (at most 2400 px) before it is sent.
  await alice.click('#addFileBtn');
  const photoBytes = await alice.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000; c.height = 3000;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
      const x = p % c.width, y = (p / c.width) | 0;
      const n = Math.imul(p, 2654435761) >>> 27;
      img.data[i] = (x ^ y) & 255; img.data[i + 1] = (x + n) & 255; img.data[i + 2] = (y * 3 + n) & 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'Area 3 before.jpeg', { type: 'image/jpeg' }));
    document.getElementById('fFiles').files = dt.files;
    return blob.size;
  });
  assert.ok(photoBytes > 2 * 1048576, `test photo should be over 2 MB, was ${photoBytes}`);
  await alice.click('#fileSaveBtn');
  await alice.waitForFunction(() => /Area 3 before\.jpg/.test(document.getElementById('filesTable').textContent), null, { timeout: 30000 });
  assert.match(await alice.textContent('#filesFoot'), /^2 files, /);

  // What landed in Drive: a folder for the project, with the files inside.
  const metas = await Promise.all((await readdir(driveDir)).filter((f) => f.endsWith('.json'))
    .map(async (f) => JSON.parse(await readFile(path.join(driveDir, f), 'utf8'))));
  const projFolder = metas.find((m) => m.name === `Tower Crane Works (${pid})`);
  assert.ok(projFolder, 'project folder created');
  assert.deepEqual(projFolder.parents, ['fake-root']);
  const filesFolder = metas.find((m) => m.name === 'Files' && m.parents[0] === projFolder.id);
  const storedPdf = metas.find((m) => m.name === 'Lift plan rev B.pdf');
  assert.equal(storedPdf.parents[0], filesFolder.id);
  assert.ok((await readFile(path.join(driveDir, storedPdf.id + '.bin'))).equals(pdfBytes), 'PDF stored byte for byte');
  const storedPhoto = metas.find((m) => m.name === 'Area 3 before.jpg');
  assert.ok(storedPhoto.size < photoBytes, 'photo made smaller');
  step('Files and photos are added to the project’s Drive folder; big photos are made smaller');

  // Web pages are refused in the app, and a page renamed to .png by the server.
  await alice.click('#addFileBtn');
  await alice.setInputFiles('#fFiles', { name: 'invoice.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  await alice.click('#fileSaveBtn');
  await alice.waitForFunction(() => /cannot be added/.test(document.getElementById('fileFormMsg').textContent));
  await alice.click('#fileModal .modal-foot [data-close]');
  const disguised = await alice.evaluate((id) => firebase.functions().httpsCallable('projectFileUpload')({
    projectId: id, name: 'photo.png', size: 25, data: btoa('<script>alert(1)</script>'), category: 'photo'
  }).then(() => 'allowed', (e) => e.message), pid);
  assert.match(disguised, /does not look like a real \.png/);
  step('Web pages and disguised files are refused');

  // Bob (editor) downloads and views; he cannot delete Alice's file.
  await bob.reload();
  await bob.waitForFunction(() => document.querySelectorAll('#filesTable tbody tr').length === 2, null, { timeout: 15000 });
  const pdfRow = bob.locator('#filesTable tbody tr', { hasText: 'Lift plan rev B.pdf' });
  assert.equal(await pdfRow.locator('[data-delete-file]').count(), 0, 'no Delete on someone else’s file');
  const [pdfDl] = await Promise.all([bob.waitForEvent('download'), pdfRow.locator('[data-download]').click()]);
  assert.equal(pdfDl.suggestedFilename(), 'Lift plan rev B.pdf');
  assert.ok((await readFile(await pdfDl.path())).equals(pdfBytes), 'downloaded PDF matches');
  await bob.locator('#filesTable tbody tr', { hasText: 'Area 3 before.jpg' }).locator('[data-view]').click();
  await bob.waitForFunction(() => !document.getElementById('viewModal').hidden && document.getElementById('viewImg').naturalWidth > 0, null, { timeout: 15000 });
  const dims = await bob.evaluate(() => [document.getElementById('viewImg').naturalWidth, document.getElementById('viewImg').naturalHeight]);
  assert.deepEqual(dims, [2400, 1800]);
  await bob.click('#viewModal .modal-foot [data-close]');
  const pdfId = await pdfRow.locator('[data-download]').getAttribute('data-download');
  const bobDelete = await bob.evaluate(([id, fileId]) => firebase.functions().httpsCallable('projectFileDelete')({ projectId: id, fileId })
    .then(() => 'allowed', (e) => e.message), [pid, pdfId]);
  assert.match(bobDelete, /Only a manager or the person who added a file/);
  assert.equal(await bob.isVisible('#backupCard'), false, 'editors do not see backups');

  // Bob attaches a file to a tracked item from the item window, then deletes it.
  await bob.selectOption('#itemStatus', '');
  await bob.locator('#itemsTable tr[data-id]', { hasText: 'Check outriggers' }).click();
  await bob.click('#itemFiles [data-attach]');
  await bob.setInputFiles('#fFiles', { name: 'toolbox talk.txt', mimeType: 'text/plain', buffer: Buffer.from('Outrigger mats checked.\n') });
  await bob.click('#fileSaveBtn');
  await bob.waitForFunction(() => /toolbox talk\.txt/.test(document.getElementById('itemFiles').textContent), null, { timeout: 20000 });
  assert.match(await bob.textContent('#filesTable'), /toolbox talk\.txt[\s\S]*Item: <img src=x/);
  await bob.click('#itemFiles [data-delete-file]');
  await bob.waitForFunction(() => /None yet/.test(document.getElementById('itemFiles').textContent), null, { timeout: 20000 });
  await bob.click('#itemModal .modal-foot [data-close]');
  await alice.waitForFunction(() => /Deleted file: toolbox talk\.txt/.test(document.getElementById('activityFeed').textContent), null, { timeout: 15000 });
  assert.match(await alice.textContent('#activityFeed'), /Added document: Lift plan rev B\.pdf/);
  step('Bob downloads and views files, attaches one to an item, and cannot delete Alice’s');

  // Backups: Alice backs up, downloads the backup, and restores tracked items.
  await alice.waitForSelector('#backupCard:not([hidden])');
  await alice.click('#backupNowBtn');
  await alice.waitForFunction(() => /Backed up/.test(document.getElementById('backupMsg').textContent), null, { timeout: 20000 });
  await alice.waitForSelector('#backupList [data-restore]');
  await alice.click('#backupNowBtn');
  await alice.waitForFunction(() => /less than a minute ago/.test(document.getElementById('backupMsg').textContent), null, { timeout: 20000 });
  const [bkDl] = await Promise.all([alice.waitForEvent('download'), alice.click('#backupList [data-backup-download]')]);
  const backup = JSON.parse(await readFile(await bkDl.path(), 'utf8'));
  assert.equal(backup.format, 'duck-hse-project-backup');
  assert.equal(backup.projectId, pid);
  assert.equal(backup.items.length, 2);
  assert.equal(backup.files.length, 2);
  const itemTitles = async () => (await alice.evaluate((id) => firebase.firestore().collection('projects').doc(id).collection('items').get()
    .then((s) => s.docs.map((d) => d.data().title).sort()), pid));
  const before = await itemTitles();
  await alice.evaluate(async (id) => {
    const items = await firebase.firestore().collection('projects').doc(id).collection('items').get();
    const outriggers = items.docs.find((d) => /Check outriggers/.test(d.data().title));
    await Projects.deleteItem(id, Object.assign({ id: outriggers.id }, outriggers.data()));
    await Projects.saveItem(id, null, { title: 'Temporary item', type: 'action' });
  }, pid);
  assert.deepEqual(await itemTitles(), [before.find((t) => /Permit/.test(t)), 'Temporary item'].sort());
  await alice.click('#backupList [data-restore]');
  await alice.waitForFunction(() => /Restored 2 items and removed 1 added since/.test(document.getElementById('backupMsg').textContent), null, { timeout: 30000 });
  assert.deepEqual(await itemTitles(), before);
  await alice.waitForFunction(() => /Before restore/.test(document.getElementById('backupList').textContent), null, { timeout: 15000 });
  await alice.waitForFunction(() => /Restored tracked items from the backup/.test(document.getElementById('activityFeed').textContent), null, { timeout: 15000 });
  step('Backups: made on demand, downloaded, and used to put deleted items back');

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

  // 10. The dashboard covers every HSE module and counts Alice's project.
  await alice.goto(BASE + 'index.html');
  await alice.waitForFunction(() => typeof DB !== 'undefined' && typeof EQUIPMENT_TYPES !== 'undefined');
  await alice.evaluate(() => DB.saveChecklist({
    equipmentType: EQUIPMENT_TYPES[0].id, assetNo: 'FL-07', inspectionDate: '2026-08-01',
    nextDue: '2026-09-01', verdict: 'unfit', savedAt: new Date().toISOString()
  }));
  await alice.reload();
  await alice.waitForFunction(() => document.getElementById('statProjects')?.textContent === '1', null, { timeout: 15000 });
  assert.equal(await alice.textContent('.topbar .crumb'), 'Your HSE work at a glance');
  assert.equal(await alice.locator('.module-card').count(), 5);
  assert.match(await alice.textContent('#coming-due'), /FL-07[\s\S]*Overdue/);
  assert.match(await alice.textContent('#recent-records'), /Inspection[\s\S]*FL-07[\s\S]*Not fit for use/);
  assert.doesNotMatch(await alice.textContent('body'), /lifting activity|Not for operational lift decisions/);
  step('Dashboard covers all HSE modules and shows what is coming due');
  if (process.env.E2E_SHOTS) {
    await alice.setViewportSize({ width: 1366, height: 900 });
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'dashboard-desktop.png'), fullPage: true });
    await alice.setViewportSize({ width: 390, height: 844 });
    await alice.waitForTimeout(500);   // let the sidebar finish sliding away
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'dashboard-mobile.png'), fullPage: true });
    await alice.setViewportSize({ width: 1280, height: 720 });
  }

  // 10b. Permits to work: old lifting permits still show; a confined space
  // permit is blocked by a bad gas reading, then issued, tracked on the
  // project, and closed out.
  const hour = 36e5;
  await alice.evaluate((h) => localStorage.setItem('cla_permits', JSON.stringify([{
    id: 'P-legacy', permitNumber: 'LP-2026-0003', location: 'Berth 4', personInCharge: 'Old PIC', status: 'active',
    isCriticalLift: true, validFrom: new Date(Date.now() - h).toISOString(), validTo: new Date(Date.now() + 5 * h).toISOString()
  }])), hour);
  await alice.goto(BASE + 'permits.html?type=lifting');
  await alice.waitForSelector('#tableWrap tbody tr');
  assert.match(await alice.textContent('#tableWrap'), /LP-2026-0003[\s\S]*Lifting[\s\S]*Critical lift[\s\S]*Active/);
  assert.equal(await alice.isVisible('#filterType'), true, 'lift filter shown for lifting');

  await alice.goto(BASE + 'permit.html');
  await alice.waitForSelector('#typeChooser .type-card');
  assert.ok(await alice.locator('#typeChooser .type-card').count() >= 4);
  assert.equal(await alice.isVisible('#btnSave'), false);
  await alice.click('#typeChooser a[href="permit.html?type=confined_space"]');
  await alice.waitForURL(/type=confined_space/);
  assert.match(await alice.textContent('#pageTitle'), /^New confined space/i);
  assert.equal(await alice.isVisible('#liftingSection'), false, 'no crane sections on a confined space permit');
  await alice.waitForFunction(() => [...document.querySelectorAll('#projectLink option')].some((o) => /Tower Crane Works/.test(o.textContent)), null, { timeout: 15000 });

  await alice.fill('#location', 'Tank T-4, Unit 2');
  await alice.fill('#workDescription', 'Internal inspection of tank T-4');
  await alice.selectOption('#projectLink', { label: 'P-2041 · Tower Crane Works' });
  await alice.fill('#personInCharge', 'R. Khan');
  await alice.check('#chkRiskAssessment');
  await alice.check('#chkMethodStatement');
  await alice.fill('#validTo', await alice.evaluate(() => {
    const d = new Date(Date.now() + 4 * 36e5); const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }));
  // Every type-specific field and precaution, filled from the registry.
  await alice.evaluate(() => {
    const t = PermitTypes.byKey('confined_space');
    t.fields.forEach((f) => {
      const el = document.getElementById('fld_' + f.key);
      el.value = f.kind === 'select' ? f.options[0] : f.kind === 'list' ? 'Entrant One\nEntrant Two' : f.kind === 'number' ? '3' : f.kind === 'datetime' ? document.getElementById('validFrom').value : 'Checked';
    });
    t.checks.forEach((c) => { document.getElementById('chk_' + c.key).checked = true; });
  });
  const gas = alice.locator('#gasRows tr').first();
  await gas.locator('[data-k="o2"]').fill('18.2');
  for (const k of ['lel', 'h2s', 'co']) if (await gas.locator(`[data-k="${k}"]`).count()) await gas.locator(`[data-k="${k}"]`).fill('0');
  await gas.locator('[data-k="testedBy"]').fill('G. Tester');
  await gas.locator('[data-k="instrument"]').fill('GD-7, calibrated 01/09');
  assert.match(await gas.locator('[data-result]').textContent(), /Outside limits/);
  await alice.fill('#issuerName', 'A. Issuer');
  for (const sel of ['#sigIssuer']) {
    await alice.locator(sel).scrollIntoViewIfNeeded();
    const box = await alice.locator(sel).boundingBox();
    await alice.mouse.move(box.x + 20, box.y + 30);
    await alice.mouse.down();
    await alice.mouse.move(box.x + 120, box.y + 70, { steps: 5 });
    await alice.mouse.up();
  }
  await alice.click('#btnSave');
  await alice.waitForFunction(() => /Oxygen/.test(document.getElementById('validationErrors').textContent));
  assert.match(await alice.textContent('#validationErrors'), /outside the limits/);
  if (process.env.E2E_SHOTS) {
    await alice.setViewportSize({ width: 1366, height: 900 });
    await alice.evaluate(() => window.scrollTo(0, 0));
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'permit-confined-space.png'), fullPage: true });
    await alice.setViewportSize({ width: 1280, height: 720 });
  }
  await gas.locator('[data-k="o2"]').fill('20.9');
  assert.match(await gas.locator('[data-result]').textContent(), /Within limits/);
  await alice.click('#btnSave');
  await alice.waitForURL(/permit\.html\?id=.*mode=view/, { timeout: 15000 });
  const year = new Date().getFullYear();
  // Numbers carry the issuer's code, so two people never issue the same one.
  // The page has just loaded, so wait for the sign-in to be restored.
  const code = await (await alice.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps.length
    && firebase.auth().currentUser && PermitTypes.issuerCode(firebase.auth().currentUser.uid), null, { timeout: 20000 })).jsonValue();
  assert.match(code, /^[A-Z][0-9A-Z]{3}$/);
  assert.equal(await alice.inputValue('#permitNumber'), `CSE-${year}-${code}-0001`);
  assert.match(await alice.textContent('#pageTitle'), new RegExp(`Confined space.*CSE-${year}-${code}-0001`, 'i'));
  step('Confined space permit: blocked by low oxygen, issued after a good reading');

  // Printed, the gas table fits an A4 page instead of losing its right-hand columns.
  await alice.emulateMedia({ media: 'print' });
  await alice.setViewportSize({ width: 718, height: 1000 });
  assert.ok(await alice.evaluate(() => {
    const t = document.querySelector('.gas-table');
    return t.getBoundingClientRect().right <= t.closest('.card, .content, main, body').getBoundingClientRect().right + 1;
  }), 'gas table fits the printed page');
  if (process.env.E2E_SHOTS) await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'permit-print.png'), fullPage: true });
  await alice.emulateMedia({ media: 'screen' });
  await alice.setViewportSize({ width: 1280, height: 720 });
  step('The printed permit fits the gas table on the page');

  await alice.goto(BASE + 'permits.html');
  await alice.waitForSelector('#tableWrap tbody tr:nth-child(2)');
  assert.match(await alice.textContent('#tableWrap'), new RegExp(`CSE-${year}-${code}-0001[\\s\\S]*Confined space`, 'i'));
  if (process.env.E2E_SHOTS) {
    await alice.setViewportSize({ width: 1366, height: 900 });
    await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'permits-list.png'), fullPage: true });
    await alice.setViewportSize({ width: 1280, height: 720 });
  }
  await alice.selectOption('#filterPermitType', 'confined_space');
  assert.equal(await alice.locator('#tableWrap tbody tr').count(), 1);
  assert.equal(await alice.isVisible('#filterType'), false, 'lift filter hidden for other types');
  // A permit from a crafted backup file cannot run script in the list.
  const xss = '<img src=x onerror="window.__xss2=1">Tank';
  await alice.evaluate((x) => DB.savePermit({ id: 'P-xss', permitType: 'hot_work', permitNumber: x, location: x, personInCharge: x, status: 'active', validTo: new Date(Date.now() + 36e5).toISOString() }), xss);
  await alice.reload();
  await alice.waitForSelector('#tableWrap tbody tr:nth-child(3)');
  assert.ok((await alice.textContent('#tableWrap')).includes(xss), 'shown as text');
  assert.equal(await alice.evaluate(() => window.__xss2), undefined);
  await alice.evaluate(() => DB.deletePermit('P-xss'));

  await alice.goto(BASE + 'index.html');
  await alice.waitForSelector('#stat-cards');
  assert.match(await alice.textContent('#stat-cards'), /Active permits\s*2\s*1 high-risk permit · 1 critical lift/);
  assert.equal(await alice.locator('.module-card').count(), 5);

  const item = await alice.evaluate(async (id) => {
    const snap = await firebase.firestore().collection('projects').doc(id).collection('items').where('ref.kind', '==', 'permit').get();
    return snap.docs.map((d) => d.data()).find((d) => /Confined space/i.test(d.title));
  }, pid);
  assert.ok(item, 'permit tracked on the project');
  assert.match(item.title, new RegExp(`CSE-${year}-${code}-0001`));
  assert.equal(item.status, 'in_progress');
  assert.equal(item.priority, 'high');
  step('Permit list, dashboard and project show the permit type');

  const cseId = await alice.evaluate(() => DB.getPermits().find((p) => p.permitType === 'confined_space').id);
  await alice.goto(BASE + 'permit.html?id=' + encodeURIComponent(cseId));
  await alice.waitForSelector('#closeCard:not([hidden])');
  // Unsaved edits are not thrown away by closing.
  await alice.fill('#location', 'Tank T-4, Unit 2 (north manway)');
  await alice.click('#btnClose');
  await alice.waitForFunction(() => /not saved/.test(document.getElementById('closeErrors').textContent));
  // A failed re-test is kept on the permit and suspends it.
  await alice.click('#btnAddGas');
  const retest = alice.locator('#gasRows tr').last();
  await retest.locator('[data-k="point"]').fill('Bottom');
  for (const [k, v] of [['o2', '20.9'], ['lel', '0'], ['h2s', '5'], ['co', '0'], ['testedBy', 'G. Tester'], ['instrument', 'GD-7']]) await retest.locator(`[data-k="${k}"]`).fill(v);
  assert.match(await retest.locator('[data-result]').textContent(), /Outside limits[\s\S]*H₂S 5 ppm/);
  await alice.click('#btnSave');
  await alice.waitForURL(/mode=view/, { timeout: 15000 });
  assert.match(await alice.textContent('#statusBanner'), /suspended/i);
  assert.deepEqual(await alice.evaluate((id) => { const p = DB.getPermits().find((x) => x.id === id); return [p.status, p.gasTests.length, p.location]; }, cseId),
    ['suspended', 2, 'Tank T-4, Unit 2 (north manway)']);
  step('A failed gas re-test is saved and suspends the permit; unsaved edits block closing');

  await alice.goto(BASE + 'permit.html?id=' + encodeURIComponent(cseId));
  await alice.waitForSelector('#closeCard:not([hidden])');
  await alice.click('#btnClose');
  await alice.waitForFunction(() => /Record who is closing/.test(document.getElementById('closeErrors').textContent));
  await alice.fill('#closedBy', 'R. Khan');
  await alice.$$eval('#closeChecks input[type=checkbox]', (els) => els.forEach((e) => { e.checked = true; }));
  await alice.click('#btnClose');
  await alice.waitForURL(/mode=view/, { timeout: 15000 });
  await alice.waitForSelector('#closeoutSummary:not([hidden])');
  assert.match(await alice.textContent('#statusBanner'), /closed/i);
  let closedItem = false;
  for (let i = 0; i < 30 && !closedItem; i++) {
    closedItem = await alice.evaluate(async (id) => {
      const snap = await firebase.firestore().collection('projects').doc(id).collection('items').where('ref.kind', '==', 'permit').get();
      return snap.docs.some((d) => /Confined space/i.test(d.data().title) && d.data().status === 'closed');
    }, pid);
    if (!closedItem) await alice.waitForTimeout(500);
  }
  assert.ok(closedItem, 'project item closed');
  step('Closing out the permit records who closed it and closes the project item');

  // Hot work stays open until the fire watch has run for an hour.
  await alice.evaluate((y) => DB.savePermit({
    id: 'P-hw', permitType: 'hot_work', permitNumber: `HW-${y}-0001`, location: 'Pipe rack 3', personInCharge: 'W. Welder',
    status: 'active', validFrom: new Date(Date.now() - 3 * 36e5).toISOString(), validTo: new Date(Date.now() + 36e5).toISOString(),
    details: { hotWorkType: 'Electric arc welding' }, checks: {},
  }), year);
  await alice.goto(BASE + 'permit.html?id=P-hw');
  await alice.waitForSelector('#closeCard:not([hidden])');
  const localAgo = (mins) => alice.evaluate((m) => {
    const d = new Date(Date.now() - m * 60000); const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, mins);
  await alice.fill('#closedBy', 'W. Welder');
  await alice.$$eval('#closeChecks input[type=checkbox]', (els) => els.forEach((e) => { e.checked = true; }));
  await alice.fill('#closefld_hotWorkEnded', await localAgo(30));
  await alice.fill('#closefld_fireWatchEnded', await localAgo(1));
  await alice.click('#btnClose');
  await alice.waitForFunction(() => /at least 1 hour/.test(document.getElementById('closeErrors').textContent));
  await alice.fill('#closefld_hotWorkEnded', await localAgo(75));
  await alice.click('#btnClose');
  await alice.waitForURL(/id=P-hw.*mode=view/, { timeout: 15000 });
  await alice.waitForSelector('#closeoutSummary:not([hidden])');
  assert.match(await alice.textContent('#closeoutSummary'), /Fire watch ended at/);
  assert.equal(await alice.evaluate(() => DB.getPermits().find((p) => p.id === 'P-hw').status), 'closed');
  step('Hot work cannot be closed until the fire watch has run for an hour');

  // 11. Delete my data: nobody signed out can erase; signed in needs the password.
  const visitor = await newUser();
  await visitor.goto(BASE + 'account-deletion.html');
  await visitor.waitForSelector('#wipeSignedOut:not([hidden])');
  assert.equal(await visitor.isVisible('#btnWipe'), false);
  assert.equal(await visitor.isVisible('#wipeForm'), false);
  step('A signed-out visitor gets no erase button');

  await alice.goto(BASE + 'account-deletion.html');
  await alice.waitForSelector('#wipeForm:not([hidden])');
  assert.equal(await alice.textContent('#wipeEmail'), 'alice@example.com');
  await alice.fill('#wipePassword', 'not-my-password');
  await alice.click('#btnWipe');
  await alice.waitForFunction(() => /not right/.test(document.getElementById('wipeResult').textContent), null, { timeout: 15000 });
  assert.ok(await alice.evaluate(() => DB.getChecklists().length > 0), 'nothing erased on a wrong password');
  if (process.env.E2E_SHOTS) await alice.screenshot({ path: path.join(process.env.E2E_SHOTS, 'erase-signed-in.png'), fullPage: true });
  await alice.fill('#wipePassword', 'correct-horse-battery');
  await alice.click('#btnWipe');
  await alice.waitForFunction(() => /have been erased/.test(document.getElementById('wipeResult').textContent), null, { timeout: 15000 });
  assert.equal(await alice.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cla_')).length), 0);
  await alice.waitForSelector('#wipeSignedOut:not([hidden])');
  step('Erasing needs the password, then wipes the device and signs out');

  // 12. Records come back from the account after an erase, inspections too.
  async function signInAs(page, email) {
    await page.goto(BASE + 'login.html');
    await page.waitForSelector('#cloudSection:not([hidden])');
    await page.fill('#cloudEmail', email);
    await page.fill('#cloudPassword', 'correct-horse-battery');
    await page.click('#cloudSubmitBtn');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), null, { timeout: 20000 });
    return (await page.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps.length
      && firebase.auth().currentUser && firebase.auth().currentUser.uid, null, { timeout: 20000 })).jsonValue();
  }
  // Signing out can navigate twice (the sign-out and the auth watch), so wait
  // for the login page to settle rather than for one navigation.
  async function signOutOf(page) {
    await page.evaluate(() => { Access.signOut(); });
    await page.waitForFunction(() => location.pathname.endsWith('login.html') && document.readyState === 'complete', null, { timeout: 15000 });
    await page.waitForTimeout(500);
  }
  await signInAs(alice, 'alice@example.com');
  await alice.waitForFunction(() => /FL-07/.test(document.getElementById('recent-records').textContent), null, { timeout: 20000 });
  assert.ok(await alice.evaluate(() => DB.getPermits().some((p) => p.permitType === 'confined_space')), 'permits come back too');
  step('After an erase, signing in brings inspections and permits back from the account');

  // 13. Links to one record open it, or say it is not on this device yet.
  const assessor = '<img src=x onerror="window.__xss3=1">A. Assessor';
  const aid = await alice.evaluate((name) => DB.saveAssessment({
    date: new Date().toISOString(), craneModel: Object.keys(CRANE_DATA)[0], configuration: '<b>cfg</b>',
    loadWeight: 12.5, windSpeed: 4, utilization: 40, isValid: true, assessorName: name
  }).id, assessor);
  await alice.goto(BASE + 'history.html?id=' + encodeURIComponent(aid));
  await alice.waitForSelector('#adModal');
  assert.ok((await alice.textContent('#tableWrap')).includes('<img src=x'), 'assessor name shown as text');
  assert.equal(await alice.evaluate(() => window.__xss3), undefined);
  await alice.goto(BASE + 'history.html?id=A-not-here');
  await alice.waitForFunction(() => /not on this device yet/.test(document.getElementById('statusBanner').textContent));
  await alice.goto(BASE + 'checklist.html?id=C-not-here');
  await alice.waitForFunction(() => /not on this device yet/.test(document.querySelector('.content').textContent));
  assert.equal(await alice.isVisible('#btnSave'), false, 'no blank form under a record link');
  step('Record links open the record, or say it is not on this device yet');

  // 14. A shared device: Bob signs in on Alice's device. He sees none of her
  // records, his own are kept apart, and hers are all back when she returns.
  await signOutOf(alice);
  const bobHereUid = await signInAs(alice, 'bob@example.com');
  assert.equal(await alice.evaluate(() => DB.getChecklists().length + DB.getPermits().length + DB.getAssessments().length), 0, 'none of Alice\'s records');
  assert.match(await alice.textContent('#recent-records'), /No records yet/);
  assert.equal(await alice.evaluate(() => DeviceData.idbName('cla_audit_store_v1')), 'cla_audit_store_v1:' + bobHereUid, 'Bob has his own evidence store');
  await alice.evaluate(() => DB.saveChecklist({
    equipmentType: EQUIPMENT_TYPES[0].id, assetNo: 'BOB-1', inspectionDate: '2026-08-02',
    nextDue: '2027-08-02', verdict: 'fit', savedAt: new Date().toISOString()
  }));
  await alice.evaluate(() => DB.flush(5000));
  await signOutOf(alice);
  await signInAs(alice, 'alice@example.com');
  await alice.waitForFunction(() => /FL-07/.test(document.getElementById('recent-records').textContent), null, { timeout: 20000 });
  assert.equal(await alice.evaluate(() => DB.getChecklists().some((c) => c.assetNo === 'BOB-1')), false, 'Bob\'s record stays his');
  assert.equal(await alice.evaluate(() => DB.getAssessments().length), 1, 'Alice\'s assessment is back');
  assert.equal(await alice.evaluate(() => DeviceData.idbName('cla_audit_store_v1')), 'cla_audit_store_v1');
  step('On a shared device each account sees only its own records, and nothing is lost');

  // 15. A second device gets Alice's records, and a delete made there
  // reaches this device instead of coming back.
  const alice2 = await newUser();
  await signInAs(alice2, 'alice@example.com');
  await alice2.waitForFunction(() => /FL-07/.test(document.getElementById('recent-records').textContent), null, { timeout: 20000 });
  await alice.goto(BASE + 'checklists.html');
  await alice.waitForFunction(() => /FL-07/.test(document.getElementById('tableWrap').textContent), null, { timeout: 15000 });
  await alice2.evaluate(() => DB.deleteChecklist(DB.getChecklists().find((c) => c.assetNo === 'FL-07').id));
  await alice.waitForFunction(() => !/FL-07/.test(document.getElementById('tableWrap').textContent), null, { timeout: 20000 });
  await alice.reload();
  await alice.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps.length && firebase.auth().currentUser, null, { timeout: 20000 });
  await alice.waitForTimeout(2000);   // time for the account's copy to be merged again
  assert.equal(await alice.evaluate(() => DB.getChecklists().some((c) => c.assetNo === 'FL-07')), false, 'the delete does not come back');
  assert.deepEqual(alice2.errors, [], 'second device page errors');
  step('Records reach a second device, and deletes made there reach this one');

  // 16. The project's CSV export has every item, closed ones included.
  await bob.goto(projectUrl);
  await bob.waitForSelector('#projectBody:not([hidden])');
  const itemCount = await bob.evaluate((id) => firebase.firestore().collection('projects').doc(id).collection('items').get().then((s) => s.size), pid);
  await bob.selectOption('#itemStatus', '');
  await bob.waitForFunction((n) => document.querySelectorAll('#itemsTable tr[data-id]').length === n, itemCount, { timeout: 15000 });
  await bob.selectOption('#itemStatus', 'notclosed');
  assert.ok(await bob.locator('#itemsTable tr[data-id]').count() < itemCount, 'the default view hides closed items');
  const [csvDl] = await Promise.all([bob.waitForEvent('download'), bob.click('#exportBtn')]);
  const csvRows = (await readFile(await csvDl.path(), 'utf8')).replace(/^﻿/, '').split('\r\n');
  assert.equal(csvRows.length, itemCount + 1, 'header plus every item');
  assert.ok(csvRows.some((r) => r.includes('"Closed"')), 'closed items exported');
  step('Export all items (CSV) includes the closed items the list is not showing');

  // 17. Settings import checks the file, and Merge / Replace / Cancel mean what they say.
  await bob.goto(BASE + 'settings.html');
  await bob.waitForFunction(() => typeof DB !== 'undefined' && typeof BackupImport !== 'undefined');
  const jsonFile = (name, obj) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
  await bob.setInputFiles('#fileImport', jsonFile('P-2041_backup.json', backup));
  await bob.waitForFunction(() => /project backup/.test(document.getElementById('importResult').textContent));
  assert.equal(await bob.isVisible('#importModal'), false, 'a project backup is refused');
  const mine = {
    exportedAt: new Date().toISOString(),
    assessments: [{ id: 'A-imp', craneModel: 'QY25K5D' }],
    permits: [{ id: 'P-imp', permitType: 'hot_work', permitNumber: 'HW-IMP-0001', status: 'closed' }],
    checklists: [{ id: 'C-imp', assetNo: 'IMP-1', inspectionDate: '2026-09-01' }]
  };
  const localCounts = () => bob.evaluate(() => [DB.getAssessments().length, DB.getPermits().length, DB.getChecklists().length]);
  const beforeImport = await localCounts();
  await bob.setInputFiles('#fileImport', jsonFile('duck-hse-backup.json', mine));
  await bob.waitForSelector('#importModal:not([hidden])');
  await bob.click('#importModal .modal-foot [data-import-cancel]');
  assert.deepEqual(await localCounts(), beforeImport, 'Cancel changes nothing');
  await bob.setInputFiles('#fileImport', jsonFile('duck-hse-backup.json', mine));
  await bob.waitForSelector('#importModal:not([hidden])');
  await bob.click('#importReplaceBtn');
  await bob.waitForSelector('#importReplaceWarn:not([hidden])');
  await bob.click('#importModal .modal-foot [data-import-cancel]');
  assert.deepEqual(await localCounts(), beforeImport, 'Replace asks again before changing anything');
  await bob.setInputFiles('#fileImport', jsonFile('duck-hse-backup.json', mine));
  await bob.waitForSelector('#importModal:not([hidden])');
  await bob.click('#importMergeBtn');
  await bob.waitForFunction(() => /Backup merged: 1 inspection checklist, 1 permit and 1 lift assessment imported/
    .test(document.getElementById('importResult').textContent), null, { timeout: 20000 });
  assert.deepEqual(await localCounts(), beforeImport.map((n) => n + 1));
  step('Settings import refuses a project backup; Cancel and a first Replace change nothing; Merge reports all three counts');

  // 18. Bob's trial ends while his project is open: it turns read-only
  // instead of sending him to the paywall, and he can still download.
  const { setUserNumber } = await import('./e2e-lib.mjs');
  const bobUid = await bob.evaluate(() => firebase.auth().currentUser.uid);
  await bob.goto(projectUrl);
  await bob.waitForSelector('#addItemBtn:not([hidden])', { timeout: 15000 });
  const navsBefore = bob.navs.length;
  await setUserNumber(bobUid, 'trialEndsAt', Date.now() - 60000);
  await bob.waitForSelector('#readOnlyBanner:not([hidden])', { timeout: 15000 });
  assert.match(await bob.textContent('#readOnlyBanner'), /trial or subscription has ended/);
  assert.equal(await bob.isVisible('#addItemBtn'), false);
  assert.equal(await bob.isVisible('#addFileBtn'), false);
  assert.equal(await bob.isEnabled('#exportBtn'), true);
  const roPdf = bob.locator('#filesTable tbody tr', { hasText: 'Lift plan rev B.pdf' });
  const [roDl] = await Promise.all([bob.waitForEvent('download'), roPdf.locator('[data-download]').click()]);
  assert.ok((await readFile(await roDl.path())).equals(pdfBytes), 'files still download');
  await bob.selectOption('#itemStatus', '');
  await bob.locator('#itemsTable tr[data-id]').first().click();
  assert.equal(await bob.isVisible('#itemSaveBtn'), false);
  assert.equal(await bob.isDisabled('#iTitle'), true);
  await bob.click('#itemModal .modal-foot [data-close]');
  assert.equal(bob.navs.length, navsBefore, 'stayed on the project page');
  step('When Bob’s trial ends, the open project turns read-only and files still download');

  await bob.goto(BASE + 'projects.html');
  await bob.waitForSelector('.project-card', { timeout: 15000 });
  await bob.waitForSelector('#readOnlyBanner:not([hidden])');
  assert.equal(await bob.isVisible('#newProjectBtn'), false);
  await bob.goto(BASE + 'settings.html');
  await bob.waitForSelector('#readOnlyBanner:not([hidden])');
  assert.equal(await bob.isVisible('#importLabel'), false, 'no import while read-only');
  const [expDl] = await Promise.all([bob.waitForEvent('download'), bob.click('#btnExport')]);
  const exported = JSON.parse(await readFile(await expDl.path(), 'utf8'));
  assert.ok(exported.permits.some((p) => p.id === 'P-imp'), 'export still works');
  await bob.goto(BASE + 'index.html');
  await bob.waitForURL(/subscribe\.html/, { timeout: 15000 });
  step('A lapsed account opens its projects and exports from Settings; other pages go to the paywall');

  await bob.goto(projectUrl);
  await bob.waitForSelector('#readOnlyBanner:not([hidden])', { timeout: 15000 });
  await setUserNumber(bobUid, 'trialEndsAt', Date.now() + 86400000);
  await bob.waitForSelector('#addItemBtn:not([hidden])', { timeout: 15000 });
  assert.equal(await bob.isVisible('#readOnlyBanner'), false);
  step('When access comes back, the open project can be edited again');

  for (const [name, p] of [['alice', alice], ['bob', bob], ['visitor', visitor]]) {
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
