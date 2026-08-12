import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The dev server proxies /api to the backend (VITE_API_PROXY_TARGET). In
// production the app calls the relative /api, served by nginx (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing deps into their own vendor chunks so
        // they cache independently of app code and don't bloat the entry.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        // The backend runs with --root-path /api, so its own routes are mounted
        // at the root (/auth, /roles, ...). Strip the /api prefix when proxying.
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
