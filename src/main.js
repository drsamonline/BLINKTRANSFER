// BlinkTransfer - Main Application Logic

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
const QR_PAYLOAD_MAX = 1600; // Reduced for reliable scanning
const QR_HEADER_SIZE = 26; // 1 + 16 + 4 + 4 + 1 (version + uuid + k + symbolIndex + crc)
const SYMBOL_DATA_SIZE = 1500; // Payload minus header overhead
const FPS = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max recommended file size

// State
let currentFile = null;
let compressedData = null;
let compressionMode = 'none';
let encoderWorker = null;
let decoderWorker = null;
let ltDecoderWorker = null;
let qrAnimationId = null;
let isTransferring = false;
let wakeLock = null;
let stream = null;
let animationFrameCount = 0;
let receivedFileBlob = null;

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
// Header: [1 byte version][16 bytes UUID][4 bytes k][4 bytes symbolIndex][2 bytes CRC]
function createQRPayload(uuid, totalSymbols, symbolIndex, packetData) {
  const payload = new Uint8Array(QR_PAYLOAD_MAX);
  const view = new DataView(payload.buffer);
  
  // Header version (1 byte)
  payload[0] = 0x01;
  
  // UUID (16 bytes) - full UUID
  const uuidBytes = new TextEncoder().encode(uuid);
  payload.set(uuidBytes.slice(0, 16), 1);
  
  // Total symbols (4 bytes, big-endian)
  view.setUint32(17, totalSymbols, false);
  
  // Symbol index (4 bytes, big-endian)
  view.setUint32(21, symbolIndex, false);
  
  // Packet data starts at offset 25
  const dataOffset = 25;
  const availableSpace = QR_PAYLOAD_MAX - dataOffset - 2; // Reserve 2 bytes for CRC
  const dataLength = Math.min(packetData.length, availableSpace);
  payload.set(packetData.slice(0, dataLength), dataOffset);
  
  // Calculate CRC16 for error detection
  const crc = calculateCRC16(payload.slice(0, dataOffset + dataLength));
  view.setUint16(dataOffset + dataLength, crc, false);
  
  // Convert to string for QR encoding
  let binary = '';
  for (let i = 0; i < QR_PAYLOAD_MAX; i++) {
    binary += String.fromCharCode(payload[i]);
  }
  
  return btoa(binary);
}

// CRC16 calculation for error detection
function calculateCRC16(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  
  return crc;
}

function parseQRPayload(base64Data) {
  try {
    const binary = atob(base64Data);
    const payload = new Uint8Array(binary.length);
    
    for (let i = 0; i < binary.length; i++) {
      payload[i] = binary.charCodeAt(i);
    }
    
    // Minimum payload size check
    if (payload.length < 27) { // version(1) + uuid(16) + k(4) + symbolIndex(4) + crc(2)
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
    const totalSymbols = view.getUint32(17, false);
    const symbolIndex = view.getUint32(21, false);
    
    // Verify CRC
    const dataOffset = 25;
    const receivedCRC = view.getUint16(QR_PAYLOAD_MAX - 2, false);
    const calculatedCRC = calculateCRC16(payload.slice(0, QR_PAYLOAD_MAX - 2));
    
    if (receivedCRC !== calculatedCRC) {
      console.warn('CRC mismatch, packet may be corrupted');
      // Still try to process but with lower confidence
    }
    
    const packetData = payload.slice(dataOffset, QR_PAYLOAD_MAX - 2);
    
    return { uuid, totalSymbols, symbolIndex, packetData };
  } catch (e) {
    console.error('Failed to parse QR payload:', e);
    return null;
  }
}

// Sender workflow
sendBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // Check file size limit
  if (file.size > MAX_FILE_SIZE) {
    showToast(`File too large! Max recommended size is ${formatBytes(MAX_FILE_SIZE)}`, 'error');
    fileInput.value = '';
    return;
  }
  
  currentFile = file;
  
  // Check if it's a media file
  const isMedia = file.type.startsWith('image/') || 
                  file.type.startsWith('video/') || 
                  file.type.startsWith('audio/');
  
  if (isMedia && file.type.startsWith('image/')) {
    // Show quality modal for images
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);
    fileTypeDisplay.textContent = file.type;
    qualityModal.classList.add('active');
  } else {
    // Start compression directly for non-media or video/audio
    await startCompression(file, 0.6);
  }
});

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value;
});

startTransferBtn.addEventListener('click', async () => {
  qualityModal.classList.remove('active');
  const quality = parseInt(qualitySlider.value) / 100;
  await startCompression(currentFile, quality);
});

cancelCompressionBtn.addEventListener('click', () => {
  qualityModal.classList.remove('active');
  currentFile = null;
  fileInput.value = '';
});

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
async function startAnimatedTransfer(data) {
  const uuid = generateUUID();
  const totalSymbols = Math.ceil(data.length / SYMBOL_DATA_SIZE);

  // Initialize encoder worker
  encoderWorker = new Worker('/src/workers/encoder-worker.js');

  encoderWorker.onmessage = (e) => {
    if (e.data.type === 'initialized') {
      // Show focus assist pattern first
      showFocusAssist();
      
      // After 2 seconds of focus assist, show header QR
      setTimeout(() => {
        showHeaderQR(uuid, totalSymbols);
        
        // After 2 seconds of header QR, start animated transfer
        setTimeout(() => {
          startQRAnimation(uuid, totalSymbols);
        }, 2000);
      }, 2000);
    } else if (e.data.type === 'symbol') {
      // Render this symbol
      renderSymbolQR(uuid, totalSymbols, e.data.symbolIndex, e.data.packet);
    }
  };

  encoderWorker.postMessage({
    type: 'init',
    data: data,
    uuid: uuid
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
    name: currentFile.name,
    size: compressedData.length,
    mode: compressionMode,
    origName: currentFile.name,
    origType: currentFile.type
  });
  
  // Encode header as base64
  const headerBase64 = btoa(headerData);
  
  const qr = generateQRCode(headerBase64);
  if (qr) {
    renderQRCode(qr, qrCanvas);
  }
  
  document.getElementById('qrTitle').textContent = 'Preparing...';
  document.getElementById('qrSubtitle').textContent = 'Header information';
}

function startQRAnimation(uuid, totalSymbols) {
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

function renderSymbolQR(uuid, totalSymbols, symbolIndex, packet) {
  const payload = createQRPayload(uuid, totalSymbols, symbolIndex, packet);
  const qr = generateQRCode(payload);
  
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
  decoderWorker = new Worker('/src/workers/decoder-worker.js');
  
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
        
        // Store metadata for later use
        transferMetadata = {
          fileName: header.origName || 'received_file',
          fileType: header.origType || 'application/octet-stream',
          size: header.size,
          compressionMode: header.mode
        };
        
        // Initialize LT decoder
        ltDecoderWorker = new Worker('/src/workers/lt-decoder-worker.js');
        
        ltDecoderWorker.onmessage = handleLTDecoderMessage;
        
        ltDecoderWorker.postMessage({
          type: 'init',
          totalSymbols: header.k,
          originalSize: header.size,
          fileName: header.origName,
          fileType: header.origType,
          compressionMode: header.mode
        });
        
        progressContainer.style.display = 'block';
        updateProgress(0, header.k);
        
        // Calculate and show estimated transfer time
        estimatedTransferTime = Math.ceil(header.k / FPS);
        const mins = Math.floor(estimatedTransferTime / 60);
        const secs = estimatedTransferTime % 60;
        const timeEstimate = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        document.getElementById('qrSubtitle').textContent = `~${timeEstimate} remaining`;
        
        showToast('Header received! Scanning data...', 'success');
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
          symbolIndex: parsed.symbolIndex,
          packet: parsed.packetData
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
  const fileName = transferMetadata?.fileName || 'received_file';
  const fileType = transferMetadata?.fileType || 'application/octet-stream';
  const actualSize = transferMetadata?.size || arrayBuffer.byteLength;
  
  // Decompress if needed
  let finalData = new Uint8Array(arrayBuffer);
  
  // Trim to actual size (remove padding)
  finalData = finalData.slice(0, actualSize);
  
  // Store for download
  receivedFileBlob = new Blob([finalData], { type: fileType });
  
  // Update modal
  receivedFileName.textContent = fileName;
  receivedFileSize.textContent = formatBytes(finalData.length);
  receivedFileType.textContent = fileType;
  
  downloadModal.classList.add('active');
  showToast('Transfer complete!', 'success');
}

downloadFileBtn.addEventListener('click', () => {
  if (receivedFileBlob) {
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
  }
});

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
