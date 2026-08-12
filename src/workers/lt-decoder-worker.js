// LT Code Decoder using Belief Propagation
import { 
  SYMBOL_DATA_SIZE, 
  HEADER_SIZE, 
  calculateCRC16, 
  createDegreeGenerator, 
  selectDistinctIndices 
} from '../lib/utils.js';

const QR_HEADER_VERSION = 0x01;

class LTDecoder {
  constructor(totalSymbols, symbolSize = SYMBOL_DATA_SIZE) {
    this.k = totalSymbols;
    this.symbolSize = symbolSize;
    this.receivedSymbols = new Map(); // symbolIndex -> { degree, indices, data }
    this.sourceBlocks = new Array(totalSymbols).fill(null);
    this.recoveredCount = 0;
    this.graph = []; // For each source block, list of received symbols that include it
    for (let i = 0; i < totalSymbols; i++) {
      this.graph[i] = [];
    }
    
    // Pre-compute degree generator
    this.getDegree = createDegreeGenerator(totalSymbols);
  }

  addSymbol(payload) {
    // Parse payload: [ver(1)][uuid(16)][k(4)][idx(4)][data][crc(2)]
    if (payload.length < HEADER_SIZE + 2) {
      return { success: false, error: 'Payload too short' };
    }

    const view = new DataView(payload.buffer);
    let offset = 0;

    const version = payload[offset++];
    if (version !== QR_HEADER_VERSION) {
      return { success: false, error: `Invalid version: ${version}` };
    }

    // Skip UUID (16 bytes) - we assume it matches the current transfer
    offset += 16;

    const k = view.getUint32(offset, false);
    offset += 4;

    if (k !== this.k) {
      return { success: false, error: `K mismatch: expected ${this.k}, got ${k}` };
    }

    const symbolIndex = view.getUint32(offset, false);
    offset += 4;

    // Extract data
    const dataEnd = payload.length - 2;
    const data = payload.slice(offset, dataEnd);

    // Verify CRC
    const receivedCrc = view.getUint16(dataEnd, false);
    const calculatedCrc = calculateCRC16(payload.slice(0, dataEnd));
    if (receivedCrc !== calculatedCrc) {
      return { success: false, error: 'CRC mismatch' };
    }

    // Get degree and indices from symbolIndex (same as encoder)
    const degree = this.getDegree(symbolIndex);
    const indices = selectDistinctIndices(symbolIndex, degree, this.k);

    // Check if already recovered
    const sourceIdx = symbolIndex % this.k;
    if (this.sourceBlocks[sourceIdx] !== null) {
      return { success: false, error: 'Already recovered', duplicate: true };
    }

    // Store the received symbol
    this.receivedSymbols.set(symbolIndex, {
      degree: indices.length,
      indices: indices,
      data: new Uint8Array(data)
    });

    // Add to graph
    for (const srcIdx of indices) {
      this.graph[srcIdx].push(symbolIndex);
    }

    // Try belief propagation
    const completed = this.beliefPropagation();
    return { success: true, completed };
  }

  beliefPropagation() {
    let changed = true;
    while (changed && this.recoveredCount < this.k) {
      changed = false;

      // Find a recoverable symbol (degree 1 with exactly one unknown source block)
      for (const [symIdx, sym] of this.receivedSymbols) {
        if (sym.data === null) continue; // Already processed

        // Count unknown source blocks
        const unknownIndices = sym.indices.filter(idx => this.sourceBlocks[idx] === null);
        
        if (unknownIndices.length === 1 && sym.data !== null) {
          // Recover this source block
          const targetIdx = unknownIndices[0];
          let recovered = new Uint8Array(sym.data);

          // XOR out known source blocks
          for (const idx of sym.indices) {
            if (idx !== targetIdx && this.sourceBlocks[idx] !== null) {
              for (let i = 0; i < this.symbolSize; i++) {
                recovered[i] ^= this.sourceBlocks[idx][i];
              }
            }
          }

          this.sourceBlocks[targetIdx] = recovered;
          this.recoveredCount++;
          changed = true;

          // Mark symbol as processed
          sym.data = null;

          // Notify progress
          self.postMessage({
            type: 'progress',
            recovered: this.recoveredCount,
            total: this.k
          });

          if (this.recoveredCount >= this.k) {
            this.finish();
            return true;
          }
        }
      }
    }

    return false;
  }

  finish() {
    // Concatenate all source blocks
    const data = new Uint8Array(this.k * this.symbolSize);
    for (let i = 0; i < this.k; i++) {
      if (this.sourceBlocks[i]) {
        data.set(this.sourceBlocks[i], i * this.symbolSize);
      }
    }

    self.postMessage({
      type: 'complete',
      data: data.buffer
    }, [data.buffer]);
  }

  isComplete() {
    return this.recoveredCount >= this.k;
  }
}

// Worker state
let decoder = null;
let originalSize = 0;
let fileName = '';
let fileType = '';
let compressionMode = 'none';

self.onmessage = function(e) {
  const { type, totalSymbols, payload, metadata } = e.data;

  if (type === 'init') {
    decoder = new LTDecoder(totalSymbols);
    originalSize = e.data.originalSize || 0;
    fileName = e.data.fileName || 'received_file';
    fileType = e.data.fileType || 'application/octet-stream';
    compressionMode = e.data.compressionMode || 'none';
    
    self.postMessage({ type: 'initialized' });
  } else if (type === 'symbol') {
    if (!decoder) {
      self.postMessage({ type: 'error', message: 'Decoder not initialized' });
      return;
    }

    const result = decoder.addSymbol(payload);
    
    if (!result.success && !result.duplicate) {
      // Log error but continue (might be corrupted packet)
      console.warn('Symbol rejected:', result.error);
    }
    
    if (result.completed && decoder.isComplete()) {
      // File is complete, complete message already sent
    }
  } else if (type === 'setMetadata') {
    originalSize = e.data.originalSize || 0;
    fileName = e.data.fileName || 'received_file';
    fileType = e.data.fileType || 'application/octet-stream';
    compressionMode = e.data.compressionMode || 'none';
  }
};
