import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html'
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  server: {
    port: 3000,
    host: true
  },
  plugins: [{
    name: 'copy-workers',
    writeBundle() {
      // Copy workers and libs to dist
      const dist = 'dist';
      
      // Create directories
      mkdirSync(join(dist, 'src', 'workers'), { recursive: true });
      mkdirSync(join(dist, 'src', 'lib'), { recursive: true });
      
      // Copy worker files
      copyFileSync('src/workers/encoder-worker.js', join(dist, 'src', 'workers', 'encoder-worker.js'));
      copyFileSync('src/workers/decoder-worker.js', join(dist, 'src', 'workers', 'decoder-worker.js'));
      copyFileSync('src/workers/lt-decoder-worker.js', join(dist, 'src', 'workers', 'lt-decoder-worker.js'));
      copyFileSync('sw.js', join(dist, 'sw.js'));
      
      // Copy lib files
      copyFileSync('src/lib/jsQR.min.js', join(dist, 'src', 'lib', 'jsQR.min.js'));
      copyFileSync('src/lib/qrcode-gen.js', join(dist, 'src', 'lib', 'qrcode-gen.js'));
      copyFileSync('src/lib/utils.js', join(dist, 'src', 'lib', 'utils.js'));
    }
  }]
});
