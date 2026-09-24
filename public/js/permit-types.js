// permit-types.js — the permit-to-work types and their rules.
//
// One registry drives the permit form (permit.html), the permit list
// (permits.html), the dashboard and permit numbering. Each type lists its
// extra fields, precautions, gas-test limits, energy isolations and close-out
// checks, and validate() turns them into the list of problems that stop a
// permit being issued. Everything here is plain data and pure functions so
// the unit tests (test/permit-types.test.mjs) can load this file in Node.
//
// Lifting permits keep their original shape (top-level has* check keys,
// isCriticalLift, a linked crane assessment) so records saved before the other
// types existed keep working. Every other type stores its answers under
// `details`, `checks`, `gasTests`, `isolations` and `closeout`.
//
// The content follows the ADOSH-SF codes of practice named on each type. It
// supports the site's own permit-to-work system; a competent person must
// check it against that system before it is relied on.

(function (root) {
  'use strict';

  const LIFTING_CHECKS = [
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

  // Gas-test limits. `below` means the reading must be under the figure;
  // `min`/`max` are inclusive bounds.
  const OXYGEN = { key: 'o2', label: 'Oxygen', unit: '%', min: 19.5, max: 23.5, limitText: '19.5–23.5 %' };
  const FLAMMABLE = { key: 'lel', label: 'Flammable gas', unit: '% LEL', below: 5, limitText: 'below 5 % LEL' };
  const H2S = { key: 'h2s', label: 'H₂S', unit: ' ppm', max: 1, limitText: 'no more than 1 ppm' };
  const CO = { key: 'co', label: 'CO', unit: ' ppm', max: 25, limitText: 'no more than 25 ppm' };

  const YES_NO = ['No', 'Yes'];

  // Every non-lifting permit asks for these (ADOSH-SF CoP 21.0: the permit
  // holder briefs the work party in a common language and they sign on; s3.9,
  // concurrent activities are controlled).
  const BRIEFED = { key: 'briefed', label: 'Work party briefed in a language they understand, and signed on', required: true };
  const NEARBY = { key: 'nearbyWork', label: 'Other work and live permits nearby checked for conflicts', required: true };

  const HOT_WORK_AREAS = [
    'Open site or outdoors',
    'Inside a building or structure',
    'Hazardous area (flammable gas, vapour or dust may be present)',
    'Inside a confined space',
    'On or next to live process plant or pipework',
  ];
  // Locations where a flammable-gas test is needed before hot work starts.
  const HOT_WORK_GAS_AREAS = HOT_WORK_AREAS.slice(2);

  const HEIGHT_ACCESS = [
    'Fixed platform or roof with edge protection', 'Independent scaffold', 'Mobile scaffold tower',
    'MEWP – scissor lift', 'MEWP – boom lift', 'Ladder or stepladder', 'Suspended platform or cradle',
    'Rope access', 'Other',
  ];
  const FALL_PROTECTION = [
    'Guardrails / edge protection', 'Work restraint', 'Fall arrest (harness and energy-absorbing lanyard or SRL)',
    'Safety nets or soft landing', 'Several of these',
  ];

  const CSE_CONTENTS = [
    'Nothing hazardous (water, inert solids, never used)', 'Fuel, oil, hydrocarbons or solvents', 'Chemicals',
    'Sewage, sludge or rotting matter', 'Nitrogen, CO₂ or other inert gas (purged or fire protection)', 'Unknown',
  ];
  // Heat stress controls and a time limit become required at this temperature
  // inside a confined space (a practice trigger; see ADOSH-SF CoP 11.0).
  const HEAT_TRIGGER_C = 30;
  // ADOSH-SF CoP 11.0 s3.1.1(e): a heat stress programme at 35 °C or more.
  const HEAT_OUTDOOR_C = 35;

  const SUPPORT_METHODS = [
    'None needed (1.2 m or less and assessed stable)', 'None – stable rock, assessed by a competent person', 'Battered or sloped', 'Benched',
    'Timber or trench sheets with props', 'Trench box', 'Sheet piling or cofferdam', 'Engineered temporary works',
  ];
  // Safe batter angles in degrees from horizontal, dry and wet (ADOSH-SF CoP
  // 29.0 Table 1). Steeper sides need an engineer's design.
  const SAFE_SLOPES = {
    Boulders: { dry: 35, wet: 30 },
    Cobbles: { dry: 35, wet: 30 },
    Gravel: { dry: 30, wet: 10 },
    Sand: { dry: 30, wet: 10 },
    Silt: { dry: 20, wet: 5 },
    'Soft clay': { dry: 20, wet: 10 },
    'Firm clay': { dry: 30, wet: 20 },
    'Stiff clay': { dry: 40, wet: 25 },
  };

  // Work at height: a harness is in use (restraint or arrest), or the fall
  // protection is a combination that may include one.
  const needsHarness = (h) => /restraint|arrest|Several/i.test(h.detail('fallProtection'));
  const isFallArrest = (h) => /arrest|Several/i.test(h.detail('fallProtection'));

  // Methods that only act on a control circuit, which is not isolation.
  const CONTROL_DEVICE = /\b(stop button|push ?button|e-?stop|emergency stop|selector|interlock|plc|vfd|drive stop|control switch)\b/i;

  // True when any isolation point on the permit is electrical.
  function isElectrical(p) {
    return (p && Array.isArray(p.isolations) ? p.isolations : []).some((r) => r && /Electrical|Back-feed/.test(r.energy || ''));
  }

  // A precaution that becomes required only in some conditions, for example
  // flashback arrestors when gas cutting. The message uses the check's label.
  function requireCheckWhen(key, cond) {
    return (p, h) => (cond(p, h) && !h.check(key)) ? `Confirm: ${h.checkLabel(key)}.` : null;
  }

  const TYPES = [
    {
      key: 'lifting', label: 'Lifting', prefix: 'LP',
      summary: 'Crane and lifting operations; critical lifts need a passing load-chart assessment.',
      code: 'ADOSH-SF CoP 34.0 – Safe Use of Lifting Equipment and Lifting Accessories',
      workPlaceholder: 'Describe the lift(s) to be carried out',
      maxValidityHours: 12,
      topLevelChecks: true,
      checks: LIFTING_CHECKS,
      closeout: [
        { key: 'loadLanded', label: 'Load landed safely and rigging removed', required: true },
        { key: 'craneSecured', label: 'Crane stowed and secured, or released from the job', required: true },
        { key: 'zoneCleared', label: 'Exclusion zone removed and the area left safe', required: true },
        { key: 'defectsReported', label: 'Any defects, near misses or incidents reported' },
      ],
    },
    {
      key: 'hot_work', label: 'Hot work', prefix: 'HW', highRisk: true,
      summary: 'Welding, cutting, grinding, brazing, heating and other work that makes sparks or flame.',
      code: 'ADOSH-SF CoP 28.0 – Hot Work Operations',
      workPlaceholder: 'What is being welded, cut, ground or heated, and where',
      personInChargeLabel: 'Permit holder (in charge of the work)',
      maxValidityHours: 12,
      fields: [
        { key: 'hotWorkType', label: 'Type of hot work', kind: 'select', required: true,
          options: ['Electric arc welding', 'Gas (oxy-fuel) welding or cutting', 'Grinding or abrasive cutting', 'Plasma or thermal cutting', 'Heating or torch work', 'Brazing or soldering', 'Several of these', 'Other'] },
        { key: 'equipment', label: 'Equipment used, with ID numbers', kind: 'text', required: true, hint: 'For example welding set W-12, oxy-acetylene set, grinder' },
        { key: 'area', label: 'Work location', kind: 'select', required: true, options: HOT_WORK_AREAS },
        { key: 'onContainer', label: 'Work on a tank, drum, vessel or pipe that held flammable or unknown contents?', kind: 'select', required: true, options: YES_NO, full: true },
        { key: 'fireDetection', label: 'Fire detection and sprinklers', kind: 'select', required: true,
          options: ['Not affected', 'Detectors isolated with approval (restore at close-out)', 'Sprinklers impaired'] },
        { key: 'detectorZones', label: 'Detector zones isolated, and who was told', kind: 'text',
          hint: 'Needed when detectors are isolated. Tell the fire panel operator and anyone else affected (ADOSH-SF CoP 21.0 s3.8).' },
        { key: 'extinguishers', label: 'Fire extinguishers at the work point', kind: 'text', required: true, hint: 'Type, size and number, for example 2 × 6 kg dry powder' },
        { key: 'fireWatcher', label: 'Fire watcher', kind: 'text', required: true, group: 'People' },
        { key: 'workers', label: 'Welders, cutters and grinder operators', kind: 'list', required: true, group: 'People' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'combustiblesCleared', label: 'Combustibles removed from 10 m around the work, or covered and protected', required: true },
        { key: 'hiddenCombustibles', label: 'Walls, floors, ceilings and levels below checked for hidden combustibles', required: true },
        { key: 'openingsCovered', label: 'Openings, gaps and drains that sparks could reach covered, or none nearby', required: true },
        { key: 'dustCleared', label: 'Combustible dust and fibres cleaned up or wetted down, or none present', required: true },
        { key: 'extinguisherReady', label: 'Suitable fire extinguisher at the work point, ready for use', required: true },
        { key: 'fireWatchInPlace', label: 'Fire watcher briefed to stay during the work and at least 1 hour after', required: true },
        { key: 'alarmKnown', label: 'Fire watcher knows how to raise the alarm (call point, site emergency number)', required: true },
        { key: 'barricaded', label: 'Work area barricaded and signed', required: true },
        { key: 'ventilation', label: 'Ventilation or fume extraction adequate for the fumes produced', required: true },
        { key: 'equipmentInspected', label: 'Hot work equipment inspected today by a competent person', required: true },
        { key: 'escapeClear', label: 'Safe access and escape route kept clear', required: true },
        { key: 'ppe', label: 'PPE for the task worn: eye and face protection, FR gloves and clothing, boots', required: true },
        { key: 'arcScreens', label: 'Screens protect people nearby from arc flash' },
        { key: 'rcd', label: 'Mains- or generator-fed sets on an RCD-protected supply (not engine-driven sets)' },
        { key: 'leadsChecked', label: 'Welding leads, cables and return clamp undamaged and connected at the work' },
        { key: 'flashbackArrestors', label: 'Flashback arrestors fitted on gas sets; hoses and regulators checked' },
        { key: 'cylindersSecured', label: 'Gas cylinders upright and secured against falling' },
        { key: 'containerGasFreed', label: 'Tank, drum or pipe drained, cleaned and gas-freed' },
        { key: 'detectorsLogged', label: 'Isolated smoke or heat detectors approved and logged for restoring' },
        { key: 'coatings', label: 'Coatings (galvanised, painted, plated, stainless) removed, or extraction or RPE used' },
        { key: 'hotWasteBin', label: 'Container for hot waste and rod stubs close to the work' },
        { key: 'sds', label: 'Safety data sheets for rods, fluxes and coatings available' },
        { key: 'firstAider', label: 'First aider for burns and welding flash available' },
      ],
      gasTest: {
        required: false, beforeWhat: 'hot work starts',
        requiredWhen: (p, h) => HOT_WORK_GAS_AREAS.includes(h.detail('area')) || h.detail('onContainer') === 'Yes',
        hint: 'Needed in hazardous areas, inside confined spaces, near live plant, and in or on containers that held flammables (ADOSH-SF CoP 28.0 s3.4). Test oxygen and flammable gas before starting, again after any break, and wherever gas could collect.',
        failAdvice: 'Do not start hot work. Remove the source, ventilate and test again.',
        limits: [OXYGEN, FLAMMABLE],
      },
      rules: [
        (p, h) => h.detail('fireDetection') === 'Sprinklers impaired'
          ? 'Hot work cannot go ahead while sprinklers in the area are impaired.' : null,
        (p, h) => (h.detail('area') === 'Inside a confined space' && h.isBlank(p.otherPermits))
          ? 'Hot work inside a confined space also needs a confined space entry permit. Enter its number under "Other permits for this job".' : null,
        (p, h) => {
          const watcher = h.detail('fireWatcher');
          const workers = [].concat(h.detail('workers') || []);
          return workers.some((w) => sameName(w, watcher))
            ? 'The fire watcher cannot also be doing the hot work. Name someone else to watch for fire.' : null;
        },
        (p, h) => (/Detectors isolated/.test(h.detail('fireDetection')) && h.isBlank(h.detail('detectorZones')))
          ? 'Record which detector zones are isolated and who was told.' : null,
        requireCheckWhen('arcScreens', (p, h) => /arc|Plasma|Several/i.test(h.detail('hotWorkType'))),
        requireCheckWhen('rcd', (p, h) => /arc|Plasma|Several/i.test(h.detail('hotWorkType'))),
        requireCheckWhen('leadsChecked', (p, h) => /arc|Plasma|Several/i.test(h.detail('hotWorkType'))),
        requireCheckWhen('flashbackArrestors', (p, h) => /Gas|Several|torch/i.test(h.detail('hotWorkType'))),
        requireCheckWhen('cylindersSecured', (p, h) => /Gas|Several|torch/i.test(h.detail('hotWorkType'))),
        requireCheckWhen('containerGasFreed', (p, h) => h.detail('onContainer') === 'Yes'),
        requireCheckWhen('detectorsLogged', (p, h) => /Detectors isolated/.test(h.detail('fireDetection'))),
      ],
      closeoutFields: [
        { key: 'hotWorkEnded', label: 'Hot work finished at', kind: 'datetime', required: true },
        { key: 'fireWatchEnded', label: 'Fire watch ended at', kind: 'datetime', required: true, hint: 'At least 1 hour after the hot work finished' },
      ],
      closeoutRules: [
        (c) => {
          const end = Date.parse((c.fields || {}).hotWorkEnded || '');
          const watch = Date.parse((c.fields || {}).fireWatchEnded || '');
          if (Number.isNaN(end) || Number.isNaN(watch)) return null;
          if (watch - end < 60 * 60000) return 'The fire watch must continue for at least 1 hour after hot work finishes (ADOSH-SF CoP 28.0). Keep the permit open until then.';
          const at = Date.parse(c.at || '');
          if (!Number.isNaN(at) && watch > at + 60000) return 'The fire watch end time is in the future. Close the permit once the fire watch has ended.';
          return null;
        },
        (c, permit) => (/Detectors isolated/.test(detailValue(permit, 'fireDetection')) && !(c.checks || {}).detectorsRestored)
          ? 'Isolated fire detectors must be restored and confirmed with the fire panel before the permit is closed.' : null,
      ],
      closeout: [
        { key: 'areaChecked', label: 'Work area, level below and far side of walls checked: no smouldering', required: true },
        { key: 'equipmentSafe', label: 'Cylinder valves closed, hoses depressurised, welding sets switched off', required: true },
        { key: 'wasteCleared', label: 'Hot waste, slag and rod stubs cleared; site left clean and safe', required: true },
        { key: 'detectorsRestored', label: 'Any isolated smoke or heat detectors restored and confirmed' },
        { key: 'fireEquipmentBack', label: 'Fire-fighting equipment brought for the job returned' },
      ],
    },
    {
      key: 'confined_space', label: 'Confined space entry', prefix: 'CSE', highRisk: true,
      summary: 'Entry into tanks, vessels, pits, manholes, sewers, silos, ducts and other enclosed spaces.',
      code: 'ADOSH-SF CoP 27.0 – Confined Spaces',
      workPlaceholder: 'Why people need to go in, and the work inside',
      personInChargeLabel: 'Entry supervisor (permit holder)',
      maxValidityHours: 12,
      fields: [
        { key: 'spaceId', label: 'Confined space name or tag', kind: 'text', required: true },
        { key: 'spaceType', label: 'Type of space', kind: 'select', required: true,
          options: ['Tank', 'Vessel', 'Pipe or duct', 'Sewer', 'Silo, bin or hopper', 'Vault', 'Pit or sump', 'Excavation or trench', 'Manhole or chamber', 'Other'] },
        { key: 'entryType', label: 'Entry', kind: 'select', required: true, options: ['Horizontal (side) entry', 'Vertical (top or bottom) entry'] },
        { key: 'contentsType', label: 'What the space held or could contain', kind: 'select', required: true, options: CSE_CONTENTS },
        { key: 'previousContents', label: 'Previous contents or residues, in detail', kind: 'textarea', required: true },
        { key: 'temperature', label: 'Temperature inside the space', unit: '°C', kind: 'number', required: true },
        { key: 'hazards', label: 'Specified risks identified', kind: 'textarea', required: true, hint: 'Fire or explosion, heat, toxic gas or fumes, low or high oxygen, drowning, engulfment, entrapment' },
        { key: 'isolations', label: 'Isolations (lines, electrical, mechanical)', kind: 'textarea', required: true, hint: 'List each isolation and its certificate number, or write "None required" and why' },
        { key: 'ventilation', label: 'Ventilation', kind: 'select', required: true, options: ['Natural', 'Forced supply (blower)', 'Forced extraction', 'Supply and extraction'] },
        { key: 'monitoring', label: 'Gas monitoring during entry', kind: 'select', required: true,
          options: ['Continuous, worn by entrants or at the work point', 'Re-tested at the interval set by the issuer'] },
        { key: 'ppe', label: 'PPE and breathing equipment required', kind: 'textarea', required: true },
        { key: 'hotWorkInside', label: 'Hot work inside the space?', kind: 'select', required: true, options: YES_NO },
        { key: 'maxTimeInside', label: 'Maximum time inside at one go', unit: 'minutes', kind: 'number', min: 0 },
        { key: 'otherGas', label: 'Other gases tested for, with their limits and latest readings', kind: 'textarea',
          hint: 'For example VOCs or benzene for fuels and solvents, CO₂ for sewage or inerted spaces. The flammable (LEL) limit is a fire limit, not a safe breathing limit.' },
        { key: 'entrants', label: 'Authorised entrants', kind: 'list', required: true, group: 'People' },
        { key: 'attendant', label: 'Standby person (attendant) outside the entry', kind: 'text', required: true, group: 'People' },
        { key: 'comms', label: 'Communication with entrants', kind: 'select', required: true, group: 'People',
          options: ['Direct voice and sight', 'Intrinsically safe radio', 'Hard-wired intercom', 'Other'] },
        { key: 'rescuePlan', label: 'Rescue plan: team, how they are called, phone numbers', kind: 'textarea', required: true, group: 'Rescue' },
        { key: 'rescueEquipment', label: 'Rescue and resuscitation equipment at the entry', kind: 'text', required: true, group: 'Rescue',
          hint: 'For example tripod and winch, harness and lifeline, breathing apparatus, stretcher, resuscitator' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'riskAssessed', label: 'Risk assessment done for this entry, including previous contents', required: true },
        { key: 'signed', label: 'Entry point barricaded and signed against unauthorised entry', required: true },
        { key: 'isolationsVerified', label: 'All isolations verified, or none needed', required: true },
        { key: 'cleaned', label: 'Space drained, cleaned or purged as planned' },
        { key: 'ventilated', label: 'Ventilation adequate and running', required: true },
        { key: 'blowerIntake', label: 'Blower intake in clean air, away from engine and generator exhaust' },
        { key: 'detectorChecked', label: 'Gas detector calibrated, bump tested, alarms set no higher than the limits', required: true },
        { key: 'continuousMonitor', label: 'Continuous gas monitor at the work point or worn by entrants' },
        { key: 'standby', label: 'Standby person at the entry for the whole entry and does not enter', required: true },
        { key: 'noRescueEntry', label: 'Standby and others told never to enter to rescue; only the rescue team with BA', required: true },
        { key: 'stopTriggers', label: 'Entrants told to leave at once on any alarm, bad reading, lost contact or ventilation stop', required: true },
        { key: 'entryLog', label: 'Entry log at the entry point records everyone in and out', required: true },
        { key: 'commsTested', label: 'Communication with entrants agreed and tested before entry', required: true },
        { key: 'rescueReady', label: 'Rescue plan agreed; rescue team can respond in time', required: true },
        { key: 'rescueEquipmentReady', label: 'Rescue and resuscitation equipment ready at the entry', required: true },
        { key: 'accessEgress', label: 'Safe access and exit: ladder secured, opening clear', required: true },
        { key: 'fireEquipment', label: 'Fire-fighting equipment placed at the work area', required: true },
        { key: 'competent', label: 'Entrants and standby trained and competent for confined spaces', required: true },
        { key: 'fit', label: 'Entrants medically fit for the work, breathing equipment and heat', required: true },
        { key: 'ppeIssued', label: 'PPE and breathing equipment issued as assessed, escape sets if needed', required: true },
        { key: 'lightingTools', label: 'Lighting and tools suitable for the space (low voltage, Ex rated)' },
        { key: 'noCylinders', label: 'No gas cylinders or fuel engines inside unless assessed' },
        { key: 'heatStress', label: 'Heat stress controls set: work and rest times, water, cooling' },
      ],
      gasTest: {
        required: true, beforeWhat: 'anyone enters',
        hint: 'Test from outside the space in this order: oxygen, flammable gas, then toxic gases. Test at the top, middle and bottom, before entry and after any break. The H₂S and CO figures are 8-hour exposure limits (ADOSH-SF Occupational Standards, Schedule A): a longer shift may need lower site limits, and any toxic gas found at all calls for continuous monitoring.',
        failAdvice: 'Do not enter. Ventilate the space and test again.',
        limits: [OXYGEN, FLAMMABLE, H2S, CO],
      },
      rules: [
        (p, h) => (h.detail('hotWorkInside') === 'Yes' && h.isBlank(p.otherPermits))
          ? 'Hot work inside the space needs its own hot work permit. Enter its number under "Other permits for this job".' : null,
        (p, h) => ([].concat(h.detail('entrants') || []).some((e) => sameName(e, h.detail('attendant'))))
          ? 'The standby person cannot also be an entrant. Name someone who stays outside.' : null,
        (p, h) => (h.detail('contentsType') !== CSE_CONTENTS[0] && h.isBlank(h.detail('otherGas')))
          ? 'Given what the space held, list the other gases tested for (for example VOCs, benzene or CO₂), with their limits and readings.' : null,
        (p) => {
          // Low oxygen means another gas has displaced air; at 19.5 % about a
          // third of the air is something else. Practice trigger, not ADOSH text.
          const low = latestGasRound(p).some((t) => { const v = num(t.o2); return !Number.isNaN(v) && v < 20.5; });
          return (low && isBlank(detailValue(p, 'otherGas')))
            ? 'Oxygen is below 20.5 %, so another gas has displaced some of the air. Find out which gas and record it and its reading under "Other gases tested for".' : null;
        },
        requireCheckWhen('blowerIntake', (p, h) => /Forced|Supply and/.test(h.detail('ventilation'))),
        requireCheckWhen('heatStress', (p, h) => h.num(h.detail('temperature')) >= HEAT_TRIGGER_C),
        (p, h) => (h.num(h.detail('temperature')) >= HEAT_TRIGGER_C && h.isBlank(h.detail('maxTimeInside')))
          ? `The space is ${HEAT_TRIGGER_C} °C or hotter. Set the maximum time inside at one go (ADOSH-SF CoP 27.0: limit the time exposed).` : null,
      ],
      closeout: [
        { key: 'allOut', label: 'All entrants out; head count matches the entry log', required: true },
        { key: 'toolsOut', label: 'Tools, equipment, materials and waste removed from the space', required: true },
        { key: 'secured', label: 'Space closed, or barricaded and signed against entry', required: true },
        { key: 'hotWorkClosed', label: 'Any hot work inside finished, fire watch done, its permit closed' },
        { key: 'equipmentSecure', label: 'Equipment made safe and fire-fighting equipment returned' },
        { key: 'isolationsAfterHandBack', label: 'Isolations removed only after hand-back, under their certificate' },
        { key: 'recordsKept', label: 'Entry log and gas test records filed with the permit' },
      ],
    },
    {
      key: 'work_at_height', label: 'Work at height', prefix: 'WAH', highRisk: true,
      summary: 'Work where someone could fall: roofs, scaffolds, ladders, platforms, MEWPs, open edges.',
      code: 'ADOSH-SF CoP 23.0 – Working at Heights',
      workPlaceholder: 'The work, where it is, and how people will reach it',
      personInChargeLabel: 'Permit holder (in charge of the work)',
      maxValidityHours: 12,
      fields: [
        { key: 'height', label: 'Maximum possible fall to the next level below', unit: 'm', kind: 'number', required: true, min: 0 },
        { key: 'access', label: 'Access or working platform', kind: 'select', required: true, options: HEIGHT_ACCESS },
        { key: 'fallProtection', label: 'Fall protection', kind: 'select', required: true, options: FALL_PROTECTION },
        { key: 'whyNotCollective', label: 'Why guardrails or nets are not reasonably practicable', kind: 'text',
          hint: 'Needed for falls of 2 m or more without guardrails or nets. Preventing a fall comes before arresting one (ADOSH-SF CoP 23.0 s3.2).' },
        { key: 'openEdges', label: 'Open edges, or floor or roof openings, at the work area?', kind: 'select', required: true, options: YES_NO },
        { key: 'fragile', label: 'Work on or near a fragile roof or roof lights?', kind: 'select', required: true, options: YES_NO },
        { key: 'anchors', label: 'Anchor points or lifelines, with certificate reference', kind: 'text',
          hint: 'Needed for restraint or fall arrest. Rated for 2,450 kg per person attached.' },
        { key: 'clearanceAvailable', label: 'Clear distance below the working level', unit: 'm', kind: 'number', min: 0, hint: 'Needed for fall arrest' },
        { key: 'clearanceNeeded', label: 'Clearance the lanyard or SRL needs (manufacturer)', unit: 'm', kind: 'number', min: 0,
          hint: 'Needed for fall arrest. A 2 m energy-absorbing lanyard often needs 5–6 m; use restraint or an SRL when it is lower.' },
        { key: 'platformTag', label: 'Scaffold or tower tag number and last inspection date', kind: 'text', hint: 'Needed for scaffolds and towers. Inspected within the last 7 days.' },
        { key: 'mewp', label: 'MEWP ID, certificate expiry and operator card', kind: 'text', hint: 'Needed when a MEWP is used' },
        { key: 'exclusionZone', label: 'Exclusion zone below the work', kind: 'text', required: true, hint: 'Size of the zone and how it is barricaded' },
        { key: 'windLimit', label: 'Wind limit for this task', unit: 'm/s', kind: 'number', min: 0,
          hint: 'Site limit, or the MEWP, cradle or rope access limit if lower. Needed for MEWPs, cradles and rope access.' },
        { key: 'windReading', label: 'Wind speed at the start, at or near working height', unit: 'm/s', kind: 'number', min: 0 },
        { key: 'temperature', label: 'Forecast maximum temperature', unit: '°C', kind: 'number', required: true },
        { key: 'nearbyHazards', label: 'Nearby hazards (power lines, moving plant, traffic, work above or below)', kind: 'textarea' },
        { key: 'workers', label: 'People working at height, with training reference', kind: 'list', required: true, group: 'People' },
        { key: 'rescuePlan', label: 'Rescue plan and rescue equipment at the work area', kind: 'textarea', required: true, group: 'Rescue',
          hint: 'How a person hanging in a harness is reached quickly, by whom, with what' },
        { key: 'rescuers', label: 'Named rescuers', kind: 'list', group: 'Rescue', hint: 'Needed when fall arrest is used' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'noAlternative', label: 'Work cannot reasonably be done without working at height', required: true },
        { key: 'edgeGuardrails', label: 'Guardrails (950 mm, mid-rail, 150 mm toe board) at open edges' },
        { key: 'openingsProtected', label: 'Floor and roof openings covered, secured and marked, or guarded' },
        { key: 'platformInspected', label: 'Scaffold inspected in the last 7 days and since any change or storm; tag shown' },
        { key: 'towerSafe', label: 'Tower no taller than 3 × its base, castors locked, nobody on it when moved' },
        { key: 'mewpChecked', label: 'MEWP certified, pre-use checked and run by a trained operator' },
        { key: 'mewpGround', label: 'Trained person at ground level who can use the ground controls' },
        { key: 'boomHarness', label: 'Boom lift: harness with short restraint lanyard clipped to the basket anchor' },
        { key: 'independentLine', label: 'Cradle or rope access: independent safety line per person on its own anchor' },
        { key: 'harnessChecked', label: 'Harness, lanyards, connectors and SRLs pre-use checked and in test date' },
        { key: 'anchorsCertified', label: 'Anchor points certified for fall arrest (2,450 kg per person)' },
        { key: 'twinLanyard', label: 'Twin lanyard used so workers stay attached when moving' },
        { key: 'exclusionZoneSet', label: 'Exclusion zone below barricaded and signed; hard hats inside it', required: true },
        { key: 'toolsTethered', label: 'Tools and materials secured against falling (tethers, bags, toe boards, nets)', required: true },
        { key: 'rescueReady', label: 'Rescue plan in place and rescue equipment at the work area', required: true },
        { key: 'competent', label: 'Workers trained and competent for the task and equipment', required: true },
        { key: 'weatherChecked', label: 'Weather and wind checked and within the limits for the task', required: true },
        { key: 'overhead', label: 'Overhead power lines and nearby moving plant controlled' },
        { key: 'ladderUse', label: 'Ladder inspected and tagged, at 70–80°, tied, 1 m above the landing' },
        { key: 'stepladder', label: 'Stepladder working height 1.8 m or less' },
        { key: 'fragileRoof', label: 'Fragile roof: guarded walkways, roof lights barricaded or boarded, signs up' },
        { key: 'lighting', label: 'Adequate lighting at the work area and access routes' },
        { key: 'heatStress', label: 'Heat stress controls in place: water, rest, shade, summer midday break' },
      ],
      rules: [
        requireCheckWhen('edgeGuardrails', (p, h) => h.num(h.detail('height')) >= 2 && /Guardrails/.test(h.detail('fallProtection'))),
        (p, h) => (h.num(h.detail('height')) >= 2 && !/Guardrails|nets/i.test(h.detail('fallProtection')) && h.isBlank(h.detail('whyNotCollective')))
          ? 'For a fall of 2 m or more, use guardrails or nets, or record why they are not reasonably practicable (ADOSH-SF CoP 23.0).' : null,
        requireCheckWhen('openingsProtected', (p, h) => h.detail('openEdges') === 'Yes'),
        requireCheckWhen('platformInspected', (p, h) => /scaffold/i.test(h.detail('access'))),
        requireCheckWhen('towerSafe', (p, h) => /tower/i.test(h.detail('access'))),
        requireCheckWhen('mewpChecked', (p, h) => /MEWP/.test(h.detail('access'))),
        requireCheckWhen('mewpGround', (p, h) => /MEWP/.test(h.detail('access'))),
        requireCheckWhen('boomHarness', (p, h) => /boom/i.test(h.detail('access'))),
        requireCheckWhen('independentLine', (p, h) => /Suspended|Rope access/.test(h.detail('access'))),
        requireCheckWhen('ladderUse', (p, h) => /Ladder/.test(h.detail('access'))),
        requireCheckWhen('harnessChecked', (p, h) => needsHarness(h)),
        requireCheckWhen('anchorsCertified', (p, h) => needsHarness(h)),
        requireCheckWhen('fragileRoof', (p, h) => h.detail('fragile') === 'Yes'),
        requireCheckWhen('heatStress', (p, h) => h.num(h.detail('temperature')) >= HEAT_OUTDOOR_C),
        (p, h) => (needsHarness(h) && h.isBlank(h.detail('anchors')))
          ? 'Record the anchor points used for restraint or fall arrest.' : null,
        (p, h) => (isFallArrest(h) && h.isBlank(h.detail('rescuers')))
          ? 'Name the rescuers when fall arrest is used.' : null,
        (p, h) => {
          if (!isFallArrest(h)) return null;
          const have = h.num(h.detail('clearanceAvailable'));
          const need = h.num(h.detail('clearanceNeeded'));
          if (Number.isNaN(have) || Number.isNaN(need)) return 'Record the clear distance below and the clearance the fall arrest system needs.';
          return have < need
            ? `Only ${have} m is clear below, but the fall arrest system needs ${need} m. The worker would hit the ground or structure first. Use restraint or an SRL instead.` : null;
        },
        (p, h) => (/scaffold|tower/i.test(h.detail('access')) && h.isBlank(h.detail('platformTag')))
          ? 'Record the scaffold or tower tag number and last inspection date.' : null,
        (p, h) => (/MEWP/.test(h.detail('access')) && h.isBlank(h.detail('mewp')))
          ? 'Record the MEWP ID, certificate and operator card.' : null,
        (p, h) => (/Ladder/.test(h.detail('access')) && h.num(h.detail('height')) > 2 && !needsHarness(h))
          ? 'Above 2 m, people on a ladder need a harness and safety line (ADOSH-SF CoP 37.0). Choose restraint or fall arrest.' : null,
        (p, h) => (/MEWP|Suspended|Rope access/.test(h.detail('access')) && (h.isBlank(h.detail('windLimit')) || h.isBlank(h.detail('windReading'))))
          ? 'Record the wind limit and the wind speed at working height for MEWPs, cradles and rope access.' : null,
        (p, h) => {
          const limit = h.num(h.detail('windLimit'));
          const now = h.num(h.detail('windReading'));
          return (!Number.isNaN(limit) && !Number.isNaN(now) && now > limit)
            ? `Wind speed ${now} m/s is above the ${limit} m/s limit for this task. Do not start.` : null;
        },
      ],
      closeout: [
        { key: 'peopleDown', label: 'All people down from height and accounted for', required: true },
        { key: 'materialsRemoved', label: 'Tools, materials and debris removed from height', required: true },
        { key: 'edgesReinstated', label: 'Edge protection and opening covers left in place or refitted', required: true },
        { key: 'platformTagged', label: 'Scaffold or platform tag updated, or handed over or dismantled' },
        { key: 'mewpStowed', label: 'MEWP lowered, stowed, isolated and keys removed' },
        { key: 'harnessesChecked', label: 'Any harness or SRL that arrested a fall taken out of use until examined' },
        { key: 'zoneRemoved', label: 'Exclusion zone removed only after the area above is clear' },
        { key: 'incidentsReported', label: 'Any fall, arrested fall or dropped object reported' },
      ],
    },
    {
      key: 'excavation', label: 'Excavation', prefix: 'EXC', highRisk: true,
      summary: 'Digging, trenching, boring, piling and any ground break that could hit buried services.',
      code: 'ADOSH-SF CoP 29.0 – Excavation Work',
      workPlaceholder: 'Where and why the ground is being opened',
      personInChargeLabel: 'Excavation supervisor (permit holder)',
      maxValidityHours: 12,
      fields: [
        { key: 'method', label: 'Excavation method', kind: 'select', required: true,
          options: ['Hand digging', 'Mechanical excavator', 'Vacuum excavation', 'Boring or directional drilling', 'Piling, posts or earth rods', 'Several of these', 'Other'] },
        { key: 'depth', label: 'Maximum depth', unit: 'm', kind: 'number', required: true, min: 0 },
        { key: 'dimensions', label: 'Length × width, or route', kind: 'text' },
        { key: 'groundType', label: 'Ground type', kind: 'select', required: true, options: Object.keys(SAFE_SLOPES).concat(['Rock', 'Fill or made ground', 'Unknown']) },
        { key: 'groundCondition', label: 'Ground condition', kind: 'select', required: true, options: ['Dry', 'Wet (water table, groundwater or rain)'] },
        { key: 'support', label: 'Side support', kind: 'select', required: true, options: SUPPORT_METHODS },
        { key: 'batterAngle', label: 'Batter angle from horizontal', unit: 'degrees', kind: 'number', min: 0, hint: 'Needed when the sides are battered or sloped' },
        { key: 'tempWorks', label: 'Support design or rock assessment reference, and who made it', kind: 'text',
          hint: 'An engineer\'s design allows steeper sides; a competent person\'s written assessment is needed for unsupported rock' },
        { key: 'setBack', label: 'Spoil and plant kept back from the edge', unit: 'm', kind: 'number', required: true, min: 0, hint: 'At least 0.6 m, or more if the competent person says so' },
        { key: 'nocs', label: 'Utility and authority NOC numbers, with expiry dates', kind: 'list', required: true },
        { key: 'drawings', label: 'Utility and as-built drawings reviewed', kind: 'text', required: true },
        { key: 'locator', label: 'Cable locator serial, calibration due date and operator', kind: 'text', required: true },
        { key: 'servicesFound', label: 'Services found: type, depth, how marked, trial hole', kind: 'list', required: true, hint: 'Write "None found" if the search found none' },
        { key: 'gasSource', label: 'Possible gas source (sewer, fuel or gas line, landfill, engines or pumps in or near the dig)?', kind: 'select', required: true, options: YES_NO, full: true },
        { key: 'confinedSpace', label: 'Could the excavation be a confined space (gases, depth, hard to get out)?', kind: 'select', required: true, options: YES_NO, full: true },
        { key: 'overheadLines', label: 'Overhead power lines within reach of the plant?', kind: 'select', required: true, options: YES_NO },
        { key: 'access', label: 'Ladders, ramps or steps for getting in and out', kind: 'text' },
        { key: 'roadApproval', label: 'Traffic Police approval for road works', kind: 'text' },
        { key: 'temperature', label: 'Forecast maximum temperature', unit: '°C', kind: 'number', required: true },
        { key: 'lastInspection', label: 'Last competent-person inspection', kind: 'datetime', required: true, hint: 'Before this shift' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'nocs', label: 'Utility and authority NOCs obtained and valid for this dig area', required: true },
        { key: 'drawingsReviewed', label: 'Utility drawings and as-built plans reviewed for the dig area', required: true },
        { key: 'scanned', label: 'Area scanned with a calibrated cable locator by a trained person', required: true },
        { key: 'marked', label: 'Located services marked on the ground, or the search found none', required: true },
        { key: 'trialHoles', label: 'Trial holes hand dug to confirm services, or the search found none', required: true },
        { key: 'noMachineNearServices', label: 'Within 0.5 m of services: GRP shovels and spades or vacuum dig only, no picks', required: true },
        { key: 'banksman', label: 'Banksman for machine digging within 3 m of known services' },
        { key: 'plantSeparation', label: 'Nobody in the trench or slew radius while the bucket works; banksman or zone' },
        { key: 'overheadControls', label: 'Goalposts and height limiters under overhead lines, or written isolation' },
        { key: 'sidesSupported', label: 'Sides supported, battered or benched where over 1.2 m or unstable', required: true },
        { key: 'spoilBack', label: 'Spoil, materials and plant kept back from the edge as recorded', required: true },
        { key: 'edgeBarriers', label: 'Rigid 950 mm barriers where a fall is over 2 m; edges marked below that', required: true },
        { key: 'safeAccess', label: 'Safe way in and out where people enter; ladders tied, 1 m above ground', required: true },
        { key: 'wheelStops', label: 'Wheel stops set where plant works near the edge' },
        { key: 'warningLights', label: 'Warning lights on edges for darkness and public areas' },
        { key: 'structures', label: 'Nearby structures, walls and footings checked for stability' },
        { key: 'water', label: 'Groundwater and surface water controlled; discharge planned' },
        { key: 'servicesProtected', label: 'Exposed services supported and protected' },
        { key: 'inspected', label: 'Excavation inspected by a competent person before this shift', required: true },
        { key: 'emergency', label: 'Emergency plan covers collapse, flooding and service strike; numbers posted', required: true },
        { key: 'traffic', label: 'Traffic management and Traffic Police approval for road works' },
        { key: 'heatStress', label: 'Heat stress controls in place: water, rest, shade, summer midday break' },
      ],
      gasTest: {
        required: false, beforeWhat: 'anyone enters the excavation',
        requiredWhen: (p, h) => h.detail('confinedSpace') === 'Yes' || (h.detail('gasSource') === 'Yes' && h.num(h.detail('depth')) > 1.2),
        hint: 'Needed where the excavation could be a confined space, or is over 1.2 m deep near a gas source. Test oxygen first, then flammable gas, then toxic gases, and keep testing during the shift (ADOSH-SF CoP 29.0 s3.10).',
        failAdvice: 'Do not enter the excavation. Ventilate and test again.',
        limits: [OXYGEN, FLAMMABLE, H2S, CO],
      },
      rules: [
        (p, h) => {
          const support = h.detail('support');
          if (!(h.num(h.detail('depth')) > 1.2)) return null;
          if (/^None needed/.test(support)) return 'Excavations deeper than 1.2 m need support, battering or benching (ADOSH-SF CoP 29.0).';
          if (/^None – stable rock/.test(support) && (h.detail('groundType') !== 'Rock' || h.isBlank(h.detail('tempWorks')))) {
            return 'Unsupported sides deeper than 1.2 m are only allowed in stable rock, with a competent person\'s written assessment recorded.';
          }
          return null;
        },
        (p, h) => {
          if (!/Battered|Benched/.test(h.detail('support'))) return null;
          const angle = h.num(h.detail('batterAngle'));
          if (Number.isNaN(angle)) return 'Record the batter angle.';
          if (!h.isBlank(h.detail('tempWorks'))) return null;
          const ground = h.detail('groundType');
          const wet = /^Wet/.test(h.detail('groundCondition'));
          // Fill, unknown ground and rock have no Table 1 value: use the
          // flattest one (wet silt) unless a design is recorded.
          const slope = SAFE_SLOPES[ground] || SAFE_SLOPES.Silt;
          const max = SAFE_SLOPES[ground] ? (wet ? slope.wet : slope.dry) : slope.wet;
          const what = SAFE_SLOPES[ground] ? `${ground.toLowerCase()} in ${wet ? 'wet' : 'dry'} ground` : `${ground.toLowerCase()} (no Table 1 value, so the flattest is used)`;
          return angle > max
            ? `A ${angle}° batter is steeper than the ${max}° safe slope for ${what} (ADOSH-SF CoP 29.0 Table 1). Flatten it, or record the engineer's design.` : null;
        },
        (p, h) => (h.detail('confinedSpace') === 'Yes' && h.isBlank(p.otherPermits))
          ? 'An excavation that could be a confined space also needs a confined space entry permit. Enter its number under "Other permits for this job".' : null,
        (p, h) => {
          const v = h.num(h.detail('setBack'));
          return (!Number.isNaN(v) && v < 0.6) ? 'Keep spoil and plant at least 0.6 m back from the edge.' : null;
        },
        requireCheckWhen('banksman', (p, h) => /Mechanical|Several/.test(h.detail('method'))
          && !(h.detail('servicesFound') || []).every((x) => /^none found/i.test(String(x).trim()))),
        requireCheckWhen('plantSeparation', (p, h) => /Mechanical|Piling|Boring|Several/.test(h.detail('method'))),
        requireCheckWhen('overheadControls', (p, h) => h.detail('overheadLines') === 'Yes'),
        requireCheckWhen('traffic', (p, h) => !h.isBlank(h.detail('roadApproval'))),
        requireCheckWhen('heatStress', (p, h) => h.num(h.detail('temperature')) >= HEAT_OUTDOOR_C),
      ],
      closeout: [
        { key: 'allOut', label: 'People, plant and tools out of the excavation', required: true },
        { key: 'backfilled', label: 'Backfilled and compacted, or barricaded, signed and lit if left open', required: true },
        { key: 'damageReported', label: 'Any damage to services, coatings or tapes reported to the owner', required: true },
        { key: 'siteSecured', label: 'Site secured against unauthorised entry', required: true },
        { key: 'warningTape', label: 'Warning tape laid over services during backfill' },
        { key: 'shoringRemoved', label: 'Shoring removed by competent people as backfill went in' },
        { key: 'dewatering', label: 'Dewatering kept running or safely stopped; discharge as approved (CoP 54.0)' },
        { key: 'recorded', label: 'Location and depth of exposed services recorded for as-built drawings' },
      ],
    },
    {
      key: 'energy_isolation', label: 'Energy isolation (LOTO)', prefix: 'ISO', highRisk: true,
      summary: 'Lock-out, tag-out of electrical, mechanical, hydraulic, pneumatic, chemical or thermal energy.',
      code: 'ADOSH-SF CoP 24.0 – Lock-out – Tag out (Isolation)',
      workPlaceholder: 'The equipment and the work that needs it isolated',
      personInChargeLabel: 'Permit holder (in charge of the work)',
      maxValidityHours: 12,
      isolations: true,
      isolationHint: 'List every energy source, including stored energy and back-feeds. Isolate at an isolating device (breaker, isolator, valve, blind), not a stop button, selector, interlock or drive. Each point needs its own lock and tag, and zero energy must be proven before work starts. Isolations can stay in place across shifts under the isolation register; this permit is revalidated or reissued each shift and the incoming permit holder re-checks them.',
      energyTypes: ['Electrical', 'Stored electrical (capacitors, batteries, UPS)', 'Back-feed (generator, solar, VFD)', 'Mechanical', 'Gravity or springs', 'Hydraulic', 'Pneumatic', 'Chemical / process', 'Thermal'],
      fields: [
        { key: 'equipment', label: 'Equipment or circuit, with tag number', kind: 'text', required: true, hint: 'As shown on the single-line diagram, P&ID or equipment register' },
        { key: 'procedure', label: 'Isolation procedure or LOTO sheet reference', kind: 'text', hint: 'The written, equipment-specific sequence for isolating and restoring' },
        { key: 'certificate', label: 'Isolation certificate or register number', kind: 'text', hint: 'Cross-referenced to the permits that rely on this isolation (ADOSH-SF CoP 21.0 s3.12)' },
        { key: 'lockMethod', label: 'How workers lock on', kind: 'select', required: true,
          options: ['Each worker locks every isolation point', 'Group lock box (each worker locks the box)'] },
        { key: 'voltage', label: 'System voltage', unit: 'V', kind: 'number', min: 0, hint: 'Needed for electrical isolation' },
        { key: 'tester', label: 'Voltage tester ID and calibration due date', kind: 'text', hint: 'Needed for electrical isolation; rated for the system voltage' },
        { key: 'zeroEnergyMethod', label: 'How zero energy was proven (test points and results)', kind: 'textarea', required: true,
          hint: 'For example no voltage between all conductors and to earth (L-L, L-N, L-E, N-E), try-start from the local control then back to off, vent open with no flow' },
        { key: 'hazardousArea', label: 'In a hazardous (classified) area?', kind: 'select', required: true, options: YES_NO },
        { key: 'liveWork', label: 'Live work or live testing needed?', kind: 'select', required: true, options: YES_NO },
        { key: 'isolatingAuthority', label: 'Isolating authority', kind: 'text', required: true, group: 'People', hint: 'The person authorised to apply and remove the isolations' },
        { key: 'electrician', label: 'Authorised electrical person, with licence number', kind: 'text', group: 'People', hint: 'Needed for electrical isolation (ADOSH-SF CoP 15.0)' },
        { key: 'workers', label: 'Workers covered by these isolations, with personal lock numbers', kind: 'list', required: true, group: 'People' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'sourcesIdentified', label: 'All energy sources identified from current drawings and on site', required: true },
        { key: 'affectedNotified', label: 'Operators and others affected told before shutdown', required: true },
        { key: 'shutDown', label: 'Equipment shut down in the normal way before isolating', required: true },
        { key: 'isolatingDevice', label: 'Every source isolated at an isolating device, not a control switch', required: true },
        { key: 'lockedTagged', label: 'Every lockable isolation point locked and tagged with name, date and reason', required: true },
        { key: 'tagOnly', label: 'Points that cannot be locked have an extra measure (fuse out, breaker racked out)' },
        { key: 'storedReleased', label: 'Stored energy released: pressure bled, capacitors discharged, moving parts blocked', required: true },
        { key: 'zeroEnergy', label: 'Zero energy proven at the point of work, then controls put back to off', required: true },
        { key: 'personalLocks', label: 'Every worker has fitted a personal lock (to each point or the group box)', required: true },
        { key: 'issuerChecked', label: 'Permit issuer checked the isolations on site before signing', required: true },
        { key: 'keysControlled', label: 'Keys kept by the lock owners or in the lock box' },
        { key: 'backfeed', label: 'Back-feeds isolated: UPS, generators, solar, batteries, drives' },
        { key: 'testerChecked', label: 'Voltage tester proven on a known live source before and after the test' },
        { key: 'electricalPpe', label: 'Insulated tools and PPE suitable for the voltage and arc risk' },
        { key: 'earths', label: 'Earths applied where required (high voltage, induced voltage or back-feed)' },
        { key: 'liveScreened', label: 'Nearby live parts screened, covered or barriered' },
        { key: 'processIsolation', label: 'Process lines positively isolated (blind, spade, or double block and bleed)' },
        { key: 'reaccumulation', label: 'Checked that energy cannot build up again (re-test during long jobs)' },
      ],
      gasTest: {
        required: false, beforeWhat: 'enclosures are opened',
        requiredWhen: (p, h) => h.detail('hazardousArea') === 'Yes',
        hint: 'Needed in hazardous areas before enclosures are opened or test equipment that is not Ex-rated is used.',
        failAdvice: 'Do not open enclosures or use non-Ex equipment. Find the source and test again.',
        limits: [FLAMMABLE],
      },
      rules: [
        (p) => {
          const bad = (p.isolations || []).filter((r) => r && CONTROL_DEVICE.test(`${r.point || ''} ${r.method || ''}`));
          return bad.length
            ? `Stop buttons, selectors, interlocks, PLCs and drives are control devices, not isolating devices (${bad.map((r) => String(r.point || '').slice(0, 30)).join(', ')}). Isolate at the breaker, isolator or valve.` : null;
        },
        (p, h) => h.detail('liveWork') === 'Yes'
          ? 'This permit does not cover live work or live testing. That needs separate written authorisation from a competent authority, endorsed by senior management (ADOSH-SF CoP 15.0 s3.9).' : null,
        (p, h) => (isElectrical(p) && h.isBlank(h.detail('electrician')))
          ? 'Name the authorised electrical person, with licence number.' : null,
        (p, h) => (isElectrical(p) && h.isBlank(h.detail('voltage')))
          ? 'Record the system voltage.' : null,
        (p, h) => (isElectrical(p) && h.isBlank(h.detail('tester')))
          ? 'Record the voltage tester ID and calibration due date.' : null,
        requireCheckWhen('testerChecked', (p) => isElectrical(p)),
        requireCheckWhen('electricalPpe', (p) => isElectrical(p)),
        requireCheckWhen('backfeed', (p) => (p.isolations || []).some((r) => r && /Back-feed|Stored electrical/.test(r.energy || ''))),
        requireCheckWhen('processIsolation', (p) => (p.isolations || []).some((r) => r && /Chemical|Hydraulic|Pneumatic|Thermal/.test(r.energy || ''))),
      ],
      closeoutFields: [
        { key: 'returnedAt', label: 'Returned to service at', kind: 'datetime' },
      ],
      closeout: [
        { key: 'workDone', label: 'Work finished; tools, test leads, temporary earths removed; guards refitted', required: true },
        { key: 'peopleClear', label: 'Everyone clear of the equipment and told it will be re-energised', required: true },
        { key: 'locksRemoved', label: 'Each lock removed by the person who fitted it (absent owner: written procedure)', required: true },
        { key: 'deisolationRecorded', label: 'Each de-isolation recorded with name and time', required: true },
        { key: 'returned', label: 'Equipment restored in sequence, tested and handed back to operations', required: true },
        { key: 'linkedClosed', label: 'Linked permits updated and the isolation register cleared' },
      ],
    },
    {
      key: 'general', label: 'General work', prefix: 'GW',
      summary: 'Maintenance, repair, testing and other work with no ignition source that still needs control.',
      code: 'ADOSH-SF CoP 21.0 – Permit to Work Systems',
      workPlaceholder: 'The work to be done and where',
      personInChargeLabel: 'Permit holder (in charge of the work)',
      maxValidityHours: 12,
      fields: [
        { key: 'category', label: 'Work category', kind: 'select', required: true,
          options: ['Mechanical maintenance', 'Opening lines or equipment', 'Pressure or leak testing', 'Scaffold erection or dismantling',
            'Chemical cleaning', 'Removing safety-critical equipment', 'Building or civil work (no digging)', 'Inspection or testing', 'Other'] },
        { key: 'hazards', label: 'Main hazards and how they are controlled', kind: 'textarea', required: true },
        { key: 'tools', label: 'Tools, plant and vehicles used', kind: 'text' },
        { key: 'chemicals', label: 'Chemicals used', kind: 'text', hint: 'Safety data sheets must be at the work' },
        { key: 'ppe', label: 'PPE required', kind: 'text', required: true },
        { key: 'hazardousArea', label: 'In a hazardous (classified) area?', kind: 'select', required: true, options: YES_NO },
        { key: 'isolationNeeded', label: 'Plant needs isolating for this work?', kind: 'select', required: true, options: YES_NO },
        { key: 'isolationCert', label: 'Isolation certificate or ISO permit number', kind: 'text', hint: 'Needed when plant is isolated' },
        { key: 'pressureMedium', label: 'Pressure test medium', kind: 'select', options: ['Hydrostatic (water)', 'Pneumatic (air or gas)'], hint: 'Needed for pressure testing' },
        { key: 'pressureTest', label: 'Pressure test: test pressure, relief setting, exclusion zone', kind: 'textarea', hint: 'Needed for pressure testing, from the approved test procedure' },
        { key: 'temperature', label: 'Forecast maximum temperature', unit: '°C', kind: 'number', required: true },
        { key: 'safetyEquipmentOut', label: 'Safety-critical equipment taken out of service, controls, and who was told', kind: 'textarea',
          hint: 'For example a fire alarm zone or deluge system (ADOSH-SF CoP 21.0 s3.8)' },
        { key: 'gasTestNeeded', label: 'Gas test needed?', kind: 'select', required: true, options: YES_NO,
          hint: 'For example in process or hazardous areas, near drains or pits, or when opening lines' },
        { key: 'areaOwner', label: 'Area owner or operator who agreed the work', kind: 'text', required: true, group: 'People' },
        { key: 'workers', label: 'Work party', kind: 'list', required: true, group: 'People' },
        { key: 'muster', label: 'Muster point and emergency contact', kind: 'text', required: true, group: 'People' },
      ],
      checks: [
        BRIEFED,
        NEARBY,
        { key: 'siteInspected', label: 'Work site inspected by the issuer with the area owner before issue', required: true },
        { key: 'isolationConfirmed', label: 'Isolation certificate attached; isolations checked on site' },
        { key: 'otherPermits', label: 'Other permits needed are linked (hot work, confined space, height, digging, lifting)', required: true },
        { key: 'exEquipment', label: 'Hazardous area: only Ex-rated equipment, or a hot work permit for anything else' },
        { key: 'toolsInspected', label: 'Tools and equipment inspected and fit for use', required: true },
        { key: 'ppeWorn', label: 'PPE listed on the permit issued and worn', required: true },
        { key: 'emergencyKnown', label: 'Emergency arrangements known: alarm, muster point, first aider', required: true },
        { key: 'barricaded', label: 'Work area barricaded and signed' },
        { key: 'depressurised', label: 'Equipment drained, depressurised and flushed or purged before opening' },
        { key: 'pressureTestControls', label: 'Pressure test: exclusion zone set, test pressure and relief confirmed' },
        { key: 'pneumaticApproved', label: 'Pneumatic test approved by an engineer, exclusion zone calculated' },
        { key: 'safetyEquipmentApproved', label: 'Safety-critical equipment out of service approved; people affected told' },
        { key: 'temporaryPower', label: 'Temporary power at 110 V with RCD protection; cables undamaged' },
        { key: 'sds', label: 'Safety data sheets at the work and chemical controls in place' },
        { key: 'housekeeping', label: 'Access routes kept clear; waste and materials stored safely' },
        { key: 'heatStress', label: 'Heat stress controls in place: water, rest, shade, midday break' },
      ],
      gasTest: {
        required: false, beforeWhat: 'work starts',
        requiredWhen: (p, h) => h.detail('gasTestNeeded') === 'Yes' || h.detail('hazardousArea') === 'Yes'
          || /Opening lines|Chemical cleaning/.test(h.detail('category')),
        hint: 'Needed when opening lines, chemical cleaning, in hazardous areas, or where the issuer says so. Test oxygen and flammable gas, and H₂S or CO where the risk assessment says so.',
        failAdvice: 'Do not start work. Find the source, ventilate and test again.',
        limits: [OXYGEN, FLAMMABLE,
          Object.assign({}, H2S, { optional: true, limitText: H2S.limitText + ' where tested' }),
          Object.assign({}, CO, { optional: true, limitText: CO.limitText + ' where tested' })],
      },
      rules: [
        (p, h) => (/Pressure/.test(h.detail('category')) && (h.isBlank(h.detail('pressureTest')) || h.isBlank(h.detail('pressureMedium'))))
          ? 'Record the pressure test medium and details.' : null,
        (p, h) => (/Scaffold/.test(h.detail('category')) && h.isBlank(p.otherPermits))
          ? 'Scaffold erection and dismantling is work at height. Enter the work at height permit number under "Other permits for this job".' : null,
        (p, h) => (h.detail('isolationNeeded') === 'Yes' && h.isBlank(h.detail('isolationCert')))
          ? 'Record the isolation certificate or ISO permit number.' : null,
        requireCheckWhen('isolationConfirmed', (p, h) => h.detail('isolationNeeded') === 'Yes'),
        requireCheckWhen('exEquipment', (p, h) => h.detail('hazardousArea') === 'Yes'),
        requireCheckWhen('pressureTestControls', (p, h) => /Pressure/.test(h.detail('category'))),
        requireCheckWhen('pneumaticApproved', (p, h) => /Pressure/.test(h.detail('category')) && /Pneumatic/.test(h.detail('pressureMedium'))),
        requireCheckWhen('depressurised', (p, h) => /Opening lines|Chemical cleaning/.test(h.detail('category'))),
        requireCheckWhen('heatStress', (p, h) => h.num(h.detail('temperature')) >= HEAT_OUTDOOR_C),
        requireCheckWhen('sds', (p, h) => !h.isBlank(h.detail('chemicals'))),
        requireCheckWhen('safetyEquipmentApproved', (p, h) => !h.isBlank(h.detail('safetyEquipmentOut')) || /safety-critical/.test(h.detail('category'))),
      ],
      closeoutRules: [
        (c, permit) => ((!isBlank(detailValue(permit, 'safetyEquipmentOut')) || /safety-critical/.test(detailValue(permit, 'category'))) && !(c.checks || {}).safetyEquipmentBack)
          ? 'Safety-critical equipment must be back in service, and the people affected told, before the permit is closed.' : null,
      ],
      closeout: [
        { key: 'workDone', label: 'Work finished or stopped; tools, materials and waste removed', required: true },
        { key: 'followUp', label: 'Any outstanding or follow-up work recorded', required: true },
        { key: 'reinstated', label: 'Equipment reinstated: guards refitted, joints made up, leak test where lines were opened' },
        { key: 'isolationsAfterHandBack', label: 'Isolations removed only after hand-back, under their certificate' },
        { key: 'safetyEquipmentBack', label: 'Safety-critical equipment back in service and people affected told' },
        { key: 'areaSafe', label: 'Area left clean, safe and handed back to the area owner', required: true },
        { key: 'barriersRemoved', label: 'Temporary barriers removed or handed over' },
        { key: 'incidentsReported', label: 'Any incident, near miss or defect reported' },
      ],
    },
  ];

  const byKeyMap = new Map(TYPES.map((t) => [t.key, t]));
  const DEFAULT_TYPE = 'lifting';

  function byKey(key) { return byKeyMap.get(key) || null; }
  function isType(key) { return byKeyMap.has(key); }
  function typeKeyOf(permit) {
    const k = permit && permit.permitType;
    return isType(k) ? k : DEFAULT_TYPE;
  }
  function typeOf(permit) { return byKey(typeKeyOf(permit)); }
  function labelOf(permit) { return typeOf(permit).label; }

  // ---- Status ---------------------------------------------------------------
  // closed and suspended are set by people; expired follows from validTo.
  function statusOf(permit, now) {
    const t = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
    if (!permit) return 'active';
    if (permit.status === 'closed') return 'closed';
    if (permit.status === 'suspended') return 'suspended';
    const end = Date.parse(permit.validTo || '');
    if (!Number.isNaN(end) && end < t) return 'expired';
    return 'active';
  }
  const STATUS_LABELS = { active: 'Active', suspended: 'Suspended', expired: 'Expired', closed: 'Closed' };

  // ---- Numbering ------------------------------------------------------------
  // Numbers look like HW-2026-0007. The next one is one more than the larger
  // of the stored counter and the highest number already on file for that
  // prefix and year, so a wiped or new device never reissues a number that
  // came back from the account.
  function nextNumber(prefix, year, counter, existingNumbers) {
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    let max = Number.isFinite(counter) ? counter : 0;
    (existingNumbers || []).forEach((n) => {
      const m = re.exec(String(n || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    const seq = max + 1;
    return { seq, number: `${prefix}-${year}-${String(seq).padStart(4, '0')}` };
  }

  // ---- Reading answers -------------------------------------------------------
  function checkValue(permit, type, key) {
    if (type.topLevelChecks) return !!(permit && permit[key]);
    return !!(permit && permit.checks && permit.checks[key]);
  }
  function detailValue(permit, key) {
    const v = permit && permit.details ? permit.details[key] : undefined;
    return v == null ? '' : v;
  }
  function isBlank(v) {
    if (Array.isArray(v)) return v.filter((x) => String(x || '').trim()).length === 0;
    return v == null || String(v).trim() === '';
  }
  const num = (v) => (v === '' || v == null ? NaN : Number(v));

  // ---- Gas tests ------------------------------------------------------------
  // Returns the readings in a test that are outside the type's limits, as
  // human-readable strings, plus any that are missing.
  function gasProblems(test, limits) {
    const out = [];
    (limits || []).forEach((lim) => {
      const v = num(test ? test[lim.key] : '');
      if (Number.isNaN(v)) { if (!lim.optional) out.push(`${lim.label} reading missing`); return; }
      if (v < 0) { out.push(`${lim.label} reading cannot be negative`); return; }
      if (lim.min != null && v < lim.min) out.push(`${lim.label} ${v}${lim.unit} is below ${lim.min}${lim.unit}`);
      if (lim.max != null && v > lim.max) out.push(`${lim.label} ${v}${lim.unit} is above ${lim.max}${lim.unit}`);
      if (lim.below != null && v >= lim.below) out.push(`${lim.label} ${v}${lim.unit} is not below ${lim.below}${lim.unit}`);
    });
    return out;
  }
  function recordedGasTests(permit) {
    return (permit && Array.isArray(permit.gasTests) ? permit.gasTests : [])
      .filter((t) => t && (t.at || t.o2 !== undefined));
  }
  function latestGasTest(permit) {
    const tests = recordedGasTests(permit);
    if (!tests.length) return null;
    return tests.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).pop();
  }
  // The latest round: every reading recorded at the same time as the latest
  // one (for example the top, middle and bottom of a tank). All of them must
  // pass; earlier rounds stay on the permit as the record of what was found.
  function latestGasRound(permit) {
    const last = latestGasTest(permit);
    if (!last) return [];
    return recordedGasTests(permit).filter((t) => String(t.at || '') === String(last.at || ''));
  }
  const sameName = (a, b) => {
    const n = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return n(a) !== '' && n(a) === n(b);
  };

  // ---- Validation -----------------------------------------------------------
  // ctx.assessments: the user's crane assessments (lifting only).
  // Returns a list of problems; an empty list means the permit can be issued.
  function validate(permit, ctx) {
    const errors = [];
    const type = typeOf(permit);
    const p = permit || {};
    ctx = ctx || {};

    if (isBlank(p.projectNumber)) errors.push('Project number is required.');
    if (isBlank(p.location)) errors.push('Location is required.');
    if (isBlank(p.workDescription) && type.key !== DEFAULT_TYPE) errors.push('Describe the work.');
    if (isBlank(p.personInCharge)) errors.push(`${type.personInChargeLabel || 'Person in charge'} is required.`);
    if (!p.hasRiskAssessment) errors.push('Risk assessment must be confirmed available.');
    if (!p.hasMethodStatement) errors.push('Method statement must be confirmed available.');

    const from = Date.parse(p.validFrom || '');
    const to = Date.parse(p.validTo || '');
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
      errors.push('Valid-to date/time must be after valid-from date/time.');
    } else if (type.maxValidityHours && (to - from) > type.maxValidityHours * 36e5) {
      errors.push(`A ${type.label.toLowerCase()} permit can be valid for at most ${type.maxValidityHours} hours. Revalidate or issue a new permit for longer work.`);
    }

    (type.fields || []).forEach((f) => {
      if (f.required && isBlank(detailValue(p, f.key))) errors.push(`${f.label} is required.`);
      if (f.kind === 'number' && !isBlank(detailValue(p, f.key))) {
        const v = num(detailValue(p, f.key));
        if (Number.isNaN(v)) errors.push(`${f.label} must be a number.`);
        else if (f.min != null && v < f.min) errors.push(`${f.label} must be at least ${f.min}.`);
      }
    });

    (type.checks || []).forEach((c) => {
      if (c.required && !checkValue(p, type, c.key)) errors.push(`Confirm: ${c.label}.`);
    });

    if (type.gasTest) {
      // A type may need a test always (confined space) or only in some
      // conditions (hot work near flammables). Any test recorded must be
      // complete and within the limits, and recent enough to count.
      const needed = type.gasTest.required || (type.gasTest.requiredWhen && type.gasTest.requiredWhen(p, helpers(p, type)));
      const round = latestGasRound(p);
      if (!round.length && needed) errors.push(`Record a gas test before ${type.gasTest.beforeWhat || 'work starts'}.`);
      if (round.length) {
        const at = Date.parse(round[0].at || '');
        const maxAge = type.gasTest.maxAgeHours || 2;
        if (Number.isNaN(at)) errors.push('Record the time of the latest gas test.');
        else if (!Number.isNaN(from) && at < from - maxAge * 36e5) {
          errors.push(`The latest gas test was more than ${maxAge} hours before the permit starts. Test again just before ${type.gasTest.beforeWhat || 'work starts'}.`);
        }
        if (round.some((t) => isBlank(t.testedBy))) errors.push('Record who carried out the latest gas test.');
        if (round.some((t) => isBlank(t.instrument))) errors.push('Record the gas detector used for the latest test.');
        const bad = [];
        round.forEach((t) => gasProblems(t, type.gasTest.limits).forEach((b) => bad.push(isBlank(t.point) ? b : `${String(t.point).trim()}: ${b}`)));
        if (bad.length) errors.push(`The latest gas test is outside the limits (${bad.join('; ')}). ${type.gasTest.failAdvice || 'Do not start work.'}`);
      }
    }

    if (type.isolations) {
      const rows = (Array.isArray(p.isolations) ? p.isolations : []).filter((r) => r && !isBlank(r.point));
      if (!rows.length) errors.push('List at least one isolation point.');
      rows.forEach((r, i) => {
        const name = `Isolation ${i + 1} (${String(r.point).slice(0, 40)})`;
        if (isBlank(r.lockNo)) errors.push(`${name}: lock or tag number is required.`);
        if (isBlank(r.isolatedBy)) errors.push(`${name}: record who isolated it.`);
        if (!r.verified) errors.push(`${name}: confirm zero energy was verified.`);
      });
    }

    if (isBlank(p.issuerName)) errors.push('Issuer name is required.');
    else if (sameName(p.issuerName, p.personInCharge)) {
      errors.push(`The issuer and the ${(type.personInChargeLabel || 'person in charge').replace(/ \(.*\)$/, '').toLowerCase()} must be different people (ADOSH-SF CoP 21.0).`);
    }
    if (isBlank(p.issuerSignature)) errors.push('Issuer signature is required.');

    if (type.key === 'lifting' && p.isCriticalLift) {
      const a = (ctx.assessments || []).find((x) => x.id === p.assessmentId);
      if (!a) errors.push('Critical lifts require a linked crane assessment.');
      else if (!a.isValid) errors.push('The linked crane assessment is not within capacity — a critical lift cannot proceed on a failed assessment.');
      if (isBlank(p.approverName) || isBlank(p.approverSignature)) errors.push('Critical lifts require an approver name and signature.');
    } else if (type.approverRequired && (isBlank(p.approverName) || isBlank(p.approverSignature))) {
      errors.push(`${type.label} permits require an approver name and signature.`);
    }

    (type.rules || []).forEach((rule) => {
      const msg = rule(p, helpers(p, type));
      if (msg) errors.push(msg);
    });
    return errors;
  }

  function helpers(p, type) {
    return {
      detail: (k) => detailValue(p, k),
      check: (k) => checkValue(p, type, k),
      checkLabel: (k) => ((type.checks || []).find((c) => c.key === k) || { label: k }).label,
      num, isBlank,
    };
  }

  // Close-out: what has to be confirmed before a permit is closed.
  function validateCloseout(permit, closeout) {
    const type = typeOf(permit);
    const c = closeout || {};
    const errors = [];
    if (isBlank(c.by)) errors.push('Record who is closing the permit.');
    (type.closeoutFields || []).forEach((f) => {
      if (f.required && isBlank(c.fields && c.fields[f.key])) errors.push(`${f.label} is required.`);
    });
    (type.closeout || []).forEach((item) => {
      if (item.required && !(c.checks && c.checks[item.key])) errors.push(`Confirm: ${item.label}.`);
    });
    (type.closeoutRules || []).forEach((rule) => {
      const msg = rule(c, permit);
      if (msg) errors.push(msg);
    });
    return errors;
  }

  const api = {
    TYPES, DEFAULT_TYPE, STATUS_LABELS,
    byKey, isType, typeKeyOf, typeOf, labelOf, statusOf,
    nextNumber, checkValue, detailValue, gasProblems, latestGasTest, latestGasRound,
    validate, validateCloseout,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PermitTypes = api;
})(typeof self !== 'undefined' ? self : this);
