// LT Code (Fountain Code) Encoder using Robust Soliton Distribution
const QR_PAYLOAD_MAX = 1600;
const QR_HEADER_SIZE = 25; // 1 + 16 + 4 + 4
const SYMBOL_DATA_SIZE = 1500; // Reduced for reliable scanning

class LTEncoder {
  constructor(data, uuid, symbolSize = SYMBOL_DATA_SIZE) {
    this.data = data; // Uint8Array
    this.uuid = uuid;
    this.symbolSize = symbolSize;
    this.totalSymbols = Math.ceil(data.length / symbolSize);
    this.sourceBlocks = this.splitIntoBlocks();
    this.counter = 0;
    
    // Robust Soliton Distribution parameters
    this.c = 0.1; // Constant for RSD
    this.delta = 0.01; // Failure probability
    this.R = this.computeR();
  }

  splitIntoBlocks() {
    const blocks = [];
    for (let i = 0; i < this.totalSymbols; i++) {
      const start = i * this.symbolSize;
      const end = Math.min(start + this.symbolSize, this.data.length);
      const block = new Uint8Array(this.symbolSize);
      block.set(this.data.slice(start, end));
      blocks.push(block);
    }
    return blocks;
  }

  computeR() {
    const k = this.totalSymbols;
    const sumTau = this.computeSumTau(k);
    return Math.ceil(this.c * Math.sqrt(k) * Math.log(k / this.delta) / sumTau);
  }

  computeSumTau(k) {
    let sum = 0;
    for (let d = 1; d <= k; d++) {
      sum += 1 / d;
    }
    return sum;
  }

  // Robust Soliton Distribution
  getDegree() {
    const k = this.totalSymbols;
    const random = this.seededRandom(this.counter);
    
    // Compute ideal soliton distribution
    const rho = new Array(k + 1).fill(0);
    rho[1] = 1 / k;
    for (let d = 2; d <= k; d++) {
      rho[d] = 1 / (d * (d - 1));
    }

    // Compute tau
    const tau = new Array(k + 1).fill(0);
    const sumTau = this.computeSumTau(k);
    for (let d = 1; d < this.R; d++) {
      tau[d] = this.R / (d * k);
    }
    tau[this.R] = this.R * Math.log(this.R / this.delta) / k;

    // Combine rho and tau
    const mu = new Array(k + 1).fill(0);
    for (let d = 1; d <= k; d++) {
      mu[d] = (rho[d] + tau[d]) / (this.computeSumTau(k) / k + this.R / k * Math.log(this.R / this.delta));
    }

    // Normalize
    let sum = 0;
    for (let d = 1; d <= k; d++) {
      sum += mu[d];
    }
    for (let d = 1; d <= k; d++) {
      mu[d] /= sum;
    }

    // Cumulative distribution
    const cumulative = new Array(k + 1).fill(0);
    for (let d = 1; d <= k; d++) {
      cumulative[d] = cumulative[d - 1] + mu[d];
    }

    // Sample degree
    const r = random();
    let degree = 1;
    for (let d = 1; d <= k; d++) {
      if (r <= cumulative[d]) {
        degree = d;
        break;
      }
    }

    return Math.max(1, Math.min(k, degree));
  }

  seededRandom(seed) {
    // Simple seeded PRNG (mulberry32)
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Generate encoded symbol
  generateSymbol() {
    const k = this.totalSymbols;
    const degree = this.getDegree();
    
    // Select 'degree' distinct source block indices
    const indices = this.selectIndices(degree, k);
    
    // XOR the selected blocks
    const encoded = new Uint8Array(this.symbolSize);
    for (const idx of indices) {
      for (let i = 0; i < this.symbolSize; i++) {
        encoded[i] ^= this.sourceBlocks[idx][i];
      }
    }

    // Create packet: [seed (4)][symbol_index (4)][data]
    const packet = new Uint8Array(8 + this.symbolSize);
    const view = new DataView(packet.buffer);
    view.setUint32(0, this.counter, false); // seed (big-endian)
    view.setUint32(4, this.counter, false); // symbol_index (big-endian)
    packet.set(encoded, 8);

    this.counter++;
    return { packet, degree, indices, symbolIndex: this.counter - 1 };
  }

  selectIndices(degree, k) {
    const indices = new Set();
    const random = this.seededRandom(this.counter);
    
    while (indices.size < degree) {
      const idx = Math.floor(random() * k);
      indices.add(idx);
    }
    
    return Array.from(indices);
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
    encoder = new LTEncoder(data, uuid);
    self.postMessage({ 
      type: 'initialized', 
      totalSymbols: encoder.getTotalSymbols(),
      uuid: uuid
    });
  } else if (type === 'generate') {
    if (!encoder) {
      self.postMessage({ type: 'error', message: 'Encoder not initialized' });
      return;
    }
    
    const symbol = encoder.generateSymbol();
    self.postMessage({ 
      type: 'symbol', 
      packet: symbol.packet,
      symbolIndex: symbol.symbolIndex,
      totalSymbols: encoder.getTotalSymbols()
    }, [symbol.packet.buffer]);
  }
};
