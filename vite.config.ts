import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: false,
    // three.js alone is ~530 kB minified; the real budget (400 kB gzip) is enforced by `npm run perf`.
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
  preview: { host: '127.0.0.1' },
});
