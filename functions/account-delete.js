// account-delete.js — deleting a person's account when they ask for it (see
// public/account-deletion.html). Behind the admin-only adminDeleteAccount
// callable in index.js; the steps are in docs/DEPLOY.md, "Account deletion
// requests".
//
// What goes:
//   - users/{uid} with its assessments, permits and checklists
//   - driveUsers/{uid} (their file-space count) and purchaseTokens for them
//   - their place in every project (members, memberUids, memberEmails)
//   - a project only they belong to, with its items, files, backups and Drive
//     folder, and the space it used; with keepSoloProjects it is archived
//     and kept instead
//   - invites to their email address (pendingInvites, projectInvites/{email})
//   - the sign-in itself (Firebase Auth), and then users/{uid}, last, so a
//     run that fails half-way can simply be run again
// What stays, without their email address:
//   - the activity log, file list and backup list of every other project:
//     their address becomes "deleted user", so a team's history still reads
//   - deletedAccounts/{uid} (a date only), which the rules check so a page
//     still open on their device cannot write their records back
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
// driveTrash entries given back per transaction (each may touch a person's
// count too, so this stays well under the writes one transaction may hold).
const TRASH_STEP = 200;

const bad = (msg) => { throw new PlanError('invalid-argument', msg); };

function nameOf(p) { return String((p && p.name) || 'Untitled project').slice(0, 120); }
function quoted(list) { return list.map((p) => `"${p.name}"`).join(', '); }

/**
 * Sort the projects someone belongs to.
 * @param uid       the account being deleted
 * @param projects  [{ id, data }] every project whose memberUids holds uid
 * @returns { blocked, solo, leave }, each [{ id, name }]:
 *          blocked = owned, and other people are still members;
 *          solo    = owned, and nobody else is a member (deleted, or
 *                    archived with keepSoloProjects);
 *          leave   = someone else's project.
 */
function planAccountDeletion(uid, projects) {
  const out = { blocked: [], solo: [], leave: [] };
  for (const { id, data } of projects || []) {
    const members = (data && data.members) || {};
    if (!members[uid]) continue;
    const entry = { id, name: nameOf(data) };
    if (members[uid] !== 'owner') out.leave.push(entry);
    else if (Object.keys(members).some((m) => m !== uid)) out.blocked.push(entry);
    else out.solo.push(entry);
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

// Replace each of the addresses in a line of text with "deleted user". Only
// the whole address: not inside a longer one such as sales.info@acme.com
// (for info@acme.com) or ali@acme.ae.uk (for ali@acme.ae). A full stop after
// it that ends a sentence is not part of it.
function scrub(text, emails) {
  let out = String(text == null ? '' : text);
  for (const e of emails) {
    if (!e) continue;
    const escaped = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-])${escaped}(?![A-Za-z0-9-]|\\.[A-Za-z0-9-])`, 'gi'), DELETED);
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
 * @param drive      drive.js's drive() (only trash() is used)
 */
function makeAccountDelete({ db, FieldValue, auth, drive, now: clock }) {
  const now = clock || (() => Date.now());
  const users = db.collection('users');
  const projects = db.collection('projects');
  const inc = (n) => FieldValue.increment(n);

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

  // In a transaction: give `bytes` and `files` back to the portal's count
  // (once it exists), and each of `added` ([uid, size]) to the person who
  // added it (unless their count is gone). Reads first, then writes.
  async function giveBack(tx, added, bytes, files) {
    const totalsRef = db.collection('driveTotals').doc('all');
    const totals = await tx.get(totalsRef);
    const byPerson = new Map();
    for (const [who, size] of added) {
      if (!who) continue;
      const a = byPerson.get(who) || { bytes: 0, files: 0 };
      a.bytes += Number(size || 0);
      a.files += 1;
      byPerson.set(who, a);
    }
    const people = [];
    for (const who of byPerson.keys()) people.push(await tx.get(db.collection('driveUsers').doc(who)));
    if (totals.exists) tx.set(totalsRef, { usedBytes: inc(-bytes), fileCount: inc(-files) }, { merge: true });
    for (const p of people) {
      const a = byPerson.get(p.id);
      if (p.exists) tx.set(p.ref, { usedBytes: inc(-a.bytes), fileCount: inc(-a.files) }, { merge: true });
    }
  }

  // Delete a project only they belong to: its Drive folder (to the shared
  // drive's trash, emptied after 30 days), then the space it used, then the
  // project with its items, activity, files and backups. The space comes
  // back as the nightly run would give it: first the files deleted in the
  // last 30 days (their driveTrash entries), a few at a time, then the files
  // still listed, with driveFolders/{pid}. Each step runs only while
  // driveFolders/{pid} exists and changes it in the same transaction, so a
  // run that stops half-way can be run again without giving anything back
  // twice.
  async function deleteProject(pid, uid) {
    const ref = projects.doc(pid);
    const snap = await ref.get();
    if (!snap.exists) return null;
    // Throws if someone else has joined since the plan was made.
    const exit = exitPatch(snap.data(), uid);
    if (!exit || !exit.archived) return null;
    const folderRef = db.collection('driveFolders').doc(pid);
    const folderId = (await folderRef.get()).get('folderId');
    if (folderId) {
      try { await drive.trash(folderId); }
      catch (err) {
        console.error('Could not trash the Drive folder of project', pid, err);
        throw new PlanError('unavailable', `Google Drive could not delete the folder of "${nameOf(snap.data())}". Click Delete account again to carry on.`);
      }
    }

    const trashStep = () => db.runTransaction(async (tx) => {
      if (!(await tx.get(folderRef)).exists) return false;
      const trash = await tx.get(db.collection('driveTrash').where('pid', '==', pid).limit(TRASH_STEP));
      if (trash.empty) return false;
      const bytes = trash.docs.reduce((n, d) => n + Number(d.get('size') || 0), 0);
      await giveBack(tx, trash.docs.map((d) => [d.get('uid'), d.get('size')]), bytes, trash.size);
      tx.set(folderRef, { usedBytes: inc(-bytes), fileCount: inc(-trash.size) }, { merge: true });
      trash.docs.forEach((d) => tx.delete(d.ref));
      return true;
    });
    for (let more = true; more;) more = await trashStep();
    await db.runTransaction(async (tx) => {
      const folder = await tx.get(folderRef);
      if (!folder.exists) return;
      const files = await tx.get(ref.collection('files').select('uploadedBy', 'size'));
      await giveBack(tx, files.docs.map((d) => [d.get('uploadedBy'), d.get('size')]),
        Number(folder.get('usedBytes') || 0), Number(folder.get('fileCount') || 0));
      tx.delete(folderRef);
    });

    await commitAll(exit.cancelled.map((email) => (b) => b.set(db.collection('projectInvites').doc(email),
      { invites: { [pid]: FieldValue.delete() } }, { merge: true })));
    await db.recursiveDelete(ref);
    return exit;
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

  // Their address, wherever a project keeps it. Any project can hold it
  // (they may have left some already), so every project is checked, with
  // small queries: their own activity entries, the team changes other people
  // made (which name them), and the files and backups they added. An invite
  // the index no longer points to (an archived project skips it at sign-in)
  // is cancelled here too.
  async function pseudonymise(uid, emails) {
    const listed = (await projects.select('pendingInvites').get()).docs;
    const invited = (d) => (d.get('pendingInvites') || []).some((i) => i && emails.includes(normEmail(i.email)));
    let changed = 0;
    let invites = 0;
    await eachLimit(listed, PROJECT_WORKERS, async (doc) => {
      const pid = doc.id;
      const ref = projects.doc(pid);
      if (invited(doc)) {
        invites += await db.runTransaction(async (tx) => {
          const p = await tx.get(ref);
          if (!p.exists) return 0;
          const pending = p.data().pendingInvites || [];
          const kept = pending.filter((i) => !i || !emails.includes(normEmail(i.email)));
          if (kept.length !== pending.length) tx.update(ref, { pendingInvites: kept });
          return pending.length - kept.length;
        });
      }
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
    return { changed, invites };
  }

  /**
   * Delete the account `targetUid`. With dryRun, only say what would happen.
   * `confirm` must be the account's email address (or its id when it has
   * none), typed by the admin. With keepSoloProjects, the projects only they
   * belong to are archived and kept instead of deleted.
   */
  async function deleteAccount({ adminUid, targetUid, confirm, dryRun, keepSoloProjects }) {
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
    const keep = keepSoloProjects === true;
    const summary = {
      uid: targetUid, email: who,
      solo: plan.solo.map((p) => p.name), keepSoloProjects: keep, leave: plan.leave.map((p) => p.name), subscription
    };
    if (dryRun) return Object.assign({ dryRun: true }, summary);
    if (normEmail(confirm) !== normEmail(who)) bad('The confirmation did not match the account\'s email address. Nothing was deleted.');

    // No new sign-ins or token refreshes while the rest is removed. A page
    // still open keeps its current token for up to an hour, so the rules
    // also refuse its writes once this marker exists (it has no address).
    if (signIn) {
      await auth.updateUser(targetUid, { disabled: true });
      await auth.revokeRefreshTokens(targetUid);
    }
    await db.collection('deletedAccounts').doc(targetUid).set({ deletedAt: FieldValue.serverTimestamp() });
    let projectsDeleted = 0;
    let archived = 0;
    let left = 0;
    for (const p of plan.solo) {
      if (keep) { if (await leaveProject(p.id, targetUid, adminUid)) archived++; }
      else if (await deleteProject(p.id, targetUid)) projectsDeleted++;
    }
    for (const p of plan.leave) {
      if (await leaveProject(p.id, targetUid, adminUid)) left++;
    }
    const cancelled = await cancelInvites(emails);
    const { changed: scrubbed, invites: moreCancelled } = await pseudonymise(targetUid, emails);
    const invitesCancelled = cancelled + moreCancelled;

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
      projectsDeleted, archived, left, invitesCancelled, entriesPseudonymised: scrubbed
    });
    return Object.assign({ deleted: true }, summary, { projectsDeleted, archived, left, invitesCancelled });
  }

  return { deleteAccount };
}

module.exports = { makeAccountDelete, planAccountDeletion, exitPatch, scrub, liveSubscription, blockedMessage, DELETED };
