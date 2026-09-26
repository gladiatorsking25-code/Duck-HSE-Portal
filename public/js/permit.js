renderSidebar('permit');
renderFooter('app-footer');

// ---- Lightbox for viewing a lift diagram at full size ----
function openLightbox(src, caption) {
  const root = document.getElementById('lightboxRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop no-print" id="lightboxBackdrop">
      <div class="modal" style="max-width:760px;">
        <div class="modal-head">
          <strong>${caption || 'Lift diagram'}</strong>
          <button class="close-x" id="lightboxClose">&times;</button>
        </div>
        <div class="modal-body">
          <img class="lightbox-img" src="${src}" alt="${caption || 'Lift diagram'}">
        </div>
        <div class="modal-foot">
          <a class="btn btn-sm" href="${src}" download="${(caption || 'lift-diagram').replace(/\s+/g,'-').toLowerCase()}.png">Download PNG</a>
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
    images && images.diagram3D ? { src: images.diagram3D, label: '3D view' } : null,
    images && images.diagramSketch ? { src: images.diagramSketch, label: 'Plan sketch' } : null,
  ].filter(Boolean);
  if (!shots.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="diagram-thumbs">
    ${shots.map(s => `
      <div class="diagram-thumb">
        <img src="${s.src}" alt="${s.label}" data-caption="${s.label}">
        <span class="cap">${s.label} — click to enlarge / download</span>
      </div>`).join('')}
  </div>`;
  el.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src, img.dataset.caption));
  });
}

const CHECKLIST_ITEMS = [
  { key: 'hasLiftingPlan', label: 'Lifting plan available' },
  { key: 'hasPreTaskBriefing', label: 'Pre-task briefing conducted' },
  { key: 'hasRequiredPersonnel', label: 'Required personnel available' },
  { key: 'hasEmergencyPlan', label: 'Emergency plan provided' },
  { key: 'hasAppointedPerson', label: 'Appointed person present' },
  { key: 'hasSupervisor', label: 'Lift supervisor present' },
  { key: 'hasRigger', label: 'Rigger present' },
  { key: 'hasBanksman', label: 'Banksman / signaller present' },
  { key: 'hasTrainingCertificates', label: 'Lifting personnel training certificates checked' },
  { key: 'hasEmergencyProcedure', label: 'Emergency procedure in place' },
  { key: 'hasSiteSurvey', label: 'Site survey conducted' },
  { key: 'hasLiftingCalculation', label: 'Lifting calculation provided' },
  { key: 'hasGroundCompaction', label: 'Ground bearing / compaction checked' },
  { key: 'hasEquipmentInspection', label: 'Equipment inspection completed' },
  { key: 'hasThirdPartyCertificate', label: 'Third-party certificates provided' },
  { key: 'hasAccessoriesCertificate', label: 'Lifting accessories certified' },
  { key: 'hasWindSpeedCheck', label: 'Wind speed checked against limit' },
  { key: 'hasLoadSpreaders', label: 'Load spreaders checked' },
  { key: 'hasTagLines', label: 'Tag lines provided' },
  { key: 'hasSafeDistance', label: 'Safe distance from power lines confirmed' },
  { key: 'hasExclusionZone', label: 'Exclusion zone established' },
  { key: 'hasPPE', label: 'PPE available and checked' },
];

document.getElementById('checklist').innerHTML = CHECKLIST_ITEMS.map(item => `
  <div class="check-row">
    <input type="checkbox" id="chk_${item.key}">
    <label for="chk_${item.key}">${item.label}</label>
  </div>
`).join('');

const params = new URLSearchParams(location.search);
const permitId = params.get('id');
const viewMode = params.get('mode') === 'view';
let permit = permitId ? DB.getPermits().find(p => p.id === permitId) : null;
const isNew = !permit;

if (isNew) {
  permit = {
    id: uid('P'),
    permitNumber: DB.nextPermitNumber(),
    status: 'active',
    issueDate: new Date().toISOString(),
  };
}

document.getElementById('pageTitle').textContent = viewMode ? `Permit ${permit.permitNumber}` : (isNew ? 'New lifting permit' : `Edit permit ${permit.permitNumber}`);
document.getElementById('pageCrumb').textContent = viewMode ? 'Viewing permit — read only' : 'Permit-to-work for a lifting operation';

// ---- Assessment dropdown ----
const assessments = DB.getAssessments().sort((a,b) => new Date(b.date) - new Date(a.date));
function assessmentGeometryLabel(a) {
  return a.jibMode
    ? `${a.boomAngle}° boom angle (${a.jibLength}m jib, ${a.jibOffset}° offset)`
    : `${a.workingRadius}m radius, ${a.boomLength}m boom`;
}

const assessmentSelect = document.getElementById('assessmentSelect');
assessmentSelect.innerHTML += assessments.map(a =>
  `<option value="${a.id}">${fmtDate(a.date)} — ${a.craneModel} — ${a.loadWeight}t @ ${a.jibMode ? a.boomAngle + '°' : a.workingRadius + 'm'} ${a.isValid ? '(Allowed)' : '(Not allowed)'}</option>`
).join('');

function renderAssessmentSummary() {
  const id = assessmentSelect.value;
  const a = assessments.find(x => x.id === id);
  const el = document.getElementById('assessmentSummary');
  if (!a) { el.innerHTML = ''; renderDiagramThumbs(null); renderLiftPlanningSummary(null); return; }
  el.innerHTML = `<div class="banner ${a.isValid ? 'banner-ok' : 'banner-danger'}" style="margin-top:10px;">
    ${a.craneModel} · ${a.configuration} · ${a.loadWeight}t at ${assessmentGeometryLabel(a)} — capacity ${a.maximumCapacity.toFixed(2)}t —
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
       <ol class="briefing-list">${a.briefingPoints.map(b => `<li>${b}</li>`).join('')}</ol>`
    : '';

  const exclusionHtml = (a.exclusionZoneM != null || a.exclusionZoneNote)
    ? `<div class="section-title">Exclusion zone</div>
       ${a.exclusionZoneM != null ? `<div class="exclusion-figure">${a.exclusionZoneM} m <span>minimum barriered radius (starting point)</span></div>` : ''}
       <p class="hint">${a.exclusionZoneNote || ''}</p>`
    : '';

  const trainingHtml = (a.trainingRequirements && a.trainingRequirements.length)
    ? `<div class="section-title">Training required for the lifting team</div>
       <div class="training-grid">
         ${a.trainingRequirements.map(t => `
           <div class="training-cat ${t.required ? 'required' : ''}">
             <div class="training-cat-head">
               <strong>${t.category}</strong>
               <span class="badge ${t.required ? 'badge-fail' : 'badge-ok'}"><span class="badge-dot"></span>${t.required ? 'Mandatory for this lift' : 'Standard requirement'}</span>
             </div>
             <ul>${t.items.map(i => `<li>${i}</li>`).join('')}</ul>
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

// ---- Load existing permit data ----
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  document.getElementById('radCritical').checked = !!permit.isCriticalLift;
  document.getElementById('radNonCritical').checked = !permit.isCriticalLift;
  updateCriticalHint();
  if (permit.assessmentId) assessmentSelect.value = permit.assessmentId;
  renderAssessmentSummary();
  document.getElementById('chkRiskAssessment').checked = !!permit.hasRiskAssessment;
  document.getElementById('chkMethodStatement').checked = !!permit.hasMethodStatement;
  document.getElementById('personInCharge').value = permit.personInCharge || '';
  document.getElementById('contractor').value = permit.contractor || '';
  CHECKLIST_ITEMS.forEach(item => {
    document.getElementById(`chk_${item.key}`).checked = !!permit[item.key];
  });
  document.getElementById('issuerName').value = permit.issuerName || '';
  document.getElementById('approverName').value = permit.approverName || '';
  document.getElementById('verifierName').value = permit.verifierName || '';
  if (permit.issuerSignature) sigIssuer.loadDataUrl(permit.issuerSignature);
  if (permit.approverSignature) sigApprover.loadDataUrl(permit.approverSignature);
  if (permit.verifierSignature) sigVerifier.loadDataUrl(permit.verifierSignature);

  if (permit.status === 'suspended') {
    document.getElementById('statusBanner').innerHTML = `<div class="banner banner-danger">
      <strong>Permit suspended</strong> by ${permit.ptwSuspendedBy || 'unknown'}: ${permit.suspensionReason || 'no reason recorded'}
    </div>`;
  } else if (permit.validTo && new Date(permit.validTo) < new Date()) {
    document.getElementById('statusBanner').innerHTML = `<div class="banner banner-warn"><strong>This permit has expired.</strong></div>`;
  }
}

if (!isNew) loadForm();

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
else {
  document.getElementById('validFrom').value = toLocalInput(new Date().toISOString());
  document.getElementById('date').value = new Date().toISOString().slice(0,10);
}

// ---- View mode: disable everything ----
if (viewMode) {
  document.querySelectorAll('#permitContent input, #permitContent select, #permitContent textarea, #permitContent button').forEach(el => {
    if (el.id === 'btnPrint') return;
    el.disabled = true;
  });
  [sigIssuer, sigApprover, sigVerifier].forEach(c => c.setDisabled(true));
  document.getElementById('actionRow').style.display = 'none';
} else if (!isNew) {
  document.getElementById('suspendCard').style.display = permit.status === 'suspended' ? 'none' : 'block';
}

document.getElementById('btnSuspend')?.addEventListener('click', () => {
  const by = document.getElementById('ptwSuspendedBy').value.trim();
  const reason = document.getElementById('suspensionReason').value.trim();
  if (!by || !reason) { alert('Enter who is suspending the permit and the reason.'); return; }
  permit.status = 'suspended';
  permit.ptwSuspendedBy = by;
  permit.suspensionReason = reason;
  DB.savePermit(permit);
  syncPermitToProject(permit).then(() => { alert('Permit suspended.'); location.reload(); });
});

// ---- Validation (mirrors the original PermitValidator) ----
function validate(data) {
  const errors = [];
  if (!data.projectNumber) errors.push('Project number is required.');
  if (!data.location) errors.push('Location is required.');
  if (!data.personInCharge) errors.push('Person in charge is required.');
  if (!data.hasRiskAssessment) errors.push('Risk assessment must be confirmed available.');
  if (!data.hasMethodStatement) errors.push('Method statement must be confirmed available.');
  if (!data.validFrom || !data.validTo || new Date(data.validTo) <= new Date(data.validFrom)) {
    errors.push('Valid-to date/time must be after valid-from date/time.');
  }
  if (!data.issuerName) errors.push('Issuer name is required.');
  if (!data.issuerSignature) errors.push('Issuer signature is required.');
  if (data.isCriticalLift) {
    const a = assessments.find(x => x.id === data.assessmentId);
    if (!a) errors.push('Critical lifts require a linked crane assessment.');
    else if (!a.isValid) errors.push('The linked crane assessment is not within capacity — a critical lift cannot proceed on a failed assessment.');
    if (!data.approverName || !data.approverSignature) errors.push('Critical lifts require an approver name and signature.');
  }
  return errors;
}

document.getElementById('btnSave').addEventListener('click', () => {
  const linkedAssessment = assessments.find(x => x.id === assessmentSelect.value) || null;
  const data = {
    ...permit,
    projectNumber: document.getElementById('projectNumber').value.trim(),
    location: document.getElementById('location').value.trim(),
    date: document.getElementById('date').value,
    validFrom: document.getElementById('validFrom').value ? new Date(document.getElementById('validFrom').value).toISOString() : '',
    validTo: document.getElementById('validTo').value ? new Date(document.getElementById('validTo').value).toISOString() : '',
    workDescription: document.getElementById('workDescription').value.trim(),
    otherPermits: document.getElementById('otherPermits').value.trim(),
    isCriticalLift: document.getElementById('radCritical').checked,
    assessmentId: assessmentSelect.value || null,
    // Denormalize the linked assessment's lift diagrams onto the permit itself so
    // the permit stays self-contained (viewable/printable/downloadable) even if
    // the source assessment is later edited or deleted.
    diagram3D: linkedAssessment ? (linkedAssessment.diagram3D || null) : null,
    diagramSketch: linkedAssessment ? (linkedAssessment.diagramSketch || null) : null,
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
  CHECKLIST_ITEMS.forEach(item => { data[item.key] = document.getElementById(`chk_${item.key}`).checked; });

  const errors = validate(data);
  const errEl = document.getElementById('validationErrors');
  if (errors.length) {
    errEl.innerHTML = `<div class="banner banner-danger">Please correct the following:<br>&bull; ${errors.join('<br>&bull; ')}</div>`;
    errEl.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  errEl.innerHTML = '';
  permit = data;
  DB.savePermit(permit);
  syncPermitToProject(permit).then(() => { location.href = `permit.html?id=${permit.id}&mode=view`; });
});

// Mirror the permit onto its project's tracked items (see js/project-link.js).
async function syncPermitToProject(p) {
  if (!p.projectId || typeof ProjectLink === 'undefined') return;
  const expired = p.validTo && new Date(p.validTo) < new Date();
  const res = await ProjectLink.sync(p.projectId,
    { kind: 'permit', id: p.id, label: `Permit ${p.permitNumber || p.id}` },
    {
      title: `Permit ${p.permitNumber || ''}: ${(p.workDescription || p.location || 'Lifting permit').slice(0, 150)}`,
      status: p.status === 'suspended' ? 'open' : expired ? 'closed' : 'in_progress',
      priority: p.status === 'suspended' ? 'high' : p.isCriticalLift ? 'critical' : 'medium',
      dueDate: p.validTo ? p.validTo.slice(0, 10) : '',
      location: p.location || '',
      details: [p.isCriticalLift ? 'Critical lift.' : 'Non-critical lift.',
                p.personInCharge ? `Person in charge: ${p.personInCharge}.` : '',
                p.status === 'suspended' ? `Suspended by ${p.ptwSuspendedBy || '?'}: ${p.suspensionReason || ''}` : ''].filter(Boolean).join(' ')
    });
  if (!res.ok) alert('The permit was saved, but it could not be added to the project: ' + res.error);
}

document.getElementById('btnPrint').addEventListener('click', () => window.print());
