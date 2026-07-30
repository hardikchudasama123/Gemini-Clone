import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.API_TARGET || 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries so app edits do not
        // invalidate them in the browser cache.
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          markdown: ['marked', 'dompurify', 'highlight.js/lib/common'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
