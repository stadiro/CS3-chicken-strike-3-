import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      allow: [projectRoot],
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
