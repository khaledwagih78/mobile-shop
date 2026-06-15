import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'خالد لقطع غيار المحمول',
        short_name: 'خالد ERP',
        description: 'نظام مبيعات ومخزون لقطع غيار المحمول - يعمل بدون إنترنت',
        dir: 'rtl',
        lang: 'ar',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F6F8',
        theme_color: '#0F4C5C',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  build: { chunkSizeWarningLimit: 1500 }
});
