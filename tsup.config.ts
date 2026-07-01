import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/animate/index.ts'],
  outDir: 'dist/animate',
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  // clean НЕЛЬЗЯ: dist/ делит место с выводом scripts/build.js (статические иконки)
  clean: false,
  minify: false,
  treeshake: true,
});
