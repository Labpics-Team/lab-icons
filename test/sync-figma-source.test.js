import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { authorPathFingerprint, loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { loadSymbolSource, projectAuthorBaseline } from '../scripts/lib/symbol-source.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { syncFigmaSource } from '../scripts/lib/sync-figma-source.js';
const repository = fileURLToPath(new URL('..', import.meta.url));
const temporary = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
afterEach(() => { for (const path of temporary.splice(0)) {
  if (dirname(path) !== tmpdir() || !path.includes('lab-icons-sync-')) throw new Error('unexpected cleanup path');
  rmSync(path, { recursive: true, force: true });
} });
function fixture({ sameVersion = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-sync-')); temporary.push(root);
  const captureRoot = join(root, 'capture');
  const source = loadSymbolSource(repository);
  source.symbols = { accessibility: source.symbols.accessibility };
  delete source.symbols.accessibility.compatibilityStatic;
  source.components = {}; source.compatibility.stateGroups.groups = {};
  source.symbols.accessibility.variants.outline.anatomy.classification = 'semantic';
  source.symbols.accessibility.variants.outline.anatomy.parts[0].id = 'authored-body';
  write(root, 'symbols/source.json', JSON.stringify(source));
  const manifest = projectAuthorBaseline(source);
  manifest.source.version = sameVersion ? source.capture.source.version : '2416636003859748576';
  for (const variant of ['outline', 'filled']) {
    const old = source.symbols.accessibility.variants[variant].provenance;
    const bytes = readFileSync(join(repository, old.master));
    write(root, old.master, bytes);
    const receipt = manifest.icons.accessibility[variant];
    receipt.master = `masters/figma/${manifest.source.version}/${old.style}/accessibility.svg`;
    const svg = variant === 'outline' ? bytes.toString().replace(/\bd="M(-?[\d.]+)/, (_, number) => `d="M${Number(number) + 0.01}`) : bytes.toString();
    const normalized = normalizeFigmaSvg(svg);
    receipt.sha256 = sha(svg); receipt.bytes = Buffer.byteLength(svg);
    receipt.normalizedSource = { ...receipt.normalizedSource, sha256: sha(normalized), pathFingerprintSha256: authorPathFingerprint(normalized) };
    write(captureRoot, receipt.master, svg);
  }
  return { root, captureRoot, source, manifest };
}
it('writes only a changed master, preserves old capture references and drops stale semantic parts', () => {
  const input = fixture();
  const result = syncFigmaSource({ ...input, write: true });
  expect(result.changed.map(({ id, variant }) => `${id}/${variant}`)).toEqual(['accessibility/outline']);
  expect(result.unchanged).toBe(1);
  const next = loadSymbolSource(input.root);
  expect(next.symbols.accessibility.variants.outline.anatomy.classification).toBe('unclassified');
  expect(next.symbols.accessibility.variants.outline.anatomy.parts[0].id).not.toBe('authored-body');
  expect(next.symbols.accessibility.variants.filled.provenance.master).toBe(input.source.symbols.accessibility.variants.filled.provenance.master);
  expect(existsSync(join(input.root, input.manifest.icons.accessibility.filled.master))).toBe(false);
  expect(loadAuthorBaseline(input.root).icons.accessibility.outline.author.version).toBe(input.manifest.source.version);
  expect(loadAuthorBaseline(input.root).icons.accessibility.filled.author.version).toBe(input.source.capture.source.version);
});
it('refuses to replace an immutable master before changing the active source', () => {
  const input = fixture({ sameVersion: true });
  const original = readFileSync(join(input.root, 'symbols/source.json'), 'utf8');
  expect(() => syncFigmaSource({ ...input, write: true })).toThrow('immutable master would be overwritten');
  expect(readFileSync(join(input.root, 'symbols/source.json'), 'utf8')).toBe(original);
});
