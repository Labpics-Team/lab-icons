import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/ir/index.ts'],
    outDir: 'dist/ir',
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: false,
    treeshake: true,
    // Self-reference сохраняет один corpus в tarball: ./ir берёт точные SVG
    // из root entry и не дублирует 444 строки внутри своего bundle.
    external: ['@labpics/icons'],
  },
  {
    entry: ['src/ir/recipes.ts'],
    outDir: 'dist/ir',
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: false,
    treeshake: true,
  },
]);
