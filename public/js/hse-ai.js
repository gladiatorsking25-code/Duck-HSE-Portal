// hse-ai.js — the dashboard's on-device analyst.
//
// "Local" here means local in both senses, and there are two layers:
//
//   1. THE ENGINE (always present, always offline). A deterministic analyst
//      that resolves a plain-English question to a KPI, a period and an
//      operation, then answers it by reading the parsed dataset. It never
//      guesses a number — every figure it returns came out of one of the two
//      uploaded workbooks. It also writes the reports: executive summary,
//      monthly narrative, gap analysis, action plan, client cover note.
//
//   2. THE BRIDGE (optional). If a local model server is running on this
//      machine — Ollama, LM Studio, llama.cpp, anything speaking the Ollama or
//      OpenAI chat API — the free-text box can route through it for phrasing
//      and open-ended reasoning, with a compact digest of the real data
//      injected as context. Nothing leaves the machine: the endpoint is
//      localhost by default and there is no cloud fallback. If no server
//      answers, questions fall back to the engine rather than failing.
//
// The engine is the floor, not the fallback of last resort. It is the part
// that is accountable for the numbers.

(function (global) {
  'use strict';

  const LLM_STORE = 'cla_hse_llm';
  const DEFAULT_LLM = {
    enabled: false,
    baseUrl: 'http://localhost:11434',
    model: '',
    api: 'auto',          // 'auto' | 'ollama' | 'openai'
    temperature: 0.2,
    timeoutMs: 120000
  };

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmt = (v, unit) => HSEAnalysis.fmtNum(v, unit);
  const MONTHS = () => HSEParser.MONTH_NAMES;

  // --------------------------------------------------------------- config --

  function loadLlm() {
    try {
      const raw = localStorage.getItem(LLM_STORE);
      return raw ? Object.assign({}, DEFAULT_LLM, JSON.parse(raw)) : Object.assign({}, DEFAULT_LLM);
    } catch (e) { return Object.assign({}, DEFAULT_LLM); }
  }
  function saveLlm(cfg) {
    try { localStorage.setItem(LLM_STORE, JSON.stringify(cfg)); return true; } catch (e) { return false; }
  }

  // Probes a local server and reports which API it speaks and what it has
  // loaded. Both shapes are tried because the two ecosystems split on it.
  async function probeLlm(cfg) {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return { ok: false, error: 'No endpoint set.' };
    const tryFetch = async (path) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(base + path, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        return await res.json();
      } catch (e) { clearTimeout(t); return null; }
    };

    if (cfg.api !== 'openai') {
      const tags = await tryFetch('/api/tags');
      if (tags && Array.isArray(tags.models)) {
        return { ok: true, api: 'ollama', models: tags.models.map((m) => m.name || m.model).filter(Boolean) };
      }
    }
    if (cfg.api !== 'ollama') {
      const models = await tryFetch('/v1/models');
      if (models && Array.isArray(models.data)) {
        return { ok: true, api: 'openai', models: models.data.map((m) => m.id).filter(Boolean) };
      }
    }
    return {
      ok: false,
      error: 'No local model server answered at ' + base + '. Start Ollama (ollama serve) or LM Studio\'s ' +
        'local server, then try again. Everything still works without it — the built-in engine answers from the data directly.'
    };
  }

  async function callLlm(cfg, messages) {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    const api = cfg.api === 'auto' ? (cfg.detectedApi || 'ollama') : cfg.api;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 120000);
    try {
      let res, data;
      if (api === 'ollama') {
        res = await fetch(base + '/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({
            model: cfg.model, messages: messages, stream: false,
            options: { temperature: cfg.temperature }
          })
        });
        if (!res.ok) throw new Error('Local model returned HTTP ' + res.status);
        data = await res.json();
        return (data.message && data.message.content) || '';
      }
      res = await fetch(base + '/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: cfg.model, messages: messages, temperature: cfg.temperature, stream: false })
      });
      if (!res.ok) throw new Error('Local model returned HTTP ' + res.status);
      data = await res.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    } finally { clearTimeout(timer); }
  }

  // ------------------------------------------------------------- vocabulary -

  // Everyday words for KPIs that the form names formally. Matching is scored
  // rather than exact, so partial and misspelt questions still land.
  const SYNONYMS = {
    employees: ['workforce', 'headcount', 'manpower', 'people', 'staff', 'workers', 'employees', 'crew'],
    manhours: ['manhours', 'man hours', 'hours worked', 'exposure', 'worked hours'],
    trainingHours: ['training', 'trained', 'training hours', 'courses'],
    avgTrainingHours: ['training per employee', 'training per person', 'average training'],
    inspections: ['inspection', 'inspections', 'walkdowns', 'site walks'],
    audits: ['audit', 'audits', 'auditing'],
    nearMiss: ['near miss', 'near misses', 'nearmiss', 'close call'],
    unsafeActs: ['unsafe act', 'unsafe acts', 'observations acts'],
    unsafeConditions: ['unsafe condition', 'unsafe conditions'],
    toolboxTalks: ['toolbox', 'tool box', 'tbt', 'briefing'],
    lti: ['lti', 'lost time injury', 'lost time'],
    ltifr: ['ltifr', 'frequency rate', 'injury frequency'],
    ltisr: ['ltisr', 'severity rate'],
    trcf: ['trcf', 'recordable frequency', 'total recordable'],
    firstAid: ['first aid', 'firstaid'],
    mtc: ['mtc', 'medical treatment'],
    rwc: ['rwc', 'restricted work'],
    fatality: ['fatality', 'fatalities', 'death', 'deaths'],
    rta: ['road traffic', 'vehicle accident', 'rta', 'driving'],
    propertyDamage: ['property damage', 'equipment damage'],
    drills: ['drill', 'drills', 'evacuation', 'emergency drill', 'mock drill'],
    meetings: ['meeting', 'meetings', 'hse committee'],
    permitExcavation: ['excavation permit', 'excavation permits', 'digging permit'],
    permitConfined: ['confined space', 'confined space permit'],
    permitHotWork: ['hot work', 'hot work permit', 'welding permit'],
    permitOther: ['other permits'],
    ptwAudited: ['permit audit', 'ptw audit', 'permits audited'],
    waterConsumption: ['water', 'water use', 'water consumption'],
    powerConsumption: ['electricity', 'power', 'kwh', 'energy'],
    fuelConsumption: ['fuel', 'diesel and petrol', 'fuel consumption'],
    dieselQty: ['diesel'],
    petrolQty: ['petrol', 'gasoline'],
    paperConsumption: ['paper'],
    envIncidents: ['environmental incident', 'environmental incidents'],
    spills: ['spill', 'spills', 'leak'],
    hazSolidWaste: ['hazardous waste', 'hazardous solid waste'],
    nonHazSolidWaste: ['non hazardous waste', 'general waste'],
    inductions: ['induction', 'inductions', 'onboarding'],
    lostDays: ['lost days', 'days lost', 'work days lost']
  };

  const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'is', 'are', 'was', 'were', 'and', 'or',
    'how', 'what', 'many', 'much', 'our', 'we', 'did', 'do', 'does', 'show', 'me', 'give', 'tell', 'this', 'that',
    'it', 'be', 'have', 'has', 'with', 'at', 'by', 'from', 'about', 'please', 'can', 'you']);

  function tokens(q) {
    return String(q || '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
  }

  function resolveMetric(q) {
    const ql = ' ' + String(q || '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const toks = tokens(q);
    let best = null, bestScore = 0;

    HSEKpi.CANON.forEach((def) => {
      let score = 0;
      const label = def.label.toLowerCase();
      // Whole-phrase hits are worth far more than loose token overlap.
      if (ql.indexOf(' ' + label + ' ') >= 0) score += 12;
      (SYNONYMS[def.key] || []).forEach((syn) => {
        if (ql.indexOf(' ' + syn + ' ') >= 0) score += 8 + syn.length / 10;
      });
      const labelToks = label.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
      labelToks.forEach((lt) => { if (toks.indexOf(lt) >= 0) score += 2; });
      if (score > bestScore) { bestScore = score; best = def; }
    });
    return bestScore >= 4 ? best : null;
  }

  function resolvePeriod(q, ctx) {
    const ql = String(q || '').toLowerCase();
    const names = MONTHS();
    for (let i = 0; i < names.length; i++) {
      if (new RegExp('\\b' + names[i].toLowerCase().slice(0, 3)).test(ql)) return { kind: 'month', index: i };
    }
    if (/\blast month\b|\bprevious month\b/.test(ql)) {
      return { kind: 'month', index: Math.max(0, ctx.monthIndex - 1) };
    }
    if (/\bytd\b|\byear to date\b|\bso far\b|\bthis year\b/.test(ql)) return { kind: 'ytd' };
    for (let q4 = 1; q4 <= 4; q4++) {
      if (new RegExp('\\bq' + q4 + '\\b|\\bquarter ' + q4 + '\\b').test(ql)) return { kind: 'quarter', index: q4 - 1 };
    }
    if (/\btrend\b|\bover time\b|\beach month\b|\bby month\b|\bmonthly\b|\bhistory\b/.test(ql)) return { kind: 'series' };
    return { kind: 'month', index: ctx.monthIndex };
  }

  // -------------------------------------------------------------- answers --

  function metricValue(A, def, period) {
    const t = A.taqaCanon[def.key];
    const i = A.internalCanon[def.key];
    if (period.kind === 'series' && t) return { kind: 'series', series: t.series, source: 'TAQA' };
    if (period.kind === 'ytd') {
      if (t && t.ytd != null) return { kind: 'scalar', value: t.ytd, source: 'TAQA YTD' };
      if (i && i.cumulative != null) return { kind: 'scalar', value: i.cumulative, source: 'internal cumulative' };
      return null;
    }
    if (period.kind === 'quarter' && t && t.quarters) {
      return { kind: 'scalar', value: t.quarters[period.index], source: 'TAQA Q' + (period.index + 1) };
    }
    const mi = period.index;
    if (t && t.series && mi >= 0 && t.series[mi] != null) return { kind: 'scalar', value: t.series[mi], source: 'TAQA' };
    if (i && mi === A.monthIndex && i.value != null) return { kind: 'scalar', value: i.value, source: 'internal report' };
    return null;
  }

  function periodLabel(period, A) {
    if (period.kind === 'ytd') return 'year to date';
    if (period.kind === 'series') return 'by month';
    if (period.kind === 'quarter') return 'Quarter ' + (period.index + 1);
    return MONTHS()[period.index] + (A.year ? ' ' + A.year : '');
  }

  function answerLocally(question, A) {
    const ql = String(question || '').toLowerCase();

    // --- intent: what is wrong / what should we do -------------------------
    if (/\b(action|actions|do next|what should|to do|plan|priorit)/.test(ql)) {
      const acts = A.actions.slice(0, 8);
      if (!acts.length) return { html: '<p>No open actions — every reconciliation matched and every target was met for ' + esc(A.monthName) + '.</p>' };
      return {
        html: '<p>' + A.actions.length + ' open action' + (A.actions.length === 1 ? '' : 's') + ' for ' + esc(A.monthName) + ' ' + esc(A.year) +
          '. The ' + acts.length + ' most urgent:</p><ol class="ai-list">' +
          acts.map((a) => `<li><strong>${esc(a.title)}</strong> — ${esc(a.owner)}, due ${esc(a.dueLabel)} <span class="pill pill-${esc(a.priority)}">${esc(a.priority)}</span><br><span class="ai-dim">${esc(a.what)}</span></li>`).join('') +
          '</ol>'
      };
    }

    // --- intent: where are we lagging / compliance status ------------------
    if (/\b(lagging|behind|non.?complian|compliant|complying|failing|gap|gaps|weak|worst|problem)/.test(ql)) {
      const bad = A.findings.filter((f) => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium')
        .filter((f) => f.status !== 'match' && f.status !== 'met').slice(0, 10);
      const s = A.scorecard;
      let html = `<p>For <strong>${esc(A.monthName)} ${esc(A.year)}</strong>: the two reports agree on <strong>${s.alignmentMatched} of ${s.alignmentTotal}</strong> comparable KPIs (${s.alignment}%), and <strong>${s.attainmentMet} of ${s.attainmentTotal}</strong> targets were met (${s.attainment}%).</p>`;
      if (!bad.length) return { html: html + '<p>Nothing material is lagging.</p>' };
      html += '<p>Where you are lagging:</p><ul class="ai-list">' +
        bad.map((f) => `<li><span class="pill pill-${esc(f.severity)}">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> — ${esc(f.detail)}</li>`).join('') + '</ul>';
      return { html: html };
    }

    // --- intent: what is going well ----------------------------------------
    if (/\b(going well|good|strength|complian(t|ce) area|positive|achiev)/.test(ql)) {
      const good = A.findings.filter((f) => f.status === 'match' || f.status === 'met');
      return {
        html: `<p>${good.length} check${good.length === 1 ? '' : 's'} came back clean for ${esc(A.monthName)}:</p><ul class="ai-list">` +
          good.slice(0, 14).map((f) => `<li><strong>${esc(f.title)}</strong> — ${esc(f.detail)}</li>`).join('') + '</ul>'
      };
    }

    // --- intent: compare the two reports -----------------------------------
    if (/\b(compare|comparison|difference|differ|versus|vs|reconcil|match|mismatch|against internal)/.test(ql)) {
      const def = resolveMetric(question);
      if (def) {
        const f = A.findings.find((x) => x.type === 'reconciliation' && x.key === def.key);
        if (f) {
          return {
            html: `<p><strong>${esc(f.title)}</strong> — ${esc(f.detail)}</p>` +
              (f.notes && f.notes.length ? '<p class="ai-dim">' + f.notes.map(esc).join(' ') + '</p>' : ''),
            chart: f.taqaValue != null && f.internalValue != null ? {
              kind: 'bars',
              opts: {
                title: f.title + ' — ' + A.monthName, categories: ['TAQA submission', 'Internal report'],
                series: [{ name: f.title, values: [f.taqaValue, f.internalValue] }],
                unit: f.unit, labelValues: true, height: 200
              }
            } : null
          };
        }
      }
      const mism = A.findings.filter((x) => x.type === 'reconciliation' && x.status !== 'match');
      return {
        html: `<p>${mism.length} of ${A.scorecard.alignmentTotal} comparable KPIs do not agree between the TAQA submission and the internal report for ${esc(A.monthName)}:</p><ul class="ai-list">` +
          mism.map((f) => `<li><strong>${esc(f.title)}</strong> — ${esc(f.detail)}</li>`).join('') + '</ul>'
      };
    }

    // --- intent: summarise --------------------------------------------------
    if (/\b(summar|overview|brief|how did we do|performance)/.test(ql)) {
      const blocks = buildReport('executive', A);
      return { html: blocksToHtml(blocks) };
    }

    // --- intent: a specific KPI --------------------------------------------
    const def = resolveMetric(question);
    if (def) {
      const period = resolvePeriod(question, A);
      const got = metricValue(A, def, period);
      if (!got) {
        return { html: `<p>Neither uploaded report carries a figure for <strong>${esc(def.label)}</strong> in ${esc(periodLabel(period, A))}.</p>` };
      }
      if (got.kind === 'series') {
        const t = A.taqaCanon[def.key];
        const upTo = t.series.slice(0, A.monthIndex + 1).filter((v) => v != null);
        const total = upTo.reduce((a, b) => a + b, 0);
        return {
          html: HSEAnalysis.sentence(`<p><strong>${esc(def.label)}</strong> month by month to ${esc(A.monthName)}: total ${esc(fmt(total, def.unit))}, ` +
            `current month ${esc(fmt(t.series[A.monthIndex], def.unit))}.</p>`),
          chart: {
            kind: 'line',
            opts: {
              title: def.label + ' — monthly trend', categories: HSEParser.MONTHS.slice(0, A.monthIndex + 1),
              series: [{ name: def.label, values: t.series.slice(0, A.monthIndex + 1) }],
              unit: def.unit, area: true, highlightIndex: A.monthIndex, height: 230
            }
          }
        };
      }

      const t = A.taqaCanon[def.key];
      const i = A.internalCanon[def.key];
      const S = HSEAnalysis.sentence;
      let html = S(`<p><strong>${esc(def.label)}</strong> for ${esc(periodLabel(period, A))}: <strong>${esc(fmt(got.value, def.unit))}</strong> <span class="ai-dim">(${esc(got.source)})</span>.</p>`);
      if (t && i && t.value != null && i.value != null && period.kind === 'month' && period.index === A.monthIndex) {
        html += t.value === i.value
          ? `<p>Both reports agree.</p>`
          : S(`<p class="ai-warn">The internal report records ${esc(fmt(i.value, def.unit))} for the same period — the two do not agree.</p>`);
      }
      // Don't restate the year-to-date figure when that is what was asked for.
      if (t && t.ytd != null && period.kind !== 'ytd') html += S(`<p class="ai-dim">Year to date: ${esc(fmt(t.ytd, def.unit))}.</p>`);
      if (i && i.cumulative != null) html += S(`<p class="ai-dim">Internal cumulative since contract start: ${esc(fmt(i.cumulative, def.unit))}.</p>`);

      return {
        html: html,
        chart: t && t.series ? {
          kind: 'bars',
          opts: {
            title: def.label + ' by month', categories: HSEParser.MONTHS,
            series: [{ name: def.label, values: t.series }], unit: def.unit,
            highlightIndex: period.kind === 'month' ? period.index : A.monthIndex, height: 220
          }
        } : null
      };
    }

    // --- nothing matched ----------------------------------------------------
    return {
      html: '<p>I could not match that to a KPI in the uploaded reports. Try naming one directly — for example ' +
        '<em>“how many inspections in August”</em>, <em>“near miss trend”</em>, <em>“compare training hours”</em>, ' +
        '<em>“where are we lagging”</em> or <em>“what should I do next”</em>.</p>',
      unmatched: true
    };
  }

  // -------------------------------------------------------------- reports --

  function blocksToHtml(blocks) {
    return blocks.map((b) => {
      if (b.type === 'h2') return `<h3 class="rep-h2">${esc(b.text)}</h3>`;
      if (b.type === 'h3') return `<h4 class="rep-h3">${esc(b.text)}</h4>`;
      if (b.type === 'p') return `<p>${b.html ? b.html : esc(b.text)}</p>`;
      if (b.type === 'ul') return `<ul class="rep-list">${b.items.map((x) => `<li>${x.html ? x.html : esc(x.text || x)}</li>`).join('')}</ul>`;
      if (b.type === 'ol') return `<ol class="rep-list">${b.items.map((x) => `<li>${x.html ? x.html : esc(x.text || x)}</li>`).join('')}</ol>`;
      if (b.type === 'kv') return `<dl class="rep-kv">${b.items.map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join('')}</dl>`;
      if (b.type === 'table') return `<table class="data-table"><thead><tr>${b.head.map((h) => `<th${/^(num|#)/.test(h) ? ' class="num"' : ''}>${esc(h.replace(/^num:/, ''))}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r) => `<tr>${r.map((c, ci) => `<td${/^num:/.test(b.head[ci]) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      if (b.type === 'note') return `<p class="rep-note">${esc(b.text)}</p>`;
      return '';
    }).join('');
  }

  function blocksToMarkdown(blocks) {
    return blocks.map((b) => {
      if (b.type === 'h2') return '## ' + b.text;
      if (b.type === 'h3') return '### ' + b.text;
      if (b.type === 'p') return stripTags(b.html || b.text);
      if (b.type === 'ul') return b.items.map((x) => '- ' + stripTags(x.html || x.text || x)).join('\n');
      if (b.type === 'ol') return b.items.map((x, i) => (i + 1) + '. ' + stripTags(x.html || x.text || x)).join('\n');
      if (b.type === 'kv') return b.items.map((x) => '- **' + x.k + ':** ' + x.v).join('\n');
      if (b.type === 'table') {
        const head = b.head.map((h) => h.replace(/^num:/, ''));
        return '| ' + head.join(' | ') + ' |\n| ' + head.map(() => '---').join(' | ') + ' |\n' +
          b.rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
      }
      if (b.type === 'note') return '> ' + b.text;
      return '';
    }).filter(Boolean).join('\n\n');
  }
  function stripTags(s) { return String(s).replace(/<[^>]+>/g, ''); }

  const REPORTS = {
    executive: 'Executive summary',
    monthly: 'Monthly HSE performance narrative',
    gap: 'Gap & reconciliation analysis',
    action: 'Action plan with timeline',
    client: 'Client cover note',
    quality: 'Data quality report'
  };

  function buildReport(kind, A) {
    const m = A.taqa ? A.taqa.meta : (A.internal ? A.internal.meta : {});
    const s = A.scorecard;
    const period = (A.monthName || '') + ' ' + (A.year || '');
    const r = A.rates;
    const blocks = [];

    const header = () => {
      blocks.push({ type: 'h2', text: REPORTS[kind] + ' — ' + period });
      blocks.push({
        type: 'kv', items: [
          { k: 'Contract', v: m.contractNo || '—' },
          { k: 'Project', v: m.projectTitle || '—' },
          { k: 'Contractor', v: m.contractor || (A.internal && A.internal.meta.client ? 'HEGC' : '—') },
          { k: 'Reporting period', v: period },
          { k: 'Prepared from', v: [A.taqa && A.taqa.fileName, A.internal && A.internal.fileName].filter(Boolean).join(' + ') || '—' },
          { k: 'Generated', v: new Date().toLocaleString() }
        ]
      });
    };

    const safetyLine = () => {
      const parts = [];
      if (r.manhours != null) parts.push(fmt(r.manhours, 'man-hours') + ' worked');
      if (r.employees != null) parts.push('a workforce of ' + fmt(r.employees));
      if (r.ltiCount != null) parts.push(r.ltiCount === 0 ? 'no lost-time injuries' : fmt(r.ltiCount) + ' lost-time injur' + (r.ltiCount === 1 ? 'y' : 'ies'));
      if (r.recordable != null) parts.push(r.recordable === 0 ? 'no recordable cases' : fmt(r.recordable) + ' recordable case(s)');
      return parts.join(', ');
    };

    if (kind === 'executive') {
      header();
      blocks.push({ type: 'h3', text: 'Position' });
      blocks.push({ type: 'p', text: 'The period recorded ' + safetyLine() + '. LTIFR stands at ' + fmt(round2(r.ltifr)) +
        ' and TRCF at ' + fmt(round2(r.trcf)) + ' per million hours worked.' });
      if (s.alignment != null) {
        blocks.push({ type: 'p', text: 'Against the internal record, the TAQA submission agrees on ' + s.alignmentMatched +
          ' of ' + s.alignmentTotal + ' comparable KPIs (' + s.alignment + '%). ' + s.attainmentMet + ' of ' +
          s.attainmentTotal + ' performance targets were met (' + s.attainment + '%).' });
      }
      const top = A.findings.filter((f) => ['critical', 'high'].indexOf(f.severity) >= 0 && f.status !== 'match' && f.status !== 'met');
      blocks.push({ type: 'h3', text: 'What needs attention' });
      if (!top.length) blocks.push({ type: 'p', text: 'Nothing of high severity is open for this period.' });
      else blocks.push({ type: 'ul', items: top.map((f) => ({ text: f.title + ' — ' + f.detail })) });

      // One line per KPI: a KPI whose reports agree AND whose target is met
      // would otherwise appear twice under the same heading.
      const seenWin = {};
      const wins = A.findings.filter((f) => {
        if (f.status !== 'match' && f.status !== 'met') return false;
        if (seenWin[f.title]) return false;
        seenWin[f.title] = true;
        return true;
      }).slice(0, 8);
      if (wins.length) {
        blocks.push({ type: 'h3', text: 'Holding well' });
        blocks.push({ type: 'ul', items: wins.map((f) => ({ text: f.title + ' — ' + f.detail })) });
      }
      blocks.push({ type: 'h3', text: 'Next 30 days' });
      blocks.push({
        type: 'ol', items: A.actions.slice(0, 5).map((a) => ({
          text: a.title + ' (' + a.owner + ', by ' + a.dueLabel + ')'
        }))
      });
      blocks.push({ type: 'note', text: 'Figures are read directly from the uploaded workbooks. Targets are house targets set in this dashboard, not regulatory thresholds.' });
      return blocks;
    }

    if (kind === 'monthly') {
      header();
      blocks.push({ type: 'h3', text: '1. Exposure' });
      blocks.push({ type: 'p', text: 'A workforce of ' + fmt(r.employees) + ' worked ' + fmt(r.manhours, 'hours') +
        ' during ' + period + ', an average of ' + fmt(round2(r.hoursPerEmployee), 'hours') + ' per person.' });

      blocks.push({ type: 'h3', text: '2. Lagging indicators' });
      const lag = ['fatality', 'lti', 'lwc', 'rwc', 'mtc', 'firstAid', 'propertyDamage', 'rta', 'lostDays']
        .map((k) => A.canon[k]).filter(Boolean);
      blocks.push({
        type: 'table', head: ['Indicator', 'num:This month', 'num:Year to date'],
        rows: lag.map((c) => [c.def.label, fmt(c.value, c.def.unit), fmt(c.ytd != null ? c.ytd : c.cumulative, c.def.unit)])
      });
      blocks.push({ type: 'p', text: 'LTIFR ' + fmt(round2(r.ltifr)) + ', LTISR ' + fmt(round2(r.ltisr)) + ', TRCF ' + fmt(round2(r.trcf)) + ' per million hours.' });

      blocks.push({ type: 'h3', text: '3. Leading indicators' });
      const lead = ['inspections', 'audits', 'trainingHours', 'toolboxTalks', 'nearMiss', 'unsafeActs', 'unsafeConditions', 'drills', 'meetings']
        .map((k) => A.canon[k]).filter(Boolean);
      blocks.push({
        type: 'table', head: ['Indicator', 'num:This month', 'num:Year to date'],
        rows: lead.map((c) => [c.def.label, fmt(c.value, c.def.unit), fmt(c.ytd != null ? c.ytd : c.cumulative, c.def.unit)])
      });
      blocks.push({ type: 'p', text: 'Training delivered ' + fmt(round2(r.trainingHoursPerEmployee), 'hours per employee') +
        '; inspections ran at ' + fmt(round2(r.inspectionsPer100Workers)) + ' per 100 workers; ' +
        fmt(r.proactiveReports) + ' proactive reports (near misses and observations) were raised.' });

      blocks.push({ type: 'h3', text: '4. Permits to work' });
      blocks.push({ type: 'p', text: fmt(r.permitsIssued) + ' permits were issued: ' +
        ['permitExcavation', 'permitConfined', 'permitHotWork', 'permitOther'].map((k) =>
          (A.canon[k] ? A.canon[k].def.label.toLowerCase() + ' ' + fmt(A.canon[k].value) : null)).filter(Boolean).join(', ') + '.' });

      blocks.push({ type: 'h3', text: '5. Environment' });
      const env = ['waterConsumption', 'powerConsumption', 'fuelConsumption', 'envIncidents', 'spills']
        .map((k) => A.canon[k]).filter(Boolean);
      blocks.push({
        type: 'table', head: ['Indicator', 'num:This month', 'num:Unit'],
        rows: env.map((c) => [c.def.label, fmt(c.value), c.def.unit])
      });

      blocks.push({ type: 'h3', text: '6. Reconciliation against the internal record' });
      const mism = A.findings.filter((f) => f.type === 'reconciliation' && f.status !== 'match');
      if (!mism.length) blocks.push({ type: 'p', text: 'Every comparable KPI agrees between the two reports.' });
      else blocks.push({ type: 'ul', items: mism.map((f) => ({ text: f.title + ': ' + f.detail })) });

      blocks.push({ type: 'h3', text: '7. Actions' });
      blocks.push({
        type: 'table', head: ['Priority', 'Action', 'Owner', 'Due'],
        rows: A.actions.map((a) => [a.priority, a.title, a.owner, a.dueLabel])
      });
      return blocks;
    }

    if (kind === 'gap') {
      header();
      blocks.push({ type: 'p', text: 'Comparison basis: the TAQA form\'s Contractor line against the internal report\'s ' +
        'monthly total, because the internal report covers this company only. ' + (A.cumulativeBasis ? A.cumulativeBasis.detail : '') });

      const groups = [
        ['Agreeing', A.findings.filter((f) => f.type === 'reconciliation' && f.status === 'match')],
        ['Not agreeing', A.findings.filter((f) => f.type === 'reconciliation' && f.status === 'mismatch')],
        ['Blank in the TAQA submission', A.findings.filter((f) => f.status === 'blank-taqa')],
        ['Missing from one side', A.findings.filter((f) => f.status === 'missing-taqa' || f.status === 'missing-internal')],
        ['Recorded internally, no row on the TAQA form', A.findings.filter((f) => f.type === 'coverage')]
      ];
      groups.forEach(([title, list]) => {
        if (!list.length) return;
        blocks.push({ type: 'h3', text: title + ' (' + list.length + ')' });
        blocks.push({
          type: 'table', head: ['KPI', 'num:TAQA', 'num:Internal', 'num:Difference', 'Note'],
          rows: list.map((f) => [f.title, fmt(f.taqaValue, f.unit), fmt(f.internalValue, f.unit),
            f.delta == null ? '—' : fmt(f.delta, f.unit), f.detail])
        });
      });
      return blocks;
    }

    if (kind === 'action') {
      header();
      blocks.push({ type: 'p', text: A.actions.length + ' actions arise from this period\'s findings. Due dates are ' +
        'calculated from the severity of each finding using the response times set in this dashboard.' });
      ['critical', 'high', 'medium', 'low'].forEach((p) => {
        const list = A.actions.filter((a) => a.priority === p);
        if (!list.length) return;
        blocks.push({ type: 'h3', text: p.charAt(0).toUpperCase() + p.slice(1) + ' priority (' + list.length + ')' });
        list.forEach((a) => {
          blocks.push({ type: 'p', html: '<strong>' + esc(a.title) + '</strong>' });
          blocks.push({
            type: 'kv', items: [
              { k: 'Why', v: a.why },
              { k: 'What to do', v: a.what },
              { k: 'Owner', v: a.owner },
              { k: 'Due', v: a.dueLabel + ' (' + a.dueDays + ' days)' },
              { k: 'Verification', v: a.verification }
            ]
          });
        });
      });
      if (!A.actions.length) blocks.push({ type: 'p', text: 'No actions arise — every check passed.' });
      return blocks;
    }

    if (kind === 'client') {
      header();
      blocks.push({ type: 'p', text: 'Please find enclosed the HSE statistics return for ' + period + ' against contract ' +
        (m.contractNo || '') + '.' });
      blocks.push({ type: 'p', text: 'During the period the project recorded ' + safetyLine() + '. LTIFR and TRCF both stand at ' +
        fmt(round2(r.ltifr)) + ' and ' + fmt(round2(r.trcf)) + ' respectively.' });
      blocks.push({ type: 'p', text: 'Proactive activity for the period: ' +
        ['inspections', 'audits', 'toolboxTalks', 'trainingHours', 'drills', 'meetings']
          .map((k) => (A.canon[k] && A.canon[k].value != null ? fmt(A.canon[k].value) + ' ' + A.canon[k].def.label.toLowerCase() : null))
          .filter(Boolean).join(', ') + '.' });
      const cov = A.findings.filter((f) => f.type === 'coverage');
      if (cov.length) {
        blocks.push({ type: 'p', text: 'The following proactive activity was carried out during the period but has no ' +
          'corresponding row on Form ' + (m.formRef || 'F-019-F') + ', and is recorded here for completeness:' });
        blocks.push({ type: 'ul', items: cov.map((f) => ({ text: f.title + ': ' + fmt(f.internalValue, f.unit) })) });
      }
      blocks.push({ type: 'p', text: 'Actions arising from the period\'s review have been logged with owners and target dates, ' +
        'and will be reported on in the next return.' });
      return blocks;
    }

    if (kind === 'quality') {
      header();
      const q = A.findings.filter((f) => f.type === 'quality');
      blocks.push({ type: 'p', text: q.length ? q.length + ' data-quality defects were found in the submitted workbook. ' +
        'Each one changes what the form reports, so they are worth fixing before the next submission.'
        : 'No data-quality defects were found in the submitted workbook.' });
      q.forEach((f) => {
        blocks.push({ type: 'h3', text: f.title });
        blocks.push({ type: 'p', text: f.detail });
        if (f.sample && f.sample.length) blocks.push({ type: 'p', text: 'Examples: ' + f.sample.join('; ') + '…' });
        if (f.notes && f.notes.length) blocks.push({ type: 'ul', items: f.notes.map((x) => ({ text: x })) });
      });
      return blocks;
    }

    return blocks;
  }

  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  // ------------------------------------------------------ LLM integration --

  // A compact digest of the real numbers. The model is given data and told to
  // reason over it — never asked to recall a figure, because it cannot.
  function buildContext(A) {
    const m = A.taqa ? A.taqa.meta : (A.internal ? A.internal.meta : {});
    const pick = (obj, keys) => keys.reduce((acc, k) => {
      if (obj[k] && obj[k].value != null) acc[obj[k].def.label] = obj[k].value;
      return acc;
    }, {});
    const headline = ['employees', 'manhours', 'lti', 'lwc', 'rwc', 'mtc', 'firstAid', 'nearMiss',
      'unsafeActs', 'unsafeConditions', 'inspections', 'audits', 'trainingHours', 'toolboxTalks',
      'drills', 'meetings', 'waterConsumption', 'powerConsumption', 'fuelConsumption'];

    return {
      period: { month: A.monthName, year: A.year },
      contract: { no: m.contractNo, project: m.projectTitle, contractor: m.contractor, client: A.internal ? A.internal.meta.client : null },
      thisMonth: pick(A.canon, headline),
      rates: {
        LTIFR: round2(A.rates.ltifr), LTISR: round2(A.rates.ltisr), TRCF: round2(A.rates.trcf),
        trainingHoursPerEmployee: round2(A.rates.trainingHoursPerEmployee),
        inspectionsPer100Workers: round2(A.rates.inspectionsPer100Workers),
        proactiveReports: A.rates.proactiveReports, permitsIssued: A.rates.permitsIssued
      },
      monthlySeries: ['manhours', 'employees', 'nearMiss', 'inspections', 'trainingHours', 'toolboxTalks']
        .reduce((acc, k) => {
          if (A.taqaCanon[k]) acc[A.taqaCanon[k].def.label] = A.taqaCanon[k].series.slice(0, (A.monthIndex + 1) || 12);
          return acc;
        }, {}),
      scorecard: A.scorecard,
      findings: A.findings.filter((f) => f.status !== 'match' && f.status !== 'met')
        .map((f) => ({ kpi: f.title, type: f.type, status: f.status, severity: f.severity, detail: f.detail })),
      agreeing: A.findings.filter((f) => f.status === 'match').map((f) => f.title),
      actions: A.actions.map((a) => ({ priority: a.priority, title: a.title, owner: a.owner, due: a.dueLabel }))
    };
  }

  const SYSTEM_PROMPT =
    'You are an HSE performance analyst embedded in a construction contractor\'s reporting dashboard. ' +
    'You are given a JSON digest of two already-parsed monthly reports: a client submission (TAQA form F-019-F) ' +
    'and the contractor\'s own internal report, plus the reconciliation findings and action plan the dashboard computed.\n\n' +
    'Rules you must follow:\n' +
    '1. Use ONLY figures present in the digest. Never invent, estimate or recall a number. If something is not in the ' +
    'digest, say it is not in the uploaded reports.\n' +
    '2. Do not cite regulations, standards or legal thresholds as requirements. The targets in the digest are the ' +
    'contractor\'s own house targets, not regulatory limits — describe them that way.\n' +
    '3. Be concrete and brief. Lead with the answer. Use short paragraphs and lists.\n' +
    '4. When something is wrong, say what to do about it and who should own it.\n' +
    '5. Write in plain professional English suitable for a project HSE report. No marketing tone.';

  async function ask(question, A, cfg) {
    const local = answerLocally(question, A);
    const llm = cfg || loadLlm();

    if (!llm.enabled || !llm.model) return Object.assign({ source: 'engine' }, local);

    try {
      const ctx = buildContext(A);
      const reply = await callLlm(llm, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'DATA DIGEST (the only figures you may use):\n```json\n' + JSON.stringify(ctx) + '\n```\n\nQUESTION: ' + question }
      ]);
      if (!reply || !reply.trim()) return Object.assign({ source: 'engine' }, local);
      return {
        source: 'llm', model: llm.model,
        html: mdToHtml(reply),
        chart: local.chart || null,
        engineHtml: local.unmatched ? null : local.html
      };
    } catch (e) {
      return Object.assign({ source: 'engine', llmError: e.message }, local);
    }
  }

  async function rewriteReport(kind, A, cfg, instruction) {
    const blocks = buildReport(kind, A);
    const llm = cfg || loadLlm();
    const md = blocksToMarkdown(blocks);
    if (!llm.enabled || !llm.model) return { source: 'engine', blocks: blocks, html: blocksToHtml(blocks), markdown: md };
    try {
      const reply = await callLlm(llm, [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user', content: 'Here is a generated ' + REPORTS[kind] + ' built directly from the data:\n\n' + md +
            '\n\nDATA DIGEST:\n```json\n' + JSON.stringify(buildContext(A)) + '\n```\n\n' +
            (instruction || 'Rewrite this as a polished report. Keep every figure exactly as given — you may reorganise, ' +
              'explain and add analysis, but you may not change or add a number.')
        }
      ]);
      if (!reply || !reply.trim()) return { source: 'engine', blocks: blocks, html: blocksToHtml(blocks), markdown: md };
      return { source: 'llm', model: llm.model, blocks: blocks, html: mdToHtml(reply), markdown: reply };
    } catch (e) {
      return { source: 'engine', llmError: e.message, blocks: blocks, html: blocksToHtml(blocks), markdown: md };
    }
  }

  // Minimal Markdown renderer for model output — headings, lists, tables,
  // bold/italic/code. Everything is escaped first, so model output can never
  // inject markup.
  function mdToHtml(md) {
    const lines = String(md).split(/\r?\n/);
    const out = [];
    let list = null, table = null;

    const inline = (s) => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const closeTable = () => {
      if (!table) return;
      out.push('<table class="data-table"><thead><tr>' + table.head.map((h) => '<th>' + inline(h) + '</th>').join('') +
        '</tr></thead><tbody>' + table.rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>');
      table = null;
    };

    lines.forEach((raw) => {
      const l = raw.trimEnd();
      const cells = l.trim().match(/^\|(.+)\|$/);
      if (cells) {
        const parts = cells[1].split('|').map((c) => c.trim());
        if (/^[\s:-]+$/.test(cells[1].replace(/\|/g, ''))) return; // separator row
        if (!table) { closeList(); table = { head: parts, rows: [] }; }
        else table.rows.push(parts);
        return;
      }
      closeTable();

      if (!l.trim()) { closeList(); return; }
      const h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push('<h' + Math.min(4, h[1].length + 1) + ' class="rep-h2">' + inline(h[2]) + '</h' + Math.min(4, h[1].length + 1) + '>'); return; }
      const ul = l.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) { if (list !== 'ul') { closeList(); out.push('<ul class="rep-list">'); list = 'ul'; } out.push('<li>' + inline(ul[1]) + '</li>'); return; }
      const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) { if (list !== 'ol') { closeList(); out.push('<ol class="rep-list">'); list = 'ol'; } out.push('<li>' + inline(ol[1]) + '</li>'); return; }
      closeList();
      out.push('<p>' + inline(l) + '</p>');
    });
    closeList(); closeTable();
    return out.join('');
  }

  global.HSEAI = {
    REPORTS: REPORTS,
    DEFAULT_LLM: DEFAULT_LLM,
    loadLlm: loadLlm, saveLlm: saveLlm, probeLlm: probeLlm,
    ask: ask, answerLocally: answerLocally,
    buildReport: buildReport, rewriteReport: rewriteReport,
    blocksToHtml: blocksToHtml, blocksToMarkdown: blocksToMarkdown,
    buildContext: buildContext, mdToHtml: mdToHtml,
    resolveMetric: resolveMetric
  };
})(window);
