// QR layer: the only place that knows about the QR libraries.
//
// Encoding uses `qrcode-generator` (MIT); decoding uses `jsQR` (Apache-2.0).
// Both are bundled by Vite, so nothing is fetched at runtime — the app works
// fully offline once installed.
//
// Binary safety: `qrcode-generator`'s byte mode maps each character to one byte
// (latin-1), and `jsQR` exposes the decoded bytes as `binaryData`. We therefore
// pass a latin-1 string in and read `binaryData` out, so arbitrary binary
// payloads round-trip exactly — no base64 overhead.

import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

/** Uint8Array -> one-char-per-byte (latin-1) string. */
export function bytesToBinaryString(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return s;
}

/** one-char-per-byte string -> Uint8Array. */
export function binaryStringToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Encode bytes to a QR module matrix with automatic version selection.
 * @param {Uint8Array} bytes
 * @returns {{count:number, isDark:(r:number,c:number)=>boolean}}
 */
export function encodeMatrix(bytes) {
  const qr = qrcode(0, 'L'); // typeNumber 0 = pick the smallest version that fits
  qr.addData(bytesToBinaryString(bytes), 'Byte');
  qr.make();
  return { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

/**
 * Draw a QR for `bytes` onto a canvas 2D context, filling `size`×`size`.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawQR(ctx, bytes, size, { margin = 4, dark = '#000', light = '#fff' } = {}) {
  const { count, isDark } = encodeMatrix(bytes);
  const modules = count + margin * 2;
  const scale = size / modules;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!isDark(r, c)) continue;
      ctx.fillRect(
        Math.round((c + margin) * scale),
        Math.round((r + margin) * scale),
        Math.ceil(scale),
        Math.ceil(scale),
      );
    }
  }
  return { count, scale };
}

/**
 * Decode a QR from an ImageData-like object into raw bytes.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @returns {Uint8Array|null}
 */
export function decodeImage(image, options = {}) {
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: options.inversionAttempts ?? 'attemptBoth',
  });
  return result ? Uint8Array.from(result.binaryData) : null;
}

/**
 * Try progressively downscaled copies too, so a code that is too close (or too
 * far) for the camera still decodes. `makeImage(w, h)` returns a fresh
 * ImageData-like object — supplied by the caller so this stays DOM-free.
 */
export function decodeWithScales(makeImage, width, height, scales = [1, 0.6, 0.35]) {
  for (const scale of scales) {
    const w = Math.max(24, Math.round(width * scale));
    const h = Math.max(24, Math.round(height * scale));
    const image = makeImage(w, h);
    const bytes = decodeImage(image);
    if (bytes) return { bytes, scale };
  }
  return null;
}
