import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSymbolSource } from '../scripts/lib/symbol-source.js';
import { compileOpticalCorpus, opticalReviewDigest } from '../scripts/lib/optical-corpus.js';
import { pathBBox } from '../src/core/path-data.js';
import { opticalPathData, opticalPosition, sampleOpticalPath } from '../src/render/optical-grid.ts';
import { runProcessTree } from './helpers/run-process-tree.js';

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
  const file = source.symbols[ids[0]].opticalMaster;
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

it('binds visual acceptance to the compiled geometry, including shared profiles', () => {
  const { root, source, recipe, file } = fixture();
  recipe.review = 'accepted';
  recipe.reviewedSha256 = opticalReviewDigest(compileOpticalCorpus(root, { preview: true }).symbols['plus-circle'].data);
  write(root, file, JSON.stringify(recipe));
  expect(() => compileOpticalCorpus(root)).not.toThrow();
  source.opticalProfiles['positive-mark'].weightScale[2] += 0.05;
  write(root, 'symbols/source.json', JSON.stringify(source));
  expect(() => compileOpticalCorpus(root)).toThrow('geometry changed since visual review');
});

it('retains authored support corrections during regeneration and refuses stale bindings before any write', async () => {
  const { root, recipe, file } = fixture(['console']);
  const original = compileOpticalCorpus(root, { preview: true }).symbols.console.data;
  const corrections = [{ weight: 600, opsz: 16, paths: [{ pathIndex: 0, delta: [2, 0.01] }] }];
  recipe.variants.filled.corrections = corrections;
  write(root, file, JSON.stringify(recipe));
  const run = () => runProcessTree(process.execPath, [join(repository, 'scripts/draft-optical-corpus.mjs'), '--root', root, '--regenerate'], {
    cwd: repository, signal: AbortSignal.timeout(30_000),
  });
  const regenerated = await run();
  expect(regenerated.error, regenerated.stderr).toBeUndefined();
  expect(regenerated.status, regenerated.stderr).toBe(0);
  const updated = JSON.parse(readFileSync(join(root, file), 'utf8'));
  expect(updated.variants.filled.corrections).toEqual(corrections);
  const compiled = compileOpticalCorpus(root, { preview: true }).symbols.console.data;
  const position = opticalPosition(compiled.axes, 600, 16);
  const before = sampleOpticalPath(original.variants.filled.paths[0], position);
  const after = sampleOpticalPath(compiled.variants.filled.paths[0], position);
  expect(after[2] - before[2]).toBeCloseTo(0.01, 12);
  expect(compiled.variants.filled.paths[0].coordinates).toEqual(original.variants.filled.paths[0].coordinates);

  updated.variants.filled.masterSha256 = '0'.repeat(64);
  const stale = JSON.stringify(updated);
  write(root, file, stale);
  const sourceBefore = readFileSync(join(root, 'symbols/source.json'), 'utf8');
  const refused = await run();
  expect(refused.error).toBeUndefined();
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain('migrate the coordinate bindings first');
  expect(readFileSync(join(root, file), 'utf8')).toBe(stale);
  expect(readFileSync(join(root, 'symbols/source.json'), 'utf8')).toBe(sourceBefore);
}, 40_000);
