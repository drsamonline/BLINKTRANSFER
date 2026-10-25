# Changelog

## 3.0.1 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.


All notable changes to BlinkTransfer are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Live landing page (`docs/index.html`) and demo at `docs/play/`.

### Fixed
- Frame headers are validated on parse: a payload shorter than the blockSize it
  claims, a totalLength larger than `k * blockSize`, or a transfer over 64 MB is
  rejected. A crafted frame could otherwise force a ~4 GB decoder allocation.
- Result blob URLs are revoked instead of leaked.

## [3.0.0] - 2026-10-22

First release that actually transfers files end to end.

### Added
- **LT fountain coding** (`src/lib/fountain.js`): rateless symbols so a missed
  frame never breaks a transfer — the receiver needs *enough* symbols, not every
  one.
- Real **QR encoder** (`qrcode-generator`) and **decoder** (`jsQR`) wired into
  `src/lib/qr.js`, with automatic QR version selection and binary-safe payloads.
- Self-describing **frame format** with a header CRC-16 (`src/lib/frame.js`).
- Transfer **codec**: multi-file container + gzip via `CompressionStream`.
- Working **sender and receiver** with a camera scan loop, multi-scale decoding,
  progress and file saving.
- **Compatibility mode**: a single plain QR any third-party scanner can read, for
  small text payloads.
- Test suite (`node --test`) covering fountain codes, frames, codec and a full
  optical loopback with binary data.
- PolyForm Noncommercial licence, commercial licence guide, third-party notices.
- esbuild build (`tools/build.mjs`) and dev server (`tools/dev.mjs`).
- **Release automation**: `build-apps.yml` builds the portable Windows EXE and
  Android APK (via `drsamonline/app-builder`) and publishes them on the
  `app-latest` release; `pages.yml` deploys the landing page and demo to GitHub
  Pages.
- Receiver robustness: three decode scales, a reused scratch canvas and a faster
  scan cadence.

### Fixed
- The previous version rendered no QR at all (`window.QRCode` was never defined)
  and had no decoder — the receiver was a stub.

### Changed
- Relicensed future versions under the dual (non-commercial free / commercial
  paid) model. Copies previously released under MIT keep that grant.
- Replaced Vite with esbuild to stay dependency-light.

## [2.0.0] - earlier

- UI prototype for animated QR transfer. Not functional end to end.

[Unreleased]: https://github.com/drsamonline/BLINKTRANSFER/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/drsamonline/BLINKTRANSFER/releases/tag/v3.0.0
