// audit-pack.js — compiles an audit into an evidence pack (.zip), reads one
// back, and computes readiness.
//
// Pack layout — flat on purpose, because Windows still limits extracted paths
// to 260 characters and a section/item/file nesting runs out fast:
//
//   O-16123 HSE Audit Contractor 2026-09-21/
//     00 Index.html        every S/No., status, and a link to each file — opens offline
//     00 Checklist.csv     the same checklist for Excel
//     manifest.json        machine-readable copy, so the pack can be re-opened in the app
//     04.03 Activity risk assessments …/
//       RA-Excavation.pdf
//       Link - DMS record.url
//
// The two-digit padding (04.03, not 4.3) makes every file manager list the
// folders in S/No. order.

(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const STATUS = {
    pending: { label: 'Not started', short: 'Pending' },
    partial: { label: 'Partly evidenced', short: 'Partial' },
    ready: { label: 'Evidence ready', short: 'Ready' },
    gap: { label: 'Cannot evidence — expected finding', short: 'Gap' },
    na: { label: 'Not applicable', short: 'N/A' }
  };

  function pad(no) {
    return String(no).split('.').map((p) => (p.length < 2 ? '0' + p : p)).join('.');
  }

  function isoDate(d) {
    const x = d ? new Date(d) : new Date();
    return isNaN(x) ? new Date().toISOString().slice(0, 10) : x.toISOString().slice(0, 10);
  }

  function packName(audit) {
    const role = audit.role === 'consultant' ? 'Consultant' : 'Contractor';
    return ZipWriter.safeName((audit.projectNo || 'Project') + ' HSE Audit ' + role + ' ' + isoDate(audit.auditDate || Date.now()), 90, true);
  }

  // ASCII-only: these names come from checklist wording, which uses em dashes.
  function itemFolder(it) {
    return ZipWriter.safeName(pad(it.no) + ' ' + it.text, 64, true);
  }

  // ------------------------------------------------------------ readiness ---

  function stats(audit) {
    const s = { total: 0, applicable: 0, ready: 0, partial: 0, pending: 0, gap: 0, na: 0,
      files: 0, links: 0, bytes: 0, potentialMajor: 0, potentialMinor: 0, potentialEither: 0 };
    (audit.sections || []).forEach((sec) => sec.items.forEach((it) => {
      s.total++;
      s[it.status] = (s[it.status] || 0) + 1;
      s.files += (it.files || []).length;
      s.links += (it.links || []).length;
      (it.files || []).forEach((f) => { s.bytes += f.size || 0; });
      if (it.status === 'na') return;
      s.applicable++;
      // Anything not fully evidenced is exposure on the day. Classified by the
      // NC level TG 15 suggests if the evidence cannot be shown.
      if (it.status !== 'ready') {
        if (it.nc === 'Major') s.potentialMajor++;
        else if (it.nc === 'Minor') s.potentialMinor++;
        else if (it.nc) s.potentialEither++;
      }
    }));
    s.readiness = s.applicable ? Math.round(((s.ready + 0.5 * s.partial) / s.applicable) * 100) : 0;
    return s;
  }

  function sectionStats(sec) {
    const s = { applicable: 0, ready: 0, partial: 0 };
    sec.items.forEach((it) => {
      if (it.status === 'na') return;
      s.applicable++;
      if (it.status === 'ready') s.ready++;
      if (it.status === 'partial') s.partial++;
    });
    s.readiness = s.applicable ? Math.round(((s.ready + 0.5 * s.partial) / s.applicable) * 100) : 100;
    return s;
  }

  // --------------------------------------------------------------- build ----

  async function build(audit, opts) {
    const o = opts || {};
    const root = packName(audit);
    const entries = [];
    const fileMap = []; // [{ itemId, fileId, path }] — written into the manifest

    // Evidence files first, in S/No. order.
    for (const sec of audit.sections) {
      for (const it of sec.items) {
        const folder = itemFolder(it);
        const used = new Set();
        for (const meta of (it.files || [])) {
          const rec = await AuditStore.getFile(meta.id);
          if (!rec || !rec.blob) continue;
          let name = ZipWriter.safeName(meta.name, 100);
          if (used.has(name.toLowerCase())) {
            const dot = name.lastIndexOf('.');
            let n = 2;
            while (used.has((dot > 0 ? name.slice(0, dot) + ' (' + n + ')' + name.slice(dot) : name + ' (' + n + ')').toLowerCase())) n++;
            name = dot > 0 ? name.slice(0, dot) + ' (' + n + ')' + name.slice(dot) : name + ' (' + n + ')';
          }
          used.add(name.toLowerCase());
          const path = root + '/' + folder + '/' + name;
          entries.push({ path: path, data: rec.blob, date: new Date(meta.addedAt || Date.now()) });
          fileMap.push({ itemId: it.id, fileId: meta.id, path: folder + '/' + name });
        }
        (it.links || []).forEach((l, i) => {
          const base = ZipWriter.safeName('Link - ' + (l.label || 'reference ' + (i + 1)), 70);
          // Windows internet shortcut — double-click opens the link.
          entries.push({ path: root + '/' + folder + '/' + base + '.url', data: '[InternetShortcut]\r\nURL=' + l.url + '\r\n' });
        });
      }
    }

    const st = stats(audit);
    entries.unshift(
      { path: root + '/00 Index.html', data: indexHtml(audit, st, fileMap) },
      { path: root + '/00 Checklist.csv', data: csv(audit, fileMap) },
      { path: root + '/manifest.json', data: JSON.stringify(manifest(audit, fileMap), null, 1) }
    );

    const blob = await ZipWriter.build(entries, { onProgress: o.onProgress });
    return { blob: blob, fileName: root + '.zip', rootFolder: root, stats: st, entries: entries.length };
  }

  function manifest(audit, fileMap) {
    const copy = JSON.parse(JSON.stringify(audit));
    delete copy.drive; // Drive folder ids are this device's business, not the pack's
    return {
      format: 'duck-hse-audit-pack',
      version: 1,
      generated: new Date().toISOString(),
      app: typeof APP_BUILD_LABEL !== 'undefined' ? APP_BUILD_LABEL : '',
      sources: (typeof AuditChecklists !== 'undefined') ? AuditChecklists.SOURCES : [],
      audit: copy,
      files: fileMap
    };
  }

  function csv(audit, fileMap) {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['S/No.', 'Section', 'Requirement', 'Reference', 'NC if not evidenced', 'Status', 'Evidence files', 'Links', 'Notes', 'Expected evidence']];
    audit.sections.forEach((sec) => sec.items.forEach((it) => {
      const files = fileMap.filter((f) => f.itemId === it.id).map((f) => f.path.split('/').pop());
      rows.push([it.no, sec.title, it.text, it.ref, it.nc || '', STATUS[it.status] ? STATUS[it.status].short : it.status,
        files.join('; '), (it.links || []).map((l) => l.url).join('; '), it.note || '', (it.evidence || []).join('; ')]);
    }));
    // BOM so Excel opens the UTF-8 correctly.
    return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  function indexHtml(audit, st, fileMap) {
    const roleLabel = audit.role === 'consultant' ? 'Consultant' : 'Contractor';
    const href = (p) => p.split('/').map(encodeURIComponent).join('/');
    const statusCls = { ready: 'ok', partial: 'warn', pending: 'muted', gap: 'bad', na: 'muted' };

    const sections = audit.sections.map((sec) => {
      const ss = sectionStats(sec);
      return `<h2><span class="no">${esc(sec.no)}</span> ${esc(sec.title)} <span class="pct">${ss.readiness}% ready</span></h2>
        <p class="ref">${esc(sec.ref)}</p>
        <table><thead><tr><th>S/No.</th><th>Requirement</th><th>Status</th><th>NC if missing</th><th>Evidence</th></tr></thead><tbody>
        ${sec.items.map((it) => {
          const files = fileMap.filter((f) => f.itemId === it.id);
          const ev = files.map((f) => `<a href="${href(f.path)}">${esc(f.path.split('/').pop())}</a>`)
            .concat((it.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${esc(l.label || l.url)}</a>`));
          return `<tr>
            <td class="sno">${esc(it.no)}</td>
            <td>${esc(it.text)}<div class="ref">${esc(it.ref)}</div>${it.note ? `<div class="note">Note: ${esc(it.note)}</div>` : ''}</td>
            <td><span class="st ${statusCls[it.status] || 'muted'}">${esc(STATUS[it.status] ? STATUS[it.status].short : it.status)}</span></td>
            <td>${esc(it.nc || '—')}</td>
            <td class="ev">${ev.length ? ev.join('<br>') : '<span class="none">No evidence attached</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody></table>`;
    }).join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(audit.projectNo)} — HSE audit evidence pack (${roleLabel})</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16232c; background: #fff; margin: 0; padding: 28px; max-width: 1100px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 2px; padding-top: 14px; border-top: 1px solid #d7dee3; }
  h2 .no { display: inline-block; min-width: 26px; color: #b9791f; }
  h2 .pct { float: right; font-size: 12px; font-weight: 600; color: #52626d; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px 20px; margin: 14px 0 18px; font-size: 13px; }
  .meta b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #52626d; }
  .sum { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .sum div { border: 1px solid #d7dee3; border-radius: 4px; padding: 8px 14px; min-width: 110px; }
  .sum b { display: block; font-size: 22px; }
  .sum span { font-size: 11.5px; color: #52626d; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #52626d; background: #eef1f4; padding: 7px 9px; }
  td { padding: 8px 9px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
  td.sno { font-family: ui-monospace, Consolas, monospace; white-space: nowrap; font-weight: 600; }
  .ref { font-size: 11.5px; color: #52626d; margin-top: 2px; }
  .note { font-size: 12px; color: #7a5308; margin-top: 3px; }
  .ev a { color: #1c5cab; word-break: break-word; }
  .none { color: #8a9398; font-style: italic; }
  .st { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .st.ok { background: #e5f4ec; color: #1f7a4d; } .st.warn { background: #fff4e0; color: #7a5308; }
  .st.bad { background: #fbe9e7; color: #b23b3b; } .st.muted { background: #eef1f4; color: #52626d; }
  .src { margin-top: 30px; font-size: 11.5px; color: #52626d; border-top: 1px solid #d7dee3; padding-top: 12px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
<h1>HSE audit evidence pack — ${esc(audit.projectNo)}</h1>
<div>${esc(audit.projectTitle || '')}</div>
<div class="meta">
  <div><b>Prepared as</b>${esc(roleLabel)}${audit.company ? ' — ' + esc(audit.company) : ''}</div>
  <div><b>Client</b>${esc(audit.client || 'TAQA Water Solutions')}</div>
  <div><b>Audit type</b>${esc(audit.auditType || '')}</div>
  <div><b>Audit date</b>${esc(audit.auditDate || '—')}</div>
  <div><b>Auditor(s)</b>${esc(audit.auditors || '—')}</div>
  <div><b>Prepared by</b>${esc(audit.preparedBy || '—')}</div>
  <div><b>Pack compiled</b>${esc(new Date().toLocaleString())}</div>
</div>
<div class="sum">
  <div><b>${st.readiness}%</b><span>ready</span></div>
  <div><b>${st.ready}/${st.applicable}</b><span>points evidenced</span></div>
  <div><b>${st.files}</b><span>files</span></div>
  <div><b>${st.potentialMajor}</b><span>open points rated Major if missing</span></div>
  <div><b>${st.potentialMinor + st.potentialEither}</b><span>open points rated Minor or Minor / Major</span></div>
</div>
${sections}
<div class="src">NC levels are the suggested classifications in ADOSH-SF Technical Guideline 15 (v4.0, July 2024) if the evidence cannot be shown; the auditor's judgement on the day decides the actual level.
Checklist sources: ${esc(((typeof AuditChecklists !== 'undefined') ? AuditChecklists.SOURCES : []).join(' · '))}.</div>
</body></html>`;
  }

  // ------------------------------------------------------------ re-open ----

  // Reads a pack back. Returns the audit plus a way to fetch each file's bytes
  // straight out of the zip, so the viewer can browse a pack without importing.
  async function read(file) {
    if (typeof XLSXReader === 'undefined' || !XLSXReader.unzip) throw new Error('Zip reader not loaded.');
    const zip = await XLSXReader.unzip(await file.arrayBuffer());
    const names = Object.keys(zip.files);
    const mName = names.find((n) => /(^|\/)manifest\.json$/i.test(n));
    if (!mName) throw new Error('This .zip has no manifest.json, so it was not made by this tool. Open it with your normal zip program.');
    let m;
    try { m = JSON.parse(zip.text(mName)); } catch (e) { throw new Error('The pack\'s manifest.json is damaged.'); }
    if (!m || m.format !== 'duck-hse-audit-pack' || !m.audit) throw new Error('This .zip was not made by the HSE audit tool.');
    const rootPrefix = mName.slice(0, mName.length - 'manifest.json'.length);

    const bytesFor = (relPath) => {
      const u8 = zip.files[rootPrefix + relPath];
      return u8 ? new Blob([u8]) : null;
    };
    return { manifest: m, audit: m.audit, files: m.files || [], bytesFor: bytesFor, names: names };
  }

  global.AuditPack = {
    STATUS: STATUS, pad: pad, stats: stats, sectionStats: sectionStats,
    build: build, read: read, packName: packName, itemFolder: itemFolder
  };
})(window);
