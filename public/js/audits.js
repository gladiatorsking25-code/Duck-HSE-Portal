// audits.js — the audit list page (audits.html): create, open, delete, and
// open compiled packs.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let audits = [];
  let openedPack = null;

  // ---------------------------------------------------------------- modals --

  function showModal(id) { $(id).hidden = false; }
  function hideModal(id) { $(id).hidden = true; }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const m = c.closest('.modal-backdrop'); if (m) m.hidden = true; }
    if (e.target.classList && e.target.classList.contains('modal-backdrop') && !e.target.classList.contains('viewer-backdrop')) e.target.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-backdrop:not([hidden]):not(.viewer-backdrop)').forEach((m) => { m.hidden = true; });
  });

  // ------------------------------------------------------------------ list --

  async function load() {
    try {
      audits = await AuditStore.listAudits();
    } catch (e) {
      $('auditList').innerHTML = `<div class="banner banner-danger"><div>${esc(e.message)}</div></div>`;
      return;
    }
    render();
    const u = await AuditStore.usage();
    if (u.quota) $('storageNote').textContent = 'Device storage: ' + AuditViewer.fmtSize(u.used) + ' of ' + AuditViewer.fmtSize(u.quota) + ' used';
  }

  function render() {
    const q = ($('auditSearch').value || '').toLowerCase();
    const role = $('auditRole').value;
    const list = audits.filter((a) => (!role || a.role === role) &&
      (!q || [a.projectNo, a.projectTitle, a.company, a.auditType].join(' ').toLowerCase().includes(q)));

    if (!audits.length) {
      $('auditList').innerHTML = `<div class="card empty-state"><div class="icon">🗂️</div>
        No audits yet. <button class="btn btn-sm btn-primary" type="button" id="btnNewEmpty" style="margin-left:8px;">Create the first one</button></div>`;
      $('btnNewEmpty').addEventListener('click', openNew);
      return;
    }
    if (!list.length) { $('auditList').innerHTML = '<div class="card empty-state">No audits match.</div>'; return; }

    $('auditList').innerHTML = `<div class="audit-cards">${list.map((a) => {
      const s = AuditPack.stats(a);
      const up = a.drive && a.drive.lastUpload;
      return `<div class="audit-card">
        <div class="audit-card-top">
          <span class="badge ${a.role === 'consultant' ? 'badge-consultant' : 'badge-contractor'}">${a.role === 'consultant' ? 'Consultant' : 'Contractor'}</span>
          <span class="audit-card-date">${esc(a.auditDate ? 'Audit ' + a.auditDate : 'No audit date')}</span>
        </div>
        <a class="audit-card-title" href="audit.html?id=${encodeURIComponent(a.id)}">${esc(a.projectNo)}</a>
        <div class="audit-card-sub">${esc(a.projectTitle || a.auditType || '')}</div>
        <div class="meter-track"><div class="meter-fill" style="width:${s.readiness}%;background:${s.readiness >= 80 ? 'var(--ok-green)' : s.readiness >= 50 ? 'var(--amber)' : 'var(--danger-red)'}"></div></div>
        <div class="audit-card-stats">
          <span><strong>${s.readiness}%</strong> ready</span>
          <span><strong>${s.ready}</strong>/${s.applicable} points</span>
          <span><strong>${s.files}</strong> files</span>
          <span class="${s.potentialMajor ? 'txt-bad' : ''}"><strong>${s.potentialMajor}</strong> open Major</span>
        </div>
        <div class="audit-card-foot">
          <span class="hint">${up ? '☁ Uploaded ' + esc(new Date(up.at).toLocaleDateString()) : 'Not uploaded yet'} · updated ${esc(new Date(a.updatedAt || a.createdAt).toLocaleDateString())}</span>
          <span class="audit-card-actions">
            <a class="btn btn-sm btn-primary" href="audit.html?id=${encodeURIComponent(a.id)}">Open</a>
            <button class="btn btn-sm btn-danger" type="button" data-del="${esc(a.id)}">Delete</button>
          </span>
        </div>
      </div>`;
    }).join('')}</div>`;

    $('auditList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const a = audits.find((x) => x.id === b.getAttribute('data-del'));
      if (!a) return;
      const s = AuditPack.stats(a);
      if (!confirm(`Delete the ${a.role} audit for ${a.projectNo}?\n\nThis removes the checklist and all ${s.files} evidence file(s) from this device. ` +
        `Anything already uploaded to Google Drive is not affected. This cannot be undone.`)) return;
      await AuditStore.deleteAudit(a.id);
      load();
    }));
  }

  // ------------------------------------------------------------ new audit --

  function scopeFor(role) {
    return AuditChecklists.sopCatalogue();
  }

  function renderScope(role, selected) {
    const sel = new Set(selected || AuditChecklists.defaultSops(role));
    $('scopeGrid').innerHTML = scopeFor(role).map((s) => `
      <label class="scope-opt"><input type="checkbox" value="${esc(s.code)}"${sel.has(s.code) ? ' checked' : ''}>
        <span><span class="scope-code">${esc(s.code)}</span> ${esc(s.title)}</span></label>`).join('');
    updateScopeCount();
  }
  function selectedScope() {
    return Array.from($('scopeGrid').querySelectorAll('input:checked')).map((i) => i.value);
  }
  function updateScopeCount() {
    $('scopeCount').textContent = '(' + selectedScope().length + ' selected)';
  }
  function currentRole() {
    const r = document.querySelector('input[name="role"]:checked');
    return r ? r.value : 'contractor';
  }

  function openNew() {
    $('newForm').reset();
    $('fClient').value = 'TAQA Water Solutions';
    renderScope(currentRole());
    showModal('newModal');
    setTimeout(() => $('fProjectNo').focus(), 50);
  }

  async function create(e) {
    e.preventDefault();
    const projectNo = $('fProjectNo').value.trim();
    if (!projectNo) { $('fProjectNo').focus(); return; }
    const role = currentRole();
    const audit = {
      id: 'AUD-' + Date.now().toString(36).toUpperCase(),
      role: role,
      projectNo: projectNo,
      projectTitle: $('fProjectTitle').value.trim(),
      company: $('fCompany').value.trim(),
      client: $('fClient').value.trim() || 'TAQA Water Solutions',
      auditType: $('fAuditType').value,
      auditDate: $('fAuditDate').value,
      auditors: $('fAuditors').value.trim(),
      preparedBy: $('fPreparedBy').value.trim(),
      shrinkPhotos: $('fShrink').checked,
      sops: selectedScope(),
      sections: AuditChecklists.build(role, selectedScope()),
      createdAt: Date.now(),
      drive: {}
    };
    await AuditStore.saveAudit(audit);
    AuditStore.requestPersist();
    location.href = 'audit.html?id=' + encodeURIComponent(audit.id);
  }

  // ------------------------------------------------------------ open pack --

  async function openPack(file) {
    $('packBody').innerHTML = '<p>Reading ' + esc(file.name) + '…</p>';
    showModal('packModal');
    try {
      openedPack = await AuditPack.read(file);
    } catch (e) {
      openedPack = null;
      $('packBody').innerHTML = `<div class="banner banner-danger"><div>${esc(e.message)}</div></div>`;
      $('btnPackView').hidden = $('btnPackImport').hidden = true;
      return;
    }
    const a = openedPack.audit;
    const s = AuditPack.stats(a);
    const exists = audits.find((x) => x.id === a.id);
    $('btnPackView').hidden = $('btnPackImport').hidden = false;
    $('packBody').innerHTML = `
      <table class="spec-table">
        <tr><td>Project</td><td>${esc(a.projectNo)}</td></tr>
        <tr><td>Prepared as</td><td>${esc(a.role === 'consultant' ? 'Consultant' : 'Contractor')}</td></tr>
        <tr><td>Audit date</td><td>${esc(a.auditDate || '—')}</td></tr>
        <tr><td>Readiness</td><td>${s.readiness}% (${s.ready}/${s.applicable})</td></tr>
        <tr><td>Evidence files</td><td>${openedPack.files.length}</td></tr>
        <tr><td>Compiled</td><td>${esc(new Date(openedPack.manifest.generated).toLocaleString())}</td></tr>
      </table>
      ${exists ? '<div class="banner banner-warn" style="margin-top:14px;"><div>This audit is already on this device. Importing adds it as a <strong>separate copy</strong> — your existing one is not changed.</div></div>' : ''}
      <p class="hint" style="margin-top:12px;">View the files straight from the pack, or import it to keep working on it here.</p>`;
  }

  function viewPack() {
    if (!openedPack) return;
    const a = openedPack.audit;
    const entries = [];
    a.sections.forEach((sec) => sec.items.forEach((it) => {
      openedPack.files.filter((f) => f.itemId === it.id).forEach((f) => {
        const meta = (it.files || []).find((m) => m.id === f.fileId) || {};
        entries.push({ name: f.path.split('/').pop(), type: meta.type, size: meta.size, addedAt: meta.addedAt,
          label: 'S/No. ' + it.no + ' — ' + it.text, path: f.path });
      });
    }));
    if (!entries.length) { alert('This pack has no evidence files.'); return; }
    hideModal('packModal');
    AuditViewer.open(entries, 0, { getBlob: async (e) => openedPack.bytesFor(e.path) });
  }

  async function importPack() {
    if (!openedPack) return;
    const btn = $('btnPackImport');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const src = openedPack.audit;
      const exists = audits.find((x) => x.id === src.id);
      const audit = JSON.parse(JSON.stringify(src));
      if (exists) { audit.id = 'AUD-' + Date.now().toString(36).toUpperCase(); audit.projectTitle = (audit.projectTitle || '') + ' (imported copy)'; }
      audit.drive = {};
      // File ids are re-issued so an imported copy can never collide with, or
      // delete, files belonging to the original. The pack comes from someone
      // else, so each file's type is worked out from its name, not taken from
      // the pack, and only web (http/https) links are kept.
      for (const sec of audit.sections) {
        for (const it of sec.items) {
          const kept = [];
          for (const meta of (it.files || [])) {
            const entry = openedPack.files.find((f) => f.itemId === it.id && f.fileId === meta.id);
            const blob = entry ? openedPack.bytesFor(entry.path) : null;
            if (!blob) continue;
            const id = AuditChecklists.uid('f');
            const type = AuditViewer.safeType(meta.name);
            await AuditStore.putFile({ id: id, auditId: audit.id, itemId: it.id, name: meta.name, type: type,
              size: blob.size, blob: new Blob([blob], { type: type }), addedAt: meta.addedAt || Date.now() });
            kept.push(Object.assign({}, meta, { id: id, type: type, size: blob.size }));
          }
          it.files = kept;
          it.links = (Array.isArray(it.links) ? it.links : []).filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url));
        }
      }
      audit.createdAt = audit.createdAt || Date.now();
      await AuditStore.saveAudit(audit);
      location.href = 'audit.html?id=' + encodeURIComponent(audit.id);
    } catch (e) {
      alert('Import failed: ' + e.message);
      btn.disabled = false; btn.textContent = 'Import to this device';
    }
  }

  // ------------------------------------------------------------------ boot --

  $('btnNew').addEventListener('click', openNew);
  $('newForm').addEventListener('submit', create);
  document.querySelectorAll('input[name="role"]').forEach((r) => r.addEventListener('change', () => renderScope(currentRole())));
  $('scopeGrid').addEventListener('change', updateScopeCount);
  $('scopeDefault').addEventListener('click', () => renderScope(currentRole()));
  $('scopeAll').addEventListener('click', () => renderScope(currentRole(), AuditChecklists.sopCatalogue().map((s) => s.code)));
  $('scopeNone').addEventListener('click', () => renderScope(currentRole(), []));
  $('auditSearch').addEventListener('input', render);
  $('auditRole').addEventListener('change', render);
  $('btnOpenPack').addEventListener('click', () => $('packInput').click());
  $('packInput').addEventListener('change', () => {
    const f = $('packInput').files && $('packInput').files[0];
    $('packInput').value = '';
    if (f) openPack(f);
  });
  $('btnPackView').addEventListener('click', viewPack);
  $('btnPackImport').addEventListener('click', importPack);

  load();
})();
