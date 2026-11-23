import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.SITE_BASE ?? './',
  resolve: {
    alias: [
      { find: /^route-map-matching\/tiles$/, replacement: src('tiles/index.ts') },
      { find: /^route-map-matching\/traffic-side$/, replacement: src('traffic-side.ts') },
      { find: /^route-map-matching$/, replacement: src('index.ts') },
    ],
  },
  plugins: [
    {
      name: 'text-loader',
      enforce: 'pre',
      load(id) {
        const file = id.split('?')[0];
        if (!file.endsWith('.txt')) return null;
        return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
      },
    },
  ],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1200 },
});
