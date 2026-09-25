// project-drive.js — Firestore + Drive work behind the file and backup
// callables in index.js. The checks themselves are in files.js.
//
// Server-only records (never readable or writable from the app):
//   driveFolders/{pid}   the project's Drive folder ids, space and files used,
//                        backup bookkeeping
//   driveUsers/{uid}     space and files one account has added, over all projects
//   driveTotals/all      space and files every project together has used
//   driveTrash/{id}      a deleted file's space, given back once Drive's 30-day
//                        trash has emptied
// Readable by members, written only here:
//   projects/{pid}/files/{id}     one per uploaded file
//   projects/{pid}/backups/{id}   one per backup (managers can read)

const F = require('./files');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const BACKUP_GAP_MS = 60 * 1000;
// The nightly run stops starting new projects after this long, well inside the
// function's 540-second limit; the rest go first the next night.
const DAILY_BUDGET_MS = 420 * 1000;
const DAILY_WORKERS = 3;
const CATEGORY_LABEL = { document: 'document', photo: 'photo', drawing: 'drawing', certificate: 'certificate', report: 'report', other: 'file' };

function config(env) {
  const mb = (v, dflt) => (Number(v) > 0 ? Number(v) : dflt);
  return {
    root: String(env.DRIVE_ROOT_FOLDER_ID || '').trim(),
    quotaBytes: Math.round(mb(env.DRIVE_PROJECT_QUOTA_MB, F.DEFAULT_QUOTA_MB) * 1048576),
    userQuotaBytes: Math.round(mb(env.DRIVE_USER_QUOTA_MB, F.DEFAULT_USER_QUOTA_MB) * 1048576),
    trialQuotaBytes: Math.round(mb(env.DRIVE_TRIAL_QUOTA_MB, F.DEFAULT_TRIAL_QUOTA_MB) * 1048576),
    totalQuotaBytes: Math.round(mb(env.DRIVE_TOTAL_QUOTA_MB, F.DEFAULT_TOTAL_QUOTA_MB) * 1048576)
  };
}

function makeProjectDrive({ db, FieldValue, Timestamp, drive, env, sleep, now: clock }) {
  const bad = (msg) => { throw new F.FileError('invalid-argument', msg); };
  const deny = (msg) => { throw new F.FileError('permission-denied', msg); };
  const cfg = () => config(env);
  const now = clock || (() => Date.now());
  const projectRef = (pid) => db.collection('projects').doc(pid);
  const foldersRef = (pid) => db.collection('driveFolders').doc(pid);
  const userRef = (uid) => db.collection('driveUsers').doc(uid);
  const totalsRef = () => db.collection('driveTotals').doc('all');
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const inc = (n) => FieldValue.increment(n);

  function requireRoot() {
    const { root } = cfg();
    if (!root) throw new F.FileError('failed-precondition', 'File storage is not set up yet. The portal owner needs to connect Google Drive.');
    return root;
  }
  function checkId(id, what) {
    if (typeof id !== 'string' || !ID_RE.test(id)) bad(`${what} is missing or not valid.`);
    return id;
  }
  async function getProject(pid) {
    const snap = await projectRef(checkId(pid, 'The project')).get();
    if (!snap.exists) throw new F.FileError('not-found', 'Project not found.');
    return snap.data();
  }
  function activity(uid, email, action, summary, itemId) {
    return { at: FieldValue.serverTimestamp(), uid: uid || '', email: email || '', action, itemId: itemId || '', summary: String(summary).slice(0, 300) };
  }

  // The project's folder and its Files and Backups folders, made the first
  // time they are needed. A short claim stops two uploads at once from making
  // two sets of folders, and each id is saved as soon as it exists, so a Drive
  // error half-way never leaves a folder that a retry would make again.
  async function ensureFolders(pid, project) {
    const root = requireRoot();
    const ref = foldersRef(pid);
    for (let attempt = 0; attempt < 30; attempt++) {
      const snap = await ref.get();
      const cur = snap.exists ? snap.data() : null;
      if (cur && cur.filesFolderId && cur.backupsFolderId) return cur;
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const d = s.exists ? s.data() : {};
        if (d.filesFolderId && d.backupsFolderId) return null;
        if (d.claimedAt && now() - d.claimedAt < 60000) return null;
        tx.set(ref, { claimedAt: now() }, { merge: true });
        return d;
      });
      if (claimed) {
        try {
          const props = { duckProjectId: pid };
          let folderId = claimed.folderId;
          if (!folderId) {
            folderId = await drive.createFolder(`${String(project.name || 'Project').slice(0, 120)} (${pid})`, root, props);
            await ref.set({ folderId }, { merge: true });
          }
          let filesFolderId = claimed.filesFolderId;
          if (!filesFolderId) {
            filesFolderId = await drive.createFolder('Files', folderId, props);
            await ref.set({ filesFolderId }, { merge: true });
          }
          const backupsFolderId = claimed.backupsFolderId || await drive.createFolder('Backups', folderId, props);
          await ref.set({ folderId, filesFolderId, backupsFolderId, claimedAt: FieldValue.delete(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
          return (await ref.get()).data();
        } catch (err) {
          await ref.set({ claimedAt: FieldValue.delete() }, { merge: true }).catch(() => {});
          throw err;
        }
      }
      await wait(500);
    }
    throw new F.FileError('unavailable', 'The project folder is still being set up. Please try again in a minute.');
  }

  function decode(data) {
    if (typeof data !== 'string' || !data) bad('The file is empty.');
    if (data.length > Math.ceil(F.MAX_FILE_BYTES / 3) * 4 + 4) bad(`Files can be at most ${F.fmtMB(F.MAX_FILE_BYTES)}.`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) bad('The file did not arrive complete. Please try again.');
    return Buffer.from(data, 'base64');
  }

  // The portal-wide count starts from what the projects already hold the
  // first time it is needed, so files added before it existed still count.
  async function ensureTotals() {
    if ((await totalsRef().get()).exists) return;
    let usedBytes = 0;
    let fileCount = 0;
    (await db.collection('driveFolders').get()).forEach((d) => {
      usedBytes += Number(d.data().usedBytes || 0);
      fileCount += Number(d.data().fileCount || 0);
    });
    // Another upload may have made it a moment ago; theirs is just as good.
    await totalsRef().create({ usedBytes, fileCount }).catch((err) => { if (err.code !== 6) throw err; });
  }

  // `emailVerified` comes from the caller's sign-in token. Accounts are free
  // to make, so only a confirmed address may add files, a free trial gets a
  // small personal space, and the whole portal has a ceiling.
  async function uploadFile({ uid, email, emailVerified, projectId, input, data }) {
    requireRoot();
    if (emailVerified !== true) throw new F.FileError('failed-precondition', F.verifyEmailMessage());
    const project = await getProject(projectId);
    const buf = decode(data);
    const usage = (await foldersRef(projectId).get()).data() || {};
    const { quotaBytes, userQuotaBytes, trialQuotaBytes, totalQuotaBytes } = cfg();
    const plan = F.planUpload(project, uid, input, buf, usage, quotaBytes);
    if (plan.itemId && !(await projectRef(projectId).collection('items').doc(plan.itemId).get()).exists) {
      bad('That item was not found. It may have been deleted.');
    }
    const folders = await ensureFolders(projectId, project);
    await ensureTotals();

    // Reserve the space before uploading, so two uploads at once cannot both
    // squeeze under a limit.
    await db.runTransaction(async (tx) => {
      const p = (await tx.get(foldersRef(projectId))).data() || {};
      const u = (await tx.get(userRef(uid))).data() || {};
      const account = (await tx.get(db.collection('users').doc(uid))).data() || {};
      const all = (await tx.get(totalsRef())).data() || {};
      const used = Number(p.usedBytes || 0);
      if (used + plan.size > quotaBytes) bad(F.quotaMessage(used, quotaBytes));
      if (Number(p.fileCount || 0) >= F.MAX_FILES_PER_PROJECT) bad(F.projectFilesMessage());
      const mine = Number(u.usedBytes || 0);
      const personal = F.personalQuota(account, { userQuotaBytes, trialQuotaBytes }, now());
      if (mine + plan.size > personal.bytes) {
        bad(personal.trial ? F.trialQuotaMessage(mine, personal.bytes) : F.userQuotaMessage(mine, personal.bytes));
      }
      if (Number(u.fileCount || 0) >= F.MAX_FILES_PER_USER) bad(F.userQuotaMessage(mine, personal.bytes));
      const everyone = Number(all.usedBytes || 0);
      if (everyone + plan.size > totalQuotaBytes) {
        console.error(`Portal file space is full: ${F.fmtMB(everyone)} of ${F.fmtMB(totalQuotaBytes)} used. Raise DRIVE_TOTAL_QUOTA_MB if the shared drive has room.`);
        throw new F.FileError('resource-exhausted', F.totalQuotaMessage());
      }
      tx.set(foldersRef(projectId), { usedBytes: inc(plan.size), fileCount: inc(1) }, { merge: true });
      tx.set(userRef(uid), { usedBytes: inc(plan.size), fileCount: inc(1) }, { merge: true });
      tx.set(totalsRef(), { usedBytes: inc(plan.size), fileCount: inc(1) }, { merge: true });
    });
    const release = () => {
      const batch = db.batch();
      batch.set(foldersRef(projectId), { usedBytes: inc(-plan.size), fileCount: inc(-1) }, { merge: true });
      batch.set(userRef(uid), { usedBytes: inc(-plan.size), fileCount: inc(-1) }, { merge: true });
      batch.set(totalsRef(), { usedBytes: inc(-plan.size), fileCount: inc(-1) }, { merge: true });
      return batch.commit();
    };

    let stored;
    try {
      stored = await drive.upload({
        name: plan.name, mimeType: plan.mimeType, parentId: folders.filesFolderId, data: buf,
        appProperties: { duckProjectId: projectId, uploadedBy: uid.slice(0, 100) }
      });
    } catch (err) { await release().catch(() => {}); throw err; }

    try {
      const fileRef = projectRef(projectId).collection('files').doc();
      const batch = db.batch();
      batch.set(fileRef, Object.assign({}, plan, {
        driveFileId: stored.id, uploadedBy: uid, uploadedByEmail: email || '', uploadedAt: FieldValue.serverTimestamp()
      }));
      batch.set(projectRef(projectId).collection('activity').doc(),
        activity(uid, email, 'file.upload', `Added ${CATEGORY_LABEL[plan.category]}: ${plan.name}`, plan.itemId));
      await batch.commit();
      return { id: fileRef.id, name: plan.name, size: plan.size };
    } catch (err) {
      // Never leave a file in Drive that the app does not list.
      await drive.trash(stored.id).catch(() => {});
      await release().catch(() => {});
      throw err;
    }
  }

  async function downloadFile({ uid, projectId, fileId }) {
    const project = await getProject(projectId);
    if (!F.roleOf(project, uid)) deny('You are not a member of this project.');
    const snap = await projectRef(projectId).collection('files').doc(checkId(fileId, 'The file')).get();
    if (!snap.exists) throw new F.FileError('not-found', 'That file was not found. It may have been deleted.');
    const meta = snap.data();
    const buf = await drive.download(meta.driveFileId);
    return { name: meta.name, mimeType: meta.mimeType, size: buf.length, data: buf.toString('base64') };
  }

  async function deleteFile({ uid, email, projectId, fileId }) {
    const project = await getProject(projectId);
    const ref = projectRef(projectId).collection('files').doc(checkId(fileId, 'The file'));
    const meta = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new F.FileError('not-found', 'That file was already deleted.');
      const m = snap.data();
      if (!F.canDeleteFile(project, uid, m)) {
        deny(project.status === 'archived' ? 'This project is archived, so its files cannot be deleted.'
          : 'Only a manager or the person who added a file can delete it.');
      }
      tx.delete(ref);
      // The space is given back when Drive empties its trash, not now.
      tx.set(db.collection('driveTrash').doc(), {
        pid: projectId, uid: m.uploadedBy || '', size: Number(m.size || 0), driveFileId: m.driveFileId || '',
        releaseAt: now() + F.TRASH_HOLD_MS
      });
      tx.set(projectRef(projectId).collection('activity').doc(), activity(uid, email, 'file.delete', `Deleted file: ${m.name}`, m.itemId));
      return m;
    });
    // The record is gone first, so a failed Drive call can never leave a file
    // that the app still lists. Drive keeps trashed files for 30 days.
    try { await drive.trash(meta.driveFileId); }
    catch (err) { console.error('Could not trash Drive file', meta.driveFileId, err); }
    return { deleted: true };
  }

  // Give back the space of files deleted more than 30 days ago. A deleted
  // account's count is not brought back, and the portal's count is lowered
  // only once it exists (until then ensureTotals() counts from the projects,
  // which are lowered here).
  async function releaseTrash() {
    const due = await db.collection('driveTrash').where('releaseAt', '<=', now()).limit(2000).get();
    let released = 0;
    for (const d of due.docs) {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(d.ref);
        if (!s.exists) return;
        const t = s.data();
        const person = t.uid ? await tx.get(userRef(t.uid)) : null;
        const totals = await tx.get(totalsRef());
        tx.delete(d.ref);
        tx.set(foldersRef(t.pid), { usedBytes: inc(-t.size), fileCount: inc(-1) }, { merge: true });
        if (person && person.exists) tx.set(userRef(t.uid), { usedBytes: inc(-t.size), fileCount: inc(-1) }, { merge: true });
        if (totals.exists) tx.set(totalsRef(), { usedBytes: inc(-t.size), fileCount: inc(-1) }, { merge: true });
        released++;
      });
    }
    return released;
  }

  // ---- Backups -------------------------------------------------------------------

  async function runBackup(projectId, { kind, uid, email, project: given }) {
    requireRoot();
    const project = given || (await getProject(projectId));
    const pRef = projectRef(projectId);
    const [ni, nf] = await Promise.all([pRef.collection('items').count().get(), pRef.collection('files').count().get()]);
    if (ni.data().count > F.MAX_BACKUP_ITEMS || nf.data().count > F.MAX_BACKUP_FILES) {
      throw new F.FileError('failed-precondition',
        `This project is too large to back up here (more than ${F.MAX_BACKUP_ITEMS} items or ${F.MAX_BACKUP_FILES} files). Ask the portal owner.`);
    }
    const [itemsSnap, filesSnap] = await Promise.all([pRef.collection('items').get(), pRef.collection('files').get()]);
    const withId = (d) => Object.assign({ id: d.id }, d.data());
    const items = itemsSnap.docs.map(withId);
    const files = filesSnap.docs.map(withId);
    const at = now();
    const fingerprint = F.fingerprintOf({ project, items, files });
    const folders = await ensureFolders(projectId, project);
    if (kind === 'auto' && folders.lastBackupFingerprint === fingerprint) {
      await foldersRef(projectId).set({ lastCheckedAt: at }, { merge: true });
      return { skipped: true };
    }

    const actSnap = await pRef.collection('activity').orderBy('at', 'desc').limit(500).get();
    const backup = F.buildBackup({
      projectId, project, items, files, activity: actSnap.docs.map(withId), now: at, kind, by: email || uid || 'daily schedule'
    });
    const json = Buffer.from(JSON.stringify(backup));
    const name = F.backupName(project, at, kind);
    const stored = await drive.upload({
      name, mimeType: 'application/json', parentId: folders.backupsFolderId, data: json,
      appProperties: { duckProjectId: projectId, duckBackupKind: kind }
    });
    const bRef = pRef.collection('backups').doc();
    const batch = db.batch();
    batch.set(bRef, {
      name, kind, size: json.length, itemCount: items.length, fileCount: files.length,
      fingerprint: backup.fingerprint, driveFileId: stored.id,
      createdAt: FieldValue.serverTimestamp(), createdAtMs: at, createdBy: uid || '', createdByEmail: email || ''
    });
    batch.set(foldersRef(projectId), { lastBackupFingerprint: backup.fingerprint, lastBackupAt: at, lastCheckedAt: at }, { merge: true });
    if (kind === 'manual') {
      batch.set(pRef.collection('activity').doc(), activity(uid, email, 'project.backup',
        `Backed up the project (${items.length} item${items.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'})`));
    }
    await batch.commit();
    await prune(projectId);
    return { id: bRef.id, name, skipped: false };
  }

  async function prune(projectId) {
    const col = projectRef(projectId).collection('backups');
    const list = (await col.get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
    for (const b of F.backupsToPrune(list)) {
      await col.doc(b.id).delete();
      await drive.trash(b.driveFileId).catch((err) => console.warn('Could not trash old backup', b.driveFileId, err.message));
    }
  }

  // At most one manual backup, and one restore, per project per minute. The
  // claim is a transaction, so clicks from several devices cannot all pass.
  async function claimSlot(projectId, field, message) {
    await db.runTransaction(async (tx) => {
      const ref = foldersRef(projectId);
      const last = Number(((await tx.get(ref)).data() || {})[field] || 0);
      if (now() - last < BACKUP_GAP_MS) bad(message);
      tx.set(ref, { [field]: now() }, { merge: true });
    });
  }

  async function backupNow({ uid, email, projectId }) {
    requireRoot();
    const project = await getProject(projectId);
    if (!F.atLeast(project, uid, 'manager')) deny('Only the owner or a manager can back up the project.');
    await claimSlot(projectId, 'lastManualClaimAt', 'A backup was made less than a minute ago.');
    return runBackup(projectId, { kind: 'manual', uid, email, project });
  }

  async function readBackup(projectId, backupId) {
    const snap = await projectRef(projectId).collection('backups').doc(checkId(backupId, 'The backup')).get();
    if (!snap.exists) throw new F.FileError('not-found', 'That backup was not found. Old backups are removed automatically.');
    const meta = snap.data();
    return { meta, buf: await drive.download(meta.driveFileId) };
  }

  async function downloadBackup({ uid, projectId, backupId }) {
    const project = await getProject(projectId);
    if (!F.atLeast(project, uid, 'manager')) deny('Only the owner or a manager can download backups.');
    const { meta, buf } = await readBackup(projectId, backupId);
    if (buf.length > F.MAX_FILE_BYTES) {
      throw new F.FileError('failed-precondition', 'This backup is too large to download here. It is kept in the project\'s Backups folder in Google Drive; ask the portal owner for a copy.');
    }
    return { name: meta.name, mimeType: 'application/json', size: buf.length, data: buf.toString('base64') };
  }

  async function restoreItems({ uid, email, projectId, backupId }) {
    requireRoot();
    const project = await getProject(projectId);
    if (!F.atLeast(project, uid, 'manager')) deny('Only the owner or a manager can restore a backup.');
    if (project.status === 'archived') bad('This project is archived. Change its status before restoring.');
    checkId(backupId, 'The backup');
    await claimSlot(projectId, 'lastRestoreClaimAt', 'A restore was started less than a minute ago.');
    const { meta, buf } = await readBackup(projectId, backupId);
    let backup;
    try { backup = JSON.parse(buf.toString('utf8')); } catch (e) { bad('That backup file is damaged, so nothing was restored.'); }
    const itemsCol = projectRef(projectId).collection('items');
    const currentIds = (await itemsCol.select().get()).docs.map((d) => d.id);
    const plan = F.planRestore(backup, projectId, currentIds);

    // A restore point first, so the restore itself can be undone.
    const point = await runBackup(projectId, { kind: 'restore_point', uid, email, project });

    const makeTs = (ms) => Timestamp.fromMillis(ms);
    const ops = plan.set.map((s) => (b) => b.set(itemsCol.doc(s.id), F.fromJson(s.data, makeTs)))
      .concat(plan.remove.map((id) => (b) => b.delete(itemsCol.doc(id))));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
    const when = new Date(meta.createdAtMs || Date.parse(backup.createdAt)).toISOString().slice(0, 16).replace('T', ' ');
    await projectRef(projectId).collection('activity').add(activity(uid, email, 'project.restore',
      `Restored tracked items from the backup of ${when} UTC (${plan.set.length} restored, ${plan.remove.length} removed)`));
    return { restored: plan.set.length, removed: plan.remove.length, restorePointId: point.id || null };
  }

  // Once a day: give back space from emptied trash, then back up every project
  // that changed. Projects checked longest ago go first, and no new project is
  // started once the time budget is used, so a slow night never starves the
  // same projects twice.
  async function dailyBackups(opts) {
    const budgetMs = (opts && opts.budgetMs) || DAILY_BUDGET_MS;
    const started = now();
    const tally = { done: 0, skipped: 0, failed: 0, notReached: 0, released: 0 };
    try { tally.released = await releaseTrash(); } catch (err) { console.error('Releasing trashed file space failed', err); }
    if (!cfg().root) { console.log('Daily backups skipped: DRIVE_ROOT_FOLDER_ID is not set.'); return tally; }
    const [snap, foldersSnap] = await Promise.all([db.collection('projects').get(), db.collection('driveFolders').get()]);
    const checked = new Map(foldersSnap.docs.map((d) => [d.id, Number(d.data().lastCheckedAt || d.data().lastBackupAt || 0)]));
    const queue = snap.docs.filter((d) => d.data().status !== 'archived')
      .sort((a, b) => (checked.get(a.id) || 0) - (checked.get(b.id) || 0));
    const worker = async () => {
      while (queue.length) {
        if (now() - started > budgetMs) { tally.notReached += queue.length; queue.length = 0; break; }
        const d = queue.shift();
        try {
          const r = await runBackup(d.id, { kind: 'auto', project: d.data() });
          if (r.skipped) tally.skipped++; else tally.done++;
        } catch (err) {
          tally.failed++;
          console.error('Daily backup failed for project', d.id, err.message || err);
        }
      }
    };
    await Promise.all(Array.from({ length: DAILY_WORKERS }, worker));
    return tally;
  }

  return { ensureFolders, uploadFile, downloadFile, deleteFile, releaseTrash, runBackup, backupNow, downloadBackup, restoreItems, dailyBackups };
}

module.exports = { makeProjectDrive, config };
