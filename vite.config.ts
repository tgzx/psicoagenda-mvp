import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const appBase =
  process.env.GITHUB_PAGES === 'true' && repositoryName
    ? `/${repositoryName}/`
    : '/'

export default defineConfig({
  base: appBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PsicoAgenda',
        short_name: 'PsicoAgenda',
        description: 'Agenda e prontuario leve para psicologos.',
        theme_color: '#16453f',
        background_color: '#f7faf8',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          {
            src: './favicon.svg',
            sizes: '48x48',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*$/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'supabase-network-only',
            },
          },
        ],
      },
    }),
  ],
})
