import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server proxies /api to the .NET API. Set VITE_API_URL to bypass the proxy
// (e.g. when the UI is wrapped in a desktop shell).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:5080' },
  },
})
