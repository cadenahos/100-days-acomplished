import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, proxy /api and /health to the local backend so the frontend code
// uses the exact same relative paths it uses in production behind nginx.
// Override with DEV_BACKEND_URL if your backend runs elsewhere.
// eslint-disable-next-line no-undef
const devBackend = process.env.DEV_BACKEND_URL || 'http://localhost:5048'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': { target: devBackend, changeOrigin: true },
      '/health': { target: devBackend, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
