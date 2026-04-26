import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/boston-crime': {
        target: 'https://data.boston.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/boston-crime/, ''),
      },
      '/api/massdot': {
        target: 'https://gisstg.massdot.state.ma.us',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/massdot/, ''),
      },
    },
  },
})
