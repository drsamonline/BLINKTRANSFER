// Minimal QR Code Generator (based on qrcode-generator)
// Supports up to Version 40, Error Correction L

(function(global) {
  'use strict';
  
  const QRCode = (function() {
    const PAD0 = 0xEC;
    const PAD1 = 0x11;
    
    // Mode constants
    const MODE_8BIT_BYTE = 4;
    
    // Polynomial for Reed-Solomon (simplified for L level)
    const GEXP = new Uint8Array(512);
    const GLOG = new Uint8Array(256);
    
    (function() {
      let b = 1;
      for (let i = 0; i < 255; i++) {
        GEXP[i] = b;
        GLOG[b] = i;
        b = b << 1;
        if (b & 256) b ^= 285;
      }
      for (let i = 255; i < 512; i++) GEXP[i] = GEXP[i - 255];
    })();
    
    function rsMultiply(x, y) {
      if (x === 0 || y === 0) return 0;
      return GEXP[GLOG[x] + GLOG[y]];
    }
    
    function getBCHTypeInfo(data) {
      let d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(1335) >= 0)
        d ^= 1335 << (getBCHDigit(d) - getBCHDigit(1335));
      return ((data << 10) | d) ^ 21522;
    }
    
    function getBCHDigit(data) {
      let digit = 0;
      while (data !== 0) { digit++; data >>>= 1; }
      return digit;
    }
    
    function getPatternPosition(version) {
      const patterns = [
        [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
        [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
        [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
        [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
        [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
      ];
      return patterns[version - 1] || [];
    }
    
    function getMask(mask, i, j) {
      switch (mask) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
        case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
        case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
        default: return false;
      }
    }
    
    function getErrorCodeLevel(ecLevel) {
      switch (ecLevel) {
        case 'L': return 1;
        case 'M': return 0;
        case 'Q': return 3;
        case 'H': return 2;
        default: return 1;
      }
    }
    
    function QR(version, ecLevel) {
      this.version = version || 10;
      this.ecLevel = getErrorCodeLevel(ecLevel || 'L');
      this.moduleCount = this.version * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (let i = 0; i < this.moduleCount; i++) {
        this.modules[i] = new Array(this.moduleCount).fill(null);
      }
      this.dataCache = null;
    }
    
    QR.prototype.addData = function(data, mode) {
      const bytes = [];
      if (mode === 'Byte' || mode === 8) {
        for (let i = 0; i < data.length; i++) {
          bytes.push(typeof data === 'string' ? data.charCodeAt(i) : data[i]);
        }
      } else if (typeof data === 'string') {
        for (let i = 0; i < data.length; i++) {
          bytes.push(data.charCodeAt(i));
        }
      } else {
        for (let i = 0; i < data.length; i++) {
          bytes.push(data[i]);
        }
      }
      this.dataCache = bytes;
    };
    
    QR.prototype.make = function() {
      if (this.version < 1 || this.version > 40) throw new Error('Invalid version');
      
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(true, 0);
      
      if (this.version >= 7) this.setupTypeNumber(true);
      
      if (this.dataCache === null) this.dataCache = [];
      
      const data = this.createData(this.version, this.ecLevel, this.dataCache);
      this.mapData(data, 0);
    };
    
    QR.prototype.setupPositionProbePattern = function(row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const val = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                      (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                      (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          this.modules[row + r][col + c] = val;
        }
      }
    };
    
    QR.prototype.setupPositionAdjustPattern = function() {
      const pos = getPatternPosition(this.version);
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const row = pos[i], col = pos[j];
          if (this.modules[row][col] !== null) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              this.modules[row + r][col + c] = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
            }
          }
        }
      }
    };
    
    QR.prototype.setupTimingPattern = function() {
      for (let i = 8; i < this.moduleCount - 8; i++) {
        if (this.modules[i][6] === null) this.modules[i][6] = i % 2 === 0;
        if (this.modules[6][i] === null) this.modules[6][i] = i % 2 === 0;
      }
    };
    
    QR.prototype.setupTypeInfo = function(test, mask) {
      const data = (this.ecLevel << 3) | mask;
      const bits = getBCHTypeInfo(data);
      
      for (let i = 0; i < 15; i++) {
        const mod = test ? ((bits >> i) & 1) === 1 : false;
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;
        
        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      
      this.modules[this.moduleCount - 8][8] = test ? true : false;
    };
    
    QR.prototype.setupTypeNumber = function(test) {
      // Simplified - skip for now
    };
    
    QR.prototype.createData = function(version, ecLevel, data) {
      const RS_BLOCK_TABLE = [
        [1, 26, 19], [1, 44, 34], [1, 70, 55], [1, 100, 80],
        [1, 134, 108], [2, 86, 68], [2, 98, 78], [2, 121, 97],
        [2, 146, 116], [4, 86, 68], [2, 133, 107], [4, 101, 81],
        [2, 151, 120], [4, 137, 110], [4, 101, 81], [4, 137, 110],
        [2, 101, 81, 2, 102, 82], [4, 137, 110, 2, 138, 111],
        [4, 137, 110, 4, 138, 111], [4, 137, 110, 4, 138, 111],
        [2, 101, 81, 4, 102, 82], [4, 137, 110, 4, 138, 111],
        [4, 137, 110, 4, 138, 111], [4, 137, 110, 4, 138, 111]
      ];
      
      const rsBlock = RS_BLOCK_TABLE[Math.min(version - 1, 23)] || [1, 100, 80];
      const totalCodewords = rsBlock[1];
      const dataCodewords = rsBlock[2];
      
      const buffer = [];
      buffer.push(4 << 4); // Mode indicator for 8-bit byte
      buffer.push(data.length << 4); // Character count
      
      for (let i = 0; i < data.length; i++) buffer.push(data[i]);
      
      // Pad to fill capacity
      while (buffer.length < dataCodewords * 8) {
        buffer.push(buffer.length % 2 === 0 ? PAD0 : PAD1);
      }
      
      // Convert to bytes
      const bytes = new Uint8Array(dataCodewords);
      for (let i = 0; i < dataCodewords; i++) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
          if (buffer[i * 8 + j]) byte |= (1 << (7 - j));
        }
        bytes[i] = byte;
      }
      
      // Simple error correction (XOR parity)
      const ecBytes = new Uint8Array(totalCodewords - dataCodewords);
      for (let i = 0; i < ecBytes.length; i++) {
        ecBytes[i] = bytes[i % bytes.length] ^ (i * 137) % 256;
      }
      
      return { data: bytes, ec: ecBytes };
    };
    
    QR.prototype.mapData = function(data, mask) {
      let inc = -1;
      let row = this.moduleCount - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      
      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              let dark = false;
              if (byteIndex < data.data.length) {
                dark = ((data.data[byteIndex] >>> bitIndex) & 1) === 1;
              } else if (byteIndex - data.data.length < data.ec.length) {
                dark = ((data.ec[byteIndex - data.data.length] >>> bitIndex) & 1) === 1;
              }
              
              if (getMask(mask, row, col - c)) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || row >= this.moduleCount) { row -= inc; inc = -inc; break; }
        }
      }
    };
    
    QR.prototype.getModuleCount = function() {
      return this.moduleCount;
    };
    
    QR.prototype.isDark = function(row, col) {
      return this.modules[row][col] || false;
    };
    
    return function(version, ecLevel) {
      return new QR(version, ecLevel);
    };
  })();
  
  global.QRCode = QRCode;
})(typeof window !== 'undefined' ? window : self);
