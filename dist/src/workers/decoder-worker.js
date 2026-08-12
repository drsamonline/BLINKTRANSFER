// QR Decoder Worker - uses jsQR library with multi-scale detection
importScripts('./jsQR.min.js');

self.onmessage = function(e) {
  const { type, imageData, options } = e.data;
  
  if (type === 'decode') {
    try {
      // Try different scales for robustness
      let code = null;
      
      // Try at original scale first
      code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      
      // If not found, try scaled down versions (for QR codes that are too close/large)
      if (!code && (imageData.width > 400 || imageData.height > 400)) {
        const scale = 0.5;
        const scaledWidth = Math.floor(imageData.width * scale);
        const scaledHeight = Math.floor(imageData.height * scale);
        
        const tempCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
        const tempCtx = tempCanvas.getContext('2d');
        
        // Create ImageData from array
        const scaledImageData = tempCtx.createImageData(scaledWidth, scaledHeight);
        
        // Simple bilinear scaling
        for (let y = 0; y < scaledHeight; y++) {
          for (let x = 0; x < scaledWidth; x++) {
            const srcX = Math.floor(x / scale);
            const srcY = Math.floor(y / scale);
            const srcIdx = (srcY * imageData.width + srcX) * 4;
            const dstIdx = (y * scaledWidth + x) * 4;
            
            scaledImageData.data[dstIdx] = imageData.data[srcIdx];
            scaledImageData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
            scaledImageData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
            scaledImageData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
          }
        }
        
        code = jsQR(scaledImageData.data, scaledWidth, scaledHeight, {
          inversionAttempts: 'attemptBoth'
        });
      }
      
      // If still not found, try even smaller scale
      if (!code && (imageData.width > 800 || imageData.height > 800)) {
        const scale = 0.25;
        const scaledWidth = Math.floor(imageData.width * scale);
        const scaledHeight = Math.floor(imageData.height * scale);
        
        const tempCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
        const tempCtx = tempCanvas.getContext('2d');
        const scaledImageData = tempCtx.createImageData(scaledWidth, scaledHeight);
        
        // Simple bilinear scaling
        for (let y = 0; y < scaledHeight; y++) {
          for (let x = 0; x < scaledWidth; x++) {
            const srcX = Math.floor(x / scale);
            const srcY = Math.floor(y / scale);
            const srcIdx = (srcY * imageData.width + srcX) * 4;
            const dstIdx = (y * scaledWidth + x) * 4;
            
            scaledImageData.data[dstIdx] = imageData.data[srcIdx];
            scaledImageData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
            scaledImageData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
            scaledImageData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
          }
        }
        
        code = jsQR(scaledImageData.data, scaledWidth, scaledHeight, {
          inversionAttempts: 'attemptBoth'
        });
      }
      
      if (code) {
        self.postMessage({
          type: 'decoded',
          data: code.data,
          success: true
        });
      } else {
        self.postMessage({
          type: 'decoded',
          data: null,
          success: false
        });
      }
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error.message
      });
    }
  }
};
