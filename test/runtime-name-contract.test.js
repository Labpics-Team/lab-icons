import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build-ir.mjs';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { createCompiledCapsuleGlyph } from '../src/ir/author-capsule-runtime.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function productionRuntime(entry, external) {
  const directory = mkdtempSync(join(tmpdir(), 'lab-icons-runtime-names-'));
  try {
    await bundle(root, directory, entry, 'runtime.js', external);
    const emitted = readFileSync(join(directory, 'runtime.js'), 'utf8');
    // Повторная minify моделирует сборку потребителя поверх production output.
    const result = await build({ stdin: { contents: emitted, resolveDir: dirname(join(root, entry)) },
      bundle: true, minify: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
    return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('production minification preserves named public runtime contracts', () => {
  it('retains public Motion export names', async () => {
    const runtime = await productionRuntime('src/motion/index.ts', ['../ir/contour-runtime.js']);
    const names = ['compileSymbolEffect', 'prepareContourStateEffect'];
    expect(Object.keys(runtime).sort()).toEqual(names.sort());
    for (const name of names) expect(runtime[name].name).toBe(name);
  });

  it('retains the returned capsule glyph contract after consumer minification', async () => {
    const runtime = await productionRuntime('src/ir/author-capsule-runtime.ts',
      ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js']);
    const { mic: authored } = await authoredSymbolPayloads(['mic']);
    const mic = structuredClone(authored);
    Object.freeze(mic.source);
    const glyph = runtime.createCompiledCapsuleGlyph('mic', mic.source, mic.variation);
    const sourceGlyph = createCompiledCapsuleGlyph('mic', mic.source, mic.variation);
    // Физические factory/class exports закрыты package exports. Имена их свойств
    // нужны линковке; контракт Function.name принадлежит возвращённому glyph.
    expect(Object.keys(runtime).sort()).toEqual(['AuthoredCapsuleVariationError', 'createCompiledCapsuleGlyph']);
    expect(Object.getOwnPropertyDescriptor(glyph, 'name')).toEqual({
      value: 'glyph', writable: false, enumerable: false, configurable: true,
    });
    expect(glyph.length).toBe(1);
    expect(Object.hasOwn(glyph, 'prototype')).toBe(true);
    expect(glyph.prototype.constructor).toBe(glyph);
    expect(Reflect.construct(glyph, [])).toBe(mic.source.outline);
    expect(glyph.call(null)).toBe(mic.source.outline);
    expect(glyph.apply(null, [])).toBe(mic.source.outline);
    expect(glyph()).toBe(mic.source.outline);
    expect(Object.isFrozen(mic.source.outline.parts[0].paint)).toBe(true);
    expect(glyph({ variant: 'filled', variation: { bodyWidth: 1 } })).toBe(mic.source.filled);
    for (const variant of ['outline', 'filled']) for (const bodyWidth of [.8, .9, 1]) {
      expect(glyph({ variant, variation: { bodyWidth } })).toEqual(sourceGlyph({ variant, variation: { bodyWidth } }));
    }
    expect(() => glyph({ axes: { weight: 1.1 } })).toThrowError(expect.objectContaining({ name: 'GlyphModelError', code: 'AUTHOR_PARITY_REQUIRED' }));
    expect(() => glyph({ variation: { bodyWidth: .7 } })).toThrowError(expect.objectContaining({ name: 'AuthoredCapsuleVariationError', code: 'VARIATION_OUTSIDE_DOMAIN' }));
  });
});
