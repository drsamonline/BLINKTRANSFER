// LT Code (Fountain Code) Encoder using Robust Soliton Distribution
import { 
  SYMBOL_DATA_SIZE, 
  HEADER_SIZE, 
  calculateCRC16, 
  createDegreeGenerator, 
  selectDistinctIndices 
} from '../lib/utils.js';

const QR_HEADER_VERSION = 0x01;

class LTEncoder {
  constructor(data, uuidBytes, symbolSize = SYMBOL_DATA_SIZE) {
    this.data = data; // Uint8Array
    this.uuidBytes = uuidBytes; // Uint8Array(16)
    this.symbolSize = symbolSize;
    this.totalSymbols = Math.ceil(data.length / symbolSize);
    this.sourceBlocks = this.splitIntoBlocks();
    this.counter = 0;
    
    // Pre-compute degree generator for Robust Soliton
    this.getDegree = createDegreeGenerator(this.totalSymbols);
  }

  splitIntoBlocks() {
    const blocks = [];
    const k = this.totalSymbols;
    for (let i = 0; i < k; i++) {
      const start = i * this.symbolSize;
      const end = Math.min(start + this.symbolSize, this.data.length);
      const block = new Uint8Array(this.symbolSize);
      if (end > start) {
        block.set(this.data.slice(start, end));
      }
      blocks.push(block);
    }
    return blocks;
  }

  // Generate encoded symbol with full header
  generateSymbol() {
    const k = this.totalSymbols;
    const degree = this.getDegree(this.counter);
    
    // Select 'degree' distinct source block indices
    const indices = selectDistinctIndices(this.counter, degree, k);
    
    // XOR the selected blocks
    const encoded = new Uint8Array(this.symbolSize);
    for (const idx of indices) {
      const block = this.sourceBlocks[idx];
      for (let i = 0; i < this.symbolSize; i++) {
        encoded[i] ^= block[i];
      }
    }

    // Build QR payload: [ver(1)][uuid(16)][k(4)][idx(4)][data][crc(2)]
    const payloadSize = HEADER_SIZE + this.symbolSize;
    const payload = new Uint8Array(payloadSize);
    const view = new DataView(payload.buffer);
    
    let offset = 0;
    payload[offset++] = QR_HEADER_VERSION;                    // 1 byte version
    payload.set(this.uuidBytes, offset);                      // 16 bytes UUID
    offset += 16;
    view.setUint32(offset, k, false);                         // 4 bytes k (big-endian)
    offset += 4;
    view.setUint32(offset, this.counter, false);              // 4 bytes symbol index
    offset += 4;
    payload.set(encoded, offset);                             // symbol data
    offset += this.symbolSize;
    
    // Calculate CRC16 over everything except the last 2 bytes
    const crc = calculateCRC16(payload.slice(0, offset));
    view.setUint16(offset, crc, false);                       // 2 bytes CRC
    
    this.counter++;
    
    return { 
      payload, 
      symbolIndex: this.counter - 1,
      totalSymbols: k 
    };
  }

  getTotalSymbols() {
    return this.totalSymbols;
  }
}

// Worker message handling
let encoder = null;

self.onmessage = function(e) {
  const { type, data, uuid } = e.data;

  if (type === 'init') {
    // uuid should be a Uint8Array of 16 bytes
    encoder = new LTEncoder(data, uuid);
    self.postMessage({ 
      type: 'initialized', 
      totalSymbols: encoder.getTotalSymbols(),
      uuid: Array.from(uuid) // Send as array for main thread
    });
  } else if (type === 'generate') {
    if (!encoder) {
      self.postMessage({ type: 'error', message: 'Encoder not initialized' });
      return;
    }
    
    const symbol = encoder.generateSymbol();
    self.postMessage({ 
      type: 'symbol', 
      payload: symbol.payload,
      symbolIndex: symbol.symbolIndex,
      totalSymbols: symbol.totalSymbols
    }, [symbol.payload.buffer]);
  }
};
