import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadSymbolSource, projectAuthorBaseline, verifySymbolComponents, writeSymbolSourceProjections } from '../scripts/lib/symbol-source.js';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { syncFigmaSource } from '../scripts/lib/sync-figma-source.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('SymbolSource corpus', () => {
  it('keeps exact provenance pairs and derives compatibility projections from one source', () => {
    const source = loadSymbolSource(root);
    expect(Object.keys(source.symbols)).toHaveLength(330);
    expect(writeSymbolSourceProjections(root, { check: true })).toEqual({ families: 330, components: 1, references: 4 });
    for (const symbol of Object.values(source.symbols)) {
      expect(symbol.variants.outline.provenance.style).toBe('Outline');
      expect(symbol.variants.filled.provenance.style).toBe('Filled');
    }
  });

  it('shares the exact circle contour while retaining the microphone and counter shapes', () => {
    const source = loadSymbolSource(root);
    expect(verifySymbolComponents(source, root).references).toBe(4);
    for (const id of ['plus-circle', 'minus-circle', 'checkmark-circle', 'mic-circle']) {
      const shape = source.symbols[id];
      expect(shape.variants.outline.anatomy.parts.filter(part => part.component === 'circle-outline')).toHaveLength(1);
      expect(shape.variants.filled.anatomy.parts.some(part => part.role === 'counter')).toBe(true);
    }
    source.components['circle-outline'].geometry.pathIndex = 0;
    expect(() => verifySymbolComponents(source, root)).toThrow('no longer matches');
  });

  it('same-capture sync checks all 660 masters without touching them', () => {
    const source = loadSymbolSource(root), manifest = projectAuthorBaseline(source);
    const path = join(root, manifest.icons['mic-circle'].outline.master);
    const before = statSync(path).mtimeMs;
    const result = syncFigmaSource({ root, captureRoot: root, manifest });
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toBe(660);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it('all 660 root strings match current author masters and the per-family module', async () => {
    const baseline = loadAuthorBaseline(root);
    const exports = await import(pathToFileURL(join(root, 'dist/index.js')).href);
    expect(Object.keys(exports)).toHaveLength(660);
    for (const [id, variants] of Object.entries(baseline.icons)) {
      const family = await import(pathToFileURL(join(root, `dist/symbols/${id}.js`)).href);
      expect(family.default.id).toBe(id);
      for (const variant of ['outline', 'filled']) {
        expect(exports[symbolExportName(id, variant)], `${id}/${variant}`).toBe(variants[variant].artifactSvg);
        expect(family[variant], `${id}/${variant}`).toBe(variants[variant].artifactSvg);
      }
    }
  }, 10000);

  it('a static leaf consumer contains just its SVG literal, no runtime or other symbols', async () => {
    const bundle = await build({ absWorkingDir: root, stdin: { contents: 'export { outline } from "@labpics/icons/symbols/plus-circle";', resolveDir: root },
      bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, metafile: true });
    const output = bundle.outputFiles[0].text;
    const source = await import(pathToFileURL(join(root, 'dist/symbols/plus-circle.js')).href);
    expect(output.length).toBeLessThan(source.outline.length + 150);
    expect(output).not.toMatch(/createCompiled|compiler|requestAnimationFrame|ResizeObserver|catalog|masterSha256/);
    const contributing = Object.entries(Object.values(bundle.metafile.outputs)[0].inputs).filter(([, value]) => value.bytesInOutput > 0);
    expect(contributing.every(([path]) => /plus-circle\.js$/.test(path))).toBe(true);
  });
});
