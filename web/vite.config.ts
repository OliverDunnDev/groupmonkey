import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server proxies /api to the .NET API. Set VITE_API_URL to bypass the proxy
// (e.g. when the UI is wrapped in a desktop shell). `--mode demo` builds the static, backend-free demo
// (see src/demo); it uses relative asset paths so it works from any GitHub Pages sub-path.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? './' : '/',
  // A true compile-time constant: normal builds drop the demo code entirely (see src/demo/flag.ts).
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:5080' },
  },
}))
