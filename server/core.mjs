import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const DAY = 86400000;
export const HEADERS = ['Email', 'PasswordHash', 'Subscription (Trial/Monthly/Yearly)', 'UID', 'Role', 'TrialEndsAt', 'ExpiresAt', 'GrantUntil', 'CompForever', 'CreatedAt', 'Revoked'];
export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('Use a password between 12 and 128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, hex] = String(encoded).split('$');
  if (!salt || !/^[a-f0-9]{128}$/.test(hex || '')) { await scrypt(password, 'disabled-account', 64); return false; }
  return timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(hex, 'hex'));
}
const millis = v => Number(v) || Date.parse(v) || 0;
export function publicUser(row) {
  const plan = String(row[2] || '').trim().toLowerCase();
  const revoked = String(row[10]).toLowerCase() === 'true' || plan === 'revoked';
  return { uid: row[3], email: row[0], role: row[4] === 'admin' ? 'admin' : 'user', subscriptionStatus: revoked ? 'revoked' : ['monthly', 'yearly'].includes(plan) ? 'active' : plan === 'trial' ? 'trial' : 'expired', trialEndsAt: plan === 'trial' && !revoked ? millis(row[5]) : 0, subscriptionExpiryMillis: millis(row[6]), adminGrantUntil: revoked ? 0 : millis(row[7]), compForever: !revoked && String(row[8]).toLowerCase() === 'true', createdAt: millis(row[9]) };
}
export function hasAccess(u, now = Date.now()) {
  if (u.role === 'admin') return true;
  if (u.subscriptionStatus === 'revoked') return false;
  return !!(u.compForever || u.adminGrantUntil > now || (u.subscriptionStatus === 'active' && u.subscriptionExpiryMillis > now) || (u.subscriptionStatus === 'trial' && u.trialEndsAt > now));
}
export class Portal {
  constructor(google, store, { mail, verifyPlay, now = () => Date.now() } = {}) { Object.assign(this, { google, store, mail, verifyPlay, now }); }
  async rows() { return this.google.read(this.google.userTab); }
  async rowByUid(uid) { const rows = await this.rows(); const index = rows.findIndex((r, i) => i > 0 && r[3] === uid); if (index < 1) fail('Account not found.', 404); return { row: rows[index], index: index + 1 }; }
  async save(index, row) { await this.google.write(this.google.userTab, index, row); }
  async session(token, kind = 'session') {
    if (!token) fail('Please sign in.', 401);
    const session = await this.store.get('PortalSessions', digest(token));
    if (!session || session.kind !== kind || session.expires <= this.now()) fail('Session expired. Please sign in again.', 401);
    const { row } = await this.rowByUid(session.uid);
    if (session.passwordVersion !== digest(String(row[1]))) fail('Session expired. Please sign in again.', 401);
    return publicUser(row);
  }
  async newSession(row, kind = 'session') {
    const token = randomBytes(32).toString('base64url');
    await this.store.put('PortalSessions', digest(token), { uid: row[3], kind, expires: this.now() + (kind === 'reset' ? 1800000 : DAY), passwordVersion: digest(String(row[1])) });
    return token;
  }
  async refreshPurchases() {
    if (!this.verifyPlay) return;
    const grouped = new Map();
    for (const { value: purchase } of await this.store.list('PortalPurchases')) {
      if (!purchase.uid || !purchase.purchaseToken) continue;
      try {
        const result = await this.verifyPlay(purchase);
        const previous = grouped.get(purchase.uid);
        if (!previous || result.expiry > previous.result.expiry) grouped.set(purchase.uid, { purchase, result });
      } catch { /* Keep the last verified expiry on a temporary Play outage. */ }
    }
    for (const [uid, { purchase, result }] of grouped) {
      const { row, index } = await this.rowByUid(uid);
      row[2] = result.active ? (purchase.subscriptionId === 'pro_yearly' ? 'Yearly' : 'Monthly') : 'Expired';
      row[6] = new Date(result.expiry || 0).toISOString();
      await this.save(index, row);
    }
  }
  async call(action, data, token) {
    if (['signin', 'signup'].includes(action)) {
      const email = String(data.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('Enter a valid email address.');
      const rows = await this.rows();
      let row = rows.slice(1).find(r => String(r[0]).toLowerCase() === email);
      if (action === 'signup') {
        if (row) fail('Cannot create this account. Try signing in or resetting the password.');
        row = [email, await hashPassword(data.password), 'Trial', randomUUID(), 'user', new Date(this.now() + 14 * DAY).toISOString(), '', '', false, new Date(this.now()).toISOString(), false];
        await this.save(Math.max(2, rows.length + 1), row);
      } else if (!await checkPassword(data.password, row?.[1])) fail('Incorrect email or password.', 401);
      return { user: publicUser(row), sessionToken: await this.newSession(row) };
    }
    if (action === 'resetRequest') {
      if (!this.mail) fail('Password reset email is not configured. Please contact support.', 503);
      const row = (await this.rows()).slice(1).find(r => String(r[0]).toLowerCase() === String(data.email || '').trim().toLowerCase());
      if (row) await this.mail(row[0], await this.newSession(row, 'reset'));
      return { ok: true };
    }
    if (action === 'resetConfirm') {
      const user = await this.session(String(data.token || ''), 'reset');
      const { row, index } = await this.rowByUid(user.uid);
      row[1] = await hashPassword(data.password);
      await this.save(index, row);
      await this.store.put('PortalSessions', digest(data.token), {});
      return { ok: true };
    }
    if (action === 'signout') { if (token) await this.store.put('PortalSessions', digest(token), {}); return { ok: true }; }
    const user = await this.session(token);
    if (action === 'me') return { user };
    if (action.startsWith('admin')) {
      if (user.role !== 'admin') fail('Administrator access required.', 403);
      if (action === 'adminListUsers') { const users = (await this.rows()).slice(1).filter(r => r[0]).map(publicUser); return { users, count: users.length }; }
      const { row, index } = await this.rowByUid(data.targetUid);
      if (action === 'adminSetRole') {
        if (!['admin', 'user'].includes(data.role)) fail('Invalid role.');
        if (user.uid === data.targetUid && data.role !== 'admin') fail('You cannot remove your own admin role.');
        row[4] = data.role;
      } else if (action === 'adminSetSubscription') {
        if (data.action === 'revoke') { row[10] = true; row[7] = ''; row[8] = false; }
        else if (['grant', 'extendTrial'].includes(data.action)) {
          const forever = data.action === 'grant' && data.untilMillis === 'forever';
          if (!forever && (!Number.isFinite(Number(data.untilMillis)) || Number(data.untilMillis) <= this.now())) fail('Choose a future expiry date.');
          row[10] = false;
          if (data.action === 'extendTrial') { row[2] = 'Trial'; row[5] = new Date(Number(data.untilMillis)).toISOString(); }
          else { row[8] = forever; row[7] = forever ? '' : new Date(Number(data.untilMillis)).toISOString(); }
        } else fail('Unknown subscription action.');
      } else fail('Unknown admin action.');
      await this.save(index, row);
      return publicUser(row);
    }
    if (action === 'verifyPlayPurchase') {
      if (!this.verifyPlay) fail('Google Play verification is not configured.', 503);
      const key = digest(String(data.purchaseToken || ''));
      const existing = await this.store.get('PortalPurchases', key);
      if (existing?.uid && existing.uid !== user.uid) fail('Purchase belongs to another account.', 403);
      const result = await this.verifyPlay(data);
      if (result.linkedPurchaseToken) {
        const linked = await this.store.get('PortalPurchases', digest(result.linkedPurchaseToken));
        if (linked?.uid && linked.uid !== user.uid) fail('Purchase belongs to another account.', 403);
      }
      await this.store.put('PortalPurchases', key, { uid: user.uid, ...data });
      const { row, index } = await this.rowByUid(user.uid);
      row[2] = result.active ? (data.subscriptionId === 'pro_yearly' ? 'Yearly' : 'Monthly') : 'Expired';
      row[6] = new Date(result.expiry || 0).toISOString();
      await this.save(index, row);
      return { status: publicUser(row).subscriptionStatus, expiryTimeMillis: result.expiry };
    }
    if (data.expectedUid !== user.uid) fail('Account changed. Reload this page before syncing.', 409);
    if (!hasAccess(user, this.now())) fail('An active trial or subscription is required.', 403);
    if (!['assessments', 'permits', 'checklists'].includes(data.collection)) fail('Unknown record collection.');
    const prefix = `${user.uid}/${data.collection}/`;
    if (action === 'records') return { records: (await this.store.list('PortalRecords')).filter(r => r.key.startsWith(prefix)).map(r => r.value) };
    if (!['saveRecord', 'deleteRecord'].includes(action)) fail('Unknown action.');
    const id = data.id || data.record?.id;
    if (typeof id !== 'string' || !id || id.length > 200 || id.includes('/')) fail('Invalid record identifier.');
    const value = action === 'deleteRecord' ? { id, deleted: true, updatedAt: this.now() } : { ...data.record, id, deleted: false, updatedAt: this.now() };
    await this.store.put('PortalRecords', prefix + id, value);
    return value;
  }
}
