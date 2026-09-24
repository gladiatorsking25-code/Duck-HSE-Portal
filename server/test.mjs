import test from 'node:test';
import assert from 'node:assert/strict';
import { Portal, HEADERS, hasAccess, hashPassword, checkPassword, publicUser } from './core.mjs';
import { Store } from './sheets.mjs';
class MemoryGoogle {
  userTab = 'Sheet1';
  tables = new Map([['Sheet1', [HEADERS]], ...['PortalSessions', 'PortalRecords', 'PortalPurchases'].map(n => [n, [['ID', 'Data']]])]);
  async read(tab) { return structuredClone(this.tables.get(tab) || []); }
  async write(tab, row, values) { if (!this.tables.has(tab)) this.tables.set(tab, []); this.tables.get(tab)[row - 1] = [...values]; }
}
async function fixture() {
  const google = new MemoryGoogle(); const store = new Store(google); const mails = [];
  const portal = new Portal(google, store, { mail: async (email, token) => mails.push({ email, token }), verifyPlay: async () => ({ active: true, expiry: Date.now() + 86400000 }) });
  const signup = email => portal.call('signup', { email, password: 'test-long-password-123!' });
  const a = await signup('a@example.com'), b = await signup('b@example.com');
  return { google, store, portal, signup, a, b, mails };
}
test('passwords are salted, reject plaintext, and enforce minimum strength', async () => {
  const hash = await hashPassword('secure-long-password'); assert.equal(await checkPassword('secure-long-password', hash), true); assert.equal(await checkPassword('bad', hash), false); assert.equal(await checkPassword('admin', 'admin'), false); assert.notEqual(hash, await hashPassword('secure-long-password')); await assert.rejects(hashPassword('short'));
});
test('signup cannot set a role or plan, duplicate signup fails, and sessions expose no password', async () => {
  const { portal, a, signup } = await fixture(); assert.equal(a.user.role, 'user'); assert.equal(a.user.subscriptionStatus, 'trial'); assert.equal('PasswordHash' in a.user, false);
  await assert.rejects(signup('A@example.com')); await assert.rejects(portal.call('me', {}, 'made-up-token'), { status: 401 });
  assert.equal((await portal.call('me', {}, a.sessionToken)).user.uid, a.user.uid);
});
test('records are account-isolated and deletes are propagated as tombstones', async () => {
  const { portal, a, b } = await fixture();
  await portal.call('saveRecord', { expectedUid: a.user.uid, collection: 'assessments', record: { id: 'A-1', title: '=IMPORTXML("bad")', uid: b.user.uid } }, a.sessionToken);
  assert.equal((await portal.call('records', { expectedUid: b.user.uid, collection: 'assessments' }, b.sessionToken)).records.length, 0);
  assert.equal((await portal.call('records', { expectedUid: a.user.uid, collection: 'assessments' }, a.sessionToken)).records.length, 1);
  await portal.call('deleteRecord', { expectedUid: a.user.uid, collection: 'assessments', id: 'A-1' }, a.sessionToken);
  assert.equal((await portal.call('records', { expectedUid: a.user.uid, collection: 'assessments' }, a.sessionToken)).records[0].deleted, true);
  await assert.rejects(portal.call('records', { expectedUid: a.user.uid, collection: 'users' }, a.sessionToken));
});
test('non-admin cannot grant access; expired and revoked users cannot read or write records', async () => {
  const { google, portal, a, b } = await fixture();
  await assert.rejects(portal.call('adminSetRole', { targetUid: a.user.uid, role: 'admin' }, a.sessionToken), { status: 403 });
  const rows = await google.read('Sheet1'); rows[1][4] = 'admin'; await google.write('Sheet1', 2, rows[1]);
  await portal.call('adminSetSubscription', { targetUid: b.user.uid, action: 'revoke' }, a.sessionToken);
  await assert.rejects(portal.call('records', { expectedUid: b.user.uid, collection: 'permits' }, b.sessionToken), { status: 403 });
  await assert.rejects(portal.call('saveRecord', { expectedUid: b.user.uid, collection: 'permits', record: { id: 'P-1' } }, b.sessionToken), { status: 403 });
  await portal.call('adminSetSubscription', { targetUid: b.user.uid, action: 'grant', untilMillis: 'forever' }, a.sessionToken);
  assert.deepEqual((await portal.call('records', { expectedUid: b.user.uid, collection: 'permits' }, b.sessionToken)).records, []);
});
test('monthly/yearly plans require an unexpired date; blank plans do not grant access', () => {
  for (const plan of ['Monthly', 'Yearly']) {
    assert.equal(hasAccess(publicUser(['x', '', plan, 'u', 'user', '', ''])), false);
    assert.equal(hasAccess(publicUser(['x', '', plan, 'u', 'user', '', new Date(Date.now() + 100000).toISOString()])), true);
    assert.equal(hasAccess(publicUser(['x', '', plan, 'u', 'user', '', '2000-01-01'])), false);
  }
  assert.equal(hasAccess(publicUser(['x', '', '', 'u'])), false);
});
test('reset token is single-use, expires, and password change invalidates every prior session', async () => {
  const { portal, a, mails, store } = await fixture();
  await portal.call('resetRequest', { email: a.user.email }); const token = mails[0].token;
  await portal.call('resetConfirm', { token, password: 'a-new-password-123!' });
  await assert.rejects(portal.call('me', {}, a.sessionToken), { status: 401 });
  await assert.rejects(portal.call('resetConfirm', { token, password: 'a-new-password-234!' }), { status: 401 });
  const signed = await portal.call('signin', { email: a.user.email, password: 'a-new-password-123!' }); assert.ok(signed.sessionToken);
  await portal.call('signout', {}, signed.sessionToken); await assert.rejects(portal.call('me', {}, signed.sessionToken), { status: 401 });
  const sessions = await store.list('PortalSessions'); assert.ok(sessions.every(s => s.key.length === 64));
});
test('large records are split across cells, read back correctly, and over-limit saves fail', async () => {
  const { store, google } = await fixture(); const record = { id: 'photo', text: 'x'.repeat(95000) };
  await store.put('PortalRecords', 'u/assessments/photo', record); assert.deepEqual(await store.get('PortalRecords', 'u/assessments/photo'), record);
  assert.ok((await google.read('PortalRecords'))[1].slice(1).every(cell => cell.length <= 40000));
  await assert.rejects(store.put('PortalRecords', 'large', { text: 'x'.repeat(2000001) }), { status: 413 });
});
test('Google Play purchase token cannot be reused by another account', async () => {
  const { portal, a, b } = await fixture(); const purchase = { packageName: 'Duck.HSE.Portal', subscriptionId: 'pro_monthly', purchaseToken: 'test-purchase-token' };
  await portal.call('verifyPlayPurchase', purchase, a.sessionToken);
  await assert.rejects(portal.call('verifyPlayPurchase', purchase, b.sessionToken), { status: 403 });
});
test('stale tabs cannot save one user records under another user session', async () => {
  const { portal, a, b } = await fixture();
  await assert.rejects(portal.call('saveRecord', { expectedUid: a.user.uid, collection: 'assessments', record: { id: 'A-1' } }, b.sessionToken), { status: 409 });
});
