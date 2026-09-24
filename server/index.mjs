import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { GoogleSheets, Store } from './sheets.mjs';
import { Portal, fail } from './core.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const google = new GoogleSheets();
await google.connect();
const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('APP_ORIGIN must use HTTPS except on localhost.');
let mail;
if (process.env.SMTP_HOST) {
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_PORT !== '587', requireTLS: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
  mail = (to, token) => transport.sendMail({ from: process.env.SMTP_FROM, to, subject: 'Reset your portal password', text: `Use this link within 30 minutes to set a new password:\n${origin}/reset-password.html#${token}\nIf you did not request this, ignore this message.` });
}
async function verifyPlay(data) {
  const packageName = process.env.PLAY_PACKAGE_NAME;
  if (!packageName || data.packageName !== packageName || !['pro_monthly', 'pro_yearly'].includes(data.subscriptionId) || !data.purchaseToken) fail('Invalid or unconfigured Google Play purchase.');
  const headers = { Authorization: `Bearer ${await google.token('https://www.googleapis.com/auth/androidpublisher')}`, 'Content-Type': 'application/json' };
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions`;
  const result = await fetch(`${base}v2/tokens/${encodeURIComponent(data.purchaseToken)}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!result.ok) fail('Google Play could not verify this purchase.', 502);
  const sub = await result.json();
  const item = sub.lineItems?.find(i => i.productId === data.subscriptionId);
  if (!item) fail('The purchase does not match this subscription.');
  const expiry = Date.parse(item.expiryTime) || 0;
  const active = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'].includes(sub.subscriptionState) && expiry > Date.now();
  if (active && sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    const ack = await fetch(`${base}/${encodeURIComponent(data.subscriptionId)}/tokens/${encodeURIComponent(data.purchaseToken)}:acknowledge`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20000) });
    if (!ack.ok) fail('Google Play purchase acknowledgement failed. Try Restore purchases.', 502);
  }
  return { active, expiry, linkedPurchaseToken: sub.linkedPurchaseToken || '' };
}
const portal = new Portal(google, new Store(google), { mail, verifyPlay });
// A single writer serializes all read-modify-write operations. Deploy exactly ONE process/replica.
let queue = Promise.resolve();
// Reconcile renewals/cancellations even if the Android app is closed.
if (process.env.PLAY_PACKAGE_NAME) {
  setInterval(() => { const job = queue.then(() => portal.refreshPurchases()); queue = job.catch(err => console.error('Purchase refresh:', err.message)); }, 15 * 60000).unref();
}
const limits = new Map();
function throttle(key, max) {
  const now = Date.now();
  if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const state = limits.get(key) || { count: 0, until: now + 900000 };
  if (state.until < now) { state.count = 0; state.until = now + 900000; }
  limits.set(key, state);
  if (++state.count > max) fail('Too many attempts. Try again in 15 minutes.', 429);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
function cookie(token) { return `portal_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 86400 : 0}${origin.startsWith('https:') ? '; Secure' : ''}`; }
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/portal') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') fail('POST required.', 405);
      if (req.headers.origin !== origin || !String(req.headers['content-type']).startsWith('application/json')) fail('Invalid request origin.', 403);
      throttle('ip:' + req.socket.remoteAddress, 1200);
      let raw = '';
      for await (const part of req) { raw += part; if (Buffer.byteLength(raw) > 2100000) fail('Request too large.', 413); }
      let body; try { body = JSON.parse(raw); } catch { fail('Invalid request.'); }
      if (!body || typeof body.action !== 'string' || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) fail('Invalid request.');
      if (['signin', 'signup', 'resetRequest', 'resetConfirm'].includes(body.action)) {
        throttle('auth-ip:' + req.socket.remoteAddress, 50);
        throttle('email:' + String(body.data.email || '').trim().toLowerCase(), 20);
      }
      const token = /(?:^|;\s*)portal_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
      const job = queue.then(() => portal.call(body.action, body.data, token));
      queue = job.catch(() => {});
      const data = await job;
      if (data.sessionToken) { res.setHeader('Set-Cookie', cookie(data.sessionToken)); delete data.sessionToken; }
      if (body.action === 'signout') res.setHeader('Set-Cookie', cookie(''));
      res.end(JSON.stringify({ data }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed.', 405);
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (name.includes('..') || name.includes('\\') || name.includes('\0') || !(/^\/[\w-]+\.html$/.test(name) || /^\/(js|css|assets)\/[\w./-]+$/.test(name) || ['/sw.js', '/manifest.webmanifest', '/storage.js', '/app-version.js', '/.well-known/assetlinks.json'].includes(name))) fail('Not found.', 404);
    const file = path.join(root, name);
    let bytes; try { bytes = await readFile(file); } catch { fail('Not found.', 404); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (err) {
    res.statusCode = err.status || 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.status ? err.message : 'The sheet connection is unavailable. Please try again.' }));
    if (!err.status) console.error(err.message);
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`Portal listening at ${origin}`));
