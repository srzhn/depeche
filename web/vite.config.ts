import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev Vite отдаёт фронт на :5173 и проксирует API/веб-сокет на Node-сервер :3000.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
