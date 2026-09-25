#!/usr/bin/env node
// check-deploy.mjs — checks the settings a live deploy needs, before you upload.
//
//   node tools/check-deploy.mjs
//
// It only reads files in this folder. It changes nothing and sends nothing
// anywhere. ✗ lines must be fixed before going live; ! lines are worth a look.
// See docs/DEPLOY.md for what each setting is.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Names that must never be served from the website.
const PRIVATE_NAME = /(^|\/)(service-account[^/]*\.json|google-services\.json|\.env(\.[^/]*)?|\.secret\.local|\.runtimeconfig\.json|[^/]*\.(pem|key|p12|jks|keystore))$/i;
// Things that look like secrets inside a file.
const SECRET_TEXT = [
  [/-----BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY-----/, 'a private key'],
  [/"private_key"\s*:/, 'a service-account key'],
  [/\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/, 'a Stripe secret key'],
  [/\bwhsec_[A-Za-z0-9]{10,}/, 'a Stripe webhook secret']
];
const TEXT_EXT = /\.(html?|js|mjs|json|css|txt|md|webmanifest|xml|svg|htaccess)$|(^|\/)\.htaccess$/i;

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else out.push({ rel: path.relative(base, full).split(path.sep).join('/'), full, size: st.size });
  }
  return out;
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function configValue(src, key) {
  const m = new RegExp(key + '\\s*:\\s*["\']([^"\']*)["\']').exec(src);
  return m ? m[1] : '';
}

// The website folder only: what gets uploaded to Hostinger.
export function checkSite(repo = REPO) {
  const r = { errors: [], warnings: [], ok: [] };
  const pub = path.join(repo, 'public');
  if (!existsSync(pub)) { r.errors.push('There is no public/ folder.'); return r; }
  const files = walk(pub);

  const leaked = files.filter((f) => PRIVATE_NAME.test(f.rel));
  for (const f of leaked) r.errors.push(`public/${f.rel} must not be on the website. Delete it (keys and settings never go in public/).`);
  for (const f of files) {
    if (!TEXT_EXT.test(f.rel) || f.size > 5 * 1024 * 1024) continue;
    const text = readFileSync(f.full, 'utf8');
    for (const [re, what] of SECRET_TEXT) {
      if (re.test(text)) r.errors.push(`public/${f.rel} contains what looks like ${what}. Remove it, and replace that key, since it may have been seen.`);
    }
  }
  if (!leaked.length) r.ok.push('No key or settings files in public/.');

  if (files.some((f) => f.rel === '.htaccess')) r.ok.push('public/.htaccess is there (HTTPS redirect, security headers).');
  else r.errors.push('public/.htaccess is missing. It forces HTTPS and sets the security headers.');

  const cfgPath = path.join(pub, 'js', 'firebase-config.js');
  const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
  const apiKey = configValue(cfg, 'apiKey');
  const projectId = configValue(cfg, 'projectId');
  if (!apiKey || apiKey === 'YOUR_API_KEY' || !projectId) {
    r.errors.push('public/js/firebase-config.js has no real Firebase web config. Copy it from Firebase Console → Project settings → Your apps.');
  } else r.ok.push(`Firebase web config is for project "${projectId}".`);
  r.projectId = projectId;

  const version = (readText(pub, 'js/app-version.js').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const code = (readText(pub, 'js/app-version.js').match(/APP_VERSION_CODE\s*=\s*(\d+)/) || [])[1];
  const cache = (readText(pub, 'sw.js').match(/CACHE_VERSION\s*=\s*'v?([^']+)'/) || [])[1];
  r.version = version;
  if (!version) r.errors.push('APP_VERSION was not found in public/js/app-version.js.');
  else if (version !== cache) r.errors.push(`APP_VERSION is ${version} but CACHE_VERSION in public/sw.js is ${cache}. Make them match, or phones keep the old version.`);
  else r.ok.push(`Version ${version} (build ${code}) matches the offline cache.`);
  return r;
}

function readText(dir, rel) {
  try { return readFileSync(path.join(dir, rel), 'utf8'); } catch (e) { return ''; }
}

// Everything: the website plus the Firebase side.
export function checkAll(repo = REPO) {
  const r = checkSite(repo);

  const rc = readText(repo, '.firebaserc');
  let target = '';
  try { target = JSON.parse(rc).projects.default; } catch (e) { /* none */ }
  if (!target) r.warnings.push('No .firebaserc default project. Run `firebase use --add` once and pick your project.');
  else if (r.projectId && target !== r.projectId) r.errors.push(`.firebaserc deploys to "${target}" but the website is set up for "${r.projectId}". They must be the same project.`);
  else r.ok.push(`Firebase deploys go to "${target}".`);

  const envText = readText(repo, 'functions/.env');
  if (!envText) {
    r.errors.push('functions/.env is missing. Copy functions/.env.example to functions/.env and fill it in (docs/DEPLOY.md, step 4).');
  } else {
    const env = parseEnv(envText);
    for (const [re, what] of SECRET_TEXT) {
      if (re.test(envText)) r.errors.push(`functions/.env contains ${what}. Secrets go in Firebase secret storage (firebase functions:secrets:set), not in .env.`);
    }
    const origin = env.APP_ORIGIN || '';
    if (!origin || /your-domain/.test(origin)) r.errors.push('APP_ORIGIN in functions/.env is not set to your website address.');
    else if (!/^https:\/\/[^/\s]+$/.test(origin)) r.errors.push(`APP_ORIGIN must be https://your-domain with no path or trailing slash; it is "${origin}".`);
    else r.ok.push(`APP_ORIGIN is ${origin}.`);
    const price = env.STRIPE_PRICE_MONTHLY || '';
    if (!/^price_[A-Za-z0-9]+$/.test(price) || price === 'price_xxx') r.errors.push('STRIPE_PRICE_MONTHLY in functions/.env is not a Stripe price ID (price_…). Card payments will not work (docs/PAYMENTS.md).');
    else r.ok.push('A Stripe monthly price is set.');
    if (!env.DRIVE_ROOT_FOLDER_ID) r.warnings.push('DRIVE_ROOT_FOLDER_ID is empty, so project files and backups are switched off (docs/DRIVE_FILES.md).');
    else r.ok.push('Google Drive is set for project files and backups.');
  }

  const appVersion = readText(path.join(repo, 'public'), 'js/app-version.js');
  if (/websiteUrl:\s*''/.test(appVersion)) r.warnings.push("websiteUrl in public/js/app-version.js (APP_PUBLISHER) is empty. Set it to your site's address.");
  if (/legalEntity:\s*''/.test(appVersion)) r.warnings.push('The licensed business name in public/js/app-version.js (APP_PUBLISHER.legalEntity) is empty. Fill it in before selling.');

  const twa = readText(repo, 'twa-manifest.json');
  if (/HOST_DOMAIN/.test(twa)) r.warnings.push('twa-manifest.json still says HOST_DOMAIN. Only matters when you build the Android app.');
  const twaVersion = (twa.match(/"appVersionName"\s*:\s*"([^"]+)"/) || [])[1];
  if (twaVersion && r.version && twaVersion !== r.version) r.warnings.push(`twa-manifest.json is version ${twaVersion}, the website is ${r.version}. Match them before the next Android build.`);
  // The Android app hides the address bar and can take Google Play payments
  // only once this file names the app's signing certificate.
  const links = readText(path.join(repo, 'public'), '.well-known/assetlinks.json');
  if (links) {
    let prints = [];
    try { prints = JSON.parse(links).flatMap((s) => (s && s.target && s.target.sha256_cert_fingerprints) || []); } catch (e) { /* warned below */ }
    if (!prints.length || prints.some((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(f))) {
      r.warnings.push('public/.well-known/assetlinks.json still has a placeholder fingerprint. Only matters for the Android app: put in the SHA-256 fingerprints from Play Console (docs/PLAY_STORE_LAUNCH.md, section 2).');
    }
  }
  return r;
}

export function print(r) {
  for (const s of r.ok) console.log('  ✓ ' + s);
  for (const s of r.warnings) console.log('  ! ' + s);
  for (const s of r.errors) console.log('  ✗ ' + s);
  console.log(r.errors.length ? `\n${r.errors.length} thing(s) to fix before going live.` : '\nReady to deploy.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = checkAll();
  print(r);
  process.exit(r.errors.length ? 1 : 0);
}
