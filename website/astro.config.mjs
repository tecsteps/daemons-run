import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://daemons.run',
  output: 'static',
  build: { format: 'file' },
  vite: { plugins: [tailwindcss()] },
});
