import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'sync-vendor': ['socket.io-client'],
        },
      },
    },
  },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.PORT || 4000}`,
      '/socket.io': {
        target: `http://127.0.0.1:${process.env.PORT || 4000}`,
        ws: true,
      },
    },
  },
});
