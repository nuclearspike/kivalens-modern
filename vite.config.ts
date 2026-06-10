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
        // Kiva's WAF answers 406 when a browser User-Agent arrives without a
        // full browser fingerprint. Send exactly the header recipe the
        // production KivaLens server uses (cluster.js) and nothing else
        // browser-identifying.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            for (const header of proxyReq.getHeaderNames()) {
              if (
                header === 'user-agent' ||
                header === 'cookie' ||
                header === 'origin' ||
                header.startsWith('sec-') ||
                header.startsWith('accept-')
              ) {
                proxyReq.removeHeader(header)
              }
            }
            proxyReq.setHeader('X-Requested-With', 'XMLHttpRequest')
            proxyReq.setHeader('Accept', 'application/json, text/javascript, */*; q=0.01')
            proxyReq.setHeader('Referer', 'https://www.kiva.org/')
          })
        },
      },
      '/proxy/gdocs': {
        target: 'https://docs.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/gdocs/, ''),
      },
    },
  },
})
