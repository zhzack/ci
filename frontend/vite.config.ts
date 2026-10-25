import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000';
const USE_POLLING = Boolean(process.env.VITE_USE_POLLING || process.env.CHOKIDAR_USEPOLLING);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    // The antd vendor chunk is ~1 MB raw (330 kB gzip) and the Monaco
    // editor chunk ~4 MB raw — both are cached across releases; above the
    // default limit by design.
    chunkSizeWarningLimit: 4200,
    rollupOptions: {
      output: {
        // Split the large vendor libraries into cacheable chunks instead of
        // one oversized app bundle.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          query: ['@tanstack/react-query', 'axios', 'zustand'],
          monaco: ['monaco-editor', '@monaco-editor/react'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: USE_POLLING ? { usePolling: true, interval: 100 } : undefined,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
      // System endpoints live outside the /api prefix (health probes, installer scripts).
      '/health': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/install': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/uninstall': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
});
