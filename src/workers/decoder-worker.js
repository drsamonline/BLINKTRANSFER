// QR Decoder Worker - uses jsQR library
importScripts('/src/lib/jsQR.min.js');

self.onmessage = function(e) {
  const { type, imageData, options } = e.data;

  if (type === 'decode') {
    try {
      // Try different scales for robustness
      const results = [];
      
      // Try at original scale
      let code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      
      if (code) {
        results.push(code.data);
      }
      
      // Try with inversion if not found
      if (!code && options?.tryInvert !== false) {
        code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        
        if (code) {
          results.push(code.data);
        }
      }
      
      if (results.length > 0) {
        self.postMessage({
          type: 'decoded',
          data: results[0],
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
