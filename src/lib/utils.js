// BlinkTransfer — shared low-level utilities — delegated to the shared `frame-kit`.
//
// Deliberately dependency-free and DOM-free so every module here runs in the
// browser, in a Web Worker, and under `node --test`. The implementations now
// live once in `drsamonline/frame-kit` (vendored beside this file as
// `frame-kit.js`); this module re-exports them under the same names.

import './frame-kit.js'; // side-effect: defines globalThis.Frame

const Frame = globalThis.Frame;

export const crc16 = Frame.crc16;
export const crc32 = Frame.crc32;
export const createPRNG = Frame.createPRNG;
export const generateUUID = Frame.generateUUID;
export const xorInto = Frame.xorInto;
export const concatBytes = Frame.concatBytes;
export const formatSize = Frame.formatSize;
export const guessType = Frame.guessType;
