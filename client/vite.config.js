import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + Socket.IO to the backend on :3000, so the client can
// use same-origin relative URLs and websockets upgrade cleanly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
      '/health': 'http://localhost:3000',
    },
  },
});
