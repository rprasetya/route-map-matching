import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
});
