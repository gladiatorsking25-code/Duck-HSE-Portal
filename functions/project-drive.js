// project-drive.js — Firestore + Drive work behind the file and backup
// callables in index.js. The checks themselves are in files.js.
//
// Server-only records (never readable or writable from the app):
//   driveFolders/{pid}   the project's Drive folder ids, bytes used, last backup
// Readable by members, written only here:
//   projects/{pid}/files/{id}     one per uploaded file
//   projects/{pid}/backups/{id}   one per backup (managers can read)

const F = require('./files');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MANUAL_BACKUP_GAP_MS = 60 * 1000;
const CATEGORY_LABEL = { document: 'document', photo: 'photo', drawing: 'drawing', certificate: 'certificate', report: 'report', other: 'file' };

function config(env) {
  const quotaMb = Number(env.DRIVE_PROJECT_QUOTA_MB) > 0 ? Number(env.DRIVE_PROJECT_QUOTA_MB) : F.DEFAULT_QUOTA_MB;
  return { root: String(env.DRIVE_ROOT_FOLDER_ID || '').trim(), quotaBytes: Math.round(quotaMb * 1048576) };
}

function makeProjectDrive({ db, FieldValue, Timestamp, drive, env, sleep }) {
  const bad = (msg) => { throw new F.FileError('invalid-argument', msg); };
  const deny = (msg) => { throw new F.FileError('permission-denied', msg); };
  const cfg = () => config(env);
  const projectRef = (pid) => db.collection('projects').doc(pid);
  const foldersRef = (pid) => db.collection('driveFolders').doc(pid);
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

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
  // two sets of folders.
  async function ensureFolders(pid, project) {
    const root = requireRoot();
    const ref = foldersRef(pid);
    for (let attempt = 0; attempt < 30; attempt++) {
      const snap = await ref.get();
      const cur = snap.exists ? snap.data() : null;
      if (cur && cur.filesFolderId && cur.backupsFolderId) return cur;
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const d = s.exists ? s.data() : null;
        if (d && d.filesFolderId) return false;
        if (d && d.claimedAt && Date.now() - d.claimedAt < 60000) return false;
        tx.set(ref, { claimedAt: Date.now() }, { merge: true });
        return true;
      });
      if (claimed) {
        try {
          const props = { duckProjectId: pid };
          const folderId = await drive.createFolder(`${String(project.name || 'Project').slice(0, 120)} (${pid})`, root, props);
          const filesFolderId = await drive.createFolder('Files', folderId, props);
          const backupsFolderId = await drive.createFolder('Backups', folderId, props);
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

  async function uploadFile({ uid, email, projectId, input, data }) {
    requireRoot();
    const project = await getProject(projectId);
    const buf = decode(data);
    const usage = (await foldersRef(projectId).get()).data() || {};
    const quota = cfg().quotaBytes;
    const plan = F.planUpload(project, uid, input, buf, usage, quota);
    if (plan.itemId && !(await projectRef(projectId).collection('items').doc(plan.itemId).get()).exists) {
      bad('That item was not found. It may have been deleted.');
    }
    const folders = await ensureFolders(projectId, project);

    // Reserve the space before uploading, so two uploads at once cannot both
    // squeeze under the limit.
    await db.runTransaction(async (tx) => {
      const s = await tx.get(foldersRef(projectId));
      const used = Number((s.data() || {}).usedBytes || 0);
      if (used + plan.size > quota) bad(F.quotaMessage(used, quota));
      tx.set(foldersRef(projectId), { usedBytes: FieldValue.increment(plan.size), fileCount: FieldValue.increment(1) }, { merge: true });
    });
    const release = () => foldersRef(projectId).set(
      { usedBytes: FieldValue.increment(-plan.size), fileCount: FieldValue.increment(-1) }, { merge: true });

    let stored;
    try {
      stored = await drive.upload({
        name: plan.name, mimeType: plan.mimeType, parentId: folders.filesFolderId, data: buf,
        appProperties: { duckProjectId: projectId, uploadedBy: uid }
      });
    } catch (err) { await release().catch(() => {}); throw err; }

    const fileRef = projectRef(projectId).collection('files').doc();
    const batch = db.batch();
    batch.set(fileRef, Object.assign({}, plan, {
      driveFileId: stored.id, uploadedBy: uid, uploadedByEmail: email || '', uploadedAt: FieldValue.serverTimestamp()
    }));
    batch.set(projectRef(projectId).collection('activity').doc(),
      activity(uid, email, 'file.upload', `Added ${CATEGORY_LABEL[plan.category]}: ${plan.name}`, plan.itemId));
    try { await batch.commit(); }
    catch (err) {
      await drive.trash(stored.id).catch(() => {});
      await release().catch(() => {});
      throw err;
    }
    return { id: fileRef.id, name: plan.name, size: plan.size };
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
      tx.set(foldersRef(projectId), { usedBytes: FieldValue.increment(-Number(m.size || 0)), fileCount: FieldValue.increment(-1) }, { merge: true });
      tx.set(projectRef(projectId).collection('activity').doc(), activity(uid, email, 'file.delete', `Deleted file: ${m.name}`, m.itemId));
      return m;
    });
    // The record is gone first, so a failed Drive call can never leave a file
    // that the app still lists. Drive keeps trashed files for 30 days.
    try { await drive.trash(meta.driveFileId); }
    catch (err) { console.error('Could not trash Drive file', meta.driveFileId, err); }
    return { deleted: true };
  }

  // ---- Backups -------------------------------------------------------------------

  async function runBackup(projectId, { kind, uid, email, project: given }) {
    requireRoot();
    const project = given || (await getProject(projectId));
    const pRef = projectRef(projectId);
    const [itemsSnap, filesSnap, actSnap] = await Promise.all([
      pRef.collection('items').get(),
      pRef.collection('files').get(),
      pRef.collection('activity').orderBy('at', 'desc').limit(500).get()
    ]);
    const withId = (d) => Object.assign({ id: d.id }, d.data());
    const items = itemsSnap.docs.map(withId);
    const files = filesSnap.docs.map(withId);
    const now = Date.now();
    const backup = F.buildBackup({
      projectId, project, items, files, activity: actSnap.docs.map(withId), now, kind, by: email || uid || 'daily schedule'
    });
    const folders = await ensureFolders(projectId, project);
    if (kind === 'auto' && folders.lastBackupFingerprint === backup.fingerprint) return { skipped: true };

    const json = Buffer.from(JSON.stringify(backup, null, 1));
    const name = F.backupName(project, now, kind);
    const stored = await drive.upload({
      name, mimeType: 'application/json', parentId: folders.backupsFolderId, data: json,
      appProperties: { duckProjectId: projectId, duckBackupKind: kind }
    });
    const bRef = pRef.collection('backups').doc();
    const batch = db.batch();
    batch.set(bRef, {
      name, kind, size: json.length, itemCount: items.length, fileCount: files.length,
      fingerprint: backup.fingerprint, driveFileId: stored.id,
      createdAt: FieldValue.serverTimestamp(), createdAtMs: now, createdBy: uid || '', createdByEmail: email || ''
    });
    const mark = { lastBackupFingerprint: backup.fingerprint, lastBackupAt: now };
    if (kind === 'manual') mark.lastManualBackupAt = now;
    batch.set(foldersRef(projectId), mark, { merge: true });
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

  async function backupNow({ uid, email, projectId }) {
    const project = await getProject(projectId);
    if (!F.atLeast(project, uid, 'manager')) deny('Only the owner or a manager can back up the project.');
    const folders = (await foldersRef(projectId).get()).data() || {};
    if (folders.lastManualBackupAt && Date.now() - folders.lastManualBackupAt < MANUAL_BACKUP_GAP_MS) {
      bad('A backup was made less than a minute ago.');
    }
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
    return { name: meta.name, mimeType: 'application/json', size: buf.length, data: buf.toString('base64') };
  }

  async function restoreItems({ uid, email, projectId, backupId }) {
    const project = await getProject(projectId);
    if (!F.atLeast(project, uid, 'manager')) deny('Only the owner or a manager can restore a backup.');
    if (project.status === 'archived') bad('This project is archived. Change its status before restoring.');
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

  // Once a day: back up every project that changed since its last backup.
  async function dailyBackups() {
    if (!cfg().root) { console.log('Daily backups skipped: DRIVE_ROOT_FOLDER_ID is not set.'); return { done: 0, skipped: 0, failed: 0 }; }
    const snap = await db.collection('projects').get();
    const queue = snap.docs.filter((d) => d.data().status !== 'archived');
    const tally = { done: 0, skipped: 0, failed: 0 };
    const worker = async () => {
      while (queue.length) {
        const d = queue.shift();
        try {
          const r = await runBackup(d.id, { kind: 'auto', project: d.data() });
          if (r.skipped) tally.skipped++; else tally.done++;
        } catch (err) {
          tally.failed++;
          console.error('Daily backup failed for project', d.id, err);
        }
      }
    };
    await Promise.all([0, 1, 2, 3].map(worker));
    return tally;
  }

  return { ensureFolders, uploadFile, downloadFile, deleteFile, runBackup, backupNow, downloadBackup, restoreItems, dailyBackups };
}

module.exports = { makeProjectDrive, config };
