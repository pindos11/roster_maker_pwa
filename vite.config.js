import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/',
  plugins: [VitePWA({ registerType: 'prompt', workbox: { globPatterns: ['**/*.{js,css,html,svg,json}'] }, manifest: {
    name: 'Roster Planner', short_name: 'Roster Planner', start_url: '.', scope: '.', display: 'standalone',
    background_color: '#f5f7fb', theme_color: '#1d4ed8', icons: [
      { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
    ]
  }})]
});
