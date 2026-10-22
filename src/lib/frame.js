// Frame format.
//
// Every QR in a transfer carries the same 22-byte header plus one fountain
// symbol. The header is self-describing, so a receiver can lock on to *any*
// frame — there is no separate "header QR" to catch first.
//
//   0     magic 0xB7
//   1     version
//   2-3   transferId      u16
//   4-5   k               u16   number of source blocks
//   6-7   blockSize       u16   bytes per block / per symbol
//   8-11  totalLength     u32   compressed payload length
//   12-15 payloadCRC      u32   CRC-32 of the whole compressed payload
//   16-19 symbolId        u32   fountain symbol id (0,1,2,... forever)
//   20-21 headerCRC       u16   CRC-16 of bytes 0..19
//   then  blockSize bytes of fountain symbol data
//
// The symbol data itself is protected by the QR's own Reed-Solomon error
// correction; the header CRC-16 catches a header that a decoder mis-read, so a
// corrupt frame is dropped instead of poisoning the fountain decoder.

import { crc16 } from './utils.js';

export const MAGIC = 0xb7;
export const VERSION = 1;
export const HEADER_SIZE = 22;

// A frame is untrusted input: bound what a header may claim, so a corrupt or
// crafted frame cannot make the receiver allocate a huge decoder.
export const MAX_CONTAINER = 64 * 1024 * 1024;

/**
 * QR payload density presets. Bigger blocks mean fewer frames but denser,
 * harder-to-scan codes; smaller blocks scan far more reliably.
 */
export const PRESETS = {
  robust: { blockSize: 800, label: 'Robust', hint: 'small codes, easiest to scan' },
  balanced: { blockSize: 1400, label: 'Balanced', hint: 'the default — good speed and reliability' },
  dense: { blockSize: 1800, label: 'Dense', hint: 'fewest frames, needs a steady camera' },
};
export const DEFAULT_PRESET = 'balanced';

export function presetBlockSize(name) {
  return (PRESETS[name] ?? PRESETS[DEFAULT_PRESET]).blockSize;
}

/** Total QR payload bytes per frame for a given block size. */
export const frameBytes = (blockSize) => HEADER_SIZE + blockSize;

/** Number of source blocks a payload needs at this block size. */
export const blockCount = (length, blockSize) => Math.max(1, Math.ceil(length / blockSize));

/** Pack one fountain symbol into a frame, header CRC included. */
export function packFrame({ transferId, k, blockSize, totalLength, payloadCRC, symbolId, data }) {
  const out = new Uint8Array(HEADER_SIZE + data.length);
  const view = new DataView(out.buffer);
  out[0] = MAGIC;
  out[1] = VERSION;
  view.setUint16(2, transferId & 0xffff, false);
  view.setUint16(4, k, false);
  view.setUint16(6, blockSize, false);
  view.setUint32(8, totalLength, false);
  view.setUint32(12, payloadCRC, false);
  view.setUint32(16, symbolId, false);
  view.setUint16(20, crc16(out.subarray(0, 20)), false);
  out.set(data, HEADER_SIZE);
  return out;
}

/**
 * Parse a decoded QR payload back into a frame.
 * @throws if the bytes are not a valid BlinkTransfer frame
 */
export function parseFrame(bytes) {
  if (bytes.length < HEADER_SIZE) throw new Error('frame truncated');
  if (bytes[0] !== MAGIC) throw new Error('not a BlinkTransfer frame');
  if (bytes[1] !== VERSION) throw new Error(`unsupported frame version ${bytes[1]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (crc16(bytes.subarray(0, 20)) !== view.getUint16(20, false)) {
    throw new Error('frame header failed its checksum');
  }
  const k = view.getUint16(4, false);
  const blockSize = view.getUint16(6, false);
  if (k === 0 || blockSize === 0) throw new Error('frame has an empty grid');
  // The payload must actually carry `blockSize` bytes, and k blocks must be able
  // to hold the container — otherwise a crafted frame could request a huge
  // allocation in the fountain decoder.
  if (bytes.length < HEADER_SIZE + blockSize) throw new Error('frame payload truncated');
  const totalLength = view.getUint32(8, false);
  if (totalLength > k * blockSize) throw new Error('frame sizes are inconsistent');
  if (totalLength > MAX_CONTAINER) throw new Error('frame declares an oversized transfer');
  const payloadCRC = view.getUint32(12, false);
  const symbolId = view.getUint32(16, false);
  if (symbolId >= k * 64 + 1024) {
    // Guard against a header that decoded to nonsense despite the CRC.
    throw new Error('symbol id out of range');
  }
  const data = bytes.slice(HEADER_SIZE, HEADER_SIZE + blockSize);
  return {
    transferId: view.getUint16(2, false),
    k,
    blockSize,
    totalLength,
    payloadCRC,
    symbolId,
    data,
  };
}
