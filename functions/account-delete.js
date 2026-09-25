// account-delete.js — deleting a person's account when they ask for it (see
// public/account-deletion.html). Behind the admin-only adminDeleteAccount
// callable in index.js; the steps are in docs/DEPLOY.md, "Account deletion
// requests".
//
// What goes:
//   - users/{uid} with its assessments, permits and checklists
//   - driveUsers/{uid} (their file-space count) and purchaseTokens for them
//   - their place in every project (members, memberUids, memberEmails)
//   - invites to their email address (pendingInvites, projectInvites/{email})
//   - the sign-in itself (Firebase Auth), and then users/{uid}, last, so a
//     run that fails half-way can simply be run again
// What stays, without their email address:
//   - the activity log, file list and backup list of every project: their
//     address becomes "deleted user", so a team's history still reads
//   - a project only they belong to is archived, not deleted
// A project they own that other people still use is not touched: the owner
// must hand it to another member first, so a team never loses its owner
// without warning. Backup files already in Google Drive are not rewritten.
//
// The decisions are pure functions so they can be unit-tested; the Firestore
// and Auth work is in makeAccountDelete().

const { PlanError, normEmail } = require('./projects');

const DELETED = 'deleted user';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_WORKERS = 8;
const BATCH_SIZE = 400;

const bad = (msg) => { throw new PlanError('invalid-argument', msg); };

function nameOf(p) { return String((p && p.name) || 'Untitled project').slice(0, 120); }
function quoted(list) { return list.map((p) => `"${p.name}"`).join(', '); }

/**
 * Sort the projects someone belongs to.
 * @param uid       the account being deleted
 * @param projects  [{ id, data }] every project whose memberUids holds uid
 * @returns { blocked, archive, leave }, each [{ id, name }]:
 *          blocked = owned, and other people are still members;
 *          archive = owned, and nobody else is a member;
 *          leave   = someone else's project.
 */
function planAccountDeletion(uid, projects) {
  const out = { blocked: [], archive: [], leave: [] };
  for (const { id, data } of projects || []) {
    const members = (data && data.members) || {};
    if (!members[uid]) continue;
    const entry = { id, name: nameOf(data) };
    if (members[uid] !== 'owner') out.leave.push(entry);
    else if (Object.keys(members).some((m) => m !== uid)) out.blocked.push(entry);
    else out.archive.push(entry);
  }
  return out;
}

function blockedMessage(who, blocked) {
  const one = blocked.length === 1;
  return `${who} owns ${one ? 'a project' : blocked.length + ' projects'} that other people still use: ${quoted(blocked)}. `
    + `Ask them to hand ${one ? 'it' : 'each one'} to another member first (project page, Team, Make owner). Nothing was deleted.`;
}

/**
 * The project after `uid` leaves it. An owner leaves only a project nobody
 * else belongs to; it is archived, and invites still waiting are cancelled.
 * @returns { patch, archived, cancelled: [email] } or null when uid is not a member.
 */
function exitPatch(project, uid) {
  const members = Object.assign({}, project.members);
  const role = members[uid];
  if (!role) return null;
  const memberEmails = Object.assign({}, project.memberEmails);
  delete members[uid];
  delete memberEmails[uid];
  if (role !== 'owner') {
    return { patch: { members, memberUids: Object.keys(members), memberEmails }, archived: false, cancelled: [] };
  }
  if (Object.keys(members).length) throw new PlanError('failed-precondition', blockedMessage('This person', [{ name: nameOf(project) }]));
  const cancelled = (project.pendingInvites || []).map((i) => i && i.email).filter(inviteKey);
  return {
    patch: { members, memberUids: [], memberEmails, pendingInvites: [], status: 'archived' },
    archived: true, cancelled
  };
}

// An address that can name a projectInvites document.
function inviteKey(email) { return typeof email === 'string' && email !== '' && !email.includes('/'); }

// Replace each of the addresses in a line of text with "deleted user".
function scrub(text, emails) {
  let out = String(text == null ? '' : text);
  for (const e of emails) {
    if (e) out = out.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), DELETED);
  }
  return out;
}

// A paid subscription that is still running: deleting the account does not
// stop it, so the admin is told to cancel it.
function liveSubscription(u, now) {
  if (!u || !['stripe', 'play'].includes(u.subscriptionProvider)) return null;
  if (!['active', 'in_grace'].includes(u.subscriptionStatus) || !(Number(u.subscriptionExpiryMillis || 0) > now)) return null;
  return {
    provider: u.subscriptionProvider,
    renews: !u.cancelAtPeriodEnd,
    stripeCustomerId: u.stripeCustomerId || null
  };
}

async function eachLimit(list, n, fn) {
  const queue = list.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

/**
 * @param db         Firestore (Admin SDK)
 * @param FieldValue from firebase-admin/firestore
 * @param auth       admin.auth(), or a stand-in with getUser / updateUser /
 *                   revokeRefreshTokens / deleteUser
 */
function makeAccountDelete({ db, FieldValue, auth, now: clock }) {
  const now = clock || (() => Date.now());
  const users = db.collection('users');
  const projects = db.collection('projects');

  async function signInOf(uid) {
    try { return await auth.getUser(uid); }
    catch (err) { if (err.code === 'auth/user-not-found') return null; throw err; }
  }

  // Every write in `ops` (each a function of a batch), in batches.
  async function commitAll(ops) {
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = db.batch();
      ops.slice(i, i + BATCH_SIZE).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  function activityEntry(uid, summary) {
    return { at: FieldValue.serverTimestamp(), uid, email: DELETED, action: 'project.update', itemId: '', summary };
  }

  // Take them out of one project, or archive it if it was theirs alone.
  async function leaveProject(pid, uid, adminUid) {
    const ref = projects.doc(pid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const exit = exitPatch(snap.data(), uid);
      if (!exit) return null;
      tx.update(ref, Object.assign({}, exit.patch, { updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid }));
      for (const email of exit.cancelled) {
        tx.set(db.collection('projectInvites').doc(email), { invites: { [pid]: FieldValue.delete() } }, { merge: true });
      }
      tx.set(ref.collection('activity').doc(), activityEntry(uid, exit.archived
        ? 'Project archived because its owner deleted their account'
        : 'Left the project (account deleted)'));
      return exit;
    });
  }

  // Cancel the invites waiting for their address, in each project and in
  // the index the app reads at sign-in.
  async function cancelInvites(emails) {
    let cancelled = 0;
    for (const email of emails.filter(inviteKey)) {
      const inviteRef = db.collection('projectInvites').doc(email);
      const snap = await inviteRef.get();
      const pids = Object.keys((snap.exists && snap.data().invites) || {});
      for (const pid of pids) {
        if (!ID_RE.test(pid)) continue;
        const ref = projects.doc(pid);
        const did = await db.runTransaction(async (tx) => {
          const p = await tx.get(ref);
          if (!p.exists) return false;
          const pending = p.data().pendingInvites || [];
          const kept = pending.filter((i) => !i || normEmail(i.email) !== email);
          if (kept.length === pending.length) return false;
          tx.update(ref, { pendingInvites: kept });
          return true;
        });
        if (did) cancelled++;
      }
      if (snap.exists) await inviteRef.delete();
    }
    return cancelled;
  }

  // Their address, wherever a project's history keeps it. Any project can
  // hold it (they may have left some already), so every project is checked,
  // with small queries: their own activity entries, the team changes other
  // people made (which name them), and the files and backups they added.
  async function pseudonymise(uid, emails) {
    const ids = (await projects.select().get()).docs.map((d) => d.id);
    let changed = 0;
    await eachLimit(ids, PROJECT_WORKERS, async (pid) => {
      const ref = projects.doc(pid);
      const [own, team, files, backups] = await Promise.all([
        ref.collection('activity').where('uid', '==', uid).get(),
        ref.collection('activity').where('action', '==', 'project.update').get(),
        ref.collection('files').where('uploadedBy', '==', uid).get(),
        ref.collection('backups').where('createdBy', '==', uid).get()
      ]);
      const ops = [];
      const seen = new Set();
      for (const d of own.docs.concat(team.docs)) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const a = d.data();
        const patch = {};
        if (a.uid === uid && a.email !== DELETED) patch.email = DELETED;
        const summary = scrub(a.summary, emails);
        if (summary !== String(a.summary == null ? '' : a.summary)) patch.summary = summary;
        if (Object.keys(patch).length) ops.push((b) => b.update(d.ref, patch));
      }
      for (const d of files.docs) {
        if (d.data().uploadedByEmail !== DELETED) ops.push((b) => b.update(d.ref, { uploadedByEmail: DELETED }));
      }
      for (const d of backups.docs) {
        if (d.data().createdByEmail !== DELETED) ops.push((b) => b.update(d.ref, { createdByEmail: DELETED }));
      }
      await commitAll(ops);
      changed += ops.length;
    });
    return changed;
  }

  /**
   * Delete the account `targetUid`. With dryRun, only say what would happen.
   * `confirm` must be the account's email address (or its id when it has
   * none), typed by the admin.
   */
  async function deleteAccount({ adminUid, targetUid, confirm, dryRun }) {
    if (typeof targetUid !== 'string' || !ID_RE.test(targetUid)) bad('Choose an account to delete.');
    if (targetUid === adminUid) bad('You cannot delete your own account here.');
    const signIn = await signInOf(targetUid);
    const profileSnap = await users.doc(targetUid).get();
    const profile = profileSnap.exists ? profileSnap.data() : null;
    if (!signIn && !profile) throw new PlanError('not-found', 'There is no account with that id. It may have been deleted already.');
    if (profile && profile.role === 'admin') bad('This account is an admin. Remove its admin role first.');

    const emails = [...new Set([signIn && signIn.email, profile && profile.email].map(normEmail).filter(Boolean))];
    const who = emails[0] || targetUid;
    const memberOf = (await projects.where('memberUids', 'array-contains', targetUid).get()).docs
      .map((d) => ({ id: d.id, data: d.data() }));
    const plan = planAccountDeletion(targetUid, memberOf);
    if (plan.blocked.length) throw new PlanError('failed-precondition', blockedMessage(who, plan.blocked));
    const subscription = liveSubscription(profile, now());
    const summary = {
      uid: targetUid, email: who,
      archive: plan.archive.map((p) => p.name), leave: plan.leave.map((p) => p.name), subscription
    };
    if (dryRun) return Object.assign({ dryRun: true }, summary);
    if (normEmail(confirm) !== normEmail(who)) bad('The confirmation did not match the account\'s email address. Nothing was deleted.');

    // No new sign-ins or token refreshes while the rest is removed.
    if (signIn) {
      await auth.updateUser(targetUid, { disabled: true });
      await auth.revokeRefreshTokens(targetUid);
    }
    let archived = 0;
    let left = 0;
    for (const p of plan.archive.concat(plan.leave)) {
      const exit = await leaveProject(p.id, targetUid, adminUid);
      if (exit && exit.archived) archived++;
      else if (exit) left++;
    }
    const invitesCancelled = await cancelInvites(emails);
    const scrubbed = await pseudonymise(targetUid, emails);

    await db.collection('driveUsers').doc(targetUid).delete();
    const tokens = await db.collection('purchaseTokens').where('uid', '==', targetUid).get();
    await commitAll(tokens.docs.map((d) => (b) => b.delete(d.ref)));

    // The users doc goes after the sign-in: until then the account is still
    // on the admin list, so a run that stops here can be started again.
    if (signIn) {
      try { await auth.deleteUser(targetUid); }
      catch (err) {
        if (err.code !== 'auth/user-not-found') {
          console.error('Could not delete the sign-in', targetUid, err);
          throw new PlanError('unavailable', 'Almost done: the sign-in could not be deleted, so the account is still listed. Click Delete account again, or delete the sign-in in Firebase Console, Authentication.');
        }
      }
    }
    await db.recursiveDelete(users.doc(targetUid));

    await db.collection('adminLog').add({
      at: FieldValue.serverTimestamp(), byUid: adminUid, targetUid, action: 'deleteAccount',
      archived, left, invitesCancelled, entriesPseudonymised: scrubbed
    });
    return Object.assign({ deleted: true }, summary, { archived, left, invitesCancelled });
  }

  return { deleteAccount };
}

module.exports = { makeAccountDelete, planAccountDeletion, exitPatch, scrub, liveSubscription, blockedMessage, DELETED };
