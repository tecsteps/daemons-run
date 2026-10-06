import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) } },
  build: { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true }, '/agent': 'http://localhost:8787', '/install.sh': 'http://localhost:8787' } },
});
