// certificate-report.js — certificate row rendering, standalone HTML report,
// and share/download. Language-aware: every user-facing label goes through T(),
// which uses I18n when it is loaded (all checklist pages load it) and falls back
// to English otherwise, so this file also works if dropped in standalone.
const CertificateReport = (function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Localised string with an English fallback and {token} interpolation.
  function T(key, fallback, vars) {
    let s = (typeof I18n !== 'undefined' && I18n.t) ? I18n.t(key) : null;
    if (!s || s === key) s = fallback;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  // Category values are stored in English ('Equipment'/'Personnel'/'Accessory')
  // so a record stays readable regardless of the language it was saved in; the
  // label shown is translated at render time.
  function catLabel(cat) {
    const map = { Equipment: 'cat.equipment', Personnel: 'cat.personnel', Accessory: 'cat.accessory' };
    return map[cat] ? T(map[cat], cat) : (cat || '—');
  }

  function certStatus(expiry) {
    if (!expiry) return { key: 'missing', label: T('exp.missing', 'No expiry recorded') };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(expiry + 'T00:00:00');
    if (d < today) return { key: 'expired', label: T('exp.expired', 'Expired') };
    const days = Math.ceil((d - today) / 86400000);
    if (days <= 30) return { key: 'expiring', label: T('exp.expiring', 'Expiring in ' + days + ' day(s)', { n: days }) };
    return { key: 'valid', label: T('exp.valid', 'Valid') };
  }

  function statusBadge(c) {
    const s = c.statusKey ? { key: c.statusKey, label: c.statusLabel } : certStatus(c.expiryDate);
    const cls = s.key === 'valid' ? 'badge-ok' : s.key === 'expiring' ? 'badge-warn' : 'badge-fail';
    return `<span class="badge ${cls}"><span class="badge-dot"></span>${esc(s.label)}</span>`;
  }

  function computeSummary(certs) {
    const out = { total: certs.length, valid: 0, expiring: 0, expired: 0, missing: 0 };
    certs.forEach(c => {
      const s = certStatus(c.expiryDate);
      out[s.key] = (out[s.key] || 0) + 1;
    });
    return out;
  }

  async function loadPhotoMap(certs) {
    const map = {};
    for (const cert of (certs || [])) {
      for (const photo of (cert.photos || [])) {
        if (!photo || !photo.id) continue;
        if (photo.dataUrl) { map[photo.id] = photo.dataUrl; continue; }
        try {
          const rec = await CertificateStore.getPhoto(photo.id);
          if (rec && rec.blob) map[photo.id] = await CertificateStore.fileToDataUrl(rec.blob);
        } catch (e) { console.warn('Certificate photo unavailable', photo.id, e); }
      }
    }
    return map;
  }

  // Shared meta-row markup so the editable list, the on-screen report and the
  // standalone HTML report all read identically.
  function metaHtml(c) {
    return `<span><b>${esc(T('cert.lCategory', 'Category'))}:</b> ${esc(catLabel(c.category))}</span>
      <span><b>${esc(T('cert.lHolder', 'Holder / Item'))}:</b> ${esc(c.holder || '—')}</span>
      <span><b>${esc(T('cert.lNumber', 'Certificate No.'))}:</b> ${esc(c.number || '—')}</span>
      <span><b>${esc(T('cert.lIssuer', 'Issuer'))}:</b> ${esc(c.issuer || '—')}</span>
      <span><b>${esc(T('cert.lIssue', 'Issue'))}:</b> ${esc(c.issueDate || '—')}</span>
      <span><b>${esc(T('cert.lExpiry', 'Expiry'))}:</b> ${esc(c.expiryDate || '—')}</span>
      ${c.wll ? `<span><b>WLL/SWL:</b> ${esc(c.wll)}</span>` : ''}`;
  }

  function buildRows(certs, photos, opts) {
    opts = opts || {};
    if (!certs.length) return `<div class="card empty-state"><div class="icon">📎</div>${esc(T('cert.none', 'No third-party certificates have been added.'))}</div>`;
    const fallbackTitle = T('cert.titleFallback', 'Certificate');
    return certs.map((c) => {
      const imgs = (c.photos || []).map(p => photos && photos[p.id] ? `<img class="cert-photo" src="${photos[p.id]}" alt="${esc(c.title || fallbackTitle)}">` : '').join('');
      return `<div class="certificate-row" data-cert-id="${esc(c.id)}">
        <div class="certificate-main">
          <div class="certificate-title"><strong>${esc(c.title || fallbackTitle)}</strong>${statusBadge(c)}</div>
          <div class="certificate-meta">${metaHtml(c)}</div>
          ${c.notes ? `<div class="certificate-notes">${esc(c.notes)}</div>` : ''}
          ${imgs ? `<div class="certificate-gallery">${imgs}</div>` : ''}
        </div>
        ${opts.editable ? `<div class="certificate-actions no-print">
          <button class="btn btn-sm" type="button" data-edit-cert="${esc(c.id)}">${esc(T('cert.edit', 'Edit'))}</button>
          <button class="btn btn-sm btn-danger" type="button" data-delete-cert="${esc(c.id)}">${esc(T('cert.deleteBtn', 'Delete'))}</button>
        </div>` : ''}
      </div>`;
    }).join('');
  }

  async function render(root, certs, opts) {
    const photos = await loadPhotoMap(certs || []);
    root.innerHTML = buildRows(certs || [], photos, opts);
    return photos;
  }

  async function reportPhotoMap(record) {
    return loadPhotoMap(record && record.certificates ? record.certificates : []);
  }

  function buildHtml(record, photos) {
    const certs = record.certificates || [];
    const s = computeSummary(certs);
    const fallbackTitle = T('cert.titleFallback', 'Certificate');
    const dir = (typeof I18n !== 'undefined' && I18n.isRtl && I18n.isRtl()) ? 'rtl' : 'ltr';
    const lang = (typeof I18n !== 'undefined' && I18n.get) ? I18n.get() : 'en';
    const photoBlocks = certs.map(c => {
      const imgs = (c.photos || []).map(p => photos[p.id] ? `<div class="photo"><img src="${photos[p.id]}" alt="${esc(c.title || fallbackTitle)}"></div>` : '').join('');
      return `<section class="cert"><h2>${esc(c.title || fallbackTitle)} <small>${esc(certStatus(c.expiryDate).label)}</small></h2>
        <p><b>${esc(T('cert.lCategory', 'Category'))}:</b> ${esc(catLabel(c.category))} &nbsp; <b>${esc(T('cert.lHolder', 'Holder / Item'))}:</b> ${esc(c.holder || '—')}</p>
        <p><b>${esc(T('cert.lNumber', 'Certificate No.'))}:</b> ${esc(c.number || '—')} &nbsp; <b>${esc(T('cert.lIssuer', 'Issuer'))}:</b> ${esc(c.issuer || '—')}</p>
        <p><b>${esc(T('cert.lIssue', 'Issue'))}:</b> ${esc(c.issueDate || '—')} &nbsp; <b>${esc(T('cert.lExpiry', 'Expiry'))}:</b> ${esc(c.expiryDate || '—')}</p>
        ${c.wll ? `<p><b>WLL/SWL:</b> ${esc(c.wll)}</p>` : ''}
        ${c.notes ? `<p><b>${esc(T('cert.lNotes', 'Notes'))}:</b> ${esc(c.notes)}</p>` : ''}
        ${imgs ? `<div class="photos">${imgs}</div>` : ''}
      </section>`;
    }).join('');
    return `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(T('cert.shareTitle', 'Third-Party Certificate Report'))} - ${esc(record.assetNo || record.equipmentType || 'Equipment')}</title>
<style>body{font-family:'Segoe UI','Noto Sans Arabic','Noto Sans Devanagari',Arial,sans-serif;margin:28px;color:#16232c}h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #ddd;padding-bottom:6px}small{font-size:12px}table{border-collapse:collapse;width:100%;margin:14px 0}td{border:1px solid #ddd;padding:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.photos{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.photo{width:360px}.photo img{width:100%;height:auto;border:1px solid #ccc}.ok{color:#1f7a4d}.warn{color:#b9791f}.bad{color:#b23b3b}@media print{.cert{break-inside:avoid}.photo{max-width:48%}}</style></head><body>
<h1>${esc(T('cert.shareTitle', 'Third-Party Certificate Report'))}</h1><div class="grid"><div><b>${esc(T('f.equipmentType', 'Equipment'))}:</b> ${esc(record.equipmentType || '—')}</div><div><b>${esc(T('f.assetNo', 'Asset No.'))}:</b> ${esc(record.assetNo || '—')}</div><div><b>${esc(T('f.make', 'Make'))}/${esc(T('f.model', 'Model'))}:</b> ${esc([record.make, record.model].filter(Boolean).join(' ') || '—')}</div><div><b>${esc(T('f.serial', 'Serial'))}:</b> ${esc(record.serial || '—')}</div><div><b>${esc(T('f.project', 'Project'))}:</b> ${esc(record.project || '—')}</div><div><b>${esc(T('f.location', 'Location'))}:</b> ${esc(record.location || '—')}</div></div>
<table><tr><td><b>${esc(T('cert.countWord', 'certificates'))}</b></td><td>${s.total}</td><td><b>${esc(T('cert.headValid', 'Valid'))}</b></td><td class="ok">${s.valid}</td></tr><tr><td><b>${esc(T('cert.headExpiring', 'Expiring ≤30 days'))}</b></td><td class="warn">${s.expiring}</td><td><b>${esc(T('cert.headExpired', 'Expired'))}</b></td><td class="bad">${s.expired}</td></tr></table>${photoBlocks || '<p>' + esc(T('cert.reportEmpty', 'No certificates attached.')) + '</p>'}
<p style="font-size:11px;color:#667">${esc(T('cert.recordTitle', 'Third-party certificate record'))} — Duck HSE Portal. ${esc(T('disc.title', 'This checklist does not replace statutory inspection.'))}</p></body></html>`;
  }

  async function share(record) {
    const photos = await reportPhotoMap(record);
    const html = buildHtml(record, photos);
    const filename = `certificate-report-${(record.assetNo || 'equipment').replace(/[^A-Za-z0-9_-]+/g, '-')}.html`;
    const file = new File([html], filename, { type: 'text/html' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({
          title: T('cert.shareTitle', 'Third-Party Certificate Report'),
          text: T('cert.shareText', 'Certificate report for ' + (record.assetNo || record.equipmentType || 'equipment'), { asset: record.assetNo || record.equipmentType || 'equipment' }),
          files: [file]
        });
        return { shared: true };
      } catch (e) {
        if (e && e.name === 'AbortError') return { cancelled: true };
      }
    }
    downloadHtml(html, filename);
    return { downloaded: true };
  }

  function downloadHtml(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'certificate-report.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { certStatus, catLabel, statusBadge, computeSummary, loadPhotoMap, render, buildHtml, share, downloadHtml };
})();
