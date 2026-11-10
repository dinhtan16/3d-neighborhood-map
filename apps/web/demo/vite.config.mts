import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Static, backend-free demo build (GitHub Pages / artifact hosting).
// Reuses the exact same map components as the Next.js app; data comes from
// public/demo-data/*.json produced by `pnpm --filter api export:static`.
const pkg = (name: string) => fileURLToPath(new URL(`../../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      // Bundle workspace packages from source (ESM) instead of their CommonJS dist.
      '@nmap/map-config': pkg('map-config'),
      '@nmap/geo-core': pkg('geo-core'),
      '@nmap/shared-types': pkg('shared-types'),
      '@nmap/map-contracts': pkg('map-contracts'),
    },
  },
  define: {
    'process.env.NEXT_PUBLIC_DATA_MODE': JSON.stringify('static'),
    'process.env.NEXT_PUBLIC_EMBED_MODELS': JSON.stringify(process.env.EMBED_MODELS === '1' ? '1' : '0'),
  },
  // ASCII-only output: survives any host/charset (non-ASCII is \u-escaped).
  esbuild: { charset: 'ascii' },
  build: {
    outDir: fileURLToPath(new URL('../dist-demo', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
