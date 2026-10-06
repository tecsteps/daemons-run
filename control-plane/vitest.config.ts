import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'text-modules',
      load(id) {
        if (id.endsWith('.sh') || id.endsWith('.tmpl')) return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
      },
    },
  ],
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./test/cloudflare-workers-stub.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
