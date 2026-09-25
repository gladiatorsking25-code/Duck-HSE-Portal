// Firestore security rules tests. Run with `npm run test:rules` in this folder
// (starts the Firestore emulator; needs Java 11+).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs,
  query, where, serverTimestamp, deleteField
} from 'firebase/firestore';

const DAY = 86400000;
let env;

const USERS = {
  owner:   { subscriptionStatus: 'trial', trialEndsAt: Date.now() + 10 * DAY, role: 'user' },
  manager: { subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + 30 * DAY, role: 'user' },
  editor:  { subscriptionStatus: 'comped', compForever: true, role: 'user' },
  viewer:  { subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + 30 * DAY, role: 'user' },
  lapsed:  { subscriptionStatus: 'expired', trialEndsAt: Date.now() - DAY, role: 'user' },
  revoked: { subscriptionStatus: 'revoked', trialEndsAt: Date.now() + 10 * DAY, role: 'user' },
  outsider:{ subscriptionStatus: 'trial', trialEndsAt: Date.now() + 10 * DAY, role: 'user' }
};

function db(uid) { return env.authenticatedContext(uid, { email: uid + '@example.com' }).firestore(); }

function newProject(uid, extra = {}) {
  return {
    name: 'Tower crane works', number: 'P-100', client: 'ACME', location: 'Site A',
    status: 'active', startDate: '2026-09-01', endDate: '', description: '',
    driveFolderUrl: '',
    ownerUid: uid, members: { [uid]: 'owner' }, memberUids: [uid],
    memberEmails: { [uid]: uid + '@example.com' }, pendingInvites: [],
    createdAt: serverTimestamp(), createdBy: uid,
    updatedAt: serverTimestamp(), updatedBy: uid,
    ...extra
  };
}

function newItem(uid, extra = {}) {
  return {
    type: 'action', title: 'Replace sling', status: 'open', priority: 'high',
    dueDate: '2026-10-01', assigneeUid: '', location: '', details: '',
    createdAt: serverTimestamp(), createdBy: uid,
    updatedAt: serverTimestamp(), updatedBy: uid,
    ...extra
  };
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-duck-hse',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = ctx.firestore();
    for (const [uid, data] of Object.entries(USERS)) await setDoc(doc(a, 'users', uid), data);
    await setDoc(doc(a, 'projects', 'p1'), {
      name: 'Existing project', number: '', client: '', location: '', status: 'active',
      startDate: '', endDate: '', description: '', driveFolderUrl: '',
      ownerUid: 'owner',
      members: { owner: 'owner', manager: 'manager', editor: 'editor', viewer: 'viewer', lapsed: 'editor' },
      memberUids: ['owner', 'manager', 'editor', 'viewer', 'lapsed'],
      memberEmails: {}, pendingInvites: [],
      createdAt: new Date(), createdBy: 'owner', updatedAt: new Date(), updatedBy: 'owner'
    });
    await setDoc(doc(a, 'projects', 'p1', 'items', 'i1'), {
      type: 'action', title: 'Existing item', status: 'open', priority: 'low',
      dueDate: '', assigneeUid: '', location: '', details: '',
      createdAt: new Date(), createdBy: 'editor', updatedAt: new Date(), updatedBy: 'editor'
    });
    await setDoc(doc(a, 'projects', 'p1', 'files', 'f1'), {
      name: 'Lift plan.pdf', ext: 'pdf', mimeType: 'application/pdf', size: 1000, category: 'document',
      note: '', itemId: '', driveFileId: 'drive1', uploadedBy: 'editor', uploadedByEmail: 'editor@example.com', uploadedAt: new Date()
    });
    await setDoc(doc(a, 'projects', 'p1', 'backups', 'b1'), {
      name: 'backup.json', kind: 'manual', size: 10, itemCount: 1, fileCount: 1, driveFileId: 'drive2', createdAtMs: Date.now()
    });
    await setDoc(doc(a, 'driveFolders', 'p1'), { folderId: 'x', filesFolderId: 'y', backupsFolderId: 'z', usedBytes: 1000 });
  });
});

// ---- Entitlement fields --------------------------------------------------
test('a user cannot grant themselves a paid subscription', async () => {
  await assertFails(updateDoc(doc(db('lapsed'), 'users', 'lapsed'), {
    subscriptionStatus: 'active', subscriptionExpiryMillis: Date.now() + 365 * DAY
  }));
});

test('a user cannot make themselves admin', async () => {
  await assertFails(updateDoc(doc(db('lapsed'), 'users', 'lapsed'), { role: 'admin' }));
});

test('a user cannot set or change their card subscription fields', async () => {
  const me = doc(db('lapsed'), 'users', 'lapsed');
  for (const patch of [
    { subscriptionProvider: 'stripe' },
    { stripeCustomerId: 'cus_someone_else' },
    { stripeSubscriptionId: 'sub_someone_else' },
    { cancelAtPeriodEnd: false }
  ]) await assertFails(updateDoc(me, patch));
  // Not even when creating the profile.
  await assertFails(setDoc(doc(db('fresh'), 'users', 'fresh'), { email: 'fresh@example.com', stripeCustomerId: 'cus_1' }));
  // Ordinary profile edits still work.
  await assertSucceeds(updateDoc(me, { displayName: 'Lee' }));
});

test('a user cannot rewrite the email or sign-up date the admin sees, or add other fields', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'users', 'owner'), { email: 'owner@example.com', createdAt: new Date(2026, 0, 1) });
  });
  const me = doc(db('owner'), 'users', 'owner');
  await assertFails(updateDoc(me, { email: 'customer@client.com' }));
  await assertFails(updateDoc(me, { createdAt: new Date(2030, 0, 1) }));
  await assertFails(updateDoc(me, { createdAt: deleteField() }));
  await assertFails(updateDoc(me, { notes: 'anything else' }));
  await assertFails(updateDoc(me, { displayName: 'x'.repeat(201) }));
  await assertSucceeds(updateDoc(me, { displayName: 'Lee Owner' }));
  // A new profile doc cannot carry them either.
  await assertFails(setDoc(doc(db('fresh'), 'users', 'fresh'), { email: 'customer@client.com' }));
  await assertFails(setDoc(doc(db('fresh'), 'users', 'fresh'), { createdAt: new Date(2030, 0, 1) }));
  await assertSucceeds(setDoc(doc(db('fresh'), 'users', 'fresh'), { displayName: 'Fresh' }));
});

test('a user can record which version of the terms they accepted, stamped by the server clock', async () => {
  const me = doc(db('lapsed'), 'users', 'lapsed');
  await assertSucceeds(updateDoc(me, { consentVersion: '2026-09', consentAcceptedAt: serverTimestamp() }));
  await assertFails(updateDoc(me, { consentVersion: '2026-10', consentAcceptedAt: new Date(2020, 0, 1) }));
  await assertFails(updateDoc(me, { consentVersion: 'x'.repeat(41), consentAcceptedAt: serverTimestamp() }));
  await assertFails(updateDoc(me, { consentVersion: 7, consentAcceptedAt: serverTimestamp() }));
  await assertFails(updateDoc(me, { consentVersion: '2026-10', consentAcceptedAt: serverTimestamp(), role: 'admin' }));
});

test('the one-time free trial still starts from the app, and only once', async () => {
  // No users doc yet (the server has not stamped the trial).
  const trial = (days = 14) => ({ subscriptionStatus: 'trial', trialStartedAt: Date.now(), trialEndsAt: Date.now() + days * DAY });
  await assertSucceeds(setDoc(doc(db('fresh'), 'users', 'fresh'), trial(), { merge: true }));
  await assertFails(setDoc(doc(db('fresh'), 'users', 'fresh'), trial(13), { merge: true }));
  // A doc holding only the consent record can still take the trial.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'fresh2'), { consentVersion: '2026-09', consentAcceptedAt: new Date() });
  });
  await assertSucceeds(setDoc(doc(db('fresh2'), 'users', 'fresh2'), trial(), { merge: true }));
  // Too long a trial is refused.
  await assertFails(setDoc(doc(db('fresh3'), 'users', 'fresh3'),
    { subscriptionStatus: 'trial', trialStartedAt: Date.now(), trialEndsAt: Date.now() + 60 * DAY }, { merge: true }));
});

// ---- Personal records (assessments, permits, checklists) -------------------
test('saving personal records needs a subscription or trial; reading and deleting do not', async () => {
  for (const name of ['assessments', 'permits', 'checklists']) {
    await assertSucceeds(setDoc(doc(db('owner'), 'users', 'owner', name, 'r1'), { id: 'r1', title: 'Mine', updatedAt: Date.now() }));
    await assertSucceeds(setDoc(doc(db('manager'), 'users', 'manager', name, 'r1'), { id: 'r1', updatedAt: Date.now() }, { merge: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'lapsed', name, 'old'), { id: 'old', title: 'Kept', updatedAt: 1 });
      await setDoc(doc(ctx.firestore(), 'users', 'lapsed', name, 'old2'), { id: 'old2', title: 'Kept', updatedAt: 1 });
    });
    const lapsed = (id) => doc(db('lapsed'), 'users', 'lapsed', name, id);
    await assertFails(setDoc(lapsed('new'), { id: 'new', title: 'New', updatedAt: Date.now() }));
    await assertFails(setDoc(lapsed('old'), { id: 'old', title: 'Changed', updatedAt: Date.now() }));
    await assertFails(setDoc(doc(db('revoked'), 'users', 'revoked', name, 'new'), { id: 'new', updatedAt: Date.now() }));
    await assertSucceeds(getDoc(lapsed('old')));
    await assertSucceeds(getDocs(collection(db('lapsed'), 'users', 'lapsed', name)));
    await assertSucceeds(deleteDoc(lapsed('old2')));
    // Someone else's records stay out of reach.
    await assertFails(getDoc(doc(db('owner'), 'users', 'lapsed', name, 'old')));
    await assertFails(setDoc(doc(db('owner'), 'users', 'lapsed', name, 'x'), { id: 'x', updatedAt: Date.now() }));
    await assertFails(deleteDoc(doc(db('owner'), 'users', 'lapsed', name, 'old')));
  }
});

test('a lapsed account can still mark its own records deleted, and only with a plain tombstone', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'lapsed', 'permits', 'p1'), { id: 'p1', title: 'Hot work', updatedAt: 1 });
  });
  const ref = (id) => doc(db('lapsed'), 'users', 'lapsed', 'permits', id);
  await assertFails(setDoc(ref('p1'), { deleted: true, updatedAt: Date.now() }, { merge: true }));   // keeps the old fields
  await assertFails(setDoc(ref('p1'), { deleted: true, updatedAt: Date.now(), title: 'Sneaky' }));
  await assertFails(setDoc(ref('p1'), { deleted: true, updatedAt: 'now' }));
  await assertFails(setDoc(ref('p1'), { deleted: 'yes', updatedAt: Date.now() }));
  await assertFails(setDoc(ref('p1'), { deleted: true }));
  await assertSucceeds(setDoc(ref('p1'), { deleted: true, updatedAt: Date.now() }));
  await assertSucceeds(setDoc(ref('p2'), { deleted: true, updatedAt: Date.now() }));
  await assertFails(setDoc(doc(db('owner'), 'users', 'lapsed', 'permits', 'p3'), { deleted: true, updatedAt: Date.now() }));
});

// ---- Creating projects ---------------------------------------------------
test('a trial user can create a project as its sole owner', async () => {
  await assertSucceeds(setDoc(doc(db('owner'), 'projects', 'new1'), newProject('owner')));
});

test('a lapsed user cannot create a project', async () => {
  await assertFails(setDoc(doc(db('lapsed'), 'projects', 'new1'), newProject('lapsed')));
});

test('a revoked user cannot create a project even with trial time left', async () => {
  await assertFails(setDoc(doc(db('revoked'), 'projects', 'new1'), newProject('revoked')));
});

test('a new project cannot include other members', async () => {
  await assertFails(setDoc(doc(db('owner'), 'projects', 'new1'), newProject('owner', {
    members: { owner: 'owner', outsider: 'editor' }, memberUids: ['owner', 'outsider']
  })));
});

test('a new project cannot be owned by someone else', async () => {
  await assertFails(setDoc(doc(db('outsider'), 'projects', 'new1'), newProject('owner')));
});

test('a Drive link must point at drive.google.com', async () => {
  await assertFails(setDoc(doc(db('owner'), 'projects', 'new1'),
    newProject('owner', { driveFolderUrl: 'https://evil.example.com/x' })));
  await assertSucceeds(setDoc(doc(db('owner'), 'projects', 'new2'),
    newProject('owner', { driveFolderUrl: 'https://drive.google.com/drive/folders/abc' })));
});

// ---- Reading projects ----------------------------------------------------
test('members can read a project; outsiders cannot', async () => {
  await assertSucceeds(getDoc(doc(db('viewer'), 'projects', 'p1')));
  await assertFails(getDoc(doc(db('outsider'), 'projects', 'p1')));
});

test('listing projects only works when filtered to your own membership', async () => {
  await assertSucceeds(getDocs(query(collection(db('viewer'), 'projects'),
    where('memberUids', 'array-contains', 'viewer'))));
  await assertFails(getDocs(collection(db('viewer'), 'projects')));
});

// ---- Updating projects ---------------------------------------------------
test('a manager can edit project details', async () => {
  await assertSucceeds(updateDoc(doc(db('manager'), 'projects', 'p1'), {
    status: 'on_hold', updatedAt: serverTimestamp(), updatedBy: 'manager'
  }));
});

test('an editor cannot edit project details', async () => {
  await assertFails(updateDoc(doc(db('editor'), 'projects', 'p1'), {
    status: 'on_hold', updatedAt: serverTimestamp(), updatedBy: 'editor'
  }));
});

test('nobody can change membership from the app, not even the owner', async () => {
  await assertFails(updateDoc(doc(db('owner'), 'projects', 'p1'), {
    'members.outsider': 'editor', memberUids: ['owner', 'manager', 'editor', 'viewer', 'lapsed', 'outsider'],
    updatedAt: serverTimestamp(), updatedBy: 'owner'
  }));
});

test('projects cannot be deleted from the app', async () => {
  await assertFails(deleteDoc(doc(db('owner'), 'projects', 'p1')));
});

// ---- Items ---------------------------------------------------------------
test('an editor can add an item', async () => {
  await assertSucceeds(addDoc(collection(db('editor'), 'projects', 'p1', 'items'), newItem('editor')));
});

test('a viewer cannot add an item', async () => {
  await assertFails(addDoc(collection(db('viewer'), 'projects', 'p1', 'items'), newItem('viewer')));
});

test('an outsider cannot read or add items', async () => {
  await assertFails(getDoc(doc(db('outsider'), 'projects', 'p1', 'items', 'i1')));
  await assertFails(addDoc(collection(db('outsider'), 'projects', 'p1', 'items'), newItem('outsider')));
});

test('an item cannot claim to be created by someone else', async () => {
  await assertFails(addDoc(collection(db('editor'), 'projects', 'p1', 'items'), newItem('editor', { createdBy: 'owner' })));
});

test('an item with an unknown type or extra fields is rejected', async () => {
  await assertFails(addDoc(collection(db('editor'), 'projects', 'p1', 'items'), newItem('editor', { type: 'nonsense' })));
  await assertFails(addDoc(collection(db('editor'), 'projects', 'p1', 'items'), newItem('editor', { isAdmin: true })));
});

test('an item cannot carry a huge assignee or a closing date that is not a date', async () => {
  const items = collection(db('editor'), 'projects', 'p1', 'items');
  await assertFails(addDoc(items, newItem('editor', { assigneeUid: 'x'.repeat(129) })));
  await assertFails(addDoc(items, newItem('editor', { closedAt: 'yesterday' })));
  await assertFails(addDoc(items, newItem('editor', { closedAt: { big: 'x'.repeat(5000) } })));
  await assertSucceeds(addDoc(items, newItem('editor', { closedAt: serverTimestamp(), status: 'closed' })));
  await assertSucceeds(addDoc(items, newItem('editor', { closedAt: null })));
  await assertFails(updateDoc(doc(db('editor'), 'projects', 'p1', 'items', 'i1'), {
    closedAt: 12345, updatedAt: serverTimestamp(), updatedBy: 'editor'
  }));
});

test('a lapsed member can read items but not change them', async () => {
  await assertSucceeds(getDoc(doc(db('lapsed'), 'projects', 'p1', 'items', 'i1')));
  await assertFails(updateDoc(doc(db('lapsed'), 'projects', 'p1', 'items', 'i1'), {
    status: 'closed', updatedAt: serverTimestamp(), updatedBy: 'lapsed'
  }));
});

test('an editor can close an item but only a manager can delete one', async () => {
  await assertSucceeds(updateDoc(doc(db('editor'), 'projects', 'p1', 'items', 'i1'), {
    status: 'closed', updatedAt: serverTimestamp(), updatedBy: 'editor'
  }));
  await assertFails(deleteDoc(doc(db('editor'), 'projects', 'p1', 'items', 'i1')));
  await assertSucceeds(deleteDoc(doc(db('manager'), 'projects', 'p1', 'items', 'i1')));
});

// ---- Activity log --------------------------------------------------------
test('the activity log is append-only and server-stamped', async () => {
  const col = collection(db('editor'), 'projects', 'p1', 'activity');
  const ref = await assertSucceeds(addDoc(col, {
    at: serverTimestamp(), uid: 'editor', email: 'editor@example.com',
    action: 'item.create', itemId: 'i1', summary: 'Added an item'
  }));
  await assertFails(updateDoc(ref, { summary: 'changed' }));
  await assertFails(deleteDoc(ref));
  await assertFails(addDoc(col, {
    at: serverTimestamp(), uid: 'owner', email: '', action: 'item.create', itemId: '', summary: 'spoofed'
  }));
});

test('an activity entry carries the writer\'s own sign-in email, not a teammate\'s', async () => {
  const entry = (email) => ({ at: serverTimestamp(), uid: 'editor', email, action: 'item.close', itemId: 'i1', summary: 'Closed: Hot work permit' });
  const col = collection(db('editor'), 'projects', 'p1', 'activity');
  await assertFails(addDoc(col, entry('owner@example.com')));
  await assertFails(addDoc(col, entry('')));
  await assertFails(addDoc(col, entry('EDITOR@example.com ')));
  await assertSucceeds(addDoc(col, entry('editor@example.com')));
  // A sign-in with no email address writes none.
  const noEmail = collection(env.authenticatedContext('editor', {}).firestore(), 'projects', 'p1', 'activity');
  await assertFails(addDoc(noEmail, entry('editor@example.com')));
  await assertSucceeds(addDoc(noEmail, entry('')));
});

// ---- Files and backups (written only by Cloud Functions) -------------------
test('every member can list and read files; outsiders cannot', async () => {
  for (const uid of ['owner', 'editor', 'viewer', 'lapsed']) {
    await assertSucceeds(getDocs(collection(db(uid), 'projects', 'p1', 'files')));
  }
  await assertFails(getDoc(doc(db('outsider'), 'projects', 'p1', 'files', 'f1')));
});

test('nobody can add, change or remove a file record from the app', async () => {
  const col = collection(db('owner'), 'projects', 'p1', 'files');
  await assertFails(addDoc(col, { name: 'x.pdf', driveFileId: 'someone-elses-file', uploadedBy: 'owner' }));
  await assertFails(updateDoc(doc(col, 'f1'), { driveFileId: 'someone-elses-file' }));
  await assertFails(deleteDoc(doc(col, 'f1')));
});

test('only the owner and managers can see backups, and nobody can write them', async () => {
  await assertSucceeds(getDocs(collection(db('owner'), 'projects', 'p1', 'backups')));
  await assertSucceeds(getDoc(doc(db('manager'), 'projects', 'p1', 'backups', 'b1')));
  await assertFails(getDoc(doc(db('editor'), 'projects', 'p1', 'backups', 'b1')));
  await assertFails(getDoc(doc(db('viewer'), 'projects', 'p1', 'backups', 'b1')));
  await assertFails(updateDoc(doc(db('owner'), 'projects', 'p1', 'backups', 'b1'), { driveFileId: 'x' }));
});

test('Drive folder, space and trash records are server only', async () => {
  await assertFails(getDoc(doc(db('owner'), 'driveFolders', 'p1')));
  await assertFails(setDoc(doc(db('owner'), 'driveFolders', 'p1'), { filesFolderId: 'another-customers-folder' }));
  await assertFails(getDoc(doc(db('owner'), 'driveUsers', 'owner')));
  await assertFails(setDoc(doc(db('owner'), 'driveUsers', 'owner'), { usedBytes: 0, fileCount: 0 }));
  await assertFails(getDoc(doc(db('owner'), 'driveTrash', 't1')));
  await assertFails(setDoc(doc(db('owner'), 'driveTrash', 't1'), { pid: 'p1', uid: 'owner', size: -1e12, releaseAt: 0 }));
  await assertFails(getDoc(doc(db('owner'), 'driveTotals', 'all')));
  await assertFails(setDoc(doc(db('owner'), 'driveTotals', 'all'), { usedBytes: 0, fileCount: 0 }));
});
