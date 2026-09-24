// lift-planning.js — pre-lift briefing, categorized training requirements, and
// an exclusion-zone starting-point calculator, generated from an assessment's
// own parameters. These are planning aids only — they do not replace a proper
// site-specific risk assessment, lift plan, and toolbox talk led by the
// Appointed Person, and do not replace ADOSH-SF CoP 34.0 or other applicable
// local regulations.

const LiftPlanning = (function () {

  const ENV_LABELS = {
    visibility: { good: 'Good — clear line of sight', moderate: 'Moderate — some haze/dust', poor: 'Poor — fog, heavy dust, or darkness without adequate lighting' },
    precipitation: { none: 'None', 'light-rain': 'Light rain', 'heavy-rain': 'Heavy rain / thunderstorm', sandstorm: 'Dust / sandstorm', fog: 'Fog / low cloud' },
    lighting: { daylight: 'Daylight', artificial: 'Artificial lighting (adequate)', 'low-light': 'Low light / inadequate artificial lighting' },
    ground: { 'firm-level': 'Firm and level', 'soft-uneven': 'Soft, uneven or unconsolidated', sloped: 'Sloped / graded' }
  };

  function envLabel(field, value) {
    return (ENV_LABELS[field] && ENV_LABELS[field][value]) || (value || 'Not recorded');
  }

  // ---- Exclusion zone: a suggested starting point, not a mandated figure ----
  function computeExclusionZone(p) {
    if (p.jibMode) {
      return {
        zoneM: null,
        note: "Working radius for jib (angle-indexed) configurations varies with boom angle — read the actual radius off the manufacturer's lifting-height/radius chart for this boom angle, then apply the same margin method below to set the exclusion zone."
      };
    }
    const radius = p.radius || 0;
    const loadDim = (p.loadDimensionM && p.loadDimensionM > 0) ? p.loadDimensionM : 2;
    let zone = radius + (loadDim / 2) + 3; // generic 3 m slew/rigger working margin
    let windNote = '';
    if (p.windSpeedMs != null && p.windLimitMs && p.windSpeedMs > p.windLimitMs * 0.6) {
      zone += 2;
      windNote = ' plus 2 m because wind is approaching the stop-work limit';
    }
    zone = Math.ceil(zone * 2) / 2; // round up to nearest 0.5 m
    return {
      zoneM: zone,
      note: `Starting point only = working radius (${radius.toFixed(1)} m) + half the load's largest dimension (${(loadDim / 2).toFixed(1)} m, assumed ${loadDim.toFixed(1)} m overall${p.loadDimensionM ? '' : ' — no dimension entered, so a generic 2 m default was used'}) + a generic 3 m slew/rigger margin${windNote}. The Appointed Person and site risk assessment set the final barriered distance — this does not account for ground slope, nearby structures/public access, or overhead services.`
    };
  }

  // ---- Training requirements, categorized ----
  function computeTrainingRequirements(p) {
    const highRisk = (p.utilization != null && p.utilization > 85) || p.jibMode ||
      (p.loadWeight != null && p.craneMaxCapacity && p.loadWeight >= 0.8 * p.craneMaxCapacity);
    return [
      {
        category: 'Appointed Person',
        required: highRisk,
        items: [
          'Appointed Person qualification (e.g. a recognized scheme such as CPCS/NPORS Appointed Person, or local equivalent)',
          'Has authored, reviewed, and signed off the lifting plan for this specific lift',
          highRisk
            ? "Mandatory for this lift — flagged for high utilization, a jib configuration, and/or a load close to the crane's rated capacity"
            : 'Recommended for oversight even on lower-risk lifts, per site policy'
        ]
      },
      {
        category: 'Lift Supervisor',
        required: highRisk,
        items: [
          'Competent, experienced person supervising the lift directly on site',
          'Clear authority to stop the lift immediately if conditions change',
          highRisk ? 'Mandatory for this lift given its risk profile' : 'May be combined with the Appointed Person role on lower-risk lifts, per site policy'
        ]
      },
      {
        category: 'Crane Operator',
        required: true,
        items: [
          'Valid, in-date operator licence/certificate for this class of crane',
          'Familiar with this specific crane model, configuration, and load chart',
          "Briefed on today's wind limit, exclusion zone, and load details before starting"
        ]
      },
      {
        category: 'Rigger / Slinger',
        required: true,
        items: [
          'Certified slinger/rigger competence',
          "Inspected slings, shackles and lifting accessories, and confirmed their safe working load (SWL) against the load weight",
          "Assessed the load's centre of gravity and confirmed the rigging/sling-angle plan"
        ]
      },
      {
        category: 'Banksman / Signaller',
        required: true,
        items: [
          'Certified banksman/signaller',
          'Agreed hand-signal or radio protocol confirmed with the crane operator before the lift',
          'Positioned with a clear, unobstructed view of the load path and exclusion zone'
        ]
      }
    ];
  }

  // ---- Pre-lift briefing points, tailored to this lift ----
  function generateBriefingPoints(p) {
    const pts = [];

    pts.push(`Lift overview: ${p.craneModel || 'crane'} (${p.configuration || 'configuration TBC'}), load ${p.loadWeight != null ? p.loadWeight.toFixed(1) : '—'} t at ${p.jibMode ? (p.boomAngle != null ? p.boomAngle.toFixed(1) + '° boom angle' : 'the planned boom angle') : (p.radius != null ? p.radius.toFixed(1) + ' m radius' : 'the planned radius')}. ${p.isValid === false ? 'Assessment result: NOT ALLOWED as planned — do not proceed until re-assessed.' : (p.isValid === true ? `Assessment result: ALLOWED, at ${p.utilization != null ? p.utilization.toFixed(0) : '—'}% of chart capacity.` : 'Assessment not yet finalized.')}`);

    pts.push(`Wind: current ${p.windSpeedMs != null ? p.windSpeedMs.toFixed(1) : '—'} m/s against a stop-work limit of ${p.windLimitMs} m/s (${(p.windLimitMs * 3.6).toFixed(1)} km/h)${p.windLimitIsAdosh ? " — the ADOSH-SF CoP 34.0 threshold governs here, being lower than the crane's own rating" : " — the crane's manufacturer rating governs here"}. Lifting must stop immediately if this is exceeded, and conditions should be monitored throughout the lift.`);

    if (p.exclusionZoneM != null) {
      pts.push(`Exclusion zone: barrier and signpost a minimum ${p.exclusionZoneM} m radius around the lift area (see calculation note below); confirm with the banksman that it is clear of personnel before starting and kept clear throughout.`);
    } else if (p.exclusionZoneNote) {
      pts.push(`Exclusion zone: ${p.exclusionZoneNote}`);
    }

    const envBits = [];
    if (p.visibility) envBits.push(`visibility — ${envLabel('visibility', p.visibility).toLowerCase()}`);
    if (p.precipitation && p.precipitation !== 'none') envBits.push(envLabel('precipitation', p.precipitation).toLowerCase());
    if (p.lighting) envBits.push(`lighting — ${envLabel('lighting', p.lighting).toLowerCase()}`);
    if (p.ground) envBits.push(`ground — ${envLabel('ground', p.ground).toLowerCase()}`);
    if (envBits.length) pts.push(`Environmental conditions recorded: ${envBits.join('; ')}.`);

    if (p.visibility === 'poor' || p.lighting === 'low-light') {
      pts.push('Caution: poor visibility or lighting recorded — the operator, banksman and riggers must have a clear, unobstructed view of the load and exclusion zone at all times. Do not proceed if this cannot be assured; consider additional lighting, a dedicated spotter, or postponing the lift.');
    }
    if (p.precipitation === 'heavy-rain' || p.precipitation === 'sandstorm' || p.precipitation === 'fog') {
      pts.push(`Caution: ${envLabel('precipitation', p.precipitation).toLowerCase()} recorded — reassess whether the lift should proceed; reduced visibility, slippery rigging and gusting wind often accompany these conditions.`);
    }
    if (p.ground === 'soft-uneven' || p.ground === 'sloped') {
      pts.push('Ground conditions: confirm outrigger/crawler ground-bearing pressure has been checked against mats or a compacted, level pad before setting up — this tool does not assess ground-bearing capacity.');
    }

    pts.push('Communication: confirm the agreed hand signals or radio channel with the crane operator, banksman, and riggers before the lift starts.');
    pts.push('Load path and tag lines: walk the planned load path, confirm it is clear of personnel, structures, and services (including overhead power lines), and that tag lines are fitted and will be used to control the load.');
    pts.push('Emergency arrangements: confirm the muster point, who has the authority to halt the lift, and the procedure for safely lowering or setting down the load if the lift must be stopped part-way.');
    pts.push('Roles present: confirm the personnel listed in the training requirements below are on site, briefed, and hold current, checked certification before lifting begins.');

    return pts;
  }

  return { envLabel, ENV_LABELS, computeExclusionZone, computeTrainingRequirements, generateBriefingPoints };
})();
