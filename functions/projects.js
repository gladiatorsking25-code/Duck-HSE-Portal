// projects.js — team membership for shared projects.
//
// Membership fields on projects/{pid} (ownerUid, members, memberUids,
// memberEmails, pendingInvites) are written ONLY here, with the Admin SDK;
// firestore.rules forbids clients from touching them. People are invited by
// email. An invite only ever lands on an account whose email address has been
// VERIFIED, so nobody can claim an invite by signing up with someone else's
// address first.
//
// The decision logic (planSetMember / planRemoveMember) is pure so it can be
// unit-tested without Firebase; the callables below wrap it in transactions.

const ROLES = ['owner', 'manager', 'editor', 'viewer'];
const RANK = { owner: 4, manager: 3, editor: 2, viewer: 1 };
const MAX_MEMBERS = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class PlanError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const deny = (msg) => { throw new PlanError('permission-denied', msg); };
const bad = (msg) => { throw new PlanError('invalid-argument', msg); };

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

function roleOf(project, uid) { return (project.members || {})[uid] || ''; }

// What may `callerRole` do to someone who is (or would become) `role`?
// owner:   anything (ownership moves only via transfer).
// manager: add / change / remove editors and viewers.
function canAssign(callerRole, fromRole, toRole) {
  if (callerRole === 'owner') return true;
  if (callerRole === 'manager') {
    return RANK[toRole || 'viewer'] <= RANK.editor && (!fromRole || RANK[fromRole] <= RANK.editor);
  }
  return false;
}

/**
 * Work out the new membership after inviting/changing someone.
 * @param project  current project data
 * @param callerUid
 * @param target   { uid: string|null, email: string, verified: boolean }
 *                 uid is null when no account exists for the email yet.
 * @param role     'owner' | 'manager' | 'editor' | 'viewer'
 * @returns { patch, invite }  patch = fields to write on the project;
 *          invite = { email, role } when the person must accept later.
 */
function planSetMember(project, callerUid, target, role) {
  if (!ROLES.includes(role)) bad('Choose a role: manager, editor or viewer.');
  const email = normEmail(target.email);
  if (!EMAIL_RE.test(email)) bad('Enter a valid email address.');

  const callerRole = roleOf(project, callerUid);
  if (!callerRole) deny('You are not a member of this project.');
  if (project.status === 'archived') bad('This project is archived.');

  const members = Object.assign({}, project.members);
  const memberEmails = Object.assign({}, project.memberEmails);
  let pending = (project.pendingInvites || []).filter((p) => p.email !== email);
  let ownerUid = project.ownerUid;

  const existingRole = target.uid ? roleOf(project, target.uid) : '';

  if (target.uid && target.uid === callerUid) bad('You cannot change your own role.');

  if (role === 'owner') {
    if (callerRole !== 'owner') deny('Only the owner can hand over the project.');
    if (!target.uid || !existingRole) bad('Ownership can only go to an existing member.');
    if (!target.verified) bad('That person must verify their email address first.');
    members[callerUid] = 'manager';
    members[target.uid] = 'owner';
    ownerUid = target.uid;
    return { patch: { ownerUid, members, memberUids: Object.keys(members), memberEmails, pendingInvites: pending }, invite: null };
  }

  if (!canAssign(callerRole, existingRole, role)) {
    deny(callerRole === 'manager'
      ? 'Managers can add, change and remove editors and viewers only.'
      : 'Only the owner or a manager can manage the team.');
  }
  if (existingRole === 'owner') deny('Hand over ownership before changing the owner’s role.');

  if (target.uid && target.verified) {
    if (!existingRole && Object.keys(members).length >= MAX_MEMBERS) bad(`A project can have at most ${MAX_MEMBERS} members.`);
    members[target.uid] = role;
    memberEmails[target.uid] = email;
    return { patch: { ownerUid, members, memberUids: Object.keys(members), memberEmails, pendingInvites: pending }, invite: null };
  }

  // No account yet, or the address isn't verified: record a pending invite.
  if (Object.keys(members).length + pending.length >= MAX_MEMBERS) bad(`A project can have at most ${MAX_MEMBERS} members.`);
  pending = pending.concat([{ email, role }]);
  return { patch: { pendingInvites: pending }, invite: { email, role } };
}

/**
 * Remove a member (by uid) or a pending invite (by email). Any member may
 * remove themselves, except the owner, who must hand over ownership first.
 */
function planRemoveMember(project, callerUid, { uid, email }) {
  const callerRole = roleOf(project, callerUid);
  if (!callerRole) deny('You are not a member of this project.');

  if (email && !uid) {
    const e = normEmail(email);
    const invite = (project.pendingInvites || []).find((p) => p.email === e);
    if (!invite) bad('No pending invite for that address.');
    if (!canAssign(callerRole, invite.role, invite.role)) deny('You cannot cancel that invite.');
    return { patch: { pendingInvites: project.pendingInvites.filter((p) => p.email !== e) }, email: e };
  }

  const targetRole = roleOf(project, uid);
  if (!targetRole) bad('That person is not a member.');
  if (targetRole === 'owner') deny('The owner cannot be removed. Hand over ownership first.');
  if (uid !== callerUid && !canAssign(callerRole, targetRole, targetRole)) deny('You cannot remove that member.');

  const members = Object.assign({}, project.members);
  const memberEmails = Object.assign({}, project.memberEmails);
  delete members[uid];
  delete memberEmails[uid];
  return { patch: { members, memberUids: Object.keys(members), memberEmails }, email: null };
}

module.exports = { planSetMember, planRemoveMember, normEmail, PlanError, ROLES, MAX_MEMBERS };
