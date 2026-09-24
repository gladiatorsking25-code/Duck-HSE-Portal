// crane-selector.js — given a load weight and required working radius, scans
// every crane/configuration/boom-length combination in CRANE_DATA (main boom
// mode only — jib/angle-indexed charts aren't radius-addressable the same way)
// and returns the ones that can safely lift it, ranked by a simple
// "smallest adequate crane" cost-efficiency proxy.
//
// IMPORTANT: there is no real pricing data behind this. It is a planning
// heuristic — smaller crane class and shorter boom generally correlate with
// lower mobilization/rental cost, but actual cost depends on supplier,
// region, mobilization distance, and rental duration. Always confirm
// commercial cost with your crane supplier.

const CraneSelector = (function () {

  function findOptions(loadWeight, radius, opts) {
    opts = opts || {};
    const maxBoomLength = opts.maxBoomLength || null;
    const results = [];

    Object.values(CRANE_DATA).forEach(spec => {
      Object.keys(spec.loadCharts).forEach(configName => {
        const chart = spec.loadCharts[configName];
        Object.keys(chart).forEach(boomKey => {
          const boomLength = Number(boomKey);
          if (maxBoomLength && boomLength > maxBoomLength) return;

          const { capacity, error } = CraneCalc.maxCapacityTonnes(spec, configName, boomLength, radius);
          if (error || !capacity || capacity <= 0) return;
          if (capacity < loadWeight) return; // not safe — skip

          const utilization = (loadWeight / capacity) * 100;
          results.push({
            craneModel: spec.model,
            craneMaxCapacity: spec.maxCapacity,
            configuration: configName,
            boomLength,
            capacity,
            utilization,
            maxWindSpeed: spec.maxWindSpeed
          });
        });
      });
    });

    // Cost-efficiency proxy ranking:
    //   1) smaller-capacity crane class first (proxy for lower day rate/mobilization cost)
    //   2) shorter boom length first (less rigging/transport for the boom sections)
    //   3) higher utilization first, among ties (uses the smaller crane's ability well,
    //      rather than a much bigger crane doing the same job with huge headroom to spare)
    results.sort((a, b) =>
      a.craneMaxCapacity - b.craneMaxCapacity ||
      a.boomLength - b.boomLength ||
      b.utilization - a.utilization
    );

    // De-duplicate: keep only the best (first, given the sort above) row per
    // crane+configuration+boomLength — chart iteration can't actually repeat
    // these, but keep this defensive in case of future multi-source data.
    const seen = new Set();
    const deduped = results.filter(r => {
      const key = `${r.craneModel}|${r.configuration}|${r.boomLength}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped;
  }

  // For the "nothing fits" case: find the single largest capacity available
  // at this radius across the whole fleet, for a useful reference point.
  function bestEffort(radius, opts) {
    opts = opts || {};
    const maxBoomLength = opts.maxBoomLength || null;
    let best = null;
    Object.values(CRANE_DATA).forEach(spec => {
      Object.keys(spec.loadCharts).forEach(configName => {
        const chart = spec.loadCharts[configName];
        Object.keys(chart).forEach(boomKey => {
          const boomLength = Number(boomKey);
          if (maxBoomLength && boomLength > maxBoomLength) return;
          const { capacity, error } = CraneCalc.maxCapacityTonnes(spec, configName, boomLength, radius);
          if (error || !capacity) return;
          if (!best || capacity > best.capacity) {
            best = { craneModel: spec.model, configuration: configName, boomLength, capacity };
          }
        });
      });
    });
    return best;
  }

  return { findOptions, bestEffort };
})();
