/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // @requimeet/contracts es CJS con re-exports; hay que transformarlo
  // explicitamente para poder usar named imports en el bundle.
  build: {
    commonjsOptions: { include: [/contracts/, /node_modules/] },
  },
  optimizeDeps: { include: ['@requimeet/contracts'] },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
