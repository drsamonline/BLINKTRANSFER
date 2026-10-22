import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LTDecoder,
  encodeSymbol,
  splitBlocks,
  degreeFor,
  indicesFor,
} from '../src/lib/fountain.js';

function randomBytes(n, seed = 1) {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

/** Feed symbols until the decoder completes; return how many were needed. */
function decodeAll(blocks, blockSize, length, { duplicates = false, shuffle = null } = {}) {
  const dec = new LTDecoder(blocks.length, blockSize, length);
  let used = 0;
  const order = [];
  for (let id = 0; id < 20000 && !dec.complete; id++) order.push(id);
  if (shuffle) order.sort(shuffle);
  for (const id of order) {
    const sym = encodeSymbol(id, blocks);
    dec.addSymbol(id, sym);
    used++;
    if (duplicates && used % 3 === 0) dec.addSymbol(id, sym); // replay, must be ignored
    if (dec.complete) break;
  }
  return { dec, used };
}

test('fountain recovers the payload from symbols in order', () => {
  const blockSize = 128;
  const payload = randomBytes(blockSize * 40, 7);
  const blocks = splitBlocks(payload, blockSize);
  const { dec, used } = decodeAll(blocks, blockSize, payload.length);
  assert.equal(dec.complete, true);
  assert.deepEqual(dec.payload(), payload);
  assert.ok(used < blocks.length * 1.6, `too much overhead: ${used}/${blocks.length}`);
});

test('fountain tolerates duplicates and out-of-order symbols', () => {
  const blockSize = 96;
  const payload = randomBytes(blockSize * 25, 11);
  const blocks = splitBlocks(payload, blockSize);
  const { dec } = decodeAll(blocks, blockSize, payload.length, {
    duplicates: true,
    shuffle: () => Math.random() - 0.5,
  });
  assert.equal(dec.complete, true);
  assert.deepEqual(dec.payload(), payload);
});

test('fountain handles a single block', () => {
  const blockSize = 64;
  const payload = randomBytes(40, 3);
  const blocks = splitBlocks(payload, blockSize);
  assert.equal(blocks.length, 1);
  const dec = new LTDecoder(1, blockSize, payload.length);
  dec.addSymbol(0, encodeSymbol(0, blocks));
  assert.equal(dec.complete, true);
  assert.deepEqual(dec.payload(), payload);
});

test('degrees and index sets are deterministic and in range', () => {
  const k = 50;
  for (const id of [0, 1, 17, 999, 123456]) {
    const d = degreeFor(id, k);
    assert.ok(d >= 1 && d <= k, `degree out of range: ${d}`);
    const a = indicesFor(id, k);
    const b = indicesFor(id, k);
    assert.deepEqual(a, b, 'indices must be reproducible');
    assert.equal(new Set(a).size, a.length, 'indices must be distinct');
    for (const i of a) assert.ok(i >= 0 && i < k);
  }
});

test('payload() refuses an incomplete transfer', () => {
  const dec = new LTDecoder(10, 32, 320);
  assert.throws(() => dec.payload(), /incomplete/);
});
