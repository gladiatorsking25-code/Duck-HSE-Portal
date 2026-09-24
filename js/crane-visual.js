// crane-visual.js — dependency-free lift visualization.
//
// Draws two things from the same assessment parameters:
//   1. A rotating pseudo-3D wireframe/solid crane (SVG, animated in JS with real
//      3D rotation math + isometric projection — no WebGL / three.js dependency,
//      so it keeps working offline exactly like the rest of this static site).
//   2. A flat 2D side-view "plan sketch" of the same lift (boom angle, radius,
//      load, wind arrow) for a clearer at-a-glance technical read.
//
// Both can be frozen and rasterized to a PNG data URL for saving into an
// assessment/permit record and for direct download.

const CraneVisual = (function () {

  // ---------- shared geometry helpers ----------

  // Rotate a point around the vertical (Y) axis by angle theta (radians).
  function rotY(p, theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  }

  // Simple axonometric (isometric-style) projection to 2D screen space.
  function project(p, scale, originX, originY) {
    const rad30 = Math.PI / 6;
    const sx = (p.x - p.z) * Math.cos(rad30);
    const sy = (p.x + p.z) * Math.sin(rad30) - p.y;
    return { x: originX + sx * scale, y: originY + sy * scale };
  }

  function compassLabel(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(((deg % 360) / 22.5)) % 16;
    return dirs[idx];
  }

  // Build the 3D "world" edges/faces for the crane in local units (metres, roughly
  // scaled down) given the lift parameters. Returns arrays of segments/polys with
  // a color/kind tag so the renderer can style them.
  function buildModel(p) {
    const boomLen = clamp(p.boomLength || 20, 8, 60) * 0.4;       // scaled model units
    const elevRad = (clamp(p.boomAngleDeg, 5, 88)) * Math.PI / 180;
    const slewRad = (p.slewDeg || 0) * Math.PI / 180;
    const chassisW = 4.2, chassisL = 7.5, chassisH = 1.6;
    const turretH = 1.1;

    const segs = [];   // { a:{x,y,z}, b:{x,y,z}, kind }
    const polys = [];  // { pts:[{x,y,z}...], kind }

    // ---- ground grid ----
    const g = 14, step = 2.8;
    for (let i = -g; i <= g; i += step) {
      segs.push({ a: { x: i, y: 0, z: -g }, b: { x: i, y: 0, z: g }, kind: 'grid' });
      segs.push({ a: { x: -g, y: 0, z: i }, b: { x: g, y: 0, z: i }, kind: 'grid' });
    }

    // ---- chassis box (undercarriage) ----
    const cw = chassisW / 2, cl = chassisL / 2;
    const chassisPts = [
      { x: -cl, y: 0, z: -cw }, { x: cl, y: 0, z: -cw }, { x: cl, y: 0, z: cw }, { x: -cl, y: 0, z: cw },
      { x: -cl, y: chassisH, z: -cw }, { x: cl, y: chassisH, z: -cw }, { x: cl, y: chassisH, z: cw }, { x: -cl, y: chassisH, z: cw }
    ];
    boxSegs(chassisPts).forEach(s => segs.push(Object.assign(s, { kind: 'chassis' })));
    polys.push({ pts: [chassisPts[4], chassisPts[5], chassisPts[6], chassisPts[7]], kind: 'chassisTop' });

    // ---- outrigger legs (4 corners, splayed outward) ----
    const outSpan = chassisW / 2 + 2.6;
    const outL = chassisL / 2 + 2.6;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
      const base = { x: sx * cl, y: chassisH * 0.5, z: sz * cw };
      const tip = { x: sx * outL, y: 0, z: sz * outSpan };
      segs.push({ a: base, b: tip, kind: 'outrigger' });
    });

    // ---- slewing turret + counterweight, rotated by slewRad ----
    const turretBase = { x: 0, y: chassisH, z: 0 };
    const turretTop = { x: 0, y: chassisH + turretH, z: 0 };
    segs.push({ a: turretBase, b: turretTop, kind: 'turret' });
    const cwLocal = { x: -2.6, y: chassisH + 0.6, z: 0 };
    const cwPts3d = boxAt(cwLocal, 1.6, 1.2, 2.0).map(pt => rotAround(pt, turretTop, slewRad));
    boxSegs(cwPts3d).forEach(s => segs.push(Object.assign(s, { kind: 'counterweight' })));

    // ---- boom (from turret top, elevated by elevRad, slewed by slewRad) ----
    const pivot = { x: 0, y: chassisH + turretH, z: 0 };
    const boomTipLocal = {
      x: Math.cos(elevRad) * boomLen,
      y: pivot.y + Math.sin(elevRad) * boomLen,
      z: 0
    };
    const boomBaseLocal = { x: 0, y: pivot.y, z: 0 };
    const boomBase = rotAround(boomBaseLocal, pivot, slewRad);
    const boomTip = rotAround(boomTipLocal, pivot, slewRad);
    segs.push({ a: boomBase, b: boomTip, kind: 'boom', thick: true });
    // a second lattice line offset slightly for a "boom truss" look
    const boomTipLocal2 = { x: boomTipLocal.x, y: boomTipLocal.y - 0.5, z: 0.35 };
    const boomBaseLocal2 = { x: boomBaseLocal.x, y: boomBaseLocal.y - 0.4, z: 0.35 };
    segs.push({ a: rotAround(boomBaseLocal2, pivot, slewRad), b: rotAround(boomTipLocal2, pivot, slewRad), kind: 'boomLattice' });

    // ---- hoist line + hook + load ----
    const dropLen = 3.2;
    const hookLocal = { x: boomTipLocal.x, y: Math.max(0.6, boomTipLocal.y - dropLen), z: 0 };
    const hook = rotAround(hookLocal, pivot, slewRad);
    segs.push({ a: boomTip, b: hook, kind: 'hoistLine' });

    const loadSize = 0.9 + Math.min(1.6, (p.loadWeight || 1) / 12);
    const loadLocal = { x: boomTipLocal.x, y: hookLocal.y - loadSize / 2 - 0.2, z: 0 };
    const loadPts3d = boxAt(loadLocal, loadSize, loadSize, loadSize).map(pt => rotAround(pt, pivot, slewRad));
    boxSegs(loadPts3d).forEach(s => segs.push(Object.assign(s, { kind: p.isValid === false ? 'loadBad' : 'loadOk' })));
    polys.push({ pts: [loadPts3d[4], loadPts3d[5], loadPts3d[6], loadPts3d[7]], kind: p.isValid === false ? 'loadFaceBad' : 'loadFaceOk' });

    // ---- radius marker on the ground (arc from turret centre to load footprint) ----
    const groundRadius = Math.hypot(boomTipLocal.x, 0);
    const radiusEnd = rotAround({ x: groundRadius, y: 0.02, z: 0 }, { x: 0, y: 0.02, z: 0 }, slewRad);
    segs.push({ a: { x: 0, y: 0.02, z: 0 }, b: radiusEnd, kind: 'radiusLine' });

    // ---- wind arrow (from compass direction, pointing toward the crane) ----
    if (p.windDirectionDeg != null) {
      const windRad = (p.windDirectionDeg) * Math.PI / 180;
      const windDist = 11;
      const from = { x: Math.sin(windRad) * windDist, y: 1.4, z: Math.cos(windRad) * windDist };
      const to = { x: Math.sin(windRad) * (windDist - 2.6), y: 1.4, z: Math.cos(windRad) * (windDist - 2.6) };
      segs.push({ a: from, b: to, kind: 'windArrow' });
    }

    return { segs, polys, meta: { boomTip, hook } };
  }

  function clamp(v, lo, hi) { v = (v == null || isNaN(v)) ? lo : v; return Math.max(lo, Math.min(hi, v)); }

  function boxAt(center, w, h, d) {
    const hw = w / 2, hd = d / 2;
    return [
      { x: center.x - hw, y: center.y - h / 2, z: center.z - hd },
      { x: center.x + hw, y: center.y - h / 2, z: center.z - hd },
      { x: center.x + hw, y: center.y - h / 2, z: center.z + hd },
      { x: center.x - hw, y: center.y - h / 2, z: center.z + hd },
      { x: center.x - hw, y: center.y + h / 2, z: center.z - hd },
      { x: center.x + hw, y: center.y + h / 2, z: center.z - hd },
      { x: center.x + hw, y: center.y + h / 2, z: center.z + hd },
      { x: center.x - hw, y: center.y + h / 2, z: center.z + hd },
    ];
  }

  function boxSegs(pts) {
    const idx = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    return idx.map(([i, j]) => ({ a: pts[i], b: pts[j] }));
  }

  // Rotate point p around a vertical axis passing through `center`, by angle (rad).
  function rotAround(p, center, angle) {
    const rel = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
    const r = rotY(rel, angle);
    return { x: r.x + center.x, y: r.y + center.y, z: r.z + center.z };
  }

  const KIND_STYLE = {
    grid: { stroke: '#c7d2d8', width: 0.5, opacity: 0.6 },
    chassis: { stroke: '#16283a', width: 1.6 },
    chassisTop: { fill: '#2b4a61', opacity: 0.85 },
    outrigger: { stroke: '#52626d', width: 1.3 },
    turret: { stroke: '#16283a', width: 2.4 },
    counterweight: { stroke: '#0f1b26', width: 1.4 },
    boom: { stroke: '#e8a53d', width: 3 },
    boomLattice: { stroke: '#b9791f', width: 1.2, opacity: 0.8 },
    hoistLine: { stroke: '#52626d', width: 1.1, dash: '2,2' },
    loadOk: { stroke: '#1f7a4d', width: 1.6 },
    loadBad: { stroke: '#b23b3b', width: 1.6 },
    loadFaceOk: { fill: '#1f7a4d', opacity: 0.55 },
    loadFaceBad: { fill: '#b23b3b', opacity: 0.55 },
    radiusLine: { stroke: '#2b4a61', width: 1, dash: '4,3', opacity: 0.7 },
    windArrow: { stroke: '#2b83c9', width: 2.4 },
  };

  function toScreenSegs(model, theta, scale, ox, oy) {
    return model.segs.map(s => {
      const a = project(rotY(s.a, theta), scale, ox, oy);
      const b = project(rotY(s.b, theta), scale, ox, oy);
      return { a, b, kind: s.kind };
    });
  }
  function toScreenPolys(model, theta, scale, ox, oy) {
    return model.polys.map(poly => ({
      pts: poly.pts.map(pt => project(rotY(pt, theta), scale, ox, oy)),
      kind: poly.kind
    }));
  }

  function svgAttrEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // ---------- public: interactive rotating 3D viewer ----------

  function mount(container, initialParams) {
    container.innerHTML = '';
    const W = 560, H = 340; // fixed internal coordinate space — container just scales it
    const svg = svgAttrEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet', style: 'display:block; background:#f6f7f5; border-radius:4px; touch-action:none; cursor:grab;' });
    container.appendChild(svg);

    let params = Object.assign({}, initialParams);
    let theta = 0.6;           // current camera azimuth
    let autoRotate = true;
    let dragging = false, lastX = 0;
    let raf = null;

    const scale = 9.5, ox = W / 2, oy = H * 0.66;

    function drawFrame() {
      const model = buildModel(params);
      const segs = toScreenSegs(model, theta, scale, ox, oy).sort((s1, s2) => (s1.a.y + s1.b.y) - (s2.a.y + s2.b.y));
      const polys = toScreenPolys(model, theta, scale, ox, oy);

      while (svg.firstChild) svg.removeChild(svg.firstChild);

      polys.forEach(poly => {
        const st = KIND_STYLE[poly.kind] || {};
        svg.appendChild(svgAttrEl('polygon', {
          points: poly.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
          fill: st.fill || 'none', 'fill-opacity': st.opacity != null ? st.opacity : 1, stroke: 'none'
        }));
      });

      segs.forEach(s => {
        const st = KIND_STYLE[s.kind] || { stroke: '#888', width: 1 };
        const el = svgAttrEl('line', {
          x1: s.a.x.toFixed(1), y1: s.a.y.toFixed(1), x2: s.b.x.toFixed(1), y2: s.b.y.toFixed(1),
          stroke: st.stroke, 'stroke-width': st.width, 'stroke-linecap': 'round'
        });
        if (st.dash) el.setAttribute('stroke-dasharray', st.dash);
        if (st.opacity != null) el.setAttribute('stroke-opacity', st.opacity);
        svg.appendChild(el);
        if (s.kind === 'windArrow') {
          const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
          const ah = 7;
          const p1 = { x: s.b.x - ah * Math.cos(angle - 0.4), y: s.b.y - ah * Math.sin(angle - 0.4) };
          const p2 = { x: s.b.x - ah * Math.cos(angle + 0.4), y: s.b.y - ah * Math.sin(angle + 0.4) };
          svg.appendChild(svgAttrEl('polygon', { points: `${s.b.x.toFixed(1)},${s.b.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`, fill: KIND_STYLE.windArrow.stroke }));
        }
      });

      // labels
      const label = (text, x, y, opts) => {
        const t = svgAttrEl('text', Object.assign({ x, y, 'font-family': 'IBM Plex Mono, monospace', 'font-size': 11, fill: '#52626d' }, opts || {}));
        t.textContent = text;
        svg.appendChild(t);
      };
      label(`${(params.craneModel || 'Crane')}`, 10, 18, { 'font-weight': 700, fill: '#16232c', 'font-size': 12.5 });
      label(`Load ${fmtNum(params.loadWeight)} t  ·  ${params.jibMode ? 'Angle ' + fmtNum(params.boomAngleDeg) + '°' : 'Radius ' + fmtNum(params.radius) + ' m'}  ·  Boom ${fmtNum(params.boomLength)} m`, 10, 34);
      if (params.windDirectionDeg != null) label(`Wind ${fmtNum(params.windSpeedMs)} m/s from ${compassLabel(params.windDirectionDeg)} (${Math.round(params.windDirectionDeg)}°)`, 10, 50);
      label(params.isValid === false ? 'NOT ALLOWED' : (params.isValid === true ? 'ALLOWED' : ''), W - 12, 18, { 'text-anchor': 'end', 'font-weight': 700, fill: params.isValid === false ? '#b23b3b' : '#1f7a4d' });
    }

    function loop() {
      if (autoRotate && !dragging) theta += 0.006;
      drawFrame();
      raf = requestAnimationFrame(loop);
    }
    loop();

    // drag-to-rotate
    function pointerDown(e) { dragging = true; lastX = (e.touches ? e.touches[0].clientX : e.clientX); svg.style.cursor = 'grabbing'; }
    function pointerMove(e) {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      theta += (x - lastX) * 0.008;
      lastX = x;
    }
    function pointerUp() { dragging = false; svg.style.cursor = 'grab'; }
    svg.addEventListener('mousedown', pointerDown);
    window.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);
    svg.addEventListener('touchstart', pointerDown, { passive: true });
    svg.addEventListener('touchmove', pointerMove, { passive: true });
    svg.addEventListener('touchend', pointerUp);

    return {
      update(newParams) { params = Object.assign({}, params, newParams); },
      setAutoRotate(v) { autoRotate = v; },
      capturePNG(callback) {
        autoRotate = false;
        drawFrame();
        svgElementToPng(svg, W, H, callback);
      },
      destroy() {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('mousemove', pointerMove);
        window.removeEventListener('mouseup', pointerUp);
      }
    };
  }

  function fmtNum(n) { return (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toString(); }

  // ---------- public: static 2D side-view sketch ----------

  function sketchSVGString(p) {
    const W = 640, H = 360;
    const groundY = 300;
    const pxPerM = 9;
    const originX = 470; // approx crane pivot x on screen

    const boom = clamp(p.boomLength || 20, 8, 60);
    const elevDeg = clamp(p.boomAngleDeg, 5, 88);
    const elevRad = elevDeg * Math.PI / 180;
    const pivot = { x: originX, y: groundY - 55 };
    const tip = { x: pivot.x - Math.cos(elevRad) * boom * pxPerM * 0.62, y: pivot.y - Math.sin(elevRad) * boom * pxPerM * 0.62 };
    const hook = { x: tip.x, y: Math.min(groundY - 20, tip.y + 70) };
    const radiusM = p.jibMode ? null : (p.radius != null ? p.radius : Math.cos(elevRad) * boom);
    const isValid = p.isValid;
    const loadColor = isValid === false ? '#b23b3b' : '#1f7a4d';
    const loadFill = isValid === false ? '#fbe9e7' : '#e5f4ec';

    const windDeg = p.windDirectionDeg;
    let windGroup = '';
    if (windDeg != null) {
      // Show wind as a simple side-on arrow (left/right) based on whether it's
      // broadly an "onshore" (toward crane, from left half) or opposite bearing.
      const fromLeft = windDeg > 180;
      const wx1 = fromLeft ? 60 : 610, wx2 = fromLeft ? 130 : 540;
      windGroup = `
        <g font-family="IBM Plex Mono, monospace" font-size="11" fill="#2b83c9">
          <line x1="${wx1}" y1="70" x2="${wx2}" y2="70" stroke="#2b83c9" stroke-width="2.4"/>
          <polygon points="${wx2},70 ${wx2 + (fromLeft ? -8 : 8)},65 ${wx2 + (fromLeft ? -8 : 8)},75" fill="#2b83c9"/>
          <text x="${(wx1+wx2)/2}" y="58" text-anchor="middle">WIND ${fmtNum(p.windSpeedMs)} m/s</text>
          <text x="${(wx1+wx2)/2}" y="86" text-anchor="middle">from ${compassLabel(windDeg)} (${Math.round(windDeg)}°)</text>
        </g>`;
    }

    const radiusGroup = (!p.jibMode && radiusM != null) ? `
      <g font-family="IBM Plex Mono, monospace" font-size="11" fill="#52626d">
        <line x1="${pivot.x}" y1="${groundY + 16}" x2="${tip.x}" y2="${groundY + 16}" stroke="#52626d" stroke-width="1" stroke-dasharray="3,3"/>
        <line x1="${pivot.x}" y1="${groundY + 10}" x2="${pivot.x}" y2="${groundY + 22}" stroke="#52626d" stroke-width="1"/>
        <line x1="${tip.x}" y1="${groundY + 10}" x2="${tip.x}" y2="${groundY + 22}" stroke="#52626d" stroke-width="1"/>
        <text x="${(pivot.x + tip.x) / 2}" y="${groundY + 34}" text-anchor="middle">RADIUS ${fmtNum(radiusM)} m</text>
      </g>` : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, sans-serif">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#f6f7f5"/>
      <text x="16" y="24" font-family="Inter, sans-serif" font-weight="700" font-size="14" fill="#16232c">${escapeXml(p.craneModel || 'Crane')} — Lift Plan Sketch</text>
      <text x="16" y="42" font-family="IBM Plex Mono, monospace" font-size="11" fill="#52626d">${p.jibMode ? `Boom angle ${fmtNum(p.boomAngleDeg)}° (main boom + jib)` : `Boom ${fmtNum(p.boomLength)} m · Radius ${fmtNum(p.radius)} m`} · Load ${fmtNum(p.loadWeight)} t · Slew ${fmtNum(p.slewDeg || 0)}°</text>

      <!-- ground -->
      <line x1="20" y1="${groundY}" x2="${W - 20}" y2="${groundY}" stroke="#16283a" stroke-width="2"/>
      <g stroke="#c7d2d8" stroke-width="1">
        ${Array.from({length: 12}).map((_,i)=>`<line x1="${30+i*50}" y1="${groundY}" x2="${18+i*50}" y2="${groundY+9}"/>`).join('')}
      </g>

      <!-- crane body -->
      <rect x="${pivot.x - 34}" y="${groundY - 24}" width="68" height="24" rx="3" fill="#2b4a61"/>
      <rect x="${pivot.x - 46}" y="${groundY - 8}" width="92" height="10" rx="2" fill="#16283a"/>
      <rect x="${pivot.x - 20}" y="${groundY - 55}" width="18" height="34" fill="#1e3548"/>
      <rect x="${pivot.x - 40}" y="${groundY - 46}" width="18" height="14" fill="#0f1b26"/>

      <!-- outriggers -->
      <line x1="${pivot.x - 46}" y1="${groundY - 2}" x2="${pivot.x - 78}" y2="${groundY}" stroke="#52626d" stroke-width="3"/>
      <line x1="${pivot.x + 46}" y1="${groundY - 2}" x2="${pivot.x + 78}" y2="${groundY}" stroke="#52626d" stroke-width="3"/>

      <!-- boom -->
      <line x1="${pivot.x - 6}" y1="${pivot.y}" x2="${tip.x}" y2="${tip.y}" stroke="#e8a53d" stroke-width="6" stroke-linecap="round"/>
      <line x1="${pivot.x - 6}" y1="${pivot.y}" x2="${tip.x}" y2="${tip.y}" stroke="#b9791f" stroke-width="1.4" stroke-dasharray="1,5"/>

      <!-- hoist line + hook + load -->
      <line x1="${tip.x}" y1="${tip.y}" x2="${hook.x}" y2="${hook.y}" stroke="#52626d" stroke-width="1.4" stroke-dasharray="2,3"/>
      <rect x="${hook.x - 16}" y="${hook.y}" width="32" height="26" rx="2" fill="${loadFill}" stroke="${loadColor}" stroke-width="2"/>
      <text x="${hook.x}" y="${hook.y + 40}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="700" fill="${loadColor}">${fmtNum(p.loadWeight)} t</text>

      <!-- elevation angle arc -->
      <path d="M ${pivot.x - 6 + 30} ${pivot.y} A 30 30 0 0 0 ${pivot.x - 6 + 30*Math.cos(elevRad)} ${pivot.y - 30*Math.sin(elevRad)}" fill="none" stroke="#52626d" stroke-width="1"/>
      <text x="${pivot.x + 34}" y="${pivot.y - 8}" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#52626d">${fmtNum(elevDeg)}°</text>

      ${radiusGroup}
      ${windGroup}

      <!-- verdict -->
      <text x="${W - 16}" y="24" text-anchor="end" font-family="IBM Plex Mono, monospace" font-weight="700" font-size="13" fill="${isValid === false ? '#b23b3b' : (isValid === true ? '#1f7a4d' : '#52626d')}">${isValid === false ? 'NOT ALLOWED' : (isValid === true ? 'ALLOWED' : 'DRAFT')}</text>
      <text x="16" y="${H - 12}" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#9aa9b1">Planning sketch only — not to scale. Verify against the manufacturer's printed load chart.</text>
    </svg>`;
  }

  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  }

  // ---------- shared: rasterize any SVG string/element to a PNG data URL ----------

  function svgStringToPng(svgString, width, height, callback) {
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f6f7f5';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      try { callback(canvas.toDataURL('image/png')); }
      catch (e) { console.error('PNG export failed', e); callback(null); }
    };
    img.onerror = function (e) { console.error('SVG rasterize failed', e); callback(null); };
    img.src = svg64;
  }

  function svgElementToPng(svgEl, width, height, callback) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const str = new XMLSerializer().serializeToString(clone);
    svgStringToPng(str, width, height, callback);
  }

  function downloadDataUrl(dataUrl, filename) {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return {
    mount,
    sketchSVGString,
    svgStringToPng,
    downloadDataUrl,
    compassLabel,
  };
})();
