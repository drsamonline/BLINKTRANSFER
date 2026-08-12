// BlinkTransfer - Shared Utilities

/**
 * Generate a random UUID as Uint8Array (16 bytes)
 */
export function generateUUID() {
  const uuid = new Uint8Array(16);
  crypto.getRandomValues(uuid);
  return uuid;
}

/**
 * Calculate CRC-16 checksum (CCITT polynomial)
 */
export function calculateCRC16(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ polynomial : crc << 1;
    }
  }
  
  return crc & 0xFFFF;
}

/**
 * Mulberry32 PRNG - fast seeded random number generator
 */
export function createPRNG(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Format bytes to human-readable string
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Get file icon emoji based on MIME type
 */
export function getFileIcon(type) {
  if (!type) return '📁';
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '📦';
  if (type.includes('word') || type.includes('document') || type.includes('text')) return '📝';
  return '📁';
}
