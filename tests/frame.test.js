import test from 'node:test';
import assert from 'node:assert/strict';

import { packFrame, parseFrame, blockCount, frameBytes, presetBlockSize, HEADER_SIZE, PRESETS } from '../src/lib/frame.js';

test('a frame round-trips through pack and parse', () => {
  const data = new Uint8Array(64).map((_, i) => (i * 7) & 0xff);
  const frame = packFrame({
    transferId: 0x1234,
    k: 40,
    blockSize: 64,
    totalLength: 2500,
    payloadCRC: 0xdeadbeef,
    symbolId: 7,
    data,
  });
  assert.equal(frame.length, HEADER_SIZE + 64);
  const parsed = parseFrame(frame);
  assert.equal(parsed.transferId, 0x1234);
  assert.equal(parsed.k, 40);
  assert.equal(parsed.blockSize, 64);
  assert.equal(parsed.totalLength, 2500);
  assert.equal(parsed.payloadCRC, 0xdeadbeef);
  assert.equal(parsed.symbolId, 7);
  assert.deepEqual(parsed.data, data);
});

test('a corrupted header is rejected by its CRC', () => {
  const frame = packFrame({
    transferId: 1, k: 4, blockSize: 32, totalLength: 100, payloadCRC: 5, symbolId: 0,
    data: new Uint8Array(32),
  });
  frame[6] ^= 0xff; // flip a blockSize bit
  assert.throws(() => parseFrame(frame), /checksum/);
});

test('non-frames are rejected', () => {
  assert.throws(() => parseFrame(Uint8Array.of(1, 2, 3)), /truncated/);
  const wrong = new Uint8Array(HEADER_SIZE);
  assert.throws(() => parseFrame(wrong), /not a BlinkTransfer frame/);
});

test('presets and derived sizes are consistent', () => {
  assert.ok(presetBlockSize('robust') < presetBlockSize('dense'));
  assert.equal(frameBytes(presetBlockSize('balanced')), HEADER_SIZE + PRESETS.balanced.blockSize);
  assert.equal(blockCount(2800, 1400), 2);
  assert.equal(blockCount(0, 1400), 1);
  assert.equal(blockCount(1401, 1400), 2);
});

test('frames with impossible sizes are rejected', () => {
  const data = new Uint8Array(32);
  const mk = (over) =>
    packFrame({ transferId: 1, k: 2, blockSize: 32, totalLength: 40, payloadCRC: 1, symbolId: 0, data, ...over });

  // totalLength larger than k * blockSize can never be a real transfer
  assert.throws(() => parseFrame(mk({ totalLength: 5000 })), /inconsistent/);

  // a header claiming more payload than the frame carries
  assert.throws(() => parseFrame(mk().subarray(0, 30)), /truncated/);

  // a crafted header asking for an enormous allocation
  const huge = packFrame({
    transferId: 1, k: 65535, blockSize: 65535,
    totalLength: 200 * 1024 * 1024, payloadCRC: 1, symbolId: 0, data: new Uint8Array(65535),
  });
  assert.throws(() => parseFrame(huge), /oversized/);
});
