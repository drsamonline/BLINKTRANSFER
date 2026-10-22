import test from 'node:test';
import assert from 'node:assert/strict';

import { LTDecoder, encodeSymbol, splitBlocks } from '../src/lib/fountain.js';
import { packFrame, parseFrame, HEADER_SIZE } from '../src/lib/frame.js';
import { packFiles, unpackFiles } from '../src/lib/codec.js';

test('fountain stays efficient at a larger block count', () => {
  const blockSize = 64;
  const k = 200;
  const payload = crypto.getRandomValues(new Uint8Array(blockSize * k));
  const blocks = splitBlocks(payload, blockSize);
  const dec = new LTDecoder(k, blockSize, payload.length);
  let used = 0;
  for (let id = 0; id < k * 3 && !dec.complete; id++) {
    dec.addSymbol(id, encodeSymbol(id, blocks));
    used++;
  }
  assert.equal(dec.complete, true);
  assert.deepEqual(dec.payload(), payload);
  assert.ok(used < k * 1.7, `overhead too high at k=${k}: ${used}`);
});

test('a frame with an empty grid is rejected', () => {
  const frame = packFrame({
    transferId: 1, k: 1, blockSize: 0, totalLength: 0, payloadCRC: 0, symbolId: 0,
    data: new Uint8Array(0),
  });
  assert.equal(frame.length, HEADER_SIZE);
  assert.throws(() => parseFrame(frame), /empty grid/);
});

test('a frame whose symbol id is out of range is rejected', () => {
  const frame = packFrame({
    transferId: 1, k: 2, blockSize: 16, totalLength: 20, payloadCRC: 0,
    symbolId: 0xffffff, data: new Uint8Array(16),
  });
  assert.throws(() => parseFrame(frame), /out of range/);
});

test('unicode file names survive a round trip', () => {
  const files = [
    { name: 'नोट.txt', type: 'text/plain', bytes: new TextEncoder().encode('नमस्ते') },
    { name: 'résumé.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
    { name: 'emoji-😀.dat', type: 'application/octet-stream', bytes: new Uint8Array([9]) },
  ];
  const out = unpackFiles(packFiles(files));
  assert.deepEqual(out.map((f) => f.name), files.map((f) => f.name));
  assert.deepEqual(out[0].bytes, files[0].bytes);
  assert.deepEqual(out[2].bytes, files[2].bytes);
});
