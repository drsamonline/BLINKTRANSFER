import test from 'node:test';
import assert from 'node:assert/strict';

import { packFiles, unpackFiles, gzip, gunzip, prepare, restore } from '../src/lib/codec.js';

const enc = (s) => new TextEncoder().encode(s);

test('files pack and unpack with names, types and binary bytes', () => {
  const files = [
    { name: 'note.txt', type: 'text/plain', bytes: enc('hello world') },
    { name: 'blob.bin', type: 'application/octet-stream', bytes: new Uint8Array([0, 1, 2, 255, 254, 128]) },
    { name: 'empty.dat', type: 'application/octet-stream', bytes: new Uint8Array(0) },
  ];
  const container = packFiles(files);
  const out = unpackFiles(container);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((f) => f.name), ['note.txt', 'blob.bin', 'empty.dat']);
  assert.equal(out[0].type, 'text/plain');
  assert.deepEqual(out[1].bytes, files[1].bytes);
  assert.equal(out[2].bytes.length, 0);
});

test('gzip shrinks text and round-trips exactly', async () => {
  const original = enc('BlinkTransfer fountain-coded QR transfer. '.repeat(200));
  const zipped = await gzip(original);
  assert.ok(zipped.length < original.length, 'expected compression');
  assert.deepEqual(await gunzip(zipped), original);
});

test('prepare/restore round-trips a mixed batch', async () => {
  const files = [
    { name: 'a.txt', type: 'text/plain', bytes: enc('the quick brown fox '.repeat(50)) },
    { name: 'b.bin', type: 'application/octet-stream', bytes: crypto.getRandomValues(new Uint8Array(500)) },
  ];
  const { compressed } = await prepare(files);
  const out = await restore(compressed);
  assert.deepEqual(out[0].bytes, files[0].bytes);
  assert.deepEqual(out[1].bytes, files[1].bytes);
});
