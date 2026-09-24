import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

// Server-only Google service-account transport. Never include this file or keys in static hosting.
export class GoogleSheets {
  constructor(env = process.env) { this.env = env; this.id = env.SHEET_ID || '1_cxtIQV17Enp1z7vJhBBkVYyJwvwdxjcAJiN9kYBpAw'; }
  async token(scope = 'https://www.googleapis.com/auth/spreadsheets') {
    this.tokens ||= new Map();
    const cached = this.tokens.get(scope);
    if (cached?.expires > Date.now()) return cached.value;
    const key = JSON.parse(await readFile(this.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }), signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error('Google authorization failed. Check the server service-account credentials.');
    this.tokens.set(scope, { value: data.access_token, expires: Date.now() + 3300000 });
    return data.access_token;
  }
  async request(path, method = 'GET', body) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}${path}`, { method, headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Google Sheets request failed (${res.status}). Check sheet sharing, API access and quotas.`);
    return res.json();
  }
  async read(tab) { return (await this.request('/values/' + encodeURIComponent(`'${tab.replaceAll("'", "''")}'!A:AZ`))).values || []; }
  async write(tab, row, values) {
    const range = `'${tab.replaceAll("'", "''")}'!A${row}:AZ${row}`;
    await this.request('/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', 'PUT', { values: [[...values, ...Array(Math.max(0, 52 - values.length)).fill('')]] });
  }
  async initialize() {
    const meta = await this.request('?fields=sheets.properties');
    this.userTab = meta.sheets.find(s => s.properties.sheetId === 0)?.properties.title || meta.sheets[0].properties.title;
    const existing = new Set(meta.sheets.map(s => s.properties.title));
    const names = ['PortalSessions', 'PortalRecords', 'PortalPurchases'];
    const requests = names.filter(n => !existing.has(n)).map(title => ({ addSheet: { properties: { title, gridProperties: { columnCount: 52 } } } }));
    for (const s of meta.sheets) if (s.properties.gridProperties.columnCount < 52) requests.push({ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, gridProperties: { columnCount: 52 } }, fields: 'gridProperties.columnCount' } });
    if (requests.length) await this.request(':batchUpdate', 'POST', { requests });
    return this.userTab;
  }
  async connect() {
    const meta = await this.request('?fields=sheets.properties');
    this.userTab = meta.sheets.find(s => s.properties.sheetId === 0)?.properties.title || meta.sheets[0].properties.title;
    if ((await this.read(this.userTab))[0]?.[1] !== 'PasswordHash') throw new Error('Run npm run setup before starting the server.');
  }
}

export class Store {
  constructor(google) { this.google = google; }
  async list(tab) {
    const rows = await this.google.read(tab);
    return rows.slice(1).filter(r => r[0]).map(r => ({ key: r[0], value: JSON.parse(r.slice(1).join('') || '{}') }));
  }
  async get(tab, key) { return (await this.list(tab)).find(r => r.key === key)?.value; }
  async put(tab, key, value) {
    const json = JSON.stringify(value);
    if (json.length > 2000000) throw Object.assign(new Error('Record exceeds the 2 MB Sheets sync limit; it remains saved on this device.'), { status: 413 });
    const rows = await this.google.read(tab);
    const index = rows.findIndex((r, i) => i > 0 && r[0] === key);
    const chunks = json.match(/[\s\S]{1,40000}/g) || ['{}'];
    await this.google.write(tab, index < 0 ? Math.max(2, rows.length + 1) : index + 1, [key, ...chunks]);
  }
}
