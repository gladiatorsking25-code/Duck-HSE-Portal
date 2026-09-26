// Unit tests for the team-membership decisions in functions/projects.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planSetMember, planRemoveMember } = require('../functions/projects.js');

const project = () => ({
  status: 'active', ownerUid: 'o',
  members: { o: 'owner', m: 'manager', e: 'editor', v: 'viewer' },
  memberEmails: { o: 'o@x.com', m: 'm@x.com', e: 'e@x.com', v: 'v@x.com' },
  pendingInvites: []
});
const user = (uid, email, verified = true) => ({ uid, email, verified });

test('owner adds a verified user directly', () => {
  const { patch, invite } = planSetMember(project(), 'o', user('n', 'N@X.com'), 'editor');
  assert.equal(invite, null);
  assert.equal(patch.members.n, 'editor');
  assert.equal(patch.memberEmails.n, 'n@x.com');
  assert.ok(patch.memberUids.includes('n'));
});

test('an unverified or unknown address becomes a pending invite', () => {
  let r = planSetMember(project(), 'o', user('n', 'n@x.com', false), 'viewer');
  assert.deepEqual(r.invite, { email: 'n@x.com', role: 'viewer' });
  assert.equal(r.patch.members, undefined);
  r = planSetMember(project(), 'o', user(null, 'new@x.com', false), 'editor');
  assert.deepEqual(r.patch.pendingInvites, [{ email: 'new@x.com', role: 'editor' }]);
});

test('a manager can add editors and viewers but not managers', () => {
  assert.doesNotThrow(() => planSetMember(project(), 'm', user('n', 'n@x.com'), 'editor'));
  assert.throws(() => planSetMember(project(), 'm', user('n', 'n@x.com'), 'manager'), /Managers can/);
  assert.throws(() => planSetMember(project(), 'm', user('o', 'o@x.com'), 'viewer'), /Managers can/);
});

test('editors and viewers cannot manage the team', () => {
  assert.throws(() => planSetMember(project(), 'e', user('n', 'n@x.com'), 'viewer'), /owner or a manager/);
  assert.throws(() => planSetMember(project(), 'v', user('n', 'n@x.com'), 'viewer'), /owner or a manager/);
});

test('outsiders cannot do anything', () => {
  assert.throws(() => planSetMember(project(), 'zz', user('n', 'n@x.com'), 'viewer'), /not a member/);
  assert.throws(() => planRemoveMember(project(), 'zz', { uid: 'v' }), /not a member/);
});

test('ownership transfer: owner only, to a verified existing member', () => {
  const { patch } = planSetMember(project(), 'o', user('m', 'm@x.com'), 'owner');
  assert.equal(patch.ownerUid, 'm');
  assert.equal(patch.members.m, 'owner');
  assert.equal(patch.members.o, 'manager');
  assert.throws(() => planSetMember(project(), 'm', user('e', 'e@x.com'), 'owner'), /Only the owner/);
  assert.throws(() => planSetMember(project(), 'o', user('n', 'n@x.com'), 'owner'), /existing member/);
});

test('you cannot change your own role, and invalid input is rejected', () => {
  assert.throws(() => planSetMember(project(), 'o', user('o', 'o@x.com'), 'viewer'), /own role/);
  assert.throws(() => planSetMember(project(), 'o', user(null, 'not-an-email'), 'viewer'), /valid email/);
  assert.throws(() => planSetMember(project(), 'o', user('n', 'n@x.com'), 'superuser'), /Choose a role/);
});

test('removing: owner cannot be removed; members may leave; managers limited', () => {
  assert.throws(() => planRemoveMember(project(), 'm', { uid: 'o' }), /owner cannot be removed/);
  assert.throws(() => planRemoveMember(project(), 'o', { uid: 'o' }), /owner cannot be removed/);
  assert.equal(planRemoveMember(project(), 'v', { uid: 'v' }).patch.members.v, undefined);
  assert.equal(planRemoveMember(project(), 'm', { uid: 'e' }).patch.members.e, undefined);
  assert.throws(() => planRemoveMember(project(), 'e', { uid: 'v' }), /cannot remove/);
});

test('cancelling a pending invite', () => {
  const p = project(); p.pendingInvites = [{ email: 'a@x.com', role: 'manager' }, { email: 'b@x.com', role: 'viewer' }];
  assert.deepEqual(planRemoveMember(p, 'o', { email: 'A@x.com' }).patch.pendingInvites, [{ email: 'b@x.com', role: 'viewer' }]);
  assert.throws(() => planRemoveMember(p, 'm', { email: 'a@x.com' }), /cannot cancel/);
  assert.doesNotThrow(() => planRemoveMember(p, 'm', { email: 'b@x.com' }));
});

test('archived projects cannot take new members', () => {
  const p = project(); p.status = 'archived';
  assert.throws(() => planSetMember(p, 'o', user('n', 'n@x.com'), 'viewer'), /archived/);
});
