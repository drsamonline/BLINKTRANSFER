// Shared test helpers: render QR bytes to an RGBA buffer, no DOM needed.

import { encodeMatrix } from '../src/lib/qr.js';

/** Render a QR (from raw bytes) into an ImageData-like RGBA buffer. */
export function renderQR(bytes, { scale = 6, quiet = 4 } = {}) {
  const { count, isDark } = encodeMatrix(bytes);
  const size = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < count && my < count && isDark(my, mx);
      const v = dark ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}
