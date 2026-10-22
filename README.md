<div align="center">

# ⚡ BlinkTransfer

**Offline file transfer via animated QR codes — no internet, no Bluetooth, no cables.**

[![Stars](https://img.shields.io/github/stars/drsamonline/BLINKTRANSFER)](https://github.com/drsamonline/BLINKTRANSFER/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/drsamonline/BLINKTRANSFER)](https://github.com/drsamonline/BLINKTRANSFER/commits)
[![License: not specified](https://img.shields.io/badge/license-not%20specified-lightgrey)](https://github.com/drsamonline/BLINKTRANSFER)
[![Top language](https://img.shields.io/github/languages/top/drsamonline/BLINKTRANSFER)](https://github.com/drsamonline/BLINKTRANSFER)

**Landing page:** [drsamonline.github.io/BLINKTRANSFER](https://drsamonline.github.io/BLINKTRANSFER/) · **Live demo:** [open the app](https://drsamonline.github.io/BLINKTRANSFER/play/) · **Download:** [clone the repo](https://github.com/drsamonline/BLINKTRANSFER)

**Download:** [Windows (.exe)](https://github.com/drsamonline/BLINKTRANSFER/releases/latest/download/BLINKTRANSFER-portable.exe) &nbsp;·&nbsp; [Android (.apk)](https://github.com/drsamonline/BLINKTRANSFER/releases/latest/download/BLINKTRANSFER.apk)

</div>

---


**Offline file transfer via animated QR codes**

## Features

- 🔒 **Completely Offline** - No internet, Bluetooth, or cables needed
- 📸 **QR Code Transfer** - Animated QR codes at 20 FPS
- 🗜️ **Smart Compression** - JPEG for images (adjustable quality), Gzip for others
- 📦 **Multi-File Support** - Send multiple files in one session
- 🎯 **Focus Assist** - Camera calibration pattern before transfer
- ✅ **CRC-16 Checksums** - Error detection on every QR frame
- 🌐 **PWA Ready** - Installable, works offline after first load
- 📱 **Mobile Optimized** - Beautiful responsive UI

## File Size Limits

- **Max per file**: 5 MB
- **Max total batch**: 20 MB
- **Practical speed**: ~30 KB/s (20 FPS × 1573 bytes)

## Performance

| File Type | Original | Compressed | Transfer Time |
|-----------|----------|------------|---------------|
| Text doc  | 100 KB   | 30 KB      | 1-2 seconds   |
| Photo     | 5 MB     | 500 KB     | 17-20 seconds |
| PDF       | 2 MB     | 1.8 MB     | 60-70 seconds |

## Usage

```bash
npm install
npm run dev      # Development server on port 3000
npm run build    # Production build in dist/
npm run preview  # Preview production build
```

## How It Works

### Sender
1. Select files (multiple supported)
2. Adjust image quality if needed (10-90%)
3. Focus assist pattern displays for 2 seconds
4. Header QR shows file metadata
5. Animated data stream begins (20 FPS)
6. Keep screen visible until complete

### Receiver
1. Tap "Receive" and grant camera permission
2. Point camera at sender's QR code
3. Progress bar shows symbols collected
4. When complete: tap "Save Files" to download

## Technical Details

- **QR Payload**: 1600 bytes per frame (1573 data + 27 header)
- **Header**: Version(1) + UUID(16) + k(4) + symbolIndex(4) + CRC(2)
- **Compression**: Canvas-based JPEG for images, CompressionStream API for others
- **Wake Lock**: Keeps screen on during transfer
- **Service Worker**: Caches app for offline use

## Browser Requirements

- Chrome 80+ (recommended)
- Firefox 114+
- Safari 16+

Required APIs: `CompressionStream`, `getUserMedia`, `wakeLock`

## License

MIT
