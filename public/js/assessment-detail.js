// assessment-detail.js — renders a saved assessment as a complete, self-contained
// record: every parameter that was entered, the chart lookup behind the verdict,
// the wind rule that was applied, environment/site conditions, exclusion zone,
// pre-lift briefing, categorized training requirements, lift diagrams, notes, and
// any permit the assessment is attached to.
//
// Two things this module does that a plain field dump cannot:
//
//   1. **Back-fills older records.** Assessments saved before the briefing /
//      training / exclusion-zone fields existed have none of them stored. Rather
//      than showing empty sections (which is why those records used to render as
//      little more than the two diagrams), this module recomputes them from the
//      parameters that *were* saved, via LiftPlanning, and labels them clearly as
//      regenerated so nobody mistakes them for what was briefed on the day.
//   2. **Escapes everything user-entered.** Assessor names and notes are free
//      text; they are HTML-escaped here rather than concatenated raw into
//      innerHTML.
//
// Nothing in this file replaces the existing history.html functions — both
// viewDiagram() and viewAssessment() there still work; viewAssessment() now
// delegates its rendering here so permit.html and any future page can reuse the
// exact same record layout.

const AssessmentDetail = (function () {

  // ---- small formatting helpers, all tolerant of missing/NaN values ----

  function esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // num(4.567, 1, ' m') -> "4.6 m"; num(undefined) -> "—"
  function num(v, dp, unit) {
    if (!isNum(v)) return '—';
    return v.toFixed(dp == null ? 1 : dp) + (unit || '');
  }

  function dateStr(iso) {
    if (typeof fmtDate === 'function') return fmtDate(iso);
    return iso ? new Date(iso).toLocaleString() : '—';
  }

  function specFor(model) {
    return (typeof CRANE_DATA !== 'undefined' && model && CRANE_DATA[model]) ? CRANE_DATA[model] : null;
  }

  // The effective wind stop-work limit is whichever is LOWER: the crane's own
  // manufacturer rating, or the ADOSH-SF site threshold. Mirrors the same rule
  // assessment.js applies when the assessment is first run.
  function windRule(spec) {
    const adosh = (typeof ADOSH_WIND_STOP_MS !== 'undefined') ? ADOSH_WIND_STOP_MS : null;
    const rated = spec && isNum(spec.maxWindSpeed) ? spec.maxWindSpeed : null;
    if (rated == null && adosh == null) return { limit: null, isAdosh: false, rated: null, adosh: null };
    if (rated == null) return { limit: adosh, isAdosh: true, rated: null, adosh };
    if (adosh == null) return { limit: rated, isAdosh: false, rated, adosh: null };
    return { limit: Math.min(rated, adosh), isAdosh: adosh <= rated, rated, adosh };
  }

  // ---- back-fill for records saved before these fields were stored ----

  function planningParamsFrom(a, spec, wind) {
    const env = a.environment || {};
    return {
      craneModel: a.craneModel,
      configuration: a.configuration,
      jibMode: !!a.jibMode,
      radius: isNum(a.workingRadius) ? a.workingRadius : null,
      boomAngle: isNum(a.boomAngle) ? a.boomAngle : null,
      loadWeight: isNum(a.loadWeight) ? a.loadWeight : null,
      craneMaxCapacity: spec ? spec.maxCapacity : null,
      utilization: isNum(a.utilization) && a.utilization < 999 ? a.utilization : null,
      isValid: typeof a.isValid === 'boolean' ? a.isValid : null,
      windSpeedMs: isNum(a.windSpeed) ? a.windSpeed : null,
      windLimitMs: wind.limit,
      windLimitIsAdosh: wind.isAdosh,
      exclusionZoneM: null,
      exclusionZoneNote: null,
      visibility: env.visibility || '',
      precipitation: env.precipitation || '',
      lighting: env.lighting || '',
      ground: env.ground || '',
      loadDimensionM: isNum(env.loadDimensionM) ? env.loadDimensionM : null
    };
  }

  // Returns { exclusion, briefing, training, regenerated } where `regenerated`
  // lists which of the three had to be rebuilt because the record predates them.
  function resolvePlanning(a, spec, wind) {
    const regenerated = [];
    const havePlanning = typeof LiftPlanning !== 'undefined';
    const p = havePlanning ? planningParamsFrom(a, spec, wind) : null;

    let exclusion = { zoneM: isNum(a.exclusionZoneM) ? a.exclusionZoneM : null, note: a.exclusionZoneNote || null };
    if (exclusion.zoneM == null && !exclusion.note && havePlanning) {
      const ez = LiftPlanning.computeExclusionZone(p);
      if (ez && (ez.zoneM != null || ez.note)) { exclusion = ez; regenerated.push('exclusion zone'); }
    }

    let training = Array.isArray(a.trainingRequirements) ? a.trainingRequirements : [];
    if (!training.length && havePlanning) {
      training = LiftPlanning.computeTrainingRequirements(p) || [];
      if (training.length) regenerated.push('training requirements');
    }

    let briefing = Array.isArray(a.briefingPoints) ? a.briefingPoints : [];
    if (!briefing.length && havePlanning) {
      briefing = LiftPlanning.generateBriefingPoints(
        Object.assign({}, p, { exclusionZoneM: exclusion.zoneM, exclusionZoneNote: exclusion.note })
      ) || [];
      if (briefing.length) regenerated.push('pre-lift briefing');
    }

    return { exclusion, briefing, training, regenerated };
  }

  // ---- section builders ----

  function table(rows) {
    const body = rows
      .filter(Boolean)
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
      .join('');
    return `<table class="spec-table">${body}</table>`;
  }

  function verdictPanel(a) {
    const ok = !!a.isValid;
    const util = isNum(a.utilization) && a.utilization < 999 ? a.utilization.toFixed(0) + '%' : '—';
    const pct = isNum(a.utilization) && a.utilization < 999 ? Math.min(a.utilization, 100) : 0;
    // Same colour thresholds the assessment page itself uses.
    let barColor = 'var(--ok-green)';
    if (!ok || (isNum(a.utilization) && a.utilization > 100)) barColor = 'var(--danger-red)';
    else if (isNum(a.utilization) && a.utilization > 85) barColor = 'var(--amber-dark)';
    return `
      <div class="result-panel" style="margin-top:0;">
        <div class="result-head ${ok ? 'ok' : 'fail'}">
          <div class="verdict">${ok ? '✓ Lift was allowed' : '✕ Lift was not allowed'}</div>
          <div class="util">${util} of capacity</div>
        </div>
        <div class="result-body">
          <div class="util-bar-track"><div class="util-bar-fill" style="width:${pct}%; background:${barColor};"></div></div>
        </div>
      </div>`;
  }

  function parameterRows(a, spec) {
    const margin = (isNum(a.maximumCapacity) && isNum(a.loadWeight)) ? a.maximumCapacity - a.loadWeight : null;
    return [
      ['Crane model', esc(a.craneModel || '—')],
      ['Configuration', esc(a.configuration || '—')],
      ['Boom setup', a.jibMode ? 'Main boom + jib (angle-indexed chart)' : 'Main boom only (radius-indexed chart)'],
      ['Load weight', num(a.loadWeight, 2, ' t')],
      a.jibMode
        ? ['Boom angle', num(a.boomAngle, 1, '°')]
        : ['Working radius', num(a.workingRadius, 1, ' m')],
      a.jibMode ? ['Jib length', isNum(a.jibLength) ? num(a.jibLength, 1, ' m') : esc(a.jibLength || '—')] : null,
      a.jibMode ? ['Jib offset', isNum(a.jibOffset) ? num(a.jibOffset, 0, '°') : esc(a.jibOffset || '—')] : null,
      ['Boom length', num(a.boomLength, 2, ' m')],
      ['Wind speed', isNum(a.windSpeed) ? `${a.windSpeed.toFixed(1)} m/s (${(a.windSpeed * 3.6).toFixed(1)} km/h)` : '—'],
      ['Wind direction', isNum(a.windDirection) ? num(a.windDirection, 0, '° from north') : '—'],
      ['Slew direction', isNum(a.slewDirection) ? num(a.slewDirection, 0, '° from north') : '—'],
      ['Chart capacity at this point', num(a.maximumCapacity, 2, ' t')],
      ['Remaining margin', isNum(margin) ? `${margin >= 0 ? '' : '−'}${Math.abs(margin).toFixed(2)} t` : '—'],
      ['Utilization of chart capacity', isNum(a.utilization) && a.utilization < 999 ? a.utilization.toFixed(1) + '%' : '—'],
      spec ? ['Crane max rated capacity', num(spec.maxCapacity, 0, ' t')] : null,
      spec ? ['Load as % of crane max', (isNum(a.loadWeight) && isNum(spec.maxCapacity) && spec.maxCapacity > 0) ? (a.loadWeight / spec.maxCapacity * 100).toFixed(1) + '%' : '—'] : null
    ];
  }

  function windSection(a, wind) {
    if (wind.limit == null) return '';
    const over = isNum(a.windSpeed) && a.windSpeed > wind.limit;
    const near = isNum(a.windSpeed) && !over && a.windSpeed > wind.limit * 0.6;
    const bannerClass = over ? 'banner-danger' : (near ? 'banner-warn' : 'banner-ok');
    const verdict = over
      ? 'Recorded wind speed <strong>exceeded</strong> the stop-work limit for this lift.'
      : (near
        ? 'Recorded wind speed was <strong>within</strong> the limit but approaching it — conditions needed monitoring throughout the lift.'
        : 'Recorded wind speed was <strong>within</strong> the stop-work limit for this lift.');
    return `
      <div class="section-title">Wind stop-work rule applied</div>
      ${table([
        ['Recorded wind speed', isNum(a.windSpeed) ? `${a.windSpeed.toFixed(1)} m/s (${(a.windSpeed * 3.6).toFixed(1)} km/h)` : '—'],
        wind.rated != null ? ['Crane manufacturer rating', `${wind.rated.toFixed(2)} m/s (${(wind.rated * 3.6).toFixed(1)} km/h)`] : null,
        wind.adosh != null ? ['ADOSH-SF site threshold', `${wind.adosh.toFixed(2)} m/s (${(wind.adosh * 3.6).toFixed(1)} km/h)`] : null,
        ['Effective limit (lower of the two)', `${wind.limit.toFixed(2)} m/s — ${wind.isAdosh ? 'ADOSH-SF CoP 34.0 threshold governs' : "crane's own rating governs"}`],
        ['Margin to limit', isNum(a.windSpeed) ? `${(wind.limit - a.windSpeed).toFixed(2)} m/s` : '—']
      ])}
      <div class="banner ${bannerClass}" style="margin-top:10px;"><div>${verdict}</div></div>`;
  }

  function environmentSection(a) {
    const env = a.environment || {};
    const label = (f, v) => (typeof LiftPlanning !== 'undefined' && v) ? esc(LiftPlanning.envLabel(f, v)) : '—';
    const anyRecorded = env.visibility || env.precipitation || env.lighting || env.ground || isNum(env.loadDimensionM);
    return `
      <div class="section-title">Environment &amp; site conditions</div>
      ${anyRecorded ? '' : '<p class="hint">No environmental conditions were recorded on this assessment.</p>'}
      ${table([
        ['Visibility', label('visibility', env.visibility)],
        ['Precipitation', label('precipitation', env.precipitation)],
        ['Lighting', label('lighting', env.lighting)],
        ['Ground conditions', label('ground', env.ground)],
        ["Load's largest dimension", num(env.loadDimensionM, 1, ' m')]
      ])}`;
  }

  function exclusionSection(ex) {
    if (ex.zoneM == null && !ex.note) return '';
    return `
      <div class="section-title">Exclusion zone</div>
      ${ex.zoneM != null ? `<div class="exclusion-figure">${esc(ex.zoneM)} m <span>minimum barriered radius (starting point)</span></div>` : ''}
      <p class="hint">${esc(ex.note || '')}</p>`;
  }

  function briefingSection(points) {
    if (!points.length) return '';
    return `
      <div class="section-title">Pre-lift briefing</div>
      <ol class="briefing-list">${points.map(pt => `<li>${esc(pt)}</li>`).join('')}</ol>`;
  }

  function trainingSection(training) {
    if (!training.length) return '';
    return `
      <div class="section-title">Training &amp; competency requirements</div>
      ${training.map(t => `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px;">
            <strong>${esc(t.category)}</strong>
            <span class="badge ${t.required ? 'badge-warn' : 'badge-neutral'}"><span class="badge-dot"></span>${t.required ? 'Mandatory for this lift' : 'Recommended'}</span>
          </div>
          <ul class="briefing-list" style="margin:0;">${(t.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>`).join('')}`;
  }

  function diagramSection(a) {
    const shots = [
      a.diagram3D ? { src: a.diagram3D, label: '3D view' } : null,
      a.diagramSketch ? { src: a.diagramSketch, label: 'Plan sketch' } : null
    ].filter(Boolean);
    if (!shots.length) {
      return `<div class="section-title">Lift diagrams</div>
        <p class="hint">No lift diagrams were captured with this record. Diagrams are attached automatically for assessments saved from the current version of the assessment page.</p>`;
    }
    return `
      <div class="section-title">Lift diagrams</div>
      <div style="display:flex; gap:14px; flex-wrap:wrap;">
        ${shots.map(s => `
          <div style="flex:1; min-width:280px;">
            <img class="lightbox-img" src="${s.src}" alt="${esc(s.label)}">
            <div style="text-align:center; margin-top:6px;">
              <span class="hint">${esc(s.label)}</span>
              <a class="btn btn-sm no-print" style="margin-left:8px;" href="${s.src}" download="${esc(a.id || 'assessment')}-${s.label.replace(/\s+/g, '-').toLowerCase()}.png">Download</a>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function linkedPermitSection(a) {
    if (typeof DB === 'undefined') return '';
    let permits = [];
    try { permits = DB.getPermits().filter(p => p.assessmentId === a.id); } catch (e) { permits = []; }
    if (!permits.length) {
      return `<div class="section-title">Linked permit</div>
        <p class="hint">This assessment is not attached to any permit-to-work.
        <a class="no-print" href="permit.html?type=lifting&amp;assessmentId=${encodeURIComponent(a.id)}">Raise a lifting permit from it</a>.</p>`;
    }
    return `
      <div class="section-title">Linked permit${permits.length > 1 ? 's' : ''}</div>
      ${permits.map(p => `
        <div class="banner banner-info">
          <div>
            Lifting permit <strong class="num">${esc(p.permitNumber || p.id)}</strong>
            — ${esc(p.location || 'location not recorded')}
            ${p.isCriticalLift ? ' · <strong>critical lift</strong>' : ''}
            ${p.status ? ` · status: ${esc(p.status)}` : ''}
            <a class="btn btn-sm no-print" style="margin-left:8px;" href="permit.html?id=${encodeURIComponent(p.id)}&mode=view">View permit</a>
          </div>
        </div>`).join('')}`;
  }

  function recordSection(a, regenerated) {
    return `
      <div class="section-title">Record details</div>
      ${table([
        ['Record ID', esc(a.id || '—')],
        ['Assessment carried out', dateStr(a.date)],
        ['Assessed by', esc(a.assessorName || '—')],
        ['Result', a.isValid ? 'ALLOWED' : 'NOT ALLOWED']
      ])}
      ${regenerated.length ? `
        <div class="banner banner-warn" style="margin-top:10px;">
          <div><strong>Regenerated sections.</strong> This record was saved before the app stored the
          ${esc(regenerated.join(', '))} with each assessment, so ${regenerated.length > 1 ? 'those sections have' : 'that section has'}
          been recomputed here from the parameters that were saved. Treat ${regenerated.length > 1 ? 'them' : 'it'} as a
          reconstruction, not as a record of what was actually briefed on the day.</div>
        </div>` : ''}`;
  }

  // ---- public API ----

  // Full record body (no modal chrome) — reusable for printing or embedding.
  function buildHTML(a) {
    const spec = specFor(a.craneModel);
    const wind = windRule(spec);
    const plan = resolvePlanning(a, spec, wind);

    return [
      verdictPanel(a),
      `<div class="section-title">Lift parameters</div>`,
      table(parameterRows(a, spec)),
      windSection(a, wind),
      environmentSection(a),
      exclusionSection(plan.exclusion),
      briefingSection(plan.briefing),
      trainingSection(plan.training),
      diagramSection(a),
      a.notes
        ? `<div class="section-title">Notes</div><p style="white-space:pre-wrap; font-size:13.5px;">${esc(a.notes)}</p>`
        : `<div class="section-title">Notes</div><p class="hint">No notes were recorded.</p>`,
      linkedPermitSection(a),
      recordSection(a, plan.regenerated),
      `<div class="banner banner-warn" style="margin-top:14px;"><div><strong>Planning aid only.</strong>
        This record does not replace the crane's certified load chart, the Appointed Person's
        judgement, or ${typeof ADOSH_COP_REFERENCE !== 'undefined' ? esc(ADOSH_COP_REFERENCE) : 'ADOSH-SF CoP 34.0'}.</div></div>`
    ].join('\n');
  }

  // Opens the record in the standard modal used across the app.
  // rootId defaults to the #lightboxRoot container history.html already has.
  function openModal(a, rootId) {
    const root = document.getElementById(rootId || 'lightboxRoot');
    if (!root || !a) return;

    root.innerHTML = `
      <div class="modal-backdrop" id="adBackdrop">
        <div class="modal" id="adModal" style="max-width:940px;">
          <div class="modal-head">
            <div>
              <strong>${esc(a.craneModel || 'Assessment')} — ${dateStr(a.date)}</strong>
              <div class="hint">${esc(a.configuration || '')}${a.assessorName ? ' · assessed by ' + esc(a.assessorName) : ''}</div>
            </div>
            <button class="close-x no-print" id="adClose" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body" id="adBody">${buildHTML(a)}</div>
          <div class="modal-foot no-print">
            <button class="btn btn-sm" id="adPrint">Print / save as PDF</button>
            <button class="btn btn-sm btn-primary" id="adClose2">Close</button>
          </div>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.getElementById('adClose').addEventListener('click', close);
    document.getElementById('adClose2').addEventListener('click', close);
    document.getElementById('adBackdrop').addEventListener('click', (e) => { if (e.target.id === 'adBackdrop') close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('adPrint').addEventListener('click', () => {
      document.body.classList.add('printing-modal');
      window.print();
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-modal'), { once: true });
  }

  return { buildHTML, openModal, escapeHtml: esc, windRule, resolvePlanning };
})();
