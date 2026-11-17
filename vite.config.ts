import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ command }) => ({
  // Relative base: dist/ works from any sub-path (GitHub Pages project sites) or inside a Capacitor shell.
  base: './',
  define: {
    __SKITCH_VERSION__: JSON.stringify(pkg.version),
    // Only a production build registers the service worker (see src/app/pwa.ts).
    __SKITCH_BUILD__: JSON.stringify(command === 'build'),
  },
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
}));
