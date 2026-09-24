import { randomUUID } from 'node:crypto';
import { GoogleSheets } from './sheets.mjs';
import { HEADERS, hashPassword } from './core.mjs';
const google = new GoogleSheets();
if (process.env.SHEET_PRIVATE_CONFIRMED !== 'yes') throw new Error('Set sheet General access to Restricted, then set SHEET_PRIVATE_CONFIRMED=yes.');
await google.initialize();
const rows = await google.read(google.userTab);
if (rows[0]?.[1] !== 'PasswordHash' && rows[0]?.slice(3).some(Boolean)) throw new Error('Columns D onward contain data. Back up the sheet and review the schema before migration.');
await google.write(google.userTab, 1, HEADERS);
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row[0]) continue;
  // Existing plaintext passwords are disabled, never imported as usable credentials.
  if (!String(row[1]).startsWith('scrypt$')) row[1] = 'RESET_REQUIRED';
  row[3] ||= randomUUID(); row[4] ||= 'user'; row[9] ||= new Date().toISOString();
  await google.write(google.userTab, i + 1, row);
}
for (const tab of ['PortalSessions', 'PortalRecords', 'PortalPurchases']) if (!(await google.read(tab)).length) await google.write(tab, 1, ['ID', 'Data (server managed)']);
if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD) {
  const current = await google.read(google.userTab);
  const email = process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase();
  const index = current.findIndex((r, i) => i > 0 && String(r[0]).toLowerCase() === email);
  const row = index < 0 ? [email, '', '', randomUUID(), 'admin', '', '', '', false, new Date().toISOString(), false] : current[index];
  row[1] = await hashPassword(process.env.INITIAL_ADMIN_PASSWORD); row[4] = 'admin';
  await google.write(google.userTab, index < 0 ? current.length + 1 : index + 1, row);
}
console.log('Sheet schema ready. Plaintext passwords disabled. Remove INITIAL_ADMIN_PASSWORD from the environment after setup.');
