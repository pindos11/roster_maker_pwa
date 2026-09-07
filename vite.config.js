import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/',
  plugins: [VitePWA({ registerType: 'prompt', manifest: {
    name: 'Roster Planner', short_name: 'Roster Planner', start_url: '.', display: 'standalone',
    background_color: '#f5f7fb', theme_color: '#1d4ed8', icons: []
  }})]
});
