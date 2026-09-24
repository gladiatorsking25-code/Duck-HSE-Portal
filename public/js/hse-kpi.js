// hse-kpi.js — the canonical KPI vocabulary shared by both report families.
//
// The TAQA submission and the internal HEGC report measure many of the same
// things under different names ("No.s Of HSE insepctions" vs "Inspections
// Performed by"), in different units (water in m³ vs litres), and split across
// different parties. Nothing can be compared until both sides are mapped onto
// one vocabulary — that mapping is this file.
//
// Matching is by regular expression against the KPI's own label, not by row
// number, because these forms are re-issued regularly and rows move. Labels are
// matched with their real spelling mistakes intact ("insepctions",
// "dangeroues", "Manageement", "Soild") — they are in the live forms and a
// matcher that quietly requires correct spelling would silently drop the KPI.
//
// WHICH PARTY TO COMPARE. The internal report covers our own company only; the
// TAQA form splits every KPI into Consultant / Contractor / Sub-Cont. / Total.
// The honest comparison is therefore the TAQA *Contractor* line against the
// internal *Total* — and the August 2026 data confirms it (125 = 125 employees,
// 25,000 = 25,000 man-hours, 22 = 22 inspections, 69 = 69 training hours).
// Comparing against the TAQA Total would build in a permanent false gap equal
// to the consultant's own numbers.

(function (global) {
  'use strict';

  const K = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

  // Groups drive both the layout of the dashboard and how a gap is weighted.
  const GROUPS = {
    exposure: { label: 'Exposure', order: 1 },
    lagging: { label: 'Lagging indicators', order: 2 },
    leading: { label: 'Leading indicators', order: 3 },
    enforcement: { label: 'Regulatory & enforcement', order: 4 },
    environment: { label: 'Environment', order: 5 },
    process: { label: 'Process safety', order: 6 }
  };

  // better: 'lower' — fewer is better (incidents). 'higher' — more is better
  // (inspections, training). 'neutral' — context only (headcount, fuel used).
  const CANON = [
    // ---- exposure ----------------------------------------------------------
    { key: 'employees', label: 'Workforce on site', unit: 'persons', group: 'exposure', better: 'neutral',
      taqa: /^average no\.? of employees/, internal: { domain: 'ohs', re: /^no\.? of employees/ } },
    { key: 'manhours', label: 'Man-hours worked', unit: 'hrs', group: 'exposure', better: 'neutral',
      taqa: /^man-?\s?hours worked/, internal: { domain: 'ohs', re: /^man-?\s?hours worked/ } },
    { key: 'safeHours', label: 'Safe working hours', unit: 'hrs', group: 'exposure', better: 'higher',
      internal: { domain: 'ohs', re: /^safe working-?\s?hours/ } },
    { key: 'lostDays', label: 'Work days lost', unit: 'days', group: 'lagging', better: 'lower',
      taqa: /^work days lost/ },

    // ---- lagging: reportable ----------------------------------------------
    { key: 'fatality', label: 'Fatalities', unit: 'cases', group: 'lagging', better: 'lower', critical: true,
      taqa: /^fatality\b/, internal: { domain: 'ohs', re: /^no\.? fatalities/ } },
    { key: 'ptd', label: 'Permanent total disability', unit: 'cases', group: 'lagging', better: 'lower', critical: true,
      taqa: /^permanent total disability/, internal: { domain: 'ohs', re: /^permanent total disability/ } },
    { key: 'ppd', label: 'Permanent partial disability', unit: 'cases', group: 'lagging', better: 'lower', critical: true,
      taqa: /^permanent partial disability/, internal: { domain: 'ohs', re: /^permanent partial disability/ } },
    { key: 'lwc', label: 'Lost workday injuries', unit: 'cases', group: 'lagging', better: 'lower', critical: true,
      taqa: /^lost\s+workdays injury/, internal: { domain: 'ohs', re: /^lost working days cases/ } },
    { key: 'occIllness', label: 'Occupational illness / disease', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^lost\s+workdays occupational illness/, internal: { domain: 'ohs', re: /^no of serious occupational illness/ } },
    { key: 'dangerousOccurrence', label: 'Serious dangerous occurrences', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^serious dangerous occurrence/, internal: { domain: 'ohs', re: /^no of serious dangerou/ } },
    { key: 'swi', label: 'Serious workplace injuries', unit: 'cases', group: 'lagging', better: 'lower',
      internal: { domain: 'ohs', re: /^no\.? of serious workplace/ } },

    // ---- lagging: recordable ----------------------------------------------
    { key: 'rwc', label: 'Restricted workday cases', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^restricted workday cases/, internal: { domain: 'ohs', re: /^restricted workday cases/ } },
    { key: 'mtc', label: 'Medical treatment cases', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^medical treatment cases/, internal: { domain: 'ohs', re: /^number of medical treatment cases/ } },
    { key: 'firstAid', label: 'First aid injuries', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^first aid injury/, internal: { domain: 'ohs', re: /^number of first aid injuries/ } },
    { key: 'propertyDamage', label: 'Property / equipment damage', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^equipment\/property damage/, internal: { domain: 'ohs', re: /^number of property\/equipment damage/ } },
    { key: 'nearMiss', label: 'Near misses reported', unit: 'reports', group: 'leading', better: 'higher',
      taqa: /^near misses/, internal: { domain: 'ohs', re: /^reported near miss/ } },
    { key: 'rta', label: 'Road traffic accidents', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^road traffic accident/, internal: { domain: 'ohs', re: /^no of road traffic/ } },
    { key: 'totalConsequences', label: 'Total consequences', unit: 'cases', group: 'lagging', better: 'lower',
      taqa: /^total consequences/ },
    { key: 'lti', label: 'Lost time injuries', unit: 'cases', group: 'lagging', better: 'lower', critical: true,
      internal: { domain: 'ohs', re: /^lost time injury \(lti\)/ } },
    { key: 'trc', label: 'Total reported cases', unit: 'cases', group: 'lagging', better: 'lower',
      internal: { domain: 'ohs', re: /^total reported cases/ } },

    // ---- rates -------------------------------------------------------------
    { key: 'ltifr', label: 'LTIFR', unit: 'per 10⁶ hrs', group: 'lagging', better: 'lower', rate: true,
      taqa: /^lost time injury frequency rate/, internal: { domain: 'ohs', re: /^lost time injury frequency rate/ } },
    { key: 'ltisr', label: 'LTISR', unit: 'per 10⁶ hrs', group: 'lagging', better: 'lower', rate: true,
      taqa: /^lost time injury severity rate/, internal: { domain: 'ohs', re: /^lost time injury severity rate/ } },
    { key: 'trcf', label: 'TRCF', unit: 'per 10⁶ hrs', group: 'lagging', better: 'lower', rate: true,
      taqa: /^total reportable case frequency/, internal: { domain: 'ohs', re: /^total reported case frequency/ } },

    // ---- leading -----------------------------------------------------------
    { key: 'inspections', label: 'HSE inspections', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^inspections performed by/, internal: { domain: 'ohs', re: /^no\.?s? of hse insepctions|^no\.?s? of hse inspections/ } },
    { key: 'audits', label: 'HSE compliance audits', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^full ohs ms compliance audit/, internal: { domain: 'ohs', re: /^no\.?s? of hse audits/ } },
    { key: 'trainingHours', label: 'Training hours delivered', unit: 'hrs', group: 'leading', better: 'higher',
      taqa: /^training hours \(kpi/, internal: { domain: 'ohs', re: /^total training hours/ } },
    { key: 'avgTrainingHours', label: 'Training hours per employee', unit: 'hrs/person', group: 'leading', better: 'higher', rate: true,
      taqa: /^average number of training hours per employee/ },
    { key: 'internalTrainings', label: 'Internal training sessions', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^number of internal trainings/ },
    { key: 'externalTrainings', label: 'External (third-party) trainings', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^number of external \(third party\) trainings/ },
    { key: 'inductions', label: 'Inductions delivered', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^number of induction/ },
    { key: 'toolboxTalks', label: 'Toolbox talks', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^number of tool box talk/ },
    { key: 'drills', label: 'Emergency drills', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^site erp drills conducted vs plan/, internal: { domain: 'ohs', re: /^emergency evacuation drills/ } },
    { key: 'meetings', label: 'HSE meetings', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^sws\/consultant\/contractor|^meetings$/, internal: { domain: 'ohs', re: /^no\.?s? of hse meetings/ } },
    { key: 'unsafeActs', label: 'Observations — unsafe acts', unit: 'no.', group: 'leading', better: 'higher',
      internal: { domain: 'ohs', re: /^hse observation \(unsafe acts\)/ } },
    { key: 'unsafeConditions', label: 'Observations — unsafe conditions', unit: 'no.', group: 'leading', better: 'higher',
      internal: { domain: 'ohs', re: /^hse observation \(unsafe conditions\)/ } },
    { key: 'docReviews', label: 'EHS documents reviewed / approved', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^review \/ approval of ehs procedures/ },
    { key: 'incidentsInvestigated', label: 'Incidents investigated by client / consultant', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^contractor incidents investigated/ },
    { key: 'partSystemAudit', label: 'Part-system audits', unit: 'no.', group: 'leading', better: 'higher',
      taqa: /^specific requirement \/ part system audit/ },
    { key: 'correctiveActions', label: 'Corrective actions issued', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^corrective actions issued by/ },
    { key: 'breachNotices', label: 'Breach notices issued', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^breach notices issued by/ },
    { key: 'stopWorkNotices', label: 'Stop-work notices issued', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^stop work notice issued by/ },

    // ---- permits -----------------------------------------------------------
    { key: 'permitExcavation', label: 'Excavation permits', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^number of sws excavation permit/ },
    { key: 'permitConfined', label: 'Confined space permits', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^number of sws confined space permit/ },
    { key: 'permitHotWork', label: 'Hot work permits', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^number of hot work permit/ },
    { key: 'permitOther', label: 'Other permits', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^number of other permits/ },
    { key: 'ptwAudited', label: 'PTWs audited vs issued', unit: '%', group: 'leading', better: 'higher', rate: true,
      taqa: /^ptws audited vs issued/ },
    { key: 'ptwActions', label: 'Actions raised from PTW audits', unit: 'no.', group: 'leading', better: 'neutral',
      taqa: /^actions raised from ptw audits/ },

    // ---- OHS resourcing ----------------------------------------------------
    { key: 'ohsStaffUae', label: 'OHS staff — UAE nationals', unit: 'persons', group: 'leading', better: 'higher',
      taqa: /^number of employees in ohs department \(uae/ },
    { key: 'ohsStaffExpat', label: 'OHS staff — expatriate', unit: 'persons', group: 'leading', better: 'neutral',
      taqa: /^number of employees in ohs department \(non uae/ },
    { key: 'ohsPractitioner', label: "OHS practitioner's course attendees", unit: 'persons', group: 'leading', better: 'higher',
      taqa: /^number of employees attended ohs practitioner/ },
    { key: 'qudorat', label: 'Employees registered at Qudorat', unit: 'persons', group: 'leading', better: 'higher',
      taqa: /^number of employees registered at qudorat/ },

    // ---- enforcement -------------------------------------------------------
    { key: 'warningNotices', label: 'Warning notices from the SRA', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^number of warning notices received/ },
    { key: 'improvementNotices', label: 'Improvement notices from the SRA', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^number of improvement notices received/ },
    { key: 'prohibitionNotices', label: 'Prohibition notices from the SRA', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^number of prohibition notices received/ },
    { key: 'penalties', label: 'Penalties / fines received', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^number of penalties/ },
    { key: 'enforceableUndertakings', label: 'Enforceable undertakings', unit: 'no.', group: 'enforcement', better: 'lower',
      taqa: /^number of enforceable undertakings/ },
    { key: 'fineValue', label: 'Value of fines enforced', unit: 'AED', group: 'enforcement', better: 'lower',
      taqa: /^total value of all fines/ },

    // ---- environment -------------------------------------------------------
    { key: 'envModerate', label: 'Environmental incidents — moderate', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^environment - moderate/ },
    { key: 'envMajor', label: 'Environmental incidents — major', unit: 'no.', group: 'environment', better: 'lower', critical: true,
      taqa: /^environment - major/ },
    { key: 'envMinor', label: 'Environmental incidents — minor', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^environment - minor/ },
    { key: 'envIncidents', label: 'Environmental incidents (total)', unit: 'no.', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^environmental incidents/ } },
    { key: 'uncontainedSpills', label: 'Uncontained spills', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^uncontained spills a spill/ },
    { key: 'uncontainedSpillQty', label: 'Uncontained spill quantity', unit: 'L', group: 'environment', better: 'lower',
      taqa: /^uncontained spills quantity/ },
    { key: 'containedSpills', label: 'Contained spills', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^contained spills a spill/ },
    { key: 'containedSpillQty', label: 'Contained spill quantity', unit: 'L', group: 'environment', better: 'lower',
      taqa: /^contained spill quantity/ },
    { key: 'spills', label: 'Spills (oil, chemical, sewage)', unit: 'no.', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^spill \(oil/ } },
    { key: 'gasRelease', label: 'Gas release', unit: 'kg', group: 'environment', better: 'lower',
      taqa: /^gas release/, internal: { domain: 'environment', re: /^gas release/ } },
    { key: 'fire', label: 'Fires', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^fire all fires/, internal: { domain: 'ohs', re: /^no of fire incidents/ } },
    { key: 'electricalRelease', label: 'Electrical energy release', unit: 'no.', group: 'environment', better: 'lower',
      taqa: /^electrical energy release/ },
    { key: 'waterConsumption', label: 'Water consumption', unit: 'L', group: 'environment', better: 'lower',
      taqa: /^total water consumption/, taqaUnit: 'm³', taqaToBase: 1000,
      internal: { domain: 'environment', re: /^water consumption/ } },
    { key: 'paperConsumption', label: 'Paper consumption', unit: 'kg', group: 'environment', better: 'lower',
      taqa: /^total paper consumption/ },
    { key: 'powerConsumption', label: 'Electricity consumption', unit: 'kWh', group: 'environment', better: 'lower',
      taqa: /^total power consumption/, internal: { domain: 'environment', re: /^electricity consumption/ } },
    { key: 'fuelConsumption', label: 'Fuel consumption', unit: 'L', group: 'environment', better: 'lower',
      taqa: /^total fuel consumption/ },
    { key: 'dieselQty', label: 'Diesel consumed', unit: 'L', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^diesel quantity/ } },
    { key: 'petrolQty', label: 'Petrol consumed', unit: 'L', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^petrol quantity/ } },
    { key: 'nonHazSolidWaste', label: 'Non-hazardous solid waste', unit: 'kg', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^non-hazardous so[il]+d waste/ } },
    { key: 'nonHazLiquidWaste', label: 'Non-hazardous liquid waste', unit: 'L', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^non-hazardous liquid waste/ } },
    { key: 'hazSolidWaste', label: 'Hazardous solid waste', unit: 'kg', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^hazardous so[il]+d waste/ } },
    { key: 'hazLiquidWaste', label: 'Hazardous liquid waste', unit: 'kg', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^hazardous liquid waste/ } },
    { key: 'envTrainingHours', label: 'Environmental training hours', unit: 'hrs', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^total training hours/ } },
    { key: 'envInspections', label: 'Environmental inspections', unit: 'no.', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^number of environmental inspections/ } },
    { key: 'envAudits', label: 'Environmental audits', unit: 'no.', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^number of environmental audits/ } },
    { key: 'envObsActs', label: 'Environmental observations — acts', unit: 'no.', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^environmental observations \(unsafe acts\)/ } },
    { key: 'envObsConditions', label: 'Environmental observations — conditions', unit: 'no.', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^environmental observations \(unsafe conditions\)/ } },
    { key: 'envDrills', label: 'Environmental mock drills', unit: 'no.', group: 'environment', better: 'higher',
      internal: { domain: 'environment', re: /^number of emergency mock drill/ } },
    { key: 'airEmissions', label: 'Air emissions / pollution', unit: 'kg', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^air emissions/ } },
    { key: 'waterPollution', label: 'Water pollution events', unit: 'no.', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^water pollution/ } },
    { key: 'noisePollution', label: 'Noise exceedances (>85 dB(A))', unit: 'no.', group: 'environment', better: 'lower',
      internal: { domain: 'environment', re: /^noise pollution/ } },

    // ---- process safety ----------------------------------------------------
    { key: 'lossOfContainment', label: 'Loss of process containment', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^loss of process containment/ },
    { key: 'overdueMaintenance', label: 'Overdue maintenance on safety-critical equipment', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^overdue maintenance tasks/ },
    { key: 'overdueAuditActions', label: 'Overdue actions from audits / inspections', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^overdue actions from hse audits/ },
    { key: 'overdueHipoActions', label: 'Overdue actions from HiPo investigations', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^overdue actions from hipo/ },
    { key: 'mocOverdue', label: 'MOCs open beyond 6 months', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^moc > 6 months/ },
    { key: 'overridesActive', label: 'Overrides active beyond 90 days', unit: 'no.', group: 'process', better: 'lower',
      taqa: /^overrides > 90days/ }
  ];

  const BY_KEY = {};
  CANON.forEach((d) => { BY_KEY[d.key] = d; });

  // -------------------------------------------------------- canonicalising --

  // A TAQA row's identity is its sub-item if it has one, else its group — the
  // group label on a sub-divided KPI is only a heading ("Recordable Incidents").
  function taqaRowLabel(row) { return K(row.sub || row.group); }

  function fromTaqa(report, opts) {
    const party = (opts && opts.party) || 'contractor';
    const mi = report.meta.monthIndex;
    const out = {};

    CANON.forEach((def) => {
      if (!def.taqa) return;
      const matches = report.rows.filter((r) => def.taqa.test(taqaRowLabel(r)));
      if (!matches.length) return;

      // Prefer the requested party; fall back to Total, then to whatever single
      // line exists (several KPIs are reported on one unlabelled row).
      let row = matches.find((r) => r.partyKey === party)
        || matches.find((r) => r.partyKey === 'total')
        || (matches.length === 1 ? matches[0] : null);
      if (!row) return;

      const scale = def.taqaToBase || 1;
      const series = row.months.map((v) => (v == null ? null : v * scale));
      out[def.key] = {
        key: def.key, def: def,
        value: mi >= 0 && mi < 12 ? series[mi] : null,
        series: series,
        ytd: row.ytd == null ? null : row.ytd * scale,
        quarters: row.quarters.map((v) => (v == null ? null : v * scale)),
        party: row.partyKey,
        sourceRow: row.row,
        sourceLabel: row.label,
        // Every party line, so the dashboard can break a KPI down without
        // re-scanning the raw rows.
        byParty: matches.reduce((acc, r) => {
          if (r.partyKey) acc[r.partyKey] = r.months.map((v) => (v == null ? null : v * scale));
          return acc;
        }, {})
      };
    });
    return out;
  }

  function fromInternal(report) {
    const out = {};
    CANON.forEach((def) => {
      if (!def.internal) return;
      const hit = report.kpis.find((k) =>
        k.domain === def.internal.domain && def.internal.re.test(K(k.label)));
      if (!hit) return;
      out[def.key] = {
        key: def.key, def: def,
        value: hit.total != null ? hit.total : hit.company,
        company: hit.company,
        contractor: hit.contractor,
        cumulative: hit.cumulative,
        unit: hit.unit,
        section: hit.section,
        sourceRow: hit.row,
        sourceLabel: hit.label
      };
    });
    return out;
  }

  // ---------------------------------------------------------- derived rates --

  const MILLION = 1000000;
  function safeRate(numerator, hours) {
    if (numerator == null || !hours) return null;
    return (numerator * MILLION) / hours;
  }
  function n(v) { return v == null ? 0 : v; }

  // Recomputes the rate KPIs from their own inputs rather than trusting the
  // submitted cell. In the August 2026 TAQA file every rate cell past AUG is a
  // #DIV/0! error, and a rate that disagrees with its own numerator and
  // denominator is exactly the kind of thing this dashboard exists to catch.
  function deriveRates(canon, monthIndex) {
    const at = (k) => (canon[k] ? canon[k].value : null);
    const hours = at('manhours');

    const ltiCount = at('lti') != null ? at('lti')
      : n(at('fatality')) + n(at('ptd')) + n(at('ppd')) + n(at('lwc'));
    const recordable = n(ltiCount) + n(at('rwc')) + n(at('mtc'));
    const employees = at('employees');
    const nearMiss = at('nearMiss');
    const observations = n(at('unsafeActs')) + n(at('unsafeConditions'));

    return {
      monthIndex: monthIndex,
      manhours: hours,
      employees: employees,
      ltiCount: ltiCount,
      recordable: recordable,
      ltifr: safeRate(ltiCount, hours),
      ltisr: safeRate(at('lostDays'), hours),
      trcf: safeRate(recordable, hours),
      nearMissRate: safeRate(nearMiss, hours),
      observationRate: observations && hours ? safeRate(observations, hours) : null,
      // Leading-to-lagging ratio: how many proactive reports (near misses +
      // observations) were raised for each recordable case. A high ratio is the
      // signature of a reporting culture that is working.
      leadingRatio: recordable > 0 ? (n(nearMiss) + observations) / recordable : null,
      proactiveReports: n(nearMiss) + observations,
      trainingHoursPerEmployee: (at('trainingHours') != null && employees)
        ? at('trainingHours') / employees : null,
      inspectionsPer100Workers: (at('inspections') != null && employees)
        ? (at('inspections') * 100) / employees : null,
      toolboxPerWorkerMonth: (at('toolboxTalks') != null && employees)
        ? at('toolboxTalks') / employees : null,
      observationsPerWorker: employees ? observations / employees : null,
      permitsIssued: n(at('permitExcavation')) + n(at('permitConfined')) + n(at('permitHotWork')) + n(at('permitOther')),
      hoursPerEmployee: (hours && employees) ? hours / employees : null
    };
  }

  // ------------------------------------------------------------- targets ----
  //
  // HOUSE targets, not regulatory citations. They are the numbers this
  // dashboard measures against by default and every one of them is editable in
  // the Targets tab — they should be replaced with whatever the contract's
  // approved HSE plan actually commits to. `basis` records where a number came
  // from so the UI never presents a house default as a legal requirement.

  const DEFAULT_TARGETS = {
    ltifr: { value: 0, dir: 'max', label: 'LTIFR', unit: 'per 10⁶ hrs', basis: 'house', note: 'Zero-harm objective: no lost-time injuries.' },
    ltisr: { value: 0, dir: 'max', label: 'LTISR', unit: 'per 10⁶ hrs', basis: 'house', note: 'No lost workdays.' },
    trcf: { value: 0, dir: 'max', label: 'TRCF', unit: 'per 10⁶ hrs', basis: 'house', note: 'No recordable cases.' },
    fatality: { value: 0, dir: 'max', label: 'Fatalities', unit: 'cases', basis: 'house', note: 'Absolute.' },
    trainingHoursPerEmployee: { value: 1, dir: 'min', label: 'Training hours per employee', unit: 'hrs/person/month', basis: 'house', note: 'Set this to the figure committed in the project HSE plan.' },
    inspectionsPer100Workers: { value: 15, dir: 'min', label: 'Inspections per 100 workers', unit: 'per month', basis: 'house', note: 'Site inspection frequency.' },
    auditsPerMonth: { value: 0.34, dir: 'min', label: 'Compliance audits', unit: 'per month', basis: 'house', note: 'Equivalent to one audit per quarter.' },
    drillsPerMonth: { value: 0.34, dir: 'min', label: 'Emergency drills', unit: 'per month', basis: 'house', note: 'Equivalent to one drill per quarter.' },
    meetingsPerMonth: { value: 2, dir: 'min', label: 'HSE meetings', unit: 'per month', basis: 'house', note: 'Monthly HSE committee plus toolbox review.' },
    nearMissPer100Workers: { value: 2, dir: 'min', label: 'Near misses reported per 100 workers', unit: 'per month', basis: 'house', note: 'A reporting-culture floor: silence is a finding, not a success.' },
    observationsPerWorker: { value: 0.3, dir: 'min', label: 'Observations per worker', unit: 'per month', basis: 'house', note: 'Unsafe acts + unsafe conditions raised.' },
    toolboxPerWorkerMonth: { value: 0.3, dir: 'min', label: 'Toolbox talks per worker', unit: 'per month', basis: 'house', note: 'Roughly weekly per crew.' },
    ptwAudited: { value: 10, dir: 'min', label: 'PTWs audited vs issued', unit: '%', basis: 'house', note: 'Share of issued permits subject to a field audit.' },
    overdueAuditActions: { value: 0, dir: 'max', label: 'Overdue audit actions', unit: 'no.', basis: 'house', note: 'Nothing past its due date.' },
    prohibitionNotices: { value: 0, dir: 'max', label: 'Prohibition notices', unit: 'no.', basis: 'house', note: 'Regulator enforcement.' },
    envMajor: { value: 0, dir: 'max', label: 'Major environmental incidents', unit: 'no.', basis: 'house', note: 'Absolute.' },
    uncontainedSpills: { value: 0, dir: 'max', label: 'Uncontained spills', unit: 'no.', basis: 'house', note: 'Absolute.' }
  };

  // How long an action gets, by how serious the finding is.
  const DEFAULT_SLA = { critical: 7, high: 14, medium: 30, low: 60 };

  const TARGETS_STORE = 'cla_hse_targets';
  const SLA_STORE = 'cla_hse_sla';

  function loadTargets() {
    try {
      const raw = localStorage.getItem(TARGETS_STORE);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_TARGETS));
      const saved = JSON.parse(raw);
      const merged = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
      Object.keys(saved || {}).forEach((k) => {
        if (merged[k]) merged[k] = Object.assign(merged[k], saved[k], { basis: 'edited' });
        else merged[k] = saved[k];
      });
      return merged;
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_TARGETS)); }
  }
  function saveTargets(t) {
    try { localStorage.setItem(TARGETS_STORE, JSON.stringify(t)); return true; } catch (e) { return false; }
  }
  function resetTargets() {
    try { localStorage.removeItem(TARGETS_STORE); } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  }
  function loadSla() {
    try {
      const raw = localStorage.getItem(SLA_STORE);
      return raw ? Object.assign({}, DEFAULT_SLA, JSON.parse(raw)) : Object.assign({}, DEFAULT_SLA);
    } catch (e) { return Object.assign({}, DEFAULT_SLA); }
  }
  function saveSla(s) {
    try { localStorage.setItem(SLA_STORE, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  global.HSEKpi = {
    CANON: CANON, BY_KEY: BY_KEY, GROUPS: GROUPS,
    DEFAULT_TARGETS: DEFAULT_TARGETS, DEFAULT_SLA: DEFAULT_SLA,
    fromTaqa: fromTaqa, fromInternal: fromInternal,
    deriveRates: deriveRates, taqaRowLabel: taqaRowLabel,
    loadTargets: loadTargets, saveTargets: saveTargets, resetTargets: resetTargets,
    loadSla: loadSla, saveSla: saveSla
  };
})(window);
