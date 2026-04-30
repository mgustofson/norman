import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import 'dotenv/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            if (process.env.ANTHROPIC_API_KEY) {
              proxyReq.setHeader('x-api-key', process.env.ANTHROPIC_API_KEY);
            }
            proxyReq.setHeader('anthropic-version', '2023-06-01');
            proxyReq.setHeader('anthropic-dangerous-direct-browser-access', 'true');
            
            // Also drop origin to be safe
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        }
      }
    }
  }
})
