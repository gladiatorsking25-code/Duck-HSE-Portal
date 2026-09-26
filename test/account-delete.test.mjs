// Tests for deleting an account on request (functions/account-delete.js).
// The decisions are unit tests; the Firestore work runs against the Firestore
// emulator with a stand-in for Firebase Auth, so those tests are skipped
// unless FIRESTORE_EMULATOR_HOST is set (npm run test:rules starts it).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const A = require('./account-delete.js');
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const skip = HOST ? false : 'needs the Firestore emulator (npm run test:rules)';
const PROJECT_ID = 'demo-account-delete';
const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 24, 10);

// ---- Decisions ---------------------------------------------------------------

test('projects are sorted into leave, solo (theirs alone) and blocked (others still use it)', () => {
  const plan = A.planAccountDeletion('gone', [
    { id: 'a', data: { name: 'Theirs, shared', members: { gone: 'owner', ed: 'editor' } } },
    { id: 'b', data: { name: 'Theirs alone', members: { gone: 'owner' }, pendingInvites: [{ email: 'x@example.com', role: 'viewer' }] } },
    { id: 'c', data: { name: 'Someone else\'s', members: { own: 'owner', gone: 'viewer' } } },
    { id: 'd', data: { name: 'Not a member', members: { own: 'owner' } } }
  ]);
  assert.deepEqual(plan, {
    blocked: [{ id: 'a', name: 'Theirs, shared' }],
    solo: [{ id: 'b', name: 'Theirs alone' }],
    leave: [{ id: 'c', name: 'Someone else\'s' }]
  });
  assert.match(A.blockedMessage('gone@example.com', plan.blocked),
    /^gone@example\.com owns a project that other people still use: "Theirs, shared"\. .*hand it to another member first.*Nothing was deleted\.$/);
  assert.match(A.blockedMessage('x', [{ name: 'A' }, { name: 'B' }]), /owns 2 projects .*"A", "B".*hand each one/);
});

test('leaving a project removes every trace of membership; an owner alone archives it', () => {
  const left = A.exitPatch({
    members: { own: 'owner', gone: 'editor' }, memberUids: ['own', 'gone'],
    memberEmails: { own: 'own@example.com', gone: 'gone@example.com' }
  }, 'gone');
  assert.deepEqual(left, {
    patch: { members: { own: 'owner' }, memberUids: ['own'], memberEmails: { own: 'own@example.com' } },
    archived: false, cancelled: []
  });
  const archived = A.exitPatch({
    name: 'Mine', status: 'active', members: { gone: 'owner' }, memberUids: ['gone'], memberEmails: { gone: 'gone@example.com' },
    pendingInvites: [{ email: 'friend@example.com', role: 'viewer' }, { email: 'odd/address@example.com', role: 'viewer' }]
  }, 'gone');
  assert.deepEqual(archived, {
    patch: { members: {}, memberUids: [], memberEmails: {}, pendingInvites: [], status: 'archived' },
    archived: true, cancelled: ['friend@example.com']
  });
  assert.equal(A.exitPatch({ members: { own: 'owner' } }, 'gone'), null);
  assert.throws(() => A.exitPatch({ name: 'Shared', members: { gone: 'owner', ed: 'editor' } }, 'gone'),
    (e) => e.code === 'failed-precondition' && /"Shared"/.test(e.message));
});

test('an address is replaced wherever it appears, whatever its case', () => {
  const emails = ['gone+site@example.com'];
  assert.equal(A.scrub('Invited GONE+site@Example.com as editor', emails), 'Invited deleted user as editor');
  assert.equal(A.scrub('gone+site@example.com joined; gone+site@example.com left', emails), 'deleted user joined; deleted user left');
  assert.equal(A.scrub('gonexsite@example.com stays', emails), 'gonexsite@example.com stays');
  assert.equal(A.scrub(undefined, emails), '');
  assert.equal(A.scrub('Removed gone+site@example.com.', emails), 'Removed deleted user.');
  assert.equal(A.scrub('(gone+site@example.com)', emails), '(deleted user)');
});

test('only the whole address is replaced, never part of someone else\'s', () => {
  assert.equal(A.scrub('Invited sales.info@acme.com as editor', ['info@acme.com']), 'Invited sales.info@acme.com as editor');
  assert.equal(A.scrub('Invited info@acme.com as editor', ['info@acme.com']), 'Invited deleted user as editor');
  assert.equal(A.scrub('Removed wali@acme.ae', ['ali@acme.ae']), 'Removed wali@acme.ae');
  assert.equal(A.scrub('Removed ali@acme.ae', ['ali@acme.ae']), 'Removed deleted user');
  assert.equal(A.scrub('Invited ali@acme.ae.uk as viewer', ['ali@acme.ae']), 'Invited ali@acme.ae.uk as viewer');
  assert.equal(A.scrub('Removed ali@acme.ae-group.com', ['ali@acme.ae']), 'Removed ali@acme.ae-group.com');
  assert.equal(A.scrub('ali@acme.ae left the project', ['ali@acme.ae']), 'deleted user left the project');
});

test('a running paid subscription is reported so the admin can cancel it', () => {
  assert.deepEqual(A.liveSubscription({ subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW + DAY, stripeCustomerId: 'cus_1' }, NOW),
    { provider: 'stripe', renews: true, stripeCustomerId: 'cus_1' });
  assert.equal(A.liveSubscription({ subscriptionProvider: 'stripe', subscriptionStatus: 'active', subscriptionExpiryMillis: NOW - 1 }, NOW), null);
  assert.equal(A.liveSubscription({ subscriptionStatus: 'trial', trialEndsAt: NOW + DAY }, NOW), null);
  assert.equal(A.liveSubscription(null, NOW), null);
  assert.equal(A.liveSubscription({ subscriptionProvider: 'play', subscriptionStatus: 'in_grace', subscriptionExpiryMillis: NOW + DAY, cancelAtPeriodEnd: true }, NOW).renews, false);
});

// ---- Against the emulator ----------------------------------------------------

let db, FieldValue;
before(() => {
  if (!HOST) return;
  const { initializeApp, getApp } = require('firebase-admin/app');
  const fs = require('firebase-admin/firestore');
  initializeApp({ projectId: PROJECT_ID }, 'account-delete');
  db = fs.getFirestore(getApp('account-delete'));
  FieldValue = fs.FieldValue;
});

beforeEach(async () => {
  if (!HOST) return;
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(res.ok, 'could not clear the emulator');
});

// A stand-in for admin.auth() that records what was done.
function fakeAuth(records) {
  const calls = [];
  const notFound = () => Object.assign(new Error('no such user'), { code: 'auth/user-not-found' });
  return {
    calls,
    async getUser(uid) { if (!records[uid]) throw notFound(); return records[uid]; },
    async updateUser(uid, patch) { calls.push(['updateUser', uid, patch]); Object.assign(records[uid], patch); },
    async revokeRefreshTokens(uid) { calls.push(['revokeRefreshTokens', uid]); },
    async deleteUser(uid) { calls.push(['deleteUser', uid]); if (!records[uid]) throw notFound(); delete records[uid]; }
  };
}
// A stand-in for drive.js that records what was trashed; fail.trash makes it
// throw. fail.recursiveDelete makes the next recursiveDelete of that path fail.
function setup(records) {
  const auth = fakeAuth(records || {
    gone: { uid: 'gone', email: 'Gone@Example.com' },
    own: { uid: 'own', email: 'own@example.com' },
    adm: { uid: 'adm', email: 'adm@example.com' }
  });
  const fail = {};
  const trashed = [];
  const drive = {
    async trash(id) {
      if (fail.trash) throw new Error('Drive said no');
      trashed.push(id);
    }
  };
  const dbx = new Proxy(db, {
    get(t, k) {
      if (k === 'recursiveDelete') {
        return async (ref) => {
          if (fail.recursiveDelete === ref.path) { delete fail.recursiveDelete; throw new Error('write failed'); }
          return t.recursiveDelete(ref);
        };
      }
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
  return { auth, fail, trashed, ad: A.makeAccountDelete({ db: dbx, FieldValue, auth, drive, now: () => NOW }) };
}
const get = async (path) => (await db.doc(path).get()).data();
const all = async (path) => (await db.collection(path).get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
const code = (c, re) => (e) => e.code === c && (!re || re.test(e.message));

async function seed() {
  const w = (path, data) => db.doc(path).set(data);
  await w('users/gone', {
    email: 'gone@example.com', role: 'user', subscriptionProvider: 'stripe', subscriptionStatus: 'active',
    subscriptionExpiryMillis: NOW + 20 * DAY, stripeCustomerId: 'cus_123'
  });
  await w('users/gone/assessments/a1', { id: 'a1', craneModel: 'LTM 1100' });
  await w('users/gone/permits/p1', { id: 'p1', title: 'Hot work' });
  await w('users/gone/checklists/c1', { id: 'c1' });
  await w('users/own', { email: 'own@example.com', role: 'user' });
  await w('users/own/permits/p1', { id: 'p1', title: 'Not theirs' });
  await w('users/adm', { email: 'adm@example.com', role: 'admin' });
  await w('driveUsers/gone', { usedBytes: 5000, fileCount: 1 });
  await w('driveUsers/own', { usedBytes: 7000, fileCount: 2 });
  await w('purchaseTokens/tok1', { uid: 'gone', subscriptionId: 'monthly' });
  await w('purchaseTokens/tok2', { uid: 'own', subscriptionId: 'monthly' });

  // p1: someone else's project they are an editor in.
  await w('projects/p1', {
    name: 'Tower crane works', status: 'active', ownerUid: 'own',
    members: { own: 'owner', gone: 'editor' }, memberUids: ['own', 'gone'],
    memberEmails: { own: 'own@example.com', gone: 'gone@example.com' }, pendingInvites: []
  });
  await w('projects/p1/activity/e1', { uid: 'gone', email: 'gone@example.com', action: 'item.create', itemId: 'i1', summary: 'Added: Barrier' });
  await w('projects/p1/activity/e2', { uid: 'own', email: 'own@example.com', action: 'project.update', itemId: '', summary: 'Invited gone@example.com as editor' });
  await w('projects/p1/activity/e3', { uid: 'own', email: 'own@example.com', action: 'item.close', itemId: 'i1', summary: 'Closed: Barrier' });
  await w('projects/p1/files/f1', { name: 'plan.pdf', uploadedBy: 'gone', uploadedByEmail: 'gone@example.com' });
  await w('projects/p1/files/f2', { name: 'photo.jpg', uploadedBy: 'own', uploadedByEmail: 'own@example.com' });
  await w('projects/p1/backups/b1', { name: 'b.json', kind: 'manual', createdBy: 'gone', createdByEmail: 'gone@example.com' });
  await w('projects/p1/items/i1', { title: 'Barrier', createdBy: 'gone' });

  // p2: theirs alone, with an invite still waiting for a friend, and files:
  // one of theirs, one from someone who has left, and one of that person's
  // deleted last week (its space is not given back yet).
  await w('projects/p2', {
    name: 'My own survey', status: 'active', ownerUid: 'gone',
    members: { gone: 'owner' }, memberUids: ['gone'], memberEmails: { gone: 'gone@example.com' },
    pendingInvites: [{ email: 'friend@example.com', role: 'viewer' }]
  });
  await w('projectInvites/friend@example.com', { invites: { p2: 'viewer', p9: 'editor' } });
  await w('projects/p2/items/i1', { title: 'Incident at gate 3', createdBy: 'gone' });
  await w('projects/p2/activity/e1', { uid: 'gone', email: 'gone@example.com', action: 'item.create', itemId: 'i1', summary: 'Added: Incident at gate 3' });
  await w('projects/p2/files/f1', { name: 'photo.jpg', size: 1000, uploadedBy: 'gone', uploadedByEmail: 'gone@example.com' });
  await w('projects/p2/files/f2', { name: 'cert.pdf', size: 2000, uploadedBy: 'old', uploadedByEmail: 'old@example.com' });
  await w('projects/p2/backups/b1', { name: 'b.json', kind: 'auto', driveFileId: 'bk1', createdBy: '', createdByEmail: '' });
  await w('driveFolders/p2', { folderId: 'fold_p2', filesFolderId: 'files_p2', backupsFolderId: 'backups_p2', usedBytes: 3500, fileCount: 3 });
  await w('driveTrash/t1', { pid: 'p2', uid: 'old', size: 500, driveFileId: 'x1', releaseAt: NOW + 20 * DAY });
  await w('driveTrash/t2', { pid: 'p1', uid: 'own', size: 700, driveFileId: 'x2', releaseAt: NOW + 20 * DAY });
  await w('driveFolders/p1', { folderId: 'fold_p1', usedBytes: 700, fileCount: 1 });
  await w('driveUsers/old', { usedBytes: 2600, fileCount: 3 });
  await w('driveTotals/all', { usedBytes: 20000, fileCount: 12 });

  // p3: they were invited but never joined.
  await w('projects/p3', {
    name: 'Invited only', status: 'active', ownerUid: 'own',
    members: { own: 'owner' }, memberUids: ['own'], memberEmails: { own: 'own@example.com' },
    pendingInvites: [{ email: 'gone@example.com', role: 'viewer' }, { email: 'friend@example.com', role: 'editor' }]
  });
  await w('projectInvites/gone@example.com', { invites: { p3: 'viewer' } });

  // p4: a project they left long ago.
  await w('projects/p4', { name: 'Old job', status: 'closed', ownerUid: 'own', members: { own: 'owner' }, memberUids: ['own'], memberEmails: { own: 'own@example.com' } });
  await w('projects/p4/activity/e1', { uid: 'gone', email: 'gone@example.com', action: 'project.update', itemId: '', summary: 'gone@example.com left the project' });
  await w('projects/p4/activity/e2', { uid: 'own', email: 'own@example.com', action: 'project.update', itemId: '', summary: 'Removed GONE@example.com' });
  await w('projects/p4/activity/e3', { uid: 'own', email: 'own@example.com', action: 'project.update', itemId: '', summary: 'Invited sales.gone@example.com as viewer' });

  // p6: archived before they signed in, so sign-in skipped its invite and
  // the index no longer points to it.
  await w('projects/p6', {
    name: 'Shelved', status: 'archived', ownerUid: 'own',
    members: { own: 'owner' }, memberUids: ['own'], memberEmails: { own: 'own@example.com' },
    pendingInvites: [{ email: 'gone@example.com', role: 'editor' }, { email: 'friend@example.com', role: 'viewer' }]
  });
}

test('deleting an account removes the person everywhere and keeps the teams\' history without their address', { skip }, async () => {
  await seed();
  const { auth, trashed, ad } = setup();

  const preview = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', dryRun: true });
  assert.deepEqual(preview, {
    dryRun: true, uid: 'gone', email: 'gone@example.com', solo: ['My own survey'], keepSoloProjects: false, leave: ['Tower crane works'],
    subscription: { provider: 'stripe', renews: true, stripeCustomerId: 'cus_123' }
  });
  assert.deepEqual(auth.calls, [], 'a preview changes nothing');
  assert.deepEqual(trashed, []);
  assert.ok(await get('users/gone'));
  assert.ok(await get('projects/p2'));
  assert.equal(await get('deletedAccounts/gone'), undefined);

  const res = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: ' GONE@example.com ' });
  assert.equal(res.deleted, true);
  assert.deepEqual([res.projectsDeleted, res.archived, res.left, res.invitesCancelled], [1, 0, 1, 2]);
  assert.deepEqual(auth.calls, [
    ['updateUser', 'gone', { disabled: true }], ['revokeRefreshTokens', 'gone'], ['deleteUser', 'gone']
  ]);

  // Their own data is gone; other people's is not. Only a dated marker stays.
  assert.equal(await get('users/gone'), undefined);
  assert.deepEqual(Object.keys(await get('deletedAccounts/gone')), ['deletedAt']);
  for (const sub of ['assessments', 'permits', 'checklists']) assert.deepEqual(await all(`users/gone/${sub}`), []);
  assert.equal((await all('users/own/permits')).length, 1);
  assert.equal(await get('driveUsers/gone'), undefined);
  assert.ok(await get('driveUsers/own'));
  assert.deepEqual((await all('purchaseTokens')).map((t) => t.id), ['tok2']);

  // p1: out of the team; their entries, files and backups say "deleted user".
  const p1 = await get('projects/p1');
  assert.deepEqual(p1.members, { own: 'owner' });
  assert.deepEqual(p1.memberUids, ['own']);
  assert.deepEqual(p1.memberEmails, { own: 'own@example.com' });
  assert.equal(p1.updatedBy, 'adm');
  const act = Object.fromEntries((await all('projects/p1/activity')).map((a) => [a.id, a]));
  assert.equal(act.e1.email, 'deleted user');
  assert.equal(act.e1.summary, 'Added: Barrier');
  assert.equal(act.e2.summary, 'Invited deleted user as editor');
  assert.equal(act.e2.email, 'own@example.com');
  assert.deepEqual([act.e3.email, act.e3.summary], ['own@example.com', 'Closed: Barrier']);
  const note = Object.values(act).find((a) => a.summary === 'Left the project (account deleted)');
  assert.deepEqual([note.uid, note.email, note.action], ['gone', 'deleted user', 'project.update']);
  assert.equal((await get('projects/p1/files/f1')).uploadedByEmail, 'deleted user');
  assert.equal((await get('projects/p1/files/f2')).uploadedByEmail, 'own@example.com');
  assert.equal((await get('projects/p1/backups/b1')).createdByEmail, 'deleted user');
  assert.equal((await get('projects/p1/items/i1')).title, 'Barrier');

  // p2: deleted with everything in it, its Drive folder trashed, and its
  // space given back: all of it for the portal (the deleted file's too, as
  // its driveTrash entry goes), and to the person who has left for their
  // file and their deleted one. The friend's invite is cancelled.
  assert.equal(await get('projects/p2'), undefined);
  for (const sub of ['items', 'activity', 'files', 'backups']) assert.deepEqual(await all(`projects/p2/${sub}`), []);
  assert.deepEqual(trashed, ['fold_p2']);
  assert.equal(await get('driveFolders/p2'), undefined);
  assert.deepEqual((await all('driveTrash')).map((t) => t.id), ['t2']);
  assert.deepEqual(await get('driveTotals/all'), { usedBytes: 16500, fileCount: 9 });
  assert.deepEqual(await get('driveUsers/old'), { usedBytes: 100, fileCount: 1 });
  assert.deepEqual(await get('driveUsers/own'), { usedBytes: 7000, fileCount: 2 });
  assert.deepEqual(await get('driveFolders/p1'), { folderId: 'fold_p1', usedBytes: 700, fileCount: 1 });
  assert.deepEqual((await get('projectInvites/friend@example.com')).invites, { p9: 'editor' });

  // p3: their invite is cancelled, the friend's kept.
  assert.deepEqual((await get('projects/p3')).pendingInvites, [{ email: 'friend@example.com', role: 'editor' }]);
  assert.equal(await get('projectInvites/gone@example.com'), undefined);

  // p4: a project they had already left. Someone else's address that ends
  // with theirs is left alone.
  const old = Object.fromEntries((await all('projects/p4/activity')).map((a) => [a.id, a]));
  assert.deepEqual([old.e1.email, old.e1.summary], ['deleted user', 'deleted user left the project']);
  assert.equal(old.e2.summary, 'Removed deleted user');
  assert.equal(old.e3.summary, 'Invited sales.gone@example.com as viewer');

  // p6: the invite the index had lost track of is cancelled too.
  assert.deepEqual((await get('projects/p6')).pendingInvites, [{ email: 'friend@example.com', role: 'viewer' }]);

  const log = await all('adminLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'deleteAccount');
  assert.equal(log[0].projectsDeleted, 1);
  assert.equal(log[0].targetUid, 'gone');
  assert.equal(log[0].byUid, 'adm');
  assert.ok(!JSON.stringify(log[0]).includes('gone@example.com'), 'the log keeps no address');
});

test('an account that owns a project other people use is refused, and nothing changes', { skip }, async () => {
  await seed();
  await db.doc('projects/p5').set({ name: 'Shared yard', members: { gone: 'owner', own: 'editor' }, memberUids: ['gone', 'own'] });
  const { auth, ad } = setup();
  for (const args of [{ dryRun: true }, { confirm: 'gone@example.com' }]) {
    await assert.rejects(ad.deleteAccount(Object.assign({ adminUid: 'adm', targetUid: 'gone' }, args)),
      code('failed-precondition', /gone@example\.com owns a project that other people still use: "Shared yard"/));
  }
  assert.deepEqual(auth.calls, []);
  assert.ok(await get('users/gone'));
  assert.deepEqual((await get('projects/p1')).memberUids, ['own', 'gone']);
});

test('the typed confirmation must match, and admins and the caller cannot be deleted', { skip }, async () => {
  await seed();
  const { auth, ad } = setup();
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: 'own@example.com' }), code('invalid-argument', /did not match.*Nothing was deleted/));
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone' }), code('invalid-argument', /did not match/));
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'adm', confirm: 'adm@example.com' }), code('invalid-argument', /your own account/));
  await assert.rejects(ad.deleteAccount({ adminUid: 'own', targetUid: 'adm', confirm: 'adm@example.com' }), code('invalid-argument', /is an admin/));
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'nobody', dryRun: true }), code('not-found'));
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: '../users', dryRun: true }), code('invalid-argument'));
  assert.deepEqual(auth.calls, []);
  assert.ok(await get('users/gone'));
});

test('a sign-in already removed in the console is no obstacle: the rest is cleaned up by the users doc\'s address', { skip }, async () => {
  await seed();
  const { auth, ad } = setup({ adm: { uid: 'adm', email: 'adm@example.com' } });
  const res = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: 'gone@example.com' });
  assert.equal(res.deleted, true);
  assert.deepEqual(auth.calls, []);
  assert.equal(await get('users/gone'), undefined);
  assert.deepEqual((await get('projects/p1')).memberUids, ['own']);
  assert.equal((await get('projects/p4/activity/e2')).summary, 'Removed deleted user');
  // Running it again finds nothing left to delete.
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', dryRun: true }), code('not-found'));
});

test('if the sign-in cannot be deleted, the account stays listed and a second run finishes the job', { skip }, async () => {
  await seed();
  const { auth, ad } = setup();
  const realDelete = auth.deleteUser;
  auth.deleteUser = async () => { throw Object.assign(new Error('backend error'), { code: 'auth/internal-error' }); };
  await assert.rejects(ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: 'gone@example.com' }),
    code('unavailable', /sign-in could not be deleted, so the account is still listed/));
  assert.ok(await get('users/gone'), 'still on the admin list');
  assert.deepEqual((await get('projects/p1')).memberUids, ['own']);
  assert.deepEqual(await all('adminLog'), []);
  auth.deleteUser = realDelete;
  const res = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: 'gone@example.com' });
  assert.equal(res.deleted, true);
  assert.deepEqual(auth.calls.at(-1), ['deleteUser', 'gone']);
  assert.equal(await get('users/gone'), undefined);
  assert.deepEqual(await all('users/gone/permits'), []);
  assert.equal((await all('adminLog')).length, 1);
});

test('with keepSoloProjects, a project only they belong to is archived and kept, files and all', { skip }, async () => {
  await seed();
  const { trashed, ad } = setup();
  const preview = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', dryRun: true, keepSoloProjects: true });
  assert.deepEqual([preview.solo, preview.keepSoloProjects], [['My own survey'], true]);
  const res = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: 'gone@example.com', keepSoloProjects: true });
  assert.deepEqual([res.projectsDeleted, res.archived, res.left], [0, 1, 1]);
  const p2 = await get('projects/p2');
  assert.equal(p2.status, 'archived');
  assert.deepEqual([p2.members, p2.memberUids, p2.memberEmails, p2.pendingInvites], [{}, [], {}, []]);
  assert.deepEqual((await get('projectInvites/friend@example.com')).invites, { p9: 'editor' });
  assert.ok((await all('projects/p2/activity')).some((a) => /owner deleted their account/.test(a.summary)));
  assert.equal((await all('projects/p2/items')).length, 1);
  assert.equal((await get('projects/p2/files/f1')).uploadedByEmail, 'deleted user');
  assert.deepEqual(trashed, []);
  assert.equal((await get('driveFolders/p2')).usedBytes, 3500);
  assert.deepEqual(await get('driveTotals/all'), { usedBytes: 20000, fileCount: 12 });
  assert.equal((await all('driveTrash')).length, 2);
});

test('a run that stops while deleting their own project can be run again, and no space is given back twice', { skip }, async () => {
  await seed();
  const { fail, trashed, ad } = setup();
  const confirm = { adminUid: 'adm', targetUid: 'gone', confirm: 'gone@example.com' };

  // Drive refuses: nothing of the project has changed yet.
  fail.trash = true;
  await assert.rejects(ad.deleteAccount(confirm), code('unavailable', /could not delete the folder of "My own survey"\. Click Delete account again/));
  assert.ok(await get('projects/p2'));
  assert.equal((await get('driveFolders/p2')).usedBytes, 3500);
  assert.ok(await get('deletedAccounts/gone'), 'the open app is already kept from writing');
  delete fail.trash;

  // The space is given back, then the project cannot be deleted.
  fail.recursiveDelete = 'projects/p2';
  await assert.rejects(ad.deleteAccount(confirm));
  assert.deepEqual((await get('projects/p2')).memberUids, ['gone'], 'still found by the next run');
  assert.equal(await get('driveFolders/p2'), undefined);
  assert.deepEqual(await get('driveTotals/all'), { usedBytes: 16500, fileCount: 9 });

  const res = await ad.deleteAccount(confirm);
  assert.equal(res.projectsDeleted, 1);
  assert.equal(await get('projects/p2'), undefined);
  assert.deepEqual(await all('projects/p2/files'), []);
  assert.deepEqual(trashed, ['fold_p2']);
  assert.deepEqual(await get('driveTotals/all'), { usedBytes: 16500, fileCount: 9 });
  assert.deepEqual(await get('driveUsers/old'), { usedBytes: 100, fileCount: 1 });
  assert.equal(await get('users/gone'), undefined);
});

// ---- Invites and team changes (callables in index.js) ------------------------
// index.js starts its own default app; it is pointed at this file's project,
// which the emulator run shares with other test files.
let callables;
function fns() {
  if (!callables) {
    process.env.GCLOUD_PROJECT = PROJECT_ID;
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });
    callables = require('./index.js');
  }
  return callables;
}
const as = (uid, email) => ({ auth: { uid, token: { email, email_verified: true } } });

test('signing in joins the invited projects and keeps only the invites to archived ones in the index', { skip }, async () => {
  const w = (path, data) => db.doc(path).set(data);
  const bob = { email: 'bob@example.com', role: 'editor' };
  const team = { ownerUid: 'own', members: { own: 'owner' }, memberUids: ['own'], memberEmails: { own: 'own@example.com' } };
  await w('projects/pA', Object.assign({ name: 'Open', status: 'active', pendingInvites: [bob] }, team));
  await w('projects/pArch', Object.assign({ name: 'Shelved', status: 'archived', pendingInvites: [bob] }, team));
  await w('projects/pCancelled', Object.assign({ name: 'Cancelled', status: 'active', pendingInvites: [] }, team));
  await w('projectInvites/bob@example.com', { invites: { pA: 'editor', pArch: 'editor', pCancelled: 'editor', pGone: 'viewer' } });

  const first = await fns().projectAcceptInvites.run({}, as('bob', 'Bob@Example.com'));
  assert.deepEqual(first, { joined: ['pA'], needsVerification: false });
  assert.equal((await get('projects/pA')).members.bob, 'editor');
  assert.deepEqual((await get('projectInvites/bob@example.com')).invites, { pArch: 'editor' });

  // Reopened: the next sign-in joins it, and the index is gone.
  await db.doc('projects/pArch').update({ status: 'active' });
  const second = await fns().projectAcceptInvites.run({}, as('bob', 'bob@example.com'));
  assert.deepEqual(second.joined, ['pArch']);
  assert.equal(await get('projectInvites/bob@example.com'), undefined);
});

test('without a subscription you can leave a project, but not remove others or cancel invites', { skip }, async () => {
  await db.doc('users/lapsed').set({ subscriptionStatus: 'expired', trialEndsAt: NOW - DAY });
  await db.doc('users/ed').set({ subscriptionStatus: 'expired', trialEndsAt: NOW - DAY });
  await db.doc('users/own').set({ compForever: true });
  await db.doc('projects/pT').set({
    name: 'Team', status: 'active', ownerUid: 'lapsed',
    members: { lapsed: 'owner', own: 'manager', ed: 'editor', vi: 'viewer' }, memberUids: ['lapsed', 'own', 'ed', 'vi'],
    memberEmails: {}, pendingInvites: [{ email: 'x@example.com', role: 'viewer' }]
  });
  const refused = (e) => e.code === 'permission-denied' && /active subscription is required to manage a team/.test(e.message);
  await assert.rejects(fns().projectRemoveMember.run({ projectId: 'pT', uid: 'vi' }, as('lapsed', 'lapsed@example.com')), refused);
  await assert.rejects(fns().projectRemoveMember.run({ projectId: 'pT', email: 'x@example.com' }, as('lapsed', 'lapsed@example.com')), refused);
  assert.deepEqual((await get('projects/pT')).memberUids, ['lapsed', 'own', 'ed', 'vi']);

  assert.deepEqual(await fns().projectRemoveMember.run({ projectId: 'pT', uid: 'ed' }, as('ed', 'ed@example.com')), { status: 'removed' });
  assert.deepEqual(await fns().projectRemoveMember.run({ projectId: 'pT', uid: 'vi' }, as('own', 'own@example.com')), { status: 'removed' });
  assert.deepEqual((await get('projects/pT')).memberUids, ['lapsed', 'own']);
});

test('the admin finds any account by its full address, in the same shape as the list', { skip }, async () => {
  const f = fns();
  // index.js asks the default app's Auth; answer for it without an Auth emulator.
  const auth = require('firebase-admin').auth();
  const signIns = {
    old1: { uid: 'old1', email: 'old@example.com', emailVerified: true },
    new1: { uid: 'new1', email: 'new@example.com', emailVerified: false }
  };
  const saved = { getUserByEmail: auth.getUserByEmail, getUsers: auth.getUsers };
  auth.getUserByEmail = async (email) => {
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw Object.assign(new Error('bad address'), { code: 'auth/invalid-email' });
    const r = Object.values(signIns).find((s) => s.email === email);
    if (!r) throw Object.assign(new Error('no such user'), { code: 'auth/user-not-found' });
    return r;
  };
  auth.getUsers = async (ids) => ({ users: ids.map(({ uid }) => signIns[uid]).filter(Boolean), notFound: [] });
  try {
    await db.doc('users/adm').set({ role: 'admin' });
    await db.doc('users/old1').set({
      role: 'user', subscriptionStatus: 'expired', trialEndsAt: NOW - DAY,
      createdAt: FieldValue.serverTimestamp()
    });
    await db.doc('users/new1').set({ role: 'user', createdAt: FieldValue.serverTimestamp() });
    const adm = as('adm', 'adm@example.com');

    const found = await f.adminListUsers.run({ email: '  Old@Example.com ' }, adm);
    assert.equal(found.count, 1);
    assert.equal(found.users[0].uid, 'old1');
    assert.equal(found.users[0].email, 'old@example.com');
    const listed = await f.adminListUsers.run({ limit: 10 }, adm);
    assert.equal(listed.count, 2);
    assert.deepEqual(found.users[0], listed.users.find((u) => u.uid === 'old1'));

    assert.deepEqual(await f.adminListUsers.run({ email: 'nobody@example.com' }, adm), { users: [], count: 0 });
    assert.deepEqual(await f.adminListUsers.run({ email: 'not an address' }, adm), { users: [], count: 0 });
    assert.deepEqual(await f.adminListUsers.run({ email: '' }, adm), { users: [], count: 0 });
    await assert.rejects(f.adminListUsers.run({ email: 'old@example.com' }, as('old1', 'old@example.com')),
      (e) => e.code === 'permission-denied');
  } finally {
    Object.assign(auth, saved);
  }
});
