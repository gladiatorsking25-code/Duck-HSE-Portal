// project-files.js — a project's files, photos and backups (project.html).
//
// The files themselves live in the portal's Google Drive; only the Cloud
// Functions (functions/project-drive.js) can reach it. This page lists what
// Firestore says is there, and uploads and downloads through those functions,
// so team members never need a Google account or Drive access of their own.
//
// File names and notes were typed by teammates: they are rendered escaped. A
// downloaded file is only ever shown on screen when it is a photo (in an <img>);
// everything else is saved to the device, never opened as a page here.

const ProjectFiles = (function () {
  'use strict';

  // Must match functions/files.js.
  const MAX_FILE_BYTES = 7 * 1024 * 1024;
  const EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'doc', 'docx', 'xls', 'xlsx',
    'ppt', 'pptx', 'odt', 'ods', 'msg', 'eml', 'rtf', 'csv', 'txt', 'dwg', 'dxf'];
  const VIEWABLE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  const CATEGORIES = {
    document: 'Document', photo: 'Photo', drawing: 'Drawing', certificate: 'Certificate', report: 'Report', other: 'Other'
  };
  const BACKUP_KINDS = { auto: 'Daily', manual: 'Manual', restore_point: 'Before restore' };
  // Photos bigger than this are made smaller before upload.
  const SHRINK_OVER = 2 * 1024 * 1024;
  const SHRINK_EDGE = 2400;

  const esc = (v) => Projects.esc(v);
  const $ = (id) => document.getElementById(id);

  function extOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fmtWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function col(projectId, name) { return firebase.firestore().collection('projects').doc(projectId).collection(name); }
  async function call(name, data, timeout) {
    await Projects.ready();
    try {
      const res = await firebase.functions().httpsCallable(name, { timeout: timeout || 120000 })(data);
      return res.data;
    } catch (e) {
      const msg = e && e.message && e.message !== 'internal' ? e.message : 'The request failed. Check the connection and try again.';
      throw Object.assign(new Error(msg), { code: e && e.code });
    }
  }

  // ---- Preparing a file for upload ------------------------------------------------

  function readBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => reject(new Error('Could not read the file from this device.'));
      r.readAsDataURL(blob);
    });
  }

  async function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open the photo.')); };
      img.src = url;
    });
  }

  // Large JPEG/PNG/WebP photos are redrawn at no more than 2400 px on the long
  // side, as JPEG. That keeps them readable while saving space, and it drops
  // the hidden location data phones put in photos.
  async function shrinkPhoto(file) {
    const ext = extOf(file.name);
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext) || file.size <= SHRINK_OVER) return { blob: file, name: file.name };
    const img = await loadImage(file);
    const w = img.width, h = img.height;
    const scale = Math.min(1, SHRINK_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  }

  // Checks the app can make before sending anything. The server checks again.
  function precheck(file) {
    const ext = extOf(file.name);
    if (!ext || !EXTENSIONS.includes(ext)) {
      return `${file.name}: files of this type cannot be added. Allowed: PDF, photos (JPG, PNG, WebP, GIF, HEIC), Word, Excel, PowerPoint, OpenDocument, Outlook emails, RTF, CSV, text and drawings (DWG, DXF).`;
    }
    if (!file.size) return `${file.name} is empty.`;
    return '';
  }

  async function upload(projectId, file, opts) {
    const problem = precheck(file);
    if (problem) throw new Error(problem);
    const prepared = await shrinkPhoto(file);
    if (prepared.blob.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name} is ${fmtSize(prepared.blob.size)}. Files can be at most 7 MB. Save a smaller copy (for example, a compressed PDF) and try again.`);
    }
    const data = await readBase64(prepared.blob);
    return call('projectFileUpload', {
      projectId, name: prepared.name, size: prepared.blob.size, data,
      category: opts.category || '', note: opts.note || '', itemId: opts.itemId || ''
    }, 180000);
  }

  function toBlob(res, type) {
    const bin = atob(res.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---- The panel on project.html -----------------------------------------------

  let ctx = null;            // { projectId, project(), uid(), items(), friendly(err) }
  let files = [];
  let backups = [];
  let stopBackups = null;
  let presetItem = '';

  function canEdit() { const p = ctx.project(); return Projects.can.edit(p, ctx.uid()) && p.status !== 'archived'; }
  function canManage() { return Projects.can.manage(ctx.project(), ctx.uid()); }
  function canDelete(f) {
    const p = ctx.project();
    if (p.status === 'archived') return false;
    return canManage() || (Projects.can.edit(p, ctx.uid()) && f.uploadedBy === ctx.uid());
  }
  function who(uidv, email) {
    const p = ctx.project();
    return (p.memberEmails && p.memberEmails[uidv]) || email || 'Former member';
  }
  function itemTitle(id) {
    const it = ctx.items().find((i) => i.id === id);
    return it ? it.title : '';
  }

  function banner(host, kind, text) {
    host.innerHTML = '';
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'banner banner-' + kind;
    d.style.margin = '10px 0';
    d.textContent = text;
    host.appendChild(d);
  }

  function actionsFor(f) {
    const ext = extOf(f.name);
    return `${VIEWABLE[ext] ? `<button class="btn btn-sm" type="button" data-view="${esc(f.id)}">View</button>` : ''}
      <button class="btn btn-sm" type="button" data-download="${esc(f.id)}">Download</button>
      ${canDelete(f) ? `<button class="btn btn-sm btn-danger" type="button" data-delete-file="${esc(f.id)}">Delete</button>` : ''}`;
  }

  function filtered() {
    const q = $('fileSearch').value.trim().toLowerCase();
    const cat = $('fileCategory').value;
    return files.filter((f) => (!cat || f.category === cat) &&
      (!q || `${f.name} ${f.note || ''} ${itemTitle(f.itemId)}`.toLowerCase().includes(q)));
  }

  function renderFiles() {
    if (!ctx || !ctx.project()) return;
    $('addFileBtn').hidden = !canEdit();
    const host = $('filesTable');
    const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
    $('filesFoot').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'}, ${fmtSize(total)} in total.` : '';
    if (!files.length) {
      host.innerHTML = `<div class="card empty-state"><div class="icon">📎</div>No files yet.${canEdit() ? ' Add method statements, risk assessments, certificates, drawings and site photos.' : ''}</div>`;
      return;
    }
    const list = filtered();
    if (!list.length) { host.innerHTML = '<div class="card empty-state">No files match these filters.</div>'; return; }
    host.innerHTML = `<div class="table-scroll"><table class="data-table file-table">
      <thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Added</th><th></th></tr></thead>
      <tbody>${list.map((f) => {
        const linked = f.itemId ? itemTitle(f.itemId) : '';
        return `<tr>
          <td><div class="item-title">${esc(f.name)}</div>${f.note || linked ? `<div class="item-sub">${esc([f.note, linked && 'Item: ' + linked].filter(Boolean).join(' · '))}</div>` : ''}</td>
          <td>${esc(CATEGORIES[f.category] || f.category)}</td>
          <td class="num">${esc(fmtSize(f.size))}</td>
          <td><div class="item-sub">${esc(who(f.uploadedBy, f.uploadedByEmail))}<br>${esc(fmtWhen(Projects.millis(f.uploadedAt)))}</div></td>
          <td class="file-actions">${actionsFor(f)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // Files linked to one tracked item, for the item window.
  function renderItemFiles(itemId) {
    const host = $('itemFiles');
    if (!host) return;
    if (!itemId) { host.innerHTML = ''; return; }
    const mine = files.filter((f) => f.itemId === itemId);
    host.innerHTML = `<div class="section-title" style="margin:14px 0 6px; font-size:13px;">Files for this item</div>
      ${mine.length ? `<ul class="member-list">${mine.map((f) => `<li><span class="m-email">${esc(f.name)} <span class="item-sub">${esc(fmtSize(f.size))}</span></span>
        <span class="m-actions">${actionsFor(f)}</span></li>`).join('')}</ul>` : '<div class="item-sub">None yet.</div>'}
      ${canEdit() ? `<button class="btn btn-sm" type="button" data-attach="${esc(itemId)}" style="margin-top:8px;">Attach a file</button>` : ''}`;
  }

  function renderBackups() {
    const card = $('backupCard');
    if (!ctx || !ctx.project()) return;
    card.hidden = !canManage();
    if (card.hidden) return;
    const archived = ctx.project().status === 'archived';
    $('backupNowBtn').hidden = archived;
    $('backupList').innerHTML = backups.length ? backups.map((b) => `<li>
        <span class="m-email">${esc(fmtWhen(b.createdAtMs))}<br><span class="item-sub">${esc(BACKUP_KINDS[b.kind] || b.kind)} · ${esc(b.itemCount)} item${b.itemCount === 1 ? '' : 's'} · ${esc(b.fileCount)} file${b.fileCount === 1 ? '' : 's'}</span></span>
        <span class="m-actions">
          <button class="btn btn-sm" type="button" data-backup-download="${esc(b.id)}">Download</button>
          ${archived ? '' : `<button class="btn btn-sm" type="button" data-restore="${esc(b.id)}">Restore items</button>`}
        </span></li>`).join('')
      : '<li class="item-sub">No backups yet. The first daily backup runs tonight.</li>';
  }

  function openUpload(itemId) {
    presetItem = itemId || '';
    $('fFiles').value = '';
    $('fNote').value = '';
    $('fCategory').value = 'auto';
    $('fItem').innerHTML = '<option value="">No item</option>' + ctx.items()
      .filter((i) => i.status !== 'closed' || i.id === presetItem)
      .map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
    $('fItem').value = presetItem;
    banner($('fileFormMsg'), '', '');
    $('fileModal').hidden = false;
    $('fFiles').focus();
  }

  async function submitUpload(e) {
    e.preventDefault();
    const picked = Array.from($('fFiles').files || []);
    if (!picked.length) { banner($('fileFormMsg'), 'danger', 'Choose at least one file.'); return; }
    const problems = picked.map(precheck).filter(Boolean);
    if (problems.length) { banner($('fileFormMsg'), 'danger', problems.join(' ')); return; }
    const cat = $('fCategory').value;
    const opts = { note: $('fNote').value.trim(), itemId: $('fItem').value };
    $('fileSaveBtn').disabled = true;
    const failed = [];
    let done = 0;
    for (const file of picked) {
      banner($('fileFormMsg'), 'info', `Uploading ${file.name} (${done + 1} of ${picked.length})…`);
      try {
        const category = cat === 'auto' ? (VIEWABLE[extOf(file.name)] || /^hei[cf]$/.test(extOf(file.name)) ? 'photo'
          : /^(dwg|dxf)$/.test(extOf(file.name)) ? 'drawing' : 'document') : cat;
        await upload(ctx.projectId, file, Object.assign({ category }, opts));
        done++;
      } catch (err) { failed.push(`${file.name}: ${err.message}`); }
    }
    $('fileSaveBtn').disabled = false;
    if (failed.length) {
      banner($('fileFormMsg'), 'danger', (done ? `${done} uploaded. ` : '') + failed.join(' '));
    } else {
      $('fileModal').hidden = true;
      banner($('filesMsg'), 'ok', done === 1 ? 'File added.' : `${done} files added.`);
    }
  }

  async function withMsg(host, fn, working) {
    banner(host, 'info', working);
    try { await fn(); banner(host, '', ''); }
    catch (err) { banner(host, 'danger', ctx.friendly(err)); }
  }

  async function download(fileId, show) {
    const f = files.find((x) => x.id === fileId);
    const res = await call('projectFileDownload', { projectId: ctx.projectId, fileId });
    const viewType = VIEWABLE[extOf(res.name)];
    if (show && viewType) {
      const blob = toBlob(res, viewType);
      const img = $('viewImg');
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      img.alt = res.name;
      $('viewTitle').textContent = res.name;
      $('viewDownload').onclick = () => saveBlob(blob, res.name);
      $('viewModal').hidden = false;
      return;
    }
    // Saved as a plain download, never opened as a page in this site.
    saveBlob(toBlob(res, 'application/octet-stream'), (f && f.name) || res.name);
  }

  function onClick(e) {
    const t = e.target;
    const view = t.closest('[data-view]');
    const dl = t.closest('[data-download]');
    const del = t.closest('[data-delete-file]');
    const attach = t.closest('[data-attach]');
    const host = t.closest('#itemModal') ? $('itemFormError') : $('filesMsg');
    if (view) withMsg(host, () => download(view.dataset.view, true), 'Opening…');
    else if (dl) withMsg(host, () => download(dl.dataset.download, false), 'Downloading…');
    else if (del) {
      const f = files.find((x) => x.id === del.dataset.deleteFile);
      if (!f || !confirm(`Delete ${f.name}? It goes to the Drive trash, where the portal owner can recover it for 30 days.`)) return;
      withMsg(host, () => call('projectFileDelete', { projectId: ctx.projectId, fileId: f.id }), 'Deleting…');
    } else if (attach) {
      openUpload(attach.dataset.attach);
    }
  }

  async function onBackupClick(e) {
    const dl = e.target.closest('[data-backup-download]');
    const rs = e.target.closest('[data-restore]');
    const msg = $('backupMsg');
    if (dl) {
      withMsg(msg, async () => {
        const res = await call('projectBackupDownload', { projectId: ctx.projectId, backupId: dl.dataset.backupDownload });
        saveBlob(toBlob(res, 'application/json'), res.name);
      }, 'Downloading…');
    } else if (rs) {
      const b = backups.find((x) => x.id === rs.dataset.restore);
      if (!b || !confirm(`Put the tracked items back as they were on ${fmtWhen(b.createdAtMs)}?\n\n` +
        'Items changed since then go back to how they were, and items added since then are removed. ' +
        'The team, files and activity log are not changed. A backup of how things are now is made first, so you can undo this.')) return;
      banner(msg, 'info', 'Restoring…');
      try {
        const r = await call('projectRestoreItems', { projectId: ctx.projectId, backupId: b.id }, 300000);
        banner(msg, 'ok', `Restored ${r.restored} item${r.restored === 1 ? '' : 's'}${r.removed ? ` and removed ${r.removed} added since` : ''}. A backup from just before the restore is in the list.`);
      } catch (err) { banner(msg, 'danger', ctx.friendly(err)); }
    }
  }

  function init(context) {
    ctx = context;
    $('fileCategory').innerHTML = '<option value="">All kinds</option>' +
      Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('fCategory').innerHTML = '<option value="auto">Work it out from the file</option>' +
      Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('fFiles').setAttribute('accept', EXTENSIONS.map((x) => '.' + x).join(',') + ',image/*');
    ['fileSearch', 'fileCategory'].forEach((id) => $(id).addEventListener(id === 'fileSearch' ? 'input' : 'change', renderFiles));
    $('addFileBtn').addEventListener('click', () => openUpload(''));
    $('fileForm').addEventListener('submit', submitUpload);
    $('filesTable').addEventListener('click', onClick);
    $('itemModal').addEventListener('click', onClick);
    $('backupList').addEventListener('click', onBackupClick);
    $('backupNowBtn').addEventListener('click', async () => {
      $('backupNowBtn').disabled = true;
      banner($('backupMsg'), 'info', 'Backing up…');
      try {
        await call('projectBackupNow', { projectId: ctx.projectId });
        banner($('backupMsg'), 'ok', 'Backed up to Google Drive.');
      } catch (err) { banner($('backupMsg'), 'danger', ctx.friendly(err)); }
      $('backupNowBtn').disabled = false;
    });
    ['fileModal', 'viewModal'].forEach((id) => {
      $(id).addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $(id)) $(id).hidden = true; });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ['fileModal', 'viewModal'].forEach((id) => { $(id).hidden = true; });
    });

    col(ctx.projectId, 'files').orderBy('uploadedAt', 'desc').onSnapshot((snap) => {
      files = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      renderFiles();
      if (ctx.openItemId()) renderItemFiles(ctx.openItemId());
    }, (err) => { console.error(err); banner($('filesMsg'), 'danger', 'Could not load the file list.'); });
  }

  // Called whenever the project (and so your role) changes.
  function onProject() {
    renderFiles();
    const wantBackups = canManage();
    if (wantBackups && !stopBackups) {
      stopBackups = col(ctx.projectId, 'backups').orderBy('createdAtMs', 'desc').onSnapshot((snap) => {
        backups = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        renderBackups();
      }, (err) => console.error(err));
    } else if (!wantBackups && stopBackups) {
      stopBackups(); stopBackups = null; backups = [];
    }
    renderBackups();
  }

  return { init, onProject, renderFiles, renderItemFiles, precheck, extOf, fmtSize, MAX_FILE_BYTES, EXTENSIONS };
})();
