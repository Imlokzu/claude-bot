import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/static/chat-panel/',
  build: {
    outDir: '../static/chat-panel',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'chat-panel.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'chat-panel.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
