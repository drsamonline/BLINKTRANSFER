// BlinkTransfer — shared low-level utilities.
//
// Deliberately dependency-free and DOM-free so every module here runs in the
// browser, in a Web Worker, and under `node --test`.

/** CRC-16/CCITT-FALSE over a byte array. */
export function crc16(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** CRC-32 (IEEE 802.3, reflected) over a byte array. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Mulberry32 — small, fast, deterministic seeded PRNG. */
export function createPRNG(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16 random bytes, used as a per-transfer id. */
export function generateUUID() {
  const out = new Uint8Array(16);
  crypto.getRandomValues(out);
  return out;
}

/** In-place XOR of `source` into `target` (target wins on length). */
export function xorInto(target, source) {
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i++) target[i] ^= source[i];
  return target;
}

/** Concatenate byte arrays. */
export function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Human-readable byte size. */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Best-effort MIME type from a filename extension. */
export function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
    zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}
