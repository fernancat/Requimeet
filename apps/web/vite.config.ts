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
  server: {
    host: true,
    // Dominios de tuneles (ngrok) permitidos como Host
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.ngrok.app'],
    proxy: {
      // Mismo origen: la app habla /api, /socket.io y /rtc (LiveKit) a traves
      // del dev server; asi UN solo tunel ngrok (5173) expone todo lo HTTP/WS.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/rtc': { target: 'ws://localhost:7880', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
