import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/static/memory-panel/',
  build: {
    outDir: '../static/memory-panel',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'memory-panel.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css' || assetInfo.name === 'index.css' || assetInfo.name?.endsWith('.css')) {
            return 'memory-panel.css'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  },
  server: {
    port: 5173
  }
})
