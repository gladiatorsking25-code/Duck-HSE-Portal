// storage.js — localStorage-backed data layer.
// Everything lives in the browser's localStorage under one namespace, so the
// app works offline on GitHub Pages with no server. Use Backup/Restore
// (see settings.html) regularly since clearing browser data will erase records.

const DB = {
  KEYS: {
    assessments: 'cla_assessments',
    permits: 'cla_permits',
    counter: 'cla_permit_counter',
    checklists: 'cla_checklists'
  },

  _get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Storage read failed for', key, e);
      return [];
    }
  },

  _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage write failed for', key, e);
      alert('Could not save: browser storage may be full or disabled.');
      return false;
    }
  },

  // Fire-and-forget hooks into js/cloud-sync.js. Both are no-ops unless
  // Firebase has been configured (see js/firebase-config.js) and the user is
  // signed in with a real (Firebase) account — the app behaves exactly as it
  // did before cloud sync existed until then. Wrapped defensively so a
  // missing/unloaded CloudSync never breaks a plain local save.
  _cloudPush(collectionName, record) {
    try {
      if (typeof CloudSync !== 'undefined') CloudSync.push(collectionName, record);
    } catch (e) { console.error('Cloud sync push skipped', e); }
  },
  _cloudRemove(collectionName, id) {
    try {
      if (typeof CloudSync !== 'undefined') CloudSync.remove(collectionName, id);
    } catch (e) { console.error('Cloud sync remove skipped', e); }
  },

  // ---- Assessments ----
  getAssessments() {
    return this._get(this.KEYS.assessments);
  },
  saveAssessment(assessment) {
    const list = this.getAssessments();
    assessment.id = assessment.id || ('A-' + Date.now());
    list.push(assessment);
    this._set(this.KEYS.assessments, list);
    this._cloudPush('assessments', assessment);
    return assessment;
  },
  deleteAssessment(id) {
    const list = this.getAssessments().filter(a => a.id !== id);
    this._set(this.KEYS.assessments, list);
    this._cloudRemove('assessments', id);
  },

  // ---- Permits ----
  // Permits saved before other permit types existed have no permitType; they
  // are lifting permits, so they read back as such.
  getPermits() {
    return this._get(this.KEYS.permits).map(p => (p && !p.permitType) ? Object.assign({}, p, { permitType: 'lifting' }) : p);
  },
  savePermit(permit) {
    permit.permitType = permit.permitType || 'lifting';
    const list = this.getPermits();
    const idx = list.findIndex(p => p.id === permit.id);
    if (idx >= 0) {
      list[idx] = permit;
    } else {
      permit.id = permit.id || ('P-' + Date.now());
      list.push(permit);
    }
    this._set(this.KEYS.permits, list);
    this._cloudPush('permits', permit);
    return permit;
  },
  deletePermit(id) {
    const list = this.getPermits().filter(p => p.id !== id);
    this._set(this.KEYS.permits, list);
    this._cloudRemove('permits', id);
  },
  // Each permit type has its own prefix and counter (lifting keeps the
  // original LP counter). The next number also accounts for permits already
  // on file, so a wiped or new device never reissues a number.
  nextPermitNumber(type = 'lifting') {
    const t = typeof PermitTypes !== 'undefined' ? PermitTypes.byKey(type) : null;
    const prefix = t ? t.prefix : 'LP';
    const key = type === 'lifting' ? this.KEYS.counter : `${this.KEYS.counter}_${type}`;
    const counter = parseInt(localStorage.getItem(key) || '0', 10) || 0;
    const year = new Date().getFullYear();
    const numbers = this.getPermits().map(p => p.permitNumber);
    let next;
    if (typeof PermitTypes !== 'undefined') next = PermitTypes.nextNumber(prefix, year, counter, numbers);
    else next = { seq: counter + 1, number: `${prefix}-${year}-${String(counter + 1).padStart(4, '0')}` };
    localStorage.setItem(key, String(next.seq));
    return next.number;
  },

  // ---- Equipment checklists (monthly inspection & maintenance) ----
  getChecklists() {
    return this._get(this.KEYS.checklists);
  },
  saveChecklist(checklist) {
    const list = this.getChecklists();
    const idx = checklist.id ? list.findIndex(c => c.id === checklist.id) : -1;
    if (idx >= 0) {
      list[idx] = checklist;
    } else {
      checklist.id = checklist.id || ('C-' + Date.now());
      list.push(checklist);
    }
    this._set(this.KEYS.checklists, list);
    this._cloudPush('checklists', checklist);
    return checklist;
  },
  deleteChecklist(id) {
    const list = this.getChecklists().filter(c => c.id !== id);
    this._set(this.KEYS.checklists, list);
    this._cloudRemove('checklists', id);
  },

  // ---- Backup / restore ----
  exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      assessments: this.getAssessments(),
      permits: this.getPermits(),
      checklists: this.getChecklists()
    };
  },
  // Backups written before checklists existed simply have no `checklists` key —
  // `|| []` keeps those files importable, and a merge of an old backup leaves
  // any checklists already on this device alone.
  importAll(data, mode = 'merge') {
    if (mode === 'replace') {
      this._set(this.KEYS.assessments, data.assessments || []);
      this._set(this.KEYS.permits, data.permits || []);
      this._set(this.KEYS.checklists, data.checklists || []);
      return;
    }
    const existingA = this.getAssessments();
    const existingP = this.getPermits();
    const existingC = this.getChecklists();
    const idsA = new Set(existingA.map(a => a.id));
    const idsP = new Set(existingP.map(p => p.id));
    const idsC = new Set(existingC.map(c => c.id));
    (data.assessments || []).forEach(a => { if (!idsA.has(a.id)) existingA.push(a); });
    (data.permits || []).forEach(p => { if (!idsP.has(p.id)) existingP.push(p); });
    (data.checklists || []).forEach(c => { if (!idsC.has(c.id)) existingC.push(c); });
    this._set(this.KEYS.assessments, existingA);
    this._set(this.KEYS.permits, existingP);
    this._set(this.KEYS.checklists, existingC);
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
