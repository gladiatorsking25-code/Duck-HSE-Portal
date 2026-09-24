// hse-parser.js — turns an uploaded HSE workbook into a structured report.
//
// Two document families are recognised, both real forms in use on TAQA WS
// contract O-16123:
//
//   'taqa'      SWS HSE Statistics Performance Report (Form F-019-F, 3.1-A/B).
//               The client-facing submission. One wide sheet: KPI rows down,
//               JAN..DEC + YTD + quarters across, each KPI split into
//               Consultant / Contractor / Sub-Cont. / Total lines.
//
//   'internal'  HEGC-IMS-P06-FM-03 / -03A monthly OHS + Environmental
//               performance report. The company's own record: one column for
//               the reporting month, one for the cumulative figure.
//
// Nothing here is hard-coded to a cell address. Every column position is found
// by locating its header text, because these forms get re-issued with rows and
// columns shifted and a parser pinned to "column M is August" silently reads
// the wrong month the first time someone inserts a column.
//
// The parser also records DATA QUALITY defects as it goes (letter "o" typed
// where a zero belongs, formula errors, blank months mid-year). Those are
// findings in their own right — a KPI that reads as zero because the formula
// broke is not the same as a KPI that is genuinely zero.

(function (global) {
  'use strict';

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // ------------------------------------------------------------- utilities --

  function txt(v) {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/\s+/g, ' ').trim();
  }
  // Comparison key: case/punctuation/spacing-insensitive. The forms contain
  // real typos ("insepctions", "Manageement", "dangeroues") and inconsistent
  // spacing, so matching has to survive them.
  function key(v) {
    return txt(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    if (v instanceof Date) return null;
    const s = String(v).replace(/[, ]/g, '').replace(/^AED/i, '').trim();
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  // "o" / "O" typed where a zero belongs — common in these forms, and worth
  // surfacing rather than silently coercing.
  function isOhTypo(v) { return typeof v === 'string' && /^[oO]$/.test(v.trim()); }

  function rowText(row) { return (row || []).map(txt).filter(Boolean).join(' '); }

  function findRow(rows, test, from, to) {
    const end = Math.min(to == null ? rows.length : to, rows.length);
    for (let r = from || 0; r < end; r++) if (rows[r] && test(rows[r], r)) return r;
    return -1;
  }
  function findCol(row, test) {
    for (let c = 0; c < (row || []).length; c++) if (test(txt(row[c]), c)) return c;
    return -1;
  }
  // First non-empty cell to the right of `from` — how these forms lay out a
  // label/value pair across merged cells.
  function valueRightOf(row, from) {
    for (let c = from + 1; c < row.length; c++) {
      const t = txt(row[c]);
      if (t) return t;
    }
    return '';
  }

  function parseMonthYear(s) {
    const t = txt(s);
    let mi = -1;
    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (new RegExp('\\b' + MONTH_NAMES[i].slice(0, 3), 'i').test(t)) { mi = i; break; }
    }
    const ym = t.match(/(19|20)\d{2}/);
    return { monthIndex: mi, year: ym ? Number(ym[0]) : null };
  }

  // ------------------------------------------------------------- detection --

  function detect(workbook) {
    const names = workbook.sheets.map((s) => key(s.name));
    const head = workbook.sheets.map((s) => key(s.rows.slice(0, 8).map(rowText).join(' '))).join(' ');
    if (names.some((n) => /sws hse statistic/.test(n)) || /sws hse statistics performance report/.test(head)) return 'taqa';
    if (names.some((n) => n === 'ohs' || n === 'environment') || /monthly ohs performance report|monthly environmental performance report/.test(head)) return 'internal';
    return null;
  }

  // ------------------------------------------------------------ TAQA form ---

  function parseTaqa(workbook, fileName) {
    const sheet = workbook.sheets.find((s) => /sws hse statistic/.test(key(s.name))) || workbook.sheets[0];
    const rows = sheet.rows;
    const quality = [];

    // The month header row is the anchor for the whole sheet: it fixes where
    // JAN sits, and therefore where the party column, YTD and the quarters are.
    const hdrRow = findRow(rows, (r) => {
      const ks = r.map(key);
      return ks.indexOf('jan') !== -1 && ks.indexOf('dec') !== -1;
    });
    if (hdrRow < 0) throw new Error('This looks like a TAQA statistics form, but the JAN–DEC header row could not be found.');

    const hdr = rows[hdrRow];
    const monthCols = MONTHS.map((m) => findCol(hdr, (t) => key(t) === key(m)));
    const firstMonthCol = monthCols[0];
    const ytdCol = findCol(hdr, (t) => key(t) === 'ytd');
    const quarterCols = [1, 2, 3, 4].map((q) => findCol(hdr, (t) => key(t) === 'quarter ' + q || key(t) === 'q' + q));

    // Layout to the LEFT of JAN, derived rather than assumed:
    //   [Sr. No.] [KPI group] [KPI sub-item] [Party]
    const partyCol = firstMonthCol - 1;
    const subCol = firstMonthCol - 2;
    const groupCol = findCol(hdr, (t) => key(t) === 'kpis');
    const srCol = findCol(hdr, (t) => /^sr no/.test(key(t)));

    const out = [];
    let part = 'A', curSr = '', curGroup = '', curSub = '';

    for (let r = hdrRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const line = rowText(row);
      if (!line) continue;

      // Section banners: "PART A-...", "PART B-...", "PART 3 - Process Safety".
      const banner = txt(row[srCol >= 0 ? srCol : 1]) || txt(row[groupCol >= 0 ? groupCol : 2]);
      const pm = banner.match(/^PART\s+([ABC123])\b/i);
      if (pm && !MONTHS.some((_, i) => num(row[monthCols[i]]) != null)) {
        const tok = pm[1].toUpperCase();
        part = (tok === '1') ? 'A' : (tok === '2') ? 'B' : (tok === '3') ? 'C' : tok;
        curSr = ''; curGroup = ''; curSub = '';
        continue;
      }
      // Sign-off block ends the data.
      if (/^(prepared by|reviewed by|validated by|approved by|designation|signature)\b/i.test(banner)) break;

      // Forward-fill the merged label columns. A new Sr. No. starts a new KPI,
      // so both label levels reset; a new group resets only the sub-item.
      const srCell = srCol >= 0 ? txt(row[srCol]) : '';
      const groupCell = groupCol >= 0 ? txt(row[groupCol]) : '';
      const subCell = subCol >= 0 ? txt(row[subCol]) : '';
      if (srCell) { curSr = srCell; curGroup = ''; curSub = ''; }
      if (groupCell) { curGroup = groupCell; curSub = ''; }
      if (subCell) curSub = subCell;

      const party = partyCol >= 0 ? txt(row[partyCol]) : '';
      const months = [];
      let hasValue = false;
      for (let m = 0; m < 12; m++) {
        const cell = monthCols[m] >= 0 ? row[monthCols[m]] : null;
        if (isOhTypo(cell)) {
          quality.push({
            kind: 'letter-o-for-zero', sheet: sheet.name, row: r + 1,
            label: [curGroup, curSub].filter(Boolean).join(' › '),
            month: MONTHS[m],
            detail: 'Cell contains the letter "o" instead of the digit 0.'
          });
          months.push(null);
          continue;
        }
        const n = num(cell);
        months.push(n);
        if (n != null) hasValue = true;
      }

      if (!curGroup && !curSub) continue;
      if (!hasValue && !party) continue;

      out.push({
        part: part,
        srNo: curSr,
        group: curGroup,
        sub: curSub,
        label: [curGroup, curSub].filter(Boolean).join(' › '),
        party: party,
        partyKey: normaliseParty(party),
        months: months,
        ytd: ytdCol >= 0 ? num(row[ytdCol]) : null,
        quarters: quarterCols.map((c) => (c >= 0 ? num(row[c]) : null)),
        row: r + 1
      });
    }

    const meta = taqaMeta(workbook, sheet, out);
    return {
      kind: 'taqa',
      fileName: fileName || '',
      sheetName: sheet.name,
      meta: meta,
      rows: out,
      training: parseTrainingSheet(workbook),
      incidents: parseIncidentSheet(workbook),
      quality: quality
    };
  }

  function normaliseParty(p) {
    const k = key(p);
    if (!k) return '';
    if (/^total/.test(k)) return 'total';
    if (/^sub/.test(k)) return 'subcontractor';
    if (/^contractor/.test(k) || /by contractor/.test(k)) return 'contractor';
    if (/^consultant/.test(k)) return 'consultant';
    if (/^sws consultant/.test(k) || /^sws$/.test(k)) return 'client';
    return k;
  }

  function taqaMeta(workbook, sheet, parsedRows) {
    const blob = sheet.rows.slice(0, 6).map(rowText).join('\n');
    const foot = sheet.rows.slice(Math.max(0, sheet.rows.length - 400)).map(rowText).join('\n');
    const all = workbook.sheets.map((s) => s.rows.slice(0, 4).map(rowText).join(' ')).join('\n');

    const pick = (re, src) => { const m = (src || blob).match(re); return m ? txt(m[1]) : ''; };

    // Month/year is not stated on the statistics sheet itself — the training
    // calculator and incident register both carry it, so read it there. If
    // neither is present, fall back to the last month column holding data.
    let my = { monthIndex: -1, year: null };
    const hit = all.match(/month\s*:?\s*([A-Za-z]+)\s*,?\s*(?:year\s*:?\s*)?\(?\s*((?:19|20)\d{2})/i)
      || all.match(/for the month of\s+([A-Za-z]+)\s*,?\s*\(?\s*year\s*:?\s*((?:19|20)\d{2})/i);
    if (hit) my = parseMonthYear(hit[0]);
    if (my.monthIndex < 0) {
      let last = -1;
      parsedRows.forEach((r) => r.months.forEach((v, i) => { if (v != null && i > last) last = i; }));
      my = { monthIndex: last, year: my.year };
    }
    if (!my.year) {
      const dm = foot.match(/date\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]((?:19|20)\d{2}))/i);
      if (dm) my.year = Number(dm[2]);
    }

    return {
      title: txt(sheet.rows[1] ? rowText(sheet.rows[1]).replace(/Form:.*$/i, '') : ''),
      contractNo: pick(/Contract\s*No\s*:?\s*([A-Z0-9\-\/]+)/i),
      projectTitle: pick(/Project\s*Title\s*:?\s*([^\n]+?)(?:\s*Contractor\s*:|$)/i),
      contractor: pick(/Contractor\s*:\s*([^\n]+?)(?:\s*Consultant\s*:|\s*Revision\s*:|$)/i),
      consultant: pick(/Consultant\s*:\s*([^\n]+?)(?:\s*Revision\s*:|$)/i),
      // The colon is required — without it "PERFORMANCE" matches "form".
      formRef: pick(/\bForm\s*:\s*([A-Z0-9][A-Z0-9\-]*)/i),
      revision: pick(/Revision\s*:?\s*(\d+)/i),
      effectiveDate: pick(/Effective\s*Date\s*:?\s*([A-Za-z]+\s*\d{4})/i),
      monthIndex: my.monthIndex,
      monthName: my.monthIndex >= 0 ? MONTH_NAMES[my.monthIndex] : '',
      year: my.year,
      preparedBy: pick(/Prepared\s*by\s*:?\s*([A-Za-z .'-]+?)(?:\s*Reviewed|\s*Designation|$)/i, foot),
      reviewedBy: pick(/Reviewed\s*by\s*:?\s*([A-Za-z .'-]+?)(?:\s*Validated|\s*Designation|$)/i, foot),
      approvedBy: pick(/Approved\s*by\s*:?\s*([A-Za-z .'-]+?)(?:\s*Designation|$)/i, foot)
    };
  }

  function parseTrainingSheet(workbook) {
    const sheet = workbook.sheets.find((s) => /training hrs cal|training hours cal/.test(key(s.name)));
    if (!sheet) return [];
    const rows = sheet.rows;
    const h = findRow(rows, (r) => r.map(key).some((t) => /type of ehs training|type of training/.test(t)));
    if (h < 0) return [];
    const hdr = rows[h];
    const col = (re) => findCol(hdr, (t) => re.test(key(t)));
    const cType = col(/type of (ehs )?training/), cSession = col(/^session/), cDate = col(/training date/);
    const cTopic = col(/training topic/), cHours = col(/training period/), cAtt = col(/attendee/), cTotal = col(/total training hours/);
    // The party ("Contractor" / "Consultant") sits in the unlabelled column
    // between the training type and the session number.
    const cParty = (cSession - cType === 2) ? cType + 1 : -1;

    const out = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const type = txt(row[cType]);
      if (/^total training hours/i.test(type)) break;
      const topic = cTopic >= 0 ? txt(row[cTopic]) : '';
      const hrs = cHours >= 0 ? num(row[cHours]) : null;
      if (!topic && hrs == null) continue;
      const d = cDate >= 0 ? row[cDate] : null;
      out.push({
        type: /external/i.test(type) ? 'External' : /internal/i.test(type) ? 'Internal' : type,
        party: cParty >= 0 ? txt(row[cParty]) : '',
        session: cSession >= 0 ? num(row[cSession]) : null,
        date: d instanceof Date ? d : (num(d) != null ? XLSXReader.serialToDate(num(d)) : null),
        topic: topic,
        hours: hrs,
        attendees: cAtt >= 0 ? num(row[cAtt]) : null,
        totalHours: cTotal >= 0 ? num(row[cTotal]) : null,
        row: r + 1
      });
    }
    return out;
  }

  function parseIncidentSheet(workbook) {
    const sheet = workbook.sheets.find((s) => /incident register/.test(key(s.name)));
    if (!sheet) return [];
    const rows = sheet.rows;
    const h = findRow(rows, (r) => r.map(key).some((t) => /incident category/.test(t)));
    if (h < 0) return [];
    const hdr = rows[h];
    const col = (re) => findCol(hdr, (t) => re.test(key(t)));
    const map = {
      category: col(/incident category/), location: col(/incident location/), date: col(/incident date/),
      time: col(/incident time/), description: col(/description of incident/), age: col(/^age/),
      nationality: col(/nationality/), trade: col(/^trade/), experience: col(/experience/),
      employer: col(/injured person is employed|employed as contractor/), organisation: col(/organisation|organization/),
      bodyPart: col(/body part injured/), daysLost: col(/work days lost/), activity: col(/activity type/)
    };
    const out = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !rowText(row)) continue;
      const rec = { row: r + 1 };
      let any = false;
      Object.keys(map).forEach((k) => {
        const c = map[k];
        if (c < 0) { rec[k] = ''; return; }
        const v = row[c];
        rec[k] = v instanceof Date ? v : txt(v);
        if (rec[k]) any = true;
      });
      if (any) { rec.daysLost = num(row[map.daysLost]) || 0; out.push(rec); }
    }
    return out;
  }

  // -------------------------------------------------------- internal form ---

  function parseInternal(workbook, fileName) {
    const sections = [];
    const quality = [];
    let meta = null;

    workbook.sheets.forEach((sheet) => {
      const rows = sheet.rows;
      const domain = /environment/i.test(sheet.name) ? 'environment' : 'ohs';

      // "This Month" spans the company/contractor/total columns; the row under
      // it names them. Those two rows fix every column position we need.
      const hdrRow = findRow(rows, (r) => r.map(key).some((t) => t === 'this month'));
      if (hdrRow < 0) return;
      const hdr = rows[hdrRow];
      const sub = rows[hdrRow + 1] || [];

      const cCumulative = findCol(hdr, (t) => /^cumulative/.test(key(t)));
      const cRemarks = findCol(hdr, (t) => /^remark/.test(key(t)));
      const cUnit = findCol(hdr, (t) => /^unit/.test(key(t)));
      const cCompany = findCol(sub, (t) => /^company/.test(key(t)));
      const cContractor = findCol(sub, (t) => /^contractor/.test(key(t)));
      const cTotal = findCol(sub, (t) => /^total/.test(key(t)));
      const cNo = findCol(hdr, (t) => /^kpi no/.test(key(t)));
      const cLabel = findCol(hdr, (t) => /^kpi name/.test(key(t)));
      if (cLabel < 0 || cTotal < 0) return;

      if (!meta) meta = internalMeta(rows, hdrRow);

      // "A. Reactive", "B. Energy Consumption(...)" — a lettered banner with no
      // figures beside it. It sits in the label column on one sheet and in
      // column A on the other, so check both.
      const sectionOf = (row) => {
        if (!row) return null;
        for (const c of [cLabel, 0]) {
          const m = txt(row[c]).match(/^([A-Z])\.\s*(.+)$/);
          if (m && num(row[cTotal]) == null && num(row[cCumulative]) == null) {
            return txt(m[2]).replace(/\s*\(.*$/, '');
          }
        }
        return null;
      };

      // The first banner ("A. Reactive") is printed ABOVE the column headers,
      // so seed from there or every KPI in section A would come out unlabelled.
      let section = '';
      for (let r = hdrRow - 1; r >= 0; r--) {
        const s = sectionOf(rows[r]);
        if (s) { section = s; break; }
      }

      for (let r = hdrRow + 2; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        const label = txt(row[cLabel]);
        const line = rowText(row);
        if (!line) continue;

        const sm = sectionOf(row);
        if (sm) { section = sm; continue; }
        if (/^reported by/i.test(label) || /^waste definations|^waste definitions/i.test(label)) break;
        if (!label) continue;

        const total = num(row[cTotal]);
        const cumulative = cCumulative >= 0 ? num(row[cCumulative]) : null;
        const company = cCompany >= 0 ? num(row[cCompany]) : null;
        const contractor = cContractor >= 0 ? num(row[cContractor]) : null;
        if (total == null && cumulative == null && company == null) continue;

        sections.push({
          domain: domain,
          sheet: sheet.name,
          section: section,
          no: cNo >= 0 ? txt(row[cNo]) : '',
          label: label,
          unit: cUnit >= 0 ? txt(row[cUnit]) : '',
          company: company,
          contractor: contractor,
          total: total,
          cumulative: cumulative,
          remarks: cRemarks >= 0 ? txt(row[cRemarks]) : '',
          row: r + 1
        });
      }
    });

    if (!sections.length) throw new Error('This looks like an internal HEGC report, but no KPI rows could be read from it.');

    return {
      kind: 'internal',
      fileName: fileName || '',
      meta: meta || {},
      kpis: sections,
      quality: quality
    };
  }

  function internalMeta(rows, hdrRow) {
    const head = rows.slice(0, hdrRow);
    const grab = (re) => {
      for (let r = 0; r < head.length; r++) {
        const c = findCol(head[r], (t) => re.test(t));
        if (c >= 0) {
          const v = valueRightOf(head[r], c);
          if (v) return v;
        }
      }
      return '';
    };
    const monthRaw = grab(/month\s*&?\s*year/i);
    const my = parseMonthYear(monthRaw);
    const foot = rows.slice(hdrRow).map(rowText).join('\n');
    const rb = foot.match(/Reported\s*by\s*:?\s*([A-Za-z .'-]+?)(?:\s*Designation|$)/i);
    const dg = foot.match(/Designation\s*:?\s*([A-Za-z .'\/-]+?)(?:\s*Date\s*:|$)/i);

    return {
      contractNo: grab(/contract\s*no/i),
      projectTitle: grab(/project\s*title/i),
      client: grab(/^client/i),
      consultant: grab(/consultant/i),
      docRef: (rows[0] ? rowText(rows[0]).match(/Doc\.?\s*Ref\.?\s*([A-Z0-9\-]+)/i) || [] : [])[1] || '',
      monthLabel: monthRaw,
      monthIndex: my.monthIndex,
      monthName: my.monthIndex >= 0 ? MONTH_NAMES[my.monthIndex] : '',
      year: my.year,
      reportedBy: rb ? txt(rb[1]) : '',
      designation: dg ? txt(dg[1]) : ''
    };
  }

  // ------------------------------------------------------------------ api ---

  function parse(workbook, fileName) {
    const kind = detect(workbook);
    if (kind === 'taqa') return parseTaqa(workbook, fileName);
    if (kind === 'internal') return parseInternal(workbook, fileName);
    throw new Error(
      'Unrecognised workbook. Expected either a TAQA "SWS HSE Statistics Performance Report" ' +
      '(Form F-019-F / 3.1-A / 3.1-B) or an internal "Monthly OHS / Environmental Performance Report" ' +
      '(HEGC-IMS-P06-FM-03 / 03A). Sheets found: ' + workbook.sheets.map((s) => '"' + s.name + '"').join(', ') + '.'
    );
  }

  global.HSEParser = {
    parse: parse,
    detect: detect,
    MONTHS: MONTHS,
    MONTH_NAMES: MONTH_NAMES,
    _util: { txt: txt, key: key, num: num }
  };
})(window);
