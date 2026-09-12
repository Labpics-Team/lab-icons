import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANDATORY_TRAIN,
  RETROSPECTIVE_HOLDOUT_SIZE,
  buildHoldoutLeakSignals,
  buildRetrospectivePartition,
  buildSealedCorpusManifest,
  buildTrainManifestProjection,
  scanHoldoutLeakage,
  structuralRows,
} from '../scripts/lib/baseline-freeze.js';
import {
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
} from '../scripts/lib/corpus-contract.js';

const root = join(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(join(root, 'semantics/catalog.json'), 'utf8'));
const axisQuality = JSON.parse(readFileSync(join(root, 'semantics/axis-quality.json'), 'utf8'));
const sourceFence = Object.freeze({
  headSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
  package: {
    name: '@labpics/icons',
    version: '0.3.0',
    contractSha256: 'c'.repeat(64),
  },
});

function baseline() {
  const partition = buildRetrospectivePartition({ catalog, sourceFence });
  const sealed = buildSealedCorpusManifest({ catalog, axisQuality, sourceFence, partition });
  const projection = buildTrainManifestProjection(sealed);
  return { partition, sealed, projection };
}

describe('BASELINE-08 freeze boundary', () => {
  it('замыкает 238 семейств в детерминированные 32 holdout + 206 train без mission-примеров в holdout', () => {
    const first = buildRetrospectivePartition({ catalog, sourceFence });
    const second = buildRetrospectivePartition({ catalog, sourceFence });
    expect(second).toEqual(first);
    expect(first.holdout).toHaveLength(RETROSPECTIVE_HOLDOUT_SIZE);
    expect(first.train).toHaveLength(EXPECTED_ICON_NAMES - RETROSPECTIVE_HOLDOUT_SIZE);
    expect(new Set([...first.holdout, ...first.train]).size).toBe(EXPECTED_ICON_NAMES);
    expect(first.holdout.filter((name) => first.train.includes(name))).toEqual([]);
    for (const name of DEFAULT_MANDATORY_TRAIN) expect(first.train).toContain(name);
    expect(Object.values(first.quotas).reduce((sum, quota) => sum + quota, 0))
      .toBe(RETROSPECTIVE_HOLDOUT_SIZE);
    expect(Object.values(first.quotas).every((quota) => quota > 0)).toBe(true);
  });

  it('строит structural strata из source topology, а не из ручного списка имён', () => {
    const rows = structuralRows(catalog);
    expect(rows).toHaveLength(EXPECTED_ICON_NAMES);
    expect(new Set(rows.map((row) => row.structuralStratum)).size).toBeGreaterThanOrEqual(8);
    expect(rows.every((row) => /^(single|pair|multi)-q[1-4]$/.test(row.structuralStratum))).toBe(true);
    expect(rows.every((row) => row.commandCount > 0 && row.maxContours > 0 && row.maxSourceParts > 0)).toBe(true);
  });

  it('sealed manifest классифицирует все 476 source variants и train projection не несёт holdout membership', () => {
    const { partition, sealed, projection } = baseline();
    expect(sealed.families).toHaveLength(EXPECTED_ICON_NAMES);
    expect(sealed.families.flatMap((family) => Object.values(family.variants)))
      .toHaveLength(EXPECTED_SOURCE_VARIANTS);
    expect(sealed.families.every((family) => ['train', 'holdout'].includes(family.allocation))).toBe(true);
    expect(projection.families).toHaveLength(EXPECTED_ICON_NAMES - RETROSPECTIVE_HOLDOUT_SIZE);
    expect(projection.families.map((family) => family.id).sort()).toEqual(partition.train);
    expect(projection).not.toHaveProperty('holdout');
    expect(projection.families.every((family) => !Object.hasOwn(family, 'allocation'))).toBe(true);
    expect(projection.families.every((family) => !Object.hasOwn(family, 'referenceDigest'))).toBe(true);
  });

  it('hostile controls ловят полный catalog, filename и raw holdout geometry, а чистая train projection проходит', () => {
    const { partition, sealed, projection } = baseline();
    const signals = buildHoldoutLeakSignals({ root, catalog, partition });
    const holdoutName = partition.holdout[0];
    const holdoutFile = catalog.icons[holdoutName].source.outline.file;
    // Реальный corpus содержит законно общую геометрию между train/holdout.
    // Это regression против наивного scanner-а, который делал DRY overlap утечкой.
    expect(signals.sharedWithTrain.fingerprints.length).toBeGreaterThan(0);
    const cleanFindings = scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'train-manifest.json', content: JSON.stringify(projection) }],
    });
    expect(cleanFindings).toEqual([]);

    const fullCatalogFindings = scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'semantics/catalog.json', content: JSON.stringify(catalog) }],
    });
    expect(fullCatalogFindings.some((finding) => finding.kind === 'holdout-name')).toBe(true);
    expect(fullCatalogFindings.some((finding) => finding.kind === 'holdout-fingerprint')).toBe(true);

    const promptFindings = scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'prompt', content: `reference file: ${holdoutFile}` }],
    });
    expect(promptFindings.some((finding) => finding.kind === 'holdout-filename')).toBe(true);

    const svgFindings = scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'reference.svg', content: readFileSync(join(root, holdoutFile)) }],
    });
    expect(svgFindings.some((finding) =>
      finding.kind === 'holdout-source-bytes' || finding.kind === 'holdout-geometry')).toBe(true);

    // Сам sealed verifier artifact ожидаемо является leak-positive и поэтому не
    // может быть смонтирован в train lineage.
    const sealedFindings = scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'sealed-manifest.json', content: JSON.stringify(sealed) }],
    });
    expect(sealedFindings.length).toBeGreaterThan(0);
  });

  it('различает semantic icon identity и обычное слово, но ловит generated export ID', () => {
    const signals = {
      identifying: {
        names: ['component'],
        filenames: [],
        exportIds: ['componentFilled', 'componentOutline'],
        fingerprints: [],
        sourceFileDigests: [],
        rawPaths: [],
        geometryDigests: [],
      },
      sharedWithTrain: {},
    };

    expect(scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'generic-contract-prose', content: 'phase-stable component/counter topology' }],
    })).toEqual([]);

    expect(scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'target-brief', content: 'target icon: component' }],
    }).some((finding) => finding.kind === 'holdout-name')).toBe(true);

    expect(scanHoldoutLeakage({
      signals,
      artifacts: [{ id: 'generated-types', content: 'export declare const componentFilled: string;' }],
    }).some((finding) => finding.kind === 'holdout-export-id')).toBe(true);
  });

  it('смена source fence меняет allocation identity и не переносит старую partition молча', () => {
    const first = buildRetrospectivePartition({ catalog, sourceFence });
    const driftedFence = { ...sourceFence, treeSha: 'd'.repeat(40) };
    const second = buildRetrospectivePartition({ catalog, sourceFence: driftedFence });
    expect(second.sourceFenceDigest).not.toBe(first.sourceFenceDigest);
    // Fence связывает evidence с exact source, но не является управляемым seed:
    // нерелевантный metadata drift не имеет права перетасовать blind allocation.
    expect(second.holdout).toEqual(first.holdout);
    expect(second.train).toEqual(first.train);

    const renamedCatalog = structuredClone(catalog);
    for (const icon of Object.values(renamedCatalog.icons)) {
      for (const source of Object.values(icon.source)) {
        source.file = `renamed/${source.file.split('/').at(-1)}`;
      }
    }
    const renamed = buildRetrospectivePartition({ catalog: renamedCatalog, sourceFence });
    expect(renamed.holdout).toEqual(first.holdout);
    expect(renamed.train).toEqual(first.train);

    const coordinateDriftCatalog = structuredClone(catalog);
    let fingerprintCounter = 0;
    for (const icon of Object.values(coordinateDriftCatalog.icons)) {
      for (const source of Object.values(icon.source)) {
        for (const part of source.parts) {
          fingerprintCounter += 1;
          const synthetic = fingerprintCounter.toString(16).padStart(64, '0');
          part.sourceFingerprint = `sha256:${synthetic}`;
          part.artifactFingerprint = `sha256:${synthetic}`;
        }
      }
    }
    const coordinateDrift = buildRetrospectivePartition({
      catalog: coordinateDriftCatalog,
      sourceFence,
    });
    expect(coordinateDrift.holdout).toEqual(first.holdout);
    expect(coordinateDrift.train).toEqual(first.train);

    expect(() => buildSealedCorpusManifest({
      catalog,
      axisQuality,
      sourceFence: driftedFence,
      partition: first,
    })).toThrow(/другому source fence/);
  });
});
