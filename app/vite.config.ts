import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: "Let's Jam",
        short_name: "Let's Jam",
        description: 'Live song-leading and repertoire tracking',
        theme_color: '#8a3ffc',
        background_color: '#faf9fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-shell only — Supabase API calls are left to the network (no
        // offline data story yet; that's a separate, deliberate decision).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
