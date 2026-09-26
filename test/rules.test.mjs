// Firestore security rules tests. Run with `npm run test:rules` in this folder
// (starts the Firestore emulator; needs Java 11+).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs,
  query, where, serverTimestamp
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
