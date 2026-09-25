// Integration tests for the Firestore + Drive work behind project files and
// backups (functions/project-drive.js), against the Firestore emulator and a
// local stand-in for Drive. Run with `npm run test:rules` in this folder, which
// starts the emulator; on their own they are skipped.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const skip = HOST ? false : 'needs the Firestore emulator (npm run test:rules)';
const PROJECT_ID = 'demo-drive-int';
const DAY = 86400000;

let db, FieldValue, Timestamp, F, makeProjectDrive, fakeDrive;

before(() => {
  if (!HOST) return;
  const { initializeApp } = require('firebase-admin/app');
  const fs = require('firebase-admin/firestore');
  initializeApp({ projectId: PROJECT_ID }, 'drive-int');
  db = fs.getFirestore(require('firebase-admin/app').getApp('drive-int'));
  FieldValue = fs.FieldValue;
  Timestamp = fs.Timestamp;
  F = require('./files.js');
  ({ makeProjectDrive } = require('./project-drive.js'));
  ({ fakeDrive } = require('./drive.js'));
});

beforeEach(async () => {
  if (!HOST) return;
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(res.ok, 'could not clear the emulator');
});

// A fresh Drive stand-in, a clock the test moves, and hooks to make Drive or
// the next Firestore batch fail.
function setup(envOver = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duck-drive-'));
  const base = fakeDrive(dir);
  const calls = { createFolder: [], upload: [], trash: [] };
  const fail = {};
  const drive = {
    async createFolder(name, parent, props) {
      calls.createFolder.push(name);
      if (fail.createFolder && fail.createFolder(name)) throw new Error('Drive said no');
      return base.createFolder(name, parent, props);
    },
    async upload(args) {
      calls.upload.push(args.name);
      if (fail.upload && fail.upload(args)) throw new Error('Drive said no');
      if (fail.onUpload) fail.onUpload(args);
      return base.upload(args);
    },
    download: (id) => base.download(id),
    async trash(id) { calls.trash.push(id); return base.trash(id); }
  };
  // Everything goes to the real emulator, except that fail.nextBatch makes the
  // next batch write fail once.
  const dbx = new Proxy(db, {
    get(t, k) {
      if (k === 'batch') {
        return () => {
          const b = t.batch();
          if (fail.nextBatch) { fail.nextBatch = false; b.commit = async () => { throw new Error('write failed'); }; }
          return b;
        };
      }
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
  const clock = { t: Date.UTC(2026, 8, 24, 10) };
  const env = Object.assign({ DRIVE_ROOT_FOLDER_ID: 'root' }, envOver);
  const pd = makeProjectDrive({
    db: dbx, FieldValue, Timestamp, drive, env, now: () => clock.t, sleep: () => new Promise((r) => setTimeout(r, 20))
  });
  const meta = (id) => JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'));
  const stored = () => readdirSync(dir).filter((n) => n.endsWith('.bin')).map((n) => meta(n.slice(0, -4)));
  return { pd, calls, fail, clock, env, meta, stored, base };
}

async function makeProject(pid, extra = {}) {
  await db.collection('projects').doc(pid).set(Object.assign({
    name: 'Tower crane works', number: 'P-100', status: 'active',
    members: { own: 'owner', man: 'manager', ed: 'editor', view: 'viewer' }, memberUids: ['own', 'man', 'ed', 'view']
  }, extra));
}
const pdf = (bytes) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(bytes - 9, 32)]);
const send = (pd, uid, pid, name, buf, input = {}, emailVerified = true) => pd.uploadFile({
  uid, email: uid + '@example.com', emailVerified, projectId: pid, input: Object.assign({ name, size: buf.length }, input), data: buf.toString('base64')
});
// An account that pays (the rest have no users doc, like an account on the trial).
const paying = (uid, clock) => db.collection('users').doc(uid).set({
  subscriptionStatus: 'active', subscriptionExpiryMillis: clock.t + 30 * DAY, trialEndsAt: clock.t - DAY
});
const usage = async (col, id) => (await db.collection(col).doc(id).get()).data() || {};
const refused = (re) => (e) => e instanceof Error && re.test(e.message);

test('an upload is stored in the project folder and counted for the project and the person', { skip }, async () => {
  const { pd, meta } = setup();
  await makeProject('p1');
  const r = await send(pd, 'ed', 'p1', 'Lift plan.pdf', pdf(1000));
  const rec = (await db.doc(`projects/p1/files/${r.id}`).get()).data();
  assert.equal(rec.name, 'Lift plan.pdf');
  assert.equal(rec.uploadedBy, 'ed');
  const m = meta(rec.driveFileId);
  const folders = await usage('driveFolders', 'p1');
  assert.deepEqual(m.parents, [folders.filesFolderId]);
  assert.deepEqual(m.appProperties, { duckProjectId: 'p1', uploadedBy: 'ed' });
  assert.equal(folders.usedBytes, 1000);
  assert.equal(folders.fileCount, 1);
  assert.deepEqual(await usage('driveUsers', 'ed'), { usedBytes: 1000, fileCount: 1 });
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 1000, fileCount: 1 });
  const back = await pd.downloadFile({ uid: 'view', projectId: 'p1', fileId: r.id });
  assert.equal(Buffer.from(back.data, 'base64').length, 1000);
  await assert.rejects(pd.downloadFile({ uid: 'stranger', projectId: 'p1', fileId: r.id }), refused(/not a member/));
});

test('two uploads at once cannot both slip under the project limit', { skip }, async () => {
  const { pd, stored } = setup({ DRIVE_PROJECT_QUOTA_MB: '1' });
  await makeProject('p1');
  await pd.ensureFolders('p1', { name: 'x' });
  const results = await Promise.allSettled([
    send(pd, 'ed', 'p1', 'a.pdf', pdf(600000)), send(pd, 'man', 'p1', 'b.pdf', pdf(600000))
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /used 0\.6 MB of its 1\.0 MB of file space/);
  assert.equal((await usage('driveFolders', 'p1')).usedBytes, 600000);
  assert.equal(stored().length, 1);
});

test('one person cannot get round the space limit by spreading files over projects', { skip }, async () => {
  const { pd, clock } = setup({ DRIVE_USER_QUOTA_MB: '1' });
  await paying('ed', clock);
  await makeProject('p1');
  await makeProject('p2');
  await send(pd, 'ed', 'p1', 'a.pdf', pdf(700000));
  await assert.rejects(send(pd, 'ed', 'p2', 'b.pdf', pdf(700000)), refused(/across your projects/));
  // Someone else in the same project is not held back by it.
  await send(pd, 'man', 'p2', 'c.pdf', pdf(700000));
});

test('an account whose email address is not verified cannot add files', { skip }, async () => {
  const { pd, calls } = setup();
  await makeProject('p1');
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(1000), {}, false), refused(/Verify your email address before adding files/));
  // Not saying counts as not verified.
  await assert.rejects(pd.uploadFile({ uid: 'ed', projectId: 'p1', input: { name: 'a.pdf', size: 1000 }, data: pdf(1000).toString('base64') }),
    refused(/Verify your email address/));
  assert.deepEqual(calls.upload, []);
  assert.equal((await db.doc('driveUsers/ed').get()).exists, false);
});

test('a free trial gets a small personal space; paying lifts it to the full space', { skip }, async () => {
  const { pd, clock } = setup({ DRIVE_TRIAL_QUOTA_MB: '1' });
  await makeProject('p1');
  await makeProject('p2');
  await db.doc('users/ed').set({ subscriptionStatus: 'trial', trialEndsAt: clock.t + 10 * DAY });
  await send(pd, 'ed', 'p1', 'a.pdf', pdf(700000));
  await assert.rejects(send(pd, 'ed', 'p2', 'b.pdf', pdf(700000)), refused(/During the free trial each person can add up to 1\.0 MB of files, and you have added 0\.7 MB.*Subscribe/));
  // An admin grant counts as paying; so does a subscription.
  await db.doc('users/ed').set({ adminGrantUntil: clock.t + DAY }, { merge: true });
  await send(pd, 'ed', 'p2', 'b.pdf', pdf(700000));
  await db.doc('users/ed').set({ adminGrantUntil: clock.t - 1 }, { merge: true });
  await assert.rejects(send(pd, 'ed', 'p2', 'c.pdf', pdf(100)), refused(/free trial/));
  await paying('ed', clock);
  await send(pd, 'ed', 'p2', 'c.pdf', pdf(100));
  assert.equal((await usage('driveUsers', 'ed')).usedBytes, 1400100);
});

test('the whole portal has a ceiling, kept in step with uploads, failures and emptied trash', { skip }, async () => {
  const { pd, clock, fail } = setup({ DRIVE_TOTAL_QUOTA_MB: '1' });
  await makeProject('p1');
  await makeProject('p2');
  const r = await send(pd, 'ed', 'p1', 'a.pdf', pdf(600000));
  await assert.rejects(send(pd, 'man', 'p2', 'b.pdf', pdf(600000)), (e) => e.code === 'resource-exhausted' && /file storage is full/.test(e.message));
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 600000, fileCount: 1 });
  assert.equal((await usage('driveUsers', 'man')).usedBytes, undefined);

  // A failed upload gives its share back.
  fail.upload = () => true;
  await assert.rejects(send(pd, 'man', 'p2', 'c.pdf', pdf(1000)), /Drive said no/);
  fail.upload = null;
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 600000, fileCount: 1 });

  // A deleted file keeps counting until Drive's trash has emptied.
  await pd.deleteFile({ uid: 'ed', email: 'ed@example.com', projectId: 'p1', fileId: r.id });
  assert.equal((await usage('driveTotals', 'all')).usedBytes, 600000);
  clock.t += 31 * DAY;
  assert.equal(await pd.releaseTrash(), 1);
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 0, fileCount: 0 });
  await send(pd, 'man', 'p2', 'b.pdf', pdf(600000));
});

test('the portal-wide count starts from the space projects already use', { skip }, async () => {
  const { pd } = setup({ DRIVE_TOTAL_QUOTA_MB: '1' });
  await makeProject('p1');
  await makeProject('p2');
  // Files added before the count existed.
  await db.doc('driveFolders/p1').set({ usedBytes: 900000, fileCount: 3 });
  await db.doc('driveFolders/p2').set({ usedBytes: 50000, fileCount: 1 });
  await Promise.all([send(pd, 'ed', 'p1', 'a.pdf', pdf(40000)), send(pd, 'man', 'p2', 'b.pdf', pdf(40000))]);
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 1030000, fileCount: 6 });
  await assert.rejects(send(pd, 'ed', 'p1', 'c.pdf', pdf(40000)), refused(/file storage is full/));
});

test('emptied trash does not bring back the count of a deleted account', { skip }, async () => {
  const { pd, clock } = setup();
  await makeProject('p1');
  const r = await send(pd, 'ed', 'p1', 'a.pdf', pdf(5000));
  await pd.deleteFile({ uid: 'man', email: 'man@example.com', projectId: 'p1', fileId: r.id });
  await db.doc('driveUsers/ed').delete();
  clock.t += 31 * DAY;
  assert.equal(await pd.releaseTrash(), 1);
  assert.equal((await db.doc('driveUsers/ed').get()).exists, false);
  assert.equal((await usage('driveFolders', 'p1')).usedBytes, 0);
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 0, fileCount: 0 });
});

test('file-count limits: 5,000 per project and 20,000 per person', { skip }, async () => {
  const { pd } = setup();
  await makeProject('p1');
  await pd.ensureFolders('p1', { name: 'x' });
  await db.doc('driveFolders/p1').set({ fileCount: F.MAX_FILES_PER_PROJECT }, { merge: true });
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(100)), refused(/reached 5000 files/));
  await db.doc('driveFolders/p1').set({ fileCount: 0 }, { merge: true });
  await db.doc('driveUsers/ed').set({ usedBytes: 0, fileCount: F.MAX_FILES_PER_USER });
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(100)), refused(/20000 files/));
});

test('a deleted file keeps its space for 30 days, then the nightly job frees it', { skip }, async () => {
  const { pd, clock, meta } = setup();
  await makeProject('p1');
  const r = await send(pd, 'ed', 'p1', 'a.pdf', pdf(5000));
  const driveId = (await db.doc(`projects/p1/files/${r.id}`).get()).data().driveFileId;
  await pd.deleteFile({ uid: 'ed', email: 'ed@example.com', projectId: 'p1', fileId: r.id });
  assert.equal((await db.doc(`projects/p1/files/${r.id}`).get()).exists, false);
  assert.equal(meta(driveId).trashed, true);
  assert.equal((await usage('driveFolders', 'p1')).usedBytes, 5000);
  assert.equal((await usage('driveUsers', 'ed')).fileCount, 1);

  clock.t += 29 * DAY;
  assert.equal(await pd.releaseTrash(), 0);
  clock.t += 2 * DAY;
  assert.equal(await pd.releaseTrash(), 1);
  assert.equal(await pd.releaseTrash(), 0);
  const folders = await usage('driveFolders', 'p1');
  assert.equal(folders.usedBytes, 0);
  assert.equal(folders.fileCount, 0);
  assert.deepEqual(await usage('driveUsers', 'ed'), { usedBytes: 0, fileCount: 0 });
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 0, fileCount: 0 });
});

test('editors delete only their own files; archived projects keep theirs', { skip }, async () => {
  const { pd } = setup();
  await makeProject('p1');
  const r = await send(pd, 'man', 'p1', 'a.pdf', pdf(100));
  await assert.rejects(pd.deleteFile({ uid: 'ed', projectId: 'p1', fileId: r.id }), refused(/Only a manager or the person/));
  await db.doc('projects/p1').update({ status: 'archived' });
  await assert.rejects(pd.deleteFile({ uid: 'man', projectId: 'p1', fileId: r.id }), refused(/archived/));
  assert.equal((await db.collection('driveTrash').get()).size, 0);
});

test('a failed Drive upload gives the reserved space back', { skip }, async () => {
  const { pd, fail } = setup();
  await makeProject('p1');
  fail.upload = () => true;
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(1000)), /Drive said no/);
  assert.equal((await usage('driveFolders', 'p1')).usedBytes, 0);
  assert.deepEqual(await usage('driveUsers', 'ed'), { usedBytes: 0, fileCount: 0 });
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 0, fileCount: 0 });
});

test('a failed record write trashes the Drive file and gives the space back', { skip }, async () => {
  const { pd, fail, stored } = setup();
  await makeProject('p1');
  await pd.ensureFolders('p1', { name: 'x' });
  fail.onUpload = () => { fail.nextBatch = true; };
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(1000)), /write failed/);
  assert.equal(stored().length, 1);
  assert.equal(stored()[0].trashed, true);
  assert.equal((await db.collection('projects/p1/files').get()).size, 0);
  assert.equal((await usage('driveFolders', 'p1')).usedBytes, 0);
  assert.deepEqual(await usage('driveUsers', 'ed'), { usedBytes: 0, fileCount: 0 });
  assert.deepEqual(await usage('driveTotals', 'all'), { usedBytes: 0, fileCount: 0 });
});

test('a Drive error while making folders is retried without making the folder twice', { skip }, async () => {
  const { pd, fail, calls } = setup();
  await makeProject('p1');
  let failed = false;
  fail.createFolder = (name) => name === 'Files' && !failed && (failed = true);
  await assert.rejects(send(pd, 'ed', 'p1', 'a.pdf', pdf(100)), /Drive said no/);
  const half = await usage('driveFolders', 'p1');
  assert.ok(half.folderId);
  assert.equal(half.claimedAt, undefined);
  await send(pd, 'ed', 'p1', 'a.pdf', pdf(100));
  assert.deepEqual(calls.createFolder, ['Tower crane works (p1)', 'Files', 'Files', 'Backups']);
  assert.equal((await usage('driveFolders', 'p1')).folderId, half.folderId);
});

test('uploads at the same moment share one set of folders', { skip }, async () => {
  const { pd, calls } = setup();
  await makeProject('p1');
  await Promise.all([1, 2, 3].map((n) => send(pd, 'ed', 'p1', `f${n}.pdf`, pdf(100))));
  assert.deepEqual(calls.createFolder.sort(), ['Backups', 'Files', 'Tower crane works (p1)']);
  assert.equal((await usage('driveFolders', 'p1')).fileCount, 3);
});

test('Back up now and Restore items work once a minute per project', { skip }, async () => {
  const { pd, clock } = setup();
  await makeProject('p1');
  await db.doc('projects/p1/items/i1').set({ type: 'action', title: 'Barrier', status: 'open' });
  const b1 = await pd.backupNow({ uid: 'man', email: 'man@example.com', projectId: 'p1' });
  await assert.rejects(pd.backupNow({ uid: 'man', projectId: 'p1' }), refused(/less than a minute ago/));
  await assert.rejects(pd.backupNow({ uid: 'ed', projectId: 'p1' }), refused(/Only the owner or a manager/));
  clock.t += 61000;
  await pd.backupNow({ uid: 'own', projectId: 'p1' });

  await db.doc('projects/p1/items/i2').set({ type: 'action', title: 'Added later', status: 'open' });
  const r = await pd.restoreItems({ uid: 'man', projectId: 'p1', backupId: b1.id });
  assert.deepEqual([r.restored, r.removed], [1, 1]);
  assert.ok(r.restorePointId);
  await assert.rejects(pd.restoreItems({ uid: 'man', projectId: 'p1', backupId: b1.id }), refused(/restore was started less than a minute/));
  assert.deepEqual((await db.collection('projects/p1/items').get()).docs.map((d) => d.id), ['i1']);
  clock.t += 61000;
  await db.doc('projects/p1').update({ status: 'archived' });
  await assert.rejects(pd.restoreItems({ uid: 'man', projectId: 'p1', backupId: b1.id }), refused(/archived/));
});

test('the nightly backup skips a project that has not changed', { skip }, async () => {
  const { pd, clock, calls } = setup();
  await makeProject('p1');
  await db.doc('projects/p1/items/i1').set({ type: 'action', title: 'Barrier', status: 'open' });
  assert.equal((await pd.runBackup('p1', { kind: 'auto' })).skipped, false);
  clock.t += DAY;
  assert.equal((await pd.runBackup('p1', { kind: 'auto' })).skipped, true);
  assert.equal((await usage('driveFolders', 'p1')).lastCheckedAt, clock.t);
  await db.doc('projects/p1/items/i1').update({ status: 'closed' });
  assert.equal((await pd.runBackup('p1', { kind: 'auto' })).skipped, false);
  assert.equal(calls.upload.length, 2);
});

test('a project over the backup limits is refused before anything is read in full', { skip }, async () => {
  const { pd, calls } = setup();
  await makeProject('p1');
  for (let i = 0; i <= F.MAX_BACKUP_ITEMS; i += 500) {
    const batch = db.batch();
    for (let j = i; j < Math.min(i + 500, F.MAX_BACKUP_ITEMS + 1); j++) batch.set(db.doc(`projects/p1/items/i${j}`), { t: 'x' });
    await batch.commit();
  }
  await assert.rejects(pd.runBackup('p1', { kind: 'auto' }), refused(/too large to back up/));
  assert.equal(calls.upload.length, 0);
});

test('a backup over 7 MB is kept in Drive but not sent through the app', { skip }, async () => {
  const { pd, base } = setup();
  await makeProject('p1');
  const folders = await pd.ensureFolders('p1', { name: 'x' });
  const big = await base.upload({ name: 'big.json', mimeType: 'application/json', parentId: folders.backupsFolderId, data: Buffer.alloc(F.MAX_FILE_BYTES + 1, 32) });
  await db.doc('projects/p1/backups/b1').set({ name: 'big.json', kind: 'manual', driveFileId: big.id, createdAtMs: 1 });
  await assert.rejects(pd.downloadBackup({ uid: 'man', projectId: 'p1', backupId: 'b1' }), refused(/too large to download here/));
  await assert.rejects(pd.downloadBackup({ uid: 'ed', projectId: 'p1', backupId: 'b1' }), refused(/Only the owner or a manager/));
});

test('the nightly run goes oldest-checked first and stops starting projects when out of time', { skip }, async () => {
  const { pd, clock, fail } = setup();
  const order = [];
  for (const [pid, checked] of [['pA', 5], ['pB', 1], ['pC', 4], ['pD', 2], ['pE', 3]]) {
    await makeProject(pid, { name: pid });
    await db.doc(`driveFolders/${pid}`).set({ lastCheckedAt: checked });
  }
  await makeProject('pX', { status: 'archived' });
  fail.onUpload = (args) => { order.push(args.appProperties.duckProjectId); clock.t += 500000; };
  const tally = await pd.dailyBackups({ budgetMs: 1000 });
  assert.deepEqual(order.sort(), ['pB', 'pD', 'pE']);
  assert.deepEqual({ done: tally.done, notReached: tally.notReached, failed: tally.failed }, { done: 3, notReached: 2, failed: 0 });

  // The next night the two left out go first.
  order.length = 0;
  fail.onUpload = (args) => { order.push(args.appProperties.duckProjectId); };
  const next = await pd.dailyBackups({ budgetMs: 1000 });
  assert.deepEqual(order.sort(), ['pA', 'pC']);
  assert.equal(next.skipped, 3);
});
