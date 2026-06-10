import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { klDevServer } from './server/klDevPlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), klDevServer()],
  server: {
    proxy: {
      // Proxy external services directly (NOT through KivaLens prod)
      '/proxy/kiva': {
        target: 'https://www.kiva.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/kiva/, ''),
      },
      '/proxy/gdocs': {
        target: 'https://docs.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/gdocs/, ''),
      },
    },
  },
})
