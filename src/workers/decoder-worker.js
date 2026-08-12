// QR Decoder Worker - uses jsQR library with multi-scale detection
importScripts('/src/lib/jsQR.min.js');

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
        
        const scaledCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
        const scaledCtx = scaledCanvas.getContext('2d');
        scaledCtx.drawImage(
          imageData, 
          0, 0, imageData.width, imageData.height,
          0, 0, scaledWidth, scaledHeight
        );
        const scaledImageData = scaledCtx.getImageData(0, 0, scaledWidth, scaledHeight);
        
        code = jsQR(scaledImageData.data, scaledWidth, scaledHeight, {
          inversionAttempts: 'attemptBoth'
        });
      }
      
      // If still not found, try even smaller scale
      if (!code && (imageData.width > 800 || imageData.height > 800)) {
        const scale = 0.25;
        const scaledWidth = Math.floor(imageData.width * scale);
        const scaledHeight = Math.floor(imageData.height * scale);
        
        const scaledCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
        const scaledCtx = scaledCanvas.getContext('2d');
        scaledCtx.drawImage(
          imageData, 
          0, 0, imageData.width, imageData.height,
          0, 0, scaledWidth, scaledHeight
        );
        const scaledImageData = scaledCtx.getImageData(0, 0, scaledWidth, scaledHeight);
        
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
