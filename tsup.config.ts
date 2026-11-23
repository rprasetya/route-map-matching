import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'tiles/index': 'src/tiles/index.ts', 'traffic-side': 'src/traffic-side.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: 'es2020',
  splitting: true,
  sourcemap: true,
  loader: { '.txt': 'text' },
});
