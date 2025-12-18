import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    proxy: {
      '/auth': 'http://localhost:3001',
      '/stream': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true // Importante para que funcionen los WebSockets
      }
    }
  }
})
