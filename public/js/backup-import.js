// backup-import.js — checks a backup file before Settings imports it.
//
// A personal backup is the file "Export backup" on the Settings page saves:
// { exportedAt, assessments: [...], permits: [...], checklists: [...] }.
// Older backups have no checklists. Anything else (a project backup, some
// other JSON) is refused before it can touch the records on this device.
// No DOM here, so it is unit-tested (test/access.test.mjs).

(function (root) {
  'use strict';

  const LISTS = ['assessments', 'permits', 'checklists'];

  // Returns { ok: true, counts } or { ok: false, error } with a message for
  // the person importing.
  function check(data) {
    const notBackup = 'This file is not a Duck HSE Portal backup. Choose a file saved with "Export backup" on this page.';
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: notBackup };
    if (data.format === 'duck-hse-project-backup') {
      return { ok: false, error: 'This is a project backup, not a backup of your own records. Project backups are restored ' +
        'from the project\'s page, under Backups (Restore items).' };
    }
    if (!LISTS.some((k) => Array.isArray(data[k]))) return { ok: false, error: notBackup };
    const damaged = LISTS.some((k) => data[k] != null && (!Array.isArray(data[k])
      || data[k].some((r) => !r || typeof r !== 'object' || Array.isArray(r))));
    if (damaged) return { ok: false, error: 'This backup file is damaged, so nothing was imported.' };
    return { ok: true, counts: countsOf(data) };
  }

  function countsOf(data) {
    const n = (k) => (data && Array.isArray(data[k]) ? data[k].length : 0);
    return { assessments: n('assessments'), permits: n('permits'), checklists: n('checklists') };
  }

  // The counts DB.importAll returned, or the file's own counts where it
  // returned none.
  function resultCounts(result, data) {
    const fromFile = countsOf(data);
    const out = {};
    LISTS.forEach((k) => {
      const v = result && typeof result === 'object' ? Number(result[k]) : NaN;
      out[k] = Number.isFinite(v) && v >= 0 ? v : fromFile[k];
    });
    return out;
  }

  // "3 inspection checklists, 1 permit and 0 lift assessments"
  function describe(counts) {
    const c = counts || {};
    const part = (n, one, many) => `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;
    return `${part(c.checklists, 'inspection checklist', 'inspection checklists')}, ` +
      `${part(c.permits, 'permit', 'permits')} and ${part(c.assessments, 'lift assessment', 'lift assessments')}`;
  }

  const api = { check, countsOf, resultCounts, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BackupImport = api;
})(typeof self !== 'undefined' ? self : this);
