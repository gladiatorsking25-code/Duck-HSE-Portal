renderSidebar('assessment');

const craneModelSel = document.getElementById('craneModel');
const liftModeSel = document.getElementById('liftMode');
const configSel = document.getElementById('configuration');
const boomConfigRow = document.getElementById('boomConfigRow');
const jibConfigRow = document.getElementById('jibConfigRow');
const jibConfigSel = document.getElementById('jibConfiguration');
const jibLengthSel = document.getElementById('jibLength');
const jibLengthField = document.getElementById('jibLengthField');
const jibOffsetSel = document.getElementById('jibOffset');
const boomSel = document.getElementById('boomLength');
const boomLengthField = document.getElementById('boomLengthField');
const loadInput = document.getElementById('loadWeight');
const radiusInput = document.getElementById('radius');
const radiusField = document.getElementById('radiusField');
const radiusHint = document.getElementById('radiusHint');
const boomAngleInput = document.getElementById('boomAngle');
const boomAngleField = document.getElementById('boomAngleField');
const angleHint = document.getElementById('angleHint');
const windInput = document.getElementById('windSpeed');
const windHint = document.getElementById('windHint');
const windDirectionSel = document.getElementById('windDirection');
const slewDirectionSel = document.getElementById('slewDirection');
const adoshWindBannerText = document.getElementById('adoshWindBannerText');
const rangeWarning = document.getElementById('rangeWarning');
const resultPanel = document.getElementById('resultPanel');
const briefingPanel = document.getElementById('briefingPanel');
const saveRow = document.getElementById('saveRow');

const envVisibilitySel = document.getElementById('envVisibility');
const envPrecipitationSel = document.getElementById('envPrecipitation');
const envLightingSel = document.getElementById('envLighting');
const envGroundSel = document.getElementById('envGround');
const loadDimensionInput = document.getElementById('loadDimension');

let lastResult = null;

// ---- Compass direction options (shared by wind + slew/load-bearing fields) ----
const COMPASS_POINTS = [
  ['0', 'N (0°)'], ['45', 'NE (45°)'], ['90', 'E (90°)'], ['135', 'SE (135°)'],
  ['180', 'S (180°)'], ['225', 'SW (225°)'], ['270', 'W (270°)'], ['315', 'NW (315°)']
];
windDirectionSel.innerHTML = `<option value="">Not recorded</option>` + COMPASS_POINTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
slewDirectionSel.innerHTML = COMPASS_POINTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

// ---- Effective wind limit: the crane's rated limit AND the ADOSH-SF CoP 34.0
// site stop-work threshold both apply — whichever is lower governs the lift. ----
function effectiveWindLimitMs(spec) {
  return Math.min(spec.maxWindSpeed, ADOSH_WIND_STOP_MS);
}
function windLimitIsAdosh(spec) {
  return ADOSH_WIND_STOP_MS < spec.maxWindSpeed;
}

// ---- Lift visualization (3D turntable + 2D plan sketch) ----
const vizCanvas = document.getElementById('vizCanvas');
const vizSketch = document.getElementById('vizSketch');
const btnToggleRotate = document.getElementById('btnToggleRotate');
const btnDownload3d = document.getElementById('btnDownload3d');
const btnDownloadSketch = document.getElementById('btnDownloadSketch');
let vizHandle = null;
let vizRotating = true;

function buildVizParams() {
  const spec = currentSpec();
  const jib = isJibMode();
  const load = parseFloat(loadInput.value);
  const wind = parseFloat(windInput.value);
  const windDir = windDirectionSel.value === '' ? null : parseFloat(windDirectionSel.value);
  const slew = slewDirectionSel.value === '' ? 0 : parseFloat(slewDirectionSel.value);

  let boomLength, radius, boomAngleDeg;
  if (jib) {
    boomLength = spec ? spec.maxBoomLength : 30;
    boomAngleDeg = parseFloat(boomAngleInput.value);
    radius = null;
  } else {
    boomLength = parseFloat(boomSel.value);
    radius = parseFloat(radiusInput.value);
    if (!isNaN(radius) && !isNaN(boomLength) && boomLength > 0) {
      boomAngleDeg = Math.acos(Math.max(-1, Math.min(1, radius / boomLength))) * 180 / Math.PI;
    } else {
      boomAngleDeg = 55;
    }
  }

  return {
    craneModel: spec ? spec.model : '',
    jibMode: jib,
    boomLength: isNaN(boomLength) ? 20 : boomLength,
    radius: isNaN(radius) ? null : radius,
    boomAngleDeg: isNaN(boomAngleDeg) ? 55 : boomAngleDeg,
    loadWeight: isNaN(load) ? 0 : load,
    windSpeedMs: isNaN(wind) ? 0 : wind,
    windDirectionDeg: windDir,
    slewDeg: isNaN(slew) ? 0 : slew,
    isValid: lastResult ? lastResult.isValid : null
  };
}

function refreshViz() {
  const p = buildVizParams();
  if (vizHandle) vizHandle.update(p);
  vizSketch.innerHTML = CraneVisual.sketchSVGString(p);
}

if (vizCanvas) {
  vizHandle = CraneVisual.mount(vizCanvas, buildVizParams());
  refreshViz();

  btnToggleRotate.addEventListener('click', () => {
    vizRotating = !vizRotating;
    vizHandle.setAutoRotate(vizRotating);
    btnToggleRotate.textContent = vizRotating ? 'Pause rotation' : 'Resume rotation';
  });

  btnDownload3d.addEventListener('click', () => {
    const spec = currentSpec();
    vizHandle.capturePNG(dataUrl => {
      CraneVisual.downloadDataUrl(dataUrl, `lift-3d-${(spec ? spec.model : 'crane')}-${Date.now()}.png`);
      vizHandle.setAutoRotate(vizRotating); // capture pauses rotation — restore prior state
    });
  });

  btnDownloadSketch.addEventListener('click', () => {
    const spec = currentSpec();
    const svgStr = CraneVisual.sketchSVGString(buildVizParams());
    CraneVisual.svgStringToPng(svgStr, 640, 360, dataUrl => {
      CraneVisual.downloadDataUrl(dataUrl, `lift-sketch-${(spec ? spec.model : 'crane')}-${Date.now()}.png`);
    });
  });

  [loadInput, radiusInput, boomAngleInput].forEach(el => el.addEventListener('input', refreshViz));
  [windDirectionSel, slewDirectionSel].forEach(el => el.addEventListener('change', refreshViz));
}

// ---- Pre-lift briefing, training requirements & exclusion zone ----
function buildPlanningParams() {
  const spec = currentSpec();
  const vp = buildVizParams();
  const windLimit = effectiveWindLimitMs(spec);
  const loadDim = parseFloat(loadDimensionInput.value);

  const ez = LiftPlanning.computeExclusionZone({
    jibMode: vp.jibMode,
    radius: vp.radius,
    loadDimensionM: isNaN(loadDim) ? null : loadDim,
    windSpeedMs: vp.windSpeedMs,
    windLimitMs: windLimit
  });

  return {
    craneModel: vp.craneModel,
    configuration: lastResult ? lastResult.config : null,
    jibMode: vp.jibMode,
    radius: vp.radius,
    boomAngle: vp.jibMode ? vp.boomAngleDeg : null,
    loadWeight: vp.loadWeight,
    craneMaxCapacity: spec ? spec.maxCapacity : null,
    utilization: lastResult ? lastResult.utilization : null,
    isValid: lastResult ? lastResult.isValid : null,
    windSpeedMs: vp.windSpeedMs,
    windLimitMs: windLimit,
    windLimitIsAdosh: spec ? windLimitIsAdosh(spec) : false,
    exclusionZoneM: ez.zoneM,
    exclusionZoneNote: ez.note,
    visibility: envVisibilitySel.value,
    precipitation: envPrecipitationSel.value,
    lighting: envLightingSel.value,
    ground: envGroundSel.value,
    loadDimensionM: isNaN(loadDim) ? null : loadDim
  };
}

function renderBriefing() {
  if (!lastResult) { briefingPanel.innerHTML = ''; return; }
  const p = buildPlanningParams();
  const training = LiftPlanning.computeTrainingRequirements(p);
  const briefing = LiftPlanning.generateBriefingPoints(p);

  briefingPanel.innerHTML = `
    <div class="card" style="margin-top:16px;">
      <div class="section-title" style="margin-top:0;">Pre-lift briefing</div>
      <p class="viz-hint" style="margin-top:-6px;">Generated from this specific lift — walk through it with the crew before work starts. Planning aid only; does not replace the site risk assessment / method statement.</p>
      <ol class="briefing-list">
        ${briefing.map(b => `<li>${b}</li>`).join('')}
      </ol>

      <div class="section-title">Exclusion zone</div>
      ${p.exclusionZoneM != null
        ? `<div class="exclusion-figure">${p.exclusionZoneM} m <span>minimum barriered radius (starting point)</span></div>`
        : ''}
      <p class="hint">${p.exclusionZoneNote}</p>

      <div class="section-title">Training required for the lifting team</div>
      <div class="training-grid">
        ${training.map(t => `
          <div class="training-cat ${t.required ? 'required' : ''}">
            <div class="training-cat-head">
              <strong>${t.category}</strong>
              <span class="badge ${t.required ? 'badge-fail' : 'badge-ok'}"><span class="badge-dot"></span>${t.required ? 'Mandatory for this lift' : 'Standard requirement'}</span>
            </div>
            <ul>${t.items.map(i => `<li>${i}</li>`).join('')}</ul>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

[envVisibilitySel, envPrecipitationSel, envLightingSel, envGroundSel, loadDimensionInput].forEach(el => {
  el.addEventListener('input', renderBriefing);
  el.addEventListener('change', renderBriefing);
});

function currentSpec() {
  return CRANE_DATA[craneModelSel.value];
}

function isJibMode() {
  return liftModeSel.value === 'jib';
}

function populateCraneModels() {
  craneModelSel.innerHTML = Object.keys(CRANE_DATA)
    .map(m => `<option value="${m}">${m} — ${CRANE_DATA[m].maxCapacity}t max</option>`).join('');
  onModelOrModeChange();
}

function onModelOrModeChange() {
  const spec = currentSpec();
  const hasJib = spec.jibCharts && Object.keys(spec.jibCharts).length > 0;
  liftModeSel.querySelector('option[value="jib"]').disabled = !hasJib;
  if (!hasJib && isJibMode()) liftModeSel.value = 'boom';

  if (isJibMode()) {
    boomConfigRow.style.display = 'none';
    jibConfigRow.style.display = '';
    radiusField.style.display = 'none';
    boomAngleField.style.display = '';
    boomLengthField.style.display = 'none';
    populateJibConfigs();
  } else {
    boomConfigRow.style.display = '';
    jibConfigRow.style.display = 'none';
    radiusField.style.display = '';
    boomAngleField.style.display = 'none';
    boomLengthField.style.display = '';
    populateConfigs();
  }
  resetResult();
}

function populateConfigs() {
  const spec = currentSpec();
  configSel.innerHTML = Object.keys(spec.loadCharts).map(c => `<option value="${c}">${c}</option>`).join('');
  populateBoomLengths();
}

function populateBoomLengths() {
  const spec = currentSpec();
  boomSel.innerHTML = spec.boomLengths.map(b => `<option value="${b}">${b.toFixed(2)} m</option>`).join('');
  updateRadiusHint();
  updateWindHint();
}

function updateRadiusHint() {
  const spec = currentSpec();
  const config = configSel.value;
  const boom = parseFloat(boomSel.value);
  const range = CraneCalc.radiusRangeForBoom(spec, config, boom);
  if (range) {
    radiusInput.placeholder = `${range.min}–${range.max} m for this boom`;
    radiusHint.textContent = `This boom length's chart covers ${range.min}–${range.max} m radius.`;
  } else {
    radiusInput.placeholder = '';
    radiusHint.textContent = '';
  }
}

function updateWindHint() {
  const spec = currentSpec();
  const limit = effectiveWindLimitMs(spec);
  windHint.textContent = `Crane rated to ${spec.maxWindSpeed} m/s. Effective stop-work limit: ${limit} m/s (${(limit * 3.6).toFixed(1)} km/h).`;
  if (adoshWindBannerText) {
    adoshWindBannerText.innerHTML = windLimitIsAdosh(spec)
      ? `<strong>ADOSH-SF CoP 34.0 wind stop-work threshold applies:</strong> lifting must stop above ${ADOSH_WIND_STOP_KMH} km/h (${ADOSH_WIND_STOP_MS} m/s) regardless of this crane's ${spec.maxWindSpeed} m/s manufacturer rating, since ${ADOSH_WIND_STOP_KMH} km/h is the lower (more conservative) of the two limits.`
      : `Lifting must stop above this crane's manufacturer-rated ${spec.maxWindSpeed} m/s limit, which is lower than the ${ADOSH_WIND_STOP_KMH} km/h (${ADOSH_WIND_STOP_MS} m/s) ADOSH-SF CoP 34.0 site stop-work threshold. Confirm the current site-specific wind action limit with your appointed person.`;
  }
  refreshViz();
}

function populateJibConfigs() {
  const spec = currentSpec();
  jibConfigSel.innerHTML = Object.keys(spec.jibCharts).map(c => `<option value="${c}">${c}</option>`).join('');
  populateJibLengths();
}

function populateJibLengths() {
  const spec = currentSpec();
  const chart = spec.jibCharts[jibConfigSel.value];
  const lengths = Object.keys(chart).map(Number).sort((a, b) => a - b);
  jibLengthSel.innerHTML = lengths.map(l => `<option value="${l}">${l} m</option>`).join('');
  // fixed-length jibs (only one option) — hide the selector, it's not a real choice
  jibLengthField.style.display = lengths.length > 1 ? '' : 'none';
  populateJibOffsets();
}

function populateJibOffsets() {
  const spec = currentSpec();
  const chart = spec.jibCharts[jibConfigSel.value];
  const lenKey = Object.keys(chart).find(k => Number(k) === Number(jibLengthSel.value));
  const offsets = Object.keys(chart[lenKey]).map(Number).sort((a, b) => a - b);
  jibOffsetSel.innerHTML = offsets.map(o => `<option value="${o}">${o}°</option>`).join('');
  updateAngleHint();
  updateWindHint();
}

function updateAngleHint() {
  const spec = currentSpec();
  const range = CraneCalc.angleRangeForJib(spec, jibConfigSel.value, jibLengthSel.value, jibOffsetSel.value);
  if (range) {
    boomAngleInput.placeholder = `${range.min}–${range.max}°`;
    angleHint.textContent = `Chart covers ${range.min}°–${range.max}° boom angle for this jib length/offset.`;
  } else {
    boomAngleInput.placeholder = '';
    angleHint.textContent = '';
  }
}

craneModelSel.addEventListener('change', onModelOrModeChange);
liftModeSel.addEventListener('change', onModelOrModeChange);
configSel.addEventListener('change', () => { populateBoomLengths(); resetResult(); });
boomSel.addEventListener('change', () => { updateRadiusHint(); resetResult(); refreshViz(); });
jibConfigSel.addEventListener('change', () => { populateJibLengths(); resetResult(); });
jibLengthSel.addEventListener('change', () => { populateJibOffsets(); resetResult(); });
jibOffsetSel.addEventListener('change', () => { updateAngleHint(); resetResult(); refreshViz(); });

function resetResult() {
  resultPanel.innerHTML = '';
  briefingPanel.innerHTML = '';
  saveRow.style.display = 'none';
  lastResult = null;
}

// live wind warning as the user types
windInput.addEventListener('input', () => {
  const spec = currentSpec();
  const limit = effectiveWindLimitMs(spec);
  const w = parseFloat(windInput.value);
  const limitSource = windLimitIsAdosh(spec)
    ? `the ${ADOSH_WIND_STOP_KMH} km/h (${ADOSH_WIND_STOP_MS} m/s) ADOSH-SF CoP 34.0 stop-work threshold`
    : `this crane's ${spec.maxWindSpeed} m/s manufacturer-rated limit`;
  if (!isNaN(w) && w > limit) {
    rangeWarning.innerHTML = `<div class="banner banner-danger">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <div>Wind speed (${w} m/s / ${(w * 3.6).toFixed(1)} km/h) exceeds ${limitSource}. Lifting operations must stop.</div>
    </div>`;
  } else if (!isNaN(w) && w > limit * 0.8) {
    rangeWarning.innerHTML = `<div class="banner banner-warn">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <div>Wind speed is approaching ${limitSource}. Monitor conditions closely.</div>
    </div>`;
  } else {
    rangeWarning.innerHTML = '';
  }
  refreshViz();
});

document.getElementById('btnReset').addEventListener('click', () => {
  loadInput.value = ''; radiusInput.value = ''; boomAngleInput.value = ''; windInput.value = '0';
  windDirectionSel.value = ''; slewDirectionSel.value = '0';
  envVisibilitySel.value = 'good'; envPrecipitationSel.value = 'none'; envLightingSel.value = 'daylight'; envGroundSel.value = 'firm-level';
  loadDimensionInput.value = '';
  rangeWarning.innerHTML = '';
  resetResult();
  refreshViz();
});

document.getElementById('btnCalculate').addEventListener('click', calculate);

function calculateBoomMode(spec) {
  const config = configSel.value;
  const boom = parseFloat(boomSel.value);
  const load = parseFloat(loadInput.value);
  const radius = parseFloat(radiusInput.value);
  const wind = parseFloat(windInput.value);

  const errors = [];
  if (isNaN(load) || load <= 0) errors.push('Enter a valid load weight.');
  else if (load > spec.maxCapacity) errors.push(`Load weight cannot exceed the crane's rated ${spec.maxCapacity} t maximum capacity.`);
  if (isNaN(radius) || radius <= 0) errors.push('Enter a valid working radius.');
  if (isNaN(wind) || wind < 0) errors.push('Enter a valid wind speed.');
  if (errors.length) return { errors };

  const { capacity, error } = CraneCalc.maxCapacityTonnes(spec, config, boom, radius);
  if (error) return { errors: [error] };

  return {
    errors: [], capacity,
    summaryRows: [
      ['Crane model', spec.model],
      ['Configuration', config],
      ['Boom length', `${boom.toFixed(2)} m`],
      ['Working radius', `${radius.toFixed(1)} m`],
    ],
    record: { craneModel: spec.model, configuration: config, boomLength: boom, workingRadius: radius, jibMode: false },
    load, wind
  };
}

function calculateJibMode(spec) {
  const jibConfig = jibConfigSel.value;
  const jibLength = parseFloat(jibLengthSel.value);
  const offset = parseFloat(jibOffsetSel.value);
  const angle = parseFloat(boomAngleInput.value);
  const load = parseFloat(loadInput.value);
  const wind = parseFloat(windInput.value);

  const errors = [];
  if (isNaN(load) || load <= 0) errors.push('Enter a valid load weight.');
  if (isNaN(angle) || angle <= 0) errors.push('Enter a valid boom angle.');
  if (isNaN(wind) || wind < 0) errors.push('Enter a valid wind speed.');
  if (errors.length) return { errors };

  const { capacity, error } = CraneCalc.maxJibCapacityTonnes(spec, jibConfig, jibLength, offset, angle);
  if (error) return { errors: [error] };

  return {
    errors: [], capacity,
    summaryRows: [
      ['Crane model', spec.model],
      ['Configuration', jibConfig],
      ['Jib length', `${jibLength} m`],
      ['Jib offset', `${offset}°`],
      ['Boom angle', `${angle.toFixed(1)}°`],
    ],
    record: { craneModel: spec.model, configuration: jibConfig, jibMode: true, jibLength, jibOffset: offset, boomAngle: angle },
    load, wind
  };
}

function calculate() {
  const spec = currentSpec();
  const out = isJibMode() ? calculateJibMode(spec) : calculateBoomMode(spec);

  if (out.errors.length) {
    resultPanel.innerHTML = `<div class="banner banner-danger" style="margin-top:16px;">${out.errors.join('<br>')}</div>`;
    saveRow.style.display = 'none';
    return;
  }

  const { capacity, summaryRows, record, load, wind } = out;
  const windLimit = effectiveWindLimitMs(spec);
  const windOk = wind <= windLimit;
  const capOk = load <= capacity && capacity > 0;
  const isValid = windOk && capOk;
  const utilization = capacity > 0 ? (load / capacity) * 100 : 999;

  let barColor = 'var(--ok-green)';
  if (utilization > 100) barColor = 'var(--danger-red)';
  else if (utilization > 85) barColor = 'var(--amber-dark)';

  let reasonText = '';
  if (!isValid) {
    const reasons = [];
    if (!windOk) {
      reasons.push(windLimitIsAdosh(spec)
        ? `wind speed (${wind} m/s / ${(wind * 3.6).toFixed(1)} km/h) exceeds the ${ADOSH_WIND_STOP_KMH} km/h (${ADOSH_WIND_STOP_MS} m/s) ADOSH-SF CoP 34.0 stop-work threshold`
        : `wind speed (${wind} m/s) exceeds the crane's ${spec.maxWindSpeed} m/s manufacturer-rated limit`);
    }
    if (!capOk) reasons.push(`load exceeds the interpolated chart capacity of ${capacity.toFixed(2)} t at this ${record.jibMode ? 'boom angle' : 'radius/boom'}`);
    reasonText = 'Lift is not permitted: ' + reasons.join('; ') + '.';
  } else {
    reasonText = utilization > 85
      ? 'Within capacity, but utilization is high — consider a longer boom or reduced radius to add margin.'
      : 'Load is within the crane\'s rated capacity for this configuration.';
  }

  const rowsHtml = summaryRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  resultPanel.innerHTML = `
    <div class="result-panel">
      <div class="result-head ${isValid ? 'ok' : 'fail'}">
        <div class="verdict">${isValid ? '✓ Lift is allowed' : '✕ Lift is not allowed'}</div>
        <div class="util">${utilization < 999 ? utilization.toFixed(0) + '%' : '—'} of capacity</div>
      </div>
      <div class="result-body">
        <div class="util-bar-track"><div class="util-bar-fill" style="width:${Math.min(utilization,100)}%; background:${barColor};"></div></div>
        <p style="margin: 6px 0 16px; font-size: 13.5px; color: var(--ink-soft);">${reasonText}</p>
        <table class="spec-table">
          ${rowsHtml}
          <tr><td>Load weight</td><td>${load.toFixed(2)} t</td></tr>
          <tr><td>Chart capacity at this ${record.jibMode ? 'angle' : 'radius'}</td><td>${capacity.toFixed(2)} t</td></tr>
          <tr><td>Wind speed</td><td>${wind.toFixed(1)} m/s / ${(wind * 3.6).toFixed(1)} km/h (stop-work limit ${windLimit} m/s / ${(windLimit * 3.6).toFixed(1)} km/h${windLimitIsAdosh(spec) ? ' — ADOSH-SF CoP 34.0' : ' — crane rated'})</td></tr>
        </table>
        ${record.jibMode ? '<p class="hint" style="margin-top:10px;">Note: this is a boom-angle-indexed jib chart, as printed by the manufacturer. Cross-check the corresponding lifting-height diagram for the actual radius this angle produces before positioning the load.</p>' : ''}
      </div>
    </div>
  `;

  lastResult = { spec, config: record.configuration, load, wind, capacity, isValid, utilization, record };
  saveRow.style.display = 'block';
  document.getElementById('saveConfirm').textContent = '';
  refreshViz();
  renderBriefing();
}

// Wraps a callback-style capture function (calls cb(dataUrl)) in a Promise.
function captureAsPromise(captureFn) {
  return new Promise(resolve => captureFn(resolve));
}

document.getElementById('btnSave').addEventListener('click', async () => {
  if (!lastResult) return;
  const assessorName = document.getElementById('assessorName').value.trim();
  if (!assessorName) {
    alert('Enter the name of the person carrying out this assessment before saving.');
    return;
  }
  const notes = document.getElementById('notes').value.trim();
  const r = lastResult;

  const btnSave = document.getElementById('btnSave');
  btnSave.disabled = true;
  const confirmEl = document.getElementById('saveConfirm');
  confirmEl.textContent = 'Capturing lift diagrams…';

  const vizParams = buildVizParams();
  const planParams = buildPlanningParams();
  const training = LiftPlanning.computeTrainingRequirements(planParams);
  const briefingPoints = LiftPlanning.generateBriefingPoints(planParams);
  let diagram3D = null, diagramSketch = null;
  try {
    if (vizHandle) diagram3D = await captureAsPromise(cb => vizHandle.capturePNG(cb));
    diagramSketch = await captureAsPromise(cb => CraneVisual.svgStringToPng(CraneVisual.sketchSVGString(vizParams), 640, 360, cb));
  } catch (e) {
    console.error('Diagram capture failed', e);
  }
  if (vizHandle) vizHandle.setAutoRotate(vizRotating);

  const record = Object.assign({
    date: new Date().toISOString(),
    craneModel: r.spec.model,
    configuration: r.config,
    loadWeight: r.load,
    windSpeed: r.wind,
    windDirection: vizParams.windDirectionDeg,
    slewDirection: vizParams.slewDeg,
    maximumCapacity: r.capacity,
    utilization: r.utilization,
    isValid: r.isValid,
    assessorName,
    notes,
    diagram3D,
    diagramSketch,
    environment: {
      visibility: planParams.visibility,
      precipitation: planParams.precipitation,
      lighting: planParams.lighting,
      ground: planParams.ground,
      loadDimensionM: planParams.loadDimensionM
    },
    exclusionZoneM: planParams.exclusionZoneM,
    exclusionZoneNote: planParams.exclusionZoneNote,
    briefingPoints,
    trainingRequirements: training
  }, r.record.jibMode
    ? { jibMode: true, boomLength: r.spec.maxBoomLength, jibLength: r.record.jibLength, jibOffset: r.record.jibOffset, boomAngle: r.record.boomAngle, workingRadius: null }
    : { jibMode: false, boomLength: r.record.boomLength, workingRadius: r.record.workingRadius });

  DB.saveAssessment(record);
  btnSave.disabled = false;
  confirmEl.textContent = 'Saved to history ✓ (lift diagrams attached)';
});

populateCraneModels();

// ---- Prefill from a "Start assessment" deep link (e.g. from the Crane Selector) ----
(function prefillFromQuery() {
  const params = new URLSearchParams(location.search);
  if (![...params.keys()].length) return;

  const craneModel = params.get('craneModel');
  if (craneModel && CRANE_DATA[craneModel]) {
    craneModelSel.value = craneModel;
    onModelOrModeChange();
  }
  const configuration = params.get('configuration');
  if (configuration) {
    configSel.value = configuration;
    populateBoomLengths();
  }
  const boomLength = params.get('boomLength');
  if (boomLength) {
    boomSel.value = boomLength;
    updateRadiusHint();
    updateWindHint();
  }
  const radius = params.get('radius');
  if (radius) radiusInput.value = radius;
  const loadWeight = params.get('loadWeight');
  if (loadWeight) loadInput.value = loadWeight;

  refreshViz();
})();
