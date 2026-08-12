# BlinkTransfer PWA

**Offline file transfer using animated QR codes and fountain codes (LT codes)**

## Features

- ✅ **Completely offline** - No internet, Bluetooth, or cables needed
- ✅ **Lossless transfer** for documents, executables, archives
- ✅ **Lossy compression** for images (adjustable quality) to speed up transfer
- ✅ **Fountain codes (LT codes)** - Receiver only needs ~105% of symbols to reconstruct
- ✅ **Static QR** for tiny files (≤2953 bytes)
- ✅ **Animated QR** at 20 FPS for larger files
- ✅ **Web Workers** for all heavy processing (non-blocking UI)
- ✅ **PWA** - Installable, works offline after first load
- ✅ **Wake Lock** - Keeps screen on during transfer
- ✅ **Camera permission** requested on first use
- ✅ **Save/Download** option for received files

## Architecture

### Sender Flow
1. User selects file → Compression (lossy for images, gzip for others)
2. If ≤2953 bytes: Single static QR code
3. If larger: LT encoding → Animated QR sequence at 20 FPS
4. Header QR displayed for 2 seconds, then data stream begins

### Receiver Flow
1. Camera access → Scan for header QR
2. Parse metadata (UUID, total symbols, filename, compression mode)
3. Scan data QRs → LT decoding with belief propagation
4. Progress indicator shows symbols collected
5. When complete: Decompress → Save/Download file

### QR Payload Format (2953 bytes max)
```
[1 byte]  Header version (0x01)
[8 bytes] UUID (first 8 chars)
[4 bytes] Total symbols count (big-endian)
[4 bytes] Symbol index (big-endian)
[2936 bytes] Encoded symbol data (padded with zeros)
```

### LT Code Implementation
- **Symbol size**: 2936 bytes (fits exactly in QR payload)
- **Robust Soliton Distribution** for degree selection
- **Belief Propagation** decoder
- Receiver needs only k+5% symbols to recover original file

## File Structure

```
/workspace
├── index.html              # Main HTML with embedded CSS
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker for offline caching
├── package.json            # Dependencies
├── vite.config.js          # Build configuration
├── src/
│   ├── main.js             # Main application logic
│   ├── workers/
│   │   ├── encoder-worker.js    # LT encoder
│   │   ├── decoder-worker.js    # QR decoder (jsQR)
│   │   └── lt-decoder-worker.js # LT decoder (belief propagation)
│   └── lib/
│       ├── jsQR.min.js     # QR decoding library
│       └── qrcode-gen.js   # QR encoding library
├── public/
│   ├── icon-192.png        # PWA icons
│   └── icon-512.png
└── dist/                   # Production build
```

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

### Sending a File
1. Open BlinkTransfer on sender device
2. Tap "Send File"
3. Select the file to transfer
4. For images: Adjust quality slider if desired
5. Point receiver's camera at the QR code
6. Keep screen visible until transfer completes

### Receiving a File
1. Open BlinkTransfer on receiver device
2. Tap "Receive File"
3. Grant camera permission when prompted
4. Point camera at sender's QR code
5. Wait for scanning to complete (~105% of symbols needed)
6. Tap "Save File" to download

## Browser Compatibility

- ✅ Chrome/Edge (Android, Desktop)
- ✅ Safari (iOS 16+, macOS)
- ✅ Firefox (Android, Desktop)

**Required APIs:**
- `navigator.mediaDevices.getUserMedia` (camera)
- `CompressionStream` / `DecompressionStream` (optional, graceful fallback)
- `navigator.wakeLock` (optional, keeps screen on)
- Web Workers
- Offscreen Canvas (optional)

## Performance Tips

1. **Image transfers**: Use 40-60% quality for photos (good balance)
2. **Lighting**: Ensure good lighting for reliable QR scanning
3. **Distance**: Hold devices 15-30cm apart for optimal scanning
4. **Stability**: Keep both devices steady during transfer
5. **Large files**: Expect 1-5 MB per minute depending on conditions

## Limitations

- Maximum practical file size: ~50 MB (would take ~30 minutes)
- Video/audio files use lossless compression (no re-encoding yet)
- iOS camera access requires HTTPS or localhost
- Screen brightness auto-maximum not available on all browsers

## Security Notes

- All processing happens locally - no data leaves the device
- UUID ensures you only receive from intended sender
- QR codes are ephemeral - disappear when transfer ends
- No persistent storage of transferred files

## License

MIT License - Feel free to use and modify!
