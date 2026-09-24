import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the build works from any sub-path (GitHub Pages: /<repo>/)
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
