import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Stamped into the page so a user's screenshot says which build they ran
  // (a phone can keep a tab open on an old one for days).
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
