import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://boardgamecompany.in',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/pay'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
