renderSidebar('permit');
renderFooter('app-footer');

// The permit form serves every permit type in js/permit-types.js. Lifting
// permits keep their own sections (type of lift, linked crane assessment,
// lift diagrams); other types get their fields, gas tests and energy
// isolations drawn from the registry.

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Only data: images made by this app are shown as diagrams.
const safeImg = (src) => (typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) ? src : '';

// ---- Lightbox for viewing a lift diagram at full size ----
function openLightbox(src, caption) {
  const root = document.getElementById('lightboxRoot');
  if (!root || !safeImg(src)) return;
  const cap = caption || 'Lift diagram';
  root.innerHTML = `
    <div class="modal-backdrop no-print" id="lightboxBackdrop">
      <div class="modal" style="max-width:760px;">
        <div class="modal-head">
          <strong>${esc(cap)}</strong>
          <button class="close-x" id="lightboxClose">&times;</button>
        </div>
        <div class="modal-body">
          <img class="lightbox-img" src="${esc(src)}" alt="${esc(cap)}">
        </div>
        <div class="modal-foot">
          <a class="btn btn-sm" href="${esc(src)}" download="${esc(cap.replace(/\s+/g,'-').toLowerCase())}.png">Download PNG</a>
          <button class="btn btn-sm" id="lightboxClose2">Close</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  document.getElementById('lightboxClose').addEventListener('click', close);
  document.getElementById('lightboxClose2').addEventListener('click', close);
  document.getElementById('lightboxBackdrop').addEventListener('click', (e) => { if (e.target.id === 'lightboxBackdrop') close(); });
}

// Renders diagram thumbnails into #assessmentDiagrams, preferring images already
// saved on the permit itself (denormalized at save time), falling back to the
// currently-linked assessment's images so a diagram shows before first save.
function renderDiagramThumbs(images) {
  const el = document.getElementById('assessmentDiagrams');
  if (!el) return;
  const shots = [
    images && safeImg(images.diagram3D) ? { src: images.diagram3D, label: '3D view' } : null,
    images && safeImg(images.diagramSketch) ? { src: images.diagramSketch, label: 'Plan sketch' } : null,
  ].filter(Boolean);
  if (!shots.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="diagram-thumbs">
    ${shots.map(s => `
      <div class="diagram-thumb">
        <img src="${esc(s.src)}" alt="${esc(s.label)}" data-caption="${esc(s.label)}">
        <span class="cap">${esc(s.label)} — click to enlarge / download</span>
      </div>`).join('')}
  </div>`;
  el.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src, img.dataset.caption));
  });
}

// ---- Which permit, and which type ----
const params = new URLSearchParams(location.search);
const permitId = params.get('id');
const viewMode = params.get('mode') === 'view';
let permit = permitId ? DB.getPermits().find(p => p.id === permitId) : null;
const isNew = !permit;
const requestedType = params.get('type');
const typeKey = permit ? PermitTypes.typeKeyOf(permit) : (PermitTypes.isType(requestedType) ? requestedType : null);
const type = typeKey ? PermitTypes.byKey(typeKey) : null;
const isLifting = typeKey === 'lifting';

if (isNew) {
  permit = { id: uid('P'), permitType: typeKey, status: 'active', issueDate: new Date().toISOString() };
}

// A link to a permit that isn't on this device yet (for example a project
// item opened before sync finishes) must not quietly start a new permit. The
// page opens it as soon as it arrives from the account.
if (permitId && isNew) {
  document.getElementById('statusBanner').innerHTML = `<div class="banner banner-warn">
    <strong>This permit is not on this device yet.</strong> It may still be syncing from your account, so it will open here as soon as it arrives. If it does not, it may belong to another team member. <a href="permits.html">See all permits</a>.
  </div>`;
  document.addEventListener('cloudsync:changed', () => {
    if (DB.getPermits().some(p => p.id === permitId)) location.reload();
  });
}

// Saves the permit, then waits for the account and the project to have it
// (each with a time limit) so leaving the page does not cut the writes off.
// Resolves false if the permit could not be stored on this device.
function savePermitAndSync(p) {
  if (!DB.savePermit(p)) return Promise.resolve(false);
  const project = syncPermitToProject(p).catch((e) => console.error('Project link failed', e));
  return Promise.all([project, DB.flush(5000)]).then(() => true);
}

// ---- Type chooser (new permit with no type yet) ----
function renderChooser() {
  const host = document.getElementById('typeChooser');
  host.hidden = false;
  host.innerHTML = `
    <div class="section-title" style="margin-top:0;">What work is this permit for?</div>
    <div class="type-grid">
      ${PermitTypes.TYPES.map(t => `
        <a class="card type-card" href="permit.html?type=${encodeURIComponent(t.key)}">
          <span class="type-prefix">${esc(t.prefix)}</span>
          <strong>${esc(t.label)}</strong>
          <span>${esc(t.summary)}</span>
        </a>`).join('')}
    </div>`;
  document.getElementById('permitForm').hidden = true;
}

const pageTitle = document.getElementById('pageTitle');
const pageCrumb = document.getElementById('pageCrumb');
const missing = !!permitId && isNew;
if (missing) {
  pageTitle.textContent = 'Permit not found';
  pageCrumb.textContent = 'Permit to work';
  document.getElementById('permitForm').hidden = true;
} else if (!type) {
  renderChooser();
} else {
  document.title = `${type.label} permit · Duck HSE Portal`;
  pageTitle.textContent = viewMode ? `${type.label} permit ${permit.permitNumber || ''}`.trim()
    : isNew ? `New ${PermitTypes.nameOf(type)} permit` : `Edit ${PermitTypes.nameOf(type)} permit ${permit.permitNumber || ''}`.trim();
  pageCrumb.textContent = viewMode ? 'Viewing permit — read only' : `Permit to work · ${type.summary}`;
  document.getElementById('permitTypeLabel').value = type.label;
  document.getElementById('workDescription').placeholder = type.workPlaceholder || 'Describe the work to be carried out';
  document.getElementById('personInChargeLabel').textContent = type.personInChargeLabel || 'Person in charge';
  document.getElementById('liftingSection').hidden = !isLifting;
  document.getElementById('checklistTitle').textContent = isLifting ? 'Pre-start checklist' : 'Precautions';
  document.getElementById('checklistHint').hidden = !(type.checks || []).some(c => c.required);
  if (type.approverRequired) document.getElementById('approverCaption').textContent = 'Approver signature (required)';
  if (typeof renderDisclaimer === 'function') renderDisclaimer('ptwDisclaimer', isLifting ? 'lifting' : 'ptw', type.code);
}

// ---- Checklist (precautions) ----
const checkId = (key) => `chk_${key}`;
document.getElementById('checklist').innerHTML = (type ? type.checks : []).map(item => `
  <div class="check-row">
    <input type="checkbox" id="${checkId(item.key)}">
    <label for="${checkId(item.key)}">${esc(item.label)}${item.required ? ' <span class="req-tag">Required</span>' : ''}</label>
  </div>
`).join('');

// ---- Type-specific sections: fields, gas tests, isolations ----
function fieldHtml(f) {
  const id = `fld_${f.key}`;
  const req = f.required ? ' <span class="req-tag">Required</span>' : '';
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '';
  const full = (f.kind === 'textarea' || f.kind === 'list' || f.full) ? ' full' : '';
  let input;
  if (f.kind === 'select') {
    input = `<select id="${id}"><option value="">— Select —</option>${f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
  } else if (f.kind === 'textarea') {
    input = `<textarea id="${id}"></textarea>`;
  } else if (f.kind === 'list') {
    input = `<textarea id="${id}" placeholder="One per line"></textarea>`;
  } else if (f.kind === 'number') {
    input = `<input type="number" id="${id}" step="any" inputmode="decimal"${f.min != null ? ` min="${f.min}"` : ''}>`;
  } else if (f.kind === 'datetime') {
    input = `<input type="datetime-local" id="${id}">`;
  } else {
    input = `<input type="text" id="${id}">`;
  }
  return `<div class="field${full}"><label for="${id}">${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ''}${req}</label>${input}${hint}</div>`;
}

function renderTypeSections() {
  const host = document.getElementById('typeSections');
  if (!type || isLifting) { host.innerHTML = ''; return; }
  const groups = [];
  (type.fields || []).forEach(f => {
    const g = f.group || 'Work details';
    let grp = groups.find(x => x.name === g);
    if (!grp) { grp = { name: g, fields: [] }; groups.push(grp); }
    grp.fields.push(f);
  });
  let html = groups.map(g => `
    <div class="section-title">${esc(g.name)}</div>
    <div class="form-grid">${g.fields.map(fieldHtml).join('')}</div>`).join('');

  if (type.gasTest) {
    const lim = type.gasTest.limits.map(l => `${esc(l.label)} ${esc(l.limitText)}`).join(' · ');
    html += `
      <div class="section-title">Gas tests${type.gasTest.required ? ' <span class="req-tag">Required</span>' : ''}</div>
      <p class="hint">${esc(type.gasTest.hint || '')} Limits used: ${lim}. Readings taken together (for example top, middle and bottom) share one time; every reading in the latest round must be within the limits, and the round must be no more than ${esc(String(type.gasTest.maxAgeHours || 2))} hours before the permit starts.</p>
      <div class="table-scroll"><table class="data-table gas-table">
        <thead><tr><th>Time</th><th>Where tested</th>${type.gasTest.limits.map(l => `<th>${esc(l.label)} (${esc(l.unit.trim())})</th>`).join('')}<th>Tested by</th><th>Detector</th><th>Result</th><th class="no-print"></th></tr></thead>
        <tbody id="gasRows"></tbody>
      </table></div>
      <button type="button" class="btn btn-sm no-print" id="btnAddGas" style="margin-top:8px;">+ Add gas reading</button>`;
  }

  if (type.isolations) {
    html += `
      <div class="section-title">Isolation points <span class="req-tag">Required</span></div>
      <p class="hint">${esc(type.isolationHint || '')}</p>
      <div class="table-scroll"><table class="data-table iso-table">
        <thead><tr><th>Equipment / isolation point</th><th>Energy</th><th>Method</th><th>Lock / tag no.</th><th>Isolated by</th><th>Zero energy verified</th><th class="no-print"></th></tr></thead>
        <tbody id="isoRows"></tbody>
      </table></div>
      <button type="button" class="btn btn-sm no-print" id="btnAddIso" style="margin-top:8px;">+ Add isolation point</button>`;
  }
  host.innerHTML = html;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v) => v ? new Date(v).toISOString() : '';

function gasResultBadge(test) {
  const bad = PermitTypes.gasProblems(test, type.gasTest.limits);
  if (!bad.length) return '<span class="badge badge-ok"><span class="badge-dot"></span>Within limits</span>';
  const out = bad.filter(b => !/reading missing$/.test(b));
  if (!out.length) return '<span class="badge badge-neutral">Incomplete</span>';
  return `<span class="badge badge-fail"><span class="badge-dot"></span>Outside limits</span><span class="gas-why">${esc(out.join('; '))}</span>`;
}

function addGasRow(test) {
  const body = document.getElementById('gasRows');
  if (!body) return;
  // A new reading starts with the previous row's time, so readings from one
  // round (top, middle, bottom) group together; change it for a re-test.
  const prev = body.querySelector('tr:last-child [data-k="at"]');
  const t = test || { at: prev && prev.value ? fromLocalInput(prev.value) : new Date().toISOString() };
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="datetime-local" data-k="at" value="${esc(toLocalInput(t.at))}" aria-label="Time"></td>
    <td><input type="text" data-k="point" value="${esc(t.point || '')}" aria-label="Where tested" placeholder="e.g. top"></td>
    ${type.gasTest.limits.map(l => `<td><input type="number" step="any" inputmode="decimal" data-k="${esc(l.key)}" value="${esc(t[l.key] == null ? '' : t[l.key])}" aria-label="${esc(l.label)}"></td>`).join('')}
    <td><input type="text" data-k="testedBy" value="${esc(t.testedBy || '')}" aria-label="Tested by"></td>
    <td><input type="text" data-k="instrument" value="${esc(t.instrument || '')}" aria-label="Detector ID" placeholder="ID / calibration date"></td>
    <td data-result></td>
    <td class="no-print"><button type="button" class="btn btn-sm" data-remove aria-label="Remove reading">✕</button></td>`;
  body.appendChild(tr);
  const refresh = () => { tr.querySelector('[data-result]').innerHTML = gasResultBadge(readRow(tr)); };
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input', refresh));
  tr.querySelector('[data-remove]').addEventListener('click', () => tr.remove());
  refresh();
}

function addIsoRow(row) {
  const body = document.getElementById('isoRows');
  if (!body) return;
  const r = row || {};
  const energies = type.energyTypes || [];
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" data-k="point" value="${esc(r.point || '')}" aria-label="Isolation point"></td>
    <td><select data-k="energy" aria-label="Energy">${['', ...energies].map(e => `<option value="${esc(e)}"${e === r.energy ? ' selected' : ''}>${esc(e || '— Select —')}</option>`).join('')}</select></td>
    <td><input type="text" data-k="method" value="${esc(r.method || '')}" aria-label="Isolation method" placeholder="e.g. breaker off and locked"></td>
    <td><input type="text" data-k="lockNo" value="${esc(r.lockNo || '')}" aria-label="Lock or tag number"></td>
    <td><input type="text" data-k="isolatedBy" value="${esc(r.isolatedBy || '')}" aria-label="Isolated by"></td>
    <td style="text-align:center;"><input type="checkbox" data-k="verified"${r.verified ? ' checked' : ''} aria-label="Zero energy verified"></td>
    <td class="no-print"><button type="button" class="btn btn-sm" data-remove aria-label="Remove isolation point">✕</button></td>`;
  body.appendChild(tr);
  tr.querySelector('[data-remove]').addEventListener('click', () => tr.remove());
}

function readRow(tr) {
  const out = {};
  tr.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (k === 'at') out[k] = fromLocalInput(el.value);
    else if (el.type === 'number') out[k] = el.value === '' ? '' : Number(el.value);
    else out[k] = el.value.trim();
  });
  return out;
}
const readRows = (id) => [...document.querySelectorAll(`#${id} tr`)].map(readRow);

renderTypeSections();
document.getElementById('btnAddGas')?.addEventListener('click', () => addGasRow());
document.getElementById('btnAddIso')?.addEventListener('click', () => addIsoRow());

// ---- Lifting: crane assessment link ----
const assessments = DB.getAssessments().sort((a,b) => new Date(b.date) - new Date(a.date));
function assessmentGeometryLabel(a) {
  return a.jibMode
    ? `${a.boomAngle}° boom angle (${a.jibLength}m jib, ${a.jibOffset}° offset)`
    : `${a.workingRadius}m radius, ${a.boomLength}m boom`;
}

const assessmentSelect = document.getElementById('assessmentSelect');
assessmentSelect.innerHTML += assessments.map(a =>
  `<option value="${esc(a.id)}">${esc(fmtDate(a.date))} — ${esc(a.craneModel)} — ${esc(a.loadWeight)}t @ ${esc(a.jibMode ? a.boomAngle + '°' : a.workingRadius + 'm')} ${a.isValid ? '(Allowed)' : '(Not allowed)'}</option>`
).join('');

function renderAssessmentSummary() {
  const id = assessmentSelect.value;
  const a = assessments.find(x => x.id === id);
  const el = document.getElementById('assessmentSummary');
  if (!a) { el.innerHTML = ''; renderDiagramThumbs(null); renderLiftPlanningSummary(null); return; }
  const cap = Number(a.maximumCapacity);
  el.innerHTML = `<div class="banner ${a.isValid ? 'banner-ok' : 'banner-danger'}" style="margin-top:10px;">
    ${esc(a.craneModel)} · ${esc(a.configuration)} · ${esc(a.loadWeight)}t at ${esc(assessmentGeometryLabel(a))} — capacity ${Number.isFinite(cap) ? cap.toFixed(2) + 't' : 'not recorded'} —
    <strong>${a.isValid ? 'Allowed' : 'Not allowed'}</strong>
  </div>`;
  // Prefer the permit's own saved copies (self-contained, survives the source
  // assessment being edited/deleted later) if they still match this selection;
  // otherwise fall back to the linked assessment's own images (e.g. before first save).
  const images = (permit.assessmentId === a.id && (permit.diagram3D || permit.diagramSketch))
    ? { diagram3D: permit.diagram3D, diagramSketch: permit.diagramSketch }
    : { diagram3D: a.diagram3D, diagramSketch: a.diagramSketch };
  renderDiagramThumbs(images);
  renderLiftPlanningSummary(a);
}
assessmentSelect.addEventListener('change', renderAssessmentSummary);

// Shows the pre-lift briefing, exclusion zone, and categorized training
// requirements that were generated and saved with the linked assessment.
function renderLiftPlanningSummary(a) {
  const el = document.getElementById('liftPlanningSummary');
  if (!el) return;
  if (!a || (!a.briefingPoints && a.exclusionZoneM == null && !a.trainingRequirements)) { el.innerHTML = ''; return; }

  const briefingHtml = (a.briefingPoints && a.briefingPoints.length)
    ? `<div class="section-title" style="margin-top:16px;">Pre-lift briefing</div>
       <ol class="briefing-list">${a.briefingPoints.map(b => `<li>${esc(b)}</li>`).join('')}</ol>`
    : '';

  const exclusionHtml = (a.exclusionZoneM != null || a.exclusionZoneNote)
    ? `<div class="section-title">Exclusion zone</div>
       ${a.exclusionZoneM != null ? `<div class="exclusion-figure">${esc(a.exclusionZoneM)} m <span>minimum barriered radius (starting point)</span></div>` : ''}
       <p class="hint">${esc(a.exclusionZoneNote || '')}</p>`
    : '';

  const trainingHtml = (a.trainingRequirements && a.trainingRequirements.length)
    ? `<div class="section-title">Training required for the lifting team</div>
       <div class="training-grid">
         ${a.trainingRequirements.map(t => `
           <div class="training-cat ${t.required ? 'required' : ''}">
             <div class="training-cat-head">
               <strong>${esc(t.category)}</strong>
               <span class="badge ${t.required ? 'badge-fail' : 'badge-ok'}"><span class="badge-dot"></span>${t.required ? 'Mandatory for this lift' : 'Standard requirement'}</span>
             </div>
             <ul>${(t.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
           </div>
         `).join('')}
       </div>`
    : '';

  el.innerHTML = briefingHtml + exclusionHtml + trainingHtml;
}

// ---- Critical lift hint ----
function updateCriticalHint() {
  const isCritical = document.getElementById('radCritical').checked;
  document.getElementById('criticalHint').textContent = isCritical
    ? 'Critical lift selected: requires a linked, passing crane assessment and full sign-off before work starts.'
    : '';
}
document.getElementById('radCritical').addEventListener('change', updateCriticalHint);
document.getElementById('radNonCritical').addEventListener('change', updateCriticalHint);

// ---- Signature pads ----
const sigIssuer = document.getElementById('sigIssuer');
const sigApprover = document.getElementById('sigApprover');
const sigVerifier = document.getElementById('sigVerifier');
[sigIssuer, sigApprover, sigVerifier].forEach(attachSignaturePad);
document.querySelectorAll('[data-clear]').forEach(btn => {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.clear).clearPad());
});

// ---- Load the permit into the form ----
function setField(f, value) {
  const el = document.getElementById(`fld_${f.key}`);
  if (!el) return;
  if (f.kind === 'list') el.value = Array.isArray(value) ? value.join('\n') : (value || '');
  else if (f.kind === 'datetime') el.value = toLocalInput(value);
  else el.value = value == null ? '' : value;
}
function getField(f) {
  const el = document.getElementById(`fld_${f.key}`);
  if (!el) return '';
  if (f.kind === 'list') return el.value.split('\n').map(x => x.trim()).filter(Boolean);
  if (f.kind === 'datetime') return fromLocalInput(el.value);
  if (f.kind === 'number') return el.value === '' ? '' : Number(el.value);
  return el.value.trim();
}

function loadForm() {
  document.getElementById('permitNumber').value = permit.permitNumber || '';
  document.getElementById('projectNumber').value = permit.projectNumber || '';
  document.getElementById('location').value = permit.location || '';
  document.getElementById('date').value = permit.date ? permit.date.slice(0,10) : new Date().toISOString().slice(0,10);
  document.getElementById('validFrom').value = toLocalInput(permit.validFrom) || toLocalInput(new Date().toISOString());
  document.getElementById('validTo').value = toLocalInput(permit.validTo);
  document.getElementById('workDescription').value = permit.workDescription || '';
  document.getElementById('otherPermits').value = permit.otherPermits || '';
  document.getElementById('chkRiskAssessment').checked = !!permit.hasRiskAssessment;
  document.getElementById('chkMethodStatement').checked = !!permit.hasMethodStatement;
  document.getElementById('personInCharge').value = permit.personInCharge || '';
  document.getElementById('contractor').value = permit.contractor || '';
  type.checks.forEach(item => {
    document.getElementById(checkId(item.key)).checked = PermitTypes.checkValue(permit, type, item.key);
  });
  if (isLifting) {
    document.getElementById('radCritical').checked = !!permit.isCriticalLift;
    document.getElementById('radNonCritical').checked = !permit.isCriticalLift;
    updateCriticalHint();
    if (permit.assessmentId) assessmentSelect.value = permit.assessmentId;
    renderAssessmentSummary();
  } else {
    (type.fields || []).forEach(f => setField(f, PermitTypes.detailValue(permit, f.key)));
    (Array.isArray(permit.gasTests) ? permit.gasTests : []).forEach(addGasRow);
    (Array.isArray(permit.isolations) ? permit.isolations : []).forEach(addIsoRow);
  }
  document.getElementById('issuerName').value = permit.issuerName || '';
  document.getElementById('approverName').value = permit.approverName || '';
  document.getElementById('verifierName').value = permit.verifierName || '';
  if (permit.issuerSignature) sigIssuer.loadDataUrl(permit.issuerSignature);
  if (permit.approverSignature) sigApprover.loadDataUrl(permit.approverSignature);
  if (permit.verifierSignature) sigVerifier.loadDataUrl(permit.verifierSignature);

  const status = PermitTypes.statusOf(permit);
  const banner = document.getElementById('statusBanner');
  if (status === 'suspended') {
    banner.innerHTML = `<div class="banner banner-danger">
      <strong>Permit suspended</strong> by ${esc(permit.ptwSuspendedBy || 'unknown')}: ${esc(permit.suspensionReason || 'no reason recorded')}
    </div>`;
  } else if (status === 'closed') {
    banner.innerHTML = `<div class="banner banner-ok"><strong>This permit is closed.</strong> The work is finished and the permit can no longer be used.</div>`;
  } else if (status === 'expired') {
    banner.innerHTML = `<div class="banner banner-warn"><strong>This permit has expired.</strong> Revalidate it or issue a new permit before work continues.</div>`;
  }
  renderCloseoutSummary();
}

function renderCloseoutSummary() {
  const el = document.getElementById('closeoutSummary');
  const c = permit.closeout;
  if (!c || permit.status !== 'closed') { el.hidden = true; return; }
  const ticked = (type.closeout || []).filter(i => c.checks && c.checks[i.key]);
  el.hidden = false;
  el.innerHTML = `
    <div class="section-title" style="margin-top:0;">Close-out</div>
    <p>Closed by <strong>${esc(c.by)}</strong> on ${esc(fmtDate(c.at))}.</p>
    ${(type.closeoutFields || []).filter(f => c.fields && c.fields[f.key]).map(f => `<p>${esc(f.label)}: <strong>${esc(f.kind === 'datetime' ? fmtDate(c.fields[f.key]) : c.fields[f.key])}</strong></p>`).join('')}
    ${ticked.length ? `<ul>${ticked.map(i => `<li>${esc(i.label)}</li>`).join('')}</ul>` : ''}
    ${c.notes ? `<p class="hint">${esc(c.notes)}</p>` : ''}`;
}

if (type && !isNew) loadForm();
else if (type && !missing) {
  document.getElementById('validFrom').value = toLocalInput(new Date().toISOString());
  document.getElementById('date').value = new Date().toISOString().slice(0,10);
  // "Raise a permit" from a crane assessment preselects it.
  const fromAssessment = params.get('assessmentId');
  if (isLifting && fromAssessment && assessments.some(a => a.id === fromAssessment)) {
    assessmentSelect.value = fromAssessment;
    renderAssessmentSummary();
  }
  if (type.gasTest && type.gasTest.required) addGasRow();
  if (type.isolations) addIsoRow();
}

// "Track on project": offer the user's projects; picking one fills in the
// project number when it's empty.
if (typeof ProjectLink !== 'undefined') {
  const projectSel = document.getElementById('projectLink');
  ProjectLink.mount(projectSel, permit && permit.projectId);
  projectSel.addEventListener('change', () => {
    const opt = projectSel.selectedOptions[0];
    const num = document.getElementById('projectNumber');
    if (opt && opt.dataset.number && !num.value.trim()) num.value = opt.dataset.number;
  });
}

// ---- View mode: disable everything ----
const currentStatus = PermitTypes.statusOf(permit);
if (viewMode || currentStatus === 'closed') {
  document.querySelectorAll('#permitForm input, #permitForm select, #permitForm textarea, #permitForm button').forEach(el => {
    if (el.id === 'btnPrint') return;
    el.disabled = true;
  });
  [sigIssuer, sigApprover, sigVerifier].forEach(c => c.setDisabled(true));
  document.getElementById('actionRow').style.display = 'none';
  document.querySelectorAll('#btnAddGas, #btnAddIso, [data-remove]').forEach(el => { el.hidden = true; });
}
if (!viewMode && !isNew && type && currentStatus !== 'closed') {
  document.getElementById('suspendCard').style.display = currentStatus === 'active' ? 'block' : 'none';
  const closeCard = document.getElementById('closeCard');
  closeCard.hidden = false;
  document.getElementById('closeChecks').innerHTML = (type.closeoutFields || []).length
    ? `<div class="form-grid" style="grid-column:1 / -1; margin-bottom:8px;">${type.closeoutFields.map(f => {
        const id = `closefld_${esc(f.key)}`;
        const input = f.kind === 'datetime' ? `<input type="datetime-local" id="${id}">` : `<input type="text" id="${id}">`;
        return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? ' <span class="req-tag">Required</span>' : ''}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
      }).join('')}</div>` : '';
  document.getElementById('closeChecks').innerHTML += (type.closeout || []).map(item => `
    <div class="check-row">
      <input type="checkbox" id="close_${esc(item.key)}">
      <label for="close_${esc(item.key)}">${esc(item.label)}${item.required ? ' <span class="req-tag">Required</span>' : ''}</label>
    </div>`).join('');
}

document.getElementById('btnSuspend')?.addEventListener('click', () => {
  const by = document.getElementById('ptwSuspendedBy').value.trim();
  const reason = document.getElementById('suspensionReason').value.trim();
  if (!by || !reason) { alert('Enter who is suspending the permit and the reason.'); return; }
  permit.status = 'suspended';
  permit.ptwSuspendedBy = by;
  permit.suspensionReason = reason;
  permit.suspendedAt = new Date().toISOString();
  savePermitAndSync(permit).then((ok) => { if (!ok) return; alert('Permit suspended.'); location.reload(); });
});

// Closing saves the permit as it was loaded, so unsaved edits above would be
// lost. The verifier's name and signature are completion sign-off and are
// kept; anything else has to be saved first.
let formDirty = false;
const markDirty = (e) => {
  if (e.target.closest('#closeCard, #suspendCard, #actionRow') || e.target.id === 'verifierName' || e.target.id === 'sigVerifier') return;
  formDirty = true;
};
['input', 'change'].forEach(ev => document.getElementById('permitForm').addEventListener(ev, markDirty));
document.getElementById('permitForm').addEventListener('pointerdown', (e) => {
  if (e.target.matches('canvas.sig-pad, #btnAddGas, #btnAddIso, [data-remove]')) markDirty(e);
});

document.getElementById('btnClose')?.addEventListener('click', () => {
  const errEl = document.getElementById('closeErrors');
  if (formDirty) {
    errEl.innerHTML = '<div class="banner banner-danger" style="margin:10px 0;">You have changes above that are not saved. Press <strong>Save permit</strong> first, then close the permit.</div>';
    return;
  }
  const closeout = {
    by: document.getElementById('closedBy').value.trim(),
    at: new Date().toISOString(),
    notes: document.getElementById('closeNotes').value.trim(),
    checks: {},
    fields: {},
  };
  (type.closeout || []).forEach(item => { closeout.checks[item.key] = document.getElementById(`close_${item.key}`).checked; });
  (type.closeoutFields || []).forEach(f => {
    const v = document.getElementById(`closefld_${f.key}`).value;
    closeout.fields[f.key] = f.kind === 'datetime' ? fromLocalInput(v) : v.trim();
  });
  const errors = PermitTypes.validateCloseout(permit, closeout);
  if (errors.length) {
    errEl.innerHTML = `<div class="banner banner-danger" style="margin:10px 0;">Before closing:<br>&bull; ${errors.map(esc).join('<br>&bull; ')}</div>`;
    return;
  }
  if (!confirm('Close this permit? It can no longer be used for work.')) return;
  errEl.innerHTML = '';
  permit.verifierName = document.getElementById('verifierName').value.trim();
  const verifierSig = sigVerifier.toDataUrlSafe();
  if (verifierSig) permit.verifierSignature = verifierSig;
  permit.status = 'closed';
  permit.closeout = closeout;
  savePermitAndSync(permit).then((ok) => { if (ok) location.href = `permit.html?id=${encodeURIComponent(permit.id)}&mode=view`; });
});

// ---- Save ----
function readForm() {
  const data = {
    ...permit,
    permitType: typeKey,
    projectNumber: document.getElementById('projectNumber').value.trim(),
    location: document.getElementById('location').value.trim(),
    date: document.getElementById('date').value,
    validFrom: fromLocalInput(document.getElementById('validFrom').value),
    validTo: fromLocalInput(document.getElementById('validTo').value),
    workDescription: document.getElementById('workDescription').value.trim(),
    otherPermits: document.getElementById('otherPermits').value.trim(),
    hasRiskAssessment: document.getElementById('chkRiskAssessment').checked,
    hasMethodStatement: document.getElementById('chkMethodStatement').checked,
    personInCharge: document.getElementById('personInCharge').value.trim(),
    contractor: document.getElementById('contractor').value.trim(),
    issuerName: document.getElementById('issuerName').value.trim(),
    approverName: document.getElementById('approverName').value.trim(),
    verifierName: document.getElementById('verifierName').value.trim(),
    issuerSignature: sigIssuer.toDataUrlSafe(),
    approverSignature: sigApprover.toDataUrlSafe(),
    verifierSignature: sigVerifier.toDataUrlSafe(),
    status: permit.status || 'active',
    projectId: document.getElementById('projectLink').value || null,
  };
  if (isLifting) {
    const linkedAssessment = assessments.find(x => x.id === assessmentSelect.value) || null;
    data.isCriticalLift = document.getElementById('radCritical').checked;
    data.assessmentId = assessmentSelect.value || null;
    // Denormalize the linked assessment's lift diagrams onto the permit itself so
    // the permit stays self-contained (viewable/printable/downloadable) even if
    // the source assessment is later edited or deleted.
    data.diagram3D = linkedAssessment ? (linkedAssessment.diagram3D || null) : null;
    data.diagramSketch = linkedAssessment ? (linkedAssessment.diagramSketch || null) : null;
    type.checks.forEach(item => { data[item.key] = document.getElementById(checkId(item.key)).checked; });
  } else {
    data.isCriticalLift = false;
    data.details = {};
    (type.fields || []).forEach(f => { data.details[f.key] = getField(f); });
    data.checks = {};
    type.checks.forEach(item => { data.checks[item.key] = document.getElementById(checkId(item.key)).checked; });
    // A row with only its default time filled in is not a test.
    if (type.gasTest) data.gasTests = readRows('gasRows').filter(t => t.testedBy || t.instrument || type.gasTest.limits.some(l => t[l.key] !== ''));
    if (type.isolations) data.isolations = PermitTypes.isolationRows({ isolations: readRows('isoRows') });
  }
  return data;
}

document.getElementById('btnSave').addEventListener('click', () => {
  const data = readForm();
  // An issued permit keeps its record: rules added since it was issued apply
  // only to what changes, and a failed re-test is saved and suspends it.
  const issued = !isNew && !!permit.permitNumber;
  const errors = PermitTypes.validate(data, { assessments, original: isNew ? null : permit, allowFailedGas: issued });
  const errEl = document.getElementById('validationErrors');
  if (errors.length) {
    errEl.innerHTML = `<div class="banner banner-danger">Please correct the following:<br>&bull; ${errors.map(esc).join('<br>&bull; ')}</div>`;
    errEl.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  errEl.innerHTML = '';
  if (!data.permitNumber) data.permitNumber = DB.nextPermitNumber(typeKey) || '';
  const failing = issued ? PermitTypes.failingGasReadings(data) : [];
  if (failing.length && PermitTypes.statusOf(data) === 'active') {
    const last = PermitTypes.latestGasTest(data);
    data.status = 'suspended';
    data.ptwSuspendedBy = (last && last.testedBy) || 'Gas test';
    data.suspensionReason = `Gas test outside the limits (${failing.join('; ')}). Stop work and make the area safe.`;
    data.suspendedAt = new Date().toISOString();
    alert('The latest gas test is outside the limits, so this permit has been suspended. Stop work and make the area safe.');
  }
  permit = data;
  const btn = document.getElementById('btnSave');
  btn.disabled = true;
  savePermitAndSync(permit).then((ok) => {
    if (ok) location.href = `permit.html?id=${encodeURIComponent(permit.id)}&mode=view`;
    else btn.disabled = false;
  });
});

// Mirror the permit onto its project's tracked items (see js/project-link.js).
// Team members see the permit only through this item, so it names the type.
async function syncPermitToProject(p) {
  if (!p.projectId || typeof ProjectLink === 'undefined') return;
  const t = PermitTypes.typeOf(p);
  const status = PermitTypes.statusOf(p);
  const name = `${t.label} permit ${p.permitNumber || ''}`.trim();
  const res = await ProjectLink.sync(p.projectId,
    { kind: 'permit', id: p.id, label: name },
    {
      title: `${name}: ${(p.workDescription || p.location || 'Permit to work').slice(0, 120)}`,
      status: status === 'suspended' ? 'open' : (status === 'closed' || status === 'expired') ? 'closed' : 'in_progress',
      priority: status === 'suspended' ? 'high' : (t.key === 'lifting' && p.isCriticalLift) ? 'critical' : t.highRisk ? 'high' : 'medium',
      dueDate: p.validTo ? p.validTo.slice(0, 10) : '',
      location: p.location || '',
      details: [`${t.label} permit, ${PermitTypes.STATUS_LABELS[status].toLowerCase()}.`,
                t.key === 'lifting' ? (p.isCriticalLift ? 'Critical lift.' : 'Non-critical lift.') : '',
                p.personInCharge ? `${t.personInChargeLabel || 'Person in charge'}: ${p.personInCharge}.` : '',
                status === 'suspended' ? `Suspended by ${p.ptwSuspendedBy || '?'}: ${p.suspensionReason || ''}` : '',
                status === 'closed' && p.closeout ? `Closed by ${p.closeout.by}.` : ''].filter(Boolean).join(' ')
    });
  if (!res.ok) alert('The permit was saved, but it could not be added to the project: ' + res.error);
}

document.getElementById('btnPrint').addEventListener('click', () => window.print());
