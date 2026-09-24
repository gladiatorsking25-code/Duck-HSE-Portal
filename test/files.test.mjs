// Unit tests for project files and backups (functions/files.js).
// Run with `npm run test:unit` in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../functions/files.js');

const project = {
  name: 'Tower crane works', number: 'P-100', status: 'active',
  members: { own: 'owner', man: 'manager', ed: 'editor', ed2: 'editor', view: 'viewer' }
};
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 32)]);
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]);
const QUOTA = 50 * 1048576;

function upload(uid, input, buf, used = 0, p = project) {
  return F.planUpload(p, uid, Object.assign({ size: buf.length }, input), buf, { usedBytes: used }, QUOTA);
}
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof F.FileError && re.test(e.message));

test('an editor can add a PDF; the stored type comes from the extension', () => {
  const r = upload('ed', { name: 'Method statement.PDF', category: 'document', note: ' rev B ' }, PDF);
  assert.equal(r.name, 'Method statement.PDF');
  assert.equal(r.ext, 'pdf');
  assert.equal(r.mimeType, 'application/pdf');
  assert.equal(r.size, PDF.length);
  assert.equal(r.category, 'document');
  assert.equal(r.note, 'rev B');
});

test('photos default to the photo category and other files to document', () => {
  assert.equal(upload('ed', { name: 'site.png' }, PNG).category, 'photo');
  assert.equal(upload('ed', { name: 'site.jpg', category: 'nonsense' }, JPG).category, 'photo');
  assert.equal(upload('ed', { name: 'plan.pdf' }, PDF).category, 'document');
});

test('viewers and outsiders cannot add files', () => {
  refuses(() => upload('view', { name: 'a.pdf' }, PDF), /Viewers cannot add files/);
  refuses(() => upload('stranger', { name: 'a.pdf' }, PDF), /not a member/);
});

test('an archived project takes no new files', () => {
  refuses(() => upload('own', { name: 'a.pdf' }, PDF, 0, Object.assign({}, project, { status: 'archived' })), /archived/);
});

test('web pages, scripts and programs are refused', () => {
  for (const name of ['page.html', 'x.svg', 'run.exe', 'script.js', 'macro.docm', 'noext', 'archive.zip']) {
    refuses(() => upload('ed', { name }, PDF), /cannot be added|needs a name/);
  }
});

test('a file must really be what its extension says when the app can show it', () => {
  refuses(() => upload('ed', { name: 'fake.png' }, Buffer.from('<html><script>alert(1)</script>')), /does not look like a real \.png/);
  refuses(() => upload('ed', { name: 'fake.pdf' }, Buffer.from('<html></html>')), /does not look like a real \.pdf/);
  refuses(() => upload('ed', { name: 'fake.webp' }, Buffer.from('RIFF0000WAVEfmt ')), /does not look like a real \.webp/);
  assert.ok(upload('ed', { name: 'ok.webp' }, Buffer.from('RIFF0000WEBPVP8 ')));
  // Text formats have no signature to check.
  assert.ok(upload('ed', { name: 'register.csv' }, Buffer.from('a,b\n1,2\n')));
});

test('size limits: 7 MB per file, the declared size must match, and the project quota', () => {
  const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(F.MAX_FILE_BYTES)]);
  refuses(() => upload('ed', { name: 'big.pdf' }, big), /at most 7\.0 MB/);
  refuses(() => F.planUpload(project, 'ed', { name: 'a.pdf', size: 5 }, PDF, {}, QUOTA), /did not arrive complete/);
  refuses(() => upload('ed', { name: 'empty.pdf' }, Buffer.alloc(0)), /empty/);
  refuses(() => upload('ed', { name: 'a.pdf' }, PDF, QUOTA - 10), /used 50 MB of its 50 MB/);
});

test('file names lose folders and odd characters but keep their extension', () => {
  assert.deepEqual(F.cleanName('C:\\Users\\me\\Desktop\\Lift plan.pdf'), { name: 'Lift plan.pdf', ext: 'pdf' });
  assert.deepEqual(F.cleanName('../../etc/passwd.txt'), { name: 'passwd.txt', ext: 'txt' });
  assert.equal(F.cleanName('a<b>c:"d"|e?.pdf').name, 'a b c d e .pdf');
  assert.equal(F.cleanName('...hidden.pdf').name, 'hidden.pdf');
  const long = F.cleanName('x'.repeat(300) + '.xlsx');
  assert.ok(long.name.length <= 150);
  assert.ok(long.name.endsWith('.xlsx'));
});

test('a link to a tracked item must look like an item id', () => {
  assert.equal(upload('ed', { name: 'a.pdf', itemId: 'abc123' }, PDF).itemId, 'abc123');
  refuses(() => upload('ed', { name: 'a.pdf', itemId: '../x' }, PDF), /item was not found/);
});

test('managers delete any file; editors only their own; viewers none', () => {
  const mine = { uploadedBy: 'ed' };
  assert.equal(F.canDeleteFile(project, 'man', mine), true);
  assert.equal(F.canDeleteFile(project, 'own', mine), true);
  assert.equal(F.canDeleteFile(project, 'ed', mine), true);
  assert.equal(F.canDeleteFile(project, 'ed2', mine), false);
  assert.equal(F.canDeleteFile(project, 'view', { uploadedBy: 'view' }), false);
  assert.equal(F.canDeleteFile(Object.assign({}, project, { status: 'archived' }), 'own', mine), false);
});

// ---- Backups ------------------------------------------------------------------------

const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const item = (id, title, extra = {}) => Object.assign({
  id, type: 'action', title, status: 'open', priority: 'high', dueDate: '', assigneeUid: '',
  location: '', details: '', createdAt: ts(1700000000000), createdBy: 'own', updatedAt: ts(1700000500000), updatedBy: 'own'
}, extra);

test('a backup holds the project, items and file list, with timestamps kept', () => {
  const b = F.buildBackup({
    projectId: 'p1', project, items: [item('b', 'Second'), item('a', 'First')],
    files: [{ id: 'f1', name: 'a.pdf', uploadedAt: ts(1700000600000) }],
    activity: [{ id: 'e1', summary: 'x', at: ts(1700000700000) }], now: 1700001000000, kind: 'manual', by: 'own@x.com'
  });
  assert.equal(b.format, F.BACKUP_FORMAT);
  assert.equal(b.projectId, 'p1');
  assert.deepEqual(b.items.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(b.items[0].createdAt, { __ts: '2023-11-14T22:13:20.000Z' });
  assert.equal(b.files[0].name, 'a.pdf');
  assert.equal(b.activity.length, 1);
  assert.match(b.fingerprint, /^[0-9a-f]{64}$/);
  // Round trip through JSON and back to timestamps.
  const back = F.fromJson(JSON.parse(JSON.stringify(b.items[0])), (ms) => ({ ms }));
  assert.deepEqual(back.createdAt, { ms: 1700000000000 });
});

test('the fingerprint changes when items change, not when only the activity log grows', () => {
  const base = { projectId: 'p1', project, files: [], now: 1, kind: 'auto' };
  const a = F.buildBackup(Object.assign({}, base, { items: [item('a', 'First')], activity: [] }));
  const b = F.buildBackup(Object.assign({}, base, { items: [item('a', 'First')], activity: [{ id: 'x' }], now: 99 }));
  const c = F.buildBackup(Object.assign({}, base, { items: [item('a', 'First', { status: 'closed' })], activity: [] }));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('backup file names say which project, when and what kind', () => {
  assert.equal(F.backupName(project, Date.UTC(2026, 8, 24, 22, 5), 'auto'), 'P-100_backup_2026-09-24_2205Z_daily.json');
  assert.equal(F.backupName({ name: 'Site / B' }, Date.UTC(2026, 0, 2, 3, 4), 'restore_point'), 'Site_B_backup_2026-01-02_0304Z_before-restore.json');
});

test('old backups are pruned per kind, newest kept', () => {
  const list = [];
  for (let i = 0; i < 35; i++) list.push({ id: 'a' + i, kind: 'auto', createdAtMs: i });
  for (let i = 0; i < 3; i++) list.push({ id: 'm' + i, kind: 'manual', createdAtMs: i });
  const gone = F.backupsToPrune(list).map((b) => b.id).sort();
  assert.deepEqual(gone, ['a0', 'a1', 'a2', 'a3', 'a4']);
});

test('restoring puts items back and removes ones added since', () => {
  const b = JSON.parse(JSON.stringify(F.buildBackup({
    projectId: 'p1', project, items: [item('a', 'First'), item('b', 'Second')], files: [], activity: [], now: 1, kind: 'manual'
  })));
  const plan = F.planRestore(b, 'p1', ['a', 'c']);
  assert.deepEqual(plan.set.map((s) => s.id), ['a', 'b']);
  assert.equal(plan.set[0].data.id, undefined);
  assert.equal(plan.set[0].data.title, 'First');
  assert.deepEqual(plan.remove, ['c']);
});

test('a restore refuses another project’s backup, a newer format or a damaged item', () => {
  const good = JSON.parse(JSON.stringify(F.buildBackup({ projectId: 'p1', project, items: [item('a', 'First')], files: [], activity: [], now: 1, kind: 'manual' })));
  refuses(() => F.planRestore(good, 'p2', []), /different project/);
  refuses(() => F.planRestore(Object.assign({}, good, { version: 99 }), 'p1', []), /newer version/);
  refuses(() => F.planRestore({ format: 'other' }, 'p1', []), /not a Duck HSE project backup/);
  const extra = JSON.parse(JSON.stringify(good));
  extra.items[0].ownerUid = 'x';
  refuses(() => F.planRestore(extra, 'p1', []), /cannot read/);
  const badId = JSON.parse(JSON.stringify(good));
  badId.items[0].id = 'a/b';
  refuses(() => F.planRestore(badId, 'p1', []), /cannot read/);
});
