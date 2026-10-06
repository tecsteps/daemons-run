import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Adapted from old daemons-run resources/js/lib/xtermShadeGlyphs.ts: the WebGL addon draws the
// shade glyphs (U+2591..2593, Claude Code's welcome art) as sparse dots; draw solid alpha fills.
const SHADE_ANCHOR = 'let u=Wr[e];if(u)return Kr(i,u,t,n,s,o),!0;';
const SHADE_FIX = String.raw`let u={"\u2591":.25,"\u2592":.5,"\u2593":.75}[e];if(u!==void 0){let a0=i.globalAlpha;i.globalAlpha=a0*u,i.fillRect(t,n,s,o),i.globalAlpha=a0;return!0}`;
const xtermShadeGlyphs = (): Plugin => ({
  name: 'xterm-shade-glyphs',
  transform(code, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/@xterm/addon-webgl/lib/addon-webgl.mjs')) return;
    if (code.split(SHADE_ANCHOR).length !== 2) {
      this.warn('xterm WebGL addon changed: shade glyph fix not applied');
      return;
    }
    return { code: code.replace(SHADE_ANCHOR, SHADE_FIX), map: null };
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), xtermShadeGlyphs()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) } },
  build: { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true }, '/agent': 'http://localhost:8787', '/install.sh': 'http://localhost:8787' } },
});
