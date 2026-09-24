// audit.js — the audit workspace (audit.html?id=…).
//
// One page to work an audit checklist end to end: attach evidence to each
// S/No., set its status, note what is outstanding, view anything attached,
// compile the pack, and upload it to the project's Drive folder.
//
// Rendering is targeted: the page is drawn once, then a change to one item
// redraws that item, its section header and the summary — never all ~200
// points — so typing a note or dropping a file stays instant on a phone.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtSize = (n) => AuditViewer.fmtSize(n);
  const MAX_FILE = 250 * 1024 * 1024;
  const SHRINK_OVER = 1.2 * 1024 * 1024;

  let audit = null;
  let compiled = null;        // { blob, fileName, stats, stamp } — the last pack built this session
  let uploadTarget = null;    // item receiving the next file-picker selection
  let linkTarget = null, customTarget = null;
  const open = new Set();     // expanded section ids
  const noteOpen = new Set(); // items whose empty note box is showing — page state, never saved

  // ------------------------------------------------------------ persistence -

  // Saves are chained so two quick edits can never land out of order.
  let saving = Promise.resolve();
  function save() {
    saving = saving.then(() => AuditStore.saveAudit(audit)).catch((e) => {
      showError('Could not save: ' + e.message + ' — the device may be out of storage.');
    });
    return saving;
  }
  // Content edits bump a revision number; bookkeeping (when a pack was built,
  // when it was uploaded) does not. A compiled pack is stale exactly when the
  // revision has moved since it was built. Comparing save timestamps instead
  // would make every bookkeeping save mark the fresh pack stale, and "Upload"
  // would rebuild it forever.
  function changed() { audit.rev = (audit.rev || 0) + 1; return save(); }
  let noteTimer = null;
  function saveSoon() { clearTimeout(noteTimer); noteTimer = setTimeout(changed, 450); }
  window.addEventListener('pagehide', () => { if (noteTimer) { clearTimeout(noteTimer); changed(); } });

  function showError(msg) {
    $('loadError').innerHTML = msg ? `<div class="banner banner-danger"><div>${esc(msg)}</div></div>` : '';
  }

  function remember() {
    try { sessionStorage.setItem('audit-open:' + audit.id, JSON.stringify(Array.from(open))); } catch (e) {}
  }
  function recall() {
    try { JSON.parse(sessionStorage.getItem('audit-open:' + audit.id) || '[]').forEach((id) => open.add(id)); } catch (e) {}
  }

  // ------------------------------------------------------------------ find --

  function findItem(id) {
    for (const sec of audit.sections) {
      const it = sec.items.find((x) => x.id === id);
      if (it) return { sec: sec, it: it };
    }
    return null;
  }

  // ------------------------------------------------------------------ render -

  function roleLabel() { return audit.role === 'consultant' ? 'Consultant' : 'Contractor'; }

  function renderHeader() {
    $('hdrTitle').textContent = audit.projectNo + ' — ' + roleLabel() + ' audit';
    $('hdrCrumb').innerHTML = `<a href="audits.html">HSE audit preparation</a> / ${esc(audit.projectTitle || audit.auditType || '')}`;
    document.title = audit.projectNo + ' audit · Duck HSE Portal';
  }

  function renderSummary() {
    const s = AuditPack.stats(audit);
    const up = audit.drive && audit.drive.lastUpload;
    const color = s.readiness >= 80 ? 'var(--ok-green)' : s.readiness >= 50 ? 'var(--amber)' : 'var(--danger-red)';
    $('summary').innerHTML = `
      <div class="audit-summary">
        <div class="as-hero">
          <div class="as-figure">${s.readiness}<span>%</span></div>
          <div class="as-hero-text">
            <div class="as-hero-title">Audit readiness</div>
            <div class="meter-track"><div class="meter-fill" style="width:${s.readiness}%;background:${color}"></div></div>
            <div class="as-hero-sub">${s.ready} of ${s.applicable} applicable points evidenced${s.partial ? ', ' + s.partial + ' partly' : ''} · ${s.na} not applicable</div>
          </div>
        </div>
        <div class="as-stats">
          <div class="as-stat ${s.potentialMajor ? 'bad' : 'good'}"><b>${s.potentialMajor}</b><span>open points rated <strong>Major</strong> if missing</span></div>
          <div class="as-stat ${s.potentialEither ? 'warn' : ''}"><b>${s.potentialEither}</b><span>rated Minor / Major</span></div>
          <div class="as-stat"><b>${s.potentialMinor}</b><span>rated Minor</span></div>
          <div class="as-stat"><b>${s.files}</b><span>files · ${fmtSize(s.bytes)}</span></div>
        </div>
        <div class="as-meta">
          <span><b>Audit</b> ${esc(audit.auditType || '—')}${audit.auditDate ? ' · ' + esc(audit.auditDate) : ''}</span>
          ${audit.auditors ? `<span><b>Auditor(s)</b> ${esc(audit.auditors)}</span>` : ''}
          <span><b>Drive</b> ${up ? `<a href="${esc(up.webViewLink || '#')}" target="_blank" rel="noopener">${esc(up.name)}</a> · ${esc(new Date(up.at).toLocaleString())}` : 'not uploaded yet'}</span>
        </div>
        <p class="as-note">Point levels are the classification ADOSH-SF Technical Guideline 15 suggests if the evidence cannot be shown on the day. The auditor decides the actual level.</p>
      </div>`;
  }

  function ncBadge(nc) {
    if (!nc) return '<span class="nc nc-judgement">Auditor\'s judgement</span>';
    const cls = nc === 'Major' ? 'nc-major' : nc === 'Minor' ? 'nc-minor' : 'nc-either';
    return `<span class="nc ${cls}">${esc(nc)} if missing</span>`;
  }

  function fileIcon(name, type) {
    const k = AuditViewer.kindOf(name, type);
    return { image: '🖼', pdf: '📕', video: '🎞', audio: '🎧', xlsx: '📊', docx: '📝', html: '🌐', text: '📄' }[k] || '📎';
  }

  function renderItem(it) {
    const files = it.files || [], links = it.links || [];
    const statusOpts = Object.keys(AuditPack.STATUS).map((k) =>
      `<option value="${k}"${it.status === k ? ' selected' : ''}>${esc(AuditPack.STATUS[k].label)}</option>`).join('');
    return `<div class="aitem st-${esc(it.status)}" id="it-${esc(it.id)}" data-item="${esc(it.id)}">
      <div class="aitem-no" title="S/No.">${esc(it.no)}</div>
      <div class="aitem-body">
        <div class="aitem-text">${esc(it.text)}${it.custom ? ' <span class="custom-tag">added</span>' : ''}</div>
        <div class="aitem-meta"><span class="aitem-ref">${esc(it.ref || '')}</span>${ncBadge(it.nc)}</div>
        ${(it.evidence && it.evidence.length) || it.tip ? `<details class="aitem-expect">
          <summary>Evidence expected${it.evidence && it.evidence.length ? ' (' + it.evidence.length + ')' : ''}</summary>
          ${it.evidence && it.evidence.length ? `<ul>${it.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
          ${it.tip ? `<p class="aitem-tip"><strong>Auditor's view:</strong> ${esc(it.tip)}</p>` : ''}
        </details>` : ''}
        ${files.length || links.length ? `<div class="aitem-files">
          ${files.map((f) => `<span class="fchip"><button type="button" class="fchip-open" data-view="${esc(f.id)}" title="View">
            <span class="fchip-ic">${fileIcon(f.name, f.type)}</span><span class="fchip-name">${esc(f.name)}</span><span class="fchip-size">${fmtSize(f.size)}</span></button>
            <button type="button" class="fchip-x" data-rmfile="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('')}
          ${links.map((l, i) => `<span class="fchip fchip-link"><a class="fchip-open" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}">
            <span class="fchip-ic">🔗</span><span class="fchip-name">${esc(l.label || l.url)}</span></a>
            <button type="button" class="fchip-x" data-rmlink="${i}" aria-label="Remove link">×</button></span>`).join('')}
        </div>` : ''}
        <div class="aitem-note-wrap"${it.note || noteOpen.has(it.id) ? '' : ' hidden'}>
          <textarea class="aitem-note" rows="2" placeholder="What is outstanding, who is chasing it, where the original is kept…">${esc(it.note || '')}</textarea>
        </div>
      </div>
      <div class="aitem-side no-print">
        <select class="aitem-status" aria-label="Status of ${esc(it.no)}">${statusOpts}</select>
        <div class="aitem-btns">
          <button type="button" class="btn btn-sm btn-primary" data-upload>Upload</button>
          <button type="button" class="btn btn-sm" data-link>Link</button>
          <button type="button" class="btn btn-sm" data-note>${it.note ? 'Note ✓' : 'Note'}</button>
        </div>
        <div class="aitem-drop">or drop files here</div>
      </div>
    </div>`;
  }

  function sectionHead(sec) {
    const ss = AuditPack.sectionStats(sec);
    const files = sec.items.reduce((a, it) => a + (it.files || []).length, 0);
    const isOpen = open.has(sec.id);
    return `<button type="button" class="asec-head" aria-expanded="${isOpen}" data-toggle="${esc(sec.id)}">
      <span class="asec-caret">${isOpen ? '▾' : '▸'}</span>
      <span class="asec-no">${esc(sec.no)}</span>
      <span class="asec-titles"><span class="asec-title">${esc(sec.title)}</span><span class="asec-ref">${esc(sec.ref)}</span></span>
      <span class="asec-prog"><span class="asec-bar"><i style="width:${ss.readiness}%"></i></span>
        <span class="asec-pct">${ss.ready}/${ss.applicable}${files ? ' · ' + files + ' file' + (files === 1 ? '' : 's') : ''}</span></span>
    </button>`;
  }

  function renderSections() {
    const partTitles = { A: 'Audit readiness', B: 'ADOSH-SF management system — per Technical Guideline 15', C: 'TAQA WS SOP operational compliance' };
    let lastPart = null, html = '';
    audit.sections.forEach((sec) => {
      if (sec.part !== lastPart) {
        html += `<div class="apart">${esc(partTitles[sec.part] || '')}</div>`;
        lastPart = sec.part;
      }
      html += `<section class="asec${open.has(sec.id) ? ' is-open' : ''}" id="sec-${esc(sec.id)}" data-sec="${esc(sec.id)}">
        ${sectionHead(sec)}
        <div class="asec-body">
          ${sec.items.map(renderItem).join('')}
          <div class="asec-add no-print"><button type="button" class="linklike" data-addpoint="${esc(sec.id)}">+ Add a point to this section</button></div>
        </div>
      </section>`;
    });
    $('sections').innerHTML = html;
    applyFilters();
  }

  function refreshItem(it) {
    const el = $('it-' + it.id);
    if (el) {
      const wasOpen = el.querySelector('.aitem-expect') && el.querySelector('.aitem-expect').open;
      el.outerHTML = renderItem(it);
      if (wasOpen) { const d = $('it-' + it.id).querySelector('.aitem-expect'); if (d) d.open = true; }
    }
    const f = findItem(it.id);
    if (f) refreshSection(f.sec);
    renderSummary();
    applyFilters();
  }
  function refreshSection(sec) {
    const el = $('sec-' + sec.id);
    if (!el) return;
    el.querySelector('.asec-head').outerHTML = sectionHead(sec);
  }

  // ----------------------------------------------------------------- filter -

  function applyFilters() {
    const q = ($('fSearch').value || '').toLowerCase().trim();
    const st = $('fStatus').value;
    const nc = $('fNc').value;
    const filtering = !!(q || st || nc);
    audit.sections.forEach((sec) => {
      let visible = 0;
      sec.items.forEach((it) => {
        const hay = (it.no + ' ' + it.text + ' ' + it.ref + ' ' + (it.evidence || []).join(' ') + ' ' + (it.note || '') + ' ' + sec.title).toLowerCase();
        const okQ = !q || hay.includes(q);
        const okS = !st || (st === 'open' ? ['pending', 'partial', 'gap'].indexOf(it.status) !== -1 : it.status === st);
        const okN = !nc || it.nc === nc;
        const show = okQ && okS && okN;
        const el = $('it-' + it.id);
        if (el) el.hidden = !show;
        if (show) visible++;
      });
      const secEl = $('sec-' + sec.id);
      if (!secEl) return;
      secEl.hidden = filtering && !visible;
      // While filtering, open every section with a match so results are visible.
      secEl.classList.toggle('is-open', filtering ? visible > 0 : open.has(sec.id));
    });
    document.querySelectorAll('.apart').forEach((p) => {
      let n = p.nextElementSibling, any = false;
      while (n && !n.classList.contains('apart')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      p.hidden = !any;
    });
  }

  // ---------------------------------------------------------------- evidence -

  async function addFiles(it, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const el = $('it-' + it.id);
    if (el) el.classList.add('is-busy');
    const skipped = [];
    for (const f of files) {
      if (f.size > MAX_FILE) { skipped.push(f.name + ' (over ' + fmtSize(MAX_FILE) + ')'); continue; }
      let blob = f, name = f.name || 'file', type = f.type || '';
      if (audit.shrinkPhotos && /^image\/(jpeg|png|webp)$/i.test(type) && f.size > SHRINK_OVER && typeof Photo !== 'undefined') {
        try {
          const dataUrl = await Photo.fileToResizedDataUrl(f, { maxDim: 2000, quality: 0.85 });
          const small = Photo.dataUrlToBlob(dataUrl);
          if (small.size < f.size) { blob = small; type = 'image/jpeg'; name = name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg'; }
        } catch (e) { /* keep the original if the browser can't decode it (e.g. HEIC) */ }
      }
      const id = AuditChecklists.uid('f');
      const now = Date.now();
      try {
        await AuditStore.putFile({ id: id, auditId: audit.id, itemId: it.id, name: name, type: type, size: blob.size, blob: blob, addedAt: now });
      } catch (e) {
        skipped.push(name + ' (' + e.message + ')');
        continue;
      }
      it.files = it.files || [];
      it.files.push({ id: id, name: name, type: type, size: blob.size, addedAt: now });
    }
    if (it.status === 'pending' && it.files && it.files.length) it.status = 'ready';
    await changed();
    refreshItem(it);
    if (skipped.length) alert('Not added:\n• ' + skipped.join('\n• '));
  }

  async function removeFile(it, fileId) {
    const meta = (it.files || []).find((f) => f.id === fileId);
    if (!meta || !confirm('Remove "' + meta.name + '" from S/No. ' + it.no + '?')) return;
    await AuditStore.deleteFile(fileId);
    it.files = it.files.filter((f) => f.id !== fileId);
    if (!it.files.length && !(it.links || []).length && it.status === 'ready') it.status = 'pending';
    await changed();
    refreshItem(it);
  }

  // Every file in the audit, in S/No. order — the viewer pages through all of
  // them, not just one point's, so a reviewer can walk the whole pack.
  function allEntries() {
    const out = [];
    audit.sections.forEach((sec) => sec.items.forEach((it) => (it.files || []).forEach((f) => {
      out.push({ id: f.id, name: f.name, type: f.type, size: f.size, addedAt: f.addedAt, label: 'S/No. ' + it.no + ' — ' + it.text });
    })));
    return out;
  }
  function viewFile(fileId) {
    const entries = allEntries();
    const idx = Math.max(0, entries.findIndex((e) => e.id === fileId));
    if (!entries.length) { alert('No evidence attached yet.'); return; }
    AuditViewer.open(entries, idx, {
      getBlob: async (e) => { const r = await AuditStore.getFile(e.id); return r ? r.blob : null; }
    });
  }

  // ------------------------------------------------------------------ events -

  function wireSections() {
    const root = $('sections');

    root.addEventListener('click', (e) => {
      const t = e.target;
      const tog = t.closest('[data-toggle]');
      if (tog) {
        const id = tog.getAttribute('data-toggle');
        if (open.has(id)) open.delete(id); else open.add(id);
        remember();
        const secEl = $('sec-' + id);
        secEl.classList.toggle('is-open', open.has(id));
        const sec = audit.sections.find((s) => s.id === id);
        if (sec) refreshSection(sec);
        return;
      }
      const add = t.closest('[data-addpoint]');
      if (add) { openCustom(add.getAttribute('data-addpoint')); return; }

      const itemEl = t.closest('[data-item]');
      if (!itemEl) return;
      const found = findItem(itemEl.getAttribute('data-item'));
      if (!found) return;
      const it = found.it;

      if (t.closest('[data-upload]')) { uploadTarget = it; $('hiddenUpload').value = ''; $('hiddenUpload').click(); return; }
      if (t.closest('[data-link]')) { openLink(it); return; }
      if (t.closest('[data-note]')) {
        noteOpen.add(it.id);
        const w = itemEl.querySelector('.aitem-note-wrap');
        w.hidden = false;
        w.querySelector('textarea').focus();
        return;
      }
      const v = t.closest('[data-view]');
      if (v) { viewFile(v.getAttribute('data-view')); return; }
      const rf = t.closest('[data-rmfile]');
      if (rf) { removeFile(it, rf.getAttribute('data-rmfile')); return; }
      const rl = t.closest('[data-rmlink]');
      if (rl) {
        const i = Number(rl.getAttribute('data-rmlink'));
        if (!confirm('Remove this link?')) return;
        it.links.splice(i, 1);
        if (!(it.files || []).length && !it.links.length && it.status === 'ready') it.status = 'pending';
        changed(); refreshItem(it);
      }
    });

    root.addEventListener('change', (e) => {
      if (!e.target.classList.contains('aitem-status')) return;
      const found = findItem(e.target.closest('[data-item]').getAttribute('data-item'));
      if (!found) return;
      found.it.status = e.target.value;
      changed(); refreshItem(found.it);
    });

    root.addEventListener('input', (e) => {
      if (!e.target.classList.contains('aitem-note')) return;
      const found = findItem(e.target.closest('[data-item]').getAttribute('data-item'));
      if (!found) return;
      found.it.note = e.target.value;
      saveSoon();
    });
    root.addEventListener('focusout', (e) => {
      if (!e.target.classList.contains('aitem-note')) return;
      const found = findItem(e.target.closest('[data-item]').getAttribute('data-item'));
      if (!found) return;
      noteOpen.delete(found.it.id);
      clearTimeout(noteTimer);
      changed().then(() => {
        // Redraw so the Note button reflects whether a note exists, unless the
        // user has moved straight into another field in the same item.
        setTimeout(() => { if (!document.activeElement || !document.activeElement.closest('#it-' + found.it.id)) refreshItem(found.it); }, 0);
      });
    });

    // Drag and drop onto any point.
    let dragItem = null;
    root.addEventListener('dragover', (e) => {
      const el = e.target.closest('[data-item]');
      if (!el || !e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') === -1) return;
      e.preventDefault();
      if (dragItem !== el) { if (dragItem) dragItem.classList.remove('is-drop'); dragItem = el; el.classList.add('is-drop'); }
    });
    root.addEventListener('dragleave', (e) => {
      const el = e.target.closest('[data-item]');
      if (el && !el.contains(e.relatedTarget)) { el.classList.remove('is-drop'); if (dragItem === el) dragItem = null; }
    });
    root.addEventListener('drop', (e) => {
      const el = e.target.closest('[data-item]');
      if (!el) return;
      e.preventDefault();
      el.classList.remove('is-drop'); dragItem = null;
      const found = findItem(el.getAttribute('data-item'));
      if (found && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(found.it, e.dataTransfer.files);
    });
    // A file dropped anywhere else must not navigate the tab away from the audit.
    window.addEventListener('dragover', (e) => { if (!e.target.closest || !e.target.closest('[data-item]')) e.preventDefault(); });
    window.addEventListener('drop', (e) => { if (!e.target.closest || !e.target.closest('[data-item]')) e.preventDefault(); });

    $('hiddenUpload').addEventListener('change', () => {
      const it = uploadTarget; uploadTarget = null;
      if (it) addFiles(it, $('hiddenUpload').files);
    });
  }

  // ------------------------------------------------------------------ modals -

  function showModal(id) { $(id).hidden = false; }
  function hideModal(id) { $(id).hidden = true; }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const m = c.closest('.modal-backdrop'); if (m) m.hidden = true; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-backdrop:not([hidden]):not(.viewer-backdrop)').forEach((m) => {
      if (m.id !== 'compileModal' || !m.dataset.busy) m.hidden = true;
    });
  });

  // details
  function openDetails() {
    $('dProjectNo').value = audit.projectNo || '';
    $('dAuditDate').value = audit.auditDate || '';
    $('dProjectTitle').value = audit.projectTitle || '';
    $('dCompany').value = audit.company || '';
    $('dClient').value = audit.client || '';
    $('dAuditType').value = audit.auditType || '';
    $('dAuditors').value = audit.auditors || '';
    $('dPreparedBy').value = audit.preparedBy || '';
    $('dShrink').checked = !!audit.shrinkPhotos;
    $('dRole').textContent = roleLabel();
    showModal('detailsModal');
  }
  $('detailsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pn = $('dProjectNo').value.trim();
    if (!pn) return;
    Object.assign(audit, {
      projectNo: pn, auditDate: $('dAuditDate').value, projectTitle: $('dProjectTitle').value.trim(),
      company: $('dCompany').value.trim(), client: $('dClient').value.trim(), auditType: $('dAuditType').value.trim(),
      auditors: $('dAuditors').value.trim(), preparedBy: $('dPreparedBy').value.trim(), shrinkPhotos: $('dShrink').checked
    });
    await changed();
    hideModal('detailsModal');
    renderHeader(); renderSummary();
  });

  // links
  function openLink(it) {
    linkTarget = it;
    $('linkForm').reset();
    $('linkFor').textContent = 'S/No. ' + it.no + ' — ' + it.text;
    showModal('linkModal');
    setTimeout(() => $('lUrl').focus(), 40);
  }
  $('linkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('lUrl').value.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\//i.test(url)) { alert('Only http(s) links can be added.'); return; }
    const it = linkTarget; linkTarget = null;
    it.links = it.links || [];
    it.links.push({ url: url, label: $('lLabel').value.trim(), addedAt: Date.now() });
    if (it.status === 'pending') it.status = 'ready';
    await changed();
    hideModal('linkModal');
    refreshItem(it);
  });

  // custom point
  function openCustom(secId) {
    customTarget = audit.sections.find((s) => s.id === secId);
    if (!customTarget) return;
    $('customForm').reset();
    $('customFor').textContent = 'Section ' + customTarget.no + ' — ' + customTarget.title;
    showModal('customModal');
    setTimeout(() => $('cText').focus(), 40);
  }
  $('customForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sec = customTarget; customTarget = null;
    if (!sec) return;
    const last = sec.items.reduce((m, it) => Math.max(m, Number(String(it.no).split('.')[1]) || 0), 0);
    const it = {
      id: AuditChecklists.uid('it'), no: sec.no + '.' + (last + 1), custom: true,
      text: $('cText').value.trim(), evidence: $('cEvidence').value.split(';').map((s) => s.trim()).filter(Boolean),
      ref: $('cRef').value.trim(), nc: $('cNc').value || null, tip: '', status: 'pending', note: '', files: [], links: []
    };
    if (!it.text) return;
    sec.items.push(it);
    await changed();
    hideModal('customModal');
    open.add(sec.id); remember();
    renderSections();
    const el = $('it-' + it.id); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // scope
  function openScope() {
    const have = new Set(audit.sections.filter((s) => s.sop).map((s) => s.sop));
    $('scopeEdit').innerHTML = AuditChecklists.sopCatalogue().map((s) => {
      const sec = audit.sections.find((x) => x.sop === s.code);
      const files = sec ? sec.items.reduce((a, it) => a + (it.files || []).length, 0) : 0;
      return `<label class="scope-opt"><input type="checkbox" value="${esc(s.code)}"${have.has(s.code) ? ' checked' : ''}>
        <span><span class="scope-code">${esc(s.code)}</span> ${esc(s.title)}${files ? ` <em class="hint">(${files} file${files === 1 ? '' : 's'})</em>` : ''}</span></label>`;
    }).join('');
    showModal('scopeModal');
  }
  $('btnScopeSave').addEventListener('click', async () => {
    const want = new Set(Array.from($('scopeEdit').querySelectorAll('input:checked')).map((i) => i.value));
    const have = audit.sections.filter((s) => s.sop);
    const removing = have.filter((s) => !want.has(s.sop));
    const losing = removing.reduce((a, s) => a + s.items.reduce((b, it) => b + (it.files || []).length, 0), 0);
    if (removing.length && !confirm('Remove ' + removing.length + ' SOP section(s)?' +
      (losing ? '\n\n' + losing + ' attached file(s) in them will be deleted from this device.' : ''))) return;
    for (const sec of removing) for (const it of sec.items) for (const f of (it.files || [])) await AuditStore.deleteFile(f.id);
    audit.sections = audit.sections.filter((s) => !s.sop || want.has(s.sop));
    const existing = new Set(audit.sections.filter((s) => s.sop).map((s) => s.sop));
    AuditChecklists.sopCatalogue().forEach((s) => {
      if (!want.has(s.code) || existing.has(s.code)) return;
      const next = audit.sections.reduce((m, x) => Math.max(m, Number(x.no) || 0), 0) + 1;
      const sec = AuditChecklists.sectionForSop(audit.role, s.code, next);
      if (sec) audit.sections.push(sec);
    });
    audit.sops = Array.from(want);
    await changed();
    hideModal('scopeModal');
    renderSections(); renderSummary();
  });

  // --------------------------------------------------------------- compile ---

  async function compile(thenUpload) {
    showModal('compileModal');
    const body = $('compileBody'), foot = $('compileFoot');
    $('compileModal').dataset.busy = '1';
    foot.innerHTML = '';
    body.innerHTML = `<p>Building <strong>${esc(AuditPack.packName(audit))}.zip</strong>…</p>
      <div class="meter-track"><div class="meter-fill" id="cBar" style="width:0%;background:var(--navy-700)"></div></div>
      <p class="hint" id="cStep">Reading evidence</p>`;
    try {
      await saving;
      // Captured before building: an edit made while the pack builds must
      // leave the result marked stale.
      const rev = audit.rev || 0;
      const res = await AuditPack.build(audit, {
        onProgress: (p) => {
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
          const bar = $('cBar'); if (bar) bar.style.width = pct + '%';
          const st = $('cStep'); if (st) st.textContent = p.entry ? p.entry.split('/').slice(1).join(' / ') : '';
        }
      });
      compiled = Object.assign(res, { rev: rev });
      // Recording when the pack was built is bookkeeping — the pack itself is
      // already in memory and ready — so the dialog never waits on this write.
      audit.lastCompiled = { at: Date.now(), name: res.fileName, size: res.blob.size };
      save();
      delete $('compileModal').dataset.busy;
      if (thenUpload) { hideModal('compileModal'); openDrive(); return; }
      const url = URL.createObjectURL(res.blob);
      body.innerHTML = `
        <div class="banner banner-ok"><div><strong>Pack ready.</strong> ${res.entries} entries · ${fmtSize(res.blob.size)}</div></div>
        <table class="spec-table">
          <tr><td>File</td><td>${esc(res.fileName)}</td></tr>
          <tr><td>Readiness</td><td>${res.stats.readiness}% (${res.stats.ready}/${res.stats.applicable})</td></tr>
          <tr><td>Evidence files</td><td>${res.stats.files}</td></tr>
          <tr><td>Open Major points</td><td>${res.stats.potentialMajor}</td></tr>
        </table>
        <p class="hint" style="margin-top:12px;">Inside: one folder per S/No., <strong>00 Index.html</strong> linking every file, <strong>00 Checklist.csv</strong> for Excel, and a manifest so the pack can be re-opened here.</p>`;
      foot.innerHTML = `<button class="btn" type="button" data-close>Close</button>
        <a class="btn" href="${url}" download="${esc(res.fileName)}">Download .zip</a>
        <button class="btn btn-primary" type="button" id="cToDrive">Upload to Drive</button>`;
      $('cToDrive').addEventListener('click', () => { hideModal('compileModal'); openDrive(); });
    } catch (e) {
      delete $('compileModal').dataset.busy;
      body.innerHTML = `<div class="banner banner-danger"><div>${esc(e.message)}</div></div>`;
      foot.innerHTML = '<button class="btn" type="button" data-close>Close</button>';
    }
  }

  // ------------------------------------------------------------------ drive --

  // `resolving` guards the loop between the two: renderDrive() starts a lookup
  // when there is no destination yet, and resolveDest() redraws while it looks.
  // Without the flag each redraw would start another lookup, recursively.
  const driveState = { dest: null, busy: false, resolving: false };

  function packIsStale() { return !compiled || compiled.rev !== (audit.rev || 0); }

  function projectSegIndex(cfg) {
    const segs = String(cfg.pathTemplate || '{project}/HSE Audit').split('/').map((s) => s.trim()).filter(Boolean);
    const i = segs.findIndex((s) => /\{project\}/i.test(s));
    return i < 0 ? 0 : i;
  }

  async function openDrive() {
    showModal('driveModal');
    const body = $('driveBody'), foot = $('driveFoot');
    const cfg = GDrive.loadConfig();

    if (!GDrive.isConfigured(cfg)) {
      body.innerHTML = `<div class="banner banner-warn"><div><strong>Google Drive is not set up on this app yet.</strong>
        It needs a Google OAuth Client ID — a one-time setup of about ten minutes in Google Cloud. Until then you can still
        <strong>Compile pack (.zip)</strong> and upload the file to Drive yourself.</div></div>`;
      foot.innerHTML = `<button class="btn" type="button" data-close>Close</button>
        <button class="btn btn-primary" type="button" id="dvCfg">Open Drive settings</button>`;
      $('dvCfg').addEventListener('click', () => { hideModal('driveModal'); openDriveCfg(); });
      return;
    }
    if (packIsStale()) {
      hideModal('driveModal');
      compile(true);
      return;
    }
    driveState.dest = null;
    renderDrive();
  }

  function renderDrive(msg) {
    const cfg = GDrive.loadConfig();
    const segs = GDrive.pathFor(cfg, audit.projectNo);
    const signed = GDrive.isSignedIn();
    const d = driveState.dest;
    const body = $('driveBody'), foot = $('driveFoot');

    const destHtml = !signed ? '<span class="hint">Sign in first.</span>'
      : !d ? '<span class="hint">Checking…</span>'
      : d.error ? `<div class="banner banner-danger"><div>${esc(d.error)}</div></div>`
      : d.needProject ? `<div class="banner banner-warn"><div>
          <strong>Project folder "${esc(d.name)}" not found</strong> in ${esc(cfg.rootFolderName || 'My Drive')}${cfg.scope === 'file' ? ' among the folders this app can see' : ''}.
          ${cfg.scope === 'file' ? '<br>If it already exists (made by hand in Drive), pick it once and the app will remember it.' : ''}
        </div></div>
        <div class="drive-choices">
          <button class="btn btn-primary" type="button" id="dvCreate">Create "${esc(d.name)}"</button>
          <button class="btn" type="button" id="dvPick">Pick the existing folder…</button>
          <button class="btn" type="button" id="dvPaste">Paste its link</button>
        </div>`
      : `<div class="drive-dest">✓ <a href="${esc(GDrive.folderUrl(d.folder.id))}" target="_blank" rel="noopener">${esc(d.pathLabel)}</a>
          ${d.created && d.created.length ? `<span class="hint"> — created ${esc(d.created.join(', '))}</span>` : ''}
          <button type="button" class="linklike" id="dvChange">change</button></div>`;

    body.innerHTML = `
      ${msg ? `<div class="banner ${msg.kind === 'ok' ? 'banner-ok' : 'banner-danger'}"><div>${msg.html}</div></div>` : ''}
      <ol class="drive-steps">
        <li class="${compiled ? 'done' : ''}"><div class="ds-title">Evidence pack</div>
          <div>${esc(compiled.fileName)} · ${fmtSize(compiled.blob.size)} · ${compiled.stats.files} files
          <button type="button" class="linklike" id="dvRecompile">recompile</button></div></li>
        <li class="${signed ? 'done' : ''}"><div class="ds-title">Google account</div>
          <div>${signed ? 'Signed in <button type="button" class="linklike" id="dvSignOut">sign out</button>'
            : '<button class="btn btn-primary btn-sm" type="button" id="dvSignIn">Sign in with Google</button>'}</div></li>
        <li class="${d && d.folder ? 'done' : ''}"><div class="ds-title">Destination</div>
          <div class="hint">Path: ${esc(cfg.rootFolderName || 'My Drive')} / ${segs.map(esc).join(' / ')}</div>
          <div>${destHtml}</div></li>
        <li id="dvUploadStep"><div class="ds-title">Upload</div>
          <div id="dvProgress" class="hint">${d && d.folder ? 'Ready to upload.' : 'Complete the steps above.'}</div></li>
      </ol>`;

    foot.innerHTML = `<button class="btn" type="button" id="dvSettings">Drive settings</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" type="button" data-close>Close</button>
      <button class="btn btn-primary" type="button" id="dvUpload"${d && d.folder && !driveState.busy ? '' : ' disabled'}>Upload pack</button>`;

    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('dvSettings', () => { hideModal('driveModal'); openDriveCfg(); });
    on('dvRecompile', () => { hideModal('driveModal'); compile(true); });
    on('dvSignIn', async () => {
      try { await GDrive.signIn(); renderDrive(); resolveDest(false); }
      catch (e) { renderDrive({ kind: 'err', html: esc(e.message) }); }
    });
    on('dvSignOut', () => { GDrive.signOut(); driveState.dest = null; renderDrive(); });
    on('dvCreate', () => resolveDest(true));
    on('dvPick', pickProjectFolder);
    on('dvPaste', pasteProjectFolder);
    on('dvChange', () => { driveState.dest = { needProject: true, name: audit.projectNo }; renderDrive(); });
    on('dvUpload', doUpload);

    if (signed && !d && !driveState.resolving) resolveDest(false);
  }

  async function resolveDest(createProject) {
    const cfg = GDrive.loadConfig();
    const segs = GDrive.pathFor(cfg, audit.projectNo);
    const pi = Math.min(projectSegIndex(cfg), segs.length - 1);
    const base = cfg.rootFolderId || 'root';
    if (driveState.resolving) return;
    driveState.resolving = true;
    driveState.dest = null;
    renderDrive();
    try {
      let project = null;
      const created = [];
      const cached = cfg.projectFolders && cfg.projectFolders[audit.projectNo];
      if (cached && cached.id) {
        try { project = await GDrive.getFolder(cached.id); }
        catch (e) { delete cfg.projectFolders[audit.projectNo]; GDrive.saveConfig(cfg); }
      }
      if (!project) {
        const r = await GDrive.resolvePath(base, segs.slice(0, pi + 1), (i) => i < pi || createProject);
        if (!r.ok) { driveState.dest = { needProject: true, name: r.missingName, parentId: r.parentId }; renderDrive(); return; }
        r.trail.forEach((f) => { if (f.created) created.push(f.name); });
        project = r.folder;
        cfg.projectFolders = cfg.projectFolders || {};
        cfg.projectFolders[audit.projectNo] = { id: project.id, name: project.name };
        GDrive.saveConfig(cfg);
      }
      const rest = segs.slice(pi + 1);
      const r2 = await GDrive.resolvePath(project.id, rest, true);
      r2.trail.forEach((f) => { if (f.created) created.push(f.name); });
      driveState.dest = {
        folder: r2.folder.id ? r2.folder : project,
        project: project,
        created: created,
        pathLabel: [project.name].concat(rest).join(' / ')
      };
    } catch (e) {
      driveState.dest = { error: e.message };
    } finally {
      driveState.resolving = false;
    }
    renderDrive();
  }

  async function pickProjectFolder() {
    try {
      const f = await GDrive.pickFolder('Pick the folder for project ' + audit.projectNo);
      if (!f) return;
      rememberProjectFolder(f);
    } catch (e) { renderDrive({ kind: 'err', html: esc(e.message) }); }
  }
  async function pasteProjectFolder() {
    const s = prompt('Paste the Google Drive link of the "' + audit.projectNo + '" folder:');
    const id = GDrive.parseFolderRef(s);
    if (!s) return;
    if (!id) { renderDrive({ kind: 'err', html: 'That does not look like a Drive folder link.' }); return; }
    try { rememberProjectFolder(await GDrive.getFolder(id)); }
    catch (e) { renderDrive({ kind: 'err', html: esc(e.message) }); }
  }
  function rememberProjectFolder(f) {
    const cfg = GDrive.loadConfig();
    cfg.projectFolders = cfg.projectFolders || {};
    cfg.projectFolders[audit.projectNo] = { id: f.id, name: f.name };
    GDrive.saveConfig(cfg);
    resolveDest(false);
  }

  async function doUpload() {
    const d = driveState.dest;
    if (!d || !d.folder || driveState.busy) return;
    driveState.busy = true;
    $('dvUpload').disabled = true;
    const prog = $('dvProgress');
    prog.innerHTML = '<div class="meter-track"><div class="meter-fill" id="dvBar" style="width:0%;background:var(--navy-700)"></div></div><span id="dvPct">Starting…</span>';
    // Two uploads on the same day would otherwise sit side by side in Drive
    // with identical names.
    let name = compiled.fileName;
    const prev = audit.drive && audit.drive.lastUpload;
    if (prev && prev.name === name) {
      const t = new Date();
      name = name.replace(/\.zip$/i, '') + ' ' + String(t.getHours()).padStart(2, '0') + String(t.getMinutes()).padStart(2, '0') + '.zip';
    }
    try {
      const file = await GDrive.upload(compiled.blob, name, d.folder.id, (done, total) => {
        const pct = Math.round((done / total) * 100);
        const bar = $('dvBar'); if (bar) bar.style.width = pct + '%';
        const t = $('dvPct'); if (t) t.textContent = pct + '% · ' + fmtSize(done) + ' of ' + fmtSize(total);
      });
      audit.drive = audit.drive || {};
      audit.drive.lastUpload = {
        fileId: file.id, name: file.name || name, webViewLink: file.webViewLink || '',
        folderId: d.folder.id, folderPath: d.pathLabel, size: compiled.blob.size, at: Date.now()
      };
      // The file is already safely in Drive; recording that locally must not
      // hold up telling the user.
      save();
      renderSummary();
      driveState.busy = false;
      renderDrive({
        kind: 'ok',
        html: `<strong>Uploaded.</strong> <a href="${esc(file.webViewLink || GDrive.folderUrl(d.folder.id))}" target="_blank" rel="noopener">${esc(file.name || name)}</a>
          in <a href="${esc(GDrive.folderUrl(d.folder.id))}" target="_blank" rel="noopener">${esc(d.pathLabel)}</a>.`
      });
    } catch (e) {
      driveState.busy = false;
      renderDrive({ kind: 'err', html: esc(e.message) });
    }
  }

  // Drive settings
  function openDriveCfg() {
    const c = GDrive.loadConfig();
    $('gClientId').value = c.clientId || '';
    $('gApiKey').value = c.apiKey || '';
    $('gAppId').value = c.appId || '';
    $('gPath').value = c.pathTemplate || '{project}/HSE Audit';
    document.querySelectorAll('input[name="gScope"]').forEach((r) => { r.checked = r.value === (c.scope || 'file'); });
    $('gBaseName').textContent = c.rootFolderName || 'My Drive';
    $('gBaseName').dataset.id = c.rootFolderId || 'root';
    $('gOrigin').textContent = $('gOrigin2').textContent = location.origin;
    $('gProjHint').textContent = (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.projectId) || 'your project';
    showModal('driveCfgModal');
  }
  $('driveCfgForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = GDrive.loadConfig();
    const scope = (document.querySelector('input[name="gScope"]:checked') || {}).value || 'file';
    if (scope !== c.scope) GDrive.signOut(); // a different scope needs a fresh consent
    Object.assign(c, {
      clientId: $('gClientId').value.trim(), apiKey: $('gApiKey').value.trim(), appId: $('gAppId').value.trim(),
      scope: scope, pathTemplate: $('gPath').value.trim() || '{project}/HSE Audit',
      rootFolderId: $('gBaseName').dataset.id || 'root', rootFolderName: $('gBaseName').textContent || 'My Drive'
    });
    if (!/\{project\}/i.test(c.pathTemplate)) { alert('The folder path must contain {project}, so each project gets its own folder.'); return; }
    GDrive.saveConfig(c);
    hideModal('driveCfgModal');
  });
  $('gBasePick').addEventListener('click', async () => {
    // Save what has been typed so far — the picker needs the Client ID and key.
    const c = GDrive.loadConfig();
    Object.assign(c, { clientId: $('gClientId').value.trim(), apiKey: $('gApiKey').value.trim(), appId: $('gAppId').value.trim() });
    GDrive.saveConfig(c);
    try {
      const f = await GDrive.pickFolder('Choose the base folder for project folders');
      if (f) { $('gBaseName').textContent = f.name; $('gBaseName').dataset.id = f.id; }
    } catch (e) { alert(e.message); }
  });
  $('gBasePaste').addEventListener('click', async () => {
    const s = prompt('Paste the Google Drive link of the base folder:');
    if (!s) return;
    const id = GDrive.parseFolderRef(s);
    if (!id) { alert('That does not look like a Drive folder link.'); return; }
    const c = GDrive.loadConfig();
    Object.assign(c, { clientId: $('gClientId').value.trim(), apiKey: $('gApiKey').value.trim() });
    GDrive.saveConfig(c);
    try {
      await GDrive.signIn();
      const f = await GDrive.getFolder(id);
      $('gBaseName').textContent = f.name; $('gBaseName').dataset.id = f.id;
    } catch (e) { alert(e.message); }
  });
  $('gBaseReset').addEventListener('click', () => { $('gBaseName').textContent = 'My Drive'; $('gBaseName').dataset.id = 'root'; });

  // ------------------------------------------------------------------- boot --

  async function init() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) { location.replace('audits.html'); return; }
    try { audit = await AuditStore.getAudit(id); }
    catch (e) { showError(e.message); return; }
    if (!audit) {
      showError('This audit is not on this device. It may have been deleted, or created on another device — open its pack (.zip) from the audit list to bring it here.');
      return;
    }
    recall();
    if (!open.size && audit.sections[0]) open.add(audit.sections[0].id);
    renderHeader();
    renderSummary();
    renderSections();
    wireSections();

    ['fSearch'].forEach((i) => $(i).addEventListener('input', applyFilters));
    ['fStatus', 'fNc'].forEach((i) => $(i).addEventListener('change', applyFilters));
    $('btnExpand').addEventListener('click', () => { audit.sections.forEach((s) => open.add(s.id)); remember(); renderSections(); });
    $('btnCollapse').addEventListener('click', () => { open.clear(); remember(); renderSections(); });
    $('btnViewAll').addEventListener('click', () => { const e = allEntries(); if (!e.length) { alert('No evidence attached yet.'); return; } viewFile(e[0].id); });
    $('btnScope').addEventListener('click', openScope);
    $('btnDetails').addEventListener('click', openDetails);
    $('btnCompile').addEventListener('click', () => compile(false));
    $('btnDrive').addEventListener('click', openDrive);
    // A closed <details> hides its contents whatever the CSS says, so the
    // expected-evidence lists are opened for the print and closed after —
    // via beforeprint/afterprint so Ctrl+P prints the full checklist too.
    let openedForPrint = [];
    window.addEventListener('beforeprint', () => {
      document.body.classList.add('print-all');
      openedForPrint = Array.from(document.querySelectorAll('details.aitem-expect:not([open])'));
      openedForPrint.forEach((d) => { d.open = true; });
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('print-all');
      openedForPrint.forEach((d) => { d.open = false; });
      openedForPrint = [];
    });
    $('btnPrint').addEventListener('click', () => window.print());
  }

  init();
})();
