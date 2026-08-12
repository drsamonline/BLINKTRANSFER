/**
 * BlinkTransfer Shared Utilities
 * Common constants, math functions, and helpers for Workers and Main Thread
 */

// --- Constants ---
export const QR_VERSION = 40;
export const QR_ERROR_CORRECTION = 'L';
// Max payload for Version 40-L is 2953 bytes. 
// We use 1600 bytes for data + header to ensure robust scanning on mobile cameras.
export const MAX_PAYLOAD_BYTES = 1600; 
export const HEADER_SIZE = 27; // 1(ver) + 16(uuid) + 4(k) + 4(idx) + 2(crc)
export const SYMBOL_DATA_SIZE = MAX_PAYLOAD_BYTES - HEADER_SIZE; // 1573 bytes
export const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB recommended limit

// --- Math & CRC ---

/**
 * Calculate CRC16-CCITT (polynomial 0x1021) for error detection
 */
export function calculateCRC16(data) {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

/**
 * Generate a random UUID (v4) as a byte array (16 bytes)
 */
export function generateUUIDBytes() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  // Set version to 4
  arr[6] = (arr[6] & 0x0f) | 0x40;
  // Set variant to RFC4122
  arr[8] = (arr[8] & 0x3f) | 0x80;
  return arr;
}

/**
 * Convert UUID bytes to hex string for debugging/logging
 */
export function uuidBytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('-');
}

// --- LT Code Math (Robust Soliton) ---

/**
 * Ideal Soliton Distribution
 */
export function idealSolitonDist(d, k) {
  if (d === 1) return 1 / k;
  return 1 / (d * (d - 1));
}

/**
 * Robust Soliton Distribution parameters
 */
export function getRobustSolitonParams(k) {
  const c = 0.1; // Tuning parameter
  const delta = 0.5; // Failure probability
  const R = c * Math.log(k / delta) * Math.sqrt(k);
  return { c, delta, R };
}

/**
 * Tau function for Robust Soliton
 */
export function tau(d, k, R) {
  if (d >= 1 && d < k / R) {
    return R / (k * d);
  } else if (d === Math.floor(k / R)) {
    return R * Math.log(R / delta) / k; // Approximation
  }
  return 0;
}

// Simplified Robust Soliton Degree Generator
// Pre-calculates the distribution table for speed
export function createDegreeGenerator(k) {
  const { c, delta, R } = getRobustSolitonParams(k);
  const dist = new Float64Array(k + 1);
  let sum = 0;

  for (let d = 1; d <= k; d++) {
    let val = idealSolitonDist(d, k);
    const extra = (d < k / R) ? (R / (k * d)) : (d === Math.floor(k / R) ? (R * Math.log(R / delta) / k) : 0);
    val += extra;
    dist[d] = val;
    sum += val;
  }

  // Normalize
  for (let d = 1; d <= k; d++) {
    dist[d] /= sum;
  }

  // Create cumulative distribution for O(1) sampling
  const cumDist = new Float64Array(k + 1);
  let running = 0;
  for (let d = 1; d <= k; d++) {
    running += dist[d];
    cumDist[d] = running;
  }

  return function(seed) {
    // Simple seeded random [0, 1)
    const x = seededRandom(seed);
    // Binary search or linear scan (linear is fine for small k, binary for large)
    // Linear scan is often faster for small arrays due to branch prediction
    for (let d = 1; d <= k; d++) {
      if (x < cumDist[d]) return d;
    }
    return k;
  };
}

/**
 * Seeded PRNG (Mulberry32)
 */
export function seededRandom(seed) {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Select 'count' distinct random indices from 0 to 'max'-1 using a seed
 */
export function selectDistinctIndices(seed, count, max) {
  const indices = new Uint32Array(count);
  let used = 0;
  
  // For small counts relative to max, rejection sampling is fast
  // For large counts, we might need a shuffle, but LT degrees are usually small
  const rng = () => {
    seed += 0x6D2B79F5;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    let idx;
    let collision;
    do {
      collision = false;
      idx = Math.floor(rng() * max);
      for (let j = 0; j < i; j++) {
        if (indices[j] === idx) {
          collision = true;
          break;
        }
      }
    } while (collision);
    indices[i] = idx;
  }
  return indices;
}
