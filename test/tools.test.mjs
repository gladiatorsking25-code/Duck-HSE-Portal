// Unit tests for the deploy tools (tools/check-deploy.mjs, tools/package-site.mjs).
// Run with `npm run test:unit` in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { checkSite, checkAll } from '../tools/check-deploy.mjs';
import { zipFolder } from '../tools/package-site.mjs';

function fakeRepo(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'duck-deploy-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const GOOD = {
  'public/.htaccess': 'Options -Indexes\n',
  'public/index.html': '<!doctype html><title>x</title>',
  'public/js/firebase-config.js': 'const FIREBASE_CONFIG = { apiKey: "AIzaReal", projectId: "my-proj" };',
  'public/js/app-version.js': "const APP_VERSION = '1.2.3';\nconst APP_VERSION_CODE = 7;",
  'public/sw.js': "const CACHE_VERSION = 'v1.2.3';",
  '.firebaserc': '{"projects":{"default":"my-proj"}}',
  'functions/.env': 'APP_ORIGIN=https://hse.example.com\nSTRIPE_PRICE_MONTHLY=price_123abc\nDRIVE_ROOT_FOLDER_ID=0ABCdef\n',
  'twa-manifest.json': '{"appVersionName": "1.2.3"}'
};

test('a complete setup passes', () => {
  const dir = fakeRepo(GOOD);
  const r = checkAll(dir);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  rmSync(dir, { recursive: true });
});

test('keys and secrets in the website folder are caught', () => {
  const dir = fakeRepo(Object.assign({}, GOOD, {
    'public/service-account.json': '{}',
    'public/js/leak.js': 'const k = "sk_live_abcdefghijklmnop";',
    'public/notes.txt': '-----BEGIN PRIVATE KEY-----\nMII...',
    'public/.env': 'X=1'
  }));
  const errs = checkSite(dir).errors.join('\n');
  assert.match(errs, /service-account\.json must not be on the website/);
  assert.match(errs, /\.env must not be on the website/);
  assert.match(errs, /leak\.js contains what looks like a Stripe secret key/);
  assert.match(errs, /notes\.txt contains what looks like a private key/);
  rmSync(dir, { recursive: true });
});

test('placeholder settings and mismatches are reported', () => {
  const dir = fakeRepo(Object.assign({}, GOOD, {
    'public/js/firebase-config.js': 'const FIREBASE_CONFIG = { apiKey: "YOUR_API_KEY", projectId: "" };',
    'public/sw.js': "const CACHE_VERSION = 'v1.2.2';",
    'functions/.env': 'APP_ORIGIN=https://hse.example.com/\nSTRIPE_PRICE_MONTHLY=price_xxx\nSTRIPE_SECRET_KEY=sk_test_abcdefghijklmnop\n'
  }));
  const r = checkAll(dir);
  const errs = r.errors.join('\n');
  assert.match(errs, /no real Firebase web config/);
  assert.match(errs, /CACHE_VERSION in public\/sw\.js is 1\.2\.2/);
  assert.match(errs, /APP_ORIGIN must be https:\/\/your-domain with no path or trailing slash/);
  assert.match(errs, /not a Stripe price ID/);
  assert.match(errs, /functions\/\.env contains a Stripe secret key/);
  assert.match(r.warnings.join('\n'), /DRIVE_ROOT_FOLDER_ID is empty/);
  rmSync(dir, { recursive: true });
});

test('a www. APP_ORIGIN is flagged, since the website sends www. to the bare address', () => {
  const dir = fakeRepo(Object.assign({}, GOOD, {
    'functions/.env': 'APP_ORIGIN=https://www.example.com\nSTRIPE_PRICE_MONTHLY=price_123abc\nDRIVE_ROOT_FOLDER_ID=0ABCdef\n'
  }));
  const r = checkAll(dir);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /APP_ORIGIN is https:\/\/www\.example\.com.*Set APP_ORIGIN to https:\/\/example\.com,/);
  rmSync(dir, { recursive: true });
});

test('the deploy target must be the project the website uses', () => {
  const dir = fakeRepo(Object.assign({}, GOOD, { '.firebaserc': '{"projects":{"default":"other-proj"}}' }));
  assert.match(checkAll(dir).errors.join('\n'), /deploys to "other-proj" but the website is set up for "my-proj"/);
  rmSync(dir, { recursive: true });
});

test('a placeholder in the Android app links file is flagged, a real fingerprint is not', () => {
  const links = (print) => JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'Duck.HSE.Portal', sha256_cert_fingerprints: [print] } }]);
  const real = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  for (const [body, flagged] of [[links('REPLACE_WITH_PLAY_APP_SIGNING_SHA256'), true], ['not json', true], ['[]', true], [links(real), false]]) {
    const dir = fakeRepo(Object.assign({}, GOOD, { 'public/.well-known/assetlinks.json': body }));
    const r = checkAll(dir);
    assert.equal(/assetlinks\.json still has a placeholder fingerprint/.test(r.warnings.join('\n')), flagged, body);
    assert.deepEqual(r.errors, []);
    rmSync(dir, { recursive: true });
  }
});

// Reads a zip back with nothing but Node, to prove the archive is well formed.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    out[name] = method === 8 ? inflateRawSync(body) : body;
    p += 46 + nlen;
  }
  return out;
}

test('the site zip holds every file of public/, hidden ones included, byte for byte', () => {
  const dir = fakeRepo({
    'public/.htaccess': 'Options -Indexes\n',
    'public/index.html': '<!doctype html>' + 'x'.repeat(5000),
    'public/js/app.js': 'console.log("hi")',
    'public/assets/icon.png': Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]),
    'public/ملف.txt': 'unicode name'
  });
  const { zip, count } = zipFolder(path.join(dir, 'public'));
  const files = unzip(zip);
  assert.equal(count, 5);
  assert.deepEqual(Object.keys(files).sort(), ['.htaccess', 'assets/icon.png', 'index.html', 'js/app.js', 'ملف.txt']);
  assert.equal(files['index.html'].toString(), '<!doctype html>' + 'x'.repeat(5000));
  assert.deepEqual([...files['assets/icon.png']], [0x89, 0x50, 0x4E, 0x47, 1, 2, 3]);
  rmSync(dir, { recursive: true });
});
