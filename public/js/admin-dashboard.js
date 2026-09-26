// admin-dashboard.js — the admin control centre (admin.html).
//
// Owns the tabs, the file intake, and every render on the page except the
// subscription table (that stays in js/admin.js, which renders into the
// Users & access panel exactly as it did before this dashboard existed).
//
// Everything here runs in the browser against files the user picks themselves.
// No workbook, and nothing read out of one, is sent anywhere — the analysis,
// the charts, the reports and the AI answers are all produced on this machine.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = HSECharts.esc;
  const fmt = HSECharts.fmt;
  const MONTHS = HSEParser.MONTHS;
  const STORE = 'cla_hse_reports';

  const state = {
    taqa: null,
    internal: null,
    analysis: null,
    party: 'contractor',
    reportBlocks: null,
    reportMarkdown: ''
  };

  // ------------------------------------------------------------------ tabs --

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.getAttribute('data-panel') === name;
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.hidden = p.id !== 'panel-' + name;
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function wireTabs() {
    $('tabBar').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t) showTab(t.getAttribute('data-panel'));
    });
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); showTab(g.getAttribute('data-goto')); }
    });
    const hash = (location.hash || '').replace('#', '');
    showTab(document.getElementById('panel-' + hash) ? hash : 'overview');
  }

  // ---------------------------------------------------------------- intake --

  function dropZone(kind) {
    const zone = document.querySelector(`.drop[data-kind="${kind}"]`);
    const input = document.querySelector(`input[data-input="${kind}"]`);
    const pick = document.querySelector(`[data-pick="${kind}"]`);

    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) handleFile(input.files[0], kind);
    });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f, kind);
    });
  }

  function zoneStatus(kind, cls, text) {
    const zone = document.querySelector(`.drop[data-kind="${kind}"]`);
    zone.classList.remove('is-loaded', 'is-error');
    if (cls) zone.classList.add(cls);
    document.querySelector(`[data-file="${kind}"]`).innerHTML = text || '';
  }

  async function handleFile(file, expectedKind) {
    zoneStatus(expectedKind, '', 'Reading ' + esc(file.name) + '…');
    try {
      const wb = await XLSXReader.read(await file.arrayBuffer());
      const report = HSEParser.parse(wb, file.name);

      // The two slots are labelled, but people drop files in the wrong one.
      // Route on what the file actually is and say so, rather than failing.
      const slot = report.kind === 'taqa' ? 'taqa' : 'internal';
      state[slot] = report;

      const period = (report.meta.monthName || '') + ' ' + (report.meta.year || '');
      const detail = report.kind === 'taqa'
        ? `${report.rows.length} KPI rows · ${report.training.length} training records`
        : `${report.kpis.length} KPI rows`;
      zoneStatus(slot, 'is-loaded', `<strong>${esc(file.name)}</strong><br>${esc(period.trim() || 'period not stated')} · ${esc(detail)}`);
      if (slot !== expectedKind) {
        zoneStatus(expectedKind, '', `<em>That file was the ${slot === 'taqa' ? 'TAQA submission' : 'internal report'} — loaded into the other slot.</em>`);
      }
      persist();
      rebuild();
    } catch (err) {
      zoneStatus(expectedKind, 'is-error', `<strong>${esc(file.name)}</strong><br>${esc(err.message)}`);
      console.error('HSE upload failed', err);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ taqa: state.taqa, internal: state.internal }));
    } catch (e) { /* quota — the dashboard still works, it just won't survive a reload */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const saved = JSON.parse(raw);
      ['taqa', 'internal'].forEach((k) => {
        if (!saved[k]) return;
        state[k] = saved[k];
        const m = saved[k].meta || {};
        const detail = k === 'taqa'
          ? `${(saved[k].rows || []).length} KPI rows`
          : `${(saved[k].kpis || []).length} KPI rows`;
        zoneStatus(k, 'is-loaded',
          `<strong>${esc(saved[k].fileName || 'saved file')}</strong><br>${esc(((m.monthName || '') + ' ' + (m.year || '')).trim())} · ${esc(detail)} <em>(restored)</em>`);
      });
    } catch (e) { /* ignore a corrupt cache */ }
  }

  // --------------------------------------------------------------- rebuild --

  function rebuild() {
    if (!state.taqa && !state.internal) {
      state.analysis = null;
      $('analyticsBody').hidden = true; $('analyticsEmpty').hidden = false;
      $('compareBody').hidden = true; $('compareEmpty').hidden = false;
      $('actionsBody').hidden = true; $('actionsEmpty').hidden = false;
      $('reportsBody').hidden = true; $('reportsEmpty').hidden = false;
      $('cntGaps').textContent = '0'; $('cntActions').textContent = '0';
      $('periodCrumb').textContent = 'HSE performance analytics, reconciliation and account control';
      renderOverview();
      return;
    }

    const A = HSEAnalysis.analyse({
      taqa: state.taqa, internal: state.internal, party: state.party
    });
    state.analysis = A;

    const open = A.findings.filter((f) => f.status !== 'match' && f.status !== 'met').length;
    $('cntGaps').textContent = String(open);
    $('cntActions').textContent = String(A.actions.length);
    $('periodCrumb').textContent =
      (A.monthName ? A.monthName + ' ' + (A.year || '') : 'Reporting period unknown') +
      (state.taqa && state.taqa.meta.contractNo ? ' · Contract ' + state.taqa.meta.contractNo : '');

    $('analyticsEmpty').hidden = true; $('analyticsBody').hidden = false;
    renderAnalytics(A);

    const both = !!(state.taqa && state.internal);
    $('compareEmpty').hidden = both; $('compareBody').hidden = !both;
    if (both) renderCompare(A);

    $('actionsEmpty').hidden = false; $('actionsBody').hidden = true;
    if (A.actions.length || A.findings.length) {
      $('actionsEmpty').hidden = true; $('actionsBody').hidden = false;
      renderActions(A);
    }

    $('reportsEmpty').hidden = true; $('reportsBody').hidden = false;
    renderOverview();
    refreshAiChips();
  }

  // -------------------------------------------------------------- overview --

  function renderOverview() {
    const A = state.analysis;
    const tiles = $('portalTiles');
    const assessments = (typeof DB !== 'undefined') ? DB.getAssessments() : [];
    const permits = (typeof DB !== 'undefined') ? DB.getPermits() : [];
    const checklists = (typeof DB !== 'undefined' && DB.getChecklists) ? DB.getChecklists() : [];

    const items = [
      { label: 'Lift assessments', value: assessments.length, foot: assessments.filter((a) => a.isValid).length + ' allowed' },
      { label: 'Permits on file', value: permits.length, foot: permits.filter((p) => new Date(p.validTo) >= new Date()).length + ' still valid' },
      { label: 'Equipment checklists', value: checklists.length, foot: 'saved in this browser' },
      { label: 'Crane models', value: (typeof CRANE_DATA !== 'undefined') ? Object.keys(CRANE_DATA).length : 0, foot: 'configured in the fleet' }
    ];
    tiles.innerHTML = '';
    items.forEach((it) => {
      const d = document.createElement('div');
      tiles.appendChild(d);
      HSECharts.statTile(d, it);
    });

    const host = $('overviewPeriod');
    if (!A) {
      host.innerHTML = `<div class="card empty-state"><div class="icon">📂</div>
        No HSE reports loaded yet. <button class="btn btn-sm btn-primary" data-goto="analytics" style="margin-left:8px;">Upload them</button></div>`;
      return;
    }
    const s = A.scorecard;
    const m = state.taqa ? state.taqa.meta : state.internal.meta;
    host.innerHTML = `
      <div class="card">
        <div class="kv-inline">
          <div><div class="k">Period</div><div class="v">${esc(A.monthName)} ${esc(A.year || '')}</div></div>
          <div><div class="k">Contract</div><div class="v">${esc(m.contractNo || '—')}</div></div>
          <div><div class="k">Files loaded</div><div class="v">${state.taqa ? 'TAQA' : ''}${state.taqa && state.internal ? ' + ' : ''}${state.internal ? 'Internal' : ''}</div></div>
          <div><div class="k">Open findings</div><div class="v">${A.findings.filter((f) => f.status !== 'match' && f.status !== 'met').length}</div></div>
          <div><div class="k">Actions</div><div class="v">${A.actions.length}</div></div>
          ${s.overall != null ? `<div><div class="k">Overall score</div><div class="v">${s.overall}%</div></div>` : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------- analytics --

  function seriesTo(A, key, opts) {
    const e = A.taqaCanon[key];
    if (!e) return null;
    const upto = (opts && opts.full) ? 12 : A.monthIndex + 1;
    return e.series.slice(0, Math.max(1, upto));
  }
  function labelsTo(A, opts) {
    const upto = (opts && opts.full) ? 12 : A.monthIndex + 1;
    return MONTHS.slice(0, Math.max(1, upto));
  }
  function v(A, key) { return A.canon[key] ? A.canon[key].value : null; }

  function renderAnalytics(A) {
    const r = A.rates;
    const s = A.scorecard;

    // ---- hero: one number, the thing to lead with -------------------------
    const hasBoth = !!(state.taqa && state.internal);
    $('heroBlock').innerHTML = `
      <div class="hero">
        <div class="hero-figure">${hasBoth && s.overall != null ? s.overall : (r.ltiCount === 0 ? '0' : r.ltiCount)}${hasBoth && s.overall != null ? '<span class="hero-pct">%</span>' : ''}</div>
        <div class="hero-body">
          <div class="hero-title">${hasBoth ? 'Overall compliance score for ' + esc(A.monthName) + ' ' + esc(A.year || '') : 'Lost-time injuries in ' + esc(A.monthName)}</div>
          <div class="hero-detail">${hasBoth
            ? `Reports agree on ${s.alignmentMatched}/${s.alignmentTotal} comparable KPIs · ${s.attainmentMet}/${s.attainmentTotal} targets met · data integrity ${s.integrity}%`
            : `${esc(fmt(r.manhours))} man-hours worked by ${esc(fmt(r.employees))} people. Load the internal report to reconcile the submission against it.`}</div>
        </div>
        <div class="hero-breakdown">
          <div class="hero-stat"><div class="hero-stat-v">${esc(fmt(r.ltifr == null ? null : Math.round(r.ltifr * 100) / 100))}</div><div class="hero-stat-l">LTIFR</div></div>
          <div class="hero-stat"><div class="hero-stat-v">${esc(fmt(r.trcf == null ? null : Math.round(r.trcf * 100) / 100))}</div><div class="hero-stat-l">TRCF</div></div>
          <div class="hero-stat"><div class="hero-stat-v">${esc(fmt(r.manhours, ''))}</div><div class="hero-stat-l">Man-hours</div></div>
          <div class="hero-stat"><div class="hero-stat-v">${esc(fmt(r.proactiveReports))}</div><div class="hero-stat-l">Proactive reports</div></div>
        </div>
      </div>`;

    // ---- KPI tiles ---------------------------------------------------------
    const mi = A.monthIndex;
    const prev = (key) => {
      const s2 = seriesTo(A, key, { full: true });
      return (s2 && mi > 0) ? s2[mi - 1] : null;
    };
    const tileDefs = [
      { key: 'manhours', label: 'Man-hours worked', better: 'higher' },
      { key: 'employees', label: 'Workforce on site', better: 'neutral' },
      { key: 'inspections', label: 'HSE inspections', better: 'higher' },
      { key: 'toolboxTalks', label: 'Toolbox talks', better: 'higher' },
      { key: 'trainingHours', label: 'Training hours', better: 'higher', unit: 'hrs' },
      { key: 'nearMiss', label: 'Near misses reported', better: 'higher' },
      { key: 'firstAid', label: 'First aid cases', better: 'lower' },
      { key: 'lti', label: 'Lost-time injuries', better: 'lower' }
    ];
    const grid = $('kpiTiles');
    grid.innerHTML = '';
    tileDefs.forEach((d) => {
      const cur = v(A, d.key);
      const p = prev(d.key);
      const delta = (cur != null && p != null) ? cur - p : null;
      const host = document.createElement('div');
      grid.appendChild(host);
      HSECharts.statTile(host, {
        label: d.label,
        value: cur,
        unit: d.unit || '',
        delta: delta,
        deltaGood: delta == null ? null : (d.better === 'lower' ? delta <= 0 : d.better === 'higher' ? delta >= 0 : true),
        deltaLabel: 'vs ' + (mi > 0 ? MONTHS[mi - 1] : 'last month'),
        series: seriesTo(A, d.key),
        status: d.key === 'lti' && cur === 0 ? 'good' : (d.key === 'nearMiss' && cur === 0 ? 'warning' : ''),
        accent: HSECharts.CAT[0]
      });
    });

    // ---- exposure ----------------------------------------------------------
    HSECharts.line($('chartManhours'), {
      title: 'Man-hours worked', subtitle: 'Contractor line, month by month',
      categories: labelsTo(A), series: [{ name: 'Man-hours', values: seriesTo(A, 'manhours') || [] }],
      unit: 'hrs', area: true, highlightIndex: mi, height: 250
    });

    const partySeries = A.taqaCanon.employees ? A.taqaCanon.employees.byParty : null;
    if (partySeries) {
      HSECharts.bars($('chartWorkforce'), {
        title: 'Workforce on site by party', subtitle: 'As declared on the TAQA form',
        categories: labelsTo(A),
        series: [
          { name: 'Contractor', values: (partySeries.contractor || []).slice(0, mi + 1) },
          { name: 'Consultant', values: (partySeries.consultant || []).slice(0, mi + 1) },
          { name: 'Sub-contractor', values: (partySeries.subcontractor || []).slice(0, mi + 1) }
        ].filter((x) => x.values.some((y) => y != null)),
        unit: 'people', stacked: true, highlightIndex: mi, height: 250
      });
    }

    // ---- leading -----------------------------------------------------------
    HSECharts.line($('chartLeading'), {
      title: 'Proactive activity', subtitle: 'Inspections, toolbox talks and internal training sessions',
      categories: labelsTo(A),
      series: [
        { name: 'Toolbox talks', values: seriesTo(A, 'toolboxTalks') || [] },
        { name: 'Inspections', values: seriesTo(A, 'inspections') || [] },
        { name: 'Internal trainings', values: seriesTo(A, 'internalTrainings') || [] }
      ].filter((x) => x.values.length),
      unit: 'no.', highlightIndex: mi, height: 250
    });

    const nmSeries = seriesTo(A, 'nearMiss') || [];
    const nmStopped = A.findings.find((f) => f.id === 'trend:stopped:nearMiss');
    HSECharts.bars($('chartNearMiss'), {
      title: 'Near misses reported', subtitle: 'The clearest single read on whether reporting culture is alive',
      categories: labelsTo(A), series: [{ name: 'Near misses', values: nmSeries }],
      unit: 'reports', highlightIndex: mi, labelValues: true, height: 250,
      note: nmStopped ? nmStopped.detail : ''
    });

    const heatKeys = ['inspections', 'toolboxTalks', 'internalTrainings', 'externalTrainings', 'trainingHours', 'nearMiss', 'meetings', 'drills', 'docReviews'];
    const heatRows = heatKeys.map((k) => (A.taqaCanon[k]
      ? { label: A.taqaCanon[k].def.label, values: A.taqaCanon[k].series.slice(0, mi + 1) } : null)).filter(Boolean);
    if (heatRows.length) {
      HSECharts.heatmap($('chartLeadingHeat'), {
        title: 'Leading indicators, month by month',
        subtitle: 'Darker is more activity. Empty cells are months with no figure at all.',
        rows: heatRows, columns: labelsTo(A), rowLabel: 'Indicator'
      });
    }

    // ---- permits -----------------------------------------------------------
    const permitKeys = [
      ['permitExcavation', 'Excavation'], ['permitConfined', 'Confined space'],
      ['permitHotWork', 'Hot work'], ['permitOther', 'Other']
    ];
    HSECharts.donut($('chartPermitMix'), {
      title: 'Permit mix — ' + A.monthName, centreLabel: 'permits', unit: 'permits',
      items: permitKeys.map(([k, label]) => ({ label: label, value: v(A, k) || 0 })),
      categoryLabel: 'Permit type', height: 230
    });
    HSECharts.bars($('chartPermitTrend'), {
      title: 'Permits issued by month', subtitle: 'Stacked by permit type',
      categories: labelsTo(A),
      series: permitKeys.map(([k, label]) => ({ name: label, values: seriesTo(A, k) || [] })).filter((x) => x.values.length),
      unit: 'permits', stacked: true, highlightIndex: mi, height: 250
    });

    // ---- training ----------------------------------------------------------
    HSECharts.line($('chartTraining'), {
      title: 'Training hours delivered', subtitle: 'Target line is hours per employee × this month\'s workforce',
      categories: labelsTo(A), series: [{ name: 'Training hours', values: seriesTo(A, 'trainingHours') || [] }],
      unit: 'hrs', area: true, highlightIndex: mi, height: 250,
      targetLine: (A.targets.trainingHoursPerEmployee && r.employees)
        ? A.targets.trainingHoursPerEmployee.value * r.employees : null
    });
    HSECharts.bars($('chartTrainingSessions'), {
      title: 'Training sessions', subtitle: 'Internal versus external (third-party)',
      categories: labelsTo(A),
      series: [
        { name: 'Internal', values: seriesTo(A, 'internalTrainings') || [] },
        { name: 'External', values: seriesTo(A, 'externalTrainings') || [] }
      ].filter((x) => x.values.length),
      unit: 'sessions', highlightIndex: mi, height: 250
    });

    // ---- environment -------------------------------------------------------
    // Two single-measure charts rather than one chart with two scales:
    // electricity is kWh and water is litres, and they do not share an axis.
    HSECharts.line($('chartEnergy'), {
      title: 'Electricity consumption', subtitle: 'From Part B of the TAQA form',
      categories: labelsTo(A), series: [{ name: 'Electricity', values: seriesTo(A, 'powerConsumption') || [] }],
      unit: 'kWh', area: true, highlightIndex: mi, height: 240
    });
    HSECharts.line($('chartWater'), {
      title: 'Water consumption', subtitle: 'Converted from the form\'s cubic metres to litres',
      categories: labelsTo(A), series: [{ name: 'Water', values: seriesTo(A, 'waterConsumption') || [] }],
      unit: 'L', area: true, highlightIndex: mi, height: 240
    });

    // ---- by party ----------------------------------------------------------
    const mh = A.taqaCanon.manhours ? A.taqaCanon.manhours.byParty : null;
    if (mh) {
      HSECharts.bars($('chartParty'), {
        title: 'Man-hours by party', subtitle: 'Who worked the hours the submission reports',
        categories: labelsTo(A),
        series: [
          { name: 'Contractor', values: (mh.contractor || []).slice(0, mi + 1) },
          { name: 'Consultant', values: (mh.consultant || []).slice(0, mi + 1) },
          { name: 'Sub-contractor', values: (mh.subcontractor || []).slice(0, mi + 1) }
        ].filter((x) => x.values.some((y) => y != null)),
        unit: 'hrs', stacked: true, highlightIndex: mi, height: 260
      });
    }

    renderSourceInfo(A);
  }

  function renderSourceInfo(A) {
    const t = state.taqa, i = state.internal;
    const rows = [];
    if (t) rows.push(['TAQA submission', t.fileName, t.meta.formRef || '—', t.meta.monthName + ' ' + (t.meta.year || ''),
      t.rows.length + ' KPI rows, ' + t.training.length + ' training records, ' + t.incidents.length + ' incidents',
      [t.meta.preparedBy, t.meta.reviewedBy, t.meta.approvedBy].filter(Boolean).join(' · ') || '—']);
    if (i) rows.push(['Internal report', i.fileName, i.meta.docRef || '—', i.meta.monthName + ' ' + (i.meta.year || ''),
      i.kpis.length + ' KPI rows', [i.meta.reportedBy, i.meta.designation].filter(Boolean).join(' · ') || '—']);

    $('sourceInfo').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Source</th><th>File</th><th>Form</th><th>Period</th><th>Content</th><th>Signed</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c, ci) => `<td${ci === 1 ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      ${A.cumulativeBasis ? `<p class="viz-note">${esc(A.cumulativeBasis.detail)}</p>` : ''}`;
  }

  // --------------------------------------------------------------- compare --

  function renderCompare(A) {
    // Differences are shown as PERCENTAGES, not raw deltas: the KPIs on this
    // chart are litres, kWh and counts, and raw magnitudes on one axis would
    // make the biggest unit look like the biggest problem.
    const diffs = A.findings
      .filter((f) => f.type === 'reconciliation' && f.status === 'mismatch' && f.deltaPct != null)
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .map((f) => ({ label: f.title, value: f.deltaPct, a: f.taqaValue, b: f.internalValue, unit: f.unit }));

    if (diffs.length) {
      HSECharts.diverging($('chartVariance'), {
        title: 'Difference between the two reports',
        subtitle: 'As a percentage of the larger figure, so litres and counts can sit on one axis',
        items: diffs, unit: '%',
        note: 'Hover a bar for the two underlying figures. Everything not shown here agrees between the reports.'
      });
    } else {
      $('chartVariance').innerHTML = '<div class="card empty-state"><div class="icon">✓</div>Every comparable KPI agrees between the two reports.</div>';
    }

    const tItems = A.findings.filter((f) => f.type === 'target').map((f) => ({
      label: f.title, actual: f.actual, target: f.target, dir: f.direction, unit: f.unit
    }));
    if (tItems.length) {
      HSECharts.bullet($('chartTargets'), {
        title: 'Performance against target',
        subtitle: 'House targets set on the Targets & settings tab — not regulatory thresholds',
        items: tItems
      });
    }

    // Radar caps at three series; two is what this comparison needs.
    const radarKeys = [
      ['inspectionsPer100Workers', 'Inspections'],
      ['trainingHoursPerEmployee', 'Training'],
      ['toolboxPerWorkerMonth', 'Toolbox'],
      ['observationsPerWorker', 'Observations'],
      ['nearMissPer100Workers', 'Near misses'],
      ['meetingsPerMonth', 'Meetings']
    ].filter(([k]) => A.targets[k]);
    const actuals = {
      inspectionsPer100Workers: A.rates.inspectionsPer100Workers,
      trainingHoursPerEmployee: A.rates.trainingHoursPerEmployee,
      toolboxPerWorkerMonth: A.rates.toolboxPerWorkerMonth,
      observationsPerWorker: A.rates.observationsPerWorker,
      nearMissPer100Workers: (v(A, 'nearMiss') != null && A.rates.employees) ? (v(A, 'nearMiss') * 100) / A.rates.employees : null,
      meetingsPerMonth: v(A, 'meetings')
    };
    if (radarKeys.length >= 3) {
      HSECharts.radar($('chartRadar'), {
        title: 'Leading-indicator profile', subtitle: 'Each axis is performance as a share of its target (1.0 = on target)',
        axes: radarKeys.map(([, label]) => label),
        series: [
          {
            name: A.monthName + ' actual',
            values: radarKeys.map(([k]) => {
              const t = A.targets[k].value;
              return t ? Math.min(1.05, (actuals[k] || 0) / t) : 0;
            }),
            display: radarKeys.map(([k]) => fmt(actuals[k] == null ? null : Math.round(actuals[k] * 100) / 100))
          },
          { name: 'Target', values: radarKeys.map(() => 1), display: radarKeys.map(([k]) => fmt(A.targets[k].value)), color: HSECharts.DIM }
        ],
        height: 330
      });
    }

    const s = A.scorecard;
    $('scorecardCard').innerHTML = `
      <div class="viz">
        <div class="viz-head"><span class="viz-title">Compliance scorecard</span>
        <span class="viz-sub">${esc(A.monthName)} ${esc(A.year || '')}</span></div>
        <div id="meterAlign"></div><div id="meterAttain" style="margin-top:10px;"></div><div id="meterIntegrity" style="margin-top:10px;"></div>
        <p class="viz-note">The overall score is the mean of the three. Alignment counts KPIs the two reports agree on;
        attainment counts targets met; integrity falls with the weight of open data defects in the submitted workbook.</p>
      </div>`;
    HSECharts.meter($('meterAlign'), {
      label: 'Report alignment', value: s.alignment, max: 100, unit: '%',
      foot: s.alignmentMatched + ' of ' + s.alignmentTotal + ' comparable KPIs agree'
    });
    HSECharts.meter($('meterAttain'), {
      label: 'Target attainment', value: s.attainment, max: 100, unit: '%',
      foot: s.attainmentMet + ' of ' + s.attainmentTotal + ' targets met'
    });
    HSECharts.meter($('meterIntegrity'), {
      label: 'Data integrity', value: s.integrity, max: 100, unit: '%',
      foot: s.qualityDefects + ' data defect' + (s.qualityDefects === 1 ? '' : 's') + ' found in the workbook'
    });

    renderFindings();
  }

  const STATUS_LABEL = {
    match: 'Agrees', mismatch: 'Does not agree', 'blank-taqa': 'Blank on the form',
    'missing-taqa': 'Missing from TAQA', 'missing-internal': 'Missing internally',
    'not-visible': 'No row on the form', met: 'Target met', missed: 'Target missed',
    stopped: 'Reporting stopped', 'adverse-shift': 'Adverse shift', shift: 'Notable shift',
    defect: 'Data defect', inconsistent: 'Totals disagree'
  };

  function renderFindings() {
    const A = state.analysis;
    if (!A) return;
    const type = $('findingType').value;
    const sev = $('findingSeverity').value;
    const q = ($('findingSearch').value || '').toLowerCase();

    const list = A.findings.filter((f) => {
      if (type && f.type !== type) return false;
      if (sev && f.severity !== sev) return false;
      if (q && !((f.title + ' ' + f.detail).toLowerCase().includes(q))) return false;
      return true;
    });

    $('findingCount').textContent = list.length + ' of ' + A.findings.length + ' findings';
    if (!list.length) { $('findingList').innerHTML = '<div class="empty-state">Nothing matches those filters.</div>'; return; }

    $('findingList').innerHTML = list.map((f) => {
      const hasPair = f.taqaValue != null || f.internalValue != null;
      const hasTarget = f.type === 'target';
      return `<div class="finding">
        <div>
          <span class="pill pill-${esc(f.severity)}">${esc(f.severity)}</span>
          <div class="finding-evidence" style="margin-top:6px;">${esc(STATUS_LABEL[f.status] || f.status)}</div>
        </div>
        <div>
          <div class="finding-title">${esc(f.title)}</div>
          <div class="finding-detail">${esc(f.detail)}</div>
          ${(f.notes && f.notes.length) ? `<div class="finding-notes">${esc(f.notes.join(' '))}</div>` : ''}
          ${(f.evidence && f.evidence.length) ? `<div class="finding-evidence">${f.evidence.map((e) => esc(e.source + ' row ' + e.row)).join(' · ')}</div>` : ''}
          ${(f.sample && f.sample.length) ? `<div class="finding-evidence">${esc(f.sample.join(' · '))} …</div>` : ''}
        </div>
        <div class="finding-values">
          ${hasPair ? `
            <div class="fv-l">TAQA</div><div class="fv">${esc(fmt(f.taqaValue))}</div>
            <div class="fv-l" style="margin-top:6px;">Internal</div><div class="fv">${esc(fmt(f.internalValue))}</div>
            ${f.deltaPct != null ? `<div class="fv-delta ${f.deltaPct >= 0 ? 'pos' : 'neg'}">${f.deltaPct > 0 ? '+' : ''}${esc(f.deltaPct)}%</div>` : ''}
          ` : hasTarget ? `
            <div class="fv-l">Actual</div><div class="fv">${esc(fmt(f.actual))}</div>
            <div class="fv-l" style="margin-top:6px;">Target</div><div class="fv">${f.direction === 'max' ? '≤' : '≥'} ${esc(fmt(f.target))}</div>
          ` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // --------------------------------------------------------------- actions --

  function renderActions(A) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    A.actions.forEach((a) => { counts[a.priority] = (counts[a.priority] || 0) + 1; });
    const soon = A.actions.filter((a) => a.dueDays <= 14).length;

    const tiles = $('actionTiles');
    tiles.innerHTML = '';
    [
      { label: 'Open actions', value: A.actions.length, foot: 'from this period\'s findings' },
      { label: 'Critical + high', value: counts.critical + counts.high, foot: 'need attention first', status: (counts.critical + counts.high) ? 'critical' : 'good' },
      { label: 'Due within 14 days', value: soon, foot: 'from today', status: soon ? 'warning' : '' },
      { label: 'Owners involved', value: new Set(A.actions.map((a) => a.owner)).size, foot: 'distinct roles' }
    ].forEach((it) => { const d = document.createElement('div'); tiles.appendChild(d); HSECharts.statTile(d, it); });

    const sel = $('actionOwner');
    const owners = Array.from(new Set(A.actions.map((a) => a.owner))).sort();
    sel.innerHTML = '<option value="">Every owner</option>' + owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');

    filterActions();
  }

  function filterActions() {
    const A = state.analysis;
    if (!A) return;
    const p = $('actionPriority').value, o = $('actionOwner').value;
    const list = A.actions.filter((a) => (!p || a.priority === p) && (!o || a.owner === o));
    if (!list.length) { $('actionList').innerHTML = '<div class="card empty-state">No actions match those filters.</div>'; return; }

    $('actionList').innerHTML = list.map((a, i) => `
      <div class="action-card p-${esc(a.priority)}">
        <div class="action-head">
          <span class="pill pill-${esc(a.priority)}">${esc(a.priority)}</span>
          <span class="action-title">${esc(i + 1)}. ${esc(a.title)}</span>
        </div>
        <div class="action-body">
          <p style="margin:0 0 6px;"><strong>Why:</strong> ${esc(a.why)}</p>
          <p style="margin:0;"><strong>What to do:</strong> ${esc(a.what)}</p>
          ${a.notes && a.notes.length ? `<p style="margin:6px 0 0;" class="hint">${esc(a.notes.join(' '))}</p>` : ''}
        </div>
        <div class="action-meta">
          <div><span class="amk">Owner</span><span class="amv">${esc(a.owner)}</span></div>
          <div><span class="amk">Due</span><span class="amv">${esc(a.dueLabel)} (${a.dueDays} days)</span></div>
          <div><span class="amk">Verification</span><span class="amv">${esc(a.verification)}</span></div>
        </div>
      </div>`).join('');
  }

  function actionsAsText() {
    const A = state.analysis;
    if (!A) return '';
    const head = `HSE ACTION PLAN — ${A.monthName} ${A.year || ''}\n` +
      (state.taqa ? `Contract ${state.taqa.meta.contractNo || ''} · ${state.taqa.meta.projectTitle || ''}\n` : '') +
      `Generated ${new Date().toLocaleString()}\n\n`;
    return head + A.actions.map((a, i) =>
      `${i + 1}. [${a.priority.toUpperCase()}] ${a.title}\n` +
      `   Owner: ${a.owner}    Due: ${a.dueLabel} (${a.dueDays} days)\n` +
      `   Why: ${a.why}\n   What to do: ${a.what}\n   Verification: ${a.verification}\n`
    ).join('\n');
  }

  function actionsAsCsv() {
    const A = state.analysis;
    if (!A) return '';
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['#', 'Priority', 'Action', 'Owner', 'Due date', 'Days', 'Why', 'What to do', 'Verification']];
    A.actions.forEach((a, i) => rows.push([i + 1, a.priority, a.title, a.owner, a.dueLabel, a.dueDays, a.why, a.what, a.verification]));
    return rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  async function copyText(text, btn) {
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (e) {
      // Clipboard API needs a secure context; fall back to a selection copy.
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); btn.textContent = 'Copied'; }
      catch (e2) { btn.textContent = 'Copy failed'; }
      ta.remove();
    }
    setTimeout(() => { btn.textContent = label; }, 1800);
  }

  // -------------------------------------------------------------------- AI --

  const CHIPS_BASE = [
    'Where are we lagging?', 'What should I do next?', 'Summarise the month',
    'Compare training hours', 'Near miss trend', 'How many inspections this month?',
    'What is going well?', 'Show the permit numbers'
  ];

  function refreshAiChips() {
    const A = state.analysis;
    const chips = CHIPS_BASE.slice();
    if (A) {
      const worst = A.findings.find((f) => f.status === 'mismatch');
      if (worst) chips.unshift('Why does ' + worst.title.toLowerCase() + ' differ?');
    }
    $('aiChips').innerHTML = chips.slice(0, 9).map((c) => `<button class="ai-chip" type="button">${esc(c)}</button>`).join('');
  }

  function aiAppend(html) {
    const t = $('aiThread');
    const d = document.createElement('div');
    d.className = 'ai-msg';
    d.innerHTML = html;
    t.appendChild(d);
    t.scrollTop = t.scrollHeight;
    return d;
  }

  async function aiAsk(question) {
    if (!state.analysis) {
      aiAppend(`<div class="ai-q">${esc(question)}</div><div class="ai-a"><p>Load a report on the HSE analytics tab first — I answer from the figures in your workbooks, and there are none loaded yet.</p></div>`);
      return;
    }
    const node = aiAppend(`<div class="ai-q">${esc(question)}</div><div class="ai-a"><p class="ai-typing">Working…</p></div>`);
    const cfg = HSEAI.loadLlm();
    let res;
    try {
      res = await HSEAI.ask(question, state.analysis, cfg);
    } catch (e) {
      res = { source: 'engine', html: '<p>Something went wrong answering that: ' + esc(e.message) + '</p>' };
    }

    const src = res.source === 'llm'
      ? 'Answered by the local model “' + esc(res.model) + '”, from a digest of your uploaded data.'
      : 'Answered by the built-in engine, directly from your uploaded data.' +
        (res.llmError ? ' (The local model did not respond: ' + esc(res.llmError) + ')' : '');

    node.innerHTML = `<div class="ai-q">${esc(question)}</div>
      <div class="ai-a">${res.html}
        ${res.engineHtml ? `<details style="margin-top:8px;"><summary class="ai-dim" style="cursor:pointer;">Figures from the engine</summary>${res.engineHtml}</details>` : ''}
        <div class="ai-chart" id="aiChart-${Date.now()}"></div>
        <div class="ai-source">${src}</div>
      </div>`;

    if (res.chart) {
      const host = node.querySelector('.ai-chart');
      try {
        HSECharts[res.chart.kind](host, res.chart.opts);
      } catch (e) { host.remove(); }
    } else {
      const h = node.querySelector('.ai-chart'); if (h) h.remove();
    }
    $('aiThread').scrollTop = $('aiThread').scrollHeight;
  }

  function renderAiStatus() {
    const cfg = HSEAI.loadLlm();
    const on = cfg.enabled && cfg.model;
    $('aiStatus').innerHTML = `
      <div><span class="dot ${on ? 'on' : 'off'}"></span>${on ? 'Local model connected' : 'Built-in engine only'}</div>
      <div style="margin-top:6px; color:var(--ink-soft);">
        ${on
          ? 'Using <strong>' + esc(cfg.model) + '</strong> at <span class="num">' + esc(cfg.baseUrl) + '</span>. Answers are grounded in a digest of your uploaded data.'
          : 'The built-in engine answers every question from the parsed reports with no model server and no network. Connect a local model for free-form phrasing and longer reports.'}
      </div>`;
  }

  // --------------------------------------------------------------- reports --

  function renderReportPicker() {
    const sel = $('reportKind');
    sel.innerHTML = Object.keys(HSEAI.REPORTS).map((k) =>
      `<option value="${esc(k)}">${esc(HSEAI.REPORTS[k])}</option>`).join('');
  }

  async function buildReport() {
    if (!state.analysis) return;
    const kind = $('reportKind').value;
    const pane = $('reportPane');
    pane.innerHTML = '<p class="ai-typing">Generating…</p>';
    const cfg = HSEAI.loadLlm();
    let res;
    try {
      res = await HSEAI.rewriteReport(kind, state.analysis, cfg);
    } catch (e) {
      const blocks = HSEAI.buildReport(kind, state.analysis);
      res = { source: 'engine', blocks: blocks, html: HSEAI.blocksToHtml(blocks), markdown: HSEAI.blocksToMarkdown(blocks) };
    }
    state.reportBlocks = res.blocks;
    state.reportMarkdown = res.markdown;
    pane.innerHTML = res.html +
      `<p class="rep-note">${res.source === 'llm'
        ? 'Drafted by the local model “' + esc(res.model) + '” from figures computed by the dashboard. Check it before sending.'
        : 'Generated by the built-in engine directly from the uploaded workbooks.'}</p>`;
  }

  // -------------------------------------------------------------- settings --

  function renderTargets() {
    const t = HSEKpi.loadTargets();
    $('targetEditor').innerHTML = Object.keys(t).map((k) => {
      const d = t[k];
      return `<div class="target-row" data-key="${esc(k)}">
        <div>
          <div class="target-name">${esc(d.label)}</div>
          <div class="target-note">${esc(d.note || '')} <span class="basis-tag">${esc(d.basis || 'house')}</span></div>
        </div>
        <input type="number" step="any" value="${esc(d.value)}" data-f="value" aria-label="Target value for ${esc(d.label)}">
        <select data-f="dir" aria-label="Direction for ${esc(d.label)}">
          <option value="min"${d.dir === 'min' ? ' selected' : ''}>at least</option>
          <option value="max"${d.dir === 'max' ? ' selected' : ''}>no more than</option>
        </select>
        <span class="hint">${esc(d.unit || '')}</span>
      </div>`;
    }).join('');

    const sla = HSEKpi.loadSla();
    $('slaEditor').innerHTML = ['critical', 'high', 'medium', 'low'].map((p) => `
      <div class="target-row" data-sla="${p}">
        <div><div class="target-name">${p.charAt(0).toUpperCase() + p.slice(1)} findings</div>
          <div class="target-note">Days allowed to close an action raised by a ${p}-severity finding.</div></div>
        <input type="number" min="1" step="1" value="${sla[p]}" data-f="days" aria-label="Days for ${p}">
        <span></span><span class="hint">days</span>
      </div>`).join('');
  }

  function saveTargets() {
    const out = {};
    document.querySelectorAll('#targetEditor .target-row').forEach((row) => {
      const k = row.getAttribute('data-key');
      const value = Number(row.querySelector('[data-f="value"]').value);
      const dir = row.querySelector('[data-f="dir"]').value;
      if (!isFinite(value)) return;
      out[k] = { value: value, dir: dir };
    });
    HSEKpi.saveTargets(out);

    const sla = {};
    document.querySelectorAll('#slaEditor .target-row').forEach((row) => {
      const p = row.getAttribute('data-sla');
      const days = Number(row.querySelector('[data-f="days"]').value);
      if (isFinite(days) && days > 0) sla[p] = Math.round(days);
    });
    HSEKpi.saveSla(sla);

    $('targetSaveMsg').textContent = 'Saved. The findings and action plan have been recalculated.';
    setTimeout(() => { $('targetSaveMsg').textContent = ''; }, 3500);
    renderTargets();
    rebuild();
  }

  function renderLlm() {
    const c = HSEAI.loadLlm();
    $('llmEditor').innerHTML = `
      <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <label style="grid-column:1/-1; display:flex; align-items:center; gap:9px;">
          <input type="checkbox" id="llmEnabled" ${c.enabled ? 'checked' : ''} style="width:auto;">
          <span>Use a local model for free-form answers and report writing</span>
        </label>
        <div>
          <label for="llmUrl">Server address</label>
          <input type="text" id="llmUrl" value="${esc(c.baseUrl)}" placeholder="http://localhost:11434">
          <div class="hint">Ollama defaults to <span class="num">http://localhost:11434</span>; LM Studio to <span class="num">http://localhost:1234</span>.</div>
        </div>
        <div>
          <label for="llmApi">API</label>
          <select id="llmApi">
            <option value="auto"${c.api === 'auto' ? ' selected' : ''}>Detect automatically</option>
            <option value="ollama"${c.api === 'ollama' ? ' selected' : ''}>Ollama</option>
            <option value="openai"${c.api === 'openai' ? ' selected' : ''}>OpenAI-compatible</option>
          </select>
        </div>
        <div>
          <label for="llmModel">Model</label>
          <select id="llmModel"><option value="${esc(c.model)}">${esc(c.model || '— detect to list models —')}</option></select>
        </div>
        <div>
          <label for="llmTemp">Temperature</label>
          <input type="number" id="llmTemp" min="0" max="1" step="0.1" value="${esc(c.temperature)}">
          <div class="hint">Lower keeps the wording closer to the data.</div>
        </div>
      </div>
      <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <button class="btn" id="btnLlmDetect" type="button">Detect local models</button>
        <button class="btn btn-primary" id="btnLlmSave" type="button">Save</button>
        <span class="hint" id="llmMsg"></span>
      </div>
      <p class="hint" style="margin-top:14px; line-height:1.6;">
        The address must be a server running on this machine or your own network. The dashboard sends it a compact digest
        of the figures it has already computed, and nothing else — no files, no account data. If the server is not
        running, every question still gets answered by the built-in engine.
      </p>`;

    $('btnLlmDetect').addEventListener('click', detectLlm);
    $('btnLlmSave').addEventListener('click', saveLlmCfg);
  }

  async function detectLlm() {
    const msg = $('llmMsg');
    msg.textContent = 'Looking for a local model server…';
    const cfg = Object.assign(HSEAI.loadLlm(), {
      baseUrl: $('llmUrl').value.trim(),
      api: $('llmApi').value
    });
    const res = await HSEAI.probeLlm(cfg);
    if (!res.ok) { msg.textContent = res.error; return; }
    const sel = $('llmModel');
    sel.innerHTML = res.models.map((m) => `<option value="${esc(m)}"${m === cfg.model ? ' selected' : ''}>${esc(m)}</option>`).join('')
      || '<option value="">No models installed on that server</option>';
    cfg.detectedApi = res.api;
    HSEAI.saveLlm(cfg);
    msg.textContent = `Found a ${res.api} server with ${res.models.length} model${res.models.length === 1 ? '' : 's'}. Pick one and save.`;
  }

  function saveLlmCfg() {
    const cfg = Object.assign(HSEAI.loadLlm(), {
      enabled: $('llmEnabled').checked,
      baseUrl: $('llmUrl').value.trim(),
      api: $('llmApi').value,
      model: $('llmModel').value,
      temperature: Number($('llmTemp').value) || 0.2
    });
    HSEAI.saveLlm(cfg);
    $('llmMsg').textContent = 'Saved.';
    renderAiStatus();
    setTimeout(() => { $('llmMsg').textContent = ''; }, 2500);
  }

  // ------------------------------------------------------------------ boot --

  function ownerBanner() {
    const host = $('ownerBanner');
    if (typeof Access === 'undefined' || !Access.firebaseOn()) {
      host.innerHTML = '<div class="banner banner-warn"><div><strong>Backend not configured.</strong> ' +
        'Subscription management needs Firebase (see SECURITY.md). The HSE analytics, AI analyst and reports all work ' +
        'without it — they run entirely on files you load here.</div></div>';
      return;
    }
    Access.armAuthWatch(function (user, access, doc) {
      if (!user) { host.innerHTML = ''; return; }
      const isAdmin = doc && doc.role === 'admin';
      host.innerHTML = `<div class="banner ${isAdmin ? 'banner-ok' : 'banner-warn'}"><div>
        Signed in as <strong>${esc(user.email || user.uid)}</strong>${isAdmin ? ' — administrator.' :
          '. This account is not an administrator, so the Users &amp; access tab is read-only. Everything else on this page works.'}
      </div></div>`;
    });
  }

  function init() {
    wireTabs();
    dropZone('taqa');
    dropZone('internal');
    renderReportPicker();
    renderTargets();
    renderLlm();
    renderAiStatus();
    refreshAiChips();
    ownerBanner();

    $('btnPrint').addEventListener('click', () => window.print());
    $('btnClearFiles').addEventListener('click', () => {
      state.taqa = null; state.internal = null;
      try { localStorage.removeItem(STORE); } catch (e) {}
      zoneStatus('taqa', '', ''); zoneStatus('internal', '', '');
      rebuild();
    });
    $('partySelect').addEventListener('change', (e) => { state.party = e.target.value; rebuild(); });

    ['findingType', 'findingSeverity'].forEach((id) => $(id).addEventListener('change', renderFindings));
    $('findingSearch').addEventListener('input', renderFindings);
    ['actionPriority', 'actionOwner'].forEach((id) => $(id).addEventListener('change', filterActions));

    $('btnCopyActions').addEventListener('click', (e) => copyText(actionsAsText(), e.target));
    $('btnCsvActions').addEventListener('click', () => {
      const A = state.analysis;
      download(`HSE action plan ${A ? A.monthName + ' ' + (A.year || '') : ''}.csv`, actionsAsCsv(), 'text/csv;charset=utf-8');
    });

    $('aiForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('aiInput').value.trim();
      if (!q) return;
      $('aiInput').value = '';
      aiAsk(q);
    });
    $('aiChips').addEventListener('click', (e) => {
      const c = e.target.closest('.ai-chip');
      if (c) aiAsk(c.textContent);
    });
    $('btnAiDetect').addEventListener('click', async () => {
      showTab('settings');
      await detectLlm();
    });

    $('btnBuildReport').addEventListener('click', buildReport);
    $('btnCopyReport').addEventListener('click', (e) => copyText(state.reportMarkdown || '', e.target));
    $('btnDownloadReport').addEventListener('click', () => {
      const A = state.analysis;
      const kind = $('reportKind').value;
      download(`${HSEAI.REPORTS[kind]} — ${A ? A.monthName + ' ' + (A.year || '') : ''}.md`, state.reportMarkdown || '', 'text/markdown;charset=utf-8');
    });
    $('btnPrintReport').addEventListener('click', () => window.print());

    $('btnSaveTargets').addEventListener('click', saveTargets);
    $('btnResetTargets').addEventListener('click', () => {
      HSEKpi.resetTargets();
      HSEKpi.saveSla(HSEKpi.DEFAULT_SLA);
      renderTargets();
      rebuild();
    });

    aiAppend(`<div class="ai-a"><p><strong>Local HSE analyst.</strong> Ask about anything in the loaded reports —
      a KPI for a month or a quarter, a trend, how the submission compares with the internal record, where you are
      lagging, or what to do next. Every figure comes from your own workbooks and nothing leaves this machine.</p></div>`);

    restore();
    rebuild();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
