# BlinkTransfer 📤📥

**Offline file transfer using animated QR codes** - No internet, no Bluetooth, no cables. Just point and scan!

## ✨ Features

### Core Functionality
- **Static QR**: Instant transfer for tiny files (≤1.6 KB compressed)
- **Animated QR**: 20 FPS streaming for larger files
- **Fountain Codes (LT Codes)**: Receiver needs only k+5% of frames to reconstruct files
- **Multi-file Transfer**: Select and transfer multiple files in one session
- **Focus Assist**: 2-second calibration pattern helps camera adjust

### Compression
- **Images (JPEG/PNG/WebP)**: Lossy compression (10-90% quality slider)
  - Resized to max 1920px on longest side
  - Re-encoded as JPEG at user-selected quality
- **Other Files**: Lossless gzip compression via CompressionStream API
- **File Size Limits**:
  - Max per file: **5 MB** (practical limit)
  - Max total batch: **20 MB**

### Robustness
- **CRC-16 Checksum**: Every QR frame verified for integrity
- **Multi-scale Detection**: Scans at 1x, 0.5x, 0.25x scales
- **Full UUID**: 16-byte unique identifier prevents transfer collisions
- **Error Correction**: QR Code Version 40-L (lowest ECC for max capacity)

### PWA Features
- **Offline Ready**: Works completely offline after first load
- **Installable**: Add to home screen on mobile devices
- **Wake Lock**: Keeps screen on during transfer
- **Responsive Design**: Works on all modern mobile browsers

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Development server (port 3000)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## 📱 Usage

### Sender
1. Tap **Send File** button
2. Select one or multiple files (max 5 MB each)
3. For images: Adjust quality slider (default 60%)
4. Focus assist pattern displays for 2 seconds
5. Header QR shows file metadata
6. Animated data stream begins automatically
7. Keep screen visible and steady

### Receiver
1. Tap **Receive File** button
2. Grant camera permission when prompted
3. Point camera at sender's QR code
4. Progress bar shows symbols collected
5. When complete: Tap **Save File** to download

## 📊 Performance

| File Type | Original | Compressed | Transfer Time |
|-----------|----------|------------|---------------|
| Text doc  | 100 KB   | 30 KB      | 1-2 sec       |
| Photo     | 5 MB     | 500 KB     | 17-20 sec     |
| PDF       | 2 MB     | 1.8 MB     | 60-70 sec     |
| Audio MP3 | 5 MB     | 4.5 MB     | 2.5-3 min     |
| **Max (5MB)** | 5 MB | ~4 MB      | 2.5-3 min     |

**Transfer Speed**: ~30 KB/s (20 FPS × 1500 bytes/payload)

## 🔧 Technical Details

### QR Code Format
```
[1 byte version][16 bytes UUID][4 bytes k][4 bytes symbolIndex][data][2 bytes CRC]
Total overhead: 27 bytes
Data payload: 1573 bytes (reduced from 2936 for reliability)
```

### LT Code Parameters
- **Symbol Size**: 1573 bytes
- **Distribution**: Robust Soliton (c=0.1, δ=0.5)
- **Overhead**: 5% (receiver needs k×1.05 symbols)
- **Decoding**: Belief Propagation algorithm

### Web Workers
- `encoder-worker.js`: LT encoding with pre-computed degree distribution
- `decoder-worker.js`: QR decoding with jsQR (multi-scale)
- `lt-decoder-worker.js`: Belief Propagation decoder

### Browser Compatibility
- **Chrome**: 80+ (full support)
- **Firefox**: 114+ (full support)
- **Safari**: 16+ (full support)
- **Required APIs**: CompressionStream, WakeLock, OffscreenCanvas, MediaDevices

## ⚠️ Limitations

1. **Video/Audio Compression**: Uses gzip only (not MediaRecorder re-encoding)
   - Reason: Cross-browser inconsistencies with hidden media elements
   - Workaround: Pre-compress media files before transfer

2. **Large Files**: Files >5 MB work but transfer times become impractical
   - 10 MB ≈ 5-6 minutes
   - Recommendation: Use cloud services for large files

3. **Camera Requirements**:
   - Good lighting essential
   - Steady hands improve success rate
   - Rear camera recommended (facingMode: environment)

4. **Browser Support**:
   - CompressionStream API required for gzip
   - Older browsers will skip compression (slower transfer)

## 🎨 Customization

Edit `/workspace/src/lib/utils.js` to adjust:
- `MAX_PAYLOAD_BYTES`: QR payload size (default 1600)
- `SYMBOL_DATA_SIZE`: LT symbol size (default 1573)
- `FILE_SIZE_LIMIT`: Max file size warning (default 5 MB)
- `FRAME_RATE`: Animation speed (default 20 FPS)

## 📁 Project Structure

```
/workspace
├── index.html              # Main UI with embedded CSS
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── package.json            # Dependencies
├── vite.config.js          # Build configuration
├── README.md               # This file
├── public/
│   ├── icon-192.png        # PWA icons
│   └── icon-512.png
├── src/
│   ├── main.js             # Application logic (~1100 lines)
│   ├── lib/
│   │   ├── jsQR.min.js     # QR decoder library
│   │   ├── qrcode-gen.js   # QR encoder library
│   │   └── utils.js        # Shared utilities
│   └── workers/
│       ├── encoder-worker.js
│       ├── decoder-worker.js
│       └── lt-decoder-worker.js
└── dist/                   # Production build
```

## 🛠️ Development

### Code Quality
- **Total Lines**: ~2300 (including workers and utils)
- **Build Size**: 14.2 KB gzipped (main bundle)
- **No External Dependencies**: All libraries bundled locally
- **ES Modules**: Modern module syntax throughout

### Recent Improvements
✅ Fixed worker paths for production builds  
✅ Reduced QR payload to 1600 bytes for reliability  
✅ Added CRC-16 checksums for error detection  
✅ Implemented focus assist pattern  
✅ Multi-file transfer support  
✅ Download modal with save option  
✅ Permission prompts on first run  
✅ Optimized LT code degree generation  

## 📝 License

MIT License - Feel free to use, modify, and distribute!

---

**Built with ❤️ using vanilla JavaScript and Web APIs**
