import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANDATORY_TRAIN,
  ENVELOPE_REQUIRED_FIELDS,
  REQUIRED_MOVABLE_MISSION_FAMILIES,
  RETROSPECTIVE_HOLDOUT_SIZE,
  buildHoldoutLeakSignals,
  buildCorpusFreeAuthoringProjection,
  buildRetrospectivePartition,
  buildSealedCorpusManifest,
  buildTrainManifestProjection,
  scanHoldoutLeakage,
  structuralRows,
  validateGenerationEnvelopeProtocol,
  validateMotionIntentCensus,
  validateNovelChallengePolicy,
  validateRunLedgerProtocol,
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

function motionRows() {
  const names = Object.keys(catalog.icons).sort();
  const rows = names.map((familyId) => ({
    familyId,
    kind: 'static-by-design',
    witnessCode: 'semantic-static-review',
    witnessDigest: createHash('sha256').update(`static-witness\0${familyId}`).digest('hex'),
  }));
  for (const familyId of REQUIRED_MOVABLE_MISSION_FAMILIES) {
    const index = rows.findIndex((row) => row.familyId === familyId);
    rows[index] = {
      familyId,
      kind: 'movable',
      parts: [{ partId: 'primary', affordance: 'semantic-motion', domain: 'target-neutral-parameter' }],
    };
  }
  return rows;
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

  it('prospective policy замораживает semantics/quota/entropy до чтения candidate IDs', () => {
    const policy = {
      upstream: {
        repository: 'google/material-design-icons',
        commit: 'd'.repeat(40),
        identifiersPath: 'font/MaterialIconsOutlined-Regular.codepoints',
        identifiersOnly: true,
        geometryAllowed: false,
        codepointValuesAllowed: false,
      },
      equivalence: {
        ruleVersion: 'semantic-equivalence-v1',
        reasonCodes: ['same-referent-action-state'],
        forbiddenInputs: ['grammar', 'recipe-coverage', 'benchmark-score', 'model-trace', 'difficulty'],
      },
      semanticStrata: [
        { id: 'action', assignmentRule: 'action-before-state', goldenVectors: ['refresh=>action'] },
        { id: 'referent', assignmentRule: 'referent-fallback', goldenVectors: ['pet=>referent'] },
      ],
      quota: {
        algorithm: 'one-per-nonempty+capped-hamilton-v1',
        targetCount: 32,
        maxPerStratum: 8,
        tieBreak: 'stable-stratum-id',
      },
      selection: {
        entropy: 'nist-beacon-v2-first-valid-after-author-bench',
        seed: 'sha256(policyDigest||freezeHead||pulse.outputValue)',
        order: 'sha256(seed||stratum||briefId)',
      },
    };
    expect(validateNovelChallengePolicy(policy).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateNovelChallengePolicy({ ...policy, selectedBriefs: ['convenient-target'] }))
      .toThrow(/не может содержать/);
    expect(() => validateNovelChallengePolicy({
      ...policy,
      equivalence: { ...policy.equivalence, forbiddenInputs: ['benchmark-score'] },
    })).toThrow(/не закрывает implementability/);
    expect(() => validateNovelChallengePolicy({ ...policy, postHocHint: 'prefer easy targets' }))
      .toThrow(/скрытый набор полей/);
    expect(() => validateNovelChallengePolicy({
      ...policy,
      quota: { ...policy.quota, postHocHint: 'rebalance after seeing pool' },
    })).toThrow(/скрытый набор полей/);
  });

  it('generation envelope и durable ledger закрывают скрытые попытки', () => {
    const envelope = {
      immutableFields: ENVELOPE_REQUIRED_FIELDS,
      dynamicSlots: ['briefPayload', 'boundedFeedbackPayload'],
      providerDefaults: 'explicit-value-or-unsupported',
      sessionState: 'empty-or-byte-bound',
      retry: {
        preDispatchFailureConsumesAttempt: false,
        uncertainDispatchConsumesAttempt: true,
        lostResponseConsumesAttempt: true,
        byteIdenticalResendIsSameAttempt: 'provider-idempotency-or-no-execution-proof-only',
      },
    };
    expect(validateGenerationEnvelopeProtocol(envelope).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateGenerationEnvelopeProtocol({
      ...envelope,
      dynamicSlots: [...envelope.dynamicSlots, 'hiddenSystemPrompt'],
    })).toThrow(/скрытый dynamic slot/);
    expect(() => validateGenerationEnvelopeProtocol({
      ...envelope,
      retry: { ...envelope.retry, uncertainDispatchConsumesAttempt: false },
    })).toThrow(/attempt budget/);
    expect(() => validateGenerationEnvelopeProtocol({ ...envelope, postHocHint: 'hidden prefill' }))
      .toThrow(/скрытый набор полей/);
    expect(() => validateGenerationEnvelopeProtocol({
      ...envelope,
      retry: { ...envelope.retry, postHocHint: 'free retry' },
    })).toThrow(/скрытый набор полей/);

    const ledger = {
      sinkType: 'trusted-append-only-store',
      owner: 'verifier',
      retention: 'through-r10-terminal-plus-audit-window',
      readback: 'identity+contiguous-sequence+provider-outcome',
      canonicalRunRule: 'first-valid-run-start-per-freeze-identity',
      dispatchOrder: 'durable-intent-before-provider-dispatch',
      sequence: 'monotonic-contiguous',
      authorCapabilities: {
        appendIntent: false,
        directProviderCredential: false,
        directProviderEgress: false,
        delete: false,
        update: false,
      },
      verifierCapabilities: {
        appendIntent: true,
        providerCredential: true,
        providerEgress: true,
      },
      hardInvalidations: ['gap', 'unlogged-execution', 'extra-execution', 'second-canonical-run-after-dispatch'],
    };
    expect(validateRunLedgerProtocol(ledger).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateRunLedgerProtocol({
      ...ledger,
      authorCapabilities: { ...ledger.authorCapabilities, directProviderEgress: true },
    })).toThrow(/недопустимую ledger\/provider capability/);
    expect(() => validateRunLedgerProtocol({
      ...ledger,
      hardInvalidations: ledger.hardInvalidations.filter((item) => item !== 'extra-execution'),
    })).toThrow(/extra-execution/);
    expect(() => validateRunLedgerProtocol({ ...ledger, postHocHint: 'alternate canonical run' }))
      .toThrow(/скрытый набор полей/);
    expect(() => validateRunLedgerProtocol({
      ...ledger,
      verifierCapabilities: { ...ledger.verifierCapabilities, rewriteOutcome: true },
    })).toThrow(/скрытый набор полей/);
  });
});
