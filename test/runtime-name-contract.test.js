import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build-ir.mjs';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('production minification preserves named public runtime contracts', () => {
  it.each([
    ['src/motion/index.ts', ['../ir/contour-runtime.js'], ['compileSymbolEffect', 'prepareContourStateEffect']],
    ['src/ir/author-capsule-runtime.ts', ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js'],
      ['AuthoredCapsuleVariationError', 'createCompiledCapsuleGlyph']],
  ])('%s retains exported and returned function names', async (entry, external, expectedNames) => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-icons-runtime-names-'));
    try {
      await bundle(root, directory, entry, 'runtime.js', external);
      const emitted = readFileSync(join(directory, 'runtime.js'), 'utf8');
      // Диагностическая сборка разрешает реальные external sources; проверяется
      // уже выпущенная production форма, включая штатные keepNames annotations.
      const result = await build({ stdin: { contents: emitted, resolveDir: dirname(join(root, entry)) },
        bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
      const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
      expect(Object.keys(runtime).sort()).toEqual([...expectedNames].sort());
      for (const name of expectedNames) expect(runtime[name].name).toBe(name);
      if (runtime.createCompiledCapsuleGlyph) {
        const { mic } = await authoredSymbolPayloads(['mic']);
        const glyph = runtime.createCompiledCapsuleGlyph('mic', mic.source, mic.variation);
        expect(glyph.name).toBe('glyph');
        expect(glyph()).toBe(mic.source.outline);
        expect(glyph({ variant: 'filled', variation: { bodyWidth: 1 } })).toBe(mic.source.filled);
        expect(glyph({ variation: { bodyWidth: .9 } }).provenance.variation.parameters.bodyWidth).toBe(.9);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
