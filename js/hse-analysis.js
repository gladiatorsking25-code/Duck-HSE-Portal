// hse-analysis.js — turns two parsed reports into findings, and findings into
// a dated action plan.
//
// Five independent passes, each answering a different question:
//
//   reconcile()      Does what we told the client match what we recorded
//                    ourselves? (TAQA Contractor line vs internal Total.)
//   selfConsistency() Does the submitted workbook agree with itself — do the
//                    YTD and quarter cells equal the months they sum?
//   assessTargets()  Are we meeting the targets we set?
//   detectTrends()   Has anything stopped being reported, or moved sharply?
//   dataQuality()    Is the file itself sound — typos, broken formulas, gaps?
//
// A deliberate non-finding: the two reports' CUMULATIVE columns are NOT
// compared. The TAQA form's YTD is calendar-year-to-date; the internal report's
// cumulative is project-to-date since 2024. In August 2026 that is 201,480
// man-hours against 450,625 — not a discrepancy, two different questions. The
// engine states the basis difference once and compares only the reporting
// month, rather than manufacturing a gap on every row.

(function (global) {
  'use strict';

  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const val = (c, k) => (c && c[k] && c[k].value != null ? c[k].value : null);
  const n0 = (v) => (v == null ? 0 : v);
  const round = (v, d) => (v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));

  function fmtNum(v, unit) {
    if (v == null) return '—';
    const abs = Math.abs(v);
    const s = abs >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : (Number.isInteger(v) ? String(v) : v.toFixed(2));
    return unit ? s + ' ' + unit : s;
  }
  // Units like "no." already end in a period, so a sentence built around them
  // lands on "0 no..". Collapse the double rather than special-casing callers.
  function sentence(s) { return String(s).replace(/\.\.(\s|$)/g, '.$1'); }

  // Counts must agree exactly; measured quantities and rates get a small band,
  // because a litre of diesel and a rounded rate are not the same kind of
  // number as "how many people were injured".
  function toleranceFor(def) {
    if (def.rate) return { abs: 0.01, pct: 1 };
    if (/^(L|kg|kWh|m³|AED|hrs)$/.test(def.unit || '')) return { abs: 0.5, pct: 0.5 };
    return { abs: 0, pct: 0 };
  }

  function within(a, b, tol) {
    const d = Math.abs(a - b);
    if (d <= tol.abs) return true;
    const base = Math.max(Math.abs(a), Math.abs(b));
    return base > 0 && (d / base) * 100 <= tol.pct;
  }

  // ------------------------------------------------------------ reconcile ---

  // Composite mappings that are not a 1:1 label match. The TAQA form asks for
  // one "Total Fuel Consumption" figure; the internal report splits diesel from
  // petrol, so the comparable internal number is their sum.
  const COMPOSITES = [
    {
      key: 'fuelConsumption', label: 'Fuel consumption', unit: 'L', group: 'environment',
      internalOf: (i) => (val(i, 'dieselQty') == null && val(i, 'petrolQty') == null)
        ? null : n0(val(i, 'dieselQty')) + n0(val(i, 'petrolQty')),
      internalNote: 'Diesel + petrol, from the internal environmental report',
      taqaParts: ['fuelConsumption'], rollsUp: ['dieselQty', 'petrolQty'],
      severity: 'medium'
    },
    {
      key: 'envIncidentsAll', label: 'Environmental incidents (all severities)', unit: 'no.', group: 'environment',
      taqaOf: (t) => (val(t, 'envMinor') == null && val(t, 'envModerate') == null && val(t, 'envMajor') == null)
        ? null : n0(val(t, 'envMinor')) + n0(val(t, 'envModerate')) + n0(val(t, 'envMajor')),
      internalOf: (i) => val(i, 'envIncidents'),
      taqaNote: 'Minor + moderate + major, from Part B of the TAQA form',
      taqaParts: ['envMinor', 'envModerate', 'envMajor'], rollsUp: ['envIncidents'],
      severity: 'high'
    },
    {
      key: 'spillsAll', label: 'Spills', unit: 'no.', group: 'environment',
      taqaOf: (t) => (val(t, 'containedSpills') == null && val(t, 'uncontainedSpills') == null)
        ? null : n0(val(t, 'containedSpills')) + n0(val(t, 'uncontainedSpills')),
      internalOf: (i) => val(i, 'spills'),
      taqaNote: 'Contained + uncontained spills, from Part B',
      taqaParts: ['containedSpills', 'uncontainedSpills'], rollsUp: ['spills'],
      severity: 'high'
    },
    {
      // The TAQA form has no "safe hours" row — man-hours worked with no lost
      // time IS the safe-hours figure, so this is a naming difference only.
      key: 'safeHoursCheck', label: 'Safe working hours', unit: 'hrs', group: 'exposure',
      taqaOf: (t) => val(t, 'manhours'),
      internalOf: (i) => val(i, 'safeHours'),
      taqaNote: 'Compared against TAQA man-hours worked — with zero lost time the two should be equal',
      taqaParts: ['manhours'], rollsUp: ['safeHours'],
      severity: 'medium'
    }
  ];

  function reconcile(taqaCanon, internalCanon, ctx) {
    const findings = [];
    const seen = {};

    function emit(key, label, unit, group, a, b, severityHint, notes, rowExists) {
      if (a == null && b == null) return;
      const def = HSEKpi.BY_KEY[key] || { unit: unit, rate: false };
      const tol = toleranceFor({ unit: unit, rate: def.rate });

      // A KPI can be absent from the TAQA file two different ways, and they
      // need different actions: the form has no row for it at all, or the row
      // is there but the month's cell is empty (very often because someone
      // typed the letter "o"). The second is a filling-in error, not a form
      // coverage gap.
      const taqaRowExists = rowExists != null ? rowExists : !!taqaCanon[key];

      let status, severity, detail;
      if (a == null && taqaRowExists) {
        status = 'blank-taqa'; severity = b > 0 ? (severityHint || 'high') : 'medium';
        detail = 'The TAQA form carries this row, but the ' + ((ctx && ctx.monthLabel) || 'reporting month') +
          ' cell is empty or unreadable, so it submits as no data. The internal report records ' + fmtNum(b, unit) + '.';
      } else if (a == null) {
        status = 'missing-taqa'; severity = b > 0 ? (severityHint || 'high') : 'low';
        detail = 'Recorded internally (' + fmtNum(b, unit) + ') but not carried into the TAQA submission.';
      } else if (b == null) {
        status = 'missing-internal'; severity = a > 0 ? (severityHint || 'medium') : 'low';
        detail = 'Submitted to TAQA (' + fmtNum(a, unit) + ') with no matching line in the internal report.';
      } else if (within(a, b, tol)) {
        status = 'match'; severity = 'info';
        detail = 'Both reports agree at ' + fmtNum(a, unit) + '.';
      } else {
        status = 'mismatch';
        const base = Math.max(Math.abs(a), Math.abs(b));
        const pct = base ? (Math.abs(a - b) / base) * 100 : 100;
        severity = severityHint || (pct >= 50 ? 'high' : pct >= 10 ? 'medium' : 'low');
        if (def.critical) severity = 'critical';
        detail = 'TAQA reports ' + fmtNum(a, unit) + '; the internal report records ' + fmtNum(b, unit) +
          ' — a difference of ' + fmtNum(Math.abs(a - b), unit) + ' (' + round(pct, 1) + '%).';
      }

      findings.push({
        id: 'rec:' + key, type: 'reconciliation', key: key, title: label,
        group: group || (HSEKpi.BY_KEY[key] ? HSEKpi.BY_KEY[key].group : 'leading'),
        status: status, severity: severity, unit: unit,
        taqaValue: a, internalValue: b,
        delta: (a == null || b == null) ? null : a - b,
        deltaPct: (a == null || b == null || !Math.max(Math.abs(a), Math.abs(b))) ? null
          : round(((a - b) / Math.max(Math.abs(a), Math.abs(b))) * 100, 1),
        detail: sentence(detail),
        notes: notes || [],
        evidence: [
          taqaCanon[key] ? { source: 'TAQA', row: taqaCanon[key].sourceRow, label: taqaCanon[key].sourceLabel } : null,
          internalCanon[key] ? { source: 'Internal', row: internalCanon[key].sourceRow, label: internalCanon[key].sourceLabel } : null
        ].filter(Boolean)
      });
    }

    HSEKpi.CANON.forEach((def) => {
      if (!def.taqa || !def.internal) return;
      seen[def.key] = true;
      emit(def.key, def.label, def.unit, def.group,
        val(taqaCanon, def.key), val(internalCanon, def.key),
        def.critical ? 'critical' : null,
        def.taqaToBase ? ['Unit converted: the TAQA form records this in ' + def.taqaUnit + '; shown here in ' + def.unit + '.'] : []);
    });

    COMPOSITES.forEach((c) => {
      const a = c.taqaOf ? c.taqaOf(taqaCanon) : val(taqaCanon, c.key);
      const b = c.internalOf ? c.internalOf(internalCanon) : val(internalCanon, c.key);
      const notes = [];
      if (c.taqaNote) notes.push(c.taqaNote);
      if (c.internalNote) notes.push(c.internalNote);
      const exists = (c.taqaParts || [c.key]).some((k) => !!taqaCanon[k]);
      emit(c.key, c.label, c.unit, c.group, a, b, c.severity, notes, exists);
    });

    // Anything already accounted for inside a composite is not also a coverage
    // gap — diesel and petrol ARE in the TAQA submission, added together as
    // "Total Fuel Consumption".
    const rolledUp = {};
    COMPOSITES.forEach((c) => (c.rollsUp || []).forEach((k) => { rolledUp[k] = c.label; }));

    // KPIs the internal report tracks that the TAQA form has no row for. This
    // is not a reporting failure — it is work being done that the client never
    // sees, which is worth saying out loud in the submission's Remarks column.
    HSEKpi.CANON.forEach((def) => {
      if (def.taqa || !def.internal || seen[def.key] || rolledUp[def.key]) return;
      const v = val(internalCanon, def.key);
      if (v == null || v === 0) return;
      findings.push({
        id: 'cov:' + def.key, type: 'coverage', key: def.key, title: def.label,
        group: def.group, status: 'not-visible', severity: v > 0 ? 'medium' : 'low',
        unit: def.unit, taqaValue: null, internalValue: v, delta: null, deltaPct: null,
        detail: sentence(fmtNum(v, def.unit) + ' recorded internally this month. The TAQA form (Form ' +
          ((ctx && ctx.formRef) || 'F-019-F') + ') has no row for it, so this effort is invisible to the client.'),
        notes: ['Carry it in the Remarks column, or in the monthly narrative, so the proactive effort is on the record.'],
        evidence: internalCanon[def.key]
          ? [{ source: 'Internal', row: internalCanon[def.key].sourceRow, label: internalCanon[def.key].sourceLabel }] : []
      });
    });

    return findings;
  }

  // Compares the two reports' cumulative columns once, as context rather than
  // as a defect, and says plainly why they differ.
  function cumulativeBasis(taqaCanon, internalCanon) {
    const tY = taqaCanon.manhours ? taqaCanon.manhours.ytd : null;
    const iC = internalCanon.manhours ? internalCanon.manhours.cumulative : null;
    if (tY == null || iC == null) return null;
    return {
      taqaYtd: tY, internalCumulative: iC,
      ratio: tY ? round(iC / tY, 2) : null,
      detail: 'The TAQA YTD column is calendar-year-to-date (' + fmtNum(tY, 'hrs') +
        '); the internal report\'s cumulative column runs from contract start (' + fmtNum(iC, 'hrs') +
        '). They are different questions, so only the reporting month is reconciled above.'
    };
  }

  // ----------------------------------------------------- self-consistency ---

  // Does the submitted workbook agree with itself? YTD should equal the sum of
  // the months, and each quarter the sum of its three. Rate, percentage and
  // average rows are excluded — those are averaged, not summed, so a sum check
  // on them would be wrong rather than useful.
  function selfConsistency(taqaReport) {
    const findings = [];
    const isAveraged = (row) => /%|\brate\b|\baverage\b|\bavg\b/i.test(row.label);

    taqaReport.rows.forEach((row) => {
      if (isAveraged(row)) return;
      const months = row.months.map(n0);
      const anyMonth = row.months.some((v) => v != null);
      if (!anyMonth) return;

      if (row.ytd != null) {
        const sum = months.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - row.ytd) > 0.01) {
          findings.push({
            id: 'sc:ytd:' + row.row, type: 'quality', key: 'ytd', title: row.label || 'Row ' + row.row,
            group: 'quality', status: 'inconsistent', severity: 'medium', unit: '',
            detail: 'Row ' + row.row + ' (' + (row.party || 'unspecified') + '): the YTD cell reads ' +
              fmtNum(row.ytd) + ' but the twelve month cells sum to ' + fmtNum(sum) +
              '. One of the two is wrong.',
            notes: ['Check the YTD formula on this row before the next submission.'],
            evidence: [{ source: 'TAQA', row: row.row, label: row.label }]
          });
        }
      }

      row.quarters.forEach((q, qi) => {
        if (q == null) return;
        const sum = months.slice(qi * 3, qi * 3 + 3).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - q) > 0.01) {
          findings.push({
            id: 'sc:q' + (qi + 1) + ':' + row.row, type: 'quality', key: 'quarter',
            title: row.label || 'Row ' + row.row, group: 'quality',
            status: 'inconsistent', severity: 'low', unit: '',
            detail: 'Row ' + row.row + ' (' + (row.party || 'unspecified') + '): Quarter ' + (qi + 1) +
              ' reads ' + fmtNum(q) + ' but its three months sum to ' + fmtNum(sum) + '.',
            notes: [], evidence: [{ source: 'TAQA', row: row.row, label: row.label }]
          });
        }
      });
    });
    return findings;
  }

  // ------------------------------------------------------- target assessment -

  function assessTargets(canon, rates, targets) {
    const findings = [];
    const actual = {
      ltifr: rates.ltifr, ltisr: rates.ltisr, trcf: rates.trcf,
      fatality: val(canon, 'fatality'),
      trainingHoursPerEmployee: rates.trainingHoursPerEmployee,
      inspectionsPer100Workers: rates.inspectionsPer100Workers,
      auditsPerMonth: val(canon, 'audits'),
      drillsPerMonth: val(canon, 'drills'),
      meetingsPerMonth: val(canon, 'meetings'),
      nearMissPer100Workers: (val(canon, 'nearMiss') != null && rates.employees)
        ? (val(canon, 'nearMiss') * 100) / rates.employees : null,
      observationsPerWorker: rates.observationsPerWorker,
      toolboxPerWorkerMonth: rates.toolboxPerWorkerMonth,
      ptwAudited: val(canon, 'ptwAudited'),
      overdueAuditActions: val(canon, 'overdueAuditActions'),
      prohibitionNotices: val(canon, 'prohibitionNotices'),
      envMajor: val(canon, 'envMajor'),
      uncontainedSpills: val(canon, 'uncontainedSpills')
    };

    Object.keys(targets).forEach((k) => {
      const t = targets[k];
      const a = actual[k];
      if (a == null) return;
      const meets = t.dir === 'min' ? a >= t.value : a <= t.value;
      const shortfall = t.dir === 'min' ? t.value - a : a - t.value;
      let severity = 'info';
      if (!meets) {
        const rel = t.value ? Math.abs(shortfall) / Math.abs(t.value) : 1;
        severity = (k === 'fatality' || k === 'envMajor' || k === 'prohibitionNotices') ? 'critical'
          : rel >= 0.5 ? 'high' : rel >= 0.2 ? 'medium' : 'low';
      }
      findings.push({
        id: 'tgt:' + k, type: 'target', key: k, title: t.label,
        group: 'target', status: meets ? 'met' : 'missed', severity: severity,
        unit: t.unit, actual: round(a, 3), target: t.value, direction: t.dir,
        shortfall: meets ? 0 : round(Math.abs(shortfall), 3),
        basis: t.basis,
        detail: sentence(meets
          ? fmtNum(round(a, 2), t.unit) + ' against a target of ' + (t.dir === 'min' ? 'at least ' : 'no more than ') + fmtNum(t.value, t.unit) + '.'
          : fmtNum(round(a, 2), t.unit) + ' against a target of ' + (t.dir === 'min' ? 'at least ' : 'no more than ') +
            fmtNum(t.value, t.unit) + ' — ' + (t.dir === 'min' ? 'short by ' : 'over by ') + fmtNum(round(Math.abs(shortfall), 2), t.unit) + '.'),
        notes: t.basis === 'house' ? ['House target, not a regulatory threshold. Edit it in Targets to match the project HSE plan.'] : [],
        evidence: []
      });
    });
    return findings;
  }

  // ------------------------------------------------------------- trends -----

  function detectTrends(taqaCanon, monthIndex) {
    const findings = [];
    if (monthIndex == null || monthIndex < 0) return findings;

    Object.keys(taqaCanon).forEach((k) => {
      const entry = taqaCanon[k];
      const def = entry.def;
      if (!def || def.rate) return;
      const s = entry.series;
      if (!s) return;

      const upTo = s.slice(0, monthIndex + 1);
      const reported = upTo.filter((v) => v != null);
      if (reported.length < 4) return;

      // Something that was being reported has gone quiet. Only meaningful for
      // KPIs where more is better — a run of zero injuries is good news.
      if (def.better === 'higher') {
        let trailingZeros = 0;
        for (let i = upTo.length - 1; i >= 0; i--) {
          if (upTo[i] === 0) trailingZeros++;
          else if (upTo[i] == null) continue;
          else break;
        }
        const earlier = upTo.slice(0, upTo.length - trailingZeros).filter((v) => v != null);
        const earlierTotal = earlier.reduce((a, b) => a + b, 0);
        // At least two separate months with activity before the silence —
        // otherwise a single one-off event (one induction in March) reads as a
        // programme that has collapsed, which is just noise.
        const activeMonths = earlier.filter((v) => v > 0).length;
        if (trailingZeros >= 3 && activeMonths >= 2) {
          findings.push({
            id: 'trend:stopped:' + k, type: 'trend', key: k, title: def.label,
            group: def.group, status: 'stopped', severity: trailingZeros >= 4 ? 'high' : 'medium',
            unit: def.unit,
            detail: sentence(def.label + ' ran at ' + fmtNum(earlierTotal, def.unit) + ' across ' + activeMonths +
              ' months earlier in the year, then read zero for ' + trailingZeros + ' consecutive months to ' +
              HSEParser.MONTHS[monthIndex] + '. For a proactive indicator, a run of zeros usually means the reporting ' +
              'has lapsed rather than the hazard.'),
            series: s.slice(), notes: [], evidence: [{ source: 'TAQA', row: entry.sourceRow, label: entry.sourceLabel }]
          });
        }
      }

      // A sharp move against the trailing quarter.
      if (monthIndex >= 3) {
        const cur = s[monthIndex];
        const prior = [s[monthIndex - 1], s[monthIndex - 2], s[monthIndex - 3]].filter((v) => v != null);
        if (cur != null && prior.length === 3) {
          const avg = prior.reduce((a, b) => a + b, 0) / 3;
          if (avg > 0) {
            const pct = ((cur - avg) / avg) * 100;
            const badDirection = def.better === 'higher' ? pct <= -40 : def.better === 'lower' ? pct >= 40 : false;
            if (Math.abs(pct) >= 40) {
              findings.push({
                id: 'trend:shift:' + k, type: 'trend', key: k, title: def.label,
                group: def.group, status: badDirection ? 'adverse-shift' : 'shift',
                severity: badDirection ? 'medium' : 'info', unit: def.unit,
                detail: sentence(def.label + ' is ' + fmtNum(round(cur, 2), def.unit) + ' this month against a three-month average of ' +
                  fmtNum(round(avg, 1), def.unit) + ' — ' + (pct > 0 ? 'up ' : 'down ') + Math.abs(round(pct, 0)) + '%.'),
                series: s.slice(), changePct: round(pct, 1), notes: [],
                evidence: [{ source: 'TAQA', row: entry.sourceRow, label: entry.sourceLabel }]
              });
            }
          }
        }
      }
    });
    return findings;
  }

  // -------------------------------------------------------- data quality ----

  function dataQuality(taqaReport, taqaCanon) {
    const findings = [];
    const q = taqaReport.quality || [];

    const ohTypos = q.filter((x) => x.kind === 'letter-o-for-zero');
    if (ohTypos.length) {
      const rows = new Set(ohTypos.map((x) => x.row));
      findings.push({
        id: 'dq:oh', type: 'quality', key: 'letter-o', title: 'Letter “o” typed instead of zero',
        group: 'quality', status: 'defect', severity: ohTypos.length > 100 ? 'high' : 'medium', unit: '',
        detail: ohTypos.length + ' cells across ' + rows.size + ' rows contain the letter “o” where a digit 0 belongs. ' +
          'Excel stores these as text, so they are excluded from every SUM on the sheet — the YTD and quarter ' +
          'totals on those rows are computed from fewer cells than they appear to cover.',
        notes: ['Select the affected range and replace “o” with 0, then check the YTD column re-calculates.'],
        sample: ohTypos.slice(0, 12).map((x) => 'row ' + x.row + ' · ' + x.month),
        evidence: []
      });
    }

    // Rate cells the submitted file could not compute, where the inputs to
    // compute them are present.
    ['ltifr', 'ltisr', 'trcf'].forEach((k) => {
      const e = taqaCanon[k];
      if (!e) return;
      const blanks = e.series.filter((v) => v == null).length;
      if (blanks >= 3) {
        findings.push({
          id: 'dq:rate:' + k, type: 'quality', key: k, title: e.def.label + ' — unreadable cells',
          group: 'quality', status: 'defect', severity: 'low', unit: e.def.unit,
          detail: e.def.label + ' is blank or in error for ' + blanks + ' of the 12 months on row ' + e.sourceRow +
            '. These are division-by-zero results from months with no man-hours yet; they are harmless in a ' +
            'printed form but they break charting and any downstream SUM.',
          notes: ['Wrap the formula in IFERROR(...,"") so future months read as empty rather than as an error.'],
          evidence: [{ source: 'TAQA', row: e.sourceRow, label: e.sourceLabel }]
        });
      }
    });

    return findings;
  }

  // ------------------------------------------------------------- actions ----

  // Who should own what. Roles, not names — the dashboard does not know the
  // project org chart, and a role is what belongs in an action register anyway.
  const OWNER = {
    lagging: 'Project HSE Manager',
    leading: 'HSE Officer',
    exposure: 'Project HSE Manager',
    enforcement: 'Project Manager',
    environment: 'Environmental Officer',
    process: 'Project Manager',
    quality: 'Document Controller',
    target: 'Project HSE Manager'
  };

  const ACTION_TEXT = {
    mismatch: (f) => ({
      title: 'Reconcile ' + f.title.toLowerCase() + ' between the TAQA submission and the internal report',
      what: 'Establish which figure is correct for ' + f.title.toLowerCase() + ', correct the wrong one at source, ' +
        'and re-issue whichever report carries the error.',
      verify: 'Both reports show the same figure for the period, and the source record (register, log or timesheet) supports it.'
    }),
    'blank-taqa': (f) => ({
      title: 'Fill in the blank ' + f.title.toLowerCase() + ' cell in the TAQA submission',
      what: 'The row exists on the form but the month\'s cell is empty or holds text where a number belongs ' +
        '(most often the letter “o”). Enter ' + fmtNum(f.internalValue, f.unit) + ' and confirm the YTD re-calculates.',
      verify: 'The cell holds a number, the YTD total moves accordingly, and it matches the internal record.'
    }),
    'missing-taqa': (f) => ({
      title: 'Add ' + f.title.toLowerCase() + ' to the TAQA submission',
      what: 'The internal report records ' + fmtNum(f.internalValue, f.unit) + ' but the client submission shows nothing. ' +
        'Populate the corresponding row before the next submission.',
      verify: 'The TAQA form carries the figure and it matches the internal record.'
    }),
    'missing-internal': (f) => ({
      title: 'Record ' + f.title.toLowerCase() + ' in the internal monthly report',
      what: 'A figure was submitted to the client that the internal report does not carry. Add it, or correct the submission.',
      verify: 'The internal report carries the figure with a traceable source.'
    }),
    'not-visible': (f) => ({
      title: 'Surface ' + f.title.toLowerCase() + ' to the client',
      what: 'The TAQA form has no row for this. Record the figure in the Remarks column and in the monthly narrative so the ' +
        'effort counts toward the contract\'s HSE performance.',
      verify: 'The submission\'s Remarks or narrative states the figure for the period.'
    }),
    missed: (f) => ({
      title: 'Close the gap on ' + f.title.toLowerCase(),
      what: 'Performance is ' + fmtNum(f.actual, f.unit) + ' against a target of ' + fmtNum(f.target, f.unit) +
        '. Plan and schedule the additional activity needed to reach the target, or revise the target with justification.',
      verify: 'Next month\'s figure meets or exceeds the target, evidenced in the monthly report.'
    }),
    stopped: (f) => ({
      title: 'Investigate why ' + f.title.toLowerCase() + ' has read zero for several months',
      what: 'This indicator has read zero for several consecutive months after being reported earlier in the year. ' +
        'Confirm whether the activity stopped or only the reporting did, then re-brief supervisors on how and where to log it.',
      verify: 'Entries appear in the register for the current month and the indicator is non-zero.'
    }),
    'adverse-shift': (f) => ({
      title: 'Investigate the change in ' + f.title.toLowerCase(),
      what: f.detail + ' Establish the cause and whether it reflects real performance or a recording change.',
      verify: 'A written cause is recorded and, where the cause is real, a corrective action is raised against it.'
    }),
    defect: (f) => ({
      title: 'Correct the data defect: ' + f.title.toLowerCase(),
      what: f.detail,
      verify: 'The file re-calculates correctly and the affected totals are verified against source registers.'
    }),
    inconsistent: (f) => ({
      title: 'Fix the total that disagrees with its own months',
      what: f.detail,
      verify: 'The YTD / quarter cell equals the sum of its months.'
    })
  };

  function buildActions(findings, ctx, sla) {
    const anchor = (ctx && ctx.anchorDate) ? new Date(ctx.anchorDate) : new Date();
    const out = [];

    findings.forEach((f) => {
      if (f.severity === 'info') return;
      if (f.status === 'match' || f.status === 'met') return;
      const maker = ACTION_TEXT[f.status];
      if (!maker) return;
      const body = maker(f);
      const days = sla[f.severity] != null ? sla[f.severity] : 30;
      const due = new Date(anchor.getTime() + days * 86400000);

      out.push({
        id: 'act:' + f.id,
        findingId: f.id,
        priority: f.severity,
        title: body.title,
        what: body.what,
        why: f.detail,
        owner: OWNER[f.group] || 'Project HSE Manager',
        group: f.group,
        dueDays: days,
        dueDate: due,
        dueLabel: due.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
        verification: body.verify,
        notes: f.notes || []
      });
    });

    out.sort((a, b) => (SEV_ORDER[a.priority] - SEV_ORDER[b.priority]) || (a.dueDate - b.dueDate));
    return out;
  }

  // ----------------------------------------------------------- scorecard ----

  function scorecard(findings) {
    const rec = findings.filter((f) => f.type === 'reconciliation');
    const matched = rec.filter((f) => f.status === 'match').length;
    const tgt = findings.filter((f) => f.type === 'target');
    const met = tgt.filter((f) => f.status === 'met').length;
    const quality = findings.filter((f) => f.type === 'quality');
    const openBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach((f) => {
      if (f.severity in openBySeverity && f.status !== 'match' && f.status !== 'met') openBySeverity[f.severity]++;
    });

    const alignment = rec.length ? Math.round((matched / rec.length) * 100) : null;
    const attainment = tgt.length ? Math.round((met / tgt.length) * 100) : null;
    // Data-quality score falls with the weight of open defects rather than
    // their count, so one high-severity defect outranks several trivial ones.
    const weight = quality.reduce((a, f) => a + (f.severity === 'high' ? 12 : f.severity === 'medium' ? 6 : 2), 0);
    const integrity = Math.max(0, 100 - weight);

    const parts = [alignment, attainment, integrity].filter((v) => v != null);
    return {
      alignment: alignment, alignmentMatched: matched, alignmentTotal: rec.length,
      attainment: attainment, attainmentMet: met, attainmentTotal: tgt.length,
      integrity: integrity, qualityDefects: quality.length,
      overall: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null,
      open: openBySeverity
    };
  }

  // --------------------------------------------------------------- run ------

  function analyse(input) {
    const taqaReport = input.taqa || null;
    const internalReport = input.internal || null;
    const targets = input.targets || HSEKpi.loadTargets();
    const sla = input.sla || HSEKpi.loadSla();
    const party = input.party || 'contractor';

    const taqaCanon = taqaReport ? HSEKpi.fromTaqa(taqaReport, { party: party }) : {};
    const internalCanon = internalReport ? HSEKpi.fromInternal(internalReport) : {};

    const monthIndex = (taqaReport && taqaReport.meta.monthIndex >= 0) ? taqaReport.meta.monthIndex
      : (internalReport ? internalReport.meta.monthIndex : -1);

    // Rates come from whichever source is present, preferring the TAQA file
    // because it carries the full twelve-month series.
    const primary = Object.keys(taqaCanon).length ? taqaCanon : internalCanon;
    const merged = Object.assign({}, internalCanon, taqaCanon);
    const rates = HSEKpi.deriveRates(merged, monthIndex);

    let findings = [];
    if (taqaReport && internalReport) {
      findings = findings.concat(reconcile(taqaCanon, internalCanon, {
        formRef: taqaReport.meta.formRef,
        monthLabel: monthIndex >= 0 ? HSEParser.MONTH_NAMES[monthIndex] : 'reporting month'
      }));
    }
    if (taqaReport) {
      findings = findings.concat(selfConsistency(taqaReport));
      findings = findings.concat(detectTrends(taqaCanon, monthIndex));
      findings = findings.concat(dataQuality(taqaReport, taqaCanon));
    }
    findings = findings.concat(assessTargets(merged, rates, targets));

    findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.title.localeCompare(b.title));

    return {
      taqa: taqaReport, internal: internalReport,
      taqaCanon: taqaCanon, internalCanon: internalCanon, canon: merged,
      primary: primary, party: party,
      monthIndex: monthIndex,
      monthName: monthIndex >= 0 ? HSEParser.MONTH_NAMES[monthIndex] : '',
      year: (taqaReport && taqaReport.meta.year) || (internalReport && internalReport.meta.year) || null,
      rates: rates,
      targets: targets,
      findings: findings,
      actions: buildActions(findings, { anchorDate: input.anchorDate }, sla),
      scorecard: scorecard(findings),
      cumulativeBasis: (taqaReport && internalReport) ? cumulativeBasis(taqaCanon, internalCanon) : null
    };
  }

  global.HSEAnalysis = {
    analyse: analyse,
    reconcile: reconcile,
    selfConsistency: selfConsistency,
    assessTargets: assessTargets,
    detectTrends: detectTrends,
    dataQuality: dataQuality,
    buildActions: buildActions,
    scorecard: scorecard,
    fmtNum: fmtNum,
    sentence: sentence,
    SEV_ORDER: SEV_ORDER
  };
})(window);
