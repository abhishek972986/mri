import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is proxied rather than called cross-origin so that slice PNGs and
// NIfTI downloads are same-origin in the browser and need no CORS preflight.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind IPv4 explicitly: Vite's default binds only [::1] on this machine, and
    // whether http://localhost:5173 reaches it then depends on resolver order.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
