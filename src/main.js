// BlinkTransfer - Main Application Logic
import { 
  MAX_PAYLOAD_BYTES, 
  HEADER_SIZE, 
  SYMBOL_DATA_SIZE, 
  FILE_SIZE_LIMIT,
  calculateCRC16,
  generateUUIDBytes,
  uuidBytesToHex
} from './lib/utils.js';

// DOM Elements
const sendBtn = document.getElementById('sendBtn');
const receiveBtn = document.getElementById('receiveBtn');
const qrScreen = document.getElementById('qrScreen');
const cameraScreen = document.getElementById('cameraScreen');
const qrCanvas = document.getElementById('qrCanvas');
const qrCtx = qrCanvas.getContext('2d');
const videoPreview = document.getElementById('videoPreview');
const qrBackBtn = document.getElementById('qrBackBtn');
const cameraBackBtn = document.getElementById('cameraBackBtn');
const cancelReceiveBtn = document.getElementById('cancelReceiveBtn');
const fileInput = document.getElementById('fileInput');
const qualityModal = document.getElementById('qualityModal');
const downloadModal = document.getElementById('downloadModal');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const toast = document.getElementById('toast');

// Quality modal elements
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const fileSizeDisplay = document.getElementById('fileSizeDisplay');
const fileTypeDisplay = document.getElementById('fileTypeDisplay');
const startTransferBtn = document.getElementById('startTransferBtn');
const cancelCompressionBtn = document.getElementById('cancelCompressionBtn');

// Download modal elements
const receivedFileName = document.getElementById('receivedFileName');
const receivedFileSize = document.getElementById('receivedFileSize');
const receivedFileType = document.getElementById('receivedFileType');
const downloadFileBtn = document.getElementById('downloadFileBtn');
const closeDownloadModalBtn = document.getElementById('closeDownloadModalBtn');

// Constants
const QR_PAYLOAD_MAX = MAX_PAYLOAD_BYTES;
const FPS = 20;

// State
let currentFiles = []; // Array of { file, compressedData, compressionMode }
let encoderWorker = null;
let decoderWorker = null;
let ltDecoderWorker = null;
let qrAnimationId = null;
let isTransferring = false;
let wakeLock = null;
let stream = null;
let animationFrameCount = 0;
let receivedFiles = []; // Array of received files
let currentUUIDBytes = null; // Store UUID as Uint8Array for sender
let totalSymbols = 0;
let symbolsCollected = 0;
let currentSymbolIndex = 0;
let allFileMetadata = []; // For batch transfer
let currentReceivedFiles = null; // For multiple file downloads

// Utility functions
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateUUID() {
  return crypto.randomUUID();
}

// Convert UUID string to bytes (first 16 bytes of the hex representation)
function uuidStringToBytes(uuidStr) {
  // Remove hyphens and convert hex to bytes
  const hex = uuidStr.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function uint8ArrayToBase64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

// File compression
async function compressFile(file, quality = 0.6) {
  const fileType = file.type;
  
  // Check if it's a media file
  const isImage = fileType.startsWith('image/');
  const isVideo = fileType.startsWith('video/');
  const isAudio = fileType.startsWith('audio/');
  
  if (isImage) {
    return await compressImage(file, quality);
  } else if (isVideo || isAudio) {
    // For video/audio, we'll use lossless compression for now
    // Full MediaRecorder re-encoding would require more complex setup
    return await compressLossless(file);
  } else {
    return await compressLossless(file);
  }
}

async function compressImage(file, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      
      // Resize to max 1920px on longest side
      let width = img.width;
      let height = img.height;
      const maxSize = 1920;
      
      if (width > height && width > maxSize) {
        height = Math.round(height * maxSize / width);
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round(width * maxSize / height);
        height = maxSize;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                data: new Uint8Array(reader.result),
                mode: 'lossy-image',
                originalSize: file.size,
                compressedSize: blob.size
              });
            };
            reader.readAsArrayBuffer(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function compressLossless(file) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Use CompressionStream API if available
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(uint8Array);
      writer.close();
      
      const compressedChunks = [];
      const reader = cs.readable.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }
      
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of compressedChunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      return {
        data: compressed,
        mode: 'gzip',
        originalSize: file.size,
        compressedSize: compressed.length
      };
    } catch (e) {
      console.log('CompressionStream failed, using raw data:', e);
    }
  }
  
  // Fallback: no compression
  return {
    data: uint8Array,
    mode: 'none',
    originalSize: file.size,
    compressedSize: uint8Array.length
  };
}

async function decompressData(data, mode, originalSize) {
  if (mode === 'none' || !data) {
    return data;
  }
  
  if (mode === 'gzip' && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();
      
      const decompressedChunks = [];
      const reader = ds.readable.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decompressedChunks.push(value);
      }
      
      const totalLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const decompressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of decompressedChunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      return decompressed;
    } catch (e) {
      console.log('Decompression failed:', e);
    }
  }
  
  return data;
}

// QR Code generation
function generateQRCode(data) {
  // Load qrcode-generator from lib
  if (typeof qrcode === 'undefined') {
    console.error('qrcode-generator not loaded');
    return null;
  }
  
  const qr = qrcode(40, 'L'); // Version 40, Error correction L
  qr.addData(data, 'Byte');
  qr.make();
  
  return qr;
}

function renderQRCode(qr, canvas) {
  const moduleCount = qr.getModuleCount();
  const size = Math.min(canvas.width, canvas.height) * 0.9;
  const moduleSize = Math.floor(size / moduleCount);
  const offset = Math.floor((canvas.width - moduleCount * moduleSize) / 2);
  
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(
          offset + col * moduleSize,
          offset + row * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }
}

// Create QR payload with improved structure
// Header: [1 byte version][16 bytes UUID][4 bytes k][4 bytes symbolIndex][data][2 bytes CRC]
function createQRPayload(uuidBytes, totalSymbols, symbolIndex, packetData) {
  const payloadSize = HEADER_SIZE + packetData.length;
  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);
  
  let offset = 0;
  payload[offset++] = 0x01;                    // 1 byte version
  payload.set(uuidBytes, offset);              // 16 bytes UUID
  offset += 16;
  view.setUint32(offset, totalSymbols, false); // 4 bytes k (big-endian)
  offset += 4;
  view.setUint32(offset, symbolIndex, false);  // 4 bytes symbol index
  offset += 4;
  payload.set(packetData, offset);             // symbol data
  offset += packetData.length;
  
  // Calculate CRC16 for error detection
  const crc = calculateCRC16(payload.slice(0, offset));
  view.setUint16(offset, crc, false);          // 2 bytes CRC
  
  // Convert to base64 string for QR encoding
  let binary = '';
  for (let i = 0; i < payload.length; i++) {
    binary += String.fromCharCode(payload[i]);
  }
  
  return btoa(binary);
}

function parseQRPayload(base64Data) {
  try {
    const binary = atob(base64Data);
    const payload = new Uint8Array(binary.length);
    
    for (let i = 0; i < binary.length; i++) {
      payload[i] = binary.charCodeAt(i);
    }
    
    // Minimum payload size check: version(1) + uuid(16) + k(4) + symbolIndex(4) + crc(2) = 27
    if (payload.length < HEADER_SIZE + 2) {
      return null;
    }
    
    const headerVersion = payload[0];
    if (headerVersion !== 0x01) {
      return null;
    }
    
    // Parse UUID (16 bytes)
    const uuidBytes = payload.slice(1, 17);
    let uuidHex = '';
    for (let i = 0; i < 16; i++) {
      const hex = uuidBytes[i].toString(16).padStart(2, '0');
      if (i === 3 || i === 5 || i === 7 || i === 9) uuidHex += '-';
      uuidHex += hex;
    }
    const uuid = uuidHex;
    
    const view = new DataView(payload.buffer);
    let offset = 17;
    const totalSymbols = view.getUint32(offset, false);
    offset += 4;
    const symbolIndex = view.getUint32(offset, false);
    offset += 4;
    
    // Verify CRC
    const dataEnd = payload.length - 2;
    const receivedCRC = view.getUint16(dataEnd, false);
    const calculatedCRC = calculateCRC16(payload.slice(0, dataEnd));
    
    if (receivedCRC !== calculatedCRC) {
      console.warn('CRC mismatch, packet may be corrupted');
      // Still try to process but with lower confidence
    }
    
    const packetData = payload.slice(offset, dataEnd);
    
    return { uuid, totalSymbols, symbolIndex, packetData };
  } catch (e) {
    console.error('Failed to parse QR payload:', e);
    return null;
  }
}

// Sender workflow - Support multiple file selection
sendBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  
  // Check total size limit (10 MB per file, but allow multiple files)
  const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
  if (oversizedFiles.length > 0) {
    showToast(`Some files too large! Max recommended size is ${formatBytes(MAX_FILE_SIZE)} per file`, 'error');
    // Remove oversized files
    currentFiles = files.filter(f => f.size <= MAX_FILE_SIZE);
  } else {
    currentFiles = files;
  }
  
  if (currentFiles.length === 0) {
    fileInput.value = '';
    return;
  }
  
  // Check if any file is a media file that needs quality adjustment
  const imageFiles = currentFiles.filter(f => f.type.startsWith('image/'));
  
  if (imageFiles.length > 0) {
    // Show quality modal for images
    const firstImage = imageFiles[0];
    fileNameDisplay.textContent = imageFiles.length > 1 
      ? `${imageFiles.length} images selected`
      : firstImage.name;
    fileSizeDisplay.textContent = formatBytes(imageFiles.reduce((sum, f) => sum + f.size, 0));
    fileTypeDisplay.textContent = 'Multiple images';
    qualityModal.classList.add('active');
  } else {
    // Start compression directly for non-media files
    await compressAllFiles(0.6);
  }
});

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value;
});

startTransferBtn.addEventListener('click', async () => {
  qualityModal.classList.remove('active');
  const quality = parseInt(qualitySlider.value) / 100;
  await compressAllFiles(quality);
});

cancelCompressionBtn.addEventListener('click', () => {
  qualityModal.classList.remove('active');
  currentFiles = [];
  fileInput.value = '';
});

async function compressAllFiles(quality = 0.6) {
  if (currentFiles.length === 0) return;
  
  const compressedResults = [];
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;
  
  for (const file of currentFiles) {
    try {
      showToast(`Compressing ${file.name}...`);
      const result = await compressFile(file, quality);
      compressedResults.push({
        file: file,
        data: result.data,
        mode: result.mode,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize
      });
      totalOriginalSize += result.originalSize;
      totalCompressedSize += result.compressedSize;
    } catch (err) {
      console.error(`Failed to compress ${file.name}:`, err);
      showToast(`Failed to compress ${file.name}`, 'error');
    }
  }
  
  if (compressedResults.length === 0) {
    showToast('No files could be compressed', 'error');
    fileInput.value = '';
    return;
  }
  
  // Store compressed data
  currentFiles = compressedResults;
  
  // Calculate total symbols needed
  const totalDataSize = compressedResults.reduce((sum, r) => sum + r.compressedSize, 0);
  const k = Math.ceil(totalDataSize / SYMBOL_DATA_SIZE);
  
  // Prepare metadata for all files
  allFileMetadata = compressedResults.map(r => ({
    name: r.file.name,
    type: r.file.type,
    size: r.compressedSize,
    mode: r.mode,
    originalSize: r.originalSize
  }));
  
  // Generate UUID for this transfer session
  currentUUIDBytes = generateUUIDBytes();
  const uuidHex = uuidBytesToHex(currentUUIDBytes);
  
  // Check if we can do static QR (single file and fits in one QR)
  if (compressedResults.length === 1 && totalDataSize <= QR_PAYLOAD_MAX - HEADER_SIZE) {
    // Static QR code for tiny files
    showToast('Generating static QR code...');
    const packetData = compressedResults[0].data;
    const base64Payload = createQRPayload(currentUUIDBytes, 1, 0, packetData);
    
    // Also include metadata in a separate header QR
    const headerData = new TextEncoder().encode(JSON.stringify({
      files: allFileMetadata,
      uuid: uuidHex,
      singleFrame: true
    }));
    
    // For single frame, we embed everything in one QR with special marker
    // Simplified: just show the data QR
    displayStaticQR(base64Payload);
  } else {
    // Animated QR codes for larger files
    startAnimatedTransfer(k, uuidHex);
  }
}

async function startCompression(file, quality) {
  showToast('Compressing file...', 'success');
  
  try {
    const result = await compressFile(file, quality);
    compressedData = result.data;
    compressionMode = result.mode;
    
    showToast(`Compressed: ${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)}`, 'success');
    
    // Check if file fits in single QR
    if (compressedData.length <= 2953) {
      showStaticQR(compressedData);
    } else {
      startAnimatedTransfer(compressedData);
    }
  } catch (error) {
    console.error('Compression failed:', error);
    showToast('Compression failed: ' + error.message, 'error');
  }
}

function showStaticQR(data) {
  // Create single QR with entire data
  const uuid = generateUUID();
  const payload = createQRPayload(uuid, 1, 0, data);
  
  const qr = generateQRCode(payload);
  if (!qr) {
    showToast('Failed to generate QR code', 'error');
    return;
  }
  
  qrScreen.classList.add('active');
  qrCanvas.width = 800;
  qrCanvas.height = 800;
  renderQRCode(qr, qrCanvas);
  
  document.getElementById('qrTitle').textContent = 'Scan to Receive';
  document.getElementById('qrSubtitle').textContent = 'Single scan transfer';
  
  requestWakeLock();
}
async function startAnimatedTransfer(k, uuidHex) {
  // k is total symbols, uuidHex is the UUID string
  const uuidBytes = uuidStringToBytes(uuidHex);
  currentUUIDBytes = uuidBytes;

  // Concatenate all file data with metadata headers
  // Format: [metadata JSON length (4 bytes)][metadata JSON][file1 data][file2 data]...
  const metadata = {
    files: allFileMetadata,
    uuid: uuidHex,
    version: 1
  };
  const metadataJson = JSON.stringify(metadata);
  const metadataBytes = new TextEncoder().encode(metadataJson);
  
  // Build combined data
  const metadataLenBuf = new ArrayBuffer(4);
  const metadataLenView = new DataView(metadataLenBuf);
  metadataLenView.setUint32(0, metadataBytes.length, false);
  
  let totalSize = 4 + metadataBytes.length;
  for (const result of currentFiles) {
    totalSize += result.compressedSize;
  }
  
  const combinedData = new Uint8Array(totalSize);
  let offset = 0;
  
  // Add metadata length
  combinedData.set(new Uint8Array(metadataLenBuf), offset);
  offset += 4;
  
  // Add metadata
  combinedData.set(metadataBytes, offset);
  offset += metadataBytes.length;
  
  // Add each file's compressed data
  for (const result of currentFiles) {
    combinedData.set(result.data, offset);
    offset += result.compressedSize;
  }

  // Initialize encoder worker
  encoderWorker = new Worker('./workers/encoder-worker.js', { type: 'module' });

  encoderWorker.onmessage = (e) => {
    if (e.data.type === 'initialized') {
      // Show focus assist pattern first
      showFocusAssist();
      
      // After 2 seconds of focus assist, show header QR
      setTimeout(() => {
        showHeaderQR(uuidHex, k);
        
        // After 2 seconds of header QR, start animated transfer
        setTimeout(() => {
          startQRAnimation(k);
        }, 2000);
      }, 2000);
    } else if (e.data.type === 'symbol') {
      // Render this symbol
      renderSymbolQR(currentUUIDBytes, k, e.data.symbolIndex, e.data.payload);
    }
  };

  encoderWorker.postMessage({
    type: 'init',
    data: combinedData,
    uuid: Array.from(currentUUIDBytes)
  });

  qrScreen.classList.add('active');
  qrCanvas.width = 800;
  qrCanvas.height = 800;

  requestWakeLock();
}

// Focus assist pattern to help camera adjust exposure and focus
function showFocusAssist() {
  const ctx = qrCanvas.getContext('2d');
  let phase = 0;
  let count = 0;
  const maxCount = 40; // 2 seconds at 20fps
  
  function animate() {
    if (count >= maxCount) return;
    
    phase = !phase;
    ctx.fillStyle = phase ? '#000000' : '#FFFFFF';
    ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    
    // Draw checkerboard pattern
    const squareSize = 50;
    ctx.fillStyle = phase ? '#FFFFFF' : '#000000';
    for (let row = 0; row < qrCanvas.height / squareSize; row++) {
      for (let col = 0; col < qrCanvas.width / squareSize; col++) {
        if ((row + col) % 2 === 0) {
          ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
        }
      }
    }
    
    count++;
    document.getElementById('qrTitle').textContent = `Focusing ${count}/${maxCount}`;
    document.getElementById('qrSubtitle').textContent = 'Helping camera adjust...';
    
    setTimeout(animate, 1000 / FPS);
  }
  
  animate();
}

function showHeaderQR(uuid, totalSymbols) {
  const headerData = JSON.stringify({
    v: 1,
    uuid: uuid,
    k: totalSymbols,
    files: allFileMetadata,
    totalFiles: currentFiles.length
  });
  
  // Encode header as base64
  const headerBase64 = btoa(headerData);
  
  const qr = generateQRCode(headerBase64);
  if (qr) {
    renderQRCode(qr, qrCanvas);
  }
  
  document.getElementById('qrTitle').textContent = 'Preparing...';
  document.getElementById('qrSubtitle').textContent = `${currentFiles.length} file(s) • Header information`;
}

function startQRAnimation(totalSymbols) {
  let lastFrameTime = 0;
  const frameInterval = 1000 / FPS;
  
  function animate(timestamp) {
    if (!isTransferring) return;
    
    const elapsed = timestamp - lastFrameTime;
    
    if (elapsed >= frameInterval) {
      lastFrameTime = timestamp - (elapsed % frameInterval);
      
      // Request next symbol
      encoderWorker.postMessage({ type: 'generate' });
    }
    
    qrAnimationId = requestAnimationFrame(animate);
  }
  
  isTransferring = true;
  qrAnimationId = requestAnimationFrame(animate);
}

function renderSymbolQR(uuidBytes, totalSymbols, symbolIndex, payload) {
  const qrPayload = createQRPayload(uuidBytes, totalSymbols, symbolIndex, payload);
  const qr = generateQRCode(qrPayload);
  
  if (qr) {
    renderQRCode(qr, qrCanvas);
  }
  
  document.getElementById('qrTitle').textContent = `Symbol ${symbolIndex + 1}`;
  document.getElementById('qrSubtitle').textContent = `${totalSymbols} total • Keep scanning`;
}

// Receiver workflow
receiveBtn.addEventListener('click', async () => {
  try {
    // Request camera permission
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    
    videoPreview.srcObject = stream;
    cameraScreen.classList.add('active');
    progressContainer.style.display = 'none';
    
    // Start scanning
    startCameraScanning();
  } catch (error) {
    console.error('Camera access denied:', error);
    showToast('Camera permission denied. Please enable camera access.', 'error');
  }
});

let scannerRunning = false;
let lastDecodeTime = 0;
let headerReceived = false;
let currentTransferUUID = null;
let expectedTotalSymbols = 0;
let receivedSymbols = new Map();
let transferMetadata = null; // Store file metadata from header
let estimatedTransferTime = 0; // Estimated time in seconds

async function startCameraScanning() {
  scannerRunning = true;
  headerReceived = false;
  receivedSymbols.clear();
  
  // Initialize decoder worker
  decoderWorker = new Worker('./workers/decoder-worker.js');
  
  decoderWorker.onmessage = handleDecodedQR;
  
  scanFrame();
}

function scanFrame() {
  if (!scannerRunning) return;
  
  // Removed throttle - let jsQR run as fast as possible
  lastDecodeTime = Date.now();
  
  // Draw video frame to canvas for processing
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = videoPreview.videoWidth || 640;
  tempCanvas.height = videoPreview.videoHeight || 480;
  const ctx = tempCanvas.getContext('2d');
  ctx.drawImage(videoPreview, 0, 0, tempCanvas.width, tempCanvas.height);
  
  const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  
  // Send to worker for decoding
  decoderWorker.postMessage({
    type: 'decode',
    imageData: imageData
  });
  
  requestAnimationFrame(scanFrame);
}

function handleDecodedQR(e) {
  if (e.data.type !== 'decoded' || !e.data.success) return;
  
  const qrData = e.data.data;
  
  if (!headerReceived) {
    // Try to parse as header
    try {
      const headerJson = atob(qrData);
      const header = JSON.parse(headerJson);
      
      if (header.v === 1 && header.uuid && header.k) {
        headerReceived = true;
        currentTransferUUID = header.uuid;
        expectedTotalSymbols = header.k;
        
        // Store metadata for later use - support multiple files
        transferMetadata = {
          files: header.files || [],
          totalFiles: header.totalFiles || 1,
          compressionMode: 'mixed'
        };
        
        // Initialize LT decoder with module type
        ltDecoderWorker = new Worker('./workers/lt-decoder-worker.js', { type: 'module' });
        
        ltDecoderWorker.onmessage = handleLTDecoderMessage;
        
        ltDecoderWorker.postMessage({
          type: 'init',
          totalSymbols: header.k,
          metadata: transferMetadata
        });
        
        progressContainer.style.display = 'block';
        updateProgress(0, header.k);
        
        // Calculate and show estimated transfer time
        estimatedTransferTime = Math.ceil(header.k / FPS);
        const mins = Math.floor(estimatedTransferTime / 60);
        const secs = estimatedTransferTime % 60;
        const timeEstimate = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        document.getElementById('qrSubtitle').textContent = `~${timeEstimate} remaining`;
        
        showToast(`Header received! ${header.totalFiles || 1} file(s) to receive...`, 'success');
      }
    } catch (e) {
      // Not a header, ignore
    }
  } else {
    // Parse as data QR
    const parsed = parseQRPayload(qrData);
    
    if (parsed && parsed.uuid === currentTransferUUID) {
      // Check if we already have this symbol
      if (!receivedSymbols.has(parsed.symbolIndex)) {
        receivedSymbols.set(parsed.symbolIndex, parsed.packetData);
        
        // Send to LT decoder
        ltDecoderWorker.postMessage({
          type: 'symbol',
          payload: parsed.packetData
        });
        
        updateProgress(receivedSymbols.size, expectedTotalSymbols);
      }
    }
  }
}

function handleLTDecoderMessage(e) {
  if (e.data.type === 'progress') {
    updateProgress(e.data.recovered, e.data.total);
  } else if (e.data.type === 'complete') {
    handleTransferComplete(e.data.data);
  } else if (e.data.type === 'error') {
    showToast('Decoding error: ' + e.data.message, 'error');
  }
}

function updateProgress(received, total) {
  const percent = Math.min(100, Math.round((received / (total * 1.05)) * 100));
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${received} / ~${Math.ceil(total * 1.05)} symbols`;
}

async function handleTransferComplete(arrayBuffer) {
  scannerRunning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  cameraScreen.classList.remove('active');
  
  // Get metadata from transfer (stored when header was received)
  const files = transferMetadata?.files || [];
  const totalFiles = transferMetadata?.totalFiles || 1;
  
  // Parse combined data: [metadata length (4 bytes)][metadata JSON][file1 data][file2 data]...
  const dataView = new DataView(arrayBuffer);
  const metadataLen = dataView.getUint32(0, false);
  const metadataBytes = new Uint8Array(arrayBuffer, 4, metadataLen);
  const metadataJson = new TextDecoder().decode(metadataBytes);
  const parsedMetadata = JSON.parse(metadataJson);
  
  // Extract individual files
  let offset = 4 + metadataLen;
  const receivedFilesList = [];
  
  for (const fileInfo of parsedMetadata.files) {
    const fileData = new Uint8Array(arrayBuffer, offset, fileInfo.size);
    offset += fileInfo.size;
    
    // Decompress if needed
    let finalData = fileData;
    if (fileInfo.mode === 'gzip' && typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(fileData);
        writer.close();
        
        const decompressedChunks = [];
        const reader = ds.readable.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          decompressedChunks.push(value);
        }
        
        const totalLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        finalData = new Uint8Array(totalLength);
        let off = 0;
        for (const chunk of decompressedChunks) {
          finalData.set(chunk, off);
          off += chunk.length;
        }
      } catch (e) {
        console.warn('Decompression failed, using compressed data:', e);
      }
    }
    
    receivedFilesList.push({
      name: fileInfo.name,
      type: fileInfo.type,
      size: finalData.length,
      data: finalData
    });
  }
  
  // Show download modal with multiple files option
  showDownloadModal(receivedFilesList);
  showToast(`Transfer complete! ${receivedFilesList.length} file(s) received.`, 'success');
}

function showDownloadModal(files) {
  if (files.length === 1) {
    // Single file - show simple modal
    const file = files[0];
    receivedFileName.textContent = file.name;
    receivedFileSize.textContent = formatBytes(file.size);
    receivedFileType.textContent = file.type;
    
    // Store single blob for download
    receivedFileBlob = new Blob([file.data], { type: file.type });
    currentReceivedFiles = files;
  } else {
    // Multiple files - show list
    receivedFileName.textContent = `${files.length} files`;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    receivedFileSize.textContent = formatBytes(totalSize);
    receivedFileType.textContent = 'Multiple files';
    
    // Store all files
    currentReceivedFiles = files;
    receivedFileBlob = null;
  }
  
  downloadModal.classList.add('active');
}

downloadFileBtn.addEventListener('click', () => {
  if (receivedFileBlob) {
    // Single file download
    const url = URL.createObjectURL(receivedFileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFileName.textContent;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    downloadModal.classList.remove('active');
    receivedFileBlob = null;
  } else if (currentReceivedFiles && currentReceivedFiles.length > 1) {
    // Multiple files - download all as ZIP or individually
    // For simplicity, download each file sequentially
    downloadAllFiles(currentReceivedFiles);
  }
});

async function downloadAllFiles(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const url = URL.createObjectURL(new Blob([file.data], { type: file.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Small delay between downloads
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  downloadModal.classList.remove('active');
  currentReceivedFiles = null;
}

closeDownloadModalBtn.addEventListener('click', () => {
  downloadModal.classList.remove('active');
  receivedFileBlob = null;
});

// Cleanup and navigation
qrBackBtn.addEventListener('click', stopTransfer);
cameraBackBtn.addEventListener('click', stopReceiving);
cancelReceiveBtn.addEventListener('click', stopReceiving);

function stopTransfer() {
  isTransferring = false;
  if (qrAnimationId) {
    cancelAnimationFrame(qrAnimationId);
  }
  if (encoderWorker) {
    encoderWorker.terminate();
    encoderWorker = null;
  }
  qrScreen.classList.remove('active');
  releaseWakeLock();
  currentFile = null;
  compressedData = null;
  fileInput.value = '';
}

function stopReceiving() {
  scannerRunning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (decoderWorker) {
    decoderWorker.terminate();
    decoderWorker = null;
  }
  if (ltDecoderWorker) {
    ltDecoderWorker.terminate();
    ltDecoderWorker = null;
  }
  cameraScreen.classList.remove('active');
  headerReceived = false;
  receivedSymbols.clear();
  transferMetadata = null; // Clear metadata
}

// Wake Lock API
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake lock released');
      });
    }
  } catch (err) {
    console.log('Wake lock error:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Load qrcode-generator library dynamically
function loadQRCodeLibrary() {
  return new Promise((resolve, reject) => {
    if (typeof qrcode !== 'undefined') {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = '/src/lib/qrcode-gen.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Initialize
loadQRCodeLibrary().then(() => {
  console.log('QR Code library loaded');
}).catch(err => {
  console.error('Failed to load QR Code library:', err);
});

// Handle visibility change
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isTransferring) {
    // Pause transfer when tab is hidden
    console.log('Tab hidden, transfer paused');
  }
});
