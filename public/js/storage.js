// storage.js — localStorage-backed data layer.
// Permits, assessments and checklists live in the browser's localStorage, so
// every page can read them synchronously and the app works offline. While
// signed in they are also copied to the account (js/cloud-sync.js). The lists
// hold one account's records at a time; js/firebase-auth.js (DeviceData) puts
// them aside when someone else signs in on the same device. Use Backup/Restore
// (see settings.html) regularly since clearing browser data will erase records
// that have not reached the account.

const DB = {
  KEYS: {
    assessments: 'cla_assessments',
    permits: 'cla_permits',
    counter: 'cla_permit_counter',
    checklists: 'cla_checklists'
  },
  // Which account's records are the ones above, and the marker set while
  // another account's records are being put aside. Kept in step with
  // DeviceData in js/firebase-auth.js.
  DEVICE_KEYS: { owner: 'cla_data_uid', swap: 'cla_data_swap' },

  // True for the few milliseconds after a sign-in while the previous
  // account's records are moved out: they must not be shown or written over.
  _swapping() {
    try { return !!localStorage.getItem(this.DEVICE_KEYS.swap); } catch (e) { return false; }
  },

  _get(key) {
    if (this._swapping()) return [];
    try {
      const raw = localStorage.getItem(key);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (e) {
      console.error('Storage read failed for', key, e);
      return [];
    }
  },

  // Tells the user (and returns true) when a save has to wait for that.
  _blockedBySwap() {
    if (!this._swapping()) return false;
    alert('Your records are still being set up on this device. Wait a moment, then save again.');
    return true;
  },

  _set(key, value) {
    if (this._blockedBySwap()) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage write failed for', key, e);
      alert('Could not save: browser storage may be full or disabled.');
      return false;
    }
  },

  // Records in the list, without tombstones of deleted ones.
  _list(key) {
    return this._get(key).filter(r => r && typeof r === 'object' && r.deleted !== true);
  },

  // Every save carries the time it was made (newer wins when devices sync)
  // and stays pending until the account has it (js/cloud-sync.js). The time
  // never goes backwards for a record, even if this device's clock is behind.
  _stamp(record, previous) {
    const prev = Math.max(Number(record.updatedAt) || 0, Number(previous && previous.updatedAt) || 0);
    record.updatedAt = Math.max(Date.now(), prev + 1);
    record._pending = true;
    return record;
  },

  // Hooks into js/cloud-sync.js. No-ops unless Firebase has been configured
  // (see js/firebase-config.js) and the user is signed in. Wrapped defensively
  // so a missing/unloaded CloudSync never breaks a plain local save; a record
  // that could not be sent stays pending and is sent later.
  _cloudPush(collectionName, record) {
    try {
      if (typeof CloudSync !== 'undefined') CloudSync.push(collectionName, record);
    } catch (e) { console.error('Cloud sync push skipped', e); }
  },
  _cloudRemove(collectionName, id, at) {
    try {
      if (typeof CloudSync !== 'undefined') CloudSync.remove(collectionName, id, at);
    } catch (e) { console.error('Cloud sync remove skipped', e); }
  },
  // Waits (at most `ms`) for records being sent to the account, so a page can
  // navigate away right after saving.
  flush(ms = 4000) {
    try {
      if (typeof CloudSync !== 'undefined' && CloudSync.flush) return CloudSync.flush(ms);
    } catch (e) { /* nothing to wait for */ }
    return Promise.resolve(true);
  },

  // Saves (inserts or replaces by id) and returns the record, or null if it
  // could not be stored on this device.
  _save(name, prefix, record) {
    const key = this.KEYS[name];
    const list = this._list(key);
    record.id = record.id || (prefix + '-' + Date.now());
    const idx = list.findIndex(r => r.id === record.id);
    this._stamp(record, idx >= 0 ? list[idx] : null);
    if (idx >= 0) list[idx] = record; else list.push(record);
    if (!this._set(key, list)) return null;
    this._cloudPush(name, record);
    return record;
  },
  _delete(name, id) {
    const key = this.KEYS[name];
    const all = this._list(key);
    const gone = all.find(r => r.id === id);
    if (!this._set(key, all.filter(r => r.id !== id))) return;
    const at = Math.max(Date.now(), (Number(gone && gone.updatedAt) || 0) + 1);
    this._cloudRemove(name, id, at);
  },

  // ---- Assessments ----
  getAssessments() {
    return this._list(this.KEYS.assessments);
  },
  saveAssessment(assessment) {
    return this._save('assessments', 'A', assessment);
  },
  deleteAssessment(id) {
    this._delete('assessments', id);
  },

  // ---- Permits ----
  // Permits saved before other permit types existed have no permitType; they
  // are lifting permits, so they read back as such.
  getPermits() {
    return this._list(this.KEYS.permits).map(p => !p.permitType ? Object.assign({}, p, { permitType: 'lifting' }) : p);
  },
  savePermit(permit) {
    permit.permitType = permit.permitType || 'lifting';
    return this._save('permits', 'P', permit);
  },
  deletePermit(id) {
    this._delete('permits', id);
  },

  // The signed-in account whose records are on this device, if known.
  _ownerUid() {
    try {
      const uid = localStorage.getItem(this.DEVICE_KEYS.owner);
      if (uid) return uid;
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && firebase.auth().currentUser) {
        return firebase.auth().currentUser.uid;
      }
    } catch (e) { /* not signed in */ }
    return null;
  },

  // Each permit type has its own prefix and counter (lifting keeps the
  // original LP counter), and the number carries the issuer's code (see
  // PermitTypes.nextNumber). The next number also accounts for permits
  // already on file, so a wiped or new device never reissues a number.
  nextPermitNumber(type = 'lifting') {
    if (this._swapping()) return '';
    const t = typeof PermitTypes !== 'undefined' ? PermitTypes.byKey(type) : null;
    const prefix = t ? t.prefix : 'LP';
    const key = type === 'lifting' ? this.KEYS.counter : `${this.KEYS.counter}_${type}`;
    const counter = parseInt(localStorage.getItem(key) || '0', 10) || 0;
    const year = new Date().getFullYear();
    const numbers = this.getPermits().map(p => p.permitNumber);
    let next;
    if (typeof PermitTypes !== 'undefined') {
      next = PermitTypes.nextNumber(prefix, year, counter, numbers, PermitTypes.issuerCode(this._ownerUid()));
    } else {
      next = { seq: counter + 1, number: `${prefix}-${year}-${String(counter + 1).padStart(4, '0')}` };
    }
    try { localStorage.setItem(key, String(next.seq)); } catch (e) { console.error('Could not store the permit counter', e); }
    return next.number;
  },

  // ---- Equipment checklists (monthly inspection & maintenance) ----
  getChecklists() {
    return this._list(this.KEYS.checklists);
  },
  saveChecklist(checklist) {
    return this._save('checklists', 'C', checklist);
  },
  deleteChecklist(id) {
    this._delete('checklists', id);
  },

  // ---- Backup / restore ----
  exportAll() {
    const clean = (list) => list.map(r => { const c = Object.assign({}, r); delete c._pending; delete c._restored; return c; });
    return {
      exportedAt: new Date().toISOString(),
      assessments: clean(this.getAssessments()),
      permits: clean(this.getPermits()),
      checklists: clean(this.getChecklists())
    };
  },
  // Adds the records in a backup file to this device and sends them to the
  // account. Returns how many of each were imported.
  //   merge:   records already here (same id) are kept; the rest are added
  //            with their own save times, so a newer copy in the account wins.
  //   replace: the lists on this device become exactly the backup, and the
  //            backup's copies become the newest ones. Records in the account
  //            that are not in the backup are not deleted from it.
  // Either way a restored record that had been deleted comes back (the
  // `_restored` flag lets it win over the account's record of the delete).
  // Backups written before checklists existed simply have no `checklists` key,
  // so a merge of an old backup leaves the checklists on this device alone.
  importAll(data, mode = 'merge') {
    const counts = { assessments: 0, permits: 0, checklists: 0 };
    if (this._blockedBySwap()) return counts;
    const PREFIX = { assessments: 'A', permits: 'P', checklists: 'C' };
    const src = data && typeof data === 'object' ? data : {};
    Object.keys(counts).forEach(name => {
      const key = this.KEYS[name];
      const incoming = (Array.isArray(src[name]) ? src[name] : [])
        .filter(r => r && typeof r === 'object' && !Array.isArray(r) && r.deleted !== true);
      if (mode !== 'replace' && !incoming.length) return;
      const current = this._list(key);
      const previous = new Map(current.map(r => [r.id, r]));
      const list = mode === 'replace' ? [] : current;
      const ids = new Set(list.map(r => r.id));
      const added = [];
      incoming.forEach((r, i) => {
        const rec = JSON.parse(JSON.stringify(r));
        if (!rec.id) rec.id = `${PREFIX[name]}-${Date.now()}-${i}`;
        if (ids.has(rec.id)) return;
        ids.add(rec.id);
        if (mode === 'replace') this._stamp(rec, previous.get(rec.id));
        else rec._pending = true;
        rec._restored = true;
        list.push(rec);
        added.push(rec);
      });
      if (!this._set(key, list)) return;
      counts[name] = added.length;
      try {
        if (typeof CloudSync !== 'undefined' && CloudSync.pushPending) CloudSync.pushPending(name);
      } catch (e) { console.error('Cloud sync push skipped', e); }
    });
    return counts;
  }
};

// ---- Crane engineering calculations ----
const CraneCalc = {
  // Builds a { numericKey: originalStringKey } map so lookups work regardless of how
  // the JSON keys were formatted (e.g. "3" vs "3.0"). Fixes a bug where table[3] (a
  // numeric bracket access, which coerces to the string "3") silently missed a chart
  // entry stored as "3.0", returning undefined instead of the actual capacity.
  _numericKeyMap(table) {
    const map = new Map();
    for (const k of Object.keys(table)) map.set(Number(k), k);
    return map;
  },

  // Finds the exact boom-length entry in a chart, tolerant of the requested value
  // being e.g. 43.5 vs a stored key of "43.50".
  _findBoomKey(chart, boomLength) {
    const map = this._numericKeyMap(chart);
    if (map.has(Number(boomLength))) return map.get(Number(boomLength));
    return null;
  },

  interpolateCapacityKg(table, radius) {
    const keyMap = this._numericKeyMap(table);
    const radii = [...keyMap.keys()].sort((a, b) => a - b);
    if (radii.length === 0) return null;
    if (radius < radii[0]) return null; // below the chart's minimum radius for this boom
    if (radius > radii[radii.length - 1]) return 0; // beyond max radius: no capacity

    let lower = radii[0], upper = radii[radii.length - 1];
    for (let i = 0; i < radii.length; i++) {
      if (radii[i] <= radius) lower = radii[i];
      if (radii[i] >= radius) { upper = radii[i]; break; }
    }
    const lowCap = table[keyMap.get(lower)];
    const upCap = table[keyMap.get(upper)];
    if (lower === upper) return lowCap;
    const frac = (radius - lower) / (upper - lower);
    return lowCap + (upCap - lowCap) * frac;
  },

  // Returns the [min, max] working radius the chart actually covers for a given boom
  // length (exact chart entry only — used to validate input before interpolating).
  radiusRangeForBoom(craneSpec, configName, boomLength) {
    const chart = craneSpec.loadCharts[configName];
    if (!chart) return null;
    const boomKey = this._findBoomKey(chart, boomLength);
    if (!boomKey) return null;
    const radii = Object.keys(chart[boomKey]).map(Number).sort((a, b) => a - b);
    if (radii.length === 0) return null;
    return { min: radii[0], max: radii[radii.length - 1] };
  },

  // Interpolates across boom length too, in case the exact boom length isn't a chart entry.
  maxCapacityTonnes(craneSpec, configName, boomLength, radius) {
    const chart = craneSpec.loadCharts[configName];
    if (!chart) return { capacity: 0, error: `Configuration "${configName}" not found.` };

    const boomKeyMap = this._numericKeyMap(chart);
    const booms = [...boomKeyMap.keys()].sort((a, b) => a - b);
    if (boomKeyMap.has(Number(boomLength))) {
      const table = chart[boomKeyMap.get(Number(boomLength))];
      const kg = this.interpolateCapacityKg(table, radius);
      if (kg === null) {
        const range = this.radiusRangeForBoom(craneSpec, configName, boomLength);
        return { capacity: 0, error: `Radius ${radius} m is below this boom length's minimum working radius${range ? ` of ${range.min} m` : ''}.` };
      }
      return { capacity: kg / 1000, error: null };
    }
    // interpolate between nearest boom lengths
    let lower = booms[0], upper = booms[booms.length - 1];
    for (let i = 0; i < booms.length; i++) {
      if (booms[i] <= boomLength) lower = booms[i];
      if (booms[i] >= boomLength) { upper = booms[i]; break; }
    }
    const lowTable = chart[boomKeyMap.get(lower)];
    const upTable = chart[boomKeyMap.get(upper)];
    const lowKg = this.interpolateCapacityKg(lowTable, radius) || 0;
    const upKg = this.interpolateCapacityKg(upTable, radius) || 0;
    if (lower === upper) return { capacity: lowKg / 1000, error: null };
    const frac = (boomLength - lower) / (upper - lower);
    const kg = lowKg + (upKg - lowKg) * frac;
    return { capacity: kg / 1000, error: null };
  },

  // ---- Jib (angle-indexed) charts ----
  // jibChart shape: { jibLength: { offsetDeg: { boomAngleDeg: capacityKg } } }
  interpolateAngleCapacityKg(table, angle) {
    const keyMap = this._numericKeyMap(table);
    const angles = [...keyMap.keys()].sort((a, b) => a - b);
    if (angles.length === 0) return null;
    if (angle < angles[0] || angle > angles[angles.length - 1]) return null; // outside the printed angle range
    let lower = angles[0], upper = angles[angles.length - 1];
    for (let i = 0; i < angles.length; i++) {
      if (angles[i] <= angle) lower = angles[i];
      if (angles[i] >= angle) { upper = angles[i]; break; }
    }
    const lowCap = table[keyMap.get(lower)];
    const upCap = table[keyMap.get(upper)];
    if (lower === upper) return lowCap;
    const frac = (angle - lower) / (upper - lower);
    return lowCap + (upCap - lowCap) * frac;
  },

  angleRangeForJib(craneSpec, jibConfigName, jibLength, offset) {
    const chart = craneSpec.jibCharts && craneSpec.jibCharts[jibConfigName];
    if (!chart) return null;
    const lenMap = this._numericKeyMap(chart);
    const lenKey = lenMap.get(Number(jibLength));
    if (!lenKey) return null;
    const offMap = this._numericKeyMap(chart[lenKey]);
    const offKey = offMap.get(Number(offset));
    if (!offKey) return null;
    const angles = Object.keys(chart[lenKey][offKey]).map(Number).sort((a, b) => a - b);
    if (angles.length === 0) return null;
    return { min: angles[0], max: angles[angles.length - 1] };
  },

  maxJibCapacityTonnes(craneSpec, jibConfigName, jibLength, offset, angle) {
    const chart = craneSpec.jibCharts && craneSpec.jibCharts[jibConfigName];
    if (!chart) return { capacity: 0, error: `Jib configuration "${jibConfigName}" not found.` };
    const lenMap = this._numericKeyMap(chart);
    const lenKey = lenMap.get(Number(jibLength));
    if (!lenKey) return { capacity: 0, error: `Jib length ${jibLength} m not found for this configuration.` };
    const offMap = this._numericKeyMap(chart[lenKey]);
    const offKey = offMap.get(Number(offset));
    if (!offKey) return { capacity: 0, error: `Jib offset ${offset}° not found for this configuration.` };
    const table = chart[lenKey][offKey];
    const kg = this.interpolateAngleCapacityKg(table, angle);
    if (kg === null) {
      const range = this.angleRangeForJib(craneSpec, jibConfigName, jibLength, offset);
      return { capacity: 0, error: `Boom angle ${angle}° is outside the chart's printed range${range ? ` of ${range.min}°–${range.max}°` : ''}.` };
    }
    return { capacity: kg / 1000, error: null };
  }
};

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
