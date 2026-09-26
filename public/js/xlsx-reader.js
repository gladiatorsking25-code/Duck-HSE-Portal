// xlsx-reader.js — reads .xlsx workbooks in the browser with no dependencies.
//
// Why write this instead of pulling in SheetJS: the portal is a static,
// installable PWA that has to keep working offline from the service worker
// cache, with no build step and no CDN. A 900 KB third-party bundle fetched
// from a CDN would break both of those. An .xlsx is just a ZIP of XML, and the
// browser already ships everything needed to read one — DecompressionStream for
// the deflate, DOMParser for the XML — so the whole reader is ~400 lines.
//
//   const wb = await XLSXReader.read(arrayBuffer);
//   wb.sheets[0].name          -> 'SWS HSE STATISTICS '
//   wb.sheets[0].rows[6][5]    -> value of cell F7 (0-indexed row/col)
//   wb.sheets[0].merges        -> [{ r1, c1, r2, c2 }, ...]
//
// Cell values come back as string | number | Date | boolean | null. Formula
// cells yield their *cached* value — the value Excel last calculated and stored
// in the file — which is what we want: we are reading a submitted report, not
// recalculating it. Error cells (#DIV/0!, #REF!) come back as null rather than
// as Excel's internal sentinel numbers, so a broken formula reads as "no value"
// instead of silently poisoning a chart with -2146826281.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------- inflate --
  // Raw DEFLATE (RFC 1951). DecompressionStream handles this natively in every
  // current browser; the hand-rolled decoder below is the fallback for older
  // Android WebViews, which the Play build can still land on.

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huffman(lengths) {
    // Canonical Huffman table in the "puff" shape: how many codes of each bit
    // length, plus the symbols ordered by (length, symbol).
    const counts = new Array(16).fill(0);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offs = new Array(16).fill(0);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    const symbols = new Array(lengths.length).fill(0);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts: counts, symbols: symbols };
  }

  function inflateRaw(src) {
    let pos = 0, bitBuf = 0, bitCnt = 0;
    let out = new Uint8Array(Math.max(1024, src.length * 6)), outLen = 0;

    function need(extra) {
      if (outLen + extra <= out.length) return;
      let size = out.length;
      while (size < outLen + extra) size *= 2;
      const next = new Uint8Array(size);
      next.set(out.subarray(0, outLen));
      out = next;
    }
    function bits(n) {
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error('deflate: out of input');
        bitBuf |= src[pos++] << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n; bitCnt -= n;
      return v;
    }
    function decode(tree) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= bits(1);
        const count = tree.counts[len];
        if (code - first < count) return tree.symbols[index + (code - first)];
        index += count; first = (first + count) << 1; code <<= 1;
      }
      throw new Error('deflate: bad code');
    }

    let fixedLit = null, fixedDist = null;
    function fixedTrees() {
      if (fixedLit) return;
      const l = new Array(288);
      for (let i = 0; i < 144; i++) l[i] = 8;
      for (let i = 144; i < 256; i++) l[i] = 9;
      for (let i = 256; i < 280; i++) l[i] = 7;
      for (let i = 280; i < 288; i++) l[i] = 8;
      fixedLit = huffman(l);
      fixedDist = huffman(new Array(30).fill(5));
    }

    for (;;) {
      const last = bits(1), type = bits(2);
      if (type === 0) {
        // Stored: discard the partial byte, then a length/complement pair.
        bitBuf = 0; bitCnt = 0;
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        need(len);
        out.set(src.subarray(pos, pos + len), outLen);
        outLen += len; pos += len;
      } else {
        let lit, dist;
        if (type === 1) { fixedTrees(); lit = fixedLit; dist = fixedDist; }
        else if (type === 2) {
          const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
          const clens = new Array(19).fill(0);
          for (let i = 0; i < ncode; i++) clens[CLEN_ORDER[i]] = bits(3);
          const ctree = huffman(clens);
          const lengths = [];
          while (lengths.length < nlen + ndist) {
            const sym = decode(ctree);
            if (sym < 16) lengths.push(sym);
            else if (sym === 16) {
              const prev = lengths[lengths.length - 1];
              let n = 3 + bits(2);
              while (n--) lengths.push(prev);
            } else if (sym === 17) { let n = 3 + bits(3); while (n--) lengths.push(0); }
            else { let n = 11 + bits(7); while (n--) lengths.push(0); }
          }
          lit = huffman(lengths.slice(0, nlen));
          dist = huffman(lengths.slice(nlen));
        } else throw new Error('deflate: reserved block type');

        for (;;) {
          const sym = decode(lit);
          if (sym < 256) { need(1); out[outLen++] = sym; }
          else if (sym === 256) break;
          else {
            const li = sym - 257;
            const length = LEN_BASE[li] + bits(LEN_EXTRA[li]);
            const di = decode(dist);
            const distance = DIST_BASE[di] + bits(DIST_EXTRA[di]);
            need(length);
            let from = outLen - distance;
            for (let i = 0; i < length; i++) out[outLen++] = out[from++];
          }
        }
      }
      if (last) break;
    }
    return out.subarray(0, outLen);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'function') {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* fall through to the JS decoder */ }
    }
    return inflateRaw(bytes);
  }

  // -------------------------------------------------------------------- zip --

  async function unzip(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    // End-of-central-directory record, scanned backwards past any ZIP comment.
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).');

    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const files = {};

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = decoder.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

      // The local header repeats the name/extra lengths, and they can differ
      // from the central directory's — always read the local ones.
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(start, start + compSize);

      files[name] = method === 0 ? raw : await inflate(raw);
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return { files: files, text: (n) => (files[n] ? decoder.decode(files[n]) : null) };
  }

  // -------------------------------------------------------------------- xml --

  const parser = new DOMParser();
  function xml(text) {
    const doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Corrupt XML inside the workbook.');
    return doc;
  }
  // Tag names are namespace-prefixed in some producers' files, so match on the
  // local name rather than assuming the default namespace.
  function tags(node, local) {
    const all = node.getElementsByTagName('*');
    const hits = [];
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      if ((n.localName || n.nodeName.split(':').pop()) === local) hits.push(n);
    }
    return hits;
  }

  // ------------------------------------------------------------- date/style --

  const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

  function looksLikeDateFormat(code) {
    if (!code) return false;
    // Strip quoted literals and colour/condition blocks before sniffing for
    // date tokens, so "0.00\"m\"" (metres) isn't mistaken for a month.
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    return /[ymdhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
  }

  function readStyles(text) {
    // Maps a cell's style index (s="12") to whether that style is a date format.
    if (!text) return [];
    const doc = xml(text);
    const custom = {};
    tags(doc, 'numFmt').forEach((n) => {
      custom[n.getAttribute('numFmtId')] = n.getAttribute('formatCode');
    });
    const cellXfs = tags(doc, 'cellXfs')[0];
    if (!cellXfs) return [];
    return tags(cellXfs, 'xf').map((xf) => {
      const id = Number(xf.getAttribute('numFmtId') || 0);
      return BUILTIN_DATE_FMT.has(id) || looksLikeDateFormat(custom[String(id)]);
    });
  }

  const EPOCH_1900 = Date.UTC(1899, 11, 30);
  const EPOCH_1904 = Date.UTC(1904, 0, 1);
  function serialToDate(serial, is1904) {
    // Excel's 1900 calendar wrongly contains 29 Feb 1900, which the 1899-12-30
    // anchor already absorbs for every serial past that phantom day.
    const ms = (is1904 ? EPOCH_1904 : EPOCH_1900) + Math.round(serial * 86400000);
    return new Date(ms);
  }

  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  // ---------------------------------------------------------------- reading --

  function readSharedStrings(text) {
    if (!text) return [];
    const doc = xml(text);
    return tags(doc, 'si').map((si) => {
      // Rich text splits one logical string across several <t> runs.
      let s = '';
      const ts = tags(si, 't');
      for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
      return s;
    });
  }

  function readSheet(text, shared, dateStyles, is1904) {
    const doc = xml(text);
    const rows = [];
    let maxCol = 0;

    tags(doc, 'row').forEach((rowEl) => {
      const rIdx = Number(rowEl.getAttribute('r') || 0) - 1;
      if (rIdx < 0) return;
      const cells = [];
      const cs = rowEl.children;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if ((c.localName || c.nodeName.split(':').pop()) !== 'c') continue;
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : cells.length;
        const type = c.getAttribute('t') || 'n';

        let value = null;
        if (type === 'inlineStr') {
          let s = '';
          const ts = tags(c, 't');
          for (let k = 0; k < ts.length; k++) s += ts[k].textContent;
          value = s;
        } else {
          let vEl = null;
          for (let k = 0; k < c.children.length; k++) {
            const ch = c.children[k];
            if ((ch.localName || ch.nodeName.split(':').pop()) === 'v') { vEl = ch; break; }
          }
          const rawText = vEl ? vEl.textContent : null;
          if (rawText == null || rawText === '') value = null;
          else if (type === 's') value = shared[Number(rawText)] != null ? shared[Number(rawText)] : null;
          else if (type === 'str') value = rawText;
          else if (type === 'b') value = rawText === '1';
          else if (type === 'e') value = null; // #DIV/0!, #REF! — treat as "no value"
          else {
            const num = Number(rawText);
            if (!isFinite(num)) value = null;
            else {
              const si = Number(c.getAttribute('s') || -1);
              value = (si >= 0 && dateStyles[si]) ? serialToDate(num, is1904) : num;
            }
          }
        }
        cells[ci] = value;
        if (ci + 1 > maxCol) maxCol = ci + 1;
      }
      rows[rIdx] = cells;
    });

    // Normalise into a dense rectangle so callers can index without guarding.
    const height = rows.length;
    const dense = [];
    for (let r = 0; r < height; r++) {
      const src = rows[r] || [];
      const line = new Array(maxCol);
      for (let c = 0; c < maxCol; c++) line[c] = src[c] === undefined ? null : src[c];
      dense.push(line);
    }

    const merges = tags(doc, 'mergeCell').map((m) => {
      const parts = String(m.getAttribute('ref') || '').split(':');
      if (parts.length !== 2) return null;
      const r1 = Number(parts[0].replace(/[^0-9]/g, '')) - 1;
      const r2 = Number(parts[1].replace(/[^0-9]/g, '')) - 1;
      return { r1: r1, c1: colIndex(parts[0]), r2: r2, c2: colIndex(parts[1]) };
    }).filter(Boolean);

    return { rows: dense, merges: merges };
  }

  async function read(buffer) {
    const zip = await unzip(buffer);

    const wbText = zip.text('xl/workbook.xml');
    if (!wbText) throw new Error('This file is not an Excel workbook (.xlsx). If it is an old .xls, re-save it as .xlsx first.');
    const wbDoc = xml(wbText);

    const is1904 = tags(wbDoc, 'workbookPr').some((p) => {
      const v = p.getAttribute('date1904');
      return v === '1' || v === 'true';
    });

    // r:id -> part path, via the workbook's relationship file.
    const relsText = zip.text('xl/_rels/workbook.xml.rels');
    const relMap = {};
    if (relsText) {
      tags(xml(relsText), 'Relationship').forEach((r) => {
        let target = r.getAttribute('Target') || '';
        if (target.startsWith('/xl/')) target = target.slice(1);
        else if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\.\//, '');
        relMap[r.getAttribute('Id')] = target;
      });
    }

    const shared = readSharedStrings(zip.text('xl/sharedStrings.xml'));
    const dateStyles = readStyles(zip.text('xl/styles.xml'));

    const sheets = [];
    const sheetEls = tags(wbDoc, 'sheet');
    for (let i = 0; i < sheetEls.length; i++) {
      const el = sheetEls[i];
      const rid = el.getAttribute('r:id') || el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const path = relMap[rid] || ('xl/worksheets/sheet' + (i + 1) + '.xml');
      const text = zip.text(path);
      if (!text) continue;
      const parsed = readSheet(text, shared, dateStyles, is1904);
      sheets.push({
        name: el.getAttribute('name') || ('Sheet' + (i + 1)),
        rows: parsed.rows,
        merges: parsed.merges
      });
    }
    if (!sheets.length) throw new Error('The workbook has no readable worksheets.');
    return { sheets: sheets };
  }

  // Copies each merged range's anchor value into the rest of the range. The
  // TAQA form leans heavily on vertical merges for its KPI group labels, so
  // without this a row reads as blank where the label is "obviously" there.
  function expandMerges(sheet) {
    const rows = sheet.rows;
    (sheet.merges || []).forEach((m) => {
      const anchor = rows[m.r1] ? rows[m.r1][m.c1] : null;
      if (anchor == null || anchor === '') return;
      for (let r = m.r1; r <= m.r2; r++) {
        if (!rows[r]) continue;
        for (let c = m.c1; c <= m.c2; c++) {
          if (rows[r][c] == null || rows[r][c] === '') rows[r][c] = anchor;
        }
      }
    });
    return sheet;
  }

  // `unzip` is exported for the audit tool, which re-opens compiled evidence
  // packs; an .xlsx is just one kind of zip, so the same reader serves both.
  global.XLSXReader = { read: read, unzip: unzip, expandMerges: expandMerges, serialToDate: serialToDate };
})(window);
