import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildBaselineSnapshot,
  canonicalDigest,
  compareBaselineSnapshot,
} from '../scripts/lib/baseline-snapshot.js';
import {
  loadBaselineSourceEvidence,
  parseVerifyObservations,
} from '../scripts/lib/baseline-evidence.js';
import {
  assertOutputOutsideSource,
  buildToolIdentity,
} from '../scripts/lib/baseline-freeze.js';

const root = join(import.meta.dirname, '..');
const sourceFence = {
  headSha: '73835162207a790831a831fb962fee29270ec3e1',
  treeSha: '4'.repeat(40),
  package: {
    name: '@labpics/icons',
    version: '0.3.0',
    packageJsonSha256: 'a'.repeat(64),
    pnpmLockSha256: 'b'.repeat(64),
    releaseContractSha256: 'c'.repeat(64),
  },
};
const toolIdentity = {
  schema: 'labpics.icons-baseline-tool/2',
  entrySha256: 'd'.repeat(64),
  cliAdapterSha256: '6'.repeat(64),
  snapshotLibrarySha256: 'e'.repeat(64),
  evidenceAdapterSha256: '7'.repeat(64),
  freezeAdapterSha256: '3'.repeat(64),
  corpusContractSha256: '1'.repeat(64),
  packageJsonSha256: '2'.repeat(64),
};
const verifyReceipt = {
  schema: 'labpics.icons-baseline-verify/2',
  status: 'passed',
  sourceFenceDigest: canonicalDigest(sourceFence),
  toolchain: { node: 'v24.15.0', pnpm: '11.13.1' },
  observations: {
    testFilesPassed: 78,
    testsPassed: 901,
    packageArtifactWitness: true,
    outputSha256: 'f'.repeat(64),
  },
};

const tempRoots = [];
afterEach(() => {
  for (const path of tempRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixtureRoot() {
  const target = mkdtempSync(join(tmpdir(), 'lab-icons-baseline-'));
  tempRoots.push(target);
  for (const path of ['semantics', 'svg']) cpSync(join(root, path), join(target, path), { recursive: true });
  return target;
}

function toolFixtureRoot() {
  const target = mkdtempSync(join(tmpdir(), 'lab-icons-baseline-tool-'));
  tempRoots.push(target);
  mkdirSync(join(target, 'scripts', 'lib'), { recursive: true });
  for (const path of [
    'scripts/freeze-baseline.mjs',
    'scripts/lib/baseline-cli.js',
    'scripts/lib/baseline-evidence.js',
    'scripts/lib/baseline-snapshot.js',
    'scripts/lib/baseline-freeze.js',
    'scripts/lib/corpus-contract.js',
    'package.json',
  ]) {
    cpSync(join(root, path), join(target, path));
  }
  return target;
}

function snapshot(sourceRoot = root, overrides = {}) {
  return buildBaselineSnapshot({
    sourceEvidence: loadBaselineSourceEvidence(sourceRoot),
    sourceFence,
    toolIdentity,
    verifyReceipt,
    ...overrides,
  });
}

describe('BASELINE-08: публичный снимок полного корпуса', () => {
  it('замыкает exact 238×2 corpus и честно классифицирует текущее model/axis debt', () => {
    const result = snapshot();

    expect(result.schema).toBe('labpics.icons-baseline-snapshot/1');
    expect(result.corpus).toEqual({ families: 238, variants: 476 });
    expect(result.modelStates).toEqual({ accepted: 53, candidate: 91, sourceOnly: 332 });
    expect(result.debt).toEqual({ quarantinedVariants: 10, disabledAxisEntries: 66 });
    expect(result.variants).toHaveLength(476);
    expect(new Set(result.variants.map((row) => `${row.familyId}/${row.variant}`)).size).toBe(476);
    expect(result.variants.every((row) => /^[a-f0-9]{64}$/.test(row.sourceFileSha256))).toBe(true);
    expect(result.variants.every((row) => ['accepted', 'candidate', 'source-only'].includes(row.modelState))).toBe(true);
    expect(result.receiptDigest).toBe(canonicalDigest({ ...result, receiptDigest: undefined }));
  });

  it('не выдаёт receipt для неполного corpus', () => {
    const fixture = fixtureRoot();
    const path = join(fixture, 'semantics', 'catalog.json');
    const catalog = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF+/, ''));
    delete catalog.icons[Object.keys(catalog.icons)[0]];
    writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);

    expect(() => snapshot(fixture)).toThrow(/238 families/);
  });

  it('не выдаёт receipt без полного source/artifact fingerprint evidence', () => {
    const sourceEvidence = loadBaselineSourceEvidence(root);
    const family = sourceEvidence.catalog.icons[Object.keys(sourceEvidence.catalog.icons)[0]];
    delete family.source.outline.parts[0].sourceFingerprint;

    expect(() => buildBaselineSnapshot({
      sourceEvidence,
      sourceFence,
      toolIdentity,
      verifyReceipt,
    })).toThrow(/invalid source part evidence/);
  });

  it('отвергает debt keys с лишними сегментами для каждого registry', () => {
    const catalog = JSON.parse(readFileSync(join(root, 'semantics', 'catalog.json'), 'utf8').replace(/^\uFEFF+/, ''));
    const key = `${Object.keys(catalog.icons)[0]}/outline`;
    const cases = [
      ['candidate-variants.json', (value) => value.variants.push(`${key}/extra`), /malformed candidate key/],
      ['model-quality.json', (value) => { value.quarantined[`${key}/extra`] = {}; }, /malformed quarantine key/],
      ['axis-quality.json', (value) => { value.disabled[`${key}/weight/extra`] = {}; }, /malformed axis debt key/],
    ];

    for (const [file, mutate, error] of cases) {
      const fixture = fixtureRoot();
      const path = join(fixture, 'semantics', file);
      const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF+/, ''));
      mutate(value);
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
      expect(() => snapshot(fixture)).toThrow(error);
    }
  });

  it('source и tool mutation инвалидируют immutable receipt', () => {
    const fixture = fixtureRoot();
    const frozen = snapshot(fixture);
    const sourcePath = join(fixture, frozen.variants[0].sourceFile);
    writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n<!-- deliberate mutation -->\n`);

    expect(() => compareBaselineSnapshot({
      expected: frozen,
      sourceEvidence: loadBaselineSourceEvidence(fixture),
      sourceFence,
      toolIdentity,
      verifyReceipt,
    })).toThrow(/snapshot drift/);

    const toolFixture = fixtureRoot();
    const toolFrozen = snapshot(toolFixture);
    expect(() => compareBaselineSnapshot({
      expected: toolFrozen,
      sourceEvidence: loadBaselineSourceEvidence(toolFixture),
      sourceFence,
      toolIdentity: { ...toolIdentity, snapshotLibrarySha256: '0'.repeat(64) },
      verifyReceipt,
    })).toThrow(/snapshot drift/);
  });

  it('tool identity привязан ко всем исполняемым и конфигурационным входам freeze', () => {
    const fixture = toolFixtureRoot();
    const mutations = [
      ['scripts/freeze-baseline.mjs', 'entrySha256'],
      ['scripts/lib/baseline-cli.js', 'cliAdapterSha256'],
      ['scripts/lib/baseline-snapshot.js', 'snapshotLibrarySha256'],
      ['scripts/lib/baseline-evidence.js', 'evidenceAdapterSha256'],
      ['scripts/lib/baseline-freeze.js', 'freezeAdapterSha256'],
      ['scripts/lib/corpus-contract.js', 'corpusContractSha256'],
      ['package.json', 'packageJsonSha256'],
    ];
    let previous = buildToolIdentity(fixture);

    for (const [relativePath, digestField] of mutations) {
      const path = join(fixture, relativePath);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// deliberate identity mutation\n`);
      const next = buildToolIdentity(fixture);

      expect(next[digestField]).not.toBe(previous[digestField]);
      for (const [, otherField] of mutations) {
        if (otherField !== digestField) expect(next[otherField]).toBe(previous[otherField]);
      }
      previous = next;
    }
  });

  it('verify receipt принимает только реально наблюдавшиеся witnesses', () => {
    const observations = parseVerifyObservations([
      'check-package-artifact: OK',
      ' Test Files  80 passed (80)',
      '      Tests  917 passed (917)',
    ].join('\n'));
    expect(observations).toMatchObject({
      testFilesPassed: 80,
      testsPassed: 917,
      packageArtifactWitness: true,
    });
    expect(() => parseVerifyObservations('all checks passed')).toThrow(/direct required witnesses/);
    expect(() => parseVerifyObservations('Test Files 80 passed\nTests 917 passed')).toThrow(/direct required witnesses/);
  });

  it('output fence отвергает receipt внутри frozen source и разрешает соседний путь', () => {
    expect(() => assertOutputOutsideSource({
      sourceRoot: root,
      output: join(root, 'evidence', 'baseline.json'),
    })).toThrow(/outside the frozen source/);
    expect(() => assertOutputOutsideSource({
      sourceRoot: root,
      output: join(root, '..', 'baseline.json'),
    })).not.toThrow();
  });

  it('output fence разрешает symlink/junction только если его realpath остаётся вне source', () => {
    const outside = mkdtempSync(join(tmpdir(), 'lab-icons-baseline-output-'));
    tempRoots.push(outside);
    const sourceLink = join(outside, 'source-link');
    symlinkSync(root, sourceLink, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => assertOutputOutsideSource({
      sourceRoot: root,
      output: join(sourceLink, 'evidence', 'baseline.json'),
    })).toThrow(/outside the frozen source/);
    expect(() => assertOutputOutsideSource({
      sourceRoot: root,
      output: join(outside, 'evidence', 'baseline.json'),
    })).not.toThrow();
  });
});
