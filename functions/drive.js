// drive.js — the few Google Drive calls the portal makes, behind one small
// interface so the rest of the code (and the tests) never see the Drive API.
//
// In production this signs in as the Cloud Functions' own service account
// (Application Default Credentials): there is no key file to leak. That
// account must be a member of the shared drive named by DRIVE_ROOT_FOLDER_ID
// (see docs/DEPLOY.md). Service accounts have no storage of their own, so the
// root must be in a SHARED drive, not someone's "My Drive".
//
// Local testing only: with DRIVE_FAKE_DIR set inside the Functions emulator,
// files are kept in that folder instead. It is ignored when deployed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function realDrive() {
  const { google } = require('googleapis');
  let client = null;
  async function api() {
    if (!client) {
      const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
      client = google.drive({ version: 'v3', auth: await auth.getClient() });
    }
    return client;
  }
  return {
    kind: 'google',
    async describe(id) {
      const res = await (await api()).files.get({
        fileId: id, supportsAllDrives: true, fields: 'id,name,mimeType,driveId,trashed'
      });
      return res.data;
    },
    async createFolder(name, parentId, appProperties) {
      const res = await (await api()).files.create({
        supportsAllDrives: true, fields: 'id',
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId], appProperties }
      });
      return res.data.id;
    },
    async upload({ name, mimeType, parentId, data, appProperties }) {
      const res = await (await api()).files.create({
        supportsAllDrives: true, fields: 'id,size',
        requestBody: { name, parents: [parentId], appProperties },
        media: { mimeType, body: Readable.from(data) }
      });
      return { id: res.data.id, size: Number(res.data.size || data.length) };
    },
    async download(id) {
      const res = await (await api()).files.get(
        { fileId: id, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    },
    // Moves the file to the shared drive's trash, where a drive manager can
    // still recover it for 30 days.
    async trash(id) {
      try {
        await (await api()).files.update({ fileId: id, supportsAllDrives: true, requestBody: { trashed: true } });
      } catch (err) {
        if (Number(err.code || (err.response && err.response.status)) !== 404) throw err;
      }
    }
  };
}

function fakeDrive(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = (id) => path.join(dir, id + '.json');
  const read = (id) => {
    try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch (e) { return null; }
  };
  const write = (meta) => fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 1));
  const newId = () => 'fake_' + crypto.randomBytes(10).toString('hex');
  const notFound = () => Object.assign(new Error('File not found'), { code: 404 });
  return {
    kind: 'fake',
    async describe(id) {
      const m = read(id);
      if (m) return m;
      if (id === process.env.DRIVE_ROOT_FOLDER_ID) return { id, name: 'Fake shared drive', mimeType: FOLDER_MIME, driveId: id, trashed: false };
      throw notFound();
    },
    async createFolder(name, parentId, appProperties) {
      const meta = { id: newId(), name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: appProperties || {}, trashed: false };
      write(meta);
      return meta.id;
    },
    async upload({ name, mimeType, parentId, data, appProperties }) {
      const meta = { id: newId(), name, mimeType, parents: [parentId], appProperties: appProperties || {}, size: data.length, trashed: false };
      fs.writeFileSync(path.join(dir, meta.id + '.bin'), data);
      write(meta);
      return { id: meta.id, size: data.length };
    },
    async download(id) {
      const m = read(id);
      if (!m || m.trashed) throw notFound();
      return fs.readFileSync(path.join(dir, id + '.bin'));
    },
    async trash(id) {
      const m = read(id);
      if (!m) return;
      m.trashed = true;
      write(m);
    }
  };
}

let instance = null;
function drive() {
  if (!instance) {
    const fake = process.env.FUNCTIONS_EMULATOR === 'true' && process.env.DRIVE_FAKE_DIR;
    instance = fake ? fakeDrive(path.resolve(fake)) : realDrive();
  }
  return instance;
}

module.exports = { drive, fakeDrive, FOLDER_MIME };
