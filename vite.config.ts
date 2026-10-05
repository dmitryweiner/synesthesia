import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: './',
  // SYN_HTTPS=1: a self-signed HTTPS dev server, so a phone on the LAN gets
  // a secure context (an AudioWorklet needs one) — `npm run bench:serve`.
  plugins: process.env.SYN_HTTPS ? [basicSsl()] : [],
  // Stamped into the page so a user's screenshot says which build they ran
  // (a phone can keep a tab open on an old one for days).
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    // core-bench.html: PLAN-CORE.md phase 0's gate, opened on phones too
    rollupOptions: { input: { main: 'index.html', coreBench: 'core-bench.html' } },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
