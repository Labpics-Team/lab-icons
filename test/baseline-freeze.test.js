import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANDATORY_TRAIN,
  REQUIRED_DISCRETE_MISSION_FAMILIES,
  REQUIRED_MOVABLE_MISSION_FAMILIES,
  RETROSPECTIVE_HOLDOUT_SIZE,
  canonicalDigest,
  buildHoldoutLeakSignals,
  buildCorpusFreeAuthoringProjection,
  buildRetrospectivePartition,
  buildSealedCorpusManifest,
  buildTrainManifestProjection,
  scanHoldoutLeakage,
  structuralRows,
  validateMotionIntentCensus,
  validateMotionIntentEvidence,
  validateStaticConsumerBaseline,
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
const partitionSeed = '11'.repeat(32);
const alternatePartitionSeed = '22'.repeat(32);

function baseline() {
  const partition = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
  const sealed = buildSealedCorpusManifest({ catalog, axisQuality, sourceFence, partition });
  const projection = buildTrainManifestProjection(sealed);
  return { partition, sealed, projection };
}

function motionFixture() {
  const names = Object.keys(catalog.icons).sort();
  const evidence = [];
  const rows = names.map((familyId) => {
    const witness = {
      familyId,
      kind: 'static-by-design',
      witnessCode: 'semantic-static-review',
      rationale: `No intrinsic target-neutral continuous kinematics are asserted for ${familyId}; motion requires product-state context or would be decorative.`,
    };
    evidence.push(witness);
    return { ...witness, rationale: undefined, witnessDigest: canonicalDigest(witness) };
  }).map(({ rationale: _rationale, ...row }) => row);
  for (const familyId of REQUIRED_MOVABLE_MISSION_FAMILIES) {
    const index = rows.findIndex((row) => row.familyId === familyId);
    rows[index] = {
      familyId,
      kind: 'movable',
      parts: [{ partId: 'primary', affordance: 'semantic-motion', domain: 'target-neutral-parameter' }],
    };
    const evidenceIndex = evidence.findIndex((row) => row.familyId === familyId);
    evidence.splice(evidenceIndex, 1);
  }
  for (const familyId of REQUIRED_DISCRETE_MISSION_FAMILIES) {
    const index = rows.findIndex((row) => row.familyId === familyId);
    const witness = {
      familyId,
      kind: 'unsupported-discrete',
      witnessCode: 'semantic-discrete-state',
      rationale: `${familyId} changes semantic content between discrete states; baseline must preserve state identity without inventing a continuous interpolation.`,
    };
    rows[index] = { ...witness, rationale: undefined, witnessDigest: canonicalDigest(witness) };
    rows[index] = (({ rationale: _rationale, ...row }) => row)(rows[index]);
    const evidenceIndex = evidence.findIndex((row) => row.familyId === familyId);
    evidence[evidenceIndex] = witness;
  }
  return { rows, evidence };
}

function motionRows() { return motionFixture().rows; }

describe('BASELINE-08 freeze boundary', () => {
  it('не позволяет восстановить blind partition только из публичного corpus и алгоритма', () => {
    expect(() => buildRetrospectivePartition({ catalog, sourceFence }))
      .toThrow(/private partition seed/);

    const first = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
    const repeated = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
    const alternate = buildRetrospectivePartition({
      catalog,
      sourceFence,
      partitionSeed: alternatePartitionSeed,
    });
    expect(repeated).toEqual(first);
    expect(first.seedCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toHaveProperty('partitionSeed');
    expect(alternate.seedCommitment).not.toBe(first.seedCommitment);
    expect(alternate.holdout).not.toEqual(first.holdout);
  });

  it('замыкает 238 семейств в детерминированные 32 holdout + 206 train без mission-примеров в holdout', () => {
    const first = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
    const second = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
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
    const first = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
    const driftedFence = { ...sourceFence, treeSha: 'd'.repeat(40) };
    const second = buildRetrospectivePartition({ catalog, sourceFence: driftedFence, partitionSeed });
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
    const renamed = buildRetrospectivePartition({ catalog: renamedCatalog, sourceFence, partitionSeed });
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
      partitionSeed,
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

  it('corpus-free projection допускает только train registry + leak-clean contracts', () => {
    const { partition, sealed } = baseline();
    const signals = buildHoldoutLeakSignals({ root, catalog, partition });
    const motionCensus = validateMotionIntentCensus({ catalog, rows: motionRows() });
    const projection = buildCorpusFreeAuthoringProjection({
      sealedManifest: sealed,
      signals,
      motionCensus,
      contracts: [
        { id: 'contracts/design-spec.schema.json', content: '{"type":"object","title":"DesignSpec"}' },
        { id: 'contracts/negative-space.md', content: 'Counter and aperture are first-class constraints.' },
      ],
    });
    expect(projection.registry.families).toHaveLength(EXPECTED_ICON_NAMES - RETROSPECTIVE_HOLDOUT_SIZE);
    expect(projection.motion.rows).toHaveLength(EXPECTED_ICON_NAMES - RETROSPECTIVE_HOLDOUT_SIZE);
    expect(projection.motion.rows.map((row) => row.familyId).sort()).toEqual(partition.train);
    expect(projection.motion.rows.some((row) => partition.holdout.includes(row.familyId))).toBe(false);
    expect(projection.contracts).toHaveLength(2);
    expect(projection.projectionDigest).toMatch(/^[a-f0-9]{64}$/);

    expect(() => buildCorpusFreeAuthoringProjection({
      sealedManifest: sealed,
      signals,
      motionCensus,
      contracts: [{ id: 'semantics/catalog.json', content: '{}' }],
    })).toThrow(/запрещён/);

    const holdoutName = partition.holdout[0];
    expect(() => buildCorpusFreeAuthoringProjection({
      sealedManifest: sealed,
      signals,
      motionCensus,
      contracts: [{ id: 'contracts/briefs.json', content: JSON.stringify({ target: holdoutName }) }],
    })).toThrow(/projection leak/);

    expect(() => buildCorpusFreeAuthoringProjection({
      sealedManifest: sealed,
      signals,
      contracts: [],
    })).toThrow(/motionCensus/);
  });

  it('motion-intent census требует ровно 238 target-neutral semantic rows', () => {
    const rows = motionRows();
    const census = validateMotionIntentCensus({ catalog, rows });
    expect(census.familyCount).toBe(EXPECTED_ICON_NAMES);
    expect(census.rows).toHaveLength(EXPECTED_ICON_NAMES);
    expect(census.digest).toMatch(/^[a-f0-9]{64}$/);

    const missing = rows.slice(1);
    expect(() => validateMotionIntentCensus({ catalog, rows: missing }))
      .toThrow(/exact family universe/);

    const targetBound = structuredClone(rows);
    const targetBoundIndex = targetBound.findIndex((row) => !REQUIRED_MOVABLE_MISSION_FAMILIES.includes(row.familyId));
    targetBound[targetBoundIndex] = {
      familyId: targetBound[targetBoundIndex].familyId,
      kind: 'movable',
      parts: [{ partId: 'body', affordance: 'rotate', domain: 'lottie layer' }],
    };
    expect(() => validateMotionIntentCensus({ catalog, rows: targetBound }))
      .toThrow(/target runtime/);

    const movable = structuredClone(rows);
    const movableIndex = movable.findIndex((row) => !REQUIRED_MOVABLE_MISSION_FAMILIES.includes(row.familyId));
    movable[movableIndex] = {
      familyId: movable[movableIndex].familyId,
      kind: 'movable',
      parts: [{ partId: 'body', affordance: 'rotate', domain: 'cyclic-angle' }],
    };
    expect(() => validateMotionIntentCensus({ catalog, rows: movable })).not.toThrow();

    const vacuous = structuredClone(rows);
    const staticRows = vacuous.filter((row) => row.kind !== 'movable');
    staticRows[1].witnessDigest = staticRows[0].witnessDigest;
    expect(() => validateMotionIntentCensus({ catalog, rows: vacuous }))
      .toThrow(/переиспользует static witness/);

    const lostMissionIntent = structuredClone(rows);
    const reloadIndex = lostMissionIntent.findIndex((row) => row.familyId === 'reload');
    lostMissionIntent[reloadIndex] = {
      familyId: 'reload',
      kind: 'static-by-design',
      witnessCode: 'incorrect-static-reclassification',
      witnessDigest: createHash('sha256').update('incorrect-static-reload').digest('hex'),
    };
    expect(() => validateMotionIntentCensus({ catalog, rows: lostMissionIntent }))
      .toThrow(/mission family reload/);

    for (const familyId of ['sun', 'sun-low', 'time']) {
      const lostExplicitMissionIntent = structuredClone(rows);
      const index = lostExplicitMissionIntent.findIndex((row) => row.familyId === familyId);
      lostExplicitMissionIntent[index] = {
        familyId,
        kind: 'static-by-design',
        witnessCode: 'incorrect-static-reclassification',
        witnessDigest: createHash('sha256').update(`incorrect-static-${familyId}`).digest('hex'),
      };
      expect(() => validateMotionIntentCensus({ catalog, rows: lostExplicitMissionIntent }))
        .toThrow(new RegExp(`mission family ${familyId}`));
    }

    const lostCalendarState = structuredClone(rows);
    const calendarIndex = lostCalendarState.findIndex((row) => row.familyId === 'calendar-number');
    lostCalendarState[calendarIndex] = {
      familyId: 'calendar-number',
      kind: 'static-by-design',
      witnessCode: 'incorrect-static-reclassification',
      witnessDigest: createHash('sha256').update('incorrect-static-calendar-number').digest('hex'),
    };
    expect(() => validateMotionIntentCensus({ catalog, rows: lostCalendarState }))
      .toThrow(/discrete semantic state intent/);

    const hiddenRowChannel = structuredClone(rows);
    const hiddenRowIndex = hiddenRowChannel.findIndex((row) => row.kind !== 'movable');
    hiddenRowChannel[hiddenRowIndex].postHocHint = 'convenient later override';
    expect(() => validateMotionIntentCensus({ catalog, rows: hiddenRowChannel }))
      .toThrow(/скрытый набор полей/);

    const hiddenPartChannel = structuredClone(rows);
    const hiddenPartIndex = hiddenPartChannel.findIndex((row) => row.kind === 'movable');
    hiddenPartChannel[hiddenPartIndex].parts[0].postHocHint = 'convenient later override';
    expect(() => validateMotionIntentCensus({ catalog, rows: hiddenPartChannel }))
      .toThrow(/скрытый набор полей/);
  });

  it('static/unsupported motion classification связан с независимым sealed rationale', () => {
    const fixture = motionFixture();
    const census = validateMotionIntentCensus({ catalog, rows: fixture.rows });
    const receipt = validateMotionIntentEvidence({ motionCensus: census, evidence: fixture.evidence });
    expect(receipt.familyCount).toBe(EXPECTED_ICON_NAMES - REQUIRED_MOVABLE_MISSION_FAMILIES.length);
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);

    expect(() => validateMotionIntentEvidence({
      motionCensus: census,
      evidence: fixture.evidence.slice(1),
    })).toThrow(/не замыкает|отсутствует/);

    const changed = structuredClone(fixture.evidence);
    changed[0].rationale += ' post-hoc change';
    expect(() => validateMotionIntentEvidence({ motionCensus: census, evidence: changed }))
      .toThrow(/digest mismatch/);

    const relabeled = structuredClone(fixture.evidence);
    relabeled[0].witnessCode = 'post-hoc-skip';
    expect(() => validateMotionIntentEvidence({ motionCensus: census, evidence: relabeled }))
      .toThrow(/contract mismatch/);
  });

  it('static consumer baseline обязан доказывать canonical verify на том же source fence', () => {
    const consumer = {
      schema: 'labpics.icons-static-consumer-baseline/1',
      sourceFenceDigest: canonicalDigest(sourceFence),
      command: 'CI=true pnpm verify',
      exitCode: 0,
      toolchain: { node: 'v24.15.0', pnpm: '11.13.1' },
      checks: {
        testFilesPassed: 78,
        testsPassed: 901,
        cleanSourcePackFreshInstall: true,
        candidateOptInFailClosed: true,
        unsupportedAxisRefusal: true,
        staticSvgAndAcceptedIr: true,
        motionAdaptersNotExported: true,
        sourceCleanAfter: true,
      },
      digests: {
        packageJsonSha256: sourceFence.package.contractSha256,
        pnpmLockSha256: 'd'.repeat(64),
        releaseContractSha256: 'e'.repeat(64),
      },
    };
    expect(validateStaticConsumerBaseline({ sourceFence, baseline: consumer }).digest)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateStaticConsumerBaseline({
      sourceFence,
      baseline: { ...consumer, exitCode: 1 },
    })).toThrow(/canonical GREEN verify/);
    expect(() => validateStaticConsumerBaseline({
      sourceFence,
      baseline: { ...consumer, checks: { ...consumer.checks, cleanSourcePackFreshInstall: false } },
    })).toThrow(/cleanSourcePackFreshInstall/);
    expect(() => validateStaticConsumerBaseline({
      sourceFence,
      baseline: { ...consumer, sourceFenceDigest: 'f'.repeat(64) },
    })).toThrow(/другому source fence/);
  });

});
