// BlinkTransfer — application shell.
//
// Sender:  files -> gzip -> fountain symbols -> QR frames, looping on screen.
// Receiver: camera -> jsQR -> fountain decode -> gzip -> files.
//
// All the maths lives in ./lib; this file only wires the UI to it.

import { crc32, generateUUID, formatSize, guessType } from './lib/utils.js';
import { prepare, restore } from './lib/codec.js';
import { splitBlocks, encodeSymbol, LTDecoder } from './lib/fountain.js';
import {
  packFrame,
  parseFrame,
  blockCount,
  presetBlockSize,
  DEFAULT_PRESET,
} from './lib/frame.js';
import { drawQR, decodeImage } from './lib/qr.js';

const MAX_TOTAL = 20 * 1024 * 1024; // 20 MB
const PLAIN_MAX = 1200; // max bytes for a single "any scanner" QR
const TEXT_EXT = /\.(txt|md|json|csv|html|css|js|ts|xml|yml|yaml|log|url|vcf|ics)$/i;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  files: [],
  plain: false,
  preset: DEFAULT_PRESET,
  fps: 12,
  // sender
  payload: null,
  blocks: null,
  blockSize: 0,
  k: 0,
  payloadCRC: 0,
  transferId: 0,
  symbolId: 0,
  sending: false,
  loop: 0,
  // receiver
  decoder: null,
  scanning: false,
  stream: null,
  received: [],
  resultUrls: [],
  wakeLock: null,
};

// ------------------------------------------------------------------ chrome

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  $('backBtn').hidden = id === 'screen-home';
  window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(message, tone = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}

$('backBtn').addEventListener('click', () => {
  stopSending();
  stopReceiving();
  show('screen-home');
});
$('goSend').addEventListener('click', () => show('screen-send'));
$('goReceive').addEventListener('click', startReceiving);

// ------------------------------------------------------------------ sender

$('pickBtn').addEventListener('click', () => $('fileInput').click());
$('dropzone').addEventListener('click', (e) => {
  if (e.target.id !== 'pickBtn') $('fileInput').click();
});

$('fileInput').addEventListener('change', (e) => setFiles([...e.target.files]));

['dragover', 'dragleave', 'drop'].forEach((type) => {
  const dz = $('dropzone');
  dz.addEventListener(type, (e) => {
    e.preventDefault();
    dz.classList.toggle('hover', type === 'dragover');
    if (type === 'drop') setFiles([...e.dataTransfer.files]);
  });
});

function setFiles(list) {
  const total = list.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL) {
    toast(`That is ${formatSize(total)} — the limit is ${formatSize(MAX_TOTAL)}`, 'err');
    return;
  }
  state.files = list;
  renderFileList();
}

function renderFileList() {
  const box = $('fileList');
  if (!state.files.length) {
    box.innerHTML = '';
    $('startSend').disabled = true;
    return;
  }
  const total = state.files.reduce((n, f) => n + f.size, 0);
  box.innerHTML =
    `<div class="muted">${state.files.length} file(s) &middot; ${formatSize(total)}</div>` +
    state.files
      .slice(0, 6)
      .map((f) => `<div class="file-row"><span class="name">${escapeHtml(f.name)}</span><span class="size">${formatSize(f.size)}</span></div>`)
      .join('');
  $('startSend').disabled = false;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('preset').addEventListener('change', (e) => (state.preset = e.target.value));
$('fps').addEventListener('input', (e) => {
  state.fps = Number(e.target.value);
  $('fpsLabel').textContent = state.fps;
});
$('plainMode').addEventListener('change', (e) => (state.plain = e.target.checked));

function plainEligible() {
  if (state.files.length !== 1) return false;
  const f = state.files[0];
  if (f.size > PLAIN_MAX) return false;
  return (f.type && f.type.startsWith('text/')) || TEXT_EXT.test(f.name);
}

$('startSend').addEventListener('click', startSending);
$('stopSend').addEventListener('click', () => {
  stopSending();
  show('screen-send');
});

async function startSending() {
  if (!state.files.length) return;
  if (state.plain && !plainEligible()) {
    toast('Compatibility mode needs one small text file (≤ 1.2 KB)', 'warn');
    return;
  }

  const files = await Promise.all(
    state.files.map(async (f) => ({ name: f.name, type: f.type || guessType(f.name), bytes: new Uint8Array(await f.arrayBuffer()) })),
  );

  if (state.plain) {
    state.payload = files[0].bytes;
    show('screen-show');
    drawPlain();
    $('sendMeta').textContent = 'Plain QR — any scanner can read this';
    $('sendPct').textContent = '';
    $('sendBar').style.width = '100%';
    return;
  }

  try {
    const { compressed } = await prepare(files);
    state.payload = compressed;
    state.blockSize = presetBlockSize(state.preset);
    state.k = blockCount(compressed.length, state.blockSize);
    state.blocks = splitBlocks(compressed, state.blockSize);
    state.payloadCRC = crc32(compressed);
    const id = generateUUID();
    state.transferId = (id[0] << 8) | id[1];
    state.symbolId = 0;
    state.loop = 0;

    const frameB = state.blockSize + 22;
    const est = Math.ceil((state.k * 1.1) / state.fps);
    $('sendStats').hidden = false;
    $('sendStats').innerHTML = `
      <div><dt>Payload</dt><dd>${formatSize(compressed.length)}</dd></div>
      <div><dt>Blocks</dt><dd>${state.k}</dd></div>
      <div><dt>Per frame</dt><dd>${formatSize(frameB)}</dd></div>
      <div><dt>One loop</dt><dd>~${est}s</dd></div>`;

    await focusAssist();
    show('screen-show');
    state.sending = true;
    keepAwake(true);
    runSendLoop();
  } catch (err) {
    toast(`Could not prepare: ${err.message}`, 'err');
  }
}

function drawPlain() {
  const canvas = $('qrCanvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  drawQR(ctx, state.payload, size, { margin: 6 });
}

function runSendLoop() {
  if (!state.sending) return;
  const canvas = $('qrCanvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;

  const tick = () => {
    if (!state.sending) return;
    const data = encodeSymbol(state.symbolId, state.blocks);
    const frame = packFrame({
      transferId: state.transferId,
      k: state.k,
      blockSize: state.blockSize,
      totalLength: state.payload.length,
      payloadCRC: state.payloadCRC,
      symbolId: state.symbolId,
      data,
    });
    drawQR(ctx, frame, size, { margin: 4 });

    if (state.symbolId > 0 && state.symbolId % state.k === 0) state.loop++;
    const pct = Math.min(100, Math.round((state.symbolId / (state.k * 1.15)) * 100));
    $('sendBar').style.width = `${pct}%`;
    $('sendPct').textContent = `${pct}%`;
    $('sendMeta').textContent = `Symbol ${state.symbolId + 1} / ${state.k}${state.loop ? ` · loop ${state.loop + 1}` : ''}`;

    state.symbolId++;
    setTimeout(() => requestAnimationFrame(tick), Math.round(1000 / state.fps));
  };
  tick();
}

function stopSending() {
  state.sending = false;
  keepAwake(false);
}

/** Flash a checkerboard so the camera can lock focus and exposure. */
function focusAssist() {
  const canvas = $('focusCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');
  return new Promise((resolve) => {
    let phase = 0;
    const total = 36;
    const cell = 40;
    const step = () => {
      if (phase >= total) {
        canvas.classList.remove('active');
        resolve();
        return;
      }
      for (let y = 0; y < canvas.height; y += cell) {
        for (let x = 0; x < canvas.width; x += cell) {
          ctx.fillStyle = (x / cell + y / cell + phase) % 2 ? '#000' : '#fff';
          ctx.fillRect(x, y, cell, cell);
        }
      }
      phase++;
      requestAnimationFrame(step);
    };
    step();
  });
}

async function keepAwake(on) {
  try {
    if (on) state.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    else {
      await state.wakeLock?.release();
      state.wakeLock = null;
    }
  } catch {
    state.wakeLock = null;
  }
}

// ---------------------------------------------------------------- receiver

$('stopRecv').addEventListener('click', () => {
  stopReceiving();
  show('screen-home');
});

async function startReceiving() {
  if (state.scanning) return;
  show('screen-receive');
  $('results').hidden = true;
  $('saveAll').hidden = true;
  state.received = [];
  state.decoder = null;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    toast(`Camera unavailable: ${err.message}`, 'err');
    show('screen-home');
    return;
  }
  $('video').srcObject = state.stream;
  await $('video').play().catch(() => {});
  state.scanning = true;
  keepAwake(true);
  scanLoop();
}

// A single reusable scratch canvas — one allocation instead of one per attempt.
let scanCanvas = null;
function grab(w, h) {
  const video = $('video');
  if (!scanCanvas) scanCanvas = document.createElement('canvas');
  if (scanCanvas.width !== w || scanCanvas.height !== h) {
    scanCanvas.width = w;
    scanCanvas.height = h;
  }
  const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Full resolution first, then downscales so a code that is too close or too far
// for the sensor still decodes. jsQR itself tries both polarities.
const SCAN_SCALES = [1, 0.65, 0.4];

async function scanLoop() {
  let misses = 0;
  while (state.scanning) {
    const video = $('video');
    if (!video.videoWidth) {
      await sleep(100);
      continue;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let bytes = null;
    for (const scale of SCAN_SCALES) {
      bytes = decodeImage(grab(Math.round(vw * scale), Math.round(vh * scale)));
      if (bytes) break;
    }
    if (bytes) {
      misses = 0;
      try {
        if (await ingest(bytes)) return;
      } catch {
        /* header CRC rejected this frame; keep scanning */
      }
    } else if (++misses % 8 === 0) {
      $('recvMeta').textContent = 'Searching — fill the frame with the code';
    }
    await sleep(35);
  }
}

async function ingest(bytes) {
  const frame = parseFrame(bytes);
  if (
    !state.decoder ||
    state.decoder.k !== frame.k ||
    state.decoder.blockSize !== frame.blockSize ||
    state.decoder.length !== frame.totalLength
  ) {
    state.decoder = new LTDecoder(frame.k, frame.blockSize, frame.totalLength);
    state.recvCRC = frame.payloadCRC;
    state.recvTransferId = frame.transferId;
    toast('Transfer detected — collecting frames…', 'warn');
  }
  state.decoder.addSymbol(frame.symbolId, frame.data);
  const pct = Math.round(state.decoder.progress * 100);
  $('recvBar').style.width = `${pct}%`;
  $('recvPct').textContent = `${pct}%`;
  $('recvMeta').textContent = `${state.decoder.resolvedCount} / ${state.decoder.k} blocks`;

  if (!state.decoder.complete) return false;
  await finishReceive();
  return true;
}

async function finishReceive() {
  const payload = state.decoder.payload();
  if (crc32(payload) !== state.recvCRC) {
    toast('Checksum mismatch — please rescan', 'err');
    state.decoder = null;
    return;
  }
  const files = await restore(payload);
  state.received = files;
  $('recvMeta').textContent = 'Transfer complete';
  $('recvPct').textContent = '100%';
  $('recvBar').style.width = '100%';
  renderResults(files);
  stopReceiving();
  toast(`Received ${files.length} file(s)`, 'ok');
}

function renderResults(files) {
  const box = $('results');
  box.hidden = false;
  // Release the previous transfer's blob URLs before making new ones.
  for (const url of state.resultUrls) URL.revokeObjectURL(url);
  state.resultUrls = [];
  box.innerHTML = files
    .map((f) => {
      const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type }));
      state.resultUrls.push(url);
      return `<div class="result-row"><span class="name">${escapeHtml(f.name)}</span><span class="size">${formatSize(f.bytes.length)}</span><a href="${url}" download="${escapeHtml(f.name)}">Save</a></div>`;
    })
    .join('');
  $('saveAll').hidden = files.length < 2;
}

$('saveAll').addEventListener('click', () => {
  state.received.forEach((f, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type }));
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, i * 250);
  });
});

function stopReceiving() {
  state.scanning = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $('video').srcObject = null;
  keepAwake(false);
}

// -------------------------------------------------------------------- PWA

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// Reflect the saved preset/FPS on load.
$('preset').value = state.preset;
$('fpsLabel').textContent = state.fps;
