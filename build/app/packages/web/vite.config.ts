import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Built straight into the API package, which serves it as static files.
  // One container, one origin — no CORS in production and no second service.
  build: {
    outDir: '../api/public',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3010', '/media': 'http://localhost:3010' },
  },
})
