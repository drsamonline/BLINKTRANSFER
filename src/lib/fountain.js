// Luby Transform (LT) fountain codes.
//
// A fountain code turns k source blocks into an endless stream of encoded
// symbols. The receiver can rebuild the source from *any* k + a little overhead
// symbols, in any order, with duplicates ignored — which is exactly what an
// optical link needs, because the camera will always miss some frames.
//
// Every encoded symbol is the XOR of a pseudorandom subset of the source
// blocks. The subset is derived purely from the symbol's id and k, so the
// decoder reconstructs the same subset without any side channel. Decoding is
// belief propagation over a degree-1 "ripple".

import { createPRNG, xorInto } from './utils.js';

// Robust Soliton parameters. c trades overhead for a heavier tail; delta is the
// target failure probability.
export const DEFAULT_C = 0.03;
export const DEFAULT_DELTA = 0.5;

const CDF_CACHE = new Map();

/** Cumulative degree distribution (Robust Soliton) for k blocks. */
export function degreeCDF(k, c = DEFAULT_C, delta = DEFAULT_DELTA) {
  const key = `${k}:${c}:${delta}`;
  const hit = CDF_CACHE.get(key);
  if (hit) return hit;

  const rho = new Float64Array(k + 1);
  rho[1] = 1 / k;
  for (let d = 2; d <= k; d++) rho[d] = 1 / (d * (d - 1));

  const R = c * Math.log(k / delta) * Math.sqrt(k);
  const tau = new Float64Array(k + 1);
  const kr = Math.max(1, Math.min(k, Math.round(k / R)));
  for (let d = 1; d < kr; d++) tau[d] = R / (d * k);
  tau[kr] += (R * Math.log(R / delta)) / k;

  const cdf = new Float64Array(k + 1);
  let sum = 0;
  for (let d = 1; d <= k; d++) {
    sum += rho[d] + tau[d];
    cdf[d] = sum;
  }
  for (let d = 1; d <= k; d++) cdf[d] /= sum;

  CDF_CACHE.set(key, cdf);
  return cdf;
}

/** Degree of the symbol with this id. Deterministic on both sides. */
export function degreeFor(symbolId, k, c = DEFAULT_C, delta = DEFAULT_DELTA) {
  const cdf = degreeCDF(k, c, delta);
  const rng = createPRNG((symbolId ^ 0x9e3779b9) >>> 0);
  const u = rng();
  let lo = 1;
  let hi = k;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The distinct source-block indices XORed into symbol `symbolId`. */
export function indicesFor(symbolId, k, c = DEFAULT_C, delta = DEFAULT_DELTA) {
  const d = Math.min(k, degreeFor(symbolId, k, c, delta));
  const rng = createPRNG((symbolId ^ 0x85ebca6b) >>> 0);
  const picked = new Set();
  while (picked.size < d) picked.add((rng() * k) | 0);
  return Array.from(picked);
}

/**
 * Produce the encoded symbol for `symbolId`.
 * @param {number} symbolId
 * @param {Uint8Array[]} blocks equal-length source blocks
 */
export function encodeSymbol(symbolId, blocks, c = DEFAULT_C, delta = DEFAULT_DELTA) {
  const k = blocks.length;
  const idx = indicesFor(symbolId, k, c, delta);
  const out = Uint8Array.from(blocks[idx[0]]);
  for (let i = 1; i < idx.length; i++) xorInto(out, blocks[idx[i]]);
  return out;
}

/** Split a payload into k equal-length blocks, zero-padded on the last. */
export function splitBlocks(payload, blockSize) {
  const k = Math.max(1, Math.ceil(payload.length / blockSize));
  const blocks = [];
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(blockSize);
    block.set(payload.subarray(i * blockSize, (i + 1) * blockSize));
    blocks.push(block);
  }
  return blocks;
}

/**
 * Belief-propagation LT decoder.
 *
 * Feed it `addSymbol(id, data)` in any order, with any number of duplicates,
 * until `complete` is true, then read `payload` (trimmed to `length`).
 */
export class LTDecoder {
  constructor(k, blockSize, length, c = DEFAULT_C, delta = DEFAULT_DELTA) {
    this.k = k;
    this.blockSize = blockSize;
    this.length = length;
    this.c = c;
    this.delta = delta;
    this.blocks = new Array(k).fill(null);
    this.resolvedCount = 0;
    this.symbols = new Map(); // id -> { value, set }
    this.adjacency = new Map(); // blockIndex -> Set(symbolId)
    this.ripple = []; // symbol ids currently at degree 1
    this.seen = new Set();
    this.symbolsAccepted = 0;
  }

  get complete() {
    return this.resolvedCount === this.k;
  }

  get progress() {
    return this.k === 0 ? 1 : this.resolvedCount / this.k;
  }

  /**
   * Absorb one symbol.
   * @returns {boolean} true if it was new and contributed to the ripple
   */
  addSymbol(symbolId, data) {
    if (this.complete || this.seen.has(symbolId)) return false;
    this.seen.add(symbolId);
    this.symbolsAccepted++;

    const value = Uint8Array.from(data);
    const set = new Set();
    for (const b of indicesFor(symbolId, this.k, this.c, this.delta)) {
      if (this.blocks[b]) xorInto(value, this.blocks[b]);
      else set.add(b);
    }
    if (set.size === 0) return false; // wholly redundant given what we know

    this.symbols.set(symbolId, { value, set });
    for (const b of set) {
      let list = this.adjacency.get(b);
      if (!list) this.adjacency.set(b, (list = new Set()));
      list.add(symbolId);
    }
    if (set.size === 1) this.ripple.push(symbolId);
    this.#propagate();
    return true;
  }

  #propagate() {
    while (this.ripple.length) {
      const id = this.ripple.pop();
      const sym = this.symbols.get(id);
      if (!sym || sym.set.size !== 1) continue;
      const [b] = sym.set;
      if (this.blocks[b]) continue;

      this.blocks[b] = sym.value;
      this.resolvedCount++;
      this.symbols.delete(id);

      const neighbours = this.adjacency.get(b);
      this.adjacency.delete(b);
      if (!neighbours) continue;
      for (const nid of neighbours) {
        const ns = this.symbols.get(nid);
        if (!ns) continue;
        xorInto(ns.value, sym.value);
        ns.set.delete(b);
        if (ns.set.size === 1) this.ripple.push(nid);
        else if (ns.set.size === 0) this.symbols.delete(nid);
      }
    }
  }

  /** Reassemble the payload. Throws if the transfer is not yet complete. */
  payload() {
    if (!this.complete) throw new Error('transfer incomplete');
    const out = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) out.set(this.blocks[i], i * this.blockSize);
    return out.subarray(0, this.length);
  }
}
