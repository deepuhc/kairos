import { defineConfig } from 'vite';
import path from 'node:path';

const root = process.cwd();
const backendPort = process.env.KAIROS_PORT ?? '3333';
const backendUrl = `http://localhost:${backendPort}`;

export default defineConfig({
  root: path.join(root, 'src'),
  publicDir: path.join(root, 'public'),
  define: {
    __KAIROS_VERSION__: JSON.stringify('0.1.0'),
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/highlight.js/')) return 'highlight';
          if (id.includes('/marked/')) return 'marked';
          if (id.includes('/lit/') || id.includes('/lit-html/') || id.includes('/lit-element/') || id.includes('/@lit/')) return 'lit';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backendUrl,
      '/acp': {
        target: backendUrl,
        ws: true,
      },
      '/events': {
        target: backendUrl,
        ws: true,
      },
      '/terminal': {
        target: backendUrl,
        ws: true,
      },
    },
  },
});
