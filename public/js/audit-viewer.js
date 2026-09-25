// audit-viewer.js — in-app viewer for audit evidence.
//
// Opens any file attached to an audit, or found inside a compiled pack, without
// leaving the app and without a network: images, PDFs, video, audio and text
// render natively; Excel workbooks are shown as a table using the same
// XLSXReader the HSE dashboard uses; Word documents are shown as their text
// (read straight from word/document.xml inside the .docx). Anything else gets
// its details and a download button.
//
// HTML is rendered in a sandboxed iframe with scripts disabled — a pack's
// index page is safe to preview, and so is an HTML file of unknown origin.
//
// A file's type is worked out from its name (safeType below), never taken from
// the file record or a pack's manifest. A pack from someone else can label a
// web page "application/pdf", or a ".pdf" "text/html", and a file opened in a
// tab runs as part of this site. Only pictures, PDFs, video and audio are shown
// by the browser itself or offered in a tab; everything else (web pages, SVG,
// XML, text…) is application/octet-stream, which a browser only downloads.
//
//   AuditViewer.open(entries, startIndex, { getBlob: async (entry) => Blob })
//   entries: [{ name, type, size, label, sublabel, addedAt }]

(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // The only types the viewer hands to the browser. None of them can run a
  // script as part of this site, even when opened in a tab of its own.
  const SAFE_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    pdf: 'application/pdf',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg'
  };
  const DOWNLOAD_ONLY = 'application/octet-stream';

  function safeType(name) {
    const m = /\.([a-z0-9]+)$/.exec(String(name || '').toLowerCase());
    return m && Object.prototype.hasOwnProperty.call(SAFE_TYPES, m[1]) ? SAFE_TYPES[m[1]] : DOWNLOAD_ONLY;
  }

  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }

  // How a file is previewed. Pictures, PDFs, video and audio come from the
  // name only (see safeType); the recorded type can still mark a file as a web
  // page or text, since those are only ever read by this script, not the browser.
  function kindOf(name, type) {
    const n = String(name || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    const safe = safeType(n);
    if (/^image\//.test(safe)) return 'image';
    if (safe === 'application/pdf') return 'pdf';
    if (/^video\//.test(safe)) return 'video';
    if (/^audio\//.test(safe)) return 'audio';
    if (/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
    if (/\.docx$/.test(n)) return 'docx';
    if (/\.html?$/.test(n) || t === 'text/html') return 'html';
    if (/^text\//.test(t) || /\.(txt|csv|json|md|log|xml|url)$/.test(n)) return 'text';
    return 'other';
  }

  let root = null, state = null;

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'modal-backdrop viewer-backdrop';
    root.hidden = true;
    root.innerHTML = `
      <div class="modal viewer" role="dialog" aria-modal="true" aria-labelledby="vwTitle">
        <div class="modal-head viewer-head">
          <div class="viewer-titles">
            <div class="viewer-label" id="vwLabel"></div>
            <div class="viewer-title" id="vwTitle"></div>
            <div class="viewer-meta" id="vwMeta"></div>
          </div>
          <div class="viewer-actions">
            <span class="viewer-count" id="vwCount"></span>
            <button class="btn btn-sm" type="button" id="vwPrev" aria-label="Previous file">‹ Prev</button>
            <button class="btn btn-sm" type="button" id="vwNext" aria-label="Next file">Next ›</button>
            <a class="btn btn-sm" id="vwOpen" target="_blank" rel="noopener">Open in tab</a>
            <a class="btn btn-sm btn-primary" id="vwDownload">Download</a>
            <button class="close-x" type="button" id="vwClose" aria-label="Close viewer">×</button>
          </div>
        </div>
        <div class="viewer-body" id="vwBody"></div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.querySelector('#vwClose').addEventListener('click', close);
    root.querySelector('#vwPrev').addEventListener('click', () => go(-1));
    root.querySelector('#vwNext').addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => {
      if (!state || root.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });
  }

  function revoke() {
    if (state && state.url) { URL.revokeObjectURL(state.url); state.url = null; }
  }

  function close() {
    revoke();
    if (root) { root.hidden = true; root.querySelector('#vwBody').innerHTML = ''; }
    document.body.classList.remove('viewer-open');
    state = null;
  }

  function go(delta) {
    if (!state) return;
    const n = state.entries.length;
    if (n < 2) return;
    show((state.index + delta + n) % n);
  }

  async function show(index) {
    revoke();
    state.index = index;
    const entry = state.entries[index];
    const body = root.querySelector('#vwBody');
    root.querySelector('#vwLabel').textContent = entry.label || '';
    root.querySelector('#vwTitle').textContent = entry.name || 'File';
    root.querySelector('#vwMeta').textContent = [fmtSize(entry.size), entry.sublabel,
      entry.addedAt ? 'added ' + new Date(entry.addedAt).toLocaleString() : ''].filter(Boolean).join(' · ');
    root.querySelector('#vwCount').textContent = state.entries.length > 1 ? (index + 1) + ' / ' + state.entries.length : '';
    root.querySelector('#vwPrev').hidden = root.querySelector('#vwNext').hidden = state.entries.length < 2;
    body.innerHTML = '<div class="viewer-loading">Loading…</div>';

    let blob;
    try { blob = await state.getBlob(entry); } catch (e) { body.innerHTML = `<div class="viewer-empty">Could not read this file: ${esc(e.message)}</div>`; return; }
    if (!state || state.index !== index) return; // navigated away meanwhile
    if (!blob) { body.innerHTML = '<div class="viewer-empty">This file is no longer in storage.</div>'; return; }

    // Always re-typed from the name: the stored or packed type is not trusted.
    const type = safeType(entry.name);
    state.url = URL.createObjectURL(new Blob([blob], { type: type }));
    const dl = root.querySelector('#vwDownload');
    dl.href = state.url; dl.download = entry.name || 'file';
    const openTab = root.querySelector('#vwOpen');
    if (type === DOWNLOAD_ONLY) { openTab.hidden = true; openTab.removeAttribute('href'); }
    else { openTab.hidden = false; openTab.href = state.url; }

    const kind = kindOf(entry.name, entry.type || blob.type);
    try {
      if (kind === 'image') body.innerHTML = `<div class="viewer-media"><img src="${state.url}" alt="${esc(entry.name)}"></div>`;
      else if (kind === 'pdf') body.innerHTML = `<iframe class="viewer-frame" src="${state.url}" title="${esc(entry.name)}"></iframe>
        <p class="viewer-note">If the PDF does not display on this device, use <strong>Open in tab</strong> or <strong>Download</strong>.</p>`;
      else if (kind === 'video') body.innerHTML = `<div class="viewer-media"><video src="${state.url}" controls playsinline></video></div>`;
      else if (kind === 'audio') body.innerHTML = `<div class="viewer-media"><audio src="${state.url}" controls></audio></div>`;
      else if (kind === 'text') {
        const text = await blob.slice(0, 600000).text();
        body.innerHTML = `<pre class="viewer-text">${esc(text)}${blob.size > 600000 ? '\n\n… (preview truncated — download for the full file)' : ''}</pre>`;
      } else if (kind === 'html') {
        // sandbox="" = no scripts, no forms, no same-origin access.
        const html = await blob.slice(0, 2000000).text();
        body.innerHTML = '<iframe class="viewer-frame" sandbox="" title="HTML preview"></iframe>';
        body.querySelector('iframe').srcdoc = html;
      } else if (kind === 'xlsx') body.innerHTML = await renderXlsx(blob);
      else if (kind === 'docx') body.innerHTML = await renderDocx(blob);
      else body.innerHTML = `<div class="viewer-empty"><div class="viewer-empty-icon">📄</div>
        No in-app preview for this file type.<br>Use <strong>Download</strong> to open it in its own application.</div>`;
    } catch (e) {
      body.innerHTML = `<div class="viewer-empty">Preview failed (${esc(e.message)}). Use <strong>Download</strong> to open the file.</div>`;
    }
  }

  async function renderXlsx(blob) {
    if (typeof XLSXReader === 'undefined') throw new Error('workbook reader not loaded');
    const wb = await XLSXReader.read(await blob.arrayBuffer());
    const tabs = wb.sheets.map((s, i) => `<button type="button" class="viewer-tab${i ? '' : ' on'}" data-sheet="${i}">${esc(s.name)}</button>`).join('');
    const tables = wb.sheets.map((s, i) => {
      const rows = s.rows.filter((r) => r && r.some((c) => c != null && c !== '')).slice(0, 300);
      const width = Math.min(30, Math.max(1, ...rows.map((r) => {
        let w = 0; r.forEach((c, ci) => { if (c != null && c !== '') w = ci + 1; }); return w;
      })));
      const cell = (c) => c instanceof Date ? c.toISOString().slice(0, 10) : (c == null ? '' : String(c));
      return `<div class="viewer-sheet" data-sheet="${i}"${i ? ' hidden' : ''}>
        <table class="viewer-grid"><tbody>${rows.map((r) => `<tr>${Array.from({ length: width }, (_, ci) => `<td>${esc(cell(r[ci]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
        ${s.rows.length > 300 ? '<p class="viewer-note">First 300 non-empty rows shown.</p>' : ''}</div>`;
    }).join('');
    setTimeout(() => {
      const b = root && root.querySelector('#vwBody');
      if (!b) return;
      b.querySelectorAll('.viewer-tab').forEach((t) => t.addEventListener('click', () => {
        b.querySelectorAll('.viewer-tab').forEach((x) => x.classList.toggle('on', x === t));
        b.querySelectorAll('.viewer-sheet').forEach((x) => { x.hidden = x.getAttribute('data-sheet') !== t.getAttribute('data-sheet'); });
      }));
    }, 0);
    return `<div class="viewer-tabs">${tabs}</div><div class="viewer-sheets">${tables}</div>`;
  }

  async function renderDocx(blob) {
    if (typeof XLSXReader === 'undefined' || !XLSXReader.unzip) throw new Error('document reader not loaded');
    const zip = await XLSXReader.unzip(await blob.arrayBuffer());
    const xml = zip.text('word/document.xml');
    if (!xml) throw new Error('not a Word document');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = [];
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if ((el.localName || '').toLowerCase() !== 'p') continue;
      let t = '';
      const runs = el.getElementsByTagName('*');
      for (let k = 0; k < runs.length; k++) {
        const ln = runs[k].localName;
        if (ln === 't') t += runs[k].textContent;
        else if (ln === 'tab') t += '\t';
        else if (ln === 'br') t += '\n';
      }
      paras.push(t);
    }
    const text = paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return `<div class="viewer-doc">${text ? text.split('\n').map((p) => `<p>${esc(p) || '&nbsp;'}</p>`).join('') : '<p class="viewer-note">No text found in this document.</p>'}</div>
      <p class="viewer-note">Text-only preview — layout, images and tables are shown in Word. Use <strong>Download</strong> for the original.</p>`;
  }

  function open(entries, startIndex, opts) {
    if (!entries || !entries.length) return;
    ensureDom();
    state = { entries: entries, index: 0, getBlob: opts.getBlob, url: null };
    root.hidden = false;
    document.body.classList.add('viewer-open');
    show(Math.max(0, Math.min(entries.length - 1, startIndex || 0)));
    setTimeout(() => { const c = root.querySelector('#vwClose'); if (c) c.focus(); }, 30);
  }

  global.AuditViewer = { open: open, close: close, kindOf: kindOf, safeType: safeType, fmtSize: fmtSize };
})(window);
