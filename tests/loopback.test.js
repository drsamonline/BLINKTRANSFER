// End-to-end optical loopback: files -> fountain frames -> QR pixels ->
// jsQR -> fountain decode -> files. This is the whole transport, in Node.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderQR } from './helpers.js';
import { decodeImage } from '../src/lib/qr.js';
import { prepare, restore } from '../src/lib/codec.js';
import { splitBlocks, encodeSymbol, LTDecoder } from '../src/lib/fountain.js';
import { packFrame, parseFrame, blockCount, presetBlockSize } from '../src/lib/frame.js';
import { crc32 } from '../src/lib/utils.js';

const enc = (s) => new TextEncoder().encode(s);

async function loopback(files, preset = 'balanced', { scale = 5 } = {}) {
  const { compressed } = await prepare(files);
  const blockSize = presetBlockSize(preset);
  const k = blockCount(compressed.length, blockSize);
  const blocks = splitBlocks(compressed, blockSize);
  const payloadCRC = crc32(compressed);
  const transferId = 0x4242;

  const decoder = new LTDecoder(k, blockSize, compressed.length);
  let symbols = 0;
  for (let id = 0; id < k * 5 + 200 && !decoder.complete; id++) {
    const data = encodeSymbol(id, blocks);
    const frame = packFrame({
      transferId, k, blockSize, totalLength: compressed.length, payloadCRC, symbolId: id, data,
    });
    const decoded = decodeImage(renderQR(frame, { scale }));
    assert.ok(decoded, `QR for symbol ${id} failed to decode`);
    const parsed = parseFrame(decoded);
    assert.equal(parsed.symbolId, id);
    decoder.addSymbol(parsed.symbolId, parsed.data);
    symbols++;
  }
  return { compressed, payloadCRC, k, symbols, decoder };
}

test('full optical loopback restores a text file and a binary file', async () => {
  const files = [
    { name: 'readme.txt', type: 'text/plain', bytes: enc('BlinkTransfer, end to end. '.repeat(300)) },
    { name: 'data.bin', type: 'application/octet-stream', bytes: crypto.getRandomValues(new Uint8Array(3000)) },
  ];
  const { compressed, payloadCRC, k, symbols, decoder } = await loopback(files);

  assert.equal(decoder.complete, true, 'fountain decode did not complete');
  const payload = decoder.payload();
  assert.deepEqual(payload, compressed);
  assert.equal(crc32(payload), payloadCRC);

  const out = await restore(payload);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'readme.txt');
  assert.deepEqual(out[0].bytes, files[0].bytes);
  assert.deepEqual(out[1].bytes, files[1].bytes);
  assert.ok(symbols < k * 3, `overhead too high: ${symbols} symbols for ${k} blocks`);
});

test('loopback works in robust density too', async () => {
  const files = [{ name: 'note.txt', type: 'text/plain', bytes: enc('small payload, big cells. '.repeat(40)) }];
  const { k, decoder } = await loopback(files, 'robust', { scale: 6 });
  assert.equal(decoder.complete, true);
  const out = await restore(decoder.payload());
  assert.deepEqual(out[0].bytes, files[0].bytes);
  assert.ok(k >= 1);
});

test('a frame that decodes to garbage is rejected, not absorbed', () => {
  const frame = packFrame({
    transferId: 1, k: 4, blockSize: 32, totalLength: 100, payloadCRC: 5, symbolId: 0,
    data: new Uint8Array(32),
  });
  frame[6] ^= 0x01; // corrupt blockSize in the header
  assert.throws(() => parseFrame(frame), /checksum/);
});
