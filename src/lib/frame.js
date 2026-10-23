// Frame format — delegated to the shared `frame-kit`.
//
// Every QR in a transfer carries the same 22-byte self-describing header plus
// one fountain symbol, so a receiver can lock on to *any* frame — there is no
// separate "header QR" to catch first.
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
// The header and its validation used to live here; they are now extracted once
// into `drsamonline/frame-kit`, vendored beside this file as `frame-kit.js`.
// Everything here is a thin adapter over the kit, so the repo keeps the same
// public API while the framing lives in one place.

import './frame-kit.js'; // side-effect: defines globalThis.Frame

const Frame = globalThis.Frame;

export const MAGIC = 0xb7;
export const VERSION = Frame.VERSION;
export const HEADER_SIZE = Frame.HEADER_SIZE;

// A frame is untrusted input: bound what a header may claim, so a corrupt or
// crafted frame cannot make the receiver allocate a huge decoder.
export const MAX_CONTAINER = Frame.MAX_CONTAINER;

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
export const frameBytes = (blockSize) => Frame.frameBytes(blockSize);

/** Number of source blocks a payload needs at this block size. */
export const blockCount = (length, blockSize) => Frame.blockCount(length, blockSize);

/** Pack one fountain symbol into a frame, header CRC included. */
export function packFrame({ transferId, k, blockSize, totalLength, payloadCRC, symbolId, data }) {
  return Frame.pack({ magic: MAGIC, transferId, k, blockSize, totalLength, payloadCRC, symbolId, data });
}

/**
 * Parse a decoded QR payload back into a frame.
 * @throws if the bytes are not a valid BlinkTransfer frame
 */
export function parseFrame(bytes) {
  return Frame.parse(bytes, { magics: [MAGIC], label: 'BlinkTransfer' });
}
