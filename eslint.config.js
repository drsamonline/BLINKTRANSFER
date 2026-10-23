export default [
  { ignores: ['docs/**', 'node_modules/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        performance: 'readonly', console: 'readonly', fetch: 'readonly',
        caches: 'readonly', self: 'readonly', crypto: 'readonly',
        CompressionStream: 'readonly', DecompressionStream: 'readonly',
        Response: 'readonly', Blob: 'readonly', URL: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', requestAnimationFrame: 'readonly',
        process: 'readonly', Buffer: 'readonly', btoa: 'readonly', atob: 'readonly', module: 'readonly', require: 'readonly', exports: 'readonly', globalThis: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        ImageData: 'readonly', OffscreenCanvas: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
