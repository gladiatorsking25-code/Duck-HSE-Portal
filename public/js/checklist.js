// checklist.js — controller for checklist.html.
//
// Holds the answers in memory as { itemId: { status, note } }, re-renders the
// section list whenever the equipment type or language changes, and keeps the
// running summary and suggested verdict in step with the answers.
//
// Saved record shape (see DB.getChecklists()):
//   { id, savedAt, lang, equipmentType, make, model, serial, assetNo, plateNo,
//     capacity, hourMeter, odometer, location, project, contractor, operator,
//     month, inspectionDate, nextDue, inspector, inspectorId, supervisor,
//     colourScheme, tagFitted, verdict, verdictAuto, remarks,
//     answers: { itemId: { status, note } },
//     counts: { total, ok, monitor, defect, na, answered },
//     sigInspector, sigSupervisor }

(function () {
  'use strict';

  const STATUSES = ['ok', 'monitor', 'defect', 'na'];

  let answers = {};
  let editingId = null;
  let sigInspector = null;
  let sigSupervisor = null;
  let certificates = [];
  let certificatePhotos = {}; // certId -> [{id, dataUrl, name}] while editing

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------
  // Field wiring
  // ---------------------------------------------------------------------
  const FIELD_IDS = [
    'equipmentType', 'make', 'model', 'serial', 'assetNo', 'plateNo', 'capacity',
    'hourMeter', 'odometer', 'location', 'project', 'contractor', 'operator',
    'month', 'inspectionDate', 'nextDue', 'inspector', 'inspectorId', 'supervisor',
    'colourScheme', 'remarks', 'projectId'
  ];

  function readFields() {
    const out = {};
    FIELD_IDS.forEach(id => {
      const el = $(id);
      if (el) out[id] = el.value.trim ? el.value.trim() : el.value;
    });
    out.tagFitted = $('tagFitted').checked;
    out.verdict = document.querySelector('input[name="verdict"]:checked')?.value || 'fit';
    return out;
  }

  function writeFields(rec) {
    FIELD_IDS.forEach(id => {
      const el = $(id);
      if (el && rec[id] != null) el.value = rec[id];
    });
    $('tagFitted').checked = !!rec.tagFitted;
    const v = document.querySelector(`input[name="verdict"][value="${rec.verdict || 'fit'}"]`);
    if (v) v.checked = true;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // I18n.t with {token} interpolation.
  function tvar(key, vars) {
    let s = I18n.t(key);
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  // Translated category label from the English category value stored on a cert.
  function catLabel(cat) {
    return (typeof CertificateReport !== 'undefined' && CertificateReport.catLabel)
      ? CertificateReport.catLabel(cat)
      : cat;
  }

  // ---------------------------------------------------------------------
  // Equipment type dropdown
  // ---------------------------------------------------------------------
  function populateTypes() {
    const sel = $('equipmentType');
    const keep = sel.value;
    const lang = I18n.get();
    sel.innerHTML = `<option value="">${escapeHtml(I18n.t('f.selectPlaceholder'))}</option>` +
      EQUIPMENT_TYPES.map(t =>
        `<option value="${t.id}">${escapeHtml(t.name[lang] || t.name.en)}</option>`).join('');
    sel.value = keep;
  }

  function populateSchemes() {
    const sel = $('colourScheme');
    const keep = sel.value || 'monthly';
    sel.innerHTML = Object.values(COLOUR_SCHEMES)
      .map(s => `<option value="${s.id}">${escapeHtml(I18n.t(s.labelKey))}</option>`).join('');
    sel.value = keep;
  }

  // ---------------------------------------------------------------------
  // Checklist rendering
  // ---------------------------------------------------------------------
  function renderSections() {
    const typeId = $('equipmentType').value;
    const host = $('checklistSections');
    const lang = I18n.get();

    if (!typeId) {
      host.innerHTML = `<div class="card empty-state">${escapeHtml(I18n.t('msg.needType'))}</div>`;
      updateSummary();
      return;
    }

    const sections = ChecklistData.sectionsFor(typeId);

    host.innerHTML = sections.map(sec => {
      const title = sec.title[lang] || sec.title.en;
      return `
        <section class="chk-section${sec.maintenance ? ' chk-section-maint' : ''}" data-section="${sec.id}">
          <header class="chk-section-head">
            <span class="chk-section-icon">${ChecklistData.icon(sec.icon, 20)}</span>
            <h3>${escapeHtml(title)}</h3>
            <span class="chk-section-count" data-count-for="${sec.id}"></span>
          </header>
          <div class="chk-items">
            ${sec.items.map((item, i) => renderItem(sec, item, i, lang)).join('')}
          </div>
        </section>`;
    }).join('');

    host.querySelectorAll('.chk-status-btn').forEach(btn => {
      btn.addEventListener('click', onStatusClick);
    });
    host.querySelectorAll('.chk-note').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-note-for');
        answers[id] = answers[id] || { status: null, note: '' };
        answers[id].note = e.target.value;
      });
    });

    updateSummary();
  }

  function renderItem(sec, item, index, lang) {
    const a = answers[item.id] || {};
    const text = item.text[lang] || item.text.en;
    const noteOpen = a.status === 'monitor' || a.status === 'defect';
    return `
      <div class="chk-item${a.status ? ' answered status-' + a.status : ''}" data-item="${item.id}">
        <div class="chk-item-text">
          <span class="chk-item-no">${index + 1}</span>
          <span>${escapeHtml(text)}</span>
        </div>
        <div class="chk-status-group" role="group" aria-label="${escapeHtml(text)}">
          ${STATUSES.map(s => `
            <button type="button" class="chk-status-btn st-${s}${a.status === s ? ' selected' : ''}"
                    data-item-id="${item.id}" data-status="${s}"
                    aria-pressed="${a.status === s}"
                    title="${escapeHtml(I18n.t('st.' + s))}">
              <span class="chk-status-mark">${s === 'ok' ? '✓' : s === 'monitor' ? '!' : s === 'defect' ? '✕' : '–'}</span>
              <span class="chk-status-label">${escapeHtml(I18n.t('st.short.' + s))}</span>
            </button>`).join('')}
        </div>
        <input type="text" class="chk-note" data-note-for="${item.id}"
               placeholder="${escapeHtml(I18n.t('f.remarks'))}"
               value="${escapeHtml(a.note || '')}"
               style="${noteOpen ? '' : 'display:none;'}">
      </div>`;
  }

  function onStatusClick(e) {
    const btn = e.currentTarget;
    const id = btn.getAttribute('data-item-id');
    const status = btn.getAttribute('data-status');
    const row = btn.closest('.chk-item');

    // Clicking the selected status again clears it, so a mis-tap is undoable.
    const current = answers[id] && answers[id].status;
    const next = current === status ? null : status;

    answers[id] = answers[id] || { status: null, note: '' };
    answers[id].status = next;

    row.querySelectorAll('.chk-status-btn').forEach(b => {
      const on = b.getAttribute('data-status') === next;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    row.className = 'chk-item' + (next ? ' answered status-' + next : '');

    const note = row.querySelector('.chk-note');
    note.style.display = (next === 'monitor' || next === 'defect') ? '' : 'none';

    updateSummary();
  }

  // ---------------------------------------------------------------------
  // Summary, verdict and colour code
  // ---------------------------------------------------------------------
  function computeCounts() {
    const typeId = $('equipmentType').value;
    const sections = ChecklistData.sectionsFor(typeId);
    const counts = { total: 0, ok: 0, monitor: 0, defect: 0, na: 0, answered: 0 };
    sections.forEach(sec => sec.items.forEach(item => {
      counts.total++;
      const s = answers[item.id] && answers[item.id].status;
      if (s) { counts.answered++; counts[s]++; }
    }));
    return counts;
  }

  function suggestedVerdict(counts) {
    if (counts.defect > 0) return 'unfit';
    if (counts.monitor > 0) return 'conditional';
    return 'fit';
  }

  function updateSummary() {
    const counts = computeCounts();
    const pct = counts.total ? Math.round(counts.answered / counts.total * 100) : 0;

    $('sumTotal').textContent = counts.total;
    $('sumOk').textContent = counts.ok;
    $('sumMonitor').textContent = counts.monitor;
    $('sumDefect').textContent = counts.defect;
    $('sumNa').textContent = counts.na;
    $('sumProgressFill').style.width = pct + '%';
    $('sumProgressText').textContent = `${counts.answered} / ${counts.total} (${pct}%)`;

    // Per-section progress
    const typeId = $('equipmentType').value;
    ChecklistData.sectionsFor(typeId).forEach(sec => {
      const el = document.querySelector(`[data-count-for="${sec.id}"]`);
      if (!el) return;
      const done = sec.items.filter(i => answers[i.id] && answers[i.id].status).length;
      const bad = sec.items.filter(i => answers[i.id] && answers[i.id].status === 'defect').length;
      el.textContent = `${done}/${sec.items.length}`;
      el.classList.toggle('has-defect', bad > 0);
      el.classList.toggle('complete', done === sec.items.length && bad === 0);
    });

    // Suggested verdict — only moves the radio while the user hasn't overridden it.
    const sug = suggestedVerdict(counts);
    $('verdictSuggestion').textContent = I18n.t('v.' + sug);
    if (!$('verdictOverridden').value) {
      const r = document.querySelector(`input[name="verdict"][value="${sug}"]`);
      if (r) r.checked = true;
    }
    paintVerdict();
    return counts;
  }

  // Mirrors the checked radio onto its label as a class, so the verdict colour
  // works on browsers without :has() support (older Android WebViews).
  function paintVerdict() {
    document.querySelectorAll('.verdict-opt').forEach(lab => {
      const input = lab.querySelector('input[name="verdict"]');
      lab.classList.toggle('checked', !!(input && input.checked));
    });
  }

  function updateColour() {
    const parsed = ChecklistData.parseMonth($('month').value);
    const scheme = $('colourScheme').value;
    const box = $('colourSwatch');
    if (!parsed) {
      box.style.background = 'var(--steel-200)';
      box.style.color = 'var(--ink-soft)';
      box.textContent = '—';
      $('colourName').textContent = '—';
      return;
    }
    const c = ChecklistData.colourFor(parsed.monthIndex, scheme);
    const lang = I18n.get();
    box.style.background = c.hex;
    box.style.color = c.ink;
    box.textContent = ChecklistData.monthName(parsed.monthIndex, lang).slice(0, 3);
    $('colourName').textContent = `${c.name[lang] || c.name.en} — ${ChecklistData.monthName(parsed.monthIndex, lang)} ${parsed.year}`;
  }

  // Next inspection due = one month after the inspection date, unless the user
  // has typed something of their own.
  function autoNextDue() {
    const d = $('inspectionDate').value;
    if (!d || $('nextDue').dataset.touched === '1') return;
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return;
    dt.setMonth(dt.getMonth() + 1);
    $('nextDue').value = dt.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------
  // Third-party certificate register
  // ---------------------------------------------------------------------
  function newCertificate(category) {
    return {
      id: 'CERT-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      category,
      title: category === 'Equipment' ? I18n.t('cert.defEquipment') :
        category === 'Personnel' ? I18n.t('cert.defPersonnel') : I18n.t('cert.defAccessory'),
      holder: category === 'Personnel' ? ($('operator').value.trim() || '') :
        category === 'Equipment' ? ($('equipmentType').value || '') : '',
      number: '', issuer: '', issueDate: '', expiryDate: '', wll: '', notes: '', photos: []
    };
  }

  function certificatesForView() {
    return (certificates || []).map(c => Object.assign({}, c, {
      photos: (certificatePhotos[c.id] || c.photos || []).map(p => Object.assign({}, p))
    }));
  }

  async function renderCertificateSection() {
    const rows = $('certificateRows');
    const report = $('certificateReport');
    if (!rows || !report) return;
    const safeCerts = certificatesForView();
    const summary = typeof CertificateReport !== 'undefined' ? CertificateReport.computeSummary(safeCerts) : { total: safeCerts.length, valid: 0, expiring: 0, expired: 0, missing: 0 };
    $('certificateSummary').textContent = tvar('cert.summaryTpl', { total: summary.total, valid: summary.valid, expiring: summary.expiring, expired: summary.expired });
    await CertificateReport.render(rows, safeCerts, { editable: true });
    const photos = await CertificateReport.loadPhotoMap(safeCerts);
    const fallbackTitle = I18n.t('cert.titleFallback');
    report.innerHTML = `<div class="certificate-print-header"><strong>${escapeHtml(I18n.t('cert.recordTitle'))}</strong></div>
      <div class="report-head"><strong>${escapeHtml(I18n.t('cert.complianceSummary'))}</strong>
        <div class="report-stats">
          <span class="report-stat">${escapeHtml(I18n.t('cert.headValid'))}: <b>${summary.valid}</b></span>
          <span class="report-stat">${escapeHtml(I18n.t('cert.headExpiring'))}: <b>${summary.expiring}</b></span>
          <span class="report-stat">${escapeHtml(I18n.t('cert.headExpired'))}: <b>${summary.expired}</b></span>
        </div>
      </div>`;
    if (safeCerts.length) {
      safeCerts.forEach(c => {
        const st = CertificateReport.certStatus(c.expiryDate);
        const imgHtml = (c.photos || []).map(ph => photos[ph.id] ? `<img class="cert-photo" src="${photos[ph.id]}" alt="${escapeHtml(c.title || fallbackTitle)}">` : '').join('');
        report.innerHTML += `<div class="card" style="margin-bottom:10px;">
          <div class="certificate-title"><strong>${escapeHtml(c.title || fallbackTitle)}</strong><span class="badge ${st.key === 'valid' ? 'badge-ok' : st.key === 'expiring' ? 'badge-warn' : 'badge-fail'}"><span class="badge-dot"></span>${escapeHtml(st.label)}</span></div>
          <div class="certificate-meta">
            <span><b>${escapeHtml(I18n.t('cert.lCategory'))}:</b> ${escapeHtml(catLabel(c.category) || '—')}</span>
            <span><b>${escapeHtml(I18n.t('cert.lHolder'))}:</b> ${escapeHtml(c.holder || '—')}</span>
            <span><b>${escapeHtml(I18n.t('cert.lNumber'))}:</b> ${escapeHtml(c.number || '—')}</span>
            <span><b>${escapeHtml(I18n.t('cert.lIssuer'))}:</b> ${escapeHtml(c.issuer || '—')}</span>
            <span><b>${escapeHtml(I18n.t('cert.lIssue'))}:</b> ${escapeHtml(c.issueDate || '—')}</span>
            <span><b>${escapeHtml(I18n.t('cert.lExpiry'))}:</b> ${escapeHtml(c.expiryDate || '—')}</span>
            ${c.wll ? `<span><b>WLL/SWL:</b> ${escapeHtml(c.wll)}</span>` : ''}
          </div>
          ${c.notes ? `<div class="certificate-notes">${escapeHtml(c.notes)}</div>` : ''}
          ${imgHtml ? `<div class="certificate-gallery">${imgHtml}</div>` : ''}
        </div>`;
      });
    } else {
      report.innerHTML += `<div class="certificate-empty">${escapeHtml(I18n.t('cert.reportEmpty'))}</div>`;
    }
    rows.querySelectorAll('[data-edit-cert]').forEach(b => b.addEventListener('click', () => openCertificateEditor(b.getAttribute('data-edit-cert'))));
    rows.querySelectorAll('[data-delete-cert]').forEach(b => b.addEventListener('click', async () => deleteCertificate(b.getAttribute('data-delete-cert'))));
  }

  async function openCertificateEditor(idOrCategory) {
    const existing = certificates.find(c => c.id === idOrCategory);
    const cert = existing || newCertificate(idOrCategory);
    if (!existing) certificates.push(cert);
    certificatePhotos[cert.id] = (certificatePhotos[cert.id] || []).slice();

    const root = document.getElementById('lightboxRoot') || document.body;
    const photos = certificatePhotos[cert.id];
    for (let i = 0; i < photos.length; i++) {
      if (photos[i] && !photos[i].dataUrl && photos[i].id) {
        try {
          const rec = await CertificateStore.getPhoto(photos[i].id);
          if (rec && rec.blob) photos[i].dataUrl = await CertificateStore.fileToDataUrl(rec.blob);
        } catch (e) { console.warn('Could not load certificate photo', photos[i].id, e); }
      }
    }
    root.innerHTML = `<div class="modal-backdrop" id="certModal">
      <div class="modal" style="max-width:820px;">
        <div class="modal-head"><strong>${escapeHtml(I18n.t(existing ? 'cert.editTitle' : 'cert.addTitle'))} · ${escapeHtml(catLabel(cert.category))}</strong><button class="close-x" id="certClose">&times;</button></div>
        <div class="modal-body">
          <div class="certificate-modal-grid">
            <div class="field"><label>${escapeHtml(I18n.t('cert.fCategory'))}</label><select id="certCategory">
              <option value="Equipment">${escapeHtml(I18n.t('cat.equipment'))}</option>
              <option value="Personnel">${escapeHtml(I18n.t('cat.personnel'))}</option>
              <option value="Accessory">${escapeHtml(I18n.t('cat.accessory'))}</option>
            </select></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fTitle'))}</label><input id="certTitle" type="text"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fHolder'))}</label><input id="certHolder" type="text"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fNumber'))}</label><input id="certNumber" type="text"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fIssuer'))}</label><input id="certIssuer" type="text"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fWll'))}</label><input id="certWll" type="text"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fIssue'))}</label><input id="certIssue" type="date"></div>
            <div class="field"><label>${escapeHtml(I18n.t('cert.fExpiry'))}</label><input id="certExpiry" type="date"></div>
            <div class="field full"><label>${escapeHtml(I18n.t('cert.fNotes'))}</label><textarea id="certNotes" rows="3"></textarea></div>
            <div class="field full certificate-photo-drop">
              <label>${escapeHtml(I18n.t('cert.fPhotos'))}</label>
              <input id="certPhotoInput" type="file" accept="image/*" capture="environment" multiple>
              <span class="hint">${escapeHtml(I18n.t('cert.photoHint'))}</span>
              <div class="certificate-photo-list" id="certPhotoList"></div>
            </div>
          </div>
          <div id="certModalResult" style="margin-top:12px;"></div>
        </div>
        <div class="modal-foot"><button class="btn btn-primary" id="certSave">${escapeHtml(I18n.t('cert.saveBtn'))}</button><button class="btn" id="certCancel">${escapeHtml(I18n.t('cert.cancel'))}</button></div>
      </div>
    </div>`;

    $('certCategory').value = cert.category || 'Equipment';
    $('certTitle').value = cert.title || '';
    $('certHolder').value = cert.holder || '';
    $('certNumber').value = cert.number || '';
    $('certIssuer').value = cert.issuer || '';
    $('certWll').value = cert.wll || '';
    $('certIssue').value = cert.issueDate || '';
    $('certExpiry').value = cert.expiryDate || '';
    $('certNotes').value = cert.notes || '';

    function renderEditorPhotos() {
      const holder = $('certPhotoList');
      if (!holder) return;
      holder.innerHTML = photos.length ? photos.map((p, i) => `<div class="certificate-photo-item"><img src="${p.dataUrl || ''}" alt="${escapeHtml(I18n.t('cert.fPhotos'))}"><button type="button" data-photo-index="${i}" title="${escapeHtml(I18n.t('cert.deleteBtn'))}">&times;</button></div>`).join('') : `<span class="hint">${escapeHtml(I18n.t('cert.noPhotos'))}</span>`;
      holder.querySelectorAll('[data-photo-index]').forEach(b => b.addEventListener('click', () => { photos.splice(Number(b.getAttribute('data-photo-index')), 1); renderEditorPhotos(); }));
    }
    renderEditorPhotos();

    $('certPhotoInput').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      $('certModalResult').innerHTML = `<div class="banner banner-info"><div>${escapeHtml(I18n.t('cert.processing'))}</div></div>`;
      let hadError = false;
      for (const file of files) {
        try {
          const dataUrl = await Photo.fileToResizedDataUrl(file);
          photos.push({ id: 'temp-' + Date.now() + '-' + Math.floor(Math.random()*100000), dataUrl, name: file.name || 'certificate.jpg' });
        } catch (err) {
          console.error(err);
          hadError = true;
          $('certModalResult').innerHTML = `<div class="banner banner-danger"><div>${escapeHtml(I18n.t('cert.readError'))}</div></div>`;
        }
      }
      e.target.value = '';
      renderEditorPhotos();
      if (!hadError) $('certModalResult').innerHTML = '';
    });

    $('certCategory').addEventListener('change', e => { cert.category = e.target.value; });
    $('certSave').addEventListener('click', () => {
      cert.category = $('certCategory').value;
      cert.title = $('certTitle').value.trim();
      cert.holder = $('certHolder').value.trim();
      cert.number = $('certNumber').value.trim();
      cert.issuer = $('certIssuer').value.trim();
      cert.wll = $('certWll').value.trim();
      cert.issueDate = $('certIssue').value;
      cert.expiryDate = $('certExpiry').value;
      cert.notes = $('certNotes').value.trim();
      root.innerHTML = '';
      renderCertificateSection();
    });
    const close = () => { root.innerHTML = ''; if (!existing) certificates = certificates.filter(c => c.id !== cert.id); };
    $('certClose').addEventListener('click', close);
    $('certCancel').addEventListener('click', close);
    $('certModal').addEventListener('click', e => { if (e.target.id === 'certModal') close(); });
  }

  async function deleteCertificate(id) {
    const cert = certificates.find(c => c.id === id);
    if (!cert || !confirm(I18n.t('cert.deleteConfirm'))) return;
    const ids = (certificatePhotos[id] || cert.photos || []).map(p => p && p.id).filter(Boolean).filter(x => !String(x).startsWith('temp-'));
    try { await CertificateStore.deleteMany(ids); } catch (e) { console.warn('Could not delete all certificate photos', e); }
    delete certificatePhotos[id];
    certificates = certificates.filter(c => c.id !== id);
    await renderCertificateSection();
  }

  async function persistCertificatePhotos(recordId) {
    const clean = [];
    for (const cert of certificates) {
      const photos = certificatePhotos[cert.id] || cert.photos || [];
      const previousIds = (cert.photos || []).map(p => p && p.id).filter(id => id && !String(id).startsWith('temp-'));
      const storedPhotos = [];
      for (const p of photos) {
        if (!p || !p.dataUrl) {
          if (p && p.id) storedPhotos.push({ id: p.id, name: p.name || 'certificate.jpg' });
          continue;
        }
        let id = p.id && !String(p.id).startsWith('temp-') ? p.id : ('CP-' + Date.now() + '-' + Math.floor(Math.random() * 100000));
        const blob = Photo.dataUrlToBlob(p.dataUrl);
        await CertificateStore.putPhoto({ id, checklistId: recordId, certificateId: cert.id, name: p.name || 'certificate.jpg', blob, createdAt: new Date().toISOString() });
        storedPhotos.push({ id, name: p.name || 'certificate.jpg' });
      }
      const retained = new Set(storedPhotos.map(p => p.id));
      const stale = previousIds.filter(id => !retained.has(id));
      if (stale.length) {
        try { await CertificateStore.deleteMany(stale); } catch (e) { console.warn('Could not remove old certificate photos', e); }
      }
      clean.push(Object.assign({}, cert, { photos: storedPhotos }));
    }
    return clean;
  }

  async function shareCertificateReport() {
    try {
      const rec = buildRecord(certificatesForView());
      const result = await CertificateReport.share(rec);
      const msg = result.shared ? I18n.t('cert.sharedMsg') : result.downloaded ? I18n.t('cert.downloadedMsg') : I18n.t('cert.shareCancelled');
      $('saveConfirm').textContent = msg;
      $('saveConfirm').className = result.cancelled ? 'banner banner-info' : 'banner banner-ok';
      setTimeout(() => { $('saveConfirm').textContent = ''; $('saveConfirm').className = ''; }, 6000);
    } catch (e) {
      console.error(e);
      $('saveConfirm').textContent = I18n.t('cert.shareError');
      $('saveConfirm').className = 'banner banner-danger';
    }
  }

  // ---------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------
  function buildRecord(certificateList) {
    const f = readFields();
    const counts = computeCounts();
    // Only keep answers for items that actually belong to this equipment type,
    // so switching type part-way doesn't leave orphan answers in the record.
    const validIds = new Set();
    ChecklistData.sectionsFor(f.equipmentType).forEach(s => s.items.forEach(i => validIds.add(i.id)));
    const cleaned = {};
    Object.entries(answers).forEach(([id, a]) => {
      if (validIds.has(id) && a && a.status) cleaned[id] = { status: a.status, note: a.note || '' };
    });

    return Object.assign({}, f, {
      id: editingId || undefined,
      savedAt: new Date().toISOString(),
      lang: I18n.get(),
      verdictAuto: suggestedVerdict(counts),
      answers: cleaned,
      counts,
      sigInspector,
      sigSupervisor,
      certificates: Array.isArray(certificateList) ? certificateList : certificates
    });
  }

  async function save() {
    const f = readFields();
    if (!f.equipmentType) { alert(I18n.t('msg.needType')); $('equipmentType').focus(); return; }
    if (!f.assetNo) { alert(I18n.t('msg.needAsset')); $('assetNo').focus(); return; }
    if (!f.inspector) { alert(I18n.t('msg.needInspector')); $('inspector').focus(); return; }

    const counts = computeCounts();
    const missing = counts.total - counts.answered;
    if (missing > 0 && !confirm(`${missing} ${I18n.t('msg.incomplete')}`)) return;

    const padI = $('sigInspectorPad');
    const padS = $('sigSupervisorPad');
    sigInspector = padI && padI.toDataUrlSafe ? padI.toDataUrlSafe() : null;
    sigSupervisor = padS && padS.toDataUrlSafe ? padS.toDataUrlSafe() : null;

    // Assign the checklist ID before storing photos so the IndexedDB records are linked.
    const recordId = editingId || ('C-' + Date.now());
    editingId = recordId;
    const persistedCertificates = await persistCertificatePhotos(recordId);
    const rec = DB.saveChecklist(buildRecord(persistedCertificates));
    if (!rec) return;   // not stored on this device; DB has told the user why
    editingId = rec.id;
    let linkError = '';
    if (rec.projectId && typeof ProjectLink !== 'undefined') {
      const unfit = rec.verdict === 'unfit';
      const res = await ProjectLink.sync(rec.projectId,
        { kind: 'checklist', id: rec.id, label: `${rec.equipmentType || 'Equipment'} ${rec.assetNo || ''}`.trim() },
        {
          title: `Inspection: ${rec.equipmentType || 'Equipment'} ${rec.assetNo || ''} (${rec.verdict === 'fit' ? 'fit for use' : rec.verdict === 'conditional' ? 'conditional' : 'NOT fit for use'})`,
          status: rec.verdict === 'fit' ? 'closed' : 'open',
          priority: unfit ? 'critical' : rec.verdict === 'conditional' ? 'high' : 'low',
          dueDate: rec.verdict === 'fit' ? '' : (rec.nextDue || ''),
          location: rec.location || '',
          details: [`Inspected by ${rec.inspector || '?'} on ${rec.inspectionDate || '?'}.`, rec.remarks || ''].filter(Boolean).join(' ')
        });
      if (!res.ok) linkError = ` Could not add it to the project: ${res.error}` +
        (res.offline ? '. The project will be updated the next time you save it online.' : '');
    }
    certificates = persistedCertificates;
    certificatePhotos = {};
    persistedCertificates.forEach(c => { certificatePhotos[c.id] = (c.photos || []).map(p => ({ id: p.id, name: p.name })); });
    await renderCertificateSection();
    const el = $('saveConfirm');
    el.textContent = I18n.t('msg.saved') + linkError;
    el.className = 'banner banner-ok';
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 6000);
  }

  // ---------------------------------------------------------------------
  // Email
  // ---------------------------------------------------------------------
  function currentDraft() {
    return ChecklistEmail.draft(buildRecord(), I18n.get());
  }

  function openEmailModal() {
    const f = readFields();
    if (!f.equipmentType) { alert(I18n.t('msg.needType')); return; }

    const d = currentDraft();
    $('emSubject').value = d.subject;
    $('emBody').value = d.body;
    $('emResult').innerHTML = '';
    $('emailModal').hidden = false;
    document.body.classList.add('modal-open');
    $('emTo').focus();
  }

  function closeEmailModal() {
    $('emailModal').hidden = true;
    document.body.classList.remove('modal-open');
  }

  // Collects and validates the address fields, showing which entries are bad
  // rather than silently dropping them.
  function gatherRecipients() {
    const to = Mailer.parseAddresses($('emTo').value);
    const cc = Mailer.parseAddresses($('emCc').value);
    const bad = to.invalid.concat(cc.invalid);
    if (bad.length) {
      $('emResult').innerHTML =
        `<div class="banner banner-danger"><div>${escapeHtml(I18n.t('em.badAddress'))} ${escapeHtml(bad.join(', '))}</div></div>`;
      return null;
    }
    if (!to.valid.length) {
      $('emResult').innerHTML =
        `<div class="banner banner-danger"><div>${escapeHtml(I18n.t('em.needTo'))}</div></div>`;
      return null;
    }
    return { to: to.valid, cc: cc.valid };
  }

  function msgFromForm(rcpt) {
    return {
      from: $('emFrom').value.trim(),
      to: rcpt.to,
      cc: rcpt.cc,
      subject: $('emSubject').value,
      body: $('emBody').value
    };
  }

  // ---------------------------------------------------------------------
  // Load an existing record (from the records page "View")
  // ---------------------------------------------------------------------
  function loadRecord(id) {
    const rec = DB.getChecklists().find(c => c.id === id);
    if (!rec) return false;
    editingId = rec.id;
    if (rec.lang) I18n.set(rec.lang);
    populateTypes();
    populateSchemes();
    writeFields(rec);
    if (typeof ProjectLink !== 'undefined') ProjectLink.mount($('projectId'), rec.projectId || null);
    answers = {};
    Object.entries(rec.answers || {}).forEach(([k, v]) => { answers[k] = Object.assign({}, v); });
    certificates = Array.isArray(rec.certificates) ? rec.certificates.map(c => Object.assign({}, c, { photos: Array.isArray(c.photos) ? c.photos.slice() : [] })) : [];
    certificatePhotos = {};
    certificates.forEach(c => { certificatePhotos[c.id] = (c.photos || []).map(p => Object.assign({}, p)); });
    sigInspector = rec.sigInspector || null;
    sigSupervisor = rec.sigSupervisor || null;
    renderSections();
    updateColour();
    const padI = $('sigInspectorPad'), padS = $('sigSupervisorPad');
    if (padI && padI.loadDataUrl) padI.loadDataUrl(sigInspector);
    if (padS && padS.loadDataUrl) padS.loadDataUrl(sigSupervisor);
    $('verdictOverridden').value = '1';
    renderCertificateSection();
    return true;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    I18n.applyDocument();
    I18n.mountSwitcher('langSwitch');
    I18n.apply();

    populateTypes();
    populateSchemes();

    $('month').value = ChecklistData.currentMonthValue();
    $('inspectionDate').value = new Date().toISOString().slice(0, 10);
    autoNextDue();
    updateColour();

    ['sigInspectorPad', 'sigSupervisorPad'].forEach(id => {
      const c = $(id);
      if (c && typeof attachSignaturePad === 'function') attachSignaturePad(c);
    });
    document.querySelectorAll('[data-clear-sig]').forEach(b => {
      b.addEventListener('click', () => {
        const c = $(b.getAttribute('data-clear-sig'));
        if (c && c.clearPad) c.clearPad();
      });
    });

    $('equipmentType').addEventListener('change', renderSections);
    $('month').addEventListener('change', updateColour);
    $('colourScheme').addEventListener('change', updateColour);
    $('inspectionDate').addEventListener('change', autoNextDue);
    $('nextDue').addEventListener('input', () => { $('nextDue').dataset.touched = '1'; });

    document.querySelectorAll('input[name="verdict"]').forEach(r => {
      r.addEventListener('change', () => { $('verdictOverridden').value = '1'; paintVerdict(); });
    });
    paintVerdict();

    $('btnMarkAllOk').addEventListener('click', () => {
      const typeId = $('equipmentType').value;
      if (!typeId) { alert(I18n.t('msg.needType')); return; }
      ChecklistData.sectionsFor(typeId).forEach(s => s.items.forEach(i => {
        answers[i.id] = answers[i.id] || { status: null, note: '' };
        if (!answers[i.id].status) answers[i.id].status = 'ok';
      }));
      renderSections();
    });

    $('btnClearAll').addEventListener('click', () => {
      if (!confirm(I18n.t('msg.confirmClear'))) return;
      answers = {};
      renderSections();
    });

    $('btnSave').addEventListener('click', save);
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnEmail').addEventListener('click', openEmailModal);
    $('btnAddEquipmentCert').addEventListener('click', () => openCertificateEditor('Equipment'));
    $('btnAddPersonnelCert').addEventListener('click', () => openCertificateEditor('Personnel'));
    $('btnAddAccessoryCert').addEventListener('click', () => openCertificateEditor('Accessory'));
    $('btnShareCertificates').addEventListener('click', shareCertificateReport);

    $('emClose').addEventListener('click', closeEmailModal);
    $('emCancel').addEventListener('click', closeEmailModal);
    $('emailModal').addEventListener('click', (e) => {
      if (e.target.id === 'emailModal') closeEmailModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('emailModal').hidden) closeEmailModal();
    });

    $('emRegenerate').addEventListener('click', () => {
      const d = currentDraft();
      $('emSubject').value = d.subject;
      $('emBody').value = d.body;
    });

    $('emOpenClient').addEventListener('click', () => {
      const r = gatherRecipients();
      if (!r) return;
      Mailer.openMailto(Object.assign(msgFromForm(r), {
        truncationNote: I18n.t('em.note')
      }));
    });

    $('emDownload').addEventListener('click', () => {
      const r = gatherRecipients();
      if (!r) return;
      Mailer.downloadEml(msgFromForm(r), ChecklistEmail.filenameFor(buildRecord()));
      $('emResult').innerHTML = `<div class="banner banner-ok"><div>${escapeHtml(I18n.t('em.download'))} ✓</div></div>`;
    });

    $('emCopy').addEventListener('click', async () => {
      const text = `${I18n.t('em.subject')}: ${$('emSubject').value}\n\n${$('emBody').value}`;
      const ok = await Mailer.copyText(text);
      $('emResult').innerHTML = ok
        ? `<div class="banner banner-ok"><div>${escapeHtml(I18n.t('em.copied'))}</div></div>`
        : `<div class="banner banner-warn"><div>${escapeHtml(I18n.t('em.copy'))} — ✕</div></div>`;
    });

    // Re-render everything in the new language when it changes.
    document.addEventListener('i18n:changed', () => {
      populateTypes();
      populateSchemes();
      I18n.apply();
      renderSections();
      updateColour();
      renderCertificateSection();
    });

    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (id && loadRecord(id)) return;
    if (id) { waitForRecord(id); return; }
    if (typeof ProjectLink !== 'undefined') ProjectLink.mount($('projectId'), null);
    renderSections(); renderCertificateSection();
  }

  // A link to an inspection that is not on this device yet (for example a
  // project item opened before sync finishes) must not open a blank form
  // under that record's address. Say so, and load it once it arrives.
  function waitForRecord(id) {
    const content = document.querySelector('.content');
    const hidden = [];
    Array.from(content.children).forEach((el) => {
      if (el.id === 'langSwitch' || el.id === 'app-footer' || el.hidden) return;
      el.hidden = true;
      hidden.push(el);
    });
    const banner = document.createElement('div');
    banner.className = 'banner banner-warn';
    banner.innerHTML = `<div><strong>This inspection is not on this device yet.</strong>
      It may still be syncing from your account, so it will open here as soon as it arrives.
      If it does not, it may belong to another team member.
      <a href="checklists.html">See all inspection records</a> or <a href="checklist.html">start a new inspection</a>.</div>`;
    content.insertBefore(banner, content.firstChild);
    const onSync = () => {
      if (!DB.getChecklists().some(c => c.id === id)) return;
      document.removeEventListener('cloudsync:changed', onSync);
      banner.remove();
      hidden.forEach((el) => { el.hidden = false; });
      loadRecord(id);
    };
    document.addEventListener('cloudsync:changed', onSync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
