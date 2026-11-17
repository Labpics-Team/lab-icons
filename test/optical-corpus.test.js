import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSymbolSource } from '../scripts/lib/symbol-source.js';
import { compileOpticalCorpus } from '../scripts/lib/optical-corpus.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const temporary = [];
const write = (root, file, bytes) => {
  const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
};
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-optics-')); temporary.push(root);
  const source = loadSymbolSource(repository);
  source.symbols = { 'plus-circle': source.symbols['plus-circle'] };
  delete source.symbols['plus-circle'].compatibilityStatic;
  for (const variant of Object.values(source.symbols['plus-circle'].variants)) {
    write(root, variant.provenance.master, readFileSync(join(repository, variant.provenance.master)));
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
