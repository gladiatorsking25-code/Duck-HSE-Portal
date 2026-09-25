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

test('projects are sorted into leave, archive (theirs alone) and blocked (others still use it)', () => {
  const plan = A.planAccountDeletion('gone', [
    { id: 'a', data: { name: 'Theirs, shared', members: { gone: 'owner', ed: 'editor' } } },
    { id: 'b', data: { name: 'Theirs alone', members: { gone: 'owner' }, pendingInvites: [{ email: 'x@example.com', role: 'viewer' }] } },
    { id: 'c', data: { name: 'Someone else\'s', members: { own: 'owner', gone: 'viewer' } } },
    { id: 'd', data: { name: 'Not a member', members: { own: 'owner' } } }
  ]);
  assert.deepEqual(plan, {
    blocked: [{ id: 'a', name: 'Theirs, shared' }],
    archive: [{ id: 'b', name: 'Theirs alone' }],
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
function setup(records) {
  const auth = fakeAuth(records || {
    gone: { uid: 'gone', email: 'Gone@Example.com' },
    own: { uid: 'own', email: 'own@example.com' },
    adm: { uid: 'adm', email: 'adm@example.com' }
  });
  return { auth, ad: A.makeAccountDelete({ db, FieldValue, auth, now: () => NOW }) };
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

  // p2: theirs alone, with an invite still waiting for a friend.
  await w('projects/p2', {
    name: 'My own survey', status: 'active', ownerUid: 'gone',
    members: { gone: 'owner' }, memberUids: ['gone'], memberEmails: { gone: 'gone@example.com' },
    pendingInvites: [{ email: 'friend@example.com', role: 'viewer' }]
  });
  await w('projectInvites/friend@example.com', { invites: { p2: 'viewer', p9: 'editor' } });

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
}

test('deleting an account removes the person everywhere and keeps the teams\' history without their address', { skip }, async () => {
  await seed();
  const { auth, ad } = setup();

  const preview = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', dryRun: true });
  assert.deepEqual(preview, {
    dryRun: true, uid: 'gone', email: 'gone@example.com', archive: ['My own survey'], leave: ['Tower crane works'],
    subscription: { provider: 'stripe', renews: true, stripeCustomerId: 'cus_123' }
  });
  assert.deepEqual(auth.calls, [], 'a preview changes nothing');
  assert.ok(await get('users/gone'));

  const res = await ad.deleteAccount({ adminUid: 'adm', targetUid: 'gone', confirm: ' GONE@example.com ' });
  assert.equal(res.deleted, true);
  assert.deepEqual([res.archived, res.left, res.invitesCancelled], [1, 1, 1]);
  assert.deepEqual(auth.calls, [
    ['updateUser', 'gone', { disabled: true }], ['revokeRefreshTokens', 'gone'], ['deleteUser', 'gone']
  ]);

  // Their own data is gone; other people's is not.
  assert.equal(await get('users/gone'), undefined);
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

  // p2: archived with nobody in it; the friend's invite is cancelled.
  const p2 = await get('projects/p2');
  assert.equal(p2.status, 'archived');
  assert.deepEqual([p2.members, p2.memberUids, p2.memberEmails, p2.pendingInvites], [{}, [], {}, []]);
  assert.deepEqual((await get('projectInvites/friend@example.com')).invites, { p9: 'editor' });
  assert.ok((await all('projects/p2/activity')).some((a) => /owner deleted their account/.test(a.summary)));

  // p3: their invite is cancelled, the friend's kept.
  assert.deepEqual((await get('projects/p3')).pendingInvites, [{ email: 'friend@example.com', role: 'editor' }]);
  assert.equal(await get('projectInvites/gone@example.com'), undefined);

  // p4: a project they had already left.
  const old = Object.fromEntries((await all('projects/p4/activity')).map((a) => [a.id, a]));
  assert.deepEqual([old.e1.email, old.e1.summary], ['deleted user', 'deleted user left the project']);
  assert.equal(old.e2.summary, 'Removed deleted user');

  const log = await all('adminLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'deleteAccount');
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
