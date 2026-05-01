import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://bgc-website-1mi.pages.dev',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
