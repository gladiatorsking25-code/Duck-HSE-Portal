#!/usr/bin/env node
// package-site.mjs — makes the zip you upload to Hostinger.
//
//   node tools/package-site.mjs
//
// It checks the website folder first (tools/check-deploy.mjs), then zips the
// CONTENTS of public/ (including the hidden .htaccess) into
// dist/duck-hse-portal-site-v<version>.zip. In Hostinger's File Manager, upload
// that zip into public_html and choose Extract. Needs only Node.js.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSite, print } from './check-deploy.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push({ name: path.relative(base, full).split(path.sep).join('/'), full });
  }
  return out;
}

// A standard zip (deflate), readable by Hostinger, Windows and macOS.
export function zipFolder(dir, when = new Date()) {
  const { time, date } = dosTime(when);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of listFiles(dir)) {
    const data = readFileSync(f.full);
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);                 // names are UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x0314, 4);                   // made by: Unix, zip 2.0
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38);  // rw-r--r--
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = central.length / 2;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return { zip: Buffer.concat([...locals, cenBuf, end]), count };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const check = checkSite(REPO);
  if (check.errors.length) {
    print(check);
    console.log('Nothing was packaged.');
    process.exit(1);
  }
  const { zip, count } = zipFolder(path.join(REPO, 'public'));
  const out = path.join(REPO, 'dist', `duck-hse-portal-site-v${check.version}.zip`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, zip);
  console.log(`Packaged ${count} files (${(zip.length / 1048576).toFixed(1)} MB) into ${path.relative(REPO, out)}`);
  console.log('Upload it to public_html in Hostinger\'s File Manager and choose Extract (docs/DEPLOY.md, step 7).');
}
