import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSymbolSource } from '../scripts/lib/symbol-source.js';
import { compileOpticalCorpus } from '../scripts/lib/optical-corpus.js';
import { pathBBox } from '../src/core/path-data.js';
import { opticalPathData, opticalPosition, sampleOpticalPath } from '../src/render/optical-grid.ts';

const repository = fileURLToPath(new URL('..', import.meta.url));
const temporary = [];
const write = (root, file, bytes) => {
  const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
};
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
function fixture(ids = ['plus-circle']) {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-optics-')); temporary.push(root);
  const source = loadSymbolSource(repository);
  source.symbols = Object.fromEntries(ids.map(id => [id, source.symbols[id]]));
  for (const symbol of Object.values(source.symbols)) {
    delete symbol.compatibilityStatic;
    for (const variant of Object.values(symbol.variants)) {
      write(root, variant.provenance.master, readFileSync(join(repository, variant.provenance.master)));
    }
    write(root, symbol.opticalMaster, readFileSync(join(repository, symbol.opticalMaster)));
  }
  const file = source.symbols['plus-circle'].opticalMaster;
  const recipe = JSON.parse(readFileSync(join(repository, file), 'utf8'));
  write(root, file, JSON.stringify(recipe)); write(root, 'symbols/source.json', JSON.stringify(source));
  return { root, source, recipe, file };
}

it('projects real source-bound recipes and shared circle optics into both variants', () => {
  const { root } = fixture();
  const { symbols, axes } = compileOpticalCorpus(root, { preview: true });
  expect(axes).toEqual({ weight: [300, 400, 600], opsz: [16, 24, 48] });
  expect(Object.keys(symbols)).toEqual(['plus-circle']);
  const variants = symbols['plus-circle'].data.variants;
  expect(variants.outline.paths).toHaveLength(2);
  expect(variants.filled.paths).toHaveLength(1);
  expect(variants.outline.paths[1].terms.length).toBeGreaterThan(0);
  expect(variants.filled.paths[0].fillRule).toBe('evenodd');
});

it('shares the complete circle grid and changes the minus stroke independently of its length', () => {
  const { root, source: document } = fixture(['plus-circle', 'minus-circle']);
  const { symbols, axes } = compileOpticalCorpus(root, { preview: true });
  const plus = symbols['plus-circle'].data.variants.outline.paths;
  const minus = symbols['minus-circle'].data.variants.outline.paths;
  expect(minus[1]).toEqual(plus[1]);
  const source = pathBBox(opticalPathData(minus[0], minus[0].coordinates));
  const heavy = pathBBox(opticalPathData(minus[0], sampleOpticalPath(minus[0], opticalPosition(axes, 600, 16))));
  const profile = document.opticalProfiles['positive-mark'];
  const thickness = profile.weightScale[2] * profile.opszScale[0];
  expect(heavy.maxY - heavy.minY).toBeCloseTo((source.maxY - source.minY) * thickness, 10);
  expect((heavy.maxX - heavy.minX) / (source.maxX - source.minX)).toBeLessThan(thickness);
});

it('refuses shipping missing or unreviewed masters and stale source-coordinate bindings', () => {
  const { root, source, recipe, file } = fixture();
  expect(() => compileOpticalCorpus(root)).toThrow('still need visual review');
  recipe.variants.outline.masterSha256 = '0'.repeat(64);
  write(root, file, JSON.stringify(recipe));
  expect(() => compileOpticalCorpus(root, { preview: true })).toThrow('source changed');
  delete source.symbols['plus-circle'].opticalMaster;
  write(root, 'symbols/source.json', JSON.stringify(source));
  expect(() => compileOpticalCorpus(root)).toThrow('no authored masters');
});
