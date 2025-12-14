
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'app/client',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    proxy: {
        '/api': 'http://localhost:3000'
    }
  }
})
