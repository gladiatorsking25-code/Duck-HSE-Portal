// Unit tests for the permit-to-work registry and rules in public/js/permit-types.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PT = require('../public/js/permit-types.js');

const FROM = '2026-09-24T06:00:00.000Z';
const TO = '2026-09-24T14:00:00.000Z';
const SIG = 'data:image/png;base64,AAAA';

// Realistic answers for selects where the last option would stop the permit
// (for example "Sprinklers impaired"). Everything else uses the last option,
// which for most types switches on the extra conditional checks.
const SAMPLE = {
  hot_work: {
    fireDetection: 'Detectors isolated with approval (restore at close-out)',
    area: 'Hazardous area (flammable gas, vapour or dust may be present)',
  },
  energy_isolation: { liveWork: 'No' },
};

// A permit of the given type with every required answer filled in, built from
// the registry itself so the tests follow the content.
function complete(key, extra = {}, details = {}) {
  const type = PT.byKey(key);
  const p = {
    id: 'P-1', permitType: key, status: 'active',
    projectNumber: 'PRJ-1', location: 'Unit 4 pipe rack', workDescription: 'Replace flange gasket',
    validFrom: FROM, validTo: TO, personInCharge: 'R. Khan', hasRiskAssessment: true, hasMethodStatement: true,
    otherPermits: 'CSE-2026-0001, HW-2026-0002, WAH-2026-0003',
    issuerName: 'A. Issuer', issuerSignature: SIG, approverName: 'B. Approver', approverSignature: SIG,
  };
  if (type.topLevelChecks) type.checks.forEach((c) => { p[c.key] = true; });
  else {
    p.checks = {}; type.checks.forEach((c) => { p.checks[c.key] = true; });
    p.details = {};
    (type.fields || []).forEach((f) => {
      p.details[f.key] = f.kind === 'number' ? Math.max(f.min || 0, 2)
        : f.kind === 'select' ? f.options[f.options.length - 1]
        : f.kind === 'list' ? ['Person One', 'Person Two']
        : f.kind === 'datetime' ? FROM
        : 'filled';
    });
    Object.assign(p.details, SAMPLE[key] || {}, details);
  }
  if (type.gasTest) p.gasTests = [goodGas(type)];
  if (type.isolations) p.isolations = [{ point: 'MCC-3 feeder 12', energy: 'Electrical', method: 'Breaker off, locked', lockNo: 'L-101', isolatedBy: 'E. Tech', verified: true }];
  return Object.assign(p, extra);
}
// A close-out with every item ticked. Date/time fields are an hour apart,
// ending ten minutes before the permit is closed.
function closeoutFor(type, extra = {}) {
  const c = { by: 'C. Closer', at: '2026-09-24T13:10:00.000Z', checks: {}, fields: {} };
  (type.closeout || []).forEach((i) => { c.checks[i.key] = true; });
  const dt = (type.closeoutFields || []).filter((f) => f.kind === 'datetime');
  (type.closeoutFields || []).forEach((f) => {
    c.fields[f.key] = f.kind === 'datetime'
      ? new Date(Date.parse(c.at) - 10 * 60000 - (dt.length - 1 - dt.indexOf(f)) * 3600000).toISOString()
      : 'filled';
  });
  return Object.assign(c, extra);
}
// A reading in the middle of every limit.
function goodGas(type, at = FROM) {
  const t = { at, testedBy: 'G. Tester', instrument: 'GD-7' };
  type.gasTest.limits.forEach((l) => {
    if (l.min != null && l.max != null) t[l.key] = (l.min + l.max) / 2;
    else if (l.below != null) t[l.key] = 0;
    else if (l.max != null) t[l.key] = 0;
    else t[l.key] = 0;
  });
  return t;
}

test('the registry: unique keys and prefixes, lifting is the default', () => {
  const keys = PT.TYPES.map((t) => t.key);
  const prefixes = PT.TYPES.map((t) => t.prefix);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.equal(PT.DEFAULT_TYPE, 'lifting');
  for (const k of ['lifting', 'hot_work', 'confined_space', 'work_at_height']) assert.ok(PT.isType(k), k);
  for (const t of PT.TYPES) {
    assert.ok(t.label && t.summary && t.prefix, t.key);
    assert.ok(/^[A-Z]{2,4}$/.test(t.prefix), t.prefix);
    assert.ok(t.checks.length >= 5, `${t.key} has precautions`);
    assert.ok((t.closeout || []).length >= 2, `${t.key} has close-out checks`);
    t.checks.forEach((c) => assert.ok(c.label.length <= 90, `${t.key}.${c.key} label is short`));
    const checkKeys = t.checks.map((c) => c.key);
    assert.equal(new Set(checkKeys).size, checkKeys.length, `${t.key} check keys are unique`);
    const fieldKeys = (t.fields || []).map((f) => f.key);
    assert.equal(new Set(fieldKeys).size, fieldKeys.length, `${t.key} field keys are unique`);
    (t.fields || []).filter((f) => f.kind === 'select').forEach((f) => assert.ok(f.options.length, `${t.key}.${f.key} has options`));
  }
});

test('old permits with no type are lifting permits', () => {
  assert.equal(PT.typeKeyOf({}), 'lifting');
  assert.equal(PT.typeKeyOf({ permitType: 'nonsense' }), 'lifting');
  assert.equal(PT.labelOf({ permitType: 'hot_work' }), PT.byKey('hot_work').label);
});

test('status: closed and suspended win, then expiry', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  assert.equal(PT.statusOf({ validTo: TO }, now), 'active');
  assert.equal(PT.statusOf({ validTo: '2026-09-24T09:00:00Z' }, now), 'expired');
  assert.equal(PT.statusOf({ validTo: TO, status: 'suspended' }, now), 'suspended');
  assert.equal(PT.statusOf({ validTo: '2026-09-01T00:00:00Z', status: 'closed' }, now), 'closed');
});

test('numbering continues from the highest number on file, per prefix and year', () => {
  assert.equal(PT.nextNumber('HW', 2026, 0, []).number, 'HW-2026-0001');
  assert.equal(PT.nextNumber('HW', 2026, 3, ['HW-2026-0002']).number, 'HW-2026-0004');
  // A wiped device (counter 0) with permits back from the account.
  assert.equal(PT.nextNumber('LP', 2026, 0, ['LP-2026-0007', 'HW-2026-0020', 'LP-2025-0099', null]).number, 'LP-2026-0008');
  assert.equal(PT.nextNumber('LP', 2026, 12, ['LP-2026-0007']).seq, 13);
});

test('a complete permit of every type can be issued', () => {
  for (const t of PT.TYPES) {
    assert.deepEqual(PT.validate(complete(t.key), { assessments: [] }), [], t.key);
  }
});

test('common fields are required for every type', () => {
  for (const t of PT.TYPES) {
    for (const [field, blank] of [['location', ''], ['personInCharge', ''], ['issuerSignature', ''], ['hasRiskAssessment', false], ['projectNumber', '']]) {
      const errs = PT.validate(complete(t.key, { [field]: blank }), { assessments: [] });
      assert.ok(errs.length >= 1, `${t.key} without ${field}`);
    }
    const back = PT.validate(complete(t.key, { validTo: FROM }), {});
    assert.ok(back.some((e) => /Valid-to/.test(e)), `${t.key} validity order`);
  }
});

test('ADOSH-SF CoP 21.0: a permit lasts at most 12 hours', () => {
  for (const t of PT.TYPES) {
    const errs = PT.validate(complete(t.key, { validTo: '2026-09-24T18:30:00.000Z' }), {});
    assert.ok(errs.some((e) => /at most 12 hours/.test(e)), t.key);
    assert.deepEqual(PT.validate(complete(t.key, { validTo: '2026-09-24T18:00:00.000Z' }), {}), [], `${t.key} exactly 12 h`);
  }
});

test('every required precaution, field and close-out item is enforced', () => {
  for (const t of PT.TYPES) {
    t.checks.filter((c) => c.required).forEach((c) => {
      const p = complete(t.key);
      if (t.topLevelChecks) p[c.key] = false; else p.checks[c.key] = false;
      assert.ok(PT.validate(p, {}).some((e) => e.includes(c.label)), `${t.key}.${c.key}`);
    });
    (t.fields || []).filter((f) => f.required).forEach((f) => {
      const p = complete(t.key);
      p.details[f.key] = f.kind === 'list' ? [] : '';
      assert.ok(PT.validate(p, {}).some((e) => e.includes(f.label)), `${t.key}.${f.key}`);
    });
    assert.deepEqual(PT.validateCloseout(complete(t.key), closeoutFor(t)), [], `${t.key} close-out`);
    assert.ok(PT.validateCloseout(complete(t.key), closeoutFor(t, { by: '' })).length, `${t.key} close-out needs a name`);
    (t.closeout || []).filter((i) => i.required).forEach((i) => {
      const c = closeoutFor(t); c.checks[i.key] = false;
      assert.ok(PT.validateCloseout(complete(t.key), c).some((e) => e.includes(i.label)), `${t.key} close-out ${i.key}`);
    });
    (t.closeoutFields || []).filter((f) => f.required).forEach((f) => {
      const c = closeoutFor(t); c.fields[f.key] = '';
      assert.ok(PT.validateCloseout(complete(t.key), c).some((e) => e.includes(f.label)), `${t.key} close-out ${f.key}`);
    });
  }
});

test('gas tests: required types need a reading inside every limit', () => {
  for (const t of PT.TYPES.filter((x) => x.gasTest)) {
    if (t.gasTest.required) {
      assert.ok(PT.validate(complete(t.key, { gasTests: [] }), {}).some((e) => /gas test/i.test(e)), `${t.key} needs a test`);
    }
    for (const lim of t.gasTest.limits) {
      const bad = goodGas(t);
      bad[lim.key] = lim.min != null ? lim.min - 0.1 : (lim.max != null ? lim.max + 1 : lim.below);
      const errs = PT.validate(complete(t.key, { gasTests: [bad] }), {});
      assert.ok(errs.some((e) => e.includes(lim.label)), `${t.key} ${lim.key} out of range`);
      if (lim.max != null && lim.min != null) {
        const high = goodGas(t); high[lim.key] = lim.max + 0.1;
        assert.ok(PT.validate(complete(t.key, { gasTests: [high] }), {}).length, `${t.key} ${lim.key} too high`);
      }
      const missing = goodGas(t); missing[lim.key] = '';
      const missingErrs = PT.validate(complete(t.key, { gasTests: [missing] }), {});
      if (lim.optional) assert.deepEqual(missingErrs, [], `${t.key} ${lim.key} is optional`);
      else assert.ok(missingErrs.some((e) => /missing/.test(e)), `${t.key} ${lim.key} missing`);
    }
    // The latest reading decides: a failed test followed by a good one passes.
    const failed = goodGas(t, '2026-09-24T05:00:00.000Z'); failed[t.gasTest.limits[0].key] = -1;
    // A test with no detector or tester recorded is not good enough.
    const anon = goodGas(t); anon.instrument = ''; anon.testedBy = '';
    const anonErrs = PT.validate(complete(t.key, { gasTests: [anon] }), {});
    assert.ok(anonErrs.some((e) => /detector/.test(e)) && anonErrs.some((e) => /who carried out/.test(e)), `${t.key} tester and detector`);
    assert.deepEqual(PT.validate(complete(t.key, { gasTests: [goodGas(t, '2026-09-24T05:30:00.000Z'), failed].reverse() }), {}), [], `${t.key} retest`);
    const later = complete(t.key, { gasTests: [goodGas(t, '2026-09-24T05:00:00.000Z'), failed] });
    later.gasTests[1].at = '2026-09-24T05:45:00.000Z';
    assert.ok(PT.validate(later, {}).length, `${t.key} latest failed test blocks`);
  }
});

test('confined space uses the ADOSH-SF CoP 27.0 oxygen and flammable limits', () => {
  const lim = Object.fromEntries(PT.byKey('confined_space').gasTest.limits.map((l) => [l.key, l]));
  assert.equal(lim.o2.min, 19.5);
  assert.equal(lim.o2.max, 23.5);
  assert.equal(lim.lel.below, 5);
  assert.ok(PT.byKey('confined_space').gasTest.required);
});

test('energy isolation needs a verified, locked point', () => {
  const t = PT.TYPES.find((x) => x.isolations);
  assert.ok(t, 'an isolation type exists');
  assert.ok(PT.validate(complete(t.key, { isolations: [] }), {}).some((e) => /isolation point/.test(e)));
  const row = { point: 'Pump P-101 motor', energy: 'Electrical', method: 'Breaker off', lockNo: '', isolatedBy: 'X', verified: false };
  const errs = PT.validate(complete(t.key, { isolations: [row] }), {});
  assert.ok(errs.some((e) => /lock or tag/.test(e)));
  assert.ok(errs.some((e) => /zero energy/.test(e)));
});

test('lifting keeps its critical-lift rules', () => {
  const ok = { id: 'A1', isValid: true };
  const bad = { id: 'A2', isValid: false };
  assert.deepEqual(PT.validate(complete('lifting', { isCriticalLift: true, assessmentId: 'A1' }), { assessments: [ok] }), []);
  assert.ok(PT.validate(complete('lifting', { isCriticalLift: true, assessmentId: null }), { assessments: [ok] }).some((e) => /linked crane assessment/.test(e)));
  assert.ok(PT.validate(complete('lifting', { isCriticalLift: true, assessmentId: 'A2' }), { assessments: [bad] }).some((e) => /not within capacity/.test(e)));
  assert.ok(PT.validate(complete('lifting', { isCriticalLift: true, assessmentId: 'A1', approverSignature: '' }), { assessments: [ok] }).some((e) => /approver/.test(e)));
  // A non-critical lift needs no assessment or approver, and no work description (as before).
  assert.deepEqual(PT.validate(complete('lifting', { approverName: '', approverSignature: '', workDescription: '' }), {}), []);
});

test('types that need an approver say so', () => {
  for (const t of PT.TYPES.filter((x) => x.approverRequired)) {
    assert.ok(PT.validate(complete(t.key, { approverSignature: '' }), {}).some((e) => /approver/.test(e)), t.key);
  }
});

// ---- Conditional rules, type by type ----------------------------------------
const has = (errs, re) => errs.some((e) => re.test(e));

test('hot work: gas test where flammables may be present; sprinklers must work', () => {
  const open = { area: 'Open site or outdoors', onContainer: 'No' };
  assert.deepEqual(PT.validate(complete('hot_work', { gasTests: [] }, open), {}), [], 'open site needs no gas test');
  assert.ok(has(PT.validate(complete('hot_work', { gasTests: [] }), {}), /gas test/i), 'hazardous area needs one');
  assert.ok(has(PT.validate(complete('hot_work', { gasTests: [] }, { area: 'Open site or outdoors', onContainer: 'Yes' }), {}), /gas test/i), 'a container needs one');
  assert.ok(has(PT.validate(complete('hot_work', {}, { fireDetection: 'Sprinklers impaired' }), {}), /sprinklers/));
  assert.ok(has(PT.validate(complete('hot_work', { otherPermits: '' }, { area: 'Inside a confined space' }), {}), /confined space entry permit/));
});

test('hot work: equipment checks follow the kind of hot work', () => {
  const gasCutting = complete('hot_work', {}, { hotWorkType: 'Gas (oxy-fuel) welding or cutting', onContainer: 'No' });
  for (const k of ['flashbackArrestors', 'rcd', 'arcScreens', 'containerGasFreed']) gasCutting.checks[k] = false;
  const errs = PT.validate(gasCutting, {});
  assert.ok(has(errs, /flashback arrestors/i), 'gas sets need flashback arrestors');
  assert.ok(!has(errs, /RCD/), 'no RCD check for gas cutting');
  assert.ok(!has(errs, /arc flash/), 'no arc screens for gas cutting');
  assert.ok(!has(errs, /gas-freed/), 'no gas-freeing unless on a container');
  const arc = complete('hot_work', {}, { hotWorkType: 'Electric arc welding' });
  arc.checks.rcd = false; arc.checks.arcScreens = false; arc.checks.flashbackArrestors = false;
  const arcErrs = PT.validate(arc, {});
  assert.ok(has(arcErrs, /RCD/) && has(arcErrs, /arc flash/));
  assert.ok(!has(arcErrs, /flashback/));
});

test('hot work: the fire watcher is not one of the welders; isolated detectors are recorded and restored', () => {
  assert.ok(has(PT.validate(complete('hot_work', {}, { fireWatcher: ' person  one', workers: ['Person One'] }), {}), /fire watcher cannot also/));
  const iso = 'Detectors isolated with approval (restore at close-out)';
  assert.ok(has(PT.validate(complete('hot_work', {}, { fireDetection: iso, detectorZones: '' }), {}), /detector zones/));
  const t = PT.byKey('hot_work');
  const c = closeoutFor(t); c.checks.detectorsRestored = false;
  assert.ok(has(PT.validateCloseout(complete('hot_work', {}, { fireDetection: iso }), c), /detectors must be restored/));
  assert.deepEqual(PT.validateCloseout(complete('hot_work', {}, { fireDetection: 'Not affected' }), c), []);
});

test('hot work close-out: fire watch lasts at least an hour and has ended', () => {
  const t = PT.byKey('hot_work');
  const at = '2026-09-24T13:10:00.000Z';
  const c = (ended, watch) => closeoutFor(t, { at, fields: { hotWorkEnded: ended, fireWatchEnded: watch } });
  assert.deepEqual(PT.validateCloseout(complete('hot_work'), c('2026-09-24T12:00:00.000Z', '2026-09-24T13:00:00.000Z')), []);
  assert.ok(has(PT.validateCloseout(complete('hot_work'), c('2026-09-24T12:30:00.000Z', '2026-09-24T13:00:00.000Z')), /at least 1 hour/));
  assert.ok(has(PT.validateCloseout(complete('hot_work'), c('2026-09-24T12:30:00.000Z', '2026-09-24T14:00:00.000Z')), /in the future/));
});

test('confined space: hot work inside, standby, other gases and heat', () => {
  assert.ok(has(PT.validate(complete('confined_space', { otherPermits: '' }, { hotWorkInside: 'Yes' }), {}), /hot work permit/));
  assert.deepEqual(PT.validate(complete('confined_space', { otherPermits: '' }, { hotWorkInside: 'No' }), {}), []);
  assert.ok(has(PT.validate(complete('confined_space', {}, { attendant: 'Person Two' }), {}), /standby person cannot also/));
  const clean = 'Nothing hazardous (water, inert solids, never used)';
  assert.deepEqual(PT.validate(complete('confined_space', {}, { contentsType: clean, otherGas: '' }), {}), []);
  assert.ok(has(PT.validate(complete('confined_space', {}, { contentsType: 'Fuel, oil, hydrocarbons or solvents', otherGas: '' }), {}), /other gases/));
  const t = PT.byKey('confined_space');
  const lowO2 = goodGas(t); lowO2.o2 = 20.1;
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [lowO2] }, { contentsType: clean, otherGas: '' }), {}), /displaced/));
  const hot = complete('confined_space', {}, { temperature: 41, maxTimeInside: '' }); hot.checks.heatStress = false;
  const hotErrs = PT.validate(hot, {});
  assert.ok(has(hotErrs, /Heat stress/) && has(hotErrs, /maximum time inside/));
  const cool = complete('confined_space', {}, { temperature: 24, maxTimeInside: '' }); cool.checks.heatStress = false;
  assert.deepEqual(PT.validate(cool, {}), []);
});

test('gas tests: every reading in the latest round counts, and it must be recent', () => {
  const t = PT.byKey('confined_space');
  const top = { ...goodGas(t), point: 'Top' };
  const bottom = { ...goodGas(t), point: 'Bottom', h2s: 3 };
  const errs = PT.validate(complete('confined_space', { gasTests: [top, bottom] }), {});
  assert.ok(has(errs, /Bottom: H₂S 3 ppm/), 'a bad reading at one point blocks the round');
  // After ventilating, a new round replaces it.
  const later = '2026-09-24T06:30:00.000Z';
  const retest = [top, bottom, { ...goodGas(t, later), point: 'Top' }, { ...goodGas(t, later), point: 'Bottom' }];
  assert.deepEqual(PT.validate(complete('confined_space', { gasTests: retest }), {}), []);
  const stale = goodGas(t, '2026-09-24T03:30:00.000Z');
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [stale] }), {}), /more than 2 hours before/));
  const noDetector = [top, { ...bottom, h2s: 0, instrument: '' }];
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: noDetector }), {}), /detector/));
});

test('ADOSH-SF CoP 21.0: the issuer cannot issue a permit to themselves', () => {
  for (const t of PT.TYPES) {
    assert.ok(has(PT.validate(complete(t.key, { issuerName: 'r. khan ' }), { assessments: [] }), /must be different people/), t.key);
  }
});

test('work at height: equipment details and wind limits', () => {
  const arrest = { fallProtection: 'Fall arrest (harness and energy-absorbing lanyard or SRL)' };
  assert.ok(has(PT.validate(complete('work_at_height', {}, { ...arrest, anchors: '' }), {}), /anchor points/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { ...arrest, rescuers: [] }), {}), /rescuers/));
  const noHarness = complete('work_at_height', {}, arrest); noHarness.checks.harnessChecked = false;
  assert.ok(has(PT.validate(noHarness, {}), /Harness/));
  const rails = complete('work_at_height', {}, { fallProtection: 'Guardrails / edge protection', anchors: '', rescuers: [] });
  rails.checks.harnessChecked = false; rails.checks.anchorsCertified = false; rails.checks.fallClearance = false;
  assert.deepEqual(PT.validate(rails, {}), [], 'guardrails need no harness, anchors or rescuers');
  assert.ok(has(PT.validate(complete('work_at_height', {}, { access: 'MEWP – boom lift', mewp: '' }), {}), /MEWP ID/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { access: 'Independent scaffold', platformTag: '' }), {}), /tag number/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { windLimit: 10, windReading: 12.5 }), {}), /above the 10 m\/s limit/));
  assert.deepEqual(PT.validate(complete('work_at_height', {}, { windLimit: 10, windReading: 10 }), {}), []);
});

test('excavation: support over 1.2 m, safe batter angles, buried services', () => {
  const none = 'None needed (1.2 m or less and assessed stable)';
  assert.ok(has(PT.validate(complete('excavation', {}, { depth: 1.5, support: none }), {}), /deeper than 1\.2 m/));
  assert.deepEqual(PT.validate(complete('excavation', {}, { depth: 1.2, support: none }), {}), []);
  const batter = { support: 'Battered or sloped', groundType: 'Sand', groundCondition: 'Wet (water table, groundwater or rain)', tempWorks: '' };
  assert.ok(has(PT.validate(complete('excavation', {}, { ...batter, batterAngle: 20 }), {}), /steeper than the 10° safe slope for sand in wet ground/));
  assert.deepEqual(PT.validate(complete('excavation', {}, { ...batter, batterAngle: 10 }), {}), []);
  assert.deepEqual(PT.validate(complete('excavation', {}, { ...batter, batterAngle: 20, tempWorks: 'TW-12, J. Engineer' }), {}), [], 'an engineered design allows steeper sides');
  assert.ok(has(PT.validate(complete('excavation', {}, { ...batter, batterAngle: '' }), {}), /batter angle/));
  const machine = complete('excavation', {}, { method: 'Mechanical excavator', servicesFound: ['11 kV cable at 0.8 m, pegged'] });
  machine.checks.banksman = false;
  assert.ok(has(PT.validate(machine, {}), /Banksman/));
  const clear = complete('excavation', {}, { method: 'Mechanical excavator', servicesFound: ['None found'] });
  clear.checks.banksman = false;
  assert.deepEqual(PT.validate(clear, {}), []);
  assert.ok(has(PT.validate(complete('excavation', { gasTests: [], otherPermits: '' }, { confinedSpace: 'Yes' }), {}), /gas test/i));
  assert.ok(has(PT.validate(complete('excavation', { otherPermits: '' }, { confinedSpace: 'Yes' }), {}), /confined space entry permit/));
  assert.deepEqual(PT.validate(complete('excavation', { gasTests: [], otherPermits: '' }, { confinedSpace: 'No', gasSource: 'No' }), {}), []);
  assert.ok(has(PT.validate(complete('excavation', { gasTests: [] }, { confinedSpace: 'No', gasSource: 'Yes', depth: 1.5 }), {}), /gas test/i), 'deep dig near a gas source');
  assert.deepEqual(PT.validate(complete('excavation', { gasTests: [] }, { confinedSpace: 'No', gasSource: 'Yes', depth: 1 }), {}), []);
  // Rock can stand unsupported only with a written assessment.
  const rock = 'None – stable rock, assessed by a competent person';
  assert.deepEqual(PT.validate(complete('excavation', {}, { depth: 3, support: rock, groundType: 'Rock', tempWorks: 'GA-7, J. Geotech' }), {}), []);
  assert.ok(has(PT.validate(complete('excavation', {}, { depth: 3, support: rock, groundType: 'Rock', tempWorks: '' }), {}), /stable rock/));
  assert.ok(has(PT.validate(complete('excavation', {}, { depth: 3, support: rock, groundType: 'Sand', tempWorks: 'X' }), {}), /stable rock/));
  // Fill and unknown ground use the flattest Table 1 slope.
  assert.ok(has(PT.validate(complete('excavation', {}, { support: 'Battered or sloped', groundType: 'Unknown', groundCondition: 'Dry', tempWorks: '', batterAngle: 20 }), {}), /5° safe slope/));
  assert.ok(has(PT.validate(complete('excavation', {}, { setBack: 0.3 }), {}), /0\.6 m back/));
  const hot = complete('excavation', {}, { temperature: 41 }); hot.checks.heatStress = false;
  assert.ok(has(PT.validate(hot, {}), /Heat stress/));
  const lines = complete('excavation', {}, { overheadLines: 'Yes' }); lines.checks.overheadControls = false;
  assert.ok(has(PT.validate(lines, {}), /Goalposts/));
});

test('work at height: guardrails first, fall clearance, ladders, wind for MEWPs', () => {
  const arrest = 'Fall arrest (harness and energy-absorbing lanyard or SRL)';
  assert.ok(has(PT.validate(complete('work_at_height', {}, { height: 4, fallProtection: arrest, whyNotCollective: '' }), {}), /not reasonably practicable/));
  assert.deepEqual(PT.validate(complete('work_at_height', {}, { height: 1.5, fallProtection: arrest, whyNotCollective: '' }), {}), []);
  assert.ok(has(PT.validate(complete('work_at_height', {}, { fallProtection: arrest, clearanceAvailable: 3, clearanceNeeded: 5.5 }), {}), /Only 3 m is clear below/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { fallProtection: arrest, clearanceAvailable: '' }), {}), /clear distance below/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { access: 'Leaning ladder', height: 3, fallProtection: 'Guardrails / edge protection', anchors: '', rescuers: [] }), {}), /CoP 37\.0/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { access: 'MEWP – scissor lift', windLimit: '', windReading: '' }), {}), /wind limit and the wind speed/));
  const boom = complete('work_at_height', {}, { access: 'MEWP – boom lift' }); boom.checks.boomHarness = false;
  assert.ok(has(PT.validate(boom, {}), /Boom lift/));
  const open = complete('work_at_height', {}, { openEdges: 'Yes' }); open.checks.openingsProtected = false;
  assert.ok(has(PT.validate(open, {}), /openings covered/));
});

test('energy isolation: electrical and process isolations add their own checks', () => {
  const elec = complete('energy_isolation'); elec.checks.testerChecked = false; elec.checks.processIsolation = false;
  const errs = PT.validate(elec, {});
  assert.ok(has(errs, /Voltage tester/), 'electrical isolation needs a proven tester');
  assert.ok(!has(errs, /Process lines/), 'no process isolation check for electrical only');
  const proc = complete('energy_isolation', { isolations: [{ point: 'Line 12 inlet valve', energy: 'Chemical / process', method: 'Spade fitted', lockNo: 'L-7', isolatedBy: 'O. Operator', verified: true }] });
  proc.checks.testerChecked = false; proc.checks.processIsolation = false;
  const perrs = PT.validate(proc, {});
  assert.ok(has(perrs, /Process lines/));
  assert.ok(!has(perrs, /Voltage tester/));
});

test('energy isolation: no live work, electrical details when electrical, gas test in hazardous areas', () => {
  assert.ok(has(PT.validate(complete('energy_isolation', {}, { liveWork: 'Yes' }), {}), /does not cover live work/));
  const elec = complete('energy_isolation', {}, { electrician: '', voltage: '', tester: '' });
  const errs = PT.validate(elec, {});
  assert.ok(has(errs, /authorised electrical person/) && has(errs, /system voltage/) && has(errs, /voltage tester ID/));
  const mech = complete('energy_isolation', { isolations: [{ point: 'Conveyor C-2 drive', energy: 'Mechanical', method: 'Coupling pinned', lockNo: 'L-9', isolatedBy: 'M. Fitter', verified: true }] },
    { electrician: '', voltage: '', tester: '' });
  mech.checks.testerChecked = false; mech.checks.electricalPpe = false;
  assert.deepEqual(PT.validate(mech, {}), [], 'mechanical isolation needs no electrical details');
  assert.ok(has(PT.validate(complete('energy_isolation', { gasTests: [] }, { hazardousArea: 'Yes' }), {}), /gas test before enclosures/));
  assert.deepEqual(PT.validate(complete('energy_isolation', { gasTests: [] }, { hazardousArea: 'No' }), {}), []);
});

test('general work: pressure tests, safety-critical equipment and optional toxic gas readings', () => {
  assert.ok(has(PT.validate(complete('general', {}, { category: 'Pressure or leak testing', pressureTest: '' }), {}), /pressure test medium and details/));
  const t = PT.byKey('general');
  const c = closeoutFor(t); c.checks.safetyEquipmentBack = false;
  assert.ok(has(PT.validateCloseout(complete('general', {}, { safetyEquipmentOut: 'Fire alarm zone 4 isolated' }), c), /back in service/));
  assert.deepEqual(PT.validateCloseout(complete('general', {}, { safetyEquipmentOut: '', category: 'Inspection or testing' }), c), []);
  const noToxic = goodGas(t); delete noToxic.h2s; delete noToxic.co;
  assert.deepEqual(PT.validate(complete('general', { gasTests: [noToxic] }), {}), [], 'H₂S and CO only where tested');
  const highCo = goodGas(t); highCo.co = 40;
  assert.ok(has(PT.validate(complete('general', { gasTests: [highCo] }), {}), /CO 40 ppm/));
  const quiet = { gasTestNeeded: 'No', hazardousArea: 'No', category: 'Inspection or testing' };
  assert.deepEqual(PT.validate(complete('general', { gasTests: [] }, quiet), {}), []);
  assert.ok(has(PT.validate(complete('general', { gasTests: [] }, { ...quiet, category: 'Opening lines or equipment' }), {}), /gas test/i), 'opening lines needs a gas test');
  assert.ok(has(PT.validate(complete('general', { gasTests: [] }, { ...quiet, hazardousArea: 'Yes' }), {}), /gas test/i), 'hazardous area needs a gas test');
  assert.ok(has(PT.validate(complete('general', { otherPermits: '' }, { category: 'Scaffold erection or dismantling' }), {}), /work at height permit/));
  assert.ok(has(PT.validate(complete('general', {}, { isolationNeeded: 'Yes', isolationCert: '' }), {}), /isolation certificate/));
  const pneu = complete('general', {}, { category: 'Pressure or leak testing', pressureMedium: 'Pneumatic (air or gas)' }); pneu.checks.pneumaticApproved = false;
  assert.ok(has(PT.validate(pneu, {}), /Pneumatic test approved/));
});

test('energy isolation: a stop button or interlock is not isolation', () => {
  const row = { point: 'Pump P-4', energy: 'Electrical', method: 'E-stop pressed and tagged', lockNo: 'L-3', isolatedBy: 'E. Tech', verified: true };
  assert.ok(has(PT.validate(complete('energy_isolation', { isolations: [row] }), {}), /not isolating devices/));
  assert.deepEqual(PT.validate(complete('energy_isolation', { isolations: [{ ...row, method: 'Breaker racked out and locked' }] }), {}), []);
});

test('gas tests: the latest reading at every test point must pass', () => {
  const t = PT.byKey('confined_space');
  const at = (hhmm) => `2026-09-24T${hhmm}:00.000Z`;
  const reading = (hhmm, point, extra = {}) => ({ ...goodGas(t, at(hhmm)), point, ...extra });
  // Readings taken a couple of minutes apart still all count.
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [reading('05:50', 'Top', { h2s: 8 }), reading('05:52', 'Bottom')] }), {}), /Top: H₂S 8 ppm/));
  // Re-testing only the bottom does not clear a failed top.
  const partial = [reading('05:40', 'Top', { h2s: 8 }), reading('05:40', 'Middle'), reading('05:40', 'Bottom'), reading('05:50', 'Bottom')];
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: partial }), {}), /Top: H₂S 8 ppm/));
  assert.deepEqual(PT.validate(complete('confined_space', { gasTests: partial.concat([reading('05:55', 'top ')]) }), {}), []);
  // Every reading needs a time, and times cannot be in the future or after the permit.
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [reading('05:50', 'Top'), { ...goodGas(t), at: '', h2s: 9 }] }), {}), /needs the date and time/));
  const iso = complete('energy_isolation', { gasTests: [{ at: '', lel: 40, testedBy: 'G', instrument: 'D' }] }, { hazardousArea: 'No' });
  assert.ok(has(PT.validate(iso, {}), /needs the date and time/), 'an untimed reading is not ignored');
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [reading('05:50', 'Top')] }), { now: Date.parse(at('04:00')) }), /in the future/));
  assert.ok(has(PT.validate(complete('confined_space', { gasTests: [reading('15:00', 'Top')] }), { now: Date.parse(at('16:00')) }), /after the permit ends/));
});

test('gas tests: an issued permit can record a failed re-test for suspension', () => {
  const t = PT.byKey('confined_space');
  const p = complete('confined_space', { permitNumber: 'CSE-2026-0001', gasTests: [goodGas(t, '2026-09-24T05:45:00.000Z'), { ...goodGas(t, '2026-09-24T10:00:00.000Z'), h2s: 5 }] });
  const now = Date.parse('2026-09-24T10:05:00.000Z');
  assert.ok(has(PT.validate(p, { now }), /outside the limits/));
  assert.deepEqual(PT.validate(p, { now, allowFailedGas: true }), []);
  assert.deepEqual(PT.failingGasReadings(p), ['H₂S 5 ppm is above 1 ppm']);
});

test('older permits can still be edited: rules added later apply only to changed values', () => {
  const old = complete('lifting', { validFrom: '2026-09-20T07:00', validTo: '2026-09-24T17:00:00.000Z', issuerName: 'J. Doe', personInCharge: 'J. Doe' });
  const edited = { ...old, validFrom: new Date(Date.parse(old.validFrom)).toISOString(), verifierName: 'V. Verifier' };
  assert.deepEqual(PT.validate(edited, { original: old }), [], 'same window and names');
  assert.ok(has(PT.validate({ ...edited, validTo: '2026-09-25T17:00:00.000Z' }, { original: old }), /at most 12 hours/));
  assert.ok(has(PT.validate({ ...edited, issuerName: 'j. doe', personInCharge: 'J.  Doe', validTo: old.validTo }, { original: { ...old, issuerName: 'A. Other' } }), /different people/));
  assert.ok(has(PT.validate(edited, {}), /A lifting permit can be valid for at most 12 hours/));
  assert.ok(has(PT.validate(complete('excavation', { validTo: '2026-09-25T06:00:00.000Z' }), {}), /^An excavation permit/));
});

test('energy isolation: every row is checked, stored electrical is electrical, control devices are refused by method', () => {
  const row = { point: 'UPS-2 battery bank', energy: 'Stored electrical (capacitors, batteries, UPS)', method: 'Battery breaker open and locked', lockNo: 'L-5', isolatedBy: 'E. Tech', verified: true };
  const ups = complete('energy_isolation', { isolations: [row] }, { electrician: '', voltage: '', tester: '' });
  assert.ok(has(PT.validate(ups, {}), /authorised electrical person/));
  const unnamed = complete('energy_isolation', { isolations: [row, { energy: 'Electrical', lockNo: 'L2', isolatedBy: 'C', method: 'MCB off', verified: false }] });
  const errs = PT.validate(unnamed, {});
  assert.ok(has(errs, /Isolation 2: name the equipment/) && has(errs, /Isolation 2: confirm zero energy/));
  assert.ok(has(PT.validate(complete('energy_isolation', { isolations: [{ ...row, method: '' }] }), {}), /record how it was isolated/));
  const plc = { point: 'PLC panel CP-1 supply', energy: 'Electrical', method: 'MCB-4 in DB-2 off and locked', lockNo: 'L-1', isolatedBy: 'E', verified: true };
  const vfd = { ...plc, point: 'VFD-101 incomer isolator', method: 'Rotary isolator off and locked' };
  assert.deepEqual(PT.validate(complete('energy_isolation', { isolations: [plc, vfd] }), {}), [], 'a PLC or VFD named in the point is fine');
  assert.ok(has(PT.validate(complete('energy_isolation', { isolations: [{ ...plc, method: 'Selector to OFF' }] }), {}), /not isolating devices/));
  assert.ok(has(PT.validate(complete('energy_isolation', { isolations: [{ ...plc, point: 'E-stop at conveyor', method: '' }] }), {}), /not isolating devices/));
  const press = complete('energy_isolation', { isolations: [{ point: 'Press hydraulic power pack valve', energy: 'Hydraulic', method: 'Valve closed, locked, pressure bled', lockNo: 'L-8', isolatedBy: 'M', verified: true }] });
  press.checks.processIsolation = false;
  assert.deepEqual(PT.validate(press, {}), [], 'machine hydraulics need no blinds or spades');
});

test('other permits must name the right type of permit', () => {
  const cs = { area: 'Inside a confined space' };
  assert.ok(has(PT.validate(complete('hot_work', { otherPermits: 'WAH-2026-0004' }, cs), {}), /confined space entry permit/));
  assert.deepEqual(PT.validate(complete('hot_work', { otherPermits: 'Confined space permit to follow' }, cs), {}), []);
  assert.ok(has(PT.validate(complete('confined_space', { otherPermits: 'ISO-2026-0003' }, { hotWorkInside: 'Yes' }), {}), /hot work permit/));
});

test('work at height: stepladders', () => {
  const step = complete('work_at_height', {}, { access: 'Stepladder', height: 1.5 }); step.checks.stepladder = false; step.checks.ladderUse = false;
  const errs = PT.validate(step, {});
  assert.ok(has(errs, /Stepladder working height/) && !has(errs, /tied, 1 m above/));
  assert.ok(has(PT.validate(complete('work_at_height', {}, { access: 'Stepladder', height: 2.5 }), {}), /limited to a working height of 1\.8 m/));
});
