// files.js — project files and backups kept in Google Drive.
//
// Each project gets its own folder in the operator's shared drive, with a
// "Files" and a "Backups" folder inside. Only the Cloud Functions touch Drive,
// as the functions' own service account (no key file anywhere): team members
// never need a Google account, and nobody can reach a file except through a
// project they belong to.
//
// What a file is lives in Firestore (projects/{pid}/files/{id}, written only by
// the functions); the bytes live in Drive. The rules here are pure so they can
// be unit-tested without Firebase or Drive; index.js wraps them.

const crypto = require('crypto');

// Files go through a callable function, whose request and response are capped
// at 10 MB. Base64 adds a third, so 7 MB is the largest file that fits.
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const DEFAULT_QUOTA_MB = 2048;
const MAX_NOTE = 500;
const MAX_NAME = 150;

// Only these kinds of file are accepted. The type a file is stored and served
// as comes from this list, never from the browser. `view` marks the types the
// app may show on screen; their first bytes must match (`magic`), so a web page
// renamed to .png is refused rather than displayed.
const OLE = [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]];
const ZIP = [[0x50, 0x4B, 0x03, 0x04]];
const FILE_TYPES = {
  pdf:  { mime: 'application/pdf', view: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  jpg:  { mime: 'image/jpeg', view: 'image', magic: [[0xFF, 0xD8, 0xFF]] },
  jpeg: { mime: 'image/jpeg', view: 'image', magic: [[0xFF, 0xD8, 0xFF]] },
  png:  { mime: 'image/png', view: 'image', magic: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]] },
  gif:  { mime: 'image/gif', view: 'image', magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: 'image/webp', view: 'image', magic: [[0x52, 0x49, 0x46, 0x46]], magicAt8: [0x57, 0x45, 0x42, 0x50] },
  heic: { mime: 'image/heic' },
  heif: { mime: 'image/heif' },
  doc:  { mime: 'application/msword', magic: OLE },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: ZIP },
  xls:  { mime: 'application/vnd.ms-excel', magic: OLE },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: ZIP },
  ppt:  { mime: 'application/vnd.ms-powerpoint', magic: OLE },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: ZIP },
  odt:  { mime: 'application/vnd.oasis.opendocument.text', magic: ZIP },
  ods:  { mime: 'application/vnd.oasis.opendocument.spreadsheet', magic: ZIP },
  msg:  { mime: 'application/vnd.ms-outlook', magic: OLE },
  eml:  { mime: 'message/rfc822' },
  rtf:  { mime: 'application/rtf' },
  csv:  { mime: 'text/csv' },
  txt:  { mime: 'text/plain' },
  dwg:  { mime: 'image/vnd.dwg' },
  dxf:  { mime: 'image/vnd.dxf' }
};
const CATEGORIES = ['document', 'photo', 'drawing', 'certificate', 'report', 'other'];
const RANK = { owner: 4, manager: 3, editor: 2, viewer: 1 };

class FileError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const bad = (msg) => { throw new FileError('invalid-argument', msg); };
const deny = (msg) => { throw new FileError('permission-denied', msg); };

function roleOf(project, uid) { return ((project && project.members) || {})[uid] || ''; }
function atLeast(project, uid, role) { return (RANK[roleOf(project, uid)] || 0) >= RANK[role]; }

function fmtMB(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB'; }

// A file name that is safe to store and show: no folders, no control
// characters, a sensible length, and the extension kept.
function cleanName(raw) {
  let name = String(raw == null ? '' : raw).split(/[\\/]/).pop();
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[.\s]+/, '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (name.length > MAX_NAME) {
    const stem = dot > 0 ? name.slice(0, dot) : name;
    name = stem.slice(0, MAX_NAME - ext.length - 1).trim() + (ext ? '.' + ext : '');
  }
  return { name, ext };
}

function matchesMagic(type, buf) {
  if (!type.magic) return true;
  const ok = type.magic.some((sig) => sig.every((b, i) => buf[i] === b));
  if (!ok) return false;
  if (type.magicAt8) return type.magicAt8.every((b, i) => buf[8 + i] === b);
  return true;
}

function quotaMessage(used, quotaBytes) {
  return `This project has used ${fmtMB(used)} of its ${fmtMB(quotaBytes)} of file space. Delete files you no longer need, or ask the portal owner for more space.`;
}

function allowedList() { return Object.keys(FILE_TYPES).join(', '); }

/**
 * Check an upload before anything is written.
 * @param project  the project document
 * @param uid      the caller
 * @param input    { name, size, category, note, itemId } from the app
 * @param buf      the decoded file (Buffer)
 * @param usage    { usedBytes } for the project so far
 * @param quotaBytes
 * @returns the file record to store (without who/when)
 */
function planUpload(project, uid, input, buf, usage, quotaBytes) {
  if (!roleOf(project, uid)) deny('You are not a member of this project.');
  if (!atLeast(project, uid, 'editor')) deny('Viewers cannot add files. Ask a manager to make you an editor.');
  if (project.status === 'archived') bad('This project is archived, so files cannot be added.');
  const i = input || {};
  const { name, ext } = cleanName(i.name);
  if (!name || !ext) bad('The file needs a name with an extension, like report.pdf.');
  const type = FILE_TYPES[ext];
  if (!type) bad(`Files of type .${ext} cannot be added. Allowed: ${allowedList()}.`);
  if (!buf || !buf.length) bad('The file is empty.');
  if (buf.length > MAX_FILE_BYTES) bad(`${name} is ${fmtMB(buf.length)}. Files can be at most ${fmtMB(MAX_FILE_BYTES)}.`);
  if (Number(i.size) !== buf.length) bad('The file did not arrive complete. Please try again.');
  if (!matchesMagic(type, buf)) bad(`${name} does not look like a real .${ext} file.`);
  const category = CATEGORIES.includes(i.category) ? i.category : (type.view === 'image' ? 'photo' : 'document');
  const note = String(i.note == null ? '' : i.note).trim().slice(0, MAX_NOTE);
  const itemId = typeof i.itemId === 'string' ? i.itemId.trim() : '';
  if (itemId && !/^[A-Za-z0-9_-]{1,80}$/.test(itemId)) bad('That item was not found.');
  const used = Number((usage && usage.usedBytes) || 0);
  if (used + buf.length > quotaBytes) bad(quotaMessage(used, quotaBytes));
  return { name, ext, mimeType: type.mime, size: buf.length, category, note, itemId };
}

// Managers can remove any file; editors only their own.
function canDeleteFile(project, uid, file) {
  if (project.status === 'archived') return false;
  if (atLeast(project, uid, 'manager')) return true;
  return atLeast(project, uid, 'editor') && !!file && file.uploadedBy === uid;
}

// ---- Backups -----------------------------------------------------------------

const BACKUP_FORMAT = 'duck-hse-project-backup';
const BACKUP_VERSION = 1;
// How many of each kind of backup a project keeps; the oldest go first.
const KEEP = { auto: 30, manual: 20, restore_point: 10 };
const ITEM_KEYS = ['type', 'title', 'status', 'priority', 'dueDate', 'assigneeUid', 'location',
  'details', 'ref', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'closedAt'];

function isTimestamp(v) {
  return v && typeof v === 'object' && typeof v.toDate === 'function' && typeof v.toMillis === 'function';
}
// Firestore values → plain JSON. Timestamps become { __ts: ISO string }.
function toJson(v) {
  if (v == null) return v;
  if (isTimestamp(v)) return { __ts: v.toDate().toISOString() };
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = toJson(v[k]);
    return out;
  }
  return v;
}
// And back. `makeTs(ms)` builds a Firestore Timestamp.
function fromJson(v, makeTs) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map((x) => fromJson(x, makeTs));
  if (typeof v === 'object') {
    if (typeof v.__ts === 'string' && Object.keys(v).length === 1) {
      const ms = Date.parse(v.__ts);
      return Number.isFinite(ms) ? makeTs(ms) : null;
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = fromJson(v[k], makeTs);
    return out;
  }
  return v;
}

function stable(v) { return JSON.stringify(v); } // toJson already sorts keys

/**
 * Everything a project holds, as one JSON document.
 * `activity` is the recent log (newest first) and is kept for reference only.
 */
function buildBackup({ projectId, project, items, files, activity, now, kind, by }) {
  const body = {
    project: toJson(project),
    items: (items || []).map((it) => toJson(it)).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    files: (files || []).map((f) => toJson(f)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
  const fingerprint = crypto.createHash('sha256').update(stable(body)).digest('hex');
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    projectId,
    createdAt: new Date(now).toISOString(),
    kind,
    createdBy: by || '',
    fingerprint,
    project: body.project,
    items: body.items,
    files: body.files,
    activity: (activity || []).map((a) => toJson(a))
  };
}

function slug(s) {
  return String(s || 'project').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project';
}
function backupName(project, now, kind) {
  const d = new Date(now).toISOString();
  const stamp = d.slice(0, 10) + '_' + d.slice(11, 16).replace(':', '') + 'Z';
  const label = { auto: 'daily', manual: 'manual', restore_point: 'before-restore' }[kind] || kind;
  return `${slug(project.number || project.name)}_backup_${stamp}_${label}.json`;
}

// Which backups to delete so each kind keeps only its newest KEEP[kind].
function backupsToPrune(backups, keep = KEEP) {
  const byKind = {};
  for (const b of backups) (byKind[b.kind] = byKind[b.kind] || []).push(b);
  const out = [];
  for (const [kind, list] of Object.entries(byKind)) {
    const limit = keep[kind] == null ? KEEP.manual : keep[kind];
    list.sort((a, b) => b.createdAtMs - a.createdAtMs);
    out.push(...list.slice(limit));
  }
  return out;
}

function validItem(it) {
  if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(it.id)) return false;
  if (typeof it.title !== 'string' || !it.title) return false;
  return Object.keys(it).every((k) => k === 'id' || ITEM_KEYS.includes(k));
}

/**
 * Restoring puts a project's tracked items back exactly as they were in the
 * backup: items in the backup are written back, items added since are
 * removed. Team, files and the activity log are left alone.
 * @returns { set: [{ id, data }], remove: [id] }
 */
function planRestore(backup, projectId, currentItemIds) {
  if (!backup || backup.format !== BACKUP_FORMAT) bad('That file is not a Duck HSE project backup.');
  if (backup.version > BACKUP_VERSION) bad('That backup was made by a newer version of the portal.');
  if (backup.projectId !== projectId) bad('That backup belongs to a different project.');
  if (!Array.isArray(backup.items)) bad('The backup has no item list.');
  const bad1 = backup.items.find((it) => !validItem(it));
  if (bad1) bad('The backup contains an item the portal cannot read, so nothing was restored.');
  const keep = new Set(backup.items.map((it) => it.id));
  const set = backup.items.map((it) => {
    const data = Object.assign({}, it);
    delete data.id;
    return { id: it.id, data };
  });
  const remove = (currentItemIds || []).filter((id) => !keep.has(id));
  return { set, remove };
}

module.exports = {
  MAX_FILE_BYTES, DEFAULT_QUOTA_MB, FILE_TYPES, CATEGORIES, KEEP, BACKUP_FORMAT, BACKUP_VERSION,
  FileError, cleanName, planUpload, quotaMessage, canDeleteFile, matchesMagic, atLeast, roleOf, fmtMB,
  toJson, fromJson, buildBackup, backupName, backupsToPrune, planRestore
};
