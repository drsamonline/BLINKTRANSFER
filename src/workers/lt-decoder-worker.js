// LT Code Decoder using Belief Propagation
const SYMBOL_DATA_SIZE = 1500; // Reduced from 2936 for reliable scanning

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
  }

  addSymbol(symbolIndex, packet) {
    const sourceIdx = symbolIndex % this.k;
    if (this.sourceBlocks[sourceIdx] !== null) {
      return false; // Already recovered
    }

    // Parse packet: [seed (4)][symbol_index (4)][data]
    const view = new DataView(packet.buffer);
    const seed = view.getUint32(0, false);
    const idx = view.getUint32(4, false);
    const data = packet.slice(8);

    // We need to regenerate the indices from the seed
    const indices = this.selectIndicesFromSeed(seed, this.k);
    
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
    return this.beliefPropagation();
  }

  selectIndicesFromSeed(seed, k) {
    // Reproduce the same index selection as encoder
    const c = 0.1;
    const delta = 0.01;
    const sumTau = this.computeSumTau(k);
    const R = Math.ceil(c * Math.sqrt(k) * Math.log(k / delta) / sumTau);

    // Compute degree using same RSD
    const random = this.seededRandom(seed);
    
    const rho = new Array(k + 1).fill(0);
    rho[1] = 1 / k;
    for (let d = 2; d <= k; d++) {
      rho[d] = 1 / (d * (d - 1));
    }

    const tau = new Array(k + 1).fill(0);
    for (let d = 1; d < R; d++) {
      tau[d] = R / (d * k);
    }
    tau[R] = R * Math.log(R / delta) / k;

    const mu = new Array(k + 1).fill(0);
    for (let d = 1; d <= k; d++) {
      mu[d] = (rho[d] + tau[d]) / (sumTau / k + R / k * Math.log(R / delta));
    }

    let sum = 0;
    for (let d = 1; d <= k; d++) {
      sum += mu[d];
    }
    for (let d = 1; d <= k; d++) {
      mu[d] /= sum;
    }

    const cumulative = new Array(k + 1).fill(0);
    for (let d = 1; d <= k; d++) {
      cumulative[d] = cumulative[d - 1] + mu[d];
    }

    const r = random();
    let degree = 1;
    for (let d = 1; d <= k; d++) {
      if (r <= cumulative[d]) {
        degree = d;
        break;
      }
    }
    degree = Math.max(1, Math.min(k, degree));

    // Select indices
    const indices = new Set();
    while (indices.size < degree) {
      const idx = Math.floor(random() * k);
      indices.add(idx);
    }

    return Array.from(indices);
  }

  computeSumTau(k) {
    let sum = 0;
    for (let d = 1; d <= k; d++) {
      sum += 1 / d;
    }
    return sum;
  }

  seededRandom(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
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
      data.set(this.sourceBlocks[i], i * this.symbolSize);
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
  const { type, totalSymbols, symbolIndex, packet, metadata } = e.data;

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

    const success = decoder.addSymbol(symbolIndex, packet);
    
    if (success && decoder.isComplete()) {
      // File is complete, send it back with metadata
      // The complete message already includes the data
    }
  } else if (type === 'setMetadata') {
    originalSize = e.data.originalSize || 0;
    fileName = e.data.fileName || 'received_file';
    fileType = e.data.fileType || 'application/octet-stream';
    compressionMode = e.data.compressionMode || 'none';
  }
};
