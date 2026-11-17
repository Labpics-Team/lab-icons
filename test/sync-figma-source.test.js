import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { runProcessTree } from './helpers/run-process-tree.js';
import { createCleanPackSource, pnpmInvocation } from '../scripts/check-package-artifact.js';
import { authorPathFingerprint, loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { loadSymbolSource, projectAuthorBaseline } from '../scripts/lib/symbol-source.js';
import { stateArtifactConsumerSource, statePackageExpectations } from '../scripts/lib/state-artifact-consumer.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { syncFigmaSource } from '../scripts/lib/sync-figma-source.js';
const repository = fileURLToPath(new URL('..', import.meta.url));
const temporary = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
afterEach(() => { for (const path of temporary.splice(0)) {
  if (dirname(path) !== tmpdir() || !path.includes('lab-icons-sync-')) throw new Error('unexpected cleanup path');
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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

it('an incoming receipt cannot overwrite the trusted Outline/Filled style', () => {
  const input = fixture();
  input.manifest.icons.accessibility.outline.style = 'Filled';
  syncFigmaSource({ ...input, write: true });
  expect(loadSymbolSource(input.root).symbols.accessibility.variants.outline.provenance.style).toBe('Outline');
  expect(() => loadAuthorBaseline(input.root)).not.toThrow();
});

it('does not silently reuse optical coordinate bindings after an author master changes', () => {
  const input = fixture();
  input.source.symbols.accessibility.opticalMaster = 'symbols/optics/accessibility.json';
  const original = JSON.stringify(input.source);
  write(input.root, 'symbols/source.json', original);
  expect(() => syncFigmaSource({ ...input, write: true })).toThrow('requires review of its optical masters');
  expect(readFileSync(join(input.root, 'symbols/source.json'), 'utf8')).toBe(original);
  expect(existsSync(join(input.root, input.manifest.icons.accessibility.outline.master))).toBe(false);
});

it('a new full snapshot preserves every unchanged master and builds all production state laws', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'lab-icons-sync-')); temporary.push(temporaryRoot);
  const root = createCleanPackSource(repository, join(temporaryRoot, 'repository'));
  const captureRoot = join(temporaryRoot, 'capture');
  const source = loadSymbolSource(root), manifest = projectAuthorBaseline(source);
  manifest.source.version = (BigInt(manifest.source.version) + 1n).toString();
  for (const [id, variants] of Object.entries(manifest.icons)) for (const [variant, receipt] of Object.entries(variants)) {
    const bytes = readFileSync(join(root, receipt.master));
    delete receipt.version;
    receipt.master = `masters/figma/${manifest.source.version}/${variant === 'outline' ? 'Outline' : 'Filled'}/${id}.svg`;
    write(captureRoot, receipt.master, bytes);
  }
  write(captureRoot, 'receipt.json', JSON.stringify(manifest));
  const run = async (file, args, timeout = 30_000) => {
    const result = await runProcessTree(file, args, { cwd: root, signal: AbortSignal.timeout(timeout) });
    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout;
  };
  const synced = JSON.parse(await run(process.execPath, ['scripts/sync-figma-source.mjs', '--capture', captureRoot,
    '--manifest', join(captureRoot, 'receipt.json'), '--write']));
  expect(synced).toMatchObject({ changed: [], unchanged: manifest.counts.variants });
  const next = loadAuthorBaseline(root);
  expect(next.source.version).toBe(manifest.source.version);
  expect(existsSync(join(root, 'masters/figma', manifest.source.version))).toBe(false);
  for (const [id, variants] of Object.entries(next.icons)) for (const [variant, receipt] of Object.entries(variants)) {
    const previous = source.symbols[id].variants[variant].provenance;
    expect(receipt.master).toBe(previous.master);
    expect(receipt.author.version).toBe(previous.version ?? source.capture.source.version);
    expect(receipt.author.masterSha256).toBe(previous.sha256);
  }
  const document = JSON.parse(readFileSync(join(root, 'semantics/author-state-groups.json'), 'utf8'));
  expect([...new Set(Object.values(document.groups).map(group => group.law))].sort())
    .toEqual(['dots.orient', 'enclosure.replace', 'source.replace']);
  const build = pnpmInvocation(['build']);
  // The real clean build competes with geometry suites on CI. This is a
  // liveness limit, not a performance assertion; one CLI call used to get 90s.
  await run(build.file, build.args, 240_000);
  // The consumer reads actual package exports and checks geometry, provenance and transitions for every group.
  const grid = JSON.parse(readFileSync(join(root, 'semantics/grid.json'), 'utf8'));
  write(root, 'state-expected.json', JSON.stringify(statePackageExpectations(next, document, grid)));
  write(root, 'state-consumer.mjs', "import { readFileSync } from 'node:fs';\n" + stateArtifactConsumerSource());
  await run(process.execPath, ['state-consumer.mjs']);
}, 330_000);
