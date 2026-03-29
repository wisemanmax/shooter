import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
