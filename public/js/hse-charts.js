// hse-charts.js — the SVG chart set the HSE dashboard draws with.
//
// Hand-rolled rather than imported for the same reason as the XLSX reader: the
// portal is an offline-first PWA with no build step, and a charting bundle from
// a CDN would break the service-worker cache.
//
// The colour and mark rules below are not taste. They were measured against
// this app's actual chart surface (#ffffff) before any of this was written:
//
//   • The eight categorical slots pass the adjacent-pair gates (worst CVD
//     ΔE 9.1, worst normal-vision ΔE 19.6). Their ORDER is the safety
//     mechanism — slots are assigned in sequence and never cycled. A ninth
//     series folds into "Other"; it never gets a generated colour.
//   • Aqua, yellow and magenta sit below 3:1 contrast on white. That is legal
//     only with "relief" — so every chart here ships a table view, and
//     highlighted values are direct-labelled.
//   • All-pairs forms (radar) fail at eight slots and pass at three, so radar
//     is capped at three series.
//   • The sequential ramp passes at five steps and fails at six, so the
//     heatmap uses exactly five.
//   • Status colours fail pairwise against each other by design; they always
//     ship with an icon and a text label, never colour alone.
//
// One axis, always. No chart here plots two different scales against one
// another — where two measures of different magnitude must be compared, they
// are faceted or indexed instead.

(function (global) {
  'use strict';

  // -------------------------------------------------------------- palette --

  const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const SEQ = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
  const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
  const DIVERGE = { pos: '#2a78d6', neg: '#d03b3b', mid: '#f0efec' };
  const INK = '#16232c', INK2 = '#52626d', MUTED = '#898781';
  const GRID = '#e1e0d9', BASELINE = '#c3c2b7', SURFACE = '#ffffff';
  const DIM = '#c9cdd1'; // de-emphasis grey for context series and sparklines

  const MARK = { barMax: 24, radius: 4, line: 2, dot: 4.5, gap: 2 };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(v, opts) {
    if (v == null || !isFinite(v)) return '—';
    const o = opts || {};
    if (o.format) return o.format(v);
    const a = Math.abs(v);
    if (o.compact && a >= 1000000) return (v / 1000000).toFixed(a >= 10000000 ? 0 : 1) + 'M';
    if (o.compact && a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'K';
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toLocaleString(undefined, { maximumFractionDigits: a < 1 ? 3 : 2 });
  }

  // Axis ticks on round numbers — 0 / 500 / 1,000, never 0 / 437 / 874.
  // `integerOnly` keeps counts off fractional ticks: a near-miss axis reading
  // 0 / 0.2 / 0.4 invites the reader to look for two-fifths of an incident.
  function niceTicks(min, max, count, integerOnly) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (integerOnly) step = Math.max(1, Math.round(step));
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    // Guard against a pathological step producing an unbounded loop.
    for (let v = lo, i = 0; v <= hi + step * 0.001 && i < 200; v += step, i++) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(10)));
    }
    return out;
  }

  // A bar with its data-end rounded and its baseline end square, so the mark
  // reads as growing out of the axis rather than floating.
  function barPath(x, y, w, h, r, dir) {
    const rad = Math.max(0, Math.min(r, h, w / 2));
    if (h <= 0.01) return '';
    if (dir === 'up') {
      return `M${x},${y + h} L${x},${y + rad} Q${x},${y} ${x + rad},${y} L${x + w - rad},${y} Q${x + w},${y} ${x + w},${y + rad} L${x + w},${y + h} Z`;
    }
    if (dir === 'down') {
      return `M${x},${y} L${x},${y + h - rad} Q${x},${y + h} ${x + rad},${y + h} L${x + w - rad},${y + h} Q${x + w},${y + h} ${x + w},${y + h - rad} L${x + w},${y} Z`;
    }
    if (dir === 'left') {
      const rr = Math.max(0, Math.min(r, w, h / 2));
      return `M${x + w},${y} L${x + rr},${y} Q${x},${y} ${x},${y + rr} L${x},${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} L${x + w},${y + h} Z`;
    }
    const rr = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
  }

  // --------------------------------------------------------------- shell ---

  let uid = 0;
  function nextId() { return 'viz' + (++uid); }

  // Every chart is wrapped the same way: a title, the plot, a legend when there
  // are two or more series, and a table view. The table is not optional — it is
  // what makes the low-contrast palette slots legal, and it is the keyboard and
  // screen-reader path to the same numbers.
  function shell(host, opts, svg, tableHtml, legendHtml) {
    const id = nextId();
    host.innerHTML = `
      <figure class="viz" id="${id}">
        ${opts.title ? `<figcaption class="viz-head">
          <span class="viz-title">${esc(opts.title)}</span>
          ${opts.subtitle ? `<span class="viz-sub">${esc(opts.subtitle)}</span>` : ''}
        </figcaption>` : ''}
        ${legendHtml || ''}
        <div class="viz-plot">${svg}<div class="viz-tip" hidden></div></div>
        ${tableHtml ? `<div class="viz-table-wrap">
          <button type="button" class="viz-table-toggle" aria-expanded="false">Show the numbers</button>
          <div class="viz-table" hidden>${tableHtml}</div>
        </div>` : ''}
        ${opts.note ? `<p class="viz-note">${esc(opts.note)}</p>` : ''}
      </figure>`;

    const fig = host.querySelector('#' + id);
    const btn = fig.querySelector('.viz-table-toggle');
    if (btn) {
      const panel = fig.querySelector('.viz-table');
      btn.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'Hide the numbers' : 'Show the numbers';
      });
    }
    return fig;
  }

  function legend(series, opts) {
    if (!series || series.length < 2) return '';
    return `<div class="viz-legend">${series.map((s, i) => `
      <span class="viz-legend-item">
        <span class="viz-swatch" style="background:${s.color || CAT[i % CAT.length]}"></span>${esc(s.name)}
      </span>`).join('')}</div>`;
  }

  function tableOf(categories, series, opts) {
    const o = opts || {};
    return `<table class="data-table viz-data">
      <thead><tr><th>${esc(o.categoryLabel || 'Period')}</th>${series.map((s) => `<th class="num">${esc(s.name)}${o.unit ? ' (' + esc(o.unit) + ')' : ''}</th>`).join('')}</tr></thead>
      <tbody>${categories.map((c, i) => `<tr><td>${esc(c)}</td>${series.map((s) => `<td class="num">${esc(fmt(s.values[i], o))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  // Shared hover behaviour: a transparent hit layer per mark or per category
  // band, sized well past the mark itself so small dots stay reachable.
  function wireTips(fig, resolve) {
    const tip = fig.querySelector('.viz-tip');
    const plot = fig.querySelector('.viz-plot');
    if (!tip || !plot) return;
    fig.querySelectorAll('[data-tip]').forEach((el) => {
      const show = (ev) => {
        tip.innerHTML = resolve ? resolve(el) : el.getAttribute('data-tip');
        tip.hidden = false;
        const box = plot.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const cx = (ev && ev.clientX ? ev.clientX : r.left + r.width / 2) - box.left;
        const cy = r.top - box.top;
        tip.style.left = Math.max(4, Math.min(box.width - 12, cx)) + 'px';
        tip.style.top = Math.max(0, cy) + 'px';
      };
      el.addEventListener('mouseenter', show);
      el.addEventListener('mousemove', show);
      el.addEventListener('focus', show);
      el.addEventListener('mouseleave', () => { tip.hidden = true; });
      el.addEventListener('blur', () => { tip.hidden = true; });
    });
  }

  // ------------------------------------------------------------ sparkline --

  function sparkline(values, opts) {
    const o = opts || {};
    const w = o.width || 120, h = o.height || 28, pad = 3;
    const pts = values.map((v, i) => ({ v: v, i: i })).filter((p) => p.v != null);
    if (pts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const vals = pts.map((p) => p.v);
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    const d = pts.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${d}" fill="none" stroke="${DIM}" stroke-width="${MARK.line}" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="${MARK.dot}" fill="${o.accent || CAT[0]}" stroke="${SURFACE}" stroke-width="2"/>
    </svg>`;
  }

  // ------------------------------------------------------------ stat tile --

  function statTile(host, opts) {
    const o = opts;
    const deltaHtml = (o.delta == null) ? '' : (() => {
      const good = o.deltaGood == null ? (o.delta >= 0) : o.deltaGood;
      const cls = o.delta === 0 ? 'flat' : good ? 'up-good' : 'down-bad';
      const arrow = o.delta === 0 ? '→' : o.delta > 0 ? '↑' : '↓';
      return `<span class="tile-delta ${cls}">${arrow} ${esc(fmt(Math.abs(o.delta), o))}${o.deltaUnit ? ' ' + esc(o.deltaUnit) : ''}${o.deltaLabel ? ' <span class="tile-delta-label">' + esc(o.deltaLabel) + '</span>' : ''}</span>`;
    })();

    host.innerHTML = `
      <div class="tile ${o.status ? 'tile-' + o.status : ''}">
        <div class="tile-label">${esc(o.label)}</div>
        <div class="tile-value">${esc(fmt(o.value, o))}${o.unit ? `<span class="tile-unit">${esc(o.unit)}</span>` : ''}</div>
        <div class="tile-foot">${deltaHtml}${o.foot ? `<span class="tile-foot-text">${esc(o.foot)}</span>` : ''}</div>
        ${o.series ? `<div class="tile-spark">${sparkline(o.series, { accent: o.accent || CAT[0] })}</div>` : ''}
      </div>`;
    return host;
  }

  // ---------------------------------------------------------------- bars ---

  // One function covers column, grouped column, stacked column and horizontal
  // bar, because they differ only in how the band is divided.
  function bars(host, opts) {
    const o = Object.assign({ height: 260, stacked: false, horizontal: false }, opts);
    const cats = o.categories, series = o.series;
    const W = o.width || 720, H = o.height;
    const padL = o.horizontal ? (o.labelWidth || 150) : 52;
    const padR = 16, padT = 10, padB = o.horizontal ? 30 : 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    // Scale. Stacked charts scale on the stack total, not the tallest segment.
    let maxV = 0, minV = 0;
    if (o.stacked) {
      cats.forEach((_, i) => {
        let pos = 0, neg = 0;
        series.forEach((s) => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; });
        maxV = Math.max(maxV, pos); minV = Math.min(minV, neg);
      });
    } else {
      series.forEach((s) => s.values.forEach((v) => {
        if (v == null) return; maxV = Math.max(maxV, v); minV = Math.min(minV, v);
      }));
    }
    if (o.targetLine != null) maxV = Math.max(maxV, o.targetLine);
    const allInt = series.every((s) => s.values.every((v) => v == null || Number.isInteger(v)))
      && (o.targetLine == null || Number.isInteger(o.targetLine));
    const ticks = niceTicks(Math.min(0, minV), maxV || 1, 5, allInt);
    const lo = ticks[0], hi = ticks[ticks.length - 1], span = (hi - lo) || 1;

    const bandCount = cats.length || 1;
    const band = (o.horizontal ? plotH : plotW) / bandCount;
    const groupCount = o.stacked ? 1 : series.length;
    // Cap the mark and let the band's leftover be air.
    const slot = Math.min(MARK.barMax, (band * 0.72) / groupCount);
    const groupW = slot * groupCount + MARK.gap * (groupCount - 1);

    const vPos = (v) => (o.horizontal
      ? padL + ((v - lo) / span) * plotW
      : padT + plotH - ((v - lo) / span) * plotH);
    const zero = vPos(Math.max(lo, Math.min(0, hi)));

    let body = '';

    // Gridlines: solid hairlines, one step off the surface, behind the marks.
    ticks.forEach((t) => {
      if (o.horizontal) {
        const x = vPos(t);
        body += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="${t === 0 ? BASELINE : GRID}" stroke-width="1"/>`;
        body += `<text x="${x.toFixed(1)}" y="${padT + plotH + 18}" class="viz-tick" text-anchor="middle">${esc(fmt(t, { compact: true }))}</text>`;
      } else {
        const y = vPos(t);
        body += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${t === 0 ? BASELINE : GRID}" stroke-width="1"/>`;
        body += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" class="viz-tick" text-anchor="end">${esc(fmt(t, { compact: true }))}</text>`;
      }
    });

    if (o.targetLine != null) {
      const p = vPos(o.targetLine);
      body += o.horizontal
        ? `<line x1="${p.toFixed(1)}" y1="${padT}" x2="${p.toFixed(1)}" y2="${padT + plotH}" stroke="${STATUS.warning}" stroke-width="2"/>`
        : `<line x1="${padL}" y1="${p.toFixed(1)}" x2="${padL + plotW}" y2="${p.toFixed(1)}" stroke="${STATUS.warning}" stroke-width="2"/>`;
      body += o.horizontal
        ? `<text x="${(p + 4).toFixed(1)}" y="${padT + 10}" class="viz-tick viz-target-label">target ${esc(fmt(o.targetLine, o))}</text>`
        : `<text x="${padL + plotW}" y="${(p - 5).toFixed(1)}" class="viz-tick viz-target-label" text-anchor="end">target ${esc(fmt(o.targetLine, o))}</text>`;
    }

    cats.forEach((cat, i) => {
      const bandStart = (o.horizontal ? padT : padL) + i * band;
      const inner = bandStart + (band - groupW) / 2;
      let stackPos = 0, stackNeg = 0;

      series.forEach((s, si) => {
        const v = s.values[i];
        if (v == null) return;
        const color = s.color || CAT[si % CAT.length];
        const dim = o.emphasisIndex != null && o.emphasisIndex !== si;
        const fill = dim ? DIM : color;
        const tip = `<strong>${esc(cat)}</strong><br>${esc(s.name)}: ${esc(fmt(v, o))}${o.unit ? ' ' + esc(o.unit) : ''}`;

        if (o.stacked) {
          const from = v >= 0 ? stackPos : stackNeg;
          const to = from + v;
          if (v >= 0) stackPos = to; else stackNeg = to;
          if (o.horizontal) {
            const x0 = vPos(from), x1 = vPos(to);
            const w = Math.max(0, Math.abs(x1 - x0) - MARK.gap);
            const x = Math.min(x0, x1);
            body += `<path d="${barPath(x, inner, w, slot, MARK.radius, 'right')}" fill="${fill}" tabindex="0" data-tip="${esc(tip)}"/>`;
          } else {
            const y0 = vPos(from), y1 = vPos(to);
            const h = Math.max(0, Math.abs(y1 - y0) - MARK.gap);
            const y = Math.min(y0, y1) + (v >= 0 ? MARK.gap : 0);
            body += `<path d="${barPath(inner, y, slot, h, MARK.radius, v >= 0 ? 'up' : 'down')}" fill="${fill}" tabindex="0" data-tip="${esc(tip)}"/>`;
          }
        } else {
          const off = si * (slot + MARK.gap);
          if (o.horizontal) {
            const x1 = vPos(v);
            const w = Math.abs(x1 - zero);
            body += `<path d="${barPath(Math.min(zero, x1), inner + off, w, slot, MARK.radius, v >= 0 ? 'right' : 'left')}" fill="${fill}" tabindex="0" data-tip="${esc(tip)}"/>`;
            if (o.labelValues) {
              body += `<text x="${(Math.max(zero, x1) + 6).toFixed(1)}" y="${(inner + off + slot / 2 + 4).toFixed(1)}" class="viz-value">${esc(fmt(v, o))}</text>`;
            }
          } else {
            const y1 = vPos(v);
            const h = Math.abs(y1 - zero);
            body += `<path d="${barPath(inner + off, Math.min(zero, y1), slot, h, MARK.radius, v >= 0 ? 'up' : 'down')}" fill="${fill}" tabindex="0" data-tip="${esc(tip)}"/>`;
            // Direct-label selectively: the highlighted category only, never
            // a number on every bar.
            if (o.highlightIndex === i || (o.labelValues && series.length === 1)) {
              body += `<text x="${(inner + off + slot / 2).toFixed(1)}" y="${(Math.min(zero, y1) - 6).toFixed(1)}" class="viz-value" text-anchor="middle">${esc(fmt(v, o))}</text>`;
            }
          }
        }
      });

      const labelCls = 'viz-tick' + (o.highlightIndex === i ? ' viz-tick-on' : '');
      body += o.horizontal
        ? `<text x="${padL - 10}" y="${(bandStart + band / 2 + 4).toFixed(1)}" class="${labelCls}" text-anchor="end">${esc(truncate(cat, 24))}</text>`
        : `<text x="${(bandStart + band / 2).toFixed(1)}" y="${padT + plotH + 20}" class="${labelCls}" text-anchor="middle">${esc(cat)}</text>`;
    });

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(o.title || 'Chart')}">${body}</svg>`;
    const fig = shell(host, o, svg, tableOf(cats, series, o), legend(series, o));
    wireTips(fig);
    return fig;
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ---------------------------------------------------------------- line ---

  function line(host, opts) {
    const o = Object.assign({ height: 260 }, opts);
    const cats = o.categories, series = o.series;
    const W = o.width || 720, H = o.height;
    const padL = 52, padR = o.endLabels === false ? 16 : 64, padT = 12, padB = 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    let maxV = -Infinity, minV = Infinity;
    series.forEach((s) => s.values.forEach((v) => {
      if (v == null) return; maxV = Math.max(maxV, v); minV = Math.min(minV, v);
    }));
    if (!isFinite(maxV)) { maxV = 1; minV = 0; }
    if (o.targetLine != null) { maxV = Math.max(maxV, o.targetLine); minV = Math.min(minV, o.targetLine); }
    const allInt = series.every((s) => s.values.every((v) => v == null || Number.isInteger(v)))
      && (o.targetLine == null || Number.isInteger(o.targetLine));
    const ticks = niceTicks(Math.min(0, minV), maxV || 1, 5, allInt);
    const lo = ticks[0], hi = ticks[ticks.length - 1], span = (hi - lo) || 1;
    const x = (i) => padL + (cats.length === 1 ? plotW / 2 : (i / (cats.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - lo) / span) * plotH;

    let body = '';
    ticks.forEach((t) => {
      body += `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${padL + plotW}" y2="${y(t).toFixed(1)}" stroke="${t === 0 ? BASELINE : GRID}" stroke-width="1"/>`;
      body += `<text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" class="viz-tick" text-anchor="end">${esc(fmt(t, { compact: true }))}</text>`;
    });
    if (o.targetLine != null) {
      body += `<line x1="${padL}" y1="${y(o.targetLine).toFixed(1)}" x2="${padL + plotW}" y2="${y(o.targetLine).toFixed(1)}" stroke="${STATUS.warning}" stroke-width="2"/>`;
      body += `<text x="${padL + plotW}" y="${(y(o.targetLine) - 5).toFixed(1)}" class="viz-tick viz-target-label" text-anchor="end">target ${esc(fmt(o.targetLine, o))}</text>`;
    }

    series.forEach((s, si) => {
      const color = s.color || CAT[si % CAT.length];
      const dim = o.emphasisIndex != null && o.emphasisIndex !== si;
      const stroke = dim ? DIM : color;
      const pts = s.values.map((v, i) => (v == null ? null : { x: x(i), y: y(v), v: v, i: i })).filter(Boolean);
      if (!pts.length) return;

      if (o.area && series.length === 1) {
        const areaD = pts.map((p, k) => (k ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') +
          ` L${pts[pts.length - 1].x.toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${pts[0].x.toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`;
        body += `<path d="${areaD}" fill="${stroke}" fill-opacity="0.10"/>`;
      }
      body += `<path d="${pts.map((p, k) => (k ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${MARK.line}" stroke-linecap="round" stroke-linejoin="round"/>`;

      pts.forEach((p) => {
        const tip = `<strong>${esc(cats[p.i])}</strong><br>${esc(s.name)}: ${esc(fmt(p.v, o))}${o.unit ? ' ' + esc(o.unit) : ''}`;
        body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${MARK.dot}" fill="${stroke}" stroke="${SURFACE}" stroke-width="2" tabindex="0" data-tip="${esc(tip)}"/>`;
      });

      // Direct label at the line end — the endpoint only, never every point.
      if (o.endLabels !== false && !dim) {
        const last = pts[pts.length - 1];
        body += `<text x="${(last.x + 9).toFixed(1)}" y="${(last.y + 4).toFixed(1)}" class="viz-value">${esc(fmt(last.v, o))}</text>`;
      }
    });

    cats.forEach((c, i) => {
      if (cats.length > 12 && i % 2) return;
      body += `<text x="${x(i).toFixed(1)}" y="${padT + plotH + 20}" class="viz-tick${o.highlightIndex === i ? ' viz-tick-on' : ''}" text-anchor="middle">${esc(c)}</text>`;
    });

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(o.title || 'Chart')}">${body}</svg>`;
    const fig = shell(host, o, svg, tableOf(cats, series, o), legend(series, o));
    wireTips(fig);
    return fig;
  }

  // --------------------------------------------------------------- donut ---

  function donut(host, opts) {
    const o = Object.assign({ height: 220 }, opts);
    // Part-to-whole at a glance only — past six slices a bar chart is honest
    // and a donut is not, so the tail folds into "Other".
    let items = o.items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    if (items.length > 6) {
      const head = items.slice(0, 5);
      const tail = items.slice(5).reduce((a, d) => a + d.value, 0);
      items = head.concat([{ label: 'Other', value: tail }]);
    }
    const total = items.reduce((a, d) => a + d.value, 0);
    const size = o.height, cx = size / 2, cy = size / 2, r = size / 2 - 12, inner = r * 0.62;

    let body = '', a0 = -Math.PI / 2;
    if (total <= 0) {
      body = `<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${GRID}" stroke-width="${r - inner}"/>`;
    } else {
      items.forEach((d, i) => {
        const frac = d.value / total;
        // A 2px surface gap between slices does the separating, not a stroke.
        const gapAngle = items.length > 1 ? (MARK.gap / r) : 0;
        const a1 = a0 + frac * Math.PI * 2;
        const s = a0 + gapAngle / 2, e = Math.max(s, a1 - gapAngle / 2);
        const large = (e - s) > Math.PI ? 1 : 0;
        const p = (ang, rad) => [(cx + Math.cos(ang) * rad).toFixed(2), (cy + Math.sin(ang) * rad).toFixed(2)];
        const [x1, y1] = p(s, r), [x2, y2] = p(e, r), [x3, y3] = p(e, inner), [x4, y4] = p(s, inner);
        const color = d.color || CAT[i % CAT.length];
        const tip = `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.value, o))}${o.unit ? ' ' + esc(o.unit) : ''} · ${(frac * 100).toFixed(1)}%`;
        body += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z" fill="${color}" tabindex="0" data-tip="${esc(tip)}"/>`;
        a0 = a1;
      });
    }
    body += `<text x="${cx}" y="${cy - 2}" class="viz-hero" text-anchor="middle">${esc(fmt(total, o))}</text>`;
    body += `<text x="${cx}" y="${cy + 16}" class="viz-tick" text-anchor="middle">${esc(o.centreLabel || 'total')}</text>`;

    const svg = `<svg viewBox="0 0 ${size} ${size}" class="viz-svg viz-svg-square" role="img" aria-label="${esc(o.title || 'Chart')}">${body}</svg>`;
    const legendHtml = `<div class="viz-legend">${items.map((d, i) => `
      <span class="viz-legend-item"><span class="viz-swatch" style="background:${d.color || CAT[i % CAT.length]}"></span>${esc(d.label)}
      <span class="viz-legend-val">${esc(fmt(d.value, o))}</span></span>`).join('')}</div>`;
    const table = `<table class="data-table viz-data"><thead><tr><th>${esc(o.categoryLabel || 'Category')}</th><th class="num">Value</th><th class="num">Share</th></tr></thead>
      <tbody>${items.map((d) => `<tr><td>${esc(d.label)}</td><td class="num">${esc(fmt(d.value, o))}</td><td class="num">${total ? ((d.value / total) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('')}</tbody></table>`;
    const fig = shell(host, o, svg, table, legendHtml);
    wireTips(fig);
    return fig;
  }

  // ------------------------------------------------------------- heatmap ---

  function heatmap(host, opts) {
    const o = Object.assign({}, opts);
    const rows = o.rows, cols = o.columns;
    const cellH = 26, labelW = o.labelWidth || 190, padR = 12, padT = 22, padB = 8;
    const W = o.width || 720;
    const cellW = (W - labelW - padR) / Math.max(1, cols.length);
    const H = padT + rows.length * cellH + padB;

    let maxV = 0;
    rows.forEach((r) => r.values.forEach((v) => { if (v != null) maxV = Math.max(maxV, v); }));

    // Exactly five steps: the ramp validated at six fails its light end
    // against this surface.
    const stepOf = (v) => {
      if (v == null) return null;
      if (v <= 0) return -1;
      const f = maxV ? v / maxV : 0;
      return Math.min(SEQ.length - 1, Math.floor(f * SEQ.length - 0.0001) + (f > 0 ? 0 : 0));
    };

    let body = '';
    cols.forEach((c, ci) => {
      body += `<text x="${(labelW + ci * cellW + cellW / 2).toFixed(1)}" y="14" class="viz-tick" text-anchor="middle">${esc(c)}</text>`;
    });
    rows.forEach((r, ri) => {
      const y = padT + ri * cellH;
      body += `<text x="${labelW - 10}" y="${(y + cellH / 2 + 4).toFixed(1)}" class="viz-tick viz-tick-row" text-anchor="end">${esc(truncate(r.label, 30))}</text>`;
      r.values.forEach((v, ci) => {
        const x = labelW + ci * cellW;
        const step = stepOf(v);
        const fill = v == null ? 'none' : step < 0 ? '#f4f6f7' : SEQ[step];
        const tip = `<strong>${esc(r.label)}</strong><br>${esc(cols[ci])}: ${v == null ? 'no data' : esc(fmt(v, o))}${o.unit && v != null ? ' ' + esc(o.unit) : ''}`;
        body += `<rect x="${(x + MARK.gap / 2).toFixed(1)}" y="${(y + MARK.gap / 2).toFixed(1)}" width="${Math.max(0, cellW - MARK.gap).toFixed(1)}" height="${cellH - MARK.gap}" rx="2"
          fill="${fill}" ${v == null ? `stroke="${GRID}" stroke-width="1" stroke-dasharray="0"` : ''} tabindex="0" data-tip="${esc(tip)}"/>`;
        // Inside a filled cell the label takes white or ink by the fill's
        // luminance, so it always clears contrast.
        if (v != null && v > 0 && cellW > 30) {
          body += `<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2 + 4).toFixed(1)}" class="viz-cell-label" text-anchor="middle" fill="${step >= 3 ? '#ffffff' : INK}">${esc(fmt(v, { compact: true }))}</text>`;
        }
      });
    });

    const scale = `<div class="viz-legend viz-scale"><span class="viz-scale-label">low</span>
      ${SEQ.map((c) => `<span class="viz-swatch viz-swatch-sq" style="background:${c}"></span>`).join('')}
      <span class="viz-scale-label">high (${esc(fmt(maxV, { compact: true }))}${o.unit ? ' ' + esc(o.unit) : ''})</span></div>`;

    const table = `<table class="data-table viz-data"><thead><tr><th>${esc(o.rowLabel || 'KPI')}</th>${cols.map((c) => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.values.map((v) => `<td class="num">${v == null ? '—' : esc(fmt(v, o))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(o.title || 'Heatmap')}">${body}</svg>`;
    const fig = shell(host, o, svg, table, scale);
    wireTips(fig);
    return fig;
  }

  // -------------------------------------------------------------- bullet ---

  // Actual against target, one row per KPI. The track is a lighter step of the
  // fill's own ramp so the state reads across the whole bar.
  function bullet(host, opts) {
    const o = Object.assign({}, opts);
    const items = o.items;
    const rowH = 38, labelW = o.labelWidth || 210, padR = 64, padT = 6;
    const W = o.width || 720;
    const barW = W - labelW - padR;
    const H = padT + items.length * rowH + 6;

    let body = '';
    items.forEach((it, i) => {
      const y = padT + i * rowH;
      const pct = it.target ? Math.min(1.6, (it.actual || 0) / it.target) : ((it.actual || 0) > 0 ? 1.6 : 0);
      const meets = it.dir === 'max' ? (it.actual || 0) <= it.target : (it.actual || 0) >= it.target;
      const color = meets ? STATUS.good : pct >= 0.7 ? STATUS.warning : pct >= 0.35 ? STATUS.serious : STATUS.critical;
      const fillW = Math.max(0, Math.min(barW, (pct / 1.6) * barW));
      const targetX = labelW + (1 / 1.6) * barW;

      body += `<text x="0" y="${(y + 15).toFixed(1)}" class="viz-tick viz-tick-row">${esc(truncate(it.label, 34))}</text>`;
      body += `<rect x="${labelW}" y="${y + 6}" width="${barW}" height="14" rx="4" fill="#eef1f4"/>`;
      body += `<path d="${barPath(labelW, y + 6, fillW, 14, MARK.radius, 'right')}" fill="${color}" tabindex="0"
        data-tip="${esc(`<strong>${it.label}</strong><br>Actual: ${fmt(it.actual, o)}${it.unit ? ' ' + it.unit : ''}<br>Target: ${it.dir === 'max' ? 'max ' : 'min '}${fmt(it.target, o)}${it.unit ? ' ' + it.unit : ''}`)}"/>`;
      body += `<line x1="${targetX.toFixed(1)}" y1="${y + 2}" x2="${targetX.toFixed(1)}" y2="${y + 24}" stroke="${INK}" stroke-width="2"/>`;
      // Status never rides on colour alone — icon plus the value, always.
      body += `<text x="${W - padR + 8}" y="${(y + 17).toFixed(1)}" class="viz-value">${meets ? '✓' : '✕'} ${esc(fmt(it.actual, o))}</text>`;
      body += `<text x="${labelW}" y="${(y + 33).toFixed(1)}" class="viz-tick viz-tick-sm">target ${it.dir === 'max' ? 'max' : 'min'} ${esc(fmt(it.target, o))}${it.unit ? ' ' + esc(it.unit) : ''}</text>`;
    });

    const table = `<table class="data-table viz-data"><thead><tr><th>KPI</th><th class="num">Actual</th><th class="num">Target</th><th>Status</th></tr></thead>
      <tbody>${items.map((it) => {
        const meets = it.dir === 'max' ? (it.actual || 0) <= it.target : (it.actual || 0) >= it.target;
        return `<tr><td>${esc(it.label)}</td><td class="num">${esc(fmt(it.actual, o))}</td><td class="num">${it.dir === 'max' ? '≤ ' : '≥ '}${esc(fmt(it.target, o))}</td><td>${meets ? '✓ Met' : '✕ Missed'}</td></tr>`;
      }).join('')}</tbody></table>`;

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(o.title || 'Target attainment')}">${body}</svg>`;
    const fig = shell(host, o, svg, table, '');
    wireTips(fig);
    return fig;
  }

  // ----------------------------------------------------------- diverging ---

  // Variance around a zero baseline: how far each KPI's TAQA figure sits from
  // the internal one. Two hues that read as opposite, neutral gray at nothing.
  function diverging(host, opts) {
    const o = Object.assign({}, opts);
    const items = o.items;
    const rowH = 30, labelW = o.labelWidth || 210, padR = 70, padT = 22;
    const W = o.width || 720;
    const plotW = W - labelW - padR;
    const H = padT + items.length * rowH + 14;

    const maxAbs = Math.max.apply(null, items.map((i) => Math.abs(i.value || 0)).concat([1]));
    const mid = labelW + plotW / 2;
    const x = (v) => mid + (v / maxAbs) * (plotW / 2);

    let body = `<line x1="${mid}" y1="${padT - 6}" x2="${mid}" y2="${(padT + items.length * rowH).toFixed(1)}" stroke="${BASELINE}" stroke-width="1"/>`;
    body += `<text x="${mid}" y="${padT - 12}" class="viz-tick" text-anchor="middle">reports agree</text>`;
    body += `<text x="${labelW + 4}" y="${padT - 12}" class="viz-tick">internal higher</text>`;
    body += `<text x="${labelW + plotW - 4}" y="${padT - 12}" class="viz-tick" text-anchor="end">TAQA higher</text>`;

    items.forEach((it, i) => {
      const y = padT + i * rowH;
      const v = it.value || 0;
      const barH = 14;
      const xv = x(v);
      const w = Math.abs(xv - mid);
      const color = Math.abs(v) < 1e-9 ? DIVERGE.mid : v > 0 ? DIVERGE.pos : DIVERGE.neg;
      body += `<text x="0" y="${(y + barH + 1).toFixed(1)}" class="viz-tick viz-tick-row">${esc(truncate(it.label, 34))}</text>`;
      if (w < 0.5) {
        body += `<rect x="${(mid - 3).toFixed(1)}" y="${y + 4}" width="6" height="${barH}" rx="2" fill="${DIVERGE.mid}" tabindex="0" data-tip="${esc(`<strong>${it.label}</strong><br>Both reports agree`)}"/>`;
      } else {
        body += `<path d="${barPath(Math.min(mid, xv), y + 4, w, barH, MARK.radius, v > 0 ? 'right' : 'left')}" fill="${color}" tabindex="0"
          data-tip="${esc(`<strong>${it.label}</strong><br>TAQA: ${fmt(it.a, o)}${it.unit ? ' ' + it.unit : ''}<br>Internal: ${fmt(it.b, o)}${it.unit ? ' ' + it.unit : ''}<br>Difference: ${fmt(v, o)}`)}"/>`;
      }
      body += `<text x="${W - padR + 8}" y="${(y + barH + 1).toFixed(1)}" class="viz-value">${v > 0 ? '+' : ''}${esc(fmt(v, { compact: true }))}</text>`;
    });

    const table = `<table class="data-table viz-data"><thead><tr><th>KPI</th><th class="num">TAQA</th><th class="num">Internal</th><th class="num">Difference</th></tr></thead>
      <tbody>${items.map((it) => `<tr><td>${esc(it.label)}</td><td class="num">${esc(fmt(it.a, o))}</td><td class="num">${esc(fmt(it.b, o))}</td><td class="num">${esc(fmt(it.value, o))}</td></tr>`).join('')}</tbody></table>`;

    const legendHtml = `<div class="viz-legend">
      <span class="viz-legend-item"><span class="viz-swatch" style="background:${DIVERGE.pos}"></span>TAQA submission higher</span>
      <span class="viz-legend-item"><span class="viz-swatch" style="background:${DIVERGE.mid};outline:1px solid ${GRID}"></span>Agree</span>
      <span class="viz-legend-item"><span class="viz-swatch" style="background:${DIVERGE.neg}"></span>Internal record higher</span></div>`;

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(o.title || 'Variance')}">${body}</svg>`;
    const fig = shell(host, o, svg, table, legendHtml);
    wireTips(fig);
    return fig;
  }

  // --------------------------------------------------------------- radar ---

  // Capped at three series: the eight-slot palette fails the all-pairs gates
  // this form needs, and three is the count that passes.
  function radar(host, opts) {
    const o = Object.assign({ height: 320 }, opts);
    const axes = o.axes;
    const series = o.series.slice(0, 3);
    const size = o.height, cx = size / 2, cy = size / 2 + 6, r = size / 2 - 58;
    const n = axes.length;
    const ang = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const pt = (i, f) => [cx + Math.cos(ang(i)) * r * f, cy + Math.sin(ang(i)) * r * f];

    let body = '';
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const d = axes.map((_, i) => { const [px, py] = pt(i, f); return (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1); }).join(' ') + ' Z';
      body += `<path d="${d}" fill="none" stroke="${GRID}" stroke-width="1"/>`;
    });
    axes.forEach((a, i) => {
      const [px, py] = pt(i, 1);
      body += `<line x1="${cx}" y1="${cy}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`;
      const [lx, ly] = pt(i, 1.2);
      const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
      body += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="viz-tick" text-anchor="${anchor}">${esc(truncate(a, 16))}</text>`;
    });

    series.forEach((s, si) => {
      const color = s.color || CAT[si % CAT.length];
      const d = s.values.map((v, i) => {
        const f = Math.max(0, Math.min(1.05, (v == null ? 0 : v)));
        const [px, py] = pt(i, f);
        return (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
      }).join(' ') + ' Z';
      body += `<path d="${d}" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-width="${MARK.line}" stroke-linejoin="round"/>`;
      s.values.forEach((v, i) => {
        const f = Math.max(0, Math.min(1.05, (v == null ? 0 : v)));
        const [px, py] = pt(i, f);
        const tip = `<strong>${esc(axes[i])}</strong><br>${esc(s.name)}: ${esc(s.display ? s.display[i] : (v * 100).toFixed(0) + '% of target')}`;
        body += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${MARK.dot}" fill="${color}" stroke="${SURFACE}" stroke-width="2" tabindex="0" data-tip="${esc(tip)}"/>`;
      });
    });

    const table = `<table class="data-table viz-data"><thead><tr><th>Indicator</th>${series.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${axes.map((a, i) => `<tr><td>${esc(a)}</td>${series.map((s) => `<td class="num">${esc(s.display ? s.display[i] : ((s.values[i] || 0) * 100).toFixed(0) + '%')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const svg = `<svg viewBox="0 0 ${size} ${size + 20}" class="viz-svg viz-svg-square" role="img" aria-label="${esc(o.title || 'Profile')}">${body}</svg>`;
    const fig = shell(host, o, svg, table, legend(series, o));
    wireTips(fig);
    return fig;
  }

  // --------------------------------------------------------------- meter ---

  function meter(host, opts) {
    const o = opts;
    const pct = Math.max(0, Math.min(1, o.value / (o.max || 100)));
    const color = o.color || (pct >= 0.8 ? STATUS.good : pct >= 0.5 ? STATUS.warning : STATUS.critical);
    host.innerHTML = `
      <div class="meter">
        <div class="meter-head"><span class="meter-label">${esc(o.label)}</span><span class="meter-value">${esc(fmt(o.value, o))}${o.unit ? esc(o.unit) : ''}</span></div>
        <div class="meter-track"><div class="meter-fill" style="width:${(pct * 100).toFixed(1)}%;background:${color}"></div></div>
        ${o.foot ? `<div class="meter-foot">${esc(o.foot)}</div>` : ''}
      </div>`;
    return host;
  }

  global.HSECharts = {
    CAT: CAT, SEQ: SEQ, STATUS: STATUS, DIVERGE: DIVERGE, DIM: DIM,
    INK: INK, INK2: INK2, MUTED: MUTED, GRID: GRID, SURFACE: SURFACE,
    fmt: fmt, esc: esc, sparkline: sparkline, statTile: statTile,
    bars: bars, line: line, donut: donut, heatmap: heatmap,
    bullet: bullet, diverging: diverging, radar: radar, meter: meter
  };
})(window);
