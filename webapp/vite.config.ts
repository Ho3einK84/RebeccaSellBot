import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { collectBuildVersionInfo } from '../scripts/version-info.mjs';

const appVersionInfo = collectBuildVersionInfo({
  repoRoot: path.resolve(import.meta.dirname, '..'),
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(import.meta.dirname),
  base: '/',
  define: {
    __APP_VERSION_INFO__: JSON.stringify(appVersionInfo),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/webapp'),
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
    },
  },
});
