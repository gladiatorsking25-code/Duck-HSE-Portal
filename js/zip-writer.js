// zip-writer.js — builds .zip archives in the browser, with no dependencies.
//
// The counterpart to the reader in xlsx-reader.js, and hand-rolled for the same
// reason: the portal is an offline PWA with no build step, so a CDN library is
// not an option. The format itself is small — a local header per file, the
// file bytes, then a central directory and an end record.
//
// Memory matters more than speed here. An audit pack is mostly photos and PDFs
// that are already compressed, so those are STORED, and their Blobs are placed
// into the final archive Blob by reference rather than copied into one huge
// ArrayBuffer. Only the CRC-32 has to read the bytes, and it reads them in
// slices. That keeps a several-hundred-megabyte pack buildable on a phone.
// Text-like files (HTML index, CSV, JSON, .txt, .docx-free formats) are
// deflated with the browser's native CompressionStream when it exists.
//
// Limits: classic ZIP (no ZIP64), so a pack must stay under 4 GB and 65,535
// entries. Both are checked up front with a readable error rather than
// producing a corrupt archive.

(function (global) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crcUpdate(crc, bytes) {
    let c = crc ^ 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const SLICE = 4 * 1024 * 1024;
  async function crcOfBlob(blob, onChunk) {
    let crc = 0;
    for (let off = 0; off < blob.size; off += SLICE) {
      const chunk = new Uint8Array(await blob.slice(off, off + SLICE).arrayBuffer());
      crc = crcUpdate(crc, chunk);
      if (onChunk) onChunk(chunk.length);
    }
    return crc;
  }

  // Formats that are already compressed gain nothing from DEFLATE and cost CPU.
  const ALREADY_COMPRESSED = /\.(jpe?g|png|gif|webp|heic|heif|pdf|zip|rar|7z|gz|docx|xlsx|pptx|xlsm|mp4|mov|m4a|mp3|avi|mkv)$/i;
  const MAX_DEFLATE = 64 * 1024 * 1024; // above this, store rather than hold a compressed copy in memory

  async function deflate(blob) {
    const stream = blob.stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function dosDateTime(d) {
    const dt = (d instanceof Date && !isNaN(d)) ? d : new Date();
    const year = Math.max(1980, dt.getFullYear());
    return {
      time: ((dt.getHours() & 31) << 11) | ((dt.getMinutes() & 63) << 5) | ((Math.floor(dt.getSeconds() / 2)) & 31),
      date: (((year - 1980) & 127) << 9) | (((dt.getMonth() + 1) & 15) << 5) | (dt.getDate() & 31)
    };
  }

  const enc = new TextEncoder();

  function toBlob(data) {
    if (data instanceof Blob) return data;
    if (typeof data === 'string') return new Blob([enc.encode(data)]);
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) return new Blob([data]);
    throw new Error('Unsupported zip entry data.');
  }

  // entries: [{ path, data: Blob|string|Uint8Array, date? }]
  // opts.onProgress({ done, total, entry }) — bytes processed so far.
  async function build(entries, opts) {
    const o = opts || {};
    if (entries.length > 65535) throw new Error('Too many files for one pack (' + entries.length + '). The limit is 65,535.');

    const canDeflate = typeof CompressionStream === 'function';
    const blobs = entries.map((e) => toBlob(e.data));
    const total = blobs.reduce((a, b) => a + b.size, 0);
    if (total > 0xFFFFFFFF - 16 * 1024 * 1024) {
      throw new Error('The evidence adds up to ' + (total / 1073741824).toFixed(2) + ' GB, beyond the 4 GB a standard .zip can hold. ' +
        'Turn on photo shrinking for this audit, or remove duplicate files.');
    }

    const parts = [];
    const central = [];
    let offset = 0;
    let done = 0;
    const seen = new Set();

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let path = String(e.path).replace(/\\/g, '/').replace(/^\/+/, '');
      // Duplicate paths would make the archive ambiguous; suffix them.
      if (seen.has(path.toLowerCase())) {
        const dot = path.lastIndexOf('.');
        let n = 2, alt;
        do { alt = dot > path.lastIndexOf('/') ? path.slice(0, dot) + ' (' + n + ')' + path.slice(dot) : path + ' (' + n + ')'; n++; }
        while (seen.has(alt.toLowerCase()));
        path = alt;
      }
      seen.add(path.toLowerCase());

      const src = blobs[i];
      const nameBytes = enc.encode(path);
      const crc = await crcOfBlob(src, (n) => {
        if (o.onProgress) o.onProgress({ done: done + n, total: total, entry: path });
      });
      done += src.size;

      let method = 0, payload = src, compSize = src.size;
      if (canDeflate && src.size > 0 && src.size <= MAX_DEFLATE && !ALREADY_COMPRESSED.test(path) && o.compress !== false) {
        const z = await deflate(src);
        if (z.length < src.size) { method = 8; payload = new Blob([z]); compSize = z.length; }
      }

      const { time, date } = dosDateTime(e.date);
      const flags = 0x0800; // bit 11: file name is UTF-8

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, flags, true);
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, compSize, true);
      local.setUint32(22, src.size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);

      parts.push(new Uint8Array(local.buffer), nameBytes, payload);
      central.push({ nameBytes, method, time, date, crc, compSize, size: src.size, offset, flags });
      offset += 30 + nameBytes.length + compSize;
      if (offset > 0xFFFFFFFF) throw new Error('The pack grew past the 4 GB limit of a standard .zip.');
    }

    const cdStart = offset;
    let cdSize = 0;
    central.forEach((c) => {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);          // made by: MS-DOS / v2.0
      h.setUint16(6, 20, true);          // needed to extract: v2.0
      h.setUint16(8, c.flags, true);
      h.setUint16(10, c.method, true);
      h.setUint16(12, c.time, true);
      h.setUint16(14, c.date, true);
      h.setUint32(16, c.crc, true);
      h.setUint32(20, c.compSize, true);
      h.setUint32(24, c.size, true);
      h.setUint16(28, c.nameBytes.length, true);
      h.setUint16(30, 0, true);
      h.setUint16(32, 0, true);
      h.setUint16(34, 0, true);
      h.setUint16(36, 0, true);
      h.setUint32(38, 0, true);
      h.setUint32(42, c.offset, true);
      parts.push(new Uint8Array(h.buffer), c.nameBytes);
      cdSize += 46 + c.nameBytes.length;
    });

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    parts.push(new Uint8Array(end.buffer));

    return new Blob(parts, { type: 'application/zip' });
  }

  // A file or folder name that Windows, macOS and Google Drive all accept, and
  // that stays short enough for deep extraction paths on Windows.
  //
  // `ascii` folds typographic punctuation to plain ASCII and drops anything
  // else outside it. Used for the folder names the app generates from
  // checklist wording: older Windows Explorer "Extract All" ignores the zip
  // UTF-8 flag and garbles an em dash into mojibake. The user's own file names
  // are left in full UTF-8 (they may well be Arabic), since there is no
  // faithful ASCII form for them.
  function safeName(s, max, ascii) {
    let src = String(s == null ? '' : s);
    if (ascii) {
      src = src.replace(/[‒-―−]/g, '-').replace(/[‘’‚′]/g, "'")
        .replace(/[“”„″]/g, '').replace(/…/g, '...').replace(/§/g, 'S')
        .replace(/·/g, '-').replace(/[   ]/g, ' ')
        .normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
    }
    const clean = src
      .replace(/[ -<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    const limit = max || 80;
    return (clean.length > limit ? clean.slice(0, limit).trim().replace(/[. ]+$/, '') : clean) || 'file';
  }

  global.ZipWriter = { build: build, safeName: safeName, crc32: (bytes) => crcUpdate(0, bytes) };
})(window);
