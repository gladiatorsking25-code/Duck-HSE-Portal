// photo.js — capture and downscale certificate photos on-device.
//
// Why resize matters here: everything is stored in localStorage (see storage.js),
// which is a few MB total across the whole app. A raw phone photo is 3–8 MB, so
// three unresized certificate photos would blow the entire quota in one
// checklist. Every image is therefore drawn to a canvas, capped at a longest
// edge, and re-encoded as JPEG before it is ever stored — a legible A4
// certificate lands around 150–350 KB instead of several megabytes.
//
// No dependencies and no network: the whole thing is <canvas> + FileReader, so
// it works offline in the TWA exactly like the rest of the app.

const Photo = (function () {
  'use strict';

  const MAX_DIM = 1600;              // longest edge, px — legible for cert text
  const TARGET_MAX_BYTES = 900 * 1024; // re-compress until a photo is under this

  // file (from <input type=file> / camera) -> resized JPEG data URL.
  function fileToResizedDataUrl(file, opts) {
    const o = opts || {};
    const maxDim = o.maxDim || MAX_DIM;
    let quality = o.quality || 0.72;

    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('Not an image file'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // Flatten onto white — a photographed certificate may be a PNG with
          // transparency, and JPEG has no alpha channel.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          let out = canvas.toDataURL('image/jpeg', quality);
          // Step the quality down for a very detailed / large photo until it
          // fits the per-image budget, so one photo can't dominate storage.
          while (approxBytes(out) > TARGET_MAX_BYTES && quality > 0.4) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(out);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function dataUrlToFile(dataUrl, filename) {
    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], filename || 'photo.jpg', { type: blob.type });
  }

  // Approximate decoded byte size of a base64 data URL.
  function approxBytes(dataUrl) {
    const i = dataUrl.indexOf(',');
    const n = dataUrl.length - (i + 1);
    return Math.round(n * 0.75);
  }

  // Rough localStorage footprint (UTF-16, 2 bytes/char) so the UI can warn the
  // user before they hit the quota wall.
  function localStorageBytes() {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        total += (k ? k.length : 0) + (localStorage.getItem(k) || '').length;
      }
    } catch (e) { /* storage blocked */ }
    return total * 2;
  }

  return { fileToResizedDataUrl, dataUrlToBlob, dataUrlToFile, approxBytes, localStorageBytes, MAX_DIM };
})();
