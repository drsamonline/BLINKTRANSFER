// BlinkTransfer v2.0 - Optimized & Beautiful
import { generateUUID, calculateCRC16 } from './lib/utils.js';

// Constants
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_TOTAL_SIZE = 20 * 1024 * 1024; // 20 MB total
const QR_PAYLOAD_SIZE = 1600;
const HEADER_SIZE = 27;
const SYMBOL_DATA_SIZE = QR_PAYLOAD_SIZE - HEADER_SIZE;
const FPS = 20;

class BlinkTransfer {
  constructor() {
    this.files = [];
    this.compressedData = null;
    this.metadata = null;
    this.uuid = null;
    this.totalSymbols = 0;
    this.currentSymbol = 0;
    this.isSending = false;
    this.isReceiving = false;
    this.receivedFiles = [];
    this.collectedSymbols = new Map();
    this.stream = null;
    this.wakeLock = null;
    this.init();
  }

  init() {
    document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e));
    const slider = document.getElementById('qualitySlider');
    if (slider) slider.addEventListener('input', (e) => {
      document.getElementById('qualityValue').textContent = e.target.value;
    });
    this.registerSW();
    this.checkPermissions();
  }

  async registerSW() {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) {}
    }
  }

  async checkPermissions() {
    const card = document.getElementById('permissionCard');
    if (!card) return;
    try {
      const result = await navigator.permissions.query({ name: 'camera' });
      if (result.state === 'granted') card.style.display = 'none';
    } catch (e) {}
  }

  async requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach(t => t.stop());
      document.getElementById('permissionCard').style.display = 'none';
      this.showToast('Camera permission granted!', 'success');
    } catch (e) {
      this.showToast('Camera permission denied', 'error');
    }
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  goHome() {
    this.stopSend();
    this.stopReceive();
    this.showScreen('homeScreen');
  }

  selectFiles() { document.getElementById('fileInput').click(); }

  async handleFileSelect(e) {
    const selected = Array.from(e.target.files);
    if (selected.length === 0) return;

    const totalSize = selected.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      this.showToast(`Total exceeds ${this.formatSize(MAX_TOTAL_SIZE)}`, 'error');
      return;
    }

    const oversized = selected.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0 && !confirm(`${oversized.length} file(s) exceed ${this.formatSize(MAX_FILE_SIZE)}. Continue?`)) {
      return;
    }

    this.files = selected;
    this.renderFileList();
    
    if (this.files.some(f => f.type.startsWith('image/'))) {
      document.getElementById('qualityModal').classList.add('active');
    } else {
      this.startCompression();
    }
  }

  cancelQuality() {
    document.getElementById('qualityModal').classList.remove('active');
    this.files = [];
    document.getElementById('fileInput').value = '';
    this.renderFileList();
  }

  confirmQuality() {
    document.getElementById('qualityModal').classList.remove('active');
    this.startCompression();
  }

  renderFileList() {
    const container = document.getElementById('sendFileList');
    if (!container) return;

    if (this.files.length === 0) {
      container.innerHTML = '';
      document.getElementById('sendEmpty').classList.remove('hidden');
      document.getElementById('startSendBtn').disabled = true;
      return;
    }

    document.getElementById('sendEmpty').classList.add('hidden');
    const totalSize = this.files.reduce((sum, f) => sum + f.size, 0);
    
    container.innerHTML = `
      <div style="margin-bottom:12px;font-weight:600">${this.files.length} file(s) • ${this.formatSize(totalSize)}</div>
      ${this.files.slice(0, 5).map(f => `
        <div class="file-item">
          <div class="file-icon">${this.getFileIcon(f.type)}</div>
          <div class="file-details">
            <div class="file-name">${f.name}</div>
            <div class="file-meta">${this.formatSize(f.size)} • ${f.type || 'Unknown'}</div>
          </div>
        </div>
      `).join('')}
      ${this.files.length > 5 ? `<div style="color:var(--text-muted);font-size:0.85rem">+${this.files.length - 5} more...</div>` : ''}
    `;
    
    document.getElementById('startSendBtn').disabled = false;
  }

  getFileIcon(type) {
    if (!type) return '📁';
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎬';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('zip') || type.includes('rar')) return '📦';
    return '📁';
  }

  async startCompression() {
    this.showToast('Compressing...', 'warning');
    const quality = parseInt(document.getElementById('qualitySlider').value) / 100;
    const compressedFiles = [];
    let totalCompressed = 0;

    for (const file of this.files) {
      try {
        let data;
        if (file.type.startsWith('image/')) {
          data = await this.compressImage(file, quality);
        } else {
          data = await this.compressGeneric(file);
        }
        compressedFiles.push({ ...file, data, compressed: true });
        totalCompressed += data.byteLength;
      } catch (e) {
        const data = new Uint8Array(await file.arrayBuffer());
        compressedFiles.push({ ...file, data, compressed: false });
        totalCompressed += data.byteLength;
      }
    }

    this.prepareTransfer(compressedFiles, totalCompressed);
  }

  compressImage(file, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1920;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const r = maxDim / Math.max(w, h);
          w = Math.floor(w * r);
          h = Math.floor(h * r);
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Failed')); return; }
          blob.arrayBuffer().then(resolve).catch(reject);
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async compressGeneric(file) {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(new Uint8Array(await file.arrayBuffer()));
      writer.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) {
      return new Uint8Array(await file.arrayBuffer());
    }
  }

  prepareTransfer(files, totalSize) {
    this.metadata = {
      files: files.map(f => ({ name: f.name, type: f.type, originalSize: f.size, compressedSize: f.data.byteLength, compressed: f.compressed })),
      totalSize,
      timestamp: Date.now()
    };

    const metaBytes = new TextEncoder().encode(JSON.stringify(this.metadata));
    let offset = 4 + metaBytes.length;
    for (const f of files) offset += f.data.byteLength;
    
    this.compressedData = new Uint8Array(offset);
    const view = new DataView(this.compressedData.buffer);
    view.setUint32(0, metaBytes.length, true);
    this.compressedData.set(metaBytes, 4);
    
    offset = 4 + metaBytes.length;
    for (const f of files) {
      this.compressedData.set(f.data, offset);
      offset += f.data.byteLength;
    }

    this.uuid = generateUUID();
    this.totalSymbols = Math.ceil(this.compressedData.length / SYMBOL_DATA_SIZE);
    
    document.getElementById('statSize').textContent = this.formatSize(totalSize);
    document.getElementById('statSymbols').textContent = this.totalSymbols;
    document.getElementById('statTime').textContent = this.estimateTime(this.totalSymbols);
    
    this.renderFileList();
    this.showToast('Ready!', 'success');
  }

  estimateTime(symbols) {
    const secs = Math.ceil(symbols / FPS);
    const mins = Math.floor(secs / 60);
    return mins > 0 ? `${mins}:${(secs % 60).toString().padStart(2, '0')}` : `${secs}s`;
  }

  async startSend() {
    if (this.isSending) return;
    this.isSending = true;
    
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
      await this.showFocusAssist();
      
      this.showScreen('sendScreen');
      document.getElementById('sendStatus').classList.remove('hidden');
      document.getElementById('sendActions').classList.add('hidden');
      
      this.currentSymbol = 0;
      this.animateQR();
      this.showToast('Transmitting... Keep screen visible', 'warning');
    } catch (e) {
      this.showToast('Failed to start', 'error');
      this.isSending = false;
    }
  }

  async showFocusAssist() {
    const canvas = document.getElementById('focusCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.add('active');
    
    return new Promise(resolve => {
      let phase = 0;
      const frames = 40;
      const size = 40;
      const cols = Math.ceil(canvas.width / size);
      const rows = Math.ceil(canvas.height / size);
      
      const animate = () => {
        if (phase >= frames) {
          canvas.classList.remove('active');
          resolve();
          return;
        }
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            ctx.fillStyle = ((x + y + phase) % 2) === 0 ? '#000' : '#fff';
            ctx.fillRect(x * size, y * size, size, size);
          }
        }
        phase++;
        requestAnimationFrame(animate);
      };
      animate();
    });
  }

  animateQR() {
    if (!this.isSending) return;
    const canvas = document.getElementById('qrCanvas');
    const ctx = canvas.getContext('2d');
    
    const drawFrame = () => {
      if (!this.isSending) return;
      
      const payload = this.createPayload(this.currentSymbol);
      const qr = window.QRCode ? window.QRCode(10, 'L') : null;
      
      if (qr) {
        qr.addData(payload, 'Byte');
        qr.make();
        
        const mc = qr.getModuleCount();
        const cellSize = Math.min(4, Math.floor(Math.min(canvas.width, canvas.height) / mc));
        const size = mc * cellSize;
        canvas.width = size;
        canvas.height = size;
        
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        for (let r = 0; r < mc; r++) {
          for (let c = 0; c < mc; c++) {
            if (qr.isDark(r, c)) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
          }
        }
        
        const progress = Math.min(100, Math.round((this.currentSymbol + 1) / (this.totalSymbols * 1.05) * 100));
        document.getElementById('sendProgressBar').style.width = progress + '%';
        document.getElementById('sendProgressText').textContent = progress + '%';
        document.getElementById('statSymbols').textContent = `${this.currentSymbol + 1}/${this.totalSymbols}`;
      }
      
      this.currentSymbol++;
      if (this.currentSymbol < this.totalSymbols * 1.05) {
        setTimeout(() => requestAnimationFrame(drawFrame), 1000 / FPS);
      } else {
        this.finishSend();
      }
    };
    drawFrame();
  }

  createPayload(symbolIndex) {
    const payload = new Uint8Array(QR_PAYLOAD_SIZE);
    const view = new DataView(payload.buffer);
    
    payload[0] = 0x01;
    payload.set(this.uuid, 1);
    view.setUint32(17, this.totalSymbols, false);
    view.setUint32(21, symbolIndex, false);
    
    const dataStart = 25;
    const dataEnd = Math.min(dataStart + SYMBOL_DATA_SIZE, this.compressedData.length);
    if (dataStart < this.compressedData.length) {
      payload.set(this.compressedData.subarray(dataStart, dataEnd), 25);
    }
    
    const crc = calculateCRC16(payload.subarray(0, QR_PAYLOAD_SIZE - 2));
    view.setUint16(QR_PAYLOAD_SIZE - 2, crc, false);
    
    return payload;
  }

  finishSend() {
    this.isSending = false;
    if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null; }
    this.showToast('Transfer complete!', 'success');
    document.getElementById('sendActions').classList.remove('hidden');
  }

  stopSend() {
    this.isSending = false;
    if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null; }
  }

  async startReceive() {
    if (this.isReceiving) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      document.getElementById('video').srcObject = this.stream;
      this.showScreen('receiveScreen');
      this.isReceiving = true;
      this.collectedSymbols.clear();
      this.receivedFiles = [];
      this.scanLoop();
      this.showToast('Point camera at QR code', 'warning');
    } catch (e) {
      this.showToast('Camera access denied', 'error');
    }
  }

  scanLoop() {
    const video = document.getElementById('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const scan = () => {
      if (!this.isReceiving || video.readyState !== 4) {
        setTimeout(scan, 100);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      // QR decoding would happen here with jsQR
      requestAnimationFrame(scan);
    };
    scan();
  }

  stopReceive() {
    this.isReceiving = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    document.getElementById('video').srcObject = null;
  }

  showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
}

const app = new BlinkTransfer();
